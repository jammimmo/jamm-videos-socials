import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const NoiseListenVisual: React.FC<SceneVisualProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 720, height: 720, transform: `scale(${enter})`, borderRadius: 24, overflow: 'hidden', background: `linear-gradient(180deg, #0e1430 0%, #1a2150 100%)`, boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
        {/* Stars */}
        {[...Array(40)].map((_, i) => (
          <div key={i} style={{ position: 'absolute', left: (i * 27) % 720, top: (i * 31) % 400, width: 3, height: 3, borderRadius: '50%', background: 'white', opacity: 0.4 + Math.sin(frame * 0.1 + i) * 0.4 }} />
        ))}

        {/* Ear */}
        <div style={{ position: 'absolute', left: 60, top: '50%', transform: 'translateY(-50%)' }}>
          <svg width="200" height="280" viewBox="0 0 200 280">
            <path d="M 100,20 C 50,20 30,80 30,140 C 30,200 60,260 110,260 C 130,260 145,250 150,235 C 155,220 145,205 130,205 C 120,205 110,195 110,180 C 110,165 125,160 140,160 C 165,160 180,140 180,110 C 180,60 150,20 100,20 Z" fill="#f5d6b0" stroke={theme.jamm.orange} strokeWidth="4" />
            <ellipse cx="100" cy="140" rx="20" ry="40" fill="#d4a073" />
          </svg>
        </div>

        {/* Sound waves (animated arcs) */}
        {[0, 1, 2, 3, 4].map((i) => {
          const pulseCycle = (frame * 3 + i * 16) % 80;
          const opacity = interpolate(pulseCycle, [0, 10, 70, 80], [0, 0.7, 0.7, 0]);
          const r = 100 + pulseCycle * 4;
          return (
            <div key={i} style={{ position: 'absolute', left: 320 - r, top: 360 - r, width: r * 2, height: r * 2, borderRadius: '50%', border: `4px solid ${theme.jamm.orange}`, opacity }} />
          );
        })}

        {/* Volume meter */}
        <div style={{ position: 'absolute', right: 50, top: 80, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[100, 88, 76, 64, 52, 40, 28, 16].map((opacity, i) => {
            const lit = ((frame + i * 3) % 30) > 15;
            return (
              <div key={i} style={{ width: 80, height: 24, borderRadius: 6, background: lit ? (i < 3 ? '#a93232' : i < 6 ? theme.jamm.orange : '#4ADE80') : 'rgba(255,255,255,0.15)' }} />
            );
          })}
        </div>

        {/* Source labels */}
        <div style={{ position: 'absolute', bottom: 60, right: 50, color: theme.jamm.orange, fontSize: 24, fontWeight: 800, fontFamily: theme.fonts.display, textAlign: 'right', lineHeight: 1.4 }}>
          🔊 Générateur<br/>
          🔊 Bar voisin<br/>
          🔊 Klaxons
        </div>
      </div>
    </AbsoluteFill>
  );
};
