// Reconnaissance vocale exécutée DANS le navigateur via transformers.js.
// Le modèle ONNX est téléchargé une seule fois (puis mis en cache par le navigateur),
// et l'inférence se fait sur l'appareil de l'utilisateur → aucun coût serveur.

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
import { ASR } from './config.js';

// On n'utilise que des modèles distants (Hugging Face) + cache navigateur.
env.allowLocalModels = false;
env.useBrowserCache = true;

let _pipe = null;

export async function getTranscriber(progressCallback) {
  if (!_pipe) {
    _pipe = await pipeline('automatic-speech-recognition', ASR.MODEL_ID, {
      quantized: ASR.QUANTIZED,
      progress_callback: progressCallback,
    });
  }
  return _pipe;
}

export async function transcribe(float32, progressCallback) {
  const transcriber = await getTranscriber(progressCallback);
  const out = await transcriber(float32, {
    language: ASR.LANGUAGE,
    task: ASR.TASK,
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  return (out.text || '').trim();
}

// Transcription MOT À MOT avec timestamps (utilisée par le streamer overlap-commit).
// Renvoie [{ text, start, end }] (temps en secondes, relatifs au tampon fourni).
export async function transcribeWords(float32, progressCallback) {
  const transcriber = await getTranscriber(progressCallback);
  const out = await transcriber(float32, {
    language: ASR.LANGUAGE,
    task: ASR.TASK,
    return_timestamps: 'word',
    chunk_length_s: 30,
  });
  const chunks = out.chunks || [];
  return chunks
    .map((c) => ({
      text: (c.text || '').trim(),
      start: c.timestamp && c.timestamp[0] != null ? c.timestamp[0] : 0,
      end: c.timestamp && c.timestamp[1] != null ? c.timestamp[1] : 0,
    }))
    .filter((w) => w.text);
}
