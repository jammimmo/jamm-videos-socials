// The Gemini writer emits this exact PCM WAV shape. Reject malformed/truncated
// cache entries instead of publishing a cut-off or unverified audio track.
export function pcmWavDuration(bytes) {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.toString('ascii', 8, 12) !== 'WAVE'
    || bytes.toString('ascii', 12, 16) !== 'fmt '
    || bytes.readUInt32LE(16) !== 16 || bytes.readUInt16LE(20) !== 1
    || bytes.readUInt16LE(22) !== 1 || bytes.readUInt32LE(24) !== 24000
    || bytes.readUInt32LE(28) !== 48000 || bytes.readUInt16LE(32) !== 2
    || bytes.readUInt16LE(34) !== 16 || bytes.toString('ascii', 36, 40) !== 'data'
    || bytes.readUInt32LE(4) !== bytes.length - 8
    || bytes.readUInt32LE(40) !== bytes.length - 44
    || bytes.length <= 44 || (bytes.length - 44) % 2 !== 0) {
    throw new Error('Invalid scene voice PCM WAV');
  }
  return (bytes.length - 44) / 48000;
}

export function sceneVoiceSpecs(spec) {
  if (!/^tip-[0-9a-f-]{36}$/i.test(spec.id) || spec.scenes?.length !== 5) {
    throw new Error('Scene voice requires a dispatched five-scene tip');
  }
  return spec.scenes.map((scene, index) => {
    if (typeof scene.voiceoverFr !== 'string' || !scene.voiceoverFr.trim()) {
      throw new Error(`Missing French voice for scene ${index + 1}`);
    }
    return {
      id: `${spec.id}-scene-${index + 1}`,
      title: spec.title,
      voiceoverScript: scene.voiceoverFr,
    };
  });
}

export function assertSceneVoiceFits(bytes, index) {
  if (!Number.isInteger(index) || index < 0 || index > 4) throw new Error('Invalid scene index');
  const seconds = pcmWavDuration(bytes);
  // Keep a 100ms tail before the caption changes; never speed up or truncate.
  const available = (index === 0 ? 6.5 : 6) - 0.1;
  if (seconds > available) throw new Error(`Scene ${index + 1} voice exceeds ${available}s; shorten its script before rendering`);
  return seconds;
}

// Preserve the 45-second delivery contract (hook 75 + scenes 915 + ending 360).
// Allocate the scene budget from measured audio, never truncate or speed up.
export function allocateSceneFrames(durations) {
  if (durations.length !== 5 || durations.some((s) => !Number.isFinite(s) || s <= 0)) {
    throw new Error('Five valid measured voice durations required');
  }
  const frames = durations.map((s) => Math.max(60, Math.ceil(s * 30) + 6));
  const spare = 915 - frames.reduce((a, b) => a + b, 0);
  if (spare < 0) throw new Error('Complete voice exceeds the 45-second scene budget; shorten the script');
  return frames.map((n, i) => n + Math.floor(spare / 5) + (i < spare % 5 ? 1 : 0));
}
