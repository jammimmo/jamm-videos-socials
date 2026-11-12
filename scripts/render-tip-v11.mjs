import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildTipV11Narration, TIP_V11_TEMPLATE } from './tip-v11-contract.mjs';
import { voiceCacheHash } from './voice-profile.mjs';
import { tipV11Effects } from './tip-v11-effects.mjs';

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} failed (${code})`)));
  });
}

async function getNarration(root, audioDir, plan) {
  const raw = resolve(audioDir, `${plan.id}.wav`);
  const hashPath = resolve(audioDir, `${plan.id}.sha256`);
  const expected = voiceCacheHash(plan.script, '', TIP_V11_TEMPLATE);
  try {
    if ((await readFile(hashPath, 'utf8')).trim() === expected && (await stat(raw)).size > 44) return raw;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await run(process.execPath, ['scripts/generate-gemini-voiceover.mjs', '--profile', TIP_V11_TEMPLATE,
    '--id', plan.id, '--script', plan.script], root);
  return raw;
}

export async function renderTipV11(spec, {
  root, assistantEnabled = false, localNarration, localWordTimings,
} = {}) {
  if (!root) throw new Error('Renderer root is required');
  if (localWordTimings && !localNarration) throw new Error('Local word timings require local narration');
  const plan = buildTipV11Narration(spec, { assistantEnabled });
  const outDir = resolve(root, 'out/batch');
  const audioDir = resolve(root, 'public/audio/voiceovers');
  const specPath = resolve(outDir, `${plan.id}.spec.json`);
  const alignPath = resolve(outDir, `${plan.id}.alignment.json`);
  const propsPath = resolve(outDir, `${plan.id}.props.json`);
  const outFile = resolve(outDir, `${plan.id}.mp4`);
  const normalized = `audio/voiceovers/${plan.id}-v11.wav`;
  await Promise.all([mkdir(outDir, { recursive: true }), mkdir(audioDir, { recursive: true })]);
  const raw = localNarration ? resolve(localNarration) : await getNarration(root, audioDir, plan);
  const normalizedPath = resolve(root, 'public', normalized);
  if (raw === normalizedPath) throw new Error('Narration input must differ from processed output');
  await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', raw, '-map', '0:a:0',
    '-af', 'atempo=1.03,loudnorm=I=-16:TP=-1.5:LRA=11',
    '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', normalizedPath], root);
  await writeFile(specPath, JSON.stringify(plan), { mode: 0o600 });
  await run('python3', ['scripts/align_tip_v11.py', '--wav', normalizedPath,
    '--spec', specPath, '--output', alignPath,
    ...(localWordTimings ? ['--transcript', resolve(localWordTimings)] : [])], root);
  const alignment = JSON.parse(await readFile(alignPath, 'utf8'));
  const effectsPath = resolve(audioDir, `${plan.id}-v11-fx.wav`);
  const mixed = `audio/voiceovers/${plan.id}-v11-mix.wav`;
  await writeFile(effectsPath, tipV11Effects(alignment.segments, alignment.durationInFrames));
  await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', normalizedPath, '-i', effectsPath,
    '-filter_complex', 'amix=inputs=2:duration=longest:normalize=0', '-c:a', 'pcm_s16le', resolve(root, 'public', mixed)], root);
  const props = {
    title: plan.title,
    segments: alignment.segments,
    captions: alignment.captions,
    audio: mixed,
    durationInFrames: alignment.durationInFrames,
    assistantEnabled: plan.assistantEnabled,
    visualTopic: plan.visualTopic,
    phoneGroups: alignment.phoneGroups,
  };
  await writeFile(propsPath, JSON.stringify(props), { mode: 0o600 });
  await run(resolve(root, 'node_modules/.bin/remotion'), [
    'render', 'src/index.ts', 'TipV11Fr', outFile, `--props=${propsPath}`,
    '--codec=h264', '--audio-codec=aac', '--image-format=jpeg', '--concurrency=3', '--log=error',
  ], root);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
    'format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate', '-of', 'json', outFile],
  { encoding: 'utf8', timeout: 20_000 }));
  const video = probe.streams.find(stream => stream.codec_type === 'video');
  const audio = probe.streams.find(stream => stream.codec_type === 'audio');
  const seconds = Number(probe.format.duration);
  if (!(seconds > 60 && seconds <= 120) || Math.abs(seconds - props.durationInFrames / 30) > .12
    || video?.width !== 1080 || video.height !== 1920 || video.r_frame_rate !== '30/1'
    || video.codec_name !== 'h264' || audio?.codec_name !== 'aac' || !(Number(probe.format.size) <= 100 * 1024 * 1024)) {
    throw new Error('V11 output does not match the vertical master contract');
  }
  await writeFile(resolve(outDir, `${plan.id}.media.json`), JSON.stringify({
    duration: seconds, durationHeader: Math.ceil(seconds), width: video.width, height: video.height,
    template: TIP_V11_TEMPLATE, reviewRequired: true,
  }));
  console.log(`✓ ${plan.id} — V11 FR 1080×1920 · ${seconds.toFixed(2)} s · revue requise`);
  return outFile;
}
