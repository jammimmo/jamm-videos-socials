# Dakar Real Estate Video — Project Context

This is a **Remotion** project (React-based programmatic video). It produces a 35-second vertical TikTok-style video comparing what 300,000 CFA rents in 5 Dakar neighborhoods, for **JAMM Immobilier**.

This project was started in a chat with Claude on Anthropic's web interface. The user requested continuation here in Claude Code to be able to preview locally.

## What this produces

- 1080×1920 vertical MP4
- 30fps, ~35 seconds, ~14 MB
- Bilingual Wolof + French
- TikTok luxury-real-estate style with energetic transitions

## Stack

- Remotion 4.0.464 (don't downgrade)
- React 18
- TypeScript
- Pure SVG/CSS for visuals (no real footage)

## Structure

```
src/
├── index.ts                  # entry: registerRoot
├── Root.tsx                  # registers <Composition id="DakarRealEstate" />
├── Main.tsx                  # sequences: intro → 5 sections w/ transitions → outro
├── styles/theme.ts           # JAMM brand colors + typography tokens
├── data/neighborhoods.ts     # ALL editable copy (FR + Wolof), rents, pros/cons, map pins
└── components/
    ├── Intro.tsx
    ├── Outro.tsx
    ├── NeighborhoodSection.tsx
    ├── ApartmentScene.tsx    # SVG building + skyline + atmosphere
    ├── MapPin.tsx            # Dakar peninsula outline + animated drop pin
    ├── PriceTag.tsx          # animated rent with count-up
    ├── ProsCons.tsx          # bilingual stacked layout
    └── Transition.tsx        # diagonal wipe
public/
├── jamm-logo.jpeg            # original logo (1290×1269, mostly whitespace)
└── jamm-logo-trim.png        # cropped banner version (used in video)
```

## Brand identity

- **Brand blue:** `#2B3388` (sampled from the JAMM logo, used as primary background)
- **Brand orange:** `#E49536` (sampled from the JAMM logo circle, used for accents)
- All defined in `src/styles/theme.ts`

## Editing patterns

**To change neighborhood copy / pros / cons:** edit `src/data/neighborhoods.ts`. Each neighborhood has `tagline.fr`, `tagline.wo`, `pros[].fr`, `pros[].wo`, `cons[].fr`, `cons[].wo`, plus `rent`, `size`, `accent`, `pin: {x, y}`.

**To change pacing:** constants at the top of `src/Main.tsx`:
- `INTRO_DURATION = 90` (3s @ 30fps)
- `SECTION_DURATION = 150` (5s per neighborhood)
- `TRANSITION_DURATION = 15` (0.5s)
- `OUTRO_DURATION = 150` (5s)

**To change colors:** `src/styles/theme.ts`.

**To swap the logo:** drop a new file in `public/` and update the two `staticFile('...')` calls in `Intro.tsx` and `Outro.tsx`.

**To add background music:** in `Main.tsx`, import `Audio` and `staticFile` from `remotion`, drop an audio file in `public/`, then add `<Audio src={staticFile('music.mp3')} />` inside the top-level `<AbsoluteFill>`.

## Running

```bash
npm install                                   # first time only
npm run preview                               # opens Remotion Studio on http://localhost:3000
npm run build                                 # renders out/dakar-real-estate.mp4
```

`npm run preview` is the local interactive previewer with hot reload, timeline scrubbing, and a render button.

## Design rules / things to preserve

1. **Mobile-friendly text sizes.** Pros/cons cards use 40px French + 28px Wolof. Don't shrink these. The user explicitly asked for them to be big enough to read on mobile.
2. **Stacked pros/cons layout** (not 2 columns) — required for legibility at this size.
3. **Bilingual everywhere.** Wolof must appear alongside French. Don't drop one. Wolof goes in italic, slightly smaller, in muted color.
4. **Brand colors only for backgrounds.** Per-neighborhood `accent` colors differentiate the 5 sections but the base background is always brand blue family.
5. **Dark gradient overlay** at the bottom of every NeighborhoodSection is what makes the pros/cons readable on top of the building scene — don't remove it.
6. **Logo positioning:** small in intro (bottom center), large with orange border + glow in outro. Watermark in neighborhood scenes was tried and removed because it clashed with the title — keep it out unless redesigning the title block.

## Known constraints

- No audio track in the current build.
- All visuals are synthetic SVG — no drone footage. Real footage would be composited as a video layer underneath the overlays in each NeighborhoodSection.
- Map pin positions in `neighborhoods.ts` are tuned to a stylized Dakar peninsula SVG path inside `MapPin.tsx`. If you replace the peninsula path, recalibrate all five `pin` coords.

## What the user might ask for next

- Add background music (afrobeat / amapiano loop)
- Add a voiceover track
- Swap synthetic buildings for real footage
- Change neighborhood selection
- Translate captions to English as well
- Render a 1:1 square variant for Instagram feed
- Faster pacing (3-4s per neighborhood instead of 5)
