import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ORIGIN = 'https://jammimmo-estate-flow.jammimmo221admin.workers.dev';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAX_REPORT_BYTES = 128 * 1024;

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
    const response = await request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TIP_CALLBACK_TOKEN}`,
        'X-Job-Id': env.TIP_JOB_ID,
        'Content-Type': 'application/json',
      },
      body: report,
      redirect: 'error',
      signal: AbortSignal.timeout(7_500),
    });
    await response.body?.cancel();
    return response.status === 204 && !response.redirected;
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
