"""Score the French words of an exact local V11 narration before video exists."""

import io
import json
import math
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from time import monotonic
import wave

from align_tip_v11 import (
    ASR_REVISION, DEFERRED_DOMAIN_CHECKS, SIGNATURE_PREROLL_SECONDS, align_with_phone_retry,
    alignment_failure_diagnostics, audible_windows,
)
from audit_tip_v11 import pcm
from audit_tip_v11_speech import (
    EXCLUDED_SEGMENTS, MAX_RECOGNIZED_WORDS, SAMPLE_RATE, compare_french_segments, french_speech_outcome,
    recognize_final_window, recognize_with_timeout, sha256, verify_hook_samples, verify_phone_samples,
    verify_services_samples,
)


class SourceRecognitionError(RuntimeError):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def measured_recognizer(recognize, stage, diagnostics):
    """Keep a bounded runtime trace without paths, raw words or diagnostics.

    An unavailable decoder must not be confused with speech differing from
    the script. The exact exception messages and subprocess output remain
    private to the failed call and never enter the source receipt.
    """
    def measured(path):
        if len(diagnostics) >= 12:
            raise SourceRecognitionError('recognizer_call_limit')
        with wave.open(str(path), 'rb') as source:
            window_duration_ms = round(source.getnframes() * 1000 / source.getframerate())
        diagnostic = {'call_index': len(diagnostics) + 1, 'stage': stage,
                      'window_duration_ms': window_duration_ms, 'outcome': 'unavailable'}
        diagnostics.append(diagnostic)
        started = monotonic()
        try:
            rows = recognize(path)
            if not isinstance(rows, list) or len(rows) > MAX_RECOGNIZED_WORDS:
                raise SourceRecognitionError('recognizer_output_invalid')
            diagnostic.update(outcome='completed', recognized_row_count=len(rows))
            return rows
        except subprocess.TimeoutExpired:
            diagnostic.update(outcome='timeout', error_class='TimeoutExpired')
            raise SourceRecognitionError('recognizer_timeout') from None
        except subprocess.CalledProcessError as error:
            diagnostic.update(outcome='process_failed', error_class='CalledProcessError')
            if type(error.returncode) is int and -128 <= error.returncode <= 255:
                diagnostic['exit_code'] = error.returncode
            raise SourceRecognitionError('recognizer_process_failed') from None
        except (json.JSONDecodeError, SourceRecognitionError) as error:
            diagnostic.update(outcome='output_invalid', error_class=(
                'JSONDecodeError' if isinstance(error, json.JSONDecodeError) else 'InvalidOutput'))
            raise SourceRecognitionError('recognizer_output_invalid') from None
        except Exception as error:
            diagnostic['error_class'] = next((name for cls, name in (
                (FileNotFoundError, 'FileNotFoundError'), (PermissionError, 'PermissionError'),
                (ModuleNotFoundError, 'ModuleNotFoundError'), (ImportError, 'ImportError'),
                (OSError, 'OSError'), (ValueError, 'ValueError'), (RuntimeError, 'RuntimeError'),
            ) if isinstance(error, cls)), 'Exception')
            raise SourceRecognitionError('recognizer_unavailable') from None
        finally:
            diagnostic['elapsed_ms'] = max(0, min(360_000, round((monotonic() - started) * 1000)))
    return measured


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
    diagnostics = []
    report = {
        'contract': 'tip-v11-fr-source-speech-v2', 'source': 'normalized_wav_pcm_s16le_mono_24khz',
        'draft_sha256': plan['draft_sha256'], 'source_script_sha256': plan['source_script_sha256'],
        'narration_wav_sha256': sha256(wav), 'decoded_pcm_sha256': sha256(raw), 'model_revision': ASR_REVISION,
        'status': 'inconclusive', 'segments': [], 'excluded_segments': list(EXCLUDED_SEGMENTS),
        'deferred_checks': list(DEFERRED_DOMAIN_CHECKS),
        'accent_evaluated': False,
        'recognizer_diagnostics': diagnostics,
    }
    if not sound:
        return {**report, 'reason': 'no_audible_source'}
    source_path = directory / 'source.wav'
    source_path.write_bytes(wav)

    def alignment_window(start, end=duration, *, stage='alignment_phone'):
        first = max(0, math.floor(start * SAMPLE_RATE))
        last = min(len(raw) // 2, math.ceil(end * SAMPLE_RATE))
        path = directory / 'source-alignment-window.wav'
        with wave.open(str(path), 'wb') as target:
            target.setparams((1, 2, SAMPLE_RATE, 0, 'NONE', 'not compressed'))
            target.writeframes(raw[first * 2:last * 2])
        return timed_words(measured_recognizer(recognize_window, stage, diagnostics)(path), first / SAMPLE_RATE)

    try:
        recognized = measured_recognizer(recognize, 'full_audio', diagnostics)(source_path)
        segments = align_with_phone_retry(
            plan['segments'], timed_words(recognized), duration, sound,
            lambda boundary: alignment_window(boundary - SIGNATURE_PREROLL_SECONDS, stage='alignment_signature'), alignment_window,
            defer_domain=True,
        )['segments']
    except SourceRecognitionError as error:
        return {**report, 'reason': error.reason}
    except ValueError as error:
        return {**report, **alignment_failure_diagnostics(error)}
    except Exception:
        return {**report, 'reason': 'recognizer_unavailable'}

    try:
        narration = pcm(raw)
        results = compare_french_segments(
            segments, recognized, 0,
            lambda start, end: verify_phone_samples(raw, 0, directory, start, end,
                measured_recognizer(recognize_window, 'audit_phone', diagnostics)),
            verify_hook=lambda start, end, expected: verify_hook_samples(
                narration, raw, 0, directory, start, end, expected,
                measured_recognizer(recognize_window, 'audit_hook', diagnostics)),
            verify_services=lambda segment, expected: verify_services_samples(
                raw, 0, directory, segment, expected,
                measured_recognizer(recognize_window, 'audit_services', diagnostics)),
        )
    except SourceRecognitionError as error:
        return {**report, 'reason': error.reason}
    except ValueError:
        return {**report, 'reason': 'recognition_or_timing_inconclusive'}
    # A source can be admitted to rendering before pixels exist. Do not
    # certify the domain here: final MP4 audio and visible-CTA evidence must
    # pass independently before automatic approval or publication.
    checked_segments = [segment for segment in segments if segment['id'] != 'domain']
    checked_results = [row for row in results if row['segment'] != 'domain']
    return {**report, **french_speech_outcome(checked_segments, checked_results)}


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
