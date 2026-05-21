import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const FakeBrokerVisual: React.FC<SceneVisualProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });
  const handReach = interpolate(frame, [10, 40], [0, 80], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const billGrab = interpolate(frame, [25, 55], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const questionPulse = 1 + Math.sin(frame * 0.18) * 0.08;

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 760, height: 760, transform: `scale(${enter})` }}>
        {/* Faceless silhouette torso */}
        <svg viewBox="0 0 760 760" width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
          <defs>
            <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={theme.jamm.blueDeep} />
              <stop offset="100%" stopColor={theme.jamm.blueDark} />
            </linearGradient>
          </defs>
          {/* Shoulders only — no head */}
          <path d="M 100,560 Q 100,420 200,400 L 560,400 Q 660,420 660,560 L 660,760 L 100,760 Z" fill="url(#bodyGrad)" />
          {/* Shirt collar */}
          <path d="M 320,400 L 380,470 L 440,400 Z" fill={theme.jamm.snow} opacity={0.6} />
        </svg>

        {/* Reaching arm */}
        <div style={{ position: 'absolute', left: 480, top: 380 - handReach, width: 160, height: 280, background: theme.jamm.blueDeep, borderRadius: '24px 80px 24px 24px', transform: 'rotate(-22deg)', border: `3px solid ${theme.jamm.blue}` }} />
        {/* Hand */}
        <div style={{ position: 'absolute', left: 440, top: 320 - handReach, width: 200, height: 160, background: '#3a2316', borderRadius: '60% 40% 50% 50%', border: '3px solid #2a1810' }} />

        {/* Bills being grabbed */}
        <div style={{ position: 'absolute', left: 380, top: 280, transform: `scale(${billGrab}) translateY(${-billGrab * 80}px)`, opacity: 1 - billGrab * 0.4 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ position: 'absolute', left: i * 12, top: i * -8, width: 200, height: 100, borderRadius: 12, background: 'linear-gradient(135deg,#4ADE80,#2D8F4F)', border: '3px solid rgba(255,255,255,0.4)', color: 'white', fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 16px rgba(0,0,0,0.4)' }}>CFA</div>
          ))}
        </div>

        {/* Question mark over absent head */}
        <div style={{ position: 'absolute', top: 40, left: 0, right: 0, textAlign: 'center', color: theme.jamm.orange, fontFamily: theme.fonts.display, fontSize: 220, fontWeight: 900, transform: `scale(${questionPulse})`, textShadow: '0 8px 24px rgba(0,0,0,0.6)' }}>
          ?
        </div>
      </div>
    </AbsoluteFill>
  );
};
