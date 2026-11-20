import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deliverTipDestinations } from './deliver-tip-destinations.mjs';
import { tipV11CaptionMask } from '../src/compositions/tip-v11-caption-geometry.ts';

const jobId = '00000000-0000-4000-8000-000000000011';
const attempt = '00000000-0000-4000-8000-000000000022';
const token = 'a'.repeat(64);
const uploadUrl = 'https://jammimmo-estate-flow.jammimmo221admin.workers.dev/api/tour/upload?attempt=' + attempt;
const env = {
  TIP_JOB_ID: jobId, TIP_UPLOAD_URL: uploadUrl, TIP_CALLBACK_TOKEN: token,
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
    videos.push({ destination, duration, size: body.length, mediaSha256: sha(body),
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

test('loss, transient status and a mismatched 200 receipt stop after one request to the uncertain destination', async t => {
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
        seen.push(url.searchParams.get('destination'));
        return seen.length === 1 ? receipt(url, options) : ambiguous();
      },
    });
    assert.deepEqual(seen, ['facebook', 'instagram']);
    assert.deepEqual(result, { status: 'temporarily_unavailable', confirmed: ['facebook'], destination: 'instagram' });
  }
});
