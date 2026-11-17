import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { updateTipSourceAttempt } from './tip-source-attempt.mjs';

const sourceJob = { id: '27ab1a67-94d2-4500-8a4c-67c13b21bd42', claimToken: 'd8bba724-d36b-47e0-81e4-9c9cb5e7bc4e', attempt: 1 };
const env = { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://fixture.actions.githubusercontent.com/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture' };

test('starts only the exact acknowledged attempt, including unordered JSON receipt keys', async () => {
  let audience;
  const result = await updateTipSourceAttempt(sourceJob, 'start', null, env, async (url, options) => {
    if (url.hostname === 'fixture.actions.githubusercontent.com') {
      audience = url.searchParams.get('audience');
      return Response.json({ value: 'fixture.signed.jwt' });
    }
    assert.equal(url.href, 'https://jammimmo-estate-flow.jammimmo221admin.workers.dev/api/social/advice/source-attempt');
    assert.equal(options.redirect, 'manual');
    assert.equal(audience, `urn:jammimmo:tip-v11:machine-source-attempt:${createHash('sha256').update(options.body).digest('hex')}`);
    assert.deepEqual(JSON.parse(options.body), { sourceJob, action: 'start', reason: null });
    return Response.json({ sourceJob: { attempt: sourceJob.attempt, claimToken: sourceJob.claimToken, id: sourceJob.id }, started: true });
  });
  assert.deepEqual(result, { status: 'confirmed', sourceJob });
});

test('lost start response is not retried and stale or unrelated receipts cannot authorize synthesis', async () => {
  for (const response of [
    () => { throw new Error('lost response'); },
    () => new Response(null, { status: 409 }),
    () => Response.json({ started: true, sourceJob: { ...sourceJob, attempt: 2 } }),
    () => Response.json({ started: true, sourceJob, extra: true }),
    () => new Response('x'.repeat(1025)),
  ]) {
    let calls = 0;
    const result = await updateTipSourceAttempt(sourceJob, 'start', null, env, async () => {
      calls++;
      return calls === 1 ? Response.json({ value: 'fixture.signed.jwt' }) : response();
    });
    assert.notEqual(result.status, 'confirmed');
    assert.equal(calls, 2);
  }
});

test('invalid attempts and unbounded failure messages fail before network access', async () => {
  const request = () => assert.fail('Invalid attempt should not send a request');
  for (const identity of [{ ...sourceJob, attempt: 0 }, { ...sourceJob, attempt: 4 }, { ...sourceJob, claimToken: 'other' }]) {
    assert.deepEqual(await updateTipSourceAttempt(identity, 'start', null, env, request), { status: 'rejected' });
  }
  assert.deepEqual(await updateTipSourceAttempt(sourceJob, 'failed', 'arbitrary provider exception', env, request), { status: 'rejected' });
  assert.deepEqual(await updateTipSourceAttempt(sourceJob, 'start', 'voice_unavailable', env, request), { status: 'rejected' });
});
