import { pathToFileURL } from 'node:url';
import { postTipDelivery, readTipDeliveryTarget } from './deliver-tip-video.mjs';

const FAILURE_TIMEOUT_MS = 12_000;

export async function deliverTipFailure(reason, env, transport) {
  if (typeof reason !== 'string' || !/^[\x20-\x7e]{1,1000}$/.test(reason) || !reason.trim()) return 'rejected';
  const target = readTipDeliveryTarget(env);
  if (!target) return 'rejected';
  const { jobId, token, url } = target;
  url.searchParams.set('status', 'failed');
  const headers = { Authorization: `Bearer ${token}`, 'X-Job-Id': jobId, 'X-Error': reason };
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
