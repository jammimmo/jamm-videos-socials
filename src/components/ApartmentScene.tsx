import React from 'react';
import { AbsoluteFill, useCurrentFrame, interpolate, Easing } from 'remotion';
import { Neighborhood } from '../data/neighborhoods';

type Props = {
  neighborhood: Neighborhood;
  durationInFrames: number;
};

// Skyline silhouettes vary by neighborhood
const Skyline: React.FC<{ style: Neighborhood['silhouette']; color: string }> = ({
  style,
  color,
}) => {
  const props = { fill: color, opacity: 0.85 };
  switch (style) {
    case 'highrise':
      return (
        <g {...props}>
          {/* Plateau - tall office buildings */}
          <rect x="100" y="600" width="80" height="400" />
          <rect x="200" y="500" width="120" height="500" />
          <rect x="340" y="450" width="100" height="550" />
          <rect x="460" y="520" width="90" height="480" />
          <rect x="570" y="480" width="130" height="520" />
          <rect x="720" y="540" width="110" height="460" />
          <rect x="850" y="500" width="100" height="500" />
          {/* Windows */}
          {[...Array(20)].map((_, i) => (
            <rect
              key={i}
              x={120 + (i % 10) * 80}
              y={700 + Math.floor(i / 10) * 60}
              width="14"
              height="20"
              fill="#FFC857"
              opacity="0.9"
            />
          ))}
        </g>
      );
    case 'palms':
      return (
        <g>
          {/* Almadies - low modern + palms */}
          <g {...props}>
            <rect x="50" y="700" width="200" height="300" rx="4" />
            <rect x="280" y="650" width="240" height="350" rx="4" />
            <rect x="700" y="680" width="280" height="320" rx="4" />
          </g>
          {/* Palm trees */}
          {[180, 540, 660, 880].map((x, i) => (
            <g key={i} transform={`translate(${x}, 500)`}>
              <rect x="-6" y="50" width="12" height="280" fill="#3D2817" />
              <ellipse cx="0" cy="40" rx="70" ry="20" fill="#2D5016" opacity="0.9" transform="rotate(-15)" />
              <ellipse cx="0" cy="40" rx="70" ry="20" fill="#2D5016" opacity="0.9" transform="rotate(15)" />
              <ellipse cx="0" cy="40" rx="70" ry="20" fill="#4A7C2E" opacity="0.9" transform="rotate(-45)" />
              <ellipse cx="0" cy="40" rx="70" ry="20" fill="#4A7C2E" opacity="0.9" transform="rotate(45)" />
              <ellipse cx="0" cy="40" rx="20" ry="60" fill="#2D5016" opacity="0.9" />
            </g>
          ))}
        </g>
      );
    case 'beach':
      return (
        <g>
          {/* Yoff - coastal, fishing boats */}
          <g {...props}>
            <rect x="80" y="720" width="180" height="280" rx="2" />
            <rect x="290" y="700" width="160" height="300" rx="2" />
            <rect x="480" y="730" width="200" height="270" rx="2" />
            <rect x="710" y="710" width="170" height="290" rx="2" />
            <rect x="900" y="740" width="120" height="260" rx="2" />
          </g>
          {/* Fishing pirogues silhouettes on water */}
          <g fill="#0A1929" opacity="0.6">
            <path d="M 150 950 Q 200 940 250 950 L 240 970 L 160 970 Z" />
            <path d="M 600 970 Q 650 960 700 970 L 690 990 L 610 990 Z" />
          </g>
        </g>
      );
    case 'lowrise':
      return (
        <g {...props}>
          {/* Parcelles - 3-4 story blocks */}
          <rect x="40" y="650" width="180" height="350" />
          <rect x="240" y="680" width="160" height="320" />
          <rect x="420" y="640" width="190" height="360" />
          <rect x="630" y="670" width="170" height="330" />
          <rect x="820" y="650" width="200" height="350" />
          {/* Windows */}
          {[0, 1, 2, 3, 4].map((row) =>
            [40, 240, 420, 630, 820].map((x, col) => (
              <g key={`${row}-${col}`}>
                <rect x={x + 15} y={680 + row * 60} width="20" height="28" fill="#FFC857" opacity="0.8" />
                <rect x={x + 55} y={680 + row * 60} width="20" height="28" fill="#FFC857" opacity="0.8" />
                <rect x={x + 95} y={680 + row * 60} width="20" height="28" fill="#FFC857" opacity="0.8" />
                <rect x={x + 135} y={680 + row * 60} width="20" height="28" fill="#FFC857" opacity="0.8" />
              </g>
            ))
          )}
        </g>
      );
    case 'distant':
      return (
        <g {...props}>
          {/* Keur Massar - sparse, distant, suburban */}
          <rect x="60" y="780" width="140" height="220" />
          <rect x="220" y="820" width="120" height="180" />
          <rect x="380" y="760" width="160" height="240" />
          <rect x="580" y="800" width="130" height="200" />
          <rect x="740" y="780" width="150" height="220" />
          <rect x="920" y="810" width="100" height="190" />
          {/* Sparse trees */}
          <circle cx="190" cy="760" r="40" fill="#2D5016" opacity="0.7" />
          <circle cx="540" cy="740" r="50" fill="#2D5016" opacity="0.7" />
          <circle cx="910" cy="770" r="45" fill="#2D5016" opacity="0.7" />
        </g>
      );
  }
};

// Foreground apartment building - the "hero" subject
const HeroBuilding: React.FC<{ style: Neighborhood['buildingStyle']; accent: string }> = ({
  style,
  accent,
}) => {
  switch (style) {
    case 'colonial':
      return (
        <g>
          {/* Plateau old colonial building */}
          <rect x="320" y="400" width="440" height="600" fill="#E8C896" />
          <rect x="320" y="400" width="440" height="80" fill="#C9A876" />
          {/* Decorative cornices */}
          <rect x="310" y="475" width="460" height="12" fill="#8B6F47" />
          <rect x="310" y="700" width="460" height="12" fill="#8B6F47" />
          {/* Tall arched windows */}
          {[0, 1, 2].map((row) =>
            [0, 1, 2, 3].map((col) => (
              <g key={`${row}-${col}`}>
                <path
                  d={`M ${360 + col * 100} ${510 + row * 160} L ${360 + col * 100} ${590 + row * 160} L ${430 + col * 100} ${590 + row * 160} L ${430 + col * 100} ${510 + row * 160} Q ${395 + col * 100} ${490 + row * 160} ${360 + col * 100} ${510 + row * 160} Z`}
                  fill="#1A3A5C"
                />
                <path
                  d={`M ${360 + col * 100} ${510 + row * 160} L ${360 + col * 100} ${590 + row * 160} L ${430 + col * 100} ${590 + row * 160} L ${430 + col * 100} ${510 + row * 160} Q ${395 + col * 100} ${490 + row * 160} ${360 + col * 100} ${510 + row * 160} Z`}
                  fill="none"
                  stroke="#8B6F47"
                  strokeWidth="3"
                />
              </g>
            ))
          )}
          {/* Door */}
          <rect x="500" y="880" width="80" height="120" fill="#4A2F1A" />
          <rect x="495" y="870" width="90" height="14" fill="#8B6F47" />
          {/* Highlighted (rented) window */}
          <rect x="660" y="510" width="70" height="80" fill={accent} opacity="0.95">
            <animate attributeName="opacity" values="0.95;0.7;0.95" dur="2s" repeatCount="indefinite" />
          </rect>
        </g>
      );
    case 'modern':
      return (
        <g>
          {/* Almadies modern glass building */}
          <rect x="340" y="380" width="400" height="620" fill="#3A4A5C" />
          {/* Glass curtain wall */}
          <rect x="350" y="390" width="380" height="600" fill="#5C8DAA" opacity="0.6" />
          {/* Horizontal floor dividers */}
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <rect
              key={i}
              x="340"
              y={390 + i * 100}
              width="400"
              height="6"
              fill="#0A1929"
            />
          ))}
          {/* Reflective glass panels with shimmer */}
          {[0, 1, 2, 3, 4, 5].map((row) =>
            [0, 1, 2, 3].map((col) => (
              <rect
                key={`${row}-${col}`}
                x={355 + col * 95}
                y={398 + row * 100}
                width="85"
                height="90"
                fill="#7BB3D1"
                opacity={0.3 + (row + col) * 0.08}
              />
            ))
          )}
          {/* Balconies */}
          {[1, 3, 5].map((row) => (
            <g key={row}>
              <rect x="540" y={485 + row * 100} width="100" height="6" fill="#0A1929" />
              <rect x="540" y={485 + row * 100} width="4" height="20" fill="#0A1929" />
              <rect x="636" y={485 + row * 100} width="4" height="20" fill="#0A1929" />
            </g>
          ))}
          {/* Glowing penthouse */}
          <rect x="370" y="395" width="340" height="90" fill={accent} opacity="0.7">
            <animate attributeName="opacity" values="0.7;0.4;0.7" dur="2.5s" repeatCount="indefinite" />
          </rect>
        </g>
      );
    case 'coastal':
      return (
        <g>
          {/* Yoff coastal villa-style apartment */}
          <rect x="300" y="500" width="480" height="500" fill="#F5F0E8" />
          <rect x="300" y="500" width="480" height="40" fill="#FF6B35" opacity="0.8" />
          {/* Stucco texture lines */}
          <line x1="300" y1="700" x2="780" y2="700" stroke="#D4C4A8" strokeWidth="3" />
          {/* Big windows for ocean view */}
          {[0, 1, 2].map((col) => (
            <g key={col}>
              <rect x={340 + col * 140} y="580" width="100" height="100" fill="#4FC3F7" opacity="0.8" />
              <rect x={340 + col * 140} y="580" width="100" height="100" fill="none" stroke="#3A4A5C" strokeWidth="4" />
              <line x1={390 + col * 140} y1="580" x2={390 + col * 140} y2="680" stroke="#3A4A5C" strokeWidth="3" />
            </g>
          ))}
          {/* Lower floor */}
          {[0, 1, 2].map((col) => (
            <g key={col}>
              <rect x={340 + col * 140} y="780" width="100" height="100" fill="#1A3A5C" opacity="0.85" />
              <rect x={340 + col * 140} y="780" width="100" height="100" fill="none" stroke="#3A4A5C" strokeWidth="4" />
            </g>
          ))}
          {/* Door */}
          <rect x="500" y="900" width="80" height="100" fill="#4A2F1A" />
          {/* Featured apartment */}
          <rect x="480" y="580" width="100" height="100" fill={accent} opacity="0.9">
            <animate attributeName="opacity" values="0.9;0.6;0.9" dur="2s" repeatCount="indefinite" />
          </rect>
        </g>
      );
    case 'block':
      return (
        <g>
          {/* Parcelles standard apartment block */}
          <rect x="280" y="350" width="520" height="650" fill="#D4B896" />
          {/* Concrete bands */}
          <rect x="270" y="420" width="540" height="14" fill="#A89070" />
          <rect x="270" y="560" width="540" height="14" fill="#A89070" />
          <rect x="270" y="700" width="540" height="14" fill="#A89070" />
          <rect x="270" y="840" width="540" height="14" fill="#A89070" />
          {/* Windows grid */}
          {[0, 1, 2, 3].map((row) =>
            [0, 1, 2, 3, 4].map((col) => (
              <g key={`${row}-${col}`}>
                <rect
                  x={310 + col * 95}
                  y={450 + row * 140}
                  width="65"
                  height="80"
                  fill="#1A3A5C"
                />
                <line
                  x1={342 + col * 95}
                  y1={450 + row * 140}
                  x2={342 + col * 95}
                  y2={530 + row * 140}
                  stroke="#5C8DAA"
                  strokeWidth="2"
                />
              </g>
            ))
          )}
          {/* Laundry on balcony (cultural detail) */}
          <line x1="380" y1="600" x2="500" y2="600" stroke="#FFF" strokeWidth="2" />
          <rect x="400" y="600" width="20" height="40" fill="#FF6B35" opacity="0.8" />
          <rect x="430" y="600" width="20" height="35" fill="#4FC3F7" opacity="0.8" />
          <rect x="460" y="600" width="20" height="42" fill="#FFC857" opacity="0.8" />
          {/* Featured unit */}
          <rect x="595" y="450" width="65" height="80" fill={accent} opacity="0.95">
            <animate attributeName="opacity" values="0.95;0.6;0.95" dur="2s" repeatCount="indefinite" />
          </rect>
        </g>
      );
    case 'suburban':
      return (
        <g>
          {/* Keur Massar suburban duplex */}
          <rect x="240" y="500" width="600" height="500" fill="#E8D4B8" />
          {/* Roof */}
          <polygon points="220,500 540,380 860,500" fill="#8B4513" />
          <polygon points="540,380 860,500 860,520 540,400" fill="#6B3410" />
          {/* Big windows */}
          <rect x="290" y="580" width="160" height="180" fill="#1A3A5C" />
          <rect x="290" y="580" width="160" height="180" fill="none" stroke="#5A4A30" strokeWidth="5" />
          <line x1="370" y1="580" x2="370" y2="760" stroke="#5A4A30" strokeWidth="4" />
          <line x1="290" y1="670" x2="450" y2="670" stroke="#5A4A30" strokeWidth="4" />

          <rect x="630" y="580" width="160" height="180" fill="#1A3A5C" />
          <rect x="630" y="580" width="160" height="180" fill="none" stroke="#5A4A30" strokeWidth="5" />
          <line x1="710" y1="580" x2="710" y2="760" stroke="#5A4A30" strokeWidth="4" />
          <line x1="630" y1="670" x2="790" y2="670" stroke="#5A4A30" strokeWidth="4" />
          {/* Central door */}
          <rect x="490" y="800" width="100" height="200" fill="#4A2F1A" />
          <rect x="480" y="790" width="120" height="20" fill="#6B3410" />
          {/* Featured apartment */}
          <rect x="290" y="580" width="160" height="180" fill={accent} opacity="0.85">
            <animate attributeName="opacity" values="0.85;0.5;0.85" dur="2s" repeatCount="indefinite" />
          </rect>
          {/* Yard / palms */}
          <rect x="180" y="980" width="720" height="20" fill="#A8C97F" />
          <circle cx="180" cy="900" r="40" fill="#2D5016" opacity="0.8" />
          <rect x="174" y="900" width="12" height="80" fill="#3D2817" />
        </g>
      );
  }
};

export const ApartmentScene: React.FC<Props> = ({ neighborhood, durationInFrames }) => {
  const frame = useCurrentFrame();

  // Drone-like camera move: slow zoom in + slight pan
  const progress = frame / durationInFrames;
  const scale = interpolate(progress, [0, 1], [1.05, 1.15], {
    easing: Easing.bezier(0.4, 0, 0.2, 1),
  });
  const translateY = interpolate(progress, [0, 1], [-20, 20]);
  const translateX = interpolate(
    progress,
    [0, 1],
    [neighborhood.id === 'almadies' ? 30 : -30, neighborhood.id === 'almadies' ? -30 : 30]
  );

  // Sun position shifts subtly
  const sunY = interpolate(progress, [0, 1], [180, 220]);

  const [bgTop, bgBottom] = neighborhood.bgGradient;

  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: bgTop }}>
      <div
        style={{
          width: '100%',
          height: '100%',
          transform: `scale(${scale}) translate(${translateX}px, ${translateY}px)`,
          transformOrigin: 'center 60%',
        }}
      >
        <svg viewBox="0 0 1080 1080" style={{ width: '100%', height: '100%' }}>
          <defs>
            <linearGradient id={`sky-${neighborhood.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={bgTop} />
              <stop offset="60%" stopColor={bgBottom} />
              <stop offset="100%" stopColor={neighborhood.accent} stopOpacity="0.4" />
            </linearGradient>
            <radialGradient id={`sun-${neighborhood.id}`}>
              <stop offset="0%" stopColor="#FFE5C2" stopOpacity="1" />
              <stop offset="70%" stopColor={neighborhood.accent} stopOpacity="0.6" />
              <stop offset="100%" stopColor={neighborhood.accent} stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Sky */}
          <rect x="0" y="0" width="1080" height="1080" fill={`url(#sky-${neighborhood.id})`} />

          {/* Sun/glow */}
          <circle cx="780" cy={sunY} r="180" fill={`url(#sun-${neighborhood.id})`} />
          <circle cx="780" cy={sunY} r="60" fill="#FFE5C2" opacity="0.9" />

          {/* Background skyline */}
          <g style={{ transform: 'translateY(0px)' }}>
            <Skyline style={neighborhood.silhouette} color="#0A1929" />
          </g>

          {/* Foreground building - the hero apartment */}
          <HeroBuilding style={neighborhood.buildingStyle} accent={neighborhood.accent} />

          {/* Ground / atmosphere */}
          <rect x="0" y="1000" width="1080" height="80" fill="#0A1929" opacity="0.7" />

          {/* Light particles / atmosphere */}
          {[...Array(15)].map((_, i) => {
            const px = (i * 73 + frame * 0.5) % 1080;
            const py = (i * 137) % 800;
            return (
              <circle
                key={i}
                cx={px}
                cy={py}
                r={1.5}
                fill="#FFC857"
                opacity={0.4 + Math.sin(frame * 0.05 + i) * 0.3}
              />
            );
          })}
        </svg>
      </div>

      {/* Cinematic vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.55) 100%)',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
