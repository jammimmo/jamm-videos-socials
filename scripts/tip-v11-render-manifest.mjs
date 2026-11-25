import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tipV11SpokenScript } from './generate-gemini-voiceover.mjs';
import { PRIMARY_MODEL, TIP_V11_VOICE_NAME, voicePrompt } from './voice-profile.mjs';
import { TIP_V11_TEMPLATE } from './tip-v11-contract.mjs';
import { REVIEWED_NARRATION_MODEL } from './tip-v11-reviewed-narration.mjs';
import { tipV11CaptionMask, YOUTUBE_SHORTS_PROFILE } from '../src/compositions/tip-v11-caption-geometry.ts';

export const TIP_V11_MANIFEST_CONTRACT = 'tip-v11-fr-render-inputs-v1';
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const shortsCaptionMask = tipV11CaptionMask('youtube');

function matchesShortsCaptionGeometry(geometry) {
  return geometry?.status === 'matched' && geometry.mask === shortsCaptionMask.id
    && Array.isArray(geometry.mask_bounds) && geometry.mask_bounds.length === shortsCaptionMask.bounds.length
    && shortsCaptionMask.bounds.every((bound, index) => geometry.mask_bounds[index] === bound);
}

// Current V11's React drawings use bundled source. Its only staticFile calls
// load the logo, these fonts and the per-job mix. The lockfile pins Remotion
// and the other package dependencies of that bundle.
const V11_STATIC_FILES = [
  'package-lock.json', 'remotion.config.ts', 'remotion.tip-v11.config.ts',
  'public/tip-v11/logo.png', 'public/tip-v11/fonts/Poppins-OFL.txt',
  ...[600, 700, 800].map(weight => `public/tip-v11/fonts/Poppins-normal-${weight}-latin.woff2`),
  'scripts/align_tip_v11.py', 'scripts/generate-gemini-voiceover.mjs', 'scripts/materialize-dispatched-tip.mjs',
  'scripts/render-batch.mjs', 'scripts/render-tip-v11.mjs', 'scripts/tip-v11-contract.mjs',
  'scripts/tip-v11-caption-geometry.mjs', 'scripts/tip-v11-effects.mjs', 'scripts/tip-v11-render-manifest.mjs',
  'scripts/tip-v11-reviewed-narration.mjs', 'scripts/tip-v11-workflow-oidc.mjs', 'scripts/voice-profile.mjs',
  'src/index.ts', 'src/Root.tsx',
  'src/compositions/TipV11Fr.tsx', 'src/compositions/TipV11Outro.tsx', 'src/compositions/TipV11Project.tsx',
  'src/compositions/TipV11Water.tsx', 'src/compositions/TipV11WaterQuestions.tsx',
  'src/compositions/tip-v11-caption-geometry.ts',
].sort();

export const digestTipValue = value => createHash('sha256').update(value).digest('hex');

async function digestFile(path, maximumBytes) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > maximumBytes) throw new Error('V11 manifest input is invalid');
  const hash = createHash('sha256');
  let count = 0;
  for await (const chunk of createReadStream(path)) {
    count += chunk.length;
    if (count > maximumBytes) throw new Error('V11 manifest input exceeds its size limit');
    hash.update(chunk);
  }
  if (count !== metadata.size) throw new Error('V11 manifest input changed while hashing');
  return hash.digest('hex');
}

export async function collectTipV11StaticFiles(root) {
  const files = await Promise.all(V11_STATIC_FILES.map(async path => [path, await digestFile(resolve(root, path), 2 * 1024 * 1024)]));
  return { files, sha256: digestTipValue(JSON.stringify(files)) };
}

export async function buildTipV11RenderManifest({
  plan, sourceScriptSha256, voiceSource, inventory, raw, normalized, mix, alignment, props, mp4, captionGeometry, reviewedNarrationSha256,
  masterVisualProfile,
}) {
  const reviewed = voiceSource === 'reviewed-bundle';
  if (!['provider', 'cache', 'fixture', 'reviewed-bundle'].includes(voiceSource)
    || typeof plan.assistantEnabled !== 'boolean' || !['general', 'water'].includes(plan.visualTopic)
    || plan.segments.some(segment => segment.id === 'assistant') !== plan.assistantEnabled
    || ((voiceSource === 'provider' || reviewed) && !SHA256.test(sourceScriptSha256 ?? ''))
    || (reviewed ? plan.assistantEnabled || !SHA256.test(reviewedNarrationSha256 ?? '') : reviewedNarrationSha256 !== undefined)) {
    throw new Error('V11 manifest render inputs are incomplete');
  }
  if (masterVisualProfile !== undefined && (masterVisualProfile !== YOUTUBE_SHORTS_PROFILE
    || (!reviewed && voiceSource !== 'fixture') || !matchesShortsCaptionGeometry(captionGeometry))) {
    throw new Error('V11 Shorts master lacks reviewed inputs or matched caption geometry');
  }
  const voiceProfile = inventory.files.find(([path]) => path === 'scripts/voice-profile.mjs')?.[1];
  if (!voiceProfile) throw new Error('V11 voice profile absent from manifest');
  const [rawSha, normalizedSha, mixSha, alignmentSha, propsSha, mediaSha] = await Promise.all([
    digestFile(raw, 8 * 1024 * 1024),
    digestFile(normalized, 8 * 1024 * 1024),
    digestFile(mix, 8 * 1024 * 1024),
    digestFile(alignment, 64 * 1024),
    digestFile(props, 64 * 1024),
    digestFile(mp4, MAX_MEDIA_BYTES),
  ]);
  if (reviewed && rawSha !== reviewedNarrationSha256) throw new Error('V11 reviewed source bytes changed');
  return {
    contract: TIP_V11_MANIFEST_CONTRACT,
    source_script_sha256: SHA256.test(sourceScriptSha256 ?? '') ? sourceScriptSha256 : null,
    rendered_advice_sha256: digestTipValue(plan.body.join(' ')),
    narration_text_sha256: digestTipValue(plan.script),
    title_sha256: digestTipValue(plan.title),
    assistant_enabled: plan.assistantEnabled,
    visual_topic: plan.visualTopic,
    voice: {
      model: reviewed ? REVIEWED_NARRATION_MODEL : PRIMARY_MODEL, name: TIP_V11_VOICE_NAME,
      source: voiceSource, profile_sha256: voiceProfile,
      prompt_sha256: digestTipValue(voicePrompt(tipV11SpokenScript(plan.script, TIP_V11_TEMPLATE), '', TIP_V11_TEMPLATE)),
    },
    asset_manifest_sha256: inventory.sha256,
    static_files: inventory.files,
    raw_wav_sha256: rawSha,
    ...(reviewed && { reviewed_narration_sha256: reviewedNarrationSha256 }),
    narration_wav_sha256: normalizedSha,
    mix_wav_sha256: mixSha,
    alignment_sha256: alignmentSha,
    props_sha256: propsSha,
    media_sha256: mediaSha,
    ...(masterVisualProfile && { master_visual_profile: masterVisualProfile }),
    ...(captionGeometry && { caption_geometry: captionGeometry }),
  };
}

export function manifestHasProductionInputs(manifest, expectedMasterVisualProfile) {
  const files = manifest?.static_files;
  return manifest?.contract === TIP_V11_MANIFEST_CONTRACT
    && manifest.master_visual_profile === expectedMasterVisualProfile
    && (expectedMasterVisualProfile === undefined || (expectedMasterVisualProfile === YOUTUBE_SHORTS_PROFILE
      && manifest.voice?.source === 'reviewed-bundle' && matchesShortsCaptionGeometry(manifest.caption_geometry)))
    && Array.isArray(files) && files.length === V11_STATIC_FILES.length
    && files.every((entry, index) => Array.isArray(entry) && entry.length === 2
      && entry[0] === V11_STATIC_FILES[index] && typeof entry[1] === 'string' && SHA256.test(entry[1]))
    && manifest.asset_manifest_sha256 === digestTipValue(JSON.stringify(files))
    && typeof manifest.assistant_enabled === 'boolean'
    && ['general', 'water'].includes(manifest.visual_topic)
    && manifest.voice?.name === TIP_V11_VOICE_NAME
    && ((manifest.voice.source === 'provider' && manifest.voice.model === PRIMARY_MODEL
        && manifest.reviewed_narration_sha256 === undefined)
      || (manifest.voice.source === 'reviewed-bundle' && manifest.voice.model === REVIEWED_NARRATION_MODEL
        && manifest.assistant_enabled === false && manifest.reviewed_narration_sha256 === manifest.raw_wav_sha256))
    && manifest.voice.profile_sha256 === files.find(([path]) => path === 'scripts/voice-profile.mjs')?.[1]
    && SHA256.test(manifest.voice.prompt_sha256)
    && [
      manifest.source_script_sha256, manifest.rendered_advice_sha256, manifest.narration_text_sha256,
      manifest.title_sha256, manifest.raw_wav_sha256, manifest.narration_wav_sha256, manifest.mix_wav_sha256,
      manifest.alignment_sha256, manifest.props_sha256, manifest.media_sha256,
    ].every(value => typeof value === 'string' && SHA256.test(value));
}
