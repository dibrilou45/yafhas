// Configuration centrale de Yafhas.
// Tout tourne dans le navigateur : aucune clé API, aucun serveur d'inférence, 0 €.

export const ASR = {
  // Modèle de reconnaissance vocale exécuté DANS le navigateur via transformers.js
  // (ONNX + WASM/WebGPU). Par défaut : Whisper base multilingue, déjà converti en
  // ONNX et prêt à l'emploi, avec la langue forcée sur l'arabe.
  //
  // ➜ POUR UNE PRÉCISION CORAN NETTEMENT SUPÉRIEURE :
  //    convertir `tarteel-ai/whisper-base-ar-quran` en ONNX (via 🤗 Optimum),
  //    héberger le résultat sur Hugging Face (gratuit), puis remplacer MODEL_ID.
  //    La logique de vérification (normalisation + alignement) ne change pas.
  MODEL_ID: 'Xenova/whisper-base',
  QUANTIZED: true,
  LANGUAGE: 'arabic',
  TASK: 'transcribe',
};

// API Coran gratuite, sans clé. Sert uniquement à récupérer le TEXTE des versets
// (source fiable du mushaf — on ne code jamais le texte sacré à la main).
// Le texte est mis en cache localStorage → l'app fonctionne hors-ligne ensuite.
export const QURAN_API = 'https://api.alquran.cloud/v1';

// Périmètre du POC : Juz' 'Amma (sourates 78 → 114). Versets courts = drill idéal.
export const FOCUS_RANGE = { from: 78, to: 114 };

// Seuil de réussite d'un verset (proportion de mots corrects).
export const PASS_THRESHOLD = 0.8;

// Mode streaming (réciter du verset de départ jusqu'à la fin de la sourate).
//
// On NE s'appuie PAS sur les pauses (un récitant peut enchaîner sans silence).
// À la place : un tampon audio qui défile, re-transcrit en continu ; on valide
// ("commit") un mot dès qu'il réapparaît identique entre deux transcriptions
// successives (overlap-commit / LocalAgreement). Chaque mot validé est aligné
// sur le texte attendu autour d'un curseur qui avance. Aucune dépendance au
// silence.
export const STREAM = {
  HOP_MS: 2000,         // fréquence de re-transcription du tampon défilant
  MAX_BUFFER_SEC: 16,   // au-delà, on rogne l'audio déjà validé (via timestamps)
  RMS_GATE: 0.006,      // en dessous = silence pur → on saute la transcription (anti-hallucination)
  WINDOW_SLACK: 12,     // tokens attendus examinés au-delà de la longueur récitée
};

export const STORAGE_KEYS = {
  learned: 'yafhas.learned',    // sourates cochées comme mémorisées
  srs: 'yafhas.srs',            // état de répétition espacée, par verset
  surahCache: 'yafhas.surah.',  // préfixe du cache texte des sourates
  meta: 'yafhas.meta',          // liste des 114 sourates (métadonnées)
};
