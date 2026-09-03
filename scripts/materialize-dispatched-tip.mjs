#!/usr/bin/env node

import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64_RE = /^[a-f0-9]{64}$/;
const WORKER_ORIGIN = 'https://jammimmo-estate-flow.jammimmo221admin.workers.dev';

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value.trim();
}

function deliveryUrl(value, pathname, attempt) {
  const raw = text(value, pathname, 512);
  const url = new URL(raw);
  if (url.origin !== WORKER_ORIGIN || url.pathname !== pathname || url.username || url.password || url.hash
    || url.searchParams.size !== 1 || url.searchParams.get('attempt') !== attempt) {
    throw new Error(`${pathname} is not the exact production callback URL`);
  }
  return url.toString();
}

function wordsToFiveParts(value) {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 10) throw new Error('script is too short for five scenes');
  const parts = [];
  for (let index = 0; index < 5; index++) {
    const start = Math.floor((index * words.length) / 5);
    const end = Math.floor(((index + 1) * words.length) / 5);
    parts.push(words.slice(start, end).join(' '));
  }
  return parts;
}

function short(value, max) {
  if (value.length <= max) return value;
  const clipped = value.slice(0, max + 1).replace(/\s+\S*$/, '').trim();
  return `${clipped || value.slice(0, max).trim()}…`;
}

const VISUALS = {
  advice: ['document-stack', 'id-check', 'contract', 'calendar-notice', 'building'],
  tips: ['listing-address', 'fine-print', 'budget-calc', 'schedule-clock', 'receipt'],
  market_education: ['building', 'traffic', 'expenses-breakdown', 'calendar-notice', 'verbal-handshake'],
};

export function materializeDispatchedTip(raw) {
  const payload = object(raw, 'payload');
  if (payload.contract !== 'jamm-tip-render-v1') throw new Error('unsupported render contract');
  const job = object(payload.job, 'job');
  const content = object(payload.content, 'content');
  const delivery = object(payload.delivery, 'delivery');
  const evidence = object(payload.evidence, 'evidence');

  const jobId = text(job.id, 'job.id', 36).toLowerCase();
  if (!UUID_RE.test(jobId)) throw new Error('job.id must be a UUID');
  const family = text(job.family, 'job.family', 32);
  if (!Object.hasOwn(VISUALS, family)) throw new Error('unsupported editorial family');
  text(job.postId, 'job.postId', 36);
  text(job.hookId, 'job.hookId', 36);
  if (!UUID_RE.test(job.postId) || !UUID_RE.test(job.hookId)) throw new Error('postId and hookId must be UUIDs');
  if (!['proven', 'variant', 'disruptive'].includes(job.creativeTier)) throw new Error('invalid creative tier');

  const title = text(content.title, 'content.title', 180);
  const scriptFr = text(content.scriptFr, 'content.scriptFr', 4000);
  const scriptEn = text(content.scriptEn, 'content.scriptEn', 4000);
  text(content.caption, 'content.caption', 2200);
  if (content.voice !== 'Charon') throw new Error('unsupported voice');
  if (!/Jamm Immo/i.test(scriptFr) || !/Jamm Immo/i.test(scriptEn)) {
    throw new Error('Jamm Immo must be spoken in both scripts');
  }
  if (!Array.isArray(content.hashtags) || content.hashtags.length > 12
    || content.hashtags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 40)) {
    throw new Error('invalid hashtags');
  }

  if (evidence.brandContract !== 'jamm-immo-v1'
    || evidence.campaignSignature !== 'La vérité avant la visite.') {
    throw new Error('invalid brand evidence contract');
  }
  const attempt = new URL(text(delivery.uploadUrl, 'delivery.uploadUrl', 512)).searchParams.get('attempt') ?? '';
  if (!UUID_RE.test(attempt)) throw new Error('missing attempt capability');
  const uploadUrl = deliveryUrl(delivery.uploadUrl, '/api/tour/upload', attempt);
  const callbackUrl = deliveryUrl(delivery.callbackUrl, '/api/tour/callback', attempt);
  const callbackToken = text(delivery.callbackToken, 'delivery.callbackToken', 64).toLowerCase();
  if (!HEX64_RE.test(callbackToken)) throw new Error('invalid callback capability');

  const fr = wordsToFiveParts(scriptFr);
  const en = wordsToFiveParts(scriptEn);
  const cards = content.hashtags.slice(0, 3).map((tag) => short(tag.replace(/^#/, ''), 24));
  while (cards.length < 3) cards.push(['Conseil', 'Dakar', 'Jamm Immo'][cards.length]);

  const spec = {
    id: `tip-${jobId}`,
    title,
    hook: {
      title: short(title.toUpperCase(), 54),
      titleEn: short(en[0], 54),
      subline: 'La vérité avant la visite.',
      sublineEn: 'The truth before the visit.',
      cards,
    },
    scenes: fr.map((voiceoverFr, index) => ({
      visualType: VISUALS[family][index],
      subtitle: short(voiceoverFr.toUpperCase(), 58),
      subtitleEn: short(en[index], 58),
      voiceoverFr,
      voiceoverEn: en[index],
    })),
    voiceoverScript: scriptFr,
  };

  return { jobId, callbackUrl, uploadUrl, callbackToken, spec };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, item, index, all) => {
    if (item.startsWith('--') && all[index + 1] && !all[index + 1].startsWith('--')) {
      pairs.push([item.slice(2), all[index + 1]]);
    }
    return pairs;
  }, []));
  if (!args.payload || !args.spec || !args.env) {
    throw new Error('usage: --payload <json> --spec <json> --env <github-env>');
  }
  const result = materializeDispatchedTip(JSON.parse(await readFile(resolve(args.payload), 'utf8')));
  await writeFile(resolve(args.spec), `${JSON.stringify(result.spec)}\n`, { mode: 0o600 });
  await appendFile(resolve(args.env), [
    `TIP_JOB_ID=${result.jobId}`,
    `TIP_CALLBACK_URL=${result.callbackUrl}`,
    `TIP_UPLOAD_URL=${result.uploadUrl}`,
    `TIP_CALLBACK_TOKEN=${result.callbackToken}`,
    `TIP_SPEC_FILE=${resolve(args.spec)}`,
    '',
  ].join('\n'));
  console.log(`dispatched tip payload validated for job ${result.jobId}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`materialize failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
