const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const childProcess = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync, realpathSync, writeFileSync } = require('node:fs');
const { dirname, isAbsolute, join } = require('node:path');
const { identifyChromeLaunch, verifyGraphicsLaunch, verifiedSwiftShader } = require('./capture-graphics.mjs');

// NODE_OPTIONS is inherited by the synthetic fixture and its children. Observe
// only the actual V11 Remotion command. The output path is supplied by the
// isolated launcher, and this preload never changes production code or flags.
const entry = process.argv[1];
if (!entry || !/\/node_modules\/(?:\.bin\/remotion|@remotion\/cli\/remotion-cli\.js)$/u.test(entry)) return;
assert.equal(process.env.OFFLINE_SMOKE_NETWORK_ISOLATED, '1');
assert.equal(process.argv[2], 'render');
assert.equal(process.argv[4], 'TipV11Fr');
assert.ok(process.argv.includes('--config=remotion.tip-v11.config.ts'));
assert.ok(process.argv.includes('--image-format=png'));
assert.ok(process.argv.includes('--concurrency=1'));
assert.ok(process.argv.includes('--frames=0-131'));
const tracePath = process.env.JAMM_OFFLINE_MOTION_TRACE;
const pinnedBrowser = process.env.JAMM_OFFLINE_MOTION_BROWSER;
const expectedFrameCount = Number(process.env.JAMM_OFFLINE_MOTION_FRAMES);
assert.ok(isAbsolute(tracePath) && isAbsolute(pinnedBrowser));
assert.ok(Number.isInteger(expectedFrameCount) && expectedFrameCount > 0 && expectedFrameCount <= 3600);
const expectedBrowser = realpathSync(pinnedBrowser);

const frameContext = new AsyncLocalStorage();
const pictures = new Map();
const pngTypes = new Map();
const browserLaunches = [];
const browserLaunchers = [];
const browsers = [];
const encoders = [];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let activeBrowser;
let finalCaptureCheck;

const spawn = childProcess.spawn;
childProcess.spawn = function (executable, args, options) {
  const requestedBrowser = identifyChromeLaunch(executable, args);
  if (requestedBrowser) {
    assert.equal(realpathSync(requestedBrowser.browserExecutable), expectedBrowser);
    verifyGraphicsLaunch(requestedBrowser.browserArgs);
  }
  const child = spawn.call(this, executable, args, options);
  if (requestedBrowser) {
    const [actualExecutable, ...actualArgs] = child.spawnargs;
    const actualBrowser = identifyChromeLaunch(actualExecutable, actualArgs);
    assert.equal(actualBrowser?.launcher, requestedBrowser.launcher);
    assert.equal(realpathSync(actualBrowser.browserExecutable), expectedBrowser);
    const flags = actualBrowser.browserArgs.filter(arg => /^--(?:use-gl|use-angle|disable-gpu)(?:=|$)/u.test(arg));
    verifyGraphicsLaunch(flags);
    browserLaunches.push(flags);
    browserLaunchers.push(actualBrowser.launcher);
  }
  if (Array.isArray(args) && args.includes('libx264')) {
    const [actualExecutable, ...actualArgs] = child.spawnargs;
    assert.equal(realpathSync(actualExecutable), realpathSync(executable));
    assert.ok(actualArgs.includes('libx264'));
    const value = option => actualArgs.includes(option) ? actualArgs[actualArgs.lastIndexOf(option) + 1] : null;
    const inputIndex = actualArgs.indexOf('-i');
    assert.ok(inputIndex > 0);
    const inputArgs = actualArgs.slice(0, inputIndex);
    const inputValue = option => inputArgs.includes(option) ? inputArgs[inputArgs.lastIndexOf(option) + 1] : null;
    encoders.push({ sha256: digest(readFileSync(actualExecutable)), x264Params: value('-x264-params'),
      videoThreads: value('-threads:v'), genericThreads: value('-threads'),
      imageInput: { demuxer: inputValue('-f'), decoder: inputValue('-vcodec'), source: actualArgs[inputIndex + 1] } });
  }
  return child;
};

const renderer = dirname(require.resolve('@remotion/renderer', { paths: [process.cwd()] }));
const frameModule = require(join(renderer, 'render-frame-with-option-to-reject.js'));
const captureModule = require(join(renderer, 'take-frame.js'));
const { HeadlessBrowser } = require(join(renderer, 'browser/Browser.js'));

const renderFrame = frameModule.renderFrameWithOptionToReject;
const takeFrame = captureModule.takeFrame;
assert.equal(typeof renderFrame, 'function');
assert.equal(typeof takeFrame, 'function');
frameModule.renderFrameWithOptionToReject = function (options) {
  return frameContext.run(options.frame, () => renderFrame.call(this, options));
};
captureModule.takeFrame = async function (options) {
  const buffer = await takeFrame.call(this, options);
  if (options.imageFormat === 'png') {
    const frame = frameContext.getStore();
    assert.ok(Number.isInteger(frame) && frame >= 0 && frame < expectedFrameCount);
    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(buffer.toString('ascii', 12, 16), 'IHDR');
    assert.deepEqual([buffer.readUInt32BE(16), buffer.readUInt32BE(20), buffer[24], buffer[28]], [1080, 1920, 8, 0]);
    assert.ok([2, 6].includes(buffer[25]));
    const hash = digest(buffer);
    assert.ok(!pictures.has(frame) || pictures.get(frame) === hash, `Retried capture differs at frame ${frame}`);
    pictures.set(frame, hash);
    pngTypes.set(frame, buffer[25]);
    if (pictures.size === expectedFrameCount) {
      finalCaptureCheck ??= observeFinalCapture(frame, hash);
      await finalCaptureCheck;
    }
  }
  return buffer;
};

async function observeBrowser(browser) {
  const { value: { gpu } } = await browser.connection.send('SystemInfo.getInfo');
  assert.ok(gpu?.devices?.length && gpu.auxAttributes);
  const { processCrashCount } = gpu.auxAttributes;
  assert.equal(processCrashCount, 0);
  return verifiedSwiftShader(gpu.auxAttributes);
}

async function observeFinalCapture(frame, sha256) {
  // The Remotion CLI does not await its shutdown callbacks. Wait here, before
  // passing the PNG that completes the captured frame set to the renderer.
  assert.equal(browsers.length, 1);
  assert.equal(browserLaunches.length, 1);
  const backend = await observeBrowser(activeBrowser);
  assert.deepEqual(backend, browsers[0].start);
  browsers[0].afterFinalCapture = { frame, sha256, capturedFrames: pictures.size, backend };
}

const createBrowser = HeadlessBrowser.create;
HeadlessBrowser.create = async function (options) {
  assert.equal(realpathSync(options.executablePath), expectedBrowser);
  const browser = await createBrowser.call(this, options);
  try {
    const start = await observeBrowser(browser);
    activeBrowser = browser;
    browsers.push({ start, afterFinalCapture: null });
    return browser;
  } catch (error) {
    await browser.close({ silent: true });
    throw error;
  }
};

process.once('exit', code => {
  if (code !== 0) return;
  writeFileSync(tracePath, JSON.stringify({ browserLaunches, browserLaunchers, browsers, encoders,
    frames: [...pictures.entries()].sort((left, right) => left[0] - right[0]),
    pngColorTypes: [...pngTypes.entries()].sort((left, right) => left[0] - right[0]) }) + '\n',
  { flag: 'wx', mode: 0o600 });
});
