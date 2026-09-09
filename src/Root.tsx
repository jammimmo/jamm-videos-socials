import React from 'react';
import { Composition } from 'remotion';
import { Main, totalDuration } from './Main';
import { JammShort, TOTAL_DURATION_FRAMES } from './compositions/JammShort';
import { theme } from './styles/theme';
import { VIDEOS } from './data/videos';
import { spokenDuration } from './compositions/SpokenTip';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Original 5-neighborhood comparison video — left untouched. */}
      <Composition
        id="DakarRealEstate"
        component={Main}
        durationInFrames={totalDuration}
        fps={theme.video.fps}
        width={theme.video.width}
        height={theme.video.height}
      />

      {/* JAMM IMMO short-video pipeline: one composition driven by input props.
          Studio previews video-001 by default (audio off). render-batch
          overrides spec + audioMode='full' per video. */}
      <Composition
        id="JammShort"
        component={JammShort}
        calculateMetadata={({props}) => ({durationInFrames: props.spec.template === 'spoken-tip-v2' ? spokenDuration(props.sceneFrames) : TOTAL_DURATION_FRAMES})}
        durationInFrames={TOTAL_DURATION_FRAMES}
        fps={theme.video.fps}
        width={theme.video.width}
        height={theme.video.height}
        defaultProps={{
          spec: VIDEOS[0],
          audioMode: 'silent' as const,
        }}
      />
    </>
  );
};
