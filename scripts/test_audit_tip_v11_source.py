import io
from pathlib import Path
import struct
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock
import wave

from audit_tip_v11_speech import ASR_REVISION, SAMPLE_RATE, sha256
from score_tip_source import score_source
from test_align_tip_v11 import SEGMENTS, speech


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

    def run_source(self, rows=None, wav=None):
        if rows is None:
            rows = [(row['word'], row['start'], row['end'], .95) for row in speech(self.plan['segments'])]
        wav = self.wav if wav is None else wav
        with TemporaryDirectory() as folder:
            directory = Path(folder)

            def recognize(path):
                self.assertEqual(path.read_bytes(), wav)
                return rows

            return score_source(self.plan, wav, directory, recognize, Mock(return_value=[]))

    def test_scores_exact_source_with_bound_pcm_draft_and_model(self):
        report = self.run_source()
        self.assertEqual(report['status'], 'matched')
        self.assertEqual(report['contract'], 'tip-v11-fr-source-speech-v1')
        self.assertEqual(report['draft_sha256'], self.plan['draft_sha256'])
        self.assertEqual(report['source_script_sha256'], self.plan['source_script_sha256'])
        self.assertEqual(report['narration_wav_sha256'], sha256(self.wav))
        self.assertEqual(report['decoded_pcm_sha256'], sha256(self.data))
        self.assertEqual(report['model_revision'], ASR_REVISION)
        self.assertEqual(len(report['segments']), 11)
        self.assertEqual(report['excluded_segments'], ['greeting', 'signature'])
        self.assertFalse(report['accent_evaluated'])

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

    def test_domain_alias_requiring_final_video_does_not_qualify_source(self):
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
        self.assertEqual(report['status'], 'inconclusive')
        domain = next(row for row in report['segments'] if row['segment'] == 'domain')
        self.assertEqual(domain['reason'], 'visible_domain_required')
