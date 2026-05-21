import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const ListingScamVisual: React.FC<SceneVisualProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });
  const bubble1 = spring({ frame: frame - 8, fps, config: { damping: 12, stiffness: 100 } });
  const bubble2 = spring({ frame: frame - 32, fps, config: { damping: 12, stiffness: 100 } });
  const fade = interpolate(frame, [80, 130], [1, 0.25], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 720, height: 720, transform: `scale(${enter})` }}>
        {/* Phone frame */}
        <div style={{ position: 'absolute', inset: '40px 140px', borderRadius: 48, background: theme.colors.brandBlueDark, border: `8px solid ${theme.jamm.orange}` }}>
          <div style={{ position: 'absolute', inset: 24, borderRadius: 30, background: '#e8eaf6', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: theme.jamm.blue, fontFamily: theme.fonts.display, opacity: bubble1 }}>+221 77 ••• ••••</div>

            {/* Outgoing bubble */}
            <div style={{ alignSelf: 'flex-end', maxWidth: '78%', padding: '16px 22px', borderRadius: '20px 20px 6px 20px', background: theme.jamm.blue, color: 'white', fontSize: 28, fontWeight: 700, fontFamily: theme.fonts.display, transform: `translateX(${interpolate(bubble1, [0, 1], [80, 0])}px)`, opacity: bubble1 }}>
              Vous avez reçu ?
            </div>

            {/* Incoming bubble — "indisponible" */}
            <div style={{ alignSelf: 'flex-start', maxWidth: '85%', padding: '18px 22px', borderRadius: '20px 20px 20px 6px', background: '#a93232', color: 'white', fontSize: 26, fontWeight: 800, fontFamily: theme.fonts.display, transform: `translateX(${interpolate(bubble2, [0, 1], [-80, 0])}px)`, opacity: bubble2 * fade, letterSpacing: 1 }}>
              ⚠️ NUMÉRO INDISPONIBLE
            </div>

            {/* Status row */}
            <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12, background: '#f5f5f5', borderRadius: 12, opacity: bubble2 }}>
              <div style={{ fontSize: 22, color: '#888', fontWeight: 700, fontFamily: theme.fonts.display }}>Dernier vu</div>
              <div style={{ fontSize: 22, color: '#a93232', fontWeight: 900, fontFamily: theme.fonts.display }}>JAMAIS</div>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
