import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CAPTION_GEOMETRY_CONTRACT, FRAME_RATE, VIDEO_WIDTH, VIDEO_HEIGHT, MAX_CAPTION_CUES,
  captionSampleFrames, containsBounds, mergeBounds, tipV11CaptionMask,
} from '../src/compositions/tip-v11-caption-geometry.ts';

function validBounds(value) {
  return Array.isArray(value) && value.length === 4
    && value.every(coordinate => Number.isSafeInteger(coordinate) && Math.abs(coordinate) <= 10_000)
    && value[2] > value[0] && value[3] > value[1];
}

async function readFrame(directory, frame) {
  const path = join(directory, `frame-${frame}.json`);
  const meta = await lstat(path);
  if (!meta.isFile() || meta.size < 1 || meta.size > 512) return null;
  return JSON.parse(await readFile(path, 'utf8'));
}

/** Validate complete cue coverage independently of each browser measurement.
 * All fields are numeric metadata. A missing or malformed artifact stays inconclusive. */
export async function summarizeCaptionGeometry({ captions, durationInFrames, captionGeometryRunId, destination }, directory) {
  const { id, bounds } = tipV11CaptionMask(destination);
  const base = {
    contract: CAPTION_GEOMETRY_CONTRACT, scope: 'caption_card_and_text_bounds', mask: id,
    mask_bounds: bounds, width: VIDEO_WIDTH, height: VIDEO_HEIGHT, fps: FRAME_RATE,
    coverage: 'first_middle_last_frame_per_cue', duration_frames: durationInFrames, status: 'inconclusive', cues: [],
  };
  if (!Number.isSafeInteger(durationInFrames) || durationInFrames < 1 || durationInFrames > 3600
    || !Array.isArray(captions) || captions.length < 1 || captions.length > MAX_CAPTION_CUES) return base;
  let previousEnd = 0;
  let nextFrame = 0;
  const cues = [];
  for (const [index, cue] of captions.entries()) {
    if (!cue || typeof cue.text !== 'string' || !cue.text.trim() || cue.start < previousEnd) return base;
    const frames = captionSampleFrames(cue, durationInFrames);
    if (!frames.length || frames[0] !== nextFrame) return base;
    previousEnd = cue.end;
    nextFrame = frames.at(-1) + 1;
    const observations = await Promise.all(frames.map(frame => readFrame(directory, frame).catch(() => null)));
    if (!observations.every((item, position) => item && item.frame === frames[position] && item.cue === index
      && item.run === captionGeometryRunId && item.mask === id
      && validBounds(item.card) && validBounds(item.text))) return base;
    // Check containment at each observation before aggregation. A union could
    // otherwise hide text overflowing its local caption card in one frame.
    const matched = observations.every(({ card, text }) => containsBounds(bounds, card) && containsBounds(card, text));
    cues.push({ cue: index, status: matched ? 'matched' : 'inconclusive', sample_frames: frames,
      card_bounds: observations.map(item => item.card).reduce(mergeBounds),
      text_bounds: observations.map(item => item.text).reduce(mergeBounds) });
  }
  if (nextFrame !== durationInFrames) return base;
  return { ...base, status: cues.every(cue => cue.status === 'matched') ? 'matched' : 'inconclusive', cues };
}
