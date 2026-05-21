import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const VerbalHandshakeVisual: React.FC<SceneVisualProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });
  const fade = interpolate(frame, [durationInFrames - 60, durationInFrames - 10], [1, 0.3], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 720, height: 720, transform: `scale(${enter})` }}>
        {/* Handshake (faceless arms only) */}
        <svg viewBox="0 0 720 720" width="100%" height="100%" style={{ opacity: fade }}>
          {/* Left arm */}
          <path d="M 0,400 L 320,360 L 320,420 L 0,460 Z" fill={theme.jamm.blueDeep} />
          {/* Right arm */}
          <path d="M 720,360 L 400,400 L 400,460 L 720,420 Z" fill={theme.jamm.orange} />
          {/* Left hand */}
          <ellipse cx="350" cy="390" rx="80" ry="50" fill="#3a2316" />
          {/* Right hand */}
          <ellipse cx="370" cy="430" rx="80" ry="50" fill="#5a3a2a" />
          {/* Clasp */}
          <rect x="300" y="380" width="120" height="60" fill="#2a1810" rx="20" />
        </svg>

        {/* Question + speech bubble */}
        <div style={{ position: 'absolute', top: 40, left: '50%', transform: 'translateX(-50%)', padding: '20px 32px', background: 'white', borderRadius: 20, border: `4px solid ${theme.jamm.blue}`, fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 32, color: theme.jamm.blue }}>
          « D’accord, hein ? »
        </div>

        {/* Fade-out warning */}
        <div style={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', padding: '14px 28px', background: '#a93232', color: 'white', borderRadius: 12, fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 28, letterSpacing: 1, opacity: 1 - fade + 0.3 }}>
          AUCUNE PREUVE
        </div>
      </div>
    </AbsoluteFill>
  );
};
