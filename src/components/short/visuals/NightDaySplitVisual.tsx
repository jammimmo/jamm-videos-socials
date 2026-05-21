import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const NightDaySplitVisual: React.FC<SceneVisualProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });
  const split = interpolate(frame, [10, 60], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 720, height: 720, transform: `scale(${enter})`, borderRadius: 24, overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.4)' }}>
        {/* Day side */}
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, #87ceeb 0%, #ffb547 100%)`, clipPath: `polygon(0 0, ${50 + split * 0}% 0, ${50 - split * 50 + 50}% 100%, 0 100%)` }}>
          <div style={{ position: 'absolute', top: 80, left: 80, width: 140, height: 140, borderRadius: '50%', background: 'radial-gradient(circle, #fff7c2, #ffd95c)', boxShadow: '0 0 80px rgba(255,200,80,0.9)' }} />
        </div>
        {/* Night side */}
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, #0e1430 0%, #1a2150 100%)`, clipPath: `polygon(${50 - split * 0}% 0, 100% 0, 100% 100%, ${50 + split * 50 - 50}% 100%)` }}>
          <div style={{ position: 'absolute', top: 90, right: 100, width: 110, height: 110, borderRadius: '50%', background: '#f4eecf', boxShadow: '0 0 60px rgba(244,238,207,0.6)' }} />
          {[...Array(20)].map((_, i) => (
            <div key={i} style={{ position: 'absolute', left: 360 + (i * 17) % 320, top: 50 + (i * 23) % 400, width: 4, height: 4, borderRadius: '50%', background: 'white', opacity: 0.6 + Math.sin(frame * 0.1 + i) * 0.4 }} />
          ))}
        </div>
        {/* Shared building */}
        <svg viewBox="0 0 720 720" width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
          <rect x="220" y="280" width="280" height="440" fill={theme.jamm.blueDeep} />
          {[0, 1, 2, 3, 4, 5, 6].map((row) => [0, 1, 2].map((col) => (
            <rect key={`${row}-${col}`} x={240 + col * 84} y={300 + row * 56} width="68" height="36" fill={col + row * 3 < 11 ? '#f4d100' : '#1a2150'} />
          )))}
        </svg>
      </div>
    </AbsoluteFill>
  );
};
