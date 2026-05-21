import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  staticFile,
  Img,
} from 'remotion';
import { theme } from '../styles/theme';
import { neighborhoods } from '../data/neighborhoods';

export const Outro: React.FC<{ durationInFrames: number }> = ({
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleEnter = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 90 },
  });
  const wolofEnter = spring({
    frame: frame - 14,
    fps,
    config: { damping: 12, stiffness: 90 },
  });
  const gridEnter = spring({
    frame: frame - 24,
    fps,
    config: { damping: 14, stiffness: 80 },
  });
  const logoEnter = spring({
    frame: frame - 56,
    fps,
    config: { damping: 14, stiffness: 100 },
  });

  const arrowBounce = Math.sin(frame * 0.15) * 8;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at center, ${theme.colors.brandBlueLight} 0%, ${theme.colors.brandBlueDark} 70%)`,
        overflow: 'hidden',
      }}
    >
      {/* Floating particles */}
      {[...Array(40)].map((_, i) => {
        const x = (i * 53 + frame * 0.4) % 1080;
        const y = (i * 91 + frame * 0.3) % 1920;
        const opacity = 0.3 + Math.sin(frame * 0.05 + i) * 0.3;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: 4,
              height: 4,
              borderRadius: '50%',
              background: theme.colors.brandOrange,
              opacity,
            }}
          />
        );
      })}

      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '90px 50px 50px',
        }}
      >
        {/* Question — French */}
        <div
          style={{
            color: theme.colors.white,
            fontSize: 76,
            fontWeight: 900,
            fontFamily: theme.fonts.display,
            textAlign: 'center',
            opacity: titleEnter,
            transform: `translateY(${interpolate(titleEnter, [0, 1], [40, 0])}px)`,
            lineHeight: 1.05,
            textShadow: '0 4px 24px rgba(0,0,0,0.5)',
            letterSpacing: -2,
          }}
        >
          Lequel{' '}
          <span
            style={{
              background: `linear-gradient(135deg, ${theme.colors.brandOrange}, ${theme.colors.gold})`,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            TOI
          </span>
          ,
          <br />
          choisirais-tu ?
        </div>

        {/* Question — Wolof */}
        <div
          style={{
            marginTop: 24,
            padding: '14px 36px',
            background: 'rgba(228, 149, 54, 0.18)',
            border: `3px solid ${theme.colors.brandOrange}`,
            borderRadius: 999,
            color: theme.colors.sand,
            fontSize: 40,
            fontWeight: 800,
            fontFamily: theme.fonts.display,
            opacity: wolofEnter,
            transform: `translateY(${interpolate(wolofEnter, [0, 1], [30, 0])}px)`,
            fontStyle: 'italic',
            letterSpacing: 1,
          }}
        >
          Ban nga gënël ?
        </div>

        {/* Neighborhood vote grid */}
        <div
          style={{
            marginTop: 44,
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 14,
            width: '100%',
            opacity: gridEnter,
            transform: `scale(${interpolate(gridEnter, [0, 1], [0.85, 1])})`,
          }}
        >
          {neighborhoods.map((n, i) => {
            const itemEnter = spring({
              frame: frame - 28 - i * 4,
              fps,
              config: { damping: 14, stiffness: 110 },
            });
            return (
              <div
                key={n.id}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  backdropFilter: 'blur(20px)',
                  border: `3px solid ${n.accent}`,
                  borderRadius: 18,
                  padding: '20px 22px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  gridColumn: i === 4 ? '1 / -1' : undefined,
                  opacity: itemEnter,
                  transform: `translateX(${interpolate(itemEnter, [0, 1], [i % 2 === 0 ? -50 : 50, 0])}px)`,
                  justifyContent: i === 4 ? 'center' : 'flex-start',
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    background: n.accent,
                    color: theme.colors.brandBlueDark,
                    fontSize: 28,
                    fontWeight: 900,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: theme.fonts.display,
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </div>
                <div
                  style={{
                    color: theme.colors.white,
                    fontSize: 30,
                    fontWeight: 800,
                    fontFamily: theme.fonts.display,
                    letterSpacing: -0.5,
                  }}
                >
                  {n.name}
                </div>
              </div>
            );
          })}
        </div>

        {/* Pulsing comment arrow */}
        <div
          style={{
            marginTop: 28,
            color: theme.colors.brandOrangeBright,
            fontSize: 28,
            fontWeight: 800,
            fontFamily: theme.fonts.display,
            opacity: gridEnter,
            transform: `translateY(${arrowBounce}px)`,
            letterSpacing: 6,
          }}
        >
          ↓ COMMENTAIRES ↓
        </div>

        {/* JAMM Immobilier logo - the real one */}
        <div
          style={{
            position: 'absolute',
            bottom: 280,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            opacity: logoEnter,
            transform: `scale(${interpolate(logoEnter, [0, 1], [0.7, 1])})`,
          }}
        >
          <div
            style={{
              background: '#2B3388',
              padding: '20px 28px',
              borderRadius: 22,
              border: `4px solid ${theme.colors.brandOrange}`,
              boxShadow: `0 20px 60px rgba(0,0,0,0.5), 0 0 60px ${theme.colors.brandOrange}88`,
            }}
          >
            <Img
              src={staticFile('jamm-logo-trim.png')}
              style={{
                width: 860,
                height: 'auto',
                display: 'block',
                borderRadius: 10,
              }}
            />
          </div>
        </div>

        {/* Tagline beneath logo */}
        <div
          style={{
            position: 'absolute',
            bottom: 160,
            left: 0,
            right: 0,
            textAlign: 'center',
            color: theme.colors.brandOrangeBright,
            fontSize: 30,
            fontWeight: 800,
            letterSpacing: 6,
            fontFamily: theme.fonts.display,
            opacity: logoEnter,
            textTransform: 'uppercase',
          }}
        >
          DAKAR · SÉNÉGAL
        </div>

        {/* Contact handle */}
        <div
          style={{
            position: 'absolute',
            bottom: 90,
            left: 0,
            right: 0,
            textAlign: 'center',
            opacity: logoEnter,
            display: 'flex',
            justifyContent: 'center',
            gap: 20,
          }}
        >
          <div
            style={{
              padding: '10px 22px',
              background: 'rgba(255,255,255,0.08)',
              border: `2px solid ${theme.colors.brandOrange}`,
              borderRadius: 999,
              color: theme.colors.white,
              fontSize: 26,
              fontWeight: 700,
              fontFamily: theme.fonts.display,
              letterSpacing: 1,
            }}
          >
            📞 Contactez-nous
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
