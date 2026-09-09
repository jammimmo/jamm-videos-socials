import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('alignment', Path(__file__).with_name('align-narration.py'))
alignment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(alignment)


class AlignmentTests(unittest.TestCase):
    def setUp(self):
        self.sentences = ['Voici le premier compteur.', 'Photographiez ensuite chaque index.',
                          'Conservez vos preuves ensemble.', 'Comparez les prochaines factures.',
                          'Contactez notre agence demain.']
        self.words = [{'word': t, 'start': i*.9, 'end': i*.9+.5, 'probability': .99}
                      for i, t in enumerate(' '.join(self.sentences).split())]

    def test_audio_word_boundaries_not_silences(self):
        frames = alignment.align(self.sentences, self.words, 20)
        self.assertEqual(frames, [102, 108, 108, 108, 489])
        self.assertEqual(sum(frames), 915)

    def test_missing_sentence_is_rejected(self):
        with self.assertRaises(ValueError):
            alignment.align(self.sentences, self.words[:8]+self.words[12:], 20)

    def test_boundary_must_be_recognized(self):
        self.words[3]['word'] = 'autre'
        with self.assertRaisesRegex(ValueError, 'boundary'):
            alignment.align(self.sentences, self.words, 20)

    def test_low_confidence_and_invalid_timestamps(self):
        self.words[4]['probability'] = .1
        with self.assertRaisesRegex(ValueError, 'confidence'):
            alignment.align(self.sentences, self.words, 20)
        self.words[4]['start'] = float('nan')
        with self.assertRaisesRegex(ValueError, 'timestamps'):
            alignment.align(self.sentences, self.words, 20)

    def test_overlong_audio_is_not_truncated(self):
        with self.assertRaises(ValueError):
            alignment.align(self.sentences, self.words, 31)


if __name__ == '__main__':
    unittest.main()
