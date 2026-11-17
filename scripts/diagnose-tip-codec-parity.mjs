// Offline, synthetic codec isolation. Never imports production content or providers.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpus, platform, arch } from 'node:os';
const require = createRequire(import.meta.url);
const rendererDir = dirname(require.resolve('@remotion/renderer'));
const { getExecutablePath } = require(join(rendererDir, 'compositor/get-executable-path.js'));
const { generateFfmpegArgs } = require(join(rendererDir, 'ffmpeg-args.js'));
const out = resolve(process.argv[2] ?? 'out/codec-diagnostic');
mkdirSync(out, { recursive: true });
const hash = (b) => createHash('sha256').update(b).digest('hex');
const binary = getExecutablePath({ type: 'ffmpeg', indent: false, logLevel: 'error', binariesDirectory: null });
const { getExplicitEnv } = require(join(rendererDir, 'compositor/get-explicit-env.js'));
const execution = { cwd: dirname(binary), env: { ...process.env, ...getExplicitEnv(dirname(binary)) } };
const systemBinary = execFileSync('sh', ['-c', 'command -v ffmpeg'], { encoding: 'utf8' }).trim();
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: resolve(dirname(import.meta.filename), '..') }).trim();
const lockSha256 = hash(readFileSync(resolve(dirname(import.meta.filename), '../package-lock.json')));
const systemVersion = execFileSync(systemBinary, ['-version'], { encoding: 'utf8' });
const width = 1080, height = 1920, frames = 12;
const plane = width * height;
const raw = Buffer.alloc(plane * 3 / 2 * frames);
// Integer-only moving gradients and sharp tiles, independent of browsers/fonts/media.
for (let f = 0; f < frames; f++) {
  const start = f * plane * 3 / 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    raw[start + y * width + x] = 16 + ((x * 3 + y * 5 + f * 17 + ((x >> 5) ^ (y >> 5)) * 29) % 220);
  }
  for (let i = 0; i < plane / 4; i++) {
    raw[start + plane + i] = 48 + ((i + f * 13) % 160);
    raw[start + plane * 5 / 4 + i] = 48 + ((i * 7 + f * 11) % 160);
  }
}
const input = join(out, 'synthetic.yuv');
writeFileSync(input, raw);
// Bundled Remotion FFmpeg intentionally lacks rawvideo demuxing; PNG matches its frame pipe.
const png = execFileSync(systemBinary, ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'yuv420p', '-video_size', `${width}x${height}`, '-framerate', '30', '-i', input, '-c:v', 'png', '-threads:v', '1', '-f', 'image2pipe', 'pipe:1'], { maxBuffer: 128 * 1024 * 1024, timeout: 60_000 });
const pngInput = join(out, 'synthetic.pngpipe');
writeFileSync(pngInput, png);
const base = generateFfmpegArgs({ hasPreencoded: false, pixelFormat: 'yuv420p', codec: 'h264', crf: 18, hardwareAcceleration: 'disable', indent: false, logLevel: 'error' }).flat(2).filter(Boolean).map(String);
const supportedFilters = execFileSync(binary, ['-hide_banner', '-filters'], { ...execution, encoding: 'utf8' });
writeFileSync(join(out, 'supported-filters.log'), supportedFilters);
const encoderHelp = execFileSync(binary, ['-hide_banner', '-h', 'encoder=rawvideo'], { ...execution, encoding: 'utf8' });
writeFileSync(join(out, 'rawvideo-encoder-help.log'), encoderHelp);
const frameHashesFor = (bytes) => {
  if (bytes.length !== raw.length) throw new Error(`Incomplete pixels: expected ${raw.length}, observed ${bytes.length}`);
  return Array.from({ length: frames }, (_, f) => hash(bytes.subarray(f * plane * 3 / 2, (f + 1) * plane * 3 / 2)));
};
const preEncoderPixels = [];
for (const disableCpuFlags of [false, true]) {
  const name = disableCpuFlags ? 'preencoder-cpuflags0' : 'preencoder-baseline';
  const args = ['-nostdin', '-v', 'info', ...(disableCpuFlags ? ['-cpuflags', '0'] : []), '-f', 'image2pipe', '-vcodec', 'png', '-r', '30', '-i', pngInput,
    '-frames:v', String(frames), '-c:v', 'rawvideo', '-pix_fmt', 'yuv420p', '-threads:v', '1', '-f', 'image2pipe', 'pipe:1'];
  const oracle = spawnSync(binary, args, { ...execution, maxBuffer: raw.length + 1024 * 1024, timeout: 60_000 });
  writeFileSync(join(out, `${name}.log`), oracle.stderr ?? Buffer.alloc(0));
  if (oracle.error || oracle.status !== 0) throw oracle.error ?? new Error(`Preencoder oracle failed: ${oracle.status}`);
  preEncoderPixels.push({ name, disableCpuFlags, args, bytes: oracle.stdout.length, sha256: hash(oracle.stdout), frameHashes: frameHashesFor(oracle.stdout) });
}
const results = [];
for (const mode of [
  { name: 'baseline', disableAsm: false, disableCpuFlags: false },
  { name: 'asm0', disableAsm: true, disableCpuFlags: false },
  { name: 'cpuflags0', disableAsm: false, disableCpuFlags: true },
  { name: 'both', disableAsm: true, disableCpuFlags: true },
]) {
  const { name, disableAsm, disableCpuFlags } = mode;
  const output = join(out, `${name}.mp4`);
  const args = ['-nostdin', '-v', 'info', ...(disableCpuFlags ? ['-cpuflags', '0'] : []), '-f', 'image2pipe', '-vcodec', 'png', '-r', '30', '-i', pngInput, ...base,
    '-x264-params', `open-gop=0:keyint=90:scenecut=0${disableAsm ? ':asm=0' : ''}`, '-threads:v', '1', '-frames:v', String(frames), '-y', output];
  const started = process.hrtime.bigint();
  const encode = spawnSync(binary, args, { ...execution, encoding: 'utf8', timeout: 60_000 });
  const encodeSeconds = Number(process.hrtime.bigint() - started) / 1e9;
  writeFileSync(join(out, `${name}.log`), encode.stderr ?? '');
  if (encode.error || encode.status !== 0) throw encode.error ?? new Error(`Encoder failed: ${encode.status}`);
  const decoded = execFileSync(systemBinary, ['-v', 'error', '-i', output, '-map', '0:v:0', '-an', '-c:v', 'rawvideo', '-pix_fmt', 'yuv420p', '-threads:v', '1', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: raw.length + 1024, timeout: 60_000 });
  const frameHashes = frameHashesFor(decoded);
  const options = /options: (.+)/u.exec(encode.stderr ?? '')?.[1];
  const threadsMatch = /(?:^| )threads=(\d+)(?: |$)/u.exec(options ?? '');
  const lookaheadMatch = /(?:^| )lookahead_threads=(\d+)(?: |$)/u.exec(options ?? '');
  const cpuCapabilities = /using cpu capabilities: (.+)/u.exec(encode.stderr ?? '')?.[1];
  if (!threadsMatch || !lookaheadMatch || !cpuCapabilities) throw new Error('Missing exact x264 settings/capabilities');
  const x264 = { threads: Number(threadsMatch[1]), lookaheadThreads: Number(lookaheadMatch[1]), cpuCapabilities, options };
  if (x264.threads !== 1 || (disableAsm && cpuCapabilities !== 'none!')) throw new Error('Requested x264 isolation was not observed');
  results.push({ ...mode, x264, encodeSeconds, decodedBytes: decoded.length, args, encodedSha256: hash(readFileSync(output)), decodedSha256: hash(decoded), frameHashes });
}
const comparisons = results.map((r) => ({ name: r.name, matchesBaseline: r.decodedSha256 === results[0].decodedSha256 }));
const receipt = { source: { head, lockSha256 }, systemFfmpeg: { path: systemBinary, sha256: hash(readFileSync(systemBinary)), version: systemVersion }, preEncoderPixels, supportedFiltersSha256: hash(supportedFilters), comparisons, schema: 2, syntheticOnly: true, publishable: false, platform: platform(), arch: arch(), cpuCount: cpus().length, cpuModel: cpus()[0]?.model, binary, binarySha256: hash(readFileSync(binary)), binaryVersion: execFileSync(binary, ['-version'], { ...execution, encoding: 'utf8' }), width, height, frames, rawSha256: hash(raw), pngPipeSha256: hash(png), decoder: systemVersion.split('\n')[0], rendererVersion: require('@remotion/renderer/package.json').version, generatedEncoderArgs: base, results };
writeFileSync(join(out, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ receipt: join(out, 'receipt.json'), hashes: results.map(({name, decodedSha256}) => ({name, decodedSha256})) }, null, 2));
