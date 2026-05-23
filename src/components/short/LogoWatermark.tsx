import React from 'react';
import { Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../styles/theme';

// Small persistent logo badge that sits in the top-right corner of a scene.
// Keeps the JAMM IMMO brand on screen throughout the 30s of scene playback
// without overwhelming the central subtitle/visual area.

export const LogoWatermark: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16, stiffness: 110 } });

  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        right: 60,
        zIndex: 50,
        opacity: enter * 0.92,
        transform: `scale(${interpolate(enter, [0, 1], [0.7, 1])})`,
      }}
    >
      <div
        style={{
          background: 'rgba(45, 52, 143, 0.92)',
          padding: '8px 12px',
          borderRadius: 12,
          border: `3px solid ${theme.jamm.orange}`,
          boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
          backdropFilter: 'blur(6px)',
        }}
      >
        <Img
          src={staticFile('jamm-logo-trim.png')}
          style={{ width: 320, height: 'auto', display: 'block', borderRadius: 4 }}
        />
      </div>
    </div>
  );
};
