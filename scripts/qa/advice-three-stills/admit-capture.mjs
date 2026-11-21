import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// This admission performs a stub dispatch only. No browser, page, bundle, media
// decode or actual screenshot is created. Installed files are never rewritten.
export async function admitTipCaptureRenderer(require) {
  const entry = require.resolve('@remotion/renderer');
  assert.ok(entry.endsWith('/dist/index.js'), 'Capture diagnostics require the CommonJS renderer entry');
  const rendererDir = dirname(entry);
  const renderer = require('@remotion/renderer');
  const version = require('@remotion/renderer/package.json').version;
  assert.equal(version, '4.0.464');
  const bindings = {
    renderFrames: 'render-frames.js', openBrowser: 'open-browser.js',
    selectComposition: 'select-composition.js', ensureBrowser: 'ensure-browser.js',
    makeCancelSignal: 'make-cancel-signal.js',
  };
  for (const [name, module] of Object.entries(bindings)) {
    assert.equal(renderer[name], require(join(rendererDir, module))[name], `Renderer ${name} comes from a different module instance`);
  }
  const dependencyChain = ['index.js', 'render-frames.js', 'render-frame-and-retry-target-close.js',
    'render-frame.js', 'render-frame-with-option-to-reject.js', 'take-frame.js',
    'puppeteer-screenshot.js', 'screenshot-task.js'];
  for (let i = 0; i < dependencyChain.length - 1; i++) {
    const parent = require.cache[require.resolve(join(rendererDir, dependencyChain[i]))];
    const child = require.cache[require.resolve(join(rendererDir, dependencyChain[i + 1]))];
    assert.ok(parent && child && parent.children.includes(child), `Capture dependency is disconnected: ${dependencyChain[i]} -> ${dependencyChain[i + 1]}`);
  }
  const screenshotModule = require(join(rendererDir, 'screenshot-task.js'));
  const evaluatorModule = require(join(rendererDir, 'puppeteer-evaluate.js'));
  const originalTask = screenshotModule.screenshotTask;
  const originalEvaluator = evaluatorModule.puppeteerEvaluateWithCatch;
  const sentinel = Buffer.from('admission-only-no-capture');
  let screenshotHookCalls = 0, evaluationStubCalls = 0;
  const pageStub = { screenshotTaskQueue: { postTask: (task) => task() } };
  let returned;
  try {
    evaluatorModule.puppeteerEvaluateWithCatch = async (options) => {
      assert.equal(options.page, pageStub);
      assert.match(options.pageFunction.toString(), /document\.body\.style\.background = 'black'/u);
      evaluationStubCalls++;
    };
    screenshotModule.screenshotTask = async (options) => {
      assert.equal(options.page, pageStub);
      assert.equal(options.format, 'jpeg'); assert.equal(options.jpegQuality, 80);
      assert.equal(options.omitBackground, false);
      screenshotHookCalls++;
      return sentinel;
    };
    returned = await require(join(rendererDir, 'take-frame.js')).takeFrame({
      freePage: pageStub, imageFormat: 'jpeg', jpegQuality: 80,
      width: 1080, height: 1920, scale: 1, wantsBuffer: true,
      output: undefined, timeoutInMilliseconds: 1000,
    });
    assert.equal(returned, sentinel, 'Actual takeFrame/puppeteer-screenshot chain bypasses the hooked module');
    assert.equal(screenshotHookCalls, 1); assert.equal(evaluationStubCalls, 1);
  } finally {
    screenshotModule.screenshotTask = originalTask;
    evaluatorModule.puppeteerEvaluateWithCatch = originalEvaluator;
  }
  assert.equal(screenshotModule.screenshotTask, originalTask);
  assert.equal(evaluatorModule.puppeteerEvaluateWithCatch, originalEvaluator);
  const admission = { kind: 'commonjs', version, entry: 'dist/index.js', bindings,
    dependencyChain: dependencyChain.map((name) => ({ name, sha256: sha256(readFileSync(join(rendererDir, name))) })),
    stubDispatch: { screenshotHookCalls, evaluationStubCalls, returnedExactBuffer: returned === sentinel,
      note: 'takeFrame -> puppeteer-screenshot -> hooked screenshotTask, with page evaluation and screenshot stubbed; no browser or actual capture' } };
  return { renderer, rendererDir, screenshotModule, admission };
}
