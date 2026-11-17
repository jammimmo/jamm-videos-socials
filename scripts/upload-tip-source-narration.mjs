import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { postTipDelivery } from './deliver-tip-video.mjs';
import { isReviewedPcm, TIP_DELIVERY_ORIGIN } from './tip-v11-reviewed-narration.mjs';
import { requestTipSourceNarrationOidc } from './tip-v11-workflow-oidc.mjs';

const MAX_BYTES = 8 * 1024 * 1024;
const ENDPOINT = new URL('/api/social/advice/source-narration', TIP_DELIVERY_ORIGIN);
const opaque = value => typeof value === 'string' && value.length <= 256 && /^[!-~]+$/.test(value);

/** Replays always send the same private WAV. An uncertain receipt never starts TTS. */
export async function uploadTipSourceNarration(input, env, transport = {}) {
  if (!Buffer.isBuffer(input) || input.length < 44 || input.length > MAX_BYTES) return { status: 'rejected' };
  const wav = Buffer.from(input);
  if (!isReviewedPcm(wav)) return { status: 'rejected' };
  const sha256 = createHash('sha256').update(wav).digest('hex');
  let token;
  try {
    token = await requestTipSourceNarrationOidc(sha256, env, transport.request);
  } catch {
    return { status: 'attestation_unavailable' };
  }
  let receipt;
  const status = await postTipDelivery(ENDPOINT, {
    body: wav,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/wav', 'X-Content-SHA256': sha256 },
    timeout: 20_000,
  }, value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 4
      || value.sha256 !== sha256 || value.bytes !== wav.length || !opaque(value.version) || !opaque(value.etag)) return false;
    receipt = { sha256, bytes: wav.length, version: value.version, etag: value.etag };
    return true;
  }, transport);
  return status === 'confirmed' ? { status, receipt } : { status };
}

async function readWav(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = await file.stat();
    if (!stats.isFile() || stats.size < 44 || stats.size > MAX_BYTES) throw new Error();
    const wav = Buffer.alloc(stats.size + 1);
    let size = 0;
    while (size < wav.length) {
      const { bytesRead } = await file.read(wav, size, wav.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size !== stats.size) throw new Error();
    return wav.subarray(0, size);
  } finally {
    await file.close();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.argv.length !== 3) throw new Error();
    const result = await uploadTipSourceNarration(await readWav(process.argv[2]), process.env);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== 'confirmed') process.exitCode = 1;
  } catch {
    process.stderr.write('V11 private source narration unavailable\n');
    process.exitCode = 1;
  }
}
