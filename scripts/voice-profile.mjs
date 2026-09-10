import { createHash } from 'node:crypto';

export const VOICE_NAME = 'Charon';
export const PRIMARY_MODEL = 'gemini-3.1-flash-tts-preview';
export const STYLE_DIRECTION = 'Read only the exact passage requested, in ONE continuous take with a single narrator. Use one consistent male voice: an engaged, warm Senegalese real-estate advisor speaking natural West African French. Authentic conversational phrasing and lively human energy, never a caricature or performed accent. No laughter, chuckles, shouting, singing or theatrical urgency. Clear articulation at a natural brisk pace in the advice, then slightly calmer and deliberate for the website and each telephone number group. Read the local number exactly; never add a country code. Short natural breaths between thoughts, without long pauses. Maintain the same voice and energy through the spoken outro. Pronounce Jamm Immo clearly as two words: Jamm, Immo. The closing brand slogan "Kër gu baax, xel mu dal" is in Wolof (the Senegalese language): pronounce it naturally and correctly in Wolof, never as French. Respect the final Wolof wording exactly. Do not read instructions or context aloud.';

export const ACCENT_DIRECTION = 'Use a clearly audible, more pronounced Senegalese / West African French accent, with natural regional intonation and vowel articulation. Keep it authentic, intelligible and professional, never exaggerated. Do not flatten the accent into metropolitan French. Use a measured conversational pace rather than rushing short sentences; let each thought breathe. Preserve the same narrator and accent in every scene and the outro.';

export function voiceCacheHash(script, context = '') {
  return createHash('sha256').update(JSON.stringify({
    version: 6, model: PRIMARY_MODEL, voice: VOICE_NAME,
    direction: STYLE_DIRECTION, accent: ACCENT_DIRECTION, script, context,
  })).digest('hex');
}

export function voicePrompt(script, context = '') {
  return `${STYLE_DIRECTION}\n${ACCENT_DIRECTION}\n${context ? `Full narration and pacing guidance for continuity only (do not read):\n${context}\n` : ''}Exact passage to read, without additions:\n${script}`;
}
