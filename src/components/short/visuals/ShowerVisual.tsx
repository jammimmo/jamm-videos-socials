import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const ShowerVisual: React.FC<SceneVisualProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 720, height: 720, transform: `scale(${enter})` }}>
        <svg viewBox="0 0 720 720" width="100%" height="100%">
          {/* Shower head */}
          <rect x="280" y="60" width="40" height="60" fill="#6e7793" rx="4" />
          <ellipse cx="300" cy="170" rx="110" ry="36" fill="#bcc4d6" stroke="#6e7793" strokeWidth="5" />
          {[...Array(7)].map((_, i) => (
            <circle key={i} cx={210 + i * 30} cy="195" r="6" fill="#4a536d" />
          ))}
          {/* Tiled wall */}
          {[...Array(8)].map((_, r) => [...Array(10)].map((_, c) => (
            <rect key={`${r}-${c}`} x={c * 72} y={r * 80 + 240} width="68" height="76" fill={(r + c) % 2 === 0 ? '#e2e8f4' : '#cdd5e8'} stroke="white" strokeWidth="2" />
          )))}
        </svg>

        {/* Water streams (animated lines) */}
        {[...Array(20)].map((_, i) => {
          const x = 200 + (i % 10) * 30;
          const cycle = (frame * 6 + i * 8) % 380;
          const y1 = 210 + cycle;
          const opacity = interpolate(cycle, [0, 40, 340, 380], [0, 0.9, 0.9, 0]);
          return (
            <div key={i} style={{ position: 'absolute', left: x - 2, top: y1, width: 4, height: 24, background: '#4ec0ff', borderRadius: 2, opacity }} />
          );
        })}

        {/* Pressure indicator */}
        <div style={{ position: 'absolute', right: 30, top: 320, padding: '14px 28px', borderRadius: 20, background: theme.jamm.orange, color: 'white', fontSize: 30, fontWeight: 900, fontFamily: theme.fonts.display, transform: 'rotate(-6deg)', boxShadow: '0 12px 24px rgba(0,0,0,0.4)' }}>
          PRESSION ?
        </div>
      </div>
    </AbsoluteFill>
  );
};
