import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { materializeDispatchedTip as materialize } from './materialize-dispatched-tip.mjs';
import { buildTipV11Narration, TIP_V11_SLOGAN } from './tip-v11-contract.mjs';
import { voiceCacheHash, voicePrompt } from './voice-profile.mjs';
const materializeDispatchedTip = value => materialize(value, { legacy: true });

const id = '11111111-1111-4111-8111-111111111111';
const attempt = '22222222-2222-4222-8222-222222222222';
const worker = 'https://jammimmo-estate-flow.jammimmo221admin.workers.dev';

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

test('V11 consumes exactly the French advice and adds the reviewed brand narration', () => {
  const input = v11Payload();
  const { spec, uploadUrl } = materialize(input);
  assert.equal(spec.template, 'tip-v11-fr');
  assert.equal(spec.body.join(' '), input.content.scriptFr);
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
  assert.match(voicePrompt(enabled.script, '', 'tip-v11-fr'), /soft brief R sounds/u);
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
