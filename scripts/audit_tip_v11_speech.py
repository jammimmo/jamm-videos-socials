"""Conservatively compare French speech recognized from the final MP4 audio."""

import hashlib
from itertools import islice
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import unicodedata
import wave

from align_tip_v11 import ASR_REPO, ASR_REVISION, NUMBER_WORDS


CONTRACT = 'tip-v11-fr-final-speech-v1'
SOURCE = 'final_mp4_pcm_s16le_mono_24khz'
SAMPLE_RATE = 24_000
EXCLUDED_SEGMENTS = ('greeting', 'signature')
MAX_RECOGNIZED_WORDS = 500
MIN_WORD_PROBABILITY = .6
RECOGNITION_TIMEOUT_SECONDS = 150


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def normalized_words(segment_id, value):
    """Fold typography with no fuzzy spelling or word substitutions."""
    value = ''.join(char for char in unicodedata.normalize('NFKD', value).casefold()
                    if not unicodedata.combining(char))
    if segment_id == 'domain':
        value = re.sub(r'(?<!\w)jamm\s*immo\s*\.\s*com(?!\w)', 'jamm immo point com', value)
    if segment_id == 'phone':
        value = value.replace('+', ' plus ')
        value = re.sub(r'(?<!\w)221769444849(?!\w)', '221 76 944 48 49', value)
    words = re.findall(r'[^\W_]+', value)
    if segment_id != 'phone':
        return words
    return [word for token in words for word in NUMBER_WORDS.get(token, token).split()]


def recognize_final_wav(wav_path):
    """Only audio goes into the recognizer. The alignment step caches this model."""
    from faster_whisper import WhisperModel, download_model

    path = download_model(ASR_REPO, revision=ASR_REVISION, local_files_only=True)
    model = WhisperModel(path, device='cpu', compute_type='int8', local_files_only=True, cpu_threads=4)
    segments, _ = model.transcribe(
        str(wav_path), language='fr', beam_size=5, word_timestamps=True,
        condition_on_previous_text=False, initial_prompt=None, hotwords=None, vad_filter=False,
    )
    for segment in segments:
        for word in segment.words or ():
            yield word.word, float(word.start), float(word.end), float(word.probability)


def recognize_with_timeout(wav_path):
    # The child receives only the extracted audio path. Its transcript crosses
    # a captured pipe in memory and is never saved to the report or logged.
    completed = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), str(wav_path)],
        capture_output=True, check=True, timeout=RECOGNITION_TIMEOUT_SECONDS,
    )
    return json.loads(completed.stdout)


def words_by_segment(segments, recognized_words, lag_samples):
    observed = [[] for _ in segments]
    low_confidence = set()
    offset = lag_samples / SAMPLE_RATE
    previous = 0
    index = 0
    for number, (text, start, end, probability) in enumerate(recognized_words, 1):
        if number > MAX_RECOGNIZED_WORDS or not isinstance(text, str) or not 1 <= len(text) <= 300:
            raise ValueError('malformed or excessive recognized words')
        if not all(type(value) in (int, float) and math.isfinite(value) for value in (start, end, probability)):
            raise ValueError('invalid speech timestamps or confidence')
        if not previous <= start < end <= segments[-1]['end'] + abs(offset) + .12 or not 0 <= probability <= 1:
            raise ValueError('unexpected speech timestamps or confidence')
        previous = start
        if not normalized_words('', text):
            continue
        start, end = start - offset, end - offset
        middle = (start + end) / 2
        while index + 1 < len(segments) and middle >= segments[index]['end']:
            index += 1
        segment = segments[index]
        excluded = segment['id'] in EXCLUDED_SEGMENTS
        # Scene boundaries are approximate. Do not silently hide a French word
        # that straddles an unverified greeting or sign-off.
        in_other_scope = any(
            part['start'] < end and start < part['end'] and (part['id'] in EXCLUDED_SEGMENTS) != excluded
            for part in segments
        )
        if not segment['start'] <= middle < segment['end'] or in_other_scope:
            raise ValueError('recognized word ambiguous at a scene boundary')
        if not excluded:
            observed[index].append(text.strip())
            if probability < MIN_WORD_PROBABILITY:
                low_confidence.add(index)
    return observed, low_confidence


def compare_french_segments(segments, recognized_words, lag_samples):
    observed, low_confidence = words_by_segment(segments, recognized_words, lag_samples)
    results = []
    for index, segment in enumerate(segments):
        identity = segment['id']
        if identity in EXCLUDED_SEGMENTS:
            continue
        expected = normalized_words(identity, segment['text'])
        actual = normalized_words(identity, ' '.join(observed[index]))
        matched = bool(expected) and actual == expected and index not in low_confidence
        results.append({'segment': identity, 'status': 'matched' if matched else 'inconclusive',
                        'expected_token_count': len(expected), 'observed_token_count': len(actual),
                        'expected_sha256': sha256(' '.join(expected).encode()),
                        'observed_sha256': sha256(' '.join(actual).encode())})
    return results


def measure_final_french_speech(segments, decoded_pcm, waveform, directory, recognize=recognize_with_timeout):
    result = {'contract': CONTRACT, 'source': SOURCE, 'status': 'inconclusive',
              'model_revision': ASR_REVISION, 'decoded_pcm_sha256': sha256(decoded_pcm),
              'excluded_segments': list(EXCLUDED_SEGMENTS), 'accent_evaluated': False, 'segments': []}
    if not waveform['passed']:
        return {**result, 'reason': 'waveform_unconfirmed'}
    wav_path = Path(directory) / 'decoded-final-speech.wav'
    try:
        with wave.open(str(wav_path), 'wb') as output:
            output.setparams((1, 2, SAMPLE_RATE, 0, 'NONE', 'not compressed'))
            output.writeframes(decoded_pcm)
        results = compare_french_segments(segments, recognize(wav_path), waveform['lag_samples'])
    except ValueError:
        return {**result, 'reason': 'recognition_or_timing_inconclusive'}
    except Exception:
        # Model/cache/inference failure must preserve the prior audit, without
        # including provider diagnostics, spoken text or local paths in it.
        return {**result, 'reason': 'recognizer_unavailable'}
    if not results or any(item['status'] != 'matched' for item in results):
        return {**result, 'reason': 'ordered_words_unconfirmed', 'segments': results}
    return {**result, 'status': 'matched', 'segments': results}


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('expected one WAV path')
        words = list(islice(recognize_final_wav(sys.argv[1]), MAX_RECOGNIZED_WORDS + 1))
        if any(not isinstance(word[0], str) or len(word[0]) > 300 for word in words):
            raise ValueError('invalid recognized word length')
        json.dump(words, sys.stdout, allow_nan=False, ensure_ascii=False)
    except Exception:
        sys.exit(2)
