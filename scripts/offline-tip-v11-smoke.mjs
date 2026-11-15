import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFile, cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile,
} from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTipV11Narration } from './tip-v11-contract.mjs';
import { renderTipV11 } from './render-tip-v11.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const forbiddenCredentials = [
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'GEMINI_API_KEY', 'TIP_CALLBACK_TOKEN',
  'TIP_CALLBACK_URL', 'TIP_UPLOAD_URL',
];
const fixture = {
  template: 'tip-v11-fr',
  id: 'tip-00000000-0000-4000-8000-000000000019',
  title: 'RECETTE HORS LIGNE',
  body: [
    'Cette recette synthétique vérifie uniquement le moteur vidéo hors ligne et ne doit jamais être publiée.',
    'Chaque image utilise des données locales déterministes sans client, compte social, annonce réelle ou média privé.',
    'La piste sonore contient seulement un signal artificiel destiné aux contrôles techniques du rendu automatisé.',
    'Les sous-titres signalent clairement une démonstration de test sans conseil immobilier ni appel commercial.',
    'Le fichier final est contrôlé puis supprimé avant toute livraison, publication ou conservation comme contenu éditorial.',
  ],
};
fixture.sourceScriptSha256 = createHash('sha256').update(fixture.body.join(' ')).digest('hex');

function assertIsolatedProcess() {
  assert.equal(process.env.OFFLINE_SMOKE_NETWORK_ISOLATED, '1',
    'Run the smoke render inside the documented outbound-blocked wrapper');
  assert.deepEqual(forbiddenCredentials.filter(name => process.env[name]), [],
    'Offline smoke render refuses provider, delivery and OIDC credentials');
  if (process.platform === 'linux') {
    const nonLoopback = Object.values(networkInterfaces()).flat().filter(address => address && !address.internal);
    assert.equal(nonLoopback.length, 0, 'Linux smoke namespace must expose loopback only');
  }
}

function normalizedTokens(text) {
  return text.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/gu, '')
    .replace(/\bjam{1,2}\s*im{1,2}o\s*\.\s*com\b/gu, 'jamm immo point com')
    .replace(/\bjam{1,2}\s*im{1,2}o\b/gu, 'jamm immo')
    .replace(/\bnangadef\b/gu, 'nanga def')
    .replaceAll('+', ' plus ')
    .match(/[a-z0-9]+/gu) ?? [];
}

function deterministicTranscript(plan, durationSeconds) {
  const words = plan.segments.flatMap(segment => normalizedTokens(segment.text));
  const startAt = 0.2;
  const step = (durationSeconds - 0.8) / words.length;
  return words.map((word, index) => ({
    word,
    start: startAt + index * step,
    end: startAt + (index + 0.8) * step,
  }));
}

function deterministicTone(durationSeconds) {
  const sampleRate = 24_000;
  const sampleCount = durationSeconds * sampleRate;
  const bytes = Buffer.alloc(44 + sampleCount * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + sampleCount * 2, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(1_400 * Math.sin(2 * Math.PI * 220 * index / sampleRate));
    bytes.writeInt16LE(sample, 44 + index * 2);
  }
  return bytes;
}

async function prepareScratchRoot(scratch) {
  const root = join(scratch, 'renderer');
  await mkdir(join(root, 'public'), { recursive: true });
  await Promise.all([
    cp(join(repository, 'src'), join(root, 'src'), { recursive: true }),
    cp(join(repository, 'scripts'), join(root, 'scripts'), { recursive: true }),
    cp(join(repository, 'public', 'tip-v11'), join(root, 'public', 'tip-v11'), { recursive: true }),
    copyFile(join(repository, 'package.json'), join(root, 'package.json')),
    copyFile(join(repository, 'package-lock.json'), join(root, 'package-lock.json')),
    copyFile(join(repository, 'remotion.config.ts'), join(root, 'remotion.config.ts')),
    copyFile(join(repository, 'tsconfig.json'), join(root, 'tsconfig.json')),
    symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir'),
  ]);
  return root;
}

async function main() {
  assertIsolatedProcess();
  const scratch = await mkdtemp(join(tmpdir(), 'jamm-offline-render-smoke-'));
  let receipt;
  try {
    const root = await prepareScratchRoot(scratch);
    const inputDirectory = join(scratch, 'fixture');
    const narration = join(inputDirectory, 'non-publishable-tone.wav');
    const transcript = join(inputDirectory, 'word-timings.json');
    const durationSeconds = 60;
    const plan = buildTipV11Narration(fixture);
    await mkdir(inputDirectory, { recursive: true });
    await Promise.all([
      writeFile(narration, deterministicTone(durationSeconds), { mode: 0o600 }),
      writeFile(transcript, `${JSON.stringify(deterministicTranscript(plan, durationSeconds))}\n`, { mode: 0o600 }),
    ]);

    const video = await renderTipV11(fixture, {
      root, localNarration: narration, localWordTimings: transcript,
    });
    const output = join(root, 'out', 'batch');
    const [alignment, manifest, media, props, videoStat] = await Promise.all([
      readFile(join(output, `${fixture.id}.alignment.json`), 'utf8').then(JSON.parse),
      readFile(join(output, `${fixture.id}.manifest.json`), 'utf8').then(JSON.parse),
      readFile(join(output, `${fixture.id}.media.json`), 'utf8').then(JSON.parse),
      readFile(join(output, `${fixture.id}.props.json`), 'utf8').then(JSON.parse),
      stat(video),
    ]);

    assert.equal(basename(video), `${fixture.id}.mp4`);
    assert.equal(alignment.provenance, 'local-word-timings');
    assert.equal(alignment.reviewRequired, true);
    assert.equal(manifest.voice.source, 'fixture');
    assert.equal(manifest.source_script_sha256, fixture.sourceScriptSha256);
    assert.equal(manifest.caption_geometry?.status, 'matched');
    assert.equal(media.template, fixture.template);
    assert.equal(media.reviewRequired, true);
    assert.equal(media.width, 1080);
    assert.equal(media.height, 1920);
    assert.ok(media.duration > 60 && media.duration <= 120);
    assert.equal(props.title, fixture.title);
    assert.equal(props.assistantEnabled, false);
    assert.ok(videoStat.size > 0 && videoStat.size <= 50 * 1024 * 1024);

    receipt = {
      status: 'passed', scope: 'non-publishable-offline-remotion-smoke',
      renderer: 'TipV11Fr', voiceSource: manifest.voice.source,
      alignment: alignment.provenance, captionGeometry: manifest.caption_geometry.status,
      duration: media.duration, width: media.width, height: media.height,
      mediaSha256: manifest.media_sha256, retainedArtifact: false,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
