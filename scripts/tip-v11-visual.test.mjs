import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GeneralScene } from '../src/compositions/TipV11Fr.tsx';

test('V11 shows the full advice heading, including the end of a long sentence', () => {
  const text = 'Mandatez un agent immobilier local de confiance pour visiter les biens et évaluer leur état.';
  const scene = renderToStaticMarkup(React.createElement(GeneralScene, {
    title: 'Acheter à distance en toute sécurité',
    segment: { id: 'step1', start: 0, end: 4, text },
    time: 2,
  }));
  assert.ok(scene.includes(text));
});
