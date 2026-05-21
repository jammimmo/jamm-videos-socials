import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const ListingAddressVisual: React.FC<SceneVisualProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });
  const pinDrop = spring({ frame: frame - 18, fps, config: { damping: 10, stiffness: 140 } });
  const pulse = 1 + Math.sin(frame * 0.18) * 0.05;

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 780, height: 780, transform: `scale(${enter})` }}>
        {/* Listing card */}
        <div style={{ position: 'absolute', left: 40, top: 50, width: 380, height: 480, borderRadius: 24, background: 'white', boxShadow: '0 16px 48px rgba(0,0,0,0.35)', overflow: 'hidden', transform: 'rotate(-4deg)' }}>
          <div style={{ width: '100%', height: 230, background: `linear-gradient(160deg, ${theme.jamm.blue}, ${theme.jamm.orange})`, position: 'relative' }}>
            <svg width="100%" height="100%" viewBox="0 0 380 230">
              <rect x="60" y="80" width="100" height="150" fill="rgba(255,255,255,0.85)" />
              <rect x="180" y="50" width="120" height="180" fill="rgba(255,255,255,0.6)" />
              {[0, 1, 2, 3].map((row) => [0, 1, 2].map((col) => (
                <rect key={`${row}-${col}`} x={70 + col * 28} y={90 + row * 30} width="14" height="20" fill={theme.jamm.blueDark} />
              )))}
            </svg>
          </div>
          <div style={{ padding: 24 }}>
            <div style={{ fontSize: 32, fontWeight: 900, color: theme.jamm.blue, fontFamily: theme.fonts.display }}>3 PIÈCES · DAKAR</div>
            <div style={{ marginTop: 12, fontSize: 22, color: '#666', fontWeight: 700, fontFamily: theme.fonts.display }}>Adresse : à confirmer ?</div>
            <div style={{ marginTop: 18, fontSize: 36, color: theme.jamm.orange, fontWeight: 900, fontFamily: theme.fonts.display }}>300 000 CFA</div>
          </div>
        </div>

        {/* Map fragment */}
        <div style={{ position: 'absolute', right: 30, bottom: 80, width: 380, height: 380, borderRadius: 24, background: '#dfe7d8', border: `4px solid ${theme.jamm.blue}`, boxShadow: '0 16px 48px rgba(0,0,0,0.35)', overflow: 'hidden', transform: 'rotate(5deg)' }}>
          {/* Roads */}
          <svg width="100%" height="100%" viewBox="0 0 380 380">
            <rect width="380" height="380" fill="#e8efde" />
            <path d="M 0,190 L 380,190" stroke="#fff" strokeWidth="32" />
            <path d="M 0,150 L 380,150" stroke="#cfd6c4" strokeWidth="6" />
            <path d="M 0,230 L 380,230" stroke="#cfd6c4" strokeWidth="6" />
            <path d="M 190,0 L 190,380" stroke="#fff" strokeWidth="24" />
            {/* Blocks */}
            <rect x="40" y="40" width="100" height="80" fill="#c9d6e8" stroke="#a7bbd6" />
            <rect x="240" y="60" width="110" height="100" fill="#c9d6e8" stroke="#a7bbd6" />
            <rect x="40" y="260" width="120" height="100" fill="#c9d6e8" stroke="#a7bbd6" />
            <rect x="250" y="250" width="100" height="110" fill="#c9d6e8" stroke="#a7bbd6" />
          </svg>

          {/* Pin */}
          <div style={{ position: 'absolute', left: 175, top: 130 - interpolate(pinDrop, [0, 1], [200, 0]), width: 50, height: 70, transform: `scale(${pinDrop * pulse})`, transformOrigin: '50% 100%' }}>
            <svg viewBox="0 0 50 70" width="100%" height="100%">
              <path d="M 25,0 C 12,0 0,12 0,25 C 0,42 25,70 25,70 C 25,70 50,42 50,25 C 50,12 38,0 25,0 Z" fill={theme.jamm.orange} stroke="white" strokeWidth="3" />
              <circle cx="25" cy="25" r="9" fill="white" />
            </svg>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
