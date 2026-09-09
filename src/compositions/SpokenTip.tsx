import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame, interpolate } from 'remotion';
import type { VideoSpec } from '../data/videos';
import { SocialIcons } from '../components/short/SocialBranding';

const ink = '#132C36';
const orange = '#EF7B3E';
export function spokenDuration(frames?: number[]) {
  if (!frames || frames.length !== 4 || frames.some(n => !Number.isInteger(n) || n < 30)) throw new Error('Spoken tip requires four verified speech segments');
  const total = frames.reduce((a,b) => a+b,0);
  if (total > 1800) throw new Error('Spoken tip exceeds 60 seconds');
  return total;
}

const EvidenceObject: React.FC<{ step: number; meters: boolean }> = ({ step, meters }) => {
  const frame = useCurrentFrame();
  const rise = interpolate(frame, [0, 10], [18, 0], { extrapolateRight: 'clamp' });
  return <div style={{width: '100%', height: '100%', transform: `translateY(${rise}px)`}}>
    <svg width="100%" height="100%" viewBox="0 0 840 620" role="img" aria-label="Illustration pédagogique">
      <ellipse cx="420" cy="550" rx="300" ry="30" fill="#DBDDD3"/>
      {meters && step === 0 ? <>
        {[110,445].map((x,i) => <g key={x} transform={`translate(${x},65)`}>
          <rect width="280" height="425" rx="32" fill="#FFFDF8" stroke={ink} strokeWidth="4"/>
          <circle cx="140" cy="88" r="35" fill={i ? orange : '#73B8BD'}/>
          <text x="140" y="102" textAnchor="middle" fontSize="36" fill="white">{i ? 'ϟ' : '≈'}</text>
          <rect x="25" y="170" width="230" height="100" rx="12" fill={ink}/>
          <text x="140" y="234" textAnchor="middle" fontFamily="monospace" fontSize="46" fill="#F4F0DD">0 0 0 0</text>
          <text x="140" y="320" textAnchor="middle" fontSize="25" fill={ink}>{i ? 'ÉLECTRICITÉ' : 'EAU'}</text>
          <text x="140" y="365" textAnchor="middle" fontSize="19" fill="#62747A">EXEMPLE D’INDEX</text>
        </g>)}
      </> : meters && step === 1 ? <>
        <rect x="250" y="20" width="340" height="540" rx="48" fill={ink}/>
        <rect x="269" y="65" width="302" height="430" rx="22" fill="#E0E8DD"/>
        <rect x="310" y="155" width="220" height="190" rx="15" fill="#FFFDF8" stroke="#73B8BD" strokeWidth="5"/>
        <path d="M335 195h170M335 235h120M335 275h150" stroke={ink} strokeWidth="12"/>
        <circle cx="420" cy="450" r="27" fill="white" stroke={ink} strokeWidth="3"/>
        <text x="420" y="393" textAnchor="middle" fontSize="23" fill={ink}>PHOTO + DATE</text>
      </> : <>
        <rect x="205" y="90" width="380" height="425" rx="20" fill="#CEDACD" transform="rotate(-8 400 300)"/>
        <rect x="235" y="60" width="380" height="425" rx="20" fill="#FFFDF8" stroke={ink} strokeWidth="4"/>
        {[160,230,300].map(y => <g key={y}><circle cx="290" cy={y} r="15" fill={orange}/><path d={`M330 ${y}h220`} stroke="#AEBFBC" strokeWidth="12" strokeLinecap="round"/></g>)}
        <text x="425" y="408" textAnchor="middle" fontSize="28" fill={ink}>{meters ? 'VOS RELEVÉS' : 'VOS DOCUMENTS'}</text>
      </>}
    </svg>
  </div>;
};

const Panel: React.FC<{spec: VideoSpec; index: number}> = ({spec,index}) => {
  const scene = spec.scenes[index];
  const outro = index >= 3;
  const meters = spec.scenes[0].visualType === 'meter';
  const captionFr = outro ? 'Retrouvez-nous sur jammimmo.com et nos réseaux sociaux. Appelez le +221 76 944 48 49. Jamm Immo. Kër gu baax, xel mu dal.' : scene.voiceoverFr;
  return <AbsoluteFill style={{ background: outro ? ink : '#F5F1E7', color: outro ? '#FFFDF7' : ink, fontFamily: 'Arial, sans-serif' }}>
    <div style={{position:'absolute',left:72,top:110,width:840,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
      <Img src={staticFile('jamm-immo-logo.png')} style={{width:172,height:100,objectFit:'contain',background:'white',borderRadius:16,padding:8}}/>
      <div style={{fontSize:23,letterSpacing:3,color:outro ? '#D7E4DF' : '#5B7375'}}>LE CONSEIL JAMM IMMO</div>
    </div>
    {outro ? <>
      <div style={{position:'absolute',left:72,top:340,width:840,textAlign:'center'}}>
        <div style={{fontSize:30,color:'#B8D0CD',marginBottom:40}}>RETROUVONS-NOUS</div>
        <div style={{fontSize:74,fontWeight:700,letterSpacing:-2,color:index===3?orange:'#FFFDF7'}}>jammimmo.com</div>
        <div style={{fontSize:53,fontWeight:700,marginTop:55}}>+221 76 944 48 49</div>
        <div style={{height:2,background:'#46616A',margin:'64px 80px'}}/>
        <div style={{fontSize:51,fontWeight:700,lineHeight:1.3}}>Kër gu baax, xel mu dal</div>
        <div style={{fontSize:25,color:'#B8D0CD',marginTop:20}}>Un bon chez-soi, l’esprit tranquille.</div>
        <div style={{marginTop:65}}><SocialIcons/></div>
      </div>
    </> : <>
      <div style={{position:'absolute',left:72,top:290,width:840}}>
        <div style={{fontSize:25,fontWeight:700,color:'#737B65',letterSpacing:3}}>{index+1} / 3</div>
        <div style={{fontSize:66,fontWeight:700,lineHeight:1.08,letterSpacing:-2,marginTop:24}}>{index===0 || !meters ? spec.title : index===1 ? 'Notez. Photographiez.' : 'Comparez vos factures.'}</div>
      </div>
      <div style={{position:'absolute',left:72,top:580,width:840,height:580,overflow:'hidden'}}><EvidenceObject step={index} meters={meters}/></div>
      <div style={{position:'absolute',left:72,top:1165,fontSize:20,color:'#697675',letterSpacing:2}}>ILLUSTRATION PÉDAGOGIQUE · DONNÉES FICTIVES</div>
    </>}
    <div style={{position:'absolute',left:72,top:1250,width:840,borderTop:`2px solid ${outro?'#46616A':'#CDD5CA'}`,paddingTop:32}}>
      <div style={{fontSize:23,fontWeight:700,color:outro?orange:'#75614D',marginBottom:15}}>FR</div>
      <div style={{fontSize:captionFr.length>155?34:44,fontWeight:700,lineHeight:1.22}}>{captionFr}</div>
      <div style={{fontSize:21,color:outro?'#ADC7C5':'#677B7B',marginTop:26,marginBottom:10}}>EN</div>
      <div style={{fontSize:outro?28:32,lineHeight:1.25,color:outro?'#D6E2DB':'#466367'}}>{scene.voiceoverEn}</div>
    </div>
  </AbsoluteFill>;
};

export const SpokenTip: React.FC<{spec:VideoSpec;sceneFrames?:number[];audioMode:string}> = ({spec,sceneFrames,audioMode}) => {
  spokenDuration(sceneFrames);
  if (spec.scenes.length!==4) throw new Error('Invalid spoken-tip content contract');
  let start=0;
  return <AbsoluteFill>{sceneFrames!.map((duration,index)=>{const from=start;start+=duration;return <Sequence key={index} from={from} durationInFrames={duration}><Panel spec={spec} index={index}/></Sequence>;})}
    {audioMode!=='silent' && <Audio src={staticFile(`audio/voiceovers/${spec.id}.wav`)}/>}
  </AbsoluteFill>;
};
