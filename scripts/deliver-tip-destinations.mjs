import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { confirmsDelivery, postTipDelivery, readTipDeliveryTarget, readTipVideo } from './deliver-tip-video.mjs';
import { requestTipDestinationManifestOidc, TIP_DESTINATION_MANIFEST_HEADER_LIMIT } from './tip-v11-workflow-oidc.mjs';
import {
  CAPTION_GEOMETRY_CONTRACT, FRAME_RATE, VIDEO_HEIGHT, VIDEO_WIDTH, MAX_CAPTION_CUES,
  containsBounds, tipV11CaptionMask,
} from '../src/compositions/tip-v11-caption-geometry.ts';

const destinations = ['facebook', 'instagram', 'tiktok'];
const digestPattern = /^[a-f0-9]{64}$/;
const maxMediaBytes = 50 * 1024 * 1024;
const sha256 = value => createHash('sha256').update(value).digest('hex');

function bounds(value) {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isSafeInteger)
    && value[2] > value[0] && value[3] > value[1];
}

function captionEvidence(proof, destination, duration) {
  const mask = tipV11CaptionMask(destination);
  const frames = proof?.duration_frames;
  if (proof?.contract !== CAPTION_GEOMETRY_CONTRACT || proof.status !== 'matched'
    || proof.scope !== 'caption_card_and_text_bounds' || proof.coverage !== 'first_middle_last_frame_per_cue'
    || proof.mask !== mask.id || !bounds(proof.mask_bounds)
    || !proof.mask_bounds.every((coordinate, index) => coordinate === mask.bounds[index])
    || proof.width !== VIDEO_WIDTH || proof.height !== VIDEO_HEIGHT || proof.fps !== FRAME_RATE
    || !Number.isSafeInteger(frames) || frames <= 60 * FRAME_RATE
    || frames > (destination === 'facebook' ? 90 : 120) * FRAME_RATE
    || Math.abs(frames / FRAME_RATE - duration) > .12
    || !Array.isArray(proof.cues) || proof.cues.length < 1 || proof.cues.length > MAX_CAPTION_CUES) return null;
  let nextFrame = 0;
  const cues = [];
  for (const row of proof.cues) {
    const sampleFrames = row?.sample_frames;
    if (!Array.isArray(sampleFrames) || sampleFrames.length < 1 || sampleFrames.length > 3
      || !sampleFrames.every(Number.isSafeInteger)) return null;
    const first = sampleFrames[0];
    const last = sampleFrames.at(-1);
    const expected = [...new Set([first, Math.floor((first + last) / 2), last])];
    if (row.cue !== cues.length || row.status !== 'matched' || first !== nextFrame || last < first || last >= frames
      || sampleFrames.length !== expected.length || sampleFrames.some((frame, index) => frame !== expected[index])
      || !bounds(row.card_bounds) || !bounds(row.text_bounds) || !containsBounds(mask.bounds, row.card_bounds)
      || !containsBounds(row.card_bounds, row.text_bounds)) return null;
    cues.push({ cue: row.cue, status: 'matched', sample_frames: expected, card_bounds: [...row.card_bounds],
      text_bounds: [...row.text_bounds] });
    nextFrame = last + 1;
  }
  if (nextFrame !== frames) return null;
  return {
    contract: CAPTION_GEOMETRY_CONTRACT, scope: proof.scope, mask: mask.id, mask_bounds: mask.bounds,
    width: VIDEO_WIDTH, height: VIDEO_HEIGHT, fps: FRAME_RATE, coverage: proof.coverage,
    duration_frames: frames, status: 'matched', cues,
  };
}

export function prepareTipDestinations({ masterSha256, directory, receipt }, env) {
  if (typeof masterSha256 !== 'string' || !digestPattern.test(masterSha256) || typeof directory !== 'string' || !directory
    || receipt?.scope !== 'offline-destination-layouts' || !Array.isArray(receipt.videos)
    || receipt.videos.length !== destinations.length
    || typeof env.GITHUB_SHA !== 'string' || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA)
    || typeof env.GITHUB_RUN_ID !== 'string' || !/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID)
    || typeof env.GITHUB_RUN_ATTEMPT !== 'string' || !/^[1-9][0-9]{0,5}$/.test(env.GITHUB_RUN_ATTEMPT)) return null;
  const manifest = {
    contract: 'tip-v11-destination-manifest-v1', master_sha256: masterSha256,
    workflow_sha: env.GITHUB_SHA, workflow_run_id: env.GITHUB_RUN_ID, workflow_run_attempt: env.GITHUB_RUN_ATTEMPT,
    destinations: {},
  };
  const videos = [];
  const digests = new Set([masterSha256]);
  let commonFrames;
  for (const destination of destinations) {
    const row = receipt.videos.find(value => value?.destination === destination);
    if (!row || !Number.isFinite(row.duration) || row.duration <= 60
      || row.duration > (destination === 'facebook' ? 90 : 120)
      || !Number.isSafeInteger(row.size) || row.size < 12 || row.size > maxMediaBytes
      || typeof row.mediaSha256 !== 'string' || !digestPattern.test(row.mediaSha256) || digests.has(row.mediaSha256)) return null;
    const geometry = captionEvidence(row.captionGeometry, destination, row.duration);
    if (!geometry || row.videoFrames !== geometry.duration_frames
      || (commonFrames !== undefined && row.videoFrames !== commonFrames)) return null;
    commonFrames = row.videoFrames;
    const body = readTipVideo(join(directory, `${destination}.mp4`), maxMediaBytes);
    if (!body || body.length !== row.size || sha256(body) !== row.mediaSha256) return null;
    manifest.destinations[destination] = { media_sha256: row.mediaSha256, media_bytes: row.size, caption_geometry: geometry };
    videos.push({ destination, body, digest: row.mediaSha256 });
    digests.add(row.mediaSha256);
  }
  const header = Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64url');
  return header.length <= TIP_DESTINATION_MANIFEST_HEADER_LIMIT ? { header, videos } : null;
}

async function reconcileTipDestination(url, headers, matchesReceipt, request) {
  try {
    const response = await request(url, {
      method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(7_500),
    });
    if (response.redirected || response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      return false;
    }
    return await confirmsDelivery(response, matchesReceipt);
  } catch {
    return false;
  }
}

/** One prepared manifest covers all uploads. An ambiguous POST gets one
 * readback only. Even a missing proof never authorizes resending bytes. */
export async function deliverPreparedTipDestinations(prepared, env, {
  request = fetch, fetchToken = fetch,
} = {}) {
  const target = readTipDeliveryTarget(env);
  const confirmed = [];
  if (!target || !prepared) return { status: 'rejected', confirmed };
  let oidc;
  try {
    oidc = await requestTipDestinationManifestOidc(target.jobId, target.url.searchParams.get('attempt'),
      prepared.header, env, fetchToken);
  } catch {
    return { status: 'rejected', confirmed };
  }
  for (const { destination, body, digest } of prepared.videos) {
    const url = new URL(target.url);
    url.searchParams.set('destination', destination);
    const headers = {
      Authorization: `Bearer ${target.token}`, 'X-Job-Id': target.jobId, 'X-Kind': 'tip',
      'X-Tip-Destination-Manifest': prepared.header, 'X-Tip-Workflow-OIDC': oidc,
    };
    const matchesReceipt = reply => reply?.ok === true && reply.jobId === target.jobId && reply.destination === destination
      && reply.media_sha256 === digest && reply.media_bytes === body.length;
    const status = await postTipDelivery(url, {
      headers: { ...headers, 'Content-Type': 'video/mp4', 'Content-Length': String(body.length), 'X-Media-Sha256': digest },
      body, timeout: 60_000,
    }, matchesReceipt, { request, allowReplay: false });
    const recovered = status === 'temporarily_unavailable' && await reconcileTipDestination(url, headers, matchesReceipt, request);
    if (status !== 'confirmed' && !recovered) return { status, confirmed, destination };
    confirmed.push(destination);
  }
  return { status: 'confirmed', confirmed };
}

export async function deliverTipDestinations(input, env, transport) {
  let prepared;
  try {
    prepared = prepareTipDestinations(input, env);
  } catch {
    return { status: 'rejected', confirmed: [] };
  }
  return deliverPreparedTipDestinations(prepared, env, transport);
}
