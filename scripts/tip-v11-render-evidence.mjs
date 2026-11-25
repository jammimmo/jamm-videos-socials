import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { manifestHasProductionInputs } from './tip-v11-render-manifest.mjs';
import { YOUTUBE_SHORTS_BRAND_MASK, YOUTUBE_SHORTS_SAFE_BOUNDS } from '../src/compositions/tip-v11-caption-geometry.ts';

const ASR_REVISION = '0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf';

export function renderEvidence(reportBytes, mediaSha, { sha, runId, runAttempt, masterVisualProfile }) {
  if (reportBytes.length > 128 * 1024) throw new Error('V11 audit report exceeds size limit');
  const report = JSON.parse(reportBytes);
  if (report?.contract !== 'tip-v11-fr-objective-media-evidence-v1'
    || report.alignment_provenance !== ASR_REVISION
    || report.media_shape?.passed !== true
    || !/^[a-f0-9]{64}$/.test(report.render_manifest_sha256)
    || typeof report.render_manifest_b64 !== 'string' || report.render_manifest_b64.length > 90 * 1024
    || typeof report.audio_waveform?.passed !== 'boolean'
    || typeof report.sampled_frame_ocr?.passed !== 'boolean'
    || typeof mediaSha !== 'string' || !/^[a-f0-9]{64}$/.test(mediaSha)
    || report.media_sha256 !== mediaSha || !Number.isSafeInteger(report.media_bytes)
    || report.media_bytes < 12 || report.media_bytes > 50 * 1024 * 1024
    || typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha)
    || typeof runId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(runId)
    || typeof runAttempt !== 'string' || !/^[1-9][0-9]{0,5}$/.test(runAttempt)) {
    throw new Error('V11 audit report does not match the production render');
  }
  const manifestBytes = Buffer.from(report.render_manifest_b64, 'base64');
  const manifest = JSON.parse(manifestBytes);
  if (manifestBytes.toString('base64') !== report.render_manifest_b64
    || createHash('sha256').update(manifestBytes).digest('hex') !== report.render_manifest_sha256
    || !manifestHasProductionInputs(manifest, masterVisualProfile)
    || manifest.media_sha256 !== mediaSha
    || manifest.alignment_sha256 !== report.alignment_sha256
    || manifest.narration_wav_sha256 !== report.narration_wav_sha256
    || manifest.mix_wav_sha256 !== report.mix_wav_sha256) {
    throw new Error('V11 audit report does not match the production render manifest');
  }
  if (masterVisualProfile !== undefined) {
    const brand = report.final_brand_cta_visibility;
    if (report.sampled_frame_ocr.passed !== true || brand?.status !== 'matched'
      || brand.source !== 'decoded_mp4_frames' || brand.contract !== 'tip-v11-final-brand-cta-v1'
      || brand.mask !== YOUTUBE_SHORTS_BRAND_MASK
      || !Array.isArray(brand.mask_bounds) || brand.mask_bounds.length !== YOUTUBE_SHORTS_SAFE_BOUNDS.length
      || !YOUTUBE_SHORTS_SAFE_BOUNDS.every((bound, index) => brand.mask_bounds[index] === bound)) {
      throw new Error('V11 Shorts master lacks its decoded brand proof');
    }
  }
  return {
    contract: 'tip-v11-fr-render-evidence-v1',
    workflow_sha: sha,
    workflow_run_id: runId,
    workflow_run_attempt: runAttempt,
    report_sha256: createHash('sha256').update(reportBytes).digest('hex'),
    media_sha256: mediaSha,
    media_bytes: report.media_bytes,
    asr_revision: ASR_REVISION,
    waveform: report.audio_waveform.passed ? 'matched' : 'inconclusive',
    sampled_ocr: report.sampled_frame_ocr.passed ? 'matched' : 'inconclusive',
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [, , reportPath, mediaSha] = process.argv;
  const { GITHUB_SHA: sha, GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: runAttempt } = process.env;
  process.stdout.write(JSON.stringify(renderEvidence(readFileSync(reportPath), mediaSha, { sha, runId, runAttempt })));
}
