import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../styles/theme';
import { JammLogoMark } from './JammLogoMark';
import type { HookSpec } from '../../data/videos';

export const Hook: React.FC<{ spec: HookSpec; durationInFrames: number }> = ({ spec, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleEnter = spring({ frame, fps, config: { damping: 12, stiffness: 130 } });
  const titleEnEnter = spring({ frame: frame - 4, fps, config: { damping: 12, stiffness: 130 } });
  const sublineEnter = spring({ frame: frame - 10, fps, config: { damping: 12, stiffness: 110 } });
  const sublineEnEnter = spring({ frame: frame - 14, fps, config: { damping: 12, stiffness: 110 } });
  const cardsEnter = spring({ frame: frame - 20, fps, config: { damping: 14, stiffness: 100 } });
  const exitProgress = interpolate(frame, [durationInFrames - 10, durationInFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${theme.jamm.blueDark} 0%, ${theme.jamm.blue} 70%, ${theme.jamm.blueDeep} 100%)`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '120px 80px',
        opacity: 1 - exitProgress,
        textAlign: 'center',
      }}
    >
      {/* Decorative grid */}
      <svg viewBox="0 0 1080 1920" width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0.12 }}>
        <defs>
          <pattern id="hook-grid" width="100" height="100" patternUnits="userSpaceOnUse">
            <path d="M 100 0 L 0 0 0 100" fill="none" stroke={theme.jamm.orange} strokeWidth="1.5" />
          </pattern>
        </defs>
        <rect width="1080" height="1920" fill="url(#hook-grid)" />
      </svg>

      {/* Logo top */}
      <div style={{ position: 'absolute', top: 80, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
        <JammLogoMark size="sm" />
      </div>

      <div style={{ position: 'relative', zIndex: 2, marginTop: 60 }}>
        {/* French title */}
        <div
          style={{
            fontFamily: theme.fonts.display,
            fontSize: 92,
            fontWeight: 900,
            lineHeight: 1.0,
            letterSpacing: -2,
            opacity: titleEnter,
            transform: `translateY(${interpolate(titleEnter, [0, 1], [60, 0])}px)`,
            textShadow: '0 8px 32px rgba(0,0,0,0.6)',
            background: `linear-gradient(135deg, ${theme.jamm.orange}, #ffd95c)`,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          {spec.title}
        </div>

        {/* English title */}
        <div
          style={{
            marginTop: 14,
            color: theme.jamm.snow,
            fontFamily: theme.fonts.display,
            fontSize: 44,
            fontWeight: 700,
            fontStyle: 'italic',
            letterSpacing: 1,
            opacity: titleEnEnter * 0.95,
            transform: `translateY(${interpolate(titleEnEnter, [0, 1], [30, 0])}px)`,
            textShadow: '0 4px 16px rgba(0,0,0,0.5)',
          }}
        >
          {spec.titleEn}
        </div>

        {/* French subline */}
        <div
          style={{
            marginTop: 32,
            color: 'white',
            fontFamily: theme.fonts.display,
            fontSize: 40,
            fontWeight: 700,
            opacity: sublineEnter,
            transform: `translateY(${interpolate(sublineEnter, [0, 1], [40, 0])}px)`,
            lineHeight: 1.2,
          }}
        >
          {spec.subline}
        </div>

        {/* English subline */}
        <div
          style={{
            marginTop: 8,
            color: theme.jamm.cream,
            fontFamily: theme.fonts.display,
            fontSize: 28,
            fontWeight: 500,
            fontStyle: 'italic',
            opacity: sublineEnEnter * 0.9,
            transform: `translateY(${interpolate(sublineEnEnter, [0, 1], [24, 0])}px)`,
            lineHeight: 1.2,
          }}
        >
          {spec.sublineEn}
        </div>
      </div>

      {/* Hook cards */}
      <div
        style={{
          position: 'absolute',
          bottom: 320,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          gap: 18,
          flexWrap: 'wrap',
          padding: '0 60px',
          opacity: cardsEnter,
        }}
      >
        {spec.cards.map((card, i) => {
          const cardSpring = spring({ frame: frame - 22 - i * 4, fps, config: { damping: 14, stiffness: 110 } });
          return (
            <div
              key={`${card}-${i}`}
              style={{
                padding: '16px 28px',
                background: 'rgba(255,255,255,0.12)',
                backdropFilter: 'blur(10px)',
                border: `3px solid ${theme.jamm.orange}`,
                borderRadius: 999,
                color: 'white',
                fontFamily: theme.fonts.display,
                fontWeight: 900,
                fontSize: 32,
                letterSpacing: 1,
                opacity: cardSpring,
                transform: `scale(${cardSpring})`,
              }}
            >
              {card}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
