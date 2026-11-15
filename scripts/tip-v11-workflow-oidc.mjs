import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const sha256 = value => createHash('sha256').update(value).digest('hex');

export function tipWorkflowAudience(jobId, attemptToken, evidenceHeader) {
  if (!UUID.test(jobId) || !UUID.test(attemptToken) || !evidenceHeader || evidenceHeader.length > 1024) {
    throw new Error('V11 workflow evidence binding is invalid');
  }
  const binding = JSON.stringify([jobId, attemptToken, sha256(evidenceHeader)]);
  return `urn:jammimmo:tip-v11:render:${sha256(binding)}`;
}

export async function requestTipWorkflowOidc(evidenceHeader, env, fetchToken = fetch) {
  const attempt = new URL(env.TIP_UPLOAD_URL).searchParams.get('attempt');
  const audience = tipWorkflowAudience(env.TIP_JOB_ID, attempt, evidenceHeader);
  return requestGithubOidc(audience, env, fetchToken);
}

export function tipNarrationAudience(jobId, attemptToken, wavSha256) {
  if (!UUID.test(jobId) || !UUID.test(attemptToken) || !SHA256.test(wavSha256)) {
    throw new Error('V11 narration audience is invalid');
  }
  return `urn:jammimmo:tip-v11:narration:${sha256(JSON.stringify([jobId, attemptToken, wavSha256]))}`;
}

export async function requestTipNarrationOidc(jobId, attemptToken, wavSha256, env, fetchToken = fetch) {
  return requestGithubOidc(tipNarrationAudience(jobId, attemptToken, wavSha256), env, fetchToken);
}

async function requestGithubOidc(audience, env, fetchToken) {
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  const bearer = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!bearer || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
    || !url.hostname.endsWith('.actions.githubusercontent.com')) {
    throw new Error('V11 GitHub OIDC unavailable');
  }
  url.searchParams.set('audience', audience);
  const response = await fetchToken(url, {
    headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status !== 200) throw new Error('V11 GitHub OIDC unavailable');
  const { value } = await response.json();
  if (typeof value !== 'string' || value.length > 8192 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) {
    throw new Error('V11 GitHub OIDC response invalid');
  }
  return value;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const token = await requestTipWorkflowOidc(readFileSync(0, 'utf8'), process.env);
    // The workflow captures this output for the attempt-bound upload.
    process.stdout.write(token);
  } catch {
    process.stderr.write('V11 workflow attestation unavailable; editorial review required\n');
    process.exitCode = 1;
  }
}
