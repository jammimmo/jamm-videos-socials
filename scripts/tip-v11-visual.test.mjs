import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fitTipV11Caption, GeneralScene } from '../src/compositions/TipV11Fr.tsx';
import { CAPTION_GEOMETRY_MASK, captionSampleFrames, pixelBounds } from '../src/compositions/tip-v11-caption-geometry.ts';
import { summarizeCaptionGeometry } from './tip-v11-caption-geometry.mjs';

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

const geometryRun = '44444444-4444-4444-8444-444444444444';
const geometryProps = {
  captionGeometryRunId: geometryRun,
  durationInFrames: 12,
  captions: [{ start: 0, end: .2, text: 'Premier exemple.' }, { start: .2, end: .4, text: 'Autre exemple.' }],
};

async function withCaptionArtifacts(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'tip-v11-caption-geometry-test-'));
  try {
    const write = (frame, cue, overrides = {}) => writeFile(join(directory, `frame-${frame}.json`), JSON.stringify({
      frame, cue, run: geometryRun, mask: CAPTION_GEOMETRY_MASK, card: [135, 1391, 850, 1508],
      text: [149, 1397, 826, 1500], ...overrides,
    }));
    await Promise.all([write(0, 0), write(2, 0), write(5, 0), write(6, 1), write(8, 1), write(11, 1)]);
    return await callback(directory, write);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('caption geometry coverage follows actual half-open cue timing and rounds bounds outwards', () => {
  assert.deepEqual(captionSampleFrames(geometryProps.captions[0], 12), [0, 2, 5]);
  assert.deepEqual(captionSampleFrames(geometryProps.captions[1], 12), [6, 8, 11]);
  // Fixed frame/rate serialization can multiply back slightly above an integer.
  // An exact cue boundary still belongs only to the next caption.
  for (let frame = 3; frame < 3600; frame++) {
    const cue = { start: (frame - 2) / 30, end: frame / 30, text: 'A' };
    assert.deepEqual(captionSampleFrames(cue, 3600), [frame - 2, frame - 1]);
  }
  // A short cue can occupy one frame or none.
  assert.deepEqual(captionSampleFrames({ start: .032, end: .039, text: 'A' }, 12), [1]);
  assert.deepEqual(captionSampleFrames({ start: .034, end: .048, text: 'A' }, 12), []);
  assert.deepEqual(pixelBounds({ left: 68.6, top: 704.75, right: 300.14, bottom: 758.99 },
    { left: .5, top: 9, width: 540, height: 960 }), [136, 1391, 600, 1500]);
  assert.equal(pixelBounds({ left: 1, top: 1, right: 2, bottom: 2 }, { left: 0, top: 0, width: 0, height: 0 }), null);
});

test('caption geometry requires every cue sample from the exact render run and mask', async () => {
  await withCaptionArtifacts(async (directory, write) => {
    const result = await summarizeCaptionGeometry(geometryProps, directory);
    assert.equal(result.status, 'matched');
    assert.equal(result.scope, 'caption_card_and_text_bounds');
    assert.equal(result.duration_frames, 12);
    assert.equal((await summarizeCaptionGeometry({ ...geometryProps, durationInFrames: 13 }, directory)).status, 'inconclusive');
    assert.equal(result.mask, CAPTION_GEOMETRY_MASK);
    assert.deepEqual(result.cues.map(cue => cue.sample_frames), [[0, 2, 5], [6, 8, 11]]);
    assert.ok(!JSON.stringify(result).includes(geometryProps.captions[0].text));
    await write(8, 1, { run: '55555555-5555-4555-8555-555555555555' });
    assert.equal((await summarizeCaptionGeometry(geometryProps, directory)).status, 'inconclusive');
    await write(8, 1, { mask: 'another-mask' });
    assert.equal((await summarizeCaptionGeometry(geometryProps, directory)).status, 'inconclusive');
    await write(8, 0);
    assert.equal((await summarizeCaptionGeometry(geometryProps, directory)).status, 'inconclusive');
    await rm(join(directory, 'frame-8.json'));
    assert.equal((await summarizeCaptionGeometry(geometryProps, directory)).status, 'inconclusive');
  });
});

test('caption geometry checks each card and text region before aggregating bounds', async () => {
  await withCaptionArtifacts(async (directory, write) => {
    await write(5, 0, { card: [135, 1391, 850, 1514] });
    const outsideMask = await summarizeCaptionGeometry(geometryProps, directory);
    assert.equal(outsideMask.status, 'inconclusive');
    assert.deepEqual(outsideMask.cues[0].card_bounds, [135, 1391, 850, 1514]);
    await write(5, 0, { card: [150, 1391, 850, 1508], text: [148, 1397, 826, 1500] });
    const overflow = await summarizeCaptionGeometry(geometryProps, directory);
    assert.equal(overflow.cues[0].status, 'inconclusive');
    assert.equal(overflow.cues[1].status, 'matched');
    assert.deepEqual(overflow.cues[0].card_bounds, [135, 1391, 850, 1508]);
    assert.equal((await summarizeCaptionGeometry({ ...geometryProps, captions: [
      ...geometryProps.captions, { start: .25, end: .3, text: 'Overlapping cue' },
    ] }, directory)).status, 'inconclusive');
  });
});
