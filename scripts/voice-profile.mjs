import { createHash } from 'node:crypto';

export const VOICE_NAME = 'Charon';
export const PRIMARY_MODEL = 'gemini-3.1-flash-tts-preview';
export const STYLE_DIRECTION = 'Read only the exact passage requested, in ONE continuous take with a single narrator. Use one consistent male voice: an engaged, warm Senegalese real-estate advisor speaking natural West African French. Authentic conversational phrasing and lively human energy, never a caricature or performed accent. No laughter, chuckles, shouting, singing or theatrical urgency. Clear articulation at a natural brisk pace in the advice, then slightly calmer and deliberate for the website and each telephone number group. Read the local number exactly; never add a country code. Short natural breaths between thoughts, without long pauses. Maintain the same voice and energy through the spoken outro. Pronounce Jamm Immo clearly as two words: Jamm, Immo. The closing brand slogan "Kër gu baax, xel mu dal" is in Wolof (the Senegalese language): pronounce it naturally and correctly in Wolof, never as French. Respect the final Wolof wording exactly. Do not read instructions or context aloud.';

export const ACCENT_DIRECTION = 'Use a clearly audible, more pronounced Senegalese / West African French accent, with natural regional intonation and vowel articulation. Keep it authentic, intelligible and professional, never exaggerated. Do not flatten the accent into metropolitan French. Use a measured conversational pace rather than rushing short sentences; let each thought breathe. Preserve the same narrator and accent in every scene and the outro.';
export const TIP_V11_VOICE_NAME = 'Algenib';
// Exact direction from ROOM_TOUR_VOICE_PROFILE_V8 in Estate Flow 9b33807a.
const TIP_V11_DIRECTION = 'Speak French with a distinctly pronounced Senegalese accent from Dakar throughout: full, clear vowels, a flowing syllable-led rhythm and naturally tapped or lightly rolled R sounds, never forced trills. You are a passionate real-estate host warmly welcoming one visitor. Let a broad, genuine smile be audible from Bonjour; sound delighted to share the visit. Use buoyant melodic rises and falls, crisp phrase openings and warm personal emphasis. Sustain lively, confident energy through the descriptions and give the final Jamm Immo and Wolof slogan an especially spirited, inviting lift. Link phrases fluidly, with natural brief breaths. Express enthusiasm through intonation, not shouting or rushing. Read only the supplied words, with no added words or laughter.';
export const TIP_V11_VOICE_SDK_VERSION = '2.8.0';
export const TIP_V11_VOICE_HTTP_OPTIONS = Object.freeze({ timeout: 240_000 });

export function voiceCacheHash(script, context = '', profile = '') {
  if (profile === 'tip-v11-fr') {
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
  if (profile === 'tip-v11-fr') {
    if (context) throw new Error('The Ngor V8 voice profile does not accept additional context');
    return `${TIP_V11_DIRECTION}\n\n${script}`;
  }
  return `${STYLE_DIRECTION}\n${ACCENT_DIRECTION}\n${context ? `Full narration and pacing guidance for continuity only (do not read):\n${context}\n` : ''}Exact passage to read, without additions:\n${script}`;
}
