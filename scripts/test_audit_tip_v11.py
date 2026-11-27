import array
import base64
import io
import json
import math
from pathlib import Path
import random
from tempfile import TemporaryDirectory
import unittest
import wave
from unittest.mock import Mock

from align_tip_v11 import ASR_REVISION, GREETING_WINDOW_EVIDENCE, PHONE_WINDOW_EVIDENCE, align, align_with_signature_retry, tokens
from align_tip_v11 import GREETING_POSITION_EVIDENCE, GREETING_VAD_SHA256
from audit_tip_v11 import (
    AUDIO_PRESERVATION_WINDOW, CAPTION_SCENES, SAMPLE_RATE, bind_manifest, measure_audio,
    command, find_lag, measure_audio_preservation, normalized_ocr_text, pcm, reference_aac_proof, sha256, verify_alignment,
)
from test_align_tip_v11 import SEGMENTS, speech


class V11FinalEvidenceTest(unittest.TestCase):
    def setUp(self):
        source = random.Random(23)
        self.voice = array.array('h', [source.randint(-5000, 5000) for _ in range(SAMPLE_RATE * 4)])
        self.final = array.array('h', [0] * 48)
        self.final.extend(round(sample * .707) for sample in self.voice)
        self.segments = [
            {'id': 'opening', 'start': 0, 'end': 2},
            {'id': 'body', 'start': 2, 'end': 4},
        ]

    def test_confirms_a_single_mux_offset_and_expected_gain(self):
        result = measure_audio(self.segments, self.voice, self.voice, self.final)
        self.assertTrue(result['passed'])
        self.assertEqual(result['lag_samples'], 48)
        self.assertGreater(result['segments'][0]['narration_similarity'], .9999)

    def test_detects_a_muted_segment_despite_unchanged_duration(self):
        start = 48 + SAMPLE_RATE * 5 // 2
        length = SAMPLE_RATE // 2
        self.final[start:start + length] = array.array('h', [0] * length)
        result = measure_audio(self.segments, self.voice, self.voice, self.final)
        self.assertFalse(result['passed'])
        self.assertTrue(result['segments'][0]['passed'])
        self.assertFalse(result['segments'][1]['passed'])

    def test_rejects_a_muted_quiet_signature_tail(self):
        tail_start, tail_end = 36 * SAMPLE_RATE // 10, 37 * SAMPLE_RATE // 10
        silence_start = SAMPLE_RATE * 7 // 2
        tail = array.array('h', (round(sample / 8) for sample in self.voice[tail_start:tail_end]))
        self.voice[silence_start:] = array.array('h', [0]) * (len(self.voice) - silence_start)
        self.voice[tail_start:tail_end] = tail
        lag = 48
        final = array.array('h', [0]) * lag
        final.extend(round(sample * .707) for sample in self.voice)
        segments = [self.segments[0], {**self.segments[1], 'id': 'signature'}]
        self.assertTrue(measure_audio(segments, self.voice, self.voice, final)['passed'])

        final[tail_start + lag:tail_end + lag] = array.array('h', [0]) * len(tail)
        result = measure_audio(segments, self.voice, self.voice, final)
        self.assertFalse(result['passed'])
        self.assertTrue(result['segments'][0]['passed'])
        self.assertFalse(result['segments'][1]['passed'])

    def preservation(self, decoded, mix=None, **options):
        buffer = io.BytesIO()
        with wave.open(buffer, 'wb') as effects:
            effects.setparams((1, 2, SAMPLE_RATE, 0, 'NONE', 'not compressed'))
            effects.writeframes(bytes(2 * len(self.voice)))
        return measure_audio_preservation(
            {}, self.voice, self.voice if mix is None else mix, decoded.tobytes(), 48,
            effects=lambda _: buffer.getvalue(), **options,
        )

    def test_preservation_rejects_quiet_local_mute_and_substitution_missed_by_waveform(self):
        window = AUDIO_PRESERVATION_WINDOW
        start = SAMPLE_RATE * 5 // 2
        self.voice[start:start + window] = array.array('h', (round(sample / 26)
                                                               for sample in self.voice[start:start + window]))
        self.final[start + 48:start + 48 + window] = array.array('h', (round(sample * .707)
                                                                        for sample in self.voice[start:start + window]))
        clean = self.preservation(self.final)
        self.assertEqual(clean['status'], 'matched')
        self.assertEqual(clean['windows_over_limit'], 0)
        self.assertEqual(clean['decoded_pcm_sha256'], sha256(self.final.tobytes()))
        for replacement in (array.array('h', [0]) * window, self.final[1090:1090 + window]):
            with self.subTest(first_sample=replacement[0]):
                altered = self.final[:]
                altered[start + 48:start + 48 + window] = replacement
                self.assertTrue(measure_audio(self.segments, self.voice, self.voice, altered)['passed'])
                proof = self.preservation(altered)
                self.assertEqual(proof['status'], 'inconclusive')
                self.assertEqual(proof['reason'], 'local_sample_residual_over_limit')
                self.assertGreater(proof['windows_over_limit'], 0)

    def test_preservation_rejects_matching_but_modified_mix_and_changed_padding(self):
        tampered_mix = self.voice[:]
        tampered_mix[1234] = 0 if tampered_mix[1234] else 1
        tampered_final = self.final[:]
        tampered_final[1234 + 48] = round(tampered_mix[1234] * .707)
        self.assertEqual(self.preservation(tampered_final, tampered_mix)['reason'], 'canonical_mix_differs')

        ended_early = self.final[:-1]
        self.assertEqual(self.preservation(ended_early)['reason'], 'incomplete_aligned_samples')
        for shifted in (array.array('h', [200]) + self.final[1:], self.final + array.array('h', [200])):
            with self.subTest(final_samples=len(shifted)):
                self.assertEqual(self.preservation(shifted)['reason'], 'unexpected_padding_audio')

    def add_local_noise(self, decoded, start, length, fraction=.23):
        # Independent, deterministic noise at a fraction of the reference RMS.
        # This models a measurable residual without encoding a second MP4.
        noise = random.Random(start)
        for i in range(48 + start, 48 + start + length):
            decoded[i] += round(fraction * .707 * noise.randint(-5000, 5000))

    def test_sparse_coherent_residual_retains_original_excess_and_pcm_identity(self):
        original = self.preservation(self.final)
        self.assertEqual(original['contract'], 'tip-v11-final-audio-preservation-v1')
        self.assertNotIn('codec_exceptions', original)
        start = SAMPLE_RATE
        self.add_local_noise(self.final, start, AUDIO_PRESERVATION_WINDOW)
        report = self.preservation(self.final)
        self.assertEqual((report['status'], report['contract']), ('matched', 'tip-v11-final-audio-preservation-v2'))
        rows = report['codec_exceptions']
        self.assertEqual([row[0] for row in rows], [100])
        self.assertEqual(report['decoded_pcm_sha256'], sha256(self.final.tobytes()))
        self.assertEqual(report['windows_over_limit'], len(rows))
        self.assertEqual(report['worst_residual_to_limit_ppm'], max(row[1] for row in rows))
        self.assertGreater(rows[0][1], 1_000_000)
        self.assertLessEqual(rows[0][5], 1_000_000)

    def test_sparse_allowance_rejects_local_attenuation_shift_or_other_voice(self):
        start = 48 + SAMPLE_RATE
        length = AUDIO_PRESERVATION_WINDOW
        for name, replacement in (
            ('attenuated', array.array('h', (round(sample * .75) for sample in self.final[start:start + length]))),
            ('shifted', self.final[start + 12:start + length + 12]),
            ('substituted', self.final[900:900 + length]),
        ):
            with self.subTest(name=name):
                altered = self.final[:]
                altered[start:start + length] = replacement
                if name == 'attenuated':
                    self.assertTrue(measure_audio(self.segments, self.voice, self.voice, altered)['passed'])
                self.assertEqual(self.preservation(altered)['reason'], 'local_sample_residual_over_limit')

    def test_exception_duration_includes_touching_windows_and_separate_bursts(self):
        window = AUDIO_PRESERVATION_WINDOW
        for name, offsets in (
            ('contiguous', [SAMPLE_RATE, SAMPLE_RATE + window]),
            ('sparse window count but excessive union duration', [SAMPLE_RATE, 2 * SAMPLE_RATE, 3 * SAMPLE_RATE]),
            ('unmeasurable edge context', [0]),
        ):
            with self.subTest(name=name):
                altered = self.final[:]
                for start in offsets:
                    self.add_local_noise(altered, start, window)
                result = self.preservation(altered)
                self.assertEqual(result['reason'], 'local_sample_residual_over_limit')
                self.assertLessEqual(result['worst_residual_to_limit_ppm'], 2_000_000)

    def test_quiet_unrelated_energy_is_rejected_even_when_source_gain_is_preserved(self):
        start, window = SAMPLE_RATE, AUDIO_PRESERVATION_WINDOW
        for i in range(window):
            # The alternating orthogonal component overwhelms the quiet signal.
            value = 42 if i % 2 else -42
            self.voice[start + i] = value
            self.final[48 + start + i] = round(value * .707) + (38 if i % 4 < 2 else -38)
        result = self.preservation(self.final)
        self.assertEqual(result['reason'], 'local_sample_residual_over_limit')
        self.assertLessEqual(result['worst_residual_to_limit_ppm'], 2_000_000)

    def test_isolated_signal_cannot_explain_an_excess_in_its_surrounding_context(self):
        start, window = SAMPLE_RATE, AUDIO_PRESERVATION_WINDOW
        for left in (start - window, start + window):
            self.voice[left:left + window] = array.array('h', [0]) * window
            self.final[48 + left:48 + left + window] = array.array('h', [0]) * window
        self.add_local_noise(self.final, start, window)
        result = self.preservation(self.final)
        self.assertEqual(result['reason'], 'local_sample_residual_over_limit')
        self.assertLessEqual(result['worst_residual_to_limit_ppm'], 2_000_000)

    def test_reference_requires_every_sample_and_the_same_stereo_aac_packets(self):
        self.voice *= 8
        self.final.extend(self.final[48:] * 7)
        start, window = SAMPLE_RATE, AUDIO_PRESERVATION_WINDOW
        for left in (start - window, start + window):
            self.voice[left:left + window] = array.array('h', [0]) * window
            self.final[48 + left:48 + left + window] = array.array('h', [0]) * window
        self.add_local_noise(self.final, start, window)
        expected = self.final.tobytes()
        packets = 'a' * 64
        mix_sha = 'b' * 64
        proof = self.preservation(self.final, reference_proof=lambda: (expected, packets, packets),
                                  mix_wav_sha256=mix_sha)
        self.assertEqual(proof['contract'], 'tip-v11-final-audio-preservation-v3')
        self.assertEqual(proof['status'], 'matched')
        self.assertEqual(proof['codec_v2_rejection'], {'check': 'context_residual', 'window': 99})
        self.assertEqual(proof['codec_reference']['over_limit_indices'], [99, 100, 101])
        self.assertEqual(proof['codec_reference']['decoded_pcm_sha256'], sha256(expected))
        self.assertEqual(proof['codec_reference']['mix_wav_sha256'], mix_sha)
        for name, witness in [('one changed decoded sample', (expected[:-2] + b'xx', packets, packets)),
                              ('different stereo stream', (expected, packets, 'c' * 64))]:
            with self.subTest(name=name):
                failed = self.preservation(self.final, reference_proof=lambda: witness, mix_wav_sha256=mix_sha)
                self.assertEqual(failed['status'], 'inconclusive')
                self.assertEqual(failed['codec_reference_status'], 'different')
        unavailable = self.preservation(self.final, reference_proof=Mock(side_effect=OSError),
                                        mix_wav_sha256=mix_sha)
        self.assertEqual(unavailable['status'], 'inconclusive')
        self.assertEqual(unavailable['codec_reference_status'], 'unavailable')

    def test_real_fdk_aac_mild_burst_matches_both_streams(self):
        # A chirp establishes one unique lag. One very quiet 11.5 kHz burst
        # causes a small projection miss in otherwise identical FDK output.
        duration = 61
        signal = array.array('h', [0]) * (duration * SAMPLE_RATE)
        for index in range(4 * SAMPLE_RATE):
            seconds = index / SAMPLE_RATE
            envelope = min(1, index / 480, (4 * SAMPLE_RATE - index) / 480)
            signal[index] = round(5000 * math.sin(2 * math.pi * (200 * seconds + 130 * seconds ** 2)) * envelope)
        for index in range(1350):
            envelope = min(1, index / 40, (1350 - index) / 40)
            signal[31 * SAMPLE_RATE + index] = round(90 * math.sin(2 * math.pi * 11500 * index / SAMPLE_RATE) * envelope)

        with TemporaryDirectory() as directory:
            root = Path(directory)
            mix, aac, master = root / 'mix.wav', root / 'audio.aac', root / 'mux.m4a'
            with wave.open(str(mix), 'wb') as wav:
                wav.setparams((1, 2, SAMPLE_RATE, 0, 'NONE', 'none'))
                wav.writeframes(signal.tobytes())
            command('node', Path(__file__).with_name('tip-v11-reference-aac.mjs'), mix, aac)
            command('ffmpeg', '-v', 'error', '-i', aac, '-c:a', 'copy', '-use_editlist', '0', master)
            decoded = command('ffmpeg', '-v', 'error', '-f', 'mov', '-i', master,
                              '-ac', '1', '-ar', str(SAMPLE_RATE), '-f', 's16le', '-')
            mix_sha = sha256(mix.read_bytes())
            proof = measure_audio_preservation(
                {'segments': [], 'durationInFrames': duration * 30}, signal, signal, decoded,
                find_lag(signal, pcm(decoded)), reference_proof=lambda: reference_aac_proof(mix, mix_sha, master),
                mix_wav_sha256=mix_sha,
            )
        self.assertEqual((proof['status'], proof['contract']), ('matched', 'tip-v11-final-audio-preservation-v3'))
        self.assertEqual(proof['codec_v2_rejection'], {'check': 'projection', 'window': 3100})
        self.assertEqual(proof['codec_reference']['over_limit_indices'], [3100, 3101, 3102, 3103, 3104])
        self.assertEqual(proof['codec_reference']['reference_aac_packets_sha256'],
                         proof['codec_reference']['rendered_aac_packets_sha256'])

    def test_ordinary_or_severe_measurements_do_not_invoke_the_reference_encoder(self):
        unused = Mock(side_effect=AssertionError)
        self.assertEqual(self.preservation(self.final, reference_proof=unused,
                                          mix_wav_sha256='b' * 64)['status'], 'matched')
        self.final[SAMPLE_RATE:2 * SAMPLE_RATE] = array.array('h', [0]) * SAMPLE_RATE
        self.assertEqual(self.preservation(self.final, reference_proof=unused,
                                          mix_wav_sha256='b' * 64)['status'], 'inconclusive')
        unused.assert_not_called()

    def test_contact_ocr_preserves_meaningful_punctuation_and_digits(self):
        phone = normalized_ocr_text('phone', '+221 76 944 48 49')
        self.assertNotEqual(phone, normalized_ocr_text('phone', '221 76 944 48 49'))
        self.assertNotEqual(phone, normalized_ocr_text('phone', '+221 76 944 48 48'))
        self.assertNotEqual(normalized_ocr_text('domain', 'jammimmo.com'),
                            normalized_ocr_text('domain', 'jammimmo com'))

    def test_caption_ocr_tolerates_accents_and_line_breaks_only_at_word_level(self):
        caption = normalized_ocr_text('caption_step1', 'L’eau à vérifier\nau lavabo.')
        self.assertEqual(caption, normalized_ocr_text('caption_step1', "L'eau a verifier au lavabo"))
        self.assertNotEqual(caption, normalized_ocr_text('caption_step1', 'Eau à vérifier au lavabo'))
        self.assertNotEqual(caption, normalized_ocr_text('caption_step1', 'L’eau à fermer au lavabo.'))

    def test_audits_the_timeline_from_a_successful_signature_retry(self):
        words = speech(SEGMENTS)
        tail_length = len(tokens(SEGMENTS[-1]['text']))
        body, ending = words[:-tail_length], words[-tail_length:]
        unclear_ending = [{**word, 'word': 'inaudible'} for word in ending]
        sound = [(word['start'], word['end']) for word in words]
        boundaries = []

        def recognize_tail(boundary):
            boundaries.append(boundary)
            return ending

        alignment = align_with_signature_retry(SEGMENTS, body + unclear_ending, 70, sound, recognize_tail)
        alignment['provenance'] = ASR_REVISION
        self.assertEqual(boundaries, [body[-1]['end']])
        self.assertEqual(alignment['method'], 'french-v11-word-anchors-signature-retry')
        self.assertTrue(alignment['reviewRequired'])
        self.assertEqual(verify_alignment(json.dumps(alignment)), alignment)

        for changes in ({'method': 'unknown'}, {'provenance': 'local-word-timings'}, {'reviewRequired': False}):
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, 'alignment identity'):
                verify_alignment(json.dumps(alignment | changes))

    def test_greeting_marker_requires_pinned_decoder_and_review_identity(self):
        alignment = align(SEGMENTS, speech(SEGMENTS), 70) | {
            'provenance': ASR_REVISION, 'greetingEvidenceMethod': GREETING_WINDOW_EVIDENCE,
        }
        self.assertEqual(verify_alignment(json.dumps(alignment)), alignment)
        for changes in ({'greetingEvidenceMethod': 'unknown'}, {'greetingEvidenceMethod': None},
                        {'provenance': 'local-word-timings'}, {'reviewRequired': False}):
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, 'alignment identity'):
                verify_alignment(json.dumps(alignment | changes))

    def test_positional_caption_requires_exact_unscored_source_interval(self):
        rows = speech(SEGMENTS)
        alignment = align(SEGMENTS, rows, 70) | {'provenance': ASR_REVISION, 'greetingEvidenceMethod': GREETING_POSITION_EVIDENCE}
        onset = alignment['segments'][1]['start']
        end_sample = int(onset * SAMPLE_RATE)
        evidence = {'end_sample': end_sample, 'speech_samples_16k': 16384,
                    'prefix_pcm_sha256': sha256(self.voice[:end_sample].tobytes()), 'vad_sha256': GREETING_VAD_SHA256,
                    'words_evaluated': False}
        alignment['greetingPositionEvidence'] = evidence
        self.assertEqual(verify_alignment(json.dumps(alignment), self.voice), alignment)
        with self.assertRaisesRegex(ValueError, 'different narration samples'):
            verify_alignment(json.dumps(alignment), array.array('h', [0]) * end_sample)
        for changes in ({'end_sample': evidence['end_sample'] - 1}, {'words_evaluated': True},
                        {'speech_samples_16k': 9216}, {'speech_samples_16k': 16383}, {'vad_sha256': 'b' * 64}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                verify_alignment(json.dumps(alignment | {'greetingPositionEvidence': evidence | changes}))
        with self.assertRaises(ValueError):
            verify_alignment(json.dumps(alignment | {'greetingEvidenceMethod': GREETING_WINDOW_EVIDENCE}))

    def test_focused_phone_marker_requires_the_pinned_decoder_and_same_review_contract(self):
        alignment = align(SEGMENTS, speech(SEGMENTS), 70) | {
            'provenance': ASR_REVISION, 'phoneEvidenceMethod': PHONE_WINDOW_EVIDENCE,
        }
        self.assertEqual(verify_alignment(json.dumps(alignment)), alignment)
        for changes in ({'phoneEvidenceMethod': 'unknown'}, {'phoneEvidenceMethod': None},
                        {'provenance': 'local-word-timings'}, {'reviewRequired': False}):
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, 'alignment identity'):
                verify_alignment(json.dumps(alignment | changes))

        altered_segments = [*alignment['segments'][:-1], {**alignment['segments'][-1], 'start': 0}]
        with self.assertRaisesRegex(ValueError, 'alignment row'):
            verify_alignment(json.dumps(alignment | {'segments': altered_segments}))

    def test_binds_exact_render_files_and_actual_assistant_scene(self):
        segments = [{'id': item, 'text': f'Texte {item}.'} for item in (*CAPTION_SCENES, 'assistant')]
        alignment = {'segments': segments, 'captions': [], 'durationInFrames': 1801, 'phoneGroups': []}
        props = {**alignment, 'audio': 'audio/voiceovers/mix.wav',
                 'title': 'Titre local', 'assistantEnabled': True, 'visualTopic': 'general'}
        alignment_bytes = json.dumps(alignment).encode()
        props_bytes = json.dumps(props).encode()
        media, raw, narration, mix = (sha256(name.encode()) for name in ('video', 'raw', 'narration', 'mix'))
        manifest = {
            'contract': 'tip-v11-fr-render-inputs-v1', 'assistant_enabled': True, 'visual_topic': 'general',
            'title_sha256': sha256(props['title'].encode()),
            'rendered_advice_sha256': sha256(' '.join(row['text'] for row in segments[1:-1]).encode()),
            'narration_text_sha256': sha256(' '.join(row['text'] for row in segments).encode()),
            'props_sha256': sha256(props_bytes), 'alignment_sha256': sha256(alignment_bytes),
            'raw_wav_sha256': raw, 'narration_wav_sha256': narration, 'mix_wav_sha256': mix, 'media_sha256': media,
        }
        args = (props_bytes, alignment_bytes, alignment, media, raw, narration, mix, 'mix.wav')
        manifest_bytes = json.dumps(manifest).encode()
        self.assertEqual(bind_manifest(manifest_bytes, *args), {
            'render_manifest_sha256': sha256(manifest_bytes),
            'render_manifest_b64': base64.b64encode(manifest_bytes).decode('ascii'),
        })
        for override in ({'assistant_enabled': False}, {'raw_wav_sha256': mix}, {'media_sha256': mix},
                         {'narration_text_sha256': mix}, {'props_sha256': mix}):
            with self.assertRaisesRegex(ValueError, 'differs from the audited render inputs'):
                bind_manifest(json.dumps(manifest | override).encode(), *args)


if __name__ == '__main__':
    unittest.main()
