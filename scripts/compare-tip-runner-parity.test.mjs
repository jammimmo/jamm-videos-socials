import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareTipRunnerParity } from './compare-tip-runner-parity.mjs';

const sourceSha = 'a'.repeat(40);
const receipt = () => ({
  schema: 'jamm-tip-runner-parity-v4', sourceSha, lockSha256: 'b'.repeat(64),
  toolchain: {
    node: 'v22.20.0', npm: '10.9.3', python: '3.11.14', ffmpeg: '6.1.1', ffprobe: '6.1.1',
    chromium: '134.0.0.0', remotion: '4.0.464', ffmpegSha256: 'c'.repeat(64),
    ffprobeSha256: 'd'.repeat(64), chromiumSha256: 'e'.repeat(64), speechRuntimeSha256: '6'.repeat(64),
  },
  fixture: {
    status: 'passed', scope: 'non-publishable-offline-remotion-smoke', renderer: 'TipV11Fr',
    voiceSource: 'fixture', alignment: 'local-word-timings', captionGeometry: 'matched',
    duration: 67, width: 1080, height: 1920, audioBitrate: 128000, closedGopKeyframes: 23,
    closedGopSeconds: 3, mediaSha256: 'f'.repeat(64), retainedArtifact: false,
    decodedVideoSha256: '4'.repeat(64), decodedAudioSha256: '5'.repeat(64),
    destinationLayouts: [ ['facebook', '8'], ['instagram', '9'], ['tiktok', 'a'] ].map(([destination, sha]) => ({
      destination, width: 1080, height: 1920, duration: 67, videoFrames: 2010,
      decodedVideoSha256: sha.repeat(64), decodedAudioSha256: '5'.repeat(64),
      captionGeometrySha256: 'b'.repeat(64), mediaSha256: 'c'.repeat(64),
    })),
  },
});

function withShorts() {
  const value = receipt();
  const visualAudit = (mask, bounds) => ({
    reportSha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64), frameCount: 2010, cueCount: 26, sampleCount: 78,
    brand: { language: 'fra', status: 'matched', mask, mask_bounds: bounds,
      checks: Array.from({ length: 8 }, () => ({ status: 'matched' })) },
    ocr: { language: 'fra', passed: true,
      frames: Array.from({ length: 10 }, () => ({ status: 'matched', passed: true })) },
  });
  const { destinationLayouts, ...master } = value.fixture;
  value.fixture.visualAudit = visualAudit('tip-v11-observed-short-feed-brand-20261114-v1', [120, 255, 870, 1511]);
  value.shortsFixture = {
    ...master, decodedVideoSha256: '1'.repeat(64), mediaSha256: '2'.repeat(64), masterVisualProfile: 'youtube-shorts-v1',
    masterCaptionMask: 'tip-v11-youtube-shorts-caption-20261125-v1', masterCaptionMaskBounds: [76, 1286, 838, 1372],
    shortsAudit: visualAudit('tip-v11-youtube-shorts-brand-20261125-v1', [76, 298, 838, 1372]),
  };
  return value;
}

test('compares the explicit French Shorts lane without altering legacy parity', () => {
  const hosted = withShorts();
  const mini = withShorts();
  assert.equal(compareTipRunnerParity(sourceSha, hosted, mini).sameShortsMediaBytes, true);
  mini.shortsFixture.decodedVideoSha256 = '3'.repeat(64);
  assert.deepEqual(compareTipRunnerParity(sourceSha, hosted, mini).differences, ['shortsFixture.decodedVideoSha256']);
  assert.deepEqual(compareTipRunnerParity(sourceSha, hosted, receipt()).differences, ['shortsFixture']);
  assert.equal(compareTipRunnerParity(sourceSha, receipt(), receipt()).status, 'matched');
});

test('requires decoded French evidence for both masters and the distinct Shorts layout', () => {
  const hosted = withShorts();
  for (const alter of [
    candidate => { candidate.fixture.visualAudit = undefined; },
    candidate => { candidate.shortsFixture.shortsAudit.ocr.language = 'eng'; },
    candidate => { candidate.shortsFixture.shortsAudit.ocr.frames[0].passed = false; },
    candidate => { candidate.shortsFixture.shortsAudit.brand.checks.pop(); },
    candidate => { candidate.shortsFixture.shortsAudit.brand.mask = 'tip-v11-observed-short-feed-brand-20261114-v1'; },
  ]) {
    const candidate = withShorts();
    alter(candidate);
    assert.throws(() => compareTipRunnerParity(sourceSha, hosted, candidate), /French OCR or decoded visibility proof/);
  }
  const mixed = withShorts();
  mixed.shortsFixture.decodedVideoSha256 = hosted.fixture.decodedVideoSha256;
  assert.throws(() => compareTipRunnerParity(sourceSha, hosted, mixed), /invalid Shorts master/);
});

test('a different speech runtime fails even when both decoded media streams match', () => {
  const hosted = receipt(); const mini = receipt();
  mini.toolchain.speechRuntimeSha256 = '7'.repeat(64);
  assert.deepEqual(compareTipRunnerParity(sourceSha, hosted, mini).differences, ['toolchain.speechRuntimeSha256']);
  const old = receipt(); old.schema = 'jamm-tip-runner-parity-v3';
  assert.throws(() => compareTipRunnerParity(sourceSha, hosted, old));
});

test('reports matching outputs and records exact media equality without requiring it', () => {
  const hosted = receipt();
  const mini = receipt();
  assert.equal(compareTipRunnerParity(sourceSha, hosted, mini).sameMediaBytes, true);
  mini.fixture.mediaSha256 = '0'.repeat(64);
  mini.fixture.destinationLayouts[0].mediaSha256 = 'd'.repeat(64);
  mini.fixture.destinationLayouts.reverse();
  assert.deepEqual(compareTipRunnerParity(sourceSha, hosted, mini), {
    sourceSha, status: 'matched', differences: [], sameMediaBytes: false,
    sameDestinationMediaBytes: { facebook: false, instagram: true, tiktok: true },
  });
});

test('reports runtime, lockfile and render drift together', () => {
  const hosted = receipt();
  const mini = receipt();
  mini.toolchain.python = '3.11.15';
  mini.toolchain.chromiumSha256 = '7'.repeat(64);
  mini.lockSha256 = '8'.repeat(64);
  mini.fixture.duration = 67.04;
  assert.deepEqual(compareTipRunnerParity(sourceSha, hosted, mini).differences,
    ['lockSha256', 'toolchain.python', 'toolchain.chromiumSha256', 'fixture.duration']);
});

test('fails on decoded pictures or audio even when measured formats align', () => {
  const hosted = receipt();
  const mini = receipt();
  mini.fixture.decodedVideoSha256 = '6'.repeat(64);
  mini.fixture.decodedAudioSha256 = '7'.repeat(64);
  for (const layout of mini.fixture.destinationLayouts) layout.decodedAudioSha256 = mini.fixture.decodedAudioSha256;
  assert.deepEqual(compareTipRunnerParity(sourceSha, hosted, mini).differences, [
    'fixture.decodedVideoSha256', 'fixture.decodedAudioSha256', 'fixture.destinationLayouts.facebook.decodedAudioSha256',
    'fixture.destinationLayouts.instagram.decodedAudioSha256', 'fixture.destinationLayouts.tiktok.decodedAudioSha256',
  ]);
});

test('compares each destination caption proof and rejects partial, mislabeled or shortened output', () => {
  const hosted = receipt();
  const mini = receipt();
  const instagram = mini.fixture.destinationLayouts[1];
  instagram.captionGeometrySha256 = 'e'.repeat(64);
  assert.deepEqual(compareTipRunnerParity(sourceSha, hosted, mini).differences,
    ['fixture.destinationLayouts.instagram.captionGeometrySha256']);
  instagram.destination = 'tiktok';
  assert.throws(() => compareTipRunnerParity(sourceSha, hosted, mini), /instagram/);
  instagram.destination = 'instagram';
  instagram.videoFrames -= 1;
  assert.throws(() => compareTipRunnerParity(sourceSha, hosted, mini), /instagram/);
  mini.fixture.destinationLayouts.pop();
  assert.throws(() => compareTipRunnerParity(sourceSha, hosted, mini), /incomplete destination/);
});

test('refuses stale, incomplete and non-synthetic proofs before comparison', () => {
  const hosted = receipt();
  const mini = receipt();
  assert.throws(() => compareTipRunnerParity('main', hosted, mini), /full reviewed/);
  assert.throws(() => compareTipRunnerParity(sourceSha, hosted, { ...mini, sourceSha: '1'.repeat(40) }), /source receipt/);
  delete mini.toolchain.ffmpegSha256;
  assert.throws(() => compareTipRunnerParity(sourceSha, hosted, mini), /fingerprint/);
  mini.toolchain.ffmpegSha256 = hosted.toolchain.ffmpegSha256;
  mini.fixture.retainedArtifact = true;
  assert.throws(() => compareTipRunnerParity(sourceSha, hosted, mini), /offline render/);
});
