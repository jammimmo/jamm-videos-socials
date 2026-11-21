import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifiedSwiftShader, verifyGraphicsLaunch, verifySwiftShaderFiles } from './capture-graphics.mjs';

const sourceSha = '33d46b8c8ff4862846c9ad92464172ede055a546';
const baselineSha = '482a390db547fca0734cb7ebc52363e5a6a07d54';
const officialBrowserSha = '47e823e3a14b431ffa8dc88f97db6a854cd92e04800c01fc765c16a18d393d72';
const bundledEncoderSha = '358964462a020c645825bd27f9ec0bdd9ce27e0d0c49d8c1f57c96cd9d1dc2b2';
const expectedAssetManifest = 'bdfe127c1e7896f14b4d02bbb5d8dae08b583e4769b273c0af14387805e0225c';
const frames = 1818;
const sha256 = /^[a-f0-9]{64}$/u;
const hashFile = path => createHash('sha256').update(readFileSync(path)).digest('hex');

export function validateMotionEvidence(fixture, trace) {
  assert.equal(fixture.status, 'passed');
  assert.equal(fixture.scope, 'non-publishable-offline-remotion-smoke');
  assert.equal(fixture.renderer, 'TipV11Fr');
  assert.equal(fixture.voiceSource, 'fixture');
  assert.equal(fixture.alignment, 'local-word-timings');
  assert.equal(fixture.retainedArtifact, false);
  assert.equal(fixture.destinationLayouts, undefined);
  assert.deepEqual([fixture.duration, fixture.width, fixture.height, fixture.captionGeometry],
    [60.650667, 1080, 1920, 'matched']);
  assert.deepEqual([fixture.closedGopKeyframes, fixture.closedGopSeconds], [21, 3]);
  for (const name of ['decodedVideoSha256', 'decodedAudioSha256', 'mediaSha256']) assert.match(fixture[name], sha256);

  assert.equal(trace.browserLaunches.length, 1);
  verifyGraphicsLaunch(trace.browserLaunches[0]);
  assert.equal(trace.browsers.length, 1);
  const [{ start, beforeClose }] = trace.browsers;
  assert.deepEqual(verifiedSwiftShader(start), verifiedSwiftShader(beforeClose));
  assert.equal(trace.encoders.length, 1);
  const [encoder] = trace.encoders;
  assert.equal(encoder.sha256, bundledEncoderSha);
  assert.equal(encoder.x264Params, 'open-gop=0:keyint=90:scenecut=0');
  assert.equal(trace.frames.length, frames);
  for (let frame = 0; frame < frames; frame += 1) {
    const [number, digest] = trace.frames[frame];
    assert.equal(number, frame);
    assert.match(digest, sha256);
  }
}

async function captureMotion([repository, output, browserExecutable, ...rest]) {
  assert.ok(!rest.length && [repository, output, browserExecutable].every(path => path && isAbsolute(path)));
  assert.deepEqual([process.platform, process.arch, process.version], ['linux', 'x64', 'v22.20.0']);
  assert.equal(process.env.OFFLINE_SMOKE_NETWORK_ISOLATED, '1');
  assert.equal(Object.values(networkInterfaces()).flat().filter(address => address && !address.internal).length, 0);
  assert.deepEqual(Object.keys(process.env).filter(name => /GEMINI_.*KEY|TOKEN|TIP_.*URL|TIP_.*FILE|PROXY|NODE_OPTIONS/iu.test(name)), []);
  const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', timeout: 10_000 }).trim();
  assert.equal(git('rev-parse', 'HEAD'), sourceSha);
  assert.equal(git('rev-parse', 'HEAD^'), baselineSha);
  assert.equal(git('diff', '--name-only', baselineSha, sourceSha), 'remotion.tip-v11.config.ts');
  assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '');
  assert.equal(hashFile(browserExecutable), officialBrowserSha);
  const graphicsFiles = verifySwiftShaderFiles(browserExecutable);
  const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 10_000 }).trim();
  const lock = JSON.parse(readFileSync(join(repository, 'scripts/tip-runtime-lock.json')));
  assert.equal(run('npm', ['--version']), lock.npm);
  assert.equal(run('python3', ['--version']), `Python ${lock.python}`);
  for (const tool of ['ffmpeg', 'ffprobe']) assert.equal(hashFile(run('which', [tool])), lock[`${tool}Sha256`]);
  assert.equal(run(browserExecutable, ['--version']), 'Chromium 149.0.7790.0');
  const remotion = JSON.parse(readFileSync(join(repository, 'node_modules/@remotion/renderer/package.json')));
  assert.equal(remotion.version, '4.0.464');

  mkdirSync(output, { mode: 0o700 });
  const preload = join(dirname(fileURLToPath(import.meta.url)), 'capture-motion-preload.cjs');
  assert.doesNotMatch(preload, /\s/u);
  const tracePath = join(output, 'trace.json');
  const start = performance.now();
  const fixtureOutput = execFileSync(process.execPath, ['scripts/offline-tip-v11-smoke.mjs'], {
    cwd: repository, encoding: 'utf8', timeout: 600_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: `--require=${preload}`, JAMM_OFFLINE_MOTION_TRACE: tracePath,
      JAMM_OFFLINE_MOTION_BROWSER: browserExecutable },
  });
  const fixture = JSON.parse(fixtureOutput.trim().split('\n').at(-1));
  const trace = JSON.parse(readFileSync(tracePath));
  validateMotionEvidence(fixture, trace);

  const manifestModule = join(repository, 'scripts/tip-v11-render-manifest.mjs');
  const { collectTipV11StaticFiles } = await import(manifestModule);
  const assetManifest = await collectTipV11StaticFiles(repository);
  assert.equal(assetManifest.sha256, expectedAssetManifest);
  assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '');
  const receipt = { schema: 'jamm-v11-swangle-master-motion-v1', syntheticOnly: true, publishable: false,
    sourceSha, baselineSha, treeSha: git('rev-parse', 'HEAD^{tree}'), assetManifestSha256: assetManifest.sha256,
    browser: { executableSha256: officialBrowserSha, graphicsFiles, version: '149.0.7790.0' },
    runtime: { remotion: remotion.version, node: process.version, npm: lock.npm, python: lock.python,
      ffmpegSha256: lock.ffmpegSha256, ffprobeSha256: lock.ffprobeSha256 },
    elapsedMs: Math.round(performance.now() - start), fixture, traceSha256: hashFile(tracePath) };
  writeFileSync(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await captureMotion(process.argv.slice(2));
}
