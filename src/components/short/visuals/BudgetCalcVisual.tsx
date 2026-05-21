import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const BudgetCalcVisual: React.FC<SceneVisualProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });
  const total = Math.floor(interpolate(frame, [10, durationInFrames - 10], [0, 85000], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const totalStr = total.toLocaleString('fr-FR');

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 700, height: 700, transform: `scale(${enter})` }}>
        {/* Calculator body */}
        <div style={{ position: 'absolute', inset: '40px 80px', borderRadius: 32, background: theme.jamm.blueDeep, border: `8px solid ${theme.jamm.orange}`, boxShadow: '0 24px 64px rgba(0,0,0,0.45)', padding: 30, display: 'flex', flexDirection: 'column' }}>
          {/* Screen */}
          <div style={{ background: '#0c1228', borderRadius: 16, padding: '28px 24px', textAlign: 'right' }}>
            <div style={{ fontFamily: 'monospace', fontSize: 28, color: theme.jamm.orange, opacity: 0.7, letterSpacing: 2 }}>BUDGET TRANSPORT</div>
            <div style={{ fontFamily: 'monospace', fontSize: 72, color: '#4ADE80', fontWeight: 900, marginTop: 8, textShadow: '0 0 12px rgba(74,222,128,0.6)' }}>
              {totalStr}
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 28, color: '#9aa3d6', fontWeight: 700 }}>CFA / mois</div>
          </div>
          {/* Buttons */}
          <div style={{ flex: 1, marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {['7','8','9','÷','4','5','6','×','1','2','3','-','C','0','.','+'].map((k) => (
              <div key={k} style={{ background: ['C','÷','×','-','+'].includes(k) ? theme.jamm.orange : '#1a2150', color: 'white', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: theme.fonts.display, fontSize: 32, fontWeight: 900 }}>{k}</div>
            ))}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
