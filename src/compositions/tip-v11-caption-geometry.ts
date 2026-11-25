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

export type TipV11Destination = 'tiktok' | 'instagram' | 'facebook' | 'youtube';
export const YOUTUBE_SHORTS_PROFILE = 'youtube-shorts-v1';
export const YOUTUBE_SHORTS_CAPTION_MASK = 'tip-v11-youtube-shorts-caption-20261125-v1';
export const YOUTUBE_SHORTS_SAFE_BOUNDS: Bounds = [76, 298, 838, 1372];
export const TIKTOK_CAPTION_MASK = 'tip-v11-tiktok-caption-20261125-v2';
type TipV11Layout = {
  left: number;
  top: number;
  scale: number;
  captionTop: number;
  safeBounds?: Bounds;
};

const sharedLayout: TipV11Layout = {left: 84, top: 135, scale: .8, captionTop: 1570};

// The raster stays 1080×1920. These are composition margins, not provider
// upload limits. TikTok includes extra clearance from the observed iPhone
// right rail and description. The two Reels layouts require in-app QA.
const destinationLayouts: Record<TipV11Destination, TipV11Layout> = {
  tiktok: {left: 92, top: 184, scale: .685, captionTop: 1501, safeBounds: [129, 270, 812, 1340]},
  instagram: {left: 84, top: 140, scale: .84, captionTop: 1490, safeBounds: [130, 265, 910, 1520]},
  facebook: {left: 93, top: 150, scale: .81, captionTop: 1530, safeBounds: [135, 270, 885, 1520]},
  // Organic Shorts guide, with extra space inside the top, right and bottom margins.
  youtube: {left: 78, top: 184, scale: .73, captionTop: 1510, safeBounds: YOUTUBE_SHORTS_SAFE_BOUNDS},
};

export function tipV11Layout(destination?: TipV11Destination): TipV11Layout {
  if (destination === undefined) return sharedLayout;
  if (destination === 'tiktok' || destination === 'instagram' || destination === 'facebook' || destination === 'youtube') {
    return destinationLayouts[destination];
  }
  throw new Error('Unknown V11 video destination');
}

export function tipV11CaptionMask(destination?: TipV11Destination): {id: string; bounds: Bounds} {
  if (destination === undefined) return {id: CAPTION_GEOMETRY_MASK, bounds: MASK_BOUNDS};
  const layout = tipV11Layout(destination);
  if (!layout.safeBounds) throw new Error('Missing V11 destination safe area');
  const top = Math.floor(layout.top + layout.captionTop * layout.scale);
  const [left, , right, bottom] = layout.safeBounds;
  const masks = { tiktok: TIKTOK_CAPTION_MASK, youtube: YOUTUBE_SHORTS_CAPTION_MASK };
  const id = destination === 'tiktok' || destination === 'youtube'
    ? masks[destination] : `tip-v11-${destination}-caption-20261120-v1`;
  return {id, bounds: [left, top, right, bottom]};
}

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
