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
  if (speech?.contract !== 'tip-v11-fr-source-speech-v2' || speech.status !== (exitCode === 0 ? 'matched' : 'inconclusive')) {
    throw new ScoreError('score_protocol_invalid', exitCode);
  }
  return speech;
}

export async function score(draft, wav, report, env) {
  let exitCode = 0;
  try {
    await execute(process.execPath, ['scripts/score-tip-source.mjs', '--draft', draft, '--wav', wav, '--report', report], {
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

export async function measureSource(measure, draft, wav, scratch, env) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let transient = false;
    let alignment = {};
    let reason = 'score_protocol_invalid';
    try {
      const speech = await measure(draft, wav, resolve(scratch, 'speech-' + attempt + '.json'), env);
      if (speech?.status === 'matched') return { speech, measurementAttempts: attempt };
      if (speech?.status === 'inconclusive' && measuredReasons.has(speech.reason)) {
        // Optional verification windows can record a failed recognizer call
        // alongside a negative score. Never retry mixed evidence to obtain a pass.
        const incompleteRecognizerCall = Array.isArray(speech.recognizer_diagnostics)
          && speech.recognizer_diagnostics.some(call => call?.outcome !== 'completed');
        return { diagnostic: { ...measuredDiagnostic(speech), incompleteRecognizerCall, measurementAttempts: attempt } };
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
