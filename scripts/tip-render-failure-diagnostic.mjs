import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const REPORT_CONTRACT = 'tip-v11-fr-objective-media-evidence-v1';
const MAX_REPORT_BYTES = 128 * 1024;
const MAX_HEADER_BYTES = 1_800;
const AUDIO_REJECTED = 'render_audit_audio_waveform_rejected';
const OCR_REJECTED = 'render_audit_sampled_ocr_rejected';
const AUDIO_AND_OCR_REJECTED = 'render_audit_audio_and_ocr_rejected';
const LEGACY_CODES = new Set(['render_audit_dependency_unavailable', 'render_audit_unavailable', 'render_audit_rejected']);
const REJECTION_CODES = new Set([AUDIO_REJECTED, OCR_REJECTED, AUDIO_AND_OCR_REJECTED]);

const CHECK_RULES = {
  audio_length_difference_samples: { threshold: 3_000, relation: 'lte', min: 0, max: 2_904_000, integer: true },
  audio_signature_tail_match: { threshold: 1, relation: 'eq', min: 0, max: 1, integer: true },
  audio_min_mix_gain: { threshold: 0.65, relation: 'gte', min: 0, max: 32_768 },
  audio_max_mix_gain: { threshold: 1.20, relation: 'lte', min: 0, max: 32_768 },
  audio_segments_failed: { threshold: 0, relation: 'eq', min: 0, max: 13, integer: true },
  audio_min_narration_similarity: { threshold: 0.96, relation: 'gte', min: -1, max: 1 },
  audio_min_mix_similarity: { threshold: 0.94, relation: 'gte', min: -1, max: 1 },
  audio_min_audible_windows: { threshold: 1, relation: 'gte', min: 0, max: 484, integer: true },
  audio_min_narration_gain: { threshold: 0.65, relation: 'gte', min: 0, max: 32_768 },
  audio_max_narration_gain: { threshold: 1.15, relation: 'lte', min: 0, max: 32_768 },
  ocr_frames_failed: { threshold: 0, relation: 'eq', min: 0, max: 10, integer: true },
};
const MAX_CHECKS = Object.keys(CHECK_RULES).length;

const AUDIO_FAILURE_KEYS = ['audio_length_difference_samples', 'audio_signature_tail_match', 'audio_min_mix_gain', 'audio_max_mix_gain'];

function failedCheck(key, actual) {
  const { threshold, relation, min, max, integer } = CHECK_RULES[key];
  if (!Number.isFinite(actual) || actual < min || actual > max || (integer && !Number.isInteger(actual))) return null;
  const failed = relation === 'eq' ? actual !== threshold : relation === 'gte' ? actual < threshold : actual > threshold;
  return failed ? { key, actual, threshold, relation } : null;
}

function failedRows(rows, maxRows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > maxRows
    || rows.some(row => typeof row?.passed !== 'boolean')) return [];
  return rows.filter(row => !row.passed);
}

function recordExtreme(checks, key, rows, field, extremum) {
  const failedValues = rows.map(row => row[field]).filter(value => failedCheck(key, value));
  if (failedValues.length) checks.push(failedCheck(key, extremum(...failedValues)));
}

function makeDiagnostic(code, checks = []) {
  return { version: 1, stage: 'quality', code, checks };
}

export function classifyTipAuditFailure(fallbackCode, report) {
  if (!LEGACY_CODES.has(fallbackCode)) return null;
  if (fallbackCode !== 'render_audit_rejected' || report?.contract !== REPORT_CONTRACT || report.passed !== false) {
    return makeDiagnostic(fallbackCode);
  }
  const { audio_waveform: audio, sampled_frame_ocr: ocr } = report;
  if (typeof audio?.passed !== 'boolean' || typeof ocr?.passed !== 'boolean' || (audio.passed && ocr.passed)) {
    return makeDiagnostic(fallbackCode);
  }
  const checks = [];
  if (!audio.passed) {
    for (const key of AUDIO_FAILURE_KEYS) {
      const check = failedCheck(key, audio.failure_measurements?.[key]);
      if (check) checks.push(check);
    }
    const segments = failedRows(audio.segments, CHECK_RULES.audio_segments_failed.max);
    if (segments.length) {
      checks.push(failedCheck('audio_segments_failed', segments.length));
      recordExtreme(checks, 'audio_min_narration_similarity', segments, 'narration_similarity', Math.min);
      recordExtreme(checks, 'audio_min_mix_similarity', segments.filter(segment => segment.audible_mix_windows > 0),
        'min_audible_mix_similarity', Math.min);
      recordExtreme(checks, 'audio_min_audible_windows', segments, 'audible_mix_windows', Math.min);
      recordExtreme(checks, 'audio_min_narration_gain', segments, 'narration_gain_ratio', Math.min);
      recordExtreme(checks, 'audio_max_narration_gain', segments, 'narration_gain_ratio', Math.max);
    }
  }
  let ocrCheck = null;
  if (!ocr.passed) {
    const frames = failedRows(ocr.frames, CHECK_RULES.ocr_frames_failed.max);
    if (frames.length) ocrCheck = failedCheck('ocr_frames_failed', frames.length);
  }
  const code = audio.passed ? OCR_REJECTED : ocr.passed ? AUDIO_REJECTED : AUDIO_AND_OCR_REJECTED;
  if (ocrCheck) checks.push(ocrCheck);
  return makeDiagnostic(code, checks);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function serializeTipAuditFailure(value) {
  if (!exactKeys(value, ['version', 'stage', 'code', 'checks']) || value.version !== 1 || value.stage !== 'quality'
    || (!LEGACY_CODES.has(value.code) && !REJECTION_CODES.has(value.code))
    || !Array.isArray(value.checks) || value.checks.length > MAX_CHECKS
    || (LEGACY_CODES.has(value.code) && value.checks.length)) return null;
  const checks = [];
  const seen = new Set();
  for (const check of value.checks) {
    if (!exactKeys(check, ['key', 'actual', 'threshold', 'relation']) || typeof check.key !== 'string'
      || !Object.hasOwn(CHECK_RULES, check.key) || seen.has(check.key)) return null;
    if ((value.code === OCR_REJECTED && check.key !== 'ocr_frames_failed')
      || (value.code === AUDIO_REJECTED && check.key === 'ocr_frames_failed')) return null;
    const approved = failedCheck(check.key, check.actual);
    if (!approved || approved.threshold !== check.threshold || approved.relation !== check.relation) return null;
    seen.add(check.key);
    checks.push(approved);
  }
  const json = JSON.stringify(makeDiagnostic(value.code, checks));
  return json.length <= MAX_HEADER_BYTES ? json : null;
}

async function readBoundedJson(path, limit) {
  if (!path) return null;
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || !stat.size || stat.size > limit) return null;
      const bytes = Buffer.alloc(stat.size + 1);
      let size = 0;
      while (size < bytes.length) {
        const { bytesRead } = await file.read(bytes, size, bytes.length - size, size);
        if (!bytesRead) break;
        size += bytesRead;
      }
      return size === stat.size ? JSON.parse(bytes.subarray(0, size).toString('utf8')) : null;
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}

export async function readTipAuditFailure(path) {
  return readBoundedJson(path, MAX_HEADER_BYTES + 1);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [fallbackCode, reportPath] = process.argv.slice(2);
  const report = fallbackCode === 'render_audit_rejected' ? await readBoundedJson(reportPath, MAX_REPORT_BYTES) : null;
  const diagnostic = serializeTipAuditFailure(classifyTipAuditFailure(fallbackCode, report));
  if (diagnostic) process.stdout.write(`${diagnostic}\n`);
  else process.exitCode = 1;
}
