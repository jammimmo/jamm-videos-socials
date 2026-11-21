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
    SpeechComparisonError, compare_french_segments, french_speech_outcome, measure_final_french_speech, sha256,
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


class UntimedSocialsTest(unittest.TestCase):
    """Synthetic observations, with one real point and twelve distinct voiced intervals."""
    lag = 1024
    decoded = b'\x00\x04' * (8 * SAMPLE_RATE)
    scenes = [
        {'id': 'phone', 'text': 'Plus', 'start': 0, 'end': 2},
        {'id': 'socials', 'text': 'Suivez aussi Jamm Immo sur nos réseaux sociaux pour retrouver nos prochains conseils.',
         'start': 2, 'end': 5.5},
        {'id': 'signature', 'text': 'À bientôt', 'start': 5.5, 'end': 7.5},
    ]

    def setUp(self):
        words = self.scenes[1]['text'].split()
        cursor = .25
        self.crop = []
        for i, word in enumerate(words):
            end = cursor if i == 1 else cursor + .25
            spelling = {2: 'Jam', 3: 'Imo'}.get(i, word)
            self.crop.append([' ' + spelling, cursor, end, .97])
            cursor = end
        self.crop.append([' À', 3.7, 4., .4])  # Excluded signature context.
        offset = 2 + self.lag / SAMPLE_RATE
        self.full = [[' Plus', .5, 1., .98],
                     *[[word, start + offset, end + offset, prob] for word, start, end, prob in self.crop]]
        self.full[3][0] = ' Djam'

    def measure(self, full=None, crop=None, pcm=None, preserved=True, scenes=None, change_wav=None):
        pcm = self.decoded if pcm is None else pcm
        full = self.full if full is None else full
        focused = Mock(return_value=self.crop if crop is None else crop)
        def global_read(path):
            if change_wav:
                change_wav(path)
            return full
        if preserved is True:
            preserved = {'status': 'matched', 'decoded_pcm_sha256': sha256(pcm), 'lag_samples': self.lag}
        with TemporaryDirectory() as directory:
            result = measure_final_french_speech(
                self.scenes if scenes is None else scenes, pcm, {'passed': True, 'lag_samples': self.lag}, directory,
                recognize=global_read, recognize_socials=focused, preservation=preserved,
                recognize_phone=Mock(return_value=[]), recognize_domain=Mock(return_value=[]),
            )
        return result, focused.call_count

    def test_charges_the_point_once_and_binds_both_original_observations_and_pcm(self):
        from audit_tip_v11_speech import FIXED_SOCIALS_WORDS, speech_edits, timed_rows_digest
        full_snapshot, crop_snapshot = json.dumps(self.full), json.dumps(self.crop)
        result, calls = self.measure()
        self.assertEqual((result['status'], calls), ('matched', 1))
        row = result['segments'][1]
        words = list(FIXED_SOCIALS_WORDS)
        words[1] = None
        self.assertEqual(row['observed_words'], words)
        self.assertEqual(speech_edits(FIXED_SOCIALS_WORDS, words), 1)
        self.assertNotIn('observed_sha256', row)
        proof = row['measurement']
        self.assertEqual((proof['untimed_token_index'], proof['full_row_index'], proof['focused_row_index']), (1, 2, 1))
        self.assertEqual(proof['point_sample'], round(2.5 * SAMPLE_RATE) + self.lag)
        self.assertEqual(proof['full_timed_rows_sha256'], timed_rows_digest(self.full))
        self.assertEqual(proof['focused_timed_rows_sha256'], timed_rows_digest(self.crop))
        self.assertEqual((proof['scene_start_sample'], proof['scene_end_sample'], proof['end_sample']),
                         (2 * SAMPLE_RATE + self.lag, round(5.5 * SAMPLE_RATE) + self.lag, round(6.5 * SAMPLE_RATE) + self.lag))
        clip = self.decoded[proof['start_sample'] * 2:proof['end_sample'] * 2]
        self.assertEqual((proof['decoded_pcm_sha256'], proof['window_pcm_sha256']), (sha256(self.decoded), sha256(clip)))
        self.assertEqual(proof['audible_timed_french_rows'], 12)
        self.assertEqual((full_snapshot, crop_snapshot), (json.dumps(self.full), json.dumps(self.crop)))
        changed_confidence = [*self.crop[:-1], [*self.crop[-1][:3], .41]]
        self.assertNotEqual(proof['focused_timed_rows_sha256'], timed_rows_digest(changed_confidence))

    def test_wrong_missing_uncertain_multiple_and_overlapping_observations_are_held(self):
        from copy import deepcopy
        def mutations(rows, index):
            cases = {}
            for name, word_index, column, replacement in (
                ('wrong point', index, 0, ' ici'), ('protected point', index, 0, ' non'),
                ('uncertain point', index, 3, .59), ('uncertain neighbor', index - 1, 3, .59),
                ('uncertain brand', index + 1, 3, .59), ('uncertain ordinary word', index + 4, 3, .59),
                ('contradictory brand', index + 1, 0, ' autre'), ('wrong ordinary word', index + 5, 0, ' autres'),
                ('second point', index + 4, 2, rows[index + 4][1]), ('reversed', index + 3, 2, rows[index + 3][1] - .01),
                ('overlap', index + 1, 1, rows[index][1] - .01), ('detached point', index - 1, 2, rows[index][1] - .01),
                ('nonfinite probability', index + 3, 3, float('nan')), ('untimed brand', index + 1, 2, rows[index + 1][1]),
            ):
                changed = deepcopy(rows)
                changed[word_index][column] = replacement
                cases[name] = changed
            cases['missing point row'] = rows[:index] + rows[index + 1:]
            cases['missing first row'] = rows[:index-1] + rows[index:]
            return cases

        for stream, original, point_index in (('full', self.full, 2), ('crop', self.crop, 1)):
            for name, altered in mutations(original, point_index).items():
                with self.subTest(stream=stream, name=name):
                    result, calls = self.measure(**{stream: altered})
                    two_edits = stream == 'full' and name in ('uncertain ordinary word', 'second point')
                    if stream == 'crop' or name == 'detached point' or two_edits:
                        self.assertEqual(result['status'], 'matched')
                        row = result['segments'][1]
                        self.assertEqual(row['measurement']['method'], 'ordinary_untimed_words_scored_as_edits_v1')
                        self.assertEqual(row['observed_words'].count(None), 2 if two_edits else 1)
                        self.assertEqual(row['measurement']['point_words_credited'], 0)
                    else:
                        self.assertEqual(result['status'], 'inconclusive')
                    self.assertEqual(calls, int(stream == 'crop'))
        shifted = deepcopy(self.crop)
        for row_index, field in ((0, 2), (1, 1), (1, 2), (2, 1)):
            shifted[row_index][field] += 1 / SAMPLE_RATE
        report, calls = self.measure(crop=shifted)
        self.assertEqual((report['segments'][1]['measurement']['method'], calls), ('ordinary_untimed_words_scored_as_edits_v1', 1))
        # A row ending at the signature cut may not cross into its context.
        for stream, rows, last, cut in [('full', self.full, -2, 5.5 + self.lag / SAMPLE_RATE),
                                        ('crop', self.crop, -2, 3.5)]:
            altered = deepcopy(rows)
            altered[last][2] = cut + .01
            with self.subTest(stream=stream, case='cut crossing'):
                report, _ = self.measure(**{stream: altered})
                if stream == 'full':
                    self.assertEqual(report['status'], 'inconclusive')
                else:
                    self.assertEqual(report['segments'][1]['measurement']['method'], 'ordinary_untimed_words_scored_as_edits_v1')

    def test_only_the_fixed_scene_with_its_preserved_audible_pcm_can_use_a_point(self):
        from audit_tip_v11_speech import compare_french_segments
        with self.assertRaises(ValueError):
            compare_french_segments(self.scenes, self.full, self.lag)
        for scene in ('phone', 'domain', 'hook'):
            changed = [*self.scenes[:1], {**self.scenes[1], 'id': scene}, self.scenes[-1]]
            with self.subTest(scene=scene):
                self.assertEqual(self.measure(scenes=changed)[1], 0)
        for change in ({'text': 'Suivez aussi une autre agence'}, {'start': 2.01}, {'end': 5.49}):
            altered = [self.scenes[0], {**self.scenes[1], **change}, self.scenes[-1]]
            self.assertEqual(self.measure(scenes=altered)[1], 0)
        for evidence in (None, {'status': 'matched', 'lag_samples': self.lag, 'decoded_pcm_sha256': '0' * 64},
                         {'status': 'matched', 'lag_samples': 0, 'decoded_pcm_sha256': sha256(self.decoded)}):
            self.assertEqual(self.measure(preserved=evidence)[1], 0)
        for change_wav in (lambda path: path.unlink(), lambda path: path.write_bytes(b'invalid WAV')):
            report, calls = self.measure(change_wav=change_wav)
            self.assertEqual((report['status'], calls), ('inconclusive', 0))
        for start, end in ((2.5, 3.), (2., 5.5)):
            first, last = [round(t * SAMPLE_RATE) + self.lag for t in (start, end)]
            muted = self.decoded[:first * 2] + bytes((last - first) * 2) + self.decoded[last * 2:]
            self.assertEqual(self.measure(pcm=muted)[1], 0)

    def test_exact_held_point_keeps_other_scene_scores_without_admission(self):
        from audit_tip_v11_speech import FIXED_SOCIALS_WORDS, ORDINARY_POINT_METHOD
        samples = [
            (1328160, 1362240, .991), (1362240, 1362240, .993),
            (1362240, 1370880, .485), (1370880, 1377600, .746),
            (1377600, 1381920, .976), (1381920, 1385760, .992),
            (1385760, 1392480, .999), (1392480, 1398720, .985),
            (1398720, 1406880, .963), (1406880, 1416000, .994),
            (1416000, 1420320, .988), (1420320, 1431840, .998),
            (1431840, 1441440, .998),
        ]
        words = list(FIXED_SOCIALS_WORDS)
        words[2:4] = ['Djam', 'Imo']
        rows = [('Conseil', 54.1, 54.4, .99), ('utile', 54.4, 54.8, .99), *[
            (word, start / SAMPLE_RATE, end / SAMPLE_RATE, probability)
            for word, (start, end, probability) in zip(words, samples)
        ]]
        segments = [
            {'id': 'step1', 'text': 'Conseil utile', 'start': 54, 'end': 55.3},
            {'id': 'socials', 'text': ' '.join(FIXED_SOCIALS_WORDS), 'start': 55.3, 'end': 60.1},
        ]
        pcm = b'\x00\x04' * 1_445_000
        results = compare_french_segments(segments, rows, 0, ordinary_point_pcm=pcm)
        self.assertEqual([item['status'] for item in results], ['matched', 'inconclusive'])
        held = results[1]
        proof = held['measurement']
        self.assertEqual((proof['method'], proof['point_samples'], proof['point_words_credited']),
                         (ORDINARY_POINT_METHOD, [1362240], 0))
        self.assertEqual((proof['diagnostic_only'], proof['admission_eligible'], proof['protected_names_credited']),
                         (True, False, 0))
        self.assertEqual(held['observed_words'], [None] * len(FIXED_SOCIALS_WORDS))
        outcome = french_speech_outcome(segments, results)
        self.assertEqual((outcome['status'], outcome['reason']), ('inconclusive', 'ordered_words_unconfirmed'))
        self.assertEqual(outcome['segments'][0]['status'], 'matched')

        for label, row, column, value in (
            ('wrong point', 3, 0, 'ici'), ('weak point', 3, 3, .599),
            ('detached right neighbor', 4, 1, (1362241 / SAMPLE_RATE)),
        ):
            changed = [list(item) for item in rows]
            changed[row][column] = value
            with self.subTest(case=label), self.assertRaises(SpeechComparisonError) as error:
                compare_french_segments(segments, changed, 0, ordinary_point_pcm=pcm)
            self.assertEqual(error.exception.detail['predicate'], 'timestamp_zero_duration')


if __name__ == '__main__':
    unittest.main()
