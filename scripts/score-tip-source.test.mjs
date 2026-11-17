import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildSourceScoringInput } from './score-tip-source.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/fresh-compteurs.spec.json', import.meta.url), 'utf8'));
const draft = {
  title: fixture.title.split('\n')[0],
  scriptFr: [
    'Vous préparez la visite pour examiner le logement et vérifier les informations annoncées.',
    'Comparez les pièces avec la description et notez les questions à poser sur place.',
    'Demandez les documents utiles pour comprendre la situation et la gestion du bien.',
    'Gardez une note de ce qui mérite confirmation lorsque les explications restent trop générales.',
    'Relisez vos observations avant de choisir une suite qui correspond à votre projet.',
  ].join('  '),
  scriptEn: '', caption: 'Conseils pour préparer la visite à Dakar.', hashtags: ['JammImmo', 'Sénégal'],
};

test('binds the raw script and canonical draft separately, without adding an assistant scene', () => {
  const result = buildSourceScoringInput(Object.fromEntries(Object.entries(draft).reverse()));
  assert.equal(result.draft_sha256, sha256(JSON.stringify(draft)));
  assert.equal(result.source_script_sha256, sha256(draft.scriptFr));
  assert.notEqual(result.source_script_sha256, sha256(draft.scriptFr.replaceAll('  ', ' ')));
  assert.deepEqual(result.segments.map(({ id }) => id), [
    'greeting', 'hook', 'step1', 'step2', 'step3', 'takeaway', 'services', 'tools',
    'domain', 'contact', 'phone', 'socials', 'signature',
  ]);
  assert.notEqual(buildSourceScoringInput({ ...draft, hashtags: ['Dakar'] }).draft_sha256, result.draft_sha256);
});

test('rejects malformed and ambiguous draft shapes', () => {
  for (const update of [{ source: 'other' }, { scriptEn: 'English' }, { scriptFr: 'Texte court.' },
    { scriptFr: `${draft.scriptFr} ` }, { caption: '' }, { hashtags: ['#Dakar'] }]) {
    assert.throws(() => buildSourceScoringInput({ ...draft, ...update }), /V11/);
  }
});
