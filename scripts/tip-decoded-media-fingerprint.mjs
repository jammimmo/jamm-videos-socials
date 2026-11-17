import { execFileSync } from 'node:child_process';

function hashDecodedStream(video, streamArguments) {
  const result = execFileSync('ffmpeg', [
    '-nostdin', '-v', 'error', '-xerror', '-protocol_whitelist', 'file', '-i', video,
    ...streamArguments, '-f', 'hash', '-hash', 'sha256', 'pipe:1',
  ], { encoding: 'utf8', timeout: 90_000, maxBuffer: 256 * 1024 });
  const match = /^SHA256=([a-f0-9]{64})$/u.exec(result.trim());
  if (!match) throw new Error('FFmpeg did not return a valid decoded SHA-256');
  return match[1];
}

export function decodedTipMediaFingerprints(video) {
  return {
    decodedVideoSha256: hashDecodedStream(video, [
      '-map', '0:v:0', '-an', '-sn', '-dn', '-fps_mode', 'passthrough',
      '-c:v', 'rawvideo', '-pix_fmt', 'yuv420p', '-threads:v', '1',
    ]),
    decodedAudioSha256: hashDecodedStream(video, [
      '-map', '0:a:0', '-vn', '-sn', '-dn', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2',
    ]),
  };
}
