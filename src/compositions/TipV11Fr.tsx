import React, {useEffect, useState} from 'react';
import {AbsoluteFill, Audio, Img, staticFile, useCurrentFrame, useDelayRender, useVideoConfig} from 'remotion';
import {TipV11Outro} from './TipV11Outro';
import {ServicesScene, ToolsScene} from './TipV11Project';
import {WaterIllustration} from './TipV11Water';

export type TipV11Segment = {id: string; start: number; end: number; text: string};
export type TipV11FrProps = {
  title: string;
  segments: TipV11Segment[];
  captions: Array<{start: number; end: number; text: string}>;
  audio: string;
  durationInFrames: number;
  assistantEnabled: boolean;
  phoneGroups?: Array<{start: number; end: number}>;
  visualTopic?: 'water' | 'general';
};

const cream = '#FFF1DC';
const light = '#FFB46B';
const navy = '#072451';
const orange = '#FD7E00';
const muted = '#BFD2F0';
const edge = '#5277AD';
const weights = [600, 700, 800];
const progress = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (value: number) => {
  const p = progress(value);
  return p * p * (3 - 2 * p);
};
const fontCss = () => weights.map(weight =>
  `@font-face{font-family:Poppins;src:url('${staticFile(`tip-v11/fonts/Poppins-normal-${weight}-latin.woff2`)}') format('woff2');font-weight:${weight};font-style:normal;font-display:block}`,
).join('\n');

const framePath = 'M540 24H1056V1896H24V24H540';

function ProgressFrame({value}: {value: number}) {
  return (
    <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}>
      <path d={framePath} fill="none" stroke="#6789C7" strokeWidth="2" opacity=".36" />
      <path d={framePath} pathLength="1" fill="none" stroke={orange} strokeWidth="6"
        strokeDasharray={`${value} 1`} strokeLinecap="round" />
    </svg>
  );
}

function Header({signature}: {signature: boolean}) {
  return (
    <div style={{position: 'absolute', left: 64, right: 120, top: 130,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
      <Img src={staticFile('tip-v11/logo.png')} style={{width: 225, height: 98, objectFit: 'contain'}} />
      {!signature && <div style={{fontSize: 34, fontWeight: 600, letterSpacing: -.5, textAlign: 'right', lineHeight: 1.3}}>
        Kër gu baax,<br/><span style={{color: light}}>xel mu dal !</span>
      </div>}
    </div>
  );
}

function sectionHeading(text: string) {
  const line = text.replace(/\s+/gu, ' ').trim().split(/(?<=[.!?])\s/u, 1)[0];
  if (line.length <= 88) return line;
  const words = line.slice(0, 87).split(' ');
  words.pop();
  return words.length ? `${words.join(' ')}…` : `${line.slice(0, 87)}…`;
}

/** Generic depth illustration with a house and an animated checklist. */
function Checklist({step, elapsed}: {step: number; elapsed: number}) {
  return (
    <svg width="896" height="665" viewBox="0 0 896 665" aria-hidden="true"
      style={{position: 'absolute', left: 64, top: 807}}>
      <ellipse cx="447" cy="515" rx="361" ry="77" fill="#041C48" opacity=".63" />
      <path d="M63 444 391 255 802 454 494 626Z" fill="#133D82" stroke={edge} strokeWidth="3" />
      <path d="M63 444v32l431 177v-27Z" fill="#08275C" />
      <path d="M494 626v27l308-171v-28Z" fill="#0A306D" />
      <g transform={`translate(80 ${smooth(elapsed / .65) * -16})`}>
        <path d="M73 345 74 230 239 114 427 205 428 373 252 475Z"
          fill="#E6EDF1" stroke="#A9BFE3" strokeWidth="4" />
        <path d="M252 311 427 205 428 373 252 475Z" fill="#7196C8" />
        <path d="M49 244 225 95 444 197 268 345Z" fill="#4077C7" stroke={edge} strokeWidth="3" />
        <path d="M49 244 268 345 267 325 225 115Z" fill="#87ADE0" />
        <path d="M97 295 143 316v66l-46-20Zm81 37 48 22v68l-48-24Z" fill="#073AB5" />
        <path d="M287 338 343 305v115l-56 32Z" fill="#183B76" />
        <path d="m308 391 12-7" stroke={light} strokeWidth="7" strokeLinecap="round" />
        <path d="M365 317l36-22v62l-36 23Z" fill="#F5DFC0" />
      </g>
      <g transform={`translate(465 ${68 + 16 * (1 - smooth(elapsed / .58))})`}>
        <rect x="13" y="15" width="330" height="367" rx="29" fill="#031F55" />
        <rect width="330" height="367" rx="29" fill={navy} stroke={edge} strokeWidth="3" />
        <path d="M87 0V-9h156V0" fill="none" stroke={light} strokeWidth="6" />
        {[1, 2, 3].map((index) => {
          const done = index <= step;
          const draw = done ? smooth((elapsed - index * .15) / .55) : 0;
          return <g key={index} transform={`translate(35 ${63 + (index - 1) * 100})`}>
            <rect width="52" height="52" rx="10" fill={done ? orange : '#164580'} />
            <path d="m10 25 12 12 22-26" stroke={navy} strokeWidth="6" fill="none"
              pathLength="1" strokeDasharray={`${draw} 1`} strokeLinecap="round" strokeLinejoin="round" />
            <path d="M78 15h161M78 40h125" stroke={done ? light : edge} strokeWidth="7"
              strokeLinecap="round" opacity={done ? .8 : .5} />
          </g>;
        })}
      </g>
    </svg>
  );
}

function GeneralScene({title, segment, time}: {title: string; segment: TipV11Segment; time: number}) {
  const elapsed = Math.max(0, time - segment.start);
  const steps: Record<string, number> = {step1: 1, step2: 2, step3: 3};
  const step = steps[segment.id] ?? (segment.id === 'takeaway' ? 3 : 0);
  const kicker = segment.id === 'takeaway' ? 'À RETENIR' : steps[segment.id] ? `ÉTAPE 0${step}` : 'CONSEILS JAMM IMMO';
  const heading = sectionHeading(segment.id === 'greeting' || segment.id === 'hook' ? title : segment.text);
  const fontSize = heading.length <= 36 ? 79 : heading.length <= 60 ? 65 : 55;
  return (
    <>
      <div style={{position: 'absolute', left: 64, top: 316, width: 896}}>
        <div style={{fontSize: 34, fontWeight: 600, letterSpacing: 1.4, color: muted, marginBottom: 24}}>{kicker}</div>
        <div data-fit-region="tip-heading" style={{
          fontSize, fontWeight: 800, lineHeight: 1.12, letterSpacing: -1.5,
          whiteSpace: 'normal', overflowWrap: 'anywhere',
        }}>{heading}</div>
        <div style={{height: 5, width: 135 + 145 * smooth(elapsed / .6), background: orange, marginTop: 35, borderRadius: 4}} />
      </div>
      <Checklist step={step} elapsed={elapsed} />
    </>
  );
}

export const TipV11Fr: React.FC<TipV11FrProps> = ({
  title, segments, captions, audio, assistantEnabled, phoneGroups, visualTopic,
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const {delayRender, continueRender, cancelRender} = useDelayRender();
  const [fontHandle] = useState(() => delayRender('Load the V11 Poppins fonts'));
  useEffect(() => {
    Promise.all(weights.map(weight => document.fonts.load(`${weight} 48px Poppins`))).then(
      fonts => {
        if (fonts.some(result => !result.length)) {
          cancelRender(new Error('The V11 Poppins fonts did not load'));
          return;
        }
        continueRender(fontHandle);
      },
      error => cancelRender(error),
    );
  }, [cancelRender, continueRender, fontHandle]);

  const time = frame / fps;
  const active = segments.reduce<TipV11Segment | undefined>(
    (previous, segment) => segment.start <= time ? segment : previous, segments[0],
  );
  const caption = captions.find(cue => time >= cue.start && time < cue.end);
  const outro = segments.find(segment => segment.id === (assistantEnabled ? 'assistant' : 'domain'))
    ?? segments.find(segment => segment.id === 'domain');
  const signature = segments.find(segment => segment.id === 'signature');
  const showSignature = Boolean(signature && time >= signature.start);
  let scene: React.ReactNode = null;
  if (outro && time >= outro.start) {
    scene = <TipV11Outro time={time} segments={segments} start={outro.start} end={durationInFrames / fps}
      assistantEnabled={assistantEnabled} phoneGroups={phoneGroups} />;
  } else if (active) {
    // Hold the current drawing across pauses between voice sections.
    const visualTime = Math.max(active.start, Math.min(time, active.end - .001));
    if (active.id === 'services') {
      scene = <ServicesScene t={visualTime} start={active.start} end={active.end} />;
    } else if (active.id === 'tools') {
      scene = <ToolsScene t={visualTime} start={active.start} end={active.end} />;
    } else {
      const sceneProgress = progress((visualTime - active.start) / Math.max(.1, active.end - active.start));
      const water = visualTopic === 'water' ? WaterIllustration({
        id: active.id, text: active.text, progress: sceneProgress,
        caption: caption?.text, captionElapsed: caption ? time - caption.start : undefined,
      }) : null;
      scene = water ?? <GeneralScene title={title} segment={active} time={visualTime} />;
    }
  }

  return (
    <AbsoluteFill style={{fontFamily: 'Poppins, sans-serif', color: cream, background: '#062B73', overflow: 'hidden'}}>
      <style>{fontCss() + '*{box-sizing:border-box}'}</style>
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at 65% 35%,#0B46B6 0%,#062B73 58%,#041D4C 100%)'}} />
      <Header signature={showSignature} />
      {scene}
      {caption && (
        <div style={{position: 'absolute', left: 64, right: 120, top: 1570, display: 'flex', justifyContent: 'flex-start'}}>
          <div data-fit-region="caption" style={{
            fontSize: 44, lineHeight: 1.25, fontWeight: 700, whiteSpace: 'pre-line', background: navy,
            padding: '13px 20px', borderRadius: 15, borderLeft: `5px solid ${orange}`, maxWidth: '100%',
            overflowWrap: 'break-word',
          }}>{caption.text.replace(/ ([!?:;])/gu, '\u00a0$1')}</div>
        </div>
      )}
      <ProgressFrame value={progress(frame / Math.max(1, durationInFrames - 1))} />
      {audio && <Audio src={staticFile(audio)} />}
    </AbsoluteFill>
  );
};

export const tipV11StudioProps: TipV11FrProps = {
  title: 'Les bonnes questions avant une visite',
  durationInFrames: 120,
  audio: '',
  captions: [],
  segments: [{id: 'hook', start: 0, end: 4, text: 'Les bonnes questions avant une visite'}],
  assistantEnabled: false,
  visualTopic: 'general',
};
