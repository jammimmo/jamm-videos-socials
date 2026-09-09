import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../styles/theme';

// Two-tier caption bar:
//  1. Small chip on top — the short headline takeaway (FR with tiny EN)
//  2. Big main caption — the voice-over sentence currently being spoken,
//     French primary, English italic underneath.
//
// Sits in the bottom safe zone with comfortable padding from the brand border.

type Props = {
  text: string;          // short FR headline (uppercase chip)
  textEn?: string;       // short EN headline
  voiceoverFr?: string;  // spoken French sentence
  voiceoverEn?: string;  // spoken English translation
};

export const SubtitleBar: React.FC<Props> = ({ text, textEn, voiceoverFr, voiceoverEn }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 18, stiffness: 110 } });
  const voiceEnter = spring({ frame: frame - 6, fps, config: { damping: 18, stiffness: 110 } });
  const y = interpolate(enter, [0, 1], [60, 0]);

  return (
    <div
      style={{
        position: 'absolute',
        left: 50,
        right: 50,
        bottom: 110, // sits just above the bottom brand border
        opacity: enter,
        transform: `translateY(${y}px)`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
      }}
    >
      {/* Chip — short headline */}
      <div
        style={{
          padding: '12px 28px',
          background: theme.jamm.orange,
          borderRadius: 999,
          color: 'white',
          fontFamily: theme.fonts.display,
          fontWeight: 900,
          fontSize: 32,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          boxShadow: '0 6px 18px rgba(0,0,0,0.5)',
          textAlign: 'center',
          lineHeight: 1.1,
        }}
      >
        {text}
        {textEn ? <span style={{ opacity: 0.85, fontWeight: 700, fontStyle: 'italic', textTransform: 'none', marginLeft: 12 }}>· {textEn}</span> : null}
      </div>

      {/* Main caption — voice-over sentences */}
      <div
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '22px 32px',
          background: 'rgba(8, 10, 30, 0.88)',
          backdropFilter: 'blur(10px)',
          borderRadius: 18,
          border: `4px solid ${theme.jamm.orange}`,
          boxShadow: '0 24px 48px rgba(0,0,0,0.55)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {voiceoverFr && (
          <div
            style={{
              color: 'white',
              fontFamily: theme.fonts.display,
              fontSize: 54,
              fontWeight: 800,
              lineHeight: 1.12,
              textAlign: 'center',
              letterSpacing: 0.3,
              textShadow: '0 4px 12px rgba(0,0,0,0.7)',
              opacity: voiceEnter,
              transform: `translateY(${interpolate(voiceEnter, [0, 1], [16, 0])}px)`,
            }}
          >
            {voiceoverFr}
          </div>
        )}
        {voiceoverEn && (
          <div
            style={{
              color: theme.jamm.cream,
              fontFamily: theme.fonts.display,
              fontSize: 36,
              fontWeight: 500,
              fontStyle: 'italic',
              lineHeight: 1.15,
              textAlign: 'center',
              letterSpacing: 0.3,
              opacity: voiceEnter * 0.95,
              borderTop: `1px solid rgba(232,220,203,0.3)`,
              paddingTop: 10,
              width: '100%',
            }}
          >
            {voiceoverEn}
          </div>
        )}
      </div>
    </div>
  );
};
