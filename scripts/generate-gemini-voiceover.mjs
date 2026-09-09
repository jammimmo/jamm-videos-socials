#!/usr/bin/env node
// Generate a French voice-over WAV for a single JAMM IMMO short video using
// Google Gemini TTS (Charon voice). The API key is read ONLY from
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
//   public/audio/voiceovers/<id>.sha256   (hash of the input script, for cache invalidation)

import { GoogleGenAI } from '@google/genai';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

import { VOICE_NAME, PRIMARY_MODEL, voiceCacheHash, voicePrompt } from './voice-profile.mjs';

// Gemini TTS returns raw little-endian 16-bit PCM mono at 24000 Hz.
const SAMPLE_RATE = 24000;
const NUM_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

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
function pcmToWav(pcm) {
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

async function callGemini(ai, modelName, prompt) {
  const response = await ai.models.generateContent({
    model: modelName,
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: VOICE_NAME },
        },
      },
    },
  });
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

  if (!id) abort('Missing --id flag (e.g. --id video-001)');
  if (!script) abort('Missing --script flag (the exact French voice-over text)');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    abort(
      'GEMINI_API_KEY env var is not set. Export it from your shell or set it in your GitHub Actions secret. Never paste the key on the command line.',
    );
  }

  const prompt = voicePrompt(script, args.context);
  const ai = new GoogleGenAI({ apiKey });

  let pcm;
  try {
    console.log(`▶ ${id} — calling ${PRIMARY_MODEL} (Charon)${title ? ` for "${title}"` : ''}`);
    pcm = await callGemini(ai, PRIMARY_MODEL, prompt);
  } catch (primaryErr) {
    const msg = primaryErr?.message ?? String(primaryErr);
    // Never silently switch narrator models halfway through a video.
    abort(`Consistent narrator unavailable (${PRIMARY_MODEL}): ${msg.split('\n')[0]}`);
  }

  const wav = pcmToWav(pcm);
  const outDir = resolve(ROOT, 'public/audio/voiceovers');
  await mkdir(outDir, { recursive: true });
  const wavPath = resolve(outDir, `${id}.wav`);
  const hashPath = resolve(outDir, `${id}.sha256`);
  const hash = voiceCacheHash(script, args.context);

  await writeFile(wavPath, wav);
  await writeFile(hashPath, `${hash}\n`);

  const seconds = (pcm.length / (SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8))).toFixed(1);
  console.log(`✓ ${id} — wrote ${wavPath} (${(wav.length / 1024).toFixed(1)} KB, ~${seconds}s)`);
}

main().catch((err) => {
  console.error('Unexpected error:', err?.message ?? err);
  process.exit(1);
});
