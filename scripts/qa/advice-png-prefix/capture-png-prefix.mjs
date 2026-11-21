import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyGraphicsLaunch, verifiedSwiftShader, verifySwiftShaderFiles } from './capture-graphics.mjs';
import { prepareSmokeInput, sha256 } from './prepare-smoke-input.mjs';
import { decodedTipFrameHashes } from './tip-decoded-frame-hashes.mjs';

const sourceSha = '33d46b8c8ff4862846c9ad92464172ede055a546';
const browserHash = '47e823e3a14b431ffa8dc88f97db6a854cd92e04800c01fc765c16a18d393d72';
const assetHash = 'bdfe127c1e7896f14b4d02bbb5d8dae08b583e4769b273c0af14387805e0225c';
const encoderHash = '358964462a020c645825bd27f9ec0bdd9ce27e0d0c49d8c1f57c96cd9d1dc2b2';
const frameCount = 132;
const expectedFrames = Array.from({ length: frameCount }, (_, frame) => frame);
const digest = /^[a-f0-9]{64}$/u;
const here = dirname(fileURLToPath(import.meta.url));
const hashFile = path => sha256(readFileSync(path));

export function pngPrefixOptions(root, movie, output, browser) {
  return {
    args: ['--require', join(here, 'capture-motion-preload.cjs'),
      join(root, 'node_modules/.bin/remotion'), 'render', 'src/index.ts', 'TipV11Fr', movie,
      `--props=${join(root, 'out/batch/tip-00000000-0000-4000-8000-000000000019.props.json')}`,
      '--config=remotion.tip-v11.config.ts', '--codec=h264', '--audio-codec=aac', '--image-format=png',
      '--concurrency=1', '--log=error', '--frames=0-131', `--browser-executable=${browser}`],
    env: { ...process.env, JAMM_OFFLINE_MOTION_BROWSER: browser,
      JAMM_OFFLINE_MOTION_FRAMES: String(frameCount), JAMM_OFFLINE_MOTION_TRACE: join(output, 'trace.json') },
  };
}

export function validatePngPrefixEvidence(trace, media) {
  assert.equal(trace.browserLaunches.length, 1);
  verifyGraphicsLaunch(trace.browserLaunches[0]);
  assert.equal(trace.browsers.length, 1);
  const [{ start, afterFinalCapture: last }] = trace.browsers;
  assert.deepEqual(verifiedSwiftShader(start), verifiedSwiftShader(last.backend));
  assert.equal(last.capturedFrames, frameCount);
  assert.deepEqual(trace.frames[last.frame], [last.frame, last.sha256]);
  assert.equal(trace.encoders.length, 1);
  const [encoder] = trace.encoders;
  assert.equal(encoder.sha256, encoderHash);
  assert.equal(encoder.x264Params, 'open-gop=0:keyint=90:scenecut=0');
  assert.deepEqual(encoder.imageInput, { demuxer: 'image2pipe', decoder: 'png', source: '-' });
  assert.deepEqual(trace.frames.map(([frame]) => frame), expectedFrames);
  assert.deepEqual(trace.pngColorTypes.map(([frame]) => frame), expectedFrames);
  assert.ok(trace.frames.every(([, hash]) => digest.test(hash)));
  assert.ok(trace.pngColorTypes.every(([, type]) => [2, 6].includes(type)));
  assert.equal(media.videoFormat, 'h264-1080x1920-30fps');
  assert.equal(media.audioFormat, 'aac-48000-stereo');
  assert.deepEqual(media.decodedFrames.map(({ frame }) => frame), expectedFrames);
  assert.ok(media.decodedFrames.every(({ sha256: hash }) => digest.test(hash)));
  for (const value of [media.decodedAudioSha256, media.decodedVideoSha256, media.mp4Sha256]) assert.match(value, digest);
}

async function main([repository, output, browser, ...rest]) {
  assert.ok(!rest.length && [repository, output, browser].every(path => path && isAbsolute(path)));
  assert.deepEqual([process.platform, process.arch, process.version], ['linux', 'x64', 'v22.20.0']);
  assert.equal(process.env.OFFLINE_SMOKE_NETWORK_ISOLATED, '1');
  assert.equal(Object.values(networkInterfaces()).flat().filter(address => address && !address.internal).length, 0);
  assert.deepEqual(Object.keys(process.env).filter(name => /GEMINI_.*KEY|TOKEN|TIP_.*URL|TIP_.*FILE|PROXY|NODE_OPTIONS|JAMM_OFFLINE/iu.test(name)), []);
  const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', timeout: 10_000 }).trim();
  assert.equal(git('rev-parse', 'HEAD'), sourceSha);
  assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '');
  assert.equal(hashFile(browser), browserHash);
  const graphicsFiles = verifySwiftShaderFiles(browser);
  const { collectTipV11StaticFiles } = await import(join(repository, 'scripts/tip-v11-render-manifest.mjs'));
  assert.equal((await collectTipV11StaticFiles(repository)).sha256, assetHash);
  const lock = JSON.parse(readFileSync(join(repository, 'scripts/tip-runtime-lock.json')));
  const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 10_000 }).trim();
  assert.equal(run('npm', ['--version']), lock.npm);
  assert.equal(run('python3', ['--version']), `Python ${lock.python}`);
  for (const tool of ['ffmpeg', 'ffprobe']) assert.equal(hashFile(run('which', [tool])), lock[`${tool}Sha256`]);
  assert.equal(run(browser, ['--version']), 'Chromium 149.0.7790.0');
  assert.equal(JSON.parse(readFileSync(join(repository, 'node_modules/@remotion/renderer/package.json'))).version, '4.0.464');

  const scratch = mkdtempSync(join(tmpdir(), 'jamm-v11-png-prefix-render-'));
  try {
    const { root, input } = await prepareSmokeInput(repository, scratch);
    assert.equal(input.durationInFrames, 1818);
    assert.equal(input.propsSha256IgnoringGeometryRunId, 'c60d4d5ef446fa3046bdde5ddcaa663796a12cd9439b1c862831c663be50b04a');
    assert.equal(input.alignmentSha256, '06bde2c18db05bedee13972f93299633727c0788e6f867e7a18c913591a675ec');
    mkdirSync(output, { mode: 0o700 });
    const movie = join(scratch, 'png-prefix.mp4');
    const { args, env } = pngPrefixOptions(root, movie, output, browser);
    const started = performance.now();
    execFileSync(process.execPath, args, { cwd: root, env, timeout: 210_000, maxBuffer: 1024 * 1024 });
    const elapsedMs = Math.round(performance.now() - started);
    const streamInfo = JSON.parse(run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file', '-show_entries',
      'stream=codec_name,codec_type,width,height,r_frame_rate,sample_rate,channels', '-of', 'json', movie])).streams;
    const video = streamInfo.find(stream => stream.codec_type === 'video');
    const audio = streamInfo.find(stream => stream.codec_type === 'audio');
    assert.deepEqual([video.codec_name, video.width, video.height, video.r_frame_rate], ['h264', 1080, 1920, '30/1']);
    assert.deepEqual([audio.codec_name, audio.sample_rate, audio.channels], ['aac', '48000', 2]);
    const { decodedTipMediaFingerprints } = await import(join(repository, 'scripts/tip-decoded-media-fingerprint.mjs'));
    const media = { mp4Sha256: hashFile(movie), ...decodedTipMediaFingerprints(movie),
      decodedFrames: decodedTipFrameHashes(movie, frameCount, video.width, video.height),
      videoFormat: 'h264-1080x1920-30fps', audioFormat: 'aac-48000-stereo' };
    const mediaPath = join(output, 'media-unvalidated.json');
    writeFileSync(mediaPath, JSON.stringify(media, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    const tracePath = join(output, 'trace.json');
    validatePngPrefixEvidence(JSON.parse(readFileSync(tracePath)), media);
    assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '');
    const receipt = { schema: 'jamm-v11-swangle-png-prefix-v1', syntheticOnly: true, publishable: false,
      sourceSha, treeSha: git('rev-parse', 'HEAD^{tree}'), assetHash, browserHash, graphicsFiles, frames: frameCount,
      concurrency: 1, format: 'png', input, elapsedMs, traceSha256: hashFile(tracePath), mediaSha256: hashFile(mediaPath) };
    writeFileSync(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main(process.argv.slice(2));
}
