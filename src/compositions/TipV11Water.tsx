import React from 'react';
import { OverflowScene } from './TipV11Project';
import { WaterQuestionIllustration, type WaterQuestion } from './TipV11WaterQuestions';

/** Water inspection film. Parent owns identity, narration, captions and outro. */
const C={cream:'#FFF1DC',light:'#FFB46B',orange:'#FD7E00',navy:'#072451',blue:'#073AB5',muted:'#BFD2F0',water:'#95DDFC',edge:'#5277AD'};
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const ease=(v:number)=>{const x=clamp(v);return x*x*(3-2*x);};
const progress=(t:number,start:number,end:number)=>clamp((t-start)/Math.max(.1,end-start));

function Defs(){return <defs>
 <linearGradient id="w-metal" x1="0" x2="1"><stop stopColor="#6E98BB"/><stop offset=".3" stopColor="#E9F5FF"/><stop offset=".5" stopColor="#FFF1DC"/><stop offset=".72" stopColor="#95B8D1"/><stop offset="1" stopColor="#4B789E"/></linearGradient>
 <linearGradient id="w-porcelain" x1="0" y1="0" x2=".8" y2="1"><stop stopColor="#FFF7E7"/><stop offset="1" stopColor="#B8C4CA"/></linearGradient>
 <linearGradient id="w-bowl" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#839CB0"/><stop offset=".65" stopColor="#D5E1E7"/><stop offset="1" stopColor="#F9F0DC"/></linearGradient>
 <linearGradient id="w-cabinet" x1="0" x2="1"><stop stopColor="#164D98"/><stop offset="1" stopColor="#0B3066"/></linearGradient>
 <linearGradient id="w-glass" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#A9DBF4" stopOpacity=".15"/><stop offset=".55" stopColor="#D7E6F6" stopOpacity=".03"/><stop offset="1" stopColor="#A9DBF4" stopOpacity=".2"/></linearGradient>
 </defs>;}
function Title({kicker,lines,local,first=false}:{kicker:string;lines:string[];local:number;first?:boolean}){
 const a=first?1:ease((local+.05)/.24);
 return <div data-fit-region="body-heading" style={{paddingBottom:16,position:'absolute',left:64,top:315,width:896,opacity:a,transform:`translateY(${12*(1-a)}px)`}}>
  <div style={{fontSize:34,fontWeight:600,lineHeight:1.25,letterSpacing:1.4,color:C.muted,marginBottom:20}}>{kicker}</div>
  {lines.map((line,i)=><div key={line} style={{fontSize:77,fontWeight:800,lineHeight:1.08,letterSpacing:-2.6,color:i?C.light:C.cream}}>{line}</div>)}
 </div>;
}
function Note({children,local}:{children:React.ReactNode;local:number}){
 return <div data-fit-region="body-note" style={{position:'absolute',left:64,top:1415,width:896,minHeight:76,borderTop:'2px solid #5277AD',paddingTop:20,fontSize:35,fontWeight:600,lineHeight:1.25,color:C.muted,opacity:ease((local+.2)/.3)}}>{children}</div>;
}
function Drawing({children}:{children:React.ReactNode}){return <svg width="896" height="820" viewBox="0 0 896 820" style={{position:'absolute',left:64,top:580,overflow:'visible'}}><Defs/>{children}</svg>;}
function Label({x,y,children,orange=false}:{x:number;y:number;children:React.ReactNode;orange?:boolean}){return <text x={x} y={y} fill={orange?C.light:C.cream} fontFamily="Poppins" fontWeight="700" fontSize="35">{children}</text>;}
function Drop({x,y,size=1,opacity=1}:{x:number;y:number;size?:number;opacity?:number}){return <path d="M0-17C-5-8-12-1-12 7a12 12 0 0 0 24 0C12-1 5-8 0-17Z" transform={`translate(${x} ${y}) scale(${size})`} fill={C.water} opacity={opacity}/>;}
function Stream({x,y,length,t,amount=1,width=22}:{x:number;y:number;length:number;t:number;amount?:number;width?:number}){
 return <g opacity={amount}><path d={`M${x} ${y}v${length}`} fill="none" stroke={C.water} strokeWidth={width*amount} strokeLinecap="round" opacity=".62"/>
  {[0,1,2].map(i=><path key={i} d={`M${x-width*.25+i*width*.25} ${y+8}v${Math.max(0,length-16)}`} stroke="#DAF5FF" strokeWidth="2.5" strokeDasharray="18 31" strokeDashoffset={-t*110-i*17} fill="none" opacity=".8"/>)}
  {[0,1].map(i=><ellipse key={i} cx={x} cy={y+length} rx={24+((t*1.25+i*.5)%1)*43} ry={6+((t*1.25+i*.5)%1)*9} fill="none" stroke={C.water} strokeWidth="3" opacity={.7*(1-((t*1.25+i*.5)%1))}/>)}
 </g>;
}
function Sink({t,flow=0,lever=1}:{t:number;flow?:number;lever?:number}){return <g>
 <ellipse cx="340" cy="674" rx="285" ry="48" fill="#001B4B" opacity=".45"/>
 <path d="M85 380 580 380 580 627 85 627Z" fill="url(#w-cabinet)"/><path d="M580 380 633 339 633 585 580 627Z" fill="#082653"/><path d="M330 395V608" stroke="#6288B9" strokeWidth="3"/><path d="M292 438v55M366 438v55" stroke="url(#w-metal)" strokeWidth="9" strokeLinecap="round"/><path d="M104 627v32M562 627v32" stroke="#88A2BE" strokeWidth="13"/>
 <path d="M54 322 542 276 651 338 596 399 104 399Z" fill="#A9B9C0"/>
 <path d="M54 305 542 259 651 321 596 382 104 382Z" fill="url(#w-porcelain)" stroke="#FFF1DC" strokeWidth="3"/>
 <ellipse cx="349" cy="324" rx="205" ry="63" fill="url(#w-bowl)"/>
 <ellipse cx="350" cy="352" rx="31" ry="10" fill="#39566D"/><ellipse cx="350" cy="349" rx="22" ry="6" fill="#91ADC3"/>
 <path d="M268 282V144Q268 116 297 116H344Q371 116 371 143V182" fill="none" stroke="#456C91" strokeWidth="42" strokeLinecap="round"/>
 <path d="M264 282V144Q264 116 293 116H340Q367 116 367 143V182" fill="none" stroke="url(#w-metal)" strokeWidth="32" strokeLinecap="round"/>
 <path d="M352 180h30v30h-30Z" fill="url(#w-metal)"/><ellipse cx="367" cy="211" rx="15" ry="4" fill="#234B69"/>
 <ellipse cx="264" cy="284" rx="35" ry="12" fill="url(#w-metal)"/>
 <g transform={`rotate(${-28*lever} 265 136)`}><path d="M260 133 198 116" fill="none" stroke="#436F97" strokeWidth="22" strokeLinecap="round"/><path d="M260 128 198 111" fill="none" stroke="url(#w-metal)" strokeWidth="15" strokeLinecap="round"/></g>
 {flow>0&&<Stream x={367} y={218} length={123} t={t} amount={flow} width={25}/>}
 </g>;}
function Shower({t,flow=1,thin=false}:{t:number;flow?:number;thin?:boolean}){return <g>
 <path d="M150 85 517 35 645 134 645 657 150 657Z" fill="#134A97" opacity=".66"/>
 <path d="M150 227 645 276M150 388 645 437M150 549 645 598M306 64v590M478 40v615" fill="none" stroke="#729CCF" strokeWidth="2" opacity=".18"/>
 <path d="M126 657 580 625 704 701 241 751Z" fill="#AABDC9"/><path d="M126 642 580 610 704 686 241 736Z" fill="url(#w-porcelain)" stroke={C.cream} strokeWidth="4"/><path d="M188 653 561 629 636 678 254 715Z" fill="#C5D5DB"/>
 <ellipse cx="444" cy="681" rx="25" ry="8" fill="#496D88"/>
 <path d="M461 551V172Q461 130 420 130H374" fill="none" stroke="#4B759C" strokeWidth="24" strokeLinecap="round"/><path d="M456 551V170Q456 126 418 126H374" fill="none" stroke="url(#w-metal)" strokeWidth="17" strokeLinecap="round"/>
 <path d="M364 122q-58 3-80 45l114 11q4-40-34-56Z" fill="url(#w-metal)"/><ellipse cx="340" cy="174" rx="58" ry="10" fill="#426889"/>
 <path d="M432 549h49" stroke="url(#w-metal)" strokeWidth="22" strokeLinecap="round"/>
 {(thin?[0]:[-2,-1,0,1,2]).map((i)=><path key={i} d={`M${340+i*16} 186  ${340+i*23} 656`} stroke={C.water} strokeWidth={thin?6:4} strokeDasharray={thin?'15 29':'12 20'} strokeDashoffset={-t*(thin?85:180)-i*10} opacity={flow*(thin?.9:.65)} fill="none"/>)}
 <path d="M178 120 243 155V641L178 605Z" fill="url(#w-glass)" stroke="#719BC0" strokeWidth="3"/>
 <path d="M188 143v404" stroke="#D7E6F6" strokeWidth="3" opacity=".35"/>
 <ellipse cx="340" cy="665" rx={thin?24:70} ry="12" fill={C.water} opacity={.24*flow}/>
 </g>;}

function Hook({t}:{t:number}){const zoom=ease((t-2.75)/.45);return <>
 <Title kicker="LE RÉFLEXE EN VISITE" lines={['Belle douche…','petit filet d’eau ?']} local={t} first/>
 <Drawing>
  <defs><clipPath id="hook-closeup"><rect x="64" y="40" width="768" height="650" rx="28"/></clipPath></defs>
  <g opacity={1-zoom}><g transform="translate(30 8) scale(1.08)"><Shower t={t} thin/></g><g opacity={ease((t-.35)/.35)}><path d="M200 340H86v94" fill="none" stroke={C.orange} strokeWidth="4"/><circle cx="200" cy="340" r="9" fill={C.orange}/><Label x={6} y={478} orange>À TESTER.</Label></g></g>
  <g opacity={zoom}>
   <rect x="64" y="40" width="768" height="650" rx="28" fill={C.navy}/>
   <g clipPath="url(#hook-closeup)"><g transform="translate(-300 -120) scale(2.1)"><Shower t={t} thin/></g></g>
   <rect x="64" y="40" width="768" height="650" rx="28" fill="none" stroke={C.edge} strokeWidth="3"/>
   <path d="M414 390H650v89" fill="none" stroke={C.orange} strokeWidth="4"/><circle cx="414" cy="390" r="8" fill={C.orange}/>
   <Label x={543} y={530} orange>Le débit ?</Label>
  </g>
 </Drawing>
 </>;}

function TapHook({t}:{t:number}) {
 const opening=ease(t/.6), callout=ease((t-.35)/.4);
 return <>
  <Title kicker="LE RÉFLEXE EN VISITE" lines={['Ouvrez le robinet.','Observez le débit.']} local={t} first/>
  <Drawing>
   <g transform="translate(65 6) scale(1.1)">
    <Sink t={t} flow={opening} lever={opening}/>
    <g opacity={callout}>
     <circle cx="367" cy="264" r="46" fill="none" stroke={C.orange} strokeWidth="3" strokeDasharray="6 8"/>
     <path d="M413 264h146v-41" fill="none" stroke={C.orange} strokeWidth="3"/>
     <Label x={526} y={208} orange>Débit</Label>
    </g>
   </g>
  </Drawing>
 </>;
}

function ShowerDrain({t}:{t:number}) {
 const flow=ease(t/.4)*(1-ease((t-1.65)/.3)), drain=ease((t-1.25)/.45);
 return <>
  <Title kicker="DANS LA DOUCHE" lines={['L’eau s’évacue','sans stagner ?']} local={t}/>
  <Drawing>
   <g transform="translate(69 13) scale(.95)">
    <Shower t={t} flow={flow}/>
    <g opacity={drain}>
     <path d="M332 669q39 18 90 13m119-27q-36 22-76 24" fill="none" stroke={C.water}
       strokeWidth="5" strokeDasharray="12 17" strokeDashoffset={-t*85} strokeLinecap="round"/>
     <ellipse cx="444" cy="681" rx="38" ry="17" fill="none" stroke={C.orange} strokeWidth="4"/>
     <path d="M478 681h125v-44" fill="none" stroke={C.orange} strokeWidth="3"/>
     <Label x={555} y={620} orange>Évacuation</Label>
    </g>
   </g>
  </Drawing>
 </>;
}

function Open({t,start,showerAt}:{t:number;start:number;showerAt:number}){
 const tap=ease((t-start)/.7),shower=ease((t-showerAt)/.65);
 return <><Title kicker="01 / DEMANDEZ À TESTER" lines={['Le robinet.','Puis la douche.']} local={t-start}/>
 <Drawing>
  <path d="M448 104v590" stroke={C.edge} strokeWidth="2" opacity=".65"/>
  <g transform="translate(-31 160) scale(.69)"><Sink t={t} flow={tap} lever={tap}/></g>
  <g transform="translate(427 92) scale(.62)"><Shower t={t} flow={shower}/></g>
  <circle cx="39" cy="75" r="25" fill={C.orange}/><text x="39" y="85" textAnchor="middle" fontSize="28" fontFamily="Poppins" fontWeight="800" fill={C.navy}>1</text><Label x={81} y={88}>Robinet</Label>
  <circle cx="505" cy="75" r="25" fill={shower>0?C.orange:C.navy} stroke={C.orange} strokeWidth="2"/><text x="505" y="85" textAnchor="middle" fontSize="28" fontFamily="Poppins" fontWeight="800" fill={shower>0?C.navy:C.light}>2</text><Label x={547} y={88}>Douche</Label>
  <path d="M25 715H394M493 715H864" stroke={C.edge} strokeWidth="5" strokeLinecap="round"/>
  <path d="M25 715H394" pathLength="1" stroke={C.orange} strokeWidth="5" strokeDasharray={`${tap} 1`} strokeLinecap="round"/>
  <path d="M493 715H864" pathLength="1" stroke={C.orange} strokeWidth="5" strokeDasharray={`${shower} 1`} strokeLinecap="round"/>
 </Drawing><Note local={t-start}>Demandez l’accord avant de tester.</Note></>;
}
function Drain({t,start,end,evacuationAt}:{t:number;start:number;end:number;evacuationAt:number}){
 const draw=ease((t-evacuationAt)/Math.min(.6,Math.max(.2,end-evacuationAt))),water=1-.48*draw;
 return <><Title kicker="02 / OBSERVEZ L’EAU" lines={['Le débit.','Et l’évacuation.']} local={t-start}/>
 <Drawing>
  <path d="M48 354 657 284 850 423 766 628 117 628Z" fill="#AABBC6"/>
  <path d="M48 328 657 258 850 397 766 602 117 602Z" fill="url(#w-porcelain)" stroke={C.cream} strokeWidth="4"/>
  <ellipse cx="448" cy="446" rx="295" ry="115" fill="url(#w-bowl)"/>
  <ellipse cx="448" cy="457" rx={238*water} ry={75*water} fill={C.water} opacity=".5"/>
  {[0,1,2].map(i=>{const a=(t*.45+i/3)%1;return <ellipse key={i} cx="448" cy="465" rx={20+150*(1-a)} ry={8+46*(1-a)} fill="none" stroke="#DBF5FF" strokeWidth="3" opacity={a*.7}/>;})}
  <ellipse cx="448" cy="467" rx="44" ry="17" fill="#456883"/><ellipse cx="448" cy="464" rx="32" ry="10" fill="#9FBDCD"/><path d="M425 463h46M433 458v11M447 455v17M461 459v10" stroke="#496A83" strokeWidth="3"/>
  <path d="M360 322V183Q360 144 405 144H459Q496 144 496 183v36" fill="none" stroke="url(#w-metal)" strokeWidth="42" strokeLinecap="round"/>
  <Stream x={496} y={232} length={162} t={t} amount={1} width={27}/>
  <path d="M358 191 286 161" stroke="url(#w-metal)" strokeWidth="19" strokeLinecap="round"/>
  <g opacity={draw}><path d="M317 487q48 66 102 13M402 502l18-3-3 19M578 440q-49-62-94-15M500 423l-17 3 2-18" fill="none" stroke={C.orange} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/></g>
  <path d="M515 295H713v-63M485 499l82 179h173" fill="none" stroke={C.orange} strokeWidth="3"/>
  <circle cx="515" cy="295" r="7" fill={C.orange}/><circle cx="485" cy="499" r="7" fill={C.orange}/>
  <Label x={644} y={207} orange>Débit</Label><Label x={545} y={732} orange>Évacuation</Label>
 </Drawing></>;
}
function Close({t,start,end}:{t:number;start:number;end:number}){
 const q=progress(t,start,end),closed=ease(q/.32),fall=((t-start)*.9)%1;
 return <><Title kicker="03 / REFERMEZ" lines={['Le robinet fermé,','ça goutte encore ?']} local={t-start}/>
 <Drawing><g transform="translate(-20 10) scale(1.08)"><Sink t={t} flow={1-closed} lever={1-closed}/>
  {closed>.95&&<Drop x={367} y={222+fall*114} size={.62+.18*fall} opacity={Math.sin(Math.PI*fall)}/>}
  <path d="M179 69q37-42 91-23m-9-14 12 16-18 8" fill="none" stroke={C.orange} strokeWidth="4" strokeLinecap="round" opacity={1-.65*closed}/>
 </g><g opacity={ease((q-.35)/.18)}><circle cx="377" cy="315" r="72" fill="none" stroke={C.orange} strokeWidth="4" strokeDasharray="8 10"/><path d="M449 315h192" fill="none" stroke={C.orange} strokeWidth="3"/><Label x={573} y={280} orange>Observez.</Label></g></Drawing>
 <Note local={t-start}>Une goutte persistante ? Signalez-la.</Note></>;
}
function Under({t,start,end}:{t:number;start:number;end:number}){
 const q=progress(t,start,end),door=ease(q/.35),focus=ease((q-.3)/.3);
 return <><Title kicker="04 / REGARDEZ DESSOUS" lines={['Sous le lavabo,','des traces ?']} local={t-start}/>
 <Drawing>
  <ellipse cx="400" cy="730" rx="344" ry="44" fill="#001B4B" opacity=".4"/>
  <path d="M107 240H665V676H107Z" fill="#06234F" stroke="#5A81B0" strokeWidth="4"/>
  <path d="M109 675 665 675 711 720 158 720Z" fill="#315380"/>
  <path d="M107 238H665l46-40H154Z" fill="#DCE2DA"/><path d="M107 238h558v35H107Z" fill="url(#w-porcelain)"/>
  <path d="M386 266v180q0 52 57 52h11q48 0 48-45v-74h124" fill="none" stroke="#446E8F" strokeWidth="37" strokeLinecap="round" strokeLinejoin="round"/>
  <path d="M381 266v177q0 50 57 50h11q48 0 48-45v-74h124" fill="none" stroke="url(#w-metal)" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round"/>
  <path d="M362 348h39M475 431h42M559 352v42" stroke="#BBD0DE" strokeWidth="9" strokeLinecap="round"/>
  <path d="M238 274v217M575 274v44" stroke="#6995BC" strokeWidth="13"/><path d="M225 450h27" stroke={C.orange} strokeWidth="7" strokeLinecap="round"/>
  <path d="M300 641q22-29 47-15 20-28 49-10 36-7 53 20 40 4 39 24-41 24-92 10-60 16-96-29Z" fill="#7391A5" opacity={focus*.65}/>
  <path d={`M107 275  ${364-175*door} ${275+32*door}V${669+34*door}L107 675Z`} fill="url(#w-cabinet)" stroke="#7293B9" strokeWidth="3"/>
  <path d={`M665 275 ${405+177*door} ${275+32*door}V${669+34*door}L665 675Z`} fill="url(#w-cabinet)" stroke="#7293B9" strokeWidth="3"/>
  <path d={`M${331-160*door} ${375+24*door}v62M${437+165*door} ${375+24*door}v62`} stroke="url(#w-metal)" strokeWidth="9" strokeLinecap="round"/>
  <g opacity={focus}><circle cx="495" cy="440" r="64" fill="none" stroke={C.orange} strokeWidth="5"/><path d="M547 404 656 220 732 220" fill="none" stroke={C.orange} strokeWidth="3"/><Label x={615} y={190} orange>Raccords</Label><path d="M419 642 543 762H698" fill="none" stroke={C.orange} strokeWidth="3"/><circle cx="419" cy="642" r="7" fill={C.orange}/><Label x={562} y={804} orange>Humidité</Label></g>
  <path d="M254 198v-66q0-32 33-32h66q31 0 31 32v31" fill="none" stroke="url(#w-metal)" strokeWidth="24" strokeLinecap="round"/>
 </Drawing><Note local={t-start}>Des traces visibles : posez la question.</Note></>;
}


function waterQuestion(text: string): WaterQuestion | null {
  if (/compteur|facture.{0,45}partag/u.test(text)) return 'meter';
  if (/coup.{0,18}(?:courant|[ée]lectri)|(?:courant|[ée]lectri).{0,18}coup/u.test(text)) return 'power';
  if (/citerne|r[ée]servoir|r[ée]serve d[’']eau|pompe/u.test(text)) return 'cistern';
  if (/(?:eau.{0,45}(?:journ[ée]e|horaires?|disponib|moment)|coupure.{0,20}eau)/u.test(text)) return 'availability';
  return null;
}

export function WaterIllustration({id, text, progress, caption, captionElapsed}: {
  id: string;
  text: string;
  progress: number;
  caption?: string;
  captionElapsed?: number;
}) {
  const phase = text.toLocaleLowerCase('fr');
  const mentionsShower = /douche/u.test(phase);
  const mentionsBasin = /lavabo|[ée]vier/u.test(phase);
  const mentionsTap = /robinet/u.test(phase);
  const mentionsFlow = /d[ée]bit/u.test(phase);
  if (id === 'hook' && mentionsShower && /filet|d[ée]bit|pression/u.test(phase)) {
    return <Hook t={progress * 4} />;
  }
  if (id === 'hook' && mentionsTap && mentionsFlow) return <TapHook t={progress * 4} />;
  const spokenQuestion = caption && waterQuestion(caption.toLocaleLowerCase('fr'));
  if (spokenQuestion) {
    return <WaterQuestionIllustration kind={spokenQuestion} t={captionElapsed ?? 0} />;
  }
  const mentionsDrainage = /[ée]vacu|stagn|[ée]coule/u.test(phase);
  const mentionsOverflow = /trop[- ]plein/u.test(phase);
  if (mentionsOverflow && mentionsDrainage && mentionsShower && mentionsBasin) {
    return <OverflowScene t={progress * 8} start={0} end={8.1} showerAt={4} />;
  }
  if (mentionsOverflow && mentionsBasin && !mentionsShower) {
    return <OverflowScene t={progress * 4} start={0} end={4.1} basinOnly />;
  }
  if (mentionsDrainage && mentionsShower && !mentionsBasin && !mentionsOverflow && !mentionsTap) {
    return <ShowerDrain t={progress * 4} />;
  }
  if (/sous (?:l[ea] |l['’])(?:lavabo|[ée]vier)|humidi|raccord/u.test(phase)) {
    return <Under t={progress * 4} start={0} end={4} />;
  }
  if (/goutt/u.test(phase) && /ferm/u.test(phase)) return <Close t={progress * 3} start={0} end={3} />;
  if (mentionsFlow && mentionsDrainage) return <Drain t={progress * 3} start={0} end={3} evacuationAt={1.5} />;
  if (/test|essay|v[ée]rifi/u.test(phase) && mentionsTap && mentionsShower) {
    return <Open t={progress * 3} start={0} showerAt={1.5} />;
  }
  const question = waterQuestion(phase);
  if (question) return <WaterQuestionIllustration kind={question} t={progress * 4} />;
  return null;
}
