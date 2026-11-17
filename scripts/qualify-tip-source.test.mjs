import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { qualifyTipSource } from './qualify-tip-source.mjs';
import { machineSourceFixture as fixture } from './fixtures/machine-source-work.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const env = {
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://fixture.actions.githubusercontent.com/token',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture-token',
};


test('binds measured source to its private WAV receipt before registering the same work', async () => {
  const { job, wav, speech } = fixture();
  const narration = { sha256: hash(wav), bytes: wav.length, version: 'private-v1', etag: 'e1' };
  const receipt = { postId: job.postId, draftSha256: 'd'.repeat(64), recipeId: job.policyId, qualificationId: job.hookId };
  const audiences = [];
  const routes = [];
  const result = await qualifyTipSource(job, wav, speech, env, { request: async (url, options) => {
    if (url.hostname === 'fixture.actions.githubusercontent.com') {
      audiences.push(url.searchParams.get('audience'));
      return Response.json({ value: 'fixture.signed.jwt' });
    }
    routes.push(url.pathname);
    if (url.pathname.endsWith('/source-narration')) return Response.json(narration);
    const body = JSON.parse(options.body.toString());
    assert.deepEqual(body.narration, narration);
    assert.deepEqual(body.speech, speech);
    assert.equal(body.expectedPolicyUpdatedAt, '2026-11-17T12:34:56.123456+00:00');
    assert.equal(audiences[1], `urn:jammimmo:tip-v11:machine-source:${hash(options.body)}`);
    return Response.json(receipt);
  } });
  assert.deepEqual(result, { status: 'confirmed', receipt, stage: 'qualification' });
  assert.deepEqual(routes, ['/api/social/advice/source-narration', '/api/social/advice/source-qualification']);
  assert.equal(audiences[0], `urn:jammimmo:tip-v11:machine-source-narration:${hash(wav)}`);
});

test('stale or mismatched evidence never uploads a source or starts qualification', async () => {
  const { job, wav, speech } = fixture();
  const request = () => assert.fail('Invalid source should not cause a network request');
  for (const altered of [
    { ...speech, status: 'inconclusive' }, { ...speech, narration_wav_sha256: 'f'.repeat(64) },
    { ...speech, source_script_sha256: 'f'.repeat(64) }, { ...speech, draft_sha256: 'f'.repeat(64) },
    { ...speech, accent_evaluated: true }, { ...speech, deferred_checks: [] },
  ]) assert.deepEqual(await qualifyTipSource(job, wav, altered, env, { request }), { status: 'rejected' });
  assert.deepEqual(await qualifyTipSource({ ...job, draft: { ...job.draft, caption: 'Une autre légende' } },
    wav, speech, env, { request }), { status: 'rejected' });
  assert.deepEqual(await qualifyTipSource({ ...job, expectedPolicyUpdatedAt: 'today' },
    wav, speech, env, { request }), { status: 'rejected' });
  for (const update of [
    { caption: 'Conseil', hashtags: ['JammImmo'] },
    { caption: 'Conseil', cta: 'Retrouvez nos conseils. #Dakar' },
    { caption: 'Conseil', cta: 'Retrouvez nos conseils. #JammImmo #Dakar #dakar' },
    { caption: 'Conseil', cta: 'Retrouvez nos conseils. #jammimmo' },
    { caption: 'Conseil', cta: 'Retrouvez nos conseils. #JammImmo #Dakar #Senegal #Visite #Location #Achat' },
  ]) {
    assert.deepEqual(await qualifyTipSource({ ...job, platformCopy: { ...job.platformCopy, facebook: update } },
      wav, speech, env, { request }), { status: 'rejected' });
  }
  assert.deepEqual(await qualifyTipSource({ ...job, platformCopy: {
    ...job.platformCopy, facebook: job.platformCopy.instagram,
  } }, wav, speech, env, { request }), { status: 'rejected' });
});

test('an unconfirmed private upload stops the chain and cannot register or regenerate a source', async () => {
  const { job, wav, speech } = fixture();
  let requests = 0;
  const result = await qualifyTipSource(job, wav, speech, env, { request: async url => {
    requests++;
    if (url.hostname === 'fixture.actions.githubusercontent.com') return Response.json({ value: 'fixture.signed.jwt' });
    assert.equal(url.pathname, '/api/social/advice/source-narration');
    return new Response(null, { status: 409 });
  } });
  assert.deepEqual(result, { status: 'rejected', stage: 'narration' });
  assert.equal(requests, 2);
});
