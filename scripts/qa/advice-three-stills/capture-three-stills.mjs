import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { networkInterfaces, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { admitTipCaptureRenderer } from './admit-capture.mjs';
import { snapshot } from './capture-page-state.mjs';
import { prepareSmokeInput, sha256 } from './prepare-smoke-input.mjs';

const sourceSha = '482a390db547fca0734cb7ebc52363e5a6a07d54';
const officialLinuxSha = '47e823e3a14b431ffa8dc88f97db6a854cd92e04800c01fc765c16a18d393d72';
const frames = [50, 51, 70];
const width = 1080, height = 1920;
const [repositoryArg, outputArg, browserArg, mode = 'parity'] = process.argv.slice(2);
assert.ok(repositoryArg && outputArg && browserArg && ['parity', 'mac-harness-validation'].includes(mode));
assert.equal(process.version, 'v22.20.0');
assert.equal(process.env.OFFLINE_SMOKE_NETWORK_ISOLATED, '1');
assert.ok(!process.env.DISABLE_FROM_SURFACE);
assert.deepEqual(Object.keys(process.env).filter(name => /GEMINI_.*KEY|TOKEN|TIP_.*URL|TIP_.*FILE|PROXY/iu.test(name)), []);
if (mode === 'parity') {
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  assert.equal(Object.values(networkInterfaces()).flat().filter(address => address && !address.internal).length, 0);
} else {
  assert.equal(process.platform, 'darwin');
}
const repository = resolve(repositoryArg), output = resolve(outputArg), browserExecutable = resolve(browserArg);
const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', timeout: 10_000 }).trim();
assert.equal(git('rev-parse', 'HEAD'), sourceSha);
assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '');
const browserSha = sha256(readFileSync(browserExecutable));
if (mode === 'parity') assert.equal(browserSha, officialLinuxSha);
mkdirSync(output, { mode: 0o700 }); // Refuse a directory containing older evidence.

const require = createRequire(join(repository, 'package.json'));
await import(pathToFileURL(join(repository, 'remotion.tip-v11.config.ts')).href);
const { renderer, rendererDir, screenshotModule, admission } = await admitTipCaptureRenderer(require);
const { openBrowser, selectComposition, renderFrames, makeCancelSignal } = renderer;
const { bundle } = require('@remotion/bundler');
const { getChromiumOpenGlRenderer } = require(join(rendererDir, 'options/gl.js'));
const { getJpegQuality } = require(join(rendererDir, 'options/jpeg-quality.js'));
const { getExecutablePath } = require(join(rendererDir, 'compositor/get-executable-path.js'));
assert.equal(getChromiumOpenGlRenderer(), 'angle');
assert.equal(getJpegQuality(), 80);
const ffmpeg = getExecutablePath({ type: 'ffmpeg', indent: false, logLevel: 'error', binariesDirectory: null });
const scratch = mkdtempSync(join(tmpdir(), 'jamm-three-stills-'));
const originalScreenshotTask = screenshotModule.screenshotTask;
const { cancelSignal, cancel } = makeCancelSignal();
const timer = setTimeout(cancel, 110_000);
let browser;

function filePixels(path, pixelFormat, bytesExpected) {
  const pixels = execFileSync(ffmpeg, ['-nostdin', '-v', 'error', '-xerror',
    '-protocol_whitelist', 'file', '-i', path, '-frames:v', '1', '-an', '-c:v', 'rawvideo',
    '-pix_fmt', pixelFormat, '-threads:v', '1', '-f', 'image2pipe', 'pipe:1'],
  { cwd: dirname(ffmpeg), maxBuffer: bytesExpected + 1024, timeout: 15_000 });
  assert.equal(pixels.length, bytesExpected);
  if (pixelFormat === 'rgba') {
    for (let i = 3; i < pixels.length; i += 4) assert.equal(pixels[i], 255, 'Expected opaque PNG');
  }
  return { pixelFormat, bytes: pixels.length, sha256: sha256(pixels) };
}

async function picturePair(options) {
  assert.equal(options.format, 'jpeg');
  assert.equal(options.jpegQuality, 80);
  assert.equal(options.omitBackground, false);
  assert.equal(options.width, width);
  assert.equal(options.height, height);
  assert.equal(options.scale, 1);
  const before = await snapshot(options.page);
  assert.ok(before.documents.every(document => document.devicePixelRatio === 1));
  const client = options.page._client();
  const send = client.send;
  const commands = [];
  client.send = function (method, ...args) {
    if (method === 'Page.captureScreenshot') commands.push(args[0]);
    return send.call(this, method, ...args);
  };
  let jpeg, png;
  try {
    jpeg = await originalScreenshotTask(options);
    png = await originalScreenshotTask({ ...options, format: 'png', jpegQuality: undefined, path: undefined });
  } finally {
    client.send = send;
  }
  assert.deepEqual(commands.map(({ format, quality }) => [format, quality]), [['jpeg', 80], ['png', undefined]]);
  for (const command of commands) {
    assert.equal(command.fromSurface, true);
    assert.equal(command.optimizeForSpeed, true);
    assert.equal(command.captureBeyondViewport, true);
    assert.deepEqual(command.clip, { x: 0, y: 0, width, height, scale: 1 });
  }
  const after = await snapshot(options.page);
  assert.deepEqual(after, before, 'Frame changed between JPEG and PNG');
  assert.ok([jpeg, png].every(bytes => bytes.length > 0 && bytes.length <= 4 * 1024 * 1024));
  return { jpeg, png, commands, state: before };
}

async function launchBrowser() {
  const childProcess = require('node:child_process');
  const spawn = childProcess.spawn;
  const launches = [];
  childProcess.spawn = function (executable, args, options) {
    const child = spawn.call(this, executable, args, options);
    if (executable === browserExecutable || args?.includes(browserExecutable)) {
      launches.push(child.spawnargs.filter(arg => /^--(?:use-gl|use-angle|disable-gpu|single-process|force-color-profile|headless)(?:=|$)/u.test(arg)));
    }
    return child;
  };
  try {
    browser = await openBrowser('chrome', { browserExecutable, chromiumOptions: { gl: 'angle' },
      chromeMode: 'headless-shell', forceDeviceScaleFactor: 1, logLevel: 'error' });
    assert.equal(launches.length, 1, 'Expected the instrumented vendor browser launch');
    return launches[0];
  } finally {
    childProcess.spawn = spawn;
  }
}

async function mappedBrowserLibraries() {
  if (process.platform !== 'linux') return { status: 'not-linux' };
  const data = (await browser.connection.send('SystemInfo.getProcessInfo')).value;
  const processIds = data.processInfo.filter(({ type, id }) => /^(browser|gpu)$/iu.test(type) && Number.isInteger(id));
  return processIds.map(({ type, id }) => {
    try {
      const maps = readFileSync(`/proc/${id}/maps`, 'utf8');
      const candidates = [...new Set(maps.split('\n').map(line => line.match(/\s(\/\S*\/(?:libEGL|libGLES|libGLX|libvulkan|libvk_swiftshader|libfreetype|libfontconfig|libLLVM)[^ /]*\.so[^ /]*)$/u)?.[1]).filter(Boolean))].sort();
      const libraries = candidates.slice(0, 20).map(path => ({
        name: basename(path),
        sha256: statSync(path).size <= 256 * 1024 * 1024 ? sha256(readFileSync(path)) : null,
      }));
      return { type, status: 'read', libraries };
    } catch {
      return { type, status: 'unavailable' };
    }
  });
}

try {
  const { root, props, input } = await prepareSmokeInput(repository, scratch);
  const { collectTipV11StaticFiles } = await import(pathToFileURL(join(repository, 'scripts/tip-v11-render-manifest.mjs')).href);
  const inventory = await collectTipV11StaticFiles(repository);
  const overlayInventory = await collectTipV11StaticFiles(root);
  const expectedStatic = new Map(inventory.files);
  const overlayChanges = overlayInventory.files.filter(([path, digest]) => expectedStatic.get(path) !== digest);
  assert.deepEqual(overlayChanges.map(([path]) => path), ['scripts/render-tip-v11.mjs']);
  const launchFlags = await launchBrowser();
  const serveUrl = await bundle({ entryPoint: join(root, 'src/index.ts'),
    outDir: join(scratch, 'bundle'), publicDir: join(root, 'public'), enableCaching: false });
  const composition = await selectComposition({ serveUrl, id: 'TipV11Fr', inputProps: props,
    puppeteerInstance: browser, timeoutInMilliseconds: 20_000, logLevel: 'error' });
  assert.deepEqual([composition.width, composition.height, composition.fps, composition.durationInFrames],
    [width, height, 30, input.durationInFrames]);
  const captures = [];
  for (const frame of frames) {
    let pair;
    screenshotModule.screenshotTask = async options => {
      assert.equal(pair, undefined, 'Only the selected frame may be captured');
      pair = await picturePair(options);
      return pair.jpeg;
    };
    const piped = [];
    await renderFrames({ serveUrl, composition, inputProps: props, puppeteerInstance: browser,
      imageFormat: 'jpeg', jpegQuality: 80, chromiumOptions: { gl: 'angle' }, concurrency: 3, scale: 1,
      frameRange: [frame, frame], outputDir: null, cancelSignal, timeoutInMilliseconds: 20_000,
      logLevel: 'error', onStart() {}, onFrameUpdate() {}, onArtifact() {},
      onFrameBuffer(bytes, index) { piped.push({ frame: index, sha256: sha256(bytes) }); } });
    assert.ok(pair);
    const jpegSha = sha256(pair.jpeg);
    assert.deepEqual(piped, [{ frame, sha256: jpegSha }], 'Captured JPEG differs from Remotion buffer');
    const frameOutput = join(output, String(frame));
    mkdirSync(frameOutput, { mode: 0o700 });
    const jpeg = join(frameOutput, 'frame.jpg'), png = join(frameOutput, 'frame.png');
    writeFileSync(jpeg, pair.jpeg, { mode: 0o600, flag: 'wx' });
    writeFileSync(png, pair.png, { mode: 0o600, flag: 'wx' });
    captures.push({ frame, jpeg: { sha256: jpegSha, bytes: pair.jpeg.length,
      pixels: filePixels(jpeg, 'yuv420p', width * height * 3 / 2) },
    png: { sha256: sha256(pair.png), bytes: pair.png.length, pixels: filePixels(png, 'rgba', width * height * 4) },
    samePageBeforeAfter: true, state: pair.state, captureCommands: pair.commands });
  }
  const observedGpu = (await browser.connection.send('SystemInfo.getInfo')).value.gpu;
  const browserVersion = (await browser.connection.send('Browser.getVersion')).value;
  assert.ok(observedGpu?.devices?.length && observedGpu.auxAttributes);
  if (mode === 'parity') assert.match(browserVersion.product, /\/149\.0\.7790\.0$/u);
  const receipt = { schema: 'jamm-v11-three-still-capture-v1', mode, syntheticOnly: true, publishable: false,
    sourceSha, treeSha: git('rev-parse', 'HEAD^{tree}'), admission, input, inventory, overlayChanges,
    environment: { platform: process.platform, arch: process.arch, node: process.version,
      requestedGl: 'angle', launchFlags, browser: { sha256: browserSha, version: browserVersion },
      bundledFfmpeg: { sha256: sha256(readFileSync(ffmpeg)) },
      preparationTools: Object.fromEntries([['ffmpeg', '-version'], ['ffprobe', '-version'], ['python3', '--version']]
        .map(([tool, option]) => {
          const path = execFileSync('which', [tool], { encoding: 'utf8', timeout: 5_000 }).trim();
          return [tool, { sha256: sha256(readFileSync(path)),
            version: execFileSync(path, [option], { encoding: 'utf8', timeout: 5_000 }).split('\n')[0] }];
        })),
      observedGpu, libraries: await mappedBrowserLibraries() },
    render: { composition: 'TipV11Fr', width, height, fps: 30, requestedConcurrency: 3,
      frameLimitPerPass: 1, videoEncoderStarted: false }, captures };
  const receiptBytes = `${JSON.stringify(receipt, null, 2)}\n`;
  assert.ok(Buffer.byteLength(receiptBytes) <= 256 * 1024);
  assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '');
  writeFileSync(join(output, 'receipt.json'), receiptBytes, { mode: 0o600, flag: 'wx' });
} finally {
  screenshotModule.screenshotTask = originalScreenshotTask;
  clearTimeout(timer);
  if (browser) await browser.close({ silent: true });
  rmSync(scratch, { recursive: true, force: true });
}
