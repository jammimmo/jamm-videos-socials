# Single synthetic V11 frame: review plan

No product file, global config, comparator, dependency or installed module is
changed. This diagnostic is based on d60f33f. The original90e8 diagnostic failed
before producing capture evidence; the corrected version has not been rendered.

## Input and bounded work

Use the same fixture title/body and buildTipV11Narration as the existing smoke,
with explicit diagnostic timings (four seconds per segment), empty audio and a
synthetic warning caption. At frame 60 / 30fps the real V11 greeting drawing,
text, logo, fonts and opaque background are rendered by the actual composition.
These are intentionally new fixed props, not recovered timings from the previous
60-second smoke. The full props/frame/source inventory/config are hashed and
must match between hosts before comparing pixels. Source/fonts/assets are from
the unchanged checkout. The public scratch folder contains only public/tip-v11,
as in the original smoke.

One frame through renderFrames, concurrency=3, scale=1, gl=angle, JPEG quality80,
headless-shell with the same pinned Chromium. A single requested frame means
one active render tab; this does not reproduce the full render's scheduling.
No renderStill, video encoding, audio, Python, alignment, model, ASR or TTS.

## Instrumentation without changing installed files

The90e8 hosted failure exposed separate renderer module instances: ESM imports
resolve the bundled dist/esm/index.mjs, whereas the hook targeted CommonJS
screenshot-task.js. The corrected process obtains every renderer API and the
bundler with require, so the rendering path and hook share CommonJS instances.
Admission runs before ensureBrowser/openBrowser/bundle/capture: verify public
function identity against each defining CJS module and the actual require-cache
child chain through render-frames, retry wrapper, render-frame, take-frame,
puppeteer-screenshot and screenshot-task. Then invoke actual takeFrame with a
stub page, stub evaluation and a sentinel screenshot hook; require one call and
exact returned buffer identity. Restore both stubs in finally. This admission
opens no browser and captures no image; it is also covered by a local unit test.
Its measured module/code hashes and dispatch counts are retained in the receipt.
The actual capture still must match onFrameBuffer and all previous guards.


Load the actual V11 config and assert its installed getters resolve angle,
video image format jpeg and quality80. Wrap only the in-process CommonJS export
screenshotTask, which takeFrame/puppeteer-screenshot calls. The original JPEG
screenshot task runs unchanged. Assert actual task arguments and record actual
CDP Page.captureScreenshot commands: JPEG80, clip1080×1920, scale1,
optimizeForSpeed=true, fromSurface=true and captureBeyondViewport=true.
Hash the returned original JPEG, then verify it equals the exact renderFrames
onFrameBuffer bytes for frame60. No x264 is spawned.

Immediately call the same original task on that same page for PNG, with
omitBackground=false. This deliberately avoids takeFrame's PNG-specific
transparent background mutation. Read DOM/font/background snapshots before and
after and require equality. Record every FontFace family/style/weight/status,
require the bundled Poppins600/700/800 faces loaded and reject any error/unloaded
face. For every visible direct text run record actual text and computed font and
check FontFaceSet.check for that text. Because check can still accept fallback,
also use DOM/CSS CDP to record actual per-node platform font families, custom-font
identity and glyph counts. Text requesting Poppins must obtain all measured
glyphs from custom Poppins. Preserve these full before/after snapshots; DOM hashes
alone do not replace the font evidence. Restore
the in-process task and CDP wrappers in finally. No node_modules file is edited.

Decode the saved PNG as raw RGBA using actual bundled FFmpeg, verify exact length
and alpha255 for every pixel. Decode JPEG as YUV420p and verify exact length.
Compare hashes only between corresponding formats across hosts. Lossless PNG
RGBA equality is the pre-JPEG raster oracle; JPEG equality alone is not required
if decoded pixels match. Fixed backing + root opaque CSS + observed full-alpha
PNG establish an opaque screenshot, not a general proof for every V11 scene.

Observe graphics with browser-level CDP SystemInfo.getInfo after capture, keeping
actual GPU devices/auxiliary attributes and Browser.getVersion. Require reported
GL renderer/backend information; do not infer a device from the angle flag.
Record Chromium/bundled FFmpeg hashes and installed capture implementation hashes.

## Bounds and outputs

The reviewed empty-environment/network-namespace envelope is reused. npm installs
locked dependencies without lifecycle scripts; the existing Chromium preparation
runs before network isolation. No Python or system packages are installed by the
wrapper. No secrets/OIDC are passed. Only an empty temporary HOME, PATH, locale,
source SHA and isolation marker are forwarded.

Render cancellation at60s; total process timeout120s plus5s kill grace; each raw
image decode15s. No remote execution has occurred. Caps are4MiB per screenshot
and128KiB per receipt. Only a completed receipt + two synthetic screenshots leave
temporary storage. Scratch bundle/media are removed; failure exports no partial
images. Captures are explicitly nonpublishable synthetic diagnostics.

## Falsifiable comparison and limits

First require same exact source/input inventory/props/config/Chromium/bundled
FFmpeg/capture-code hashes. Compare PNG RGBA and JPEG YUV hashes separately:
- PNG pixels differ: divergence exists before JPEG compression/x264. GPU info
  is context, not proof that the GPU caused it.
- PNG pixels match, JPEG decoded pixels differ: isolate the JPEG capture path,
  then replay one actual captured common JPEG through the existing MJPEG oracle.
- Both decoded outputs match: this frame does not reproduce full-render drift.
  Do not claim the whole video passes or repeat60seconds automatically.

A DOM snapshot cannot detect every possible compositor race. A single intro
frame does not cover other scenes, transitions or concurrent tab scheduling.
The strict switch comparator and prior failed complete d60 result remain intact.
Any CPU/raster fix requires a reproduced discrepancy and a new coordinator decision.
