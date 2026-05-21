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

export const Intro: React.FC<{ durationInFrames: number }> = ({
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const moneyEnter = spring({ frame, fps, config: { damping: 15, stiffness: 80 } });

  const line1Enter = spring({
    frame: frame - 6,
    fps,
    config: { damping: 12, stiffness: 100 },
  });
  const line2Enter = spring({
    frame: frame - 18,
    fps,
    config: { damping: 12, stiffness: 100 },
  });
  const line3Enter = spring({
    frame: frame - 32,
    fps,
    config: { damping: 12, stiffness: 100 },
  });
  const brandEnter = spring({
    frame: frame - 50,
    fps,
    config: { damping: 14, stiffness: 100 },
  });

  const numberPulse = interpolate(
    Math.sin(frame * 0.3),
    [-1, 1],
    [0.98, 1.04]
  );

  const exitStart = durationInFrames - 12;
  const exitProgress = interpolate(frame, [exitStart, durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(165deg, ${theme.colors.brandBlueDark} 0%, ${theme.colors.brandBlue} 60%, ${theme.colors.brandBlueLight} 100%)`,
        overflow: 'hidden',
        opacity: 1 - exitProgress,
      }}
    >
      {/* Animated grid background */}
      <svg
        viewBox="0 0 1080 1920"
        style={{ position: 'absolute', inset: 0, opacity: 0.15 }}
      >
        <defs>
          <pattern id="intro-grid" width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M 80 0 L 0 0 0 80" fill="none" stroke={theme.colors.brandOrange} strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="1080" height="1920" fill="url(#intro-grid)" />
      </svg>

      {/* Floating CFA bills */}
      {[...Array(12)].map((_, i) => {
        const startX = (i * 97) % 1000;
        const fallY = ((frame * 3 + i * 200) % 2200) - 200;
        const rotate = frame * 2 + i * 30;
        const billOpacity = interpolate(fallY, [-200, 0, 1920, 2100], [0, 0.7, 0.7, 0]);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: startX,
              top: fallY,
              width: 110,
              height: 56,
              background: 'linear-gradient(135deg, #4ADE80, #2D8F4F)',
              borderRadius: 8,
              transform: `rotate(${rotate}deg)`,
              opacity: billOpacity * moneyEnter,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFF',
              fontSize: 20,
              fontWeight: 900,
              fontFamily: theme.fonts.display,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              border: '2px solid rgba(255,255,255,0.4)',
              zIndex: 1,
            }}
          >
            CFA
          </div>
        );
      })}

      {/* Centered title block */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 60px',
          textAlign: 'center',
          zIndex: 2,
        }}
      >
        <div
          style={{
            color: theme.colors.offWhite,
            fontSize: 40,
            fontWeight: 700,
            letterSpacing: 6,
            fontFamily: theme.fonts.display,
            opacity: line1Enter,
            transform: `translateY(${interpolate(line1Enter, [0, 1], [40, 0])}px)`,
            textTransform: 'uppercase',
          }}
        >
          Que loue-t-on à
        </div>

        <div
          style={{
            margin: '20px 0',
            transform: `scale(${line2Enter * numberPulse})`,
            opacity: line2Enter,
          }}
        >
          <div
            style={{
              background: `linear-gradient(135deg, ${theme.colors.brandOrange}, ${theme.colors.gold})`,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              fontSize: 200,
              fontWeight: 900,
              fontFamily: theme.fonts.display,
              letterSpacing: -8,
              lineHeight: 0.9,
              filter: 'drop-shadow(0 0 30px rgba(244,196,48,0.5))',
            }}
          >
            300.000
          </div>
          <div
            style={{
              color: theme.colors.brandOrange,
              fontSize: 88,
              fontWeight: 900,
              fontFamily: theme.fonts.display,
              letterSpacing: 8,
              marginTop: -10,
            }}
          >
            CFA
          </div>
        </div>

        <div
          style={{
            color: theme.colors.white,
            fontSize: 64,
            fontWeight: 900,
            fontFamily: theme.fonts.display,
            opacity: line2Enter,
            transform: `translateY(${interpolate(line2Enter, [0, 1], [40, 0])}px)`,
            textShadow: '0 4px 24px rgba(0,0,0,0.5)',
          }}
        >
          à Dakar ?
        </div>

        <div
          style={{
            marginTop: 30,
            padding: '16px 40px',
            background: 'rgba(228, 149, 54, 0.18)',
            border: `3px solid ${theme.colors.brandOrange}`,
            borderRadius: 999,
            color: theme.colors.sand,
            fontSize: 38,
            fontWeight: 800,
            fontFamily: theme.fonts.display,
            opacity: line3Enter,
            transform: `translateY(${interpolate(line3Enter, [0, 1], [40, 0])}px)`,
            fontStyle: 'italic',
            letterSpacing: 1,
          }}
        >
          Loo mën am ci Dakar ?
        </div>

        <div
          style={{
            marginTop: 50,
            color: theme.colors.muted,
            fontSize: 30,
            fontWeight: 700,
            fontFamily: theme.fonts.display,
            opacity: line3Enter,
            letterSpacing: 4,
          }}
        >
          5 QUARTIERS · 5 RÉPONSES
        </div>
      </div>

      {/* Brand mark — small JAMM logo */}
      <div
        style={{
          position: 'absolute',
          bottom: 60,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          opacity: brandEnter,
          transform: `scale(${interpolate(brandEnter, [0, 1], [0.7, 1])})`,
          zIndex: 3,
        }}
      >
        <div
          style={{
            background: '#2B3388',
            padding: '10px 16px',
            borderRadius: 14,
            border: `2px solid ${theme.colors.brandOrange}`,
            boxShadow: `0 8px 24px rgba(0,0,0,0.4)`,
          }}
        >
          <Img
            src={staticFile('jamm-logo-trim.png')}
            style={{
              width: 420,
              height: 'auto',
              display: 'block',
              borderRadius: 6,
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
