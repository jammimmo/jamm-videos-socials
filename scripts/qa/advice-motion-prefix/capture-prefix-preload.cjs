const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createHash } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const { dirname, isAbsolute, join } = require('node:path');
const { frameCount, pairedFrames } = require('./prefix-settings.cjs');

const entry = process.argv[1];
if (!entry || !/\/node_modules\/(?:\.bin\/remotion|@remotion\/cli\/remotion-cli\.js)$/u.test(entry)) return;
assert.equal(process.env.OFFLINE_SMOKE_NETWORK_ISOLATED, '1');
assert.equal(process.argv[2], 'render');
assert.equal(process.argv[4], 'TipV11Fr');
assert.ok(process.argv.includes(`--frames=0-${frameCount - 1}`));
assert.ok(process.argv.includes('--concurrency=3'));
const output = process.env.JAMM_OFFLINE_PREFIX_OUTPUT;
assert.ok(isAbsolute(output));

const renderer = dirname(require.resolve('@remotion/renderer', { paths: [process.cwd()] }));
const frameModule = require(join(renderer, 'render-frame-with-option-to-reject.js'));
const screenshotModule = require(join(renderer, 'screenshot-task.js'));
const { Page } = require(join(renderer, 'browser/BrowserPage.js'));
const context = new AsyncLocalStorage();
const pageHistory = new WeakMap();
const seen = new Map();
const activations = [];
const paired = new Map();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function markActivation(page, kind) {
  assert.ok(activations.length < 4096);
  activations.push({ page: page.pageIndex, kind, frame: context.getStore()?.frame ?? null });
}

const bringToFront = Page.prototype.bringToFront;
Page.prototype.bringToFront = function (...args) {
  markActivation(this, 'rotation');
  return bringToFront.apply(this, args);
};
const renderFrame = frameModule.renderFrameWithOptionToReject;
frameModule.renderFrameWithOptionToReject = function (options) {
  const { frame, page, attempt } = options;
  if (!Number.isInteger(frame) || frame < 0 || frame >= frameCount) return renderFrame.call(this, options);
  const history = { frame, page: page.pageIndex, attempt, predecessor: pageHistory.get(page) ?? null };
  return context.run(history, async () => {
    const result = await renderFrame.call(this, options);
    pageHistory.set(page, frame);
    seen.set(frame, history);
    return result;
  });
};

function readVisualState() {
  const docs = [document, ...Array.from(document.querySelectorAll('iframe'), iframe => iframe.contentDocument).filter(Boolean)];
  return docs.map(doc => {
    const view = doc.defaultView;
    const regions = Array.from(doc.querySelectorAll('[data-fit-region]'), node => {
      const rect = node.getBoundingClientRect();
      const css = view.getComputedStyle(node);
      return { name: node.getAttribute('data-fit-region'), text: node.textContent,
        rect: [rect.x, rect.y, rect.width, rect.height], font: css.font, opacity: css.opacity };
    });
    const drawing = Array.from(doc.querySelectorAll('svg g[transform], svg path[stroke-dasharray]'), node =>
      [node.getAttribute('transform'), node.getAttribute('stroke-dasharray')]);
    const images = Array.from(doc.querySelectorAll('img'), image =>
      [image.complete, image.naturalWidth, image.naturalHeight]);
    const fonts = Array.from(doc.fonts, font => [font.family, font.weight, font.style, font.status]);
    return { regions, drawing, images, fonts, fontStatus: doc.fonts.status, dpr: view.devicePixelRatio,
      ready: view.remotion_renderReady ?? null, visibility: doc.visibilityState, focused: doc.hasFocus() };
  });
}

async function snapshot(send, client) {
  const { value } = await send.call(client, 'Runtime.evaluate', {
    expression: `(${readVisualState.toString()})()`, returnByValue: true,
  });
  assert.ok(!value.exceptionDetails && Array.isArray(value.result.value));
  return value.result.value;
}

const takeScreenshot = screenshotModule.screenshotTask;
screenshotModule.screenshotTask = async function (options) {
  const history = context.getStore();
  if (options.format !== 'jpeg' || !history) return takeScreenshot.call(this, options);
  const client = options.page._client();
  const send = client.send;
  const selected = pairedFrames.includes(history.frame);
  client.send = async function (method, params, ...args) {
    if (method === 'Target.activateTarget') markActivation(options.page, 'stock-screenshot');
    if (method !== 'Page.captureScreenshot' || params.format !== 'jpeg' || !selected || paired.has(history.frame)) {
      return send.call(this, method, params, ...args);
    }
    assert.equal(options.omitBackground, false);
    assert.equal(params.fromSurface, true);
    assert.equal(params.captureBeyondViewport, true);
    assert.equal(params.optimizeForSpeed, true);
    assert.equal(params.quality, 80);
    assert.deepEqual(params.clip, { x: 0, y: 0, height: 1920, scale: 1, width: 1080 });
    const eventStart = activations.length;
    const before = await snapshot(send, this);
    const jpegResult = await send.call(this, method, params, ...args);
    const pngParams = { ...params, format: 'png' };
    delete pngParams.quality;
    const pngResult = await send.call(this, method, pngParams, ...args);
    const after = await snapshot(send, this);
    const jpeg = Buffer.from(jpegResult.value.data, 'base64');
    const png = Buffer.from(pngResult.value.data, 'base64');
    assert.equal(jpeg.subarray(0, 2).toString('hex'), 'ffd8');
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(jpeg.length <= 4 * 1024 * 1024 && png.length <= 8 * 1024 * 1024);
    writeFileSync(join(output, `${history.frame}.jpg`), jpeg, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(output, `${history.frame}.png`), png, { flag: 'wx', mode: 0o600 });
    paired.set(history.frame, { ...history, before, after, eventStart, eventEnd: activations.length,
      jpegSha256: hash(jpeg), pngSha256: hash(png) });
    return jpegResult;
  };
  try {
    return await takeScreenshot.call(this, options);
  } finally {
    client.send = send;
  }
};

process.once('exit', code => {
  if (code !== 0) return;
  writeFileSync(join(output, 'page-trace.json'), JSON.stringify({ activations,
    frames: [...seen.values()].sort((a, b) => a.frame - b.frame),
    pairs: [...paired.values()].sort((a, b) => a.frame - b.frame) }) + '\n', { flag: 'wx', mode: 0o600 });
});
