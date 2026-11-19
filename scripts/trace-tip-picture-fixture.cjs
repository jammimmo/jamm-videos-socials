const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const childProcess = require('node:child_process');
const { createHash } = require('node:crypto');
const { appendFileSync, readFileSync } = require('node:fs');
const { dirname, isAbsolute, join } = require('node:path');

const trace = process.env.TIP_FIXTURE_DIAGNOSTIC_PATH;
assert.ok(trace && isAbsolute(trace) && process.env.OFFLINE_SMOKE_NETWORK_ISOLATED === '1');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const record = event => appendFileSync(trace, `${JSON.stringify(event)}\n`, { mode: 0o600 });

// The lockfile pins the exact CommonJS renderer used by the CLI. Observe the
// existing successful screenshot before it leaves takeFrame for FFmpeg.
const renderer = dirname(require.resolve('@remotion/renderer'));
const frameModule = require(join(renderer, 'render-frame-with-option-to-reject.js'));
const captureModule = require(join(renderer, 'take-frame.js'));
const frameContext = new AsyncLocalStorage();
const renderFrame = frameModule.renderFrameWithOptionToReject;
const takeFrame = captureModule.takeFrame;
assert.equal(typeof renderFrame, 'function');
assert.equal(typeof takeFrame, 'function');
frameModule.renderFrameWithOptionToReject = function(options) {
  return frameContext.run(options.frame, () => renderFrame.call(this, options));
};
captureModule.takeFrame = async function(options) {
  const result = await takeFrame.call(this, options);
  if (options.imageFormat === 'jpeg') {
    const frame = frameContext.getStore();
    assert.ok(Number.isSafeInteger(frame) && frame >= 0 && frame < 3600);
    assert.ok(Buffer.isBuffer(result));
    record({ stage: 'preencode', frame, sha256: digest(result) });
  }
  return result;
};

const { HeadlessBrowser } = require(join(renderer, 'browser/Browser.js'));
const createBrowser = HeadlessBrowser.create;
HeadlessBrowser.create = async function(options) {
  const browser = await createBrowser.call(this, options);
  try {
    const { value } = await browser.connection.send('SystemInfo.getInfo');
    const gpu = value.gpu.auxAttributes;
    record({
      stage: 'backend',
      implementation: gpu.glImplementationParts,
      renderer: gpu.glRenderer,
      flags: options.args.filter(arg => /^--(?:use-gl=|use-angle=|disable-gpu$)/u.test(arg)),
    });
  } catch (error) {
    await browser.close({ silent: true });
    throw error;
  }
  return browser;
};

const spawn = childProcess.spawn;
childProcess.spawn = function(executable, args, options) {
  if (Array.isArray(args) && args.includes('libx264')) {
    const option = name => args.includes(name) ? args[args.lastIndexOf(name) + 1] : null;
    record({
      stage: 'encoder',
      codecSha256: digest(readFileSync(executable)),
      x264Parameters: option('-x264-params'),
      videoThreads: option('-threads:v'),
    });
  }
  return spawn.call(this, executable, args, options);
};
