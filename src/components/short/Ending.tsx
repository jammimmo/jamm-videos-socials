import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../styles/theme';
import { JammLogoMark } from './JammLogoMark';
import { SocialIcons } from './SocialBranding';

// Ending: a stylised "key-handover" tableau — JAMM IMMO agent (orange suit
// silhouette, no head) extending a key toward a family silhouette (parent +
// child, cream tones, no heads), against a low Dakar skyline glow. Big logo
// and CTA appear early so the panel reads even in the first 2s of looping.

export const Ending: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const sceneEnter = spring({ frame, fps, config: { damping: 14, stiffness: 100 } });
  const keyFly = spring({ frame: frame - 18, fps, config: { damping: 12, stiffness: 80 } });
  const messageEnter = spring({ frame: frame - 30, fps, config: { damping: 14, stiffness: 110 } });
  const logoEnter = spring({ frame: frame - 50, fps, config: { damping: 14, stiffness: 100 } });
  const ctaEnter = spring({ frame: frame - 80, fps, config: { damping: 14, stiffness: 110 } });
  const ctaPulse = 1 + Math.sin(frame * 0.15) * 0.04;

  // Key position interpolates from agent's outstretched hand toward family
  const keyX = interpolate(keyFly, [0, 1], [-60, 80]);

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at center 35%, ${theme.jamm.blue} 0%, ${theme.jamm.blueDark} 70%)`,
      }}
    >
      {/* Soft warm glow behind subjects */}
      <div
        style={{
          position: 'absolute',
          top: '38%',
          left: '50%',
          width: 900,
          height: 600,
          transform: 'translate(-50%, -50%)',
          background: `radial-gradient(ellipse, ${theme.jamm.orange}33 0%, transparent 60%)`,
          filter: 'blur(20px)',
        }}
      />

      {/* Particles / stars */}
      {[...Array(40)].map((_, i) => (
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
            opacity: 0.25 + Math.sin(frame * 0.05 + i) * 0.4,
          }}
        />
      ))}

      {/* Tableau group */}
      <div
        style={{
          position: 'absolute',
          top: 380,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          opacity: sceneEnter,
          transform: `translateY(${interpolate(sceneEnter, [0, 1], [40, 0])}px)`,
        }}
      >
        <svg width="900" height="640" viewBox="0 0 900 640">
          <defs>
            <linearGradient id="agentSuitGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={theme.jamm.orange} />
              <stop offset="100%" stopColor={theme.jamm.orangeDeep} />
            </linearGradient>
            <linearGradient id="familyGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={theme.jamm.snow} />
              <stop offset="100%" stopColor="#b8c0dc" />
            </linearGradient>
            <linearGradient id="skylineGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={theme.jamm.blueDeep} />
              <stop offset="100%" stopColor={theme.jamm.blueDark} />
            </linearGradient>
          </defs>

          {/* Low Dakar skyline behind */}
          <g opacity="0.85">
            {[
              [40, 380, 80, 220],
              [130, 360, 60, 240],
              [200, 320, 100, 280],
              [310, 340, 70, 260],
              [390, 290, 120, 310],
              [520, 330, 80, 270],
              [610, 360, 100, 240],
              [720, 310, 90, 290],
              [820, 350, 60, 250],
            ].map(([x, y, w, h], i) => (
              <g key={i}>
                <rect x={x} y={y} width={w} height={h} fill="url(#skylineGrad)" />
                {[0, 1, 2].map((row) => [0, 1].map((col) => {
                  const lit = (i + row + col) % 3 === 0;
                  return (
                    <rect
                      key={`${row}-${col}`}
                      x={x + 10 + col * (w / 2)}
                      y={y + 20 + row * 50}
                      width={w / 2 - 18}
                      height={20}
                      fill={lit ? theme.jamm.orange : theme.jamm.blue}
                      opacity={lit ? 0.85 : 0.35}
                    />
                  );
                }))}
              </g>
            ))}
          </g>

          {/* Ground plane */}
          <ellipse cx="450" cy="600" rx="380" ry="30" fill="rgba(0,0,0,0.4)" filter="blur(6px)" />

          {/* AGENT — left, orange suit, no head, headless shoulder curve */}
          <g transform="translate(220, 240)">
            {/* Shoulder/body suit jacket — wide top curves up suggesting where the head was */}
            <path
              d="M 0,140 C 0,40 30,0 90,0 L 110,0 C 170,0 200,40 200,140 L 215,420 L -15,420 Z"
              fill="url(#agentSuitGrad)"
            />
            {/* Suit collar V */}
            <path
              d="M 70,5 L 100,90 L 130,5 Z"
              fill={theme.jamm.blueDeep}
            />
            {/* White shirt triangle inside collar */}
            <path d="M 92,30 L 100,90 L 108,30 Z" fill={theme.jamm.snow} />
            {/* Tie */}
            <rect x="95" y="55" width="10" height="60" fill={theme.jamm.orangeDeep} />
            {/* Right arm extended forward, ending in a hand */}
            <path
              d="M 200,140 Q 280,150 360,210 L 360,250 Q 280,200 200,180 Z"
              fill="url(#agentSuitGrad)"
            />
            {/* Hand (warm brown) */}
            <ellipse cx="380" cy="232" rx="30" ry="24" fill="#7a4a2a" stroke="#5a341f" strokeWidth="2" />
          </g>

          {/* KEY flying from agent to family */}
          <g transform={`translate(${640 + keyX}, 470)`}>
            <circle cx="0" cy="0" r="22" fill="none" stroke={theme.jamm.orange} strokeWidth="8" />
            <rect x="20" y="-7" width="48" height="14" fill={theme.jamm.orange} rx="2" />
            <rect x="52" y="7" width="8" height="14" fill={theme.jamm.orange} />
            <rect x="62" y="7" width="6" height="10" fill={theme.jamm.orange} />
          </g>

          {/* FAMILY — right side, three headless silhouettes facing the agent */}
          {/* Parent (taller) */}
          <g transform="translate(560, 250)">
            <path
              d="M 0,130 C 0,40 25,0 75,0 L 95,0 C 145,0 170,40 170,130 L 180,410 L -10,410 Z"
              fill="url(#familyGrad)"
              opacity="0.92"
            />
            {/* Neckline */}
            <path d="M 65,5 L 85,40 L 105,5 Z" fill={theme.jamm.blueDeep} opacity="0.4" />
          </g>

          {/* Second parent */}
          <g transform="translate(710, 270)">
            <path
              d="M 0,125 C 0,40 22,0 65,0 L 82,0 C 125,0 147,40 147,125 L 156,390 L -9,390 Z"
              fill="url(#familyGrad)"
              opacity="0.85"
            />
            <path d="M 60,5 L 75,38 L 90,5 Z" fill={theme.jamm.blueDeep} opacity="0.35" />
          </g>

          {/* Child (shorter, in front) */}
          <g transform="translate(650, 420)">
            <path
              d="M 0,80 C 0,28 15,0 45,0 L 60,0 C 90,0 105,28 105,80 L 112,240 L -7,240 Z"
              fill="url(#familyGrad)"
              opacity="0.85"
            />
            <path d="M 40,5 L 52,30 L 64,5 Z" fill={theme.jamm.blueDeep} opacity="0.4" />
          </g>
        </svg>
      </div>

      {/* Closing message — bilingual FR + EN */}
      <div
        style={{
          position: 'absolute',
          top: 80,
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
            fontSize: 60,
            fontWeight: 900,
            lineHeight: 1.1,
            textShadow: '0 4px 16px rgba(0,0,0,0.7)',
          }}
        >
          Suivez{' '}
          <span style={{ color: theme.jamm.orange }}>JAMM IMMO</span>
          <br />
          pour éviter les erreurs qui coûtent cher.
        </div>
        <div
          style={{
            marginTop: 18,
            color: theme.jamm.cream,
            fontFamily: theme.fonts.display,
            fontSize: 36,
            fontWeight: 600,
            fontStyle: 'italic',
            lineHeight: 1.2,
            textShadow: '0 2px 8px rgba(0,0,0,0.5)',
          }}
        >
          Follow <span style={{ color: theme.jamm.orange }}>JAMM IMMO</span> to avoid the mistakes that cost you dearly.
        </div>
      </div>

      {/* Logo (mid) */}
      <div
        style={{
          position: 'absolute',
          bottom: 490,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          opacity: logoEnter,
          transform: `scale(${interpolate(logoEnter, [0, 1], [0.7, 1])})`,
          zIndex: 10,
        }}
      >
        <JammLogoMark size="md" />
      </div>

      {/* CTA */}
      <div
        style={{
          position: 'absolute',
          bottom: 250,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'column',
          gap: 16,
          opacity: ctaEnter,
          transform: `scale(${ctaPulse})`,
          zIndex: 10,
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
            boxShadow: '0 16px 32px rgba(0,0,0,0.5)',
          }}
        >
          jammimmo.com
        </div>
        <SocialIcons />
      </div>
    </AbsoluteFill>
  );
};
