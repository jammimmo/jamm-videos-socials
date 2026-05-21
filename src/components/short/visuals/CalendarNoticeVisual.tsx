import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const CalendarNoticeVisual: React.FC<SceneVisualProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });
  const circleDraw = spring({ frame: frame - 30, fps, config: { damping: 16, stiffness: 80 } });

  const days = Array.from({ length: 35 }, (_, i) => i - 2);

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 640, height: 720, transform: `scale(${enter})` }}>
        {/* Calendar */}
        <div style={{ position: 'absolute', inset: 0, background: 'white', borderRadius: 24, boxShadow: '0 24px 48px rgba(0,0,0,0.4)', padding: 30, border: `6px solid ${theme.jamm.blue}` }}>
          {/* Header */}
          <div style={{ background: theme.jamm.blue, color: 'white', padding: '18px 22px', borderRadius: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontFamily: theme.fonts.display, fontSize: 30, fontWeight: 900, letterSpacing: 2 }}>MARS 2026</div>
            <div style={{ fontFamily: theme.fonts.display, fontSize: 18, fontWeight: 700, color: theme.jamm.orange, letterSpacing: 1 }}>PRÉAVIS</div>
          </div>

          {/* Day headers */}
          <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, color: theme.jamm.blue, fontFamily: theme.fonts.display, fontSize: 20, fontWeight: 900, textAlign: 'center' }}>
            {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => <div key={i}>{d}</div>)}
          </div>

          {/* Days grid */}
          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
            {days.map((d, i) => {
              const inMonth = d > 0 && d <= 31;
              const isMarked = d === 15;
              return (
                <div key={i} style={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: theme.fonts.display, fontSize: 26, fontWeight: 800, color: inMonth ? theme.jamm.blue : '#ccc', position: 'relative' }}>
                  {inMonth ? d : ''}
                  {isMarked && (
                    <div style={{ position: 'absolute', inset: 4, borderRadius: '50%', border: `5px solid ${theme.jamm.orange}`, transform: `scale(${circleDraw})` }} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Notice card */}
          <div style={{ marginTop: 24, padding: 20, background: 'rgba(244,154,0,0.18)', border: `4px solid ${theme.jamm.orange}`, borderRadius: 14, color: theme.jamm.blue, fontFamily: theme.fonts.display }}>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 1 }}>PRÉAVIS REQUIS</div>
            <div style={{ fontSize: 44, fontWeight: 900, color: theme.jamm.orange, marginTop: 4 }}>3 MOIS</div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
