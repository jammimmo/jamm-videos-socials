import React from 'react';
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion';
import { PhotoBackdrop } from './PhotoBackdrop';
import { SubtitleBar } from './SubtitleBar';
import { LogoWatermark } from './LogoWatermark';
import { SCENE_VISUALS } from '../../data/scene-visuals';
import type { SceneSpec } from '../../data/videos';

export const Scene: React.FC<{ spec: SceneSpec; durationInFrames: number }> = ({ spec, durationInFrames }) => {
  const frame = useCurrentFrame();
  const Visual = SCENE_VISUALS[spec.visualType];

  // Cross-fade in/out so scene-to-scene transitions feel cinematic
  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity = fadeIn * fadeOut;

  return (
    <AbsoluteFill style={{ opacity }}>
      <PhotoBackdrop photoPath={spec.photoBg} durationInFrames={durationInFrames} />
      {/* Visual fills the top ~55% of the frame, leaving room for the
          caption stack at the bottom. Top padding shrunk so the visual
          no longer floats in the middle with dead space above. */}
      <AbsoluteFill style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 60, paddingLeft: 60, paddingRight: 60, paddingBottom: 700 }}>
        <Visual variant={spec.variant} durationInFrames={durationInFrames} />
      </AbsoluteFill>
      <LogoWatermark />
      <SubtitleBar
        text={spec.subtitle}
        textEn={spec.subtitleEn}
        voiceoverFr={spec.voiceoverFr}
        voiceoverEn={spec.voiceoverEn}
      />
    </AbsoluteFill>
  );
};
