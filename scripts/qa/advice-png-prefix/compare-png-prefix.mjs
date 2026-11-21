import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validatePngPrefixEvidence } from './capture-png-prefix.mjs';
import { sha256 } from './prepare-smoke-input.mjs';

const [hostedPath, miniPath, ...rest] = process.argv.slice(2);
assert.ok(hostedPath && miniPath && !rest.length, 'Pass hosted and mini-PC output paths');

function readRun(path) {
  const receipt = JSON.parse(readFileSync(join(path, 'receipt.json')));
  assert.equal(receipt.schema, 'jamm-v11-swangle-png-prefix-v1');
  assert.equal(receipt.syntheticOnly, true);
  assert.equal(receipt.publishable, false);
  assert.deepEqual([receipt.frames, receipt.concurrency, receipt.format], [132, 1, 'png']);
  const traceBytes = readFileSync(join(path, 'trace.json'));
  const mediaBytes = readFileSync(join(path, 'media-unvalidated.json'));
  assert.equal(sha256(traceBytes), receipt.traceSha256);
  assert.equal(sha256(mediaBytes), receipt.mediaSha256);
  const trace = JSON.parse(traceBytes), media = JSON.parse(mediaBytes);
  validatePngPrefixEvidence(trace, media);
  return { receipt, trace, media };
}

const hosted = readRun(hostedPath), mini = readRun(miniPath);
for (const name of ['sourceSha', 'treeSha', 'assetHash', 'browserHash', 'graphicsFiles', 'input']) {
  assert.deepEqual(hosted.receipt[name], mini.receipt[name], `Different ${name}`);
}
assert.deepEqual(hosted.trace.browsers[0].start, mini.trace.browsers[0].start, 'Different actual graphics system');
const browserPngDifferences = hosted.trace.frames.filter(([, hash], frame) => hash !== mini.trace.frames[frame][1])
  .map(([frame]) => frame);
const decodedVideoDifferences = hosted.media.decodedFrames.filter(({ frame, sha256: hash }) =>
  hash !== mini.media.decodedFrames[frame].sha256).map(({ frame }) => frame);
const decodedAudioMatches = hosted.media.decodedAudioSha256 === mini.media.decodedAudioSha256;
assert.equal(hosted.media.decodedVideoSha256 === mini.media.decodedVideoSha256, decodedVideoDifferences.length === 0);
const mediaBytesMatch = hosted.media.mp4Sha256 === mini.media.mp4Sha256;
const matches = browserPngDifferences.length === 0 && decodedVideoDifferences.length === 0 && decodedAudioMatches;
process.stdout.write(JSON.stringify({ schema: 'jamm-v11-swangle-png-prefix-comparison-v1',
  status: matches ? 'matched-prefix' : 'drift', sourceSha: hosted.receipt.sourceSha,
  frames: 132, browserPngDifferences, decodedVideoDifferences, decodedAudioMatches, mediaBytesMatch,
  browserBackend: hosted.trace.browsers[0].start, browserFormat: 'png', concurrency: 1,
  encoders: { hosted: hosted.trace.encoders[0], mini: mini.trace.encoders[0] },
  elapsedMs: { hosted: hosted.receipt.elapsedMs, mini: mini.receipt.elapsedMs } }, null, 2) + '\n');
if (!matches) process.exitCode = 1;
