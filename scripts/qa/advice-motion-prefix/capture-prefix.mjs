import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyGraphicsLaunch, verifiedSwiftShader, verifySwiftShaderFiles } from './capture-graphics.mjs';
import { prepareSmokeInput, sha256 } from './prepare-smoke-input.mjs';
import settings from './prefix-settings.cjs';

const { sourceSha, frameCount, concurrency, divergent, controls, pairedFrames } = settings;
const here = dirname(fileURLToPath(import.meta.url));
const browserHash = '47e823e3a14b431ffa8dc88f97db6a854cd92e04800c01fc765c16a18d393d72';
const assetHash = 'bdfe127c1e7896f14b4d02bbb5d8dae08b583e4769b273c0af14387805e0225c';
const encoderHash = '358964462a020c645825bd27f9ec0bdd9ce27e0d0c49d8c1f57c96cd9d1dc2b2';
const hashFile = path => sha256(readFileSync(path));

export function prefixRenderOptions(root, scratch, output, browser) {
  return {
    args: [
      '--require', join(here, 'capture-motion-preload.cjs'), '--require', join(here, 'capture-prefix-preload.cjs'),
      join(root, 'node_modules/.bin/remotion'), 'render', 'src/index.ts', 'TipV11Fr', join(scratch, 'prefix.mp4'),
      `--props=${join(root, 'out/batch/tip-00000000-0000-4000-8000-000000000019.props.json')}`,
      '--config=remotion.tip-v11.config.ts', '--codec=h264', '--audio-codec=aac',
      '--image-format=jpeg', `--concurrency=${concurrency}`, '--log=error', `--frames=0-${frameCount - 1}`,
      `--browser-executable=${browser}`,
    ],
    env: { ...process.env, JAMM_OFFLINE_MOTION_BROWSER: browser,
      JAMM_OFFLINE_MOTION_FRAMES: String(frameCount), JAMM_OFFLINE_MOTION_TRACE: join(output, 'trace.json'),
      JAMM_OFFLINE_PREFIX_OUTPUT: output },
  };
}

export function validatePrefixEvidence(output, motion, page) {
  assert.equal(motion.browserLaunches.length, 1);
  verifyGraphicsLaunch(motion.browserLaunches[0]);
  assert.equal(motion.browsers.length, 1);
  const [{ start, afterFinalCapture: last }] = motion.browsers;
  assert.deepEqual(verifiedSwiftShader(start), verifiedSwiftShader(last.backend));
  assert.equal(last.capturedFrames, frameCount);
  assert.deepEqual(motion.frames[last.frame], [last.frame, last.sha256]);
  assert.equal(motion.encoders.length, 1);
  assert.equal(motion.encoders[0].sha256, encoderHash);
  assert.equal(motion.encoders[0].x264Params, 'open-gop=0:keyint=90:scenecut=0');
  const sequence = Array.from({ length: frameCount }, (_, frame) => frame);
  assert.deepEqual(motion.frames.map(([frame]) => frame), sequence);
  assert.deepEqual(page.frames.map(({ frame }) => frame), sequence);
  assert.ok(motion.frames.every(([, hash]) => /^[a-f0-9]{64}$/u.test(hash)));
  assert.deepEqual(page.pairs.map(({ frame }) => frame), pairedFrames);
  for (const pair of page.pairs) {
    assert.equal(pair.jpegSha256, motion.frames[pair.frame][1]);
    assert.equal(pair.jpegSha256, hashFile(join(output, `${pair.frame}.jpg`)));
    assert.equal(pair.pngSha256, hashFile(join(output, `${pair.frame}.png`)));
  }
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

  const scratch = mkdtempSync(join(tmpdir(), 'jamm-v11-prefix-render-'));
  try {
    const { root, input } = await prepareSmokeInput(repository, scratch);
    assert.equal(input.durationInFrames, 1818);
    assert.equal(input.propsSha256IgnoringGeometryRunId, 'c60d4d5ef446fa3046bdde5ddcaa663796a12cd9439b1c862831c663be50b04a');
    assert.equal(input.alignmentSha256, '06bde2c18db05bedee13972f93299633727c0788e6f867e7a18c913591a675ec');
    mkdirSync(output, { mode: 0o700 });
    const { args, env } = prefixRenderOptions(root, scratch, output, browser);
    execFileSync(process.execPath, args, { cwd: root, env, timeout: 210_000, maxBuffer: 1024 * 1024 });
    const motion = JSON.parse(readFileSync(join(output, 'trace.json')));
    const page = JSON.parse(readFileSync(join(output, 'page-trace.json')));
    validatePrefixEvidence(output, motion, page);
    assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '');
    const receipt = { schema: 'jamm-v11-swangle-prefix-v1', syntheticOnly: true, publishable: false,
      sourceSha, assetHash, browserHash, graphicsFiles, frames: frameCount, concurrency, divergent, controls, input,
      prefixMp4Sha256: hashFile(join(scratch, 'prefix.mp4')),
      motionTraceSha256: hashFile(join(output, 'trace.json')), pageTraceSha256: hashFile(join(output, 'page-trace.json')) };
    writeFileSync(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main(process.argv.slice(2));
}
