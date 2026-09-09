import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { allocateSceneFrames, assertSceneVoiceFits, pcmWavDuration, sceneVoiceSpecs } from './scene-voice.mjs';
import { voiceCacheHash, voicePrompt } from './voice-profile.mjs';

function wav(seconds) {
  const size = Math.round(seconds * 48000);
  const bytes = Buffer.alloc(44 + size);
  bytes.write('RIFF'); bytes.writeUInt32LE(36 + size, 4);
  bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(size, 40);
  return bytes;
}

test('voices preserve the exact text displayed in each scene and have separate cache keys', () => {
  const spec = { id: 'tip-debbc55c-8da4-4c74-a336-d0fc838ec04a', title: 'Compteurs',
    scenes: Array.from({ length: 5 }, (_, i) => ({ voiceoverFr: `Phrase ${i}.` })) };
  const voices = sceneVoiceSpecs(spec);
  assert.equal(new Set(voices.map(v => v.id)).size, 5);
  assert.deepEqual(voices.map(v => v.voiceoverScript), spec.scenes.map(s => s.voiceoverFr));
  assert.ok(voices.every(v => v.narrationContext === spec.scenes.map(s => s.voiceoverFr).join(' ')));
  assert.throws(() => sceneVoiceSpecs({ ...spec, scenes: [] }));
  assert.throws(() => sceneVoiceSpecs({ ...spec, id: '../invalid' }));
  assert.throws(() => sceneVoiceSpecs({ ...spec, scenes: Array(5).fill({}) }));
});

test('narrator cache includes the shared profile and context, with no per-scene model fallback', async () => {
  assert.equal(voiceCacheHash('Bonjour.'), voiceCacheHash('Bonjour.'));
  assert.notEqual(voiceCacheHash('Bonjour.'), voiceCacheHash('Bonsoir.'));
  assert.notEqual(voiceCacheHash('Bonjour.'), voiceCacheHash('Bonjour.', 'Contexte.'));
  assert.match(voicePrompt('Bonjour.', 'Contexte.'), /continuity only \(do not read\)/);
  const generator = await readFile(new URL('./generate-gemini-voiceover.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(generator, /FALLBACK_MODEL/);
  assert.match(generator, /voiceCacheHash\(script, args.context\)/);
});

test('audio must fit before its caption disappears, with a 100ms tail', () => {
  assert.equal(pcmWavDuration(wav(3)), 3);
  assert.equal(assertSceneVoiceFits(wav(6.4), 0), 6.4);
  assert.throws(() => assertSceneVoiceFits(wav(6.401), 0), /shorten/);
  for (let i = 1; i < 5; i++) {
    assert.equal(assertSceneVoiceFits(wav(5.9), i), 5.9);
    assert.throws(() => assertSceneVoiceFits(wav(5.901), i), /shorten/);
  }
  assert.throws(() => assertSceneVoiceFits(wav(1), 5));
});

test('corrupt, empty and truncated WAVs fail closed', () => {
  assert.throws(() => pcmWavDuration(Buffer.alloc(0)));
  assert.throws(() => pcmWavDuration(wav(0)));
  assert.throws(() => pcmWavDuration(wav(1).subarray(0, 100)));
  for (const offset of [0, 8, 12, 16, 20, 22, 24, 28, 32, 34, 36, 40]) {
    const broken = wav(1); broken[offset] ^= 1;
    assert.throws(() => pcmWavDuration(broken), `offset ${offset}`);
  }
});

test('measured voice redistributes scenes without altering the 45-second video', () => {
  for (const durations of [[4.8, 6.0, 6.1, 2, 6], [1, 1, 1, 1, 1], [6, 6, 6, 5, 6]]) {
    const frames = allocateSceneFrames(durations);
    assert.equal(frames.reduce((a,b) => a+b, 0), 915);
    frames.forEach((n, i) => assert.ok(n >= Math.ceil(durations[i] * 30) + 6));
    assert.equal(75 + frames.reduce((a,b) => a+b, 0) + 360, 1350);
  }
  assert.throws(() => allocateSceneFrames([10,10,10,10,10]), /budget/);
  assert.throws(() => allocateSceneFrames([1,2,3,4,NaN]), /valid/);
  assert.throws(() => allocateSceneFrames([1,2]), /Five/);
});

test('dispatch rendering validates scene audio and uses the same scene sequence as captions', async () => {
  const renderer = await readFile(new URL('./render-batch.mjs', import.meta.url), 'utf8');
  const composition = await readFile(new URL('../src/compositions/JammShort.tsx', import.meta.url), 'utf8');
  assert.match(renderer, /sceneVoices: Boolean\(specFile\)/);
  assert.ok(renderer.includes('sceneFrames = allocateSceneFrames(durations)'));
  assert.ok(renderer.indexOf('sceneFrames = allocateSceneFrames(durations)') < renderer.indexOf('const propsJson'));
  assert.match(composition, /sceneFrames\[segment.sceneIndex\]/);
  assert.match(composition, /<Scene spec=\{sceneSpec\}[^]*?showVoice && sceneVoices[^]*?sceneIndex \+ 1[^]*?<\/Sequence>/);
  assert.match(composition, /showVoice && !sceneVoices/);
});
