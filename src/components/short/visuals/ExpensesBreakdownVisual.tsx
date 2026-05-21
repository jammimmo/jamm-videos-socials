import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

const rows = [
  { label: 'Loyer net', amount: 300000, color: theme.jamm.blue },
  { label: 'Charges eau', amount: 15000, color: '#4ec0ff' },
  { label: 'Électricité', amount: 28000, color: '#f4d100' },
  { label: 'Gardien', amount: 10000, color: '#4ADE80' },
  { label: 'Ordures', amount: 5000, color: '#a93232' },
];

export const ExpensesBreakdownVisual: React.FC<SceneVisualProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });
  const max = Math.max(...rows.map((r) => r.amount));

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 720, height: 720, transform: `scale(${enter})` }}>
        <div style={{ position: 'absolute', inset: '40px 60px', background: 'white', borderRadius: 24, boxShadow: '0 24px 48px rgba(0,0,0,0.4)', padding: 36, border: `4px solid ${theme.jamm.blue}` }}>
          <div style={{ fontFamily: theme.fonts.display, fontSize: 30, fontWeight: 900, color: theme.jamm.blue, letterSpacing: 2, textAlign: 'center', marginBottom: 24 }}>CHARGES DÉTAILLÉES</div>

          {rows.map((row, i) => {
            const barGrow = spring({ frame: frame - 6 - i * 5, fps, config: { damping: 14, stiffness: 90 } });
            const pct = (row.amount / max) * 100 * barGrow;
            return (
              <div key={row.label} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: theme.fonts.display, fontSize: 22, fontWeight: 800, color: theme.jamm.blue, marginBottom: 4 }}>
                  <span>{row.label}</span>
                  <span style={{ color: row.color }}>{row.amount.toLocaleString('fr-FR')} CFA</span>
                </div>
                <div style={{ height: 18, background: '#eee', borderRadius: 9, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: row.color, borderRadius: 9 }} />
                </div>
              </div>
            );
          })}

          <div style={{ marginTop: 24, padding: 16, background: theme.jamm.blue, color: 'white', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: theme.fonts.display }}>
            <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: 2 }}>TOTAL / MOIS</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: theme.jamm.orange }}>358 000 CFA</div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
