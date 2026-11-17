import { TIP_DELIVERY_ORIGIN } from './tip-v11-reviewed-narration.mjs';
import { requestTipSourceAttemptOidc } from './tip-v11-workflow-oidc.mjs';
import { validSourceJob } from './qualify-tip-source.mjs';

const endpoint = new URL('/api/social/advice/source-attempt', TIP_DELIVERY_ORIGIN);
const reasons = ['voice_unavailable', 'source_evidence_inconclusive', 'source_delivery_unconfirmed'];

/** A lost start acknowledgement never authorizes an extra voice request. */
export async function updateTipSourceAttempt(sourceJob, action, reason, env, request = fetch) {
  if (!validSourceJob(sourceJob) || !['start', 'failed'].includes(action)
    || (action === 'start' ? reason !== null : !reasons.includes(reason))) return { status: 'rejected' };
  const identity = { id: sourceJob.id, claimToken: sourceJob.claimToken, attempt: sourceJob.attempt };
  const body = Buffer.from(JSON.stringify({ sourceJob: identity, action, reason }));
  let token;
  try {
    token = await requestTipSourceAttemptOidc(body, env, request);
  } catch {
    return { status: 'attestation_unavailable' };
  }
  try {
    const response = await request(endpoint, { method: 'POST', redirect: 'manual',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body,
      signal: AbortSignal.timeout(20_000) });
    if (response.status !== 200 || response.redirected) {
      await response.body?.cancel().catch(() => {});
      return { status: response.status >= 500 ? 'temporarily_unavailable' : 'rejected' };
    }
    const reader = response.body?.getReader();
    if (!reader) return { status: 'rejected' };
    let size = 0;
    const chunks = [];
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024) { await reader.cancel().catch(() => {}); return { status: 'rejected' }; }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, size)));
    const flag = action === 'start' ? 'started' : 'failed';
    if (!result || Object.keys(result).length !== 2 || result[flag] !== true
      || !validSourceJob(result.sourceJob) || result.sourceJob.id !== identity.id
      || result.sourceJob.claimToken !== identity.claimToken || result.sourceJob.attempt !== identity.attempt) return { status: 'rejected' };
    return { status: 'confirmed', sourceJob: identity };
  } catch {
    return { status: 'temporarily_unavailable' };
  }
}
