# Dakar Real Estate — JAMM Immobilier

A Remotion video composition for the 35-second vertical TikTok comparing what 300,000 CFA rents in 5 Dakar neighborhoods.

## Requirements

- Node.js 18+ (20 or 22 recommended)
- A working Chrome / Chromium install (Remotion will download one on first run)

## Setup

```bash
cd dakar-real-estate
npm install
```

First install takes a minute or two — it pulls Remotion (~175 packages).

## Interactive preview

```bash
npm run preview
```

This opens **Remotion Studio at http://localhost:3000** with:
- Live preview of the composition
- Scrub through frames
- Edit code in your editor and see changes hot-reload
- Render any sub-range to MP4 from the UI

## Render to MP4 from the command line

```bash
npm run build
```

Outputs `out/dakar-real-estate.mp4` (1080×1920, 30fps, ~35s, ~14 MB).

## Project structure

```
src/
├── index.ts              # registerRoot entry point
├── Root.tsx              # registers the Composition (id: DakarRealEstate)
├── Main.tsx              # sequences intro → 5 sections (with transitions) → outro
├── styles/theme.ts       # JAMM brand colors + typography
├── data/neighborhoods.ts # All copy (FR + Wolof), rents, accents, map pins, pros/cons
├── components/
│   ├── Intro.tsx              # 3s opener with 300.000 CFA reveal
│   ├── NeighborhoodSection.tsx # one of 5 neighborhood blocks
│   ├── ApartmentScene.tsx     # SVG building + skyline + sun + atmosphere
│   ├── MapPin.tsx             # Dakar peninsula outline + animated pin
│   ├── PriceTag.tsx           # animated rent card with count-up
│   ├── ProsCons.tsx           # bilingual pros/cons stacked layout
│   ├── Transition.tsx         # diagonal wipe between sections
│   └── Outro.tsx              # "Lequel TOI..." + neighborhood grid + JAMM logo
public/
├── jamm-logo.jpeg        # original JAMM Immobilier logo
└── jamm-logo-trim.png    # trimmed banner version used in video
```

## Common edits

**Change copy / pros / cons** → `src/data/neighborhoods.ts`

**Adjust pacing** → `src/Main.tsx` (top constants): `INTRO_DURATION`, `SECTION_DURATION`, `OUTRO_DURATION`. Units are frames at 30fps.

**Change colors** → `src/styles/theme.ts`

**Swap logo** → drop a new file in `public/` and update the `staticFile('...')` calls in `Intro.tsx` and `Outro.tsx`.

**Add background music** → in `Main.tsx`, import `Audio` and `staticFile`, then:

```tsx
import { Audio, staticFile } from 'remotion';
// inside <AbsoluteFill>
<Audio src={staticFile('music.mp3')} />
```

Put the audio file in `public/`.
