import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const digest = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}$/;
const toolchainKeys = ['node', 'npm', 'python', 'ffmpeg', 'ffprobe', 'chromium', 'remotion',
  'ffmpegSha256', 'ffprobeSha256', 'chromiumSha256', 'speechRuntimeSha256'];
const exactFixtureKeys = ['renderer', 'voiceSource', 'alignment', 'captionGeometry', 'duration',
  'width', 'height', 'closedGopKeyframes', 'closedGopSeconds', 'decodedVideoSha256', 'decodedAudioSha256'];
const destinations = ['facebook', 'instagram', 'tiktok'];
const exactDestinationKeys = ['width', 'height', 'duration', 'videoFrames', 'captionGeometrySha256',
  'decodedVideoSha256', 'decodedAudioSha256'];
const shortsProfile = 'youtube-shorts-v1';
const shortsCaptionMask = 'tip-v11-youtube-shorts-caption-20261125-v1';
const shortsBrandMask = 'tip-v11-youtube-shorts-brand-20261125-v1';
const sharedBrandMask = 'tip-v11-observed-short-feed-brand-20261114-v1';

function verifyFixture(fixture, lane) {
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

function matchesBounds(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && expected.every((bound, index) => actual[index] === bound);
}

function verifyFrenchVisualAudit(audit, frames, mask, bounds, lane) {
  if (!audit || !digest.test(audit.reportSha256 ?? '') || !digest.test(audit.manifestSha256 ?? '')
    || audit.frameCount !== frames || !Number.isSafeInteger(audit.cueCount) || audit.cueCount <= 0
    || !Number.isSafeInteger(audit.sampleCount) || audit.sampleCount < audit.cueCount || audit.sampleCount > audit.cueCount * 3
    || audit.brand?.language !== 'fra' || audit.brand.status !== 'matched' || audit.brand.mask !== mask
    || !matchesBounds(audit.brand.mask_bounds, bounds)
    || !Array.isArray(audit.brand.checks) || audit.brand.checks.length !== 8
    || audit.brand.checks.some(check => check?.status !== 'matched')
    || audit.ocr?.language !== 'fra' || audit.ocr.passed !== true
    || !Array.isArray(audit.ocr.frames) || audit.ocr.frames.length !== 10
    || audit.ocr.frames.some(frame => frame?.status !== 'matched' || frame.passed !== true)) {
    throw new Error(`${lane}: incomplete French OCR or decoded visibility proof`);
  }
}

function verifyReceipt(receipt, expectedSha, lane) {
  if (receipt?.schema !== 'jamm-tip-runner-parity-v4' || receipt.sourceSha !== expectedSha
    || !digest.test(receipt.lockSha256 ?? '')) throw new Error(`${lane}: invalid or different source receipt`);
  const tools = receipt.toolchain;
  if (!tools || Object.keys(tools).length !== toolchainKeys.length || toolchainKeys.some(key => {
    const value = tools[key];
    return typeof value !== 'string' || value.length === 0 || value.length > 512
      || (key.endsWith('Sha256') && !digest.test(value));
  })) throw new Error(`${lane}: incomplete toolchain fingerprint`);
  const fixture = receipt.fixture;
  verifyFixture(fixture, lane);
  if (fixture.masterVisualProfile !== undefined || fixture.masterCaptionMask !== undefined) {
    throw new Error(`${lane}: expected the legacy master in the shared fixture`);
  }
  if (!Array.isArray(fixture.destinationLayouts) || fixture.destinationLayouts.length !== destinations.length) {
    throw new Error(`${lane}: incomplete destination render evidence`);
  }
  const layouts = new Map(fixture.destinationLayouts.map(layout => [layout?.destination, layout]));
  const pictures = new Set([fixture.decodedVideoSha256]);
  const frames = layouts.get('facebook')?.videoFrames;
  for (const destination of destinations) {
    const layout = layouts.get(destination);
    if (!layout || layout.width !== fixture.width || layout.height !== fixture.height
      || !Number.isSafeInteger(frames) || frames <= 60 * 30 || layout.videoFrames !== frames
      || !Number.isFinite(layout.duration) || layout.duration <= 60 || layout.duration > (destination === 'facebook' ? 90 : 120)
      || Math.abs(layout.duration - frames / 30) > .12 || Math.abs(layout.duration - fixture.duration) > .12
      || layout.decodedAudioSha256 !== fixture.decodedAudioSha256 || pictures.has(layout.decodedVideoSha256)
      || !['mediaSha256', 'decodedVideoSha256', 'captionGeometrySha256'].every(key => digest.test(layout[key] ?? ''))) {
      throw new Error(`${lane}: invalid destination render evidence for ${destination}`);
    }
    pictures.add(layout.decodedVideoSha256);
  }
  if (Object.hasOwn(receipt, 'shortsFixture')) {
    verifyFrenchVisualAudit(fixture.visualAudit, frames, sharedBrandMask, [120, 255, 870, 1511], lane);
    const shorts = receipt.shortsFixture;
    verifyFixture(shorts, lane);
    if (shorts.masterVisualProfile !== shortsProfile
      || shorts.masterCaptionMask !== shortsCaptionMask || !matchesBounds(shorts.masterCaptionMaskBounds, [76, 1286, 838, 1372])
      || shorts.decodedAudioSha256 !== fixture.decodedAudioSha256 || pictures.has(shorts.decodedVideoSha256)
      || Math.abs(shorts.duration - fixture.duration) > .12) {
      throw new Error(`${lane}: invalid Shorts master render evidence`);
    }
    verifyFrenchVisualAudit(shorts.shortsAudit, frames, shortsBrandMask, [76, 298, 838, 1372], lane);
  }
  return layouts;
}

export function compareTipRunnerParity(expectedSha, hosted, mini) {
  if (typeof expectedSha !== 'string' || !commit.test(expectedSha)) throw new Error('Expected a full reviewed renderer SHA');
  const hostedDestinations = verifyReceipt(hosted, expectedSha, 'github-hosted');
  const miniDestinations = verifyReceipt(mini, expectedSha, 'mini-pc');
  const differences = [];
  if (hosted.lockSha256 !== mini.lockSha256) differences.push('lockSha256');
  for (const key of toolchainKeys) {
    if (hosted.toolchain[key] !== mini.toolchain[key]) differences.push(`toolchain.${key}`);
  }
  for (const key of exactFixtureKeys) {
    if (hosted.fixture[key] !== mini.fixture[key]) differences.push(`fixture.${key}`);
  }
  if (hosted.shortsFixture || mini.shortsFixture) {
    if (!hosted.shortsFixture || !mini.shortsFixture) {
      differences.push('shortsFixture');
    } else {
      for (const key of exactFixtureKeys) {
        if (hosted.shortsFixture[key] !== mini.shortsFixture[key]) differences.push(`shortsFixture.${key}`);
      }
    }
  }
  const sameDestinationMediaBytes = {};
  for (const destination of destinations) {
    const hostedLayout = hostedDestinations.get(destination);
    const miniLayout = miniDestinations.get(destination);
    for (const key of exactDestinationKeys) {
      if (hostedLayout[key] !== miniLayout[key]) differences.push(`fixture.destinationLayouts.${destination}.${key}`);
    }
    sameDestinationMediaBytes[destination] = hostedLayout.mediaSha256 === miniLayout.mediaSha256;
  }
  return {
    sourceSha: expectedSha,
    status: differences.length ? 'drift' : 'matched',
    differences,
    sameMediaBytes: hosted.fixture.mediaSha256 === mini.fixture.mediaSha256,
    sameDestinationMediaBytes,
    ...(hosted.shortsFixture && mini.shortsFixture && {
      sameShortsMediaBytes: hosted.shortsFixture.mediaSha256 === mini.shortsFixture.mediaSha256,
    }),
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
