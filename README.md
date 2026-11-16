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

## Conseils Jamm Immo en français

Les nouveaux conseils arrivent dans le workflow `render-social-tip.yml` sous le contrat `jamm-tip-render-v2`. Le renderer reprend les cinq phrases du sujet, puis ajoute les éléments V11 de marque, les services, les deux outils et les coordonnées officielles. Le visuel varie selon le sujet. Les plans sur l’eau ne s’affichent que lorsqu’ils correspondent au conseil prononcé. Les sorties V1 déjà engagées conservent leur renderer.

Le master V11 est vertical, en 1080 × 1920 à 30 images par seconde. Une seule prise Algenib couvre le conseil et les coordonnées. L’alignement local mesure les débuts de scène, contrôle le site et le numéro complets et cale les sous-titres français. Le cadre final conserve le site, le téléphone et les quatre comptes. Le rendu est livré au Worker pour validation éditoriale. Les logs et artefacts du dépôt public ne diffusent pas les nouveaux brouillons.

La variable GitHub Actions `TIPS_V11_ASSISTANT_PUBLIC=true` ajoute la démo générale de l’Assistant Jamm. L’activer après vérification de sa présence sur la vitrine. Les trois exemples montrent une estimation, la recherche d’une annonce et la prise de contact avec un conseiller.

La CI de PR exécute les tests de contrat et d’alignement sans Gemini. Pour une recette locale avec une piste déjà disponible, la fonction `renderTipV11` accepte `localNarration` et passe la piste par le même alignement et le même export.

### Recette identique sur GitHub et le mini-PC

GitHub et le mini-PC utilisent le même point d’entrée pour tester un commit exact du moteur. Sur Linux x86-64, utiliser un checkout propre, Node 22.20.0 avec npm 10.9.3, Python 3.11.14, FFmpeg, ffprobe et `sudo -n unshare` disponible pour l’utilisateur du runner.

```bash
TIP_PARITY_EXPECTED_SHA='<commit-approuve>' \
  bash scripts/check-tip-runner-parity.sh /chemin/absolu/recette.json
```

Le script installe les dépendances du lockfile, prépare le Chromium de Remotion, puis exécute le rendu synthétique dans un espace réseau limité à la boucle locale et avec un environnement vidé. Le reçu enregistre le commit, le lockfile, les versions et empreintes des outils ainsi que les mesures du MP4 synthétique. Le rendu est supprimé. `--checks-only` exécute les mêmes vérifications de source sans rendu. La livraison des conseils réels conserve l’attestation du workflow GitHub de production.
