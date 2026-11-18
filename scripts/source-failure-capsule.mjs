import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { postTipDelivery } from './deliver-tip-video.mjs';
import { validCapsuleDiagnostic } from './source-failure-diagnostic.mjs';
import { buildSourceScoringInput } from './score-tip-source.mjs';
import { isReviewedPcm, TIP_DELIVERY_ORIGIN } from './tip-v11-reviewed-narration.mjs';
import { requestTipSourceCapsuleReadOidc, requestTipSourceCapsuleWriteOidc } from './tip-v11-workflow-oidc.mjs';

const endpoint = new URL('/api/social/advice/source-failure-capsule', TIP_DELIVERY_ORIGIN);
const contract = 'source-failure-capsule-v1';
const MAX_METADATA = 16 * 1024;
const MAX_WAV = 8 * 1024 * 1024;
const MAX_FRAME = 4 + MAX_METADATA + MAX_WAV;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const isDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isUuid = value => typeof value === 'string' && UUID.test(value);
const validAttempt = value => [1, 2, 3].includes(value);
const liveExpiry = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value)
  && Date.parse(value) > Date.now();
const validWav = wav => Buffer.isBuffer(wav) && wav.length >= 44 && wav.length <= MAX_WAV && isReviewedPcm(wav);
export const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function validCapsuleIdentity({ jobId, attempt, wavSha256 }) {
  return isUuid(jobId) && validAttempt(attempt) && isDigest(wavSha256);
}

function frameWrite(metadata, wav) {
  const json = Buffer.from(JSON.stringify(metadata));
  if (!json.length || json.length > MAX_METADATA) throw new Error('Invalid capsule metadata');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(json.length);
  return Buffer.concat([size, json, wav]);
}

export async function uploadFailureCapsule(sourceJob, wav, wavKind, diagnostic, env, transport = {}) {
  if (!exactKeys(sourceJob, ['id', 'attempt', 'claimToken']) || !isUuid(sourceJob.id) || !isUuid(sourceJob.claimToken)
    || !validAttempt(sourceJob.attempt) || !validWav(wav) || !validCapsuleDiagnostic(diagnostic, wavKind)) return { status: 'rejected' };
  const wavSha256 = digest(wav);
  const body = frameWrite({ contract, sourceJob, wavSha256, wavKind, diagnostic }, wav);
  let token;
  try {
    token = await requestTipSourceCapsuleWriteOidc(body, env, transport.request);
  } catch {
    return { status: 'attestation_unavailable' };
  }
  const status = await postTipDelivery(endpoint, {
    body, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream',
      'X-Content-SHA256': digest(body) }, timeout: 20_000,
  }, receipt => exactKeys(receipt, ['stored', 'jobId', 'attempt', 'wavSha256', 'expiresAt'])
    && receipt.stored === true && receipt.jobId === sourceJob.id && receipt.attempt === sourceJob.attempt
    && receipt.wavSha256 === wavSha256 && liveExpiry(receipt.expiresAt), transport);
  return status === 'confirmed' ? { status, wavSha256 } : { status };
}

async function readFailureWav(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const meta = await file.stat();
    if (!meta.isFile() || meta.size < 44 || meta.size > MAX_WAV) return null;
    const bytes = Buffer.alloc(meta.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await file.read(bytes, size, bytes.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    const wav = bytes.subarray(0, size);
    return size === meta.size && validWav(wav) ? wav : null;
  } finally {
    await file.close();
  }
}

export async function captureFailureCapsule(scratch, sourceJob, diagnostic, env, upload = uploadFailureCapsule) {
  if (!scratch || !diagnostic) return { status: 'no_audio' };
  for (const kind of ['normalized', 'raw']) {
    const wav = await readFailureWav(resolve(scratch, kind + '.wav')).catch(() => null);
    if (wav) return upload(sourceJob, wav, kind, diagnostic, env);
  }
  return { status: 'no_audio' };
}

async function readFrame(response) {
  const lengthHeader = response.headers.get('Content-Length');
  const declared = lengthHeader === null ? null : Number(lengthHeader);
  if (response.redirected || response.status !== 200 || response.headers.get('Content-Type') !== 'application/octet-stream'
    || ![null, 'identity'].includes(response.headers.get('Content-Encoding')) || !response.body
    || (lengthHeader !== null && (!/^[1-9]\d{0,6}$/.test(lengthHeader) || declared > MAX_FRAME))) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Capsule unavailable');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FRAME || (declared !== null && size > declared)) throw new Error('Invalid capsule length');
      chunks.push(value);
    }
    if ((declared !== null && declared !== size) || size < 49) throw new Error('Incomplete capsule');
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export async function fetchFailureCapsule(identity, env, request = fetch) {
  if (!validCapsuleIdentity(identity)) throw new Error('Invalid capsule identity');
  const { jobId, attempt, wavSha256 } = identity;
  const token = await requestTipSourceCapsuleReadOidc(jobId, attempt, wavSha256, env, request);
  const response = await request(endpoint, {
    method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream', 'Accept-Encoding': 'identity',
      'X-Source-Job-Id': jobId, 'X-Source-Attempt': String(attempt), 'X-Content-SHA256': wavSha256 },
  });
  const bytes = await readFrame(response);
  const jsonEnd = 4 + bytes.readUInt32BE(0);
  if (jsonEnd <= 4 || jsonEnd > 4 + MAX_METADATA || jsonEnd >= bytes.length) throw new Error('Invalid capsule header');
  const header = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(4, jsonEnd)));
  const wav = bytes.subarray(jsonEnd);
  if (!exactKeys(header, ['contract', 'jobId', 'attempt', 'wavSha256', 'wavKind', 'draft', 'sourceDraftSha256',
    'scoringDraftSha256', 'runtimeSha256', 'diagnostic', 'expiresAt']) || header.contract !== contract || header.jobId !== jobId
    || header.attempt !== attempt || header.wavSha256 !== wavSha256 || !isDigest(header.sourceDraftSha256)
    || !isDigest(header.runtimeSha256) || !liveExpiry(header.expiresAt) || !validCapsuleDiagnostic(header.diagnostic, header.wavKind)
    || !validWav(wav) || digest(wav) !== wavSha256) throw new Error('Capsule verification failed');
  // The Worker resolves the draft from the job pinned by its private receipt.
  // Its DB digest also covers the hook. The scorer uses its own draft-only hash.
  const scoringInput = buildSourceScoringInput(header.draft);
  if (scoringInput.draft_sha256 !== header.scoringDraftSha256) throw new Error('Capsule draft mismatch');
  return { draft: header.draft, wav, wavKind: header.wavKind, runtimeSha256: header.runtimeSha256,
    diagnostic: header.diagnostic, scoringInput };
}
