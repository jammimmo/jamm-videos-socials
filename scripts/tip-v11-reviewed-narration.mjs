import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { requestTipNarrationOidc } from './tip-v11-workflow-oidc.mjs';

export const REVIEWED_NARRATION_CONTRACT = 'tip-v11-reviewed-narration-v1';
export const REVIEWED_NARRATION_DISPATCH = 'jamm-tip-render-v3-reviewed-narration';
export const REVIEWED_NARRATION_MODEL = 'reviewed-source-pcm-v1';
export const TIP_DELIVERY_ORIGIN = 'https://jammimmo-estate-flow.jammimmo221admin.workers.dev';
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAX_BYTES = 8 * 1024 * 1024;
const SCRATCH_PREFIX = 'jamm-tip-v11-narration-';

export function parseReviewedNarration(value, actualRendererSha) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.contract !== REVIEWED_NARRATION_CONTRACT
    || typeof value.sha256 !== 'string' || !SHA256.test(value.sha256)
    || typeof actualRendererSha !== 'string' || !COMMIT_SHA.test(actualRendererSha)
    || value.rendererSha !== actualRendererSha) return null;
  const privateAttempt = Object.hasOwn(value, 'source');
  if (Object.keys(value).length !== (privateAttempt ? 4 : 3)
    || !['contract', 'sha256', 'rendererSha'].every(key => Object.hasOwn(value, key))
    || (privateAttempt && value.source !== 'private-attempt')) return null;
  return { contract: REVIEWED_NARRATION_CONTRACT, sha256: value.sha256, rendererSha: actualRendererSha,
    ...(privateAttempt && { source: 'private-attempt' }) };
}

function isReviewedPcm(wav) {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF'
    || wav.readUInt32LE(4) !== wav.length - 8 || wav.toString('ascii', 8, 12) !== 'WAVE') return false;
  let validFormat = false;
  let validData = false;
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const type = wav.toString('ascii', offset, offset + 4);
    const length = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (body + length > wav.length) return false;
    if (type === 'fmt ') {
      if (validFormat || length < 16 || wav.readUInt16LE(body) !== 1 || wav.readUInt16LE(body + 2) !== 1
        || wav.readUInt32LE(body + 4) !== 24_000 || wav.readUInt32LE(body + 8) !== 48_000
        || wav.readUInt16LE(body + 12) !== 2 || wav.readUInt16LE(body + 14) !== 16) return false;
      validFormat = true;
    } else if (type === 'data') {
      if (!validFormat || validData || length < 2 || length % 2 !== 0) return false;
      validData = true;
    }
    offset = body + length + length % 2;
  }
  return validFormat && validData && offset === wav.length;
}

function verifyReviewedWav(bytes, pin) {
  if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256 || !isReviewedPcm(bytes)) {
    throw new Error('Reviewed V11 narration bytes or PCM format mismatch');
  }
}

async function readReviewedWav(source, pin, requirePrivate) {
  const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
  if (!file) throw new Error('Reviewed V11 narration file unavailable');
  try {
    const meta = await file.stat();
    if (!meta.isFile() || meta.size < 44 || meta.size > MAX_BYTES || (requirePrivate && (meta.mode & 0o077) !== 0)) {
      throw new Error('Reviewed V11 narration file unavailable');
    }
    const buffer = Buffer.alloc(meta.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== meta.size) throw new Error('Reviewed V11 narration bytes or PCM format mismatch');
    const bytes = buffer.subarray(0, length);
    verifyReviewedWav(bytes, pin);
    return bytes;
  } finally {
    await file.close();
  }
}

/** Resolve the only allowed legacy source within the pinned checkout. */
export async function stageReviewedNarration(root, output, reviewed, actualRendererSha) {
  const pin = parseReviewedNarration(reviewed, actualRendererSha);
  if (!pin || pin.source) throw new Error('Reviewed V11 narration identity mismatch');
  const directory = resolve(await realpath(root), 'approved-narrations/v11/sha256');
  if (await realpath(directory).catch(() => null) !== directory) throw new Error('Reviewed V11 narration directory unavailable');
  const bytes = await readReviewedWav(resolve(directory, `${pin.sha256}.wav`), pin, false);
  await writeFile(output, bytes, { mode: 0o600 });
  return { path: output, source: 'reviewed-bundle' };
}

async function fetchPrivateWav(delivery, pin, env, fetchImpl) {
  const url = new URL(delivery.callbackUrl);
  const attempt = url.searchParams.get('attempt');
  if (url.origin !== TIP_DELIVERY_ORIGIN || url.pathname !== '/api/tour/callback' || url.username || url.password
    || url.hash || url.searchParams.size !== 1 || !UUID.test(attempt) || !UUID.test(delivery.jobId)
    || !SHA256.test(delivery.callbackToken)) throw new Error('V11 private narration delivery identity mismatch');
  url.searchParams.set('action', 'tip-v11-narration');
  let response;
  try {
    const oidc = await requestTipNarrationOidc(delivery.jobId, attempt, pin.sha256, env, fetchImpl);
    response = await fetchImpl(url, {
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: 'audio/wav', 'Accept-Encoding': 'identity', Authorization: `Bearer ${delivery.callbackToken}`,
        'X-Job-Id': delivery.jobId, 'X-Tip-Narration-Sha256': pin.sha256, 'X-Tip-Workflow-OIDC': oidc,
      },
    });
  } catch {
    throw new Error('V11 private narration is unavailable');
  }
  const contentLength = response.headers.get('Content-Length') ?? '';
  const size = /^(?:[1-9][0-9]{1,6})$/.test(contentLength) ? Number(contentLength) : 0;
  const contentEncoding = response.headers.get('Content-Encoding');
  if (response.status !== 200 || response.headers.get('Content-Type') !== 'audio/wav'
    || (contentEncoding !== null && contentEncoding !== 'identity') || size < 44 || size > MAX_BYTES || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error('V11 private narration response is invalid');
  }
  const bytes = Buffer.alloc(size);
  const reader = response.body.getReader();
  let received = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (received + value.byteLength > size) throw new Error('Wrong length');
      bytes.set(value, received);
      received += value.byteLength;
    }
    if (received !== size) throw new Error('Wrong length');
  } catch {
    await reader.cancel().catch(() => {});
    throw new Error('V11 private narration size mismatch or stream interrupted');
  } finally {
    reader.releaseLock();
  }
  verifyReviewedWav(bytes, pin);
  return bytes;
}

export async function stagePrivateReviewedNarration(delivery, reviewed, env, fetchImpl = fetch) {
  const pin = parseReviewedNarration(reviewed, env.GITHUB_SHA);
  if (pin?.source !== 'private-attempt' || !env.RUNNER_TEMP) throw new Error('V11 private narration identity mismatch');
  const scratchRoot = await realpath(env.RUNNER_TEMP);
  // The scratch path becomes one GITHUB_ENV value.
  if (/[\r\n]/.test(scratchRoot)) throw new Error('V11 private narration scratch directory is invalid');
  const bytes = await fetchPrivateWav(delivery, pin, env, fetchImpl);
  const directory = await mkdtemp(resolve(scratchRoot, SCRATCH_PREFIX));
  const path = resolve(directory, `${pin.sha256}.wav`);
  try {
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return path;
}

export async function readStagedPrivateReviewedNarration(reviewed, env) {
  const pin = parseReviewedNarration(reviewed, env.GITHUB_SHA);
  const path = env.TIP_PRIVATE_NARRATION_FILE;
  if (pin?.source !== 'private-attempt' || !env.RUNNER_TEMP || !path || basename(path) !== `${pin.sha256}.wav`) {
    throw new Error('V11 private narration scratch identity mismatch');
  }
  const directory = dirname(path);
  if (dirname(directory) !== await realpath(env.RUNNER_TEMP) || !basename(directory).startsWith(SCRATCH_PREFIX)
    || await realpath(directory).catch(() => null) !== directory) throw new Error('V11 private narration scratch identity mismatch');
  await readReviewedWav(path, pin, true);
  return { path, source: 'reviewed-bundle' };
}
