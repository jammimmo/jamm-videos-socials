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
