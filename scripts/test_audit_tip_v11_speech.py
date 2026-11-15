import json
from pathlib import Path
import struct
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import wave

from audit_tip_v11 import audit
from audit_tip_v11_speech import (
    ASR_REVISION, MAX_RECOGNIZED_WORDS, RECOGNITION_TIMEOUT_SECONDS, compare_french_segments, measure_final_french_speech,
    recognize_final_wav, recognize_with_timeout, sha256,
)


class V11FinalSpeechTest(unittest.TestCase):
    segments = [
        {'id': 'greeting', 'text': 'Salam alikoum ! Nanga def ?', 'start': 0, 'end': 2},
        {'id': 'hook', 'text': "L’eau : à vérifier avant d’acheter.", 'start': 2, 'end': 5},
        {'id': 'domain', 'text': 'Jamm Immo point com.', 'start': 5, 'end': 7},
        {'id': 'phone', 'text': 'Plus deux cent vingt et un soixante-seize neuf cent quarante-quatre quarante-huit quarante-neuf.',
         'start': 7, 'end': 11},
        {'id': 'signature', 'text': 'Jamm Immo ! Kër gu baax, xel mu dal !', 'start': 11, 'end': 14},
    ]
    recognized = [
        ('Wolof greeting output', .2, 1.7, .3),
        (" L'eau", 2.1, 2.4, .92), (' a', 2.5, 2.6, .88), (' verifier', 2.7, 3.2, .91),
        (' avant', 3.3, 3.7, .95), (" d'acheter.", 3.8, 4.4, .98),
        (' JammImmo.com', 5.1, 6.0, .9),
        (' +221', 7.2, 7.5, .92), (' 76', 7.6, 8.0, .93), (' 944', 8.1, 8.8, .98),
        (' 48', 8.9, 9.2, .89), (' 49.', 9.3, 10.8, .96),
        ('Wolof signature output', 11.2, 13.8, .4),
    ]
    decoded = struct.pack('<5h', 400, -200, 31, 106, -8)

    def measure(self, words=None, waveform=None):
        with TemporaryDirectory() as folder:
            def recognize(wav_path):
                with wave.open(str(wav_path), 'rb') as source:
                    self.assertEqual((source.getnchannels(), source.getsampwidth(), source.getframerate()), (1, 2, 24000))
                    self.assertEqual(source.readframes(source.getnframes()), self.decoded)
                return self.recognized if words is None else words
            # Assert outside the method's fail-closed exception handler if the model is called.
            result = measure_final_french_speech(self.segments, self.decoded,
                                                 waveform or {'passed': True, 'lag_samples': 0}, folder, recognize)
            self.assertNotEqual(result.get('reason'), 'recognizer_unavailable')
            return result

    def test_exact_full_french_uses_normalized_words_and_keeps_other_speech_out_of_scope(self):
        result = self.measure()
        self.assertEqual(result['status'], 'matched')
        self.assertEqual(result['decoded_pcm_sha256'], sha256(self.decoded))
        self.assertEqual(result['excluded_segments'], ['greeting', 'signature'])
        self.assertFalse(result['accent_evaluated'])
        self.assertEqual([row['segment'] for row in result['segments']], ['hook', 'domain', 'phone'])
        for row in result['segments']:
            self.assertEqual(row['status'], 'matched')
            self.assertEqual(row['expected_sha256'], row['observed_sha256'])
            self.assertEqual(row['expected_token_count'], row['observed_token_count'])
        self.assertNotIn('Wolof greeting output', json.dumps(result))

    def test_insertions_deletions_substitutions_and_low_confidence_are_inconclusive(self):
        words = self.recognized
        variants = [
            words[:4] + words[5:],
            words[:4] + [(' et', 3.25, 3.29, .93)] + words[4:],
            words[:3] + [(' fermer', 2.7, 3.2, .93)] + words[4:],
            words[:4] + [(' zéro', 3.3, 3.7, .95)] + words[5:],
            words[:4] + [(' avant', 3.3, 3.7, .59)] + words[5:],
            words[:4] + [(' слова', 3.25, 3.29, .93)] + words[4:],
            words[:6] + [(' Jam Imo point com', 5.1, 6.0, .9)] + words[7:],
            words[:7] + [(' 221', 7.2, 7.5, .92)] + words[8:],
            words[:11] + [(' 48.', 9.3, 10.8, .96)] + words[12:],
        ]
        for sequence in variants:
            with self.subTest(sequence=sequence):
                result = self.measure(sequence)
                self.assertEqual(result['status'], 'inconclusive')
                self.assertEqual(result['reason'], 'ordered_words_unconfirmed')
        self.assertEqual(self.measure([])['status'], 'inconclusive')

    def test_missing_timing_or_ambiguous_mixed_language_boundary_is_inconclusive(self):
        for bad_word in [('mot', 1.8, 2.1, .93), ('mot', float('nan'), 2.1, .93),
                         ('mot', 2.1, 2.3, 2.), ('mot', 2.1, 2.1, .93)]:
            with self.subTest(bad_word=bad_word):
                result = self.measure(self.recognized[:1] + [bad_word] + self.recognized[1:])
                self.assertEqual(result['reason'], 'recognition_or_timing_inconclusive')
        repeated = [('bonjour', .2, .3, .9)] * (MAX_RECOGNIZED_WORDS + 1)
        self.assertEqual(self.measure(repeated)['reason'], 'recognition_or_timing_inconclusive')

    def test_mixed_language_timing_reports_other_french_scenes_without_accepting_exact_but_ambiguous_words(self):
        for index, end, affected in [(0, 2.06, 'hook'), (11, 11.12, 'phone')]:
            with self.subTest(affected=affected):
                recognized = self.recognized.copy()
                text, start, _, probability = recognized[index]
                recognized[index] = text, start, end, probability
                result = self.measure(recognized)
                self.assertEqual(result['status'], 'inconclusive')
                self.assertEqual(result['reason'], 'recognition_or_timing_inconclusive')
                self.assertEqual([row['segment'] for row in result['segments']], ['hook', 'domain', 'phone'])
                for row in result['segments']:
                    self.assertEqual(row['observed_sha256'], row['expected_sha256'])
                    if row['segment'] == affected:
                        self.assertEqual(row['status'], 'inconclusive')
                        self.assertEqual(row['reason'], 'mixed_language_boundary')
                    else:
                        self.assertEqual(row['status'], 'matched')

    def test_neighboring_french_scenes_use_one_exact_partition_without_reusing_brand_words(self):
        scenes = [
            {'id': 'takeaway', 'text': 'Consultez Jamm Immo.', 'start': 0, 'end': 4},
            {'id': 'services', 'text': 'Jamm Immo vous accompagne.', 'start': 4, 'end': 7},
        ]
        words = [
            ('Consultez', .6, 1.2, .9), ('Jamm', 1.7, 2, .9), ('Immo', 2.1, 2.4, .9),
            ('Jamm', 3.1, 3.55, .9), ('Immo', 3.6, 4.1, .9),
            ('vous', 4.2, 4.4, .9), ('accompagne', 4.6, 5.2, .9),
        ]
        result = compare_french_segments(scenes, words, 0)
        self.assertEqual([row['status'] for row in result], ['matched', 'matched'])
        self.assertEqual([row['observed_token_count'] for row in result], [3, 4])
        for row in result:
            self.assertEqual(row['observed_sha256'], row['expected_sha256'])

        for label, changed in {
            'deleted-left-word': words[:2] + words[3:],
            'deleted-right-word': words[:3] + words[4:],
            'inserted-word': words[:3] + [('déjà', 2.6, 2.8, .9)] + words[3:],
            'duplicate-word': words[:3] + [words[3]] + words[3:],
            'reordered-phrase': words[:3] + [('Immo', 3.1, 3.55, .9), ('Jamm', 3.6, 4.1, .9)] + words[5:],
            'substituted-name': words[:3] + [('Jam', 3.1, 3.55, .9)] + words[4:],
            'unconfident-word': words[:3] + [('Jamm', 3.1, 3.55, .59)] + words[4:],
            'overlapping-word': words[:3] + [('Jamm', 3.1, 3.7, .9)] + words[4:],
            'indivisible-row': words[:2] + [('Immo Jamm', 2.1, 3.55, .9)] + words[4:],
        }.items():
            with self.subTest(label=label):
                self.assertIn('inconclusive', [row['status'] for row in compare_french_segments(scenes, changed, 0)])
        delayed = [{**scenes[0], 'end': 5}, {**scenes[1], 'start': 5}]
        self.assertIn('inconclusive', [row['status'] for row in compare_french_segments(delayed, words, 0)])

    def test_final_phone_recovers_only_the_exact_pcm_between_confirmed_neighbors(self):
        scenes = [
            {'id': 'contact', 'text': 'Au même numéro.', 'start': 0, 'end': 2.5},
            {**self.segments[3], 'start': 2.5, 'end': 8.2},
            {'id': 'socials', 'text': 'Suivez aussi Jamm Immo.', 'start': 8.2, 'end': 10},
        ]
        full = [
            ('Au', .2, .4, .9), ('même', .4, .8, .9), ('numéro', .9, 2.35, .9),
            ('Plus', 2.35, 2.9, .23), ('221', 2.9, 3.9, .9), ('76', 3.9, 4.9, .9),
            ('944', 4.9, 6, .9), ('48', 6, 6.9, .9), ('49', 6.9, 7.95, .9),
            ('Suivez', 7.95, 8.4, .9), ('aussi', 8.4, 8.9, .9),
            ('Jamm', 8.9, 9.2, .9), ('Immo', 9.2, 9.6, .9),
        ]
        focused = [
            ('+', .1, .5, .72), ('221', .55, 1.4, .9), ('76', 1.4, 2.4, .9),
            ('944', 2.4, 3.4, .9), ('48', 3.4, 4.4, .9), ('49', 4.4, 5.2, .9),
        ]
        pcm = bytes(range(256)) * 2000
        lag = 1024
        first, last = round(2.35 * 24_000) + lag, round(7.95 * 24_000) + lag
        with TemporaryDirectory() as folder:
            def verify_scene(path):
                with wave.open(str(path), 'rb') as audio:
                    self.assertEqual(audio.readframes(audio.getnframes()), pcm[first * 2:last * 2])
                return focused

            def audit_words(words, scene_reader, audio_pcm=pcm):
                shifted = [(text, start + lag / 24_000, end + lag / 24_000, probability)
                           for text, start, end, probability in words]
                return measure_final_french_speech(scenes, audio_pcm, {'passed': True, 'lag_samples': lag}, folder,
                                                   lambda unused: shifted, scene_reader)

            reader = Mock(side_effect=verify_scene)
            result = audit_words(full, reader)
            reader.assert_called_once()
            self.assertEqual(result['status'], 'inconclusive', 'recovery cannot mark the neighboring scene matched')
            self.assertEqual(result['segments'][1]['status'], 'matched')
            self.assertEqual(result['segments'][1]['measurement'], {
                'method': 'phone_exact_neighbor_window', 'start_sample': first, 'end_sample': last,
                'pcm_sha256': sha256(pcm[first * 2:last * 2]),
            })

            for changed in (
                full[:4] + [('sept', 2.99, 3.6, .9)] + full[5:],
                full[:2] + [('numéro', .9, 2.35, .59)] + full[3:],
                full[:9] + [('Écoutez', 7.95, 8.4, .99)] + full[10:],
                full[:8] + [('49', 6.9, 8, .99)] + full[9:],
            ):
                forbidden = Mock()
                report = audit_words(changed, forbidden)
                forbidden.assert_not_called()
                self.assertEqual(report['segments'][1]['status'], 'inconclusive')

            for changed in (focused[1:], focused[:1] + [('221', .55, 1.4, .59)] + focused[2:],
                            focused[:1] + [('221', .45, 1.4, .9)] + focused[2:],
                            focused + [('suivez', 5.2, 5.4, .9)]):
                with self.subTest(changed=changed):
                    rejected = audit_words(full, lambda unused: changed)
                    self.assertEqual(rejected['segments'][1]['status'], 'inconclusive')

            silent_guess = Mock(return_value=focused)
            self.assertEqual(audit_words(full, silent_guess, bytes(len(pcm)))['segments'][1]['status'], 'inconclusive')
            silent_guess.assert_not_called()
            prefix_end = first + round(.55 * 24_000)
            missing_plus = pcm[:first * 2] + bytes((prefix_end - first) * 2) + pcm[prefix_end * 2:]
            self.assertEqual(audit_words(full, lambda unused: focused, missing_plus)['segments'][1]['status'],
                             'inconclusive')

    def test_standalone_plus_requires_focused_evidence(self):
        bare_symbol = self.recognized[:7] + [('+', 7.2, 7.3, .96), ('221', 7.3, 7.5, .96)] + self.recognized[8:]
        report = self.measure(bare_symbol)
        self.assertEqual(report['segments'][2]['status'], 'inconclusive')
        expected_count = report['segments'][2]['expected_token_count']
        self.assertEqual(report['segments'][2]['observed_token_count'], expected_count)

    def test_mux_offset_and_model_failure_fail_closed(self):
        shifted = [(text, start + .002, end + .002, probability)
                   for text, start, end, probability in self.recognized]
        self.assertEqual(self.measure(shifted, {'passed': True, 'lag_samples': 48})['status'], 'matched')
        with TemporaryDirectory() as folder:
            recognizer = Mock(side_effect=RuntimeError('private path and raw words'))
            result = measure_final_french_speech(self.segments, self.decoded, {'passed': True, 'lag_samples': 0},
                                                 folder, recognizer)
            self.assertEqual(result['reason'], 'recognizer_unavailable')
            self.assertNotIn('private path', json.dumps(result))
            recognizer.assert_called_once()
            recognizer.reset_mock()
            result = measure_final_french_speech(self.segments, self.decoded, {'passed': False}, folder, recognizer)
            self.assertEqual(result['reason'], 'waveform_unconfirmed')
            recognizer.assert_not_called()

    def test_recognizer_gets_only_decoded_audio_and_pinned_local_model(self):
        model = Mock()
        model.transcribe.return_value = ([SimpleNamespace(words=[
            SimpleNamespace(word=' test', start=.1, end=.3, probability=.9),
        ])], None)
        package = SimpleNamespace(WhisperModel=Mock(return_value=model), download_model=Mock(return_value='local-model'))
        with patch.dict('sys.modules', {'faster_whisper': package}):
            self.assertEqual(list(recognize_final_wav(Path('/tmp/synthetic-final.wav'))), [(' test', .1, .3, .9)])
        self.assertEqual(package.download_model.call_args.kwargs, {'revision': ASR_REVISION, 'local_files_only': True})
        model.transcribe.assert_called_once_with('/tmp/synthetic-final.wav', language='fr', beam_size=5,
                                                 word_timestamps=True, condition_on_previous_text=False,
                                                 initial_prompt=None, hotwords=None, vad_filter=False)

    def test_recognition_subprocess_is_bounded_and_gets_no_script_content(self):
        audio = '/tmp/synthetic-final.wav'
        with patch('audit_tip_v11_speech.subprocess.run', return_value=SimpleNamespace(stdout=b'[]')) as run:
            self.assertEqual(recognize_with_timeout(audio), [])
        actual = run.call_args.args[0]
        self.assertEqual(len(actual), 3)
        self.assertEqual(Path(actual[1]).name, 'audit_tip_v11_speech.py')
        self.assertEqual(actual[2], audio)
        self.assertEqual(run.call_args.kwargs, {'capture_output': True, 'check': True,
                                               'timeout': RECOGNITION_TIMEOUT_SECONDS})

    def test_optional_report_measure_uses_the_snapshot_ffmpeg_audio_not_reference_wavs(self):
        aligned = {'segments': self.segments, 'durationInFrames': 2100, 'provenance': ASR_REVISION}
        args = SimpleNamespace(alignment='mock-alignment', narration_wav='ref-voice', mix_wav='ref-mix',
                               video='source.mp4', render_manifest=None, ocr_language='fra', measure_final_french=True)
        waveform = {'passed': True, 'lag_samples': 0}
        speech = {'status': 'inconclusive', 'reason': 'ordered_words_unconfirmed'}
        with patch('audit_tip_v11.limited_read', return_value=b'fake alignment'), \
             patch('audit_tip_v11.verify_alignment', return_value=aligned), \
             patch('audit_tip_v11.read_wave', return_value=('different reference bytes', 'reference sha')), \
             patch('audit_tip_v11.snapshot_video', return_value=('mp4 sha', 20)) as snapshot, \
             patch('audit_tip_v11.media_shape', return_value={'passed': True}), \
             patch('audit_tip_v11.command', return_value=self.decoded) as command, \
             patch('audit_tip_v11.measure_audio', return_value=waveform), \
             patch('audit_tip_v11.measure_text', return_value={'passed': True}), \
             patch('audit_tip_v11.measure_final_french_speech', return_value=speech) as measure:
            report = audit(args)
            self.assertTrue(report['passed'])  # Existing waveform/OCR contract is additive.
            self.assertEqual(report['final_french_speech'], speech)
            measure.assert_called_once()
            self.assertEqual(measure.call_args.args[:3], (self.segments, self.decoded, waveform))
            decoded_input = command.call_args.args[command.call_args.args.index('-i') + 1]
            self.assertEqual(decoded_input, snapshot.call_args.args[1])
            self.assertEqual(Path(decoded_input).name, 'audit.mp4')
            args.measure_final_french = False
            self.assertNotIn('final_french_speech', audit(args))
            measure.assert_called_once()


if __name__ == '__main__':
    unittest.main()
