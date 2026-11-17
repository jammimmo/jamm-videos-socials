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

async function score(draft, wav, report, env) {
  try {
    await execute(process.execPath, ['scripts/score-tip-source.mjs', '--draft', draft, '--wav', wav, '--report', report], {
      cwd: root, env: { ...env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' }, timeout: 370_000, maxBuffer: 128 * 1024,
    });
  } catch (error) {
    // Exit 1 writes a measured inconclusive report; exit 2 has no usable report.
    if (error.code !== 1) throw new Error('Source measurement unavailable');
  }
  return JSON.parse(await readFile(report, 'utf8'));
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
  const update = dependencies.updateAttempt ?? updateTipSourceAttempt;
  const started = await update(work.sourceJob, 'start', null, env);
  if (started.status !== 'confirmed') return { status: started.status, stage: 'start' };
  let scratch;
  let failure = 'voice_unavailable';
  try {
    scratch = await mkdtemp(resolve(await realpath(env.RUNNER_TEMP), 'jamm-tip-source-'));
    const draftFile = resolve(scratch, 'draft.json');
    const raw = resolve(scratch, 'raw.wav');
    const normalized = resolve(scratch, 'normalized.wav');
    const report = resolve(scratch, 'speech.json');
    await writeFile(draftFile, JSON.stringify(work.source.draft), { mode: 0o600, flag: 'wx' });
    const pcm = await (dependencies.generateSpeech ?? generateSpeechPcm)({
      apiKey: env.GEMINI_API_KEY, profile: 'tip-v11-fr', script: work.plan.script, context: '',
    });
    await writeFile(raw, pcmToWav(pcm), { mode: 0o600, flag: 'wx' });
    failure = 'source_evidence_inconclusive';
    await (dependencies.normalize ?? normalizeTipV11Narration)(root, raw, normalized, { exactTourV8: true });
    const speech = await (dependencies.score ?? score)(draftFile, normalized, report, env);
    if (speech?.status !== 'matched') throw new Error('Source speech inconclusive');
    failure = 'source_delivery_unconfirmed';
    const result = await (dependencies.qualify ?? qualifyTipSource)(
      { ...work.source, sourceJob: work.sourceJob }, await readFile(normalized), speech, env,
    );
    if (result.status !== 'confirmed') throw new Error('Source delivery unconfirmed');
    return { status: 'confirmed', sourceJob: work.sourceJob, receipt: result.receipt };
  } catch {
    await update(work.sourceJob, 'failed', failure, env).catch(() => undefined);
    return { status: 'incomplete', reason: failure, sourceJob: work.sourceJob };
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
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== 'confirmed') process.exitCode = 1;
  } catch {
    process.stderr.write('V11 source work unavailable\n');
    process.exitCode = 1;
  }
}
