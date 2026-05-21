import React from 'react';
import { useCurrentFrame, spring, useVideoConfig, interpolate } from 'remotion';
import { Neighborhood } from '../data/neighborhoods';

type Props = {
  neighborhood: Neighborhood;
  delay?: number;
};

// Simplified Dakar peninsula outline (1080x1080 viewBox)
// The Cap-Vert peninsula juts out into the Atlantic; this is a stylized version
const DAKAR_PATH =
  'M 200 500 Q 180 450 220 420 Q 280 380 350 400 Q 420 410 470 440 Q 500 460 510 500 Q 530 540 510 580 Q 480 620 440 640 Q 400 680 360 720 Q 340 750 380 760 Q 450 770 530 760 Q 620 750 700 740 Q 800 720 880 700 Q 950 680 980 650 Q 1000 600 980 560 Q 940 520 880 510 Q 800 500 720 510 Q 640 520 580 510 Q 520 500 480 480 Q 440 460 400 460 Q 350 460 300 470 Q 250 480 220 490 Z';

export const MapPin: React.FC<Props> = ({ neighborhood, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const adjustedFrame = frame - delay;

  const drop = spring({
    frame: adjustedFrame,
    fps,
    config: { damping: 8, stiffness: 120, mass: 0.6 },
  });

  const pulse = interpolate(
    Math.sin(adjustedFrame * 0.15),
    [-1, 1],
    [0.95, 1.15]
  );

  const mapAppear = spring({
    frame: adjustedFrame,
    fps,
    config: { damping: 20, stiffness: 80 },
  });

  // Pin position
  const pinX = neighborhood.pin.x;
  const pinY = neighborhood.pin.y;
  const pinDropY = interpolate(drop, [0, 1], [pinY - 200, pinY]);
  const pinOpacity = drop > 0.05 ? 1 : 0;

  return (
    <svg
      viewBox="0 0 1080 1080"
      style={{
        width: '100%',
        height: '100%',
        opacity: mapAppear,
      }}
    >
      {/* Ocean background */}
      <defs>
        <radialGradient id="ocean-grad">
          <stop offset="0%" stopColor="#0A2540" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#0A1929" stopOpacity="0.85" />
        </radialGradient>
        <filter id="pin-glow">
          <feGaussianBlur stdDeviation="8" />
        </filter>
      </defs>

      <rect x="0" y="0" width="1080" height="1080" fill="url(#ocean-grad)" />

      {/* Wave hatching texture */}
      {[...Array(20)].map((_, i) => (
        <path
          key={i}
          d={`M 0 ${60 + i * 55} Q ${270} ${50 + i * 55} 540 ${60 + i * 55} T 1080 ${60 + i * 55}`}
          fill="none"
          stroke="#1A3A5C"
          strokeWidth="1.5"
          opacity="0.4"
        />
      ))}

      {/* Dakar peninsula */}
      <path
        d={DAKAR_PATH}
        fill="#E8C896"
        stroke="#FFC857"
        strokeWidth="3"
        opacity={0.9}
      />
      <path
        d={DAKAR_PATH}
        fill="none"
        stroke="#FF6B35"
        strokeWidth="2"
        opacity={0.7}
        strokeDasharray="4 6"
      />

      {/* Label: Dakar */}
      <text
        x="540"
        y="900"
        textAnchor="middle"
        fontFamily="Inter, sans-serif"
        fontSize="38"
        fontWeight="700"
        fill="#FFC857"
        letterSpacing="8"
        opacity={mapAppear}
      >
        DAKAR
      </text>
      <line x1="440" y1="920" x2="640" y2="920" stroke="#FFC857" strokeWidth="2" opacity={mapAppear} />

      {/* Other neighborhood dots (faded reference) */}
      <g opacity="0.35">
        <circle cx="410" cy="720" r="6" fill="#FFFFFF" />
        <circle cx="220" cy="540" r="6" fill="#FFFFFF" />
        <circle cx="360" cy="460" r="6" fill="#FFFFFF" />
        <circle cx="480" cy="480" r="6" fill="#FFFFFF" />
        <circle cx="760" cy="480" r="6" fill="#FFFFFF" />
      </g>

      {/* Active pin */}
      <g opacity={pinOpacity}>
        {/* Pulse ring */}
        <circle
          cx={pinX}
          cy={pinY}
          r={30 * pulse}
          fill="none"
          stroke={neighborhood.accent}
          strokeWidth="4"
          opacity={0.5}
        />
        <circle
          cx={pinX}
          cy={pinY}
          r={45 * pulse}
          fill="none"
          stroke={neighborhood.accent}
          strokeWidth="2"
          opacity={0.3}
        />

        {/* Pin shadow */}
        <ellipse cx={pinX} cy={pinY + 8} rx="20" ry="6" fill="#000" opacity="0.4" />

        {/* Pin teardrop */}
        <g transform={`translate(${pinX}, ${pinDropY})`}>
          <path
            d="M 0 -50 C -22 -50 -36 -32 -36 -14 C -36 8 -8 28 0 40 C 8 28 36 8 36 -14 C 36 -32 22 -50 0 -50 Z"
            fill={neighborhood.accent}
            stroke="#FFFFFF"
            strokeWidth="3"
            filter="url(#pin-glow)"
          />
          <path
            d="M 0 -50 C -22 -50 -36 -32 -36 -14 C -36 8 -8 28 0 40 C 8 28 36 8 36 -14 C 36 -32 22 -50 0 -50 Z"
            fill={neighborhood.accent}
            stroke="#FFFFFF"
            strokeWidth="3"
          />
          <circle cx="0" cy="-18" r="12" fill="#FFFFFF" />
        </g>
      </g>
    </svg>
  );
};
