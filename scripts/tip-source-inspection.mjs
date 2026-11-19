// Public diagnostics are reconstructed from finite fields. Never include exception text or private rows.
const scenes = 'hook step1 step2 step3 takeaway services tools contact phone socials'.split(' ');
const stages = 'model_load full_audio alignment_phone alignment_signature audit_phone audit_phone_context audit_services audit_socials audit_hook'.split(' ');
const outcomes = 'completed timeout process_failed output_invalid unavailable'.split(' ');
const methods = ('complete_preceding_french_words fixed_dakar_djam_imo_spelling fixed_company_domain_url_notation ' +
  'fixed_domain_jamimo_phonetic_spelling fixed_socials_complete_before_excluded_cue fixed_socials_signature_boundary ' +
  'french_centre_ville_spelling fixed_jamm_immo_phonetic_spelling hook_exact_silence_boundary phone_exact_neighbor_window ' +
  'phone_exact_contact_context_v1 services_exact_brand_window socials_exact_scene_window fixed_socials_untimed_word_scored_as_edit ' +
  'fixed_company_domain_asr_uncertain_v1 domain_exact_scene_window').split(' ');
const flags = ('unreportable_words unsafe_uncertainty edit_budget_exceeded protected_mismatch standalone_plus mixed_boundary ' +
  'domain_unconfirmed focused_matched focused_unconfirmed focus_not_eligible untimed_word_counted score_matched global_edits_exceeded').split(' ');
const revision = '0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf';
const limit = 1024 * 1024;
const maxLine = 16 * 1024;
function checked(ok, value) {
  if (!ok) throw new Error('Invalid inspection');
  return value;
}
const integer = (value, low, high) => checked(Number.isSafeInteger(value) && low <= value && value <= high, value);
const choice = (value, options) => checked(options.includes(value), value);
const bool = value => checked(typeof value === 'boolean', value);
const hex = (v, length) => checked(typeof v === 'string' && v.length === length && /^[0-9a-f]+$/.test(v), v);
const digest = v => hex(v, 64);
const optional = (v, validate) => v === null ? null : validate(v);
function list(value, length, project) {
  checked(Array.isArray(value) && value.length <= length);
  return Array.from(value, project);
}
const count = v => integer(v, 0, 128);
const positions = values => list(values, 128, count);
function scene(s, frames) {
  const sample = v => integer(v, 0, frames);
  return {
    id: choice(s.id, scenes), status: choice(s.status, ['matched', 'inconclusive', 'not_evaluated']),
    startSample: optional(s.startSample, sample), endSample: optional(s.endSample, sample),
    expectedCount: count(s.expectedCount), observedCount: optional(s.observedCount, v => integer(v, 0, 150000)),
    nullCount: optional(s.nullCount, count), editCount: optional(s.editCount, count),
    protectedMatch: optional(s.protectedMatch, bool), method: optional(s.method, v => choice(v, methods)),
    reason: optional(s.reason, v => choice(v, ['mixed_language_boundary'])),
    gateFlags: list(s.gateFlags, flags.length, v => choice(v, flags)),
    uncertainPositions: positions(s.uncertainPositions), rawMismatchPositions: positions(s.rawMismatchPositions),
  };
}
function call(c, i, frames) {
  const sample = v => integer(v, 0, frames);
  const localSample = v => integer(v, -8640000, 8640000);
  const rowCount = optional(c.rowCount, v => integer(v, 0, 500));
  const omittedRows = integer(c.omittedRows, 0, 500);
  const rows = list(c.rows, 500, (r, n) => {
    checked(Array.isArray(r) && r.length === 5 && r[0] === n);
    return [n, optional(r[1], localSample), optional(r[2], localSample),
      optional(r[3], v => integer(v, 0, 1000)), digest(r[4])];
  });
  checked((rowCount ?? 0) === rows.length + omittedRows);
  return {
    callIndex: integer(c.callIndex, i + 1, i + 1), stage: choice(c.stage, stages), outcome: choice(c.outcome, outcomes),
    startSample: optional(c.startSample, sample), endSample: optional(c.endSample, sample),
    pcmSha256: optional(c.pcmSha256, digest), streamDigest: optional(c.streamDigest, digest), rowCount, omittedRows, rows,
  };
}
export function projectInspection(e, expected) {
  try {
    checked(e.version === 1 && e.modelRevision === revision);
    const sourceFrames = integer(e.sourceFrames, 1404000, 2856000);
    const identity = { nonce: hex(e.nonce, 32), attempt: integer(e.attempt, 1, 2),
      wavSha256: digest(e.wavSha256), draftSha256: digest(e.draftSha256), scriptSha256: digest(e.scriptSha256) };
    checked(Object.entries(identity).every(([key, value]) => expected[key] === value));
    const segments = list(e.scenes, scenes.length, s => scene(s, sourceFrames));
    checked(segments.length === scenes.length && new Set(segments.map(s => s.id)).size === scenes.length);
    const projected = { status: 'available', version: 1, ...identity, pcmSha256: digest(e.pcmSha256), modelRevision: revision,
      sourceFrames, global: { status: choice(e.global.status, ['matched', 'inconclusive']),
        expectedCount: integer(e.global.expectedCount, 0, 1280), editCount: optional(e.global.editCount, v => integer(v, 0, 1280)),
        protectedMatch: optional(e.global.protectedMatch, bool),
        ruleEvaluated: e.global.ruleEvaluated === undefined ? null : optional(e.global.ruleEvaluated, bool),
        editBudgetExceeded: optional(e.global.editBudgetExceeded ?? null, bool) },
      scenes: segments, calls: list(e.calls, 12, (c, i) => call(c, i, sourceFrames)), truncated: bool(e.truncated) };
    checked(Buffer.byteLength(JSON.stringify(projected)) <= limit);
    return projected;
  } catch {
    return {status: 'unavailable', attempt: [1, 2].includes(expected?.attempt) ? expected.attempt : null};
  }
}

// Existing result fields are produced by the inspection runner's independent diagnostic projector.
export function inspectionLogLines(result) {
  const {inspection, ...base} = result;
  if (!inspection) return [JSON.stringify(base)];
  const nonce = inspection.nonce;
  if (typeof nonce !== 'string' || nonce.length !== 32 || !/^[0-9a-f]+$/.test(nonce)
    || !Array.isArray(inspection.attempts) || inspection.attempts.length > 2) return [JSON.stringify(base)];
  const attempts = inspection.attempts.map((a, i) => projectInspection(a, {...a, nonce, attempt: i + 1}));
  const encode = value => JSON.stringify(value);
  const size = line => Buffer.byteLength(line) + 1;
  const calls = [];
  for (const a of attempts) {
    for (const c of a.calls ?? []) {
      calls.push({a, c, rows: c.rows});
      delete c.rows;
    }
  }
  function metadata(forceChunks = false) {
    const summary = encode({...base, inspection: {nonce, attempts}});
    if (!forceChunks && size(summary) <= maxLine) return [summary];
    const headers = attempts.map(a => {
      const {scenes, calls, ...header} = a;
      return {...header, sceneCount: scenes?.length ?? 0, callCount: calls?.length ?? 0};
    });
    const lines = [encode({...base, inspection: {nonce, attempts: headers, metadataChunked: true}})];
    for (const a of attempts) {
      for (const scene of a.scenes ?? []) lines.push(encode({type: 'inspection_scene', nonce, attempt: a.attempt, scene}));
      for (const call of a.calls ?? []) lines.push(encode({type: 'inspection_call', nonce, attempt: a.attempt, call}));
    }
    return lines;
  }
  // Budget metadata at its largest cardinality and digit widths. Keep the chosen
  // compact/chunked form fixed so crossing a line boundary cannot grow it later.
  const oldTruncated = attempts.map(a => a.truncated);
  for (const {c} of calls) c.omittedRows = c.rowCount ?? 0;
  for (const a of attempts) if (a.calls) a.truncated = false;
  const reserved = metadata();
  const chunked = reserved.length > 1;
  let remaining = limit - reserved.reduce((n, line) => n + size(line), 0);
  const chunks = [];
  attempts.forEach((a, i) => { if (a.calls) a.truncated = oldTruncated[i]; });
  for (const {a, c, rows} of calls) {
    for (let offset = 0; offset < rows.length; offset += 100) {
      const group = rows.slice(offset, offset + 100);
      const line = encode({type: 'inspection_rows', nonce, attempt: a.attempt, callIndex: c.callIndex, rows: group});
      if (size(line) > remaining || size(line) > maxLine) {
        a.truncated = true;
        break;
      }
      chunks.push(line);
      remaining -= size(line);
      c.omittedRows -= group.length;
    }
  }
  return [...metadata(chunked), ...chunks];
}
