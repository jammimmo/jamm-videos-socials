import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildTipV11Narration, TIP_V11_TEMPLATE } from './tip-v11-contract.mjs';
import { voiceCacheHash } from './voice-profile.mjs';
import { tipV11Effects } from './tip-v11-effects.mjs';
import { buildTipV11RenderManifest, collectTipV11StaticFiles } from './tip-v11-render-manifest.mjs';
import { geometryArtifactDirectory } from '../src/compositions/tip-v11-caption-geometry.ts';
import { summarizeCaptionGeometry } from './tip-v11-caption-geometry.mjs';
import { isReviewedPcm, NORMALIZED_NARRATION_PROCESSING, readStagedPrivateReviewedNarration, reviewedPcmData, stageReviewedNarration } from './tip-v11-reviewed-narration.mjs';

const MIN_NARRATION_SECONDS = 58.5;
const MAX_NARRATION_SECONDS = 119;
const DEFAULT_TEMPO = 1.03;
const TEMPO_HEADROOM_SECONDS = 0.25;
// Alignment checks the total trailing silence, including silence in the take.
const MAX_TAIL_PADDING_SECONDS = 2.5;
const PCM_SAMPLE_RATE = 24_000;

class TipNarrationDurationError extends Error {}

function run(command, args, cwd, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} failed (${code})`)));
  });
}

async function getNarration(root, audioDir, plan) {
  const raw = resolve(audioDir, `${plan.id}.wav`);
  const hashPath = resolve(audioDir, `${plan.id}.sha256`);
  const expected = voiceCacheHash(plan.script, '', TIP_V11_TEMPLATE);
  try {
    if ((await readFile(hashPath, 'utf8')).trim() === expected && (await stat(raw)).size > 44) {
      return { path: raw, source: 'cache' };
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await run(process.execPath, ['scripts/generate-gemini-voiceover.mjs', '--profile', TIP_V11_TEMPLATE,
    '--id', plan.id, '--script', plan.script], root);
  return { path: raw, source: 'provider' };
}

function narrationDuration(path) {
  return Number(execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', path,
  ], { encoding: 'utf8', timeout: 20_000 }).trim());
}

export function tipV11NarrationTempo(rawSeconds, { exactTourV8 = false } = {}) {
  // atempo works in blocks. Decide the actual deficit from the normalized PCM.
  const minRawSeconds = exactTourV8 ? MIN_NARRATION_SECONDS - MAX_TAIL_PADDING_SECONDS : MIN_NARRATION_SECONDS;
  if (!Number.isFinite(rawSeconds) || rawSeconds < minRawSeconds
    || rawSeconds > MAX_NARRATION_SECONDS * DEFAULT_TEMPO) {
    throw new TipNarrationDurationError(`V11 raw narration cannot fit without stretching or truncation (${rawSeconds.toFixed(3)} s)`);
  }
  // The normalizer checks the measured duration after applying the Ngor tempo.
  // Imported and local sources may retain natural timing near the lower bound.
  return exactTourV8 || rawSeconds / DEFAULT_TEMPO >= MIN_NARRATION_SECONDS + TEMPO_HEADROOM_SECONDS
    ? DEFAULT_TEMPO
    : 1;
}

export function padShortNgorNarration(wav) {
  const data = reviewedPcmData(wav);
  if (!data) throw new TipNarrationDurationError('Invalid normalized Ngor PCM');
  const samples = data.length / 2;
  const missing = MIN_NARRATION_SECONDS * PCM_SAMPLE_RATE - samples;
  if (missing <= 0 || missing > MAX_TAIL_PADDING_SECONDS * PCM_SAMPLE_RATE) {
    return { wav, normalizedSeconds: samples / PCM_SAMPLE_RATE, paddingSamples: 0 };
  }
  const end = data.offset + data.length;
  const padded = Buffer.concat([wav.subarray(0, end), Buffer.alloc(missing * 2), wav.subarray(end)]);
  padded.writeUInt32LE(padded.length - 8, 4);
  padded.writeUInt32LE(data.length + missing * 2, data.offset - 4);
  return { wav: padded, normalizedSeconds: MIN_NARRATION_SECONDS, paddingSamples: missing };
}

export async function normalizeTipV11Narration(root, raw, normalizedPath, options) {
  const rawSeconds = narrationDuration(raw);
  if (options?.alreadyNormalized === true) {
    const bytes = await readFile(raw);
    if (bytes.length > 8 * 1024 * 1024 || !isReviewedPcm(bytes) || !Number.isFinite(rawSeconds)
      || rawSeconds < MIN_NARRATION_SECONDS || rawSeconds > MAX_NARRATION_SECONDS) {
      throw new TipNarrationDurationError('Invalid normalized source narration');
    }
    await writeFile(normalizedPath, bytes, { mode: 0o600 });
    return { rawSeconds, normalizedSeconds: rawSeconds, tempo: 1, processing: NORMALIZED_NARRATION_PROCESSING };
  }
  const tempo = tipV11NarrationTempo(rawSeconds, options);
  const normalize = 'loudnorm=I=-16:TP=-1.5:LRA=11';
  const filters = tempo === 1 ? normalize : `atempo=${tempo},${normalize}`;
  await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', raw, '-map', '0:a:0',
    '-af', filters, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', normalizedPath], root);
  let normalizedSeconds;
  let paddingSamples = 0;
  if (options?.exactTourV8) {
    const measured = padShortNgorNarration(await readFile(normalizedPath));
    normalizedSeconds = measured.normalizedSeconds;
    paddingSamples = measured.paddingSamples;
    if (paddingSamples) {
      const temporary = `${normalizedPath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, measured.wav, { flag: 'wx', mode: 0o600 });
        await rename(temporary, normalizedPath);
      } finally {
        await rm(temporary, { force: true });
      }
    }
  } else {
    normalizedSeconds = narrationDuration(normalizedPath);
  }
  if (!Number.isFinite(normalizedSeconds) || normalizedSeconds < MIN_NARRATION_SECONDS
    || normalizedSeconds > MAX_NARRATION_SECONDS) {
    throw new TipNarrationDurationError(`V11 normalized narration outside 58.5–119 s (${normalizedSeconds.toFixed(3)} s; raw ${rawSeconds.toFixed(3)} s; tempo ${tempo}×)`);
  }
  console.log(`V11 narration measured: ${rawSeconds.toFixed(3)} s raw, ${normalizedSeconds.toFixed(3)} s normalized, tempo ${tempo}×, ${paddingSamples} tail padding samples`);
  return { rawSeconds, normalizedSeconds, tempo, ...(paddingSamples > 0 && { paddingSamples }) };
}

export async function renderTipV11(spec, {
  root, assistantEnabled = false, localNarration, localWordTimings, fixtureDiagnosticPath,
} = {}) {
  if (!root) throw new Error('Renderer root is required');
  if (localWordTimings && !localNarration) throw new Error('Local word timings require local narration');
  if (fixtureDiagnosticPath && (!localNarration || !localWordTimings
    || process.env.OFFLINE_SMOKE_NETWORK_ISOLATED !== '1')) {
    throw new Error('Picture diagnostics require the isolated synthetic fixture');
  }
  if (spec.reviewedNarration && (localNarration || assistantEnabled)) throw new Error('Reviewed V11 narration requires the approved standard scenes');
  const plan = buildTipV11Narration(spec, { assistantEnabled });
  const outDir = resolve(root, 'out/batch');
  const audioDir = resolve(root, 'public/audio/voiceovers');
  const specPath = resolve(outDir, `${plan.id}.spec.json`);
  const alignPath = resolve(outDir, `${plan.id}.alignment.json`);
  const propsPath = resolve(outDir, `${plan.id}.props.json`);
  const manifestPath = resolve(outDir, `${plan.id}.manifest.json`);
  const outFile = resolve(outDir, `${plan.id}.mp4`);
  const normalized = `audio/voiceovers/${plan.id}-v11.wav`;
  await Promise.all([mkdir(outDir, { recursive: true }), mkdir(audioDir, { recursive: true })]);
  await rm(manifestPath, { force: true });
  const inventory = await collectTipV11StaticFiles(root).catch(() => null);
  let narration;
  if (spec.reviewedNarration?.source === 'private-attempt') {
    narration = await readStagedPrivateReviewedNarration(spec.reviewedNarration, process.env);
  } else if (spec.reviewedNarration) {
    narration = await stageReviewedNarration(root, resolve(audioDir, `${plan.id}.wav`),
      spec.reviewedNarration, process.env.GITHUB_SHA);
  } else if (localNarration) {
    narration = { path: resolve(localNarration), source: 'fixture' };
  } else {
    narration = await getNarration(root, audioDir, plan);
  }
  const raw = narration.path;
  const normalizedPath = resolve(root, 'public', normalized);
  if (raw === normalizedPath) throw new Error('Narration input must differ from processed output');
  const failureCodePath = process.env.TIP_V11_ALIGNMENT_FAILURE_CODE_FILE;
  const exactTourV8 = narration.source === 'provider' || narration.source === 'cache';
  try {
    await normalizeTipV11Narration(root, raw, normalizedPath, { exactTourV8, alreadyNormalized: narration.alreadyNormalized === true });
  } catch (error) {
    if (exactTourV8 && error instanceof TipNarrationDurationError && failureCodePath) {
      await writeFile(failureCodePath, 'narration_duration_out_of_range\n', { mode: 0o600, flag: 'wx' });
    }
    throw error;
  }
  await writeFile(specPath, JSON.stringify(plan), { mode: 0o600 });
  await run('python3', ['scripts/align_tip_v11.py', '--wav', normalizedPath,
    '--spec', specPath, '--output', alignPath,
    '--defer-domain-to-final',
    ...(localWordTimings ? ['--transcript', resolve(localWordTimings)] : []),
    ...(failureCodePath ? ['--failure-code-file', failureCodePath] : [])], root);
  const alignment = JSON.parse(await readFile(alignPath, 'utf8'));
  const effectsPath = resolve(audioDir, `${plan.id}-v11-fx.wav`);
  const mixed = `audio/voiceovers/${plan.id}-v11-mix.wav`;
  await writeFile(effectsPath, tipV11Effects(alignment.segments, alignment.durationInFrames));
  await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', normalizedPath, '-i', effectsPath,
    '-filter_complex', 'amix=inputs=2:duration=longest:normalize=0', '-c:a', 'pcm_s16le', resolve(root, 'public', mixed)], root);
  const captionGeometryRunId = randomUUID();
  const geometryDirectory = resolve(root, 'out/TipV11Fr', geometryArtifactDirectory(captionGeometryRunId));
  const props = {
    captionGeometryRunId,
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
  let captionGeometry;
  try {
    const cli = resolve(root, 'node_modules/.bin/remotion');
    const diagnosticArgs = fixtureDiagnosticPath ? [
      '--require', resolve(root, 'scripts/trace-tip-picture-fixture.cjs'), cli,
    ] : [];
    await run(fixtureDiagnosticPath ? process.execPath : cli, [
      ...diagnosticArgs,
      'render', 'src/index.ts', 'TipV11Fr', outFile, `--props=${propsPath}`,
      '--config=remotion.tip-v11.config.ts', '--codec=h264', '--audio-codec=aac',
      '--image-format=jpeg', '--concurrency=3', '--log=error',
    ], root, fixtureDiagnosticPath ? {
      ...process.env, TIP_FIXTURE_DIAGNOSTIC_PATH: fixtureDiagnosticPath,
    } : undefined);
    captionGeometry = await summarizeCaptionGeometry(props, geometryDirectory);
  } finally {
    await rm(geometryDirectory, { recursive: true, force: true }).catch(() => {
      console.warn('V11 caption geometry scratch cleanup unavailable');
    });
  }
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
    'format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate', '-of', 'json', outFile],
  { encoding: 'utf8', timeout: 20_000 }));
  const video = probe.streams.find(stream => stream.codec_type === 'video');
  const audio = probe.streams.find(stream => stream.codec_type === 'audio');
  const seconds = Number(probe.format.duration);
  if (!(seconds > 60 && seconds <= 120) || Math.abs(seconds - props.durationInFrames / 30) > .12
    || video?.width !== 1080 || video.height !== 1920 || video.r_frame_rate !== '30/1'
    || video.codec_name !== 'h264' || audio?.codec_name !== 'aac' || !(Number(probe.format.size) <= 50 * 1024 * 1024)) {
    throw new Error('V11 output does not match the vertical master contract');
  }
  try {
    if (!inventory || (await collectTipV11StaticFiles(root)).sha256 !== inventory.sha256) {
      throw new Error('V11 static inputs changed during the render');
    }
    const manifest = await buildTipV11RenderManifest({
      plan, sourceScriptSha256: spec.sourceScriptSha256, voiceSource: narration.source, inventory, raw, captionGeometry,
      normalized: normalizedPath, mix: resolve(root, 'public', mixed), alignment: alignPath, props: propsPath, mp4: outFile,
      reviewedNarrationSha256: spec.reviewedNarration?.sha256,
    });
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, { flag: 'wx', mode: 0o600 });
  } catch {
    console.warn('V11 render manifest unavailable; editorial review required');
  }
  await writeFile(resolve(outDir, `${plan.id}.media.json`), JSON.stringify({
    duration: seconds, durationHeader: Math.ceil(seconds), width: video.width, height: video.height,
    template: TIP_V11_TEMPLATE, reviewRequired: true,
  }));
  console.log(`✓ ${plan.id} — V11 FR 1080×1920 · ${seconds.toFixed(2)} s · revue requise`);
  return outFile;
}
