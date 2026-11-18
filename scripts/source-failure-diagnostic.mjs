// The speech report also contains words and segment text. Only these bounded
// measurements and controlled codes may leave the private scoring process.
export const measuredReasons = new Set([
  'no_audible_source', 'ordered_words_unconfirmed', 'recognition_or_timing_inconclusive',
  'signature_boundary_unconfirmed', 'signature_tail_too_quiet', 'signature_closing_unrecognized',
  'signature_retry_insufficient', 'signature_evidence_insufficient', 'phone_evidence_unconfirmed', 'website_evidence_unconfirmed',
  'script_evidence_unconfirmed', 'alignment_evidence_invalid',
]);
export const runtimeReasons = [
  'recognizer_call_limit', 'recognizer_process_failed', 'recognizer_output_invalid', 'recognizer_unavailable', 'recognizer_timeout',
];
const unavailableReasons = new Set([...runtimeReasons, 'score_process_failed', 'score_report_unavailable',
  'score_report_invalid', 'score_protocol_invalid', 'measurement_error']);
const alignmentCodes = new Set([
  'duration_invalid', 'no_word_timestamps', 'word_row_invalid', 'timestamp_nonfinite', 'timestamp_regression',
  'timestamp_reversed', 'timestamp_overrun', 'no_recognized_tokens', 'no_audible_windows', 'leading_silence',
  'trailing_silence', 'interior_pause', 'empty_segment', 'script_coverage_low', 'domain_unconfirmed',
  'phone_gap_unconfirmed', 'phone_gap_quiet', 'phone_window_unconfirmed', 'phone_window_early', 'phone_window_late',
  'phone_window_unvoiced', 'segment_coverage_low', 'no_segment_anchors', 'scene_too_short', 'caption_too_short',
  'signature_evidence_insufficient', 'signature_boundary_unconfirmed', 'signature_tail_too_quiet',
  'signature_closing_unrecognized', 'signature_retry_insufficient', 'unclassified_value_error',
]);
const maxima = {
  duration_ms: 360_000, span_ms: 360_000, row_index: 4096, row_count: 4096, segment_index: 4096,
  chunk_index: 4096, matched_words: 4096, expected_words: 4096, observed_words_count: 4096, ratio_permille: 1000,
};
const bounded = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;

export function safeAlignmentFields(speech) {
  const fields = {};
  if (alignmentCodes.has(speech.alignment_code)) fields.alignment_code = speech.alignment_code;
  for (const [key, max] of Object.entries(maxima)) {
    if (bounded(speech[key], max)) fields[key] = speech[key];
  }
  return fields;
}

export function validCapsuleDiagnostic(value, wavKind) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !['raw', 'normalized'].includes(wavKind)) return false;
  const { stage, reason, measurementAttempts } = value;
  if (wavKind === 'raw' && stage !== 'normalization_failed') return false;
  if (stage === 'normalization_failed') {
    if (reason !== stage || measurementAttempts !== 0) return false;
  } else {
    if (![1, 2].includes(measurementAttempts)) return false;
    if (stage === 'source_delivery_unconfirmed' ? reason !== stage
      : stage === 'measured_inconclusive' ? !measuredReasons.has(reason)
      : stage !== 'measurement_unavailable' || !unavailableReasons.has(reason)) return false;
  }
  const expected = { stage, reason, measurementAttempts, ...safeAlignmentFields(value) };
  if (typeof value.incompleteRecognizerCall === 'boolean') expected.incompleteRecognizerCall = value.incompleteRecognizerCall;
  for (const [k, max] of [['segmentCount', 4096], ['matchedSegments', 4096], ['exitCode', 255]]) {
    if (bounded(value[k], max)) expected[k] = value[k];
  }
  return Object.keys(expected).length === Object.keys(value).length && Object.keys(expected).every(k => Object.hasOwn(value, k));
}
