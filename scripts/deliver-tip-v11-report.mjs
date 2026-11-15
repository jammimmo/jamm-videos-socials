import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const ORIGIN = 'https://jammimmo-estate-flow.jammimmo221admin.workers.dev';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAX_REPORT_BYTES = 128 * 1024;
const REPORT_ATTEMPT_DELAYS_MS = [0, 250, 1000];

function readReport(path) {
  const fd = openSync(path, 'r');
  try {
    const file = fstatSync(fd);
    if (!file.isFile() || file.size < 1 || file.size > MAX_REPORT_BYTES) return null;
    const buffer = Buffer.alloc(file.size + 1);
    const count = readSync(fd, buffer, 0, buffer.length, 0);
    return count === file.size ? buffer.subarray(0, count) : null;
  } finally {
    closeSync(fd);
  }
}

export async function deliverTipV11Report(report, env, request = fetch) {
  try {
    if (!report || report.length === 0 || report.length > MAX_REPORT_BYTES
      || typeof env.TIP_JOB_ID !== 'string' || !UUID.test(env.TIP_JOB_ID)
      || typeof env.TIP_CALLBACK_TOKEN !== 'string' || !/^[a-f0-9]{64}$/.test(env.TIP_CALLBACK_TOKEN)) return false;
    const url = new URL(env.TIP_CALLBACK_URL);
    const attempt = url.searchParams.get('attempt');
    if (url.origin !== ORIGIN || url.pathname !== '/api/tour/callback' || url.username || url.password || url.hash
      || url.searchParams.size !== 1 || !attempt || !UUID.test(attempt)) return false;
    url.searchParams.set('action', 'tip-v11-report');
    const options = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TIP_CALLBACK_TOKEN}`,
        'X-Job-Id': env.TIP_JOB_ID,
        'Content-Type': 'application/json',
      },
      body: report,
      redirect: 'manual',
    };
    // Replaying the same attested report is idempotent, including after a lost
    // response. Manual redirect handling exposes refusals without forwarding.
    for (const delay of REPORT_ATTEMPT_DELAYS_MS) {
      if (delay) await wait(delay);
      let response;
      try {
        response = await request(url, { ...options, signal: AbortSignal.timeout(7_500) });
      } catch {
        continue;
      }
      await response.body?.cancel().catch(() => undefined);
      if (response.redirected) return false;
      if (response.status === 204) return true;
      if (response.status !== 429 && (response.status < 500 || response.status > 599)) return false;
    }
    return false;
  } catch {
    return false;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  let stored = false;
  try {
    stored = await deliverTipV11Report(readReport(process.argv[2]), process.env);
  } catch {
    // The MP4 already reached the Worker. This optional delivery must stay soft.
  }
  if (!stored) process.stderr.write('V11 audit report unavailable; editorial review required\n');
}
