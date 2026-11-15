import array
import base64
import json
import random
import unittest

from align_tip_v11 import ASR_REVISION, PHONE_WINDOW_EVIDENCE, align, align_with_signature_retry, tokens
from audit_tip_v11 import (
    CAPTION_SCENES, SAMPLE_RATE, bind_manifest, measure_audio, normalized_ocr_text, sha256, verify_alignment,
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
