// Streamer "overlap-commit" (LocalAgreement) — ne dépend d'AUCUNE pause.
//
// Boucle : toutes les HOP_MS, on re-transcrit le tampon audio défilant. Un mot
// n'est VALIDÉ que lorsqu'il réapparaît à l'identique entre deux transcriptions
// successives (préfixe commun) — ce qui filtre l'instabilité du bord sans jamais
// attendre un silence. Les mots validés sont transmis à `onCommit`, puis l'audio
// correspondant est rogné (via leurs timestamps) pour garder le tampon court.

import { getChunk16k, trimSeconds } from './audio.js';
import { transcribeWords } from './asr.js';
import { normalizeWord } from './normalize.js';
import { STREAM } from './config.js';

function commonPrefix(a, b) {
  let i = 0;
  const n = Math.min(a.length, b.length);
  while (i < n && normalizeWord(a[i].text) === normalizeWord(b[i].text)) i++;
  return i;
}

export function createStreamer({ onCommit, onProgress }) {
  let prev = [];           // transcription du tour précédent (même base de temps)
  let committed = 0;       // nb de mots déjà validés dans le tampon courant
  let running = false;
  let timer = null;
  let busy = false;

  async function tick() {
    if (!running || busy) { schedule(); return; }
    busy = true;
    try {
      const chunk = await getChunk16k();
      if (chunk && chunk.audio.length && chunk.rms >= STREAM.RMS_GATE) {
        const words = await transcribeWords(chunk.audio, onProgress);
        const agreed = commonPrefix(words, prev);
        if (agreed > committed) {
          onCommit(words.slice(committed, agreed).map((w) => w.text));
          committed = agreed;
        }
        prev = words;

        // Rognage : si le tampon devient long, on coupe l'audio déjà validé.
        if (chunk.durationSec > STREAM.MAX_BUFFER_SEC && committed > 0) {
          const cut = words[committed - 1].end;
          if (cut > 1) { trimSeconds(cut); prev = []; committed = 0; }
        }
      }
    } catch (e) {
      // On ignore l'erreur d'un tour (réseau modèle, etc.) — le tour suivant réessaie.
    } finally {
      busy = false;
      schedule();
    }
  }

  function schedule() {
    if (running) timer = setTimeout(tick, STREAM.HOP_MS);
  }

  return {
    start() {
      running = true; prev = []; committed = 0;
      schedule();
    },
    // Arrêt : transcription finale du tampon restant → on valide TOUT (plus de futur).
    async stop() {
      running = false;
      if (timer) clearTimeout(timer);
      while (busy) await new Promise((r) => setTimeout(r, 50));
      try {
        const chunk = await getChunk16k();
        if (chunk && chunk.audio.length && chunk.rms >= STREAM.RMS_GATE) {
          const words = await transcribeWords(chunk.audio, onProgress);
          if (words.length > committed) {
            onCommit(words.slice(committed).map((w) => w.text));
          }
        }
      } catch (e) { /* ignore */ }
    },
  };
}
