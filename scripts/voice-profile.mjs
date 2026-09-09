import { createHash } from 'node:crypto';

export const VOICE_NAME = 'Charon';
export const PRIMARY_MODEL = 'gemini-3.1-flash-tts-preview';
export const STYLE_DIRECTION = 'Read only the exact French passage requested. Use one consistent male narrator with a natural Dakar/Senegalese influence: a warm, smiling and reassuring real-estate advisor. Lively conversational energy, clear articulation, comfortable brisk pace and brief natural pauses. Maintain the same voice, accent, pitch range and energy across the whole video. No theatrical urgency, shouting or exaggerated enthusiasm. Pronounce Jamm Immo clearly as two words: Jamm, Immo. Do not read instructions or context aloud.';

export function voiceCacheHash(script, context = '') {
  return createHash('sha256').update(JSON.stringify({
    version: 2, model: PRIMARY_MODEL, voice: VOICE_NAME,
    direction: STYLE_DIRECTION, script, context,
  })).digest('hex');
}

export function voicePrompt(script, context = '') {
  return `${STYLE_DIRECTION}\n${context ? `Full narration for continuity only (do not read):\n${context}\n` : ''}Exact passage to read, without additions:\n${script}`;
}
