import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateMotionEvidence } from './capture-master-motion.mjs';

const [hostedPath, miniPath, ...rest] = process.argv.slice(2);
assert.ok(hostedPath && miniPath && !rest.length, 'Pass hosted and mini-PC output paths');
const read = path => {
  const receipt = JSON.parse(readFileSync(join(path, 'receipt.json')));
  assert.equal(receipt.schema, 'jamm-v11-swangle-master-motion-v1');
  assert.equal(receipt.syntheticOnly, true);
  assert.equal(receipt.publishable, false);
  const traceBytes = readFileSync(join(path, 'trace.json'));
  assert.equal(createHash('sha256').update(traceBytes).digest('hex'), receipt.traceSha256);
  const trace = JSON.parse(traceBytes);
  validateMotionEvidence(receipt.fixture, trace);
  return { receipt, trace };
};
const hosted = read(hostedPath), mini = read(miniPath);
for (const name of ['sourceSha', 'baselineSha', 'treeSha', 'assetManifestSha256', 'browser', 'runtime']) {
  assert.deepEqual(hosted.receipt[name], mini.receipt[name], `Incompatible ${name}`);
}
assert.deepEqual(hosted.trace.browsers, mini.trace.browsers, 'Actual backend differs');
const preencoderJpegDifferences = hosted.trace.frames.filter(([, digest], index) => digest !== mini.trace.frames[index][1])
  .map(([frame]) => frame);
const decodedVideoMatches = hosted.receipt.fixture.decodedVideoSha256 === mini.receipt.fixture.decodedVideoSha256;
const decodedAudioMatches = hosted.receipt.fixture.decodedAudioSha256 === mini.receipt.fixture.decodedAudioSha256;
const mediaBytesMatch = hosted.receipt.fixture.mediaSha256 === mini.receipt.fixture.mediaSha256;
const matches = preencoderJpegDifferences.length === 0 && decodedVideoMatches && decodedAudioMatches;
process.stdout.write(JSON.stringify({ schema: 'jamm-v11-swangle-master-comparison-v1', status: matches ? 'matched-master' : 'drift',
  sourceSha: hosted.receipt.sourceSha, backend: hosted.trace.browsers[0].start,
  frameCount: hosted.trace.frames.length, preencoderJpegDifferences, decodedVideoMatches, decodedAudioMatches, mediaBytesMatch,
  encoders: { hosted: hosted.trace.encoders[0], mini: mini.trace.encoders[0] },
  elapsedMs: { hosted: hosted.receipt.elapsedMs, mini: mini.receipt.elapsedMs } }, null, 2) + '\n');
if (!matches) process.exitCode = 1;
