import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertTipSourceRuntime, canonicalTipRuntime, expectedTipRuntime, readTipRuntimeLock, verifyTipRuntimeMeasurement } from './tip-runtime.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const fixture = lock => ({ ...lock, platform: 'linux', architecture: 'x64', pythonIsolated: true,
  asrRepository: lock.asr.repository, asrRevision: lock.asr.revision, asrFilesPresent: true, asrNativeReady: true });

test('the full wheel lock is hash-bound, exact and includes every measured package', async () => {
  const lock = await readTipRuntimeLock();
  const rows = (await readFile(new URL('./tip-runtime-linux-py311.txt', import.meta.url), 'utf8'))
    .split('\n').filter(row => row && !row.startsWith('#'));
  const packages = {};
  for (const row of rows) {
    const match = row.match(/^([a-z0-9-]+)==([0-9][a-z0-9.]*) --hash=sha256:([a-f0-9]{64})$/);
    assert.ok(match, `An unhashed or non-exact dependency was added: ${row}`);
    assert.equal(packages[match[1]], undefined); packages[match[1]] = match[2];
  }
  assert.deepEqual(packages, lock.pythonPackages); assert.equal(rows.length, 24);
  assert.equal(lock.pythonPackages['faster-whisper'], '1.2.1');
  assert.equal(lock.pythonPackages.ctranslate2, '4.8.1'); assert.equal(lock.pythonPackages.av, '18.1.0');
});

test('a measured runtime reproduces the declared digest without copying the caller digest', async () => {
  const lock = await readTipRuntimeLock(); const measured = fixture(lock);
  const expected = await expectedTipRuntime();
  const result = verifyTipRuntimeMeasurement(lock, measured, expected.sha256);
  assert.equal(result.sha256, hash(JSON.stringify(canonicalTipRuntime(lock, measured))));
  assert.equal(result.runtime.pythonPackages.numpy, '2.4.6');
  assert.throws(() => verifyTipRuntimeMeasurement(lock, measured, 'f'.repeat(64)));
});

test('wrong host, interpreter, dependencies, encoder or ASR cache fail closed', async () => {
  const lock = await readTipRuntimeLock(); const expected = await expectedTipRuntime();
  for (const change of [
    { platform: 'darwin' }, { architecture: 'arm64' }, { node: 'v22.21.0' }, { npm: '11.0.0' },
    { python: '3.11.8' }, { pythonIsolated: false }, { ffmpegSha256: 'a'.repeat(64) },
    { ffprobeSha256: 'b'.repeat(64) }, { asrRevision: 'c'.repeat(40) }, { asrFilesPresent: false },
    { asrNativeReady: false },
    { pythonPackages: { ...lock.pythonPackages, av: '18.0.0' } },
    { pythonPackages: { ...lock.pythonPackages, injected: '1.0.0' } },
  ]) assert.throws(() => verifyTipRuntimeMeasurement(lock, { ...fixture(lock), ...change }, expected.sha256));
  for (const invalid of [null, '', 'A'.repeat(64), 'a'.repeat(63)]) {
    assert.throws(() => verifyTipRuntimeMeasurement(lock, fixture(lock), invalid));
  }
});

test('a probe cannot authorize a runtime from an environment receipt or arbitrary expected hash', async () => {
  // No subprocess or provider is needed: unsupported host or absent explicit
  // interpreter is refused before inspecting any caller-supplied JSON file.
  await assert.rejects(assertTipSourceRuntime('a'.repeat(64), { TIP_RUNTIME_RECEIPT: '/tmp/forged.json' }));
});

test('runtime serialization excludes paths, credentials and observations unrelated to identity', async () => {
  const lock = await readTipRuntimeLock(); const measured = { ...fixture(lock),
    checkedAt: '2030-01-01', token: 'secret', pythonPath: '/private/operator/python' };
  const serialized = JSON.stringify(canonicalTipRuntime(lock, measured));
  for (const privateValue of ['secret', '2030-01-01', '/private/operator']) assert.ok(!serialized.includes(privateValue));
});
