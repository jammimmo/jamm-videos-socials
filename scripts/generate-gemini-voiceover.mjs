#!/usr/bin/env node
// Generate a French voice-over WAV for a single JAMM IMMO short video using
// Google Gemini TTS. The API key is read ONLY from
// process.env.GEMINI_API_KEY — never logged, never written to disk.
//
// Usage:
//   node scripts/generate-gemini-voiceover.mjs \
//     --id video-001 \
//     --title "01 - Payer avant la visite" \
//     --script "À Dakar, payer avant la visite peut coûter très cher..."
//
// Writes:
//   public/audio/voiceovers/<id>.wav
//   public/audio/voiceovers/<id>.sha256   (hash of the exact provider passage, for cache invalidation)

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TIP_V11_TEMPLATE } from './tip-v11-contract.mjs';
import { VOICE_NAME, TIP_V11_VOICE_NAME, TIP_V11_VOICE_HTTP_OPTIONS, PRIMARY_MODEL, voiceCacheHash, voicePrompt } from './voice-profile.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Gemini TTS returns raw little-endian 16-bit PCM mono at 24000 Hz.
const SAMPLE_RATE = 24000;
const NUM_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

const TIP_V11_SOCIALS_TEXT = 'Suivez aussi Jamm Immo sur nos réseaux sociaux pour retrouver nos prochains conseils.';
const TIP_V11_SOCIALS_SPOKEN = 'Suivez aussi, Jamm Immo, sur nos réseaux sociaux pour retrouver nos prochains conseils.';
const TIP_V11_FIXED_CLOSE = `Plus deux cent vingt et un, soixante-seize, neuf cent quarante-quatre, quarante-huit, quarante-neuf. ${TIP_V11_SOCIALS_TEXT} À bientôt ! Jamm Immo ! Kër gu baax, xel mu dal !`;

/** Add two natural pauses only to the exact fixed V11 close sent to TTS. */
export function tipV11SpokenScript(script, profile = '') {
  if (profile !== TIP_V11_TEMPLATE || typeof script !== 'string') return script;
  const suffixStart = script.length - TIP_V11_FIXED_CLOSE.length;
  if (suffixStart < 0 || script.indexOf(TIP_V11_FIXED_CLOSE) !== suffixStart) return script;
  const spokenClose = TIP_V11_FIXED_CLOSE.replace(TIP_V11_SOCIALS_TEXT, TIP_V11_SOCIALS_SPOKEN);
  return `${script.slice(0, suffixStart)}${spokenClose}`;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      out[key] = value;
      i += 1;
    }
  }
  return out;
}

function abort(msg, code = 1) {
  console.error(`✖ ${msg}`);
  process.exit(code);
}

// Wrap raw PCM with a minimal RIFF/WAVE header.
export function pcmToWav(pcm) {
  const byteRate = (SAMPLE_RATE * NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
  const blockAlign = (NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);             // PCM chunk size
  header.writeUInt16LE(1, 20);              // PCM format
  header.writeUInt16LE(NUM_CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

const MAX_TIP_PCM_BYTES = 123 * SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8);

function decodeTipVoice(response) {
  const candidates = response?.candidates;
  const audio = candidates?.[0]?.content?.parts?.filter(part => part.inlineData).map(part => part.inlineData);
  if (candidates?.length !== 1 || audio?.length !== 1 || typeof audio[0].data !== 'string'
    || audio[0].data.length > Math.ceil(MAX_TIP_PCM_BYTES / 3) * 4) throw new Error('One bounded Gemini take is required');
  const [type, ...fields] = String(audio[0].mimeType || '').toLowerCase().split(';').map(value => value.trim());
  const allowed = { rate: '24000', channels: '1', bits: '16', bitdepth: '16', 'bit-depth': '16', bit_depth: '16', codec: 'pcm' };
  const parameters = new Set();
  for (const field of fields) {
    const [key, value, extra] = field.split('=');
    if (!Object.hasOwn(allowed, key) || parameters.has(key) || extra !== undefined || value !== allowed[key]) {
      throw new Error('Gemini take has unsupported PCM parameters');
    }
    parameters.add(key);
  }
  if (!['audio/l16', 'audio/pcm'].includes(type) || !parameters.has('rate')) {
    throw new Error('Gemini take must declare PCM at 24000 Hz');
  }
  const pcm = Buffer.from(audio[0].data, 'base64');
  if (pcm.toString('base64') !== audio[0].data || !pcm.length || pcm.length % 2 || pcm.length > MAX_TIP_PCM_BYTES) {
    throw new Error('Gemini take contains malformed PCM');
  }
  return pcm;
}

export async function generateSpeechPcm({ apiKey, profile, script, context }) {
  const exactTourV8 = profile === 'tip-v11-fr';
  const voiceName = exactTourV8 ? TIP_V11_VOICE_NAME : VOICE_NAME;
  const prompt = voicePrompt(tipV11SpokenScript(script, profile), context, profile);
  const { GoogleGenAI } = exactTourV8 ? await import('@google/genai-ngor-v8') : await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey, ...(exactTourV8 && { httpOptions: { ...TIP_V11_VOICE_HTTP_OPTIONS } }) });
  const response = await ai.models.generateContent({
    model: PRIMARY_MODEL,
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });
  if (exactTourV8) return decodeTipVoice(response);
  const part = response?.candidates?.[0]?.content?.parts?.[0];
  const inline = part?.inlineData;
  if (!inline?.data) {
    throw new Error('Gemini response did not include audio inlineData');
  }
  return Buffer.from(inline.data, 'base64');
}

async function main() {
  const args = parseArgs(process.argv);
  const { id, title, script } = args;
  const profile = args.profile ?? '';
  if (profile && profile !== 'tip-v11-fr') abort('Unknown voice profile');
  const voiceName = profile === 'tip-v11-fr' ? TIP_V11_VOICE_NAME : VOICE_NAME;

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id ?? '')) abort('Invalid --id flag (e.g. --id video-001)');
  if (!script) abort('Missing --script flag (the exact French voice-over text)');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    abort(
      'GEMINI_API_KEY env var is not set. Export it from your shell or set it in your GitHub Actions secret. Never paste the key on the command line.',
    );
  }

  let pcm;
  try {
    console.log(`▶ ${id} — calling ${PRIMARY_MODEL} (${voiceName})${title ? ` for "${title}"` : ''}`);
    pcm = await generateSpeechPcm({ apiKey, profile, script, context: args.context });
  } catch (primaryErr) {
    const status = primaryErr?.status;
    // Never silently switch narrator models halfway through a video.
    abort(`Consistent narrator unavailable (${PRIMARY_MODEL})${Number.isInteger(status) ? ` (HTTP ${status})` : ''}`);
  }

  const wav = pcmToWav(pcm);
  const outDir = resolve(ROOT, 'public/audio/voiceovers');
  await mkdir(outDir, { recursive: true });
  const wavPath = resolve(outDir, `${id}.wav`);
  const hashPath = resolve(outDir, `${id}.sha256`);
  const hash = voiceCacheHash(tipV11SpokenScript(script, profile), args.context, profile);

  await writeFile(wavPath, wav);
  await writeFile(hashPath, `${hash}\n`);

  const seconds = (pcm.length / (SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8))).toFixed(1);
  console.log(`✓ ${id} — wrote ${wavPath} (${(wav.length / 1024).toFixed(1)} KB, ~${seconds}s)`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((err) => {
    console.error('Unexpected error:', err?.message ?? err);
    process.exit(1);
  });
}
