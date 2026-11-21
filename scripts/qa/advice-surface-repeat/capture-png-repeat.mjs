import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import childProcess, { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { identifyChromeLaunch, verifyGraphicsLaunch, verifiedSwiftShader, verifySwiftShaderFiles } from '../advice-png-prefix/capture-graphics.mjs';
import { prepareSmokeInput, sha256 } from '../advice-png-prefix/prepare-smoke-input.mjs';

const sourceSha = '33d46b8c8ff4862846c9ad92464172ede055a546';
const browserSha = '47e823e3a14b431ffa8dc88f97db6a854cd92e04800c01fc765c16a18d393d72';
const assetSha = 'bdfe127c1e7896f14b4d02bbb5d8dae08b583e4769b273c0af14387805e0225c';
const cutBoundary = [43, 44];
const ranges = [[0, 0], [10, 10], [32, 33], cutBoundary, [77, 77], [120, 120], [131, 131]];
const selected = ranges.flatMap(([first, last]) =>
  Array.from({ length: last - first + 1 }, (_, index) => first + index));
const width = 1080;
const height = 1920;
const rgbaBytes = width * height * 4;
const decimalMs = value => Math.round(value * 10) / 10;
const hashFile = path => sha256(readFileSync(path));

function visualState() {
  const docs = [document, ...Array.from(document.querySelectorAll('iframe'),
    frame => frame.contentDocument).filter(Boolean)];
  return docs.map(doc => {
    const view = doc.defaultView;
    return {
      ready: view.remotion_renderReady ?? null,
      fontStatus: doc.fonts.status,
      fonts: Array.from(doc.fonts, font => [font.family, font.status, font.weight]),
      dpr: view.devicePixelRatio,
      regions: Array.from(doc.querySelectorAll('[data-fit-region]'), node => {
        const rect = node.getBoundingClientRect();
        const style = view.getComputedStyle(node);
        return [node.getAttribute('data-fit-region'), node.textContent,
          rect.x, rect.y, rect.width, rect.height, style.font, style.opacity, style.transform];
      }),
      drawing: Array.from(doc.querySelectorAll('svg path[stroke-dasharray],svg g[transform]'),
        node => [node.getAttribute('transform'), node.getAttribute('stroke-dasharray')]),
      images: Array.from(doc.images, image => [image.complete, image.naturalWidth, image.naturalHeight]),
    };
  });
}

async function readValue(send, client, expression) {
  const { value } = await send.call(client, 'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true });
  assert.ok(value?.result && !value.exceptionDetails, 'Could not observe page state');
  return value.result.value;
}

function validatePng(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length <= 8 * 1024 * 1024);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20), bytes[24], bytes[28]],
    [width, height, 8, 0]);
  assert.ok([2, 6].includes(bytes[25]));
}

export function decodePng(ffmpeg, bytes) {
  validatePng(bytes);
  const decoded = spawnSync(ffmpeg, ['-hide_banner', '-v', 'error', '-f', 'image2pipe',
    '-protocol_whitelist', 'pipe', '-c:v', 'png', '-threads', '1', '-i', 'pipe:0',
    '-frames:v', '1', '-pix_fmt', 'rgba', '-threads', '1', '-f', 'rawvideo', 'pipe:1'],
  { input: bytes, maxBuffer: rgbaBytes + 32_768, timeout: 5_000 });
  assert.ifError(decoded.error);
  assert.equal(decoded.status, 0, decoded.stderr.toString());
  assert.equal(decoded.stdout.length, rgbaBytes);
  return decoded.stdout;
}

export function captureSummary(ffmpeg, observations) {
  const decoded = observations.captures.map(capture => decodePng(ffmpeg, capture.png));
  const captureNotices = ['native', 'immediateRepeat', 'afterTwoAnimationFrames'];
  function againstFirst(index) {
    let changedPixels = 0;
    for (let offset = 0; offset < rgbaBytes; offset += 4) {
      if (decoded[0].readUInt32LE(offset) !== decoded[index].readUInt32LE(offset)) changedPixels++;
    }
    return changedPixels;
  }
  const { before, after } = observations.domSha256;
  return {
    frame: observations.frame,
    domUnchanged: before === after,
    domSha256: { before, after },
    animationWaitMs: observations.animationWaitMs,
    browserAnimationPeriodMs: observations.browserAnimationPeriodMs,
    captures: observations.captures.map(({ png, elapsedMs }, index) => ({
      mode: captureNotices[index],
      elapsedMs,
      pngSha256: sha256(png),
      rgbaSha256: sha256(decoded[index]),
      changedPixelsAgainstNative: index > 0 ? againstFirst(index) : 0,
    })),
  };
}

export async function observeFrames({ root, browser, props, bundlePath, readGraphics }) {
  const load = createRequire(join(root, 'package.json'));
  const rendererPath = dirname(load.resolve('@remotion/renderer'));
  const screenshotModule = load(join(rendererPath, 'screenshot-task.js'));
  const frameModule = load(join(rendererPath, 'render-frame-with-option-to-reject.js'));
  const nativeFrame = frameModule.renderFrameWithOptionToReject;
  const nativeScreenshot = screenshotModule.screenshotTask;
  const frameContext = new AsyncLocalStorage();
  const observations = new Map();
  const browserLaunches = [];
  const nativeSpawn = childProcess.spawn;
  childProcess.spawn = function (executable, args, options) {
    const requested = identifyChromeLaunch(executable, args);
    if (requested) {
      assert.equal(realpathSync(requested.browserExecutable), realpathSync(browser));
      verifyGraphicsLaunch(requested.browserArgs);
    }
    const child = nativeSpawn.call(this, executable, args, options);
    if (requested) {
      const [actualExecutable, ...actualArgs] = child.spawnargs;
      const actual = identifyChromeLaunch(actualExecutable, actualArgs);
      assert.equal(actual?.launcher, requested.launcher);
      assert.equal(realpathSync(actual.browserExecutable), realpathSync(browser));
      verifyGraphicsLaunch(actual.browserArgs);
      browserLaunches.push(actual.launcher);
    }
    return child;
  };
  frameModule.renderFrameWithOptionToReject = function (options) {
    return frameContext.run(options.frame, () => nativeFrame.call(this, options));
  };
  screenshotModule.screenshotTask = async function (options) {
    const frame = frameContext.getStore();
    if (frame == null) return nativeScreenshot.call(this, options);
    assert.ok(selected.includes(frame) && !observations.has(frame));
    const client = options.page._client();
    const send = client.send;
    client.send = async function (name, params, ...rest) {
      if (name !== 'Page.captureScreenshot') return send.call(this, name, params, ...rest);
      assert.ok(!observations.has(frame));
      assert.deepEqual([params.fromSurface, params.captureBeyondViewport, params.format], [true, true, 'png']);
      assert.deepEqual(params.clip, { x: 0, y: 0, height, scale: 1, width });
      const snapshot = '(' + visualState.toString() + ')()';
      const before = await readValue(send, this, snapshot);
      assert.ok(before.some(doc => doc.regions.length > 0 && doc.fontStatus === 'loaded'));
      const take = async () => {
        const started = performance.now();
        const response = await send.call(this, name, params, ...rest);
        const elapsedMs = decimalMs(performance.now() - started);
        const png = Buffer.from(response.value.data, 'base64');
        validatePng(png);
        return { response, png, elapsedMs };
      };
      const captures = [await take(), await take()];
      const waitStarted = performance.now();
      const browserAnimationPeriodMs = await readValue(send, this,
        'new Promise(resolve => requestAnimationFrame(first => requestAnimationFrame(second => resolve(second - first))))');
      assert.ok(Number.isFinite(browserAnimationPeriodMs) && browserAnimationPeriodMs >= 0);
      const animationWaitMs = decimalMs(performance.now() - waitStarted);
      captures.push(await take());
      const after = await readValue(send, this, snapshot);
      observations.set(frame, {
        frame, animationWaitMs, browserAnimationPeriodMs,
        domSha256: { before: sha256(JSON.stringify(before)), after: sha256(JSON.stringify(after)) },
        captures: captures.map(({ png, elapsedMs }) => ({ png, elapsedMs })),
      });
      return captures[0].response;
    };
    try {
      return await nativeScreenshot.call(this, options);
    } finally {
      client.send = send;
    }
  };

  let browserHandle;
  try {
    const { bundle } = load('@remotion/bundler');
    const { openBrowser, renderFrames, selectComposition } = load('@remotion/renderer');
    const serveUrl = await bundle({
      entryPoint: join(root, 'src/index.ts'), outDir: bundlePath, enableCaching: false,
    });
    browserHandle = await openBrowser('chrome', {
      browserExecutable: browser, chromiumOptions: { gl: 'swangle' }, logLevel: 'error',
    });
    assert.equal(browserLaunches.length, 1);
    const start = await readGraphics(browserHandle);
    const common = {
      puppeteerInstance: browserHandle, serveUrl, inputProps: props,
      logLevel: 'error', timeoutInMilliseconds: 15_000,
    };
    const composition = await selectComposition({ ...common, id: 'TipV11Fr' });
    assert.deepEqual([composition.width, composition.height, composition.fps], [width, height, 30]);
    for (const frameRange of ranges) {
      await renderFrames({
        ...common, composition, outputDir: null, muted: true, concurrency: 1, imageFormat: 'png',
        frameRange, onStart: () => {}, onFrameUpdate: () => {}, onFrameBuffer: () => {},
      });
    }
    assert.deepEqual([...observations.keys()], selected);
    const end = await readGraphics(browserHandle);
    assert.deepEqual(end, start);
    return { observations: [...observations.values()], graphics: { launchedWith: browserLaunches[0], start, end } };
  } finally {
    try {
      if (browserHandle) await browserHandle.close({ silent: true });
    } finally {
      frameModule.renderFrameWithOptionToReject = nativeFrame;
      screenshotModule.screenshotTask = nativeScreenshot;
      childProcess.spawn = nativeSpawn;
    }
  }
}

async function readLinuxGraphics(browser) {
  const { value: { gpu } } = await browser.connection.send('SystemInfo.getInfo');
  assert.ok(gpu?.devices?.length && gpu.auxAttributes);
  assert.equal(gpu.auxAttributes.processCrashCount, 0);
  return verifiedSwiftShader(gpu.auxAttributes);
}

async function main([repository, output, browser, ...rest]) {
  assert.ok(!rest.length && [repository, output, browser].every(path => path && isAbsolute(path)));
  assert.deepEqual([process.platform, process.arch, process.version], ['linux', 'x64', 'v22.20.0']);
  assert.equal(process.env.OFFLINE_SMOKE_NETWORK_ISOLATED, '1');
  assert.deepEqual(Object.keys(process.env).filter(name =>
    /GEMINI_.*KEY|TOKEN|TIP_.*URL|TIP_.*FILE|PROXY|NODE_OPTIONS|DISABLE_FROM_SURFACE|JAMM_OFFLINE/iu.test(name)), []);
  assert.equal(Object.values(networkInterfaces()).flat().filter(address => address && !address.internal).length, 0);
  const run = (command, args) => execFileSync(command, args, { cwd: repository, encoding: 'utf8', timeout: 10_000 }).trim();
  const git = (...args) => run('git', args);
  assert.equal(git('rev-parse', 'HEAD'), sourceSha);
  assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '');
  assert.equal(hashFile(browser), browserSha);
  assert.equal(run(browser, ['--version']), 'Chromium 149.0.7790.0');
  const graphicsFiles = verifySwiftShaderFiles(browser);
  const { collectTipV11StaticFiles } = await import(pathToFileURL(join(repository, 'scripts/tip-v11-render-manifest.mjs')));
  assert.equal((await collectTipV11StaticFiles(repository)).sha256, assetSha);
  const runtime = JSON.parse(readFileSync(join(repository, 'scripts/tip-runtime-lock.json')));
  assert.equal(run('npm', ['--version']), runtime.npm);
  assert.equal(run('python3', ['--version']), 'Python ' + runtime.python);
  const ffmpeg = run('which', ['ffmpeg']);
  assert.equal(hashFile(ffmpeg), runtime.ffmpegSha256);
  assert.equal(hashFile(run('which', ['ffprobe'])), runtime.ffprobeSha256);
  const remotion = JSON.parse(readFileSync(join(repository, 'node_modules/@remotion/renderer/package.json'))).version;
  assert.equal(remotion, '4.0.464');
  const scratch = mkdtempSync(join(tmpdir(), 'jamm-v11-repeat-render-'));
  const cwd = process.cwd();
  try {
    const { root, props, input } = await prepareSmokeInput(repository, scratch);
    assert.equal(input.durationInFrames, 1818);
    assert.ok(props.segments[0].end > cutBoundary[0] / 30 && props.segments[0].end <= cutBoundary[1] / 30);
    assert.equal(props.segments[1].start, props.segments[0].end);
    assert.equal(input.propsSha256IgnoringGeometryRunId, 'c60d4d5ef446fa3046bdde5ddcaa663796a12cd9439b1c862831c663be50b04a');
    assert.equal(input.alignmentSha256, '06bde2c18db05bedee13972f93299633727c0788e6f867e7a18c913591a675ec');
    process.chdir(root);
    const result = await observeFrames({ root, browser, props, bundlePath: join(scratch, 'bundle'),
      readGraphics: readLinuxGraphics });
    process.chdir(cwd);
    // Decode after all browser observations, so FFmpeg cannot change capture timing.
    const frames = result.observations.map(frame => captureSummary(ffmpeg, frame));
    assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '');
    mkdirSync(output, { mode: 0o700 });
    const receipt = {
      schema: 'jamm-v11-swangle-repeat-png-v1', syntheticOnly: true, publishable: false,
      sourceSha, treeSha: git('rev-parse', 'HEAD^{tree}'), assetSha, browserSha,
      graphicsFiles, ffmpegSha: runtime.ffmpegSha256, remotion,
      capture: { fromSurface: true, width, height, concurrency: 1, ranges, cutBoundary, decodeAfterCapture: true },
      graphics: result.graphics, input, frames,
    };
    writeFileSync(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 });
  } finally {
    process.chdir(cwd);
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main(process.argv.slice(2));
}
