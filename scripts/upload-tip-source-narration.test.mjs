import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { uploadTipSourceNarration } from './upload-tip-source-narration.mjs';

const env = {
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://fixture.actions.githubusercontent.com/token',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture-token',
};
function wave() {
  const wav = Buffer.alloc(46);
  wav.write('RIFF'); wav.writeUInt32LE(38, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24_000, 24); wav.writeUInt32LE(48_000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(2, 40);
  return wav;
}

test('retries the exact private WAV after a lost receipt and authenticates its digest', async () => {
  const original = wave();
  const expected = Buffer.from(original);
  const sha256 = createHash('sha256').update(expected).digest('hex');
  let tokens = 0;
  let sends = 0;
  const delays = [];
  const result = await uploadTipSourceNarration(original, env, {
    sleep: async delay => delays.push(delay),
    request: async (url, options) => {
      if (url.hostname === 'fixture.actions.githubusercontent.com') {
        assert.equal(url.searchParams.get('audience'), `urn:jammimmo:tip-v11:machine-source-narration:${sha256}`);
        original.fill(0);
        tokens++;
        return Response.json({ value: 'fixture.signed.jwt' });
      }
      assert.equal(url.href, 'https://jammimmo-estate-flow.jammimmo221admin.workers.dev/api/social/advice/source-narration');
      assert.equal(options.headers['X-Content-SHA256'], sha256);
      assert.equal(options.headers.Authorization, 'Bearer fixture.signed.jwt');
      assert.equal(options.headers['Content-Type'], 'audio/wav');
      assert.equal(options.redirect, 'manual');
      assert.deepEqual(options.body, expected);
      sends++;
      if (sends === 1) throw new Error('response lost');
      return Response.json({ sha256, bytes: expected.length, version: 'v1', etag: 'abc123' });
    },
  });
  assert.deepEqual(result, { status: 'confirmed', receipt: { sha256, bytes: expected.length, version: 'v1', etag: 'abc123' } });
  assert.equal(tokens, 1);
  assert.equal(sends, 2);
  assert.deepEqual(delays, [250]);
});

test('conflicts, redirects and unverifiable receipts never become a successful upload', async () => {
  const wav = wave();
  const sha256 = createHash('sha256').update(wav).digest('hex');
  const good = { sha256, bytes: wav.length, version: 'v1', etag: 'a' };
  for (const response of [
    new Response(null, { status: 409 }), new Response(null, { status: 302 }),
    Response.json({ ...good, sha256: 'f'.repeat(64) }), Response.json({ ...good, bytes: 44 }),
    Response.json({ ...good, version: 'contains a space' }), Response.json({ ...good, etag: '' }),
    Response.json({ ...good, publicUrl: 'https://example.org/should-not-exist.wav' }),
  ]) {
    let calls = 0;
    const result = await uploadTipSourceNarration(wav, env, {
      request: async () => calls++ === 0 ? Response.json({ value: 'fixture.signed.jwt' }) : response,
      sleep: () => assert.fail('Do not retry a definitive conflict or invalid receipt'),
    });
    assert.deepEqual(result, { status: 'rejected' });
    assert.equal(calls, 2);
  }
});

test('invalid WAV or identity endpoint fails before private audio leaves the runner', async () => {
  const request = () => assert.fail('Untrusted requests must not send private audio');
  for (const input of [null, Buffer.alloc(0), Buffer.alloc(8 * 1024 * 1024 + 1), Buffer.alloc(46)]) {
    assert.deepEqual(await uploadTipSourceNarration(input, env, { request }), { status: 'rejected' });
  }
  const altered = wave(); altered.writeUInt32LE(44_100, 24);
  assert.deepEqual(await uploadTipSourceNarration(altered, env, { request }), { status: 'rejected' });
  assert.deepEqual(await uploadTipSourceNarration(wave(), {
    ...env, ACTIONS_ID_TOKEN_REQUEST_URL: 'https://actions.githubusercontent.com.evil.test/token',
  }, { request }), { status: 'attestation_unavailable' });
});
