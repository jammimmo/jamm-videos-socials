import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const MobileMoneyVisual: React.FC<SceneVisualProps> = ({ variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });
  const stampEnter = spring({ frame: frame - 14, fps, config: { damping: 8, stiffness: 200 } });
  const billsY = interpolate(enter, [0, 1], [80, 0]);

  const showStop = variant === 'stop';
  const showNoReceipt = variant === 'no-receipt';
  const showFastArrow = variant === 'fast-transfer';
  const billPulse = 1 + Math.sin(frame * 0.18) * 0.04;

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 720, height: 720, transform: `scale(${enter})` }}>
        {/* Phone body */}
        <div style={{ position: 'absolute', inset: '60px 200px', borderRadius: 56, background: theme.colors.brandBlueDark, border: `8px solid ${theme.jamm.orange}`, boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
          {/* Screen */}
          <div style={{ position: 'absolute', inset: 30, borderRadius: 32, background: '#0e1430', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, color: 'white', fontFamily: theme.fonts.display }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: theme.jamm.orange, letterSpacing: 2 }}>MOBILE MONEY</div>
            <div style={{ fontSize: 70, fontWeight: 900, marginTop: 18 }}>300 000</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#9aa3d6', marginTop: -4 }}>CFA</div>
            <div style={{ marginTop: 32, padding: '14px 28px', borderRadius: 999, background: showStop ? '#a93232' : theme.jamm.orange, color: 'white', fontSize: 26, fontWeight: 900, letterSpacing: 2 }}>
              {showStop ? 'ENVOYER ?' : 'ENVOYER'}
            </div>
          </div>
        </div>

        {/* Falling bills */}
        {[...Array(6)].map((_, i) => {
          const x = 60 + i * 100;
          const y = 480 + billsY + Math.sin(frame * 0.12 + i) * 12;
          return (
            <div key={i} style={{ position: 'absolute', left: x, top: y, width: 120, height: 58, borderRadius: 10, background: 'linear-gradient(135deg,#4ADE80,#2D8F4F)', transform: `rotate(${i * 12 - 30}deg) scale(${billPulse})`, color: 'white', fontWeight: 900, fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: theme.fonts.display, border: '2px solid rgba(255,255,255,0.4)', boxShadow: '0 6px 12px rgba(0,0,0,0.4)' }}>
              CFA
            </div>
          );
        })}

        {/* STOP stamp */}
        {showStop && (
          <div style={{ position: 'absolute', top: 120, right: 60, padding: '24px 40px', borderRadius: 16, background: '#a93232', color: 'white', fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 90, letterSpacing: 8, border: '8px solid white', boxShadow: '0 12px 32px rgba(0,0,0,0.5)', transform: `rotate(-12deg) scale(${stampEnter})` }}>
            STOP
          </div>
        )}

        {/* NO RECEIPT red X */}
        {showNoReceipt && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${stampEnter})` }}>
            <div style={{ width: 320, height: 320, borderRadius: '50%', border: '14px solid #a93232', position: 'relative', opacity: 0.92 }}>
              <div style={{ position: 'absolute', top: '50%', left: '-20px', right: '-20px', height: 14, background: '#a93232', transform: 'translateY(-50%) rotate(-45deg)' }} />
            </div>
          </div>
        )}

        {/* Fast-transfer arrow */}
        {showFastArrow && (
          <div style={{ position: 'absolute', top: 90, left: 30, color: theme.jamm.orange, fontSize: 64, fontWeight: 900, fontFamily: theme.fonts.display, transform: `translateX(${interpolate(frame % 30, [0, 30], [0, 40])}px)` }}>
            ⇢
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
