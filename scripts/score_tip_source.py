"""Score the French words of an exact local V11 narration before video exists."""

from difflib import SequenceMatcher
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
    AlignmentFailure, ASR_REVISION, DEFERRED_DOMAIN_CHECKS, PHONE_WORDS, PhoneEvidenceError,
    SIGNATURE_PREROLL_SECONDS, align_with_phone_retry, alignment_failure_diagnostics, audible_windows, protected_speech,
    supported_anchor_rows, tokens,
)
from audit_tip_v11 import pcm
from audit_tip_v11_speech import (
    EXCLUDED_SEGMENTS, MAX_RECOGNIZED_WORDS, SAMPLE_RATE, SpeechComparisonError, compare_french_segments, french_speech_outcome,
    MIN_WORD_PROBABILITY, POINT_PROTECTED_NAMES, normalized_words, recognize_final_window, recognize_with_timeout,
    sha256, speech_edits, timed_rows_digest, verify_hook_samples, verify_phone_with_context,
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


def phone_gap_allows_remeasurement(segments, words, failure):
    """Bound a possible phone replay without changing the render alignment."""
    if (not isinstance(failure, PhoneEvidenceError) or failure.code != 'phone_gap_unconfirmed'
        or failure.metrics.get('matched_words') != 0):
        return False
    scene_index = failure.metrics.get('segment_index', -1)
    if (not 0 < scene_index < len(segments) - 1 or segments[scene_index - 1]['id'] != 'contact'
        or segments[scene_index + 1]['id'] != 'socials' or tokens(segments[scene_index]['text']) != PHONE_WORDS):
        return False

    groups = [tokens(segment['text']) for segment in segments]
    rows = [tokens(word['word']) for word in words]
    observed = [(token, row_index) for row_index, (row, word) in enumerate(zip(rows, words))
                if word['start'] < word['end'] for token in row]
    expected = [token for group in groups for token in group]
    matcher = SequenceMatcher(None, expected, [token for token, _ in observed], autojunk=False)
    offset = sum(map(len, groups[:scene_index]))
    mapping = {block.a + i: observed[block.b + i][1] for block in matcher.get_matching_blocks() for i in range(block.size)}
    prior = [mapping[i] for i in range(offset - len(groups[scene_index - 1]), offset) if i in mapping]
    after = offset + len(PHONE_WORDS)
    following = [mapping[i] for i in range(after, after + len(groups[scene_index + 1])) if i in mapping]
    if not prior or not following or prior[-1] >= following[0]:
        return False
    # Check even untimed rows that matching discarded. A competing number or
    # negation must keep the take held, regardless of a later recognition.
    return not protected_speech([token for row in rows[prior[-1]:following[0] + 1] for token in row])


EDITORIAL_IDS = ('hook', 'step1', 'step2', 'step3', 'takeaway')
EDITORIAL_METHOD = 'source_editorial_exact_scene_v1'
EDITORIAL_NAMES = POINT_PROTECTED_NAMES | {'com', 'dakar', 'senegal'}


def editorial_protected(words):
    return [w for w in words if w is not None and (w in EDITORIAL_NAMES or protected_speech([w]))]


def confirm_editorial_scene(parts, results, recognized, raw, report, directory, recognize, inspection):
    """An unprompted exact crop can resolve one weak, fully bounded editorial scene."""
    held = [row for row in results if row['status'] != 'matched']
    calls = report['recognizer_diagnostics']
    if (len(held) != 1 or held[0]['segment'] not in EDITORIAL_IDS or 'reason' in held[0] or 'measurement' in held[0]
        or len(calls) >= 12 or any(call['outcome'] != 'completed' for call in calls)):
        return False
    row = held[0]
    parts_by_id = {part['id']: part for part in parts}
    words = {r['segment']: normalized_words(r['segment'], parts_by_id[r['segment']]['text']) for r in results}
    identity = row['segment']
    expected, full = words[identity], row['observed_words']
    errors = speech_edits(expected, full)
    if (len(expected) < 12 or not 25 * len(expected) < 100 * errors <= 40 * len(expected)
        or not full or full.count(None) > 1 or editorial_protected(full) != editorial_protected(expected)):
        return False
    total_errors = sum(speech_edits(words[r['segment']], r['observed_words']) for r in results)
    if 100 * total_errors > 15 * sum(map(len, words.values())):
        return False

    part = parts_by_id[identity]
    first, last = (round(part[edge] * SAMPLE_RATE) for edge in ('start', 'end'))
    if not (0 <= first < last <= len(raw) // 2 and .65 * SAMPLE_RATE <= last - first <= 20 * SAMPLE_RATE):
        return False
    inside = [r for r in recognized if r[1] < part['end'] and r[2] > part['start']]
    original = []
    for text, start, end, probability in inside:
        tokens_here = normalized_words(identity, text)
        if (not part['start'] <= start < end <= part['end'] or not tokens_here or '+' in text
            or (probability < MIN_WORD_PROBABILITY and editorial_protected(tokens_here))):
            return False
        original.extend(tokens_here if probability >= MIN_WORD_PROBABILITY else [None] * len(tokens_here))
    if original != full:
        return False

    clip = raw[2 * first:2 * last]
    path = directory / 'source-editorial-scene.wav'
    with wave.open(str(path), 'wb') as target:
        target.setparams((1, 2, SAMPLE_RATE, 0, 'NONE', 'not compressed'))
        target.writeframes(clip)
    # A failed optional crop leaves the full observation intact and ineligible.
    if inspection is not None:
        inspection.editorial_focus(identity)
    try:
        focused = measured_recognizer(recognize, 'audit_editorial', calls, inspection=inspection, first_sample=first)(path)
        timed = timed_words(focused)
    except (SourceRecognitionError, ValueError):
        return False
    actual = [word for text, *_ in focused for word in normalized_words(identity, text)]
    # Retain the sample bounds used for the voiced-row checks so the Worker can
    # repeat them directly on the bytes it read from private storage.
    if any(not 0 <= a < b <= (last - first) / SAMPLE_RATE for _, a, b, _ in focused):
        return False
    sample_rows = [[text, round(a * SAMPLE_RATE), round(b * SAMPLE_RATE), p] for text, a, b, p in focused]
    for index, (_, a, b, _) in enumerate(sample_rows):
        timed[index].update(start=a / SAMPLE_RATE, end=b / SAMPLE_RATE)
    if (actual != expected or any(len(text) > 300 or not normalized_words(identity, text) or '+' in text for text, *_ in focused)
        or not supported_anchor_rows(timed, list(audible_windows(clip, SAMPLE_RATE)), (last - first) / SAMPLE_RATE)):
        return False
    row.update(status='matched', observed_words=actual, observed_token_count=len(actual), observed_sha256=sha256(' '.join(actual).encode()),
               measurement={'method': EDITORIAL_METHOD, 'full_observed_words': full, 'start_sample': first, 'end_sample': last,
                            'decoded_pcm_sha256': report['decoded_pcm_sha256'], 'pcm_sha256': sha256(clip),
                            'full_raw_timed_rows_sha256': timed_rows_digest(inside), 'focused_rows': sample_rows})
    if inspection is not None:
        inspection.editorial_focus(identity, confirmed=True)
    return True


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

    timed = []
    try:
        if startup is not None:
            measured(lambda _: startup(), 'model_load')(source_path)
        recognized = measured(recognize, 'full_audio', 0)(source_path)
        timed = timed_words(recognized)
        alignment = align_with_phone_retry(
            plan['segments'], timed, duration, sound,
            lambda boundary: alignment_window(boundary - SIGNATURE_PREROLL_SECONDS, stage='alignment_signature'), alignment_window,
            defer_domain=True,
            opening_pcm=raw,
            recognize_greeting=lambda boundary: alignment_window(0, boundary, stage='alignment_greeting'),
        )
        segments = alignment['segments']
        if 'greetingPositionEvidence' in alignment:
            report['greeting_position'] = {'method': alignment['greetingEvidenceMethod'],
                                           **alignment['greetingPositionEvidence']}
    except SourceRecognitionError as error:
        return {**report, 'reason': error.reason}
    except ValueError as error:
        details = alignment_failure_diagnostics(error)
        if phone_gap_allows_remeasurement(plan['segments'], timed, error):
            details['phone_remeasurement_eligible'] = True
        return {**report, **details}
    except Exception:
        return {**report, 'reason': 'recognizer_unavailable'}

    try:
        if inspection is not None:
            inspection.aligned(segments)
        narration = pcm(raw)

        def phone_verifier(start, end, *, full_prefix_samples=None):
            contact = next((s for s in segments if s['id'] == 'contact'), None)
            return verify_phone_with_context(raw, 0, directory, segments, start, end,
                measured(recognize_window, 'audit_phone', round(start * SAMPLE_RATE)),
                recognize_context=measured(recognize_window, 'audit_phone_context',
                                           round(contact['start'] * SAMPLE_RATE) if contact else None),
                full_prefix_samples=full_prefix_samples)

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
            phone_field_scoring=True, ordinary_point_pcm=raw, ordinary_point_wav=source_path, inspection=inspection,
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
    if confirm_editorial_scene(checked_segments, checked_results, recognized, raw, report, directory, recognize_window, inspection):
        report['contract'] = 'tip-v11-fr-source-speech-v3'
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
