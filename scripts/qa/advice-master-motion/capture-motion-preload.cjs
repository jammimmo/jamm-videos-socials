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
const tracePath = process.env.JAMM_OFFLINE_MOTION_TRACE;
const pinnedBrowser = process.env.JAMM_OFFLINE_MOTION_BROWSER;
assert.ok(isAbsolute(tracePath) && isAbsolute(pinnedBrowser));
const expectedBrowser = realpathSync(pinnedBrowser);

const frameContext = new AsyncLocalStorage();
const pictures = new Map();
const browserLaunches = [];
const browserLaunchers = [];
const browsers = [];
const encoders = [];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

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
    encoders.push({ sha256: digest(readFileSync(actualExecutable)), x264Params: value('-x264-params'),
      videoThreads: value('-threads:v'), genericThreads: value('-threads') });
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
  if (options.imageFormat === 'jpeg') {
    const frame = frameContext.getStore();
    assert.ok(Number.isInteger(frame) && frame >= 0 && frame < 3600);
    assert.ok(Buffer.isBuffer(buffer));
    const hash = digest(buffer);
    assert.ok(!pictures.has(frame) || pictures.get(frame) === hash, `Retried capture differs at frame ${frame}`);
    pictures.set(frame, hash);
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

const createBrowser = HeadlessBrowser.create;
HeadlessBrowser.create = async function (options) {
  assert.equal(realpathSync(options.executablePath), expectedBrowser);
  const browser = await createBrowser.call(this, options);
  try {
    const start = await observeBrowser(browser);
    const observation = { start, beforeClose: null };
    browsers.push(observation);
    const close = browser.close;
    browser.close = async function (...arguments_) {
      try {
        if (!observation.beforeClose) observation.beforeClose = await observeBrowser(browser);
        assert.deepEqual(observation.beforeClose, observation.start);
      } finally {
        await close.apply(this, arguments_);
      }
    };
    return browser;
  } catch (error) {
    await browser.close({ silent: true });
    throw error;
  }
};

process.once('exit', code => {
  if (code !== 0) return;
  writeFileSync(tracePath, JSON.stringify({ browserLaunches, browserLaunchers, browsers, encoders,
    frames: [...pictures.entries()].sort((left, right) => left[0] - right[0]) }) + '\n',
  { flag: 'wx', mode: 0o600 });
});
