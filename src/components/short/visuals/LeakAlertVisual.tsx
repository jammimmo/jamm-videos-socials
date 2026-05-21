import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const LeakAlertVisual: React.FC<SceneVisualProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });
  const alertPulse = 1 + Math.sin(frame * 0.25) * 0.1;

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 720, height: 720, transform: `scale(${enter})` }}>
        <svg viewBox="0 0 720 720" width="100%" height="100%">
          {/* Pipe */}
          <rect x="120" y="240" width="480" height="80" fill="#6e7793" rx="8" stroke="#4a536d" strokeWidth="4" />
          {/* Joint */}
          <rect x="320" y="220" width="80" height="120" fill="#4a536d" rx="4" />
          {/* Crack */}
          <path d="M 340,280 L 360,300 L 350,320" fill="none" stroke="#a93232" strokeWidth="6" />
          {/* Pool */}
          <ellipse cx="360" cy="600" rx="200" ry="40" fill="#4ec0ff" opacity="0.7" />
          <ellipse cx="360" cy="600" rx="200" ry="40" fill="none" stroke="#2e8fc4" strokeWidth="4" />
        </svg>

        {/* Drops */}
        {[...Array(6)].map((_, i) => {
          const cyc = (frame * 5 + i * 24) % 320;
          const dy = 320 + cyc;
          const opacity = interpolate(cyc, [0, 30, 270, 320], [0, 1, 1, 0]);
          return (
            <div key={i} style={{ position: 'absolute', left: 348 + (i % 2 ? 6 : -6), top: dy, width: 14, height: 20, borderRadius: '50% 50% 50% 0', background: '#4ec0ff', transform: 'rotate(-45deg)', opacity }} />
          );
        })}

        {/* Alert badge */}
        <div style={{ position: 'absolute', top: 30, right: 30, padding: '20px 32px', borderRadius: 999, background: '#a93232', color: 'white', fontSize: 48, fontWeight: 900, fontFamily: theme.fonts.display, transform: `scale(${alertPulse})`, boxShadow: '0 16px 32px rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', gap: 12 }}>
          ⚠️ FUITE
        </div>

        {/* Cost ticker */}
        <div style={{ position: 'absolute', bottom: 30, left: 30, padding: '14px 24px', borderRadius: 16, background: theme.jamm.orange, color: 'white', fontSize: 32, fontWeight: 900, fontFamily: theme.fonts.display }}>
          + 50 000 CFA / mois
        </div>
      </div>
    </AbsoluteFill>
  );
};
