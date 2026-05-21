import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const ReceiptVisual: React.FC<SceneVisualProps> = ({ variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });
  const stampEnter = spring({ frame: frame - 24, fps, config: { damping: 8, stiffness: 180 } });

  const showName = variant === 'with-name' || variant === 'linked-lease' || variant === 'clear';
  const showDate = variant === 'dated' || variant === 'with-name' || variant === 'clear';
  const showLeaseLink = variant === 'linked-lease';
  const showArchive = variant === 'archive';
  const showProof = variant === 'proof' || variant === 'clear';

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 720, height: 720, transform: `scale(${enter})` }}>
        {/* Receipt body */}
        <div style={{ position: 'absolute', left: 160, top: 50, width: 400, minHeight: 600, background: '#fdfaf2', boxShadow: '0 24px 48px rgba(0,0,0,0.4)', padding: 32, fontFamily: 'monospace', transform: 'rotate(-3deg)', border: `2px dashed ${theme.jamm.blue}` }}>
          <div style={{ fontFamily: theme.fonts.display, fontSize: 28, fontWeight: 900, color: theme.jamm.blue, textAlign: 'center', letterSpacing: 2, borderBottom: `3px solid ${theme.jamm.orange}`, paddingBottom: 12 }}>REÇU DE PAIEMENT</div>
          <div style={{ marginTop: 18, fontSize: 22, color: '#222' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
              <span>Date :</span>
              <span style={{ fontWeight: 900, color: showDate ? theme.jamm.blue : '#ccc' }}>
                {showDate ? '15/03/2026' : '__/__/____'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
              <span>Nom :</span>
              <span style={{ fontWeight: 900, color: showName ? theme.jamm.blue : '#ccc' }}>
                {showName ? 'M. DIOP' : '___________'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
              <span>Montant :</span>
              <span style={{ fontWeight: 900, color: theme.jamm.orange, fontSize: 28 }}>300 000 CFA</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
              <span>Mois :</span>
              <span style={{ fontWeight: 900, color: theme.jamm.blue }}>MARS 2026</span>
            </div>
            {showLeaseLink && (
              <div style={{ marginTop: 14, padding: 10, background: 'rgba(45,52,143,0.1)', borderLeft: `4px solid ${theme.jamm.blue}`, fontFamily: theme.fonts.display, fontSize: 20, fontWeight: 800 }}>
                ↳ BAIL N° 2026-DKR-014
              </div>
            )}
          </div>

          {/* Signature line */}
          <div style={{ marginTop: 30, paddingTop: 16, borderTop: `2px dashed #aaa`, fontSize: 18, color: '#666', fontFamily: theme.fonts.display, textAlign: 'right' }}>
            Signature : <span style={{ color: theme.jamm.blue, fontStyle: 'italic', fontFamily: 'cursive', fontSize: 24 }}>{showName ? '✓' : '____'}</span>
          </div>
        </div>

        {/* PROOF stamp */}
        {showProof && (
          <div style={{ position: 'absolute', right: 40, top: 80, padding: '20px 32px', borderRadius: 12, background: 'rgba(74,222,128,0.15)', color: '#2D8F4F', fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 40, letterSpacing: 4, border: '5px solid #2D8F4F', transform: `rotate(12deg) scale(${stampEnter})`, boxShadow: '0 12px 24px rgba(0,0,0,0.4)' }}>
            PREUVE
          </div>
        )}

        {/* Archive folder */}
        {showArchive && (
          <div style={{ position: 'absolute', right: 40, bottom: 80, width: 240, height: 200, background: theme.jamm.orange, borderRadius: '10px 10px 16px 16px', boxShadow: '0 16px 32px rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 30, transform: `rotate(8deg) scale(${stampEnter})` }}>
            <div style={{ position: 'absolute', top: -20, left: 30, width: 100, height: 40, background: theme.jamm.orange, borderRadius: '8px 8px 0 0' }} />
            <div style={{ fontFamily: theme.fonts.display, color: 'white', fontWeight: 900, fontSize: 32, letterSpacing: 2 }}>ARCHIVÉ</div>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
