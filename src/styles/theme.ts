// JAMM Immobilier brand theme

export const theme = {
  colors: {
    // Brand
    brandBlue: '#2B3388',
    brandBlueLight: '#3A45A8',
    brandBlueDeep: '#1E2670',
    brandBlueDark: '#141B52',
    brandOrange: '#E49536',
    brandOrangeBright: '#F4A024',
    brandOrangeDeep: '#C77818',

    // Backgrounds
    nightBlue: '#141B52',
    deepTeal: '#1E2670',
    midTeal: '#3A45A8',

    // Accents
    sand: '#F5E4C3',
    sunsetOrange: '#E49536',
    gold: '#F4C430',
    coral: '#FF9F68',

    // Text
    white: '#FFFFFF',
    offWhite: '#F5F0E8',
    muted: '#B4BDDB',

    // Semantic
    pro: '#4ADE80',
    con: '#F87171',

    // Brand convenience
    brandPrimary: '#E49536',
    brandSecondary: '#F4C430',
  },
  fonts: {
    display: '"Inter", "Helvetica Neue", system-ui, sans-serif',
    body: '"Inter", system-ui, sans-serif',
    mono: '"SF Mono", "Roboto Mono", monospace',
  },
  fontSize: {
    hero: 110,
    h1: 80,
    h2: 60,
    h3: 44,
    body: 36,
    small: 28,
    tiny: 22,
  },
  video: {
    width: 1080,
    height: 1920,
    fps: 30,
  },
  // Palette for the JAMM IMMO short-video pipeline (separate from the
  // 5-neighborhood comparison comp which uses the colors block above).
  jamm: {
    blue: '#2d348f',
    blueDeep: '#1f2666',
    blueDark: '#141942',
    orange: '#f49a00',
    orangeDeep: '#c47b00',
    ink: '#0B0B0B',
    cream: '#E8DCCB',
    snow: '#F5F5F5',
    gold: '#C8A45D',
    teal: '#2F6F7E',
  },
} as const;
