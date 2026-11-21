import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { materializeDispatchedTip as materialize, TIP_DESTINATION_MEDIA_CONTRACT } from './materialize-dispatched-tip.mjs';
import { renderTipV11, tipV11NarrationTempo } from './render-tip-v11.mjs';
import { tipV11Effects } from './tip-v11-effects.mjs';
import { readStagedPrivateReviewedNarration, stagePrivateReviewedNarration, stageReviewedNarration, REVIEWED_NARRATION_DISPATCH } from './tip-v11-reviewed-narration.mjs';
import { buildTipV11Narration, TIP_V11_SLOGAN } from './tip-v11-contract.mjs';
import { voiceCacheHash, voicePrompt } from './voice-profile.mjs';
const materializeDispatchedTip = value => materialize(value, { legacy: true });

const id = '11111111-1111-4111-8111-111111111111';
const attempt = '22222222-2222-4222-8222-222222222222';
const worker = 'https://jammimmo-estate-flow.jammimmo221admin.workers.dev';

test('V11 preserves borderline one-minute narration and the normal tempo for the reference master', () => {
  assert.equal(tipV11NarrationTempo(58.5), 1);
  assert.equal(tipV11NarrationTempo(60), 1);
  assert.equal(tipV11NarrationTempo(61), 1.03);
  assert.equal(tipV11NarrationTempo(71.015), 1.03);
  assert.throws(() => tipV11NarrationTempo(58.49), /cannot fit/);
  assert.throws(() => tipV11NarrationTempo(123), /cannot fit/);
  assert.equal(tipV11NarrationTempo(60, { exactTourV8: true }), 1.03);
  assert.equal(tipV11NarrationTempo(56, { exactTourV8: true }), 1.03);
  assert.throws(() => tipV11NarrationTempo(55.999, { exactTourV8: true }), /cannot fit/);
  assert.equal(tipV11NarrationTempo(58.4, { exactTourV8: true }), 1.03);
  assert.throws(() => tipV11NarrationTempo(58.4), /cannot fit/);
  assert.equal(tipV11NarrationTempo(61, { exactTourV8: true }), 1.03);
  assert.equal(tipV11NarrationTempo(71.84, { exactTourV8: true }), 1.03);
});

test('a cached automatic Ngor take reports the measured duration failure before rendering', async t => {
  const root = mkdtempSync(join(tmpdir(), 'tip-short-v8-'));
  const failurePath = join(root, 'render-error');
  const envName = 'TIP_V11_ALIGNMENT_FAILURE_CODE_FILE';
  const oldValue = process.env[envName];
  process.env[envName] = failurePath;
  t.after(() => {
    if (oldValue === undefined) delete process.env[envName];
    else process.env[envName] = oldValue;
    rmSync(root, { recursive: true, force: true });
  });
  const { spec } = materialize(v11Payload());
  const plan = buildTipV11Narration(spec);
  const audioDir = join(root, 'public', 'audio', 'voiceovers');
  mkdirSync(audioDir, { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=350:sample_rate=24000:duration=57',
    '-c:a', 'pcm_s16le', join(audioDir, `${plan.id}.wav`)]);
  writeFileSync(join(audioDir, `${plan.id}.sha256`), voiceCacheHash(plan.script, '', 'tip-v11-fr'));
  await assert.rejects(renderTipV11(spec, { root }), /normalized narration outside 58\.5–119 s.*tempo 1\.03×/);
  assert.equal(readFileSync(failurePath, 'utf8'), 'narration_duration_out_of_range\n');
  assert.ok(!existsSync(join(root, 'out', 'batch', `${plan.id}.mp4`)));

  const imported = join(root, 'imported.wav');
  const importFailurePath = join(root, 'import-error');
  process.env[envName] = importFailurePath;
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=350:sample_rate=24000:duration=1',
    '-c:a', 'pcm_s16le', imported]);
  await assert.rejects(renderTipV11(spec, { root, localNarration: imported }), /raw narration cannot fit/);
  assert.ok(!existsSync(importFailurePath));
});

function payload() {
  return {
    contract: 'jamm-tip-render-v1',
    job: {
      id,
      postId: '33333333-3333-4333-8333-333333333333',
      hookId: '44444444-4444-4444-8444-444444444444',
      family: 'advice',
      creativeTier: 'proven',
    },
    content: {
      title: 'Vérifier son dossier avant la visite',
      scriptFr: 'À Dakar, préparez chaque document avant votre visite. Vérifiez le nom, le prix et les conditions. Gardez les preuves lisibles et refusez toute pression. Comparez calmement les informations avant de payer. Jamm Immo vous accompagne avec une méthode claire et sûre.',
      scriptEn: 'In Dakar, prepare every document before your visit. Check the name, price and conditions. Keep readable evidence and reject pressure. Compare every detail calmly before paying. Jamm Immo guides you with a clear and safe method.',
      caption: 'La vérité avant la visite.',
      hashtags: ['#JammImmo', '#Dakar'],
      voice: 'Charon',
    },
    delivery: {
      callbackUrl: `${worker}/api/tour/callback?attempt=${attempt}`,
      uploadUrl: `${worker}/api/tour/upload?attempt=${attempt}`,
      callbackToken: 'a'.repeat(64),
    },
    evidence: {
      brandContract: 'jamm-immo-v1',
      campaignSignature: 'La vérité avant la visite.',
    },
  };
}

test('materialises an exact five-scene Jamm Immo tip', () => {
  const result = materializeDispatchedTip(payload());
  assert.equal(result.jobId, id);
  assert.equal(result.spec.scenes.length, 5);
  assert.equal(result.spec.voiceoverScript, payload().content.scriptFr);
  assert.equal(result.uploadUrl, `${worker}/api/tour/upload?attempt=${attempt}`);
  assert.match(JSON.stringify(result.spec), /Jamm Immo/i);
  assert.equal(result.spec.scenes.map((scene) => scene.voiceoverFr).join(' '), payload().content.scriptFr);
  assert.equal(result.spec.scenes[0].voiceoverFr, 'À Dakar, préparez chaque document avant votre visite.');
  assert.equal(result.spec.scenes[4].voiceoverEn, 'Jamm Immo guides you with a clear and safe method.');
});

test('rejects legacy word-sliced scripts and mismatched translation scene counts', () => {
  const value = payload();
  value.content.scriptFr = "Lors de la remise des clés, relevez les compteurs d'eau et d'électricité pour éviter les mauvaises surprises. La vérité avant la visite. Contactez Jamm Immo pour un accompagnement personnalisé.";
  assert.throws(() => materializeDispatchedTip(value), /five complete sentences/);
  const english = payload();
  english.content.scriptEn += ' One extra sentence.';
  assert.throws(() => materializeDispatchedTip(english), /five complete sentences/);
});

test('English narration and opening sentence remain complete, without ellipsis excerpts', () => {
  const value = payload();
  value.content.scriptEn = 'At key handover, carefully take readings from both the water and electricity meters. Record the readings and date, then keep a clear photograph of each meter. These records help you compare future bills and report any discrepancy. The truth before the visit. Contact Jamm Immo to prepare for moving into your home and ask your questions.';
  const { spec } = materializeDispatchedTip(value);
  assert.equal(spec.hook.titleEn, value.content.scriptEn.split('. ')[0] + '.');
  assert.equal(spec.scenes.map(s => s.voiceoverEn).join(' '), value.content.scriptEn);
  assert.ok(spec.scenes.every(s => !s.subtitleEn.includes('…')));
});

test('rejects an attacker-controlled delivery host', () => {
  const value = payload();
  value.delivery.uploadUrl = `https://attacker.example/api/tour/upload?attempt=${attempt}`;
  assert.throws(() => materializeDispatchedTip(value), /exact production callback URL/);
});

test('automatic illustrations add no unsupported deadlines, prices or identities', () => {
  for (const family of ['advice', 'tips', 'market_education']) {
    const value = payload(); value.job.family = family;
    assert.ok(materializeDispatchedTip(value).spec.scenes.every((s) => ['building', 'document-stack'].includes(s.visualType)));
  }
  const meters = payload(); meters.content.title = "Compteurs à l'entrée";
  const scenes = materializeDispatchedTip(meters).spec.scenes;
  assert.deepEqual(scenes.map(s => s.visualType), ['meter','meter','document-stack','building','building']);
  assert.equal(scenes[0].variant, 'water-illustration');
  assert.equal(scenes[1].variant, 'electric-illustration');
  assert.equal(scenes[2].variant, 'bills');
});

test('rejects malformed capabilities and brand drift', () => {
  const badToken = payload();
  badToken.delivery.callbackToken = 'secret';
  assert.throws(() => materializeDispatchedTip(badToken), /invalid callback capability/);
  const badBrand = payload();
  badBrand.content.scriptFr = badBrand.content.scriptFr.replace('Jamm Immo', 'Autre marque');
  assert.throws(() => materializeDispatchedTip(badBrand), /must be spoken/);
});

test('fresh dispatch preserves all three substantive sentences and records its original scripts', () => {
  const value=payload();
  const fr=value.content.scriptFr.split(/(?<=[.!?])\s+/u).slice(0,3);
  const en=value.content.scriptEn.split(/(?<=[.!?])\s+/u).slice(0,3);
  value.content.scriptFr=[...fr,'La vérité avant la visite.','Contactez Jamm Immo pour préparer votre entrée dans le logement et poser vos questions.'].join(' ');
  value.content.scriptEn=[...en,'The truth before the visit.','Contact Jamm Immo to prepare for moving into your home and ask your questions.'].join(' ');
  const {spec}=materialize(value);
  assert.equal(spec.template,'spoken-tip-v2');
  assert.equal(spec.scenes.length,4);
  assert.deepEqual(spec.scenes.slice(0,3).map(s=>s.voiceoverFr),fr);
  assert.deepEqual(spec.scenes.slice(0,3).map(s=>s.voiceoverEn),en);
  assert.equal(spec.sourceScripts.fr,value.content.scriptFr);
  assert.equal(spec.voiceoverScript,spec.scenes.map(s=>s.voiceoverFr).join(' '));
  assert.throws(()=>materialize(payload()),/needs re-scripting/);
});

function v11Payload() {
  const data = payload();
  data.contract = 'jamm-tip-render-v2';
  delete data.content.scriptEn;
  data.content.voice = 'Algenib';
  data.content.scriptFr = [
    'Un logement peut sembler impeccable alors que son arrivée d’eau mérite quelques vérifications simples.',
    'Ouvrez les robinets les uns après les autres pour écouter et observer le débit.',
    'Dans la douche, laissez couler un peu d’eau et vérifiez qu’elle s’évacue sans stagner.',
    'Au lavabo ou à l’évier, vérifiez que le trop-plein est dégagé si le modèle en possède un.',
    'Retenez ces trois observations pour les comparer au moment de choisir votre logement.',
  ].join(' ');
  data.content.title = 'Vérifier l’eau pendant une visite';
  data.evidence.brandContract = 'jamm-tips-v11-fr';
  data.evidence.campaignSignature = TIP_V11_SLOGAN;
  return data;
}

test('destination opt-in is materialized only from the supported private V11 evidence', t => {
  assert.equal(materialize(v11Payload()).spec.destinationMediaContract, undefined);
  assert.equal(materialize(v11Payload()).strictDelivery, undefined);
  const contract = { destinationMediaContract: TIP_DESTINATION_MEDIA_CONTRACT, mediaStorageMode: 'job_owned_v1' };
  for (const fields of [{ destinationMediaContract: TIP_DESTINATION_MEDIA_CONTRACT },
    { ...contract, destinationMediaContract: 'unexpected-contract' }, { ...contract, mediaStorageMode: 'shared' }]) {
    const candidate = v11Payload();
    Object.assign(candidate.evidence, fields);
    assert.throws(() => materialize(candidate), /private V11 destination delivery contract/);
  }
  const legacy = payload();
  Object.assign(legacy.evidence, contract);
  assert.throws(() => materializeDispatchedTip(legacy), /private V11 destination delivery contract/);
  const candidate = v11Payload();
  Object.assign(candidate.evidence, contract);
  assert.equal(materialize(candidate).spec.destinationMediaContract, TIP_DESTINATION_MEDIA_CONTRACT);
  const temporary = mkdtempSync(join(tmpdir(), 'tip-destination-dispatch-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const event = join(temporary, 'event.json');
  const spec = join(temporary, 'spec.json');
  const env = join(temporary, 'env');
  writeFileSync(event, JSON.stringify({ client_payload: candidate }));
  const cli = fileURLToPath(new URL('./materialize-dispatched-tip.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--event', event, '--spec', spec, '--env', env], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(spec, 'utf8')).destinationMediaContract, TIP_DESTINATION_MEDIA_CONTRACT);
  assert.match(readFileSync(env, 'utf8'), /^TIP_DESTINATION_MEDIA_CONTRACT=tip-v11-destination-manifest-v1$/m);
  assert.match(readFileSync(env, 'utf8'), /^TIP_REQUIRED_RENDER_ATTESTATION=1$/m);
});

test('V11 consumes exactly the French advice and adds the reviewed brand narration', () => {
  const input = v11Payload();
  const { spec, uploadUrl } = materialize(input);
  assert.equal(spec.template, 'tip-v11-fr');
  assert.equal(spec.body.join(' '), input.content.scriptFr);
  assert.equal(spec.sourceScriptSha256, createHash('sha256').update(input.content.scriptFr).digest('hex'));
  const padded = `  ${input.content.scriptFr} `;
  const paddedSpec = materialize({ ...input, content: { ...input.content, scriptFr: padded } }).spec;
  assert.deepEqual(paddedSpec.body, spec.body);
  assert.equal(paddedSpec.sourceScriptSha256, createHash('sha256').update(padded).digest('hex'));
  assert.equal(uploadUrl, input.delivery.uploadUrl);
  const disabled = buildTipV11Narration(spec);
  const enabled = buildTipV11Narration(spec, { assistantEnabled: true });
  assert.equal(enabled.visualTopic, 'water');
  assert.equal(buildTipV11Narration({ ...spec, title: 'Évier en visite' }).visualTopic, 'water');
  assert.match(enabled.script, /^Salam alikoum ! Nanga def \?/u);
  assert.match(enabled.script, /acheter, vendre, louer .*gestion locative/u);
  assert.match(enabled.script, /frais d’acquisition et la rentabilité locative/u);
  assert.match(enabled.script, /retrouver une annonce.*parler à un conseiller/u);
  assert.match(enabled.script, /jamm immo point com/u);
  assert.match(enabled.script, /nos réseaux sociaux/u);
  assert.ok(enabled.script.endsWith(TIP_V11_SLOGAN));
  assert.equal(enabled.segments.find(segment => segment.id === 'phone').caption, '+221 76 944 48 49');
  assert.equal(disabled.segments.some(segment => segment.id === 'assistant'), false);
  assert.notEqual(voiceCacheHash(enabled.script), voiceCacheHash(enabled.script, '', 'tip-v11-fr'));
  assert.equal(voicePrompt(enabled.script, '', 'tip-v11-fr').split('\n\n')[1], enabled.script);
  assert.equal(buildTipV11Narration({ ...spec, title: 'Lire un dossier locatif' }).visualTopic, 'general');
});

test('V11 fails closed on legacy voice, extra language, and incomplete advice', () => {
  const voice = v11Payload();
  voice.content.voice = 'Charon';
  assert.throws(() => materialize(voice), /unsupported voice/u);
  const language = v11Payload();
  language.content.scriptEn = 'English.';
  assert.throws(() => materialize(language), /French narration only/u);
  const short = v11Payload();
  short.content.scriptFr = short.content.scriptFr.replace(/Retenez.*$/u, '');
  assert.throws(() => materialize(short), /five complete sentences/u);
});

test('the GitHub event file is consumed without logging the editorial payload', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'tip-dispatch-event-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const eventPath = join(directory, 'event.json');
  const specPath = join(directory, 'spec.json');
  const envPath = join(directory, 'env');
  const input = v11Payload();
  writeFileSync(eventPath, JSON.stringify({ action: 'render-jamm-tip', client_payload: input }));
  const cli = fileURLToPath(new URL('./materialize-dispatched-tip.mjs', import.meta.url));
  const stdout = execFileSync(process.execPath, [cli, '--event', eventPath, '--spec', specPath, '--env', envPath], { encoding: 'utf8' });
  const withoutMaskDirectives = stdout.split('\n').filter(line => !line.startsWith('::add-mask::')).join('\n');
  assert.match(withoutMaskDirectives, /^Dispatched tip payload validated\s*$/u);
  assert.ok(stdout.includes(`::add-mask::${input.job.id}`));
  assert.equal(JSON.parse(readFileSync(specPath, 'utf8')).body.join(' '), input.content.scriptFr);
  assert.match(readFileSync(envPath, 'utf8'), new RegExp(`^TIP_JOB_ID=${input.job.id}$`, 'mu'));
});


test('reviewed V11 dispatch requires the exact renderer and cannot downgrade to provider mode', () => {
  const input = v11Payload();
  input.contract = REVIEWED_NARRATION_DISPATCH;
  const pin = { contract: 'tip-v11-reviewed-narration-v1', rendererSha: 'a'.repeat(40), sha256: 'b'.repeat(64) };
  input.evidence.reviewedNarration = pin;
  assert.deepEqual(materialize(input, { rendererSha: pin.rendererSha }).spec.reviewedNarration, pin);
  assert.throws(() => materialize(input, { rendererSha: 'c'.repeat(40) }), /narration contract/);
  assert.throws(() => materialize(input), /narration contract/);
  input.evidence.reviewedNarration = { ...pin, source: 'private-attempt' };
  assert.deepEqual(materialize(input, { rendererSha: pin.rendererSha }).spec.reviewedNarration, input.evidence.reviewedNarration);
  input.evidence.destinationMediaContract = TIP_DESTINATION_MEDIA_CONTRACT;
  input.evidence.mediaStorageMode = 'job_owned_v1';
  const optedIn = materialize(input, { rendererSha: pin.rendererSha }).spec;
  assert.equal(optedIn.destinationMediaContract, TIP_DESTINATION_MEDIA_CONTRACT);
  assert.deepEqual(optedIn.reviewedNarration, input.evidence.reviewedNarration);
  for (const source of [null, 'provider', 'checkout', true]) {
    input.evidence.reviewedNarration = { ...pin, source };
    assert.throws(() => materialize(input, { rendererSha: pin.rendererSha }), /narration contract/);
  }
  input.evidence.reviewedNarration = { ...pin, url: 'https://example.test/forged.wav' };
  assert.throws(() => materialize(input, { rendererSha: pin.rendererSha }), /narration contract/);
  input.contract = 'jamm-tip-render-v2';
  assert.throws(() => materialize(input), /narration contract/);
  delete input.evidence.reviewedNarration;
  assert.equal(materialize(input).spec.reviewedNarration, undefined);
});

function privateFixture(bytes, scratchRoot) {
  const payload = v11Payload();
  payload.contract = REVIEWED_NARRATION_DISPATCH;
  const rendererSha = 'a'.repeat(40);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const pin = { contract: 'tip-v11-reviewed-narration-v1', rendererSha, sha256, source: 'private-attempt' };
  payload.evidence.reviewedNarration = pin;
  return {
    delivery: materialize(payload, { rendererSha }), payload, pin,
    env: { GITHUB_SHA: rendererSha, RUNNER_TEMP: scratchRoot,
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://vstoken.actions.githubusercontent.com/oidc?api-version=2.0',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture-runner-credential' },
  };
}

test('materialization hands the private scratch path to the renderer and preserves terminal failure reporting', async () => {
  const root = mkdtempSync(join(tmpdir(), 'private-reviewed-handoff-'));
  try {
    const pcm = tipV11Effects([], 2);
    const { delivery, payload, pin, env } = privateFixture(pcm, root);
    const event = join(root, 'event.json');
    const stub = join(root, 'closed-transport.mjs');
    const cli = fileURLToPath(new URL('./materialize-dispatched-tip.mjs', import.meta.url));
    writeFileSync(event, JSON.stringify({ client_payload: payload }));
    writeFileSync(stub, `
      globalThis.fetch = async (url, options) => {
        if (url.origin === 'https://vstoken.actions.githubusercontent.com') return Response.json({ value: 'signed.fixture.token' });
        if (url.href !== ${JSON.stringify(`${worker}/api/tour/callback?attempt=${attempt}&action=tip-v11-narration`)}
          || options.headers['X-Tip-Workflow-OIDC'] !== 'signed.fixture.token'
          || options.headers['X-Tip-Narration-Sha256'] !== ${JSON.stringify(pin.sha256)}) throw new Error('unexpected fixture transport');
        if (process.env.TEST_PRIVATE_NARRATION_DENIED === '1') return new Response(null, { status: 403 });
        const wav = Buffer.from(${JSON.stringify(pcm.toString('base64'))}, 'base64');
        return new Response(wav, { headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(wav.length) } });
      };
    `);
    const invoke = (stem, denied) => {
      const spec = join(root, `${stem}.json`);
      const ghEnv = join(root, `${stem}.env`);
      const execution = spawnSync(process.execPath, ['--import', stub, cli, '--event', event, '--spec', spec, '--env', ghEnv], {
        encoding: 'utf8', env: { ...process.env, ...env, TEST_PRIVATE_NARRATION_DENIED: denied ? '1' : '0' },
      });
      assert.ifError(execution.error);
      assert.doesNotMatch(execution.stdout + execution.stderr, /signed\.fixture\.token|fixture-runner-credential/);
      return { execution, spec, assignments: Object.fromEntries(readFileSync(ghEnv, 'utf8').trim().split('\n')
        .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])) };
    };
    const ok = invoke('success', false);
    assert.equal(ok.execution.status, 0, ok.execution.stderr);
    assert.equal(ok.assignments.TIP_REQUIRED_RENDER_ATTESTATION, '1');
    assert.deepEqual(JSON.parse(readFileSync(ok.spec, 'utf8')).reviewedNarration, pin);
    assert.deepEqual(await readStagedPrivateReviewedNarration(pin, { ...env, ...ok.assignments }),
      { path: ok.assignments.TIP_PRIVATE_NARRATION_FILE, source: 'reviewed-bundle' });
    const refused = invoke('refused', true);
    assert.equal(refused.execution.status, 1);
    assert.match(refused.execution.stderr, /private narration response is invalid/);
    assert.equal(refused.assignments.TIP_UPLOAD_URL, delivery.uploadUrl);
    assert.equal(refused.assignments.TIP_PRIVATE_NARRATION_FILE, undefined);
    assert.equal(existsSync(refused.spec), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('private reviewed narration binds both credentials to the pinned attempt and revalidates scratch bytes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'private-reviewed-narration-'));
  try {
    const pcm = tipV11Effects([], 2);
    const { delivery, pin, env } = privateFixture(pcm, root);
    const calls = [];
    const staged = await stagePrivateReviewedNarration(delivery, pin, env, async (url, options) => {
      calls.push(url.origin);
      if (url.hostname === 'vstoken.actions.githubusercontent.com') {
        const digest = createHash('sha256').update(JSON.stringify([id, attempt, pin.sha256])).digest('hex');
        assert.equal(url.searchParams.get('audience'), `urn:jammimmo:tip-v11:narration:${digest}`);
        assert.equal(options.headers.Authorization, 'Bearer fixture-runner-credential');
        assert.equal(options.redirect, 'error');
        return Response.json({ value: 'signed.fixture.token' });
      }
      assert.equal(url.href, `${worker}/api/tour/callback?attempt=${attempt}&action=tip-v11-narration`);
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'manual');
      assert.deepEqual(options.headers, {
        Accept: 'audio/wav', 'Accept-Encoding': 'identity', Authorization: `Bearer ${delivery.callbackToken}`,
        'X-Job-Id': id, 'X-Tip-Narration-Sha256': pin.sha256, 'X-Tip-Workflow-OIDC': 'signed.fixture.token',
      });
      const stream = new ReadableStream({ start(controller) {
        controller.enqueue(pcm.subarray(0, 60));
        controller.enqueue(pcm.subarray(60));
        controller.close();
      } });
      return new Response(stream, { headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(pcm.length) } });
    });
    assert.deepEqual(calls, ['https://vstoken.actions.githubusercontent.com', worker]);
    assert.ok(staged.includes('/jamm-tip-v11-narration-'));
    assert.equal(statSync(staged).mode & 0o777, 0o600);
    assert.deepEqual(readFileSync(staged), pcm);
    assert.deepEqual(await readStagedPrivateReviewedNarration(pin, { ...env, TIP_PRIVATE_NARRATION_FILE: staged }),
      { path: staged, source: 'reviewed-bundle' });
    await assert.rejects(stageReviewedNarration(root, join(root, 'fallback.wav'), pin, env.GITHUB_SHA), /identity mismatch/);
    await assert.rejects(readStagedPrivateReviewedNarration(pin, env), /scratch identity/);
    const tampered = Buffer.from(pcm);
    tampered[tampered.length - 1] ^= 1;
    writeFileSync(staged, tampered);
    await assert.rejects(readStagedPrivateReviewedNarration(pin, { ...env, TIP_PRIVATE_NARRATION_FILE: staged }), /bytes or PCM/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('private reviewed narration refuses redirect, wrong integrity, oversized and incomplete streams before staging', async () => {
  const root = mkdtempSync(join(tmpdir(), 'private-reviewed-narration-'));
  try {
    const pcm = tipV11Effects([], 2);
    const corrupt = Buffer.from(pcm);
    corrupt[corrupt.length - 1] ^= 1;
    const invalidPcm = Buffer.from(pcm);
    invalidPcm.writeUInt32LE(48000, 24);
    const responses = [
      [pcm, () => Response.redirect('https://off-origin.invalid/wav'), /response is invalid/],
      [pcm, () => new Response(pcm, { headers: { 'Content-Type': 'audio/wav' } }), /response is invalid/],
      [pcm, () => new Response(pcm, { headers: { 'Content-Type': 'audio/wav', 'Content-Length': '8388609' } }), /response is invalid/],
      [pcm, () => new Response(pcm, { headers: { 'Content-Type': 'text/html', 'Content-Length': String(pcm.length) } }), /response is invalid/],
      [pcm, () => new Response(pcm, { headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(pcm.length), 'Content-Encoding': 'gzip' } }), /response is invalid/],
      [pcm, () => new Response(pcm.subarray(0, -1), { headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(pcm.length) } }), /size mismatch/],
      [pcm, () => new Response(pcm, { headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(pcm.length - 1) } }), /size mismatch/],
      [pcm, () => new Response(corrupt, { headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(pcm.length) } }), /bytes or PCM/],
      [invalidPcm, () => new Response(invalidPcm, { headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(pcm.length) } }), /bytes or PCM/],
    ];
    for (const [pinned, response, expected] of responses) {
      const { delivery, pin, env } = privateFixture(pinned, root);
      const calls = [];
      await assert.rejects(stagePrivateReviewedNarration(delivery, pin, env, async url => {
        calls.push(url.origin);
        return calls.length === 1 ? Response.json({ value: 'signed.fixture.token' }) : response();
      }), expected);
      assert.deepEqual(calls, ['https://vstoken.actions.githubusercontent.com', worker]);
      assert.deepEqual(readdirSync(root), []);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('private reviewed narration sends neither credential when the callback or OIDC authority is invalid', async () => {
  const root = mkdtempSync(join(tmpdir(), 'private-reviewed-narration-'));
  try {
    const { delivery, pin, env } = privateFixture(tipV11Effects([], 2), root);
    let calls = 0;
    const noFetch = async () => { calls++; throw new Error('an invalid authority reached network transport'); };
    await assert.rejects(stagePrivateReviewedNarration({ ...delivery, callbackUrl: 'https://off-origin.invalid/api/tour/callback' }, pin, env, noFetch), /delivery identity/);
    await assert.rejects(stagePrivateReviewedNarration({ ...delivery, callbackUrl: delivery.callbackUrl + '&extra=1' }, pin, env, noFetch), /delivery identity/);
    await assert.rejects(stagePrivateReviewedNarration(delivery, pin, { ...env,
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://vstoken.actions.githubusercontent.com.off-origin.invalid/oidc' }, noFetch),
    /unavailable/);
    assert.equal(calls, 0);
    assert.deepEqual(readdirSync(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reviewed narration consumes the pinned, checkout-local PCM bytes and rejects all substitutes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'approved-tip-sha-'));
  try {
    const directory = join(root, 'approved-narrations/v11/sha256');
    mkdirSync(directory, { recursive: true });
    const pcm = tipV11Effects([], 2);
    const sha256 = createHash('sha256').update(pcm).digest('hex');
    const rendererSha = 'a'.repeat(40);
    const pin = { contract: 'tip-v11-reviewed-narration-v1', rendererSha, sha256 };
    const output = join(root, 'per-job.wav');
    const source = join(directory, `${sha256}.wav`);
    await assert.rejects(stageReviewedNarration(root, output, pin, rendererSha), /file unavailable/);
    writeFileSync(source, pcm);
    assert.deepEqual(await stageReviewedNarration(root, output, pin, rendererSha), { path: output, source: 'reviewed-bundle' });
    assert.deepEqual(readFileSync(output), pcm);
    writeFileSync(source, Buffer.concat([pcm, Buffer.from('mutated')]));
    await assert.rejects(stageReviewedNarration(root, output, pin, rendererSha), /bytes or PCM format mismatch/);
    const invalid = Buffer.from(pcm);
    invalid.writeUInt32LE(48000, 24);
    const invalidSha = createHash('sha256').update(invalid).digest('hex');
    writeFileSync(join(directory, `${invalidSha}.wav`), invalid);
    await assert.rejects(stageReviewedNarration(root, output, { ...pin, sha256: invalidSha }, rendererSha), /PCM format/);
    rmSync(source);
    symlinkSync(output, source);
    await assert.rejects(stageReviewedNarration(root, output, pin, rendererSha), /file unavailable/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
