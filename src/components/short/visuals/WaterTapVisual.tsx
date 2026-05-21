import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const WaterTapVisual: React.FC<SceneVisualProps> = ({ variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });
  const isDrain = variant === 'drain';

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 720, height: 720, transform: `scale(${enter})` }}>
        <svg viewBox="0 0 720 720" width="100%" height="100%">
          <defs>
            <linearGradient id="tapGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#bcc4d6" />
              <stop offset="100%" stopColor="#6e7793" />
            </linearGradient>
          </defs>
          {/* Wall behind */}
          <rect x="120" y="100" width="480" height="140" fill={theme.jamm.blueDeep} opacity="0.4" />
          {/* Tap pipe */}
          <rect x="340" y="100" width="40" height="80" fill="url(#tapGrad)" />
          <rect x="240" y="180" width="240" height="44" fill="url(#tapGrad)" rx="6" />
          <rect x="350" y="220" width="20" height="120" fill="url(#tapGrad)" />
          {/* Tap head */}
          <ellipse cx="360" cy="350" rx="60" ry="22" fill="url(#tapGrad)" stroke="#4a536d" strokeWidth="3" />
          {/* Knob */}
          <circle cx="260" cy="155" r="40" fill={theme.jamm.orange} stroke="white" strokeWidth="6" />
          <rect x="252" y="135" width="16" height="40" fill="white" rx="3" />

          {/* Sink basin or drain */}
          {isDrain ? (
            <g>
              <path d="M 150,450 L 570,450 L 530,640 L 190,640 Z" fill={theme.jamm.blue} stroke="white" strokeWidth="6" />
              <circle cx="360" cy="540" r="48" fill={theme.jamm.blueDark} />
              <circle cx="360" cy="540" r="36" fill="#0c1228" />
              {[0, 1, 2, 3].map((i) => (
                <line key={i} x1="324" y1={524 + i * 8} x2="396" y2={524 + i * 8} stroke="#1a2150" strokeWidth="3" />
              ))}
            </g>
          ) : (
            <path d="M 130,540 Q 130,640 360,640 Q 590,640 590,540" fill="none" stroke={theme.jamm.blueDeep} strokeWidth="14" />
          )}
        </svg>

        {/* Animated water droplets */}
        {[...Array(8)].map((_, i) => {
          const cyc = (frame * 4 + i * 20) % 280;
          const drop = 380 + cyc;
          const opacity = interpolate(cyc, [0, 30, 220, 280], [0, 1, 1, 0]);
          return (
            <div key={i} style={{ position: 'absolute', left: 350 + (i % 2 ? 10 : -10), top: drop, width: 16, height: 22, borderRadius: '50% 50% 50% 0', background: '#4ec0ff', transform: 'rotate(-45deg)', opacity, boxShadow: '0 2px 4px rgba(0,0,0,0.3)' }} />
          );
        })}

        {/* Pressure gauge */}
        <div style={{ position: 'absolute', right: 40, bottom: 80, width: 160, height: 160, borderRadius: '50%', background: 'white', border: `8px solid ${theme.jamm.blue}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <div style={{ fontSize: 36, fontWeight: 900, color: theme.jamm.orange, fontFamily: theme.fonts.display }}>BAR</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: theme.jamm.blue, fontFamily: theme.fonts.display }}>?</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
