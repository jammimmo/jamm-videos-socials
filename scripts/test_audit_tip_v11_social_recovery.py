"""One focused social read: real persisted AAC observations, synthetic PCM unit input."""
import json
from pathlib import Path
import stat
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch
import wave

from audit_tip_v11_speech import (
    LOCAL_SPEECH_WINDOW_TIMEOUT_SECONDS, RECOGNITION_TIMEOUT_SECONDS, SAMPLE_RATE,
    measure_final_french_speech, sha256,
)

FIXTURE = json.loads((Path(__file__).parent / 'fixtures/tip-v11-final-aac-boundaries.json').read_text())
SCENES = [row for row in FIXTURE['segments'] if row['id'] in ('socials', 'signature')]


class SocialSceneRecoveryTest(unittest.TestCase):
    lag = 1024
    # These PCM bytes are a unit fixture, not a new decoded production proof.
    decoded = b'\x00\x01' * (round(66.2 * SAMPLE_RATE) + lag)

    def global_rows(self, rows=None):
        return [(word, start + self.lag / SAMPLE_RATE, end + self.lag / SAMPLE_RATE, probability)
                for word, start, end, probability in (FIXTURE['socials_rows'] if rows is None else rows)]

    def focused_rows(self):
        return [(word, start - 57.18, end - 57.18, probability)
                for word, start, end, probability in FIXTURE['socials_inscene_rows']]

    def measure(self, *, whole=None, focused=None, preservation=True, scenes=SCENES):
        first, last = round(57.18 * SAMPLE_RATE) + self.lag, round(62.4 * SAMPLE_RATE) + self.lag
        with TemporaryDirectory() as directory:
            def inspect(path):
                self.assertEqual(Path(path).parent, Path(directory))
                self.assertEqual(stat.S_IMODE(Path(path).stat().st_mode), 0o600)
                with wave.open(str(path), 'rb') as source:
                    self.assertEqual((source.getnchannels(), source.getsampwidth(), source.getframerate()), (1, 2, SAMPLE_RATE))
                    self.assertEqual(source.readframes(source.getnframes()), self.decoded[first * 2:last * 2])
                return self.focused_rows()
            global_read = Mock(return_value=self.global_rows() if whole is None else whole)
            focused_read = focused or Mock(side_effect=inspect)
            evidence = {'status': 'matched', 'lag_samples': self.lag, 'decoded_pcm_sha256': sha256(self.decoded)}
            result = measure_final_french_speech(
                scenes, self.decoded, {'passed': True, 'lag_samples': self.lag}, directory,
                recognize=global_read, preservation=evidence if preservation is True else preservation,
                recognize_socials=focused_read,
            )
            self.assertFalse((Path(directory) / 'decoded-socials-scene.wav').exists())
        return result, global_read, focused_read

    def test_real_replayed_observations_choose_the_strict_scene_pcm_once_and_preserve_raw_status(self):
        report, whole, focused = self.measure()
        self.assertEqual((whole.call_count, focused.call_count), (1, 1))
        self.assertEqual(report['status'], 'matched')
        [social] = report['segments']
        self.assertEqual(social['observed_token_count'], 13)
        self.assertEqual(social['observed_sha256'], social['expected_sha256'])
        proof = social['measurement']
        self.assertEqual(proof['method'], 'socials_exact_scene_window')
        self.assertEqual(proof['start_sample'], round(57.18 * SAMPLE_RATE) + self.lag)
        self.assertEqual(proof['end_sample'], round(62.4 * SAMPLE_RATE) + self.lag)
        self.assertEqual(proof['decoded_pcm_sha256'], report['decoded_pcm_sha256'])
        self.assertFalse(proof['excluded_context_used_as_french'])
        self.assertEqual(proof['boundary_evidence']['method'], 'fixed_socials_complete_before_excluded_cue')
        self.assertEqual((RECOGNITION_TIMEOUT_SECONDS, LOCAL_SPEECH_WINDOW_TIMEOUT_SECONDS), (150, 45))
        # The recognizer receives exactly one path, no expected text or keyword argument.
        self.assertEqual(len(focused.call_args.args), 1)
        self.assertEqual(focused.call_args.kwargs, {})

    def test_only_boundary_failure_can_spend_the_one_extra_read(self):
        rows = list(FIXTURE['socials_rows'])
        cases = [
            self.global_rows(FIXTURE['socials_inscene_rows']),
            self.global_rows(rows[:6] + rows[7:]),
            self.global_rows([(*rows[0][:3], .599), *rows[1:]]),
            self.global_rows([*rows[:13], ('deux', *rows[13][1:]), *rows[14:]]),
        ]
        for case in cases:
            with self.subTest(case=case):
                never = Mock(side_effect=AssertionError('unexpected extra recognition'))
                self.measure(whole=case, focused=never)
                never.assert_not_called()
        for preservation in (None, {'status': 'matched', 'lag_samples': self.lag, 'decoded_pcm_sha256': '0' * 64}):
            never = Mock(side_effect=AssertionError('unconfirmed PCM must not recover'))
            self.measure(focused=never, preservation=preservation)
            never.assert_not_called()

    def test_failed_or_uncertain_window_never_retries_or_fills_words_from_expected(self):
        rows = self.focused_rows()
        invalid = [rows[:6] + rows[7:], [(*rows[0][:3], .599), *rows[1:]],
                   [(rows[0][0], -.01, rows[0][2], rows[0][3]), *rows[1:]],
                   [('non', *rows[0][1:]), *rows[1:]]]
        for result in invalid:
            with self.subTest(result=result):
                read = Mock(return_value=result)
                report, whole, _ = self.measure(focused=read)
                self.assertEqual(report['status'], 'inconclusive')
                self.assertEqual((whole.call_count, read.call_count), (1, 1))
                self.assertEqual(report['segments'][0]['reason'], 'mixed_language_boundary')
        timeout = Mock(side_effect=subprocess.TimeoutExpired('local_asr', 45))
        report, _, _ = self.measure(focused=timeout)
        self.assertEqual(report['status'], 'inconclusive')
        timeout.assert_called_once()

    def test_even_duplicate_recovery_requests_share_one_invocation_budget(self):
        # Exercise the measure-level budget independently of today's unique-scene validator.
        # An exact expected list is passed to the real helper; its decoder is intentionally unavailable.
        compare_expected = ['suivez', 'aussi', 'jamm', 'immo', 'sur', 'nos', 'reseaux', 'sociaux', 'pour', 'retrouver', 'nos', 'prochains', 'conseils']
        def duplicate(parts, words, lag, verify_phone=None, **callbacks):
            callbacks['verify_socials'](parts, 0, compare_expected)
            callbacks['verify_socials'](parts, 0, compare_expected)
            return [{'segment': 'socials', 'status': 'inconclusive', 'expected_token_count': 13, 'observed_words': []}]
        read = Mock(side_effect=subprocess.TimeoutExpired('local_asr', 45))
        with patch('audit_tip_v11_speech.compare_french_segments', side_effect=duplicate):
            report, _, _ = self.measure(focused=read)
        self.assertEqual(report['status'], 'inconclusive')
        read.assert_called_once()


if __name__ == '__main__':
    unittest.main()
