import { execFileSync } from 'node:child_process';

export function decodedTipFrameHashes(video, expectedFrames, width, height) {
  if (!Number.isSafeInteger(expectedFrames) || expectedFrames < 1 || expectedFrames > 3600
    || ![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value % 2 === 0)) {
    throw new Error('Invalid bounded V11 frame diagnostics');
  }
  const output = execFileSync('ffmpeg', [
    '-nostdin', '-v', 'error', '-xerror', '-protocol_whitelist', 'file', '-i', video,
    '-map', '0:v:0', '-an', '-sn', '-dn', '-fps_mode', 'passthrough',
    '-c:v', 'rawvideo', '-pix_fmt', 'yuv420p', '-threads:v', '1',
    '-f', 'framehash', '-hash', 'sha256', 'pipe:1',
  ], { encoding: 'utf8', timeout: 90_000, maxBuffer: 512 * 1024 });
  const rows = output.trim().split('\n').filter(line => !line.startsWith('#'));
  if (rows.length !== expectedFrames) throw new Error('V11 diagnostics frame count differs from the fixture');
  const expectedBytes = width * height * 3 / 2;
  return rows.map((row, frame) => {
    const fields = row.split(',').map(value => value.trim());
    if (fields.length !== 6 || fields[0] !== '0' || Number(fields[4]) !== expectedBytes
      || !/^[a-f0-9]{64}$/u.test(fields[5])) {
      throw new Error(`V11 diagnostics invalid decoded frame ${frame}`);
    }
    return { frame, sha256: fields[5] };
  });
}
