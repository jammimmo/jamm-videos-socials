"""Score the French words of an exact local V11 narration before video exists."""

import io
import json
import math
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import wave

from align_tip_v11 import (
    ASR_REVISION, SIGNATURE_PREROLL_SECONDS, align_with_phone_retry, alignment_failure_diagnostics, audible_windows,
)
from audit_tip_v11 import pcm
from audit_tip_v11_speech import (
    EXCLUDED_SEGMENTS, MAX_RECOGNIZED_WORDS, SAMPLE_RATE, compare_french_segments, french_speech_outcome,
    recognize_final_window, recognize_with_timeout, sha256, verify_hook_samples, verify_phone_samples,
    verify_services_samples,
)


def extract_pcm(wav):
    with wave.open(io.BytesIO(wav), 'rb') as source:
        frames = source.getnframes()
        if (source.getframerate(), source.getnchannels(), source.getsampwidth()) != (SAMPLE_RATE, 1, 2):
            raise ValueError('Expected 24 kHz mono PCM16')
        if not 58.5 * SAMPLE_RATE <= frames <= 119 * SAMPLE_RATE:
            raise ValueError('Unexpected V11 narration duration')
        data = source.readframes(frames)
        if len(data) != frames * 2:
            raise ValueError('Truncated V11 narration')
    return data


def timed_words(rows, offset=0):
    if len(rows) > MAX_RECOGNIZED_WORDS:
        raise ValueError('Too many recognized words')
    return [{'word': word, 'start': start + offset, 'end': end + offset} for word, start, end, _ in rows]


def score_source(plan, wav, directory, recognize=recognize_with_timeout, recognize_window=recognize_final_window):
    raw = extract_pcm(wav)
    duration = len(raw) / (2 * SAMPLE_RATE)
    sound = list(audible_windows(raw, SAMPLE_RATE))
    report = {
        'contract': 'tip-v11-fr-source-speech-v1', 'source': 'normalized_wav_pcm_s16le_mono_24khz',
        'draft_sha256': plan['draft_sha256'], 'source_script_sha256': plan['source_script_sha256'],
        'narration_wav_sha256': sha256(wav), 'decoded_pcm_sha256': sha256(raw), 'model_revision': ASR_REVISION,
        'status': 'inconclusive', 'segments': [], 'excluded_segments': list(EXCLUDED_SEGMENTS),
        'accent_evaluated': False,
    }
    if not sound:
        return {**report, 'reason': 'no_audible_source'}
    source_path = directory / 'source.wav'
    source_path.write_bytes(wav)

    def alignment_window(start, end=duration):
        first = max(0, math.floor(start * SAMPLE_RATE))
        last = min(len(raw) // 2, math.ceil(end * SAMPLE_RATE))
        path = directory / 'source-alignment-window.wav'
        with wave.open(str(path), 'wb') as target:
            target.setparams((1, 2, SAMPLE_RATE, 0, 'NONE', 'not compressed'))
            target.writeframes(raw[first * 2:last * 2])
        return timed_words(recognize_window(path), first / SAMPLE_RATE)

    try:
        recognized = recognize(source_path)
        segments = align_with_phone_retry(
            plan['segments'], timed_words(recognized), duration, sound,
            lambda boundary: alignment_window(boundary - SIGNATURE_PREROLL_SECONDS), alignment_window,
        )['segments']
    except ValueError as error:
        return {**report, **alignment_failure_diagnostics(error)}
    except Exception:
        return {**report, 'reason': 'recognizer_unavailable'}

    try:
        narration = pcm(raw)
        results = compare_french_segments(
            segments, recognized, 0,
            lambda start, end: verify_phone_samples(raw, 0, directory, start, end, recognize_window),
            verify_hook=lambda start, end, expected: verify_hook_samples(
                narration, raw, 0, directory, start, end, expected, recognize_window),
            verify_services=lambda segment, expected: verify_services_samples(
                raw, 0, directory, segment, expected, recognize_window),
        )
    except ValueError:
        return {**report, 'reason': 'recognition_or_timing_inconclusive'}
    # A final-video alias can depend on proven visible information. Source
    # audio alone cannot satisfy that condition, even for known contact text.
    for row in results:
        if row.get('measurement', {}).get('visible_domain_required'):
            row.update(status='inconclusive', reason='visible_domain_required')
    return {**report, **french_speech_outcome(segments, results)}


if __name__ == '__main__':
    try:
        plan = json.loads(sys.stdin.buffer.readline(16 * 1024))
        wav = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
        if len(wav) > 8 * 1024 * 1024:
            raise ValueError('Oversized narration')
        with TemporaryDirectory(prefix='jamm-tip-source-speech-') as folder:
            print(json.dumps(score_source(plan, wav, Path(folder)), allow_nan=False))
    except (KeyError, OSError, TypeError, ValueError, wave.Error, EOFError):
        sys.exit(2)
