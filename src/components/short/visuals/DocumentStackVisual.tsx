import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const DocumentStackVisual: React.FC<SceneVisualProps> = ({ variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });

  const isBills = variant === 'bills';
  const isCompare = variant === 'compare';
  const isValidated = variant === 'validated';
  const labelsBase = isBills
    ? ['FACTURE EAU', 'FACTURE ÉLEC', 'FACTURE INTERNET']
    : isCompare
    ? ['PIÈCE', 'BAIL', 'FACTURES']
    : ['BAIL', 'CAUTION', 'REÇU'];

  const stamp = isValidated ? '✓ VALIDÉ' : null;

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 720, height: 720, transform: `scale(${enter})` }}>
        {labelsBase.map((label, i) => {
          const cardEnter = spring({ frame: frame - i * 6, fps, config: { damping: 14, stiffness: 110 } });
          const offset = i * 70;
          return (
            <div key={label} style={{ position: 'absolute', left: 80 + offset, top: 120 + offset, width: 460, height: 580, background: 'white', borderRadius: 18, boxShadow: '0 16px 32px rgba(0,0,0,0.35)', padding: 36, transform: `rotate(${-6 + i * 4}deg) scale(${cardEnter})`, opacity: cardEnter, border: `4px solid ${i === labelsBase.length - 1 ? theme.jamm.orange : '#ddd'}`, zIndex: i + 1 }}>
              <div style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 30, color: theme.jamm.blue, letterSpacing: 2, textAlign: 'center' }}>{label}</div>
              <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {[1, 2, 3, 4, 5].map((j) => (
                  <div key={j} style={{ height: 14, background: '#eee', borderRadius: 4, width: `${85 - j * 8}%` }} />
                ))}
              </div>
              <div style={{ marginTop: 28, padding: '12px 18px', background: '#f5f5f5', borderRadius: 10, color: '#444', fontFamily: theme.fonts.display, fontSize: 22, fontWeight: 700 }}>
                Nom : ————
              </div>
            </div>
          );
        })}

        {stamp && (
          <div style={{ position: 'absolute', right: 40, bottom: 80, padding: '20px 32px', background: '#4ADE80', color: 'white', fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 40, borderRadius: 16, transform: 'rotate(-12deg)', boxShadow: '0 12px 24px rgba(0,0,0,0.5)', border: '6px solid white' }}>
            {stamp}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
