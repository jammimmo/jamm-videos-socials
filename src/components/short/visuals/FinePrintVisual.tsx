import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const FinePrintVisual: React.FC<SceneVisualProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });
  const magScale = spring({ frame: frame - 20, fps, config: { damping: 10, stiffness: 80 } });

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 720, height: 720, transform: `scale(${enter})` }}>
        {/* Paper with fine print */}
        <div style={{ position: 'absolute', inset: '40px 60px', background: '#fdfaf2', borderRadius: 12, padding: 32, boxShadow: '0 16px 40px rgba(0,0,0,0.35)' }}>
          <div style={{ fontFamily: theme.fonts.display, fontSize: 26, fontWeight: 900, color: theme.jamm.blue, marginBottom: 16 }}>CONDITIONS GÉNÉRALES</div>
          {[...Array(28)].map((_, i) => (
            <div key={i} style={{ height: 6, background: '#bbb', borderRadius: 2, marginBottom: 6, width: `${78 + (i % 4) * 5}%` }} />
          ))}
          {/* Hidden penalty highlight */}
          <div style={{ position: 'absolute', left: 100, top: 280, width: 360, height: 30, background: 'rgba(169,50,50,0.25)', border: `2px solid #a93232`, borderRadius: 4 }} />
        </div>

        {/* Magnifier zooming in on the highlight */}
        <div style={{ position: 'absolute', left: 200, top: 220, width: 320, height: 320, transform: `scale(${magScale})`, transformOrigin: 'center' }}>
          <div style={{ width: '100%', height: '100%', borderRadius: '50%', border: `14px solid ${theme.jamm.orange}`, background: 'white', boxShadow: '0 12px 32px rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, overflow: 'hidden' }}>
            <div style={{ textAlign: 'center', fontFamily: theme.fonts.display, color: '#a93232' }}>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>Art. 14 — En cas de retard :</div>
              <div style={{ fontSize: 38, fontWeight: 900, marginTop: 8, letterSpacing: 1 }}>+30%</div>
              <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>de pénalité</div>
            </div>
          </div>
          <div style={{ position: 'absolute', bottom: -30, right: -30, width: 100, height: 30, background: theme.jamm.orange, borderRadius: 16, transform: 'rotate(45deg)' }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
