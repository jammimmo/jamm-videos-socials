export const TIP_V11_BRAND = 'jamm-tips-v11-fr';
export const TIP_V11_SLOGAN = 'Kër gu baax, xel mu dal !';
export const TIP_V11_TEMPLATE = 'tip-v11-fr';
export const TIP_V11_GREETING = 'Salam alikoum ! Nanga def ?';
export const TIP_V11_BODY_IDS = ['hook', 'step1', 'step2', 'step3', 'takeaway'];
const TIP_ID = /^tip-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;

export function makeTipV11Spec({ id, title, body }) {
  if (typeof id !== 'string' || !TIP_ID.test(id)) throw new Error('Invalid V11 tip identifier');
  if (typeof title !== 'string' || title !== title.trim() || !title || title.length > 40
    || /[\x00-\x1f\x7f-\x9f]/u.test(title)) throw new Error('Invalid V11 title');
  if (!Array.isArray(body) || body.length !== TIP_V11_BODY_IDS.length
    || body.some(sentence => typeof sentence !== 'string' || sentence !== sentence.trim() || sentence.length > 200
      || !/^[^.!?\x00-\x1f\x7f-\x9f]+[.!?]$/u.test(sentence)
      || /\S{46}/u.test(sentence))) {
    throw new Error('V11 requires five complete, short French sentences');
  }
  const words = body.map(sentence => sentence.match(/[\p{L}\p{M}]+(?:[’'-][\p{L}\p{M}]+)*/gu) ?? []);
  if (words.some(line => line.length < 5 || line.length > 25) || words.flat().length < 55) {
    throw new Error('V11 advice must contain at least 55 French words across five sentences');
  }
  return { template: TIP_V11_TEMPLATE, id, title, body: [...body] };
}

export function buildTipV11Narration(spec, { assistantEnabled = false } = {}) {
  const checked = makeTipV11Spec(spec);
  const segments = [
    { id: 'greeting', text: TIP_V11_GREETING },
    ...checked.body.map((text, index) => ({ id: TIP_V11_BODY_IDS[index], text })),
    { id: 'services', text: 'Jamm Immo vous accompagne pour acheter, vendre, louer ou confier la gestion locative de votre bien.' },
    { id: 'tools', text: 'Sur le site, retrouvez nos outils pour estimer vos frais d’acquisition et la rentabilité locative. Les simulations restent indicatives.' },
    ...(assistantEnabled ? [{
      id: 'assistant',
      text: 'Une question ? Écrivez à l’Assistant Jamm pour retrouver une annonce, vous renseigner sur un bien ou parler à un conseiller.',
    }] : []),
    { id: 'domain', text: 'Retrouvez-nous sur notre site, jamm immo point com.', caption: 'Retrouvez-nous sur jammimmo.com' },
    { id: 'contact', text: 'Vous pouvez nous appeler ou nous écrire sur WhatsApp au même numéro.' },
    { id: 'phone', text: 'Plus deux cent vingt et un, soixante-seize, neuf cent quarante-quatre, quarante-huit, quarante-neuf.', caption: '+221 76 944 48 49' },
    { id: 'socials', text: 'Suivez aussi Jamm Immo sur nos réseaux sociaux pour retrouver nos prochains conseils.' },
    { id: 'signature', text: `À bientôt ! Jamm Immo ! ${TIP_V11_SLOGAN}` },
  ];
  const text = checked.body.join(' ');
  const waterTopic = /(?:^|[^\p{L}])(?:eau|douche|robinets?|lavabos?|éviers?)(?!\p{L})/iu;
  const isWater = waterTopic.test(checked.title) && waterTopic.test(text);
  return {
    ...checked, segments, assistantEnabled, visualTopic: isWater ? 'water' : 'general',
    script: segments.map(segment => segment.text).join(' '),
  };
}
