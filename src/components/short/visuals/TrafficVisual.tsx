import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const TrafficVisual: React.FC<SceneVisualProps> = ({ variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });

  const isMorning = variant === 'morning';
  const isEvening = variant === 'evening';
  const sky = isEvening
    ? 'linear-gradient(180deg, #6c2f8e 0%, #ff7a45 70%, #ffb547 100%)'
    : isMorning
    ? 'linear-gradient(180deg, #87ceeb 0%, #ffd6a3 100%)'
    : 'linear-gradient(180deg, #4a536d 0%, #7a8aab 100%)';

  const carShift = (frame * 0.6) % 80;

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 720, height: 720, transform: `scale(${enter})`, borderRadius: 24, overflow: 'hidden', background: sky, boxShadow: '0 16px 48px rgba(0,0,0,0.4)' }}>
        {/* Distant skyline */}
        <svg viewBox="0 0 720 720" width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
          {[80, 180, 280, 400, 520, 620].map((x, i) => (
            <rect key={i} x={x - 30} y={340 - (i % 3) * 40} width="60" height={140 + (i % 3) * 40} fill={theme.jamm.blueDeep} opacity="0.7" />
          ))}
          {/* Road */}
          <rect x="0" y="480" width="720" height="240" fill="#2a2e3a" />
          {/* Lane lines */}
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <rect key={i} x={i * 90 + (carShift % 90) - 60} y="595" width="40" height="6" fill="white" />
          ))}
        </svg>

        {/* Cars (stacked, all stuck) */}
        {[
          { x: 80, y: 540, color: '#a93232' },
          { x: 220, y: 560, color: '#3a45a8' },
          { x: 360, y: 540, color: theme.jamm.orange },
          { x: 500, y: 560, color: '#4ADE80' },
          { x: 100, y: 620, color: '#f4d100' },
          { x: 260, y: 640, color: '#a93232' },
          { x: 420, y: 620, color: '#3a45a8' },
          { x: 560, y: 640, color: 'white' },
        ].map((car, i) => (
          <div key={i} style={{ position: 'absolute', left: car.x, top: car.y, width: 110, height: 56, background: car.color, borderRadius: '20px 28px 8px 28px', boxShadow: '0 8px 16px rgba(0,0,0,0.4)' }}>
            <div style={{ position: 'absolute', top: 6, left: 18, right: 18, height: 22, background: 'rgba(255,255,255,0.4)', borderRadius: 4 }} />
            <div style={{ position: 'absolute', bottom: -10, left: 14, width: 22, height: 22, borderRadius: '50%', background: '#111', border: '3px solid #555' }} />
            <div style={{ position: 'absolute', bottom: -10, right: 14, width: 22, height: 22, borderRadius: '50%', background: '#111', border: '3px solid #555' }} />
          </div>
        ))}

        {/* Time stamp */}
        <div style={{ position: 'absolute', top: 30, right: 30, padding: '12px 22px', borderRadius: 12, background: 'rgba(0,0,0,0.7)', color: 'white', fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 36, letterSpacing: 2 }}>
          {isMorning ? '08:15' : isEvening ? '18:40' : '17:55'}
        </div>
      </div>
    </AbsoluteFill>
  );
};
