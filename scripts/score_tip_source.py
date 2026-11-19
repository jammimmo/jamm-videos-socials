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
    AlignmentFailure, ASR_REVISION, DEFERRED_DOMAIN_CHECKS, SIGNATURE_PREROLL_SECONDS, align_with_phone_retry,
    alignment_failure_diagnostics, audible_windows,
)
from audit_tip_v11 import pcm
from audit_tip_v11_speech import (
    EXCLUDED_SEGMENTS, MAX_RECOGNIZED_WORDS, SAMPLE_RATE, SpeechComparisonError, compare_french_segments, french_speech_outcome,
    recognize_final_window, recognize_with_timeout, sha256, verify_hook_samples, verify_phone_with_context,
    verify_services_samples, verify_untimed_socials_samples,
)
from tip_source_asr_session import SourceAsrSession
from tip_source_inspection import SourceInspection


class SourceRecognitionError(RuntimeError):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def measured_recognizer(recognize, stage, diagnostics, *, inspection=None, first_sample=None):
    """Keep a bounded runtime trace without paths, raw words or diagnostics.

    An unavailable decoder must not be confused with speech differing from
    the script. The exact exception messages and subprocess output remain
    private to the failed call and never enter the source receipt.
    """
    def measured(path):
        if len(diagnostics) >= 12:
            raise SourceRecognitionError('recognizer_call_limit')
        window_duration_ms = 0
        if stage != 'model_load':
            with wave.open(str(path), 'rb') as source:
                window_duration_ms = round(source.getnframes() * 1000 / source.getframerate())
        diagnostic = {'call_index': len(diagnostics) + 1, 'stage': stage,
                      'window_duration_ms': window_duration_ms, 'outcome': 'unavailable'}
        diagnostics.append(diagnostic)
        started = monotonic()
        rows = None
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
            if inspection is not None:
                inspection.call(diagnostic, path, first_sample, rows)
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
    words = []
    for index, row in enumerate(rows):
        if (not isinstance(row, (list, tuple)) or len(row) != 4 or not isinstance(row[0], str)
                or type(row[1]) not in (float, int) or type(row[2]) not in (float, int)):
            raise AlignmentFailure('Invalid recognizer row', 'word_row_invalid', 'recognizer_output_invalid',
                                   row_index=index, row_count=len(rows))
        word, start, end, probability = row
        words.append({'word': word, 'start': start + offset, 'end': end + offset, 'probability': probability})
    return words


def score_source(plan, wav, directory, recognize=None, recognize_window=None, *, inspection_nonce=None, inspection_attempt=1):
    # The production score remains independent of the optional private inspection.
    inspection = (SourceInspection(plan, wav, extract_pcm(wav), inspection_nonce, inspection_attempt)
                  if inspection_nonce is not None else None)
    if recognize is not None or recognize_window is not None:
        report = _score_source(plan, wav, directory, recognize or recognize_with_timeout,
                               recognize_window or recognize_final_window, inspection=inspection)
    else:
        session = SourceAsrSession(directory)
        try:
            report = _score_source(plan, wav, directory, session.recognize, session.recognize_window,
                                   startup=session.start, inspection=inspection)
        finally:
            session.close()
    if inspection is not None:
        report['inspection_evidence'] = inspection.finish(report)
    return report


def _score_source(plan, wav, directory, recognize, recognize_window, *, startup=None, inspection=None):
    raw = inspection.raw if inspection is not None else extract_pcm(wav)
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
        return {**report, 'reason': 'no_audible_source', 'alignment_code': 'no_audible_windows',
                'duration_ms': round(duration * 1000)}
    source_path = directory / 'source.wav'
    source_path.write_bytes(wav)

    def measured(recognizer, stage, first_sample=None):
        return measured_recognizer(recognizer, stage, diagnostics, inspection=inspection, first_sample=first_sample)

    def alignment_window(start, end=duration, *, stage='alignment_phone'):
        first = max(0, math.floor(start * SAMPLE_RATE))
        round_end = math.floor if stage == 'alignment_greeting' else math.ceil
        last = min(len(raw) // 2, round_end(end * SAMPLE_RATE))
        path = directory / 'source-alignment-window.wav'
        with wave.open(str(path), 'wb') as target:
            target.setparams((1, 2, SAMPLE_RATE, 0, 'NONE', 'not compressed'))
            target.writeframes(raw[first * 2:last * 2])
        return timed_words(measured(recognize_window, stage, first)(path), first / SAMPLE_RATE)

    try:
        if startup is not None:
            measured(lambda _: startup(), 'model_load')(source_path)
        recognized = measured(recognize, 'full_audio', 0)(source_path)
        segments = align_with_phone_retry(
            plan['segments'], timed_words(recognized), duration, sound,
            lambda boundary: alignment_window(boundary - SIGNATURE_PREROLL_SECONDS, stage='alignment_signature'), alignment_window,
            defer_domain=True,
            recognize_greeting=lambda boundary: alignment_window(0, boundary, stage='alignment_greeting'),
        )['segments']
    except SourceRecognitionError as error:
        return {**report, 'reason': error.reason}
    except ValueError as error:
        return {**report, **alignment_failure_diagnostics(error)}
    except Exception:
        return {**report, 'reason': 'recognizer_unavailable'}

    try:
        if inspection is not None:
            inspection.aligned(segments)
        narration = pcm(raw)

        def phone_verifier(start, end):
            contact = next((s for s in segments if s['id'] == 'contact'), None)
            return verify_phone_with_context(raw, 0, directory, segments, start, end,
                measured(recognize_window, 'audit_phone', round(start * SAMPLE_RATE)),
                recognize_context=measured(recognize_window, 'audit_phone_context',
                                           round(contact['start'] * SAMPLE_RATE) if contact else None))

        results = compare_french_segments(
            segments, recognized, 0,
            phone_verifier,
            verify_hook=lambda start, end, expected: verify_hook_samples(
                narration, raw, 0, directory, start, end, expected,
                measured(recognize_window, 'audit_hook', round(start * SAMPLE_RATE))),
            verify_services=lambda segment, expected: verify_services_samples(
                raw, 0, directory, segment, expected,
                measured(recognize_window, 'audit_services', round(segment['start'] * SAMPLE_RATE))),
            verify_untimed_socials=lambda rows: verify_untimed_socials_samples(
                raw, 0, directory, segments, rows, source_path,
                measured(recognize_window, 'audit_socials', next(
                    (round(s['start'] * SAMPLE_RATE) for s in segments if s['id'] == 'socials'), None))),
            inspection=inspection,
        )
    except SourceRecognitionError as error:
        return {**report, 'reason': error.reason}
    except SpeechComparisonError as error:
        return {**report, 'reason': 'recognition_or_timing_inconclusive', 'comparison_failure': error.detail}
    except ValueError:
        return {**report, 'reason': 'recognition_or_timing_inconclusive',
                'comparison_failure': {'phase': 'french_comparison', 'predicate': 'unclassified_value_error'}}
    # A source can be admitted to rendering before pixels exist. Do not
    # certify the domain here: final MP4 audio and visible-CTA evidence must
    # pass independently before automatic approval or publication.
    checked_segments = [segment for segment in segments if segment['id'] != 'domain']
    checked_results = [row for row in results if row['segment'] != 'domain']
    return {**report, **french_speech_outcome(checked_segments, checked_results)}


if __name__ == '__main__':
    try:
        nonce, attempt = None, 1
        if len(sys.argv) != 1:
            if len(sys.argv) != 4 or sys.argv[1] != '--inspect-trace':
                raise ValueError('Invalid inspection arguments')
            nonce, attempt = sys.argv[2], int(sys.argv[3])
        plan = json.loads(sys.stdin.buffer.readline(16 * 1024))
        wav = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
        if len(wav) > 8 * 1024 * 1024:
            raise ValueError('Oversized narration')
        with TemporaryDirectory(prefix='jamm-tip-source-speech-') as folder:
            report = score_source(plan, wav, Path(folder), inspection_nonce=nonce, inspection_attempt=attempt)
            print(json.dumps(report, allow_nan=False, separators=(',', ':')))
    except (KeyError, OSError, TypeError, ValueError, wave.Error, EOFError):
        sys.exit(2)
