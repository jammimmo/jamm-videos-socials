import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// Execute the admitted smoke fixture and render preparation from the exact
// checkout. Change only their exits so no render or video encoder is started.
export async function prepareSmokeInput(repository, scratch) {
  const smoke = join(repository, 'scripts/offline-tip-v11-smoke.mjs');
  const renderer = join(repository, 'scripts/render-tip-v11.mjs');
  const sources = [smoke, renderer].map(name => ({ name, bytes: readFileSync(name) }));
  const sourceHashes = Object.fromEntries(sources.map(({ name, bytes }) =>
    [name.split('/').at(-1), sha256(bytes)]));
  const smokeText = sources[0].bytes.toString('utf8');
  const rendererText = sources[1].bytes.toString('utf8');
  const smokeExit = 'main().catch(error => {\n  console.error(error);\n  process.exitCode = 1;\n});\n';
  const rendererCut = '  await writeFile(propsPath, JSON.stringify(props), { mode: 0o600 });\n';
  assert.ok(smokeText.endsWith(smokeExit));
  assert.equal(rendererText.split(rendererCut).length, 2);
  const overlay = join(scratch, 'source-overlay');
  await mkdir(join(overlay, 'public'), { recursive: true, mode: 0o700 });
  const sourceFiles = ['src', 'scripts', 'public/tip-v11', 'package.json', 'package-lock.json',
    'remotion.config.ts', 'remotion.tip-v11.config.ts', 'tsconfig.json'];
  await Promise.all([
    ...sourceFiles.map(name => cp(join(repository, name), join(overlay, name), {
      recursive: true, filter: path => !path.includes('__pycache__'),
    })),
    symlink(join(repository, 'node_modules'), join(overlay, 'node_modules'), 'dir'),
  ]);
  const overlaySmoke = join(overlay, 'scripts/offline-tip-v11-smoke.mjs');
  const overlayRenderer = join(overlay, 'scripts/render-tip-v11.mjs');
  await Promise.all([
    writeFile(overlaySmoke, smokeText.slice(0, -smokeExit.length) + `export {
  assertIsolatedProcess, fixture, deterministicTone, deterministicTranscript, prepareScratchRoot,
};\n`),
    writeFile(overlayRenderer, rendererText.slice(0, rendererText.indexOf(rendererCut) + rendererCut.length) +
      '  return { props, alignPath, normalizedPath, mixedPath: resolve(root, "public", mixed) };\n}\n'),
  ]);
  const smokeFixture = await import(pathToFileURL(overlaySmoke).href);
  const { renderTipV11 } = await import(pathToFileURL(overlayRenderer).href);
  const { assertIsolatedProcess, fixture, deterministicTone, deterministicTranscript, prepareScratchRoot } = smokeFixture;
  assertIsolatedProcess();
  const { buildTipV11Narration } = await import(pathToFileURL(join(repository, 'scripts/tip-v11-contract.mjs')).href);
  const root = await prepareScratchRoot(scratch);
  const input = join(scratch, 'fixture');
  await mkdir(input, { mode: 0o700 });
  const narration = join(input, 'non-publishable-tone.wav');
  const transcript = join(input, 'word-timings.json');
  const tone = deterministicTone(60);
  const words = deterministicTranscript(buildTipV11Narration(fixture), 60);
  const timings = `${JSON.stringify(words)}\n`;
  await Promise.all([
    writeFile(narration, tone, { mode: 0o600 }),
    writeFile(transcript, timings, { mode: 0o600 }),
  ]);
  const prepared = await renderTipV11(fixture, { root, localNarration: narration, localWordTimings: transcript });
  const alignment = await readFile(prepared.alignPath);
  assert.equal(JSON.parse(alignment).provenance, 'local-word-timings');
  assert.equal(prepared.props.title, fixture.title);
  assert.equal(prepared.props.assistantEnabled, false);
  assert.equal(prepared.props.durationInFrames, 1818);
  assert.ok(prepared.props.captions.length > 0 && prepared.props.segments.length > 0);
  const { captionGeometryRunId, ...comparisonProps } = prepared.props;
  assert.match(captionGeometryRunId, /^[a-f0-9-]{36}$/u);
  return { root, props: prepared.props, input: {
    sourceHashes, fixtureScriptSha256: fixture.sourceScriptSha256, transcriptSha256: sha256(timings),
    toneSha256: sha256(tone), alignmentSha256: sha256(alignment),
    propsSha256IgnoringGeometryRunId: sha256(JSON.stringify(comparisonProps)),
    normalizedWavSha256: sha256(await readFile(prepared.normalizedPath)),
    mixedWavSha256: sha256(await readFile(prepared.mixedPath)),
    durationInFrames: prepared.props.durationInFrames, captionCount: prepared.props.captions.length,
  } };
}
