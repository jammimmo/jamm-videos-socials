import React from 'react';
import type {TipV11FrProps, TipV11Segment} from './TipV11Fr';

const cream = '#FFF1DC';
const light = '#FFB46B';
const orange = '#FD7E00';
const navy = '#072451';
const muted = '#BFD2F0';
const edge = '#5277AD';
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => {
  const p = clamp(value);
  return p * p * (3 - 2 * p);
};
const content: React.CSSProperties = {position: 'absolute', left: 64, width: 896};
const phoneLabels = ['+221', '76', '944', '48', '49'];
const networks = [
  ['Instagram', '@jamm.immo'],
  ['Facebook', 'Jamm Immo'],
  ['YouTube', '@Jamm.immo221'],
  ['LinkedIn', 'Jamm Immo'],
] as const;
const prompts = [
  'Comment estimer mon bien ?',
  'Pouvez-vous retrouver une annonce ?',
  'Puis-je parler à un conseiller ?',
];

function SocialSymbol({platform}: {platform: typeof networks[number][0]}) {
  if (platform === 'Instagram') {
    return <svg width="62" height="62" viewBox="0 0 64 64" aria-hidden="true">
      <defs><linearGradient id="tip-v11-instagram" x1="0" y1="1" x2="1" y2="0">
        <stop stopColor="#FFB04C"/><stop offset=".45" stopColor="#EC4F7A"/><stop offset="1" stopColor="#8F62DB"/>
      </linearGradient></defs>
      <rect x="1" y="1" width="62" height="62" rx="17" fill="url(#tip-v11-instagram)"/>
      <rect x="14" y="14" width="36" height="36" rx="11" fill="none" stroke="#fff" strokeWidth="4"/>
      <circle cx="32" cy="32" r="9" fill="none" stroke="#fff" strokeWidth="4"/>
      <circle cx="44" cy="20" r="3" fill="#fff"/>
    </svg>;
  }
  if (platform === 'Facebook') {
    return <svg width="62" height="62" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="15" fill="#1877F2"/>
      <path d="M38 59V35h9l2-11H38v-6q0-5 5-5h7V3q-4-1-9-1c-10 0-16 6-16 16v6h-9v11h9v24Z" fill="#fff"/>
    </svg>;
  }
  if (platform === 'YouTube') {
    return <svg width="62" height="62" viewBox="0 0 64 64" aria-hidden="true">
      <rect x="0" y="9" width="64" height="46" rx="14" fill="#FF0033"/>
      <path d="m27 21 18 11-18 11Z" fill="#fff"/>
    </svg>;
  }
  return <svg width="62" height="62" viewBox="0 0 64 64" aria-hidden="true">
    <rect width="64" height="64" rx="9" fill="#0A66C2"/>
    <circle cx="15" cy="17" r="5" fill="#fff"/>
    <path d="M11 27h8v26h-8Zm15 0h8v4c2-3 5-5 9-5 9 0 11 6 11 14v13h-8V41c0-5-1-8-5-8s-7 3-7 8v12h-8Z" fill="#fff"/>
  </svg>;
}

function AssistantDemo({time, start, end}: {time: number; start: number; end: number}) {
  const show = ease((time - start) / .32);
  const promptIndex = Math.min(prompts.length - 1, Math.floor(clamp((time - start) / Math.max(.1, end - start)) * prompts.length));
  const prompt = prompts[promptIndex];
  const exampleTime = (time - start) - promptIndex * (end - start) / prompts.length;
  const exampleReveal = ease(Math.max(0, exampleTime) / .25);
  return (
    <div style={{...content, top: 310, opacity: show, transform: `translateY(${14 * (1 - show)}px)`}}>
      <div style={{fontSize: 33, fontWeight: 600, color: muted, letterSpacing: 1.2}}>UNE QUESTION ?</div>
      <div style={{fontSize: 72, lineHeight: 1.15, fontWeight: 800, letterSpacing: -2, marginTop: 18}}>
        Assistant <span style={{color: light}}>Jamm</span>
      </div>
      <div style={{display: 'flex', alignItems: 'center', gap: 24, minHeight: 122, marginTop: 34, padding: '18px 28px',
        border: `2px solid ${edge}`, borderRadius: 24, background: navy}}>
        <div data-fit-region="assistant-example" style={{
          flex: '1 1 0', minWidth: 0, fontSize: 40, lineHeight: 1.2, fontWeight: 700,
          opacity: .68 + .32 * exampleReveal,
        }}>{prompt.replace(/ \?/gu, '\u00a0?')}</div>
        <svg width="60" height="60" viewBox="0 0 60 60" aria-hidden="true" style={{flexShrink: 0}}>
          <rect width="60" height="60" rx="17" fill={orange}/>
          <path d="m14 29 32-14-12 32-6-13-14-5Zm14 5L46 15" fill="none" stroke={navy} strokeWidth="4" strokeLinejoin="round"/>
        </svg>
      </div>
      <div style={{display: 'inline-flex', padding: '6px 15px', border: `1px solid ${edge}`, borderRadius: 10,
        fontSize: 31, lineHeight: 1.25, fontWeight: 700, color: light, marginTop: 13}}>Parler à un conseiller</div>
    </div>
  );
}

export function TipV11Outro({time, start, end, segments, assistantEnabled, phoneGroups}: {
  time: number;
  start: number;
  end: number;
  segments: TipV11Segment[];
  assistantEnabled: boolean;
  phoneGroups?: TipV11FrProps['phoneGroups'];
}) {
  const get = (id: string) => segments.find(segment => segment.id === id);
  const domain = get('domain')?.start ?? start;
  const contact = get('contact')?.start ?? domain;
  const phone = get('phone');
  const socials = get('socials')?.start ?? contact;
  const signature = get('signature')?.start ?? end;
  const assistant = assistantEnabled ? get('assistant') : undefined;
  const appear = (at: number) => ease((time - at) / .34);
  const site = appear(domain);
  const number = appear(Math.min(domain, contact));
  const numberProgress = phone ? (time - phone.start) / Math.max(.1, phone.end - phone.start) : -1;
  const studioGroup = numberProgress >= 0 && numberProgress < 1 ? Math.floor(numberProgress * phoneLabels.length) : -1;
  const activeGroup = phoneGroups?.findIndex(group => time >= group.start && time < group.end) ?? studioGroup;

  return (
    <div style={{position: 'absolute', inset: 0, color: cream, pointerEvents: 'none'}}>
      {assistant && time >= assistant.start && time < signature && (
        <AssistantDemo time={time} start={assistant.start} end={signature} />
      )}
      {!assistant && time < signature && (
        <div style={{...content, top: 345, fontSize: 80, fontWeight: 800, lineHeight: 1.15}}>
          Contactez<br/><span style={{color: light}}>Jamm Immo.</span>
        </div>
      )}
      {time >= signature && (
        <div data-fit-region="outro-signature" style={{...content, top: 315, opacity: appear(signature)}}>
          <div style={{fontSize: 45, lineHeight: 1.25, color: muted, fontWeight: 600, marginBottom: 28}}>À bientôt !</div>
          <div style={{fontSize: 86, lineHeight: 1.1, letterSpacing: -2.6, fontWeight: 800}}>
            Kër gu baax,<br/><span style={{color: light}}>xel mu dal !</span>
          </div>
          <div style={{height: 7, width: 310 * appear(signature), background: orange, borderRadius: 4, marginTop: 28}}/>
        </div>
      )}
      <div data-fit-region="outro-site" style={{...content, top: 730, opacity: site}}>
        <div style={{fontSize: 76, fontWeight: 800, lineHeight: 1.12, letterSpacing: -2.1}}>
          jammimmo<span style={{color: light}}>.com</span>
        </div>
        <div style={{height: 4, background: edge, opacity: .65, marginTop: 25}}/>
      </div>
      <div data-fit-region="outro-phone" style={{...content, top: 910, opacity: number}}>
        <div style={{fontSize: 33, fontWeight: 600, lineHeight: 1.25, color: muted}}>Appels téléphoniques</div>
        <div style={{display: 'flex', alignItems: 'baseline', gap: 16, height: 86, fontWeight: 800,
          lineHeight: 1.13, letterSpacing: -1.7, marginTop: 14, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums'}}>
          {phoneLabels.map((group, index) => (
            <span key={group} style={{position: 'relative', fontSize: index === 0 ? 56 : 76, color: activeGroup === index ? light : cream}}>
              {group}{activeGroup === index && <span style={{
                position: 'absolute', left: 0, right: 0, bottom: -2, height: 3, borderRadius: 2, background: orange,
              }}/>}
            </span>
          ))}
        </div>
        <div style={{fontSize: 33, fontWeight: 600, lineHeight: 1.25, marginTop: 8, opacity: appear(contact)}}>
          <span style={{color: light, fontWeight: 700}}>WhatsApp</span><span style={{color: muted}}> · appels / messages</span>
        </div>
      </div>
      <div data-fit-region="outro-socials" style={{...content, top: 1160, opacity: appear(socials)}}>
        <div style={{fontSize: 30, fontWeight: 600, lineHeight: 1.15, color: muted, marginBottom: 14}}>Retrouvez Jamm Immo</div>
        <div style={{display: 'grid', gridTemplateColumns: '1fr', gap: 8}}>
          {networks.map(([platform, account], index) => (
            <div key={platform} style={{height: 76, display: 'flex', alignItems: 'center', gap: 18, padding: '6px 14px',
              background: 'rgba(7,36,81,.76)', borderRadius: 14, border: '1px solid rgba(82,119,173,.5)',
              transform: `translateY(${6 * (1 - appear(socials + index * .045))}px)`}}>
              <div style={{width: 62, height: 62, flexShrink: 0}}><SocialSymbol platform={platform}/></div>
              <div style={{width: 176, flexShrink: 0, fontSize: 28, fontWeight: 600, lineHeight: 1.15, color: muted}}>{platform}</div>
              <div style={{fontSize: 43, fontWeight: 700, lineHeight: 1.15, color: light, letterSpacing: -.7, whiteSpace: 'nowrap'}}>{account}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
