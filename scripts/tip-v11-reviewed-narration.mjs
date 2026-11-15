import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const REVIEWED_NARRATION_CONTRACT = 'tip-v11-reviewed-narration-v1';
export const REVIEWED_NARRATION_DISPATCH = 'jamm-tip-render-v3-reviewed-narration';
export const REVIEWED_NARRATION_MODEL = 'reviewed-source-pcm-v1';
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const MAX_BYTES = 8 * 1024 * 1024;

export function parseReviewedNarration(value, actualRendererSha) {
  if (!value || Object.keys(value).length !== 3 || value.contract !== REVIEWED_NARRATION_CONTRACT
    || typeof value.sha256 !== 'string' || !SHA256.test(value.sha256)
    || typeof actualRendererSha !== 'string' || !COMMIT_SHA.test(actualRendererSha)
    || value.rendererSha !== actualRendererSha) return null;
  return { contract: REVIEWED_NARRATION_CONTRACT, sha256: value.sha256, rendererSha: actualRendererSha };
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

/** Resolve the only allowed source within the pinned checkout. The caller
 * may prepare an ordinary per-job scratch input after validating the bytes. */
export async function stageReviewedNarration(root, output, reviewed, actualRendererSha) {
  const pin = parseReviewedNarration(reviewed, actualRendererSha);
  if (!pin) throw new Error('Reviewed V11 narration identity mismatch');
  const directory = resolve(await realpath(root), 'approved-narrations/v11/sha256');
  if (await realpath(directory).catch(() => null) !== directory) throw new Error('Reviewed V11 narration directory unavailable');
  const source = resolve(directory, `${pin.sha256}.wav`);
  const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
  if (!file) throw new Error('Reviewed V11 narration file unavailable');
  let bytes;
  try {
    const meta = await file.stat();
    if (!meta.isFile() || meta.size < 44 || meta.size > MAX_BYTES) throw new Error('Reviewed V11 narration file unavailable');
    const buffer = Buffer.alloc(meta.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    bytes = buffer.subarray(0, length);
    if (length !== meta.size || createHash('sha256').update(bytes).digest('hex') !== pin.sha256 || !isReviewedPcm(bytes)) {
      throw new Error('Reviewed V11 narration bytes or PCM format mismatch');
    }
  } finally {
    await file.close();
  }
  await writeFile(output, bytes, { mode: 0o600 });
  return { path: output, source: 'reviewed-bundle' };
}
