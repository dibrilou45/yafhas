# Yafhas

Webapp pour **réviser sa mémorisation du Coran** depuis chez soi, gratuitement.
On vous donne le début d'un verset ; vous récitez **en continu jusqu'à la fin de
la sourate** ; l'app vérifie **mot à mot en direct** et planifie les révisions
(répétition espacée).

**Tout tourne dans le navigateur.** Aucune clé API, aucun serveur d'inférence,
aucune donnée envoyée : **0 € d'infrastructure**, et ça marche hors-ligne après
le premier chargement.

## Comment ça marche (streaming, sans dépendre des pauses)

Un récitant enchaîne souvent sans silence — on ne peut donc pas découper sur les
pauses. À la place, on transcrit un **tampon audio défilant** en continu et on
**valide un mot dès qu'il est stable** (overlap-commit / LocalAgreement), puis on
l'aligne sur le texte attendu via un **curseur ancré** qui avance.

```
micro (capture continue) ──► tampon défilant
        │  toutes les ~2 s
        ▼
Whisper (transformers.js, dans le navigateur, avec timestamps mot-à-mot)
        ▼
overlap-commit : on ne valide un mot que s'il réapparaît identique
        ▼
curseur ancré : alignement sur le texte attendu (fenêtre glissante)
        ▼   passage attendu = verset de départ → fin de sourate (mushaf, API + cache)
chaque mot surligné en direct : correct · erreur · manquant
        ▼
répétition espacée (Leitner) → sourate suivante
```

- **ASR (audio → texte)** : modèle exécuté sur l'appareil de l'utilisateur. Coût serveur = 0.
- **Pas de dépendance au silence** : marche en récitation continue, enchaîne les sourates.
- **Curseur ancré** : on suit une *position* dans le texte connu → la dérive de l'ASR
  ne s'accumule pas sur une longue récitation.
- **Dégradation gracieuse** : si l'ASR ne tient pas le temps réel, le résultat complet
  est finalisé à l'arrêt (transcription du tampon restant).
- **Texte du Coran** : [AlQuran.cloud](https://alquran.cloud/api) (mushaf Uthmani),
  jamais codé à la main, puis mis en cache.

## Lancer en local

Les modules ES + l'accès micro exigent un contexte sécurisé : servez le dossier
(ne pas ouvrir `index.html` en `file://`).

```bash
cd yafhas
python3 -m http.server 8000
# puis http://localhost:8000
```

## Tester sur mobile (HTTPS obligatoire pour le micro)

Le micro du navigateur exige un **contexte sécurisé**. `http://<ip-locale>:8000`
depuis le téléphone **ne marche pas** (micro bloqué). Le plus simple, gratuit :

1. Pousser sur GitHub (déjà fait par le workflow `.github/workflows/pages.yml`).
2. Dans le repo : **Settings → Pages → Build and deployment → Source : GitHub Actions**
   (réglage à faire **une seule fois**).
3. Le workflow déploie à chaque push. L'URL HTTPS apparaît dans l'onglet **Actions**
   (de la forme `https://<user>.github.io/yafhas/`). Ouvrez-la sur le mobile.

Conseils mobile :
- **Chrome / Edge Android** ou **Safari iOS récent**, autoriser le micro.
- Pour une 1re prise en main fluide, basculer `MODEL_ID` sur `Xenova/whisper-tiny`
  dans `src/config.js` (plus rapide ; `whisper-base` est plus précis mais plus lourd
  sur téléphone). En WASM pur, l'affichage live peut prendre du retard : le résultat
  complet reste affiché à l'arrêt.

## Héberger gratuitement

Le repo est déjà prêt pour **GitHub Pages** via le workflow fourni (ou Cloudflare
Pages / Netlify, tiers gratuit). Aucun build : fichiers statiques servis tels quels.

## Précision : passer au modèle spécialisé Coran

Par défaut, l'ASR utilise `Xenova/whisper-base` (Whisper multilingue, ONNX prêt à
l'emploi, langue forcée sur l'arabe) — suffisant pour démontrer le flux.

Pour une précision nettement meilleure sur la récitation coranique :

1. Convertir [`tarteel-ai/whisper-base-ar-quran`](https://huggingface.co/tarteel-ai/whisper-base-ar-quran)
   en ONNX avec [🤗 Optimum](https://huggingface.co/docs/optimum) :
   ```bash
   optimum-cli export onnx --model tarteel-ai/whisper-base-ar-quran whisper-quran-onnx/
   ```
2. Héberger le dossier ONNX sur Hugging Face (gratuit).
3. Remplacer `MODEL_ID` dans [`src/config.js`](src/config.js).

La logique de vérification ne change pas.

## Structure

| Fichier | Rôle |
|---|---|
| `src/config.js` | Configuration (modèle ASR, API, périmètre, streaming, stockage) |
| `src/normalize.js` | Normalisation du texte arabe pour la comparaison |
| `src/align.js` | Alignement mot-à-mot + alignement streaming à fin libre |
| `src/engine.js` | Moteur à curseur ancré (suit la position dans le texte connu) |
| `src/streaming.js` | Streamer overlap-commit (validation des mots stables) |
| `src/srs.js` | Répétition espacée (Leitner) |
| `src/quran.js` | Texte des versets / passages via API + cache localStorage |
| `src/audio.js` | Captation micro continue → mono 16 kHz |
| `src/asr.js` | Whisper via transformers.js (navigateur), timestamps mot-à-mot |
| `src/app.js` | Orchestration + interface |

## Limites du POC (assumées)

- Le **tajweed fin** (madd, ghunna, makharij) n'est pas évalué — c'est encore du
  domaine de la recherche. Le POC vise la justesse **mot à mot**, qui couvre
  l'essentiel d'une révision de mémorisation.
- Premier chargement du modèle : ~40–150 Mo, une seule fois (mis en cache ensuite).
- WebGPU améliore la vitesse ; sinon repli WASM (CPU), plus lent mais fonctionnel.
