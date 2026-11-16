import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { submitTipSourceQualification } from './submit-tip-v11-source-qualification.mjs';

const postId = 'a178af31-bd23-4a1b-a853-4abc85ad56de';
const receipt = {
  postId,
  draftSha256: 'c'.repeat(64),
  recipeId: '5c2d10bc-c47b-4dde-a581-bd0691f59016',
  qualificationId: '115a718e-5da4-4cc2-afea-63aada7a5b6d',
};
const env = {
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://fixture.actions.githubusercontent.com/token?api-version=2.0',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture-token',
};

test('requests an audience over the unchanged request bytes and recovers the same receipt on retry', async () => {
  const input = Buffer.from(`{ "postId":"${postId}", "draft":{"title":"À Dakar"} }\n`);
  const expected = Buffer.from(input);
  const digest = createHash('sha256').update(expected).digest('hex');
  const repeatDelays = [];
  let submissions = 0;
  let tokenCalls = 0;
  const result = await submitTipSourceQualification(input, env, {
    sleep: async delay => repeatDelays.push(delay),
    request: async (url, options) => {
      if (url.origin === 'https://fixture.actions.githubusercontent.com') {
        assert.equal(url.searchParams.get('audience'), `urn:jammimmo:tip-v11:machine-source:${digest}`);
        assert.equal(options.headers.Authorization, 'Bearer fixture-token');
        assert.equal(options.redirect, 'error');
        tokenCalls++;
        // A caller-side mutation after attestation must never alter the signed bytes.
        input.fill(0);
        return Response.json({ value: 'fixture.signed.jwt' });
      }
      assert.equal(url.origin, 'https://jammimmo-estate-flow.jammimmo221admin.workers.dev');
      assert.equal(url.pathname, '/api/social/advice/source-qualification');
      assert.equal(options.headers.Authorization, 'Bearer fixture.signed.jwt');
      assert.equal(options.redirect, 'manual');
      assert.deepEqual(options.body, expected);
      submissions++;
      if (submissions === 1) return new Response(null, { status: 503, headers: { 'Retry-After': '1' } });
      return Response.json(receipt);
    },
  });
  assert.deepEqual(result, { status: 'confirmed', receipt });
  assert.equal(tokenCalls, 1);
  assert.equal(submissions, 2);
  assert.deepEqual(repeatDelays, [1000]);
});

test('returns a rejection on conflicting, redirected or unverifiable authority responses', async () => {
  const bytes = Buffer.from(JSON.stringify({ postId }));
  for (const response of [
    new Response(null, { status: 409 }),
    new Response(null, { status: 302, headers: { Location: 'https://example.org/' } }),
    Response.json({ ...receipt, postId: receipt.recipeId }),
    Response.json({ ...receipt, extra: true }),
    Response.json({ ...receipt, qualificationId: undefined }),
    new Response(' '.repeat(4097)),
  ]) {
    let requests = 0;
    const result = await submitTipSourceQualification(bytes, env, {
      request: async () => requests++ === 0 ? Response.json({ value: 'fixture.signed.jwt' }) : response,
      sleep: () => assert.fail('Unverifiable receipts must not be retried'),
    });
    assert.deepEqual(result, { status: 'rejected' });
    assert.equal(requests, 2);
  }
});

test('rejects invalid input bytes and token origins before making a request', async () => {
  const request = () => assert.fail('Untrusted input must not initiate any request');
  const cases = [null, Buffer.alloc(0), Buffer.alloc(48 * 1024 + 1), Buffer.of(0xff), Buffer.from('{"postId":1}'),
    Buffer.from(`\uFEFF{"postId":"${postId}"}`)];
  for (const bytes of cases) assert.deepEqual(await submitTipSourceQualification(bytes, env, { request }), { status: 'rejected' });
  const valid = Buffer.from(JSON.stringify({ postId }));
  const untrustedEnv = { ...env, ACTIONS_ID_TOKEN_REQUEST_URL: 'https://fixture.actions.githubusercontent.com.example.org/token' };
  const result = await submitTipSourceQualification(valid, untrustedEnv, { request });
  assert.deepEqual(result, { status: 'attestation_unavailable' });
});
