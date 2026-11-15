"""Measure objective evidence from an existing V11 MP4 without calling a provider."""

import argparse
from array import array
import base64
import hashlib
import io
from itertools import zip_longest
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory
import unicodedata
import wave

from align_tip_v11 import (
    ASR_REVISION, PHONE_WINDOW_EVIDENCE, SIGNATURE_RETRY_ALIGNMENT_METHOD, WORD_ALIGNMENT_METHOD, has_audible_narration,
)
from audit_tip_v11_brand_cta import measure_final_brand_cta
from audit_tip_v11_speech import measure_final_french_speech


SAMPLE_RATE = 24_000
FPS = 30
MAX_VIDEO_BYTES = 50 * 1024 * 1024
MAX_PCM_SECONDS = 121
MAX_LAG_SAMPLES = 1_440
CAPTION_SCENES = ('greeting', 'hook', 'step1', 'step2', 'step3', 'takeaway')
SEGMENT_IDS = (*CAPTION_SCENES, 'services', 'tools', 'domain', 'contact', 'phone', 'socials', 'signature')
# Actual MP4 pixels after the short-feed composition's translate and scale.
# Include the full caption card above the 1515px feed line with padding.
CAPTION_WIDTH, CAPTION_HEIGHT = 746, 162
CAPTION_CROP = f'{CAPTION_WIDTH}:{CAPTION_HEIGHT}:128:1372'
CONTACT_CROPS = {'domain': '560:104:130:710', 'phone': '578:74:128:898', 'brand': '386:44:132:1056'}
AUDIO_PRESERVATION_CONTRACT = 'tip-v11-final-audio-preservation-v1'
AUDIO_PRESERVATION_WINDOW = SAMPLE_RATE // 50
AUDIO_PRESERVATION_HOP = SAMPLE_RATE // 100
AUDIO_PRESERVATION_FLOOR = 20
AUDIO_PRESERVATION_RMS_RATIO = .18


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def limited_read(path, limit):
    with path.open('rb') as source:
        data = source.read(limit + 1)
    if not data or len(data) > limit:
        raise ValueError('Missing or oversized audit input')
    return data


def snapshot_video(source, snapshot):
    digest = hashlib.sha256()
    size = 0
    with source.open('rb') as original, snapshot.open('xb') as copy:
        while chunk := original.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_VIDEO_BYTES:
                raise ValueError('V11 MP4 exceeds 50 MiB')
            digest.update(chunk)
            copy.write(chunk)
    if not size:
        raise ValueError('V11 MP4 is empty')
    return digest.hexdigest(), size


def command(name, *args, data=None):
    return subprocess.run(
        [name, *args], input=data, capture_output=True, check=True, timeout=45,
    ).stdout


def media_shape(video, duration_frames):
    probe = json.loads(command(
        'ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', 'mov', '-show_entries',
        'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate', '-of', 'json', video,
    ))
    video_streams = [stream for stream in probe['streams'] if stream['codec_type'] == 'video']
    audio_streams = [stream for stream in probe['streams'] if stream['codec_type'] == 'audio']
    duration = float(probe['format']['duration'])
    passed = (
        len(video_streams) == len(audio_streams) == 1
        and video_streams[0].get('codec_name') == 'h264'
        and video_streams[0].get('width') == 1080 and video_streams[0].get('height') == 1920
        and video_streams[0].get('r_frame_rate') == '30/1'
        and audio_streams[0].get('codec_name') == 'aac'
        and 60 < duration <= 120 and abs(duration - duration_frames / FPS) <= .12
    )
    return {'passed': passed, 'duration_seconds': duration, 'video_streams': video_streams, 'audio_streams': audio_streams}


def pcm(data):
    samples = array('h')
    samples.frombytes(data)
    if sys.byteorder != 'little':
        samples.byteswap()
    return samples


def wave_pcm(data):
    with wave.open(io.BytesIO(data), 'rb') as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (1, 2, SAMPLE_RATE):
            raise ValueError('V11 WAV must be 24 kHz mono PCM16')
        return pcm(source.readframes(source.getnframes()))


def read_wave(path):
    data = limited_read(path, MAX_PCM_SECONDS * SAMPLE_RATE * 2 + 4096)
    return wave_pcm(data), sha256(data)


def similarity(reference, final, start, end, lag, stride=8):
    start = max(start, -lag)
    end = min(end, len(reference), len(final) - lag)
    if end <= start:
        return 0.0, 0.0, 0.0
    ref_power = final_power = product = 0
    for index in range(start, end, stride):
        left, right = reference[index], final[index + lag]
        ref_power += left * left
        final_power += right * right
        product += left * right
    rms = math.sqrt(ref_power / len(range(start, end, stride)))
    if not ref_power or not final_power:
        return 0.0, 0.0, rms
    return product / math.sqrt(ref_power * final_power), math.sqrt(final_power / ref_power), rms


def find_lag(reference, final):
    # A bounded one-time offset accounts for AAC priming. Every later window
    # must agree at that same offset so drift cannot be hidden by realignment.
    start, end = SAMPLE_RATE // 5, SAMPLE_RATE * 2
    best = max(range(-MAX_LAG_SAMPLES, MAX_LAG_SAMPLES + 1, 12),
               key=lambda lag: similarity(reference, final, start, end, lag, 24)[0])
    return max(range(max(-MAX_LAG_SAMPLES, best - 11), min(MAX_LAG_SAMPLES, best + 11) + 1),
               key=lambda lag: similarity(reference, final, start, end, lag)[0])


def signature_tail_matches(narration, final, start, end, lag):
    # A quiet ending can fall below the mixed-audio floor of the 250 ms checks.
    # Measure the last audible narration window using the alignment grid and
    # the same lag as the rest of the render. This scene has no sound effect.
    window_size = SAMPLE_RATE // 10
    voice_end = min(end, len(narration))
    first_window = start - start % window_size
    for offset in reversed(range(first_window, voice_end, window_size)):
        left, right = max(start, offset), min(offset + window_size, voice_end)
        if has_audible_narration(narration[left:right]):
            if left + lag < 0 or right + lag > len(final):
                return False
            score, gain, _ = similarity(narration, final, left, right, lag)
            return score >= .94 and .65 <= gain <= 1.20
    return False


def measure_audio(segments, narration, mix, final):
    lag = find_lag(mix, final)
    window_size = SAMPLE_RATE // 4
    results = []
    for segment in segments:
        start = round(segment['start'] * SAMPLE_RATE)
        end = round(segment['end'] * SAMPLE_RATE)
        voice_score, voice_gain, _ = similarity(narration, final, start, end, lag)
        windows = [
            similarity(mix, final, offset, min(offset + window_size, end), lag)
            for offset in range(start, end, window_size)
        ]
        audible = [(score, gain) for score, gain, rms in windows if rms >= 800]
        # The encoded stereo-to-mono path can preserve a waveform at −3 dB.
        # Keep that case while rejecting attenuated or missing narration.
        passed = (
            voice_score >= .96 and .65 <= voice_gain <= 1.15 and bool(audible)
            and all(score >= .94 and .65 <= gain <= 1.20 for score, gain in audible)
            and (segment['id'] != 'signature' or signature_tail_matches(narration, final, start, end, lag))
        )
        results.append({
            'segment': segment['id'], 'passed': passed,
            'narration_similarity': round(voice_score, 5),
            'narration_gain_ratio': round(voice_gain, 5),
            'audible_mix_windows': len(audible),
            'min_audible_mix_similarity': round(min((score for score, _ in audible), default=0), 5),
        })
    return {
        'passed': abs(len(final) - len(mix)) <= SAMPLE_RATE // 8 and all(result['passed'] for result in results),
        'sample_rate': SAMPLE_RATE, 'lag_samples': lag, 'segments': results,
    }


def render_audit_effects(alignment):
    module_url = Path(__file__).with_name('tip-v11-effects.mjs').resolve().as_uri()
    cue_inputs = {
        'segments': [{'id': row['id'], 'start': row['start']} for row in alignment['segments']],
        'durationInFrames': alignment['durationInFrames'],
    }
    return command('node', '--input-type=module', '-e', """
import { readFileSync } from 'node:fs';
const { tipV11Effects } = await import(process.argv[1]);
const { segments, durationInFrames } = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(tipV11Effects(segments, durationInFrames));
""", module_url, data=json.dumps(cue_inputs).encode())


def measure_audio_preservation(alignment, narration, mix, decoded_pcm, lag, effects=render_audit_effects):
    """Check which samples survived the mux. Only a lexical test can verify the spoken words."""
    result = {
        'contract': AUDIO_PRESERVATION_CONTRACT, 'status': 'inconclusive', 'sample_rate': SAMPLE_RATE,
        'window_samples': AUDIO_PRESERVATION_WINDOW, 'hop_samples': AUDIO_PRESERVATION_HOP,
        'absolute_rms_floor_pcm16': AUDIO_PRESERVATION_FLOOR,
        'relative_rms_limit_ppm': round(AUDIO_PRESERVATION_RMS_RATIO * 1_000_000),
        'decoded_pcm_sha256': sha256(decoded_pcm), 'lag_samples': lag, 'speech_recognition_evaluated': False,
    }
    if len(decoded_pcm) % 2:
        return {**result, 'reason': 'incomplete_aligned_samples'}
    final = pcm(decoded_pcm)
    if (type(lag) is not int or not 0 <= lag <= MAX_LAG_SAMPLES
        or not AUDIO_PRESERVATION_WINDOW <= len(mix) <= MAX_PCM_SECONDS * SAMPLE_RATE
        or not 0 < len(narration) <= len(mix)
        or not lag + len(mix) <= len(final) <= lag + len(mix) + SAMPLE_RATE // 8):
        return {**result, 'reason': 'incomplete_aligned_samples'}

    try:
        effects_wav = effects(alignment)
        accents = wave_pcm(effects_wav)
    except (OSError, EOFError, ValueError, wave.Error, subprocess.SubprocessError):
        return {**result, 'reason': 'canonical_mix_unavailable'}
    if len(accents) != len(mix) or any(
        sample != voice + accent for sample, (voice, accent)
        in zip(mix, zip_longest(narration, accents, fillvalue=0))
    ):
        return {**result, 'reason': 'canonical_mix_differs'}
    result['effects_wav_sha256'] = sha256(effects_wav)

    end = lag + len(mix)
    if any(abs(sample) > AUDIO_PRESERVATION_FLOOR for edge in (final[:lag], final[end:]) for sample in edge):
        return {**result, 'reason': 'unexpected_padding_audio'}
    aligned = final[lag:end]
    power = sum(sample * sample for sample in mix)
    gain = sum(reference * observed for reference, observed in zip(mix, aligned)) / power if power else 0
    result['gain_ppm'] = round(gain * 1_000_000)
    if not .65 <= gain <= 1.15:
        return {**result, 'reason': 'gain_outside_range'}

    window = AUDIO_PRESERVATION_WINDOW
    last = len(mix) - window
    offsets = list(range(0, last + 1, AUDIO_PRESERVATION_HOP))
    if offsets[-1] != last:
        offsets.append(last)
    worst = 0.0
    failed = 0
    for offset in offsets:
        expected = [sample * gain for sample in mix[offset:offset + window]]
        reference_rms = math.sqrt(sum(sample * sample for sample in expected) / window)
        residual = math.sqrt(sum((observed - reference) ** 2 for reference, observed
                                 in zip(expected, aligned[offset:offset + window])) / window)
        ratio = residual / max(AUDIO_PRESERVATION_FLOOR, AUDIO_PRESERVATION_RMS_RATIO * reference_rms)
        worst = max(worst, ratio)
        failed += ratio > 1
    return {
        **result, 'status': 'inconclusive' if failed else 'matched',
        'windows_checked': len(offsets), 'windows_over_limit': failed,
        'worst_residual_to_limit_ppm': math.ceil(worst * 1_000_000),
        **({'reason': 'local_sample_residual_over_limit'} if failed else {}),
    }


def verify_alignment(data):
    alignment = json.loads(data)
    if not isinstance(alignment, dict):
        raise ValueError('Invalid V11 alignment identity')
    method = alignment.get('method')
    if method not in (WORD_ALIGNMENT_METHOD, SIGNATURE_RETRY_ALIGNMENT_METHOD):
        raise ValueError('Invalid V11 alignment identity')
    if 'phoneEvidenceMethod' in alignment and alignment['phoneEvidenceMethod'] != PHONE_WINDOW_EVIDENCE:
        raise ValueError('Invalid V11 alignment identity')
    if method == SIGNATURE_RETRY_ALIGNMENT_METHOD or 'phoneEvidenceMethod' in alignment:
        if alignment.get('provenance') != ASR_REVISION or alignment.get('reviewRequired') is not True:
            raise ValueError('Invalid V11 alignment identity')
    duration = alignment.get('durationInFrames')
    if type(duration) is not int or not 1800 < duration <= 3600:
        raise ValueError('Invalid V11 alignment identity or duration')
    segments = alignment.get('segments')
    captions = alignment.get('captions')
    if not all(isinstance(rows, list) and all(isinstance(row, dict) for row in rows)
               for rows in (segments, captions)):
        raise ValueError('Invalid V11 alignment rows')
    if len(segments) not in (13, 14) or tuple(segment['id'] for segment in segments if segment['id'] != 'assistant') != SEGMENT_IDS:
        raise ValueError('V11 alignment segment identities differ')
    if sum(segment['id'] == 'assistant' for segment in segments) > 1 or not 1 <= len(captions) <= 100:
        raise ValueError('Invalid V11 alignment row counts')
    for rows in (segments, captions):
        previous = 0
        for row in rows:
            start, end = row['start'], row['end']
            if (not all(type(value) in (int, float) and math.isfinite(value) for value in (start, end))
                or not 0 <= start < end <= duration / FPS + .01 or abs(start - previous) > .001
                or not isinstance(row['text'], str) or not 1 <= len(row['text']) <= 300):
                raise ValueError('Invalid V11 alignment row')
            previous = end
        if abs(previous - duration / FPS) > .01:
            raise ValueError('Incomplete V11 alignment timeline')
    return alignment


def normalized_words(value):
    text = unicodedata.normalize('NFKD', value).casefold()
    text = ''.join(character for character in text if not unicodedata.combining(character))
    return ' '.join(re.findall(r'[a-z0-9]+', text))


def normalized_ocr_text(identity, value):
    if identity in ('domain', 'phone'):
        return re.sub(r'\s+', '', value.casefold())
    return normalized_words(value)


def high_contrast_caption(image, threshold):
    signature, shape, depth, pixels = image.split(b'\n', 3)
    if (signature != b'P5' or shape != f'{CAPTION_WIDTH} {CAPTION_HEIGHT}'.encode() or depth != b'255'
            or len(pixels) != CAPTION_WIDTH * CAPTION_HEIGHT):
        raise ValueError('Unexpected OCR frame layout')
    # Rendered V11 captions use light text on a dark card. Convert the
    # captured pixels to dark-on-white without changing character geometry.
    lookup = bytes(255 if value < threshold else 0 for value in range(256))
    return b'\n'.join((signature, shape, depth, pixels.translate(lookup)))


def frame_at(start, end, portion=.5):
    return round((start + (end - start) * portion) * FPS)


def measure_text(video, alignment, language):
    segments = {segment['id']: segment for segment in alignment['segments']}
    checks = []
    for identity in CAPTION_SCENES:
        segment = segments[identity]
        cues = [cue for cue in alignment['captions']
                if segment['start'] - .001 <= cue['start'] and cue['end'] <= segment['end'] + .001]
        if not cues:
            raise ValueError(f'Missing V11 caption cue for {identity}')
        cue = max(cues, key=lambda item: item['end'] - item['start'])
        checks.append((f'caption_{identity}', frame_at(cue['start'], cue['end']), CAPTION_CROP, 6, cue['text']))
    domain = segments['domain']
    phone = segments['phone']
    socials = segments['socials']
    signature = segments['signature']
    checks.extend([
        ('domain', frame_at(domain['start'] + .35, domain['end']), CONTACT_CROPS['domain'], 7, 'jammimmo.com'),
        ('phone', frame_at(phone['start'], phone['end']), CONTACT_CROPS['phone'], 7, '+221 76 944 48 49'),
        ('brand_socials', frame_at(socials['start'] + .45, socials['end']), CONTACT_CROPS['brand'], 7, 'Retrouvez Jamm Immo'),
        ('brand_signature', frame_at(signature['start'], signature['end']), CONTACT_CROPS['brand'], 7, 'Retrouvez Jamm Immo'),
    ])
    results = []
    for identity, frame, crop, psm, expected in checks:
        image = command('ffmpeg', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', 'mov',
                        '-ss', f'{frame / FPS:.6f}', '-i', video,
                        '-an', '-frames:v', '1', '-vf', f'crop={crop},format=gray',
                        '-f', 'image2pipe', '-c:v', 'pgm', '-')
        expected_text = normalized_ocr_text(identity, expected)
        if not expected_text:
            raise ValueError(f'Empty OCR comparison target for {identity}')
        attempts = []
        variants = [('grayscale', image)]
        if identity.startswith('caption_'):
            variants.extend((f'caption_threshold_{threshold}', high_contrast_caption(image, threshold))
                            for threshold in (90, 190))
        for variant, pixels in variants:
            recognized = command('tesseract', 'stdin', 'stdout', '-l', language, '--psm', str(psm), data=pixels)
            actual_text = normalized_ocr_text(identity, recognized.decode('utf-8'))
            attempts.append({'input': variant, 'matched': actual_text == expected_text,
                             'ocr_text_sha256': sha256(actual_text.encode())})
        matched = any(attempt['matched'] for attempt in attempts)
        results.append({
            'check': identity, 'frame': frame, 'crop': crop,
            'status': 'matched' if matched else 'inconclusive', 'passed': matched,
            'expected_text_sha256': sha256(expected_text.encode()), 'attempts': attempts,
        })
    return {'passed': all(result['passed'] for result in results), 'language': language, 'frames': results}


def bind_manifest(manifest_data, props_data, alignment_data, alignment, media_sha, raw_sha, narration_sha, mix_sha, mix_name):
    manifest = json.loads(manifest_data)
    props = json.loads(props_data)
    segments = alignment['segments']
    has_assistant = any(segment['id'] == 'assistant' for segment in segments)
    advice = [segment['text'] for segment in segments if segment['id'] in CAPTION_SCENES[1:]]
    if (
        not isinstance(manifest, dict) or manifest.get('contract') != 'tip-v11-fr-render-inputs-v1'
        or not isinstance(props, dict) or not isinstance(props.get('title'), str)
        or props.get('segments') != segments or props.get('captions') != alignment['captions']
        or props.get('phoneGroups') != alignment.get('phoneGroups')
        or props.get('durationInFrames') != alignment['durationInFrames']
        or props.get('audio') != f'audio/voiceovers/{mix_name}'
        or props.get('assistantEnabled') is not has_assistant or manifest.get('assistant_enabled') is not has_assistant
        or props.get('visualTopic') not in ('general', 'water') or props.get('visualTopic') != manifest.get('visual_topic')
        or manifest.get('title_sha256') != sha256(props['title'].encode())
        or manifest.get('rendered_advice_sha256') != sha256(' '.join(advice).encode())
        or manifest.get('narration_text_sha256') != sha256(' '.join(segment['text'] for segment in segments).encode())
        or manifest.get('props_sha256') != sha256(props_data) or manifest.get('alignment_sha256') != sha256(alignment_data)
        or manifest.get('raw_wav_sha256') != raw_sha or manifest.get('narration_wav_sha256') != narration_sha
        or manifest.get('mix_wav_sha256') != mix_sha or manifest.get('media_sha256') != media_sha
    ):
        raise ValueError('V11 manifest differs from the audited render inputs')
    return {'render_manifest_sha256': sha256(manifest_data),
            'render_manifest_b64': base64.b64encode(manifest_data).decode('ascii')}


def audit(args):
    alignment_data = limited_read(args.alignment, 64 * 1024)
    alignment = verify_alignment(alignment_data)
    narration, narration_sha = read_wave(args.narration_wav)
    mix, mix_sha = read_wave(args.mix_wav)
    with TemporaryDirectory() as folder:
        video = Path(folder) / 'audit.mp4'
        media_sha, media_bytes = snapshot_video(args.video, video)
        shape = media_shape(video, alignment['durationInFrames'])
        if not shape['passed']:
            raise ValueError('V11 MP4 media shape differs from the alignment contract')
        bound = {}
        if args.render_manifest:
            bound = bind_manifest(
                limited_read(args.render_manifest, 64 * 1024), limited_read(args.render_props, 64 * 1024),
                alignment_data, alignment, media_sha, sha256(limited_read(args.raw_wav, 8 * 1024 * 1024)),
                narration_sha, mix_sha, args.mix_wav.name,
            )
        decoded_pcm = command('ffmpeg', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', 'mov',
                            '-i', video, '-map', '0:a:0',
                            '-t', str(MAX_PCM_SECONDS), '-ac', '1', '-ar', str(SAMPLE_RATE), '-f', 's16le', '-')
        decoded = pcm(decoded_pcm)
        audio = measure_audio(alignment['segments'], narration, mix, decoded)
        preservation = measure_audio_preservation(alignment, narration, mix, decoded_pcm, audio.get('lag_samples'))
        text = measure_text(video, alignment, args.ocr_language)
        speech = {'final_french_speech': measure_final_french_speech(
            alignment['segments'], decoded_pcm, audio, folder,
        )} if args.measure_final_french else {}
        visibility = {'final_brand_cta_visibility': measure_final_brand_cta(
            video, alignment, args.brand_logo, args.ocr_language,
        )} if getattr(args, 'brand_logo', None) else {}
    return {
        'contract': 'tip-v11-fr-objective-media-evidence-v1',
        'passed': audio['passed'] and text['passed'],
        'media_sha256': media_sha, 'media_bytes': media_bytes,
        'alignment_sha256': sha256(alignment_data), 'narration_wav_sha256': narration_sha, 'mix_wav_sha256': mix_sha,
        'alignment_provenance': alignment.get('provenance'),
        'media_shape': shape, 'audio_waveform': audio, 'audio_preservation': preservation, 'sampled_frame_ocr': text,
        'status': 'matched' if audio['passed'] and text['passed'] else 'needs_review',
        'editorial_approval': False,
        'scope': 'Waveform, export sample preservation, sampled OCR and optional French speech evidence. No rights, privacy, or accent assessment.',
        **bound,
        **speech,
        **visibility,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', type=Path, required=True)
    parser.add_argument('--alignment', type=Path, required=True)
    parser.add_argument('--narration-wav', type=Path, required=True)
    parser.add_argument('--mix-wav', type=Path, required=True)
    parser.add_argument('--render-manifest', type=Path)
    parser.add_argument('--render-props', type=Path)
    parser.add_argument('--raw-wav', type=Path)
    parser.add_argument('--ocr-language', default='eng')
    parser.add_argument('--measure-final-french', action='store_true')
    parser.add_argument('--brand-logo', type=Path, help='Audit visible brand and CTA in the final MP4 with the pinned logo')
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    if any((args.render_manifest, args.render_props, args.raw_wav)) and not all((args.render_manifest, args.render_props, args.raw_wav)):
        parser.error('manifest, render props and original narration are required together')
    try:
        report = audit(args)
        report_fd = os.open(args.report, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(report_fd, 'w', encoding='utf-8') as output:
            json.dump(report, output, indent=2, sort_keys=True)
            output.write('\n')
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        parser.exit(2, f'V11 audit unavailable: {error}\n')
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
