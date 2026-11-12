import unittest
from unittest.mock import Mock

from align_tip_v11 import align, align_with_signature_retry, tokens


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


class V11AlignmentTest(unittest.TestCase):
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

    def test_wrong_phone_and_trailing_dead_air_fail(self):
        words = speech(SEGMENTS)
        index = next(i for i, word in enumerate(words) if word['word'] == 'neuf')
        words[index]['word'] = 'sept'
        with self.assertRaisesRegex(ValueError, 'pronunciation.*phone'):
            align(SEGMENTS, words, 70)
        with self.assertRaisesRegex(ValueError, 'excessive silence'):
            align(SEGMENTS, speech(SEGMENTS), 75)

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

        with self.assertRaisesRegex(ValueError, 'Insufficient speech evidence: signature'):
            align_with_signature_retry(SEGMENTS, body + unclear, 70, sound, recognize_tail)
        recognize_tail.assert_called_once()

    def test_no_retry_after_a_short_but_silent_ending(self):
        words = speech(SEGMENTS)
        body = words[:-len(tokens(SEGMENTS[-1]['text']))]
        sound = [(word['start'], word['end']) for word in body]
        recognize_tail = Mock()

        with self.assertRaisesRegex(ValueError, 'Insufficient speech evidence: signature'):
            align_with_signature_retry(SEGMENTS, body, body[-1]['end'] + 2.2, sound, recognize_tail)
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
        with self.assertRaisesRegex(ValueError, 'Insufficient speech evidence: signature'):
            align_with_signature_retry(SEGMENTS, unanchored, 70, sound, recognize_tail)
        recognize_tail.assert_not_called()
