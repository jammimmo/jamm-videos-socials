import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const MeterVisual: React.FC<SceneVisualProps> = ({ variant, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });
  const isElectric = variant === 'electric';
  const isSigned = variant === 'signed';

  const ticker = Math.floor(interpolate(frame, [0, durationInFrames], [0, 9999])) % 10000;
  const tickerStr = ticker.toString().padStart(5, '0');

  const label = isElectric ? 'kWh' : 'm³';
  const meterLabel = isElectric ? 'COMPTEUR ÉLECTRIQUE' : 'COMPTEUR D’EAU';
  const accent = isElectric ? '#f4d100' : '#4ec0ff';

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 720, height: 720, transform: `scale(${enter})` }}>
        {/* Meter body */}
        <div style={{ position: 'absolute', inset: '80px 60px', borderRadius: 36, background: theme.jamm.blueDeep, border: `10px solid ${theme.jamm.orange}`, boxShadow: '0 24px 64px rgba(0,0,0,0.45)', padding: 40, display: 'flex', flexDirection: 'column' }}>
          {/* Header */}
          <div style={{ fontSize: 30, fontWeight: 900, color: theme.jamm.orange, letterSpacing: 3, fontFamily: theme.fonts.display, textAlign: 'center' }}>
            {meterLabel}
          </div>

          {/* Digital readout */}
          <div style={{ marginTop: 40, padding: '32px 24px', background: '#0c1228', borderRadius: 16, border: `4px solid ${accent}`, display: 'flex', justifyContent: 'center', gap: 10 }}>
            {tickerStr.split('').map((d, i) => (
              <div key={i} style={{ width: 80, height: 120, background: '#000', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 88, fontWeight: 900, color: accent, fontFamily: 'monospace', textShadow: `0 0 16px ${accent}` }}>{d}</div>
            ))}
          </div>

          <div style={{ marginTop: 24, fontSize: 36, fontWeight: 800, color: 'white', fontFamily: theme.fonts.display, textAlign: 'center', letterSpacing: 2 }}>
            {label}
          </div>

          {/* Signature line */}
          {isSigned && (
            <div style={{ marginTop: 30, padding: '14px 20px', background: 'white', borderRadius: 12, color: theme.jamm.blue, fontFamily: 'cursive', fontSize: 44, fontStyle: 'italic', textAlign: 'center', transform: 'rotate(-3deg)' }}>
              ✓ Signé
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
