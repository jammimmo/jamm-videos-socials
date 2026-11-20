import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deliverPreparedTipDestinations, prepareTipDestinations } from './deliver-tip-destinations.mjs';
import { deliverTipVideo, readTipDeliveryTarget, readTipVideo } from './deliver-tip-video.mjs';
import { deliverTipV11Report } from './deliver-tip-v11-report.mjs';
import { TIP_DESTINATION_MEDIA_CONTRACT } from './materialize-dispatched-tip.mjs';
import { renderTipV11Destinations } from './render-tip-v11-destinations.mjs';
import { decodedTipMediaFingerprints } from './tip-decoded-media-fingerprint.mjs';
import { TIP_V11_TEMPLATE } from './tip-v11-contract.mjs';
import { renderEvidence } from './tip-v11-render-evidence.mjs';
import { requestTipWorkflowOidc } from './tip-v11-workflow-oidc.mjs';

const maximumMediaBytes = 50 * 1024 * 1024;
const maximumReportBytes = 128 * 1024;
const destinationRenderBudget = 10 * 60 * 1000;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function deliverTipDestinationAttempt({ master, sha, duration, report, prepared }, env, {
  request = fetch, fetchToken = fetch, beforeMaster,
} = {}) {
  if (!readTipDeliveryTarget(env) || !prepared || !Buffer.isBuffer(master) || digest(master) !== sha
    || !Number.isSafeInteger(duration) || duration < 61 || duration > 90 || typeof beforeMaster !== 'function') return 'invalid';
  let evidence;
  let attestation;
  try {
    const render = renderEvidence(report, sha, {
      sha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT,
    });
    if (render.media_bytes !== master.length) return 'invalid';
    evidence = JSON.stringify(render);
    attestation = await requestTipWorkflowOidc(evidence, env, fetchToken);
  } catch {
    return 'invalid';
  }

  // Mark before the first possible request. A broken response cannot establish
  // whether the master was written. The generic failed-render callback must
  // stay disabled from here, even on a killed runner or provider failure.
  await beforeMaster();
  const uploaded = await deliverTipVideo({ video: master, digest: sha, duration }, {
    ...env, TIP_RENDER_EVIDENCE: evidence, TIP_WORKFLOW_ATTESTATION: attestation,
  }, { request });
  if (uploaded !== 'attached') return 'master_unconfirmed';
  const result = await deliverPreparedTipDestinations(prepared, env, { request, fetchToken });
  if (result.status !== 'confirmed') return 'destination_unconfirmed';
  return await deliverTipV11Report(report, env, request) ? 'confirmed' : 'report_unconfirmed';
}

function masterFrames(masterPath) {
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_frames', '-of', 'json', masterPath], { encoding: 'utf8', timeout: 20_000 }));
  return Number(probe.streams?.[0]?.nb_frames);
}

async function main(env) {
  const target = readTipDeliveryTarget(env);
  if (!target || env.TIP_DESTINATION_MEDIA_CONTRACT !== TIP_DESTINATION_MEDIA_CONTRACT
    || !env.RUNNER_TEMP || !/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID ?? '')
    || !/^[1-9][0-9]{0,5}$/.test(env.GITHUB_RUN_ATTEMPT ?? '')) return 'invalid';
  const root = fileURLToPath(new URL('../', import.meta.url));
  const spec = JSON.parse(await readFile(env.TIP_SPEC_FILE, 'utf8'));
  const stem = `tip-${target.jobId}`;
  if (spec.id !== stem || spec.template !== TIP_V11_TEMPLATE
    || spec.destinationMediaContract !== TIP_DESTINATION_MEDIA_CONTRACT) return 'invalid';

  const batch = join(root, 'out', 'batch', stem);
  const masterPath = `${batch}.mp4`;
  const master = readTipVideo(masterPath, maximumMediaBytes);
  const report = readTipVideo(`${batch}.audit.json`, maximumReportBytes);
  if (!master || !report) return 'invalid';
  const sha = digest(master);
  const evidence = renderEvidence(report, sha, { sha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT });
  const auditedManifest = JSON.parse(Buffer.from(JSON.parse(report).render_manifest_b64, 'base64'));
  const propsBytes = await readFile(`${batch}.props.json`);
  const props = JSON.parse(propsBytes);
  const audio = `audio/voiceovers/${stem}-v11-mix.wav`;
  const media = JSON.parse(await readFile(`${batch}.media.json`, 'utf8'));
  if (evidence.media_bytes !== master.length || digest(propsBytes) !== auditedManifest.props_sha256
    || props.audio !== audio || props.destination !== undefined
    || !Number.isSafeInteger(props.durationInFrames) || props.durationInFrames <= 60 * 30 || props.durationInFrames > 90 * 30
    || !Number.isFinite(media.duration) || media.duration <= 60 || media.duration > 90
    || Math.abs(props.durationInFrames / 30 - media.duration) > .12 || media.durationHeader !== Math.ceil(media.duration)
    || masterFrames(masterPath) !== props.durationInFrames) return 'invalid';
  const mix = await readFile(join(root, 'public', audio));
  if (digest(mix) !== auditedManifest.mix_wav_sha256) return 'invalid';

  const scratch = await mkdtemp(join(resolve(env.RUNNER_TEMP), 'tip-destination-'));
  try {
    const directory = join(scratch, 'variants');
    const receipt = await renderTipV11Destinations({ root, outputDirectory: directory, props,
      deadline: Date.now() + destinationRenderBudget });
    const masterDecoded = decodedTipMediaFingerprints(masterPath);
    if (receipt.audioSha256 !== auditedManifest.mix_wav_sha256 || digest(readTipVideo(masterPath, maximumMediaBytes)) !== sha
      || receipt.videos.some(video => video.decodedAudioSha256 !== masterDecoded.decodedAudioSha256
        || video.decodedVideoSha256 === masterDecoded.decodedVideoSha256)) return 'invalid';
    const prepared = prepareTipDestinations({ masterSha256: sha, directory, receipt }, env);
    const pending = join(env.RUNNER_TEMP, `tip-delivery-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`);
    return await deliverTipDestinationAttempt({ master, sha, duration: media.durationHeader, report, prepared }, env, {
      beforeMaster: () => writeFile(pending, 'pending\n', { flag: 'wx', mode: 0o600 }),
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  let result;
  try {
    result = await main(process.env);
  } catch {
    result = 'failed';
  }
  // Report only bounded stage labels. URLs, token, media and manifest stay private.
  process.stdout.write(`V11 destination delivery ${result}\n`);
  if (result !== 'confirmed') process.exitCode = 1;
}
