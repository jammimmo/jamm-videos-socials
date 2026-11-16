import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { constants, openSync, closeSync, fstatSync, readSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildTipV11Narration } from './tip-v11-contract.mjs';
import { isReviewedPcm } from './tip-v11-reviewed-narration.mjs';

const DRAFT_LIMIT = 16 * 1024;
const WAV_LIMIT = 8 * 1024 * 1024;
const INPUT_FIELDS = ['title', 'scriptFr', 'scriptEn', 'caption', 'hashtags'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function readLocalFile(path, limit) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = fstatSync(fd);
    const { size } = metadata;
    if (!metadata.isFile() || size < 1 || size > limit) throw new Error('Invalid source input size');
    const opened = Buffer.alloc(size + 1);
    let offset = 0;
    while (offset < opened.length) {
      const length = readSync(fd, opened, offset, opened.length - offset, null);
      if (length === 0) break;
      offset += length;
    }
    if (offset !== size) throw new Error('Source input changed while reading');
    return opened.subarray(0, size);
  } finally {
    closeSync(fd);
  }
}

export function buildSourceScoringInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).length !== INPUT_FIELDS.length || !INPUT_FIELDS.every(key => Object.hasOwn(input, key))) {
    throw new Error('Invalid V11 advice draft shape');
  }
  const { title, scriptFr, scriptEn, caption, hashtags } = input;
  if (scriptEn !== '' || typeof scriptFr !== 'string' || scriptFr !== scriptFr.trim() || scriptFr.length > 1004
    || typeof caption !== 'string' || !caption.trim() || caption.length > 220
    || !Array.isArray(hashtags) || hashtags.length < 1 || hashtags.length > 6
    || !hashtags.every(tag => typeof tag === 'string' && /^[\p{L}\p{M}\d_]{1,40}$/u.test(tag))) {
    throw new Error('Invalid V11 advice draft fields');
  }
  const body = scriptFr.split(/(?<=[.!?])\s+/u);
  const { segments } = buildTipV11Narration({ id: 'tip-00000000-0000-4000-8000-000000000000', title, body });
  return {
    segments,
    draft_sha256: hash(JSON.stringify({ title, scriptFr, scriptEn, caption, hashtags })),
    source_script_sha256: hash(scriptFr),
  };
}

function main() {
  const { values } = parseArgs({ options: {
    draft: { type: 'string' }, wav: { type: 'string' }, report: { type: 'string' },
  } });
  if (!values.draft || !values.wav || !values.report) {
    throw new Error('Usage: node scripts/score-tip-source.mjs --draft draft.json --wav normalized.wav --report source-speech.json');
  }
  const input = buildSourceScoringInput(JSON.parse(new TextDecoder('utf-8', { fatal: true })
    .decode(readLocalFile(values.draft, DRAFT_LIMIT))));
  const wav = readLocalFile(values.wav, WAV_LIMIT);
  if (!isReviewedPcm(wav)) throw new Error('Expected a complete 24 kHz mono PCM16 WAV');
  const scored = spawnSync(process.env.TIP_SOURCE_PYTHON || 'python3', [
    fileURLToPath(new URL('./score_tip_source.py', import.meta.url)),
  ], {
    input: Buffer.concat([Buffer.from(`${JSON.stringify(input)}\n`), wav]),
    encoding: 'utf8', maxBuffer: 128 * 1024, timeout: 360_000,
    env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' },
  });
  if (scored.status !== 0) throw new Error('V11 source scoring could not read or process this WAV');
  const result = JSON.parse(scored.stdout);
  writeFileSync(values.report, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return result.status === 'matched' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
