import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const ScheduleClockVisual: React.FC<SceneVisualProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });
  const handAngle = (frame * 6) % 360;

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 720, height: 720, transform: `scale(${enter})` }}>
        {/* Clock */}
        <svg viewBox="0 0 720 720" width="100%" height="100%">
          <circle cx="260" cy="360" r="220" fill="white" stroke={theme.jamm.blue} strokeWidth="14" />
          {[...Array(12)].map((_, i) => {
            const a = (i * 30 - 90) * (Math.PI / 180);
            const x1 = 260 + Math.cos(a) * 200;
            const y1 = 360 + Math.sin(a) * 200;
            const x2 = 260 + Math.cos(a) * 180;
            const y2 = 360 + Math.sin(a) * 180;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={theme.jamm.blue} strokeWidth="8" />;
          })}
          {/* Hour hand */}
          <line x1="260" y1="360" x2="260" y2="220" stroke={theme.jamm.blueDark} strokeWidth="14" strokeLinecap="round" />
          {/* Minute hand */}
          <g transform={`rotate(${handAngle} 260 360)`}>
            <line x1="260" y1="360" x2="260" y2="180" stroke={theme.jamm.orange} strokeWidth="10" strokeLinecap="round" />
          </g>
          <circle cx="260" cy="360" r="16" fill={theme.jamm.orange} />
        </svg>

        {/* Schedule card */}
        <div style={{ position: 'absolute', right: 40, top: 120, width: 280, padding: 28, borderRadius: 24, background: 'white', boxShadow: '0 16px 48px rgba(0,0,0,0.35)', border: `4px solid ${theme.jamm.orange}` }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: theme.jamm.blue, fontFamily: theme.fonts.display, letterSpacing: 1, marginBottom: 16 }}>
            HORAIRES COUPURES
          </div>
          {[
            ['Mardi', '14h - 18h'],
            ['Vendredi', '08h - 12h'],
            ['Dimanche', 'Aléatoire'],
          ].map(([day, time]) => (
            <div key={day} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #eee', fontSize: 24, fontWeight: 700, color: '#333', fontFamily: theme.fonts.display }}>
              <span>{day}</span>
              <span style={{ color: theme.jamm.orange }}>{time}</span>
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
