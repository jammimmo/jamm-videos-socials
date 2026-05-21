import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const BuildingVisual: React.FC<SceneVisualProps> = ({ variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });

  const isNight = variant === 'night';
  const isKey = variant === 'key';
  const isVisitConfirmed = variant === 'visit-confirmed';

  const sky = isNight
    ? `linear-gradient(180deg, #0e1430 0%, #1a2150 100%)`
    : `linear-gradient(180deg, #ffb547 0%, #ff7a45 70%, #6c2f8e 100%)`;
  const windowColor = isNight ? '#f4d100' : '#2d348f';
  const windowLitChance = isNight ? 0.5 : 0;

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 720, height: 720, transform: `scale(${enter})`, borderRadius: 24, overflow: 'hidden', background: sky, boxShadow: '0 16px 48px rgba(0,0,0,0.4)' }}>
        {/* Sun or moon */}
        {!isNight ? (
          <div style={{ position: 'absolute', right: 80, top: 80, width: 140, height: 140, borderRadius: '50%', background: 'radial-gradient(circle, #fff7c2 0%, #ffd95c 60%, #ff9b3a 100%)', boxShadow: '0 0 80px rgba(255,200,80,0.9)' }} />
        ) : (
          <div style={{ position: 'absolute', right: 80, top: 80, width: 110, height: 110, borderRadius: '50%', background: '#f4eecf', boxShadow: '0 0 60px rgba(244,238,207,0.6)' }} />
        )}

        {/* Building silhouette */}
        <svg viewBox="0 0 720 720" width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
          {/* Far buildings */}
          <rect x="40" y="320" width="120" height="400" fill={isNight ? '#0a0e22' : '#1a2150'} opacity="0.85" />
          <rect x="560" y="290" width="140" height="430" fill={isNight ? '#0a0e22' : '#1a2150'} opacity="0.85" />
          {/* Hero building */}
          <rect x="200" y="200" width="320" height="520" fill={theme.jamm.blueDeep} stroke={theme.jamm.orange} strokeWidth={isVisitConfirmed ? 8 : 0} />
          {/* Door */}
          <rect x="320" y="620" width="80" height="100" fill={theme.jamm.orange} />
          {/* Windows */}
          {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => [0, 1, 2].map((col) => {
            const x = 230 + col * 96;
            const y = 240 + row * 50;
            const lit = ((row + col + 7) * 31 % 100) / 100 < windowLitChance;
            return (
              <rect key={`${row}-${col}`} x={x} y={y} width="64" height="28" fill={lit ? '#f4d100' : windowColor} opacity={lit ? 1 : 0.85} />
            );
          }))}
        </svg>

        {/* Key icon (V2 confirmed) */}
        {isKey && (
          <div style={{ position: 'absolute', bottom: 40, right: 40, width: 180, height: 180, background: theme.jamm.orange, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 100, transform: 'rotate(-25deg)', boxShadow: '0 16px 32px rgba(0,0,0,0.5)' }}>
            🔑
          </div>
        )}

        {/* Visit confirmed check */}
        {isVisitConfirmed && (
          <div style={{ position: 'absolute', top: 40, left: 40, width: 140, height: 140, background: '#4ADE80', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 90, color: 'white', fontWeight: 900, boxShadow: '0 16px 32px rgba(0,0,0,0.5)' }}>
            ✓
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
