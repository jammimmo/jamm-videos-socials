import { pathToFileURL } from 'node:url';
import { lstat } from 'node:fs/promises';
import { postTipDelivery, readTipDeliveryTarget, readTipVideo } from './deliver-tip-video.mjs';
import { readTipAuditFailure, serializeTipAuditFailure } from './tip-render-failure-diagnostic.mjs';

const FAILURE_TIMEOUT_MS = 12_000;
const MAX_SIGNATURE_DIAGNOSTIC_BYTES = 512;
const SIGNATURE_FAILURE_ENVELOPE = /^V11 speech alignment failed \((signature_evidence_insufficient|signature_retry_insufficient)\); GitHub run [1-9][0-9]{0,19}$/;
const AUDIT_FAILURE_ENVELOPE = /^V11 technical delivery proof failed \((render_audit_[a-z_]+)\); GitHub run ([1-9][0-9]{0,19})$/;

function hasExactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}

export function canonicalVideoDiagnostic(reason, value) {
  const envelope = typeof reason === 'string' ? reason.match(SIGNATURE_FAILURE_ENVELOPE) : null;
  if (!envelope || !hasExactKeys(value, ['version', 'stage', 'code', 'checks'])
    || value.version !== 1 || value.stage !== 'render' || value.code !== envelope[1]
    || !Array.isArray(value.checks) || value.checks.length !== 1) return null;
  const [check] = value.checks;
  if (!hasExactKeys(check, ['key', 'actual', 'threshold', 'relation'])
    || check.key !== 'audio_signature_words_recognized'
    || !Number.isInteger(check.actual) || check.actual < 0 || check.actual > 2
    || check.threshold !== 3 || check.relation !== 'gte') return null;
  return JSON.stringify({
    version: 1,
    stage: 'render',
    code: envelope[1],
    checks: [{
      key: 'audio_signature_words_recognized',
      actual: check.actual,
      threshold: 3,
      relation: 'gte',
    }],
  });
}

async function readVideoDiagnostic(reason, env) {
  const path = env?.TIP_VIDEO_DIAGNOSTIC_FILE;
  if (typeof path !== 'string' || !path) return null;
  const auditEnvelope = typeof reason === 'string' ? reason.match(AUDIT_FAILURE_ENVELOPE) : null;
  if (auditEnvelope) {
    const diagnostic = await readTipAuditFailure(path);
    const packet = serializeTipAuditFailure(diagnostic);
    if (!packet || (diagnostic.code !== auditEnvelope[1]
      && !(auditEnvelope[1] === 'render_audit_rejected' && diagnostic.code.endsWith('_rejected')))) return null;
    return {
      packet,
      reason: `V11 technical delivery proof failed (${diagnostic.code}); GitHub run ${auditEnvelope[2]}`,
    };
  }
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 2
      || metadata.size > MAX_SIGNATURE_DIAGNOSTIC_BYTES) return null;
    const bytes = readTipVideo(path, MAX_SIGNATURE_DIAGNOSTIC_BYTES);
    if (!bytes || bytes.length !== metadata.size) return null;
    const packet = canonicalVideoDiagnostic(reason, JSON.parse(bytes.toString('utf8')));
    return packet ? { packet, reason } : null;
  } catch {
    return null;
  }
}

export async function deliverTipFailure(reason, env, transport) {
  if (typeof reason !== 'string' || !/^[\x20-\x7e]{1,1000}$/.test(reason) || !reason.trim()) return 'rejected';
  const target = readTipDeliveryTarget(env);
  if (!target) return 'rejected';
  const { jobId, token, url } = target;
  url.searchParams.set('status', 'failed');
  const headers = { Authorization: `Bearer ${token}`, 'X-Job-Id': jobId, 'X-Error': reason };
  const diagnostic = await readVideoDiagnostic(reason, env);
  if (diagnostic) {
    headers['X-Error'] = diagnostic.reason;
    headers['X-Video-Diagnostic'] = diagnostic.packet;
  }
  const result = await postTipDelivery(url, { headers, timeout: FAILURE_TIMEOUT_MS },
    receipt => receipt?.ok === true && receipt.jobId === jobId && receipt.status === 'failed', transport);
  return result === 'confirmed' ? 'recorded' : result;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  let result = 'rejected';
  try {
    result = await deliverTipFailure(process.argv[2], process.env);
  } catch {
    // Keep credentials, the callback URL and response content private.
  }
  if (result === 'recorded') {
    process.stdout.write('Tip failure recorded\n');
  } else {
    process.stderr.write(result === 'temporarily_unavailable' ? 'Tip failure report temporarily unavailable\n' : 'Tip failure report rejected\n');
    process.exitCode = result === 'temporarily_unavailable' ? 75 : 1;
  }
}
