import io
from importlib.util import find_spec
import json
import math
from pathlib import Path
import struct
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch
import wave

from audit_tip_v11_speech import ASR_REVISION, SAMPLE_RATE, compare_french_segments, french_speech_outcome, sha256
from score_tip_source import score_source
from tip_source_asr_session import SourceAsrSession, serve
from test_align_tip_v11 import SEGMENTS, phone_gap, speech, tokens


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

    def test_source_replays_three_ordinary_edits_in_a_twelve_word_scene(self):
        changes = {'logement': 'bien', 'observations': 'remarques', 'utiles': 'pratiques'}
        rows = [(changes.get(row['word'], row['word']) if 4 <= i < 16 else row['word'],
                 row['start'], row['end'], .95) for i, row in enumerate(speech(SEGMENTS))]
        report = self.run_source(rows)
        self.assertEqual(report['status'], 'matched')
        self.assertEqual(report['warnings'], ['french_transcript_variation'])
        self.assertEqual(report['segments'][0]['observed_words'][3:9], ['bien', 'commence', 'par', 'des', 'remarques', 'pratiques'])
        word, start, end, confidence = rows[13]
        self.assertEqual(word, 'pendant')
        rows[13] = ('durant', start, end, confidence)
        self.assertEqual(self.run_source(rows)['status'], 'inconclusive')

    def test_positional_opening_preserves_the_french_score_and_exact_input_pcm(self):
        rows = [(r['word'], r['start'], r['end'], .95) for r in speech(SEGMENTS)[4:]]
        end_sample = int(rows[0][1] * SAMPLE_RATE)
        with patch('align_tip_v11.greeting_speech_samples', return_value=16384) as detector:
            report = self.run_source(rows)
            detector.assert_called_once_with(self.data[:end_sample * 2])
        self.assertEqual(report['status'], 'matched')
        self.assertEqual(len(report['segments']), 10)
        self.assertEqual(report['excluded_segments'], ['greeting', 'signature'])
        self.assertEqual(report['greeting_position']['prefix_pcm_sha256'], sha256(self.data[:end_sample * 2]))
        self.assertIs(report['greeting_position']['words_evaluated'], False)
        self.assertEqual([r['stage'] for r in report['recognizer_diagnostics']], ['full_audio'])
        wrong = [(('jamais' if word == 'observations' else word), start, end, p) for word, start, end, p in rows]
        with patch('align_tip_v11.greeting_speech_samples', return_value=16384):
            self.assertEqual(self.run_source(wrong)['status'], 'inconclusive')

    @unittest.skipUnless(find_spec('faster_whisper') and find_spec('onnxruntime'), 'requires packaged Silero runtime')
    def test_packaged_vad_rejects_silence_noise_click_and_sustained_tone(self):
        import numpy as np
        from align_tip_v11 import GREETING_VAD_MIN_SAMPLES, greeting_speech_samples
        count = 2 * SAMPLE_RATE
        click = np.zeros(count, dtype='<i2')
        click[SAMPLE_RATE] = 32767
        signals = {'silence': bytes(2 * count), 'click': click.tobytes(),
                   'noise': np.random.default_rng(4).integers(-2500, 2500, count, dtype=np.int16).tobytes(),
                   'tone': (5000 * np.sin(np.arange(count) * 2 * math.pi * 440 / SAMPLE_RATE)).astype('<i2').tobytes()}
        for name, signal in signals.items():
            with self.subTest(name=name):
                self.assertLess(greeting_speech_samples(signal), GREETING_VAD_MIN_SAMPLES)

    def test_inspection_never_changes_receipt_outcome_and_capped_rows_keep_their_commitment(self):
        ordinary = self.run_source()
        self.assertNotIn('inspection_evidence', ordinary)
        rows = [(w['word'], w['start'], w['end'], .95) for w in speech(self.plan['segments'])]
        def run(nonce):
            with TemporaryDirectory() as folder:
                return score_source(self.plan, self.wav, Path(folder), lambda _: rows, lambda _: [],
                                    inspection_nonce=nonce, inspection_attempt=1)
        full = run('a' * 32)
        self.assertEqual(full['segments'], ordinary['segments'])
        original = full['inspection_evidence']
        with patch('tip_source_inspection.MAX_TRACE_BYTES', 99):
            limited = run('b' * 32)['inspection_evidence']
        self.assertTrue(limited['truncated'])
        self.assertEqual(original['scenes'], limited['scenes'])
        a, b = original['calls'][0], limited['calls'][0]
        self.assertEqual(a['streamDigest'], b['streamDigest'])
        self.assertNotEqual(a['rows'][0][4], b['rows'][0][4])
        self.assertEqual(b['omittedRows'], b['rowCount'] - len(b['rows']))
        self.assertGreater(b['omittedRows'], 0)
        self.assertEqual(b['pcmSha256'], original['pcmSha256'])

    def test_greeting_recovery_uses_only_prefix_pcm_and_preserves_source_scoring(self):
        from math import floor
        complete = [(w['word'], w['start'], w['end'], .95) for w in speech(SEGMENTS)]
        prefix, full = complete[:4], complete[4:]
        frames = floor(full[0][1] * SAMPLE_RATE)
        def focused(path):
            self.assertEqual(path.read_bytes(), make_wav(self.data[:frames * 2]))
            return prefix
        with TemporaryDirectory() as folder:
            report = score_source(self.plan, self.wav, Path(folder), lambda _: full, focused,
                                  inspection_nonce='1' * 32)
        self.assertEqual(report['segments'], self.run_source()['segments'])
        self.assertEqual(report['status'], 'matched')
        calls = report['inspection_evidence']['calls']
        self.assertEqual([c['stage'] for c in calls], ['full_audio', 'alignment_greeting'])
        self.assertEqual((calls[1]['startSample'], calls[1]['endSample'], calls[1]['pcmSha256']),
                         (0, frames, sha256(self.data[:frames * 2])))
        rejected = self.run_source(rows=full, window=lambda _: prefix[:1])
        self.assertEqual((rejected['reason'], rejected['alignment_code'], rejected['matched_words']),
                         ('alignment_evidence_invalid', 'segment_coverage_low', 0))

    def test_scores_a_single_corresponding_fixed_socials_point_as_an_edit_only(self):
        from align_tip_v11 import align, audible_windows
        from audit_tip_v11_speech import FIXED_SOCIALS_WORDS
        self.plan = {**self.plan, 'segments': [
            {**s, 'text': ' '.join(FIXED_SOCIALS_WORDS)} if s['id'] == 'socials' else s for s in SEGMENTS
        ]}
        rows = [[w['word'], w['start'], w['end'], .95] for w in speech(self.plan['segments'])]
        start = next(i for i, row in enumerate(rows) if row[0] == 'suivez')
        point = rows[start + 2][1]
        rows[start][2] = rows[start + 1][1] = rows[start + 1][2] = point
        rows[start + 2][0], rows[start + 3][0] = 'Djam', 'Imo'
        alignment = align(self.plan['segments'], [{'word': w, 'start': a, 'end': b} for w, a, b, _ in rows],
                          70, list(audible_windows(self.data, SAMPLE_RATE)), defer_domain=True)
        social = alignment['segments'][-2]
        first = round(social['start'] * SAMPLE_RATE)
        focused = [[w, a - first / SAMPLE_RATE, b - first / SAMPLE_RATE, p]
                   for w, a, b, p in rows[start:start + len(FIXED_SOCIALS_WORDS)]]
        focused[2][0] = 'Jam'
        read = Mock(return_value=focused)
        report = self.run_source(rows=rows, window=read)
        self.assertEqual(report['status'], 'matched')
        self.assertEqual([c['stage'] for c in report['recognizer_diagnostics']], ['full_audio', 'audit_socials'])
        read.assert_called_once()
        item = report['segments'][-1]
        self.assertEqual(item['observed_words'], [FIXED_SOCIALS_WORDS[0], None, *FIXED_SOCIALS_WORDS[2:]])
        self.assertEqual(item['measurement']['edit_count'], 1)
        self.assertEqual(item['measurement']['full_wav_sha256'], report['narration_wav_sha256'])
        self.assertNotIn('observed_sha256', item)
        # The special CTA evidence leaves the prior nine gates intact.
        changed = [(['non', *r[1:]] if r[0] == 'commence' else r) for r in rows]
        held = self.run_source(rows=changed, window=Mock(return_value=focused))
        self.assertEqual(held['status'], 'inconclusive')
        self.assertEqual([r['segment'] for r in held['segments'] if r['status'] != 'matched'], ['hook'])

    def test_held_socials_point_preserves_other_scores_without_source_admission(self):
        from audit_tip_v11_speech import FIXED_SOCIALS_WORDS, ORDINARY_POINT_METHOD
        self.plan = {**self.plan, 'segments': [
            {**segment, 'text': ' '.join(FIXED_SOCIALS_WORDS)} if segment['id'] == 'socials' else segment
            for segment in SEGMENTS
        ]}
        rows = [[word['word'], word['start'], word['end'], .95] for word in speech(self.plan['segments'])]
        first = next(index for index, row in enumerate(rows) if row[0] == 'suivez')
        point = rows[first + 2][1]
        rows[first][2] = point
        rows[first + 1][1] = rows[first + 1][2] = point
        rows[first + 2] = ['Djam', rows[first + 2][1], rows[first + 2][2], .485]
        rows[first + 3] = ['Imo', rows[first + 3][1], rows[first + 3][2], .746]
        report = self.run_source(rows=rows, window=Mock(return_value=[]))
        self.assertEqual((report['status'], report['reason']), ('inconclusive', 'ordered_words_unconfirmed'))
        self.assertEqual(len(report['segments']), 10)
        held, = [item for item in report['segments'] if item['status'] != 'matched']
        self.assertEqual(held['segment'], 'socials')
        proof = held['measurement']
        self.assertEqual((proof['method'], proof['diagnostic_only'], proof['admission_eligible']),
                         (ORDINARY_POINT_METHOD, True, False))
        self.assertEqual((proof['point_words_credited'], proof['protected_names_credited']), (0, 0))
        self.assertEqual(held['observed_words'], [None] * len(FIXED_SOCIALS_WORDS))

    def test_pre_alignment_diagnostics_at_65183_ms(self):
        duration = 65.183
        samples = struct.pack('<h', 800) * round(duration * SAMPLE_RATE)
        rows = [(row['word'], round(row['start'] * duration / 70, 2), round(row['end'] * duration / 70, 2), .95)
                for row in speech(SEGMENTS)]
        self.assertEqual(self.run_source(rows, make_wav(samples))['status'], 'matched')
        greeting_count = len(tokens(SEGMENTS[0]['text']))
        fixtures = [
            ([], samples, 'no_word_timestamps', {'row_count': 0}),
            ([('SECRET',)], samples, 'word_row_invalid', {'row_count': 1, 'row_index': 0}),
            ([('SECRET', 0, float('nan'), .95)], samples, 'timestamp_nonfinite', {'row_index': 0}),
            ([rows[0], ('SECRET', 0, 1, .95)], samples, 'timestamp_regression', {'row_index': 1}),
            ([('SECRET', .5, .3, .95)], samples, 'timestamp_reversed', {'span_ms': 200}),
            ([*rows[:-1], ('SECRET', rows[-1][1], duration + .12, .95)], samples,
             'timestamp_overrun', {'row_index': len(rows) - 1, 'span_ms': 120}),
            ([('?', 0, .25, .95)], samples, 'no_recognized_tokens', {'row_count': 1}),
            (rows, bytes(3 * 2 * SAMPLE_RATE) + samples[3 * 2 * SAMPLE_RATE:], 'leading_silence', {'span_ms': 3000}),
            (rows, samples[:60 * 2 * SAMPLE_RATE] + bytes(len(samples) - 60 * 2 * SAMPLE_RATE),
             'trailing_silence', {'span_ms': 5183}),
            (rows, samples[:20 * SAMPLE_RATE] + bytes(8 * SAMPLE_RATE) + samples[28 * SAMPLE_RATE:],
             'interior_pause', {'span_ms': 4000}),
            ([('SECRET' if i < greeting_count else word, start, end, p)
              for i, (word, start, end, p) in enumerate(rows)], samples, 'segment_coverage_low',
             {'segment_index': 0, 'matched_words': 0, 'expected_words': greeting_count}),
        ]
        for observed, audio, code, metrics in fixtures:
            with self.subTest(code=code):
                report = self.run_source(observed, make_wav(audio))
                self.assertEqual(report['status'], 'inconclusive')
                expected_reason = 'recognizer_output_invalid' if code == 'word_row_invalid' else 'alignment_evidence_invalid'
                self.assertEqual(report['reason'], expected_reason)
                self.assertEqual(report['alignment_code'], code)
                self.assertEqual(report['segments'], [])
                self.assertEqual({key: report[key] for key in metrics}, metrics)
                self.assertNotIn('SECRET', json.dumps(report))

    def test_private_post_alignment_failure_retains_only_its_finite_predicate_and_indices(self):
        from audit_tip_v11_speech import SpeechComparisonError, words_by_segment
        scene = [{'id': 'hook', 'start': 1, 'end': 2, 'text': 'secret'}]
        for candidate, predicate in (
            (('private',), 'row_shape_invalid'), (('', 1, 1.1, .9), 'row_text_invalid'),
            (('private', 1, float('inf'), .9), 'timestamp_nonfinite'),
            (('private', 1, 1.1, -.01), 'confidence_invalid'),
            (('private', -.1, .2, .9), 'timestamp_regression'),
            (('private', 1.2, 1.1, .9), 'timestamp_reversed'),
            (('private', 1.2, 1.2, .9), 'timestamp_zero_duration'),
            (('private', 1.1, 2.4, .9), 'timestamp_overrun'),
            (('private', .1, .2, .9), 'midpoint_outside_scene'),
        ):
            with self.subTest(predicate=predicate), self.assertRaises(SpeechComparisonError) as error:
                words_by_segment(scene, [candidate], 0)
            self.assertEqual(error.exception.detail['predicate'], predicate)
            self.assertEqual(error.exception.detail['row_index'], 0)
            self.assertEqual(error.exception.detail['row_count'], 1)
            self.assertNotIn('private', str(error.exception.detail))
        rows = [(w['word'], w['start'], w['end'], .95) for w in speech(self.plan['segments'])]
        index = next(i for i, w in enumerate(rows) if w[0] == 'commence')
        rows[index] = ('non', rows[index][1], rows[index][1], .99)
        source = self.run_source(rows=rows)
        self.assertEqual(source['reason'], 'recognition_or_timing_inconclusive')
        self.assertEqual(source['segments'], [])
        self.assertEqual(source['comparison_failure'], {'phase': 'word_assignment', 'predicate': 'timestamp_zero_duration',
                                                       'row_index': index, 'row_count': len(rows), 'segment_index': 1})

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

    def test_marks_only_an_undecided_phone_gap_for_a_new_measurement(self):
        full, phone, index, _ = phone_gap()
        before, after = full[:index], full[index:]
        uncertain = {**phone[0], 'word': 'murmure'}
        number = {**phone[0], 'word': 'sept'}
        untimed_number = {**number, 'end': number['start']}
        for words, eligible in (
            ([*before, uncertain, *after], True),
            ([*before, number, *after], False),
            ([*before, untimed_number, *after], False),
            ([*before, {**number, 'word': '78'}, *after], False),
            ([*before, phone[0], *after], False),
        ):
            with self.subTest(eligible=eligible, inserted=words[index]['word']):
                window = Mock()
                rows = [(row['word'], row['start'], row['end'], .95) for row in words]
                report = self.run_source(rows=rows, window=window)
                self.assertEqual(report['alignment_code'], 'phone_gap_unconfirmed')
                self.assertIs(report.get('phone_remeasurement_eligible', False), eligible)
                window.assert_not_called()

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

    def test_default_source_reuses_one_model_and_closes_on_success_and_timeout(self):
        rows = [(row['word'], row['start'], row['end'], .95) for row in speech(self.plan['segments'])]
        with TemporaryDirectory() as folder, patch('score_tip_source.SourceAsrSession') as factory:
            session = factory.return_value
            session.start.return_value = []
            session.recognize.return_value = rows
            report = score_source(self.plan, self.wav, Path(folder))
            self.assertEqual(report['status'], 'matched')
            self.assertEqual([row['stage'] for row in report['recognizer_diagnostics']], ['model_load', 'full_audio'])
            self.assertEqual(report['recognizer_diagnostics'][0]['window_duration_ms'], 0)
            factory.assert_called_once_with(Path(folder))
            session.start.assert_called_once_with()
            session.recognize.assert_called_once()
            session.close.assert_called_once_with()
            session.reset_mock()
            session.start.side_effect = subprocess.TimeoutExpired('private-path', 120)
            report = score_source(self.plan, self.wav, Path(folder))
            self.assertEqual(report['reason'], 'recognizer_timeout')
            self.assertEqual(report['recognizer_diagnostics'][0]['stage'], 'model_load')
            self.assertNotIn('private-path', json.dumps(report))
            session.recognize.assert_not_called()
            session.close.assert_called_once_with()

    def test_resident_worker_loads_once_and_receives_only_private_audio_paths(self):
        with TemporaryDirectory() as folder:
            directory = Path(folder)
            wav = directory / 'source.wav'
            wav.write_bytes(self.wav)
            window = directory / 'phone.wav'
            window.write_bytes(make_wav(self.data[:48_000]))
            output = io.StringIO()
            loader = Mock(return_value=object())
            decoder = Mock(return_value=[(' observed', .1, .3, .9)])
            requests = io.BytesIO(b''.join(json.dumps({'wav': str(path)}).encode() + b'\n'
                                          for path in (wav, window)))
            serve(directory, loader=loader, decode=decoder, source=requests, destination=output)
            self.assertEqual([json.loads(row) for row in output.getvalue().splitlines()], [
                {'status': 'ready'}, {'rows': [[' observed', .1, .3, .9]]},
                {'rows': [[' observed', .1, .3, .9]]},
            ])
            loader.assert_called_once_with()
            self.assertEqual(decoder.call_count, 2)
            self.assertEqual([call.args[1] for call in decoder.call_args_list], [wav, window])
            self.assertTrue(all(call.args[0] is loader.return_value for call in decoder.call_args_list))

    def test_resident_worker_rejects_foreign_symlink_or_oversized_requests_without_private_errors(self):
        with TemporaryDirectory() as folder, TemporaryDirectory() as foreign:
            directory = Path(folder)
            outside = Path(foreign) / 'private.wav'
            outside.write_bytes(self.wav)
            link = directory / 'link.wav'
            link.symlink_to(outside)
            for request in ({'wav': str(outside)}, {'wav': str(link)}, {'script': 'private expected text'},
                            {'wav': str(outside), 'script': 'private expected text'}):
                output, decoder = io.StringIO(), Mock()
                serve(directory, loader=Mock(), decode=decoder,
                      source=io.BytesIO(json.dumps(request).encode() + b'\n'), destination=output)
                self.assertEqual(output.getvalue(), '{"status": "ready"}\n{"status": "error"}\n')
                decoder.assert_not_called()
            output = io.StringIO()
            serve(directory, loader=Mock(side_effect=RuntimeError('private model path')),
                  source=io.BytesIO(), destination=output)
            self.assertEqual(output.getvalue(), '{"status": "error"}\n')

    def test_resident_transport_reuses_process_and_terminates_on_bounded_timeout(self):
        popen = subprocess.Popen
        responder = ('import json,sys\nprint(json.dumps({"status":"ready"}),flush=True)\n'
                     'for line in sys.stdin:\n'
                     ' print(json.dumps({"rows":[[" observed",.1,.3,.9]]}),flush=True)\n')
        with TemporaryDirectory() as folder:
            directory = Path(folder)
            path = directory / 'source.wav'
            path.write_bytes(self.wav)
            with patch('tip_source_asr_session.subprocess.Popen',
                       side_effect=lambda *args, **kwargs: popen([sys.executable, '-u', '-c', responder], **kwargs)) as run:
                session = SourceAsrSession(directory)
                try:
                    session.start()
                    process = session.process
                    self.assertEqual(session.recognize(path), [[' observed', .1, .3, .9]])
                    self.assertEqual(session.recognize_window(path), [[' observed', .1, .3, .9]])
                    run.assert_called_once()
                finally:
                    session.close()
                self.assertIsNotNone(process.poll())
                self.assertTrue(process.stdin.closed)
                self.assertTrue(process.stdout.closed)
            with patch('tip_source_asr_session.subprocess.Popen', side_effect=lambda *args, **kwargs:
                       popen([sys.executable, '-u', '-c', 'import time;time.sleep(10)'], **kwargs)), \
                    patch('tip_source_asr_session.MODEL_LOAD_TIMEOUT_SECONDS', .05):
                session = SourceAsrSession(directory)
                with self.assertRaises(subprocess.TimeoutExpired):
                    session.start()
                self.assertIsNone(session.process)
                session.close()

    def test_resident_transport_bounds_unterminated_private_output(self):
        popen = subprocess.Popen
        responder = 'import sys;sys.stdout.write("x"*140000);sys.stdout.flush()'
        with TemporaryDirectory() as folder, patch('tip_source_asr_session.subprocess.Popen',
                side_effect=lambda *args, **kwargs: popen([sys.executable, '-u', '-c', responder], **kwargs)):
            session = SourceAsrSession(folder)
            with self.assertRaisesRegex(ValueError, '^Oversized source ASR response$'):
                session.start()
            self.assertIsNone(session.process)
            session.close()
