import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

export const ContractVisual: React.FC<SceneVisualProps> = ({ variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });
  const sigDraw = spring({ frame: frame - 20, fps, config: { damping: 16, stiffness: 80 } });

  const headers: Record<string, { title: string; highlights: string[]; sig?: boolean }> = {
    lease: {
      title: 'CONTRAT DE BAIL',
      highlights: ['Loyer', 'Caution', 'Durée'],
    },
    clauses: {
      title: 'CLAUSES IMPORTANTES',
      highlights: ['Hausse loyer', 'Pénalités', 'Préavis'],
    },
    payment: {
      title: 'PAIEMENT LIÉ AU BAIL',
      highlights: ['Date signature', 'Date paiement', 'Reçu obligatoire'],
    },
    inspection: {
      title: 'ÉTAT DES LIEUX',
      highlights: ['Murs', 'Sols', 'Équipements'],
    },
    signed: {
      title: 'BAIL SIGNÉ',
      highlights: ['Lu', 'Compris', 'Accepté'],
      sig: true,
    },
  };
  const content = headers[variant ?? 'lease'] ?? headers.lease;

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 640, height: 720, transform: `scale(${enter}) rotate(-2deg)` }}>
        {/* Paper */}
        <div style={{ position: 'absolute', inset: 0, background: '#fdfaf2', borderRadius: 12, boxShadow: '0 24px 48px rgba(0,0,0,0.5)', padding: 50, border: `4px solid ${theme.jamm.blue}` }}>
          {/* Header */}
          <div style={{ borderBottom: `4px solid ${theme.jamm.orange}`, paddingBottom: 18 }}>
            <div style={{ fontFamily: theme.fonts.display, fontSize: 38, fontWeight: 900, color: theme.jamm.blue, letterSpacing: 2 }}>{content.title}</div>
            <div style={{ fontSize: 20, color: '#666', marginTop: 6, fontFamily: theme.fonts.display }}>Dakar, Sénégal</div>
          </div>

          {/* Highlights */}
          <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 18 }}>
            {content.highlights.map((h) => (
              <div key={h} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 18px', background: 'rgba(244,154,0,0.18)', borderLeft: `6px solid ${theme.jamm.orange}`, borderRadius: 8 }}>
                <div style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 28, color: theme.jamm.blue }}>{h}</div>
              </div>
            ))}
          </div>

          {/* Body lines */}
          <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3, 4, 5, 6].map((j) => (
              <div key={j} style={{ height: 10, background: '#ddd', borderRadius: 3, width: `${90 - (j % 3) * 8}%` }} />
            ))}
          </div>

          {/* Signature */}
          <div style={{ position: 'absolute', bottom: 50, left: 50, right: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 18, color: '#888', fontFamily: theme.fonts.display, letterSpacing: 1 }}>SIGNATURE</div>
              <div style={{ marginTop: 12, position: 'relative', width: 200, height: 60 }}>
                {content.sig && (
                  <svg width="200" height="60" viewBox="0 0 200 60">
                    <path d="M 10,40 Q 30,10 50,30 T 90,30 Q 110,20 130,40 T 180,30" fill="none" stroke={theme.jamm.blue} strokeWidth="4" strokeLinecap="round" strokeDasharray="240" strokeDashoffset={240 - sigDraw * 240} />
                  </svg>
                )}
                <div style={{ position: 'absolute', bottom: -2, left: 0, right: 0, height: 2, background: '#888' }} />
              </div>
            </div>
            <div style={{ padding: '10px 16px', background: theme.jamm.blue, color: 'white', borderRadius: 8, fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 18 }}>
              {new Date().toLocaleDateString('fr-FR')}
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
