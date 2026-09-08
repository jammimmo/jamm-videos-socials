import React from 'react';
import { Img, staticFile } from 'remotion';
import { theme } from '../../styles/theme';

type Size = 'sm' | 'md' | 'lg';

const widths: Record<Size, number> = {
  sm: 360,
  md: 560,
  lg: 820,
};

export const JammLogoMark: React.FC<{ size?: Size; glow?: boolean }> = ({
  size = 'md',
  glow = true,
}) => (
  <div
    style={{
      display: 'inline-block',
      background: theme.jamm.blue,
      padding: size === 'lg' ? '20px 28px' : '14px 20px',
      borderRadius: size === 'lg' ? 22 : 16,
      border: `${size === 'lg' ? 6 : 4}px solid ${theme.jamm.orange}`,
      boxShadow: glow
        ? `0 16px 48px rgba(0,0,0,0.5), 0 0 60px ${theme.jamm.orange}88`
        : '0 8px 24px rgba(0,0,0,0.4)',
    }}
  >
    <Img
      src={staticFile('jamm-immo-logo.png')}
      alt="Jamm Immo"
      style={{ width: widths[size], height: 'auto', display: 'block', borderRadius: 8 }}
    />
  </div>
);
