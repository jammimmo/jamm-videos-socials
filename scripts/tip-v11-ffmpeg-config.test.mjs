import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { tipV11FfmpegOverride } from '../remotion.tip-v11.config.ts';
const require = createRequire(import.meta.url);
const cli = dirname(require.resolve('@remotion/cli'));
const { getFfmpegOverrideFunction } = require(join(cli, 'config/ffmpeg-override.js'));

test('the V11 config registers deterministic x264 for its real pre-stitcher callback', () => {
  assert.equal(getFfmpegOverrideFunction(), tipV11FfmpegOverride);
  const args = ['-f', 'image2pipe', '-i', '-', '-c:v', 'libx264', '-crf', '18', '-y', 'preencoded.mp4'];
  const before = [...args];
  assert.deepEqual(tipV11FfmpegOverride({ type: 'pre-stitcher', args }), [
    ...args.slice(0, -1), '-threads:v', '1', '-x264-params',
    'open-gop=0:keyint=90:scenecut=0:asm=0', 'preencoded.mp4',
  ]);
  assert.deepEqual(args, before);
});

test('a direct x264 stitch retains deterministic encoding and the existing Meta mux rules', () => {
  const result = tipV11FfmpegOverride({ type: 'stitcher', args: [
    '-i', 'frames', '-c:v', 'libx264', '-movflags', 'faststart', 'out.mp4',
  ] });
  assert.deepEqual(result, ['-i', 'frames', '-c:v', 'libx264', '-movflags',
    'faststart+negative_cts_offsets', '-use_editlist', '0', '-threads:v', '1',
    '-x264-params', 'open-gop=0:keyint=90:scenecut=0:asm=0', 'out.mp4']);
});

test('copy-only muxing receives no encoder options and retains the existing fail-closed mux contract', () => {
  assert.deepEqual(tipV11FfmpegOverride({ type: 'stitcher', args: [
    '-c:v', 'copy', '-movflags', 'faststart', 'out.mp4',
  ] }), ['-c:v', 'copy', '-movflags', 'faststart+negative_cts_offsets', '-use_editlist', '0', 'out.mp4']);
  assert.throws(() => tipV11FfmpegOverride({ type: 'stitcher', args: ['-c:v', 'copy', 'out.mp4'] }), /expected faststart/);
  const audio = ['-c:a', 'aac', 'audio.aac'];
  assert.deepEqual(tipV11FfmpegOverride({ type: 'pre-stitcher', args: audio }), audio);
});
