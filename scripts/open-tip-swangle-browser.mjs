import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Diagnostic-only launch instrumentation. The CJS vendor launch path is unchanged;
// inspect native spawnargs, then immediately restore the stdlib method in finally.
export async function openTipSwangleBrowser({ openBrowser, rendererDir, browserExecutable }) {
  assert.equal(openBrowser, require(join(rendererDir, 'open-browser.js')).openBrowser);
  const chain = ['open-browser.js', 'browser/Launcher.js', 'browser/Browser.js', 'browser/BrowserRunner.js'];
  for (let i = 0; i < chain.length - 1; i++) {
    const parent = require.cache[require.resolve(join(rendererDir, chain[i]))];
    const child = require.cache[require.resolve(join(rendererDir, chain[i + 1]))];
    assert.ok(parent && child && parent.children.includes(child), `CJS browser launch path disconnected: ${chain[i]}`);
  }
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  const launches = [];
  let browser;
  childProcess.spawn = function(executable, args, options) {
    const proc = originalSpawn.call(this, executable, args, options);
    try {
    if (executable === browserExecutable || args?.includes(browserExecutable)) {
      // spawnargs comes from the actual spawned ChildProcess, including setpriv
      // wrapping when the vendor uses it. Do not serialize environment/profile paths.
      const effective = proc.spawnargs;
      const glFlags = effective.filter((arg) => arg.startsWith('--use-gl='));
      const angleFlags = effective.filter((arg) => arg.startsWith('--use-angle='));
      assert.deepEqual(glFlags, ['--use-gl=angle']);
      assert.deepEqual(angleFlags, ['--use-angle=swiftshader']);
      assert.ok(!effective.includes('--disable-gpu'), 'A conflicting disabled-GPU flag bypasses the intended backend');
      launches.push({ executable: proc.spawnfile, browserExecutable,
        glFlags, angleFlags, conflictingDisableGpu: effective.includes('--disable-gpu') });
    }
    } catch (error) {
      proc.kill('SIGKILL');
      throw error;
    }
    return proc;
  };
  try {
    browser = await openBrowser('chrome', { browserExecutable,
      chromiumOptions: { gl: 'swangle' }, forceDeviceScaleFactor: 1,
      chromeMode: 'headless-shell', logLevel: 'error' });
    assert.equal(launches.length, 1, 'Exactly one vendor browser spawn must prove effective flags');
    return { browser, launchProof: { requestedGl: 'swangle', launches,
      cjsLaunchCode: chain.map((name) => ({ name, sha256: hash(readFileSync(join(rendererDir, name))) })) } };
  } catch (error) {
    if (browser) await browser.close({ silent: true });
    throw error;
  } finally {
    childProcess.spawn = originalSpawn;
  }
}
