import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { TIP_DELIVERY_ORIGIN } from './tip-v11-reviewed-narration.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 4096;
const UPLOAD_TIMEOUT_MS = 60_000;
const RETRY_DELAYS_MS = [250, 1000];
const MAX_RETRY_DELAY_MS = 10_000;

export function readTipVideo(path, maximum = MAX_VIDEO_BYTES) {
  const fd = openSync(path, 'r');
  try {
    const file = fstatSync(fd);
    const { size } = file;
    if (!file.isFile() || size < 1 || size > maximum) return null;
    const bytes = Buffer.alloc(size + 1);
    return readSync(fd, bytes, 0, bytes.length, 0) === size ? bytes.subarray(0, size) : null;
  } finally {
    closeSync(fd);
  }
}

function retryDelay(response, fallback, now) {
  const hint = response?.headers.get('retry-after');
  if (!hint) return fallback;
  const milliseconds = /^\d+$/.test(hint) ? Number(hint) * 1000 : Date.parse(hint) - now();
  if (Number.isNaN(milliseconds)) return fallback;
  if (milliseconds > MAX_RETRY_DELAY_MS) return null;
  return Math.max(fallback, milliseconds);
}

export async function confirmsDelivery(response, matchesReceipt) {
  const reader = response.body?.getReader();
  if (!reader) return false;
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RECEIPT_BYTES) {
        await reader.cancel().catch(() => {});
        return false;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
    return matchesReceipt(result);
  } catch {
    return false;
  }
}

export function readTipDeliveryTarget(env) {
  const jobId = env.TIP_JOB_ID ?? '';
  const token = env.TIP_CALLBACK_TOKEN ?? '';
  if (!UUID.test(jobId) || !SHA256.test(token)) return null;
  let url;
  try {
    url = new URL(env.TIP_UPLOAD_URL);
  } catch {
    return null;
  }
  if (url.origin !== TIP_DELIVERY_ORIGIN || url.pathname !== '/api/tour/upload' || url.username || url.password || url.hash
    || url.searchParams.size !== 1 || !UUID.test(url.searchParams.get('attempt') ?? '')) return null;
  return { jobId, token, url };
}

export async function postTipDelivery(url, { headers, body, timeout }, matchesReceipt, {
  request = fetch, sleep = wait, now = Date.now, allowReplay = true,
} = {}) {
  const retryCount = allowReplay ? RETRY_DELAYS_MS.length : 0;
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    let response;
    try {
      response = await request(url, {
        method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeout),
      });
      if (response.redirected) return 'rejected';
      if (response.status === 200) return await confirmsDelivery(response, matchesReceipt)
        ? 'confirmed' : allowReplay ? 'rejected' : 'temporarily_unavailable';
      await response.body?.cancel().catch(() => {});
      const status = response.status;
      if (status !== 408 && status !== 429 && (status < 500 || status > 599)) return 'rejected';
    } catch {
      // The Worker may already have recorded this request. Reuse the same
      // attempt and payload to recover its receipt.
    }
    if (attempt === retryCount) break;
    const delay = retryDelay(response, RETRY_DELAYS_MS[attempt], now);
    if (delay === null) break;
    await sleep(delay);
  }
  return 'temporarily_unavailable';
}

export async function deliverTipVideo({ video, digest, duration }, env, transport) {
  if (!Buffer.isBuffer(video) || video.length === 0 || video.length > MAX_VIDEO_BYTES
    || !SHA256.test(digest) || createHash('sha256').update(video).digest('hex') !== digest
    || !Number.isSafeInteger(duration) || duration < 1) return 'rejected';
  const target = readTipDeliveryTarget(env);
  if (!target) return 'rejected';
  const { jobId, token, url } = target;

  const evidence = env.TIP_RENDER_EVIDENCE ?? '';
  const attestation = env.TIP_WORKFLOW_ATTESTATION ?? '';
  if (evidence.length > 1024 || /[\r\n]/.test(evidence)
    || (attestation && (!evidence || attestation.length > 8192 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(attestation)))) return 'rejected';
  const headers = {
    Authorization: `Bearer ${token}`, 'Content-Type': 'video/mp4', 'Content-Length': String(video.length),
    'X-Job-Id': jobId, 'X-Media-Sha256': digest, 'X-Duration': String(duration),
    'X-Width': '1080', 'X-Height': '1920',
    ...(evidence && { 'X-Tip-Render-Evidence': evidence }),
    ...(attestation && { 'X-Tip-Workflow-OIDC': attestation }),
  };
  const result = await postTipDelivery(url, { headers, body: video, timeout: UPLOAD_TIMEOUT_MS },
    receipt => receipt?.ok === true && receipt.jobId === jobId && receipt.status === 'succeeded' && receipt.attached === true,
    transport);
  return result === 'confirmed' ? 'attached' : result;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  let result = 'rejected';
  try {
    const [, , path, digest, duration] = process.argv;
    result = await deliverTipVideo({ video: readTipVideo(path), digest, duration: Number(duration) }, process.env);
  } catch {
    // Keep renderer credentials, Worker reply content and draft URLs out of logs.
  }
  if (result !== 'attached') {
    process.stderr.write(result === 'temporarily_unavailable' ? 'Tip upload temporarily unavailable\n' : 'Tip upload rejected\n');
    process.exitCode = result === 'temporarily_unavailable' ? 75 : 1;
  }
}
