import io
import json
from pathlib import Path
import struct
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch
import wave

from audit_tip_v11_speech import ASR_REVISION, SAMPLE_RATE, compare_french_segments, french_speech_outcome, sha256
from score_tip_source import score_source
from test_align_tip_v11 import SEGMENTS, phone_gap, speech


def make_wav(data):
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as target:
        target.setparams((1, 2, SAMPLE_RATE, 0, 'NONE', 'not compressed'))
        target.writeframes(data)
    return buffer.getvalue()


class SourceScoringTest(unittest.TestCase):
    data = struct.pack('<h', 800) * (70 * SAMPLE_RATE)
    wav = make_wav(data)
    plan = {'segments': SEGMENTS, 'draft_sha256': 'a' * 64, 'source_script_sha256': 'b' * 64}

    def run_source(self, rows=None, wav=None, recognizer=None, window=None):
        if rows is None:
            rows = [(row['word'], row['start'], row['end'], .95) for row in speech(self.plan['segments'])]
        wav = self.wav if wav is None else wav
        with TemporaryDirectory() as folder:
            directory = Path(folder)

            def recognize(path):
                self.assertEqual(path.read_bytes(), wav)
                return rows

            return score_source(self.plan, wav, directory, recognizer or recognize, window or Mock(return_value=[]))

    def test_scores_exact_source_with_bound_pcm_draft_and_model(self):
        report = self.run_source()
        self.assertEqual(report['status'], 'matched')
        self.assertEqual(report['contract'], 'tip-v11-fr-source-speech-v2')
        self.assertEqual(report['draft_sha256'], self.plan['draft_sha256'])
        self.assertEqual(report['source_script_sha256'], self.plan['source_script_sha256'])
        self.assertEqual(report['narration_wav_sha256'], sha256(self.wav))
        self.assertEqual(report['decoded_pcm_sha256'], sha256(self.data))
        self.assertEqual(report['model_revision'], ASR_REVISION)
        self.assertEqual(len(report['segments']), 10)
        self.assertNotIn('domain', [row['segment'] for row in report['segments']])
        self.assertEqual(report['deferred_checks'], ['domain_audio', 'visible_domain_cta'])
        self.assertEqual(report['excluded_segments'], ['greeting', 'signature'])
        self.assertFalse(report['accent_evaluated'])
        diagnostic, = report['recognizer_diagnostics']
        self.assertEqual(diagnostic['stage'], 'full_audio')
        self.assertEqual(diagnostic['window_duration_ms'], 70_000)
        self.assertEqual(diagnostic['outcome'], 'completed')
        self.assertGreater(diagnostic['recognized_row_count'], 0)

    def test_classifies_full_decode_timeout_without_exposing_exception_or_transcript(self):
        failure = subprocess.TimeoutExpired(['sensitive-command-path'], 150,
                                             output=b'private raw spoken words', stderr=b'private diagnostics')
        with patch('score_tip_source.monotonic', side_effect=[0, 150.005]):
            report = self.run_source(recognizer=Mock(side_effect=failure))
        self.assertEqual(report['status'], 'inconclusive')
        self.assertEqual(report['reason'], 'recognizer_timeout')
        self.assertEqual(report['segments'], [])
        self.assertEqual(report['recognizer_diagnostics'], [{
            'call_index': 1, 'stage': 'full_audio', 'window_duration_ms': 70_000,
            'outcome': 'timeout', 'error_class': 'TimeoutExpired', 'elapsed_ms': 150_005,
        }])
        for secret in ('sensitive-command-path', 'private raw spoken words', 'private diagnostics'):
            self.assertNotIn(secret, json.dumps(report))

    def test_classifies_subprocess_and_json_failures_without_treating_them_as_voice_mismatches(self):
        for failure, reason, error_class in (
            (subprocess.CalledProcessError(2, ['sensitive-command-path'], output=b'private raw words',
                                          stderr=b'private diagnostic'), 'recognizer_process_failed', 'CalledProcessError'),
            (json.JSONDecodeError('private diagnostic', 'private raw words', 0),
             'recognizer_output_invalid', 'JSONDecodeError'),
            (FileNotFoundError('/private/sensitive-model-path'), 'recognizer_unavailable', 'FileNotFoundError'),
        ):
            with self.subTest(reason=reason):
                report = self.run_source(recognizer=Mock(side_effect=failure))
                self.assertEqual(report['status'], 'inconclusive')
                self.assertEqual(report['reason'], reason)
                diagnostic, = report['recognizer_diagnostics']
                self.assertEqual(diagnostic['stage'], 'full_audio')
                self.assertEqual(diagnostic['error_class'], error_class)
                if isinstance(failure, subprocess.CalledProcessError):
                    self.assertEqual(diagnostic['exit_code'], 2)
                self.assertNotIn('private', json.dumps(diagnostic))
                self.assertNotIn('sensitive', json.dumps(diagnostic))

    def test_identifies_a_focused_alignment_failure_separately_from_a_completed_full_decode(self):
        full, _, _, _ = phone_gap()
        rows = [(row['word'], row['start'], row['end'], .95) for row in full]
        report = self.run_source(rows=rows, window=Mock(side_effect=subprocess.TimeoutExpired('private-path', 45)))
        self.assertEqual(report['status'], 'inconclusive')
        self.assertEqual(report['reason'], 'recognizer_timeout')
        first, failed = report['recognizer_diagnostics']
        self.assertEqual((first['stage'], first['outcome']), ('full_audio', 'completed'))
        self.assertEqual((failed['stage'], failed['outcome'], failed['error_class']),
                         ('alignment_phone', 'timeout', 'TimeoutExpired'))
        self.assertLess(failed['window_duration_ms'], 10_000)
        self.assertNotIn('private-path', json.dumps(report))

    def test_rejects_changed_negation_and_number(self):
        rows = [(row['word'], row['start'], row['end'], .95) for row in speech(self.plan['segments'])]
        index = next(index for index, row in enumerate(rows) if row[0] == 'commence')
        changed = rows.copy()
        changed[index] = ('jamais', *rows[index][1:])
        self.assertEqual(self.run_source(changed)['reason'], 'ordered_words_unconfirmed')
        changed = rows.copy()
        index = next(index for index, row in enumerate(rows) if row[0] == 'seize')
        changed[index] = ('quinze', *rows[index][1:])
        self.assertEqual(self.run_source(changed)['reason'], 'phone_evidence_unconfirmed')

    def test_silence_and_short_or_truncated_wav_never_qualify(self):
        silence = make_wav(bytes(len(self.data)))
        self.assertEqual(self.run_source(wav=silence)['reason'], 'no_audible_source')
        for invalid in (make_wav(bytes(48)), self.wav[:-2]):
            with self.subTest(length=len(invalid)), self.assertRaises(ValueError):
                self.run_source(wav=invalid)

    def test_domain_alias_is_deferred_in_source_and_never_reported_as_matched(self):
        segments = [row if row['id'] != 'domain' else {
            **row, 'text': 'Retrouvez-nous sur notre site, jamm immo point com.',
        } for row in SEGMENTS]
        self.plan = {**self.plan, 'segments': segments}
        rows = [(row['word'], row['start'], row['end'], .95) for row in speech(segments)]
        first = next(index for index in range(len(rows) - 3)
                     if [word[0] for word in rows[index:index + 4]] == ['jamm', 'immo', 'point', 'com'])
        rows[first:first + 4] = [
            ('jamimo', rows[first][1], rows[first + 1][2], .95), ('.com', *rows[first + 3][1:]),
        ]
        report = self.run_source(rows)
        self.assertEqual(report['status'], 'matched')
        self.assertEqual(report['deferred_checks'], ['domain_audio', 'visible_domain_cta'])
        self.assertNotIn('domain', [row['segment'] for row in report['segments']])

    def test_uncertain_domain_does_not_turn_into_final_speech_approval(self):
        segments = [row if row['id'] != 'domain' else {
            **row, 'text': 'Retrouvez-nous sur notre site, jamm immo point com.',
        } for row in SEGMENTS]
        self.plan = {**self.plan, 'segments': segments}
        rows = [(row['word'], row['start'], row['end'], .95) for row in speech(segments)]
        first = next(index for index in range(len(rows) - 3)
                     if [word[0] for word in rows[index:index + 4]] == ['jamm', 'immo', 'point', 'com'])
        rows[first:first + 4] = [('autre', rows[first][1], rows[first + 2][2], .95), rows[first + 3]]
        source = self.run_source(rows)
        self.assertEqual(source['status'], 'matched')
        # The same bounded timing permits rendering. It never manufactures
        # the missing spoken brand or authorizes a final MP4 on its own.
        from align_tip_v11 import align
        timed = align(segments, [{'word': word, 'start': start, 'end': end} for word, start, end, _ in rows],
                      70, defer_domain=True)['segments']
        result = french_speech_outcome(timed, compare_french_segments(timed, rows, 0))
        self.assertEqual(result['status'], 'inconclusive')
        self.assertEqual(next(row for row in result['segments'] if row['segment'] == 'domain')['status'],
                         'inconclusive')

    def test_missing_domain_boundary_is_held_even_before_render(self):
        segments = [row if row['id'] != 'domain' else {
            **row, 'text': 'Retrouvez-nous sur notre site, jamm immo point com.',
        } for row in SEGMENTS]
        self.plan = {**self.plan, 'segments': segments}
        rows = [(row['word'], row['start'], row['end'], .95) for row in speech(segments)]
        first = next(index for index in range(len(rows) - 3)
                     if [word[0] for word in rows[index:index + 4]] == ['jamm', 'immo', 'point', 'com'])
        rows[first:first + 4] = [('inaudible', rows[first][1], rows[first + 3][2], .95)]
        self.assertEqual(self.run_source(rows)['reason'], 'website_evidence_unconfirmed')
