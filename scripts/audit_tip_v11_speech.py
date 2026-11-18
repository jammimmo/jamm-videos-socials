"""Conservatively compare French speech recognized from the final MP4 audio."""

import hashlib
from itertools import islice
import json
import math
import os
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


CONTRACT = 'tip-v11-fr-final-speech-v2'
SOURCE = 'final_mp4_pcm_s16le_mono_24khz'
SAMPLE_RATE = 24_000
EXCLUDED_SEGMENTS = ('greeting', 'signature')
MAX_RECOGNIZED_WORDS = 500
MAX_OBSERVED_WORDS = 128
MAX_OBSERVED_WORD_LENGTH = 128
MIN_WORD_PROBABILITY = .6
MIN_SEGMENT_ACCURACY_PERCENT = 85
MIN_GLOBAL_ACCURACY_PERCENT = 92
# The ordinary cut still owns every word outside this window. A pair can
# recover a displaced cut of at most the 1.1 seconds observed in the MP4,
# plus a small allowance for differences in word timestamps.
MAX_FRENCH_BOUNDARY_SHIFT_SECONDS = 1.25
RECOGNITION_TIMEOUT_SECONDS = 150
LOCAL_SPEECH_WINDOW_TIMEOUT_SECONDS = 45
MAX_PHONE_EDGE_SHIFT_SECONDS = .75
SOCIALS_SIGNATURE_CONTEXT_SECONDS = 1.0
SOCIALS_CONTEXT_GRID_PER_SECOND = 10
MAX_SOCIALS_CONTEXT_SECONDS = 8
MAX_DOMAIN_SCENE_SECONDS = 8
MIN_PHONE_WORD_AUDIBLE_SECONDS = .05
HOOK_QUIET_WINDOW = SAMPLE_RATE // 100
HOOK_QUIET_MIN_SIDE = SAMPLE_RATE // 10
HOOK_QUIET_MIN_TOTAL = SAMPLE_RATE * 3 // 10
FIXED_BRAND_WORD_INDEX = {'services': 0, 'socials': 2}
FIXED_DOMAIN_WORDS = ('retrouvez', 'nous', 'sur', 'notre', 'site', 'jamm', 'immo', 'point', 'com')
FIXED_DOMAIN_JAMIMO_WORDS = ('retrouvez', 'nous', 'sur', 'notre', 'site', 'jamimo', 'com')
FIXED_SOCIALS_WORDS = ('suivez', 'aussi', 'jamm', 'immo', 'sur', 'nos', 'reseaux', 'sociaux',
                       'pour', 'retrouver', 'nos', 'prochains', 'conseils')
FIXED_SOCIALS_BOUNDARY_WORDS = ('aussi', 'jam', 'imo', 'sur', 'nos', 'reseaux', 'sociaux',
                                'pour', 'retrouver', 'nos', 'prochains', 'conseils')
PROTECTED_SPEECH_WORDS = frozenset('''
zero un une deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize
vingt trente quarante cinquante soixante septante huitante octante nonante cent cents mille millier
milliers million millions milliard milliards premier premiere second seconde ne n pas aucun aucune
aucuns aucunes jamais ni sans plus non rien guere
'''.split())


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def normalized_words(segment_id, value):
    """Match the Worker's NFKD/lower/mark-removal and Unicode L/N tokens."""
    value = ''.join(char for char in unicodedata.normalize('NFKD', value).lower()
                    if not unicodedata.category(char).startswith('M'))
    if segment_id == 'domain':
        value = re.sub(r'(?<!\w)jamm\s*immo\s*\.\s*com(?!\w)', 'jamm immo point com', value)
    if segment_id == 'phone':
        value = value.replace('+', ' plus ')
        value = re.sub(r'(?<!\w)221769444849(?!\w)', '221 76 944 48 49', value)
    words = []
    current = []
    for char in value:
        if unicodedata.category(char)[:1] in ('L', 'N'):
            current.append(char)
        elif current:
            words.append(''.join(current))
            current = []
    if current:
        words.append(''.join(current))
    if segment_id != 'phone':
        return words
    return [word for token in words for word in NUMBER_WORDS.get(token, token).split()]


def speech_edits(expected, observed):
    """Bounded Levenshtein distance, identical to the Worker's row scorer."""
    previous = list(range(len(observed) + 1))
    for index, word in enumerate(expected):
        following = [index + 1]
        for column, heard in enumerate(observed):
            following.append(min(previous[column + 1] + 1, following[column] + 1,
                                 previous[column] + int(word != heard)))
        previous = following
    return previous[-1]


def protected_speech(words):
    """Keep numeric and negation semantics exact even when other words score."""
    def protected(word):
        if any(unicodedata.category(char).startswith('N') for char in word) or word in PROTECTED_SPEECH_WORDS:
            return True
        stem = word[:-4] if word.endswith('ieme') else ''
        return bool(stem) and all(unicodedata.category(char).startswith('L') for char in stem)
    return [word for word in words if word is not None and protected(word)]


def bounded_observed_words(words):
    if (not 1 <= len(words) <= MAX_OBSERVED_WORDS
        or any(word is not None and not 1 <= len(word) <= MAX_OBSERVED_WORD_LENGTH for word in words)):
        return None
    return words


def observed_words_with_uncertainty(identity, expected, raw_actual, actual, rows, alias_kind=None):
    """Replace only safely mapped, ordinary low-confidence ASR tokens with null."""
    token_rows = [normalized_words(identity, row[0]) for row in rows]
    flattened = [word for words in token_rows for word in words]
    uncertain = [word for words, row in zip(token_rows, rows) if row[3] < MIN_WORD_PROBABILITY for word in words]
    # Cross-row domain/phone rewrites cannot be assigned to one uncertain ASR
    # row. Exact rows retain the established fast path; uncertain rows fail.
    if flattened != raw_actual:
        return (actual, False) if not uncertain else (None, True)
    if protected_speech(uncertain):
        return None, True
    reported = [None if row[3] < MIN_WORD_PROBABILITY else word
                for words, row in zip(token_rows, rows) for word in words]
    if actual != raw_actual:
        if alias_kind == 'fixed_socials_fused_brand':
            # The fused alias requires every original row to be confident.
            return (actual, False) if not uncertain else (None, True)
        elif alias_kind == 'fixed_domain_jamimo':
            if reported[5] not in ('jamimo', None):
                return None, True
            reported[5:6] = ['jamm', 'immo']
        elif alias_kind == 'fixed_socials_boundary':
            if reported[1:3] != ['jam', 'imo']:
                return None, True
            reported[1:3] = ['jamm', 'immo']
        else:
            alias = fixed_brand_alias_index(identity, expected, raw_actual)
            if alias is None or reported[alias:alias + 2] != ['jam', 'imo']:
                return None, True
            reported[alias:alias + 2] = ['jamm', 'immo']
    return reported, False


def load_speech_model():
    """Load only the pinned cached model; no expected text reaches the decoder."""
    from faster_whisper import WhisperModel, download_model

    path = download_model(ASR_REPO, revision=ASR_REVISION, local_files_only=True)
    return WhisperModel(path, device='cpu', compute_type='int8', local_files_only=True, cpu_threads=4)


def recognize_model_wav(model, wav_path):
    """Share the exact decoder settings between one-shot and resident scoring."""
    segments, _ = model.transcribe(
        str(wav_path), language='fr', beam_size=5, word_timestamps=True,
        condition_on_previous_text=False, initial_prompt=None, hotwords=None, vad_filter=False,
    )
    for segment in segments:
        for word in segment.words or ():
            yield word.word, float(word.start), float(word.end), float(word.probability)


def recognize_final_wav(wav_path):
    """Only audio goes into the recognizer. Final-audit timeout stays unchanged."""
    yield from recognize_model_wav(load_speech_model(), wav_path)


def recognize_with_timeout(wav_path, timeout=RECOGNITION_TIMEOUT_SECONDS):
    # The child receives only the extracted audio path. Raw words, timestamps
    # and confidence values cross a captured pipe in memory and are never
    # logged or saved; only bounded normalized observations enter the private
    # v2 receipt.
    completed = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), str(wav_path)],
        capture_output=True, check=True, timeout=timeout,
    )
    return json.loads(completed.stdout)


def words_by_segment(segments, recognized_words, lag_samples, *, opening_hook=None, hook_crossings=None,
                     boundary_crossings=None):
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
        # Domain punctuation may be a separate ASR row. Preserve its origin
        # for the literal-URL guard; it still contributes no ordinary word.
        domain_punctuation = bool(re.fullmatch(r'[.@/\\:-]+', text))
        if not spoken_plus and not normalized_words('', text) and not domain_punctuation:
            continue
        start, end = start - offset, end - offset
        row = (text, start, end, probability)
        if opening_hook and (start < opening_hook['start'] < end or start < opening_hook['end'] < end):
            hook_crossings.append(row)
        middle = (start + end) / 2
        while index + 1 < len(segments) and middle >= segments[index]['end']:
            index += 1
        segment = segments[index]
        if domain_punctuation and segment['id'] != 'domain':
            continue
        excluded = segment['id'] in EXCLUDED_SEGMENTS
        if not segment['start'] <= middle < segment['end']:
            raise ValueError('recognized word ambiguous at a scene boundary')
        # A word spanning verified and excluded speech blocks acceptance.
        # Keep the measurements for French scenes that the word did not touch.
        overlaps = [i for i, part in enumerate(segments) if part['start'] < end and start < part['end']]
        if any((segments[i]['id'] in EXCLUDED_SEGMENTS) != excluded for i in overlaps):
            affected = [i for i in overlaps if segments[i]['id'] not in EXCLUDED_SEGMENTS]
            ambiguous_boundary.update(affected)
            if boundary_crossings is not None:
                overlap_ids = tuple(segments[i]['id'] for i in overlaps)
                for affected_index in affected:
                    boundary_crossings.setdefault(affected_index, []).append((row, overlap_ids))
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


def fixed_fused_brand_index(segment, expected, actual, rows):
    """Recognize one literal Jamimo row within the complete timed socials line."""
    index = FIXED_BRAND_WORD_INDEX['socials']
    if (segment['id'] != 'socials' or tuple(expected) != FIXED_SOCIALS_WORDS
        or actual != [*expected[:index], 'jamimo', *expected[index + 2:]]
        or len(rows) != len(actual) or rows[index][0].lower() != 'jamimo'):
        return None
    previous_end = segment['start']
    for token, (text, start, end, probability) in zip(actual, rows):
        if (normalized_words('', text) != [token] or probability < MIN_WORD_PROBABILITY
            or not previous_end <= start < end <= segment['end']):
            return None
        previous_end = end
    return index


def exact_row_token_index(identity, rows, expected_tokens):
    """Locate an exact sequence of one-token, non-overlapping ASR rows."""
    token_rows = [normalized_words(identity, row[0]) for row in rows]
    matches = []
    width = len(expected_tokens)
    for index in range(len(rows) - width + 1):
        if token_rows[index:index + width] != [[token] for token in expected_tokens]:
            continue
        selected = rows[index:index + width]
        if any(left[2] > right[1] for left, right in zip(selected, selected[1:])):
            continue
        matches.append(index)
    return matches[0] if len(matches) == 1 else None


def fixed_domain_alias(expected, raw_actual, rows):
    """Expand only the archived fixed-domain Jamimo row, never the absent point."""
    if tuple(expected) != FIXED_DOMAIN_WORDS or tuple(raw_actual) != FIXED_DOMAIN_JAMIMO_WORDS:
        return None
    index = exact_row_token_index('domain', rows, ('jamimo', 'com'))
    if index is None:
        return None
    brand, domain = rows[index:index + 2]
    if min(brand[3], domain[3]) < MIN_WORD_PROBABILITY:
        return None
    return [*FIXED_DOMAIN_WORDS[:-2], 'com'], index


def literal_company_domain_input(rows, *, allow_point_omission=False):
    """Parse raw ASR URL syntax before punctuation can become ordinary edits."""
    if not rows:
        return None
    text, origins = '', []
    for index, row in enumerate(rows):
        part = ''.join(char for char in unicodedata.normalize('NFKD', row[0]).lower()
                       if not unicodedata.category(char).startswith('M'))
        if index:
            text += ' '
            origins.append(None)
        text += part
        origins.extend([index] * len(part))
    separator = r'(?:\s*(?P<dot>\.)\s*|\s+(?P<point>point)\s+'
    separator += r'|\s+)' if allow_point_omission else ')'
    pattern = (r'(?<![\w.@/-])(?P<first>jam{1,2})\s*(?P<second>im{1,2}o)'
               + separator + r'(?P<tld>com)[.!?,;:\s]*$')
    match = re.search(pattern, text)
    # Inter-row whitespace must not conceal a split host/address/scheme.
    if match is None or re.search(r'[.@/\\:-]\s*$', text[:match.start()]):
        return None
    return text, origins, match


def fixed_domain_raw_url_guard(expected, rows):
    return (tuple(expected[-4:]) == ('jamm', 'immo', 'point', 'com')
            and literal_company_domain_input(rows, allow_point_omission=True) is not None)


def fixed_company_domain_notation(expected, rows):
    """Normalize only literal fixed-company URL notation, retaining row trust."""
    if tuple(expected[-4:]) != ('jamm', 'immo', 'point', 'com'):
        return None
    parsed = literal_company_domain_input(rows)
    if parsed is None:
        return None
    text, origins, match = parsed
    def origin_probability(first, last):
        indices = {origin for origin in origins[first:last] if origin is not None}
        return min(rows[index][3] for index in indices) if indices else 0
    tokens = []
    for prefix in re.finditer(r'[^\W_]+', text[:match.start()]):
        tokens.append((prefix.group(), origin_probability(*prefix.span())))
    for word, group in (('jamm', 'first'), ('immo', 'second'),
                        ('point', 'dot' if match.group('dot') else 'point'), ('com', 'tld')):
        tokens.append((word, origin_probability(*match.span(group))))
    actual = [word for word, _ in tokens]
    uncertain = [word for word, probability in tokens if probability < MIN_WORD_PROBABILITY]
    if protected_speech(uncertain):
        return None
    return {
        'actual': actual,
        'reported': [word if probability >= MIN_WORD_PROBABILITY else None for word, probability in tokens],
        'raw_words': normalized_words('', text),
        'uncertain_token_count': len(uncertain),
        'raw_uncertain_token_count': sum(len(normalized_words('', row[0]))
                                         for row in rows if row[3] < MIN_WORD_PROBABILITY),
        'notation': 'dot' if match.group('dot') else 'point',
        'brand_observed': match.group('first') + match.group('second'),
        'brand_probability_ppm': math.floor(origin_probability(match.start('first'), match.end('second')) * 1_000_000),
        'tld_probability_ppm': math.floor(origin_probability(*match.span('tld')) * 1_000_000),
        'brand_row_indices': sorted({origin for origin in origins[match.start('first'):match.end('second')]
                                     if origin is not None}),
        'tld_row_indices': sorted({origin for origin in origins[slice(*match.span('tld'))] if origin is not None}),
    }


def safe_socials_signature_boundary(segments, index, crossings, in_scene_rows):
    if (segments[index]['id'] != 'socials' or index + 1 >= len(segments)
        or segments[index + 1]['id'] != 'signature'
        or abs(segments[index]['end'] - segments[index + 1]['start']) > .001
        or len(crossings) != 1):
        return None
    row, overlap_ids = crossings[0]
    tokens = normalized_words('', row[0])
    boundary = segments[index]['end']
    if (overlap_ids != ('socials', 'signature') or row in in_scene_rows or len(tokens) != 1 or row[0] == '+'
        or row[3] < MIN_WORD_PROBABILITY or protected_speech(tokens)
        or not row[1] < boundary < row[2]):
        return None
    return row


def fixed_socials_boundary_alias(expected, raw_actual, rows, crossing):
    """Keep the fixed CTA words once, with only the absent Suivez scored."""
    if (crossing is None or tuple(expected) != FIXED_SOCIALS_WORDS
        or tuple(raw_actual) != FIXED_SOCIALS_BOUNDARY_WORDS):
        return None
    index = exact_row_token_index('socials', rows, ('jam', 'imo'))
    if index is None:
        return None
    first, second = rows[index:index + 2]
    if min(first[3], second[3]) < MIN_WORD_PROBABILITY:
        return None
    return ['aussi', 'jamm', 'immo', *FIXED_SOCIALS_WORDS[4:]], index


def socials_onset_without_borrowing(segments, index, rows, previous_rows):
    """Use the preceding French words, never its nominal scene rectangle."""
    if not rows or index < 1 or not previous_rows:
        return None
    part, previous = segments[index], segments[index - 1]
    first = rows[0]
    if (previous['id'] in EXCLUDED_SEGMENTS or abs(previous['end'] - part['start']) > .001
        or not 0 < part['start'] - first[1] <= MAX_PHONE_EDGE_SHIFT_SECONDS
        or first[2] <= part['start'] or protected_speech(normalized_words('', first[0]))
        or any(row[1] < part['start'] for row in rows[1:])
        or any(row[3] < MIN_WORD_PROBABILITY or row[0] == '+' for row in previous_rows)
        or any(left[2] > right[1] for left, right in zip(previous_rows, previous_rows[1:]))
        or segment_words(previous['id'], previous_rows) != normalized_words(previous['id'], previous['text'])
        or not previous_rows[-1][2] <= first[1]
        or first[1] - previous_rows[-1][2] > MAX_PHONE_EDGE_SHIFT_SECONDS):
        return None
    # Every preceding word is still present once, in its own scene. In
    # particular, a numeric/negative word cannot be clipped or borrowed to
    # improve the following French sentence's score.
    return {
        'method': 'complete_preceding_french_words',
        'previous_segment': previous['id'],
        'previous_words_sha256': sha256(' '.join(segment_words(previous['id'], previous_rows)).encode()),
        'previous_last_end_sample': round(previous_rows[-1][2] * SAMPLE_RATE),
        'observed_first_start_sample': round(first[1] * SAMPLE_RATE),
        'nominal_scene_start_sample': round(part['start'] * SAMPLE_RATE),
        'previous_min_probability_milli': round(min(row[3] for row in previous_rows) * 1000),
        'words_borrowed': False,
    }


def complete_socials_before_excluded_cue(segments, index, crossings, rows, expected, raw_actual, previous_rows=None):
    """Certify a fully observed French line, never the excluded crossing cue.

    Uncertain spelling in the excluded closing is irrelevant only when every
    French word was already heard before that cue. This does not fill a missing French word
    from the signature, or reinterpret an overlapping/protected word.
    """
    segment = segments[index]
    if (segment['id'] != 'socials' or index + 1 >= len(segments)
        or segments[index + 1]['id'] != 'signature'
        or abs(segment['end'] - segments[index + 1]['start']) > .001
        or tuple(expected) != FIXED_SOCIALS_WORDS or len(crossings) != 1 or not rows):
        return None
    crossing, overlap_ids = crossings[0]
    crossing_words = normalized_words('', crossing[0])
    onset = socials_onset_without_borrowing(segments, index, rows, previous_rows) if rows[0][1] < segment['start'] else None
    if (overlap_ids != ('socials', 'signature') or crossing in rows or len(crossing_words) != 1
        or protected_speech(crossing_words)
        or not crossing[1] < segment['end'] < crossing[2]
        or not 0 < crossing[2] - crossing[1] <= .75
        or segment['end'] - crossing[1] > .15 or crossing[2] - segment['end'] > .6
        or not rows[-1][2] <= crossing[1] <= rows[-1][2] + .75
        or any((row[1] < segment['start'] and not (number == 0 and onset))
               or row[2] > segment['end'] or row[3] < MIN_WORD_PROBABILITY
               for number, row in enumerate(rows))
        or any(left[2] > right[1] for left, right in zip(rows, rows[1:]))):
        return None
    actual = canonical_fixed_brand_words('socials', expected, raw_actual, rows)
    # The existing fixed-brand spelling normalization is the only rewrite.
    # All thirteen observed French words must remain, with no insertion.
    if actual != expected or len(actual) != len(raw_actual):
        return None
    return actual, crossing, onset


def complete_socials_boundary_only(segments, index, crossings, rows, expected, raw_actual):
    """A focused read may resolve timing, never missing/uncertain French words."""
    if (segments[index]['id'] != 'socials' or index + 1 >= len(segments)
        or segments[index + 1]['id'] != 'signature' or not rows or len(crossings) != 1
        or abs(segments[index]['end'] - segments[index + 1]['start']) > .001
        or tuple(expected) != FIXED_SOCIALS_WORDS
        or canonical_fixed_brand_words('socials', expected, raw_actual, rows) != expected
        or len(raw_actual) != len(expected)
        or rows[0][1] < segments[index]['start'] - MAX_PHONE_EDGE_SHIFT_SECONDS
        or any(row[3] < MIN_WORD_PROBABILITY or row[0] == '+'
               or row[2] > segments[index]['end']
               or (number > 0 and row[1] < segments[index]['start'])
               for number, row in enumerate(rows))
        or any(left[2] > right[1] for left, right in zip(rows, rows[1:]))):
        return False
    crossing, overlap_ids = crossings[0]
    return (overlap_ids == ('socials', 'signature') and crossing not in rows
            and len(normalized_words('', crossing[0])) == 1
            and not protected_speech(normalized_words('', crossing[0]))
            and crossing[1] < segments[index]['end'] < crossing[2]
            and 0 < crossing[2] - crossing[1] <= .75
            and segments[index]['end'] - crossing[1] <= .15
            and crossing[2] - segments[index]['end'] <= .6
            and rows[-1][2] <= crossing[1] <= rows[-1][2] + .75)


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
                            verify_services=None, verify_socials=None, verify_domain=None):
    opening_hook = None
    if (verify_hook and len(segments) > 2 and [part['id'] for part in segments[:2]] == ['greeting', 'hook']
        and segments[0]['end'] == segments[1]['start'] and segments[1]['end'] == segments[2]['start']):
        opening_hook = segments[1]
    hook_crossings = []
    boundary_crossings = {}
    observed, ambiguous_boundary = words_by_segment(
        segments, recognized_words, lag_samples, opening_hook=opening_hook, hook_crossings=hook_crossings,
        boundary_crossings=boundary_crossings,
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
        alias_kind = None
        alias_index = None
        crossing = safe_socials_signature_boundary(
            segments, index, boundary_crossings.get(index, []), observed[index],
        ) if index in ambiguous_boundary else None
        complete_socials = complete_socials_before_excluded_cue(
            segments, index, boundary_crossings.get(index, []), observed[index], expected, raw_actual,
            observed[index - 1] if index else None,
        ) if index in ambiguous_boundary else None
        socials_alias = fixed_socials_boundary_alias(expected, raw_actual, observed[index], crossing)
        domain_raw_verified = identity != 'domain' or fixed_domain_raw_url_guard(expected, observed[index])
        domain_alias = fixed_domain_alias(expected, raw_actual, observed[index]) if (
            index not in ambiguous_boundary and domain_raw_verified) else None
        domain_notation = fixed_company_domain_notation(expected, observed[index]) if identity == 'domain' else None
        if complete_socials:
            actual = complete_socials[0]
            alias_kind = 'fixed_socials_complete_boundary'
        elif socials_alias:
            actual, alias_index = socials_alias
            alias_kind = 'fixed_socials_boundary'
        elif domain_notation:
            actual = domain_notation['actual']
            if actual != domain_notation['raw_words']:
                alias_kind = 'fixed_company_domain_notation'
        elif domain_alias:
            actual, alias_index = domain_alias
            alias_kind = 'fixed_domain_jamimo'
        elif index in ambiguous_boundary:
            actual = raw_actual
        else:
            fused_index = fixed_fused_brand_index(segment, expected, raw_actual, observed[index])
            if fused_index is not None:
                actual = [*raw_actual[:fused_index], 'jamm', 'immo', *raw_actual[fused_index + 1:]]
                alias_kind = 'fixed_socials_fused_brand'
            else:
                actual = canonical_fixed_brand_words(identity, expected, raw_actual, observed[index])
                if actual != raw_actual:
                    alias_kind = 'fixed_jamm_immo'
        if domain_notation:
            uncertain_actual, unsafe_uncertainty = domain_notation['reported'], False
        else:
            uncertain_actual, unsafe_uncertainty = observed_words_with_uncertainty(
                identity, expected, raw_actual, actual, observed[index], alias_kind,
            )
        reported = bounded_observed_words(uncertain_actual) if uncertain_actual is not None else None
        # A standalone sign can be numeric formatting. It needs the focused
        # phone check and acoustic evidence before it can count as speech.
        exact = (bool(expected) and actual == expected
                 and all(word[0] != '+' and word[3] >= MIN_WORD_PROBABILITY for word in observed[index]))
        edits = speech_edits(expected, reported) if expected and reported is not None else len(expected) + len(actual)
        scored = (bool(expected) and reported is not None and not unsafe_uncertainty
                  and edits * 100 <= len(expected) * (100 - MIN_SEGMENT_ACCURACY_PERCENT)
                  and protected_speech(reported) == protected_speech(expected)
                  and all(word[0] != '+' for word in observed[index]))
        boundary_verified = alias_kind in ('fixed_socials_boundary', 'fixed_socials_complete_boundary')
        # A wrong company domain/TLD is never an ordinary 1-in-9 word edit.
        canonical_point_omission = (tuple(expected) == FIXED_DOMAIN_WORDS
            and tuple(raw_actual) == tuple(word for word in FIXED_DOMAIN_WORDS if word != 'point'))
        domain_verified = (identity != 'domain' or (domain_raw_verified and (
            domain_notation is not None or domain_alias is not None or canonical_point_omission)))
        matched = scored and domain_verified and (index not in ambiguous_boundary or boundary_verified)
        item = {'segment': identity, 'status': 'matched' if matched else 'inconclusive',
                'expected_token_count': len(expected), 'observed_token_count': len(actual),
                'expected_sha256': sha256(' '.join(expected).encode()),
                'observed_words': reported or []}
        if reported is not None and all(word is not None for word in reported):
            item['observed_sha256'] = sha256(' '.join(reported).encode())
        if matched and alias_kind:
            if alias_kind == 'fixed_company_domain_notation':
                item['measurement'] = {
                    'method': 'fixed_company_domain_url_notation',
                    'raw_observed_sha256': sha256(' '.join(domain_notation['raw_words']).encode()),
                    'notation': domain_notation['notation'],
                    'uncertain_token_count': domain_notation['uncertain_token_count'],
                    'raw_uncertain_token_count': domain_notation['raw_uncertain_token_count'],
                    'visible_domain_required': True,
                }
            elif alias_kind == 'fixed_domain_jamimo':
                item['measurement'] = {
                    'method': 'fixed_domain_jamimo_phonetic_spelling',
                    'raw_observed_sha256': sha256(' '.join(raw_actual).encode()),
                    'brand_probability_milli': round(observed[index][alias_index][3] * 1000),
                    'visible_domain_required': True,
                }
            elif alias_kind == 'fixed_socials_complete_boundary':
                excluded_cue = complete_socials[1]
                item['measurement'] = {
                    'method': 'fixed_socials_complete_before_excluded_cue',
                    'raw_observed_sha256': sha256(' '.join(raw_actual).encode()),
                    'excluded_cue_sha256': sha256(' '.join(normalized_words('', excluded_cue[0])).encode()),
                    'excluded_cue_probability_milli': round(excluded_cue[3] * 1000),
                    'excluded_cue_used_as_french': False,
                    'french_min_probability_milli': round(min(word[3] for word in observed[index]) * 1000),
                }
                if complete_socials[2]:
                    item['measurement']['onset_boundary'] = complete_socials[2]
            elif alias_kind == 'fixed_socials_boundary':
                crossing_tokens = normalized_words('', crossing[0])
                item['measurement'] = {
                    'method': 'fixed_socials_signature_boundary',
                    'raw_observed_sha256': sha256(' '.join(raw_actual).encode()),
                    'crossing_word_sha256': sha256(' '.join(crossing_tokens).encode()),
                    'crossing_probability_milli': round(crossing[3] * 1000),
                    'brand_min_probability_milli': round(min(
                        observed[index][alias_index][3], observed[index][alias_index + 1][3],
                    ) * 1000),
                }
            else:
                item['measurement'] = {
                    'method': 'fixed_jamm_immo_phonetic_spelling',
                    'raw_observed_sha256': sha256(' '.join(raw_actual).encode()),
                }
        if index in ambiguous_boundary and not boundary_verified:
            item['reason'] = 'mixed_language_boundary'
            rows = observed[index]
            if (segment is opening_hook and exact and hook_crossings == rows[:1]
                and rows[0][1] < segment['start'] < rows[0][2] <= segment['end']
                and normalized_words('hook', rows[0][0]) == expected[:1]):
                measurement = verify_hook(segment['start'], segment['end'], expected)
                if measurement:
                    item.pop('reason')
                    item.update(status='matched', observed_token_count=len(expected),
                                observed_sha256=item['expected_sha256'], observed_words=expected, measurement={
                        **measurement, 'global_min_word_probability': min(row[3] for row in rows),
                        'global_crossing_source_samples': [round(point * SAMPLE_RATE) for point in rows[0][1:3]],
                    })
            elif verify_socials and complete_socials_boundary_only(
                    segments, index, boundary_crossings.get(index, []), observed[index], expected, raw_actual):
                confirmed = verify_socials(segments, index, expected)
                if confirmed:
                    verified_words, measurement = confirmed
                    if verified_words == expected:
                        item.pop('reason')
                        item.update(status='matched', observed_words=verified_words,
                                    observed_token_count=len(verified_words),
                                    observed_sha256=sha256(' '.join(verified_words).encode()), measurement={
                            **measurement,
                            'global_raw_observed_sha256': sha256(' '.join(raw_actual).encode()),
                        })
        elif not matched and identity == 'domain' and verify_domain:
            confirmed = verify_domain(segment, expected)
            if confirmed:
                item = {**confirmed, 'measurement': {
                    **confirmed.get('measurement', {}),
                    'global_raw_observed_sha256': sha256(' '.join(raw_actual).encode()),
                }}
        elif not matched and identity == 'phone' and verify_phone:
            window = anchored_phone_range(segments, expected_words, observed, index)
            measurement = verify_phone(*window) if window else None
            verified_words = measurement.get('observed_words') if measurement else None
            if verified_words == expected:
                item.update(status='matched', observed_sha256=sha256(' '.join(verified_words).encode()),
                            observed_token_count=len(verified_words), observed_words=verified_words,
                            measurement={key: value for key, value in measurement.items() if key != 'observed_words'})
        elif not matched and identity == 'services' and verify_services:
            if fixed_brand_alias_index(identity, expected, raw_actual) is not None:
                confirmed = verify_services(segment, expected)
                if confirmed:
                    verified_words, measurement = confirmed
                    item.update(status='matched', observed_sha256=sha256(' '.join(verified_words).encode()),
                                observed_token_count=len(verified_words), observed_words=verified_words, measurement={
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
            'pcm_sha256': sha256(clip), 'observed_words': segment_words('phone', observed)}


def context_phone_rows(rows, contact_words, social_words):
    """Select one whole, actually recognized number between fixed anchors.

    Later social-brand spelling does not change the preceding phone proof.
    No expected token is inserted, and no recognition row may be divided.
    """
    if not isinstance(rows, list) or not 1 <= len(rows) <= 64:
        return None
    flattened = []
    for index, row in enumerate(rows):
        if (not isinstance(row, (tuple, list)) or len(row) != 4 or not isinstance(row[0], str)
            or not 1 <= len(row[0]) <= 80):
            return None
        flattened.extend((word, index) for word in normalized_words('phone', row[0]))
    observed = [word for word, _ in flattened]
    matches = [index for index in range(len(observed)) if observed[index:index + len(PHONE_WORDS)] == PHONE_WORDS]
    if len(matches) != 1:
        return None
    first = matches[0]
    end = first + len(PHONE_WORDS)
    if observed[:first] != contact_words or observed[end:end + 2] != social_words[:2]:
        return None
    first_row, last_row = flattened[first][1], flattened[end - 1][1]
    if ((first and flattened[first - 1][1] == first_row)
        or (end < len(flattened) and flattened[end][1] == last_row)):
        return None
    return rows[first_row:last_row + 1]


def verify_phone_context_samples(decoded_pcm, lag_samples, directory, segments, start, end, recognize):
    """Recheck the fixed phone in its bounded, unprompted French CTA context."""
    identifiers = [row.get('id') for row in segments]
    if identifiers.count('phone') != 1:
        return None
    index = identifiers.index('phone')
    if (not 0 < index < len(segments) - 1
        or identifiers[index - 1:index + 2] != ['contact', 'phone', 'socials']):
        return None
    contact, phone, social = segments[index - 1:index + 2]
    contact_words = normalized_words('contact', contact['text'])
    social_words = normalized_words('socials', social['text'])
    if (contact_words != normalized_words('contact',
            'Vous pouvez nous appeler ou nous écrire sur WhatsApp au même numéro.')
        or tuple(social_words) != FIXED_SOCIALS_WORDS
        or normalized_words('phone', phone['text']) != PHONE_WORDS
        or not contact['start'] <= start < end <= social['end']
        or not 0 < social['end'] - contact['start'] <= 18):
        return None
    first, last = (round(point * SAMPLE_RATE) + lag_samples for point in (contact['start'], social['end']))
    if not 0 <= first < last <= len(decoded_pcm) // 2:
        return None
    clip = decoded_pcm[first * 2:last * 2]
    sound = list(audible_windows(clip, SAMPLE_RATE))
    if not sound:
        return None
    path = Path(directory) / 'decoded-final-phone-context.wav'
    try:
        with wave.open(str(path), 'wb') as output:
            output.setparams((1, 2, SAMPLE_RATE, 0, 'NONE', 'not compressed'))
            output.writeframes(clip)
        context_rows = recognize(path)
        duration = (last - first) / SAMPLE_RATE
        previous_end = 0
        for row in context_rows:
            if (not isinstance(row, (tuple, list)) or len(row) != 4
                or not all(type(value) in (int, float) and math.isfinite(value) for value in row[1:])
                or not previous_end <= row[1] < row[2] <= duration or not 0 <= row[3] <= 1):
                return None
            previous_end = row[2]
        rows = context_phone_rows(context_rows, contact_words, social_words)
        if not rows or segment_words('phone', rows) != PHONE_WORDS:
            return None
        previous_end = 0
        for _, left, right, confidence in rows:
            if (not all(type(value) in (int, float) and math.isfinite(value) for value in (left, right, confidence))
                or not previous_end <= left < right <= duration or not MIN_WORD_PROBABILITY <= confidence <= 1
                or voiced_overlap(sound, left, right) < MIN_PHONE_WORD_AUDIBLE_SECONDS):
                return None
            previous_end = right
        phone_first = first + round(rows[0][1] * SAMPLE_RATE)
        phone_last = first + round(rows[-1][2] * SAMPLE_RATE)
        expected_first = round(start * SAMPLE_RATE) + lag_samples
        expected_last = round(end * SAMPLE_RATE) + lag_samples
        tolerance = round(MAX_PHONE_EDGE_SHIFT_SECONDS * SAMPLE_RATE)
        if (abs(phone_first - expected_first) > tolerance or abs(phone_last - expected_last) > tolerance
            or not 4 <= (phone_last - phone_first) / SAMPLE_RATE <= 8):
            return None
    except Exception:
        return None
    return {
        'method': 'phone_exact_contact_context_v1',
        'start_sample': phone_first, 'end_sample': phone_last,
        'pcm_sha256': sha256(decoded_pcm[phone_first * 2:phone_last * 2]),
        'context_start_sample': first, 'context_end_sample': last, 'context_pcm_sha256': sha256(clip),
        'bounded_min_word_probability': min(row[3] for row in rows),
        'observed_words': segment_words('phone', rows),
    }


def verify_phone_with_context(decoded_pcm, lag_samples, directory, segments, start, end, recognize,
                              recognize_context=None):
    direct = verify_phone_samples(decoded_pcm, lag_samples, directory, start, end, recognize)
    if direct:
        return direct
    return verify_phone_context_samples(decoded_pcm, lag_samples, directory, segments, start, end,
                                        recognize_context or recognize)


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


def verify_socials_scene_samples(decoded_pcm, lag_samples, directory, segments, index, expected, recognize):
    """Recognize once from the exact French start plus <=1s excluded context."""
    if (segments[index]['id'] != 'socials' or index + 1 >= len(segments)
        or segments[index + 1]['id'] != 'signature' or tuple(expected) != FIXED_SOCIALS_WORDS
        or type(lag_samples) is not int or lag_samples < 0):
        return None
    part, signature = segments[index:index + 2]
    if abs(part['end'] - signature['start']) > .001:
        return None
    # Round the optional closing context down on the existing100ms audio grid.
    # The French start/cut itself is not moved or rounded.
    context_end = min(signature['end'], math.floor(
        (part['end'] + SOCIALS_SIGNATURE_CONTEXT_SECONDS) * SOCIALS_CONTEXT_GRID_PER_SECOND,
    ) / SOCIALS_CONTEXT_GRID_PER_SECOND)
    first = round(part['start'] * SAMPLE_RATE) + lag_samples
    last = round(context_end * SAMPLE_RATE) + lag_samples
    if (not 0 <= first < last <= len(decoded_pcm) // 2
        or not part['end'] <= context_end
        or last - first > MAX_SOCIALS_CONTEXT_SECONDS * SAMPLE_RATE):
        return None
    clip = decoded_pcm[first * 2:last * 2]
    path = Path(directory) / 'decoded-socials-scene.wav'
    created = False
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        created = True
        with os.fdopen(descriptor, 'wb') as target:
            with wave.open(target, 'wb') as output:
                output.setparams((1, 2, SAMPLE_RATE, 0, 'NONE', 'not compressed'))
                output.writeframes(clip)
        rows = list(islice(recognize(path), MAX_RECOGNIZED_WORDS + 1))
        duration = (last - first) / SAMPLE_RATE
        if (len(rows) > MAX_RECOGNIZED_WORDS
            or any(not all(type(value) in (int, float) and math.isfinite(value) for value in row[1:])
                   or not 0 <= row[1] < row[2] <= duration + .12 for row in rows)):
            return None
        shifted = [(word, start + first / SAMPLE_RATE, end + first / SAMPLE_RATE, probability)
                   for word, start, end, probability in rows]
        [result] = compare_french_segments([part, signature], shifted, lag_samples)
        if result['status'] != 'matched' or result['observed_words'] != expected:
            return None
        return result['observed_words'], {
            'method': 'socials_exact_scene_window',
            'decoded_pcm_sha256': sha256(decoded_pcm),
            'start_sample': first, 'end_sample': last, 'pcm_sha256': sha256(clip),
            'boundary_evidence': result.get('measurement'),
            'excluded_context_used_as_french': False,
        }
    except Exception:
        return None
    finally:
        if created:
            path.unlink(missing_ok=True)


def uncertain_fixed_domain_scene_measurement(decoded_pcm, lag_samples, segment, first, last, rows, notation):
    """Describe a held brand observation; never turn its uncertainty into words."""
    if (notation is None or tuple(normalized_words('domain', segment['text'])) != FIXED_DOMAIN_WORDS
        or first != round(segment['start'] * SAMPLE_RATE) + lag_samples
        or last != round(segment['end'] * SAMPLE_RATE) + lag_samples
        or not 0 <= first < last <= len(decoded_pcm) // 2
        or last - first > MAX_DOMAIN_SCENE_SECONDS * SAMPLE_RATE
        or notation['reported'] != [*FIXED_DOMAIN_WORDS[:5], None, None, *FIXED_DOMAIN_WORDS[7:]]
        or any(left[2] > right[1] for left, right in zip(rows, rows[1:]))
        or not 0 <= notation['brand_probability_ppm'] < 600000
        or not 600000 <= notation['tld_probability_ppm'] <= 1000000):
        return None
    brand = notation['brand_observed']
    raw = notation['raw_words']
    if (not re.fullmatch(r'jam{1,2}im{1,2}o', brand)
        or raw not in ([*FIXED_DOMAIN_WORDS[:5], brand, 'com'],
                       [*FIXED_DOMAIN_WORDS[:5], brand, 'point', 'com'])):
        return None
    url_first = min(round(rows[index][1] * SAMPLE_RATE) + lag_samples
                    for index in notation['brand_row_indices'])
    url_last = max(round(rows[index][2] * SAMPLE_RATE) + lag_samples
                   for index in notation['tld_row_indices'])
    if not first <= url_first < url_last <= last:
        return None
    return {
        'method': 'fixed_company_domain_asr_uncertain_v1',
        'decoded_pcm_sha256': sha256(decoded_pcm),
        'start_sample': first, 'end_sample': last,
        'scene_start_sample': first, 'scene_end_sample': last,
        'url_start_sample': url_first, 'url_end_sample': url_last,
        'pcm_sha256': sha256(decoded_pcm[first * 2:last * 2]),
        'raw_observed_words': raw, 'raw_observed_sha256': sha256(' '.join(raw).encode()),
        'brand_observed': brand, 'brand_probability_ppm': notation['brand_probability_ppm'],
        'tld_observed': '.com', 'tld_probability_ppm': notation['tld_probability_ppm'],
    }


def verify_domain_scene_samples(decoded_pcm, lag_samples, directory, segment, expected, recognize):
    """One actual final-PCM read strictly within the domain's own scene."""
    if (segment['id'] != 'domain' or tuple(expected) != FIXED_DOMAIN_WORDS
        or type(lag_samples) is not int or lag_samples < 0):
        return None
    first = round(segment['start'] * SAMPLE_RATE) + lag_samples
    last = round(segment['end'] * SAMPLE_RATE) + lag_samples
    if (not 0 <= first < last <= len(decoded_pcm) // 2
        or last - first > MAX_DOMAIN_SCENE_SECONDS * SAMPLE_RATE):
        return None
    clip = decoded_pcm[first * 2:last * 2]
    path = Path(directory) / 'decoded-domain-scene.wav'
    created = False
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        created = True
        with os.fdopen(descriptor, 'wb') as target:
            with wave.open(target, 'wb') as output:
                output.setparams((1, 2, SAMPLE_RATE, 0, 'NONE', 'not compressed'))
                output.writeframes(clip)
        rows = list(islice(recognize(path), MAX_RECOGNIZED_WORDS + 1))
        duration = (last - first) / SAMPLE_RATE
        if (len(rows) > MAX_RECOGNIZED_WORDS
            or any(not all(type(value) in (int, float) and math.isfinite(value) for value in row[1:])
                   or not 0 <= row[1] < row[2] <= duration + .12 for row in rows)):
            return None
        shifted = [(word, start + first / SAMPLE_RATE, end + first / SAMPLE_RATE, probability)
                   for word, start, end, probability in rows]
        [result] = compare_french_segments([segment], shifted, lag_samples)
        observed, _ = words_by_segment([segment], shifted, lag_samples)
        notation = fixed_company_domain_notation(expected, observed[0])
        held = uncertain_fixed_domain_scene_measurement(
            decoded_pcm, lag_samples, segment, first, last, observed[0], notation,
        ) if result['status'] == 'inconclusive' else None
        result['measurement'] = held or {
            'method': 'domain_exact_scene_window', 'decoded_pcm_sha256': sha256(decoded_pcm),
            'start_sample': first, 'end_sample': last, 'scene_start_sample': first, 'scene_end_sample': last,
            'pcm_sha256': sha256(clip), 'normalization_evidence': result.get('measurement'),
        }
        return result
    except Exception:
        return None
    finally:
        if created:
            path.unlink(missing_ok=True)


def french_speech_outcome(segments, results):
    if any(item.get('reason') == 'mixed_language_boundary' for item in results):
        return {'status': 'inconclusive', 'reason': 'recognition_or_timing_inconclusive', 'segments': results}
    if not results or any(item['status'] != 'matched' for item in results):
        return {'status': 'inconclusive', 'reason': 'ordered_words_unconfirmed', 'segments': results}
    total_words = sum(item['expected_token_count'] for item in results)
    total_edits = sum(speech_edits(
        normalized_words(segment['id'], segment['text']), item['observed_words'],
    ) for segment, item in zip((segment for segment in segments if segment['id'] not in EXCLUDED_SEGMENTS), results))
    if not total_words or total_edits * 100 > total_words * (100 - MIN_GLOBAL_ACCURACY_PERCENT):
        return {'status': 'inconclusive', 'reason': 'ordered_words_unconfirmed', 'segments': results}
    return {'status': 'matched', 'segments': results}


def measure_final_french_speech(segments, decoded_pcm, waveform, directory, recognize=recognize_with_timeout,
                                recognize_phone=recognize_final_window, *, narration=None, preservation=None,
                                recognize_hook=recognize_final_window, recognize_services=recognize_final_window,
                                recognize_socials=recognize_final_window, recognize_domain=recognize_final_window):
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

        socials_check = None
        if preserved:
            socials_attempted = False
            def socials_check(parts, index, expected):
                nonlocal socials_attempted
                if socials_attempted:
                    return None
                socials_attempted = True
                return verify_socials_scene_samples(decoded_pcm, lag_samples, directory, parts, index,
                                                   expected, recognize_socials)

        domain_check = None
        if preserved:
            domain_attempted = False
            def domain_check(segment, expected):
                nonlocal domain_attempted
                if domain_attempted:
                    return None
                domain_attempted = True
                return verify_domain_scene_samples(decoded_pcm, lag_samples, directory, segment,
                                                   expected, recognize_domain)

        results = compare_french_segments(
            segments, recognize(wav_path), lag_samples,
            lambda start, end: verify_phone_with_context(decoded_pcm, lag_samples, directory, segments,
                                                       start, end, recognize_phone),
            verify_hook=hook_check, verify_services=services_check, verify_socials=socials_check, verify_domain=domain_check,
        )
    except ValueError:
        return {**result, 'reason': 'recognition_or_timing_inconclusive'}
    except Exception:
        # Model/cache/inference failure must preserve the prior audit, without
        # including provider diagnostics, spoken text or local paths in it.
        return {**result, 'reason': 'recognizer_unavailable'}
    return {**result, **french_speech_outcome(segments, results)}


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
