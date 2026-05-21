#!/usr/bin/env node
// Validates that every input the JammShort render pipeline depends on is
// present and well-formed BEFORE a render kicks off. Designed to fail fast
// in CI so a broken spec doesn't burn 5+ minutes of render time per video.

// Run me with `tsx scripts/content-build.mjs` (not plain `node`) so that the
// dynamic imports of .ts files in src/data/ are transpiled on the fly.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const errors = [];
const warnings = [];

function err(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

async function main() {
  console.log('▶ content:build — validating short-video specs and assets');

  // 1. Videos
  const { VIDEOS } = await import('../src/data/videos.ts');
  const { SCENE_VISUAL_TYPES } = await import('../src/data/scene-visual-types.ts');

  if (!Array.isArray(VIDEOS) || VIDEOS.length !== 10) {
    err(`Expected exactly 10 VIDEOS, got ${VIDEOS?.length ?? '?'}.`);
  }

  const seenIds = new Set();
  VIDEOS.forEach((v, i) => {
    const tag = `video[${i}] (${v?.id ?? '?'})`;
    if (!v.id) err(`${tag}: missing id`);
    if (seenIds.has(v.id)) err(`${tag}: duplicate id`);
    seenIds.add(v.id);
    if (!v.title) err(`${tag}: missing title`);
    if (!v.hook?.title) err(`${tag}: missing hook.title (FR)`);
    if (!v.hook?.titleEn) err(`${tag}: missing hook.titleEn (EN)`);
    if (!v.hook?.subline) err(`${tag}: missing hook.subline (FR)`);
    if (!v.hook?.sublineEn) err(`${tag}: missing hook.sublineEn (EN)`);
    if (!Array.isArray(v.hook?.cards) || v.hook.cards.length === 0) {
      err(`${tag}: hook.cards must be a non-empty array`);
    }
    if (!Array.isArray(v.scenes) || v.scenes.length !== 5) {
      err(`${tag}: expected exactly 5 scenes, got ${v.scenes?.length ?? '?'}`);
    } else {
      v.scenes.forEach((s, si) => {
        if (!s.subtitle) err(`${tag} scene[${si}]: missing subtitle (FR)`);
        if (!s.subtitleEn) err(`${tag} scene[${si}]: missing subtitleEn (EN)`);
        if (!s.voiceoverFr) err(`${tag} scene[${si}]: missing voiceoverFr (spoken FR sentence)`);
        if (!s.voiceoverEn) err(`${tag} scene[${si}]: missing voiceoverEn (EN translation of the spoken sentence)`);
        if (!s.visualType) err(`${tag} scene[${si}]: missing visualType`);
        else if (!SCENE_VISUAL_TYPES.includes(s.visualType)) {
          err(`${tag} scene[${si}]: unknown visualType "${s.visualType}" (allowed: ${SCENE_VISUAL_TYPES.join(', ')})`);
        }
        if (s.photoBg) {
          const photoPath = resolve(ROOT, 'public', s.photoBg);
          if (!existsSync(photoPath)) {
            warn(`${tag} scene[${si}]: photoBg "${s.photoBg}" not found (will fall back to brand gradient)`);
          }
        }
      });
    }
    if (!v.voiceoverScript || v.voiceoverScript.trim().length < 40) {
      err(`${tag}: voiceoverScript is empty or suspiciously short`);
    }
  });

  // 2. Audio config
  const { SURA_ORIGINAL_DURATION_SEC, SURA_FILE } = await import('../src/data/audio-config.ts');
  if (!(SURA_ORIGINAL_DURATION_SEC > 0)) {
    err(
      'src/data/audio-config.ts → SURA_ORIGINAL_DURATION_SEC is 0. Drop the sourate file at public/audio/sura-minshawi-102.ogg and set its real duration (use `ffprobe -i <file>` or any audio player).',
    );
  }
  const suraPath = resolve(ROOT, 'public', SURA_FILE);
  if (!existsSync(suraPath)) {
    err(`Sourate audio missing: expected ${suraPath}`);
  }

  // 3. Required directories
  const voiceoversDir = resolve(ROOT, 'public/audio/voiceovers');
  if (!existsSync(voiceoversDir)) {
    warn(`Voiceovers directory will be auto-created on first run: ${voiceoversDir}`);
  }

  // 4. Report
  if (warnings.length > 0) {
    console.warn(`⚠ ${warnings.length} warning(s):`);
    warnings.forEach((w) => console.warn(`  · ${w}`));
  }
  if (errors.length > 0) {
    console.error(`✖ ${errors.length} error(s):`);
    errors.forEach((e) => console.error(`  · ${e}`));
    process.exit(1);
  }

  console.log(`✓ content:build passed (${VIDEOS.length} videos validated)`);
}

main().catch((err) => {
  console.error('✖', err?.message ?? err);
  process.exit(1);
});
