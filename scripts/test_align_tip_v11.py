from contextlib import redirect_stderr
import difflib
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from align_tip_v11 import (
    DOMAIN_BOUNDARY_METHOD, PHONE_WINDOW_EVIDENCE, PhoneEvidenceError, SignatureEvidenceError, align, align_with_phone_retry,
    align_with_signature_retry, recognize_words, report_alignment_failure, tokens,
    alignment_failure_diagnostics, bounded_domain_boundary, canonical_signature_brand,
)


SEGMENTS = [
    {'id': 'greeting', 'text': 'Salam alikoum ! Nanga def ?'},
    *[{'id': identifier, 'text': text} for identifier, text in zip(
        ('hook', 'step1', 'step2', 'step3', 'takeaway', 'services', 'tools'),
        (
            'Le choix du logement commence par des observations utiles pendant la visite.',
            'Préparez les points importants avant votre arrivée et gardez vos questions sous la main.',
            'Comparez ce que vous voyez sur place avec les informations déjà communiquées.',
            'Prenez des notes sur ce qui mérite une confirmation après votre visite.',
            'Relisez vos observations tranquillement pour choisir le logement qui vous convient.',
            'Jamm Immo accompagne votre achat, votre vente et la gestion locative.',
            'Les simulations de rentabilité et de frais acquisition sont disponibles en ligne.',
        ))],
    {'id': 'domain', 'text': 'Retrouvez notre site jamm immo point com.', 'caption': 'jammimmo.com'},
    {'id': 'contact', 'text': 'Vous pouvez nous appeler ou écrire sur WhatsApp pour poser vos questions.'},
    {'id': 'phone', 'text': 'Plus deux cent vingt et un, soixante-seize, neuf cent quarante-quatre, quarante-huit, quarante-neuf.',
     'caption': '+221 76 944 48 49'},
    {'id': 'socials', 'text': 'Retrouvez Jamm Immo sur nos réseaux sociaux pour découvrir les prochains conseils.'},
    {'id': 'signature', 'text': 'À bientôt Jamm Immo Kër gu baax xel mu dal !'},
]


def speech(segments):
    words = [token for segment in segments for token in tokens(segment['text'])]
    step = 69 / len(words)
    return [{'word': token, 'start': .2 + index * step, 'end': .2 + (index + .8) * step}
            for index, token in enumerate(words)]


def phone_gap():
    words = speech(SEGMENTS)
    index = next(i for i, word in enumerate(words) if word['word'] == 'plus')
    phone_count = len(tokens(next(segment['text'] for segment in SEGMENTS if segment['id'] == 'phone')))
    return (words[:index] + words[index + phone_count:], words[index:index + phone_count], index,
            [(word['start'], word['end']) for word in words])


class V11AlignmentTest(unittest.TestCase):
    def test_pre_alignment_codes_for_invalid_plan_audio_and_coverage(self):
        words = speech(SEGMENTS)
        sound = [(0, 70)]
        cases = [
            (SEGMENTS, words, 4, sound, 'duration_invalid', {'duration_ms': 4000}),
            (SEGMENTS, words, 70, [], 'no_audible_windows', {'row_count': len(words)}),
            ([{'id': 'SECRET', 'text': '?!'}], words, 70, sound, 'empty_segment', {'segment_index': 0}),
            (SEGMENTS, [{**w, 'word': 'SECRET'} for w in words], 70, sound,
             'script_coverage_low', {'ratio_permille': 0}),
            (SEGMENTS, [{**w, 'start': 0, 'end': .1} for w in words], 70, sound,
             'scene_too_short', {'segment_index': 0, 'span_ms': 0}),
        ]
        for segments, rows, duration, windows, code, metrics in cases:
            with self.subTest(code=code), self.assertRaises(ValueError) as rejected:
                align(segments, rows, duration, windows)
            diagnostic = alignment_failure_diagnostics(rejected.exception)
            self.assertEqual(diagnostic['alignment_code'], code)
            self.assertEqual({key: diagnostic[key] for key in metrics}, metrics)
            self.assertNotIn('SECRET', str(diagnostic))
        self.assertEqual(alignment_failure_diagnostics(ValueError('SECRET')), {
            'reason': 'alignment_evidence_invalid', 'alignment_code': 'unclassified_value_error',
        })

    def deferred_domain_fixture(self):
        segments = [row if row['id'] != 'domain' else {
            **row, 'text': 'Retrouvez-nous sur notre site, jamm immo point com.',
        } for row in SEGMENTS]
        words = speech(segments)
        first = sum(len(tokens(row['text'])) for row in segments[:8]) + 5
        heard = [*words[:first], {**words[first], 'word': 'diamimo', 'end': words[first + 2]['end']},
                 *words[first + 3:]]
        return segments, heard, first

    def test_domain_timing_defers_only_with_explicit_option_without_rewriting_speech(self):
        segments, heard, _ = self.deferred_domain_fixture()
        original = [row.copy() for row in heard]
        with self.assertRaisesRegex(ValueError, 'pronunciation.*domain'):
            align(segments, heard, 70)
        actual = align(segments, heard, 70, defer_domain=True)
        self.assertEqual(actual['domainEvidenceMethod'], DOMAIN_BOUNDARY_METHOD)
        self.assertEqual(actual['deferredChecks'], ['domain_audio', 'visible_domain_cta'])
        self.assertTrue(actual['reviewRequired'])
        self.assertEqual(heard, original)
        self.assertEqual(actual['segments'][8]['text'], segments[8]['text'])
        self.assertEqual(actual['segments'][8]['end'], actual['segments'][9]['start'])
        self.assertEqual(len(actual['phoneGroups']), 5)

    def test_recorded_diamimo_window_locates_timing_without_certifying_domain_audio(self):
        # Exact ASR timings from the 16 November normalized local take.
        # This is a boundary regression, not a fresh decode or voice approval.
        segments = [
            {'id': 'tools', 'text': 'Les simulations restent indicatives.'},
            {'id': 'domain', 'text': 'Retrouvez-nous sur notre site, jamm immo point com.'},
            {'id': 'contact', 'text': 'Vous pouvez nous appeler ou nous écrire sur WhatsApp au même numéro.'},
        ]
        rows = [
            ('indicatives.', 44.32, 44.96), ('Retrouvez', 45.48, 46), ('-nous', 46, 46.1),
            ('sur', 46.1, 46.32), ('notre', 46.32, 46.48), ('site,', 46.48, 46.74),
            ('diamimo', 46.94, 47.68), ('.com.', 47.68, 48.18), ('Vous', 48.36, 48.7),
            ('pouvez', 48.7, 48.92), ('nous', 48.92, 49.1), ('appeler', 49.1, 49.5),
            ('ou', 49.5, 49.76), ('nous', 49.76, 50),
        ]
        groups = [tokens(segment['text']) for segment in segments]
        expected = [word for group in groups for word in group]
        actual, stamps = [], []
        for word, start, end in rows:
            for token in tokens(word):
                actual.append(token)
                stamps.append((start, end))
        matcher = difflib.SequenceMatcher(None, expected, actual, autojunk=False)
        mapping = {block.a + i: block.b + i for block in matcher.get_matching_blocks() for i in range(block.size)}
        self.assertTrue(bounded_domain_boundary(segments, 1, groups, len(groups[0]), mapping, actual, stamps))
        self.assertNotIn('jamm', actual)
        self.assertNotIn('point', actual)

    def test_domain_timing_rejects_missing_competing_or_unbounded_anchors(self):
        segments, heard, first = self.deferred_domain_fixture()
        before, domain, com, contact, following = heard[:first], heard[first], heard[first + 1], heard[first + 2], heard[first + 3:]
        invalid = (
            [*before, domain, {**com, 'word': 'fr'}, contact, *following],
            [*before, domain, {**com, 'word': 'com com'}, contact, *following],
            [*before, {**domain, 'word': 'un deux trois quatre cinq'}, com, contact, *following],
            [*before, domain, com, {**contact, 'word': 'indécis'}, *following],
            [*before[:-1], {**before[-1], 'word': 'indécis'}, domain, com, contact, *following],
        )
        for words in invalid:
            with self.subTest(words=words[first - 1:first + 3]), self.assertRaisesRegex(ValueError, 'pronunciation.*domain'):
                align(segments, words, 70, defer_domain=True)
        for update in ({'text': 'Retrouvez-nous sur notre site, autre point com.'}, {'id': 'other'}):
            changed = [row if i != 8 else {**row, **update} for i, row in enumerate(segments)]
            if update.get('id'):
                # The explicit defer mechanism is bound to the domain scene.
                with self.assertRaisesRegex(ValueError, 'Insufficient speech evidence: other'):
                    align(changed, heard, 70, defer_domain=True)
            else:
                with self.assertRaisesRegex(ValueError, 'pronunciation.*domain'):
                    align(changed, heard, 70, defer_domain=True)

    def test_domain_deferral_preserves_phone_and_signature_validation(self):
        segments, heard, _ = self.deferred_domain_fixture()
        index = next(i for i, word in enumerate(heard) if word['word'] == 'seize')
        changed = [*heard[:index], {**heard[index], 'word': 'quinze'}, *heard[index + 1:]]
        with self.assertRaises(PhoneEvidenceError):
            align(segments, changed, 70, defer_domain=True)
        ending = len(tokens(segments[-1]['text']))
        changed = heard[:-ending] + [{**row, 'word': 'murmure'} for row in heard[-ending:]]
        with self.assertRaises(SignatureEvidenceError):
            align(segments, changed, 70, defer_domain=True)

    def test_keeps_authored_steps_and_formats_the_full_number_in_digits(self):
        alignment = align(SEGMENTS, speech(SEGMENTS), 70)
        self.assertEqual([s['id'] for s in alignment['segments']], [s['id'] for s in SEGMENTS])
        self.assertGreater(alignment['durationInFrames'], 1800)
        self.assertEqual([c['text'] for c in alignment['captions'] if c['text'].startswith('+')], ['+221 76 944 48 49'])
        self.assertTrue(all(len(c['text']) <= 55 for c in alignment['captions']))
        self.assertEqual(len(alignment['phoneGroups']), 5)
        self.assertTrue(all(a['end'] < b['start'] for a, b in zip(
            alignment['phoneGroups'], alignment['phoneGroups'][1:])))
        self.assertTrue(alignment['reviewRequired'])

    def test_preroll_stays_after_the_last_word_when_both_scene_anchors_agree(self):
        words = speech(SEGMENTS)
        index = sum(len(tokens(row['text'])) for row in SEGMENTS[:6])
        previous, leading = words[index - 1], words[index]
        previous['end'] = leading['start'] - .02
        alignment = align(SEGMENTS, words, 70)
        cut = alignment['segments'][6]['start']
        self.assertEqual(cut, previous['end'])
        self.assertEqual(alignment['segments'][5]['end'], cut)
        self.assertEqual([caption['end'] for caption in alignment['captions']
                          if caption['start'] < cut][-1], cut)

        previous['word'] = 'incertain'
        unconfirmed = align(SEGMENTS, words, 70)
        self.assertAlmostEqual(unconfirmed['segments'][6]['start'], leading['start'] - .08)

    def test_unconfirmed_next_word_uses_a_measured_pause_after_an_exact_line_end(self):
        words = speech(SEGMENTS)
        boundary = sum(len(tokens(row['text'])) for row in SEGMENTS[:7])
        for word in words[boundary:]:
            word['start'] += .42
            word['end'] += .42
        words[boundary]['word'] = 'Jam'
        words[boundary + 1]['word'] = 'Imo'
        sound = [(word['start'], word['end']) for word in words]
        with_pause = align(SEGMENTS, words, 70, sound)
        self.assertAlmostEqual(with_pause['segments'][7]['start'], words[boundary]['start'] - .18)
        self.assertTrue(with_pause['reviewRequired'])

        # Continuous speech, or an uncertain prior line end, cannot establish
        # a replacement timing simply because the next start is uncertain.
        continuous = sound[:boundary - 1] + [(sound[boundary - 1][0], sound[boundary][1])] + sound[boundary + 1:]
        for evidence, last_word in [(continuous, words[boundary - 1]['word']), (sound, 'indécis')]:
            with self.subTest(last_word=last_word):
                changed = [*words[:boundary - 1], {**words[boundary - 1], 'word': last_word}, *words[boundary:]]
                result = align(SEGMENTS, changed, 70, evidence)
                self.assertAlmostEqual(result['segments'][7]['start'], words[boundary + 2]['start'] - .08)

    def test_wrong_phone_and_trailing_dead_air_fail(self):
        words = speech(SEGMENTS)
        index = next(i for i, word in enumerate(words) if word['word'] == 'neuf')
        words[index]['word'] = 'sept'
        with self.assertRaisesRegex(ValueError, 'pronunciation.*phone'):
            align(SEGMENTS, words, 70)
        with self.assertRaisesRegex(ValueError, 'excessive silence'):
            align(SEGMENTS, speech(SEGMENTS), 75)

    def test_phone_window_recovers_only_absent_number_with_small_timestamp_overlap(self):
        full, phone, index, sound = phone_gap()
        phone[0] = {**phone[0], 'start': full[index - 1]['end'] - .06}
        focused = Mock(return_value=[full[index - 1], *phone])
        recognize_tail = Mock()
        with self.assertRaises(PhoneEvidenceError):
            align(SEGMENTS, full, 70, sound)

        actual = align_with_phone_retry(SEGMENTS, full, 70, sound, recognize_tail, focused)
        focused.assert_called_once_with(full[index - 1]['end'] - .44, full[index]['start'])
        recognize_tail.assert_not_called()
        expected = align(SEGMENTS, [*full[:index], *phone, *full[index:]], 70, sound)
        self.assertEqual(actual, {**expected, 'phoneEvidenceMethod': PHONE_WINDOW_EVIDENCE})

    def test_phone_window_is_skipped_for_an_already_recognized_number(self):
        words = speech(SEGMENTS)
        focused = Mock()
        sound = [(word['start'], word['end']) for word in words]
        self.assertEqual(align_with_phone_retry(SEGMENTS, words, 70, sound, Mock(), focused),
                         align(SEGMENTS, words, 70, sound))
        focused.assert_not_called()

    def test_phone_window_does_not_replace_a_competing_word_or_guess_an_anchor(self):
        full, phone, index, sound = phone_gap()
        competing = {**phone[2], 'word': 'sept'}
        unconfirmed = [*full[:index - 1], {**full[index - 1], 'word': 'murmure'}, *full[index:]]
        for words in ([*full[:index], competing, *full[index:]], unconfirmed):
            with self.subTest(words=words[index - 1:index + 1]):
                focused = Mock(return_value=phone)
                with self.assertRaises(PhoneEvidenceError):
                    align_with_phone_retry(SEGMENTS, words, 70, sound, Mock(), focused)
                focused.assert_not_called()

    def test_phone_window_requires_exact_complete_words_and_bounded_valid_timings(self):
        full, phone, index, sound = phone_gap()
        for result in (phone[:-1], [*phone[:3], {**phone[3], 'word': 'sept'}, *phone[4:]],
                       [{**phone[0], 'start': float('nan')}, *phone[1:]],
                       [{**phone[0], 'start': full[index - 1]['end'] - .11}, *phone[1:]],
                       [{**phone[0], 'word': 'murmure'}, *phone],
                       [{**phone[0], 'word': 'au plus'}, *phone[1:]]):
            with self.subTest(first_word=result[0]):
                focused = Mock(return_value=result)
                with self.assertRaises(PhoneEvidenceError):
                    align_with_phone_retry(SEGMENTS, full, 70, sound, Mock(), focused)
                focused.assert_called_once()

    def test_phone_window_refuses_multiple_exact_reads_or_changed_script(self):
        full, phone, index, sound = phone_gap()
        start, end = full[index - 1]['end'], full[index]['start']
        step = (end - start) / (len(phone) * 2 + 1)
        twice = [{**word, 'start': start + i * step, 'end': start + (i + .5) * step}
                 for i, word in enumerate(phone + phone)]
        focused = Mock(return_value=twice)
        with self.assertRaises(PhoneEvidenceError):
            align_with_phone_retry(SEGMENTS, full, 70, sound, Mock(), focused)
        focused.assert_called_once()

        changed = [{**segment, 'text': segment['text'].replace('quarante-neuf', 'quarante-sept')}
                   if segment['id'] == 'phone' else segment for segment in SEGMENTS]
        focused.reset_mock()
        with self.assertRaises(PhoneEvidenceError):
            align_with_phone_retry(changed, full, 70, sound, Mock(), focused)
        focused.assert_not_called()

    def test_phone_window_rejects_a_quiet_gap_before_decoding(self):
        full, phone, index, sound = phone_gap()
        start, end = full[index - 1]['end'], full[index]['start']
        quiet = [(a, b) for a, b in sound if b <= start or a >= end]
        quiet.extend((position, position + .05) for position in
                     [start + (end - start) * fraction for fraction in (.25, .50, .75)])
        focused = Mock(return_value=phone)
        with self.assertRaises(PhoneEvidenceError):
            align_with_phone_retry(SEGMENTS, full, 70, sorted(quiet), Mock(), focused)
        focused.assert_not_called()

    def test_phone_window_rejects_a_recognized_word_with_no_voiced_span(self):
        full, phone, _, sound = phone_gap()
        silent_word = phone[5]
        sound.remove((silent_word['start'], silent_word['end']))
        focused = Mock(return_value=phone)
        with self.assertRaises(PhoneEvidenceError):
            align_with_phone_retry(SEGMENTS, full, 70, sound, Mock(), focused)
        focused.assert_called_once()

    def test_decoder_scalar_offsets_become_plain_floats_before_validation(self):
        class DecoderScalar(float):
            def __add__(self, offset):
                return DecoderScalar(super().__add__(offset))

        words = [SimpleNamespace(word='plus', start=DecoderScalar(.25), end=DecoderScalar(.5), probability=DecoderScalar(.79))]
        model = Mock()
        model.transcribe.return_value = ([SimpleNamespace(words=words)], None)
        observed = recognize_words(model, 'local.wav', beam_size=5, time_offset=54)
        self.assertEqual(observed, [{'word': 'plus', 'start': 54.25, 'end': 54.5, 'probability': .79}])
        self.assertIs(type(observed[0]['probability']), float)
        self.assertIs(type(observed[0]['start']), float)
        self.assertIs(type(observed[0]['end']), float)
        model.transcribe.assert_called_once_with('local.wav', language='fr', beam_size=5,
                                                word_timestamps=True, condition_on_previous_text=False)

    def test_phone_recovery_does_not_exempt_the_signature_gate(self):
        full, phone, _, sound = phone_gap()
        ending_count = len(tokens(SEGMENTS[-1]['text']))
        missing_signature = full[:-ending_count]
        focused = Mock(return_value=phone)
        with self.assertRaises(SignatureEvidenceError):
            align_with_phone_retry(SEGMENTS, missing_signature, 70, sound, lambda _: [], focused)
        focused.assert_called_once()

    def test_retries_only_the_signature_and_rechecks_the_full_contract(self):
        words = speech(SEGMENTS)
        tail_length = len(tokens(SEGMENTS[-1]['text']))
        body, ending = words[:-tail_length], words[-tail_length:]
        unclear = [{**word, 'word': 'inaudible'} for word in ending]
        sound = [(word['start'], word['end']) for word in words]
        recognize_tail = Mock(return_value=ending)

        with self.assertRaisesRegex(ValueError, 'Insufficient speech evidence: signature'):
            align(SEGMENTS, body + unclear, 70, sound)
        alignment = align_with_signature_retry(SEGMENTS, body + unclear, 70, sound, recognize_tail)
        recognize_tail.assert_called_once_with(body[-1]['end'])
        self.assertEqual(alignment['method'], 'french-v11-word-anchors-signature-retry')
        self.assertTrue(alignment['reviewRequired'])
        self.assertEqual(alignment['phoneGroups'], align(SEGMENTS, words, 70, sound)['phoneGroups'])
        self.assertEqual(alignment['segments'][-1]['text'], SEGMENTS[-1]['text'])

    def test_signature_retry_rejects_audible_but_unrelated_words(self):
        words = speech(SEGMENTS)
        tail_length = len(tokens(SEGMENTS[-1]['text']))
        body, ending = words[:-tail_length], words[-tail_length:]
        unclear = [{**word, 'word': 'murmure'} for word in ending]
        recognize_tail = Mock(return_value=unclear)
        sound = [(word['start'], word['end']) for word in words]

        with self.assertRaisesRegex(SignatureEvidenceError, 'Insufficient speech evidence: signature') as rejected:
            align_with_signature_retry(SEGMENTS, body + unclear, 70, sound, recognize_tail)
        self.assertEqual(rejected.exception.reason, 'signature_closing_unrecognized')
        recognize_tail.assert_called_once()

    def test_complete_full_signature_preserves_rows_before_trying_an_incomplete_focused_decode(self):
        body = speech(SEGMENTS)[:-len(tokens(SEGMENTS[-1]['text']))]
        scale = 60.38 / body[-1]['end']
        body = [{**row, 'start': row['start'] * scale, 'end': row['end'] * scale} for row in body]
        specs = [('À', 60.78, 61.30), ('bientôt', 61.30, 61.64), ('!', 61.64, 62.10),
                 ('Jam', 62.10, 62.68), ('Imo,', 62.68, 63.18),
                 ('suite', 63.68, 63.90), ('du', 63.90, 64.26), ('son', 64.26, 64.50),
                 ('final', 64.94, 65.72)]
        tail = [{'word': word, 'start': start, 'end': end} for word, start, end in specs]
        duration = 66.16
        sound = [(0, 60.4), (61.2, 61.7), (62.1, 63.2), (63.7, 64.6), (64.8, 65.8)]
        focused = Mock(return_value=tail[:2])
        canonical = [*tail[:3], {**tail[3], 'word': 'jamm'}, {**tail[4], 'word': 'immo'}, *tail[5:]]
        result = align_with_signature_retry(SEGMENTS, body + tail, duration, sound, focused)
        self.assertEqual(result, align(SEGMENTS, body + canonical, duration, sound))
        self.assertEqual([r['word'] for r in tail], [word for word, _, _ in specs])
        focused.assert_not_called()

        for label, observed in {
            'missing brand word': [*tail[:4], *tail[5:]],
            'reversed brand': [*tail[:3], {**tail[3], 'word': 'Imo'}, {**tail[4], 'word': 'Jam'}, *tail[5:]],
            'wide gap': [*tail[:3], {**tail[3], 'end': 62.45}, *tail[4:]],
            'truncated continuation': tail[:6],
            'crosses the preceding word': [{**tail[0], 'start': 60.35}, *tail[1:]],
        }.items():
            with self.subTest(label=label), self.assertRaises(SignatureEvidenceError) as rejected:
                align_with_signature_retry(SEGMENTS, body + observed, duration, sound, focused)
            self.assertEqual(rejected.exception.reason, 'signature_retry_insufficient')
            focused.assert_called_once_with(body[-1]['end'])
            focused.reset_mock()

    def test_split_signature_brand_uses_one_focused_decode_and_preserves_each_timestamp(self):
        # Observed closing timestamps; neutral words stand in for unconfirmed
        # ASR output beyond the brand. No private transcription is necessary.
        specs = [(' À', 57.02, 57.70), (' bientôt !', 57.70, 58.08),
                 (' Jam', 58.50, 58.86), (' Imo,', 58.86, 59.16),
                 (' suite', 59.64, 60.18), (' du', 60.44, 60.60), (' son', 60.60, 60.98)]
        tail = [{'word': word, 'start': start, 'end': end} for word, start, end in specs]
        body = speech(SEGMENTS)[:-len(tokens(SEGMENTS[-1]['text']))]
        scale = 57.12 / body[-1]['end']
        body = [{**w, 'start': w['start'] * scale, 'end': w['end'] * scale} for w in body]
        full = [*body, {**tail[0], 'start': 57.12}, tail[1]]
        duration = 61.337
        sound = [(0, 59.20), (59.60, 60.20), (60.40, 61.00)]
        with self.assertRaises(SignatureEvidenceError):
            align(SEGMENTS, body + tail, duration, sound)
        fixed = canonical_signature_brand(tail, sound, duration)
        self.assertEqual([w['word'] for w in fixed[2:4]], ['jamm', 'immo'])
        self.assertEqual([(w['start'], w['end']) for w in fixed], [(w['start'], w['end']) for w in tail])
        focused = Mock(return_value=tail)
        result = align_with_signature_retry(SEGMENTS, full, duration, sound, focused)
        self.assertEqual(result['method'], 'french-v11-word-anchors-signature-retry')
        def signature_start(alignment):
            return alignment['segments'][-1]['start']
        self.assertAlmostEqual(signature_start(result), 57.12)
        self.assertAlmostEqual(result['segments'][-2]['end'], 57.12)
        social_caption = next(c for c in result['captions'] if c['text'].endswith('prochains conseils.'))
        self.assertAlmostEqual(social_caption['end'], 57.12)
        self.assertAlmostEqual(signature_start(align(SEGMENTS, body + fixed, duration, sound)), 56.94)
        # A raw retry can pass on À, bientôt and dal alone. The same measured
        # prior-word endpoint still owns the cut when no brand repair ran.
        raw_tail = [*tail[:-1], {**tail[-1], 'word': 'dal'}]
        raw_retry = align_with_signature_retry(SEGMENTS, full, duration, sound, Mock(return_value=raw_tail))
        self.assertAlmostEqual(signature_start(raw_retry), 57.12)
        self.assertAlmostEqual(raw_retry['segments'][-2]['end'], 57.12)
        # A wrong/missing terminal anchor, an intervening token, a different scene, a fully consumed
        # opening, or overlap beyond the measured crop cannot extend the preceding scene.
        wrong_scene = [*SEGMENTS[:-2], {**SEGMENTS[-2], 'id': 'other'}, SEGMENTS[-1]]
        ambiguous_body = [{**body[0], 'word': 'prochains'}, {**body[1], 'word': 'conseils'}, *body[2:]]
        for label, segments, prior, focused_rows in [
            ('unanchored', SEGMENTS, [*body[:-2], {**body[-2], 'word': 'ailleurs'}, body[-1]], fixed),
            ('intervening', SEGMENTS, [*body, {**body[-1], 'word': 'autre', 'start': 57.01}], fixed),
            ('wrong scene', wrong_scene, body, fixed),
            ('opening too early', SEGMENTS, body, [{**fixed[0], 'start': 57.00}, *fixed[1:]]),
            ('opening swallowed', SEGMENTS, body, [{**fixed[0], 'end': 57.12}, *fixed[1:]]),
            ('duplicate prior anchor', SEGMENTS, ambiguous_body, fixed),
        ]:
            with self.subTest(clamp=label):
                ordinary = align(segments, prior + focused_rows, duration, sound)
                guarded = align(segments, prior + focused_rows, duration, sound, signature_boundary=57.12)
                self.assertAlmostEqual(signature_start(guarded), signature_start(ordinary))
                self.assertLess(signature_start(guarded), 57.12)
        focused.assert_called_once()
        self.assertEqual([w['word'] for w in tail[2:4]], [' Jam', ' Imo,'])

        def change(index, **fields):
            return [*tail[:index], {**tail[index], **fields}, *tail[index + 1:]]
        negatives = {
            'amputated': (tail[:4], sound),
            'one continuation row': (tail[:5], sound),
            'isolated brand': (tail[2:], sound),
            'brand before farewell': ([*tail[2:4], *tail[:2], *tail[4:]], sound),
            'reversed brand': (change(2, word=' Imo')[:3] + change(3, word=' Jam')[3:], sound),
            'large gap': (change(2, end=58.65), sound),
            'closed sentence': (change(2, word=' Jam!'), sound),
            'repeated pair': ([*tail, *tail[2:4]], sound),
            'overlap': (change(3, start=58.84), sound),
            'reused time': (change(3, start=58.50, end=58.86), sound),
            'silent after brand': (tail, [(0, 59.16)]),
            'silent under continuation': (tail, [(0, 59.20), (59.21, 59.63), (59.64, 60.23), (60.61, 61.15)]),
        }
        for name, (observed, audible) in negatives.items():
            with self.subTest(name=name):
                self.assertIsNone(canonical_signature_brand(observed, audible, duration))
                with self.assertRaises(ValueError):
                    align_with_signature_retry(SEGMENTS, full, duration, audible, lambda _: observed)

    def test_partial_retry_is_reported_without_changing_the_failed_result(self):
        words = speech(SEGMENTS)
        tail_length = len(tokens(SEGMENTS[-1]['text']))
        body, ending = words[:-tail_length], words[-tail_length:]
        sound = [(word['start'], word['end']) for word in words]
        with self.assertRaises(SignatureEvidenceError) as rejected:
            align_with_signature_retry(SEGMENTS, body + ending[:2], 70, sound, lambda _: ending[2:4])
        self.assertEqual(rejected.exception.diagnostics(), {
            'reason': 'signature_retry_insufficient', 'alignment_code': 'signature_retry_insufficient',
            'matched_words': 2, 'expected_words': 10,
        })

    def test_failure_marker_contains_only_a_predefined_code(self):
        with TemporaryDirectory() as directory, redirect_stderr(StringIO()) as stderr:
            marker = Path(directory) / 'failure'
            report_alignment_failure(ValueError('Unexpected private transcript'), marker)
            self.assertEqual(marker.read_text(), 'alignment_evidence_invalid\n')
            self.assertNotIn('private transcript', stderr.getvalue())
            report_alignment_failure(ValueError('Exact contact pronunciation not recognized: phone'), marker)
            self.assertEqual(marker.read_text(), 'phone_evidence_unconfirmed\n')

    def test_no_retry_after_a_short_but_silent_ending(self):
        words = speech(SEGMENTS)
        body = words[:-len(tokens(SEGMENTS[-1]['text']))]
        sound = [(word['start'], word['end']) for word in body]
        recognize_tail = Mock()

        with self.assertRaisesRegex(SignatureEvidenceError, 'Insufficient speech evidence: signature') as rejected:
            align_with_signature_retry(SEGMENTS, body, body[-1]['end'] + 2.2, sound, recognize_tail)
        self.assertEqual(rejected.exception.reason, 'signature_tail_too_quiet')
        recognize_tail.assert_not_called()

    def test_does_not_redecode_when_contact_or_the_preceding_boundary_is_unproven(self):
        words = speech(SEGMENTS)
        sound = [(word['start'], word['end']) for word in words]
        recognize_tail = Mock()
        phone_word = next(i for i, word in enumerate(words) if word['word'] == 'neuf')
        wrong_phone = [*words[:phone_word], {**words[phone_word], 'word': 'sept'}, *words[phone_word + 1:]]
        with self.assertRaisesRegex(ValueError, 'pronunciation.*phone'):
            align_with_signature_retry(SEGMENTS, wrong_phone, 70, sound, recognize_tail)

        ending_boundary = next(i for i, word in enumerate(words) if word['word'] == 'conseils')
        unanchored = words[:ending_boundary] + [{**word, 'word': 'murmure'} for word in words[ending_boundary:]]
        with self.assertRaisesRegex(SignatureEvidenceError, 'Insufficient speech evidence: signature') as rejected:
            align_with_signature_retry(SEGMENTS, unanchored, 70, sound, recognize_tail)
        self.assertEqual(rejected.exception.reason, 'signature_boundary_unconfirmed')
        recognize_tail.assert_not_called()


class GreetingWindowTests(unittest.TestCase):
    def setUp(self):
        # Preserve the original four lexical measurements, including the unaliased
        # Alekoum, on a synthetic suffix whose first hook token starts at 2.36 s.
        self.focus = [
            {'word': word, 'start': start, 'end': end, 'probability': p}
            for word, start, end, p in [('Salam', 0., .74, .827), ('Alekoum', .74, 1.56, .777),
                                        ('Nanga', 1.84, 2.1, .704), ('Def', 2.1, 2.28, .941)]
        ]
        suffix = speech(SEGMENTS)[4:]
        shift = 2.36 - suffix[0]['start']
        self.suffix = [{**w, 'start': w['start'] + shift, 'end': w['end'] + shift,
                        'probability': .99} for w in suffix]
        self.sound = [(w['start'], w['end']) for w in self.focus + self.suffix]
        self.full = [dict(w) for w in self.suffix]
        self.full[0]['probability'] = .113

    def run_alignment(self, callback, words=None, sound=None):
        return align_with_phone_retry(SEGMENTS, self.full if words is None else words, 70,
                                      self.sound if sound is None else sound, Mock(), Mock(),
                                      recognize_greeting=callback)

    def test_exact_three_focused_anchors_use_one_bounded_crop(self):
        callback = Mock(return_value=self.focus)
        result = self.run_alignment(callback)
        callback.assert_called_once_with(2.36)
        self.assertEqual(result['greetingEvidenceMethod'], 'french-v11-pinned-greeting-window')
        self.assertEqual(self.focus[1]['word'], 'Alekoum')

    def test_focused_invalid_anchors_and_measurements_do_not_recover(self):
        for index, replacement in [(2, {'word': 'autre'}), (0, {'probability': .10}),
                                   (3, {'probability': float('nan')}), (3, {'end': 2.37}),
                                   (2, {'start': 1.2}), (3, {'start': 2.28})]:
            with self.subTest(index=index, replacement=replacement):
                rows = [dict(row) for row in self.focus]
                rows[index].update(replacement)
                with self.assertRaises(ValueError):
                    self.run_alignment(Mock(return_value=rows))
        rows = [dict(row) for row in self.focus]
        rows[0].pop('probability')
        with self.assertRaises(ValueError):
            self.run_alignment(Mock(return_value=rows))

    def test_unvoiced_opening_and_ambiguous_hook_do_not_trigger_recovery(self):
        quiet = [(w['start'], w['end']) for w in self.suffix]
        for words, sound in [(self.full, quiet),
                             ([*self.full[:3], *[{**w, 'word': self.full[i]['word']} for i, w in enumerate(self.full[3:6])],
                               *self.full[6:]], self.sound)]:
            callback = Mock(return_value=self.focus)
            with self.assertRaises(ValueError):
                self.run_alignment(callback, words, sound)
            callback.assert_not_called()

    def test_unbounded_or_low_confidence_hook_and_lost_greeting_slots(self):
        for update in [{'start': -.2}, {'probability': float('inf')}, {'probability': .59}]:
            words = [dict(w) for w in self.full]
            words[1].update(update)
            callback = Mock(return_value=self.focus)
            with self.subTest(update=update), self.assertRaises(ValueError):
                self.run_alignment(callback, words)
            callback.assert_not_called()
        for rows in [self.focus[:-1], [*self.focus, self.focus[-1]], self.focus[::-1]]:
            with self.subTest(rows=len(rows)), self.assertRaises(ValueError):
                self.run_alignment(Mock(return_value=rows))

    def test_already_aligned_greeting_does_not_decode_another_prefix(self):
        words = speech(SEGMENTS)
        sound = [(w['start'], w['end']) for w in words]
        callback = Mock()
        self.assertEqual(self.run_alignment(callback, words, sound), align(SEGMENTS, words, 70, sound))
        callback.assert_not_called()
