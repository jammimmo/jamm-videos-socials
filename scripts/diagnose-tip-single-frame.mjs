// Diagnostic only: one renderFrames JPEG capture + same-state PNG, no encoder.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir, networkInterfaces } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, openBrowser, selectComposition, renderFrames, makeCancelSignal } from '@remotion/renderer';
import { buildTipV11Narration } from './tip-v11-contract.mjs';
import { collectTipV11StaticFiles } from './tip-v11-render-manifest.mjs';
import '../remotion.tip-v11.config.ts';

const root = resolve(dirname(import.meta.filename), '..');
const require = createRequire(import.meta.url);
const hash = (b) => createHash('sha256').update(b).digest('hex');
assert.equal(process.env.OFFLINE_SMOKE_NETWORK_ISOLATED, '1');
assert.equal(process.platform, 'linux');
assert.ok(!process.env.DISABLE_FROM_SURFACE);
assert.equal(Object.values(networkInterfaces()).flat().filter((a) => a && !a.internal).length, 0);
for (const key of ['GEMINI_API_KEY', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'TIP_CALLBACK_TOKEN', 'TIP_UPLOAD_URL', 'TIP_CALLBACK_URL']) assert.ok(!process.env[key]);
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(sourceSha, process.env.TIP_PARITY_EXPECTED_SHA);
const out = resolve(process.argv[2]);
mkdirSync(out, { recursive: true });
const rendererDir = dirname(require.resolve('@remotion/renderer'));
const { getChromiumOpenGlRenderer } = require(join(rendererDir, 'options/gl.js'));
const { getJpegQuality } = require(join(rendererDir, 'options/jpeg-quality.js'));
const { videoImageFormatOption } = require(join(rendererDir, 'options/video-image-format.js'));
assert.equal(getChromiumOpenGlRenderer(), 'angle');
assert.equal(getJpegQuality(), 80);
assert.equal(videoImageFormatOption.getValue({ commandLine: {} }).value, 'jpeg');
const screenshotModule = require(join(rendererDir, 'screenshot-task.js'));
const originalScreenshotTask = screenshotModule.screenshotTask;
// Same exact synthetic text as offline-tip-v11-smoke; timings below are deliberate
// diagnostic inputs, not recovered alignment timings from the old full render.
const fixture = {
  template: 'tip-v11-fr', id: 'tip-00000000-0000-4000-8000-000000000019', title: 'RECETTE HORS LIGNE',
  body: [
    'Cette recette synthétique vérifie uniquement le moteur vidéo hors ligne et ne doit jamais être publiée.',
    'Chaque image utilise des données locales déterministes sans client, compte social, annonce réelle ou média privé.',
    'La piste sonore contient seulement un signal artificiel destiné aux contrôles techniques du rendu automatisé.',
    'Les sous-titres signalent clairement une démonstration de test sans conseil immobilier ni appel commercial.',
    'Le fichier final est contrôlé puis supprimé avant toute livraison, publication ou conservation comme contenu éditorial.',
  ],
};
const plan = buildTipV11Narration(fixture);
const props = { title: plan.title, durationInFrames: 240, audio: '',
  segments: plan.segments.map((segment, index) => ({ ...segment, start: index * 4, end: (index + 1) * 4 })),
  captions: [{ start: 0, end: 4, text: 'RECETTE SYNTHÉTIQUE — NE PAS PUBLIER' }],
  assistantEnabled: false, visualTopic: plan.visualTopic };
const frame = 60, width = 1080, height = 1920;
const input = { frame, props, fixture, width, height, fps: 30 };
const inventory = await collectTipV11StaticFiles(root);
const { getExecutablePath } = require(join(rendererDir, 'compositor/get-executable-path.js'));
const binary = getExecutablePath({ type: 'ffmpeg', indent: false, logLevel: 'error', binariesDirectory: null });
const scratch = mkdtempSync(join(tmpdir(), 'jamm-one-frame-'));
const { cancelSignal, cancel } = makeCancelSignal();
const timer = setTimeout(cancel, 60_000);
let browser, capture;
const snapshot = async (page) => {
  const response = await page._client().send('Runtime.evaluate', { expression: `JSON.stringify([document,...Array.from(document.querySelectorAll('iframe')).map(f=>f.contentDocument).filter(Boolean)].map(d=>({html:d.documentElement.outerHTML,fonts:d.fonts.status,background:getComputedStyle(d.body).backgroundColor})))`, returnByValue: true });
  assert.equal(response.value.exceptionDetails, undefined);
  const text = response.value.result.value;
  const documents = JSON.parse(text);
  assert.ok(documents.every((d) => d.fonts === 'loaded'));
  return { domSha256: hash(text), fontStatus: documents.map((d) => d.fonts), backgrounds: documents.map((d) => d.background) };
};
try {
  const cached = await ensureBrowser({ onBrowserDownload() { throw new Error('Chromium must be prepared outside isolation'); } });
  assert.equal(cached.type, 'local-puppeteer-browser');
  browser = await openBrowser('chrome', { browserExecutable: cached.path, chromiumOptions: { gl: 'angle' }, forceDeviceScaleFactor: 1, chromeMode: 'headless-shell', logLevel: 'error' });
  const publicDir = join(scratch, 'public');
  mkdirSync(publicDir);
  cpSync(join(root, 'public/tip-v11'), join(publicDir, 'tip-v11'), { recursive: true });
  const serveUrl = await bundle({ entryPoint: join(root, 'src/index.ts'), outDir: join(scratch, 'bundle'), publicDir, enableCaching: false });
  const composition = await selectComposition({ serveUrl, id: 'TipV11Fr', inputProps: props, puppeteerInstance: browser, timeoutInMilliseconds: 20_000, logLevel: 'error' });
  screenshotModule.screenshotTask = async (options) => {
    assert.equal(capture, undefined, 'Only one frame may be captured');
    assert.equal(options.format, 'jpeg'); assert.equal(options.jpegQuality, 80);
    assert.equal(options.omitBackground, false); assert.equal(options.width, width); assert.equal(options.height, height); assert.equal(options.scale, 1);
    const before = await snapshot(options.page);
    const client = options.page._client();
    const originalSend = client.send;
    const screenshotCommands = [];
    client.send = function(method, ...args) {
      if (method === 'Page.captureScreenshot') screenshotCommands.push(args[0]);
      return originalSend.call(this, method, ...args);
    };
    let jpeg, png;
    try {
      jpeg = await originalScreenshotTask(options); // Unchanged production task.
      // Same page/state, without takeFrame's PNG-specific body/transparency change.
      png = await originalScreenshotTask({ ...options, format: 'png', jpegQuality: undefined, omitBackground: false, path: undefined });
    } finally { client.send = originalSend; }
    assert.equal(screenshotCommands.length, 2);
    assert.equal(screenshotCommands[0].format, 'jpeg'); assert.equal(screenshotCommands[0].quality, 80);
    assert.equal(screenshotCommands[1].format, 'png');
    for (const command of screenshotCommands) {
      assert.equal(command.fromSurface, true); assert.equal(command.optimizeForSpeed, true);
      assert.equal(command.captureBeyondViewport, true);
      assert.deepEqual(command.clip, { x: 0, y: 0, height, scale: 1, width });
    }
    const after = await snapshot(options.page);
    assert.deepEqual(after, before, 'Frame DOM/font/background state changed between captures');
    assert.ok(jpeg.length <= 4 * 1024 * 1024 && png.length <= 4 * 1024 * 1024);
    writeFileSync(join(out, 'frame.jpg'), jpeg); writeFileSync(join(out, 'frame.png'), png);
    capture = { jpegSha256: hash(jpeg), jpegBytes: jpeg.length, pngSha256: hash(png), pngBytes: png.length, before, after,
      screenshotCommands, task: { format: options.format, jpegQuality: options.jpegQuality, omitBackground: options.omitBackground, width, height, scale: options.scale } };
    return jpeg;
  };
  const piped = [];
  await renderFrames({ serveUrl, composition, inputProps: props, puppeteerInstance: browser,
    imageFormat: 'jpeg', jpegQuality: 80, chromiumOptions: { gl: 'angle' }, concurrency: 3,
    scale: 1, frameRange: [frame, frame], outputDir: null, cancelSignal,
    timeoutInMilliseconds: 20_000, logLevel: 'error',
    onStart() {}, onFrameUpdate() {}, onFrameBuffer(bytes, index) { piped.push({ frame: index, sha256: hash(bytes) }); } });
  assert.ok(capture);
  assert.deepEqual(piped, [{ frame, sha256: capture.jpegSha256 }], 'JPEG is not the exact renderFrames buffer');
  const gpu = (await browser.connection.send('SystemInfo.getInfo')).value.gpu;
  const browserVersion = (await browser.connection.send('Browser.getVersion')).value;
  assert.ok(gpu && gpu.devices?.length && gpu.auxAttributes, 'Actual graphics information unavailable');
  assert.ok(Object.keys(gpu.auxAttributes).some((key) => /gl.*renderer|glImplementationParts/iu.test(key)), 'Actual GL renderer/backend unavailable');
  const pixels = {};
  for (const [name, format, channels] of [['frame.jpg', 'yuv420p', 1.5], ['frame.png', 'rgba', 4]]) {
    const bytes = execFileSync(binary, ['-nostdin', '-v', 'error', '-i', join(out, name), '-frames:v', '1', '-an', '-c:v', 'rawvideo', '-pix_fmt', format, '-threads:v', '1', '-f', 'image2pipe', 'pipe:1'], { maxBuffer: width * height * channels + 1024, timeout: 15_000 });
    assert.equal(bytes.length, width * height * channels);
    let nonOpaquePixels = null;
    if (format === 'rgba') { nonOpaquePixels = 0; for (let i = 3; i < bytes.length; i += 4) if (bytes[i] !== 255) nonOpaquePixels++; assert.equal(nonOpaquePixels, 0); }
    pixels[name] = { format, bytes: bytes.length, sha256: hash(bytes), nonOpaquePixels };
  }
  const receipt = { schema: 'jamm-v11-single-frame-capture-v1', syntheticOnly: true, publishable: false,
    sourceSha, input, inputSha256: hash(JSON.stringify(input)), inventory, configSha256: hash(readFileSync(join(root, 'remotion.tip-v11.config.ts'))),
    chromium: { path: cached.path, sha256: hash(readFileSync(cached.path)), browserVersion },
    bundledFfmpeg: { path: binary, sha256: hash(readFileSync(binary)) },
    observedGpu: gpu, capture, piped, pixels,
    installedCaptureCode: Object.fromEntries(['render-frames.js', 'take-frame.js', 'puppeteer-screenshot.js', 'screenshot-task.js'].map((name) => [name, hash(readFileSync(join(rendererDir, name)))])) };
  const receiptBytes = `${JSON.stringify(receipt, null, 2)}\n`;
  assert.ok(Buffer.byteLength(receiptBytes) <= 128 * 1024);
  writeFileSync(join(out, 'receipt.json'), receiptBytes, { flag: 'wx', mode: 0o600 });
} finally {
  screenshotModule.screenshotTask = originalScreenshotTask;
  clearTimeout(timer);
  if (browser) await browser.close({ silent: true });
  rmSync(scratch, { recursive: true, force: true });
}
