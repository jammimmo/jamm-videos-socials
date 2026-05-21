import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../styles/theme';

type Props = {
  rent: number;
  size: string;
  accent: string;
  delay?: number;
};

const formatRent = (n: number) =>
  n.toLocaleString('fr-FR').replace(/,/g, '.');

export const PriceTag: React.FC<Props> = ({ rent, size, accent, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const adjusted = frame - delay;

  const enter = spring({
    frame: adjusted,
    fps,
    config: { damping: 12, stiffness: 100, mass: 0.7 },
  });

  const scale = interpolate(enter, [0, 1], [0.5, 1]);
  const opacity = interpolate(enter, [0, 0.5], [0, 1], { extrapolateRight: 'clamp' });

  const countProgress = interpolate(adjusted, [0, 20], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const displayRent = Math.floor(rent * countProgress);

  const float = Math.sin(adjusted * 0.08) * 4;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 720,
        left: 40,
        right: 40,
        transform: `translateY(${float}px) scale(${scale})`,
        transformOrigin: 'center',
        opacity,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.15)',
          backdropFilter: 'blur(20px)',
          border: '2px solid rgba(255, 255, 255, 0.35)',
          padding: '8px 24px',
          borderRadius: 999,
          color: theme.colors.white,
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: 6,
          fontFamily: theme.fonts.display,
          textTransform: 'uppercase',
          marginBottom: -14,
          position: 'relative',
          zIndex: 2,
        }}
      >
        LOYER · LOYU
      </div>

      <div
        style={{
          background: `linear-gradient(135deg, ${accent}, ${theme.colors.gold})`,
          padding: '28px 48px 22px',
          borderRadius: 28,
          boxShadow: `0 20px 60px ${accent}55, 0 0 0 6px rgba(255,255,255,0.15)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          minWidth: 580,
        }}
      >
        <div
          style={{
            color: theme.colors.nightBlue,
            fontSize: 96,
            fontWeight: 900,
            fontFamily: theme.fonts.display,
            letterSpacing: -2,
            display: 'flex',
            alignItems: 'baseline',
            gap: 12,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
          }}
        >
          <span>{formatRent(displayRent)}</span>
          <span style={{ fontSize: 44, fontWeight: 800 }}>CFA</span>
        </div>
        <div
          style={{
            color: 'rgba(10, 25, 41, 0.75)',
            fontSize: 22,
            fontWeight: 800,
            fontFamily: theme.fonts.display,
            letterSpacing: 4,
            textTransform: 'uppercase',
          }}
        >
          / mois · weer wu nekk
        </div>
      </div>

      <div
        style={{
          marginTop: -16,
          background: theme.colors.nightBlue,
          border: `3px solid ${accent}`,
          padding: '8px 28px',
          borderRadius: 999,
          color: theme.colors.white,
          fontSize: 28,
          fontWeight: 900,
          fontFamily: theme.fonts.display,
          letterSpacing: 1,
          position: 'relative',
          zIndex: 2,
          boxShadow: `0 8px 20px rgba(0,0,0,0.4)`,
        }}
      >
        {size}
      </div>
    </div>
  );
};
