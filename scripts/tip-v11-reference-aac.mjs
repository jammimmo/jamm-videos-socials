import { RenderInternals } from '@remotion/renderer';

// V11 has one full-length mono PCM16 WAV at unit volume. Preserve Remotion's
// integer resampling and stereo conversion order before its pinned FDK encoder.
const [mix, output] = process.argv.slice(2);
await RenderInternals.callFf({
  bin: 'ffmpeg', binariesDirectory: null, indent: false, logLevel: 'error',
  args: ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', 'wav', '-i', mix,
    '-af', 'aformat=sample_fmts=s16:sample_rates=48000,aformat=sample_fmts=s16:channel_layouts=stereo',
    '-c:a', 'libfdk_aac', '-b:a', '128k', '-cutoff', '18000', '-f', 'adts', '-n', output],
});
