"""Align five exact captions to independently transcribed words, never silence count.

This supplies timing only. It does not approve transcription/brand/media review.
"""
import argparse
import difflib
import json
import math
import re
import unicodedata
import wave


def tokens(text):
    plain = ''.join(c for c in unicodedata.normalize('NFKD', text.lower())
                    if not unicodedata.combining(c))
    return re.findall(r'[a-z0-9]+', plain)


def align(sentences, words, duration):
    if len(sentences) != 5 or not 0 < duration <= 30.3:
        raise ValueError('Five sentences within the narration budget required')
    groups = [tokens(s) for s in sentences]
    if any(not g for g in groups):
        raise ValueError('Empty sentence')
    expected = [t for g in groups for t in g]
    actual = []
    timed = []
    previous = 0
    for word in words:
        start, end = word['start'], word['end']
        if not all(math.isfinite(v) for v in [start, end]) or not previous <= start <= end <= duration + .1:
            raise ValueError('Invalid word timestamps')
        previous = start
        for token in tokens(word['word']):
            actual.append(token)
            timed.append(word)
    matcher = difflib.SequenceMatcher(None, expected, actual, autojunk=False)
    if matcher.ratio() < .85:
        raise ValueError('Transcript differs from the exact narration')
    mapping = {}
    for block in matcher.get_matching_blocks():
        for i in range(block.size):
            mapping[block.a + i] = block.b + i
    offset = 0
    cuts = []
    for index, group in enumerate(groups):
        matched = sum(i in mapping for i in range(offset, offset + len(group)))
        if matched / len(group) < .75:
            raise ValueError(f'Sentence {index + 1} not sufficiently recognized')
        offset += len(group)
        if index == 4:
            break
        # Both sides of each boundary must be heard, not inferred by word count.
        if offset - 1 not in mapping or offset not in mapping:
            raise ValueError(f'Sentence boundary {index + 1} not recognized')
        left, right = timed[mapping[offset - 1]], timed[mapping[offset]]
        if min(left.get('probability', 0), right.get('probability', 0)) < .35:
            raise ValueError('Low-confidence boundary')
        if left['end'] > right['start'] + .05:
            raise ValueError('Overlapping sentence boundary')
        cuts.append(round((left['end'] + right['start']) * 15))
    boundaries = [0, *cuts, 915]
    frames = [b-a for a, b in zip(boundaries, boundaries[1:])]
    if any(n < 60 for n in frames):
        raise ValueError('Sentence timeline is ambiguous or too short')
    return frames


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--wav', required=True)
    parser.add_argument('--spec', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    import torch
    import whisper
    torch.set_num_threads(2)
    with open(args.spec, encoding='utf8') as source:
        spec = json.load(source)
    with wave.open(args.wav, 'rb') as wav:
        duration = wav.getnframes() / wav.getframerate()
    if duration > 30.3:
        raise ValueError('Narration exceeds scene budget')
    result = whisper.load_model('base', device='cpu').transcribe(
        args.wav, language='fr', task='transcribe', word_timestamps=True,
        fp16=False, temperature=0, condition_on_previous_text=False, verbose=False)
    words = [w for segment in result['segments'] for w in segment.get('words', [])]
    frames = align([s['voiceoverFr'] for s in spec['scenes']], words, duration)
    with open(args.output, 'w', encoding='utf8') as target:
        json.dump({'sceneFrames': frames, 'transcript': result['text'], 'words': words,
                   'method': 'whisper-base-word-anchors-v1', 'reviewRequired': True}, target)


if __name__ == '__main__':
    main()
