import assert from 'node:assert/strict';
import test from 'node:test';
import { admitTipCaptureRenderer } from './admit-tip-capture-renderer.mjs';

test('the real installed CJS renderer reaches the exact hook before any browser or bundle exists', async () => {
  const first = await admitTipCaptureRenderer();
  assert.equal(first.admission.kind, 'commonjs');
  assert.equal(first.admission.stubDispatch.screenshotHookCalls, 1);
  assert.equal(first.admission.stubDispatch.evaluationStubCalls, 1);
  assert.equal(first.admission.stubDispatch.returnedExactBuffer, true);
  assert.equal(first.admission.dependencyChain.at(-1).name, 'screenshot-task.js');
  // A second admission exercises restoration of both temporary in-memory stubs.
  const second = await admitTipCaptureRenderer();
  assert.equal(first.renderer, second.renderer);
  assert.equal(first.screenshotModule.screenshotTask, second.screenshotModule.screenshotTask);
  assert.deepEqual(first.admission, second.admission);
});
