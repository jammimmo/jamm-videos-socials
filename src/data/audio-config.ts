// Configuration for the background sourate (Al Takathur, récitée par Al Minshawi).
// The user drops the file at public/audio/sura-minshawi-102.ogg and sets
// SURA_ORIGINAL_DURATION_SEC to its real duration (use `ffprobe -i public/audio/...`
// or any audio player). The composition then computes playbackRate so the audio
// fits exactly inside the 44s window, with the final 1s silenced by `endAt`.

export const SURA_FILE = 'audio/sura-minshawi-102.ogg';

// Duration of public/audio/sura-minshawi-102.ogg in seconds.
// Source: Sheikh Muhammad Siddiq Al-Minshawi, downloaded from mp3quran.net
// then transcoded to Ogg Vorbis via ffmpeg. Probed with ffprobe.
// JammShort sets playbackRate = SURA_ORIGINAL_DURATION_SEC / 44 so the audio
// finishes exactly at the 44s mark, leaving the final 1s silent per spec.
export const SURA_ORIGINAL_DURATION_SEC = 49.89;

export const SURA_TARGET_DURATION_SEC = 44;
export const SURA_VOLUME = 0.04;
export const VOICEOVER_VOLUME = 1.0;
