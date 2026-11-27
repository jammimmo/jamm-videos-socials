import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { measuredReasons, runtimeReasons, safeAlignmentFields } from './source-failure-diagnostic.mjs';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

class ScoreError extends Error {
  constructor(reason, exitCode) {
    super(reason);
    this.exitCode = exitCode;
  }
}

export async function readScoreReport(report, exitCode) {
  let bytes;
  try {
    bytes = await readFile(report, 'utf8');
  } catch {
    throw new ScoreError('score_report_unavailable', exitCode);
  }
  let speech;
  try {
    speech = JSON.parse(bytes);
  } catch {
    throw new ScoreError('score_report_invalid', exitCode);
  }
  if (!['tip-v11-fr-source-speech-v2', 'tip-v11-fr-source-speech-v3'].includes(speech?.contract) || speech.status !== (exitCode === 0 ? 'matched' : 'inconclusive')) {
    throw new ScoreError('score_protocol_invalid', exitCode);
  }
  return speech;
}

export async function score(draft, wav, report, env, inspection) {
  let exitCode = 0;
  try {
    const args = ['scripts/score-tip-source.mjs', '--draft', draft, '--wav', wav, '--report', report];
    if (inspection) args.push('--inspection-nonce', inspection.nonce, '--inspection-attempt', String(inspection.attempt));
    await execute(process.execPath, args, {
      cwd: root, env: { ...env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' }, timeout: 370_000, maxBuffer: 128 * 1024,
    });
  } catch (error) {
    // Exit 1 writes an inconclusive report, including recognizer failures. Exit 2 has no usable report.
    if (error.code !== 1) {
      const code = Number.isInteger(error.code) && error.code >= 0 && error.code <= 255 ? error.code : undefined;
      throw new ScoreError('score_process_failed', code);
    }
    exitCode = 1;
  }
  return readScoreReport(report, exitCode);
}

function measuredDiagnostic(speech) {
  const diagnostic = { stage: 'measured_inconclusive', reason: speech.reason, ...safeAlignmentFields(speech) };
  if (Array.isArray(speech.segments) && speech.segments.length <= 32) {
    diagnostic.segmentCount = speech.segments.length;
    diagnostic.matchedSegments = speech.segments.filter(row => row?.status === 'matched').length;
  }
  return diagnostic;
}

const wordAssignmentPredicates = new Set([
  'row_count_excessive', 'row_shape_invalid', 'row_text_invalid', 'timestamp_nonfinite', 'confidence_invalid',
  'timestamp_regression', 'timestamp_reversed', 'timestamp_zero_duration', 'timestamp_overrun',
  'corroborated_point_invalid', 'midpoint_outside_scene',
]);

function inspectionComparisonFailure(speech) {
  const detail = speech.comparison_failure;
  if (speech.reason !== 'recognition_or_timing_inconclusive' || !Array.isArray(speech.segments)
    || speech.segments.length !== 0 || !detail || typeof detail !== 'object' || Array.isArray(detail)) return;
  if (detail.phase === 'french_comparison' && detail.predicate === 'unclassified_value_error') {
    return { phase: detail.phase, predicate: detail.predicate };
  }
  if (detail.phase !== 'word_assignment' || !wordAssignmentPredicates.has(detail.predicate)
    || !Number.isInteger(detail.row_index) || detail.row_index < 0 || detail.row_index > 500) return;
  const safe = { phase: detail.phase, predicate: detail.predicate, row_index: detail.row_index };
  if (Number.isInteger(detail.row_count) && detail.row_count > detail.row_index && detail.row_count <= 501) {
    safe.row_count = detail.row_count;
  }
  if (Number.isInteger(detail.segment_index) && detail.segment_index >= 0 && detail.segment_index < 32) {
    safe.segment_index = detail.segment_index;
  }
  return safe;
}

const sourceIdentityFields = ['draft_sha256', 'source_script_sha256', 'narration_wav_sha256', 'decoded_pcm_sha256'];

function canRemeasurePhone(speech) {
  const calls = speech.recognizer_diagnostics;
  return speech.reason === 'phone_evidence_unconfirmed' && speech.alignment_code === 'phone_gap_unconfirmed'
    && speech.matched_words === 0 && speech.phone_remeasurement_eligible === true
    && Array.isArray(calls) && calls.some(call => call?.stage === 'full_audio' && call?.outcome === 'completed')
    && calls.every(call => call?.outcome === 'completed' && call?.stage !== 'alignment_phone')
    && sourceIdentityFields.every(key => typeof speech[key] === 'string' && /^[a-f0-9]{64}$/u.test(speech[key]));
}

export async function measureSource(measure, draft, wav, scratch, env, {
  inspectComparison = false, remeasureUnconfirmedPhone = false,
} = {}) {
  let firstPhoneMeasurement;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let transient = false;
    let alignment = {};
    let reason = 'score_protocol_invalid';
    try {
      const speech = await measure(draft, wav, resolve(scratch, 'speech-' + attempt + '.json'), env);
      if (firstPhoneMeasurement && sourceIdentityFields.some(key => speech?.[key] !== firstPhoneMeasurement.identity[key])) {
        return { diagnostic: { ...firstPhoneMeasurement.diagnostic, measurementAttempts: attempt } };
      }
      if (speech?.status === 'matched') return { speech, measurementAttempts: attempt };
      if (speech?.status === 'inconclusive' && measuredReasons.has(speech.reason)) {
        // Optional verification windows can record a failed recognizer call
        // alongside a negative score. Never retry mixed evidence to obtain a pass.
        const incompleteRecognizerCall = Array.isArray(speech.recognizer_diagnostics)
          && speech.recognizer_diagnostics.some(call => call?.outcome !== 'completed');
        const diagnostic = { ...measuredDiagnostic(speech), incompleteRecognizerCall, measurementAttempts: attempt };
        if (attempt === 1 && remeasureUnconfirmedPhone && canRemeasurePhone(speech)) {
          firstPhoneMeasurement = { diagnostic, identity: Object.fromEntries(sourceIdentityFields.map(key => [key, speech[key]])) };
          continue;
        }
        const comparison = inspectComparison && inspectionComparisonFailure(speech);
        return comparison ? { diagnostic, comparison } : { diagnostic };
      }
      if (speech?.status === 'inconclusive') {
        if (runtimeReasons.includes(speech.reason)) {
          reason = speech.reason;
          alignment = safeAlignmentFields(speech);
        }
        transient = reason === 'recognizer_timeout';
      }
    } catch (error) {
      reason = error instanceof ScoreError ? error.message : 'measurement_error';
      const diagnostic = { stage: 'measurement_unavailable', reason, measurementAttempts: attempt };
      if (error instanceof ScoreError && error.exitCode !== undefined) diagnostic.exitCode = error.exitCode;
      return { diagnostic };
    }
    if (!transient || attempt === 2) {
      return { diagnostic: { stage: 'measurement_unavailable', reason, measurementAttempts: attempt, ...alignment } };
    }
  }
}
