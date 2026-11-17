// Diagnostic only: one renderFrames JPEG capture + same-state PNG, no encoder.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir, networkInterfaces } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { admitTipCaptureRenderer } from './admit-tip-capture-renderer.mjs';
import { openTipSwangleBrowser } from './open-tip-swangle-browser.mjs';
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
// Admission proves this CommonJS renderer is connected to the actual hook before
// any ensureBrowser/openBrowser/bundle/capture call. No ESM renderer imports.
const { renderer, rendererDir, screenshotModule, admission } = await admitTipCaptureRenderer();
const { ensureBrowser, openBrowser, selectComposition, renderFrames, makeCancelSignal } = renderer;
const { bundle } = require('@remotion/bundler');
const { getChromiumOpenGlRenderer } = require(join(rendererDir, 'options/gl.js'));
const { getJpegQuality } = require(join(rendererDir, 'options/jpeg-quality.js'));
const { videoImageFormatOption } = require(join(rendererDir, 'options/video-image-format.js'));
assert.equal(getChromiumOpenGlRenderer(), 'angle');
assert.equal(getJpegQuality(), 80);
assert.equal(videoImageFormatOption.getValue({ commandLine: {} }).value, 'jpeg');
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
let browser, capture, launchProof;
const snapshot = async (page) => {
  const client = page._client();
  const response = await client.send('Runtime.evaluate', { expression: `JSON.stringify([document,...Array.from(document.querySelectorAll('iframe')).map(f=>f.contentDocument).filter(Boolean)].map(d=>({
    html:d.documentElement.outerHTML, status:d.fonts.status,
    faces:Array.from(d.fonts).map(f=>({family:f.family,style:f.style,weight:f.weight,status:f.status,stretch:f.stretch,unicodeRange:f.unicodeRange})),
    background:d.defaultView.getComputedStyle(d.body).backgroundColor,
    usedText:Array.from(d.querySelectorAll('*')).flatMap(el=>{
      if(['STYLE','SCRIPT','NOSCRIPT'].includes(el.tagName))return [];
      const text=Array.from(el.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim();
      const c=d.defaultView.getComputedStyle(el),r=el.getBoundingClientRect();
      if(!text||r.width<=0||r.height<=0||c.display==='none'||c.visibility!=='visible'||Number(c.opacity)===0)return [];
      return [{text,font:c.font,family:c.fontFamily,style:c.fontStyle,weight:c.fontWeight,check:d.fonts.check(c.font,text)}];
    })
  })))`, returnByValue: true });
  assert.equal(response.value.exceptionDetails, undefined);
  const text = response.value.result.value;
  const documents = JSON.parse(text);
  assert.ok(documents.every((d) => d.status === 'loaded'));
  const faces = documents.flatMap((d) => d.faces);
  assert.ok([600, 700, 800].every((weight) => faces.some((f) => /Poppins/iu.test(f.family) && Number(f.weight) === weight && f.style === 'normal' && f.status === 'loaded')), 'Each required Poppins face must be loaded');
  assert.ok(faces.every((f) => f.status === 'loaded'), 'Unloaded/error FontFace is not a valid capture prerequisite');
  assert.ok(documents.flatMap((d) => d.usedText).every((r) => r.font && r.check), 'A used computed font fails FontFaceSet.check for its actual text');
  // FontFaceSet.check alone can accept fallbacks. Ask Chromium for the fonts
  // actually supplying glyphs for each rendered Poppins text parent as well.
  await client.send('DOM.enable'); await client.send('CSS.enable');
  const tree = (await client.send('DOM.getDocument', { depth: -1, pierce: true })).value.root;
  const platformText = [];
  const visit = async (node, path) => {
    const directText = (node.children ?? []).filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('').trim();
    if (node.nodeType === 1 && directText && !['STYLE', 'SCRIPT', 'NOSCRIPT'].includes(node.nodeName)) {
      const style = Object.fromEntries((await client.send('CSS.getComputedStyleForNode', { nodeId: node.nodeId })).value.computedStyle.map((p) => [p.name, p.value]));
      if (style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) !== 0) {
        const fonts = (await client.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId })).value.fonts.filter((f) => f.glyphCount > 0);
        if (fonts.length) {
          if (/Poppins/iu.test(style['font-family'] ?? '')) assert.ok(fonts.every((f) => f.isCustomFont && /Poppins/iu.test(f.familyName)), 'Actual glyphs use a fallback instead of bundled Poppins');
          platformText.push({ path, text: directText,
            computedFont: Object.fromEntries(['font-family', 'font-style', 'font-weight', 'font-size', 'line-height'].map((key) => [key, style[key]])),
            fonts: fonts.map((f) => ({ family: f.familyName, postScriptName: f.postScriptName ?? null, isCustomFont: f.isCustomFont, glyphCount: f.glyphCount })) });
        }
      }
    }
    for (const [i, child] of (node.children ?? []).entries()) await visit(child, `${path}/${i}`);
    if (node.contentDocument) await visit(node.contentDocument, `${path}/document`);
  };
  await visit(tree, 'root');
  assert.ok(platformText.some((run) => run.fonts.some((f) => f.isCustomFont && /Poppins/iu.test(f.family))), 'No actually rendered bundled-font glyphs were measured');
  return { domSha256: hash(text), documents: documents.map(({ html, ...metadata }) => metadata), platformText };
};

try {
  const cached = await ensureBrowser({ onBrowserDownload() { throw new Error('Chromium must be prepared outside isolation'); } });
  assert.equal(cached.type, 'local-puppeteer-browser');
  ({ browser, launchProof } = await openTipSwangleBrowser({ openBrowser, rendererDir, browserExecutable: cached.path }));
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
    imageFormat: 'jpeg', jpegQuality: 80, chromiumOptions: { gl: 'swangle' }, concurrency: 3,
    scale: 1, frameRange: [frame, frame], outputDir: null, cancelSignal,
    timeoutInMilliseconds: 20_000, logLevel: 'error',
    onStart() {}, onFrameUpdate() {}, onFrameBuffer(bytes, index) { piped.push({ frame: index, sha256: hash(bytes) }); } });
  assert.ok(capture);
  assert.deepEqual(piped, [{ frame, sha256: capture.jpegSha256 }], 'JPEG is not the exact renderFrames buffer');
  const gpu = (await browser.connection.send('SystemInfo.getInfo')).value.gpu;
  const browserVersion = (await browser.connection.send('Browser.getVersion')).value;
  assert.ok(gpu && gpu.devices?.length && gpu.auxAttributes, 'Actual graphics information unavailable');
  assert.ok(Object.keys(gpu.auxAttributes).some((key) => /gl.*renderer|glImplementationParts/iu.test(key)), 'Actual GL renderer/backend unavailable');
  assert.match(gpu.auxAttributes.glRenderer ?? '', /swiftshader/iu, 'Requested swangle did not produce an observed SwiftShader renderer');
  assert.doesNotMatch(gpu.auxAttributes.glRenderer, /disabled|llvmpipe/iu);
  const pixels = {};
  for (const [name, format, channels] of [['frame.jpg', 'yuv420p', 1.5], ['frame.png', 'rgba', 4]]) {
    const bytes = execFileSync(binary, ['-nostdin', '-v', 'error', '-i', join(out, name), '-frames:v', '1', '-an', '-c:v', 'rawvideo', '-pix_fmt', format, '-threads:v', '1', '-f', 'image2pipe', 'pipe:1'], { maxBuffer: width * height * channels + 1024, timeout: 15_000 });
    assert.equal(bytes.length, width * height * channels);
    let nonOpaquePixels = null;
    if (format === 'rgba') { nonOpaquePixels = 0; for (let i = 3; i < bytes.length; i += 4) if (bytes[i] !== 255) nonOpaquePixels++; assert.equal(nonOpaquePixels, 0); }
    pixels[name] = { format, bytes: bytes.length, sha256: hash(bytes), nonOpaquePixels };
  }
  const receipt = { schema: 'jamm-v11-single-frame-capture-v1', syntheticOnly: true, publishable: false,
    sourceSha, admission, diagnosticIntervention: { baselineRequestedGl: 'angle', requestedGl: 'swangle', launchProof }, input, inputSha256: hash(JSON.stringify(input)), inventory, configSha256: hash(readFileSync(join(root, 'remotion.tip-v11.config.ts'))),
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
