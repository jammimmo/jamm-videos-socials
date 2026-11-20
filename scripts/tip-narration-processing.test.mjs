import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { normalizeTipV11Narration, padShortNgorNarration, tipV11AlignmentArguments } from './render-tip-v11.mjs';
import { NORMALIZED_NARRATION_PROCESSING, readStagedPrivateReviewedNarration, reviewedPcmData, stagePrivateReviewedNarration } from './tip-v11-reviewed-narration.mjs';

function wav(samples = 60 * 24_000) {
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24_000, 24); bytes.writeUInt32LE(48_000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}

test('only reviewed sources request qualifier-parity alignment decoding', () => {
  const legacy = tipV11AlignmentArguments('n.wav', 's.json', 'a.json');
  const reviewed = tipV11AlignmentArguments('n.wav', 's.json', 'a.json', { reviewedSource: true });
  assert.equal(legacy.includes('--reviewed-source'), false);
  assert.equal(reviewed.filter(value => value === '--reviewed-source').length, 1);
});

test('Ngor tail padding preserves RIFF metadata and the original PCM through the last sample', () => {
  const target = 58.5 * 24_000;
  for (const missing of [60_001, 60_000, 1, 0, -1]) {
    const original = wav(target - missing);
    original.fill(0x2a, 44);
    const metadata = Buffer.from([0x4a, 0x55, 0x4e, 0x4b, 3, 0, 0, 0, 7, 8, 9, 0]);
    const tail = Buffer.from('LIST\x04\x00\x00\x00INFO', 'latin1');
    const bytes = Buffer.concat([original.subarray(0, 36), metadata, original.subarray(36), tail]);
    bytes.writeUInt32LE(bytes.length - 8, 4);
    const before = Buffer.from(bytes);
    const measured = padShortNgorNarration(bytes);
    const expectedPadding = missing > 0 && missing <= 60_000 ? missing : 0;
    assert.equal(measured.paddingSamples, expectedPadding);
    assert.equal(measured.normalizedSeconds, (target - missing + expectedPadding) / 24_000);
    assert.deepEqual(bytes, before);
    if (!expectedPadding) {
      assert.equal(measured.wav, bytes);
      continue;
    }
    const { offset, length } = reviewedPcmData(measured.wav);
    assert.equal(length, target * 2);
    assert.deepEqual(measured.wav.subarray(8, offset - 4), bytes.subarray(8, offset - 4));
    assert.deepEqual(measured.wav.subarray(offset, offset + length - expectedPadding * 2), original.subarray(44));
    assert.deepEqual(measured.wav.subarray(offset + length - expectedPadding * 2, offset + length), Buffer.alloc(expectedPadding * 2));
    assert.deepEqual(measured.wav.subarray(offset + length), tail);
    assert.equal(padShortNgorNarration(measured.wav).wav, measured.wav);
  }
  const truncated = wav(target - 1).subarray(0, -2);
  assert.throws(() => padShortNgorNarration(truncated), /Invalid normalized/);
  truncated.writeUInt32LE(truncated.length - 8, 4);
  assert.throws(() => padShortNgorNarration(truncated), /Invalid normalized/);
});

test('58.4 seconds of fresh Ngor PCM use one tempo pass and the padded WAV is reused exactly', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jamm-ngor-padding-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const raw = join(directory, 'raw.wav');
  const normalized = join(directory, 'normalized.wav');
  const reused = join(directory, 'reused.wav');
  const bytes = wav(58.4 * 24_000);
  for (let i = 44; i < bytes.length; i += 2) bytes.writeInt16LE(i % 48 < 24 ? 3_000 : -3_000, i);
  await writeFile(raw, bytes);
  await assert.rejects(normalizeTipV11Narration(directory, raw, reused, {}), /cannot fit/);
  await assert.rejects(normalizeTipV11Narration(directory, raw, reused, { alreadyNormalized: true, exactTourV8: true }),
    /Invalid normalized source narration/);
  const result = await normalizeTipV11Narration(directory, raw, normalized, { exactTourV8: true });
  assert.equal(result.rawSeconds, 58.4);
  assert.equal(result.tempo, 1.03);
  assert.equal(result.normalizedSeconds, 58.5);
  assert.ok(result.paddingSamples > 0 && result.paddingSamples <= 60_000);
  const output = await readFile(normalized);
  const { offset, length } = reviewedPcmData(output);
  assert.equal(length, 1_404_000 * 2);
  assert.deepEqual(output.subarray(offset + length - result.paddingSamples * 2, offset + length), Buffer.alloc(result.paddingSamples * 2));
  const second = await normalizeTipV11Narration(directory, normalized, reused, { alreadyNormalized: true, exactTourV8: true });
  assert.equal(second.tempo, 1);
  assert.deepEqual(await readFile(reused), output);
});
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
