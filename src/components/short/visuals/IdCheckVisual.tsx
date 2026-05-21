import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const IdCheckVisual: React.FC<SceneVisualProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });
  const magX = 360 + Math.sin(frame * 0.08) * 80;
  const magY = 380 + Math.cos(frame * 0.06) * 40;

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 720, height: 720, transform: `scale(${enter})` }}>
        {/* ID card */}
        <div style={{ position: 'absolute', left: 60, top: 200, width: 600, height: 360, borderRadius: 24, background: 'linear-gradient(135deg, #2d348f, #1f2666)', boxShadow: '0 24px 48px rgba(0,0,0,0.5)', padding: 28, transform: 'rotate(-3deg)', border: `6px solid ${theme.jamm.orange}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontFamily: theme.fonts.display, fontWeight: 900, color: theme.jamm.orange, fontSize: 28, letterSpacing: 2 }}>RÉPUBLIQUE DU SÉNÉGAL</div>
            <div style={{ background: 'white', padding: '6px 14px', borderRadius: 8, fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 22, color: theme.jamm.blue }}>CNI</div>
          </div>
          <div style={{ display: 'flex', gap: 24, marginTop: 24 }}>
            {/* Photo placeholder — silhouette only, no face */}
            <div style={{ width: 140, height: 180, background: '#0c1228', borderRadius: 10, position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: 120, height: 110, background: '#4a536d', borderRadius: '60% 60% 0 0' }} />
            </div>
            {/* Fields */}
            <div style={{ flex: 1, color: 'white', fontFamily: theme.fonts.display, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 18, opacity: 0.7, letterSpacing: 2 }}>NOM</div>
                <div style={{ fontSize: 30, fontWeight: 900 }}>D I O P</div>
              </div>
              <div>
                <div style={{ fontSize: 18, opacity: 0.7, letterSpacing: 2 }}>PRÉNOM</div>
                <div style={{ fontSize: 30, fontWeight: 900 }}>————</div>
              </div>
              <div>
                <div style={{ fontSize: 18, opacity: 0.7, letterSpacing: 2 }}>N° CNI</div>
                <div style={{ fontSize: 26, fontWeight: 900, fontFamily: 'monospace' }}>•••• ••••</div>
              </div>
            </div>
          </div>
        </div>

        {/* Magnifier */}
        <div style={{ position: 'absolute', left: magX, top: magY, width: 220, height: 220 }}>
          <div style={{ width: 200, height: 200, borderRadius: '50%', border: `12px solid ${theme.jamm.orange}`, background: 'rgba(244,154,0,0.12)', boxShadow: '0 12px 24px rgba(0,0,0,0.4)' }} />
          <div style={{ position: 'absolute', bottom: -20, right: -20, width: 80, height: 24, background: theme.jamm.orange, borderRadius: 12, transform: 'rotate(45deg)' }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
