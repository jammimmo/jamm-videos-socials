import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { theme } from '../../../styles/theme';
import type { SceneVisualProps } from '../../../data/scene-visuals';

const Tile: React.FC<{ icon: string; label: string; color: string; delay: number; frame: number; fps: number }> = ({ icon, label, color, delay, frame, fps }) => {
  const enter = spring({ frame: frame - delay, fps, config: { damping: 12, stiffness: 110 } });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 32, background: 'white', borderRadius: 28, border: `5px solid ${color}`, boxShadow: '0 16px 32px rgba(0,0,0,0.35)', opacity: enter, transform: `scale(${enter})` }}>
      <div style={{ fontSize: 110 }}>{icon}</div>
      <div style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 36, color: theme.jamm.blue, letterSpacing: 1 }}>{label}</div>
    </div>
  );
};

export const TransitIconsVisual: React.FC<SceneVisualProps> = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 720, height: 720, transform: `scale(${enter})`, padding: 30 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 24, alignContent: 'center', height: '100%' }}>
          <Tile icon="🚌" label="BUS" color={theme.jamm.orange} delay={0} frame={frame} fps={fps} />
          <Tile icon="🚕" label="TAXI" color={theme.jamm.blue} delay={6} frame={frame} fps={fps} />
          <Tile icon="🛵" label="MOTO" color="#a93232" delay={12} frame={frame} fps={fps} />
          <Tile icon="🚶" label="MARCHE" color="#4ADE80" delay={18} frame={frame} fps={fps} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
