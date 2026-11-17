import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureBrowser } from '@remotion/renderer';
import { assertTipSourceRuntime, expectedTipRuntime } from './tip-runtime.mjs';

const [fixtureLog, output, sourceSha, ffmpeg, ffprobe] = process.argv.slice(2);
const root = process.cwd();
const digest = async path => {
  const sha = createHash('sha256');
  for await (const chunk of createReadStream(path)) sha.update(chunk);
  return sha.digest('hex');
};
const version = (command, option = '--version') => {
  const value = execFileSync(command, [option], { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0];
  if (!value || value.length > 256) throw new Error('Missing tool version');
  return value;
};

const fixtureLine = (await readFile(fixtureLog, 'utf8')).trim().split('\n').at(-1);
const fixture = JSON.parse(fixtureLine);
const sha256 = /^[a-f0-9]{64}$/u;
if (fixture.status !== 'passed' || fixture.scope !== 'non-publishable-offline-remotion-smoke' || fixture.retainedArtifact !== false
  || ![fixture.decodedVideoSha256, fixture.decodedAudioSha256].every(value => typeof value === 'string' && sha256.test(value))) {
  throw new Error('Expected a completed synthetic renderer fixture');
}
const browser = await ensureBrowser({
  onBrowserDownload() { throw new Error('The locked Remotion Chromium was not prepared'); },
});
if (browser.type !== 'local-puppeteer-browser') throw new Error('Expected Remotion’s bundled Chromium');

const receipt = {
  schema: 'jamm-tip-runner-parity-v3',
  sourceSha,
  lockSha256: await digest(join(root, 'package-lock.json')),
  toolchain: {
    node: process.version,
    npm: version('npm'),
    python: version('python'),
    ffmpeg: version(ffmpeg, '-version'),
    ffprobe: version(ffprobe, '-version'),
    chromium: version(browser.path),
    remotion: JSON.parse(await readFile(join(root, 'node_modules/remotion/package.json'), 'utf8')).version,
    ffmpegSha256: await digest(ffmpeg),
    ffprobeSha256: await digest(ffprobe),
    chromiumSha256: await digest(browser.path),
    speechRuntimeSha256: (await assertTipSourceRuntime((await expectedTipRuntime()).sha256)).sha256,
  },
  fixture,
};
await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
