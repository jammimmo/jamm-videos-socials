import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, interpolate } from 'remotion';
import { neighborhoods } from './data/neighborhoods';
import { Intro } from './components/Intro';
import { Outro } from './components/Outro';
import { NeighborhoodSection } from './components/NeighborhoodSection';
import { Transition } from './components/Transition';

// Timing (30fps)
const INTRO_DURATION = 90; // 3s
const SECTION_DURATION = 150; // 5s per neighborhood
const TRANSITION_DURATION = 15; // 0.5s
const OUTRO_DURATION = 150; // 5s

export const totalDuration =
  INTRO_DURATION +
  neighborhoods.length * SECTION_DURATION +
  (neighborhoods.length - 1) * TRANSITION_DURATION +
  OUTRO_DURATION;

export const Main: React.FC = () => {
  let cursor = 0;

  // Compute layout
  const segments: Array<{
    type: 'intro' | 'section' | 'transition' | 'outro';
    from: number;
    duration: number;
    data?: any;
  }> = [];

  segments.push({ type: 'intro', from: cursor, duration: INTRO_DURATION });
  cursor += INTRO_DURATION;

  neighborhoods.forEach((n, i) => {
    segments.push({
      type: 'section',
      from: cursor,
      duration: SECTION_DURATION,
      data: { neighborhood: n, index: i },
    });
    cursor += SECTION_DURATION;
    if (i < neighborhoods.length - 1) {
      segments.push({
        type: 'transition',
        from: cursor,
        duration: TRANSITION_DURATION,
        data: { color: neighborhoods[i + 1].accent },
      });
      cursor += TRANSITION_DURATION;
    }
  });

  segments.push({ type: 'outro', from: cursor, duration: OUTRO_DURATION });

  return (
    <AbsoluteFill style={{ backgroundColor: '#0A1929' }}>
      {segments.map((seg, i) => {
        if (seg.type === 'intro') {
          return (
            <Sequence key={i} from={seg.from} durationInFrames={seg.duration}>
              <Intro durationInFrames={seg.duration} />
            </Sequence>
          );
        }
        if (seg.type === 'section') {
          return (
            <Sequence key={i} from={seg.from} durationInFrames={seg.duration}>
              <NeighborhoodSection
                neighborhood={seg.data.neighborhood}
                index={seg.data.index}
                durationInFrames={seg.duration}
              />
            </Sequence>
          );
        }
        if (seg.type === 'transition') {
          return (
            <Sequence key={i} from={seg.from} durationInFrames={seg.duration}>
              <Transition
                color={seg.data.color}
                durationInFrames={seg.duration}
              />
            </Sequence>
          );
        }
        if (seg.type === 'outro') {
          return (
            <Sequence key={i} from={seg.from} durationInFrames={seg.duration}>
              <Outro durationInFrames={seg.duration} />
            </Sequence>
          );
        }
        return null;
      })}
    </AbsoluteFill>
  );
};
