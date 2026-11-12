"""Measure caption and scene cues from the French V11 narration's word timings."""

import argparse
from array import array
import difflib
import json
import math
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory
import unicodedata
import wave


NUMBER_WORDS = {
    '221': 'deux cent vingt et un',
    '76': 'soixante seize',
    '944': 'neuf cent quarante quatre',
    '48': 'quarante huit',
    '49': 'quarante neuf',
}
ASR_REPO = 'mobiuslabsgmbh/faster-whisper-large-v3-turbo'
ASR_REVISION = '0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf'
SIGNATURE_PREROLL_SECONDS = .10


class SignatureEvidenceError(ValueError):
    def __init__(self, preceding_end):
        super().__init__('Insufficient speech evidence: signature')
        self.preceding_end = preceding_end


def tokens(text):
    plain = ''.join(c for c in unicodedata.normalize('NFKD', text.lower())
                    if not unicodedata.combining(c))
    plain = re.sub(r'\bjam{1,2}\s*im{1,2}o\s*\.\s*com\b', 'jamm immo point com', plain)
    plain = re.sub(r'\bjam{1,2}\s*im{1,2}o\b', 'jamm immo', plain)
    plain = re.sub(r'\bnangadef\b', 'nanga def', plain)
    plain = plain.replace('221769444849', '221 76 944 48 49').replace('+', ' plus ')
    return [word for token in re.findall(r'[a-z0-9]+', plain)
            for word in NUMBER_WORDS.get(token, token).split()]


def caption_lines(text):
    chunks = []
    pending = []
    for word in text.split():
        if pending and (len(' '.join([*pending, word])) > 55 or len(pending) == 9):
            chunks.append(' '.join(pending))
            pending = []
        pending.append(word)
    if pending:
        chunks.append(' '.join(pending))
    return chunks


def audible_windows(pcm, sample_rate):
    samples = array('h')
    samples.frombytes(pcm)
    if sys.byteorder != 'little':
        samples.byteswap()
    window = sample_rate // 10
    for index in range(0, len(samples), window):
        chunk = samples[index:index + window]
        if chunk and sum(sample * sample for sample in chunk) > len(chunk) * 135 ** 2:
            yield (index / sample_rate, min(index + window, len(samples)) / sample_rate)


def align(segments, words, duration, audible=None):
    if not math.isfinite(duration) or not 58.5 <= duration <= 119:
        raise ValueError('V11 narration must fit the 60–120 second master')
    if not words:
        raise ValueError('No French word timestamps')

    actual = []
    stamps = []
    previous = 0
    for index, word in enumerate(words):
        start, end = word['start'], word['end']
        if not all(math.isfinite(v) for v in [start, end]) or not previous <= start <= end <= duration + .1:
            raise ValueError('Invalid narration timestamps')
        previous = start
        recognized = tokens(word['word'])
        if recognized == ['jamm', 'immo'] and index + 1 < len(words) and re.match(r'^\s*\.\s*com\b', words[index + 1]['word'], re.I):
            recognized = [*recognized, 'point']
        for token in recognized:
            actual.append(token)
            stamps.append((start, end))
    sound = stamps if audible is None else audible
    if not stamps or not sound or sound[0][0] > 2.5 or duration - sound[-1][1] > 2.5:
        raise ValueError('V11 narration starts or ends with excessive silence')
    if any(right[0] - left[1] > 3.25 for left, right in zip(sound, sound[1:])):
        raise ValueError('V11 narration contains a long pause')

    groups = [tokens(segment['text']) for segment in segments]
    if any(not group for group in groups):
        raise ValueError('Empty narration segment')
    expected = [token for group in groups for token in group]
    matcher = difflib.SequenceMatcher(None, expected, actual, autojunk=False)
    if matcher.ratio() < .76:
        raise ValueError('French speech differs substantially from the approved script')
    mapping = {block.a + i: block.b + i for block in matcher.get_matching_blocks()
               for i in range(block.size)}

    anchors = []
    phone_groups = []
    preceding_social_end = None
    offset = 0
    for segment, group in zip(segments, groups):
        matched = [mapping[i] for i in range(offset, offset + len(group)) if i in mapping]
        identifier = segment['id']
        coverage = len(matched) / len(group)
        if identifier in ('phone', 'domain'):
            required = group if identifier == 'phone' else tokens('jamm immo point com')
            start = matched[0] if matched else 0
            end = matched[-1] + 1 if matched else 0
            first = next((i for i in range(start, end) if actual[i:i + len(required)] == required), None)
            if first is None:
                raise ValueError(f'Exact contact pronunciation not recognized: {identifier}')
            if identifier == 'phone':
                cursor = first + 1  # skip the separately spoken international prefix “plus”
                for number in NUMBER_WORDS.values():
                    length = len(number.split())
                    phone_groups.append({'start': stamps[cursor][0], 'end': stamps[cursor + length - 1][1]})
                    cursor += length
        elif coverage < (.25 if identifier in ('greeting', 'signature') else .68):
            if identifier == 'signature':
                raise SignatureEvidenceError(preceding_social_end)
            raise ValueError(f'Insufficient speech evidence: {identifier}')
        if not matched:
            raise ValueError(f'No speech anchors: {identifier}')
        preceding_social_end = None
        if identifier == 'socials' and group[-2:] == ['prochains', 'conseils']:
            previous = mapping.get(offset + len(group) - 2)
            last = mapping.get(offset + len(group) - 1)
            if previous is not None and last == previous + 1:
                preceding_social_end = stamps[last][1]
        anchors.append((offset, stamps[matched[0]][0], stamps[matched[-1]][1]))
        offset += len(group)

    duration_in_frames = max(1801, math.ceil((duration + .6) * 30))
    end_of_video = duration_in_frames / 30
    scene_starts = [0, *(max(0, anchor[1] - .08) for anchor in anchors[1:])]
    scene_ends = [*scene_starts[1:], end_of_video]
    timed_segments, captions = [], []
    for segment, anchor, start, end in zip(segments, anchors, scene_starts, scene_ends):
        if end - start < .65:
            raise ValueError(f'Unusable scene timing: {segment["id"]}')
        timed_segments.append({**segment, 'start': start, 'end': end})
        if 'caption' in segment:
            captions.append({'text': segment['caption'], 'start': start, 'end': end})
            continue
        chunks = caption_lines(segment['text'])
        chunk_starts = [start]
        word_index = anchor[0]
        for i, chunk in enumerate(chunks[:-1], 1):
            word_index += len(tokens(chunk))
            measured = mapping.get(word_index)
            estimate = start + (end - start) * i / len(chunks)
            when = stamps[measured][0] if measured is not None else estimate
            chunk_starts.append(min(end - .18 * (len(chunks) - i), max(chunk_starts[-1] + .18, when)))
        for chunk, left, right in zip(chunks, chunk_starts, [*chunk_starts[1:], end]):
            if right - left < .15:
                raise ValueError(f'Unusable caption timing: {segment["id"]}')
            captions.append({'text': chunk, 'start': left, 'end': right})

    return {'segments': timed_segments, 'captions': captions, 'durationInFrames': duration_in_frames,
            'method': 'french-v11-word-anchors', 'reviewRequired': True,
            'phoneGroups': phone_groups,
            'listenFor': ['greeting and signature in Wolof', 'voice and accent']}


def align_with_signature_retry(segments, words, duration, sound, recognize_tail):
    try:
        return align(segments, words, duration, sound)
    except SignatureEvidenceError as error:
        boundary = error.preceding_end
        if boundary is None or not 1.2 <= duration - boundary <= 8 or segments[-1]['id'] != 'signature':
            raise
        voiced_tail = sum(max(0, end - max(start, boundary + .15)) for start, end in sound)
        if voiced_tail < .9:
            raise
        # Keep the original French body and exact contact evidence. A second
        # decode is useful only if the cropped audio supplies a closing anchor.
        tail = [word for word in recognize_tail(boundary)
                if word['start'] >= boundary - SIGNATURE_PREROLL_SECONDS - .001 and word['end'] > boundary + .05]
        closing = tokens(' '.join(word['word'] for word in tail))
        if not any(closing[index:index + 2] in (['a', 'bientot'], ['jamm', 'immo'])
                   for index in range(len(closing) - 1)):
            raise
        original = [word for word in words if word['end'] <= boundary + .001]
        alignment = align(segments, original + tail, duration, sound)
        alignment['method'] = 'french-v11-word-anchors-signature-retry'
        return alignment


def recognize_words(model, wav_path, beam_size, time_offset=0):
    result, _ = model.transcribe(str(wav_path), language='fr', beam_size=beam_size,
                                 word_timestamps=True, condition_on_previous_text=False)
    return [{'word': word.word, 'start': word.start + time_offset, 'end': word.end + time_offset}
            for segment in result for word in segment.words]


def recognize_signature_tail(model, wav_path, boundary):
    with TemporaryDirectory(prefix='tip-v11-signature-') as directory:
        tail_path = str(Path(directory) / 'signature.wav')
        with wave.open(wav_path, 'rb') as source, wave.open(tail_path, 'wb') as target:
            rate = source.getframerate()
            first_frame = max(0, math.floor((boundary - SIGNATURE_PREROLL_SECONDS) * rate))
            source.setpos(first_frame)
            target.setparams(source.getparams())
            target.writeframes(source.readframes(source.getnframes() - first_frame))
        return recognize_words(model, tail_path, beam_size=5, time_offset=first_frame / rate)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--wav', required=True)
    parser.add_argument('--spec', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--transcript', help='Premeasured local QA word timings')
    args = parser.parse_args()
    with open(args.spec, encoding='utf8') as source:
        spec = json.load(source)
    with wave.open(args.wav, 'rb') as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, 24000):
            raise ValueError('Expected 24 kHz mono PCM16')
        duration = wav.getnframes() / wav.getframerate()
        sound = list(audible_windows(wav.readframes(wav.getnframes()), wav.getframerate()))
    if args.transcript:
        with open(args.transcript, encoding='utf8') as source:
            words = json.load(source)
        alignment = align(spec['segments'], words, duration, sound)
    else:
        from faster_whisper import WhisperModel, download_model
        model_path = download_model(ASR_REPO, revision=ASR_REVISION)
        model = WhisperModel(model_path, device='cpu', compute_type='int8',
                             local_files_only=True, cpu_threads=4)
        words = recognize_words(model, args.wav, beam_size=1)
        alignment = align_with_signature_retry(spec['segments'], words, duration, sound,
                                               lambda boundary: recognize_signature_tail(model, args.wav, boundary))
        if alignment['method'] == 'french-v11-word-anchors-signature-retry':
            print('V11 signature recovered by localized speech alignment; manual review still required')
    with open(args.output, 'w', encoding='utf8') as target:
        json.dump(alignment, target, ensure_ascii=False)


if __name__ == '__main__':
    main()
