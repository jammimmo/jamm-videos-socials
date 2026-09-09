import test from 'node:test';
import assert from 'node:assert/strict';
import { BRAND, OUTRO, freshTipContract } from './fresh-tip-contract.mjs';
import { readFile } from 'node:fs/promises';

test('only known boilerplate may be replaced, with bilingual evidence', () => {
  const fr=['a','b','c','La vérité avant la visite.','Contactez Jamm Immo pour préparer votre entrée dans le logement et poser vos questions.'];
  const en=['a','b','c','The truth before the visit.','Contact Jamm Immo to prepare for moving into your home and ask your questions.'];
  assert.equal(freshTipContract(fr,en),true);
  assert.equal(freshTipContract([...fr.slice(0,4),'Payez avant la visite.'],en),false);
  assert.equal(freshTipContract(fr,[...en.slice(0,3),'Keep your receipt.',en[4]]),false);
});
test('historical branding and local video phone have one spoken source', () => {
  assert.equal(BRAND.phone,'76 944 48 49');
  assert.equal(BRAND.slogan,'Kër gu baax, xel mu dal');
  assert.equal(BRAND.website,'jammimmo.com');
  assert.match(OUTRO[1].voiceoverFr,/soixante-seize, neuf cent quarante-quatre, quarante-huit, quarante-neuf/);
  assert.doesNotMatch(JSON.stringify(OUTRO),/221|deux cent vingt et un/);
  assert.equal(OUTRO[2].voiceoverFr,`Jamm Immo. ${BRAND.slogan}.`);
});
test('fresh composition has one natural-rate track, bounded drawing and end-only website',async()=>{
  const source=await readFile(new URL('../src/compositions/SpokenTip.tsx',import.meta.url),'utf8');
  assert.equal((source.match(/<Audio /g)||[]).length,1);
  assert.doesNotMatch(source,/playbackRate|endAt|CommercialWebsite|1350|915/);
  assert.match(source,/height:590,overflow:'hidden'/);
  assert.equal((source.match(/jammimmo\.com/g)||[]).length,1); // one end-card site label
  assert.match(source,/index===3 \? <EndCard\/>/);
  assert.doesNotMatch(source,/221|captionFr|background:'white'/);
  assert.match(source,/theme\.jamm/);
  assert.match(source,/Logo width=\{440\}/);
});

test('manual prototype is isolated from the all matrix and preserves exact narration',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/render-jamm-videos.yml',import.meta.url),'utf8');
  const spec=JSON.parse(await readFile(new URL('./fixtures/fresh-compteurs.spec.json',import.meta.url),'utf8'));
  assert.equal(spec.id,'fresh-compteurs-v3');
  assert.equal(spec.scenes[3].voiceoverFr,OUTRO.map(s=>s.voiceoverFr).join(' '));
  assert.equal(spec.scenes[3].voiceoverEn,OUTRO.map(s=>s.voiceoverEn).join(' '));
  assert.equal(spec.voiceoverScript,spec.scenes.map(s=>s.voiceoverFr).join(' '));
  assert.doesNotMatch(workflow.split('else')[0].split('echo ')[1],/fresh-compteurs/);
  assert.match(workflow,/always\(\) && matrix.video_id == 'fresh-compteurs'/);
  assert.doesNotMatch(workflow,/curl|TIP_UPLOAD_URL|callback|r2\.dev/);
});
