import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deliverTipVideo } from './deliver-tip-video.mjs';
import { canonicalVideoDiagnostic, deliverTipFailure } from './deliver-tip-failure.mjs';
import { classifyTipAuditFailure, serializeTipAuditFailure } from './tip-render-failure-diagnostic.mjs';

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
const auditFailure = 'V11 technical delivery proof failed (render_audit_rejected); GitHub run 123';
const auditReport = {
  contract: 'tip-v11-fr-objective-media-evidence-v1',
  passed: false,
  audio_waveform: { passed: false, segments: [
    { passed: false, segment: 'private scene label', narration_similarity: 0.91, narration_gain_ratio: 0.71,
      min_audible_mix_similarity: 0.84, audible_mix_windows: 2 },
    { passed: false, narration_similarity: 0.99, narration_gain_ratio: 0.8,
      min_audible_mix_similarity: 0, audible_mix_windows: 0 },
    { passed: true, narration_similarity: 0.97, narration_gain_ratio: 1.1,
      min_audible_mix_similarity: 0.97, audible_mix_windows: 1 },
  ] },
  sampled_frame_ocr: { passed: false, frames: [
    { passed: false, check: 'private OCR text', expected_text_sha256: 'c'.repeat(64), frame: 100 },
    { passed: true, check: 'other content' },
  ] },
  final_french_speech: { passed: false, text: 'private speech' },
};

test('terminal V11 audit diagnostic projects failed metrics and strips private report content', () => {
  const diagnostic = classifyTipAuditFailure('render_audit_rejected', auditReport);
  assert.deepEqual(diagnostic, { version: 1, stage: 'quality', code: 'render_audit_audio_and_ocr_rejected', checks: [
    { key: 'audio_segments_failed', actual: 2, threshold: 0, relation: 'eq' },
    { key: 'audio_min_narration_similarity', actual: 0.91, threshold: 0.96, relation: 'gte' },
    { key: 'audio_min_mix_similarity', actual: 0.84, threshold: 0.94, relation: 'gte' },
    { key: 'audio_min_audible_windows', actual: 0, threshold: 1, relation: 'gte' },
    { key: 'ocr_frames_failed', actual: 1, threshold: 0, relation: 'eq' },
  ] });
  const packet = serializeTipAuditFailure(diagnostic);
  assert.deepEqual(JSON.parse(packet), diagnostic);
  assert.doesNotMatch(packet, /private|sha256|frame":/);
  assert.match(packet, /^[\x20-\x7e]{1,1800}$/);

  const ocrOnly = classifyTipAuditFailure('render_audit_rejected', { ...auditReport, audio_waveform: { passed: true } });
  assert.equal(ocrOnly.code, 'render_audit_sampled_ocr_rejected');
  assert.deepEqual(ocrOnly.checks, [diagnostic.checks.at(-1)]);
  const audioOnly = classifyTipAuditFailure('render_audit_rejected', { ...auditReport,
    audio_waveform: { passed: false, segments: [{ passed: true }] }, sampled_frame_ocr: { passed: true } });
  assert.deepEqual(audioOnly, { version: 1, stage: 'quality', code: 'render_audit_audio_waveform_rejected', checks: [] });
  assert.deepEqual(classifyTipAuditFailure('render_audit_unavailable'), {
    version: 1, stage: 'quality', code: 'render_audit_unavailable', checks: [],
  });
  assert.equal(classifyTipAuditFailure('render_audit_rejected', { ...auditReport, passed: true }).code,
    'render_audit_rejected');
});

test('terminal failure attaches only a verified and compatible audit diagnostic', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jamm-tip-audit-failure-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'diagnostic.json');
  const diagnostic = classifyTipAuditFailure('render_audit_rejected', auditReport);
  const headers = [];
  const transport = { request: async (_url, options) => {
    headers.push(options.headers);
    return Response.json(failed);
  } };
  await writeFile(path, JSON.stringify(diagnostic) + '\n', { mode: 0o600 });
  assert.equal(await deliverTipFailure(auditFailure, { ...env, TIP_VIDEO_DIAGNOSTIC_FILE: path }, transport), 'recorded');
  assert.equal(headers[0]['X-Error'],
    'V11 technical delivery proof failed (render_audit_audio_and_ocr_rejected); GitHub run 123');
  assert.deepEqual(JSON.parse(headers[0]['X-Video-Diagnostic']), diagnostic);
  const invalidPackets = [
    { ...diagnostic, privateText: 'never forward this' },
    { ...diagnostic, code: 'render_audit_unavailable', checks: [] },
    { ...diagnostic, checks: [{ ...diagnostic.checks[0], threshold: 1 }] },
    { ...diagnostic, checks: [{ ...diagnostic.checks[0], actual: 0 }] },
    { ...diagnostic, checks: [{ ...diagnostic.checks[0], key: 'unknown_key' }] },
    { ...diagnostic, checks: [diagnostic.checks[0], diagnostic.checks[0]] },
    { ...diagnostic, code: 'render_audit_sampled_ocr_rejected' },
  ];
  for (const packet of invalidPackets) {
    await writeFile(path, JSON.stringify(packet) + '\n', { mode: 0o600 });
    assert.equal(await deliverTipFailure(auditFailure, { ...env, TIP_VIDEO_DIAGNOSTIC_FILE: path }, transport), 'recorded');
  }
  for (const entry of headers.slice(1)) {
    assert.equal(entry['X-Error'], auditFailure);
    assert.equal(entry['X-Video-Diagnostic'], undefined);
  }
});

test('audit diagnostics preserve every supported failing measure in one bounded packet', () => {
  const diagnostic = classifyTipAuditFailure('render_audit_rejected', { ...auditReport,
    audio_waveform: {
      ...auditReport.audio_waveform,
      failure_measurements: { audio_length_difference_samples: 3_001, audio_signature_tail_match: 0,
        audio_min_mix_gain: 0.64, audio_max_mix_gain: 1.21 },
      segments: [
        ...auditReport.audio_waveform.segments,
        { passed: false, narration_gain_ratio: 1.3, narration_similarity: 0.9599999, audible_mix_windows: 1 },
        { passed: false, narration_gain_ratio: 0.6, audible_mix_windows: 1 },
        { passed: false, audible_mix_windows: 0 },
      ],
    },
  });
  assert.equal(diagnostic.checks.length, 11);
  assert.deepEqual(diagnostic.checks.slice(0, 4), [
    { key: 'audio_length_difference_samples', actual: 3_001, threshold: 3_000, relation: 'lte' },
    { key: 'audio_signature_tail_match', actual: 0, threshold: 1, relation: 'eq' },
    { key: 'audio_min_mix_gain', actual: 0.64, threshold: 0.65, relation: 'gte' },
    { key: 'audio_max_mix_gain', actual: 1.21, threshold: 1.20, relation: 'lte' },
  ]);
  assert.equal(diagnostic.checks.at(-1).key, 'ocr_frames_failed');
  const packet = serializeTipAuditFailure(diagnostic);
  assert.ok(Buffer.byteLength(packet) <= 1800);
  assert.deepEqual(JSON.parse(packet), diagnostic);
});

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

test('eligible signature failure retries the same closed diagnostic packet', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jamm-tip-failure-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'diagnostic.json');
  const receipt = { version: 1, stage: 'render', code: 'signature_retry_insufficient', checks: [{
    key: 'audio_signature_words_recognized', actual: 2, threshold: 3, relation: 'gte',
  }] };
  await writeFile(path, JSON.stringify(receipt) + '\n', { mode: 0o600 });
  const requests = [];
  const result = await deliverTipFailure(failure, { ...env, TIP_VIDEO_DIAGNOSTIC_FILE: path }, {
    request: async (_target, options) => {
      requests.push(options.headers);
      if (requests.length < 3) return new Response(null, { status: 503 });
      return Response.json(failed);
    },
    sleep: async () => {},
  });
  assert.equal(result, 'recorded');
  assert.equal(requests.length, 3);
  const expected = '{"version":1,"stage":"render","code":"signature_retry_insufficient",'
    + '"checks":[{"key":"audio_signature_words_recognized","actual":2,"threshold":3,"relation":"gte"}]}';
  for (const headers of requests) {
    assert.equal(headers['X-Video-Diagnostic'], expected);
    assert.equal(headers['X-Error'], failure);
  }
});

test('diagnostic receipt is closed, count-bounded and falls back to the compatible plain failure callback', async t => {
  const base = actual => ({ version: 1, stage: 'render', code: 'signature_retry_insufficient', checks: [{
    key: 'audio_signature_words_recognized', actual, threshold: 3, relation: 'gte',
  }] });
  for (const actual of [0, 1, 2]) {
    assert.equal(JSON.parse(canonicalVideoDiagnostic(failure, base(actual))).checks[0].actual, actual);
  }
  const initialFailure = 'V11 speech alignment failed (signature_evidence_insufficient); GitHub run 1';
  assert.equal(JSON.parse(canonicalVideoDiagnostic(initialFailure, {
    ...base(1), code: 'signature_evidence_insufficient',
  })).code, 'signature_evidence_insufficient');
  for (const invalid of [base(3), base(-1), { ...base(2), rawTranscript: 'private' },
    { ...base(2), code: 'signature_evidence_insufficient' },
    { ...base(2), checks: [{ ...base(2).checks[0], threshold: 2 }] }]) {
    assert.equal(canonicalVideoDiagnostic(failure, invalid), null);
  }
  assert.equal(canonicalVideoDiagnostic(failure.replace('run 123', 'run 0'), base(2)), null);

  const directory = await mkdtemp(join(tmpdir(), 'jamm-tip-failure-fallback-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'diagnostic.json');
  await writeFile(path, JSON.stringify({ ...base(2), code: 'signature_evidence_insufficient' }));
  let observed;
  assert.equal(await deliverTipFailure(failure, { ...env, TIP_VIDEO_DIAGNOSTIC_FILE: path }, {
    request: async (_target, options) => {
      observed = options.headers;
      return Response.json(failed);
    },
  }), 'recorded');
  assert.deepEqual(observed, { Authorization: 'Bearer ' + token, 'X-Job-Id': jobId, 'X-Error': failure });
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
