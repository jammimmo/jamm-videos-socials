import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { buildSourceScoringInput } from './score-tip-source.mjs';
import { uploadTipSourceNarration } from './upload-tip-source-narration.mjs';
import { submitTipSourceQualification } from './submit-tip-v11-source-qualification.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const keysAre = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function validPlatformCopy(value) {
  if (!keysAre(value, ['facebook', 'instagram', 'tiktok', 'youtube'])) return false;
  const captions = new Set();
  const ctas = new Set();
  for (const copy of Object.values(value)) {
    if (!keysAre(copy, ['caption', 'cta'])) return false;
    for (const [key, maximum] of [['caption', 2200], ['cta', 240]]) {
      const text = copy[key];
      if (typeof text !== 'string' || !text || text !== text.trim() || [...text].length > maximum
        || !/\p{L}/u.test(text.replace(/#[\p{L}\p{N}_]+/gu, ''))) return false;
    }
    const text = `${copy.caption}\n${copy.cta}`;
    if (/(?:^|[^\p{L}\p{N}_])(?:jamm[ ._/-]*immobili?(?:er|ère)|jam[ ._/-]*(?:immo|immobili?(?:er|ère))|jamm?[ ._/-]*ibo)(?=$|[^\p{L}\p{N}_])/iu.test(text)) return false;
    const tags = [...text.matchAll(/(?:^|[\s,;])#([\p{L}\p{N}_]+)(?=$|[^\p{L}\p{N}_./#-])/gu)].map(match => match[1]);
    if (tags.length < 1 || tags.length > 5 || new Set(tags.map(tag => tag.toLowerCase())).size !== tags.length
      || tags.filter(tag => tag === 'JammImmo').length !== 1
      || tags.some(tag => [...tag].length > 48 || !/\p{L}/u.test(tag))) return false;
    captions.add(copy.caption); ctas.add(copy.cta);
  }
  return captions.size === 4 && ctas.size === 4;
}

function checkedJob(input) {
  const sourceKeys = ['policyId', 'expectedPolicyUpdatedAt', 'postId', 'hookId', 'draft', 'platformCopy', 'profile'];
  const withAttempt = Object.hasOwn(input ?? {}, 'sourceJob');
  if (!keysAre(input, withAttempt ? [...sourceKeys, 'sourceJob'] : sourceKeys)
    || !['policyId', 'postId', 'hookId'].every(key => typeof input[key] === 'string' && UUID.test(input[key]))
    || typeof input.expectedPolicyUpdatedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(input.expectedPolicyUpdatedAt)
    || !Number.isFinite(Date.parse(input.expectedPolicyUpdatedAt))
    || !keysAre(input.profile, ['templateManifestSha256', 'runtimeSha256', 'qualifierSha256'])
    || !Object.values(input.profile).every(value => typeof value === 'string' && SHA256.test(value))
    || !validPlatformCopy(input.platformCopy)
    || Buffer.byteLength(JSON.stringify(input.platformCopy)) > 12_000
    || (withAttempt && (!validSourceJob(input.sourceJob) || input.sourceJob.id !== input.postId))) throw new Error('Invalid source work');
  // Validate the same five-scene French input as the scorer before any upload.
  const identity = buildSourceScoringInput(input.draft);
  return { job: structuredClone(input), identity };
}

export function validSourceJob(value) {
  return keysAre(value, ['id', 'claimToken', 'attempt'])
    && typeof value.id === 'string' && UUID.test(value.id)
    && typeof value.claimToken === 'string' && UUID.test(value.claimToken)
    && Number.isSafeInteger(value.attempt) && value.attempt >= 1 && value.attempt <= 3;
}

export function validateTipSourceJob(input) {
  return checkedJob(input).job;
}

/** Complete the two private transfers without requesting or regenerating a voice. */
export async function qualifyTipSource(input, wavInput, speechInput, env, transport = {}) {
  let job;
  let identity;
  let speech;
  let wav;
  try {
    ({ job, identity } = checkedJob(input));
    wav = Buffer.from(wavInput);
    speech = structuredClone(speechInput);
    if (!['tip-v11-fr-source-speech-v1', 'tip-v11-fr-source-speech-v2'].includes(speech?.contract)
      || speech.status !== 'matched' || speech.source !== 'normalized_wav_pcm_s16le_mono_24khz'
      || speech.draft_sha256 !== identity.draft_sha256 || speech.source_script_sha256 !== identity.source_script_sha256
      || speech.narration_wav_sha256 !== hash(wav)
      || typeof speech.decoded_pcm_sha256 !== 'string' || !SHA256.test(speech.decoded_pcm_sha256)
      || speech.accent_evaluated !== false) return { status: 'rejected' };
    if (speech.contract === 'tip-v11-fr-source-speech-v2'
      && JSON.stringify(speech.deferred_checks) !== '["domain_audio","visible_domain_cta"]') return { status: 'rejected' };
    if (Buffer.byteLength(JSON.stringify({ ...job, speech })) > 47 * 1024) return { status: 'rejected' };
  } catch {
    return { status: 'rejected' };
  }
  const uploaded = await uploadTipSourceNarration(wav, env, transport);
  if (uploaded.status !== 'confirmed') return { status: uploaded.status, stage: 'narration' };
  const body = Buffer.from(JSON.stringify({ ...job, narration: uploaded.receipt, speech }));
  // The authority independently checks the actual private WAV, transcript,
  // active policy and exact work identities. A runner-side pass is insufficient.
  const qualified = await submitTipSourceQualification(body, env, transport);
  return { ...qualified, stage: 'qualification' };
}

async function readLocal(path, maxBytes) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const meta = await file.stat();
    if (!meta.isFile() || meta.size < 1 || meta.size > maxBytes) throw new Error();
    const data = Buffer.alloc(meta.size + 1);
    let size = 0;
    while (size < data.length) {
      const { bytesRead } = await file.read(data, size, data.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size !== meta.size) throw new Error();
    return data.subarray(0, size);
  } finally {
    await file.close();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: { job: { type: 'string' }, wav: { type: 'string' }, speech: { type: 'string' } } });
    if (!values.job || !values.wav || !values.speech) throw new Error();
    const decode = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
    const result = await qualifyTipSource(decode(await readLocal(values.job, 20 * 1024)),
      await readLocal(values.wav, 8 * 1024 * 1024), decode(await readLocal(values.speech, 48 * 1024)), process.env);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== 'confirmed') process.exitCode = 1;
  } catch {
    process.stderr.write('V11 source work or measured speech unavailable\n');
    process.exitCode = 1;
  }
}
