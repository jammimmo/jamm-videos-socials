import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { measureSource, score } from './measure-tip-source.mjs';
import { exactKeys, fetchFailureCapsule, validCapsuleIdentity } from './source-failure-capsule.mjs';
import { assertTipSourceRuntime } from './tip-runtime.mjs';
import { inspectionLogLines, projectInspection } from './tip-source-inspection.mjs';

function readInspectDispatch(event, env) {
  const p = event?.client_payload;
  if (event?.action !== 'inspect-jamm-tip-source' || env.GITHUB_EVENT_NAME !== 'repository_dispatch'
    || env.GITHUB_REF !== 'refs/heads/main' || !env.RUNNER_TEMP || env.GEMINI_API_KEY
    || !exactKeys(p, ['contract', 'jobId', 'attempt', 'wavSha256', 'qualifierSha'])
    || p.contract !== 'tip-v11-source-failure-inspect-v1' || !validCapsuleIdentity(p)
    || typeof p.qualifierSha !== 'string' || !/^[a-f0-9]{40}$/.test(p.qualifierSha)
    || p.qualifierSha !== env.GITHUB_SHA) throw new Error('Invalid inspect dispatch');
  return { jobId: p.jobId, attempt: p.attempt, wavSha256: p.wavSha256 };
}

// The local score subprocess needs the locked tools and cached model. Only the
// private GET uses Actions credentials; neither the scorer nor Python need them.
function offlineEnvironment(env, scratch) {
  const safe = {};
  for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'TIP_SOURCE_PYTHON', 'HF_HOME', 'HF_HUB_CACHE',
    'OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS']) {
    if (typeof env[key] === 'string') safe[key] = env[key];
  }
  return { ...safe, TMPDIR: scratch, TEMP: scratch, TMP: scratch,
    HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' };
}

export async function inspectTipSource(event, env, dependencies = {}) {
  let identity;
  try {
    identity = readInspectDispatch(event, env);
  } catch {
    return { status: 'rejected', stage: 'dispatch' };
  }
  let scratch;
  let stage = 'capsule_read';
  try {
    const capsule = await fetchFailureCapsule(identity, env, dependencies.request);
    stage = 'scratch';
    scratch = await mkdtemp(resolve(await realpath(env.RUNNER_TEMP), 'jamm-tip-inspect-'));
    const offline = offlineEnvironment(env, scratch);
    stage = 'runtime';
    await (dependencies.verifyRuntime ?? assertTipSourceRuntime)(capsule.runtimeSha256, offline);
    stage = 'score';
    const draftPath = resolve(scratch, 'draft.json');
    const wavPath = resolve(scratch, 'source.wav');
    await writeFile(draftPath, JSON.stringify(capsule.draft), { flag: 'wx', mode: 0o600 });
    await writeFile(wavPath, capsule.wav, { flag: 'wx', mode: 0o600 });
    const nonce = randomBytes(16).toString('hex');
    const attempts = [];
    const measureExact = async (...args) => {
      const attempt = attempts.length + 1;
      attempts.push({ status: 'unavailable', attempt });
      const report = await (dependencies.score ?? score)(...args, { nonce, attempt });
      if (report?.contract !== 'tip-v11-fr-source-speech-v2' || report.narration_wav_sha256 !== identity.wavSha256
        || report.draft_sha256 !== capsule.scoringInput.draft_sha256
        || report.source_script_sha256 !== capsule.scoringInput.source_script_sha256) throw new Error('Replay input mismatch');
      attempts[attempt - 1] = projectInspection(report.inspection_evidence, { nonce, attempt, wavSha256: identity.wavSha256,
        draftSha256: capsule.scoringInput.draft_sha256, scriptSha256: capsule.scoringInput.source_script_sha256 });
      return report;
    };
    const result = await measureSource(measureExact, draftPath, wavPath, scratch, offline, { inspectComparison: true });
    const replay = result.diagnostic ? { ...result.diagnostic, ...(result.comparison && { comparison: result.comparison }) }
      : { stage: 'measured_matched', measurementAttempts: result.measurementAttempts };
    return { status: 'inspected', wavKind: capsule.wavKind, original: capsule.diagnostic, replay, inspection: { nonce, attempts } };
  } catch {
    return { status: 'unavailable', stage };
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const eventBytes = await readFile(process.env.GITHUB_EVENT_PATH);
    if (eventBytes.length > 32 * 1024) throw new Error();
    const event = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(eventBytes));
    const result = await inspectTipSource(event, process.env);
    for (const line of inspectionLogLines(result)) process.stdout.write(line + '\n');
    if (result.status !== 'inspected' || result.replay.stage === 'measurement_unavailable') process.exitCode = 1;
  } catch {
    process.stderr.write('Private source inspection unavailable\n');
    process.exitCode = 1;
  }
}
