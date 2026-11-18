import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { buildSourceScoringInput } from './score-tip-source.mjs';
import { buildTipV11Narration } from './tip-v11-contract.mjs';
import { generateSpeechPcm, pcmToWav } from './generate-gemini-voiceover.mjs';
import { normalizeTipV11Narration } from './render-tip-v11.mjs';
import { qualifyTipSource, validSourceJob, validateTipSourceJob } from './qualify-tip-source.mjs';
import { updateTipSourceAttempt } from './tip-source-attempt.mjs';
import { TIP_DELIVERY_ORIGIN } from './tip-v11-reviewed-narration.mjs';
import { assertTipSourceRuntime } from './tip-runtime.mjs';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const hasExactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function readTipSourceDispatch(event, env) {
  const payload = event?.client_payload;
  if (event?.action !== 'qualify-jamm-tip-source'
    || !hasExactKeys(payload, ['contract', 'sourceJob', 'source', 'qualifierSha', 'delivery'])
    || payload.contract !== 'tip-v11-machine-source-dispatch-v1'
    || !validSourceJob(payload.sourceJob) || payload.sourceJob.id !== payload.source?.postId
    || typeof payload.qualifierSha !== 'string' || !/^[a-f0-9]{40}$/.test(payload.qualifierSha)
    || payload.qualifierSha !== env.GITHUB_SHA || env.GITHUB_REF !== 'refs/heads/main'
    || env.GITHUB_EVENT_NAME !== 'repository_dispatch'
    || !hasExactKeys(payload.delivery, ['attemptUrl', 'narrationUrl', 'qualificationUrl'])
    || payload.delivery.attemptUrl !== `${TIP_DELIVERY_ORIGIN}/api/social/advice/source-attempt`
    || payload.delivery.narrationUrl !== `${TIP_DELIVERY_ORIGIN}/api/social/advice/source-narration`
    || payload.delivery.qualificationUrl !== `${TIP_DELIVERY_ORIGIN}/api/social/advice/source-qualification`) throw new Error('Invalid source dispatch');
  const source = validateTipSourceJob(payload.source);
  // Constructing the complete narration now rejects malformed scene input
  // before the durable attempt can be started or a provider can be called.
  const identity = buildSourceScoringInput(source.draft);
  const plan = buildTipV11Narration({ id: `tip-${source.postId}`, title: source.draft.title,
    body: source.draft.scriptFr.split(/(?<=[.!?])\s+/u) });
  return { source, sourceJob: structuredClone(payload.sourceJob), identity, plan };
}

class ScoreError extends Error {
  constructor(reason, exitCode) {
    super(reason);
    this.exitCode = exitCode;
  }
}

export async function readScoreReport(report, exitCode) {
  let bytes;
  try {
    bytes = await readFile(report, 'utf8');
  } catch {
    throw new ScoreError('score_report_unavailable', exitCode);
  }
  let speech;
  try {
    speech = JSON.parse(bytes);
  } catch {
    throw new ScoreError('score_report_invalid', exitCode);
  }
  if (speech?.contract !== 'tip-v11-fr-source-speech-v2' || speech.status !== (exitCode === 0 ? 'matched' : 'inconclusive')) {
    throw new ScoreError('score_protocol_invalid', exitCode);
  }
  return speech;
}

export async function score(draft, wav, report, env) {
  let exitCode = 0;
  try {
    await execute(process.execPath, ['scripts/score-tip-source.mjs', '--draft', draft, '--wav', wav, '--report', report], {
      cwd: root, env: { ...env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' }, timeout: 370_000, maxBuffer: 128 * 1024,
    });
  } catch (error) {
    // Exit 1 writes an inconclusive report, including recognizer failures. Exit 2 has no usable report.
    if (error.code !== 1) {
      const code = Number.isInteger(error.code) && error.code >= 0 && error.code <= 255 ? error.code : undefined;
      throw new ScoreError('score_process_failed', code);
    }
    exitCode = 1;
  }
  return readScoreReport(report, exitCode);
}

const measuredReasons = new Set([
  'no_audible_source', 'ordered_words_unconfirmed', 'recognition_or_timing_inconclusive',
  'signature_boundary_unconfirmed', 'signature_tail_too_quiet', 'signature_closing_unrecognized',
  'signature_retry_insufficient', 'signature_evidence_insufficient', 'phone_evidence_unconfirmed', 'website_evidence_unconfirmed',
  'script_evidence_unconfirmed', 'alignment_evidence_invalid',
]);

function measuredDiagnostic(speech) {
  const diagnostic = { stage: 'measured_inconclusive', reason: speech.reason };
  for (const field of ['matched_words', 'expected_words']) {
    const value = speech[field];
    if (Number.isInteger(value) && value >= 0 && value <= 4096) diagnostic[field] = value;
  }
  if (Array.isArray(speech.segments) && speech.segments.length <= 32) {
    diagnostic.segmentCount = speech.segments.length;
    diagnostic.matchedSegments = speech.segments.filter(row => row?.status === 'matched').length;
  }
  return diagnostic;
}

async function measureSource(measure, draft, wav, scratch, env) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let transient = false;
    let reason = 'score_protocol_invalid';
    try {
      const speech = await measure(draft, wav, resolve(scratch, 'speech-' + attempt + '.json'), env);
      if (speech?.status === 'matched') return { speech };
      if (speech?.status === 'inconclusive' && measuredReasons.has(speech.reason)) {
        // Optional verification windows can record a failed recognizer call
        // alongside a negative score. Never retry mixed evidence to obtain a pass.
        const incompleteRecognizerCall = Array.isArray(speech.recognizer_diagnostics)
          && speech.recognizer_diagnostics.some(call => call?.outcome !== 'completed');
        return { diagnostic: { ...measuredDiagnostic(speech), incompleteRecognizerCall, measurementAttempts: attempt } };
      }
      if (speech?.status === 'inconclusive') {
        const runtimeReasons = ['recognizer_call_limit', 'recognizer_process_failed', 'recognizer_output_invalid',
          'recognizer_unavailable', 'recognizer_timeout'];
        if (runtimeReasons.includes(speech.reason)) reason = speech.reason;
        transient = reason === 'recognizer_timeout';
      }
    } catch (error) {
      reason = error instanceof ScoreError ? error.message : 'measurement_error';
      const diagnostic = { stage: 'measurement_unavailable', reason, measurementAttempts: attempt };
      if (error instanceof ScoreError && error.exitCode !== undefined) diagnostic.exitCode = error.exitCode;
      return { diagnostic };
    }
    if (!transient || attempt === 2) {
      return { diagnostic: { stage: 'measurement_unavailable', reason, measurementAttempts: attempt } };
    }
  }
}

/** One durable, acknowledged start permits one TTS request. */
export async function runTipSourceWork(event, env, dependencies = {}) {
  let work;
  try {
    work = readTipSourceDispatch(event, env);
    if (!env.GEMINI_API_KEY || !env.RUNNER_TEMP) throw new Error();
  } catch {
    return { status: 'rejected', stage: 'dispatch' };
  }
  try {
    await (dependencies.verifyRuntime ?? assertTipSourceRuntime)(work.source.profile.runtimeSha256, env);
  } catch {
    // A missing tool/cache never spends a durable start or a paid voice take.
    return { status: 'temporarily_unavailable', stage: 'runtime' };
  }
  const update = dependencies.updateAttempt ?? updateTipSourceAttempt;
  const started = await update(work.sourceJob, 'start', null, env);
  if (started.status !== 'confirmed') return { status: started.status, stage: 'start' };
  let scratch;
  let failure = 'voice_unavailable';
  let diagnostic;
  try {
    scratch = await mkdtemp(resolve(await realpath(env.RUNNER_TEMP), 'jamm-tip-source-'));
    const draftFile = resolve(scratch, 'draft.json');
    const raw = resolve(scratch, 'raw.wav');
    const normalized = resolve(scratch, 'normalized.wav');
    await writeFile(draftFile, JSON.stringify(work.source.draft), { mode: 0o600, flag: 'wx' });
    const pcm = await (dependencies.generateSpeech ?? generateSpeechPcm)({
      apiKey: env.GEMINI_API_KEY, profile: 'tip-v11-fr', script: work.plan.script, context: '',
    });
    await writeFile(raw, pcmToWav(pcm), { mode: 0o600, flag: 'wx' });
    failure = 'source_evidence_inconclusive';
    diagnostic = { stage: 'normalization_failed' };
    await (dependencies.normalize ?? normalizeTipV11Narration)(root, raw, normalized, { exactTourV8: true });
    const measured = await measureSource(dependencies.score ?? score, draftFile, normalized, scratch, env);
    diagnostic = measured.diagnostic;
    if (!measured.speech) throw new Error('Source speech inconclusive');
    const speech = measured.speech;
    failure = 'source_delivery_unconfirmed';
    const result = await (dependencies.qualify ?? qualifyTipSource)(
      { ...work.source, sourceJob: work.sourceJob }, await readFile(normalized), speech, env,
    );
    if (result.status !== 'confirmed') throw new Error('Source delivery unconfirmed');
    return { status: 'confirmed', sourceJob: work.sourceJob, receipt: result.receipt };
  } catch {
    await update(work.sourceJob, 'failed', failure, env).catch(() => undefined);
    return { status: 'incomplete', reason: failure, sourceJob: work.sourceJob, ...(diagnostic && { diagnostic }) };
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const eventBytes = await readFile(process.env.GITHUB_EVENT_PATH);
    if (eventBytes.length > 32 * 1024) throw new Error();
    const event = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(eventBytes));
    const result = await runTipSourceWork(event, process.env);
    const { status, stage, reason, diagnostic } = result;
    process.stdout.write(`${JSON.stringify({ status, stage, reason, diagnostic })}\n`);
    if (result.status !== 'confirmed') process.exitCode = 1;
  } catch {
    process.stderr.write('V11 source work unavailable\n');
    process.exitCode = 1;
  }
}
