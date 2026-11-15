export type CaptionCue = {start: number; end: number; text: string};
export type Bounds = [left: number, top: number, right: number, bottom: number];

export const CAPTION_GEOMETRY_CONTRACT = 'tip-v11-caption-geometry-v1';
// Conservative inset from the one observed short-feed overlay at y=1515.
// This template mask does not describe every provider or UI state.
export const CAPTION_GEOMETRY_MASK = 'tip-v11-observed-short-feed-20261114-v1';
export const MASK_BOUNDS: Bounds = [120, 1360, 872, 1511];
export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const FRAME_RATE = 30;
export const MAX_CAPTION_CUES = 100;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function geometryArtifactDirectory(runId: string): string {
  if (!RUN_ID.test(runId)) throw new Error('invalid caption geometry run');
  return `caption-geometry-${runId}`;
}

export function captionSampleFrames(cue: CaptionCue, durationInFrames: number): number[] {
  if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.start >= cue.end
    || cue.end > durationInFrames / FRAME_RATE + .001) return [];
  // Use the same time comparison as the active caption lookup in the browser.
  let first = Math.floor(cue.start * FRAME_RATE);
  if (first / FRAME_RATE < cue.start) first++;
  let last = Math.min(durationInFrames - 1, Math.ceil(cue.end * FRAME_RATE));
  while (last / FRAME_RATE >= cue.end) last--;
  if (first > last) return [];
  return [...new Set([first, Math.floor((first + last) / 2), last])];
}

export function pixelBounds(rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>,
  viewport: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): Bounds | null {
  if (![viewport.left, viewport.top, viewport.width, viewport.height,
    rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)
    || viewport.width <= 0 || viewport.height <= 0 || rect.right <= rect.left || rect.bottom <= rect.top) return null;
  return [
    Math.floor((rect.left - viewport.left) * VIDEO_WIDTH / viewport.width),
    Math.floor((rect.top - viewport.top) * VIDEO_HEIGHT / viewport.height),
    Math.ceil((rect.right - viewport.left) * VIDEO_WIDTH / viewport.width),
    Math.ceil((rect.bottom - viewport.top) * VIDEO_HEIGHT / viewport.height),
  ];
}

export function mergeBounds(left: Bounds, right: Bounds): Bounds {
  return [Math.min(left[0], right[0]), Math.min(left[1], right[1]), Math.max(left[2], right[2]), Math.max(left[3], right[3])];
}

export function containsBounds(outer: Bounds, inner: Bounds): boolean {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}
