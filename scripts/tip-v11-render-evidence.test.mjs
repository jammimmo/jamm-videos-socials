import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deliverTipV11Report } from './deliver-tip-v11-report.mjs';
import { renderEvidence } from './tip-v11-render-evidence.mjs';
import {
  buildTipV11RenderManifest, collectTipV11StaticFiles, digestTipValue, manifestHasProductionInputs,
} from './tip-v11-render-manifest.mjs';
import { requestTipWorkflowOidc, tipWorkflowAudience } from './tip-v11-workflow-oidc.mjs';

const mediaSha = 'a'.repeat(64);
const workflow = { sha: 'b'.repeat(40), runId: '1234', runAttempt: '2' };
const inventory = await collectTipV11StaticFiles(fileURLToPath(new URL('../', import.meta.url)));
const manifest = {
  contract: 'tip-v11-fr-render-inputs-v1',
  source_script_sha256: '1'.repeat(64), rendered_advice_sha256: '2'.repeat(64),
  narration_text_sha256: '3'.repeat(64), title_sha256: '4'.repeat(64),
  assistant_enabled: false, visual_topic: 'general',
  voice: {
    model: 'gemini-3.1-flash-tts-preview', name: 'Algenib', source: 'provider',
    profile_sha256: inventory.files.find(([path]) => path === 'scripts/voice-profile.mjs')[1], prompt_sha256: '5'.repeat(64),
  },
  asset_manifest_sha256: inventory.sha256, static_files: inventory.files,
  raw_wav_sha256: '6'.repeat(64), narration_wav_sha256: '7'.repeat(64), mix_wav_sha256: '8'.repeat(64),
  alignment_sha256: '9'.repeat(64), props_sha256: '0'.repeat(64), media_sha256: mediaSha,
};
const manifestFields = value => ({
  render_manifest_sha256: digestTipValue(JSON.stringify(value)),
  render_manifest_b64: Buffer.from(JSON.stringify(value)).toString('base64'),
});
const report = {
  contract: 'tip-v11-fr-objective-media-evidence-v1',
  alignment_provenance: '0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf',
  media_shape: { passed: true },
  audio_waveform: { passed: true },
  sampled_frame_ocr: { passed: false },
  media_sha256: mediaSha,
  media_bytes: 12,
  ...manifestFields(manifest),
  alignment_sha256: manifest.alignment_sha256,
  narration_wav_sha256: manifest.narration_wav_sha256,
  mix_wav_sha256: manifest.mix_wav_sha256,
  editorial_approval: true,
};
const bytes = value => Buffer.from(JSON.stringify(value));

test('binds both measurements and the precise audit bytes to the uploaded media', () => {
  const reportBytes = bytes(report);
  assert.deepEqual(renderEvidence(reportBytes, mediaSha, workflow), {
    contract: 'tip-v11-fr-render-evidence-v1',
    workflow_sha: workflow.sha,
    workflow_run_id: '1234',
    workflow_run_attempt: '2',
    report_sha256: createHash('sha256').update(reportBytes).digest('hex'),
    media_sha256: mediaSha,
    media_bytes: 12,
    asr_revision: report.alignment_provenance,
    waveform: 'matched',
    sampled_ocr: 'inconclusive',
  });
});

test('rejects audit receipts for another MP4 or for local fixture timings', () => {
  assert.throws(() => renderEvidence(bytes(report), 'b'.repeat(64), workflow), /does not match/);
  assert.throws(() => renderEvidence(
    bytes({ ...report, alignment_provenance: 'local-word-timings' }), mediaSha, workflow,
  ), /does not match/);
});

test('requires the full bound manifest and declines cached or locally supplied voices', () => {
  for (const patch of [
    { render_manifest_b64: null },
    manifestFields({ ...manifest, source_script_sha256: null }),
    manifestFields({ ...manifest, static_files: manifest.static_files.slice(1) }),
    manifestFields({ ...manifest, voice: { ...manifest.voice, source: 'fixture' } }),
    manifestFields({ ...manifest, voice: { ...manifest.voice, source: 'cache' } }),
    { mix_wav_sha256: '1'.repeat(64) },
    { render_manifest_b64: manifestFields({ ...manifest, assistant_enabled: true }).render_manifest_b64 },
  ]) {
    assert.throws(() => renderEvidence(bytes({ ...report, ...patch }), mediaSha, workflow), /does not match/);
  }
});

test('records the actual render inputs and only hashes of the script, audio, props and MP4', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'tip-manifest-test-'));
  try {
    const files = Object.fromEntries(await Promise.all(['raw', 'normalized', 'mix', 'alignment', 'props', 'mp4'].map(async name => {
      const path = join(temporary, name);
      await writeFile(path, `private fixture ${name}`);
      return [name, path];
    })));
    const plan = {
      title: 'Titre local', body: ['Une phrase locale.'], script: 'Un texte à hacher.',
      assistantEnabled: true, visualTopic: 'water', segments: [{ id: 'assistant' }],
    };
    const sourceScriptSha256 = digestTipValue('Texte source exact.');
    const captionGeometry = { contract: 'tip-v11-caption-geometry-v1', status: 'inconclusive', duration_frames: 2100, cues: [] };
    const captured = await buildTipV11RenderManifest({
      plan, sourceScriptSha256, voiceSource: 'provider', inventory, captionGeometry, ...files,
    });
    assert.ok(manifestHasProductionInputs(captured));
    assert.equal(captured.source_script_sha256, sourceScriptSha256);
    assert.equal(captured.narration_text_sha256, digestTipValue(plan.script));
    assert.equal(captured.assistant_enabled, true);
    assert.equal(captured.visual_topic, 'water');
    assert.equal(captured.raw_wav_sha256, digestTipValue('private fixture raw'));
    assert.deepEqual(captured.caption_geometry, captionGeometry);
    const renderedReport = { ...report, ...manifestFields({ ...manifest, caption_geometry: captionGeometry }) };
    assert.equal(renderEvidence(bytes(renderedReport), mediaSha, workflow).report_sha256, digestTipValue(bytes(renderedReport)));
    assert.equal(captured.mix_wav_sha256, digestTipValue('private fixture mix'));
    assert.equal(captured.media_sha256, digestTipValue('private fixture mp4'));
    assert.ok(!JSON.stringify(captured).includes(plan.script));
    assert.ok(!JSON.stringify(captured).includes(temporary));
    await assert.rejects(buildTipV11RenderManifest({
      plan: { ...plan, assistantEnabled: false }, sourceScriptSha256, voiceSource: 'provider', inventory, ...files,
    }), /incomplete/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

const jobId = '11111111-1111-4111-8111-111111111111';
const attemptToken = '22222222-2222-4222-8222-222222222222';
const evidenceHeader = '{"receipt":"v11"}';
const audience = 'urn:jammimmo:tip-v11:render:7210544041e62c87ab85851a083e6ac7b01ab8674546efa33ca91105e7163461';
const oidcEnvironment = {
  TIP_JOB_ID: jobId,
  TIP_UPLOAD_URL: `https://worker.example/api/tour/upload?attempt=${attemptToken}`,
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://vstoken.actions.githubusercontent.com/example?api-version=2.0',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'test-only-runner-credential',
};

test('requests a token for the exact job, attempt, and evidence bytes', async () => {
  assert.equal(tipWorkflowAudience(jobId, attemptToken, evidenceHeader), audience);
  assert.notEqual(tipWorkflowAudience(attemptToken, jobId, evidenceHeader), audience);
  assert.notEqual(tipWorkflowAudience(jobId, attemptToken, evidenceHeader + ' '), audience);
  const token = await requestTipWorkflowOidc(evidenceHeader, oidcEnvironment, async (url, options) => {
    assert.equal(url.hostname, 'vstoken.actions.githubusercontent.com');
    assert.equal(url.searchParams.get('audience'), audience);
    assert.equal(url.searchParams.get('api-version'), '2.0');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer test-only-runner-credential');
    return Response.json({ value: 'test.only.token' });
  });
  assert.equal(token, 'test.only.token');
});

test('never sends the runner credential to an untrusted host or requests an unbound token', async () => {
  const neverFetch = async () => { throw new Error('unexpected credential request'); };
  await assert.rejects(requestTipWorkflowOidc(evidenceHeader, {
    ...oidcEnvironment, ACTIONS_ID_TOKEN_REQUEST_URL: 'https://vstoken.actions.githubusercontent.com.example/path',
  }, neverFetch), /OIDC unavailable/);
  await assert.rejects(requestTipWorkflowOidc(evidenceHeader, {
    ...oidcEnvironment, TIP_UPLOAD_URL: 'https://worker.example/api/tour/upload',
  }, neverFetch), /binding is invalid/);
});

const reportBytes = Buffer.from('{"report":"fictional"}\n');
const reportEnv = {
  TIP_JOB_ID: jobId,
  TIP_CALLBACK_TOKEN: 'a'.repeat(64),
  TIP_CALLBACK_URL: `https://jammimmo-estate-flow.jammimmo221admin.workers.dev/api/tour/callback?attempt=${attemptToken}`,
};

test('delivers the exact report to the already-bound callback without reserializing or forwarding redirects', async () => {
  const stored = await deliverTipV11Report(reportBytes, reportEnv, async (url, options) => {
    assert.equal(url.href, `${reportEnv.TIP_CALLBACK_URL}&action=tip-v11-report`);
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['X-Job-Id'], jobId);
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.headers.Authorization, `Bearer ${reportEnv.TIP_CALLBACK_TOKEN}`);
    assert.strictEqual(options.body, reportBytes);
    return new Response(null, { status: 204 });
  });
  assert.equal(stored, true);
});

test('the optional callback never retries an old Worker, nor sends a token to another host', async () => {
  for (const refusal of [
    async () => Response.json({ error: 'status invalide' }, { status: 400 }),
    async () => Response.json({ ok: true }),
    async () => { throw new Error('unavailable'); },
  ]) {
    let calls = 0;
    const stored = await deliverTipV11Report(reportBytes, reportEnv, async (...args) => {
      calls++;
      return refusal(...args);
    });
    assert.equal(stored, false);
    assert.equal(calls, 1);
  }
  let requested = false;
  const neverFetch = async () => { requested = true; };
  assert.equal(await deliverTipV11Report(reportBytes, {
    ...reportEnv, TIP_CALLBACK_URL: 'https://example.test/api/tour/callback',
  }, neverFetch), false);
  assert.equal(await deliverTipV11Report(Buffer.alloc(128 * 1024 + 1), reportEnv, neverFetch), false);
  assert.equal(requested, false);
});
