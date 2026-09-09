import React from 'react';
import { theme } from '../../styles/theme';

export const CommercialWebsite: React.FC = () => (
  <div style={{ position: 'absolute', top: 22, left: 60, zIndex: 60,
    color: 'white', background: 'rgba(8,10,30,0.9)', borderRadius: 10,
    padding: '8px 16px', fontFamily: theme.fonts.display, fontSize: 28, fontWeight: 700 }}>
    jammimmo.com
  </div>
);

// Platform identifiers, not connection-status badges or invented account handles.
export const SocialIcons: React.FC = () => (
  <div style={{ display: 'flex', justifyContent: 'center', gap: 28, color: 'white' }}>
    {[
      { name: 'Facebook', shape: <path d="M14 22v-9h3l.5-4H14V7c0-1 .3-2 2-2h2V1.5C17 1.2 16 1 15 1c-3.5 0-5 2-5 5v3H7v4h3v9z" /> },
      { name: 'Instagram', shape: <><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="17.5" cy="6.5" r="1.2"/></> },
      { name: 'YouTube', shape: <><rect x="1" y="4" width="22" height="16" rx="5"/><path d="m10 8 6 4-6 4z" fill={theme.jamm.blueDark}/></> },
      { name: 'LinkedIn', shape: <><rect x="2" y="8" width="4" height="14"/><circle cx="4" cy="3" r="2"/><path d="M9 8h4v2c1-2 3-2.5 5-2 3 1 4 3 4 6v8h-4v-8c0-4-5-4-5 0v8H9z"/></> },
      { name: 'TikTok', shape: <path d="M14 1h4c0 3 2 5 5 5v4c-2 0-4-.6-5-1.5V17a6 6 0 1 1-6-6v4a2 2 0 1 0 2 2z"/> },
    ].map(({ name, shape }) => (
      <div key={name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <svg role="img" aria-label={name} width="46" height="46" viewBox="0 0 24 24" fill="currentColor">{shape}</svg>
        <span style={{ fontFamily: theme.fonts.display, fontSize: 20 }}>{name}</span>
      </div>
    ))}
  </div>
);
