"""Real AAC replay and independent negatives for fixed URL/onset normalization."""
import json
from pathlib import Path
import unittest

from audit_tip_v11_speech import (
    FIXED_DOMAIN_WORDS, MIN_GLOBAL_ACCURACY_PERCENT, MIN_SEGMENT_ACCURACY_PERCENT, MIN_WORD_PROBABILITY,
    compare_french_segments, fixed_company_domain_notation, normalized_words, socials_onset_without_borrowing,
    speech_edits,
)


FIXTURE = json.loads((Path(__file__).parent / 'fixtures/tip-v11-final-aac-boundaries.json').read_text())


def observations(words, start=45.5, step=.18, confidence=.98):
    return [(word, start + index * step, start + index * step + step * .8, confidence)
            for index, word in enumerate(words)]


class FixedDomainAndSocialOnsetTest(unittest.TestCase):
    domain = next(row for row in FIXTURE['segments'] if row['id'] == 'domain')
    social_scenes = [row for row in FIXTURE['segments'] if row['id'] in ('phone', 'socials', 'signature')]

    def test_literal_company_notation_has_one_mapping_and_keeps_every_uncertain_token(self):
        prefix = ['Retrouvez-nous', 'sur', 'notre', 'site']
        for brand in ('jamimo', 'jammimo', 'jamimmo', 'jammimmo', 'Jam Imo', 'Jamm Immo'):
            for ending in ('.com.', ' point com.'):
                with self.subTest(brand=brand, ending=ending):
                    rows = observations([*prefix, brand + ending])
                    notation = fixed_company_domain_notation(list(FIXED_DOMAIN_WORDS), rows)
                    self.assertEqual(notation['actual'], list(FIXED_DOMAIN_WORDS))
                    self.assertEqual(notation['reported'], list(FIXED_DOMAIN_WORDS))
                    [item] = compare_french_segments([self.domain], rows, 0)
                    self.assertEqual(item['status'], 'matched')
                    self.assertEqual(item['observed_token_count'], 9)
        short = {**self.domain, 'text': 'Jamm Immo point com.', 'start': 5, 'end': 7}
        self.assertEqual(compare_french_segments([short], [(' Jam Imo point com', 5.1, 6.0, .9)], 0)[0]['status'], 'matched')
        raw = FIXTURE['domain_rows']
        unchanged = json.dumps(raw)
        mapped = fixed_company_domain_notation(list(FIXED_DOMAIN_WORDS), raw)
        self.assertEqual(mapped['raw_words'], ['retrouvez', 'nous', 'sur', 'notre', 'site', 'jamimo', 'com'])
        self.assertEqual(mapped['actual'], list(FIXED_DOMAIN_WORDS))
        self.assertEqual(mapped['reported'], ['retrouvez', 'nous', 'sur', 'notre', 'site', None, None, 'point', 'com'])
        self.assertEqual((mapped['raw_uncertain_token_count'], mapped['uncertain_token_count']), (1, 2))
        self.assertEqual(speech_edits(list(FIXED_DOMAIN_WORDS), mapped['reported']), 2)
        [item] = compare_french_segments([self.domain], raw, 0)
        self.assertEqual(item['status'], 'inconclusive')
        self.assertEqual(item['observed_words'], mapped['reported'])
        self.assertEqual(json.dumps(raw), unchanged)
        self.assertEqual((MIN_WORD_PROBABILITY, MIN_SEGMENT_ACCURACY_PERCENT, MIN_GLOBAL_ACCURACY_PERCENT), (.6, 75, 85))

    def test_other_domain_tld_missing_brand_and_suffix_cannot_spend_an_ordinary_edit(self):
        prefix = ['Retrouvez-nous', 'sur', 'notre', 'site']
        rejected = ['Jamm Immo point fr', 'Jamm Immo point net', 'Jamimo.fr', 'autre.com',
                    'diamimo.com', 'JammImmo.com.evil', 'JammImmo.com/evil', 'evil.JammImmo.com',
                    'evil@JammImmo.com', 'evil-JammImmo.com', 'point com', 'Immo point com',
                    'Jamm Immo point com autre']
        for ending in rejected:
            with self.subTest(ending=ending):
                rows = observations([*prefix, ending])
                self.assertIsNone(fixed_company_domain_notation(list(FIXED_DOMAIN_WORDS), rows))
                [item] = compare_french_segments([self.domain], rows, 0)
                self.assertEqual(item['status'], 'inconclusive')
        # A weak URL row expands to four weak tokens; no confidence is made up.
        weak = observations([*prefix, 'JammImmo.com.'])
        weak[-1] = (*weak[-1][:3], .599)
        mapped = fixed_company_domain_notation(list(FIXED_DOMAIN_WORDS), weak)
        self.assertEqual(mapped['reported'][-4:], [None] * 4)
        self.assertEqual(compare_french_segments([self.domain], weak, 0)[0]['status'], 'inconclusive')
        # The earlier archived no-point spelling remains an omission, not an invented dot.
        legacy = observations([*prefix, 'Jamimo', 'com'])
        [item] = compare_french_segments([self.domain], legacy, 0)
        self.assertEqual(item['status'], 'matched')
        self.assertNotIn('point', item['observed_words'])

    def test_fragmented_host_address_and_scheme_separators_are_not_ordinary_insertions(self):
        prefix = ['Retrouvez-nous', 'sur', 'notre', 'site']
        fragments = [
            ['evil.', 'JammImmo.com'], ['evil . JammImmo.com'], ['evil', '.', 'JammImmo.com'],
            ['evil@', 'JammImmo.com'], ['evil', '@', 'Jamm', 'Immo', '.com'],
            ['evil-', 'JammImmo.com'], ['evil', '-', 'JammImmo.com'],
            ['evil/', 'JammImmo.com'], ['evil\\', 'JammImmo.com'],
            ['https://', 'JammImmo.com'], ['https', ':', '/', '/', 'JammImmo.com'],
            ['jamm@', 'immo', 'com'], ['jamm.', 'immo', 'com'], ['jamimo@', 'com'],
        ]
        for tail in fragments:
            with self.subTest(tail=tail):
                rows = observations([*prefix, *tail], step=.1)
                self.assertIsNone(fixed_company_domain_notation(list(FIXED_DOMAIN_WORDS), rows))
                self.assertEqual(compare_french_segments([self.domain], rows, 0)[0]['status'], 'inconclusive')

    def synthetic_complete_phone(self):
        """A unit fixture; explicitly not actual AAC phone boundary evidence."""
        phone = self.social_scenes[0]
        words = normalized_words('phone', phone['text'])
        step = (56.85 - 51.65) / len(words)
        return [(word, 51.65 + index * step, 51.65 + (index + 1) * step, .97)
                for index, word in enumerate(words)]

    def test_real_aac_social_words_cannot_borrow_missing_protected_phone_evidence(self):
        original = json.dumps(FIXTURE)
        result = compare_french_segments(self.social_scenes, FIXTURE['socials_rows'], 0)
        self.assertEqual(result[1]['status'], 'inconclusive')
        # The authorized3s micro-window omitted every protected phone token.
        micro_phone = [row for row in FIXTURE['phone_boundary_rows'] if row[1] < 57.18 and row[2] <= 57.18]
        self.assertEqual(micro_phone, [])
        self.assertIsNone(socials_onset_without_borrowing(self.social_scenes, 1, FIXTURE['socials_rows'][:13], micro_phone))
        self.assertEqual(json.dumps(FIXTURE), original)

    def test_real_in_scene_aac_is_complete_without_moving_any_boundary_or_accepting_jamimu(self):
        original = json.dumps(FIXTURE)
        [_, social] = compare_french_segments(self.social_scenes, FIXTURE['socials_inscene_rows'], 0)
        self.assertEqual(social['status'], 'matched')
        self.assertEqual(social['observed_token_count'], 13)
        self.assertNotIn('onset_boundary', social['measurement'])
        self.assertEqual(social['measurement']['french_min_probability_milli'], 620)
        self.assertIsNone(fixed_company_domain_notation(list(FIXED_DOMAIN_WORDS), FIXTURE['domain_brand_rows']))
        [domain] = compare_french_segments([self.domain], FIXTURE['domain_brand_rows'], 0)
        self.assertEqual(domain['status'], 'inconclusive')
        self.assertEqual(domain['observed_words'], ['site', None, 'com'])
        self.assertEqual(json.dumps(FIXTURE), original)

    def test_bounded_onset_uses_complete_confident_actual_neighbour_words_once(self):
        previous = self.synthetic_complete_phone()
        rows = [*previous, *FIXTURE['socials_rows']]
        [phone, social] = compare_french_segments(self.social_scenes, rows, 0)
        self.assertEqual((phone['status'], social['status']), ('matched', 'matched'))
        self.assertEqual(social['observed_token_count'], 13)
        fence = social['measurement']['onset_boundary']
        self.assertFalse(fence['words_borrowed'])
        self.assertLessEqual(fence['previous_last_end_sample'], fence['observed_first_start_sample'])
        self.assertEqual(fence['nominal_scene_start_sample'] - fence['observed_first_start_sample'], 6720)
        variants = {
            'protected neighbour overlaps': [*previous[:-1], (previous[-1][0], previous[-1][1], 56.95, .97)],
            'protected word missing': previous[:-1],
            'protected word changed': [*previous[:-1], ('huit', *previous[-1][1:])],
            'protected word uncertain': [*previous[:-1], (*previous[-1][:3], .599)],
        }
        for label, invalid in variants.items():
            with self.subTest(label=label):
                [_, held] = compare_french_segments(self.social_scenes, [*invalid, *FIXTURE['socials_rows']], 0)
                self.assertEqual(held['status'], 'inconclusive')
                self.assertNotIn('onset_boundary', held.get('measurement', {}))
        french = list(FIXTURE['socials_rows'][:13])
        for delta in (.751, 1.0):
            shifted = [(french[0][0], 57.18 - delta, french[0][2], french[0][3]), *french[1:]]
            self.assertIsNone(socials_onset_without_borrowing(self.social_scenes, 1, shifted, previous))
        # A numeric first word or an excluded preceding language cannot be reallocated.
        protected = [('deux', *french[0][1:]), *french[1:]]
        self.assertIsNone(socials_onset_without_borrowing(self.social_scenes, 1, protected, previous))
        excluded = [{**self.social_scenes[0], 'id': 'greeting'}, *self.social_scenes[1:]]
        self.assertIsNone(socials_onset_without_borrowing(excluded, 1, french, previous))


if __name__ == '__main__':
    unittest.main()
