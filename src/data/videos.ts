// The 10 JAMM IMMO short videos for the "Arnaques & Erreurs locataires"
// pilot. Each scene carries:
//   - a short headline `subtitle` (FR) / `subtitleEn` (EN) shown as a chip
//   - a `voiceoverFr` / `voiceoverEn` sentence — the actual line spoken
//     during that scene, rendered as the big caption underneath the chip.
// The `voiceoverScript` is the full continuous text sent to Gemini TTS;
// it must read naturally as a single paragraph (the per-scene voiceoverFr
// fields are excerpts, used only for on-screen captioning, not for TTS).

import type { SceneVisualType } from './scene-visual-types';

export type SceneSpec = {
  visualType: SceneVisualType;
  variant?: string;
  subtitle: string;       // FR headline chip
  subtitleEn: string;     // EN headline chip
  voiceoverFr: string;    // FR spoken sentence during this scene
  voiceoverEn: string;    // EN translation of that sentence
  photoBg?: string;
};

export type HookSpec = {
  title: string;
  titleEn: string;
  subline: string;
  sublineEn: string;
  cards: string[];
};

export type VideoSpec = {
  id: string;
  title: string;
  hook: HookSpec;
  scenes: [SceneSpec, SceneSpec, SceneSpec, SceneSpec, SceneSpec];
  voiceoverScript: string;
};

export const VIDEOS: VideoSpec[] = [
  {
    id: '01-paiement-avant-visite',
    title: '01 - Payer avant la visite',
    hook: {
      title: 'PAYER AVANT LA VISITE ?',
      titleEn: 'PAY BEFORE VISITING?',
      subline: 'À Dakar, cette erreur coûte cher',
      sublineEn: 'In Dakar, this mistake costs you dearly',
      cards: ['Mobile Money', 'Sans visite', 'Argent perdu'],
    },
    scenes: [
      {
        visualType: 'listing-address',
        variant: 'photos-only',
        subtitle: 'VÉRIFIEZ L’ADRESSE SUR PLACE',
        subtitleEn: 'Verify the address in person',
        voiceoverFr: 'Ne vous fiez pas seulement aux photos : vérifiez l’adresse sur place.',
        voiceoverEn: 'Don’t trust photos alone — verify the address in person.',
      },
      {
        visualType: 'mobile-money',
        variant: 'stop',
        subtitle: 'NE PAYEZ JAMAIS AVANT LA VISITE',
        subtitleEn: 'Never pay before the visit',
        voiceoverFr: 'Si le paiement arrive avant le contrôle, stop : ne payez jamais avant la visite.',
        voiceoverEn: 'If payment comes before the check — stop. Never pay before the visit.',
      },
      {
        visualType: 'listing-scam',
        variant: 'unavailable',
        subtitle: 'Le contact peut disparaître.',
        subtitleEn: 'The contact can vanish.',
        voiceoverFr: 'Après l’envoi, le contact peut disparaître ou bloquer votre numéro.',
        voiceoverEn: 'Once you’ve sent the money, the contact may vanish or block your number.',
      },
      {
        visualType: 'receipt',
        variant: 'proof',
        subtitle: 'Demandez une preuve claire.',
        subtitleEn: 'Ask for clear proof.',
        voiceoverFr: 'Ne payez rien sans preuve lisible : reçu clair, identité, adresse.',
        voiceoverEn: 'Pay nothing without readable proof — receipt, ID, confirmed address.',
      },
      {
        visualType: 'building',
        variant: 'visit-confirmed',
        subtitle: 'PAS DE VISITE, PAS D’AVANCE',
        subtitleEn: 'No visit, no advance',
        voiceoverFr: 'La règle est simple : pas de visite, pas d’avance.',
        voiceoverEn: 'The rule is simple — no visit, no advance.',
      },
    ],
    voiceoverScript:
      'À Dakar, payer avant la visite peut coûter très cher. Ne vous fiez pas seulement aux photos : vérifiez l’adresse sur place et visitez d’abord l’appartement. Si le paiement arrive avant le contrôle, stop : ne payez jamais avant la visite. Après l’envoi, le contact peut disparaître ou bloquer votre numéro. Ne payez rien sans preuve lisible : demandez un reçu clair, une identité et une adresse confirmée. La règle est simple : pas de visite, pas d’avance. Avec JAMM IMMO, vous visitez mieux, vous vérifiez mieux, et vous louez avec plus de sécurité.',
  },
  {
    id: '02-caution-mobile-money',
    title: '02 - Envoyer la caution par Mobile Money',
    hook: {
      title: 'CAUTION TROP VITE ?',
      titleEn: 'DEPOSIT TOO FAST?',
      subline: 'Un numéro inconnu peut tout coûter',
      sublineEn: 'An unknown number can cost you everything',
      cards: ['Inconnu', 'Sans reçu', 'Sans visite'],
    },
    scenes: [
      {
        visualType: 'mobile-money',
        variant: 'fast-transfer',
        subtitle: 'ATTENTION AU NUMÉRO INCONNU',
        subtitleEn: 'Beware of unknown numbers',
        voiceoverFr: 'Premier signal d’alerte : un numéro inconnu qui réclame l’avance immédiate.',
        voiceoverEn: 'First red flag — an unknown number demanding the advance right now.',
      },
      {
        visualType: 'fake-broker',
        subtitle: 'DEMANDEZ L’IDENTITÉ COMPLÈTE',
        subtitleEn: 'Ask for full identity',
        voiceoverFr: 'Avant tout transfert, demandez l’identité complète du destinataire.',
        voiceoverEn: 'Before any transfer, ask for the recipient’s full identity.',
      },
      {
        visualType: 'receipt',
        variant: 'clear',
        subtitle: 'EXIGEZ UN REÇU CLAIR',
        subtitleEn: 'Demand a clear receipt',
        voiceoverFr: 'Exigez un reçu clair, avec date, montant et nom lisible.',
        voiceoverEn: 'Demand a clear receipt — date, amount, readable name.',
      },
      {
        visualType: 'building',
        variant: 'key',
        subtitle: 'PAS D’AVANCE SANS VISITE',
        subtitleEn: 'No advance without a visit',
        voiceoverFr: 'Ne payez aucune avance sans avoir visité le logement.',
        voiceoverEn: 'Never pay an advance without first visiting the property.',
      },
      {
        visualType: 'document-stack',
        variant: 'lease-deposit-receipt',
        subtitle: 'VÉRIFIEZ AVANT DE PAYER',
        subtitleEn: 'Verify before paying',
        voiceoverFr: 'Vérifiez toujours bail, caution et reçu avant de payer.',
        voiceoverEn: 'Always check lease, deposit and receipt before you pay.',
      },
    ],
    voiceoverScript:
      'À Dakar, envoyer la caution trop vite par Mobile Money est un piège fréquent. Premier signal d’alerte : un numéro inconnu qui réclame l’avance immédiate. Avant tout transfert, demandez l’identité complète du destinataire. Exigez un reçu clair, avec date, montant et nom lisible. Et surtout, ne payez aucune avance sans avoir visité le logement. Vérifiez toujours avant de payer. Avec JAMM IMMO, votre caution est sécurisée, votre dossier est clair, et votre location commence sans mauvaise surprise.',
  },
  {
    id: '03-tester-eau',
    title: '03 - Ne pas tester l’eau',
    hook: {
      title: 'L’EAU, TU L’AS TESTÉE ?',
      titleEn: 'DID YOU TEST THE WATER?',
      subline: 'La pression cache parfois des surprises',
      sublineEn: 'Pressure can hide nasty surprises',
      cards: ['Robinet', 'Douche', 'Compteur'],
    },
    scenes: [
      {
        visualType: 'water-tap',
        variant: 'kitchen',
        subtitle: 'OUVREZ TOUS LES ROBINETS',
        subtitleEn: 'Open every tap',
        voiceoverFr: 'Pendant la visite, ouvrez tous les robinets de la cuisine et de la salle de bain.',
        voiceoverEn: 'During the visit, open every tap in the kitchen and bathroom.',
      },
      {
        visualType: 'shower',
        subtitle: 'VÉRIFIEZ LA PRESSION DE L’EAU',
        subtitleEn: 'Check the water pressure',
        voiceoverFr: 'Vérifiez la pression sous la douche et le débit du lavabo.',
        voiceoverEn: 'Check the shower pressure and the sink flow.',
      },
      {
        visualType: 'water-tap',
        variant: 'drain',
        subtitle: 'TESTEZ AUSSI LES ÉVACUATIONS',
        subtitleEn: 'Test the drains too',
        voiceoverFr: 'Testez aussi les évacuations : un siphon bouché annonce de gros problèmes.',
        voiceoverEn: 'Test the drains too — a blocked trap signals big problems.',
      },
      {
        visualType: 'meter',
        variant: 'water',
        subtitle: 'VÉRIFIEZ LE COMPTEUR D’EAU',
        subtitleEn: 'Check the water meter',
        voiceoverFr: 'Vérifiez le compteur d’eau pour repérer toute fuite cachée.',
        voiceoverEn: 'Check the water meter to spot any hidden leak.',
      },
      {
        visualType: 'schedule-clock',
        subtitle: 'DEMANDEZ LES HORAIRES DE COUPURE',
        subtitleEn: 'Ask about outage schedules',
        voiceoverFr: 'Et demandez les horaires de coupure d’eau dans le quartier.',
        voiceoverEn: 'And ask about the water-outage schedule for the area.',
      },
    ],
    voiceoverScript:
      'À Dakar, l’eau peut faire la différence entre un bon et un mauvais appartement. Pendant la visite, ouvrez tous les robinets de la cuisine et de la salle de bain. Vérifiez la pression sous la douche et le débit du lavabo. Testez aussi les évacuations : un siphon bouché annonce de gros problèmes. Vérifiez le compteur d’eau et demandez les horaires de coupure dans le quartier. Une bonne pression d’eau, c’est une vraie tranquillité. Avec JAMM IMMO, on vérifie chaque détail avant de vous remettre les clés.',
  },
  {
    id: '04-visite-jour-nuit',
    title: '04 - Visiter seulement le jour',
    hook: {
      title: 'VISITE DE JOUR SEULEMENT ?',
      titleEn: 'DAYTIME VISIT ONLY?',
      subline: 'La nuit révèle l’autre visage du quartier',
      sublineEn: 'Night reveals the other face of the area',
      cards: ['Éclairage', 'Bruit', 'Sécurité'],
    },
    scenes: [
      {
        visualType: 'building',
        variant: 'day',
        subtitle: 'REVENEZ APRÈS LE COUCHER DU SOLEIL',
        subtitleEn: 'Come back after sunset',
        voiceoverFr: 'Ne signez jamais après une seule visite en pleine journée.',
        voiceoverEn: 'Never sign after a single daytime visit.',
      },
      {
        visualType: 'building',
        variant: 'night',
        subtitle: 'TESTEZ L’ÉCLAIRAGE',
        subtitleEn: 'Test the lighting',
        voiceoverFr: 'Revenez après le coucher du soleil pour tester l’éclairage.',
        voiceoverEn: 'Come back after sunset to test the lighting.',
      },
      {
        visualType: 'corridor-light',
        subtitle: 'REGARDEZ L’ENTRÉE ET LES COULOIRS',
        subtitleEn: 'Check the entrance and hallways',
        voiceoverFr: 'Regardez l’entrée, les couloirs et les coins sombres.',
        voiceoverEn: 'Inspect the entrance, the hallways and the dark corners.',
      },
      {
        visualType: 'noise-listen',
        subtitle: 'ÉCOUTEZ LE BRUIT DU SOIR',
        subtitleEn: 'Listen to the evening noise',
        voiceoverFr: 'Écoutez le bruit ambiant : générateurs, bars et voisins du soir.',
        voiceoverEn: 'Listen to the ambient noise — generators, bars, evening neighbours.',
      },
      {
        visualType: 'night-day-split',
        subtitle: 'VISITEZ AUSSI LA NUIT',
        subtitleEn: 'Visit at night too',
        voiceoverFr: 'Visitez aussi la nuit avant de vous engager.',
        voiceoverEn: 'Visit at night too before you commit.',
      },
    ],
    voiceoverScript:
      'À Dakar, un appartement magnifique le jour peut devenir un cauchemar la nuit. Ne signez jamais après une seule visite en journée. Revenez après le coucher du soleil pour tester l’éclairage de l’entrée et des couloirs. Regardez la sécurité, les coins sombres, les voisins du soir. Écoutez le bruit ambiant, les générateurs, les bars du quartier. Visitez aussi la nuit avant de vous engager. Avec JAMM IMMO, vous découvrez votre futur logement à toute heure.',
  },
  {
    id: '05-trajet-dakar',
    title: '05 - Sous-estimer le trajet',
    hook: {
      title: 'LE TRAJET, TU L’AS TESTÉ ?',
      titleEn: 'DID YOU TEST THE COMMUTE?',
      subline: 'Dakar aux heures de pointe surprend toujours',
      sublineEn: 'Dakar rush hour always surprises',
      cards: ['Matin', 'Soir', 'Budget'],
    },
    scenes: [
      {
        visualType: 'traffic',
        variant: 'peak',
        subtitle: 'TESTEZ AUX HEURES DE POINTE',
        subtitleEn: 'Test at rush hour',
        voiceoverFr: 'Testez le trajet aux heures de pointe, jamais le week-end.',
        voiceoverEn: 'Test the commute at rush hour — never on a weekend.',
      },
      {
        visualType: 'traffic',
        variant: 'morning',
        subtitle: 'TESTEZ LE DÉPART LE MATIN',
        subtitleEn: 'Test the morning commute',
        voiceoverFr: 'Faites le test du matin, entre sept et neuf heures.',
        voiceoverEn: 'Do the morning test, between 7 and 9 a.m.',
      },
      {
        visualType: 'traffic',
        variant: 'evening',
        subtitle: 'TESTEZ LE RETOUR LE SOIR',
        subtitleEn: 'Test the evening return',
        voiceoverFr: 'Faites le test du retour le soir, entre dix-sept et vingt heures.',
        voiceoverEn: 'Do the return test, between 5 and 8 p.m.',
      },
      {
        visualType: 'transit-icons',
        subtitle: 'REPÉREZ LES ACCÈS RÉELS',
        subtitleEn: 'Map the real access points',
        voiceoverFr: 'Repérez les bus, les taxis et les accès réels au quartier.',
        voiceoverEn: 'Map the buses, the taxis and the real access points.',
      },
      {
        visualType: 'budget-calc',
        subtitle: 'VÉRIFIEZ LE BUDGET TRANSPORT',
        subtitleEn: 'Check your transport budget',
        voiceoverFr: 'Calculez votre budget transport pour un mois complet.',
        voiceoverEn: 'Calculate your transport budget for a full month.',
      },
    ],
    voiceoverScript:
      'À Dakar, le trajet domicile-travail peut transformer votre quotidien. Avant de signer, testez le trajet aux heures de pointe, jamais le week-end. Faites le test du matin entre sept et neuf heures. Faites le test du retour le soir entre dix-sept et vingt heures. Repérez les bus, les taxis, les accès réels au quartier. Calculez votre budget transport pour un mois complet. Avec JAMM IMMO, on vous aide à choisir un quartier vraiment fait pour votre vie.',
  },
  {
    id: '06-verifier-proprietaire',
    title: '06 - Ne pas vérifier le propriétaire',
    hook: {
      title: 'EST-IL VRAIMENT PROPRIÉTAIRE ?',
      titleEn: 'IS HE REALLY THE OWNER?',
      subline: 'Vérifier l’identité évite les arnaques',
      sublineEn: 'Verifying identity prevents scams',
      cards: ['Pièce', 'Bail', 'Factures'],
    },
    scenes: [
      {
        visualType: 'id-check',
        subtitle: 'DEMANDEZ UNE PIÈCE',
        subtitleEn: 'Ask for ID',
        voiceoverFr: 'Demandez une pièce d’identité officielle dès le premier contact sérieux.',
        voiceoverEn: 'Ask for an official ID from the first serious contact.',
      },
      {
        visualType: 'document-stack',
        variant: 'compare',
        subtitle: 'COMPAREZ PIÈCE, BAIL ET FACTURES',
        subtitleEn: 'Compare ID, lease and bills',
        voiceoverFr: 'Comparez la pièce, le bail et les factures d’eau et d’électricité.',
        voiceoverEn: 'Compare the ID, the lease and the water and electricity bills.',
      },
      {
        visualType: 'receipt',
        variant: 'with-name',
        subtitle: 'LE REÇU DOIT PORTER LE BON NOM',
        subtitleEn: 'Receipt must show the right name',
        voiceoverFr: 'Le reçu doit toujours porter le bon nom — jamais un intermédiaire flou.',
        voiceoverEn: 'The receipt must always carry the right name — never a vague middleman.',
      },
      {
        visualType: 'building',
        variant: 'key',
        subtitle: 'VÉRIFIEZ LE LIEN AVEC LE LOGEMENT',
        subtitleEn: 'Confirm the link to the property',
        voiceoverFr: 'Vérifiez le lien réel entre la personne et le logement.',
        voiceoverEn: 'Confirm the real link between the person and the property.',
      },
      {
        visualType: 'document-stack',
        variant: 'validated',
        subtitle: 'IDENTITÉ AVANT PAIEMENT',
        subtitleEn: 'Identity before payment',
        voiceoverFr: 'Identité avant paiement : c’est la règle d’or.',
        voiceoverEn: 'Identity before payment — that is the golden rule.',
      },
    ],
    voiceoverScript:
      'À Dakar, vérifier que vous parlez bien au vrai propriétaire évite de gros problèmes. Demandez une pièce d’identité officielle dès le premier contact sérieux. Comparez la pièce, le bail et les factures d’eau et d’électricité. Le reçu doit toujours porter le bon nom, jamais celui d’un intermédiaire flou. Vérifiez le lien réel entre la personne et le logement. Identité avant paiement, c’est la règle d’or. Avec JAMM IMMO, chaque bail est vérifié, chaque propriétaire est confirmé.',
  },
  {
    id: '07-contrat-bail',
    title: '07 - Signer sans contrat',
    hook: {
      title: 'SANS CONTRAT, SANS RECOURS',
      titleEn: 'NO CONTRACT, NO PROTECTION',
      subline: 'Un accord verbal ne protège personne',
      sublineEn: 'A verbal deal protects no one',
      cards: ['Loyer', 'Caution', 'Durée'],
    },
    scenes: [
      {
        visualType: 'verbal-handshake',
        subtitle: 'UN ACCORD VERBAL NE SUFFIT PAS',
        subtitleEn: 'A verbal deal is not enough',
        voiceoverFr: 'Un accord verbal ne protège ni d’un loyer qui augmente, ni d’une expulsion.',
        voiceoverEn: 'A verbal deal protects you from neither rent hikes nor eviction.',
      },
      {
        visualType: 'contract',
        variant: 'lease',
        subtitle: 'LA CAUTION DOIT ÊTRE CLAIRE',
        subtitleEn: 'The deposit must be clear',
        voiceoverFr: 'Exigez un bail écrit clair, signé, avec loyer, durée et caution.',
        voiceoverEn: 'Demand a clear written lease, signed, with rent, term and deposit.',
      },
      {
        visualType: 'contract',
        variant: 'clauses',
        subtitle: 'LES CLAUSES IMPORTANTES',
        subtitleEn: 'The key clauses',
        voiceoverFr: 'Vérifiez bien les clauses importantes avant toute signature.',
        voiceoverEn: 'Carefully review the key clauses before any signature.',
      },
      {
        visualType: 'contract',
        variant: 'payment',
        subtitle: 'LE PAIEMENT SUIT LE CONTRAT',
        subtitleEn: 'Payment follows the contract',
        voiceoverFr: 'Le paiement suit toujours la signature du contrat, jamais l’inverse.',
        voiceoverEn: 'Payment always follows the signature — never the other way round.',
      },
      {
        visualType: 'contract',
        variant: 'inspection',
        subtitle: 'FAITES UN ÉTAT DES LIEUX',
        subtitleEn: 'Do a walkthrough inspection',
        voiceoverFr: 'Faites un état des lieux daté et signé avant d’entrer.',
        voiceoverEn: 'Do a dated and signed walkthrough inspection before moving in.',
      },
    ],
    voiceoverScript:
      'À Dakar, un accord verbal ne vous protège ni d’un loyer qui augmente, ni d’une expulsion soudaine. Exigez un bail écrit clair, signé, avec loyer, durée et caution. La caution doit être détaillée et remboursable selon des règles précises. Vérifiez bien les clauses importantes avant toute signature. Le paiement doit toujours suivre la signature du contrat, jamais avant. Faites un état des lieux daté et signé avant d’entrer. Avec JAMM IMMO, vous signez en toute confiance.',
  },
  {
    id: '08-clauses-bail',
    title: '08 - Ne pas lire les clauses',
    hook: {
      title: 'LIRE LES CLAUSES, OBLIGATOIRE',
      titleEn: 'READ THE CLAUSES — MANDATORY',
      subline: 'Une ligne oubliée peut coûter cher',
      sublineEn: 'One missed line can cost a lot',
      cards: ['Hausse', 'Pénalités', 'Préavis'],
    },
    scenes: [
      {
        visualType: 'contract',
        variant: 'clauses',
        subtitle: 'UNE LIGNE PEUT COÛTER CHER',
        subtitleEn: 'One line can cost dearly',
        voiceoverFr: 'Vérifiez la clause d’augmentation : combien, et tous les combien.',
        voiceoverEn: 'Check the rent-increase clause: how much, and how often.',
      },
      {
        visualType: 'fine-print',
        subtitle: 'CHERCHEZ LES FRAIS CACHÉS',
        subtitleEn: 'Look for hidden fees',
        voiceoverFr: 'Cherchez les pénalités cachées en cas de retard de paiement.',
        voiceoverEn: 'Look for hidden penalties in case of late payment.',
      },
      {
        visualType: 'calendar-notice',
        subtitle: 'VÉRIFIEZ LE PRÉAVIS',
        subtitleEn: 'Check the notice period',
        voiceoverFr: 'Vérifiez le préavis exigé pour partir — parfois trois mois au lieu d’un.',
        voiceoverEn: 'Check the notice period to leave — sometimes three months instead of one.',
      },
      {
        visualType: 'expenses-breakdown',
        subtitle: 'LES CHARGES DOIVENT ÊTRE DÉTAILLÉES',
        subtitleEn: 'Charges must be itemized',
        voiceoverFr: 'Demandez la liste détaillée des charges incluses dans le loyer.',
        voiceoverEn: 'Ask for the itemized list of charges included in the rent.',
      },
      {
        visualType: 'contract',
        variant: 'signed',
        subtitle: 'LISEZ AVANT DE SIGNER',
        subtitleEn: 'Read before you sign',
        voiceoverFr: 'Lisez chaque ligne avant de signer, sans pression.',
        voiceoverEn: 'Read every line before signing — no pressure.',
      },
    ],
    voiceoverScript:
      'À Dakar, une seule ligne de bail mal lue peut coûter des mois de loyer. Vérifiez la clause d’augmentation : combien, et tous les combien. Cherchez les pénalités cachées en cas de retard de paiement. Vérifiez aussi le préavis exigé pour partir, parfois trois mois au lieu d’un. Demandez la liste détaillée des charges incluses dans le loyer. Lisez chaque ligne avant de signer, sans pression. Avec JAMM IMMO, on vous explique chaque clause en français clair.',
  },
  {
    id: '09-recu-paiement',
    title: '09 - Payer sans reçu',
    hook: {
      title: 'PAS DE REÇU, PAS DE PREUVE',
      titleEn: 'NO RECEIPT, NO PROOF',
      subline: 'Sans trace, ton argent n’existe plus',
      sublineEn: 'Without a record, your money is gone',
      cards: ['Date', 'Nom', 'Signature'],
    },
    scenes: [
      {
        visualType: 'mobile-money',
        variant: 'no-receipt',
        subtitle: 'PAS DE PREUVE, PAS DE PAIEMENT',
        subtitleEn: 'No proof, no payment',
        voiceoverFr: 'Pas de preuve, pas de paiement : c’est la règle simple.',
        voiceoverEn: 'No proof, no payment — it is the simple rule.',
      },
      {
        visualType: 'receipt',
        variant: 'dated',
        subtitle: 'EXIGEZ UN REÇU DATÉ',
        subtitleEn: 'Demand a dated receipt',
        voiceoverFr: 'Exigez un reçu daté avant même de remettre l’argent.',
        voiceoverEn: 'Demand a dated receipt before you even hand over the money.',
      },
      {
        visualType: 'receipt',
        variant: 'with-name',
        subtitle: 'LE NOM DOIT ÊTRE LISIBLE',
        subtitleEn: 'The name must be readable',
        voiceoverFr: 'Le nom du propriétaire doit être lisible et correspondre au bail.',
        voiceoverEn: 'The owner’s name must be readable and match the lease.',
      },
      {
        visualType: 'receipt',
        variant: 'linked-lease',
        subtitle: 'LE REÇU DOIT CORRESPONDRE AU BAIL',
        subtitleEn: 'Receipt must match the lease',
        voiceoverFr: 'Vérifiez que le reçu correspond au mois et au montant convenus.',
        voiceoverEn: 'Check that the receipt matches the agreed month and amount.',
      },
      {
        visualType: 'receipt',
        variant: 'archive',
        subtitle: 'GARDEZ UNE COPIE NETTE',
        subtitleEn: 'Keep a clean copy',
        voiceoverFr: 'Gardez une copie nette — papier ou photo — dans un endroit sûr.',
        voiceoverEn: 'Keep a clean copy — paper or photo — in a safe place.',
      },
    ],
    voiceoverScript:
      'À Dakar, payer sans reçu, c’est offrir votre argent sans retour. Pas de preuve, pas de paiement, c’est la règle simple. Exigez un reçu daté avant même de remettre l’argent. Le nom du propriétaire doit être lisible et correspondre au bail. Vérifiez aussi que le reçu correspond bien au mois et au montant convenus. Gardez une copie nette, papier ou photo, dans un endroit sûr. Avec JAMM IMMO, chaque paiement laisse une trace claire et protégée.',
  },
  {
    id: '10-compteurs-entree',
    title: '10 - Oublier les compteurs',
    hook: {
      title: 'LES COMPTEURS À L’ENTRÉE',
      titleEn: 'METER READINGS ON MOVE-IN',
      subline: 'Évite de payer les factures du voisin',
      sublineEn: 'Don’t pay your neighbor’s bills',
      cards: ['Eau', 'Électricité', 'Factures'],
    },
    scenes: [
      {
        visualType: 'meter',
        variant: 'water',
        subtitle: 'RELEVEZ AVANT D’ENTRER',
        subtitleEn: 'Record readings before moving in',
        voiceoverFr: 'Relevez le compteur d’eau au moment exact de la remise des clés.',
        voiceoverEn: 'Read the water meter at the exact moment of key handover.',
      },
      {
        visualType: 'meter',
        variant: 'electric',
        subtitle: 'NOTEZ AUSSI L’ÉLECTRICITÉ',
        subtitleEn: 'Record electricity too',
        voiceoverFr: 'Notez aussi le compteur d’électricité, avec photo si possible.',
        voiceoverEn: 'Record the electricity meter too, with a photo if possible.',
      },
      {
        visualType: 'document-stack',
        variant: 'bills',
        subtitle: 'COMPAREZ LES FACTURES',
        subtitleEn: 'Compare the bills',
        voiceoverFr: 'Comparez avec les dernières factures payées par le propriétaire.',
        voiceoverEn: 'Compare with the last bills paid by the owner.',
      },
      {
        visualType: 'leak-alert',
        subtitle: 'UNE FUITE PEUT COÛTER CHER',
        subtitleEn: 'A leak can cost a lot',
        voiceoverFr: 'Une fuite ou une consommation anormale doit être signalée tout de suite.',
        voiceoverEn: 'A leak or unusual consumption must be reported immediately.',
      },
      {
        visualType: 'meter',
        variant: 'signed',
        subtitle: 'FAITES SIGNER LES RELEVÉS',
        subtitleEn: 'Get the readings signed',
        voiceoverFr: 'Faites signer les relevés par le propriétaire à l’entrée.',
        voiceoverEn: 'Have the readings signed by the owner on move-in.',
      },
    ],
    voiceoverScript:
      'À Dakar, oublier de relever les compteurs à l’entrée peut vous coûter les factures du voisin. Relevez le compteur d’eau au moment exact de la remise des clés. Notez aussi le compteur d’électricité, avec photo si possible. Comparez avec les dernières factures payées par le propriétaire. Une fuite ou une consommation anormale doit être signalée tout de suite. Faites signer les relevés par le propriétaire à l’entrée. Avec JAMM IMMO, on relève tout ensemble pour un démarrage propre.',
  },
];

export const VIDEO_IDS = VIDEOS.map((v) => v.id);

export const getVideoSpec = (id: string): VideoSpec => {
  const spec = VIDEOS.find((v) => v.id === id);
  if (!spec) {
    throw new Error(
      `Unknown video id: ${id}. Known ids: ${VIDEO_IDS.join(', ')}`,
    );
  }
  return spec;
};
