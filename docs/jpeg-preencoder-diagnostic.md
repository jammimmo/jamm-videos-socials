# One-image JPEG preencoder diagnostic

This diagnostic does not change any product renderer, comparator or permission.
The committed JPEG is synthetic: integer RGB gradients and tile edges at
1080×1920, encoded once by the existing macOS `sips` tool at quality80. It is
not regenerated on runners. Its required SHA256 is
3e17370f1c3d78db7774d9366389a47cc8efbefef1a2389d9e76250794b409ed.
Asset creation is not a decoded-output validation. No local FFmpeg oracle run
was performed; only JavaScript/shell/YAML syntax is checked before review.

The script invokes the real Remotion bundled FFmpeg twice: default CPU flags
and cpuflags0. Each invocation accepts the same JPEG through the real MJPEG
image2pipe path and emits one raw YUV420p frame through rawvideo/image2pipe,
without x264, browser, audio, Python, ASR or TTS. Timeout15seconds per conversion;
exact output length3,110,400bytes, global/Y/U/V SHA256 and elapsed seconds are
required. It records the actual stream format descriptions and binary/source/
lock/input hashes. Environment variables and pixel bytes are not serialized.
The temporary JPEG copy is removed in finally; raw output stays in memory.
The existing reviewed network isolation envelope runs the diagnostic after
locked npm installation. Only the numeric receipt is exported.

Cross-host comparison must first require equal exact source, lock, JPEG SHA,
system and bundled FFmpeg versions/hashes and dimensions. Compare default to
default and cpuflags0 to cpuflags0; a conversion mode can legitimately change
pixels within one host. Mismatch for the same JPEG implicates the MJPEG decoding/
conversion stage. Equality for this one image does not establish equality for
all possible Chromium JPEG streams or actual V11 captures. This is a localization
probe, never a switch qualification or replacement for the strict comparator.
