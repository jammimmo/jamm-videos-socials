# Audit local du MP4 V11

L’audit mesure un fichier déjà rendu avec Python 3, FFmpeg, FFprobe et Tesseract. Il lit le MP4, l’alignement et les deux WAV du même rendu V11. Le rapport est créé à un nouvel emplacement.

```sh
python3 scripts/audit_tip_v11.py \
  --video out/batch/tip-ID.mp4 \
  --alignment out/batch/tip-ID.alignment.json \
  --narration-wav public/audio/voiceovers/tip-ID-v11.wav \
  --mix-wav public/audio/voiceovers/tip-ID-v11-mix.wav \
  --report /tmp/tip-v11-evidence.json
```

L’option `--ocr-language` sélectionne les données Tesseract déjà installées. La recette de référence utilise `eng`. Un changement de version ou de modèle OCR peut changer les résultats.

- Le rapport identifie le MP4, l’alignement et les deux WAV par leur SHA-256. FFprobe vérifie la durée, les pistes, les codecs et les dimensions.
- FFmpeg décode la piste finale. L’audit mesure la concordance avec la voix normalisée par segment et avec le mix par fenêtres audibles de 250 ms. Une seule compensation de décalage AAC, limitée à 60 ms, s’applique à toutes les mesures.
- L’OCR compare six sous-titres sélectionnés à partir de leur durée dans l’alignement. Il lit aussi le domaine, le numéro et la mention « Jamm Immo » à deux moments de l’outro. Les rectangles suivent la position du texte dans le MP4, après la mise à l’échelle de la zone sûre. Pour les sous-titres, la comparaison ignore les accents, la casse et la ponctuation. Le numéro conserve le signe `+` et le domaine conserve le point.
- Une lecture OCR qui ne retrouve pas le texte attendu est `inconclusive`. Le rapport conserve les résultats de chaque lecture et ne déduit aucune erreur du texte visible à partir de ce seul écart. Le code de sortie est `0` quand toutes les mesures concordent, `1` quand une mesure demande une revue et `2` quand l’audit ne peut pas s’exécuter.

Le workflow ajoute `--measure-final-french`. Cette mesure relit la piste audio du MP4 instantané au format PCM mono 24 kHz, avec la même compensation de décalage que la mesure de forme d’onde. Faster Whisper utilise le modèle déjà présent dans le cache local. Il ne reçoit aucun texte attendu, transcription de référence, mot-clé ou instruction de prononciation. Une comparaison distincte exige les mêmes mots dans le même ordre pour chaque scène entièrement en français. Elle normalise les accents, la casse, la ponctuation et les formes strictement équivalentes du domaine et du numéro officiels. Un mot ajouté, manquant, déplacé ou de confiance insuffisante rend la mesure `inconclusive`.

Le champ `final_french_speech` identifie la révision du modèle et le PCM décodé. Il conserve le nombre et l’empreinte SHA-256 des mots normalisés séparés par une espace, par scène, sans écrire de transcription. Il exclut le salut et la signature multilingues et ne mesure pas l’accent. En cas d’indisponibilité, le sous-processus de reconnaissance est arrêté après 150 secondes. Le résultat de forme d’onde et d’OCR reste disponible. `final_french_speech.status` ne change ni le verdict de ce rapport historique ni l’autorisation de publier.

Le rapport couvre des images échantillonnées, la fidélité de la piste audio au rendu et, si demandée, la concordance de sa transcription dans les scènes entièrement en français. Les droits des médias, les données sensibles, le contenu et la qualité de l’accent relèvent d’une autre vérification. La provenance des fichiers d’entrée doit être établie avant tout usage côté serveur.

Le workflow V11 fournit aussi `--render-manifest`, `--render-props` et `--raw-wav`. Le moteur calcule les empreintes des ressources statiques avant et après le rendu. Le manifeste conserve les empreintes du texte exact reçu, du texte effectivement envoyé à la synthèse, du profil vocal, des trois WAV, des paramètres de Remotion, de l’alignement et du MP4. Le champ `assistant_enabled` doit correspondre à la scène et aux paramètres utilisés. L’audit joint les octets du manifeste encodés en Base64 et leur empreinte au rapport. L’empreinte du rapport rattache ensuite le manifeste au reçu d’upload et à l’attestation OIDC.

Le manifeste ajoute `caption_geometry`. Le navigateur relève les rectangles du cartouche et des lignes de texte après le chargement de Poppins et l’ajustement typographique, au premier, au milieu et au dernier photogramme de chaque sous-titre. Les artefacts sont liés à un identifiant aléatoire de rendu. Le moteur contrôle chaque rectangle, la couverture des sous-titres et l’appartenance à la zone `tip-v11-observed-short-feed-20261114-v1` avant d’agréger les mesures. Une mesure absente, hors zone ou dont le texte déborde du cartouche rend ce champ `inconclusive`. Les rectangles intermédiaires sont supprimés. Le rapport rattache le manifeste aux paramètres et au MP4 exacts.

Cette zone est une marge géométrique dérivée d’un exemple d’habillage TikTok. Le contrôle porte sur le cartouche et le texte, sans évaluer leur contenu, leur couleur, leur occultation par d’autres éléments ou les habillages des autres réseaux et appareils. Il conserve le verdict historique de forme d’onde et d’OCR.

Un audit sans manifeste reste utilisable localement. Le workflow ne joint pas de reçu technique pour un manifeste incomplet, une voix locale ou en cache, ou un alignement de recette. Le MP4 suit alors la revue humaine. Après un rattachement attesté, le workflow envoie le rapport par le callback de la même tentative. Le Worker vérifie son empreinte et le conserve dans le stockage privé. Un refus du rapport laisse le brouillon disponible pour revue. La rétention et la comparaison du manifeste à la politique restent à raccorder avant toute décision automatique.

```sh
python3 -m unittest discover -s scripts -p 'test_audit_tip_v11*.py'
```
