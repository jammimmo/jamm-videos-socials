import unittest

from align_tip_v11 import align, tokens


SEGMENTS = [
    {'id': 'greeting', 'text': 'Salam alikoum ! Nanga def ?'},
    *[{'id': identifier, 'text': text} for identifier, text in zip(
        ('hook', 'step1', 'step2', 'step3', 'takeaway', 'services', 'tools', 'contact', 'socials'),
        (
            'Le choix du logement commence par des observations utiles pendant la visite.',
            'Préparez les points importants avant votre arrivée et gardez vos questions sous la main.',
            'Comparez ce que vous voyez sur place avec les informations déjà communiquées.',
            'Prenez des notes sur ce qui mérite une confirmation après votre visite.',
            'Relisez vos observations tranquillement pour choisir le logement qui vous convient.',
            'Jamm Immo accompagne votre achat, votre vente et la gestion locative.',
            'Les simulations de rentabilité et de frais acquisition sont disponibles en ligne.',
            'Vous pouvez nous appeler ou écrire sur WhatsApp pour poser vos questions.',
            'Retrouvez Jamm Immo sur nos réseaux sociaux pour découvrir les prochains conseils.',
        ))],
    {'id': 'domain', 'text': 'Retrouvez notre site jamm immo point com.', 'caption': 'jammimmo.com'},
    {'id': 'phone', 'text': 'Plus deux cent vingt et un, soixante-seize, neuf cent quarante-quatre, quarante-huit, quarante-neuf.',
     'caption': '+221 76 944 48 49'},
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
