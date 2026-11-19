import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inspectTipSource } from './inspect-tip-source.mjs';
import {inspectionLogLines, projectInspection} from './tip-source-inspection.mjs';
import { machineSourceFixture } from './fixtures/machine-source-work.mjs';
import { pcmToWav } from './generate-gemini-voiceover.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function fixture(wavInput) {
  const { job, speech, wav: smallWav } = machineSourceFixture();
  const wav = wavInput ?? smallWav;
  const jobId = job.postId, attempt = 2, wavSha256 = hash(wav), qualifierSha = 'b'.repeat(40);
  const event = { action: 'inspect-jamm-tip-source', client_payload: {
    contract: 'tip-v11-source-failure-inspect-v1', jobId, attempt, wavSha256, qualifierSha,
  } };
  const env = { GITHUB_REF: 'refs/heads/main', GITHUB_SHA: qualifierSha, GITHUB_EVENT_NAME: 'repository_dispatch',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://fixture.actions.githubusercontent.com/oidc', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'private',
    PATH: process.env.PATH, HOME: process.env.HOME, RUNNER_TEMP: tmpdir() };
  const original = { stage: 'measured_inconclusive', reason: 'alignment_evidence_invalid', measurementAttempts: 1,
    alignment_code: 'timestamp_regression', row_index: 3, duration_ms: 60000 };
  const header = { contract: 'source-failure-capsule-v1', jobId, attempt, wavSha256, wavKind: 'normalized', draft: job.draft,
    sourceDraftSha256: 'c'.repeat(64), scoringDraftSha256: speech.draft_sha256, runtimeSha256: job.profile.runtimeSha256,
    diagnostic: original, expiresAt: new Date(Date.now() + 3600000).toISOString() };
  function frame(meta = header, audio = wav) {
    const bytes = Buffer.from(JSON.stringify(meta));
    const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
    return Buffer.concat([size, bytes, audio]);
  }
  const requests = [];
  function transport(makeResponse = () => new Response(frame(), { headers: { 'Content-Type': 'application/octet-stream' } })) {
    return async (url, options) => {
      requests.push({ url, options });
      if (url.hostname === 'fixture.actions.githubusercontent.com') return Response.json({ value: 'fake.private.jwt' });
      return makeResponse();
    };
  }
  return { env, event, original, wav, wavSha256, header, speech: { ...speech, narration_wav_sha256: wavSha256 },
    job, frame, transport, requests };
}

test('replay reads one authorized exact draft and WAV, scores privately, and performs zero writes or paid calls', async () => {
  const f = fixture();
  const scratch = await mkdtemp(join(tmpdir(), 'jamm-read-only-'));
  let seen, runtime;
  try {
    const result = await inspectTipSource(f.event, { ...f.env, RUNNER_TEMP: scratch }, {
      request: f.transport(), verifyRuntime: async (digest, env) => { runtime = { digest, env }; },
      score: async (draft, audio, _report, env) => {
        seen = { draft: JSON.parse(await readFile(draft)), wav: await readFile(audio), env,
          fileMode: (await stat(audio)).mode & 0o777, directoryMode: (await stat(env.TMPDIR)).mode & 0o777 };
        return { ...f.speech, status: 'inconclusive', reason: 'alignment_evidence_invalid', alignment_code: 'timestamp_regression',
          row_index: 3, duration_ms: 60000, raw_transcript: 'PRIVATE', segments: [{ status: 'matched', text: 'PRIVATE' }] };
      },
    });
    assert.deepEqual(runtime, { digest: f.header.runtimeSha256, env: seen.env });
    assert.deepEqual(seen.draft, f.job.draft); assert.deepEqual(seen.wav, f.wav);
    assert.equal(seen.fileMode, 0o600); assert.equal(seen.directoryMode, 0o700);
    assert.equal(seen.env.HF_HUB_OFFLINE, '1'); assert.equal(seen.env.TRANSFORMERS_OFFLINE, '1');
    assert.ok(!('ACTIONS_ID_TOKEN_REQUEST_TOKEN' in seen.env) && !('GEMINI_API_KEY' in seen.env));
    assert.deepEqual(await readdir(scratch), []);
    assert.equal(result.status, 'inspected'); assert.deepEqual(result.original, f.original);
    assert.equal(result.replay.alignment_code, 'timestamp_regression'); assert.equal(result.replay.row_index, 3);
    assert.equal(f.requests.length, 2);
    const [oidc, get] = f.requests;
    const { jobId, attempt, wavSha256 } = f.header;
    assert.equal(oidc.url.searchParams.get('audience'), 'urn:jammimmo:tip-v11:source-failure-capsule-read:' + hash(JSON.stringify([jobId, attempt, wavSha256])));
    assert.equal(get.options.method, 'GET'); assert.equal(get.options.redirect, 'manual');
    assert.equal(get.url.href, 'https://jammimmo-estate-flow.jammimmo221admin.workers.dev/api/social/advice/source-failure-capsule');
    assert.deepEqual(get.options.headers, { Authorization: 'Bearer fake.private.jwt', Accept: 'application/octet-stream',
      'Accept-Encoding': 'identity', 'X-Source-Job-Id': jobId, 'X-Source-Attempt': String(attempt), 'X-Content-SHA256': wavSha256 });
    const printed = JSON.stringify(result);
    for (const secret of ['PRIVATE', f.job.draft.scriptFr, f.job.postId, f.job.hookId, 'fake.private.jwt']) assert.ok(!printed.includes(secret));
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('refuses malformed, redirected, expired, missing or mismatched private evidence before scoring', async () => {
  const f = fixture();
  const ok = bytes => new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } });
  const changed = Buffer.from(f.wav); changed[44] ^= 1;
  const hugeHeader = Buffer.from(f.frame()); hugeHeader.writeUInt32BE(16385);
  const invalid = [
    () => new Response(null, { status: 404 }), () => new Response(null, { status: 302, headers: { Location: 'https://example.invalid' } }),
    () => ok(f.frame(f.header, changed)), () => ok(f.frame({ ...f.header, attempt: 1 })),
    () => ok(f.frame({ ...f.header, jobId: f.job.hookId })), () => ok(f.frame({ ...f.header, scoringDraftSha256: 'c'.repeat(64) })),
    () => ok(f.frame({ ...f.header, draft: { ...f.job.draft, caption: 'Different valid caption' } })),
    () => ok(f.frame({ ...f.header, expiresAt: '2000-01-01T00:00:00Z' })), () => ok(hugeHeader),
    () => ok(f.frame({ ...f.header, diagnostic: { ...f.original, transcript: 'PRIVATE' } })),
    () => ok(f.frame({ ...f.header, claimToken: f.job.hookId })),
    () => new Response(f.frame(), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '9999999' } }),
    () => { throw Error('PRIVATE response body'); },
  ];
  let measures = 0;
  for (const makeResponse of invalid) {
    const result = await inspectTipSource(f.event, f.env, {
      request: f.transport(makeResponse), verifyRuntime: async () => { measures++; }, score: async () => { measures++; },
    });
    assert.deepEqual(result, { status: 'unavailable', stage: 'capsule_read' });
  }
  assert.equal(measures, 0);
});

test('rejects qualifier events, stale main pins, extra fields and synthesis credentials before obtaining OIDC', async () => {
  const f = fixture();
  let calls = 0;
  for (const [event, env] of [
    [{ ...f.event, action: 'qualify-jamm-tip-source' }, f.env], [f.event, { ...f.env, GITHUB_SHA: 'c'.repeat(40) }],
    [f.event, { ...f.env, GITHUB_REF: 'refs/pull/1/merge' }], [f.event, { ...f.env, GEMINI_API_KEY: 'private' }],
    [{ ...f.event, client_payload: { ...f.event.client_payload, claimToken: 'forbidden' } }, f.env],
  ]) assert.deepEqual(await inspectTipSource(event, env, { request: () => { calls++; } }), { status: 'rejected', stage: 'dispatch' });
  assert.equal(calls, 0);
});

test('locked-runtime mismatch and substituted scoring reports cannot masquerade as a pass', async () => {
  const f = fixture();
  const badRuntime = await inspectTipSource(f.event, f.env, { request: f.transport(), verifyRuntime: async () => { throw Error('PRIVATE'); } });
  assert.deepEqual(badRuntime, { status: 'unavailable', stage: 'runtime' });
  const wrongWav = await inspectTipSource(f.event, f.env, { request: f.transport(), verifyRuntime: async () => {},
    score: async () => ({ ...f.speech, narration_wav_sha256: '1'.repeat(64) }) });
  assert.deepEqual(wrongWav.replay, { stage: 'measurement_unavailable', reason: 'measurement_error', measurementAttempts: 1 });
});

test('real JS and Python scorers replay synthetic bytes with injected timestamp rows and no TTS or ASR model', async () => {
  const pcm = Buffer.alloc(60 * 48000);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(800, i);
  const f = fixture(pcmToWav(pcm));
  const scratch = await mkdtemp(join(tmpdir(), 'jamm-private-replay-'));
  try {
    const python = join(scratch, 'synthetic-recognizer');
    await writeFile(python, `#!/usr/bin/env python3
import json, sys
from pathlib import Path
from tempfile import TemporaryDirectory
sys.path.insert(0, str(Path(sys.argv[1]).parent))
from score_tip_source import score_source
plan = json.loads(sys.stdin.buffer.readline())
wav = sys.stdin.buffer.read()
rows = [('mot', 0.5, 0.75, 1), ('privee', 0.01, 0.05, 1)]
if Path(__file__).with_suffix('.comparison').is_file():
    from align_tip_v11 import tokens
    words = [word for part in plan['segments'] for word in tokens(part['text'])]
    step = 59 / len(words)
    point = len(tokens(plan['segments'][0]['text'])) + 2
    held = Path(__file__).with_suffix('.held').is_file()
    rows = [('non' if held and i == point else w, .2 + i * step,
             .2 + (i if i == point and not held else i + .8) * step, .99) for i, w in enumerate(words)]
assert sys.argv[2] == '--inspect-trace'
with TemporaryDirectory() as directory:
    print(json.dumps(score_source(plan, wav, Path(directory), lambda _: rows, lambda _: [],
                                  inspection_nonce=sys.argv[3], inspection_attempt=int(sys.argv[4]))))
`, { mode: 0o700 });
    const result = await inspectTipSource(f.event, { ...f.env, RUNNER_TEMP: scratch, TIP_SOURCE_PYTHON: python },
      { request: f.transport(), verifyRuntime: async () => {} });
    assert.equal(result.status, 'inspected');
    assert.equal(result.replay.reason, 'alignment_evidence_invalid');
    assert.equal(result.replay.alignment_code, 'timestamp_regression');
    assert.equal(result.replay.row_index, 1);
    assert.doesNotMatch(JSON.stringify(result), /privee|fake\.private\.jwt/);
    const trace = result.inspection.attempts[0];
    assert.equal(trace.status, 'available');
    assert.ok(trace.scenes.every(s => s.status === 'not_evaluated'));
    assert.deepEqual(trace.calls[0].rows[1].slice(0, 4), [1, 240, 1200, 1000]);
    // An authorized holder can reproduce this fingerprint without giving the log a public dictionary key.
    const master = createHash('sha256').update('jamm-source-inspection-private-wav-v1').update(Buffer.from([0])).update(f.wav).digest();
    const rowKey = createHmac('sha256', master).update('row-key-v1').update(Buffer.from([0]))
      .update(Buffer.from(result.inspection.nonce, 'hex')).digest();
    const rowFingerprint = createHmac('sha256', rowKey).update(JSON.stringify(['row-v1', 1, 'full_audio', 1, 1, 'privee'])).digest('hex');
    assert.equal(trace.calls[0].rows[1][4], rowFingerprint);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(master.toString('hex') + '|' + rowKey.toString('hex')));
    assert.deepEqual(await readdir(scratch), ['synthetic-recognizer']);
    await writeFile(python + '.comparison', '', { mode: 0o600 });
    const comparison = await inspectTipSource(f.event, { ...f.env, RUNNER_TEMP: scratch, TIP_SOURCE_PYTHON: python },
      { request: f.transport(), verifyRuntime: async () => {} });
    assert.equal(comparison.replay.reason, 'recognition_or_timing_inconclusive');
    assert.equal(comparison.replay.segmentCount, 0);
    assert.equal(comparison.replay.comparison.predicate, 'timestamp_zero_duration');
    assert.equal(comparison.replay.comparison.segment_index, 1);
    assert.equal(comparison.original.comparison, undefined);
    assert.notEqual(result.inspection.nonce, comparison.inspection.nonce);
    await writeFile(python + '.held', '', { mode: 0o600 });
    const held = await inspectTipSource(f.event, { ...f.env, RUNNER_TEMP: scratch, TIP_SOURCE_PYTHON: python },
      { request: f.transport(), verifyRuntime: async () => {} });
    assert.equal(held.replay.matchedSegments, 9);
    assert.equal(held.replay.segmentCount, 10);
    const evidence = held.inspection.attempts[0];
    assert.equal(evidence.status, 'available');
    assert.equal(evidence.truncated, false);
    const [failed] = evidence.scenes.filter(s => s.status === 'inconclusive');
    assert.equal(failed.id, 'hook');
    assert.ok(failed.gateFlags.includes('protected_mismatch'));
    assert.equal(evidence.global.protectedMatch, false);
    assert.equal(held.original.inspection_evidence, undefined);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('comparison failures expose only bounded predicates in exact inspections and never enter producer diagnostics', async () => {
  const { measureSource } = await import('./measure-tip-source.mjs');
  const f = fixture();
  const trusted = { phase: 'word_assignment', predicate: 'timestamp_zero_duration', row_index: 25, row_count: 151, segment_index: 4 };
  const failed = { ...f.speech, status: 'inconclusive', reason: 'recognition_or_timing_inconclusive', segments: [],
    comparison_failure: { ...trusted, text: 'SECRET', exception: 'PRIVATE' } };
  const result = await inspectTipSource(f.event, f.env, { request: f.transport(), verifyRuntime: async () => {}, score: async () => failed });
  assert.deepEqual(result.original, f.original);
  assert.deepEqual(result.replay.comparison, trusted);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|PRIVATE/);
  const production = await measureSource(async () => failed, '', '', '.', {});
  assert.equal(production.comparison, undefined);
  assert.equal(production.diagnostic.comparison, undefined);
  assert.equal(production.diagnostic.row_index, undefined);
  for (const [detail, expected] of [
    [{ ...trusted, predicate: 'SECRET' }, undefined],
    [{ ...trusted, phase: 'SECRET' }, undefined],
    [{ ...trusted, row_index: -1 }, undefined],
    [{ ...trusted, row_index: 501 }, undefined],
    [{ ...trusted, row_index: true }, undefined],
    [{ ...trusted, row_count: 1, segment_index: 32 }, { phase: trusted.phase, predicate: trusted.predicate, row_index: trusted.row_index }],
    [{ phase: 'french_comparison', predicate: 'unclassified_value_error', message: 'SECRET' },
     { phase: 'french_comparison', predicate: 'unclassified_value_error' }],
  ]) {
    const inspected = await measureSource(async () => ({ ...failed, comparison_failure: detail }), '', '', '.', {}, { inspectComparison: true });
    assert.deepEqual(inspected.comparison, expected);
    assert.doesNotMatch(JSON.stringify(inspected), /SECRET|PRIVATE/);
  }
  for (const override of [{ reason: 'ordered_words_unconfirmed' }, { segments: [{ status: 'inconclusive' }] }]) {
    const inspected = await measureSource(async () => ({ ...failed, ...override }), '', '', '.', {}, { inspectComparison: true });
    assert.equal(inspected.comparison, undefined);
  }
});

const fixtureDigest = 'a'.repeat(64);
const identity = {nonce: '1'.repeat(32), attempt: 1, wavSha256: fixtureDigest, draftSha256: fixtureDigest, scriptSha256: fixtureDigest};
function evidence() {
  const ids = ['hook', 'step1', 'step2', 'step3', 'takeaway', 'services', 'tools', 'contact', 'phone', 'socials'];
  return {
    ...identity, version: 1, pcmSha256: fixtureDigest, modelRevision: '0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf',
    sourceFrames: 1500000, truncated: false, global: {status: 'inconclusive', expectedCount: 108, editCount: null, protectedMatch: null},
    scenes: ids.map(id => ({id, status: 'not_evaluated', startSample: null, endSample: null, expectedCount: 10,
      observedCount: null, nullCount: null, editCount: null, protectedMatch: null, method: null, reason: null,
      gateFlags: [], uncertainPositions: [], rawMismatchPositions: []})),
    calls: [{callIndex: 1, stage: 'full_audio', outcome: 'completed', startSample: 0, endSample: 1500000, pcmSha256: fixtureDigest,
      streamDigest: fixtureDigest, rowCount: 1, omittedRows: 0, rows: [[0, -1, null, 907, fixtureDigest]]}],
  };
}
test('public projection keeps signed measurements and strips private data at all levels', () => {
  const e = evidence();
  for (const obj of [e, e.global, e.scenes[0], e.calls[0]]) obj.privatePath = 'PRIVATE';
  const a = projectInspection(e, identity);
  assert.equal(a.status, 'available');
  assert.deepEqual(a.calls[0].rows[0], [0, -1, null, 907, fixtureDigest]);
  assert.ok(!JSON.stringify(a).includes('PRIVATE'));
  e.calls[0].stage = 'alignment_greeting';
  assert.equal(projectInspection(e, identity).calls[0].stage, 'alignment_greeting');
  const phone = e.scenes.find(s => s.id === 'phone');
  Object.assign(phone, {status: 'matched', method: 'fixed_phone_plus_scored_as_edit_v1',
    observedCount: 16, expectedCount: 16, editCount: 1, nullCount: 1, uncertainPositions: [0], protectedMatch: true});
  assert.deepEqual(projectInspection(e, identity).scenes.find(s => s.id === 'phone'), phone);
});
test('invalid bindings, enum, sample, digest, scene identity and row shapes fail closed', () => {
  for (const change of [
    e => e.wavSha256 = 'b'.repeat(64), e => e.nonce = '2'.repeat(32), e => e.attempt = 2,
    e => e.calls[0].stage = 'SECRET', e => e.global.status = 'SECRET', e => e.scenes[0].method = 'SECRET',
    e => e.scenes[0].reason = 'SECRET', e => e.scenes[0].gateFlags = ['SECRET'],
    e => e.scenes[0].id = 'socials', e => e.calls[0].rows[0][4] = 'SECRET',
    e => e.calls[0].rows[0].push('SECRET'), e => e.calls[0].rows[0][1] = 'SECRET',
    e => e.calls[0].omittedRows = 500, e => e.sourceFrames = 3e6,
  ]) {
    const e = evidence();
    change(e);
    assert.deepEqual(projectInspection(e, identity), {status: 'unavailable', attempt: 1});
  }
});
test('summary is first, row chunks are bounded and every dropped row is accounted for', () => {
  const attempts = [1, 2].map(attempt => {
    const e = evidence();
    e.attempt = attempt;
    e.calls = Array.from({length: 12}, (_, i) => ({...e.calls[0], callIndex: i + 1, rowCount: 500,
      rows: Array.from({length: 500}, (_, n) => [n, 10, 20, 900, fixtureDigest])}));
    return projectInspection(e, {...identity, attempt});
  });
  const lines = inspectionLogLines({status: 'inspected', inspection: {nonce: identity.nonce, attempts}});
  assert.ok(lines.length > 1);
  assert.ok(lines.every(s => Buffer.byteLength(s) + 1 <= 16384));
  assert.ok(Buffer.byteLength(lines.join('\n') + '\n') <= 1024 * 1024);
  const [summary, ...chunks] = lines.map(s => JSON.parse(s));
  for (const a of summary.inspection.attempts) {
    for (const c of a.calls) {
      const rows = chunks.filter(x => x.callIndex === c.callIndex && x.attempt === a.attempt).flatMap(x => x.rows);
      assert.equal(rows.length + c.omittedRows, 500);
      assert.equal(c.rows, undefined);
    }
  }
  assert.deepEqual(inspectionLogLines({status: 'unavailable'}), ['{"status":"unavailable"}']);
});
test('maximal metadata is chunked intact, with row losses measurable for each call', () => {
  const attempts = [1, 2].map(attempt => {
    const e = evidence();
    e.attempt = attempt;
    e.global.ruleEvaluated = true;
    e.global.editBudgetExceeded = false;
    for (const s of e.scenes) Object.assign(s, {observedCount: 150000,
      uncertainPositions: Array.from({length: 128}, (_, i) => i),
      rawMismatchPositions: Array.from({length: 128}, (_, i) => i),
      gateFlags: ['unreportable_words', 'unsafe_uncertainty', 'edit_budget_exceeded', 'protected_mismatch',
        'standalone_plus', 'mixed_boundary', 'domain_unconfirmed', 'focused_matched', 'focused_unconfirmed',
        'focus_not_eligible', 'untimed_word_counted', 'score_matched', 'global_edits_exceeded']});
    e.calls = Array.from({length: 12}, (_, i) => ({...e.calls[0], callIndex: i + 1, rowCount: 500,
      rows: Array.from({length: 500}, (_, n) => [n, 240000, 290000, 900, fixtureDigest])}));
    return projectInspection(e, {...identity, attempt});
  });
  const lines = inspectionLogLines({status: 'inspected', inspection: {nonce: identity.nonce, attempts}});
  assert.ok(lines.every(s => Buffer.byteLength(s) + 1 <= 16384));
  assert.ok(Buffer.byteLength(lines.join('\n') + '\n') <= 1024 * 1024);
  const [summary, ...records] = lines.map(s => JSON.parse(s));
  assert.equal(summary.inspection.metadataChunked, true);
  assert.ok(summary.inspection.attempts.some(a => a.truncated));
  for (const a of summary.inspection.attempts) {
    assert.deepEqual([a.sceneCount, a.callCount, a.global.ruleEvaluated, a.global.editBudgetExceeded], [10, 12, true, false]);
    const own = records.filter(r => r.attempt === a.attempt);
    assert.deepEqual(own.filter(r => r.type === 'inspection_scene').map(r => r.scene), attempts[a.attempt - 1].scenes);
    const calls = own.filter(r => r.type === 'inspection_call');
    assert.equal(calls.length, 12);
    for (const {call} of calls) {
      const rows = own.filter(r => r.type === 'inspection_rows' && r.callIndex === call.callIndex).flatMap(r => r.rows);
      assert.equal(rows.length + call.omittedRows, call.rowCount);
    }
  }
});
