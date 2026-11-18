import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readTipSourceDispatch, runTipSourceWork as run } from './run-tip-source-work.mjs';
import { machineSourceFixture } from './fixtures/machine-source-work.mjs';
import { TIP_DELIVERY_ORIGIN } from './tip-v11-reviewed-narration.mjs';

// No fixture may request a live GitHub identity, including on a hosted runner.
const runTipSourceWork = (event, env, dependencies) => run(event, env, {
  uploadCapsule: async () => ({ status: 'confirmed' }), ...dependencies,
});

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

test('scorer CLI maps a Python report to exit 0 or 1, and rejects an unusable measurement', async () => {
  const { score, readScoreReport } = await import('./run-tip-source-work.mjs');
  const { source, speech, wav } = fixture();
  const scratch = await mkdtemp(join(tmpdir(), 'jamm-score-protocol-'));
  try {
    const draft = join(scratch, 'draft.json'), audio = join(scratch, 'normalized.wav');
    await writeFile(draft, JSON.stringify(source.draft));
    await writeFile(audio, wav);
    // Supply only the Python recognizer boundary. Invoke the real Node scoring CLI.
    const python = join(scratch, 'python-fixture');
    await writeFile(python, '#!/bin/sh\ncat >/dev/null\ncat "$REPORT_FIXTURE"\n', { mode: 0o700 });
    const env = { ...process.env, TIP_SOURCE_PYTHON: python, REPORT_FIXTURE: join(scratch, 'fixture.json') };
    for (const status of ['matched', 'inconclusive']) {
      await writeFile(env.REPORT_FIXTURE, JSON.stringify({ ...speech, status }));
      assert.equal((await score(draft, audio, join(scratch, status + '.json'), env)).status, status);
    }
    await writeFile(env.REPORT_FIXTURE, 'invalid');
    await assert.rejects(score(draft, audio, join(scratch, 'error.json'), env), { message: 'score_process_failed', exitCode: 2 });
    await assert.rejects(readScoreReport(join(scratch, 'absent.json'), 1), { message: 'score_report_unavailable', exitCode: 1 });
    await assert.rejects(readScoreReport(env.REPORT_FIXTURE, 0), { message: 'score_report_invalid', exitCode: 0 });
    await writeFile(env.REPORT_FIXTURE, JSON.stringify({ status: 'matched', contract: 'PRIVATE' }));
    await assert.rejects(score(draft, audio, join(scratch, 'protocol.json'), env), { message: 'score_protocol_invalid', exitCode: 0 });
    await writeFile(env.REPORT_FIXTURE, JSON.stringify(speech));
    await assert.rejects(readScoreReport(env.REPORT_FIXTURE, 1), { message: 'score_protocol_invalid', exitCode: 1 });
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('only a reported recognizer timeout retries once on the same normalized WAV', async () => {
  const { event, env, wav, speech } = fixture();
  const scratch = await mkdtemp(join(tmpdir(), 'jamm-measure-retry-'));
  const timeout = { status: 'inconclusive', reason: 'recognizer_timeout' };
  try {
    for (const [reports, stage] of [
      [[timeout, speech], 'confirmed'],
      [[timeout, timeout], 'measurement_unavailable'],
      [[{ status: 'inconclusive', reason: 'ordered_words_unconfirmed', observed_words: ['PRIVATE'], recognizer_diagnostics: [{ outcome: 'timeout' }] }], 'measured_inconclusive'],
      ...['signature_boundary_unconfirmed', 'signature_tail_too_quiet', 'signature_closing_unrecognized',
        'signature_retry_insufficient'].map(reason => [[{ status: 'inconclusive', reason, matched_words: 2, expected_words: 10 }], 'measured_inconclusive']),
      [[{ status: 'inconclusive', reason: 'recognizer_unavailable' }], 'measurement_unavailable'],
      [[new Error('PRIVATE')], 'measurement_unavailable'],
      [[], 'normalization_failed'],
    ]) {
      const calls = [], paths = [], files = [];
      const result = await runTipSourceWork(event, { ...env, RUNNER_TEMP: scratch }, {
        verifyRuntime: async () => {},
        updateAttempt: async (_job, action, reason) => { calls.push(action); if (action === 'failed') assert.equal(reason, 'source_evidence_inconclusive'); return { status: 'confirmed' }; },
        generateSpeech: async () => { calls.push('voice'); return wav.subarray(44); },
        normalize: async (_root, _raw, path) => { calls.push('normalize'); if (!reports.length) throw Error('PRIVATE'); await writeFile(path, wav); },
        score: async (_draft, path, reportPath) => {
          paths.push(path); files.push(reportPath); assert.deepEqual(await readFile(path), wav);
          const report = reports[paths.length - 1]; if (report instanceof Error) throw report; return report;
        },
        qualify: async () => { calls.push('qualify'); return { status: 'confirmed' }; },
      });
      assert.equal(result.diagnostic?.stage ?? result.status, stage);
      if (stage === 'measured_inconclusive') {
        assert.equal(result.diagnostic.reason, reports[0].reason);
        assert.equal(result.diagnostic.incompleteRecognizerCall, !!reports[0].recognizer_diagnostics);
        assert.equal(result.diagnostic.matched_words, reports[0].matched_words);
        assert.equal(result.diagnostic.expected_words, reports[0].expected_words);
        assert.equal(result.diagnostic.measurementAttempts, 1);
      }
      assert.deepEqual(calls, ['start', 'voice', 'normalize', stage === 'confirmed' ? 'qualify' : 'failed']);
      assert.equal(paths.length, reports.length);
      assert.ok(new Set(paths).size <= 1);
      assert.equal(new Set(files).size, files.length);
      assert.doesNotMatch(JSON.stringify(result.diagnostic ?? {}), /PRIVATE/);
      assert.deepEqual(await readdir(scratch), []);
    }
  } finally { await rm(scratch, { recursive: true, force: true }); }
});


test('real scoring CLI preserves a measured signature failure through the runner', async () => {
  const { event, env } = fixture();
  const scratch = await mkdtemp(join(tmpdir(), 'jamm-signature-boundary-'));
  try {
    const python = join(scratch, 'synthetic-recognizer');
    // Exercise the real Python source scorer and JS report transport, replacing only recognition.
    await writeFile(python, `#!/usr/bin/env python3
import json, sys
from pathlib import Path
from tempfile import TemporaryDirectory
sys.path.insert(0, str(Path(sys.argv[1]).parent))
from score_tip_source import score_source
from test_align_tip_v11 import speech
plan = json.loads(sys.stdin.buffer.readline())
audio = sys.stdin.buffer.read()
words = speech(plan['segments'])
cut = next(i for i, word in enumerate(words) if word['word'] == 'conseils')
rows = [(word['word'] if i < cut else 'murmure', word['start'], word['end'], .95) for i, word in enumerate(words)]
with TemporaryDirectory() as directory:
    print(json.dumps(score_source(plan, audio, Path(directory), lambda _: rows, lambda _: [])))
`, { mode: 0o700 });
    const pcm = Buffer.alloc(70 * 48_000);
    for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(800, i);
    const actions = [];
    const result = await runTipSourceWork(event, { ...process.env, ...env, RUNNER_TEMP: scratch,
      TIP_SOURCE_PYTHON: python, PYTHONDONTWRITEBYTECODE: '1' }, {
      verifyRuntime: async () => {},
      updateAttempt: async (_job, action) => { actions.push(action); return { status: 'confirmed' }; },
      generateSpeech: async () => pcm,
      normalize: async (_root, raw, normalized) => writeFile(normalized, await readFile(raw)),
      qualify: async () => assert.fail('Negative speech must not qualify'),
    });
    assert.deepEqual(actions, ['start', 'failed']);
    assert.equal(result.diagnostic.stage, 'measured_inconclusive');
    assert.equal(result.diagnostic.reason, 'signature_boundary_unconfirmed');
    assert.equal(result.diagnostic.measurementAttempts, 1);
    assert.ok(Number.isInteger(result.diagnostic.expected_words));
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('captures the exact complete WAV before failure and cleanup without repeating the paid start', async () => {
  const { event, sourceJob, env, wav } = fixture();
  const scratch = await mkdtemp(join(tmpdir(), 'jamm-capture-fixture-'));
  const normalized = Buffer.from(wav);
  normalized.writeInt16LE(912, 44);
  const speech = { status: 'inconclusive', reason: 'alignment_evidence_invalid', alignment_code: 'timestamp_overrun',
    duration_ms: 60660, span_ms: NaN, row_index: 34, row_count: 126, observed_words_count: 1e9, secret: sourceJob.claimToken,
    recognized_words: ['PRIVATE'], transcript: 'SECRET', segments: [{ status: 'matched', text: 'SECRET' }] };
  try {
    for (const [kind, diagnosticStage, mode] of [
      ['normalized', 'measured_inconclusive', 'held'], ['normalized', 'measured_inconclusive', 'lost'],
      ['normalized', 'measurement_unavailable', 'bad-rows'], ['raw', 'normalization_failed', 'no-normalized'],
      ['raw', 'normalization_failed', 'partial-normalized'], ['normalized', 'normalization_failed', 'duration'],
      ['normalized', 'source_delivery_unconfirmed', 'delivery'], [null, undefined, 'voice'],
    ]) {
      const steps = [];
      let captured;
      const result = await runTipSourceWork(event, { ...env, RUNNER_TEMP: scratch }, {
        verifyRuntime: async () => {},
        updateAttempt: async (_job, action) => { steps.push(action); return { status: 'confirmed' }; },
        generateSpeech: async () => { steps.push('tts'); if (mode === 'voice') throw Error('PRIVATE'); return wav.subarray(44); },
        normalize: async (_root, _raw, path) => {
          if (mode === 'no-normalized') throw Error('PRIVATE');
          await writeFile(path, mode === 'partial-normalized' ? normalized.subarray(0, 18) : normalized);
          if (mode === 'partial-normalized' || mode === 'duration') throw Error('PRIVATE');
        },
        score: async () => mode === 'delivery' ? { status: 'matched' } : mode === 'bad-rows'
          ? { ...speech, reason: 'recognizer_output_invalid', alignment_code: 'word_row_invalid' } : speech,
        qualify: async () => ({ status: 'temporarily_unavailable' }),
        uploadCapsule: async (job, audio, kind, diagnostic) => {
          steps.push('upload'); captured = { job, audio, kind, diagnostic };
          if (mode === 'lost') throw Error('PRIVATE');
          return { status: 'confirmed', wavSha256: 'a'.repeat(64) };
        },
      });
      assert.deepEqual(steps, ['start', 'tts', ...(kind ? ['upload'] : []), 'failed']);
      assert.equal(result.status, 'incomplete');
      assert.equal(result.capsule.status, mode === 'voice' ? 'no_audio' : mode === 'lost' ? 'temporarily_unavailable' : 'confirmed');
      assert.equal(result.diagnostic?.stage, diagnosticStage);
      if (kind) {
        assert.deepEqual(captured.job, sourceJob);
        assert.deepEqual(captured.audio, kind === 'raw' ? wav : normalized);
        assert.equal(captured.kind, kind);
        assert.deepEqual(captured.diagnostic, result.diagnostic);
        assert.doesNotMatch(JSON.stringify(captured.diagnostic), /PRIVATE|SECRET|transcript|recognized_words|claimToken|span_ms|observed_words_count/);
        if (mode === 'held' || mode === 'lost' || mode === 'bad-rows') {
          assert.equal(captured.diagnostic.alignment_code, mode === 'bad-rows' ? 'word_row_invalid' : 'timestamp_overrun');
          assert.equal(captured.diagnostic.row_index, 34);
          assert.equal(captured.diagnostic.duration_ms, 60660);
        }
      }
      assert.deepEqual(await readdir(scratch), []);
    }
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
