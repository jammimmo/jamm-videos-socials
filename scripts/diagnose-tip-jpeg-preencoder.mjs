// Two bounded decodes of one committed synthetic JPEG. No browser or x264.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, cpus, platform, arch } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const root = resolve(dirname(import.meta.filename), '..');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const expectedJpegSha256 = '3e17370f1c3d78db7774d9366389a47cc8efbefef1a2389d9e76250794b409ed';
const jpeg = readFileSync(join(root, 'scripts/fixtures/jpeg-preencoder-synthetic.jpg'));
if (hash(jpeg) !== expectedJpegSha256) throw new Error('Common synthetic JPEG SHA mismatch');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (head !== process.env.TIP_PARITY_EXPECTED_SHA) throw new Error('Exact diagnostic source SHA required');
const rendererDir = dirname(require.resolve('@remotion/renderer'));
const { getExecutablePath } = require(join(rendererDir, 'compositor/get-executable-path.js'));
const { getExplicitEnv } = require(join(rendererDir, 'compositor/get-explicit-env.js'));
const binary = getExecutablePath({ type: 'ffmpeg', indent: false, logLevel: 'error', binariesDirectory: null });
const execution = { cwd: dirname(binary), env: { ...process.env, ...getExplicitEnv(dirname(binary)) } };
const systemBinary = execFileSync('sh', ['-c', 'command -v ffmpeg'], { encoding: 'utf8' }).trim();
const width = 1080, height = 1920, yBytes = width * height, uvBytes = yBytes / 4, expectedBytes = yBytes + uvBytes * 2;
const scratch = mkdtempSync(join(tmpdir(), 'jamm-jpeg-oracle-'));
try {
  const input = join(scratch, 'synthetic.jpg');
  writeFileSync(input, jpeg, { mode: 0o600 });
  const results = [];
  for (const disableCpuFlags of [false, true]) {
    const args = ['-nostdin', '-v', 'info', ...(disableCpuFlags ? ['-cpuflags', '0'] : []),
      '-f', 'image2pipe', '-s', `${width}x${height}`, '-vcodec', 'mjpeg', '-r', '30', '-i', input,
      '-frames:v', '1', '-an', '-c:v', 'rawvideo', '-pix_fmt', 'yuv420p', '-threads:v', '1', '-f', 'image2pipe', 'pipe:1'];
    const started = process.hrtime.bigint();
    const result = spawnSync(binary, args, { ...execution, maxBuffer: expectedBytes + 1024 * 1024, timeout: 15_000 });
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    if (result.error || result.status !== 0) throw new Error(`Bounded JPEG oracle failed: ${result.error?.code ?? result.status}`);
    const pixels = result.stdout;
    if (pixels.length !== expectedBytes) throw new Error(`Incomplete YUV: ${pixels.length} instead of ${expectedBytes}`);
    const streamDescriptions = result.stderr.toString().split('\n').filter((line) => /Stream #.*Video:/u.test(line)).map((line) => line.trim());
    if (streamDescriptions.length !== 2) throw new Error('Missing actual input/output pixel format descriptions');
    results.push({ name: disableCpuFlags ? 'cpuflags0' : 'default', disableCpuFlags, seconds,
      // Replace only our private input pathname, never serialize the environment.
      args: args.map((arg) => arg === input ? '<committed-synthetic-jpeg>' : arg),
      streamDescriptions, bytes: pixels.length, sha256: hash(pixels), planes: {
        y: { bytes: yBytes, sha256: hash(pixels.subarray(0, yBytes)) },
        u: { bytes: uvBytes, sha256: hash(pixels.subarray(yBytes, yBytes + uvBytes)) },
        v: { bytes: uvBytes, sha256: hash(pixels.subarray(yBytes + uvBytes)) },
      } });
  }
  const receipt = { schema: 'jamm-jpeg-preencoder-v1', syntheticOnly: true, publishable: false,
    sourceSha: head, lockSha256: hash(readFileSync(join(root, 'package-lock.json'))),
    input: { sha256: expectedJpegSha256, bytes: jpeg.length, width, height, frames: 1 },
    systemFfmpeg: { path: systemBinary, sha256: hash(readFileSync(systemBinary)), version: execFileSync(systemBinary, ['-version'], { encoding: 'utf8', timeout: 5000 }) },
    bundledFfmpeg: { path: binary, sha256: hash(readFileSync(binary)), version: execFileSync(binary, ['-version'], { ...execution, encoding: 'utf8', timeout: 5000 }) },
    platform: platform(), arch: arch(), cpuCount: cpus().length, cpuModel: cpus()[0]?.model,
    expectedBytes, results, defaultMatchesCpuFlags0: results[0].sha256 === results[1].sha256 };
  if (!process.argv[2]) throw new Error('Receipt output path required');
  writeFileSync(resolve(process.argv[2]), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
