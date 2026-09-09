import assert from 'node:assert/strict';
import test from 'node:test';
import { materializeDispatchedTip } from './materialize-dispatched-tip.mjs';

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

test('rejects an attacker-controlled delivery host', () => {
  const value = payload();
  value.delivery.uploadUrl = `https://attacker.example/api/tour/upload?attempt=${attempt}`;
  assert.throws(() => materializeDispatchedTip(value), /exact production callback URL/);
});

test('rejects malformed capabilities and brand drift', () => {
  const badToken = payload();
  badToken.delivery.callbackToken = 'secret';
  assert.throws(() => materializeDispatchedTip(badToken), /invalid callback capability/);
  const badBrand = payload();
  badBrand.content.scriptFr = badBrand.content.scriptFr.replace('Jamm Immo', 'Autre marque');
  assert.throws(() => materializeDispatchedTip(badBrand), /must be spoken/);
});
