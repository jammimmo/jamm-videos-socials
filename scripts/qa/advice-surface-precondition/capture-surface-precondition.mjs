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
const selection = { png: [0, 10, 32, 43, 44, 77, 120], jpeg: [0, 77, 120] };
const modes = ['baseline', 'twoAnimationFrames', 'onePixelSurface'];
const reference = JSON.parse(readFileSync(new URL('./archive-reference.json', import.meta.url)));
const animationPeriod = 'new Promise(resolve => requestAnimationFrame(first => requestAnimationFrame(second => resolve(second - first))))';
const samplingPlan = Object.entries(selection).flatMap(([format, frames]) =>
  frames.flatMap((frame, index) =>
    modes.map((_, offset) => ({ format, frame, mode: modes[(offset + index) % modes.length] }))));
const sampleKey = ({ format, frame, mode }) => format + ':' + frame + ':' + mode;
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

function validatePng(bytes, dimensions = [width, height]) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length <= 8 * 1024 * 1024);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20), bytes[24], bytes[28]],
    [...dimensions, 8, 0]);
  assert.ok([2, 6].includes(bytes[25]));
}

function validateJpeg(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length <= 8 * 1024 * 1024);
  assert.equal(bytes.readUInt16BE(0), 0xffd8);
  assert.equal(bytes.readUInt16BE(bytes.length - 2), 0xffd9);
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    do { offset++; } while (bytes[offset] === 0xff);
    const marker = bytes[offset++];
    assert.ok(marker !== 0xda && marker !== 0xd9, 'JPEG has no frame header');
    const size = bytes.readUInt16BE(offset);
    assert.ok(size >= 2 && offset + size <= bytes.length);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      assert.ok(size >= 8);
      assert.deepEqual([bytes[offset + 2], bytes.readUInt16BE(offset + 3), bytes.readUInt16BE(offset + 5)],
        [8, height, width]);
      return;
    }
    offset += size;
  }
  assert.fail('JPEG dimensions could not be verified');
}

export function decodeImage(ffmpeg, bytes, format) {
  if (format === 'png') validatePng(bytes);
  else { assert.equal(format, 'jpeg'); validateJpeg(bytes); }
  const codec = format === 'png' ? 'png' : 'mjpeg';
  const decoded = spawnSync(ffmpeg, ['-hide_banner', '-v', 'error', '-f', 'image2pipe',
    '-protocol_whitelist', 'pipe', '-c:v', codec, '-threads', '1', '-i', 'pipe:0',
    '-frames:v', '1', '-pix_fmt', 'rgba', '-threads', '1', '-f', 'rawvideo', 'pipe:1'],
  { input: bytes, maxBuffer: rgbaBytes + 32_768, timeout: 5_000 });
  assert.ifError(decoded.error);
  assert.equal(decoded.status, 0, decoded.stderr.toString());
  assert.equal(decoded.stdout.length, rgbaBytes);
  return decoded.stdout;
}

export function summarizeRgbaDifference(first, second) {
  assert.equal(first.length, rgbaBytes);
  assert.equal(second.length, rgbaBytes);
  let changedPixels = 0;
  const changedByChannel = [0, 0, 0, 0];
  const channelMaxDeltas = [0, 0, 0, 0];
  const alphaBelowOpaque = [0, 0];
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let index = 0; index < rgbaBytes; index += 4) {
    if (first[index + 3] !== 255) alphaBelowOpaque[0]++;
    if (second[index + 3] !== 255) alphaBelowOpaque[1]++;
    if (first.readUInt32LE(index) === second.readUInt32LE(index)) continue;
    changedPixels++;
    for (let channel = 0; channel < 4; channel++) {
      const delta = Math.abs(first[index + channel] - second[index + channel]);
      if (!delta) continue;
      changedByChannel[channel]++;
      channelMaxDeltas[channel] = Math.max(channelMaxDeltas[channel], delta);
    }
    const pixel = index >>> 2;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { changedPixels, changedByChannel, channelMaxDeltas, alphaBelowOpaque,
    inclusiveBounds: changedPixels ? [minX, minY, maxX, maxY] : null };
}

export function captureSummary(ffmpeg, observation) {
  const [first, second] = observation.captures.map(capture => decodeImage(ffmpeg, capture.bytes, observation.format));
  const archived = observation.format === 'png' ? reference.frames[observation.frame] : null;
  const { before, after } = observation.domSha256;
  return {
    format: observation.format, frame: observation.frame, mode: observation.mode, preconditioning: observation.preconditioning,
    domUnchanged: before === after, domMatchesArchived: archived ? before === archived.domSha256 : null,
    domSha256: { before, after },
    rgbaDifference: summarizeRgbaDifference(first, second),
    captures: observation.captures.map(({ bytes, elapsedMs }, index) => {
      const rgbaSha256 = sha256(index === 0 ? first : second);
      return { ordinal: index + 1, elapsedMs, encodedSha256: sha256(bytes), rgbaSha256,
        rgbaMatchesArchived: archived ? rgbaSha256 === archived.rgbaSha256 : null };
    }),
  };
}

export function summarizeArms(samples) {
  return Object.fromEntries(Object.keys(selection).map(format => {
    const byFormat = samples.filter(sample => sample.format === format);
    const baseline = byFormat.filter(sample => sample.mode === 'baseline');
    const baselinesByFrame = new Map(baseline.map(sample => [sample.frame, sample]));
    const reproduced = baseline.filter(sample => sample.rgbaDifference.changedPixels !== 0 && sample.domUnchanged &&
      (format === 'jpeg' || (sample.domMatchesArchived && sample.captures[1].rgbaMatchesArchived)));
    const arms = modes.filter(mode => mode !== 'baseline').map(mode => {
      const observations = byFormat.filter(sample => sample.mode === mode);
      const stabilizedBaselineFrames = observations.filter(sample =>
        reproduced.some(control => control.frame === sample.frame) && sample.domUnchanged &&
        sample.rgbaDifference.changedPixels === 0 &&
        (format === 'jpeg'
          ? sample.captures[0].rgbaSha256 === baselinesByFrame.get(sample.frame).captures[1].rgbaSha256
          : sample.domMatchesArchived && sample.captures[0].rgbaMatchesArchived)).map(sample => sample.frame);
      return { mode,
        firstCaptureDisagreementsWithArchive: format === 'png' ? observations.filter(sample =>
          !sample.captures[0].rgbaMatchesArchived).map(sample => sample.frame) : null,
        firstCaptureDisagreementsWithRepeat: observations.filter(sample => sample.rgbaDifference.changedPixels !== 0)
          .map(sample => sample.frame),
        firstCaptureDisagreementsWithBaselineRepeat: observations.filter(sample =>
          sample.captures[0].rgbaSha256 !== baselinesByFrame.get(sample.frame).captures[1].rgbaSha256)
          .map(sample => sample.frame),
        stabilizedBaselineFrames,
        firstFullTotalVsUnconditionedMs: observations.map(sample => ({ frame: sample.frame,
          deltaMs: decimalMs(sample.preconditioning.elapsedMs + sample.captures[0].elapsedMs -
            baselinesByFrame.get(sample.frame).captures[0].elapsedMs) })),
      };
    });
    return [format, { baselineDisagreements: baseline.filter(sample =>
      sample.rgbaDifference.changedPixels !== 0).map(sample => sample.frame),
    baselineDisagreementsWithArchive: format === 'png' ? baseline.filter(sample =>
      !sample.captures[0].rgbaMatchesArchived).map(sample => sample.frame) : null,
    reproducedDriftFrames: reproduced.map(sample => sample.frame), arms }];
  }));
}

export async function observeFrames({ root, browser, props, bundlePath, readGraphics, plan = samplingPlan }) {
  const load = createRequire(join(root, 'package.json'));
  const rendererPath = dirname(load.resolve('@remotion/renderer'));
  const screenshotModule = load(join(rendererPath, 'screenshot-task.js'));
  const frameModule = load(join(rendererPath, 'render-frame-with-option-to-reject.js'));
  const nativeFrame = frameModule.renderFrameWithOptionToReject;
  const nativeScreenshot = screenshotModule.screenshotTask;
  const frameContext = new AsyncLocalStorage();
  const observations = new Map();
  let activeSample;
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
    assert.equal(activeSample?.frame, options.frame);
    return frameContext.run(activeSample, () => nativeFrame.call(this, options));
  };
  screenshotModule.screenshotTask = async function (options) {
    const sample = frameContext.getStore();
    if (sample == null) return nativeScreenshot.call(this, options);
    const id = sampleKey(sample);
    assert.ok(selection[sample.format].includes(sample.frame) && !observations.has(id));
    const client = options.page._client();
    const send = client.send;
    client.send = async function (name, params, ...rest) {
      if (name !== 'Page.captureScreenshot') return send.call(this, name, params, ...rest);
      assert.ok(!observations.has(id));
      assert.deepEqual([params.fromSurface, params.captureBeyondViewport, params.format], [true, true, sample.format]);
      if (sample.format === 'jpeg') assert.equal(params.quality, 80);
      assert.deepEqual(params.clip, { x: 0, y: 0, height, scale: 1, width });
      const snapshot = '(' + visualState.toString() + ')()';
      const before = await readValue(send, this, snapshot);
      assert.ok(before.some(doc => doc.regions.length > 0 && doc.fontStatus === 'loaded'));
      const take = async (screenshotParams = params, dimensions = [width, height]) => {
        const started = performance.now();
        const response = await send.call(this, name, screenshotParams, ...rest);
        const elapsedMs = decimalMs(performance.now() - started);
        const bytes = Buffer.from(response.value.data, 'base64');
        if (screenshotParams.format === 'png') validatePng(bytes, dimensions);
        else validateJpeg(bytes);
        return { response, bytes, elapsedMs };
      };
      const preconditioning = { elapsedMs: 0 };
      if (sample.mode === 'twoAnimationFrames') {
        const start = performance.now();
        const period = await readValue(send, this, animationPeriod);
        assert.ok(Number.isFinite(period) && period >= 0);
        preconditioning.elapsedMs = decimalMs(performance.now() - start);
        preconditioning.browserAnimationPeriodMs = period;
      } else if (sample.mode === 'onePixelSurface') {
        const warmParams = { ...params, format: 'png', clip: { ...params.clip, width: 1, height: 1 } };
        delete warmParams.quality;
        const warm = await take(warmParams, [1, 1]);
        preconditioning.elapsedMs = warm.elapsedMs;
        preconditioning.clip = { x: params.clip.x, y: params.clip.y, width: 1, height: 1 };
        preconditioning.byteCount = warm.bytes.length;
      }
      const captures = [await take(), await take()];
      const after = await readValue(send, this, snapshot);
      observations.set(id, {
        ...sample, preconditioning,
        domSha256: { before: sha256(JSON.stringify(before)), after: sha256(JSON.stringify(after)) },
        captures: captures.map(({ bytes, elapsedMs }) => ({ bytes, elapsedMs })),
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
    for (const sample of plan) {
      activeSample = sample;
      await renderFrames({
        ...common, composition, outputDir: null, muted: true, concurrency: 1, imageFormat: sample.format,
        frameRange: [sample.frame, sample.frame], onStart: () => {}, onFrameUpdate: () => {}, onFrameBuffer: () => {},
      });
    }
    assert.deepEqual([...observations.keys()], plan.map(sampleKey));
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
  const treeSha = git('rev-parse', 'HEAD^{tree}');
  assert.deepEqual({ sourceSha, treeSha, assetSha, browserSha, ffmpegSha: runtime.ffmpegSha256, remotion }, reference.runtime);
  const scratch = mkdtempSync(join(tmpdir(), 'jamm-v11-precondition-render-'));
  const cwd = process.cwd();
  try {
    const { root, props, input } = await prepareSmokeInput(repository, scratch);
    assert.equal(input.durationInFrames, 1818);
    assert.ok(props.segments[0].end > cutBoundary[0] / 30 && props.segments[0].end <= cutBoundary[1] / 30);
    assert.equal(props.segments[1].start, props.segments[0].end);
    assert.equal(input.propsSha256IgnoringGeometryRunId, reference.inputPropertiesSha256);
    assert.equal(input.alignmentSha256, reference.alignmentSha256);
    process.chdir(root);
    const result = await observeFrames({ root, browser, props, bundlePath: join(scratch, 'bundle'),
      readGraphics: readLinuxGraphics });
    process.chdir(cwd);
    // Decode after all browser observations, so FFmpeg cannot change capture timing.
    const samples = result.observations.map(observation => captureSummary(ffmpeg, observation));
    assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '');
    mkdirSync(output, { mode: 0o700 });
    const receipt = {
      schema: 'jamm-v11-swangle-precondition-v1', syntheticOnly: true, publishable: false,
      sourceSha, treeSha, assetSha, browserSha,
      graphicsFiles, ffmpegSha: runtime.ffmpegSha256, remotion,
      capture: { fromSurface: true, width, height, concurrency: 1, samplingPlan, cutBoundary, decodeAfterCapture: true },
      referenceReceipts: reference.runReceipts, graphics: result.graphics, input, samples, summary: summarizeArms(samples),
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
