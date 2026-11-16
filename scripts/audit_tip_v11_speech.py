"""Conservatively compare French speech recognized from the final MP4 audio."""

import hashlib
from itertools import islice
import json
import math
from pathlib import Path
import re
import struct
import subprocess
import sys
import unicodedata
import wave

from align_tip_v11 import (
    ASR_REPO, ASR_REVISION, NUMBER_WORDS, PHONE_WORDS, audible_windows, has_audible_narration, voiced_overlap,
)


CONTRACT = 'tip-v11-fr-final-speech-v1'
SOURCE = 'final_mp4_pcm_s16le_mono_24khz'
SAMPLE_RATE = 24_000
EXCLUDED_SEGMENTS = ('greeting', 'signature')
MAX_RECOGNIZED_WORDS = 500
MIN_WORD_PROBABILITY = .6
# The ordinary cut still owns every word outside this window. A pair can
# recover a displaced cut of at most the 1.1 seconds observed in the MP4,
# plus a small allowance for differences in word timestamps.
MAX_FRENCH_BOUNDARY_SHIFT_SECONDS = 1.25
RECOGNITION_TIMEOUT_SECONDS = 150
LOCAL_SPEECH_WINDOW_TIMEOUT_SECONDS = 45
MAX_PHONE_EDGE_SHIFT_SECONDS = .75
MIN_PHONE_WORD_AUDIBLE_SECONDS = .05
HOOK_QUIET_WINDOW = SAMPLE_RATE // 100
HOOK_QUIET_MIN_SIDE = SAMPLE_RATE // 10
HOOK_QUIET_MIN_TOTAL = SAMPLE_RATE * 3 // 10
FIXED_BRAND_WORD_INDEX = {'services': 0, 'socials': 2}


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


def recognize_with_timeout(wav_path, timeout=RECOGNITION_TIMEOUT_SECONDS):
    # The child receives only the extracted audio path. Its transcript crosses
    # a captured pipe in memory and is never saved to the report or logged.
    completed = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), str(wav_path)],
        capture_output=True, check=True, timeout=timeout,
    )
    return json.loads(completed.stdout)


def words_by_segment(segments, recognized_words, lag_samples, *, opening_hook=None, hook_crossings=None):
    observed = [[] for _ in segments]
    ambiguous_boundary = set()
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
        text = text.strip()
        spoken_plus = text == '+'
        if not spoken_plus and not normalized_words('', text):
            continue
        start, end = start - offset, end - offset
        row = (text, start, end, probability)
        if opening_hook and (start < opening_hook['start'] < end or start < opening_hook['end'] < end):
            hook_crossings.append(row)
        middle = (start + end) / 2
        while index + 1 < len(segments) and middle >= segments[index]['end']:
            index += 1
        segment = segments[index]
        excluded = segment['id'] in EXCLUDED_SEGMENTS
        if not segment['start'] <= middle < segment['end']:
            raise ValueError('recognized word ambiguous at a scene boundary')
        # A word spanning verified and excluded speech blocks acceptance.
        # Keep the measurements for French scenes that the word did not touch.
        overlaps = [i for i, part in enumerate(segments) if part['start'] < end and start < part['end']]
        if any((segments[i]['id'] in EXCLUDED_SEGMENTS) != excluded for i in overlaps):
            ambiguous_boundary.update(i for i in overlaps if segments[i]['id'] not in EXCLUDED_SEGMENTS)
        if not excluded and (not spoken_plus or segment['id'] == 'phone'):
            observed[index].append(row)
    return observed, ambiguous_boundary


def segment_words(identity, words):
    return normalized_words(identity, ' '.join(word[0] for word in words))


def fixed_brand_alias_index(identity, expected, actual):
    index = FIXED_BRAND_WORD_INDEX.get(identity)
    if (index is not None and expected[index:index + 2] == ['jamm', 'immo']
        and actual[index:index + 2] == ['jam', 'imo']
        and actual[:index] == expected[:index] and actual[index + 2:] == expected[index + 2:]):
        return index
    return None


def canonical_fixed_brand_words(identity, expected, actual, rows):
    """Allow the observed phonetic spelling only in the two fixed French lines."""
    index = fixed_brand_alias_index(identity, expected, actual)
    if index is None or len(rows) != len(actual):
        return actual
    first, second = rows[index:index + 2]
    if (normalized_words('', first[0]) != ['jam'] or normalized_words('', second[0]) != ['imo']
        or first[2] > second[1] or min(first[3], second[3]) < MIN_WORD_PROBABILITY):
        return actual
    return actual[:index] + ['jamm', 'immo'] + actual[index + 2:]


def exact_adjacent_split(left, right, rows, original_split, expected_left, expected_right):
    if abs(left['end'] - right['start']) > .001 or not rows:
        return None
    if any(word[0] == '+' or word[3] < MIN_WORD_PROBABILITY for word in rows):
        return None
    if any(previous[2] > following[1] for previous, following in zip(rows, rows[1:])):
        return None
    boundary = right['start']
    matches = []
    for split in range(1, len(rows)):
        if split == original_split:
            continue
        moved = rows[min(split, original_split):max(split, original_split)]
        if any(word[1] < boundary - MAX_FRENCH_BOUNDARY_SHIFT_SECONDS
               or word[2] > boundary + MAX_FRENCH_BOUNDARY_SHIFT_SECONDS for word in moved):
            continue
        if (segment_words(left['id'], rows[:split]) == expected_left
            and segment_words(right['id'], rows[split:]) == expected_right):
            matches.append(split)
    return matches[0] if len(matches) == 1 else None


def anchored_phone_range(segments, expected_words, observed, index):
    if (not 0 < index < len(segments) - 1
        or [part['id'] for part in segments[index - 1:index + 2]] != ['contact', 'phone', 'socials']
        or expected_words[index] != PHONE_WORDS):
        return None
    left = observed[index - 1]
    right_start = expected_words[index + 1][:2]
    if (not left or segment_words('contact', left) != expected_words[index - 1]
        or any(word[3] < MIN_WORD_PROBABILITY for word in left) or len(right_start) != 2):
        return None
    rows = observed[index] + observed[index + 1]
    start = left[-1][2]
    phone = segments[index]
    if abs(start - phone['start']) > MAX_PHONE_EDGE_SHIFT_SECONDS:
        return None
    windows = []
    for pivot in range(1, len(rows)):
        end = rows[pivot][1]
        if not 4 <= end - start <= 8 or abs(end - phone['end']) > MAX_PHONE_EDGE_SHIFT_SECONDS:
            continue
        anchor = rows[pivot:pivot + 2]
        if (segment_words('socials', anchor)[:2] != right_start
            or any(word[3] < MIN_WORD_PROBABILITY for word in anchor)
            or segment_words('phone', rows[:pivot]) != PHONE_WORDS):
            continue
        # No ASR word may be trimmed out or assigned twice in the retry.
        timed = [left[-1], *rows[:pivot + len(anchor)]]
        if any(before[2] > after[1] for before, after in zip(timed, timed[1:])):
            continue
        windows.append((start, end))
    return windows[0] if len(windows) == 1 else None


def compare_french_segments(segments, recognized_words, lag_samples, verify_phone=None, *, verify_hook=None,
                            verify_services=None):
    opening_hook = None
    if (verify_hook and len(segments) > 2 and [part['id'] for part in segments[:2]] == ['greeting', 'hook']
        and segments[0]['end'] == segments[1]['start'] and segments[1]['end'] == segments[2]['start']):
        opening_hook = segments[1]
    hook_crossings = []
    observed, ambiguous_boundary = words_by_segment(
        segments, recognized_words, lag_samples, opening_hook=opening_hook, hook_crossings=hook_crossings,
    )
    expected_words = [normalized_words(segment['id'], segment['text']) for segment in segments]
    actual_words = [segment_words(segment['id'], words) for segment, words in zip(segments, observed)]
    # Keep each ASR row in exactly one report. Two proposed changes that
    # would share a scene are ambiguous, so neither changes the observation.
    repairs = {}
    for index, (left, right) in enumerate(zip(segments, segments[1:])):
        following = index + 1
        if (left['id'] in EXCLUDED_SEGMENTS or right['id'] in EXCLUDED_SEGMENTS
            or index in ambiguous_boundary or following in ambiguous_boundary
            or not expected_words[index] or not expected_words[following]
            or actual_words[index] == expected_words[index] or actual_words[following] == expected_words[following]):
            continue
        rows = observed[index] + observed[following]
        split = exact_adjacent_split(left, right, rows, len(observed[index]),
                                     expected_words[index], expected_words[following])
        if split is not None:
            repairs[index] = (rows[:split], rows[split:])
    for index, (left, right) in repairs.items():
        if index - 1 not in repairs and index + 1 not in repairs:
            observed[index:index + 2] = [left, right]
    results = []
    for index, segment in enumerate(segments):
        identity = segment['id']
        if identity in EXCLUDED_SEGMENTS:
            continue
        expected = expected_words[index]
        raw_actual = segment_words(identity, observed[index])
        actual = raw_actual if index in ambiguous_boundary else canonical_fixed_brand_words(
            identity, expected, raw_actual, observed[index],
        )
        # A standalone sign can be numeric formatting. It needs the focused
        # phone check and acoustic evidence before it can count as speech.
        exact = (bool(expected) and actual == expected
                 and all(word[0] != '+' and word[3] >= MIN_WORD_PROBABILITY for word in observed[index]))
        matched = exact and index not in ambiguous_boundary
        item = {'segment': identity, 'status': 'matched' if matched else 'inconclusive',
                'expected_token_count': len(expected), 'observed_token_count': len(actual),
                'expected_sha256': sha256(' '.join(expected).encode()),
                'observed_sha256': sha256(' '.join(actual).encode())}
        if matched and actual != raw_actual:
            item['measurement'] = {
                'method': 'fixed_jamm_immo_phonetic_spelling',
                'raw_observed_sha256': sha256(' '.join(raw_actual).encode()),
            }
        if index in ambiguous_boundary:
            item['reason'] = 'mixed_language_boundary'
            rows = observed[index]
            if (segment is opening_hook and exact and hook_crossings == rows[:1]
                and rows[0][1] < segment['start'] < rows[0][2] <= segment['end']
                and normalized_words('hook', rows[0][0]) == expected[:1]):
                measurement = verify_hook(segment['start'], segment['end'], expected)
                if measurement:
                    item.pop('reason')
                    item.update(status='matched', measurement={
                        **measurement, 'global_min_word_probability': min(row[3] for row in rows),
                        'global_crossing_source_samples': [round(point * SAMPLE_RATE) for point in rows[0][1:3]],
                    })
        elif not matched and identity == 'phone' and verify_phone:
            window = anchored_phone_range(segments, expected_words, observed, index)
            measurement = verify_phone(*window) if window else None
            if measurement:
                item.update(status='matched', observed_sha256=item['expected_sha256'],
                            observed_token_count=len(expected), measurement=measurement)
        elif not matched and identity == 'services' and verify_services:
            if fixed_brand_alias_index(identity, expected, raw_actual) is not None:
                confirmed = verify_services(segment, expected)
                if confirmed:
                    verified_words, measurement = confirmed
                    item.update(status='matched', observed_sha256=sha256(' '.join(verified_words).encode()),
                                observed_token_count=len(verified_words), measurement={
                                    **measurement, 'raw_observed_sha256': sha256(' '.join(raw_actual).encode()),
                                })
        results.append(item)
    return results


def quiet_hook_cut(samples, cut):
    """Measure contiguous 10 ms windows on both sides of the certified cut."""
    if not 0 < cut < len(samples):
        return None
    start = end = cut
    while start - HOOK_QUIET_WINDOW >= max(0, cut - SAMPLE_RATE):
        if has_audible_narration(samples[start - HOOK_QUIET_WINDOW:start]):
            break
        start -= HOOK_QUIET_WINDOW
    while end + HOOK_QUIET_WINDOW <= min(len(samples), cut + SAMPLE_RATE):
        if has_audible_narration(samples[end:end + HOOK_QUIET_WINDOW]):
            break
        end += HOOK_QUIET_WINDOW
    if min(cut - start, end - cut) < HOOK_QUIET_MIN_SIDE or end - start < HOOK_QUIET_MIN_TOTAL:
        return None
    return {
        'start_sample': start, 'cut_sample': cut, 'end_sample': end,
        'pcm_sha256': sha256(struct.pack(f'<{end - start}h', *samples[start:end])),
    }


def recognize_final_window(wav_path):
    return recognize_with_timeout(wav_path, LOCAL_SPEECH_WINDOW_TIMEOUT_SECONDS)


def verify_hook_samples(narration, decoded_pcm, lag_samples, directory, start, end, expected, recognize):
    source_cut = round(start * SAMPLE_RATE)
    first, last = source_cut + lag_samples, round(end * SAMPLE_RATE) + lag_samples
    if not 0 <= first < last <= len(decoded_pcm) // 2:
        return None
    source_quiet = quiet_hook_cut(narration, source_cut)
    if source_quiet is None:
        return None
    # Decode at most one second per side to attest the final cut at the same lag.
    probe_start = max(0, first - SAMPLE_RATE)
    probe_end = min(len(decoded_pcm) // 2, first + SAMPLE_RATE)
    probe = struct.unpack(f'<{probe_end - probe_start}h', decoded_pcm[probe_start * 2:probe_end * 2])
    final_quiet = quiet_hook_cut(probe, first - probe_start)
    if final_quiet is None:
        return None
    for field in ('start_sample', 'cut_sample', 'end_sample'):
        final_quiet[field] += probe_start
    clip = decoded_pcm[first * 2:last * 2]
    path = Path(directory) / 'decoded-final-hook.wav'
    try:
        with wave.open(str(path), 'wb') as output:
            output.setparams((1, 2, SAMPLE_RATE, 0, 'NONE', 'not compressed'))
            output.writeframes(clip)
        duration = (last - first) / SAMPLE_RATE
        [rows], _ = words_by_segment([{'id': 'hook', 'start': 0, 'end': duration}], recognize(path), 0)
        if (segment_words('hook', rows) != expected
            or any(row[2] > duration or row[3] < MIN_WORD_PROBABILITY for row in rows)):
            return None
    except Exception:
        return None
    return {
        'method': 'hook_exact_silence_boundary', 'start_sample': first, 'end_sample': last,
        'pcm_sha256': sha256(clip), 'source_quiet': source_quiet, 'decoded_quiet': final_quiet,
        'bounded_min_word_probability': min(row[3] for row in rows),
    }


def verify_phone_samples(decoded_pcm, lag_samples, directory, start, end, recognize):
    first, last = (round(point * SAMPLE_RATE) + lag_samples for point in (start, end))
    if not 0 <= first < last <= len(decoded_pcm) // 2:
        return None
    clip = decoded_pcm[first * 2:last * 2]
    sound = list(audible_windows(clip, SAMPLE_RATE))
    if not sound:
        return None
    path = Path(directory) / 'decoded-final-phone.wav'
    try:
        with wave.open(str(path), 'wb') as output:
            output.setparams((1, 2, SAMPLE_RATE, 0, 'NONE', 'not compressed'))
            output.writeframes(clip)
        duration = (last - first) / SAMPLE_RATE
        [observed], _ = words_by_segment([{'id': 'phone', 'start': 0, 'end': duration}], recognize(path), 0)
        if (segment_words('phone', observed) != PHONE_WORDS
            or any(word[2] > duration or word[3] < MIN_WORD_PROBABILITY for word in observed)
            or any(voiced_overlap(sound, word[1], word[2]) < MIN_PHONE_WORD_AUDIBLE_SECONDS for word in observed)
            or any(left[2] > right[1] for left, right in zip(observed, observed[1:]))):
            return None
    except Exception:
        return None
    return {'method': 'phone_exact_neighbor_window', 'start_sample': first, 'end_sample': last,
            'pcm_sha256': sha256(clip)}


def verify_services_samples(decoded_pcm, lag_samples, directory, segment, expected, recognize):
    first, last = (round(segment[edge] * SAMPLE_RATE) + lag_samples for edge in ('start', 'end'))
    if not 0 <= first < last <= len(decoded_pcm) // 2:
        return None
    clip = decoded_pcm[first * 2:last * 2]
    path = Path(directory) / 'decoded-final-services.wav'
    measured_segment = {**segment, 'start': 0, 'end': (last - first) / SAMPLE_RATE}
    try:
        with wave.open(str(path), 'wb') as output:
            output.setparams((1, 2, SAMPLE_RATE, 0, 'NONE', 'not compressed'))
            output.writeframes(clip)
        [rows], _ = words_by_segment([measured_segment], recognize(path), 0)
        raw_words = segment_words('services', rows)
        actual = canonical_fixed_brand_words('services', expected, raw_words, rows)
        if (actual != expected or any(row[2] > measured_segment['end'] or row[3] < MIN_WORD_PROBABILITY for row in rows)
            or any(left[2] > right[1] for left, right in zip(rows, rows[1:]))):
            return None
    except Exception:
        return None
    return actual, {
        'method': 'services_exact_brand_window', 'start_sample': first, 'end_sample': last,
        'pcm_sha256': sha256(clip), 'window_raw_observed_sha256': sha256(' '.join(raw_words).encode()),
        'bounded_min_word_probability': min(row[3] for row in rows),
    }


def measure_final_french_speech(segments, decoded_pcm, waveform, directory, recognize=recognize_with_timeout,
                                recognize_phone=recognize_final_window, *, narration=None, preservation=None,
                                recognize_hook=recognize_final_window, recognize_services=recognize_final_window):
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
        lag_samples = waveform['lag_samples']
        preserved = (type(lag_samples) is int and lag_samples >= 0 and preservation
            and preservation.get('status') == 'matched'
            and preservation.get('lag_samples') == lag_samples
            and preservation.get('decoded_pcm_sha256') == result['decoded_pcm_sha256'])
        hook_check = None
        if narration is not None and preserved:
            def hook_check(start, end, expected):
                return verify_hook_samples(narration, decoded_pcm, lag_samples, directory,
                                           start, end, expected, recognize_hook)
        services_check = None
        if preserved:
            def services_check(segment, expected):
                return verify_services_samples(decoded_pcm, lag_samples, directory,
                                               segment, expected, recognize_services)

        results = compare_french_segments(
            segments, recognize(wav_path), lag_samples,
            lambda start, end: verify_phone_samples(decoded_pcm, lag_samples, directory, start, end, recognize_phone),
            verify_hook=hook_check, verify_services=services_check,
        )
    except ValueError:
        return {**result, 'reason': 'recognition_or_timing_inconclusive'}
    except Exception:
        # Model/cache/inference failure must preserve the prior audit, without
        # including provider diagnostics, spoken text or local paths in it.
        return {**result, 'reason': 'recognizer_unavailable'}
    if any(item.get('reason') == 'mixed_language_boundary' for item in results):
        return {**result, 'reason': 'recognition_or_timing_inconclusive', 'segments': results}
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
