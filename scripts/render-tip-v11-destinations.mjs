import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FRAME_RATE, VIDEO_HEIGHT, VIDEO_WIDTH, tipV11Layout } from '../src/compositions/tip-v11-caption-geometry.ts';
import { decodedTipMediaFingerprints } from './tip-decoded-media-fingerprint.mjs';

// The caller supplies one already aligned composition and its mixed audio.
// This receipt belongs to local layout QA, outside render delivery.
const destinations = ['tiktok', 'instagram', 'facebook'];
const maxSeconds = { tiktok: 120, instagram: 120, facebook: 90 };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function renderTipV11Destinations({ root, outputDirectory, props, selectedDestinations = destinations }) {
  const { captionGeometryRunId: _sharedGeometryRun, ...baseProps } = props;
  if (!selectedDestinations.length || new Set(selectedDestinations).size !== selectedDestinations.length
    || selectedDestinations.some(destination => !destinations.includes(destination))) {
    throw new Error('Expected one or more distinct supported destinations');
  }
  const expected = baseProps.durationInFrames / FRAME_RATE;
  if (!Number.isSafeInteger(baseProps.durationInFrames) || expected < 3
    || selectedDestinations.some(destination => expected > maxSeconds[destination])) {
    throw new Error('Narration length does not fit the selected destinations');
  }
  const audioSha256 = sha256(await readFile(join(root, 'public', baseProps.audio)));
  await mkdir(outputDirectory, { mode: 0o700 });
  const videos = [];
  for (const destination of selectedDestinations) {
    const propsPath = join(outputDirectory, `${destination}.props.json`);
    const videoPath = join(outputDirectory, `${destination}.mp4`);
    await writeFile(propsPath, JSON.stringify({ ...baseProps, destination }), { flag: 'wx', mode: 0o600 });
    execFileSync(join(root, 'node_modules/.bin/remotion'), [
      'render', 'src/index.ts', 'TipV11Fr', videoPath, `--props=${propsPath}`,
      '--config=remotion.tip-v11.config.ts', '--codec=h264', '--audio-codec=aac',
      '--image-format=jpeg', '--concurrency=3', '--log=error',
    ], { cwd: root, stdio: 'inherit', timeout: 15 * 60 * 1000 });
    const probe = JSON.parse(execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate',
      '-of', 'json', videoPath,
    ], { encoding: 'utf8', timeout: 20_000 }));
    const video = probe.streams.find(stream => stream.codec_type === 'video');
    const audio = probe.streams.find(stream => stream.codec_type === 'audio');
    const duration = Number(probe.format.duration);
    const size = Number(probe.format.size);
    if (video?.width !== VIDEO_WIDTH || video.height !== VIDEO_HEIGHT || video.r_frame_rate !== `${FRAME_RATE}/1`
      || video.codec_name !== 'h264' || audio?.codec_name !== 'aac' || !(size > 0 && size <= 50 * 1024 * 1024)
      || !(Math.abs(duration - expected) <= .12) || !(duration >= 3 && duration <= maxSeconds[destination])) {
      throw new Error(`Invalid V11 layout export for ${destination}`);
    }
    videos.push({ destination, width: video.width, height: video.height, duration, size,
      layout: tipV11Layout(destination), mediaSha256: sha256(await readFile(videoPath)),
      ...decodedTipMediaFingerprints(videoPath) });
  }
  if (new Set(videos.map(video => video.decodedVideoSha256)).size !== videos.length
    || new Set(videos.map(video => video.decodedAudioSha256)).size !== 1) {
    throw new Error('Expected distinct pictures and the same decoded audio on every destination');
  }
  const receipt = { scope: 'offline-destination-layouts', audioSha256, videos };
  await writeFile(join(outputDirectory, 'layout-receipt.json'), JSON.stringify(receipt, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 });
  return receipt;
}
