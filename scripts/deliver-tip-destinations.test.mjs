import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { deliverTipDestinationAttempt } from './deliver-tip-destination-attempt.mjs';
import { deliverTipDestinations, prepareTipDestinations } from './deliver-tip-destinations.mjs';
import { buildTipV11RenderManifest, collectTipV11StaticFiles } from './tip-v11-render-manifest.mjs';
import { tipV11CaptionMask } from '../src/compositions/tip-v11-caption-geometry.ts';

const jobId = '00000000-0000-4000-8000-000000000011';
const attempt = '00000000-0000-4000-8000-000000000022';
const token = 'a'.repeat(64);
const uploadUrl = 'https://jammimmo-estate-flow.jammimmo221admin.workers.dev/api/tour/upload?attempt=' + attempt;
const env = {
  TIP_JOB_ID: jobId, TIP_UPLOAD_URL: uploadUrl, TIP_CALLBACK_TOKEN: token,
  TIP_CALLBACK_URL: uploadUrl.replace('/upload?', '/callback?'),
  GITHUB_SHA: 'c'.repeat(40), GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.githubusercontent.com/request?api-version=2',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'synthetic-only',
};
const destinations = ['facebook', 'instagram', 'tiktok'];
const masterSha256 = 'd'.repeat(64);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t, duration = 90) {
  const directory = await mkdtemp(join(tmpdir(), 'jamm-destination-delivery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const videos = [];
  for (const destination of destinations) {
    const body = Buffer.from('synthetic destination media bytes: ' + destination);
    await writeFile(join(directory, destination + '.mp4'), body);
    const mask = tipV11CaptionMask(destination);
    const last = Math.round(duration * 30) - 1;
    videos.push({ destination, duration, size: body.length, mediaSha256: sha(body), videoFrames: last + 1,
      captionGeometry: {
        contract: 'tip-v11-caption-geometry-v1', scope: 'caption_card_and_text_bounds', status: 'matched',
        coverage: 'first_middle_last_frame_per_cue', mask: mask.id, mask_bounds: mask.bounds,
        width: 1080, height: 1920, fps: 30, duration_frames: last + 1,
        cues: [{ cue: 0, status: 'matched', sample_frames: [0, Math.floor(last / 2), last],
          card_bounds: mask.bounds, text_bounds: mask.bounds }],
      },
    });
  }
  return { directory, masterSha256, receipt: { scope: 'offline-destination-layouts', videos } };
}

function receipt(url, options) {
  return Response.json({ ok: true, jobId, destination: url.searchParams.get('destination'),
    media_sha256: options.headers['X-Media-Sha256'], media_bytes: options.body.length });
}

test('one OIDC and canonical manifest cover exactly three files including a 90-second Facebook video', async t => {
  const input = await fixture(t);
  const requests = [];
  const identityRequests = [];
  const result = await deliverTipDestinations(input, env, {
    fetchToken: async (url, options) => {
      identityRequests.push({ url, options });
      return Response.json({ value: 'oidc.example.token' });
    },
    request: async (url, options) => { requests.push({ url, options }); return receipt(url, options); },
  });
  assert.deepEqual(result, { status: 'confirmed', confirmed: destinations });
  assert.equal(identityRequests.length, 1);
  assert.equal(requests.length, 3);
  const header = requests[0].options.headers['X-Tip-Destination-Manifest'];
  assert.match(header, /^[A-Za-z0-9_-]+$/);
  const manifest = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
  assert.deepEqual(manifest, {
    contract: 'tip-v11-destination-manifest-v1', master_sha256: masterSha256,
    workflow_sha: env.GITHUB_SHA, workflow_run_id: '123', workflow_run_attempt: '1',
    destinations: Object.fromEntries(input.receipt.videos.map(row => [row.destination, {
      media_sha256: row.mediaSha256, media_bytes: row.size, caption_geometry: row.captionGeometry,
    }])),
  });
  const binding = sha(JSON.stringify([jobId, attempt, sha(header)]));
  assert.equal(identityRequests[0].url.searchParams.get('audience'), 'urn:jammimmo:tip-v11:destination-manifest:' + binding);
  for (const [{ url, options }, destination] of requests.map((request, i) => [request, destinations[i]])) {
    assert.equal(url.href, uploadUrl + '&destination=' + destination);
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    assert.equal(options.headers['X-Job-Id'], jobId);
    assert.equal(options.headers['X-Kind'], 'tip');
    assert.equal(options.headers['Content-Type'], 'video/mp4');
    assert.equal(options.headers['Content-Length'], String(manifest.destinations[destination].media_bytes));
    assert.equal(options.headers['X-Tip-Destination-Manifest'], header);
    assert.equal(options.headers['X-Tip-Workflow-OIDC'], 'oidc.example.token');
    assert.equal(sha(options.body), manifest.destinations[destination].media_sha256);
  }
});

test('swapped, truncated and wrong-mask final members fail before even minting OIDC', async t => {
  const input = await fixture(t);
  const noIo = { fetchToken: () => assert.fail('minted OIDC'), request: () => assert.fail('contacted Worker') };
  const rejected = { status: 'rejected', confirmed: [] };
  await writeFile(join(input.directory, 'tiktok.mp4'), Buffer.from('synthetic destination media bytes: facebook'));
  await assert.deepEqual(await deliverTipDestinations(input, env, noIo), rejected);
  await writeFile(join(input.directory, 'tiktok.mp4'), Buffer.alloc(input.receipt.videos[2].size, 65));
  await assert.deepEqual(await deliverTipDestinations(input, env, noIo), rejected);
  await writeFile(join(input.directory, 'tiktok.mp4'), Buffer.from('truncated'));
  await assert.deepEqual(await deliverTipDestinations(input, env, noIo), rejected);
  await writeFile(join(input.directory, 'tiktok.mp4'), Buffer.from('synthetic destination media bytes: tiktok'));
  input.receipt.videos[2].captionGeometry.mask = tipV11CaptionMask('instagram').id;
  await assert.deepEqual(await deliverTipDestinations(input, env, noIo), rejected);
});

test('Facebook duration must be over 60 seconds and no longer than 90', async t => {
  const noIo = { fetchToken: () => assert.fail('minted OIDC'), request: () => assert.fail('contacted Worker') };
  for (const duration of [60, 90.01]) {
    const result = await deliverTipDestinations(await fixture(t, duration), env, noIo);
    assert.deepEqual(result, { status: 'rejected', confirmed: [] });
  }
});

test('the encoded and measured frame counts must agree across the complete batch before network calls', async t => {
  const input = await fixture(t, 61);
  const tiktok = input.receipt.videos[2];
  const individualProof = (await fixture(t, 61 + 1 / 30)).receipt.videos[2];
  const requests = [];
  const transport = {
    fetchToken: () => { requests.push('OIDC'); return Response.json({ value: 'oidc.example.token' }); },
    request: (url, options) => { requests.push('Worker'); return receipt(url, options); },
  };
  const rejected = { status: 'rejected', confirmed: [] };
  tiktok.videoFrames = individualProof.videoFrames;
  assert.deepEqual(await deliverTipDestinations(input, env, transport), rejected);
  // Both proofs now agree for TikTok alone. The final export still differs
  // from Facebook and Instagram by one frame inside the duration tolerance.
  tiktok.captionGeometry = individualProof.captionGeometry;
  tiktok.duration = individualProof.duration;
  assert.deepEqual(await deliverTipDestinations(input, env, transport), rejected);
  assert.deepEqual(requests, []);
});

test('invalid attempt URL, workflow run identity and identity token cannot send to the Worker', async t => {
  const input = await fixture(t);
  const noIo = { fetchToken: () => assert.fail('minted OIDC'), request: () => assert.fail('contacted Worker') };
  const rejected = { status: 'rejected', confirmed: [] };
  assert.deepEqual(await deliverTipDestinations(input, { ...env, TIP_UPLOAD_URL: uploadUrl + '&destination=tiktok' }, noIo), rejected);
  assert.deepEqual(await deliverTipDestinations(input, { ...env, GITHUB_RUN_ID: 123 }, noIo), rejected);
  assert.deepEqual(await deliverTipDestinations(input, env, {
    ...noIo, fetchToken: async () => Response.json({ value: 'not-a-token' }),
  }), rejected);
});

test('loss, transient status and a mismatched 200 receipt make exactly one readback without another upload', async t => {
  const input = await fixture(t, 61);
  for (const ambiguous of [
    () => { throw Error('lost response'); },
    () => new Response(null, { status: 503 }),
    () => Response.json({ ok: true, jobId, destination: 'instagram', media_sha256: 'e'.repeat(64), media_bytes: 7 }),
  ]) {
    const seen = [];
    const result = await deliverTipDestinations(input, env, {
      fetchToken: async () => Response.json({ value: 'oidc.example.token' }),
      request: async (url, options) => {
        seen.push([options.method, url.searchParams.get('destination')]);
        return seen.length === 1 ? receipt(url, options) : ambiguous();
      },
    });
    assert.deepEqual(seen, [['POST', 'facebook'], ['POST', 'instagram'], ['GET', 'instagram']]);
    assert.deepEqual(result, { status: 'temporarily_unavailable', confirmed: ['facebook'], destination: 'instagram' });
  }
});

test('only an exact readback after an ambiguous POST lets the workflow continue to the unsent sibling', async t => {
  const input = await fixture(t, 61);
  const seen = [];
  const result = await deliverTipDestinations(input, env, {
    fetchToken: async () => Response.json({ value: 'oidc.example.token' }),
    request: async (url, options) => {
      const destination = url.searchParams.get('destination');
      seen.push({ destination, options });
      if (destination !== 'instagram') return receipt(url, options);
      if (options.method === 'POST') throw Error('lost response after commit');
      assert.equal(options.body, undefined);
      assert.equal(options.headers['Content-Type'], undefined);
      assert.equal(options.headers['Content-Length'], undefined);
      const row = input.receipt.videos.find(video => video.destination === 'instagram');
      return Response.json({ ok: true, jobId, destination, media_sha256: row.mediaSha256, media_bytes: row.size });
    },
  });
  assert.deepEqual(result, { status: 'confirmed', confirmed: destinations });
  assert.deepEqual(seen.map(({ destination, options }) => [options.method, destination]),
    [['POST', 'facebook'], ['POST', 'instagram'], ['GET', 'instagram'], ['POST', 'tiktok']]);
  assert.equal(seen[1].options.headers['X-Tip-Destination-Manifest'], seen[2].options.headers['X-Tip-Destination-Manifest']);
  assert.equal(seen[1].options.headers['X-Tip-Workflow-OIDC'], seen[2].options.headers['X-Tip-Workflow-OIDC']);
});

test('native delivery confirms the master before variants and the exact private report only after all of them', async t => {
  const input = await fixture(t, 61);
  const master = Buffer.from('synthetic master media for sequence test');
  const sha256 = sha(master);
  const masterPath = join(input.directory, 'master.mp4');
  await writeFile(masterPath, master);
  const inventory = await collectTipV11StaticFiles(fileURLToPath(new URL('../', import.meta.url)));
  const manifest = await buildTipV11RenderManifest({ inventory,
    plan: { title: 'Dakar test', script: 'Fixture audio.', body: ['Fixture audio.'], segments: [],
      assistantEnabled: false, visualTopic: 'general' },
    sourceScriptSha256: 'a'.repeat(64), voiceSource: 'provider',
    raw: masterPath, normalized: masterPath, mix: masterPath, alignment: masterPath, props: masterPath, mp4: masterPath,
  });
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const report = Buffer.from(JSON.stringify({
    contract: 'tip-v11-fr-objective-media-evidence-v1', alignment_provenance: '0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf',
    media_shape: { passed: true }, audio_waveform: { passed: true }, sampled_frame_ocr: { passed: true },
    media_sha256: sha256, media_bytes: master.length, render_manifest_sha256: sha(manifestBytes),
    render_manifest_b64: manifestBytes.toString('base64'), alignment_sha256: manifest.alignment_sha256,
    narration_wav_sha256: manifest.narration_wav_sha256, mix_wav_sha256: manifest.mix_wav_sha256,
  }));
  const prepared = prepareTipDestinations({ ...input, masterSha256: sha256 }, env);
  for (const stop of ['invalid', 'master', 'instagram', 'report', 'no_preflight', 'manual_review', 'none']) {
    const phases = [];
    const result = await deliverTipDestinationAttempt({ master, sha: sha256, duration: 61,
      report: stop === 'invalid' ? Buffer.from('{}') : report, prepared }, env, {
      beforeMaster: async () => { phases.push('marked'); },
      fetchToken: async (url) => {
        const audience = url.searchParams.get('audience');
        phases.push(audience.includes(':destination-manifest:') ? 'variant-identity' : 'master-identity');
        return Response.json({ value: 'oidc.example.token' });
      },
      request: async (url, options) => {
        const destination = url.searchParams.get('destination');
        if (destination) {
          phases.push(`${options.method}:${destination}`);
          return stop === destination ? new Response(null, { status: 503 }) : receipt(url, options);
        }
        if (url.pathname.endsWith('/upload')) {
          phases.push('master');
          assert.deepEqual(options.body, master);
          assert.equal(JSON.parse(options.headers['X-Tip-Render-Evidence']).report_sha256, sha(report));
          return stop === 'master' ? new Response(null, { status: 409 })
            : Response.json({ ok: true, jobId, status: 'succeeded', attached: true });
        }
        phases.push('report');
        assert.equal(url.searchParams.get('action'), 'tip-v11-report');
        assert.deepEqual(options.body, report);
        if (stop === 'report') return new Response(null, { status: 422 });
        const headers = stop === 'no_preflight' ? undefined : {
          'X-Tip-Editorial-Preflight': stop === 'manual_review' ? 'manual_review' : 'recorded',
        };
        return new Response(null, { status: 204, headers });
      },
    });
    const started = ['master-identity', 'marked', 'master'];
    const variants = [...started, 'variant-identity', 'POST:facebook', 'POST:instagram'];
    const completed = [...variants, 'POST:tiktok', 'report'];
    assert.deepEqual({ result, phases }, {
      invalid: { result: 'invalid', phases: [] },
      master: { result: 'master_unconfirmed', phases: started },
      instagram: { result: 'destination_unconfirmed', phases: [...variants, 'GET:instagram'] },
      report: { result: 'report_unconfirmed', phases: completed },
      no_preflight: { result: 'report_unconfirmed', phases: completed },
      manual_review: { result: 'report_unconfirmed', phases: completed },
      none: { result: 'confirmed', phases: completed },
    }[stop]);
  }
});
