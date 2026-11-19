"""Measure caption and scene cues from the French V11 narration's word timings."""

import argparse
from array import array
import difflib
import json
import math
from numbers import Real
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
WORD_ALIGNMENT_METHOD = 'french-v11-word-anchors'
SIGNATURE_RETRY_ALIGNMENT_METHOD = 'french-v11-word-anchors-signature-retry'
SIGNATURE_PREROLL_SECONDS = .10
FIXED_SIGNATURE_TEXT = 'À bientôt ! Jamm Immo ! Kër gu baax, xel mu dal !'
GREETING_WINDOW_EVIDENCE = 'french-v11-pinned-greeting-window'
GREETING_WORDS = ['salam', 'alikoum', 'nanga', 'def']
MAX_GREETING_SECONDS = 4
MIN_ALIGNMENT_ANCHOR_PROBABILITY = .60
PHONE_WINDOW_EVIDENCE = 'french-v11-pinned-phone-window'
PHONE_WORDS = ['plus', *(word for group in NUMBER_WORDS.values() for word in group.split())]
PHONE_BOUNDARY_TOLERANCE_SECONDS = .10
SCENE_PREROLL_SECONDS = .08
AUDIBLE_WINDOW_SECONDS = .1
DEFERRED_DOMAIN_CHECKS = ('domain_audio', 'visible_domain_cta')
DOMAIN_BOUNDARY_METHOD = 'bounded-domain-anchors-final-mp4'


class AlignmentFailure(ValueError):
    """Only fixed call-site codes and bounded integer measurements leave the aligner."""

    def __init__(self, message, code, reason='alignment_evidence_invalid', **metrics):
        super().__init__(message)
        self.code = code
        self.reason = reason
        self.metrics = {key: min(360_000, max(0, value)) for key, value in metrics.items()
                        if type(value) is int}

    def diagnostics(self):
        return {'reason': self.reason, 'alignment_code': self.code, **self.metrics}


def milliseconds(seconds):
    if math.isfinite(seconds):
        return round(max(0, min(360, seconds)) * 1000)
    return None


class PhoneEvidenceError(AlignmentFailure):
    def __init__(self, gap, **metrics):
        super().__init__('Exact contact pronunciation not recognized: phone', 'phone_gap_unconfirmed',
                         'phone_evidence_unconfirmed', **metrics)
        self.gap = gap


class SignatureEvidenceError(AlignmentFailure):
    def __init__(self, preceding_end, matched_words, expected_words):
        super().__init__('Insufficient speech evidence: signature', 'signature_evidence_insufficient',
                         'signature_evidence_insufficient', matched_words=matched_words, expected_words=expected_words)
        self.preceding_end = preceding_end

    def diagnostics(self):
        return {**super().diagnostics(), 'alignment_code': self.reason}


def alignment_failure_diagnostics(error):
    if isinstance(error, AlignmentFailure):
        return error.diagnostics()
    # The command-line failure marker historically accepts plain ValueError too.
    reason, code = {
        'Exact contact pronunciation not recognized: phone': ('phone_evidence_unconfirmed', 'phone_gap_unconfirmed'),
        'Exact contact pronunciation not recognized: domain': ('website_evidence_unconfirmed', 'domain_unconfirmed'),
        'French speech differs substantially from the approved script': ('script_evidence_unconfirmed', 'script_coverage_low'),
    }.get(str(error), ('alignment_evidence_invalid', 'unclassified_value_error'))
    return {'reason': reason, 'alignment_code': code}


def report_alignment_failure(error, code_path=None):
    diagnostics = alignment_failure_diagnostics(error)
    print('V11 alignment: ' + json.dumps(diagnostics), file=sys.stderr)
    if code_path:
        try:
            Path(code_path).write_text(diagnostics['reason'] + '\n', encoding='utf8')
        except OSError:
            print('V11 alignment: failure marker unavailable', file=sys.stderr)


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


def has_audible_narration(samples):
    return bool(samples) and sum(sample * sample for sample in samples) > len(samples) * 135 ** 2


def audible_windows(pcm, sample_rate):
    samples = array('h')
    samples.frombytes(pcm)
    if sys.byteorder != 'little':
        samples.byteswap()
    window = int(sample_rate * AUDIBLE_WINDOW_SECONDS)
    for index in range(0, len(samples), window):
        chunk = samples[index:index + window]
        if has_audible_narration(chunk):
            yield (index / sample_rate, min(index + window, len(samples)) / sample_rate)


def quiet_scene_cut(sound, left_end, right_anchor):
    # An uncertain next word anchor can land inside speech. A unique quiet
    # gap next to the exact prior line end is better timing evidence.
    gaps = [
        (left[1], right[0]) for left, right in zip(sound, sound[1:])
        if -.1 <= left[1] - left_end <= .25 and right[0] - left[1] >= .3
        and -1.25 <= right[0] - right_anchor <= .75
    ]
    if len(gaps) != 1:
        return None
    start, end = gaps[0]
    cut = end - SCENE_PREROLL_SECONDS - AUDIBLE_WINDOW_SECONDS
    return cut if max(start, left_end) <= cut else None


def empty_phone_gap(segments, groups, index, offset, mapping, source_indices, words):
    if (index == 0 or index + 1 == len(segments) or groups[index] != PHONE_WORDS
        or segments[index - 1]['id'] != 'contact' or segments[index + 1]['id'] != 'socials'
        or len(groups[index - 1]) < 3 or len(groups[index + 1]) < 2):
        return None
    right_offset = offset + len(PHONE_WORDS)
    left = [mapping.get(i) for i in range(offset - 3, offset)]
    right = [mapping.get(i) for i in range(right_offset, right_offset + 2)]
    if any(value is None for value in left + right) or left + right != list(range(left[0], left[0] + 5)):
        return None
    before, after = source_indices[left[-1]], source_indices[right[0]]
    if before + 1 != after:
        return None
    start, end = words[before]['end'], words[after]['start']
    if not 0 < end - start <= 8:
        return None
    return after, start, end, groups[index - 1][-3:], groups[index + 1][:2]


def bounded_domain_boundary(segments, index, groups, offset, mapping, actual, stamps):
    """Locate the fixed CTA, without claiming its website words were heard.

    The standard prefix and the following contact sentence delimit at most
    four words ending in com. This permits an uncertain brand transcription
    to reach the final audio and visible-CTA checks, without inventing words
    or borrowing an anchor from another scene.
    """
    group = groups[index]
    if (index == 0 or index + 1 >= len(segments)
        or group != tokens('Retrouvez-nous sur notre site, jamm immo point com.')
        or segments[index - 1]['id'] not in ('tools', 'assistant')
        or segments[index + 1]['id'] != 'contact'):
        return False
    prefix = [mapping.get(offset + n) for n in range(5)]
    following = [mapping.get(offset + len(group) + n) for n in range(2)]
    last = mapping.get(offset + len(group) - 1)
    if (any(point is None for point in prefix + following) or last is None
        or prefix != list(range(prefix[0], prefix[0] + 5))
        or following != [last + 1, last + 2]
        or not 1 <= last - prefix[-1] <= 4
        or actual[prefix[-1] + 1:following[0]].count('com') != 1
        or actual[last] != 'com'):
        return False
    # These are timing bounds only. The final report remains responsible
    # for the complete spoken address and its actual visible rendering.
    return (0 < stamps[last][1] - stamps[prefix[0]][0] <= 8
            and 0 <= stamps[following[0]][0] - stamps[last][1] <= 1.25)


def align(segments, words, duration, audible=None, *, defer_domain=False, signature_boundary=None):
    if not math.isfinite(duration) or not 58.5 <= duration <= 119:
        raise AlignmentFailure('V11 narration must fit the 60–120 second master', 'duration_invalid', duration_ms=milliseconds(duration))
    if not words:
        raise AlignmentFailure('No French word timestamps', 'no_word_timestamps', row_count=0)

    actual = []
    stamps = []
    source_indices = []
    previous = 0
    for index, word in enumerate(words):
        start, end = word['start'], word['end']
        if not all(math.isfinite(v) for v in (start, end)):
            raise AlignmentFailure('Invalid narration timestamps', 'timestamp_nonfinite', row_index=index)
        if not previous <= start <= end <= duration + .1:
            if start < previous:
                code, difference = 'timestamp_regression', previous - start
            elif end < start:
                code, difference = 'timestamp_reversed', start - end
            else:
                code, difference = 'timestamp_overrun', end - duration
            raise AlignmentFailure('Invalid narration timestamps', code, row_index=index, span_ms=milliseconds(difference))
        previous = start
        recognized = tokens(word['word'])
        if recognized == ['jamm', 'immo'] and index + 1 < len(words) and re.match(r'^\s*\.\s*com\b', words[index + 1]['word'], re.I):
            recognized = [*recognized, 'point']
        for token in recognized:
            actual.append(token)
            stamps.append((start, end))
            source_indices.append(index)
    sound = stamps if audible is None else audible
    silence_message = 'V11 narration starts or ends with excessive silence'
    if not stamps:
        raise AlignmentFailure(silence_message, 'no_recognized_tokens', row_count=len(words))
    if not sound:
        raise AlignmentFailure(silence_message, 'no_audible_windows', row_count=len(words))
    if sound[0][0] > 2.5:
        raise AlignmentFailure(silence_message, 'leading_silence', span_ms=milliseconds(sound[0][0]))
    tail = duration - sound[-1][1]
    if tail > 2.5:
        raise AlignmentFailure(silence_message, 'trailing_silence', span_ms=milliseconds(tail))
    for left, right in zip(sound, sound[1:]):
        gap = right[0] - left[1]
        if gap > 3.25:
            raise AlignmentFailure('V11 narration contains a long pause', 'interior_pause', span_ms=milliseconds(gap))

    groups = [tokens(segment['text']) for segment in segments]
    for index, group in enumerate(groups):
        if not group:
            raise AlignmentFailure('Empty narration segment', 'empty_segment', segment_index=index)
    expected = [token for group in groups for token in group]
    matcher = difflib.SequenceMatcher(None, expected, actual, autojunk=False)
    if matcher.ratio() < .76:
        raise AlignmentFailure('French speech differs substantially from the approved script', 'script_coverage_low',
                               'script_evidence_unconfirmed', expected_words=len(expected), observed_words_count=len(actual),
                               ratio_permille=round(matcher.ratio() * 1000))
    mapping = {block.a + i: block.b + i for block in matcher.get_matching_blocks()
               for i in range(block.size)}

    anchors = []
    phone_groups = []
    preceding_social_end = None
    domain_deferred = False
    offset = 0
    for index, (segment, group) in enumerate(zip(segments, groups)):
        matched = [mapping[i] for i in range(offset, offset + len(group)) if i in mapping]
        identifier = segment['id']
        coverage = len(matched) / len(group)
        if identifier in ('phone', 'domain'):
            required = group if identifier == 'phone' else tokens('jamm immo point com')
            start = matched[0] if matched else 0
            end = matched[-1] + 1 if matched else 0
            first = next((i for i in range(start, end) if actual[i:i + len(required)] == required), None)
            if first is None:
                if identifier == 'phone':
                    raise PhoneEvidenceError(empty_phone_gap(segments, groups, index, offset, mapping, source_indices, words),
                                             segment_index=index, matched_words=len(matched), expected_words=len(group))
                if not defer_domain or not bounded_domain_boundary(
                        segments, index, groups, offset, mapping, actual, stamps):
                    raise AlignmentFailure(f'Exact contact pronunciation not recognized: {identifier}', 'domain_unconfirmed',
                                           'website_evidence_unconfirmed', segment_index=index, matched_words=len(matched),
                                           expected_words=len(group))
                domain_deferred = True
            if identifier == 'phone':
                cursor = first + 1  # skip the separately spoken international prefix “plus”
                for number in NUMBER_WORDS.values():
                    length = len(number.split())
                    phone_groups.append({'start': stamps[cursor][0], 'end': stamps[cursor + length - 1][1]})
                    cursor += length
        elif coverage < (.25 if identifier in ('greeting', 'signature') else .68):
            if identifier == 'signature':
                raise SignatureEvidenceError(preceding_social_end, len(matched), len(group))
            raise AlignmentFailure(f'Insufficient speech evidence: {identifier}', 'segment_coverage_low',
                                   segment_index=index, matched_words=len(matched), expected_words=len(group))
        if not matched:
            raise AlignmentFailure(f'No speech anchors: {identifier}', 'no_segment_anchors', segment_index=index)
        preceding_social_end = None
        if identifier == 'socials' and group[-2:] == ['prochains', 'conseils']:
            previous = mapping.get(offset + len(group) - 2)
            last = mapping.get(offset + len(group) - 1)
            if previous is not None and last == previous + 1:
                preceding_social_end = stamps[last][1]
        last = mapping.get(offset + len(group) - 1)
        penultimate = mapping.get(offset + len(group) - 2) if len(group) >= 2 else None
        ends_with_exact_pair = last is not None and penultimate == last - 1
        anchors.append((offset, stamps[matched[0]][0], mapping.get(offset), last, ends_with_exact_pair))
        offset += len(group)

    duration_in_frames = max(1801, math.ceil((duration + .6) * 30))
    end_of_video = duration_in_frames / 30
    scene_starts = [0]
    for scene, (left_anchor, right_anchor) in enumerate(zip(anchors, anchors[1:])):
        _, _, _, left_last, exact_end = left_anchor
        _, right_start, right_first, _, _ = right_anchor
        start = max(0, right_start - SCENE_PREROLL_SECONDS)
        if left_last is not None:
            left_end = stamps[left_last][1]
            # Preroll belongs in the gap before the next line.
            if right_first == left_last + 1 and left_end <= right_start:
                start = max(start, left_end)
            elif (left_end == signature_boundary and exact_end and right_first == left_last + 1
                  and segments[scene]['id'] == 'socials' and segments[scene + 1]['id'] == 'signature'
                  and groups[scene][-2:] == ['prochains', 'conseils'] and groups[scene + 1][:2] == ['a', 'bientot']
                  and 0 < left_end - right_start <= SIGNATURE_PREROLL_SECONDS + .001
                  and stamps[right_first][1] > left_end + .05
                  and sum(pair == ('prochains', 'conseils') for pair in zip(actual, actual[1:])) == 1):
                # The focused opening word can start at the crop's preroll.
                # Keep the independently anchored final word of the prior scene whole.
                start = left_end
            elif exact_end and audible is not None:
                pause_cut = quiet_scene_cut(sound, left_end, right_start)
                if pause_cut is not None:
                    start = pause_cut
        scene_starts.append(start)
    scene_ends = [*scene_starts[1:], end_of_video]
    timed_segments, captions = [], []
    for scene, (segment, anchor, start, end) in enumerate(zip(segments, anchors, scene_starts, scene_ends)):
        if end - start < .65:
            raise AlignmentFailure(f'Unusable scene timing: {segment["id"]}', 'scene_too_short',
                                   segment_index=scene, span_ms=milliseconds(end - start))
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
        for index, (chunk, left, right) in enumerate(zip(chunks, chunk_starts, [*chunk_starts[1:], end])):
            if right - left < .15:
                raise AlignmentFailure(f'Unusable caption timing: {segment["id"]}', 'caption_too_short',
                                       segment_index=scene, chunk_index=index, span_ms=milliseconds(right - left))
            captions.append({'text': chunk, 'start': left, 'end': right})

    return {'segments': timed_segments, 'captions': captions, 'durationInFrames': duration_in_frames,
            'method': WORD_ALIGNMENT_METHOD, 'reviewRequired': True,
            'phoneGroups': phone_groups,
            **({'domainEvidenceMethod': DOMAIN_BOUNDARY_METHOD,
                'deferredChecks': list(DEFERRED_DOMAIN_CHECKS)} if domain_deferred else {}),
            'listenFor': ['greeting and signature in Wolof', 'voice and accent']}


def canonical_signature_brand(tail, sound, duration, *, dakar=False):
    """Canonicalize two timed rows only within the fixed French closing phrase."""
    words = [tokens(row['word']) for row in tail]
    first_forms = (['djam'], ['jam'], ['jamm']) if dakar else (['jam'], ['jamm'])
    pairs = [i for i in range(len(tail) - 1)
             if words[i] in first_forms and words[i + 1] in (['imo'], ['immo'])]
    if len(pairs) != 1:
        return None
    i = pairs[0]
    first, second = tail[i:i + 2]
    if ([token for group in words[:i] for token in group] != ['a', 'bientot']
        or words[i:i + 2] == [['jamm'], ['immo']]
        or not 0 <= second['start'] - first['end'] <= .101):
        return None
    if dakar:
        if (i != 2 or words[:2] != [['a'], ['bientot']]
            or not re.fullmatch(r'djam[.,!?]?', first['word'].strip(), re.I)
            or not re.fullmatch(r'imo[.,!?]?', second['word'].strip(), re.I)
            or not supported_anchor_rows(tail[:4], sound, duration, weak_first=True)
            or sum(left == ['a'] and right == ['bientot'] for left, right in zip(words, words[1:])) != 1):
            return None
    elif tokens(first['word'] + ' ' + second['word']) != ['jamm', 'immo']:
        return None

    # Keep distinct time ownership, including the farewell before the brand.
    # The focused decoder may start up to one preroll before the scene boundary.
    previous_end = 0
    for row in tail:
        if not previous_end <= row['start'] < row['end'] <= duration + .1:
            return None
        previous_end = row['end']
    # An isolated French ending or words hypothesized over silence do not
    # establish continuation. This does not certify the Wolof words.
    continuation = [row for row, group in zip(tail[i + 2:], words[i + 2:]) if group]
    if (len(continuation) < 2 or voiced_overlap(sound, second['end'], continuation[-1]['end']) < .9
        or any(voiced_overlap(sound, row['start'], row['end']) <= 0 for row in continuation)):
        return None
    return [*tail[:i], {**first, 'word': 'jamm'}, {**second, 'word': 'immo'}, *tail[i + 2:]]


def corroborated_dakar_signature(segments, words, split, focused, boundary, sound, duration):
    """Only the two French brand rows receive canonical spelling, on one measured tail."""
    if (segments[-1]['text'] != FIXED_SIGNATURE_TEXT or segments[-2]['id'] != 'socials'
        or not 0 < split < len(words) or words[split - 1]['end'] != boundary
        or words[split]['start'] < boundary):
        return None
    observed = [token for row in words for token in tokens(row['word'])]
    if sum(pair == ('prochains', 'conseils') for pair in zip(observed, observed[1:])) != 1:
        return None
    full = canonical_signature_brand(words[split:], sound, duration, dakar=True)
    window = canonical_signature_brand(focused, sound, duration, dakar=True)
    if full is None or window is None:
        return None
    # Each pair is recognized in its entirety on the same recording. Require
    # corresponding brand rows to overlap in source time across the two decodes.
    if any(max(a['start'], b['start']) >= min(a['end'], b['end']) for a, b in zip(full[2:4], window[2:4])):
        return None
    return window


def align_with_signature_retry(segments, words, duration, sound, recognize_tail, *, defer_domain=False):
    try:
        return align(segments, words, duration, sound, defer_domain=defer_domain)
    except SignatureEvidenceError as error:
        boundary = error.preceding_end
        if boundary is None or not 1.2 <= duration - boundary <= 8 or segments[-1]['id'] != 'signature':
            error.reason = 'signature_boundary_unconfirmed'
            raise
        voiced_tail = sum(max(0, end - max(start, boundary + .15)) for start, end in sound)
        if voiced_tail < .9:
            error.reason = 'signature_tail_too_quiet'
            raise
        # Use the full recording's own closing rows if they form a complete
        # suffix after the measured socials endpoint. Keep every original row.
        split = next((i for i, word in enumerate(words) if word['end'] > boundary), len(words))
        if (0 < split < len(words) and words[split - 1]['end'] == boundary
            and words[split]['start'] >= boundary):
            full_tail = canonical_signature_brand(words[split:], sound, duration)
            if full_tail is not None:
                try:
                    return align(segments, words[:split] + full_tail, duration, sound, defer_domain=defer_domain)
                except AlignmentFailure:
                    # The originally eligible focused retry still runs.
                    pass
        # Keep the original French body and exact contact evidence. A second
        # decode is useful only if the cropped audio supplies a closing anchor.
        tail = [word for word in recognize_tail(boundary)
                if word['start'] >= boundary - SIGNATURE_PREROLL_SECONDS - .001 and word['end'] > boundary + .05]
        closing = tokens(' '.join(word['word'] for word in tail))
        if not any(closing[index:index + 2] in (['a', 'bientot'], ['jamm', 'immo'])
                   for index in range(len(closing) - 1)):
            error.reason = 'signature_closing_unrecognized'
            raise
        original = [word for word in words if word['end'] <= boundary + .001]
        try:
            alignment = align(segments, original + tail, duration, sound, defer_domain=defer_domain,
                              signature_boundary=boundary)
        except SignatureEvidenceError as retry_error:
            retry_error.reason = 'signature_retry_insufficient'
            # The closing gate tokenizes the joined words; align tokenizes each
            # timed row separately. Recheck this one known split spelling on
            # the same focused decode, without borrowing full-pass words.
            normalized_tail = canonical_signature_brand(tail, sound, duration)
            if normalized_tail is None:
                normalized_tail = corroborated_dakar_signature(segments, words, split, tail, boundary, sound, duration)
            if normalized_tail is None:
                raise
            try:
                alignment = align(segments, original + normalized_tail, duration, sound, defer_domain=defer_domain,
                                  signature_boundary=boundary)
            except SignatureEvidenceError as normalized_error:
                normalized_error.reason = 'signature_retry_insufficient'
                raise
        alignment['method'] = SIGNATURE_RETRY_ALIGNMENT_METHOD
        return alignment


def timed_phone_window(words, start, end, contact, socials):
    tokens_with_indices = []
    previous_start = previous_end = start - .10
    for index, word in enumerate(words):
        if not isinstance(word, dict) or not isinstance(word.get('word'), str):
            return None
        first, last = word.get('start'), word.get('end')
        if (type(first) not in (float, int) or type(last) not in (float, int)
            or not math.isfinite(first) or not math.isfinite(last)
            or not previous_start <= first < last <= end + .10 or last < previous_end):
            return None
        tokens_with_indices.extend((token, index) for token in tokens(word['word']))
        previous_start, previous_end = first, last
    observed = [token for token, _ in tokens_with_indices]
    matches = [i for i in range(len(observed)) if observed[i:i + len(PHONE_WORDS)] == PHONE_WORDS]
    if len(matches) != 1:
        return None
    first = matches[0]
    end_match = first + len(PHONE_WORDS)
    # The decoder can hear the ends of the surrounding sentences in the
    # padding. Preserve the full-pass words, and reject every other intrusion.
    before, after = observed[:first], observed[end_match:]
    if (before and (len(before) > len(contact) or before != contact[-len(before):])
        or after != socials[:len(after)]):
        return None
    first_word = tokens_with_indices[first][1]
    last_word = tokens_with_indices[end_match - 1][1]
    if (first and tokens_with_indices[first - 1][1] == first_word
        or end_match < len(observed) and tokens_with_indices[end_match][1] == last_word):
        return None
    return words[first_word:last_word + 1]


def voiced_overlap(sound, start, end):
    return sum(max(0, min(end, right) - max(start, left)) for left, right in sound)


def supported_anchor_rows(rows, sound, end, *, weak_first=False):
    previous = 0
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or not isinstance(row.get('word'), str):
            return False
        start, last, probability = (row.get(key) for key in ('start', 'end', 'probability'))
        if (any(type(v) not in (int, float) or not math.isfinite(v) for v in (start, last, probability))
            or not previous <= start < last <= end or not 0 <= probability <= 1
            or (not weak_first or index != 0) and probability < MIN_ALIGNMENT_ANCHOR_PROBABILITY
            or voiced_overlap(sound, start, last) <= 0):
            return False
        previous = last
    return True


def missing_greeting_boundary(segments, words, duration, sound):
    if (len(segments) < 2 or [s['id'] for s in segments[:2]] != ['greeting', 'hook']
        or tokens(segments[0]['text']) != GREETING_WORDS or len(words) < 3 or not sound):
        return None
    hook = tokens(segments[1]['text'])[:3]
    if (len(hook) != 3 or not supported_anchor_rows(words[:3], sound, duration, weak_first=True)
        or [tokens(row['word']) for row in words[:3]] != [[word] for word in hook]
        or not 0 < words[0]['start'] <= MAX_GREETING_SECONDS):
        return None
    expected = [token for part in segments for token in tokens(part['text'])]
    actual = [token for row in words for token in tokens(row['word'])]
    if any(sum(seq[i:i+3] == hook for i in range(len(seq)-2)) != 1 for seq in (expected, actual)):
        return None
    boundary = words[0]['start']
    return boundary if voiced_overlap(sound, 0, boundary) > 0 else None


def measured_greeting(rows, boundary, sound):
    if not isinstance(rows, list) or not 3 <= len(rows) <= 4 or not supported_anchor_rows(rows, sound, boundary):
        return False
    groups = [tokens(row['word']) for row in rows]
    if any(len(group) != 1 for group in groups[:-1]) or (len(groups[-1]) != 1 and groups[-1] != ['nanga', 'def']):
        return False
    observed = [token for group in groups for token in group]
    # Credit only exact positional anchors. One independently timed spelling can
    # remain unmatched; three of four exact anchors necessarily span both clauses.
    return len(observed) == len(GREETING_WORDS) and sum(a == b for a, b in zip(observed, GREETING_WORDS)) >= 3


def align_with_phone_retry(segments, words, duration, sound, recognize_tail, recognize_phone, *,
                           defer_domain=False, recognize_greeting=None):
    def remaining(full_words):
        return _align_with_phone_retry(segments, full_words, duration, sound, recognize_tail, recognize_phone,
                                       defer_domain=defer_domain)

    try:
        return remaining(words)
    except AlignmentFailure as error:
        if (recognize_greeting is None or error.code != 'segment_coverage_low'
            or error.metrics != {'segment_index': 0, 'matched_words': 0, 'expected_words': 4}):
            raise
        boundary = missing_greeting_boundary(segments, words, duration, sound)
        if boundary is None:
            raise
        prefix = recognize_greeting(boundary)
        if not measured_greeting(prefix, boundary, sound):
            raise

    # Every full-pass row keeps its original text, confidence and interval.
    # The ordinary global, phone, signature and scene timing gates apply anew.
    result = remaining([*prefix, *words])
    result['greetingEvidenceMethod'] = GREETING_WINDOW_EVIDENCE
    return result


def _align_with_phone_retry(segments, words, duration, sound, recognize_tail, recognize_phone, *, defer_domain):
    try:
        return align_with_signature_retry(segments, words, duration, sound, recognize_tail, defer_domain=defer_domain)
    except PhoneEvidenceError as error:
        if error.gap is None:
            raise
        index, start, end, contact, socials = error.gap
        if not sound or voiced_overlap(sound, start, end) < .9:
            error.code = 'phone_gap_quiet'
            raise
        # End at the proven next sentence, so the decoder does not have to
        # interpret a cut-off word from that sentence as part of the number.
        clip_start, clip_end = max(0, start - .44), end
        focused = timed_phone_window(recognize_phone(clip_start, clip_end), clip_start, clip_end, contact, socials)
        tolerance = PHONE_BOUNDARY_TOLERANCE_SECONDS
        if not focused:
            error.code = 'phone_window_unconfirmed'
            raise
        if focused[0]['start'] < start - tolerance:
            error.code = 'phone_window_early'
            raise
        if focused[-1]['end'] > end + tolerance:
            error.code = 'phone_window_late'
            raise
        if any(voiced_overlap(sound, word['start'], word['end']) <= 0 for word in focused):
            error.code = 'phone_window_unvoiced'
            raise
        merged = [*words[:index], *focused, *words[index:]]
        alignment = align_with_signature_retry(segments, merged, duration, sound, recognize_tail, defer_domain=defer_domain)
        alignment['phoneEvidenceMethod'] = PHONE_WINDOW_EVIDENCE
        return alignment


def recognize_words(model, wav_path, beam_size, time_offset=0):
    result, _ = model.transcribe(str(wav_path), language='fr', beam_size=beam_size,
                                 word_timestamps=True, condition_on_previous_text=False)
    rows = []
    for segment in result:
        for word in segment.words:
            row = {'word': word.word, 'start': float(word.start) + time_offset, 'end': float(word.end) + time_offset}
            probability = getattr(word, 'probability', None)
            if isinstance(probability, Real) and not isinstance(probability, bool):
                row['probability'] = float(probability)
            rows.append(row)
    return rows


def recognize_audio_window(model, wav_path, start, end=None, *, end_before=False):
    with TemporaryDirectory(prefix='tip-v11-window-') as directory:
        clip = str(Path(directory) / 'excerpt.wav')
        with wave.open(wav_path, 'rb') as source, wave.open(clip, 'wb') as target:
            rate = source.getframerate()
            first_frame = max(0, math.floor(start * rate))
            round_end = math.floor if end_before else math.ceil
            final_frame = source.getnframes() if end is None else min(source.getnframes(), round_end(end * rate))
            source.setpos(first_frame)
            target.setparams(source.getparams())
            target.writeframes(source.readframes(final_frame - first_frame))
        return recognize_words(model, clip, beam_size=5, time_offset=first_frame / rate)


def recognize_signature_tail(model, wav_path, boundary):
    return recognize_audio_window(model, wav_path, boundary - SIGNATURE_PREROLL_SECONDS)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--wav', required=True)
    parser.add_argument('--spec', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--transcript', help='Premeasured local QA word timings')
    parser.add_argument('--failure-code-file', help='Write an allowlisted classification for a failed render')
    parser.add_argument('--defer-domain-to-final', action='store_true',
                        help='Locate a bounded standard domain CTA; final MP4 audio and visible checks remain required')
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
        alignment = align(spec['segments'], words, duration, sound, defer_domain=args.defer_domain_to_final)
        alignment['provenance'] = 'local-word-timings'
    else:
        from faster_whisper import WhisperModel, download_model
        model_path = download_model(ASR_REPO, revision=ASR_REVISION)
        model = WhisperModel(model_path, device='cpu', compute_type='int8',
                             local_files_only=True, cpu_threads=4)
        words = recognize_words(model, args.wav, beam_size=1)
        try:
            alignment = align_with_phone_retry(
                spec['segments'], words, duration, sound,
                lambda boundary: recognize_signature_tail(model, args.wav, boundary),
                lambda start, end: recognize_audio_window(model, args.wav, start, end),
                defer_domain=args.defer_domain_to_final,
                recognize_greeting=lambda boundary: recognize_audio_window(model, args.wav, 0, boundary, end_before=True),
            )
        except ValueError as error:
            report_alignment_failure(error, args.failure_code_file)
            raise
        alignment['provenance'] = ASR_REVISION
        if alignment.get('phoneEvidenceMethod') == PHONE_WINDOW_EVIDENCE:
            print('V11 phone number recovered by localized speech alignment')
        if alignment['method'] == SIGNATURE_RETRY_ALIGNMENT_METHOD:
            print('V11 signature recovered by localized speech alignment; manual review still required')
    with open(args.output, 'w', encoding='utf8') as target:
        json.dump(alignment, target, ensure_ascii=False)


if __name__ == '__main__':
    main()
