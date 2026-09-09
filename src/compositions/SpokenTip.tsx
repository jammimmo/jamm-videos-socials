import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame, interpolate } from 'remotion';
import type { VideoSpec } from '../data/videos';
import { SocialIcons } from '../components/short/SocialBranding';
import { theme } from '../styles/theme';

const {blue, blueDeep, blueDark, orange} = theme.jamm;
const ease = (frame:number, start:number, end:number, from:number, to:number) => interpolate(frame,[start,end],[from,to],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
export function spokenDuration(frames?: number[]) {
  if (!frames || frames.length !== 4 || frames.some(n => !Number.isInteger(n) || n < 30)) throw new Error('Spoken tip requires four verified speech segments');
  const total = frames.reduce((a,b) => a+b,0);
  if (total > 1800) throw new Error('Spoken tip exceeds 60 seconds');
  return total;
}

const Meter: React.FC<{x:number; electric:boolean}> = ({x,electric}) => <g transform={`translate(${x},75)`}>
  <rect width="290" height="395" rx="30" fill={blueDark} stroke="#8992D0" strokeWidth="3"/>
  <circle cx="145" cy="77" r="32" fill={electric?orange:'#759CF5'}/>
  <text x="145" y="90" textAnchor="middle" fontSize="37" fill="white">{electric?'ϟ':'≈'}</text>
  <rect x="25" y="150" width="240" height="95" rx="12" fill="#101637" stroke="#6976C4" strokeWidth="2"/>
  <text x="145" y="213" textAnchor="middle" fontFamily="monospace" fontSize="45" fill="white">0 0 0 0</text>
  <text x="145" y="305" textAnchor="middle" fontSize="24" fontWeight="700" fill="white">{electric?'ÉLECTRICITÉ':'EAU'}</text>
  <text x="145" y="349" textAnchor="middle" fontSize="20" fill="#AEB9EF">INDEX ILLUSTRATIF</text>
</g>;

const EvidenceObject: React.FC<{step:number;meters:boolean}> = ({step,meters}) => {
  const frame=useCurrentFrame();
  const enter=ease(frame,0,24,85,0);
  const camera=ease(frame,24,43,32,0);
  const flash=frame>=45 && frame<51 ? (51-frame)/6*.65 : 0;
  const saved=ease(frame,48,68,0,1);
  return <svg width="100%" height="100%" viewBox="0 0 840 620" role="img" aria-label="Illustration pédagogique animée">
    {meters && step===0 ? <>
      <g transform={`translate(${-enter},0)`}><Meter x={90} electric={false}/></g>
      <g transform={`translate(${enter},0)`}><Meter x={460} electric/></g>
      <g transform={`translate(420,275) scale(${1+camera/150}) translate(-420,-275)`} opacity={ease(frame,15,28,0,1)} fill="none" stroke={orange} strokeWidth="7" strokeLinecap="round">
        <path d="M95 255v-45h45 M95 290v45h45 M745 255v-45h-45 M745 290v45h-45"/>
      </g>
      <rect x="75" y="55" width="690" height="435" rx="30" fill="white" opacity={flash}/>
      <g opacity={saved} transform={`translate(290,${ease(frame,48,68,555,510)})`}>
        <rect width="260" height="65" rx="18" fill={orange}/>
        <path d="m28 33 10 10 22-24" fill="none" stroke={blueDark} strokeWidth="5" strokeLinecap="round"/>
        <text x="165" y="41" textAnchor="middle" fontSize="21" fontWeight="700" fill={blueDark}>PHOTO GARDÉE</text>
      </g>
    </> : meters && step===1 ? <g transform={`translate(0,${ease(frame,0,18,30,0)})`}>
      <rect x="242" y="10" width="356" height="552" rx="43" fill={blueDark} stroke="#929BD7" strokeWidth="3"/>
      <rect x="264" y="60" width="312" height="425" rx="22" fill={blueDeep}/>
      <rect x="296" y="104" width="248" height="209" rx="18" fill={blue} stroke={orange} strokeWidth="4"/>
      <path d="M326 163h188M326 211h136M326 259h165" stroke="#CCD5FF" strokeWidth="12" strokeLinecap="round"/>
      <text x="420" y="367" textAnchor="middle" fontSize="27" fontWeight="700" fill="white">INDEX + DATE</text>
      <circle cx="420" cy="437" r="24" fill={orange}/>
      <path d="m408 437 8 8 16-18" fill="none" stroke={blueDark} strokeWidth="4"/>
    </g> : <g transform={`translate(0,${ease(frame,0,18,30,0)})`}>
      <rect x="190" y="95" width="390" height="415" rx="22" fill={blue} stroke="#858FD0" strokeWidth="3" transform="rotate(-9 400 300)"/>
      <rect x="250" y="50" width="390" height="435" rx="22" fill={blueDark} stroke="#929BD7" strokeWidth="3"/>
      {[160,235,310].map((y,i)=><g key={y} opacity={ease(frame,i*7,i*7+10,.3,1)}><circle cx="310" cy={y} r="16" fill={orange}/><path d={`M355 ${y}h215`} stroke="#A9B5ED" strokeWidth="12" strokeLinecap="round"/></g>)}
      <text x="445" y="413" textAnchor="middle" fontSize="27" fontWeight="700" fill="white">{meters?'PHOTOS + FACTURES':'VOS DOCUMENTS'}</text>
    </g>}
  </svg>;
};

const Logo:React.FC<{width:number}> = ({width}) => <Img src={staticFile('jamm-immo-logo.png')} style={{width,height:width*.55,objectFit:'contain'}}/>;

const EndCard:React.FC = () => {
  const frame=useCurrentFrame();
  // Visual entrance only: no guessed word timings or timed highlights.
  // All contact information remains present throughout the spoken outro.
  return <div style={{position:'absolute',left:72,top:140,width:840,textAlign:'center',transform:`translateY(${ease(frame,0,15,12,0)}px)`}}>
    <Logo width={440}/>
    <div style={{marginTop:70,fontSize:29,color:'#D6DCFF'}}>Retrouvez-nous <span style={{fontSize:24,color:'#B1BDF3'}}>/ Find us</span></div>
    <div style={{marginTop:18,fontSize:79,fontWeight:800,letterSpacing:-2,color:orange}}>jammimmo.com</div>
    <div style={{width:70,height:5,background:orange,borderRadius:5,margin:'52px auto'}}/>
    <div style={{fontSize:29,color:'#D6DCFF'}}>Appelez-nous <span style={{fontSize:24,color:'#B1BDF3'}}>/ Call us</span></div>
    <div style={{marginTop:18,fontSize:80,fontWeight:800,letterSpacing:1}}>76 944 48 49</div>
    <div style={{marginTop:90,fontSize:53,fontWeight:700,lineHeight:1.25}}>Kër gu baax, xel mu dal</div>
    <div style={{marginTop:20,fontSize:27,color:'#D6DCFF'}}>Un bon chez-soi, l’esprit tranquille.</div>
    <div style={{marginTop:10,fontSize:25,color:'#B1BDF3'}}>A good home, a peaceful mind.</div>
    <div style={{marginTop:90,marginBottom:30,fontSize:27,color:'#D6DCFF'}}>Sur les réseaux <span style={{fontSize:24,color:'#B1BDF3'}}>/ On social media</span></div>
    <SocialIcons/>
  </div>;
};

const Panel:React.FC<{spec:VideoSpec;index:number}> = ({spec,index}) => {
  const scene=spec.scenes[index];
  const meters=spec.scenes[0].visualType==='meter';
  const frame=useCurrentFrame();
  return <AbsoluteFill style={{background:`radial-gradient(ellipse at 30% 15%, ${blue} 0%, ${blueDeep} 60%, ${blueDark} 100%)`,color:'white',fontFamily:theme.fonts.display}}>
    <div style={{position:'absolute',right:-180,top:320,width:440,height:440,border:`2px solid ${orange}`,opacity:.12,borderRadius:'50%'}}/>
    {index===3 ? <EndCard/> : <>
      <div style={{position:'absolute',left:70,top:105}}><Logo width={310}/></div>
      <div style={{position:'absolute',left:76,top:340,width:830,fontSize:index===0?88:76,fontWeight:850,lineHeight:1.03,letterSpacing:-2,transform:`translateY(${ease(frame,0,14,15,0)}px)`}}>
        {meters ? index===0 ? <>Vous récupérez<br/><span style={{color:orange}}>les clés ?</span></> : index===1 ? <>Notez l’index.<br/><span style={{color:orange}}>Gardez la date.</span></> : <>Vos photos.<br/><span style={{color:orange}}>Vos repères.</span></> : spec.title}
      </div>
      <div style={{position:'absolute',left:60,top:585,width:860,height:590,overflow:'hidden'}}><EvidenceObject step={index} meters={meters}/></div>
      <div style={{position:'absolute',left:76,top:1185,fontSize:19,color:'#ACB8ED'}}>Illustration · données fictives</div>
      <div style={{position:'absolute',left:76,top:1260,width:826,borderTop:'2px solid #6773B8',paddingTop:32}}>
        <div style={{fontSize:scene.voiceoverFr.length>155?38:45,fontWeight:700,lineHeight:1.22}}>{scene.voiceoverFr}</div>
        <div style={{marginTop:28,fontSize:32,lineHeight:1.27,color:'#CBD4FF'}}>{scene.voiceoverEn}</div>
      </div>
    </>}
  </AbsoluteFill>;
};

export const SpokenTip:React.FC<{spec:VideoSpec;sceneFrames?:number[];audioMode:string}> = ({spec,sceneFrames,audioMode}) => {
  spokenDuration(sceneFrames);
  if(spec.scenes.length!==4) throw new Error('Invalid spoken-tip content contract');
  let start=0;
  return <AbsoluteFill>{sceneFrames!.map((duration,index)=>{const from=start;start+=duration;return <Sequence key={index} from={from} durationInFrames={duration}><Panel spec={spec} index={index}/></Sequence>;})}
    {audioMode!=='silent' && <Audio src={staticFile(`audio/voiceovers/${spec.id}.wav`)}/>}
  </AbsoluteFill>;
};
