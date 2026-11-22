import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { allocateSceneFrames, assertSceneVoiceFits, pcmWavDuration, sceneVoiceSpecs, continuousSceneFrames } from './scene-voice.mjs';
import { generateSpeechPcm, tipV11SpokenScript } from './generate-gemini-voiceover.mjs';
import { buildTipV11Narration } from './tip-v11-contract.mjs';
import { TIP_V11_VOICE_HTTP_OPTIONS, TIP_V11_VOICE_SDK_VERSION, voiceCacheHash, voicePrompt } from './voice-profile.mjs';

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
  assert.match(generator, /voiceCacheHash\(tipV11SpokenScript\(script, profile\), args.context, profile\)/);
});

test('automatic advice sends one Dakar voice request with the mixed-language opening through the pinned SDK', async t => {
  const profile = 'tip-v11-fr';
  const sentence = 'Vérifiez chaque document avant de réserver votre prochaine visite immobilière à Dakar.';
  const script = buildTipV11Narration({
    id: 'tip-debbc55c-8da4-4c74-a336-d0fc838ec04a', title: 'Vérifier les documents', body: Array(5).fill(sentence),
  }).script;
  const spokenScript = tipV11SpokenScript(script, profile);
  const prompt = voicePrompt(spokenScript, '', profile);
  const [direction, passage] = prompt.split('\n\n');
  assert.equal(passage, spokenScript);
  assert.match(direction, /Speak the French passage with a distinctly pronounced Senegalese accent from Dakar/u);
  assert.match(direction, /Speak the Arabic and Wolof greetings in that order, exactly as written/u);
  assert.match(direction, /Finish both before the French advice starts and keep the same voice/u);
  assert.doesNotMatch(direction, /Bonjour|Salam alikoum|Nanga def/u);
  assert.match(script, /Suivez aussi Jamm Immo sur nos réseaux sociaux/u);
  assert.doesNotMatch(script, /Suivez aussi, Jamm Immo, sur nos réseaux sociaux/u);
  assert.match(spokenScript, /Suivez aussi, Jamm Immo, sur nos réseaux sociaux/u);
  assert.notEqual(voiceCacheHash(script, '', profile), voiceCacheHash(spokenScript, '', profile));
  const normalized = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[a-z0-9]+/gu);
  assert.deepEqual(normalized(spokenScript), normalized(script));
  assert.equal(tipV11SpokenScript(script, ''), script);
  assert.equal(tipV11SpokenScript(`${script} Texte après la fermeture.`, profile), `${script} Texte après la fermeture.`);
  assert.equal(tipV11SpokenScript(`${script} ${script}`, profile), `${script} ${script}`);
  assert.equal(tipV11SpokenScript('Suivez aussi Jamm Immo sur nos réseaux sociaux pour retrouver nos prochains conseils.', profile),
    'Suivez aussi Jamm Immo sur nos réseaux sociaux pour retrouver nos prochains conseils.');
  const tourDirection = voicePrompt(`Bonjour. ${spokenScript}`, '', profile).split('\n\n')[0];
  assert.equal(createHash('sha256').update(tourDirection).digest('hex'),
    'f3f015c3bcf53b58162a94fd357fc612b774897de352586cfce3509afe033265');
  const previousAdviceCacheKey = createHash('sha256').update(JSON.stringify({
    version: 2, model: 'gemini-3.1-flash-tts-preview', voice: 'Algenib', sdk: '2.8.0',
    prompt: `${tourDirection}\n\n${spokenScript}`,
  })).digest('hex');
  assert.notEqual(voiceCacheHash(spokenScript, '', profile), previousAdviceCacheKey);
  assert.throws(() => voicePrompt(script, 'Consigne supplémentaire.', profile), /additional context/);
  assert.deepEqual(TIP_V11_VOICE_HTTP_OPTIONS, { timeout: 240_000 });
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(lock.packages['node_modules/@google/genai-ngor-v8'].version, TIP_V11_VOICE_SDK_VERSION);
  assert.equal(TIP_V11_VOICE_SDK_VERSION, '2.8.0');
  assert.equal(lock.packages['node_modules/@google/genai'].version, '1.0.0');

  const part = { data: 'AQI=', mimeType: 'audio/L16;rate=24000' };
  let providerStatus = 200;
  const request = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent');
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.contents, [{ parts: [{ text: prompt }] }]);
    assert.deepEqual(body.generationConfig, {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Algenib' } } },
    });
    return providerStatus === 200
      ? Response.json({ candidates: [{ content: { parts: [{ inlineData: part }] } }] })
      : Response.json({ error: { code: 503, status: 'UNAVAILABLE' } }, { status: providerStatus });
  });
  const input = { apiKey: 'fixture-key', profile, script };
  assert.deepEqual(await generateSpeechPcm(input), Buffer.from([1, 2]));
  assert.equal(request.mock.callCount(), 1);
  part.mimeType = 'audio/L16;rate=16000';
  await assert.rejects(generateSpeechPcm(input), /PCM parameters/);
  assert.equal(request.mock.callCount(), 2);
  part.mimeType = 'audio/L16;rate=24000';
  part.data = 'AQI';
  await assert.rejects(generateSpeechPcm(input), /malformed PCM/);
  assert.equal(request.mock.callCount(), 3);
  providerStatus = 503;
  await assert.rejects(generateSpeechPcm(input), { status: 503 });
  assert.equal(request.mock.callCount(), 4);
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
  assert.ok(renderer.includes('scripts/align-narration.py'));
  assert.ok(renderer.indexOf('scripts/align-narration.py') < renderer.indexOf('const propsJson'));
  assert.doesNotMatch(renderer, /await ensureVoiceover\(scene\)/);
  assert.match(renderer, /continuousVoice: sceneVoices/);
  assert.match(composition, /sceneFrames\[segment.sceneIndex\]/);
  assert.match(composition, /<Scene spec=\{sceneSpec\}[^]*?showVoice && sceneVoices[^]*?sceneIndex \+ 1[^]*?<\/Sequence>/);
  assert.match(composition, /showVoice && !sceneVoices/);
  assert.match(composition, /showVoice && continuousVoice[^]*?<Sequence from=\{75\} durationInFrames=\{915\}>[^]*?<Audio src=\{voiceSrc\}/);
});

function narration(pauses = [3, 7, 11, 15]) {
  const bytes = wav(20);
  for (let i = 0; i < 20 * 24000; i++) {
    const t = i / 24000;
    const quiet = t < .2 || t >= 19.8 || pauses.some(p => t >= p && t < p + .5);
    bytes.writeInt16LE(quiet ? 0 : (i % 2 ? 4000 : -4000), 44 + i * 2);
  }
  return bytes;
}

test('one continuous take aligns captions at measured pauses without stretching the voice', () => {
  assert.deepEqual(continuousSceneFrames(narration()), [98, 120, 120, 120, 457]);
  assert.throws(() => continuousSceneFrames(narration([3, 7, 11])), /expected 4/);
  assert.throws(() => continuousSceneFrames(narration([3, 5, 7, 11, 15])), /expected 4/);
  assert.throws(() => continuousSceneFrames(narration([.5, 7, 11, 15])), /shorter/);
  assert.throws(() => continuousSceneFrames(wav(20)), /expected 4/);
  assert.throws(() => continuousSceneFrames(wav(31)), /budget/);
});
