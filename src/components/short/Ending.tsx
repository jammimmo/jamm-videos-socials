import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../styles/theme';
import { JammLogoMark } from './JammLogoMark';

// Ending: agent + family silhouettes (no faces), large logo, CTA.
// Spans frames 990-1350 of the JammShort timeline (12s).

export const Ending: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const sceneEnter = spring({ frame, fps, config: { damping: 14, stiffness: 100 } });
  const messageEnter = spring({ frame: frame - 50, fps, config: { damping: 14, stiffness: 110 } });
  const logoEnter = spring({ frame: frame - 110, fps, config: { damping: 14, stiffness: 100 } });
  const ctaEnter = spring({ frame: frame - 170, fps, config: { damping: 14, stiffness: 110 } });
  const ctaPulse = 1 + Math.sin(frame * 0.15) * 0.04;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at center top, ${theme.jamm.blue} 0%, ${theme.jamm.blueDark} 70%)`,
      }}
    >
      {/* Stars / particles */}
      {[...Array(50)].map((_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: (i * 23) % 1080,
            top: (i * 41) % 1920,
            width: 3,
            height: 3,
            borderRadius: '50%',
            background: theme.jamm.orange,
            opacity: 0.3 + Math.sin(frame * 0.05 + i) * 0.4,
          }}
        />
      ))}

      {/* Faceless agent + family silhouettes */}
      <div style={{ position: 'absolute', top: 200, left: 0, right: 0, display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: 30, opacity: sceneEnter }}>
        <svg width="700" height="560" viewBox="0 0 700 560">
          <defs>
            <linearGradient id="agentGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={theme.jamm.orange} />
              <stop offset="100%" stopColor={theme.jamm.orangeDeep} />
            </linearGradient>
            <linearGradient id="familyGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={theme.jamm.snow} />
              <stop offset="100%" stopColor="#9aa3d6" />
            </linearGradient>
          </defs>

          {/* Building outline behind */}
          <rect x="120" y="60" width="460" height="500" fill={theme.jamm.blueDeep} opacity="0.5" rx="8" />
          {[0, 1, 2, 3, 4].map((row) => [0, 1, 2, 3].map((col) => (
            <rect key={`${row}-${col}`} x={150 + col * 100} y={90 + row * 80} width="70" height="40" fill={theme.jamm.orange} opacity="0.35" />
          )))}

          {/* Agent (orange) — shoulders only, no head */}
          <path d="M 80,300 Q 80,180 180,170 L 280,170 Q 380,180 380,300 L 380,560 L 80,560 Z" fill="url(#agentGrad)" />
          {/* Agent extended arm gesture */}
          <ellipse cx="380" cy="290" rx="80" ry="40" fill="url(#agentGrad)" transform="rotate(-30 380 290)" />
          {/* Keys held out */}
          <circle cx="470" cy="240" r="22" fill={theme.jamm.snow} stroke={theme.jamm.orange} strokeWidth="4" />
          <rect x="490" y="232" width="40" height="16" fill={theme.jamm.snow} />

          {/* Family — parents + child silhouettes */}
          <path d="M 460,330 Q 460,250 510,240 L 540,240 Q 590,250 590,330 L 590,560 L 460,560 Z" fill="url(#familyGrad)" opacity="0.9" />
          <path d="M 590,360 Q 590,300 620,295 L 640,295 Q 670,300 670,360 L 670,560 L 590,560 Z" fill="url(#familyGrad)" opacity="0.85" />
          <path d="M 540,440 Q 540,400 555,398 L 575,398 Q 590,400 590,440 L 590,560 L 540,560 Z" fill="url(#familyGrad)" opacity="0.8" />
        </svg>
      </div>

      {/* Closing message — bilingual FR + EN */}
      <div
        style={{
          position: 'absolute',
          top: 100,
          left: 60,
          right: 60,
          textAlign: 'center',
          opacity: messageEnter,
          transform: `translateY(${interpolate(messageEnter, [0, 1], [40, 0])}px)`,
        }}
      >
        <div
          style={{
            color: 'white',
            fontFamily: theme.fonts.display,
            fontSize: 48,
            fontWeight: 900,
            lineHeight: 1.15,
            textShadow: '0 4px 16px rgba(0,0,0,0.6)',
          }}
        >
          Suivez{' '}
          <span style={{ color: theme.jamm.orange }}>JAMM IMMO</span>
          <br />
          pour éviter les erreurs
          <br />
          qui coûtent cher.
        </div>
        <div
          style={{
            marginTop: 18,
            color: theme.jamm.cream,
            fontFamily: theme.fonts.display,
            fontSize: 30,
            fontWeight: 600,
            fontStyle: 'italic',
            lineHeight: 1.2,
            textShadow: '0 2px 8px rgba(0,0,0,0.5)',
          }}
        >
          Follow <span style={{ color: theme.jamm.orange }}>JAMM IMMO</span> to avoid the mistakes that cost you dearly.
        </div>
      </div>

      {/* Logo */}
      <div
        style={{
          position: 'absolute',
          bottom: 360,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          opacity: logoEnter,
          transform: `scale(${interpolate(logoEnter, [0, 1], [0.7, 1])})`,
        }}
      >
        <JammLogoMark size="lg" />
      </div>

      {/* CTA */}
      <div
        style={{
          position: 'absolute',
          bottom: 200,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          gap: 16,
          opacity: ctaEnter,
          transform: `scale(${ctaPulse})`,
        }}
      >
        <div
          style={{
            padding: '20px 36px',
            background: theme.jamm.orange,
            color: 'white',
            borderRadius: 999,
            fontFamily: theme.fonts.display,
            fontWeight: 900,
            fontSize: 36,
            letterSpacing: 2,
            boxShadow: '0 16px 32px rgba(0,0,0,0.4)',
          }}
        >
          📱 WHATSAPP JAMM IMMO
        </div>
      </div>
    </AbsoluteFill>
  );
};
