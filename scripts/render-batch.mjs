#!/usr/bin/env node
// Orchestrator: for one video id (or 'all'), ensure its voice-over WAV is
// fresh (regenerate via Gemini if the script hash changed), then invoke
// `remotion render` to produce out/batch/<id>.mp4.
//
// Usage:
//   npm run render:batch -- --id video-001
//   npm run render:batch -- --id all

// Run me with `tsx scripts/render-batch.mjs` (not plain `node`) so the
// dynamic import of src/data/videos.ts gets transpiled on the fly.

import { spawn } from 'node:child_process';
import { voiceCacheHash } from './voice-profile.mjs';
import { existsSync } from 'node:fs';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { continuousSceneFrames, sceneVoiceSpecs } from './scene-voice.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const VOICEOVER_DIR = resolve(ROOT, 'public/audio/voiceovers');
const OUT_DIR = resolve(ROOT, 'out/batch');
const ENTRY = 'src/index.ts';
const COMPOSITION = 'JammShort';

function parseArgs(argv) {
  const out = { _flags: new Set() };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      // Treat as boolean flag if no value follows, or the next token is another --flag
      if (next === undefined || next.startsWith('--')) {
        out._flags.add(key);
      } else {
        out[key] = next;
        i += 1;
      }
    }
  }
  return out;
}

function runStreaming(cmd, args, env = process.env) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env, cwd: ROOT });
    child.on('exit', (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`${cmd} exited with code ${code}`));
    });
    child.on('error', rejectP);
  });
}

async function ensureVoiceover(spec) {
  await mkdir(VOICEOVER_DIR, { recursive: true });
  const wavPath = resolve(VOICEOVER_DIR, `${spec.id}.wav`);
  const hashPath = resolve(VOICEOVER_DIR, `${spec.id}.sha256`);
  const expected = voiceCacheHash(spec.voiceoverScript, spec.narrationContext);

  let cached = false;
  if (existsSync(wavPath) && existsSync(hashPath)) {
    const stored = (await readFile(hashPath, 'utf8')).trim();
    if (stored === expected) cached = true;
  }

  if (cached) {
    console.log(`▸ ${spec.id} — voice-over cache hit (script unchanged)`);
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      `${spec.id} needs a fresh voice-over (script changed or no cache) but GEMINI_API_KEY is not set. Export it from your shell or, in CI, set it as a repository secret.`,
    );
  }

  console.log(`▸ ${spec.id} — regenerating voice-over via Gemini`);
  await runStreaming('node', [
    'scripts/generate-gemini-voiceover.mjs',
    '--id', spec.id,
    '--title', spec.title,
    '--script', spec.voiceoverScript,
    ...(spec.narrationContext ? ['--context', spec.narrationContext] : []),
  ]);
}

async function resolveAudioMode({ noAudio, voiceOnly }) {
  if (noAudio) return 'silent';
  if (voiceOnly) return 'voice-only';

  // Default = 'full'. If the sourate asset isn't ready, automatically degrade
  // to voice-only so the render still completes with the spoken track.
  const audioModule = await import('../src/data/audio-config.ts');
  const { SURA_FILE, SURA_ORIGINAL_DURATION_SEC } = audioModule;
  const suraPath = resolve(ROOT, 'public', SURA_FILE);
  if (!(SURA_ORIGINAL_DURATION_SEC > 0) || !existsSync(suraPath)) {
    console.log('▸ sourate not ready (file missing or SURA_ORIGINAL_DURATION_SEC=0) — degrading to voice-only');
    return 'voice-only';
  }
  return 'full';
}

async function renderOne(spec, { noAudio, voiceOnly, sceneVoices }) {
  await mkdir(OUT_DIR, { recursive: true });

  const audioMode = await resolveAudioMode({ noAudio, voiceOnly });
  let sceneFrames;
  if (audioMode === 'silent') {
    console.log(`▸ ${spec.id} — silent render, skipping Gemini TTS`);
  } else if (sceneVoices) {
    const exactScript = sceneVoiceSpecs(spec).map(s => s.voiceoverScript).join(' ');
    if (spec.voiceoverScript !== exactScript) throw new Error('Continuous narration does not match the caption script');
    await ensureVoiceover(spec);
    sceneFrames = continuousSceneFrames(await readFile(resolve(VOICEOVER_DIR, `${spec.id}.wav`)));
  } else {
    await ensureVoiceover(spec);
  }

  const propsJson = JSON.stringify({ spec, audioMode, sceneFrames, continuousVoice: sceneVoices && audioMode !== 'silent' });
  const outFile = resolve(OUT_DIR, `${spec.id}.mp4`);

  console.log(`▶ ${spec.id} — remotion render (audio: ${audioMode}) → ${outFile}`);
  await runStreaming('npx', [
    'remotion',
    'render',
    ENTRY,
    COMPOSITION,
    outFile,
    `--props=${propsJson}`,
  ]);

  const s = await stat(outFile);
  console.log(`✓ ${spec.id} — ${(s.size / (1024 * 1024)).toFixed(2)} MB (audio: ${audioMode})`);
}

async function main() {
  const args = parseArgs(process.argv);
  const specFile = args['spec-file'];
  const id = args.id;
  const noAudio = args._flags.has('no-audio');
  const voiceOnly = args._flags.has('voice-only');

  if (!id && !specFile) {
    console.error('Usage: npm run render:batch -- (--id <video-001..video-010|all> | --spec-file <json>) [--no-audio | --voice-only]');
    process.exit(1);
  }

  const { VIDEOS } = await import('../src/data/videos.ts');
  let targets;
  if (specFile) {
    const specPath = resolve(ROOT, specFile);
    const parsed = JSON.parse(await readFile(specPath, 'utf8'));
    targets = [parsed];
  } else {
    targets = id === 'all' ? VIDEOS : VIDEOS.filter((v) => v.id === id);
  }
  if (targets.length === 0) {
    console.error(`Unknown video id: ${id}. Known: ${VIDEOS.map((v) => v.id).join(', ')}`);
    process.exit(1);
  }

  for (const spec of targets) {
    await renderOne(spec, { noAudio, voiceOnly, sceneVoices: Boolean(specFile) });
  }

  console.log(`✓ render-batch complete (${targets.length} video${targets.length > 1 ? 's' : ''})`);
}

main().catch((err) => {
  console.error('✖', err?.message ?? err);
  process.exit(1);
});
