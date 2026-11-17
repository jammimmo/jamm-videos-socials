import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { postTipDelivery } from './deliver-tip-video.mjs';
import { TIP_DELIVERY_ORIGIN } from './tip-v11-reviewed-narration.mjs';
import { requestTipSourceQualificationOidc } from './tip-v11-workflow-oidc.mjs';

const MAX_SOURCE_BYTES = 48 * 1024;
const SOURCE_ROUTE = new URL('/api/social/advice/source-qualification', TIP_DELIVERY_ORIGIN);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;

async function readSourceFile(path) {
  const file = await open(path, 'r');
  try {
    const stats = await file.stat();
    if (!stats.isFile() || stats.size < 1 || stats.size > MAX_SOURCE_BYTES) return null;
    const bytes = Buffer.alloc(stats.size + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    return bytesRead === stats.size ? bytes.subarray(0, stats.size) : null;
  } finally {
    await file.close();
  }
}

export async function submitTipSourceQualification(bytes, env, transport = {}) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_SOURCE_BYTES) return { status: 'rejected' };
  // Copy once so the token and any retry always use the very same bytes.
  const body = Buffer.from(bytes);
  let source;
  try {
    source = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body));
  } catch {
    return { status: 'rejected' };
  }
  if (typeof source?.postId !== 'string' || !UUID.test(source.postId)) return { status: 'rejected' };

  let attestation;
  try {
    attestation = await requestTipSourceQualificationOidc(body, env, transport.request);
  } catch {
    return { status: 'attestation_unavailable' };
  }
  let receipt;
  const status = await postTipDelivery(SOURCE_ROUTE, {
    body,
    headers: { Authorization: `Bearer ${attestation}`, 'Content-Type': 'application/json' },
    timeout: 20_000,
  }, value => {
    if (value?.postId !== source.postId || Object.keys(value).length !== 4
      || typeof value.draftSha256 !== 'string' || !SHA256.test(value.draftSha256)
      || typeof value.recipeId !== 'string' || !UUID.test(value.recipeId)
      || typeof value.qualificationId !== 'string' || !UUID.test(value.qualificationId)) return false;
    receipt = {
      postId: value.postId, draftSha256: value.draftSha256, recipeId: value.recipeId,
      qualificationId: value.qualificationId,
    };
    return true;
  }, transport);
  return status === 'confirmed' ? { status, receipt } : { status };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.argv.length !== 3) throw new Error();
    const result = await submitTipSourceQualification(await readSourceFile(process.argv[2]), process.env);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== 'confirmed') process.exitCode = 1;
  } catch {
    process.stderr.write('V11 machine source qualification input unavailable\n');
    process.exitCode = 1;
  }
}
