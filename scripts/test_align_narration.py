import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('alignment', Path(__file__).with_name('align-narration.py'))
alignment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(alignment)


class AlignmentTests(unittest.TestCase):
    def test_full_scenes_keep_every_sample_and_delay_next_sentence(self):
        frames = [60, 30, 90, 360]
        segments = [bytes([n, n]) * (frames[n-1]*800) for n in range(1,5)]
        full, pcm = alignment.preserve_full_scenes(frames, b''.join(segments))
        self.assertEqual(full, [180,120,180,360])
        cursor = 0
        for original, complete, segment in zip(frames, full, segments):
            self.assertEqual(pcm[cursor:cursor+len(segment)], segment)
            self.assertEqual(pcm[cursor+len(segment):cursor+complete*1600], bytes((complete-original)*1600))
            cursor += complete*1600
        self.assertEqual(len(pcm), sum(full)*1600)

    def test_long_speech_extends_scene_never_truncates(self):
        frames = [240,150,210,400]
        source = bytes([1,2])*sum(frames)*800
        full, pcm = alignment.preserve_full_scenes(frames, source)
        self.assertEqual(full, frames)
        self.assertEqual(pcm, source)
        with self.assertRaisesRegex(ValueError, 'never cut'):
            alignment.preserve_full_scenes([600]*4, b'')

    def test_authored_duration_and_entire_wav_tail_preserved(self):
        frames = [90,90,90,360]
        source = bytes([1,2])*(sum(frames)*800-200)
        full, pcm = alignment.preserve_full_scenes(frames, source, minimums=[210,150,180,400])
        self.assertEqual(full,[210,150,180,400])
        self.assertEqual(pcm.count(bytes([1,2])),len(source)//2)

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

    def test_fresh_outro_does_not_attest_wolof_or_invent_internal_cuts(self):
        lines = self.sentences[:3] + ['Retrouvez-nous chez Jamm Immo. Kër gu baax, xel mu dal.']
        actual = self.sentences[:3] + ['Retrouvez-nous chez Jamm Immo. Quelque chose en wolof.']
        words = [{'word':t,'start':i*.6,'end':i*.6+.4,'probability':.99} for i,t in enumerate(' '.join(actual).split())]
        duration = words[-1]['end']+.2
        frames=alignment.align(lines,words,duration,fresh=True)
        self.assertEqual(len(frames),4)
        self.assertLessEqual(sum(frames)/30-words[-1]['end'],1)
        self.assertGreaterEqual(sum(frames)/30,duration)
        with self.assertRaisesRegex(ValueError,'silence'):
            alignment.align(lines,words,duration+2,fresh=True)
        words[12]['word']='Autre'
        with self.assertRaisesRegex(ValueError,'boundary'):
            alignment.align(lines,words,duration,fresh=True)

    def test_phone_and_domain_numeric_transcripts_normalize(self):
        self.assertEqual(alignment.tokens('+221 76 944 48 49'), alignment.tokens('plus deux cent vingt et un soixante-seize neuf cent quarante-quatre quarante-huit quarante-neuf'))
        self.assertEqual(alignment.tokens('jammimmo.com'), alignment.tokens('jamm immo point com'))


if __name__ == '__main__':
    unittest.main()
