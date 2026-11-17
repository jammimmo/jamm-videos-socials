import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { normalizeTipV11Narration } from './render-tip-v11.mjs';
import { NORMALIZED_NARRATION_PROCESSING, readStagedPrivateReviewedNarration, stagePrivateReviewedNarration } from './tip-v11-reviewed-narration.mjs';

function wav() {
  const bytes = Buffer.alloc(44 + 60 * 48_000);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24_000, 24); bytes.writeUInt32LE(48_000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}
const delivery = { jobId: '27ab1a67-94d2-4500-8a4c-67c13b21bd42', callbackToken: 'a'.repeat(64),
  callbackUrl: 'https://jammimmo-estate-flow.jammimmo221admin.workers.dev/api/tour/callback?attempt=d8bba724-d36b-47e0-81e4-9c9cb5e7bc4e' };

test('a normalized source authorized by the Worker is copied byte for byte without a second tempo change', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jamm-normalization-lineage-'));
  const bytes = wav();
  const digest = createHash('sha256').update(bytes).digest('hex');
  const pin = { contract: 'tip-v11-reviewed-narration-v1', source: 'private-attempt', sha256: digest, rendererSha: 'b'.repeat(40) };
  const env = { RUNNER_TEMP: directory, GITHUB_SHA: pin.rendererSha,
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://fixture.actions.githubusercontent.com/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture' };
  try {
    const staged = await stagePrivateReviewedNarration(delivery, pin, env, async url => {
      if (url.hostname === 'fixture.actions.githubusercontent.com') return Response.json({ value: 'fixture.signed.jwt' });
      return new Response(bytes, { headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(bytes.length),
        'X-Tip-Narration-Processing': NORMALIZED_NARRATION_PROCESSING } });
    });
    const narration = await readStagedPrivateReviewedNarration(pin, { ...env, TIP_PRIVATE_NARRATION_FILE: staged });
    assert.equal(narration.alreadyNormalized, true);
    const normalized = join(directory, 'output.wav');
    const measured = await normalizeTipV11Narration(directory, narration.path, normalized, { alreadyNormalized: true });
    assert.equal(measured.tempo, 1);
    assert.equal(measured.processing, NORMALIZED_NARRATION_PROCESSING);
    assert.deepEqual(await readFile(normalized), bytes);
    // Even a local marker cannot be reused for a different digest or shape.
    await writeFile(`${staged}.processing.json`, JSON.stringify({ sha256: 'f'.repeat(64), processing: NORMALIZED_NARRATION_PROCESSING }));
    await assert.rejects(readStagedPrivateReviewedNarration(pin, { ...env, TIP_PRIVATE_NARRATION_FILE: staged }), /marker/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('legacy private WAVs retain their original processing path and unknown processing is rejected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jamm-legacy-lineage-'));
  const bytes = wav();
  const digest = createHash('sha256').update(bytes).digest('hex');
  const pin = { contract: 'tip-v11-reviewed-narration-v1', source: 'private-attempt', sha256: digest, rendererSha: 'b'.repeat(40) };
  const env = { RUNNER_TEMP: directory, GITHUB_SHA: pin.rendererSha,
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://fixture.actions.githubusercontent.com/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture' };
  const request = processing => async url => url.hostname === 'fixture.actions.githubusercontent.com'
    ? Response.json({ value: 'fixture.signed.jwt' })
    : new Response(bytes, { headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(bytes.length),
      ...(processing && { 'X-Tip-Narration-Processing': processing }) } });
  try {
    const path = await stagePrivateReviewedNarration(delivery, pin, env, request(null));
    assert.deepEqual(await readStagedPrivateReviewedNarration(pin, { ...env, TIP_PRIVATE_NARRATION_FILE: path }), { path, source: 'reviewed-bundle' });
    await assert.rejects(stagePrivateReviewedNarration(delivery, pin, env, request('trust-me-normalized')), /processing identity/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
