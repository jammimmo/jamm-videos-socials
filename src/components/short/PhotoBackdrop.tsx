import React, { useState, useEffect } from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { theme } from '../../styles/theme';

// PhotoBackdrop loads an optional Dakar background photo from public/photos/.
// If the photo is missing (404), we fall back to a brand gradient so the
// pipeline always renders something. The image gets a subtle Ken Burns zoom +
// dark overlay so subtitles stay readable on top.

export const PhotoBackdrop: React.FC<{ photoPath?: string; durationInFrames: number }> = ({
  photoPath,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [hasPhoto, setHasPhoto] = useState(Boolean(photoPath));

  // Ken Burns
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.12]);
  const tx = interpolate(frame, [0, durationInFrames], [0, -30]);

  const fallback = (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${theme.jamm.blueDark} 0%, ${theme.jamm.blue} 60%, ${theme.jamm.blueDeep} 100%)`,
      }}
    >
      {/* Decorative grid so the fallback never feels empty */}
      <svg viewBox="0 0 1080 1920" width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0.12 }}>
        <defs>
          <pattern id="bg-grid" width="120" height="120" patternUnits="userSpaceOnUse">
            <path d="M 120 0 L 0 0 0 120" fill="none" stroke={theme.jamm.orange} strokeWidth="1.5" />
          </pattern>
        </defs>
        <rect width="1080" height="1920" fill="url(#bg-grid)" />
      </svg>
    </AbsoluteFill>
  );

  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      {hasPhoto && photoPath ? (
        <Img
          src={staticFile(photoPath)}
          onError={() => setHasPhoto(false)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${scale}) translateX(${tx}px)`,
          }}
        />
      ) : (
        fallback
      )}
      {/* Dark overlay for readability */}
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.45) 60%, rgba(0,0,0,0.65) 100%)' }} />
    </AbsoluteFill>
  );
};
