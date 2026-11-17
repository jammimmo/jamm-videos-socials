"""Strict domain-window transport and reserved-uncertainty shape; synthetic decoder fixtures."""
import json
from pathlib import Path
import stat
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch
import wave

from audit_tip_v11_speech import (
    FIXED_DOMAIN_WORDS, LOCAL_SPEECH_WINDOW_TIMEOUT_SECONDS, SAMPLE_RATE,
    fixed_company_domain_notation, measure_final_french_speech, sha256,
    uncertain_fixed_domain_scene_measurement, verify_domain_scene_samples,
)

FIXTURE = json.loads((Path(__file__).parent / 'fixtures/tip-v11-final-aac-boundaries.json').read_text())


class StrictDomainRecoveryTest(unittest.TestCase):
    lag = 1024
    scene = {'id': 'domain', 'text': 'Retrouvez-nous sur notre site, jamm immo point com.', 'start': 0., 'end': 4.}
    decoded = b'\x00\x01' * (round(4.2 * SAMPLE_RATE) + lag)

    def rows(self, brand='jamimo', probability=.419, tld='.com.'):
        words = [*FIXED_DOMAIN_WORDS[:5], brand, tld]
        return [(word, .1 + index * .4, .4 + index * .4, probability if index == 5 else .99)
                for index, word in enumerate(words)]

    def measure(self, *, focused=None, whole=None, preservation=True):
        with TemporaryDirectory() as directory:
            def inspect(path):
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                with wave.open(str(path), 'rb') as source:
                    self.assertEqual((source.getnchannels(), source.getsampwidth(), source.getframerate()), (1, 2, SAMPLE_RATE))
                    self.assertEqual(source.readframes(source.getnframes()),
                                     self.decoded[2 * self.lag:2 * (round(4. * SAMPLE_RATE) + self.lag)])
                return self.rows()
            global_read = Mock(return_value=[(word, start + self.lag / SAMPLE_RATE, end + self.lag / SAMPLE_RATE, p)
                                           for word, start, end, p in (self.rows('diamimo') if whole is None else whole)])
            focused_read = focused or Mock(side_effect=inspect)
            evidence = {'status': 'matched', 'lag_samples': self.lag, 'decoded_pcm_sha256': sha256(self.decoded)}
            result = measure_final_french_speech(
                [self.scene], self.decoded, {'passed': True, 'lag_samples': self.lag}, directory,
                recognize=global_read, preservation=evidence if preservation is True else preservation,
                recognize_domain=focused_read,
            )
            self.assertFalse((Path(directory) / 'decoded-domain-scene.wav').exists())
        return result, global_read, focused_read

    def test_one_strict_read_reports_two_uncertain_units_and_never_marks_the_raw_speech_matched(self):
        report, global_read, focused = self.measure()
        self.assertEqual((global_read.call_count, focused.call_count), (1, 1))
        self.assertEqual(report['status'], 'inconclusive')
        [domain] = report['segments']
        self.assertEqual(domain['status'], 'inconclusive')
        self.assertEqual(domain['observed_words'], [*FIXED_DOMAIN_WORDS[:5], None, None, 'point', 'com'])
        self.assertNotIn('observed_sha256', domain)
        proof = domain['measurement']
        self.assertEqual(proof['method'], 'fixed_company_domain_asr_uncertain_v1')
        self.assertEqual((proof['start_sample'], proof['end_sample']), (self.lag, round(4 * SAMPLE_RATE) + self.lag))
        self.assertEqual((proof['scene_start_sample'], proof['scene_end_sample']), (proof['start_sample'], proof['end_sample']))
        self.assertLessEqual(proof['start_sample'], proof['url_start_sample'])
        self.assertLess(proof['url_start_sample'], proof['url_end_sample'])
        self.assertLessEqual(proof['url_end_sample'], proof['end_sample'])
        self.assertEqual(proof['brand_observed'], 'jamimo')
        self.assertEqual(proof['brand_probability_ppm'], 419000)
        self.assertEqual((proof['tld_observed'], proof['tld_probability_ppm']), ('.com', 990000))
        self.assertEqual(proof['raw_observed_words'], [*FIXED_DOMAIN_WORDS[:5], 'jamimo', 'com'])
        self.assertEqual(proof['raw_observed_sha256'], sha256(' '.join(proof['raw_observed_words']).encode()))
        self.assertEqual(proof['decoded_pcm_sha256'], report['decoded_pcm_sha256'])
        self.assertEqual(LOCAL_SPEECH_WINDOW_TIMEOUT_SECONDS, 45)
        self.assertEqual(len(focused.call_args.args), 1)
        self.assertEqual(focused.call_args.kwargs, {})

    def test_unknown_brand_tld_or_fragmented_host_never_receives_reservation_evidence(self):
        variants = [self.rows('jamimu', .554), self.rows('diamimo', .99), self.rows('jamimo', .419, '.fr'),
                    self.rows('jamimo@', .419, 'com'), self.rows('jamm@ immo', .419, 'com')]
        for rows in variants:
            with self.subTest(rows=rows):
                report, _, read = self.measure(focused=Mock(return_value=rows))
                read.assert_called_once()
                [row] = report['segments']
                self.assertEqual(row['status'], 'inconclusive')
                self.assertNotEqual(row['measurement']['method'], 'fixed_company_domain_asr_uncertain_v1')
        low_tld = self.rows()
        low_tld[-1] = (*low_tld[-1][:3], .5999999)
        report, _, _ = self.measure(focused=Mock(return_value=low_tld))
        self.assertNotEqual(report['segments'][0]['measurement']['method'], 'fixed_company_domain_asr_uncertain_v1')

    def test_persisted_four_second_context_cannot_be_relabelled_as_an_in_scene_measurement(self):
        scene = next(row for row in FIXTURE['segments'] if row['id'] == 'domain')
        raw = FIXTURE['domain_rows']
        notation = fixed_company_domain_notation(list(FIXED_DOMAIN_WORDS), raw)
        pcm = b'\x00\x01' * (round(66.2 * SAMPLE_RATE) + self.lag)
        first, last = round(44.9 * SAMPLE_RATE) + self.lag, round(48.9 * SAMPLE_RATE) + self.lag
        self.assertIsNone(uncertain_fixed_domain_scene_measurement(pcm, self.lag, scene, first, last, raw, notation))

    def test_complete_global_domain_spends_nothing_and_timeout_does_not_retry(self):
        strong = self.rows('jamimo', .99)
        never = Mock(side_effect=AssertionError('complete global speech needs no extra read'))
        report, _, _ = self.measure(whole=strong, focused=never)
        self.assertEqual(report['status'], 'matched')
        never.assert_not_called()
        for evidence in (None, {'status': 'matched', 'lag_samples': self.lag, 'decoded_pcm_sha256': '0' * 64}):
            never = Mock(side_effect=AssertionError('unconfirmed PCM must remain held'))
            self.measure(focused=never, preservation=evidence)
            never.assert_not_called()
        timeout = Mock(side_effect=subprocess.TimeoutExpired('local_asr', 45))
        report, _, _ = self.measure(focused=timeout)
        self.assertEqual(report['status'], 'inconclusive')
        timeout.assert_called_once()

    def test_audio_budget_and_actual_url_bounds_are_not_extended_or_clipped(self):
        never = Mock(side_effect=AssertionError('oversized scene must not consume recognition'))
        with TemporaryDirectory() as directory:
            large = {**self.scene, 'end': 8.01}
            decoded = b'\x00\x01' * (round(9 * SAMPLE_RATE) + self.lag)
            self.assertIsNone(verify_domain_scene_samples(decoded, self.lag, directory, large,
                                                         list(FIXED_DOMAIN_WORDS), never))
        never.assert_not_called()
        outside = self.rows()
        outside[-1] = (outside[-1][0], outside[-1][1], 4.05, outside[-1][3])
        report, _, _ = self.measure(focused=Mock(return_value=outside))
        row = report['segments'][0]
        self.assertEqual(row['status'], 'inconclusive')
        self.assertNotEqual(row['measurement']['method'], 'fixed_company_domain_asr_uncertain_v1')
        overlapping = self.rows()
        overlapping[-1] = (overlapping[-1][0], overlapping[-2][2] - .05, overlapping[-1][2], overlapping[-1][3])
        report, _, _ = self.measure(focused=Mock(return_value=overlapping))
        self.assertNotEqual(report['segments'][0]['measurement']['method'], 'fixed_company_domain_asr_uncertain_v1')

    def test_duplicate_requests_share_one_domain_budget(self):
        expected = list(FIXED_DOMAIN_WORDS)
        def duplicate(parts, words, lag, verify_phone=None, **callbacks):
            callbacks['verify_domain'](parts[0], expected)
            callbacks['verify_domain'](parts[0], expected)
            return [{'segment': 'domain', 'status': 'inconclusive', 'expected_token_count': 9, 'observed_words': []}]
        read = Mock(side_effect=subprocess.TimeoutExpired('local_asr', 45))
        with patch('audit_tip_v11_speech.compare_french_segments', side_effect=duplicate):
            report, _, _ = self.measure(focused=read)
        self.assertEqual(report['status'], 'inconclusive')
        read.assert_called_once()


if __name__ == '__main__':
    unittest.main()
