import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { decodedTipMediaFingerprints } from './tip-decoded-media-fingerprint.mjs';

test('decoded fingerprints ignore container tags and distinguish changes to either stream', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'jamm-tip-stream-hashes-test-'));
  const ffmpeg = (...args) => execFileSync('ffmpeg', ['-nostdin', '-v', 'error', ...args], { timeout: 15_000 });
  try {
    const original = join(scratch, 'original.mp4');
    const tagged = join(scratch, 'tagged.mp4');
    const otherAudio = join(scratch, 'other-audio.mp4');
    const otherVideo = join(scratch, 'other-video.mp4');
    ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '0.3', '-c:v', 'mpeg4', '-c:a', 'aac', '-ac', '2', original);
    ffmpeg('-i', original, '-c', 'copy', '-metadata', 'title=Changed container metadata', tagged);
    assert.notDeepEqual(readFileSync(tagged), readFileSync(original));

    const baseline = decodedTipMediaFingerprints(original);
    assert.match(baseline.decodedVideoSha256, /^[a-f0-9]{64}$/u);
    assert.match(baseline.decodedAudioSha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(decodedTipMediaFingerprints(tagged), baseline);

    ffmpeg('-i', original, '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000',
      '-t', '0.3', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-ac', '2', otherAudio);
    const audioChanged = decodedTipMediaFingerprints(otherAudio);
    assert.equal(audioChanged.decodedVideoSha256, baseline.decodedVideoSha256);
    assert.notEqual(audioChanged.decodedAudioSha256, baseline.decodedAudioSha256);

    ffmpeg('-i', original, '-f', 'lavfi', '-i', 'color=red:size=64x48:rate=10',
      '-t', '0.3', '-map', '1:v:0', '-map', '0:a:0', '-c:v', 'mpeg4', '-c:a', 'copy', otherVideo);
    const videoChanged = decodedTipMediaFingerprints(otherVideo);
    assert.notEqual(videoChanged.decodedVideoSha256, baseline.decodedVideoSha256);
    assert.equal(videoChanged.decodedAudioSha256, baseline.decodedAudioSha256);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
