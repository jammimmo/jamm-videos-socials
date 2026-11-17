# Bounded offline codec isolation

Run `node scripts/diagnose-tip-codec-parity.mjs /absolute/artifact-directory`.
Requires only the installed project packages and existing system FFmpeg. Produces
12 integer-generated 1080×1920 frames, eight short MP4s (auto/1/2/4 encoder threads,
each twice), encoder logs, executable hash/version, input hashes and per-frame
decoded hashes. No browser, real media, narration, providers or publication code.
Output is synthetic and not publishable. Keep artifacts outside tracked source.

The raw YUV is converted to PNG image2pipe by system FFmpeg because Remotion's
bundled FFmpeg does not enable its rawvideo demuxer. PNG pipe SHA must match before
comparing hosts; a source mismatch makes a codec comparison invalid. Encoder args
come from the installed Remotion generator, with V11's closed-GOP parameters. The
binary, library env and cwd use installed Remotion's resolution rules. Decoding
uses the system FFmpeg, as the existing parity comparator does.

Local macOS ARM64 observation, 2026-11-17: all four pairs repeat identically.
Auto selects x264 threads=12/lookahead_threads=2 and decodes to 45fffe45…1b253.
Explicit 1,2,4 select lookahead_threads=1 and all decode to a49a6722…39ce.
Identical browser-free input can therefore produce different decoded pixels with
Remotion's auto-thread encoder settings. This is measured thread sensitivity,
not proof of the prior Linux hosted/mini-PC discrepancy. No render default changed.

Next bounded experiment, requiring coordinator dispatch: run this exact script
on hosted Linux and mini-PC at one source tree, retain full output, compare raw
and PNG input hashes, actual bundled executable hashes and x264 log options, then
compare each fixed-thread decoded hash between hosts. No full V11/ASR/provider run.
If fixed-thread output matches but auto differs, test a V11-only explicit-thread
setting and three actual V11 browser stills before any complete parity rerender.
If codec hashes match for all settings, measure actual V11 still pixels (before
encoding), browser GL backend/driver and per-frame hashes to isolate rasterization.
The exact existing comparator remains unchanged and mini-PC remains unqualified.
