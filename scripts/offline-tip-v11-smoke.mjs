import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile, cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile,
} from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTipV11Narration } from './tip-v11-contract.mjs';
import { decodedTipMediaFingerprints } from './tip-decoded-media-fingerprint.mjs';
import { renderTipV11 } from './render-tip-v11.mjs';
import { renderTipV11Destinations } from './render-tip-v11-destinations.mjs';

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
    copyFile(join(repository, 'remotion.tip-v11.config.ts'), join(root, 'remotion.tip-v11.config.ts')),
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

    const probe = spawnSync('ffprobe', [
      '-v', 'trace', '-show_packets', '-show_entries',
      'stream=codec_type,codec_name,profile,sample_rate,channels,bit_rate,start_time,pix_fmt,field_order,nal_length_size:packet=codec_type,size,pos,flags,pts_time',
      '-of', 'json', video,
    ], { encoding: 'utf8', timeout: 20_000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(probe.status, 0);
    const { streams, packets } = JSON.parse(probe.stdout);
    const videoStream = streams.find(stream => stream.codec_type === 'video');
    const audio = streams.find(stream => stream.codec_type === 'audio');
    assert.equal(videoStream.field_order, 'progressive');
    assert.match(videoStream.pix_fmt, /^yuvj?420p$/u);
    assert.equal(Number(videoStream.start_time), 0);
    assert.equal(audio.codec_name, 'aac');
    assert.equal(audio.profile, 'LC');
    assert.equal(audio.sample_rate, '48000');
    assert.equal(audio.channels, 2);
    assert.ok(Number(audio.bit_rate) > 0 && Number(audio.bit_rate) <= 132_000);
    assert.equal(Number(audio.start_time), 0);
    const moov = probe.stderr.indexOf("type:'moov' parent:'root'");
    const mdat = probe.stderr.indexOf("type:'mdat' parent:'root'");
    assert.ok(moov >= 0 && mdat > moov, 'MP4 metadata must precede media data');
    assert.doesNotMatch(probe.stderr, /type:'elst'/u);
    const keyframes = packets.filter(packet => packet.codec_type === 'video' && packet.flags.includes('K'));
    assert.ok(keyframes.length > 1, 'Expected several H.264 GOP boundaries');
    assert.deepEqual(keyframes.map(packet => Number(packet.pts_time)),
      keyframes.map((_, index) => index * 3), 'Expected an IDR every three seconds');
    assert.equal(Number(videoStream.nal_length_size), 4);
    const videoBytes = await readFile(video);
    for (const packet of keyframes) {
      let cursor = Number(packet.pos);
      const end = cursor + Number(packet.size);
      assert.ok(end <= videoBytes.length);
      let hasIdr = false;
      while (cursor + 4 < end) {
        const length = videoBytes.readUInt32BE(cursor);
        cursor += 4;
        assert.ok(length > 0 && cursor + length <= end);
        hasIdr ||= (videoBytes[cursor] & 0x1f) === 5;
        cursor += length;
      }
      assert.equal(cursor, end);
      assert.ok(hasIdr, 'Each video keyframe must start a closed GOP');
    }

    receipt = {
      status: 'passed', scope: 'non-publishable-offline-remotion-smoke',
      renderer: 'TipV11Fr', voiceSource: manifest.voice.source,
      alignment: alignment.provenance, captionGeometry: manifest.caption_geometry.status,
      duration: media.duration, width: media.width, height: media.height,
      audioBitrate: Number(audio.bit_rate), closedGopKeyframes: keyframes.length, closedGopSeconds: 3,
      ...decodedTipMediaFingerprints(video),
      mediaSha256: manifest.media_sha256, retainedArtifact: false,
    };
    if (process.argv.slice(2).includes('--destination-layouts')) {
      const layouts = await renderTipV11Destinations({
        root, outputDirectory: join(scratch, 'destination-layouts'), props,
      });
      assert.equal(layouts.audioSha256, manifest.mix_wav_sha256);
      receipt.destinationLayouts = layouts.videos;
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
