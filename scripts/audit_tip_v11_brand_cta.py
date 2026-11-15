"""Measure approved brand and contact pixels in selected frames of the final V11 MP4."""

import csv
import hashlib
import io
import math
import re
import subprocess
import unicodedata


CONTRACT = 'tip-v11-final-brand-cta-v1'
MASK = 'tip-v11-observed-short-feed-brand-20261114-v1'
MASK_BOUNDS = (120, 255, 870, 1511)
LOGO_SHA256 = '15f03f17e635c11c1d0c8087ee12e9f1176668c4f61c89ddc05644c740f4c34e'
WIDTH, HEIGHT, FPS = 1080, 1920, 30
LOGO_WIDTH, LOGO_HEIGHT = 176, 78
LOGO_CROP = (126, 250, 346, 370)
MAX_LOGO_MEAN_ERROR_MILLI = 22000
MAX_LOGO_TILE_ERROR_MILLI = 35000
MIN_OCR_CONFIDENCE_MILLI = 60000
# Fixed search windows from the 1080x1920 safe-feed fixture. Exact recognized
# word boxes, rather than these crops, are compared with the versioned mask.
OCR_TARGETS = {
    'cta_heading': ((128, 406, 730, 568), 6, 'Contactez Jamm Immo'),
    'domain': ((130, 710, 690, 814), 7, 'jammimmo.com'),
    'whatsapp': ((128, 967, 678, 1031), 7, 'WhatsApp appels messages'),
    'phone': ((128, 906, 706, 964), 7, '+221 76 944 48 49'),
    'brand_socials': ((132, 1056, 518, 1100), 7, 'Retrouvez Jamm Immo'),
    'brand_signature': ((132, 1056, 518, 1100), 7, 'Retrouvez Jamm Immo'),
}
FRAME_PLAN = (
    ('logo_intro', 'greeting', 0),
    ('cta_heading', 'domain', .4), ('domain', 'domain', .4),
    ('whatsapp', 'contact', .4), ('phone', 'phone', 0),
    ('brand_socials', 'socials', .4), ('brand_signature', 'signature', .4),
    ('logo_outro', 'signature', .4),
)


def digest(content):
    return hashlib.sha256(content).hexdigest()


def inside(inner, outer):
    return outer[0] <= inner[0] < inner[2] <= outer[2] and outer[1] <= inner[1] < inner[3] <= outer[3]


def sample_plan(alignment):
    if any(segment['id'] == 'assistant' for segment in alignment['segments']):
        return None
    segments = {segment['id']: segment for segment in alignment['segments']}
    def sample(identity, fade):
        part = segments[identity]
        first = math.ceil((part['start'] + fade) * FPS)
        last = min(alignment['durationInFrames'] - 1, math.ceil(part['end'] * FPS) - 1)
        if first > last or first < 0:
            raise ValueError('outro segment lacks a stable sample')
        frame = (first + last) // 2
        if not part['start'] + fade <= frame / FPS < part['end']:
            raise ValueError('sample does not fall in its stable scene')
        return frame
    return [(label, sample(segment, fade)) for label, segment, fade in FRAME_PLAN]


def run(name, args, *, data=None, timeout=35):
    return subprocess.run([name, *args], input=data, capture_output=True, check=True, timeout=timeout).stdout


def decode_frames(video, indices):
    ordered = sorted(set(indices))
    if not 1 <= len(ordered) <= len(FRAME_PLAN) or not all(type(frame) is int and 0 <= frame < 3600 for frame in ordered):
        raise ValueError('invalid visibility frame plan')
    select = '+'.join(f'eq(n\\,{frame})' for frame in ordered)
    frames = run('ffmpeg', ['-v', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-f', 'mov', '-i', str(video),
                            '-vf', f'select={select}', '-an', '-frames:v', str(len(ordered)), '-fps_mode', 'passthrough',
                            '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-threads', '2', '-'], timeout=45)
    frame_bytes = WIDTH * HEIGHT * 3
    if len(frames) != frame_bytes * len(ordered):
        raise ValueError('decoded visibility frames do not match the sample plan')
    return {number: memoryview(frames)[index * frame_bytes:(index + 1) * frame_bytes]
            for index, number in enumerate(ordered)}


def crop(frame, bounds):
    left, top, right, bottom = bounds
    return b''.join(frame[(y * WIDTH + left) * 3:(y * WIDTH + right) * 3] for y in range(top, bottom))


def opaque_logo_samples(logo_path):
    with logo_path.open('rb') as source:
        original = source.read(2 * 1024 * 1024 + 1)
    if len(original) > 2 * 1024 * 1024 or digest(original) != LOGO_SHA256:
        raise ValueError('unrecognized logo asset')
    rgba = run('ffmpeg', ['-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-i', '-',
                          '-vf', f'scale={LOGO_WIDTH}:{LOGO_HEIGHT}:flags=lanczos', '-frames:v', '1',
                          '-f', 'rawvideo', '-pix_fmt', 'rgba', '-threads', '1', '-'], data=original)
    if len(rgba) != LOGO_WIDTH * LOGO_HEIGHT * 4:
        raise ValueError('unexpected logo template shape')
    painted, samples = [], []
    for row in range(LOGO_HEIGHT):
        for column in range(LOGO_WIDTH):
            offset = (row * LOGO_WIDTH + column) * 4
            red, green, blue, alpha = rgba[offset:offset + 4]
            if alpha >= 20:
                painted.append((column, row))
            if column % 3 == 0 and alpha >= 240:
                bucket = (row // (LOGO_HEIGHT // 2)) * 4 + column // (LOGO_WIDTH // 4)
                samples.append((column, row, red, green, blue, bucket))
    if len(samples) < 500:
        raise ValueError('logo template lacks opaque landmarks')
    bounds = (min(x for x, _ in painted), min(y for _, y in painted),
              max(x for x, _ in painted) + 1, max(y for _, y in painted) + 1)
    return samples, bounds


def logo_check(frame, samples, painted):
    target = crop(frame, LOGO_CROP)
    left, top, right, _ = LOGO_CROP
    stride = right - left
    def errors(x, y):
        totals, counts = [0] * 8, [0] * 8
        for column, row, red, green, blue, bucket in samples:
            offset = ((row + y) * stride + column + x) * 3
            totals[bucket] += abs(target[offset] - red) + abs(target[offset + 1] - green) + abs(target[offset + 2] - blue)
            counts[bucket] += 3
        mean = round(sum(totals) * 1000 / sum(counts))
        worst = max(round(total * 1000 / count) for total, count in zip(totals, counts) if count >= 24)
        return mean, worst
    # The observed asset box begins at (137,263). Search only its pinned local
    # vicinity. Compare several parts of the pattern to catch partial occlusion.
    mean, worst, x, y = min((*errors(x, y), x, y) for x in range(7, 16) for y in range(9, 18))
    bounds = (left + x + painted[0], top + y + painted[1], left + x + painted[2], top + y + painted[3])
    passed = inside(bounds, MASK_BOUNDS) and mean <= MAX_LOGO_MEAN_ERROR_MILLI and worst <= MAX_LOGO_TILE_ERROR_MILLI
    return passed, bounds, {'kind': 'alpha_rgb_mae', 'mean_error_milli': mean, 'worst_tile_error_milli': worst}


def text_tokens(label, text):
    if label in ('domain', 'phone'):
        return ''.join(text.casefold().split())
    text = ''.join(character for character in unicodedata.normalize('NFKD', text).casefold()
                   if not unicodedata.combining(character))
    return ' '.join(re.findall(r'[^\W_]+', text))


def check_tsv(label, bounds, expected, raw):
    left, top, right, bottom = bounds
    words, boxes, confidences = [], [], []
    for row in csv.DictReader(io.StringIO(raw.decode('utf8')), delimiter='\t'):
        text = (row.get('text') or '').strip()
        if row['level'] != '5' or not text:
            continue
        x, y, width, height = (int(row[name]) for name in ('left', 'top', 'width', 'height'))
        box = (left + x, top + y, left + x + width, top + y + height)
        if not inside(box, bounds):
            raise ValueError('OCR box outside input crop')
        confidence = float(row['conf'])
        if not 0 <= confidence <= 100:
            raise ValueError('invalid OCR word confidence')
        words.append(text)
        boxes.append(box)
        confidences.append(round(confidence * 1000))
    union = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)) if boxes else None
    actual = text_tokens(label, ' '.join(words))
    expected = text_tokens(label, expected)
    minimum = min(confidences, default=0)
    passed = actual == expected and union is not None and inside(union, MASK_BOUNDS) and minimum >= MIN_OCR_CONFIDENCE_MILLI
    return passed, union, {'kind': 'exact_ocr', 'expected_sha256': digest(expected.encode()),
                            'observed_sha256': digest(actual.encode()), 'min_confidence_milli': minimum}


def text_check(frame, label, language):
    bounds, psm, expected = OCR_TARGETS[label]
    left, top, right, bottom = bounds
    pixels = crop(frame, bounds)
    kind = 'P6'
    if label == 'phone':
        # The active phone group changes colour. Fixed luminance and a crop
        # above its underline preserve every digit without changing geometry.
        pixels = bytes((77 * red + 150 * green + 29 * blue) >> 8
                       for red, green, blue in zip(pixels[::3], pixels[1::3], pixels[2::3]))
        kind = 'P5'
    pixels = f'{kind}\n{right - left} {bottom - top}\n255\n'.encode() + pixels
    raw = run('tesseract', ['stdin', 'stdout', '-l', language, '--psm', str(psm), 'tsv'], data=pixels, timeout=12)
    if len(raw) > 8192:
        raise ValueError('excessive visibility OCR output')
    return check_tsv(label, bounds, expected, raw)


def measure_final_brand_cta(video, alignment, logo_path, language):
    base = {'contract': CONTRACT, 'source': 'decoded_mp4_frames', 'mask': MASK, 'mask_bounds': MASK_BOUNDS,
            'logo_asset_sha256': LOGO_SHA256, 'language': language, 'status': 'inconclusive', 'checks': []}
    try:
        plan = sample_plan(alignment)
        if not plan:
            return {**base, 'reason': 'unsupported_assistant_outro'}
        frames = decode_frames(video, [frame for _, frame in plan])
        samples, logo_bounds = opaque_logo_samples(logo_path)
        results = []
        for label, frame in plan:
            if label.startswith('logo_'):
                passed, bounds, metric = logo_check(frames[frame], samples, logo_bounds)
            else:
                passed, bounds, metric = text_check(frames[frame], label, language)
            results.append({'label': label, 'frame': frame, 'status': 'matched' if passed else 'inconclusive',
                            'bounds': bounds, 'metric': metric})
        return {**base, 'checks': results,
                'status': 'matched' if all(row['status'] == 'matched' for row in results) else 'inconclusive'}
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        return {**base, 'reason': 'visibility_measurement_unavailable'}
