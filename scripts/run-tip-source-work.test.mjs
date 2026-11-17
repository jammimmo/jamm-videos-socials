import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readTipSourceDispatch, runTipSourceWork } from './run-tip-source-work.mjs';
import { machineSourceFixture } from './fixtures/machine-source-work.mjs';
import { TIP_DELIVERY_ORIGIN } from './tip-v11-reviewed-narration.mjs';

function fixture() {
  const { job: source, speech, wav } = machineSourceFixture();
  const sourceJob = { id: source.postId, claimToken: source.hookId, attempt: 1 };
  const env = { GITHUB_SHA: 'a'.repeat(40), GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'repository_dispatch', GEMINI_API_KEY: 'fixture-only' };
  const event = { action: 'qualify-jamm-tip-source', client_payload: {
    contract: 'tip-v11-machine-source-dispatch-v1', sourceJob, source, qualifierSha: env.GITHUB_SHA,
    delivery: Object.fromEntries(['attempt', 'narration', 'qualification'].map(name => [`${name}Url`, `${TIP_DELIVERY_ORIGIN}/api/social/advice/source-${name}`])),
  } };
  return { event, source, sourceJob, env, speech, wav };
}

test('refuses foreign destinations, revisions and malformed scripts before claiming work', () => {
  const { event, env } = fixture();
  const invalid = [
    { ...event, action: 'other' },
    { ...event, client_payload: { ...event.client_payload, qualifierSha: 'b'.repeat(40) } },
    { ...event, client_payload: { ...event.client_payload, delivery: { ...event.client_payload.delivery, narrationUrl: 'https://example.org/audio' } } },
    { ...event, client_payload: { ...event.client_payload, source: { ...event.client_payload.source, draft: { ...event.client_payload.source.draft, scriptFr: 'Texte court.' } } } },
  ];
  for (const input of invalid) assert.throws(() => readTipSourceDispatch(input, env));
  assert.throws(() => readTipSourceDispatch(event, { ...env, GITHUB_REF: 'refs/heads/feature' }));
});

test('one acknowledged source start calls the exact Ngor voice once and qualifies its normalized WAV', async () => {
  const { event, env, sourceJob, source, speech, wav } = fixture();
  const scratchRoot = await mkdtemp(join(tmpdir(), 'jamm-source-controller-test-'));
  const calls = [];
  try {
    const result = await runTipSourceWork(event, { ...env, RUNNER_TEMP: scratchRoot }, {
      verifyRuntime: async (expected, actualEnv) => {
        assert.equal(expected, source.profile.runtimeSha256); assert.equal(actualEnv.RUNNER_TEMP, scratchRoot);
        calls.push('runtime');
      },
      updateAttempt: async (identity, action, reason) => {
        assert.deepEqual(identity, sourceJob); assert.equal(reason, null); calls.push(action);
        return { status: 'confirmed' };
      },
      generateSpeech: async options => {
        calls.push('voice'); assert.equal(options.profile, 'tip-v11-fr'); assert.equal(options.context, '');
        assert.match(options.script, /Salam alikoum/); assert.match(options.script, /Kër gu baax/);
        assert.ok(options.script.includes(source.draft.scriptFr));
        return wav.subarray(44);
      },
      normalize: async (_root, raw, normalized, options) => {
        calls.push('normalize'); assert.equal(options.exactTourV8, true);
        assert.deepEqual(await readFile(raw), wav); await writeFile(normalized, wav);
      },
      score: async () => { calls.push('score'); return speech; },
      qualify: async (job, normalized, report) => {
        calls.push('qualify'); assert.deepEqual(job.sourceJob, sourceJob); assert.deepEqual(normalized, wav); assert.equal(report, speech);
        return { status: 'confirmed', receipt: { postId: source.postId } };
      },
    });
    assert.equal(result.status, 'confirmed');
    assert.deepEqual(calls, ['runtime', 'start', 'voice', 'normalize', 'score', 'qualify']);
    assert.deepEqual(await readdir(scratchRoot), []);
  } finally { await rm(scratchRoot, { recursive: true, force: true }); }
});

test('repeated workflow cannot call TTS without its own confirmed durable start', async () => {
  const { event, env } = fixture();
  const result = await runTipSourceWork(event, { ...env, RUNNER_TEMP: tmpdir() }, {
    verifyRuntime: async () => {},
    updateAttempt: async () => ({ status: 'rejected' }),
    generateSpeech: () => assert.fail('Duplicate start must not call TTS'),
  });
  assert.deepEqual(result, { status: 'rejected', stage: 'start' });
});

test('a held speech score records its reason and does not upload or regenerate voice', async () => {
  const { event, env, wav } = fixture();
  const scratchRoot = await mkdtemp(join(tmpdir(), 'jamm-source-controller-held-'));
  const calls = [];
  try {
    const result = await runTipSourceWork(event, { ...env, RUNNER_TEMP: scratchRoot }, {
      verifyRuntime: async () => {},
      updateAttempt: async (_job, action, reason) => { calls.push([action, reason]); return { status: 'confirmed' }; },
      generateSpeech: async () => { calls.push('voice'); return wav.subarray(44); },
      normalize: async (_root, _raw, normalized) => writeFile(normalized, wav),
      score: async () => ({ status: 'inconclusive' }),
      qualify: () => assert.fail('Unqualified speech must not be registered'),
    });
    assert.equal(result.reason, 'source_evidence_inconclusive');
    assert.deepEqual(calls, [['start', null], 'voice', ['failed', 'source_evidence_inconclusive']]);
    assert.deepEqual(await readdir(scratchRoot), []);
  } finally { await rm(scratchRoot, { recursive: true, force: true }); }
});

test('an unmeasured or changed runtime cannot claim a provider start or call TTS', async () => {
  const { event, env } = fixture();
  const result = await runTipSourceWork(event, { ...env, RUNNER_TEMP: tmpdir() }, {
    verifyRuntime: async () => { throw new Error('wrong package or encoder'); },
    updateAttempt: () => assert.fail('Runtime drift must precede the durable start'),
    generateSpeech: () => assert.fail('Runtime drift must not spend a take'),
  });
  assert.deepEqual(result, { status: 'temporarily_unavailable', stage: 'runtime' });
});
