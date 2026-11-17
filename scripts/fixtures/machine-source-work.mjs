import { createHash } from 'node:crypto';
import { buildSourceScoringInput } from '../score-tip-source.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function machineSourceFixture() {
  const wav = Buffer.alloc(46);
  wav.write('RIFF'); wav.writeUInt32LE(38, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24_000, 24); wav.writeUInt32LE(48_000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(2, 40);
  const job = {
    policyId: '27ab1a67-94d2-4500-8a4c-67c13b21bd42',
    expectedPolicyUpdatedAt: '2026-11-17T12:34:56.123456+00:00',
    postId: 'a178af31-bd23-4a1b-a853-4abc85ad56de', hookId: 'd8bba724-d36b-47e0-81e4-9c9cb5e7bc4e',
    draft: {
      title: 'Préparer une visite', scriptEn: '',
      scriptFr: [
        'Vous préparez la visite pour examiner le logement et vérifier les informations annoncées.',
        'Comparez les pièces avec la description et notez les questions à poser sur place.',
        'Demandez les documents utiles pour comprendre la situation et la gestion du bien.',
        'Gardez une note de ce qui mérite confirmation lorsque les explications restent trop générales.',
        'Relisez vos observations avant de choisir une suite qui correspond à votre projet.',
      ].join(' '),
      caption: 'Préparer une visite à Dakar.', hashtags: ['JammImmo', 'Dakar'],
    },
    platformCopy: Object.fromEntries(['facebook', 'instagram', 'tiktok', 'youtube'].map(platform => [platform, {
      caption: `Préparer une visite à Dakar avec nos conseils sur ${platform}.`,
      cta: `Retrouvez nos prochains conseils sur ${platform}. #JammImmo #Dakar`,
    }])),
    profile: { templateManifestSha256: 'a'.repeat(64), runtimeSha256: 'b'.repeat(64), qualifierSha256: 'c'.repeat(64) },
  };
  const identity = buildSourceScoringInput(job.draft);
  const speech = {
    contract: 'tip-v11-fr-source-speech-v2', source: 'normalized_wav_pcm_s16le_mono_24khz', status: 'matched',
    draft_sha256: identity.draft_sha256, source_script_sha256: identity.source_script_sha256,
    narration_wav_sha256: hash(wav), decoded_pcm_sha256: hash(wav.subarray(44)), accent_evaluated: false,
    deferred_checks: ['domain_audio', 'visible_domain_cta'],
  };
  return { job, wav, speech };
}
