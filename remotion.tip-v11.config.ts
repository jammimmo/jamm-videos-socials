import './remotion.config';
import { Config } from '@remotion/cli/config';
import type { FfmpegOverrideFn } from '@remotion/renderer';

Config.setAudioBitrate('128k');

export const tipV11FfmpegOverride: FfmpegOverrideFn = ({ type, args }) => {
  // V11-only: fixed x264 threads and CPU path match the measured Linux pair.
  // Facebook Reels requires closed GOPs of 2–5 seconds. V11 runs at 30 fps.
  const outputArgs = args.includes('libx264')
    ? [...args.slice(0, -1), '-threads:v', '1', '-x264-params', 'open-gop=0:keyint=90:scenecut=0:asm=0', args[args.length - 1]]
    : args;
  if (type !== 'stitcher') return outputArgs;
  const flags = args.indexOf('-movflags');
  if (flags < 0 || args[flags + 1] !== 'faststart') {
    throw new Error('V11 MP4 muxer did not provide its expected faststart flags');
  }
  return [
    ...outputArgs.slice(0, flags + 1), 'faststart+negative_cts_offsets',
    '-use_editlist', '0', ...outputArgs.slice(flags + 2),
  ];
};

Config.overrideFfmpegCommand(tipV11FfmpegOverride);
