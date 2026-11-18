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
    ASR_REVISION, CONTRACT, MAX_RECOGNIZED_WORDS, RECOGNITION_TIMEOUT_SECONDS, compare_french_segments,
    measure_final_french_speech, recognize_final_wav, recognize_with_timeout, sha256, verify_phone_context_samples,
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

    def measure_scenes(self, scenes, observations):
        recognized = []
        for scene, words in zip(scenes, observations):
            step = (scene['end'] - scene['start']) / (len(words) + 1)
            for index, observation in enumerate(words, 1):
                word, probability = observation if isinstance(observation, tuple) else (observation, .96)
                start = scene['start'] + step * (index - .2)
                recognized.append((word, start, start + step * .4, probability))
        with TemporaryDirectory() as folder:
            return measure_final_french_speech(
                scenes, self.decoded, {'passed': True, 'lag_samples': 0}, folder,
                lambda _path: recognized,
            )

    def test_exact_full_french_uses_normalized_words_and_keeps_other_speech_out_of_scope(self):
        result = self.measure()
        self.assertEqual(result['contract'], 'tip-v11-fr-final-speech-v2')
        self.assertEqual(CONTRACT, 'tip-v11-fr-final-speech-v2')
        self.assertEqual(result['status'], 'matched')
        self.assertEqual(result['decoded_pcm_sha256'], sha256(self.decoded))
        self.assertEqual(result['excluded_segments'], ['greeting', 'signature'])
        self.assertFalse(result['accent_evaluated'])
        self.assertEqual([row['segment'] for row in result['segments']], ['hook', 'domain', 'phone'])
        for row in result['segments']:
            self.assertEqual(row['status'], 'matched')
            self.assertEqual(row['expected_sha256'], row['observed_sha256'])
            self.assertEqual(row['expected_token_count'], row['observed_token_count'])
            self.assertEqual(row['observed_sha256'], sha256(' '.join(row['observed_words']).encode()))
        self.assertNotIn('Wolof greeting output', json.dumps(result))

    def test_scored_nonsemantic_word_edits_match_but_protected_or_untrusted_edits_fail(self):
        words = self.recognized
        accepted = [
            words[:4] + words[5:],
            words[:4] + [(' et', 3.25, 3.29, .93)] + words[4:],
            words[:3] + [(' fermer', 2.7, 3.2, .93)] + words[4:],
            words[:4] + [(' avant', 3.3, 3.7, .59)] + words[5:],
            words[:4] + [(' слова', 3.25, 3.29, .93)] + words[4:],
        ]
        for sequence in accepted:
            with self.subTest(accepted=sequence):
                self.assertEqual(self.measure(sequence)['status'], 'matched')

        rejected = [
            words[:4] + [(' zéro', 3.3, 3.7, .95)] + words[5:],
            words[:7] + [(' 221', 7.2, 7.5, .92)] + words[8:],
            words[:11] + [(' 48.', 9.3, 10.8, .96)] + words[12:],
        ]
        for sequence in rejected:
            with self.subTest(rejected=sequence):
                result = self.measure(sequence)
                self.assertEqual(result['status'], 'inconclusive')
                self.assertEqual(result['reason'], 'ordered_words_unconfirmed')
        self.assertEqual(self.measure([])['status'], 'inconclusive')

    def test_v2_low_confidence_ordinary_word_spends_one_edit_but_weak_or_protected_words_hold(self):
        long = 'maison durable quartier calme proche ecole transport jardin terrasse securite'.split()
        support = 'dossier complet solide verifie fiable durable conforme utile clair simple rapide exact'.split()
        scenes = [
            {'id': 'hook', 'text': ' '.join(long) + '.', 'start': 0, 'end': 5},
            {'id': 'step1', 'text': ' '.join(support) + '.', 'start': 5, 'end': 10},
        ]
        uncertain = [*long[:4], (long[4], .59), *long[5:]]
        accepted = self.measure_scenes(scenes, [uncertain, support])
        self.assertEqual(accepted['status'], 'matched')
        self.assertIsNone(accepted['segments'][0]['observed_words'][4])
        self.assertNotIn('observed_sha256', accepted['segments'][0])

        short = 'maison quartier calme proche ecole transport'.split()
        short_scenes = [
            {'id': 'hook', 'text': ' '.join(short) + '.', 'start': 0, 'end': 4},
            {'id': 'step1', 'text': ' '.join(support) + '.', 'start': 4, 'end': 9},
        ]
        weak = self.measure_scenes(short_scenes, [[*short[:2], (short[2], .59), *short[3:]], support])
        self.assertEqual(weak['segments'][0]['status'], 'inconclusive')
        self.assertEqual(weak['status'], 'inconclusive')

        protected = 'vous ne signez jamais sans deux controles avant une visite'.split()
        protected_scenes = [
            {'id': 'hook', 'text': ' '.join(protected) + '.', 'start': 0, 'end': 5},
            {'id': 'step1', 'text': ' '.join(support) + '.', 'start': 5, 'end': 10},
        ]
        for index in (1, 3, 4, 5, 8):
            heard = protected.copy()
            heard[index] = (heard[index], .59)
            with self.subTest(protected=protected[index]):
                held = self.measure_scenes(protected_scenes, [heard, support])
                self.assertEqual(held['segments'][0]['status'], 'inconclusive')
                self.assertEqual(held['status'], 'inconclusive')

        ordinary_heard = [*long[:4], ('deux', .59), *long[5:]]
        held = self.measure_scenes(scenes, [ordinary_heard, support])
        self.assertEqual(held['segments'][0]['status'], 'inconclusive',
                         'a weak protected ASR token cannot be hidden as an ordinary null')

    def test_v2_enforces_each_segment_then_the_global_accuracy_without_publishing_scores(self):
        first = 'maison durable quartier calme proche ecole transport jardin terrasse securite'.split()
        second = 'achetez logement fiable avec dossier complet avant toute signature finale'.split()
        scenes = [
            {'id': 'hook', 'text': ' '.join(first) + '.', 'start': 0, 'end': 5},
            {'id': 'step1', 'text': ' '.join(second) + '.', 'start': 5, 'end': 10},
        ]
        one_edit = [*first[:4], 'voisine', *first[5:]]
        matched = self.measure_scenes(scenes, [one_edit, second])
        self.assertEqual(matched['status'], 'matched')
        self.assertEqual(matched['segments'][0]['observed_words'], one_edit)
        self.assertNotIn('accuracy', json.dumps(matched))
        self.assertNotIn('edit', json.dumps(matched))

        two_edits = [*second[:5], 'apres', *second[6:]]
        global_failure = self.measure_scenes(scenes, [one_edit, two_edits])
        self.assertEqual([row['status'] for row in global_failure['segments']], ['matched', 'matched'])
        self.assertEqual(global_failure['status'], 'inconclusive')

        short = 'maison quartier calme proche ecole transport'.split()
        long = 'dossier complet solide verifie fiable durable conforme utile clair simple rapide exact'.split()
        uneven = [
            {'id': 'hook', 'text': ' '.join(short) + '.', 'start': 0, 'end': 4},
            {'id': 'step1', 'text': ' '.join(long) + '.', 'start': 4, 'end': 9},
        ]
        segment_failure = self.measure_scenes(uneven, [[*short[:-1], 'gare'], long])
        self.assertEqual(segment_failure['segments'][0]['status'], 'inconclusive')
        self.assertEqual(segment_failure['status'], 'inconclusive')

    def test_v2_keeps_numeric_and_negation_semantics_exact_at_high_word_accuracy(self):
        expected = 'vous ne signez jamais sans deux controles avant une troisieme visite 2 fois'.split()
        support = 'dossier complet solide verifie fiable durable conforme utile clair simple rapide exact'.split()
        scenes = [
            {'id': 'hook', 'text': ' '.join(expected) + '.', 'start': 0, 'end': 5},
            {'id': 'step1', 'text': ' '.join(support) + '.', 'start': 5, 'end': 10},
        ]
        for index, replacement in [
            (1, 'deja'), (3, 'souvent'), (4, 'avec'), (5, 'trois'),
            (8, 'la'), (9, 'prochaine'), (11, '3'),
        ]:
            changed = expected.copy()
            changed[index] = replacement
            with self.subTest(expected=expected[index], replacement=replacement):
                report = self.measure_scenes(scenes, [changed, support])
                self.assertEqual(report['segments'][0]['status'], 'inconclusive')
                self.assertEqual(report['status'], 'inconclusive')

    def test_v2_allows_one_unprotected_point_omission_only_as_speech_evidence(self):
        domain = 'Retrouvez nous sur notre site jamm immo point com'.split()
        support = 'consultez toujours le dossier complet avant de signer votre achat'.split()
        scenes = [
            {'id': 'domain', 'text': ' '.join(domain) + '.', 'start': 0, 'end': 5},
            {'id': 'contact', 'text': ' '.join(support) + '.', 'start': 5, 'end': 10},
        ]
        heard_domain = [word for word in domain if word != 'point']
        report = self.measure_scenes(scenes, [heard_domain, support])
        self.assertEqual(report['status'], 'matched')
        self.assertEqual(report['segments'][0]['observed_words'], [word.lower() for word in heard_domain])
        self.assertNotIn('website', json.dumps(report), 'the separate exact screen receipt remains authoritative')

        jamimo = [*domain[:5], ('Jamimo', .791), 'com']
        report = self.measure_scenes(scenes, [jamimo, support])
        self.assertEqual(report['status'], 'matched')
        domain_row = report['segments'][0]
        self.assertEqual(domain_row['observed_words'], [
            'retrouvez', 'nous', 'sur', 'notre', 'site', 'jamm', 'immo', 'com',
        ])
        self.assertNotIn('point', domain_row['observed_words'])
        self.assertEqual(domain_row['measurement']['method'], 'fixed_domain_jamimo_phonetic_spelling')
        self.assertTrue(domain_row['measurement']['visible_domain_required'])

        for held_domain in (
            [*domain[:5], ('Jamimo', .599), 'com'],
            ['Consultez', *domain[1:5], ('Jamimo', .9), 'com'],
            [*domain[:5], ('Jamimmo', .9), 'com'],
            [*domain[:5], ('Jamimo', .9), 'fr'],
        ):
            with self.subTest(held_domain=held_domain):
                held = self.measure_scenes(scenes, [held_domain, support])
                self.assertEqual(held['segments'][0]['status'], 'inconclusive')

    def test_v2_bounds_private_observed_words_fail_closed(self):
        segment = {'id': 'hook', 'text': 'conseil utile.', 'start': 0, 'end': 3}
        too_many = [(f'mot{index}', index / 100, index / 100 + .005, .9) for index in range(129)]
        [row] = compare_french_segments([segment], too_many, 0)
        self.assertEqual(row['status'], 'inconclusive')
        self.assertEqual(row['observed_words'], [])

        [row] = compare_french_segments([segment], [('x' * 129, .1, .2, .9)], 0)
        self.assertEqual(row['status'], 'inconclusive')
        self.assertEqual(row['observed_words'], [])

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

    def test_fixed_socials_counts_missing_suivez_once_only_for_one_safe_signature_crossing(self):
        scenes = [
            {'id': 'socials',
             'text': 'Suivez aussi Jamm Immo sur nos réseaux sociaux pour retrouver nos prochains conseils.',
             'start': 0, 'end': 4},
            {'id': 'signature', 'text': 'Jamm Immo ! Kër gu baax, xel mu dal !', 'start': 4, 'end': 6},
        ]
        spoken = 'aussi Jam Imo sur nos réseaux sociaux pour retrouver nos prochains conseils'.split()

        def rows(*, crossing=('Keur', 3.9, 4.3, .91), brand_probability=.82, overlap_brand=False,
                 drop=None, replace=None):
            values = spoken.copy()
            if drop is not None:
                values.pop(drop)
            if replace is not None:
                values[replace[0]] = replace[1]
            result = []
            for index, word in enumerate(values):
                start = .2 + index * .27
                end = start + .18
                probability = brand_probability if word in ('Jam', 'Imo') else .96
                result.append((word, start, end, probability))
            if overlap_brand:
                word, start, _, probability = result[2]
                result[2] = word, result[1][2] - .02, result[1][2] + .2, probability
            if crossing is not None:
                result.append(crossing)
            return result

        [row] = compare_french_segments(scenes, rows(), 0)
        self.assertEqual(row['status'], 'matched')
        self.assertEqual(row['observed_words'], [
            'aussi', 'jamm', 'immo', 'sur', 'nos', 'reseaux', 'sociaux',
            'pour', 'retrouver', 'nos', 'prochains', 'conseils',
        ])
        self.assertEqual(row['measurement']['method'], 'fixed_socials_signature_boundary')
        self.assertEqual(row['expected_token_count'] - len(row['observed_words']), 1)
        self.assertNotIn('keur', row['observed_words'])

        held = [
            rows(crossing=('non', 3.9, 4.3, .91)),
            rows(crossing=('Keur', 3.9, 4.3, .59)),
            rows(brand_probability=.59),
            rows(overlap_brand=True),
            rows(drop=5),
            rows(replace=(3, 'avec')),
            [*rows(), ('mot', 3.95, 4.5, .95)],
        ]
        for recognized in held:
            with self.subTest(recognized=recognized):
                [rejected] = compare_french_segments(scenes, recognized, 0)
                self.assertEqual(rejected['status'], 'inconclusive')
                self.assertEqual(rejected.get('reason'), 'mixed_language_boundary')

        [without_crossing] = compare_french_segments(scenes, rows(crossing=None), 0)
        self.assertEqual(without_crossing['status'], 'inconclusive')
        self.assertNotIn('measurement', without_crossing)

        variable = [{**scenes[0], 'id': 'hook'}, scenes[1]]
        [rejected] = compare_french_segments(variable, rows(), 0)
        self.assertEqual(rejected['status'], 'inconclusive')
        self.assertEqual(rejected['reason'], 'mixed_language_boundary')

    def test_complete_socials_does_not_need_to_certify_an_excluded_wolof_cue(self):
        scenes = [
            {'id': 'socials',
             'text': 'Suivez aussi Jamm Immo sur nos réseaux sociaux pour retrouver nos prochains conseils.',
             'start': 0, 'end': 4},
            {'id': 'signature', 'text': 'À bientôt ! Jamm Immo ! Kër gu baax, xel mu dal !',
             'start': 4, 'end': 6},
        ]
        heard = 'Suivez aussi Jam Imo sur nos réseaux sociaux pour retrouver nos prochains conseils'.split()
        french = [(word, .15 + i * .27, .15 + i * .27 + .18, .65 if word in ('Jam', 'Imo') else .96)
                  for i, word in enumerate(heard)]
        excluded = ('Keur', 3.96, 4.32, .593)
        [row] = compare_french_segments(scenes, [*french, excluded], 0)
        self.assertEqual(row['status'], 'matched')
        self.assertEqual(row['observed_words'], [
            'suivez', 'aussi', 'jamm', 'immo', 'sur', 'nos', 'reseaux', 'sociaux',
            'pour', 'retrouver', 'nos', 'prochains', 'conseils',
        ])
        self.assertNotIn('keur', row['observed_words'])
        self.assertEqual(row['measurement']['method'], 'fixed_socials_complete_before_excluded_cue')
        self.assertFalse(row['measurement']['excluded_cue_used_as_french'])
        self.assertEqual(row['measurement']['excluded_cue_probability_milli'], 593)
        self.assertEqual(row['measurement']['raw_observed_sha256'], sha256(' '.join(word.lower() for word in heard)
                                                                       .replace('réseaux', 'reseaux').encode()))

        cases = {
            'missing French opening': french[1:] + [excluded],
            'missing ordinary French word': french[:7] + french[8:] + [excluded],
            'uncertain French brand': [*french[:2], (*french[2][:3], .599), *french[3:], excluded],
            'uncertain ordinary French word': [*french[:6], (*french[6][:3], .599), *french[7:], excluded],
            'negation crossing': [*french, ('non', *excluded[1:3], .99)],
            'numeric crossing': [*french, ('deux', *excluded[1:3], .99)],
            'second excluded crossing': [*french, excluded, ('xel', 3.98, 4.4, .99)],
            'unbounded excluded span': [*french, ('Keur', 3.9, 4.8, .593)],
            'overlapping actual French ending': [*french[:-1], (french[-1][0], french[-1][1], 3.98, .96), excluded],
            'excluded word assigned to French': [*french, ('Keur', 3.82, 4.1, .593)],
        }
        for label, words in cases.items():
            with self.subTest(label=label):
                [held] = compare_french_segments(scenes, words, 0)
                self.assertEqual(held['status'], 'inconclusive')
                self.assertNotEqual(held.get('measurement', {}).get('method'),
                                    'fixed_socials_complete_before_excluded_cue')

    def test_fixed_brand_spelling_requires_exact_separate_words_and_keeps_original_digest(self):
        services = {'id': 'services', 'text': 'Jamm Immo vous accompagne.', 'start': 0, 'end': 2}
        words = [(' Jam', .04, .38, .85), (' Imo', .38, .64, .62),
                 (' vous', .72, .81, .96), (' accompagne', .86, 1.54, .96)]
        [row] = compare_french_segments([services], words, 0)
        self.assertEqual(row['status'], 'matched')
        self.assertEqual(row['observed_sha256'], row['expected_sha256'])
        self.assertEqual(row['measurement'], {
            'method': 'fixed_jamm_immo_phonetic_spelling',
            'raw_observed_sha256': sha256(b'jam imo vous accompagne'),
        })

        socials = {'id': 'socials', 'text': 'Suivez aussi Jamm Immo sur nos réseaux.', 'start': 0, 'end': 3}
        social_words = [
            (' Suivez', .03, .18, .99), (' aussi', .28, .44, .99),
            (' Jam', .54, .88, .85), (' Imo', .88, 1.14, .62),
            (' sur', 1.22, 1.37, .96), (' nos', 1.4, 1.63, .96), (' réseaux', 1.68, 2.06, .97),
        ]
        self.assertEqual(compare_french_segments([socials], social_words, 0)[0]['status'], 'matched')

        cases = {
            'fused brand': [(' Jamimo', .04, .64, .98), *words[2:]],
            'brand in one recognition row': [(' Jam Imo', .04, .64, .98), *words[2:]],
            'overlapping words': [words[0], (' Imo', .33, .64, .98), *words[2:]],
            'low confidence': [words[0], (' Imo', .38, .64, .599), *words[2:]],
            'partial alias': [words[0], (' Immo', .38, .64, .98), *words[2:]],
            'different name': [(' Jean', .04, .38, .98), *words[1:]],
            'name repeated': [*words, (' Imo', 1.60, 1.8, .98)],
            'missing unrelated word': words[:2] + words[3:],
            'wrong unrelated word': words[:3] + [(' assiste', .86, 1.54, .98)],
        }
        for name, incompatible in cases.items():
            with self.subTest(name=name):
                [rejected] = compare_french_segments([services], incompatible, 0)
                self.assertEqual(rejected['status'], 'inconclusive')
                self.assertNotIn('measurement', rejected)
        [other_scene] = compare_french_segments([{**services, 'id': 'hook'}], words, 0)
        self.assertEqual(other_scene['status'], 'inconclusive')
        [wrong_position] = compare_french_segments([{**socials, 'id': 'services'}], social_words, 0)
        self.assertEqual(wrong_position['status'], 'inconclusive')
        signature = {'id': 'signature', 'text': 'Kër gu baax.', 'start': 3, 'end': 4}
        [mixed_language] = compare_french_segments([socials, signature], [
            *social_words, (' expression', 2.96, 3.22, .93),
        ], 0)
        self.assertEqual(mixed_language['reason'], 'mixed_language_boundary')
        self.assertNotIn('measurement', mixed_language)

    def test_fused_brand_requires_the_entire_confident_timed_socials_line(self):
        socials = {'id': 'socials', 'start': 1, 'end': 5,
                   'text': 'Suivez aussi Jamm Immo sur nos réseaux sociaux pour retrouver nos prochains conseils.'}
        signature = {'id': 'signature', 'start': 5, 'end': 8, 'text': 'À bientôt !'}
        raw = 'suivez aussi Jamimo sur nos réseaux sociaux pour retrouver nos prochains conseils'.split()
        rows = [(word, 1.08 + i * .3, 1.34 + i * .3, .99) for i, word in enumerate(raw)]
        [row] = compare_french_segments([socials, signature], rows, 0)
        expected = 'suivez aussi jamm immo sur nos reseaux sociaux pour retrouver nos prochains conseils'.split()
        self.assertEqual((row['status'], row['observed_words'], row['observed_token_count']),
                         ('matched', expected, 13))
        self.assertEqual(row['expected_sha256'], row['observed_sha256'])
        self.assertEqual(row['measurement'], {
            'method': 'fixed_jamm_immo_phonetic_spelling',
            'raw_observed_sha256': sha256(b'suivez aussi jamimo sur nos reseaux sociaux pour retrouver nos prochains conseils'),
        })

        def change(index, word=None, start=None, end=None, probability=None):
            overrides = (word, start, end, probability)
            updated = tuple(old if new is None else new for old, new in zip(rows[index], overrides))
            return [*rows[:index], updated, *rows[index + 1:]]

        cases = {
            'wrong company': change(2, word='Jamimu'),
            'nonliteral row': change(2, word='@Jamimo'),
            'missing opening word': rows[1:],
            'different context': change(7, word='voir'),
            'additional word': [*rows, ('vite', 4.7, 4.8, .99)],
            'low brand confidence': change(2, probability=.599),
            'low context confidence': change(8, probability=.599),
            'overlapping context rows': change(4, start=rows[3][2] - .01),
            'crosses the opening cut': change(0, start=.99),
            'two words in one row': [('suivez aussi', rows[0][1], rows[1][2], .99), *rows[2:]],
            'ambiguous excluded boundary': [*rows, ('Kër', 4.98, 5.2, .96)],
        }
        for label, observed in cases.items():
            with self.subTest(label=label):
                [held] = compare_french_segments([socials, signature], observed, 0)
                self.assertEqual(held['status'], 'inconclusive')
                self.assertNotIn('measurement', held)
        for scene, observations in [({**socials, 'id': 'services'}, rows),
                                    ({**socials, 'text': socials['text'].replace('aussi ', '')}, [rows[0], *rows[2:]])]:
            with self.subTest(scene=scene):
                [held] = compare_french_segments([scene, signature], observations, 0)
                self.assertEqual(held['status'], 'inconclusive')
                self.assertNotIn('measurement', held)

    def test_centre_ville_spelling_requires_one_confident_row_in_an_exact_french_body_sentence(self):
        greeting = {'id': 'greeting', 'text': 'Salam.', 'start': 0, 'end': 1}
        scene = {'id': 'hook', 'text': 'À Dakar centre ville on vérifie.', 'start': 1, 'end': 5}
        words = [('À', 1.02, 1.20, .99), ('Dakar', 1.20, 1.60, .99),
                 ('-Centreville.', 1.60, 2.10, .836), ('on', 2.3, 2.45, .99), ('vérifie.', 2.5, 3.1, .99)]
        for identifier in ('hook', 'step1', 'step2', 'step3', 'takeaway'):
            [matched] = compare_french_segments([greeting, {**scene, 'id': identifier}], words, 0)
            self.assertEqual(matched['status'], 'matched')
            self.assertEqual(matched['observed_words'], ['a', 'dakar', 'centre', 'ville', 'on', 'verifie'])
            self.assertEqual(matched['measurement'], {
                'method': 'french_centre_ville_spelling', 'raw_observed_sha256': sha256(b'a dakar centreville on verifie'),
            })

        cases = {
            'uncertain compound': (scene, [*words[:2], (*words[2][:3], .59), *words[3:]]),
            'uncertain neighbor': (scene, [(*words[0][:3], .59), *words[1:]]),
            'changed neighbor': (scene, [words[0], ('Lyon', *words[1][1:]), *words[2:]]),
            'missing neighbor': (scene, [words[0], *words[2:]]),
            'overlap': (scene, [*words[:2], (words[2][0], 1.59, *words[2][2:]), *words[3:]]),
            'crosses excluded boundary': (scene, [('À', .98, *words[0][2:]), *words[1:]]),
            'compound shares a row': (scene, [words[0], ('Dakar-Centreville.', 1.20, 2.10, .99), *words[3:]]),
            'unrelated compound': ({**scene, 'text': 'À Dakar sur tout on vérifie.'},
                                   [*words[:2], ('surtout', *words[2][1:]), *words[3:]]),
            'numeric compound': ({**scene, 'text': 'À Dakar vingt huit on vérifie.'},
                                 [*words[:2], ('vingthuit', *words[2][1:]), *words[3:]]),
            'protected neighbor missing': ({**scene, 'text': 'À Dakar centre ville on ne vérifie.'}, words),
            'fixed French scene': ({**scene, 'id': 'socials'}, words),
        }
        for label, (source, observed) in cases.items():
            with self.subTest(label=label):
                [held] = compare_french_segments([greeting, source], observed, 0)
                self.assertEqual(held['status'], 'inconclusive')
                self.assertNotIn('measurement', held)

    def test_services_can_recheck_the_exact_preserved_pcm_when_only_brand_spelling_differs(self):
        services = {'id': 'services', 'text': 'Jamm Immo vous accompagne.', 'start': 0, 'end': 2}
        global_words = [(' Jam', .04, .38, .58), (' Imo', .38, .64, .83),
                        (' vous', .72, .81, .96), (' accompagne', .86, 1.54, .96)]
        cold_words = [(' Jam', .04, .38, .84), *global_words[1:]]
        decoded = b'\x00\x01' * (48000 + 128)
        preservation = {'status': 'matched', 'lag_samples': 128, 'decoded_pcm_sha256': sha256(decoded)}
        with TemporaryDirectory() as directory:
            def recognize_services(path):
                with wave.open(str(path), 'rb') as source:
                    self.assertEqual(source.readframes(source.getnframes()), decoded[256:])
                return cold_words

            def run(whole, focused, evidence=preservation):
                return measure_final_french_speech(
                    [services], decoded, {'passed': True, 'lag_samples': 128}, directory,
                    recognize=lambda _path: whole, preservation=evidence, recognize_services=focused,
                )

            result = run(global_words, recognize_services)
            self.assertEqual(result['status'], 'matched')
            [row] = result['segments']
            self.assertEqual(row['observed_sha256'], row['expected_sha256'])
            self.assertEqual(row['measurement']['method'], 'services_exact_brand_window')
            self.assertEqual(row['measurement']['start_sample'], 128)
            self.assertEqual(row['measurement']['pcm_sha256'], sha256(decoded[256:]))
            self.assertEqual(row['measurement']['window_raw_observed_sha256'],
                             sha256(b'jam imo vous accompagne'))

            for words in (cold_words[:-1], [*cold_words[:3], (' assiste', .86, 1.54, .96)], global_words,
                          [(' Jam Imo', .04, .64, .98), *cold_words[2:]]):
                result = run(global_words, lambda _path: words)
                self.assertEqual(result['status'], 'inconclusive')
            never = Mock(return_value=cold_words)
            self.assertEqual(run(global_words[:-1], never)['status'], 'inconclusive')
            self.assertEqual(run(global_words, never, {**preservation, 'decoded_pcm_sha256': '0' * 64})['status'],
                             'inconclusive')
            self.assertEqual(run(global_words, never, {**preservation, 'lag_samples': 0})['status'], 'inconclusive')
            never.assert_not_called()

    def test_final_hook_recovers_only_the_exact_cut_verified_in_both_signals(self):
        rate, lag = 24_000, 1024
        start, end = 2.52, 9.14
        cut, first, last = round(start * rate), round(start * rate) + lag, round(end * rate) + lag
        hook = 'Vous pouvez acheter à distance en toute sécurité si vous vérifiez chaque étape avant de signer'
        scenes = [
            {**self.segments[0], 'end': start},
            {'id': 'hook', 'text': hook, 'start': start, 'end': end},
            {**self.segments[2], 'start': end, 'end': 11},
        ]
        hook_words = [('Vous', 2.38, 3.44, .98)] + [
            (word, 3.46 + index * .32, 3.7 + index * .32, .97)
            for index, word in enumerate(hook.split()[1:])
        ]
        full = [('salutation', .3, 2.12, .9), *hook_words, ('jamm immo point com', 9.4, 10.8, .97)]
        focused = [(word, .4 + index * .35, .65 + index * .35, .91)
                   for index, word in enumerate(hook.split())]
        narration = [512] * (11 * rate)
        quiet_first, quiet_last = cut - rate // 10, cut + rate // 5
        narration[quiet_first:quiet_last] = [135] * (quiet_last - quiet_first)
        final_samples = [0] * lag + narration
        decoded = struct.pack(f'<{len(final_samples)}h', *final_samples)
        fixture_preservation = {'status': 'matched', 'lag_samples': lag, 'decoded_pcm_sha256': sha256(decoded)}

        with TemporaryDirectory() as folder:
            def read_clip(path):
                with wave.open(str(path), 'rb') as audio:
                    self.assertEqual(audio.readframes(audio.getnframes()), decoded[2 * first:2 * last])
                return focused

            def inspect(reader, words=full, source=narration, pcm=decoded, preservation=fixture_preservation):
                shifted = [(word, start + lag / rate, end + lag / rate, confidence)
                           for word, start, end, confidence in words]
                return measure_final_french_speech(
                    scenes, pcm, {'passed': True, 'lag_samples': lag}, folder, lambda unused: shifted,
                    narration=source, preservation=preservation, recognize_hook=reader,
                )

            recognizer = Mock(side_effect=read_clip)
            report = inspect(recognizer)
            recognizer.assert_called_once()
            self.assertEqual(report['status'], 'matched')
            self.assertFalse(report['accent_evaluated'])
            self.assertEqual(report['segments'][0]['observed_token_count'], 16)
            self.assertEqual(report['segments'][0]['measurement'], {
                'method': 'hook_exact_silence_boundary',
                'start_sample': first, 'end_sample': last, 'pcm_sha256': sha256(decoded[2 * first:2 * last]),
                'source_quiet': {
                    'start_sample': quiet_first, 'cut_sample': cut, 'end_sample': quiet_last,
                    'pcm_sha256': sha256(decoded[2 * (quiet_first + lag):2 * (quiet_last + lag)]),
                },
                'decoded_quiet': {
                    'start_sample': quiet_first + lag, 'cut_sample': first, 'end_sample': quiet_last + lag,
                    'pcm_sha256': sha256(decoded[2 * (quiet_first + lag):2 * (quiet_last + lag)]),
                },
                'global_crossing_source_samples': [round(2.38 * rate), round(3.44 * rate)],
                'global_min_word_probability': .97, 'bounded_min_word_probability': .91,
            })

            # Even an exact high-confidence reconstruction cannot justify cutting phonemes.
            changed_export = decoded[:2 * first] + struct.pack('<h', 8192) + decoded[2 * (first + 1):]
            changed_source = narration.copy()
            changed_source[cut] = 8192
            short_source = narration.copy()
            short_source[quiet_last - rate // 100:quiet_last] = [512] * (rate // 100)
            for changed in (
                {'source': changed_source},
                {'source': short_source},
                {'pcm': changed_export, 'preservation': {**fixture_preservation,
                                                         'decoded_pcm_sha256': sha256(changed_export)}},
                {'preservation': None},
                {'preservation': {**fixture_preservation, 'status': 'inconclusive'}},
                {'preservation': {**fixture_preservation, 'lag_samples': 0}},
                {'preservation': {**fixture_preservation, 'decoded_pcm_sha256': sha256(b'other')}},
                {'words': [full[0], ('Nous', 2.38, 3.44, .98), *full[2:]]},
                {'words': [full[0], ('Vous', 2.38, 3.44, .59), *full[2:]]},
                {'words': [('salutation', .3, 2.54, .9), *full[1:]]},
                {'words': [*full[:-2], ('signer', 8.4, 9.16, .97), full[-1]]},
            ):
                with self.subTest(fields=list(changed)):
                    forbidden = Mock(return_value=focused)
                    held = inspect(forbidden, **changed)
                    forbidden.assert_not_called()
                    self.assertEqual(held['segments'][0]['reason'], 'mixed_language_boundary')

            for changed in (
                focused[1:],
                [('Nous', .4, .65, .98), *focused[1:]],
                [('Vous', .4, .65, .59), *focused[1:]],
                [*focused[:-1], ('signer', 6.1, 6.65, .91)],
            ):
                retry = Mock(return_value=changed)
                held = inspect(retry)
                retry.assert_called_once()
                self.assertEqual(held['segments'][0]['reason'], 'mixed_language_boundary')
                self.assertEqual(held['segments'][1]['status'], 'matched')

            domain_held = inspect(recognizer, words=[*full[:-1], ('jamimo com', 9.4, 10.8, .97)])
            self.assertEqual(domain_held['status'], 'inconclusive')
            self.assertEqual([item['status'] for item in domain_held['segments']], ['matched', 'inconclusive'])

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

    def test_phone_context_requires_actual_confident_number_without_relying_on_later_brand_spelling(self):
        scenes = [
            {'id': 'contact', 'text': 'Vous pouvez nous appeler ou nous écrire sur WhatsApp au même numéro.',
             'start': 0, 'end': 2.9},
            {**self.segments[3], 'start': 2.9, 'end': 8},
            {'id': 'socials',
             'text': 'Suivez aussi Jamm Immo sur nos réseaux sociaux pour retrouver nos prochains conseils.',
             'start': 8, 'end': 13},
        ]
        contact = [(word, .15 + i * .21, .29 + i * .21, .3 if i == 0 else .95)
                   for i, word in enumerate('Vous pouvez nous appeler ou nous écrire sur WhatsApp au même numéro'.split())]
        phone = [('Plus', 3, 3.3, .77), ('221', 3.3, 4.05, .92), ('76', 4.1, 4.85, .93),
                 ('944', 4.9, 6, .94), ('48', 6.05, 6.8, .95), ('49', 6.85, 7.8, .96)]
        social = [(word, 8.05 + i * .25, 8.2 + i * .25, .3 if i == 2 else .96)
                  for i, word in enumerate('Suivez aussi Jean Immo sur nos réseaux sociaux pour retrouver nos prochains conseils'.split())]
        observed = contact + phone + social
        audio = struct.pack('<h', 512) * (13 * 24_000 + 512)
        lag = 512
        with TemporaryDirectory() as folder:
            def inspect(rows, decoded=audio, template=scenes):
                return verify_phone_context_samples(decoded, lag, folder, template, 2.9, 8, lambda path: rows)
            result = inspect(observed)
            self.assertIsNotNone(result)
            self.assertEqual(result['method'], 'phone_exact_contact_context_v1')
            self.assertEqual(result['bounded_min_word_probability'], .77)
            self.assertEqual(result['context_pcm_sha256'], sha256(audio[lag * 2:]))
            self.assertEqual(result['pcm_sha256'], sha256(audio[(3 * 24_000 + lag) * 2:(round(7.8 * 24_000) + lag) * 2]))
            self.assertEqual(result['observed_words'],
                             'plus deux cent vingt et un soixante seize neuf cent quarante quatre quarante huit quarante neuf'.split())

            bad_cases = {
                'changed country code': contact + [phone[0], ('222', *phone[1][1:]), *phone[2:]] + social,
                'reordered last groups': contact + phone[:4] + [('49', *phone[4][1:]), ('48', *phone[5][1:])] + social,
                'missing international prefix': contact + phone[1:] + social,
                'uncertain prefix': contact + [('Plus', *phone[0][1:3], .599), *phone[1:]] + social,
                'uncertain numeric group': contact + phone[:3] + [('944', *phone[3][1:3], .599), *phone[4:]] + social,
                'unconfirmed contact anchor': [('Nous', *contact[0][1:]), *contact[1:]] + phone + social,
                'unconfirmed right anchor': contact + phone + [('Écoutez', *social[0][1:]), *social[1:]],
                'duplicate complete phone': contact + phone + phone + social,
                'zero-length prefix': contact + [('Plus', 3, 3, .99), *phone[1:]] + social,
                'phone outside original range': contact + [('Plus', 3.7, 3.9, .99), *phone[1:]] + social,
                'shared contact/phone row': contact[:-1] + [('numéro Plus', contact[-1][1], 3.3, .99)] + phone[1:] + social,
            }
            for label, rows in bad_cases.items():
                with self.subTest(label=label):
                    self.assertIsNone(inspect(rows))
            silent_prefix = audio[:(3 * 24_000 + lag) * 2] + bytes(round(.3 * 24_000) * 2) + audio[(round(3.3 * 24_000) + lag) * 2:]
            self.assertIsNone(inspect(observed, decoded=silent_prefix))
            self.assertIsNone(inspect(observed, template=[{**scenes[0], 'text': 'Autre phrase.'}, *scenes[1:]]))

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
             patch('audit_tip_v11.measure_audio_preservation', return_value={'status': 'inconclusive'}) as preserve, \
             patch('audit_tip_v11.measure_text', return_value={'passed': True}), \
             patch('audit_tip_v11.measure_final_french_speech', return_value=speech) as measure:
            report = audit(args)
            self.assertTrue(report['passed'])  # Existing waveform/OCR contract is additive.
            self.assertEqual(report['final_french_speech'], speech)
            measure.assert_called_once()
            self.assertEqual(measure.call_args.args[:3], (self.segments, self.decoded, waveform))
            self.assertEqual(measure.call_args.kwargs, {
                'narration': 'different reference bytes', 'preservation': preserve.return_value,
            })
            decoded_input = command.call_args.args[command.call_args.args.index('-i') + 1]
            self.assertEqual(decoded_input, snapshot.call_args.args[1])
            self.assertEqual(Path(decoded_input).name, 'audit.mp4')
            args.measure_final_french = False
            self.assertNotIn('final_french_speech', audit(args))
            measure.assert_called_once()


if __name__ == '__main__':
    unittest.main()
