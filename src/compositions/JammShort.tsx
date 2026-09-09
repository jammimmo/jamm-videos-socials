import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from 'remotion';
import { Hook } from '../components/short/Hook';
import { Scene } from '../components/short/Scene';
import { Ending } from '../components/short/Ending';
import { BrandBorder } from '../components/short/BrandBorder';
import { CommercialWebsite } from '../components/short/SocialBranding';
import {
  SURA_FILE,
  SURA_ORIGINAL_DURATION_SEC,
  SURA_TARGET_DURATION_SEC,
  SURA_VOLUME,
  VOICEOVER_VOLUME,
} from '../data/audio-config';
import type { VideoSpec } from '../data/videos';
import { SpokenTip } from './SpokenTip';

// Timeline (frames @ 30fps):
// 0–75   Hook (2.5s)
// 75–270 Scene 1 (6.5s)
// 270–450 Scene 2 (6s)
// 450–630 Scene 3 (6s)
// 630–810 Scene 4 (6s)
// 810–990 Scene 5 (6s)
// 990–1350 Ending (12s)

const SEGMENTS = [
  { type: 'hook' as const, from: 0, duration: 75 },
  { type: 'scene' as const, from: 75, duration: 195, sceneIndex: 0 },
  { type: 'scene' as const, from: 270, duration: 180, sceneIndex: 1 },
  { type: 'scene' as const, from: 450, duration: 180, sceneIndex: 2 },
  { type: 'scene' as const, from: 630, duration: 180, sceneIndex: 3 },
  { type: 'scene' as const, from: 810, duration: 180, sceneIndex: 4 },
  { type: 'ending' as const, from: 990, duration: 360 },
];

export const TOTAL_DURATION_FRAMES = 1350;

export type JammShortProps = {
  spec: VideoSpec;
  // 'silent'   => no audio. Use this in Studio when neither voiceover nor sourate exists yet.
  // 'voice-only' => voiceover only.
  // 'full'     => voiceover + sourate. Used by render-batch in CI.
  audioMode: 'silent' | 'voice-only' | 'full';
  // Dispatched tips: the exact caption sentence owns its own checked WAV.
  sceneVoices?: boolean;
  sceneFrames?: number[];
  continuousVoice?: boolean;
};

export const JammShort: React.FC<JammShortProps> = ({ spec, audioMode, sceneVoices = false, sceneFrames, continuousVoice = false }) => {
  const { fps } = useVideoConfig();
  if (spec.template === 'spoken-tip-v2') return <SpokenTip spec={spec} sceneFrames={sceneFrames} audioMode={audioMode}/>;
  if (continuousVoice && (!sceneFrames || sceneVoices)) throw new Error('Continuous voice requires one measured timeline');
  if (sceneFrames && (sceneFrames.length !== 5
    || sceneFrames.some((n) => !Number.isInteger(n) || n < 60)
    || sceneFrames.reduce((a, b) => a + b, 0) !== 915)) {
    throw new Error('Invalid measured scene timeline');
  }
  let sceneStart = 75;
  const segments = SEGMENTS.map((segment) => {
    if (segment.type !== 'scene' || !sceneFrames) return segment;
    const duration = sceneFrames[segment.sceneIndex];
    const adjusted = { ...segment, from: sceneStart, duration };
    sceneStart += duration;
    return adjusted;
  });

  const voiceSrc = staticFile(`audio/voiceovers/${spec.id}.wav`);
  const suraSrc = staticFile(SURA_FILE);

  const showVoice = audioMode === 'voice-only' || audioMode === 'full';
  const showSura = audioMode === 'full' && SURA_ORIGINAL_DURATION_SEC > 0;
  const suraRate = showSura ? SURA_ORIGINAL_DURATION_SEC / SURA_TARGET_DURATION_SEC : 1;

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {segments.map((seg, i) => {
        if (seg.type === 'hook') {
          return (
            <Sequence key={i} from={seg.from} durationInFrames={seg.duration}>
              <Hook spec={spec.hook} durationInFrames={seg.duration} />
            </Sequence>
          );
        }
        if (seg.type === 'scene') {
          const sceneSpec = spec.scenes[seg.sceneIndex];
          return (
            <Sequence key={i} from={seg.from} durationInFrames={seg.duration}>
              <Scene spec={sceneSpec} durationInFrames={seg.duration} />
              {showVoice && sceneVoices && (
                <Audio
                  src={staticFile(`audio/voiceovers/${spec.id}-scene-${seg.sceneIndex + 1}.wav`)}
                  volume={VOICEOVER_VOLUME}
                />
              )}
            </Sequence>
          );
        }
        return (
          <Sequence key={i} from={seg.from} durationInFrames={seg.duration}>
            <Ending durationInFrames={seg.duration} />
          </Sequence>
        );
      })}

      {/* Voice-over — full duration, plays at natural rate */}
      {showVoice && !sceneVoices && !continuousVoice && (
        <Audio src={voiceSrc} volume={VOICEOVER_VOLUME} />
      )}
      {showVoice && continuousVoice && (
        <Sequence from={75} durationInFrames={915}>
          <Audio src={voiceSrc} volume={VOICEOVER_VOLUME} />
        </Sequence>
      )}

      {/* Background sourate — sped up to fit 44s, silenced for the final 1s */}
      {showSura && (
        <Audio
          src={suraSrc}
          volume={SURA_VOLUME}
          playbackRate={suraRate}
          endAt={SURA_TARGET_DURATION_SEC * fps}
        />
      )}

      {/* Persistent brand border on top of everything */}
      <BrandBorder />
      <CommercialWebsite />
    </AbsoluteFill>
  );
};
