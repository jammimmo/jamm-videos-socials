import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { measureSource, score } from './measure-tip-source.mjs';
export { readScoreReport, score } from './measure-tip-source.mjs';
import { buildSourceScoringInput } from './score-tip-source.mjs';
import { buildTipV11Narration } from './tip-v11-contract.mjs';
import { generateSpeechPcm, pcmToWav } from './generate-gemini-voiceover.mjs';
import { normalizeTipV11Narration } from './render-tip-v11.mjs';
import { qualifyTipSource, validSourceJob, validateTipSourceJob } from './qualify-tip-source.mjs';
import { updateTipSourceAttempt } from './tip-source-attempt.mjs';
import { TIP_DELIVERY_ORIGIN } from './tip-v11-reviewed-narration.mjs';
import { captureFailureCapsule } from './source-failure-capsule.mjs';
import { assertTipSourceRuntime } from './tip-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hasExactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const observationUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function readTipSourceDispatch(event, env) {
  const payload = event?.client_payload;
  const hasObservationId = Object.hasOwn(payload ?? {}, 'observationId');
  const keys = ['contract', 'sourceJob', 'source', 'qualifierSha', 'delivery'];
  if (hasObservationId) keys.push('observationId');
  if (event?.action !== 'qualify-jamm-tip-source'
    || !hasExactKeys(payload, keys)
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
  if (hasObservationId && (typeof payload.observationId !== 'string' || !observationUuid.test(payload.observationId)
    || [source.postId, source.hookId, payload.sourceJob.claimToken].some(id => id.toLowerCase() === payload.observationId))) {
    throw new Error('Invalid source dispatch');
  }
  // Constructing the complete narration now rejects malformed scene input
  // before the durable attempt can be started or a provider can be called.
  const identity = buildSourceScoringInput(source.draft);
  const plan = buildTipV11Narration({ id: `tip-${source.postId}`, title: source.draft.title,
    body: source.draft.scriptFr.split(/(?<=[.!?])\s+/u) });
  return { source, sourceJob: structuredClone(payload.sourceJob), identity, plan };
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
    diagnostic = { stage: 'normalization_failed', reason: 'normalization_failed', measurementAttempts: 0 };
    await (dependencies.normalize ?? normalizeTipV11Narration)(root, raw, normalized, { exactTourV8: true });
    const measured = await measureSource(dependencies.score ?? score, draftFile, normalized, scratch, env);
    diagnostic = measured.diagnostic;
    if (!measured.speech) throw new Error('Source speech inconclusive');
    const speech = measured.speech;
    failure = 'source_delivery_unconfirmed';
    diagnostic = { stage: failure, reason: failure, measurementAttempts: measured.measurementAttempts };
    const result = await (dependencies.qualify ?? qualifyTipSource)(
      { ...work.source, sourceJob: work.sourceJob }, await readFile(normalized), speech, env,
    );
    if (result.status !== 'confirmed') throw new Error('Source delivery unconfirmed');
    return { status: 'confirmed', sourceJob: work.sourceJob, receipt: result.receipt };
  } catch {
    // Capture under the live started lease. Transfer retries are byte-for-byte
    // and a failed transfer never changes the recorded qualification failure.
    const capsule = await captureFailureCapsule(scratch, work.sourceJob, diagnostic, env, dependencies.uploadCapsule)
      .catch(() => ({ status: 'temporarily_unavailable' }));
    await update(work.sourceJob, 'failed', failure, env).catch(() => undefined);
    return { status: 'incomplete', reason: failure, sourceJob: work.sourceJob, ...(diagnostic && { diagnostic }), capsule };
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
    const { status, stage, reason, diagnostic, capsule } = result;
    process.stdout.write(`${JSON.stringify({ status, stage, reason, diagnostic, capsule })}\n`);
    if (result.status !== 'confirmed') process.exitCode = 1;
  } catch {
    process.stderr.write('V11 source work unavailable\n');
    process.exitCode = 1;
  }
}
