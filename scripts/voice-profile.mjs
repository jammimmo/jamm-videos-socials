import { createHash } from 'node:crypto';

export const VOICE_NAME = 'Charon';
export const PRIMARY_MODEL = 'gemini-3.1-flash-tts-preview';
export const STYLE_DIRECTION = 'Read only the exact French passage requested, in ONE continuous take with a single narrator. Use one consistent male voice with a natural Dakar/Senegalese influence: a warm, smiling and reassuring real-estate advisor. Lively conversational energy, clear articulation and a comfortable brisk pace. Pause for approximately half a second between complete sentences; keep pauses within a sentence brief. Maintain the same voice, accent, pitch range and energy across the whole video. No theatrical urgency, shouting or exaggerated enthusiasm. Pronounce Jamm Immo clearly as two words: Jamm, Immo. Do not read instructions or context aloud.';

export function voiceCacheHash(script, context = '') {
  return createHash('sha256').update(JSON.stringify({
    version: 3, model: PRIMARY_MODEL, voice: VOICE_NAME,
    direction: STYLE_DIRECTION, script, context,
  })).digest('hex');
}

export function voicePrompt(script, context = '') {
  return `${STYLE_DIRECTION}\n${context ? `Full narration for continuity only (do not read):\n${context}\n` : ''}Exact passage to read, without additions:\n${script}`;
}
