# Diagnostic intervention: one shared explicit SwiftShader backend

Prepared from exact diagnostic148fc51d81291d09ea2d4985a50b7431f816c3c9.
No product file, dependency, switch comparator or production runtime changes.
Production GitHub delivery is independent of this unresolved mini-PC parity probe.
No browser, bundle, image decode, video, ASR/TTS or remote run was executed while
preparing this patch. Only JavaScript/shell syntax and diff checks are performed.

The existing successful paired evidence is preserved:
- Hosted44194087890 and reused mini44192460820 have equal source/props/assets/
  fonts/capture commands but different lossless PNG and JPEG decoded pixels.
- Actual graphics: hosted Disabled/SkiaNone, mini Vulkan llvmpipe/GaneshGL.

Hypothesis: explicitly selecting a common bundled SwiftShader backend removes
the observed pre-JPEG disagreement for this same synthetic intro frame.

Only the diagnostic browser request changes angle→swangle. The actual V11 config
remains angle and its loaded getter is still asserted. Props, fixture, frame60,
1080×1920, exact font/glyph guards, original JPEG80 buffer, same-state opaque PNG,
source/binary hashes, image length checks and existing isolation/bounds remain.
The input hash must remain the148 baseline's29c05f8f…907f4. No60-second video.

## Effective flags, not a claimed config value

Installed Remotion4.0.464 CommonJS open-browser maps swangle to
`--use-gl=angle --use-angle=swiftshader`. A diagnostic in-process wrapper asserts
the actual CJS openBrowser export and require-cache child chain through Launcher,
Browser and BrowserRunner. It observes the actual native ChildProcess.spawnargs,
including normal vendor setpriv wrapping, and requires exactly those GL/ANGLE
flags and no --disable-gpu override. It records only relevant flags/executable,
never environment or temporary browser profile contents. The stdlib spawn method
is restored in finally; installed module files are never edited. A failed flag
proof kills that newly created process and aborts. Exactly one browser spawn is
required. The normal vendor download/provisioning path is unchanged.

After capture, the existing SystemInfo report must actually identify SwiftShader
in glRenderer, with neither Disabled nor llvmpipe. Keep the full observed GPU/
Skia fields, not an inferred label from requested flags. A backend mismatch is
an invalid intervention, not a passing media comparison.

## Minimal reviewed invocation (not run)

On each already qualified Linux runner, check out the exact reviewed new SHA;
use the unchanged Node22.20/npm10.9.3 and FFmpeg prerequisites. Then:

```bash
mkdir "$RUNNER_TEMP/swangle-one-frame"
TIP_PARITY_EXPECTED_SHA="$REVIEWED_SHA" bash scripts/check-tip-single-frame.sh "$RUNNER_TEMP/swangle-one-frame"
```

This wrapper still performs locked npm preparation and normal Chromium ensure
before isolated one-frame capture. It exports only receipt.json/frame.jpg/frame.png
within existing size caps. No new carrier or dispatch is prepared by this patch.

Compare new-host receipts only after matching exact source/input/inventory/
fonts/binaries/capture proof and observed backend. First compare decoded PNG RGBA,
then JPEG YUV420p; capture-container byte equality remains informative. If both
hosts actually use SwiftShader and PNG pixels agree, this supports the backend
intervention for this sample. If PNG differs, the backend label alone is not
sufficient. One successful frame never qualifies full V11 or a production switch.
No faster or broader raster/product change is inferred or applied here.
