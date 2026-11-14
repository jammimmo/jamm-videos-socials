import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fitTipV11Caption, GeneralScene } from '../src/compositions/TipV11Fr.tsx';

test('V11 shows the full advice heading, including the end of a long sentence', () => {
  const text = 'Mandatez un agent immobilier local de confiance pour visiter les biens et évaluer leur état.';
  const scene = renderToStaticMarkup(React.createElement(GeneralScene, {
    title: 'Acheter à distance en toute sécurité',
    segment: { id: 'step1', start: 0, end: 4, text },
    time: 2,
  }));
  assert.ok(scene.includes(text));
});

test('V11 keeps regular captions at full size and sizes wide words to their measured box', () => {
  const regular = [];
  assert.equal(fitTipV11Caption(size => { regular.push(size); return 144; }), true);
  assert.deepEqual(regular, [49]);
  const wide = [];
  assert.equal(fitTipV11Caption(size => { wide.push(size); return size > 45 ? 202 : 134; }), true);
  assert.deepEqual(wide, [49, 48, 47, 46, 45]);
  assert.equal(fitTipV11Caption(() => 160), false);
});
