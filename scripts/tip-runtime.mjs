import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA256 = /^[a-f0-9]{64}$/;
export const TIP_RUNTIME_CONTRACT = 'tip-v11-linux-speech-runtime-v1';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = value => Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));

export async function readTipRuntimeLock() {
  const [bytes, requirements] = await Promise.all([
    readFile(resolve(root, 'scripts/tip-runtime-lock.json')),
    readFile(resolve(root, 'scripts/tip-runtime-linux-py311.txt')),
  ]);
  const lock = JSON.parse(bytes);
  assert.equal(lock.contract, TIP_RUNTIME_CONTRACT);
  assert.equal(lock.pythonRequirementsSha256, digest(requirements), 'Python lock bytes changed');
  return { ...lock, lockSha256: digest(bytes) };
}

// Only measured values go into this digest. Paths, clocks, tokens and the
// caller-provided policy digest are deliberately absent.
export function canonicalTipRuntime(lock, measured) {
  assert.equal(measured.platform, 'linux', 'The qualified speech runtime is Linux');
  assert.equal(measured.architecture, 'x64', 'The qualified speech runtime is x86_64');
  for (const field of ['node', 'npm', 'python', 'ffmpegSha256', 'ffprobeSha256']) {
    assert.equal(measured[field], lock[field], `Runtime changed: ${field}`);
  }
  assert.equal(measured.pythonIsolated, true, 'Use the private speech virtual environment');
  assert.deepEqual(sorted(measured.pythonPackages), sorted(lock.pythonPackages), 'Speech packages changed');
  assert.equal(measured.asrRepository, lock.asr.repository);
  assert.equal(measured.asrRevision, lock.asr.revision, 'Pinned ASR cache is unavailable');
  assert.equal(measured.asrFilesVerified, true, 'Pinned ASR cache bytes were not verified');
  assert.equal(measured.asrNativeImportsReady, true, 'Native CPU int8 ASR modules are unavailable');
  return {
    contract: TIP_RUNTIME_CONTRACT, platform: measured.platform, architecture: measured.architecture,
    node: measured.node, npm: measured.npm, python: measured.python,
    ffmpegSha256: measured.ffmpegSha256, ffprobeSha256: measured.ffprobeSha256,
    pythonPackages: sorted(measured.pythonPackages),
    asrRepository: measured.asrRepository, asrRevision: measured.asrRevision,
    runtimeLockSha256: lock.lockSha256, pythonRequirementsSha256: lock.pythonRequirementsSha256,
  };
}

export function verifyTipRuntimeMeasurement(lock, measured, expectedSha256) {
  if (typeof expectedSha256 !== 'string' || !SHA256.test(expectedSha256)) throw new Error('Missing runtime policy');
  const runtime = canonicalTipRuntime(lock, measured);
  const sha256 = digest(JSON.stringify(runtime));
  assert.equal(sha256, expectedSha256, 'Installed runtime differs from the source policy');
  return { contract: TIP_RUNTIME_CONTRACT, sha256, runtime };
}

async function fileDigest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function collectTipRuntime(lock, env = process.env) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('The qualified speech runtime requires Linux x86_64');
  const python = env.TIP_SOURCE_PYTHON;
  if (!python || !python.startsWith('/')) throw new Error('Use the absolute qualified Python interpreter');
  const command = async (tool, args) => (await execute(tool, args, {
    env: { ...env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', PYTHONNOUSERSITE: '1' },
    timeout: 90_000, maxBuffer: 64 * 1024,
  })).stdout.trim();
  const [npm, pythonValue, ffmpeg, ffprobe] = await Promise.all([
    command('npm', ['--version']),
    command(python, ['-I', resolve(root, 'scripts/probe_tip_runtime.py'), resolve(root, 'scripts/tip-runtime-lock.json'), resolve(root, 'scripts')]),
    command('which', ['ffmpeg']), command('which', ['ffprobe']),
  ]);
  const [ffmpegSha256, ffprobeSha256] = await Promise.all([
    fileDigest(await realpath(ffmpeg)), fileDigest(await realpath(ffprobe)),
  ]);
  return { platform: process.platform, architecture: process.arch, node: process.version,
    npm, ffmpegSha256, ffprobeSha256, ...JSON.parse(pythonValue) };
}

export async function assertTipSourceRuntime(expectedSha256, env = process.env) {
  const lock = await readTipRuntimeLock();
  return verifyTipRuntimeMeasurement(lock, await collectTipRuntime(lock, env), expectedSha256);
}

export async function expectedTipRuntime() {
  const lock = await readTipRuntimeLock();
  const runtime = canonicalTipRuntime(lock, { ...lock, platform: 'linux', architecture: 'x64',
    pythonIsolated: true, asrRepository: lock.asr.repository, asrRevision: lock.asr.revision,
    asrFilesVerified: true, asrNativeImportsReady: true });
  return { contract: TIP_RUNTIME_CONTRACT, sha256: digest(JSON.stringify(runtime)), runtime };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const mode = process.argv[2];
    if (mode !== 'expected' && mode !== 'measure') throw new Error('Use expected or measure');
    const expected = await expectedTipRuntime();
    const result = mode === 'expected' ? { ...expected, measured: false }
      : { ...await assertTipSourceRuntime(expected.sha256), measured: true };
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write('The pinned speech runtime is unavailable or changed\n');
    process.exitCode = 1;
  }
}
