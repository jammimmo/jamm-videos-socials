import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../styles/theme';
import { Neighborhood } from '../data/neighborhoods';

type Props = {
  pros: Neighborhood['pros'];
  cons: Neighborhood['cons'];
  delay?: number;
};

// Mobile-friendly stacked layout: full width cards, much larger text
export const ProsCons: React.FC<Props> = ({ pros, cons, delay = 0 }) => {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 50,
        left: 36,
        right: 36,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      {/* AVANTAGES section */}
      <SectionHeader
        label="AVANTAGES"
        subLabel="MËN-MËN"
        color={theme.colors.pro}
        delay={delay}
      />
      {pros.map((p, i) => (
        <Card
          key={`pro-${i}`}
          text={p.fr}
          subText={p.wo}
          color={theme.colors.pro}
          icon="✓"
          delay={delay + 6 + i * 5}
        />
      ))}

      <div style={{ height: 6 }} />

      {/* INCONVENIENTS section */}
      <SectionHeader
        label="INCONVÉNIENTS"
        subLabel="JAFE-JAFE"
        color={theme.colors.con}
        delay={delay + 18}
      />
      {cons.map((c, i) => (
        <Card
          key={`con-${i}`}
          text={c.fr}
          subText={c.wo}
          color={theme.colors.con}
          icon="✗"
          delay={delay + 24 + i * 5}
        />
      ))}
    </div>
  );
};

const SectionHeader: React.FC<{
  label: string;
  subLabel: string;
  color: string;
  delay: number;
}> = ({ label, subLabel, color, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame: frame - delay,
    fps,
    config: { damping: 14, stiffness: 110 },
  });
  const slide = interpolate(enter, [0, 1], [-40, 0]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        transform: `translateX(${slide}px)`,
        opacity: enter,
      }}
    >
      <div
        style={{
          flex: 1,
          height: 4,
          background: `linear-gradient(90deg, ${color}, transparent)`,
          borderRadius: 2,
        }}
      />
      <div
        style={{
          color,
          fontSize: 34,
          fontWeight: 900,
          letterSpacing: 3,
          fontFamily: theme.fonts.display,
          textShadow: '0 2px 8px rgba(0,0,0,0.4)',
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: theme.colors.muted,
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: 3,
          fontFamily: theme.fonts.display,
          fontStyle: 'italic',
        }}
      >
        {subLabel}
      </div>
      <div
        style={{
          flex: 1,
          height: 4,
          background: `linear-gradient(90deg, transparent, ${color})`,
          borderRadius: 2,
        }}
      />
    </div>
  );
};

const Card: React.FC<{
  text: string;
  subText: string;
  color: string;
  icon: string;
  delay: number;
}> = ({ text, subText, color, icon, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame: frame - delay,
    fps,
    config: { damping: 13, stiffness: 110 },
  });
  const slide = interpolate(enter, [0, 1], [60, 0]);

  return (
    <div
      style={{
        background: 'rgba(20, 27, 82, 0.85)',
        backdropFilter: 'blur(14px)',
        borderLeft: `8px solid ${color}`,
        borderRadius: 16,
        padding: '18px 22px',
        display: 'flex',
        gap: 18,
        alignItems: 'center',
        transform: `translateX(${slide}px)`,
        opacity: enter,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: color,
          color: theme.colors.brandBlueDark,
          fontSize: 38,
          fontWeight: 900,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: theme.fonts.display,
          flexShrink: 0,
          boxShadow: `0 4px 12px ${color}66`,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            color: theme.colors.white,
            fontSize: 40,
            fontWeight: 800,
            lineHeight: 1.05,
            fontFamily: theme.fonts.display,
            letterSpacing: -0.5,
          }}
        >
          {text}
        </div>
        <div
          style={{
            color: theme.colors.muted,
            fontSize: 28,
            fontWeight: 600,
            fontStyle: 'italic',
            marginTop: 2,
            fontFamily: theme.fonts.display,
          }}
        >
          {subText}
        </div>
      </div>
    </div>
  );
};
