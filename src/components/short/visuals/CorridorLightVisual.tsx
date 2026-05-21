import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const CorridorLightVisual: React.FC<SceneVisualProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });

  // Flicker: random-ish on/off pattern
  const seed = Math.sin(frame * 0.7) + Math.sin(frame * 1.3) * 0.5;
  const flicker = seed > 0.2 ? 1 : seed > -0.3 ? 0.6 : 0.2;

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 720, height: 720, transform: `scale(${enter})`, borderRadius: 24, overflow: 'hidden', background: '#0a0e22', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
        {/* Corridor perspective */}
        <svg viewBox="0 0 720 720" width="100%" height="100%">
          {/* Floor */}
          <polygon points="0,720 720,720 480,400 240,400" fill="#1a1f3a" />
          {/* Right wall */}
          <polygon points="720,720 720,0 480,200 480,400" fill="#15182f" />
          {/* Left wall */}
          <polygon points="0,720 0,0 240,200 240,400" fill="#15182f" />
          {/* Ceiling */}
          <polygon points="0,0 720,0 480,200 240,200" fill="#10122a" />
          {/* Door at end */}
          <rect x="320" y="280" width="80" height="120" fill={theme.jamm.orange} opacity="0.4" />
        </svg>

        {/* Hanging lamp + cone of light */}
        <div style={{ position: 'absolute', top: 0, left: 360, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ width: 4, height: 120, background: '#444' }} />
          <div style={{ width: 80, height: 40, borderRadius: '50%', background: `radial-gradient(ellipse, rgba(244,209,0,${flicker}) 0%, rgba(244,209,0,0) 70%)`, boxShadow: `0 0 80px rgba(244,209,0,${flicker * 0.8})` }} />
        </div>

        {/* Light cone */}
        <div style={{ position: 'absolute', top: 140, left: 360, transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '180px solid transparent', borderRight: '180px solid transparent', borderTop: `400px solid rgba(244,209,0,${flicker * 0.18})`, filter: 'blur(8px)' }} />

        {/* Status badge */}
        <div style={{ position: 'absolute', bottom: 30, left: 30, padding: '12px 22px', borderRadius: 12, background: flicker > 0.5 ? theme.jamm.orange : '#a93232', color: 'white', fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 26 }}>
          {flicker > 0.5 ? 'OK' : 'FAIBLE'}
        </div>
      </div>
    </AbsoluteFill>
  );
};
