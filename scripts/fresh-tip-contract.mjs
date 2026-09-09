// Verified sources: commercial site src/lib/site-config.ts (phone), and
// estate-flow/render-tool/scripts/render-synced.mjs (historical Wolof slogan).
export const BRAND = Object.freeze({ website: 'jammimmo.com', phone: '76 944 48 49', slogan: 'Kër gu baax, xel mu dal' });
export const OUTRO = [
  { voiceoverFr: 'Retrouvez-nous sur notre site jamm immo point com et sur nos réseaux sociaux.', voiceoverEn: 'Find us on our website jammimmo.com and on social media.' },
  { voiceoverFr: 'Appelez-nous au soixante-seize, neuf cent quarante-quatre, quarante-huit, quarante-neuf.', voiceoverEn: 'Call 76 944 48 49.' },
  { voiceoverFr: 'Jamm Immo. Kër gu baax, xel mu dal.', voiceoverEn: 'Jamm Immo. A good home, a peaceful mind.' },
];

export function freshTipContract(fr, en) {
  // Replace only these explicit editorial boilerplate slots. Any other text
  // remains in the legacy template; substantive advice is never discarded.
  const approvedFr = ['Contactez Jamm Immo pour un accompagnement personnalisé.', 'Contactez Jamm Immo pour préparer votre entrée dans le logement et poser vos questions.'];
  const approvedEn = ['Contact Jamm Immo for personalized guidance.', 'Contact Jamm Immo for personalised guidance.', 'Contact Jamm Immo to prepare for moving into your home and ask your questions.'];
  return fr[3] === 'La vérité avant la visite.' && en[3] === 'The truth before the visit.'
    && approvedFr.includes(fr[4]) && approvedEn.includes(en[4]);
}
