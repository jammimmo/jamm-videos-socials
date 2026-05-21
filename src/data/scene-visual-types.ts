// Pure-data list of valid scene visual types.
// Kept free of React / Remotion imports so it can be loaded by Node scripts
// (content-build, render-batch) without dragging in browser-only code.

export const SCENE_VISUAL_TYPES = [
  'mobile-money',
  'fake-broker',
  'listing-scam',
  'listing-address',
  'water-tap',
  'shower',
  'meter',
  'leak-alert',
  'schedule-clock',
  'building',
  'night-day-split',
  'corridor-light',
  'noise-listen',
  'traffic',
  'transit-icons',
  'budget-calc',
  'id-check',
  'document-stack',
  'verbal-handshake',
  'contract',
  'fine-print',
  'calendar-notice',
  'expenses-breakdown',
  'receipt',
] as const;

export type SceneVisualType = (typeof SCENE_VISUAL_TYPES)[number];

export const isSceneVisualType = (s: string): s is SceneVisualType =>
  (SCENE_VISUAL_TYPES as readonly string[]).includes(s);
