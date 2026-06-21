# Yafhas

Webapp pour **réviser sa mémorisation du Coran** depuis chez soi, gratuitement.
On vous montre le début d'un verset ; vous le complétez de mémoire à voix haute ;
l'app vérifie **mot à mot** et planifie les révisions (répétition espacée).

**Tout tourne dans le navigateur.** Aucune clé API, aucun serveur d'inférence,
aucune donnée envoyée : **0 € d'infrastructure**, et ça marche hors-ligne après
le premier chargement.

## Comment ça marche

```
micro ──► Whisper (transformers.js, ONNX, dans le navigateur) ──► texte récité
                                                                      │
verset attendu (mushaf, via API gratuite + cache) ────────────────────┤
                                                                      ▼
                       normalisation arabe + alignement mot-à-mot
                                                                      ▼
              chaque mot surligné : correct · erreur · manquant
                                                                      ▼
                    répétition espacée (Leitner) → verset suivant
```

- **ASR (audio → texte)** : modèle exécuté sur l'appareil de l'utilisateur. Coût serveur = 0.
- **Vérification** : purement algorithmique (distance d'édition au niveau des mots),
  fiable parce qu'on connaît déjà le verset cible (vérification *contrainte*).
- **Texte du Coran** : récupéré depuis [AlQuran.cloud](https://alquran.cloud/api)
  (mushaf Uthmani), jamais codé à la main, puis mis en cache.

## Lancer en local

Les modules ES + l'accès micro exigent un contexte sécurisé : servez le dossier
(ne pas ouvrir `index.html` en `file://`).

```bash
cd yafhas
python3 -m http.server 8000
# puis http://localhost:8000
```

## Héberger gratuitement

Pousser le repo et activer **GitHub Pages** (ou Cloudflare Pages / Netlify, tiers
gratuit). Aucun build : ce sont des fichiers statiques.

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
| `src/config.js` | Configuration (modèle ASR, API, périmètre, clés de stockage) |
| `src/normalize.js` | Normalisation du texte arabe pour la comparaison |
| `src/align.js` | Alignement mot-à-mot (correct / faux / manquant / en trop) |
| `src/srs.js` | Répétition espacée (Leitner) |
| `src/quran.js` | Texte des versets via API + cache localStorage |
| `src/audio.js` | Capture micro → mono 16 kHz |
| `src/asr.js` | Whisper via transformers.js (navigateur) |
| `src/app.js` | Orchestration + interface |

## Limites du POC (assumées)

- Le **tajweed fin** (madd, ghunna, makharij) n'est pas évalué — c'est encore du
  domaine de la recherche. Le POC vise la justesse **mot à mot**, qui couvre
  l'essentiel d'une révision de mémorisation.
- Premier chargement du modèle : ~40–150 Mo, une seule fois (mis en cache ensuite).
- WebGPU améliore la vitesse ; sinon repli WASM (CPU), plus lent mais fonctionnel.
