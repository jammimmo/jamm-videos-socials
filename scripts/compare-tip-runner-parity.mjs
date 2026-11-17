import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const digest = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}$/;
const toolchainKeys = ['node', 'npm', 'python', 'ffmpeg', 'ffprobe', 'chromium', 'remotion',
  'ffmpegSha256', 'ffprobeSha256', 'chromiumSha256', 'speechRuntimeSha256'];
const exactFixtureKeys = ['renderer', 'voiceSource', 'alignment', 'captionGeometry', 'duration',
  'width', 'height', 'closedGopKeyframes', 'closedGopSeconds', 'decodedVideoSha256', 'decodedAudioSha256'];

function verifyReceipt(receipt, expectedSha, lane) {
  if (receipt?.schema !== 'jamm-tip-runner-parity-v3' || receipt.sourceSha !== expectedSha
    || !digest.test(receipt.lockSha256 ?? '')) throw new Error(`${lane}: invalid or different source receipt`);
  const tools = receipt.toolchain;
  if (!tools || Object.keys(tools).length !== toolchainKeys.length || toolchainKeys.some(key => {
    const value = tools[key];
    return typeof value !== 'string' || value.length === 0 || value.length > 512
      || (key.endsWith('Sha256') && !digest.test(value));
  })) throw new Error(`${lane}: incomplete toolchain fingerprint`);
  const fixture = receipt.fixture;
  if (fixture?.status !== 'passed' || fixture.scope !== 'non-publishable-offline-remotion-smoke'
    || fixture.renderer !== 'TipV11Fr' || fixture.voiceSource !== 'fixture'
    || fixture.alignment !== 'local-word-timings' || fixture.captionGeometry !== 'matched'
    || fixture.width !== 1080 || fixture.height !== 1920 || fixture.closedGopSeconds !== 3
    || !Number.isFinite(fixture.duration) || fixture.duration <= 60 || fixture.duration > 120
    || !Number.isSafeInteger(fixture.closedGopKeyframes) || fixture.closedGopKeyframes < 2
    || !Number.isFinite(fixture.audioBitrate) || fixture.audioBitrate <= 0 || fixture.audioBitrate > 132_000
    || !['mediaSha256', 'decodedVideoSha256', 'decodedAudioSha256'].every(key => digest.test(fixture[key] ?? ''))
    || fixture.retainedArtifact !== false) {
    throw new Error(`${lane}: incomplete or failed offline render`);
  }
}

export function compareTipRunnerParity(expectedSha, hosted, mini) {
  if (typeof expectedSha !== 'string' || !commit.test(expectedSha)) throw new Error('Expected a full reviewed renderer SHA');
  verifyReceipt(hosted, expectedSha, 'github-hosted');
  verifyReceipt(mini, expectedSha, 'mini-pc');
  const differences = [];
  if (hosted.lockSha256 !== mini.lockSha256) differences.push('lockSha256');
  for (const key of toolchainKeys) {
    if (hosted.toolchain[key] !== mini.toolchain[key]) differences.push(`toolchain.${key}`);
  }
  for (const key of exactFixtureKeys) {
    if (hosted.fixture[key] !== mini.fixture[key]) differences.push(`fixture.${key}`);
  }
  return {
    sourceSha: expectedSha,
    status: differences.length ? 'drift' : 'matched',
    differences,
    sameMediaBytes: hosted.fixture.mediaSha256 === mini.fixture.mediaSha256,
  };
}

function readReceipt(path) {
  const file = statSync(path);
  if (!file.isFile() || file.size > 64 * 1024) throw new Error('Invalid runner receipt file');
  return JSON.parse(readFileSync(path, 'utf8'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [sha, hostedPath, miniPath] = process.argv.slice(2);
    if (process.argv.length !== 5) throw new Error('Usage: compare-tip-runner-parity.mjs <sha> <hosted.json> <mini.json>');
    const result = compareTipRunnerParity(sha, readReceipt(hostedPath), readReceipt(miniPath));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== 'matched') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
