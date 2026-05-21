import React from 'react';
import { AbsoluteFill, useCurrentFrame, interpolate, Easing } from 'remotion';

type Props = {
  color: string;
  durationInFrames: number;
};

// A quick energetic wipe between sections
export const Transition: React.FC<Props> = ({ color, durationInFrames }) => {
  const frame = useCurrentFrame();
  const progress = frame / durationInFrames;

  // Diagonal wipe
  const skew = interpolate(progress, [0, 0.5, 1], [-15, 0, 15]);
  const translateX = interpolate(
    progress,
    [0, 0.5, 1],
    [-1200, 0, 1200],
    { easing: Easing.bezier(0.65, 0, 0.35, 1) }
  );

  // Strip 2 offset
  const translateX2 = interpolate(
    progress,
    [0, 0.5, 1],
    [-1400, 0, 1400],
    { easing: Easing.bezier(0.65, 0, 0.35, 1) }
  );

  const opacity = interpolate(progress, [0, 0.15, 0.85, 1], [0, 1, 1, 0]);

  return (
    <AbsoluteFill style={{ overflow: 'hidden', pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          top: '-20%',
          left: 0,
          width: '140%',
          height: '60%',
          background: color,
          transform: `translateX(${translateX}px) skewX(${skew}deg)`,
          opacity,
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '-20%',
          left: 0,
          width: '140%',
          height: '60%',
          background: '#0A1929',
          transform: `translateX(${translateX2}px) skewX(${skew}deg)`,
          opacity,
        }}
      />
    </AbsoluteFill>
  );
};
