import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { uploadFailureCapsule } from './source-failure-capsule.mjs';
import { validCapsuleDiagnostic, safeAlignmentFields } from './source-failure-diagnostic.mjs';
import { machineSourceFixture } from './fixtures/machine-source-work.mjs';

const { job, wav } = machineSourceFixture();
const sourceJob = { id: job.postId, attempt: 1, claimToken: job.hookId };
const env = { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://fixture.actions.githubusercontent.com/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'private' };
const diagnostic = { stage: 'measured_inconclusive', reason: 'alignment_evidence_invalid', measurementAttempts: 1,
  alignment_code: 'phone_window_unvoiced', span_ms: 60, matched_words: 3, incompleteRecognizerCall: false };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = { stored: true, jobId: job.postId, attempt: 1, wavSha256: hash(wav),
  expiresAt: new Date(Date.now() + 3600000).toISOString() };

test('attests the complete frame once and recovers a lost acknowledgement using identical private bytes', async () => {
  const calls = [], bodies = [];
  let audience;
  const result = await uploadFailureCapsule(sourceJob, wav, 'normalized', diagnostic, env, {
    sleep: async () => {}, request: async (url, options) => {
      if (url.hostname === 'fixture.actions.githubusercontent.com') {
        calls.push('oidc'); audience = url.searchParams.get('audience'); return Response.json({ value: 'secret.signed.jwt' });
      }
      calls.push(options.method); bodies.push(Buffer.from(options.body));
      assert.equal(url.href, 'https://jammimmo-estate-flow.jammimmo221admin.workers.dev/api/social/advice/source-failure-capsule');
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers.Authorization, 'Bearer secret.signed.jwt');
      assert.equal(options.headers['X-Content-SHA256'], hash(options.body));
      assert.equal(audience, 'urn:jammimmo:tip-v11:source-failure-capsule-write:' + options.headers['X-Content-SHA256']);
      if (bodies.length === 1) throw Error('Response lost after storing capsule');
      return Response.json(receipt);
    },
  });
  assert.deepEqual(calls, ['oidc', 'POST', 'POST']);
  assert.deepEqual(result, { status: 'confirmed', wavSha256: hash(wav) });
  const [body, retry] = bodies;
  assert.deepEqual(retry, body);
  assert.equal(audience, 'urn:jammimmo:tip-v11:source-failure-capsule-write:' + hash(body));
  const end = 4 + body.readUInt32BE(0);
  assert.deepEqual(JSON.parse(body.subarray(4, end)), { contract: 'source-failure-capsule-v1',
    sourceJob, wavSha256: hash(wav), wavKind: 'normalized', diagnostic });
  assert.deepEqual(body.subarray(end), wav);
  assert.ok(!body.includes('secret.signed.jwt') && !body.includes(job.draft.scriptFr));
  assert.doesNotMatch(JSON.stringify(result), /claimToken|private|signed/);
});

test('rejects unknown, text-bearing and invalid numerics before any upload', async () => {
  let calls = 0;
  for (const value of [
    { ...diagnostic, text: 'PRIVATE' }, { ...diagnostic, alignment_code: 'PRIVATE' }, { ...diagnostic, duration_ms: Infinity },
    { ...diagnostic, matched_words: true }, { ...diagnostic, span_ms: 360001 }, { ...diagnostic, row_index: -1 },
    { ...diagnostic, measurementAttempts: 3 }, { ...diagnostic, reason: 'PRIVATE' },
    { ...diagnostic, incompleteRecognizerCall: 1 },
  ]) {
    assert.equal(validCapsuleDiagnostic(value, 'normalized'), false);
    const result = await uploadFailureCapsule(sourceJob, wav, 'normalized', value, env, { request: () => { calls++; } });
    assert.deepEqual(result, { status: 'rejected' });
  }
  assert.equal(calls, 0);
  assert.equal(validCapsuleDiagnostic(diagnostic, 'raw'), false);
  assert.deepEqual(safeAlignmentFields({ ...diagnostic, span_ms: NaN, session: 'PRIVATE' }),
    { alignment_code: diagnostic.alignment_code, matched_words: 3 });
});

test('refuses a different attempt or digest, an expired receipt, or an extra server field', async () => {
  for (const value of [{ ...receipt, wavSha256: 'f'.repeat(64) }, { ...receipt, attempt: 2 },
    { ...receipt, expiresAt: '2000-01-01T00:00:00Z' }, { ...receipt, token: 'private' }]) {
    const result = await uploadFailureCapsule(sourceJob, wav, 'normalized', diagnostic, env, {
      request: async url => Response.json(url.hostname === 'fixture.actions.githubusercontent.com' ? { value: 'secret.signed.jwt' } : value),
    });
    assert.deepEqual(result, { status: 'rejected' });
  }
});
