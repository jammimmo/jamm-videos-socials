import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from 'remotion';
import { Neighborhood } from '../data/neighborhoods';
import { ApartmentScene } from './ApartmentScene';
import { MapPin } from './MapPin';
import { PriceTag } from './PriceTag';
import { ProsCons } from './ProsCons';
import { theme } from '../styles/theme';

type Props = {
  neighborhood: Neighborhood;
  index: number;
  durationInFrames: number;
};

export const NeighborhoodSection: React.FC<Props> = ({
  neighborhood,
  index,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleEnter = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 100 },
  });
  const titleY = interpolate(titleEnter, [0, 1], [-100, 0]);
  const titleOpacity = interpolate(titleEnter, [0, 0.5], [0, 1], {
    extrapolateRight: 'clamp',
  });

  const exitStart = durationInFrames - 12;
  const exitProgress = interpolate(frame, [exitStart, durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const exitScale = interpolate(exitProgress, [0, 1], [1, 1.15]);
  const exitOpacity = interpolate(exitProgress, [0, 1], [1, 0]);

  return (
    <AbsoluteFill style={{ opacity: exitOpacity }}>
      <div style={{ transform: `scale(${exitScale})`, width: '100%', height: '100%' }}>
        <ApartmentScene
          neighborhood={neighborhood}
          durationInFrames={durationInFrames}
        />

        {/* Top: counter + title */}
        <div
          style={{
            position: 'absolute',
            top: 50,
            left: 0,
            right: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            transform: `translateY(${titleY}px)`,
            opacity: titleOpacity,
          }}
        >
          {/* Progress dots */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 14,
            }}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <div
                key={n}
                style={{
                  width: n === index + 1 ? 40 : 14,
                  height: 8,
                  borderRadius: 4,
                  background:
                    n === index + 1
                      ? neighborhood.accent
                      : 'rgba(255,255,255,0.3)',
                }}
              />
            ))}
          </div>

          <div
            style={{
              color: neighborhood.accent,
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: 8,
              fontFamily: theme.fonts.display,
              textShadow: '0 2px 8px rgba(0,0,0,0.5)',
            }}
          >
            #{index + 1} / 5
          </div>

          <h1
            style={{
              margin: '6px 0 0 0',
              color: theme.colors.white,
              fontSize: neighborhood.name.length > 10 ? 62 : 80,
              fontWeight: 900,
              fontFamily: theme.fonts.display,
              letterSpacing: -2,
              textAlign: 'center',
              textShadow: '0 4px 24px rgba(0,0,0,0.7)',
              lineHeight: 1,
              padding: '0 20px',
            }}
          >
            {neighborhood.name}
          </h1>
          <div
            style={{
              marginTop: 6,
              color: theme.colors.offWhite,
              fontSize: 26,
              fontWeight: 600,
              fontFamily: theme.fonts.display,
              fontStyle: 'italic',
              textShadow: '0 2px 8px rgba(0,0,0,0.6)',
              textAlign: 'center',
            }}
          >
            {neighborhood.tagline.fr}
          </div>
          <div
            style={{
              color: neighborhood.accent,
              fontSize: 22,
              fontWeight: 700,
              fontFamily: theme.fonts.display,
              textShadow: '0 2px 8px rgba(0,0,0,0.6)',
              textAlign: 'center',
              letterSpacing: 1,
            }}
          >
            {neighborhood.tagline.wo}
          </div>
        </div>

        {/* Map pin in upper-right */}
        <div
          style={{
            position: 'absolute',
            top: 380,
            right: 30,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <div
            style={{
              color: neighborhood.accent,
              fontSize: 16,
              fontWeight: 800,
              letterSpacing: 5,
              fontFamily: theme.fonts.display,
              textShadow: '0 2px 6px rgba(0,0,0,0.6)',
            }}
          >
            DAKAR · CAP-VERT
          </div>
          <div
            style={{
              width: 200,
              height: 200,
              borderRadius: 18,
              overflow: 'hidden',
              border: `3px solid ${neighborhood.accent}`,
              boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
            }}
          >
            <MapPin neighborhood={neighborhood} delay={6} />
          </div>
        </div>

        {/* Dark gradient overlay for readability of pros/cons */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 1050,
            background: `linear-gradient(180deg, transparent 0%, ${theme.colors.brandBlueDark}40 15%, ${theme.colors.brandBlueDark}DD 35%, ${theme.colors.brandBlueDark} 60%, ${theme.colors.brandBlueDark} 100%)`,
            pointerEvents: 'none',
          }}
        />

        {/* Price tag */}
        <PriceTag
          rent={neighborhood.rent}
          size={neighborhood.size}
          accent={neighborhood.accent}
          delay={14}
        />

        {/* Pros and cons */}
        <ProsCons pros={neighborhood.pros} cons={neighborhood.cons} delay={28} />
      </div>
    </AbsoluteFill>
  );
};
