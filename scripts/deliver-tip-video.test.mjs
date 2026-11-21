import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { deliverTipVideo } from './deliver-tip-video.mjs';
import { deliverTipFailure } from './deliver-tip-failure.mjs';

const jobId = '00000000-0000-4000-8000-000000000011';
const attempt = '00000000-0000-4000-8000-000000000022';
const url = 'https://jammimmo-estate-flow.jammimmo221admin.workers.dev/api/tour/upload?attempt=' + attempt;
const token = 'a'.repeat(64);
const env = { TIP_JOB_ID: jobId, TIP_CALLBACK_TOKEN: token, TIP_UPLOAD_URL: url,
  TIP_RENDER_EVIDENCE: '{"fixture":true}', TIP_WORKFLOW_ATTESTATION: 'signed.example.token' };
const media = Buffer.from('exact private video bytes');
const digest = createHash('sha256').update(media).digest('hex');
const input = { video: media, digest, duration: 70 };
const attached = { ok: true, jobId, status: 'succeeded', attached: true };

test('lost reply after attachment resends the same attempt, bytes and signed headers', async t => {
  const seen = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    seen.push({ body: Buffer.concat(chunks), headers: request.headers, url: request.url });
    if (seen.length === 1) {
      // The receiver accepted the first body, but the client cannot observe its receipt.
      response.destroy();
    } else {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(attached));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const local = `http://127.0.0.1:${server.address().port}`;
  const delays = [];
  const result = await deliverTipVideo(input, env, {
    request: (target, options) => {
      assert.equal(target.href, url);
      assert.equal(options.redirect, 'manual');
      return fetch(local + target.pathname + target.search, options);
    },
    sleep: async delay => { delays.push(delay); },
  });
  assert.equal(result, 'attached');
  assert.deepEqual(delays, [250]);
  assert.equal(seen.length, 2);
  for (const request of seen) {
    assert.deepEqual(request.body, media);
    assert.equal(request.url, '/api/tour/upload?attempt=' + attempt);
    assert.equal(request.headers.authorization, 'Bearer ' + token);
    assert.equal(request.headers['x-media-sha256'], digest);
    assert.equal(request.headers['x-tip-render-evidence'], env.TIP_RENDER_EVIDENCE);
    assert.equal(request.headers['x-tip-workflow-oidc'], env.TIP_WORKFLOW_ATTESTATION);
    assert.equal(request.headers['content-length'], String(media.length));
  }
});

test('transient status handling is bounded, honors backoff and never counts a missing receipt as attachment', async () => {
  const delays = [];
  const queue = [new Response(null, { status: 503, headers: { 'Retry-After': '5' } }),
    new Response(null, { status: 429 }), Response.json(attached)];
  assert.equal(await deliverTipVideo(input, env, {
    request: async () => queue.shift(),
    sleep: async value => { delays.push(value); },
  }), 'attached');
  assert.deepEqual(delays, [5000, 1000]);
  assert.equal(queue.length, 0);

  const edgeReplies = [new Response(null, { status: 522 }), new Response(null, { status: 524 }), Response.json(attached)];
  assert.equal(await deliverTipVideo(input, env, {
    request: async () => edgeReplies.shift(), sleep: async () => {},
  }), 'attached');
  assert.equal(edgeReplies.length, 0);

  let count = 0;
  assert.equal(await deliverTipVideo(input, env, {
    request: async () => { count++; return new Response(null, { status: 502 }); }, sleep: async () => {},
  }), 'temporarily_unavailable');
  assert.equal(count, 3);

  count = 0;
  assert.equal(await deliverTipVideo(input, env, {
    request: async () => { count++; return new Response(null, { status: 429, headers: { 'Retry-After': '60' } }); },
    sleep: async () => assert.fail('do not ignore a backoff outside the workflow budget'),
  }), 'temporarily_unavailable');
  assert.equal(count, 1);

  const badReceipts = [Response.json({ ...attached, jobId: attempt }), Response.json({ ...attached, attached: false }),
    new Response('x'.repeat(4097))];
  for (const receipt of badReceipts) {
    assert.equal(await deliverTipVideo(input, env, {
      request: async () => receipt, sleep: async () => assert.fail('an invalid receipt is an explicit refusal'),
    }), 'rejected');
  }
});

test('stale claims, bad permissions, redirects and drifted local bytes are terminal refusals', async () => {
  for (const status of [307, 400, 401, 409, 422]) {
    let calls = 0;
    assert.equal(await deliverTipVideo(input, env, {
      request: async () => { calls++; return new Response(null, { status }); },
      sleep: async () => assert.fail('never replay an explicit refusal'),
    }), 'rejected');
    assert.equal(calls, 1);
  }
  const forbidden = async () => assert.fail('invalid source or destination must not send a body');
  assert.equal(await deliverTipVideo({ ...input, digest: 'b'.repeat(64) }, env, { request: forbidden }), 'rejected');
  assert.equal(await deliverTipVideo(input, { ...env, TIP_UPLOAD_URL: url + '&status=failed' }, { request: forbidden }), 'rejected');
  assert.equal(await deliverTipVideo(input, { ...env, TIP_UPLOAD_URL: url.replace('workers.dev', 'workers.dev.example') },
    { request: forbidden }), 'rejected');
});

test('strict private delivery requires both evidence and OIDC before any network request', async () => {
  const forbidden = async () => assert.fail('missing strict proof must not contact the Worker');
  for (const changes of [
    { TIP_RENDER_EVIDENCE: '', TIP_WORKFLOW_ATTESTATION: '' },
    { TIP_WORKFLOW_ATTESTATION: '' },
    { TIP_REQUIRED_RENDER_ATTESTATION: 'true' },
  ]) {
    assert.equal(await deliverTipVideo(input, { ...env, TIP_REQUIRED_RENDER_ATTESTATION: '1', ...changes },
      { request: forbidden }), 'rejected');
  }

  const seen = [];
  const legacy = { ...env, TIP_RENDER_EVIDENCE: '', TIP_WORKFLOW_ATTESTATION: '' };
  assert.equal(await deliverTipVideo(input, legacy, {
    request: async (_url, options) => {
      seen.push(options.headers);
      return Response.json(attached);
    },
  }), 'attached');
  assert.equal(seen.length, 1);
  assert.equal(seen[0]['X-Tip-Render-Evidence'], undefined);
  assert.equal(seen[0]['X-Tip-Workflow-OIDC'], undefined);
});

const failure = 'V11 speech alignment failed (signature_retry_insufficient); GitHub run 123';
const failed = { ok: true, jobId, status: 'failed' };

test('terminal failure retries the unchanged signed callback after transport loss and temporary refusal', async () => {
  const requests = [];
  const delays = [];
  const result = await deliverTipFailure(failure, env, {
    request: async (target, options) => {
      requests.push({ url: target.href, options });
      if (requests.length === 1) throw new TypeError('fixture connection lost');
      if (requests.length === 2) return new Response(null, { status: 503, headers: { 'Retry-After': '5' } });
      return Response.json(failed);
    },
    sleep: async delay => { delays.push(delay); },
  });
  assert.equal(result, 'recorded');
  assert.deepEqual(delays, [250, 5000]);
  assert.equal(requests.length, 3);
  for (const { url: target, options } of requests) {
    assert.equal(target, url + '&status=failed');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.body, undefined);
    assert.deepEqual(options.headers, { Authorization: 'Bearer ' + token, 'X-Job-Id': jobId, 'X-Error': failure });
  }
});

test('terminal failure bounds retries and honors bounded Retry-After dates', async () => {
  const now = Date.parse('2026-11-16T00:00:00Z');
  const replies = [new Response(null, { status: 408 }), new Response(null, { status: 429, headers: {
    'Retry-After': new Date(now + 4000).toUTCString(),
  } }), new Response(null, { status: 524 })];
  const delays = [];
  const result = await deliverTipFailure(failure, env, {
    request: async () => replies.shift(), sleep: async delay => { delays.push(delay); }, now: () => now,
  });
  assert.equal(result, 'temporarily_unavailable');
  assert.equal(replies.length, 0);
  assert.deepEqual(delays, [250, 4000]);

  let calls = 0;
  assert.equal(await deliverTipFailure(failure, env, {
    request: async () => { calls++; return new Response(null, { status: 503, headers: { 'Retry-After': '11' } }); },
    sleep: async () => assert.fail('do not ignore a backoff outside the workflow budget'),
  }), 'temporarily_unavailable');
  assert.equal(calls, 1);
});

test('terminal failure stops on refusal, redirect or a response unrelated to the exact job', async () => {
  const replies = [new Response(null, { status: 403 }), new Response(null, { status: 409 }),
    new Response(null, { status: 302, headers: { Location: 'https://other.test/' } }),
    Response.json({ ...failed, jobId: attempt }), Response.json({ ...failed, status: 'succeeded' }),
    new Response('x'.repeat(4097))];
  for (const reply of replies) {
    let calls = 0;
    assert.equal(await deliverTipFailure(failure, env, {
      request: async () => { calls++; return reply; }, sleep: async () => assert.fail('do not replay an explicit refusal'),
    }), 'rejected');
    assert.equal(calls, 1);
  }
});

test('terminal failure validates the callback scope before sending credentials', async () => {
  const request = async () => assert.fail('invalid callback must not send credentials');
  for (const TIP_UPLOAD_URL of [url + '&status=failed', url.replace('workers.dev', 'workers.dev.other.test'),
    url.replace('/api/tour/upload', '/api/tour/callback'), url.replace(attempt, 'invalid'), url + '#fragment']) {
    assert.equal(await deliverTipFailure(failure, { ...env, TIP_UPLOAD_URL }, { request }), 'rejected');
  }
  assert.equal(await deliverTipFailure(failure, { ...env, TIP_CALLBACK_TOKEN: 'invalid' }, { request }), 'rejected');
  assert.equal(await deliverTipFailure('failure\r\nforged header', env, { request }), 'rejected');
});
