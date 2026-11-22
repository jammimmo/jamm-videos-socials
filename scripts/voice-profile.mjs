import { createHash } from 'node:crypto';
import { TIP_V11_GREETING, TIP_V11_TEMPLATE } from './tip-v11-contract.mjs';

export const VOICE_NAME = 'Charon';
export const PRIMARY_MODEL = 'gemini-3.1-flash-tts-preview';
export const STYLE_DIRECTION = 'Read only the exact passage requested, in ONE continuous take with a single narrator. Use one consistent male voice: an engaged, warm Senegalese real-estate advisor speaking natural West African French. Authentic conversational phrasing and lively human energy, never a caricature or performed accent. No laughter, chuckles, shouting, singing or theatrical urgency. Clear articulation at a natural brisk pace in the advice, then slightly calmer and deliberate for the website and each telephone number group. Read the local number exactly; never add a country code. Short natural breaths between thoughts, without long pauses. Maintain the same voice and energy through the spoken outro. Pronounce Jamm Immo clearly as two words: Jamm, Immo. The closing brand slogan "Kër gu baax, xel mu dal" is in Wolof (the Senegalese language): pronounce it naturally and correctly in Wolof, never as French. Respect the final Wolof wording exactly. Do not read instructions or context aloud.';

export const ACCENT_DIRECTION = 'Use a clearly audible, more pronounced Senegalese / West African French accent, with natural regional intonation and vowel articulation. Keep it authentic, intelligible and professional, never exaggerated. Do not flatten the accent into metropolitan French. Use a measured conversational pace rather than rushing short sentences; let each thought breathe. Preserve the same narrator and accent in every scene and the outro.';
export const TIP_V11_VOICE_NAME = 'Algenib';
// Keep the exact Ngor V8 direction for passages without the fixed advice greeting.
const NGOR_V8_ACCENT_CUE = 'Speak French with a distinctly pronounced Senegalese accent from Dakar throughout';
const NGOR_V8_OPENING_CUE = 'Let a broad, genuine smile be audible from Bonjour; sound delighted to share the visit.';
const NGOR_V8_DIRECTION = `${NGOR_V8_ACCENT_CUE}: full, clear vowels, a flowing syllable-led rhythm and naturally tapped or lightly rolled R sounds, never forced trills. You are a passionate real-estate host warmly welcoming one visitor. ${NGOR_V8_OPENING_CUE} Use buoyant melodic rises and falls, crisp phrase openings and warm personal emphasis. Sustain lively, confident energy through the descriptions and give the final Jamm Immo and Wolof slogan an especially spirited, inviting lift. Link phrases fluidly, with natural brief breaths. Express enthusiasm through intonation, not shouting or rushing. Read only the supplied words, with no added words or laughter.`;
const TIP_V11_ADVICE_DIRECTION = NGOR_V8_DIRECTION
  .replace(NGOR_V8_ACCENT_CUE, 'Speak the French passage with a distinctly pronounced Senegalese accent from Dakar')
  .replace(NGOR_V8_OPENING_CUE, 'Let a broad, genuine smile be audible from the opening greeting. Speak the Arabic and Wolof greetings in that order, exactly as written, with a brief natural pause between them. Finish both before the French advice starts and keep the same voice.');
export const TIP_V11_VOICE_SDK_VERSION = '2.8.0';
export const TIP_V11_VOICE_HTTP_OPTIONS = Object.freeze({ timeout: 240_000 });

export function voiceCacheHash(script, context = '', profile = '') {
  if (profile === TIP_V11_TEMPLATE) {
    return createHash('sha256').update(JSON.stringify({
      version: 2, model: PRIMARY_MODEL, voice: TIP_V11_VOICE_NAME, sdk: TIP_V11_VOICE_SDK_VERSION,
      prompt: voicePrompt(script, context, profile),
    })).digest('hex');
  }
  return createHash('sha256').update(JSON.stringify({
    version: 6, model: PRIMARY_MODEL, voice: VOICE_NAME,
    direction: STYLE_DIRECTION, accent: ACCENT_DIRECTION, script, context,
  })).digest('hex');
}

export function voicePrompt(script, context = '', profile = '') {
  if (profile === TIP_V11_TEMPLATE) {
    if (context) throw new Error('The Ngor V8 voice profile does not accept additional context');
    const adviceOpening = typeof script === 'string' && script.startsWith(`${TIP_V11_GREETING} `);
    return `${adviceOpening ? TIP_V11_ADVICE_DIRECTION : NGOR_V8_DIRECTION}\n\n${script}`;
  }
  return `${STYLE_DIRECTION}\n${ACCENT_DIRECTION}\n${context ? `Full narration and pacing guidance for continuity only (do not read):\n${context}\n` : ''}Exact passage to read, without additions:\n${script}`;
}
