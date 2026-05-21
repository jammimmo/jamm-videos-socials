import React from 'react';
import { AbsoluteFill } from 'remotion';
import { theme } from '../../styles/theme';

const BORDER = 28;

export const BrandBorder: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 100 }}>
    {/* 4 sides as separate solid blocks so they win the z-stacking trivially */}
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: BORDER, background: theme.jamm.blue }} />
    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: BORDER, background: theme.jamm.blue }} />
    <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: BORDER, background: theme.jamm.blue }} />
    <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: BORDER, background: theme.jamm.blue }} />
    {/* Thin orange inner accent */}
    <div style={{ position: 'absolute', top: BORDER, left: BORDER, right: BORDER, height: 3, background: theme.jamm.orange }} />
    <div style={{ position: 'absolute', bottom: BORDER, left: BORDER, right: BORDER, height: 3, background: theme.jamm.orange }} />
    <div style={{ position: 'absolute', top: BORDER, bottom: BORDER, left: BORDER, width: 3, background: theme.jamm.orange }} />
    <div style={{ position: 'absolute', top: BORDER, bottom: BORDER, right: BORDER, width: 3, background: theme.jamm.orange }} />
  </AbsoluteFill>
);
