import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareTipRunnerParity } from './compare-tip-runner-parity.mjs';

const sourceSha = 'a'.repeat(40);
const receipt = () => ({
  schema: 'jamm-tip-runner-parity-v3', sourceSha, lockSha256: 'b'.repeat(64),
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
  },
});

test('a different speech runtime fails even when both decoded media streams match', () => {
  const hosted = receipt(); const mini = receipt();
  mini.toolchain.speechRuntimeSha256 = '7'.repeat(64);
  assert.deepEqual(compareTipRunnerParity(sourceSha, hosted, mini).differences, ['toolchain.speechRuntimeSha256']);
  const old = receipt(); old.schema = 'jamm-tip-runner-parity-v2';
  assert.throws(() => compareTipRunnerParity(sourceSha, hosted, old));
});

test('reports matching outputs and records exact media equality without requiring it', () => {
  const hosted = receipt();
  const mini = receipt();
  assert.equal(compareTipRunnerParity(sourceSha, hosted, mini).sameMediaBytes, true);
  mini.fixture.mediaSha256 = '0'.repeat(64);
  assert.deepEqual(compareTipRunnerParity(sourceSha, hosted, mini), {
    sourceSha, status: 'matched', differences: [], sameMediaBytes: false,
  });
});

test('reports runtime, lockfile and render drift together', () => {
  const hosted = receipt();
  const mini = receipt();
  mini.toolchain.python = '3.11.15';
  mini.toolchain.chromiumSha256 = '7'.repeat(64);
  mini.lockSha256 = '8'.repeat(64);
  mini.fixture.duration = 68;
  assert.deepEqual(compareTipRunnerParity(sourceSha, hosted, mini).differences,
    ['lockSha256', 'toolchain.python', 'toolchain.chromiumSha256', 'fixture.duration']);
});

test('fails on decoded pictures or audio even when measured formats align', () => {
  const hosted = receipt();
  const mini = receipt();
  mini.fixture.decodedVideoSha256 = '6'.repeat(64);
  mini.fixture.decodedAudioSha256 = '7'.repeat(64);
  assert.deepEqual(compareTipRunnerParity(sourceSha, hosted, mini).differences,
    ['fixture.decodedVideoSha256', 'fixture.decodedAudioSha256']);
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
