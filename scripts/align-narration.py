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


def preserve_full_scenes(frames, pcm, sample_rate=24000, minimums=(180, 120, 180, 360)):
    """Extend visual slots, inserting silence at verified sentence boundaries.

    Every original PCM sample is retained once, in order, at its original rate.
    The authored visual duration is a floor, never replaced by a short sentence.
    """
    if sample_rate != 24000 or len(pcm) % 2 or len(frames) != 4:
        raise ValueError('Expected four scenes and 24kHz mono PCM16')
    if len(minimums) != 4 or any(type(n) is not int or n < 30 for n in minimums):
        raise ValueError('Invalid authored scene durations')
    if any(type(n) is not int or n < 30 for n in frames):
        raise ValueError('Invalid speech timeline')
    full = [max(a, b) for a, b in zip(frames, minimums)]
    if sum(full) > 1800:
        raise ValueError('Full scenes exceed 60 seconds; revise script, never cut scenes')
    samples_per_frame = sample_rate // 30
    if len(pcm) > sum(frames) * samples_per_frame * 2:
        raise ValueError('Speech extends beyond measured timeline')
    chunks, cursor, source_frame = [], 0, 0
    for original, complete in zip(frames, full):
        source_frame += original
        end = min(source_frame * samples_per_frame * 2, len(pcm))
        segment = pcm[cursor:end]
        chunks.append(segment + bytes(complete * samples_per_frame * 2 - len(segment)))
        cursor = end
    return full, b''.join(chunks)


def tokens(text):
    plain = ''.join(c for c in unicodedata.normalize('NFKD', text.lower())
                    if not unicodedata.combining(c))
    plain = plain.replace('jammimmo.com', 'jamm immo point com').replace('jammimmo', 'jamm immo')
    for number, spoken in [('221', 'deux cent vingt et un'), ('76', 'soixante seize'), ('944', 'neuf cent quarante quatre'), ('48', 'quarante huit'), ('49', 'quarante neuf')]:
        plain = re.sub(r'\b' + number + r'\b', spoken, plain)
    plain = plain.replace('+', ' plus ')
    return re.findall(r'[a-z0-9]+', plain)


def align(sentences, words, duration, fresh=False):
    if len(sentences) != (4 if fresh else 5) or not 0 < duration <= (59.2 if fresh else 30.3):
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
    if not fresh and matcher.ratio() < .85:
        raise ValueError('Transcript differs from the exact narration')
    mapping = {}
    for block in matcher.get_matching_blocks():
        for i in range(block.size):
            mapping[block.a + i] = block.b + i
    offset = 0
    cuts = []
    for index, group in enumerate(groups):
        if fresh and index == 3:
            # Only the start of the unbroken end card is timed. Its French,
            # number, domain and Wolof remain explicit human review items.
            break
        matched = sum(i in mapping for i in range(offset, offset + len(group)))
        if matched / len(group) < .75:
            raise ValueError(f'Sentence {index + 1} not sufficiently recognized')
        offset += len(group)
        if index == len(groups) - 1:
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
    if fresh:
        if not timed:
            raise ValueError('No speech timestamps; human review required')
        last_end = timed[-1]['end']
        # Keep the entire WAV; reject long trailing silence instead of cutting it.
        if duration - last_end > .5:
            raise ValueError('Excess trailing silence: regenerate narration; no audio truncation')
        total = math.ceil((duration + .5) * 30)
        if total / 30 - last_end > 1.04 or total > 1800:
            raise ValueError('Unsafe final-word timing')
    else:
        total = 915
    boundaries = [0, *cuts, total]
    frames = [b-a for a, b in zip(boundaries, boundaries[1:])]
    if any(n < (30 if fresh else 60) for n in frames):
        raise ValueError('Sentence timeline is ambiguous or too short')
    return frames


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--wav', required=True)
    parser.add_argument('--spec', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--padded-wav')
    args = parser.parse_args()
    import torch
    import whisper
    torch.set_num_threads(2)
    with open(args.spec, encoding='utf8') as source:
        spec = json.load(source)
    with wave.open(args.wav, 'rb') as wav:
        duration = wav.getnframes() / wav.getframerate()
    fresh = spec.get('template') == 'spoken-tip-v2'
    if duration > (59.2 if fresh else 30.3):
        raise ValueError('Narration exceeds scene budget')
    result = whisper.load_model('base', device='cpu').transcribe(
        args.wav, language='fr', task='transcribe', word_timestamps=True,
        fp16=False, temperature=0, condition_on_previous_text=False, verbose=False)
    words = [w for segment in result['segments'] for w in segment.get('words', [])]
    try:
        frames = align([s['voiceoverFr'] for s in spec['scenes']], words, duration, fresh=fresh)
        speech_frames = list(frames)
        if fresh:
            if not args.padded_wav:
                raise ValueError('Full-scene narration output required')
            with wave.open(args.wav, 'rb') as source:
                if source.getnchannels() != 1 or source.getsampwidth() != 2:
                    raise ValueError('Expected mono PCM16')
                frames, padded = preserve_full_scenes(frames, source.readframes(source.getnframes()), source.getframerate(),
                    [s.get('durationInFrames', default) for s, default in zip(spec['scenes'], (180,120,180,360))])
            with wave.open(args.padded_wav, 'wb') as target:
                target.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
                target.writeframes(padded)
    except ValueError as error:
        with open(args.output, 'w', encoding='utf8') as target:
            json.dump({'wavDuration': duration, 'transcript': result['text'], 'words': words,
                       'reviewRequired': True, 'alignmentError': str(error)}, target)
        raise
    with open(args.output, 'w', encoding='utf8') as target:
        json.dump({'sceneFrames': frames, 'speechSceneFrames': speech_frames, 'durationInFrames': sum(frames), 'wavDuration': duration, 'transcript': result['text'], 'words': words,
                   'wordTimestampBasis': 'original-unpadded-wav', 'paddedWav': args.padded_wav if fresh else None,
                   'method': 'whisper-base-word-anchors-v1', 'reviewRequired': True,
                   'unverifiedPronunciation': ['Jamm Immo', 'website', 'phone', 'Wolof'] if fresh else []}, target)


if __name__ == '__main__':
    main()
