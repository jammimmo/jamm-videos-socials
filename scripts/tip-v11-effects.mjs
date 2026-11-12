const SAMPLE_RATE = 24000;
const accents = {
  step1: [420, .11, .004],
  step2: [470, .11, .004],
  step3: [520, .11, .004],
  domain: [590, .065, .004],
  contact: [590, .065, .0035],
  phone: [590, .065, .003],
  socials: [620, .14, .004],
};

// Original procedural accents follow the measured cues, independent of the advice topic.
export function tipV11Effects(segments, durationInFrames) {
  const samples = durationInFrames * (SAMPLE_RATE / 30);
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);

  function accent(at, frequency, seconds, gain) {
    const start = Math.round(at * SAMPLE_RATE);
    const length = Math.min(Math.round(seconds * SAMPLE_RATE), samples - start);
    for (let index = 0; index < length; index++) {
      const t = index / SAMPLE_RATE;
      const envelope = Math.sin(Math.PI * t / seconds) ** 2 * Math.exp(-18 * t);
      const sound = Math.round(Math.sin(2 * Math.PI * frequency * t) * envelope * gain * 32767);
      const offset = 44 + (start + index) * 2;
      wav.writeInt16LE(wav.readInt16LE(offset) + sound, offset);
    }
  }

  for (const segment of segments) {
    const params = accents[segment.id];
    if (params) accent(segment.start, ...params);
    if (segment.id === 'assistant') {
      for (const delay of [.15, .29, .43]) accent(segment.start + delay, 780, .065, .0035);
    }
  }
  return wav;
}
