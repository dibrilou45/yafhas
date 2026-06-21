// Moteur de vérification STREAMING à curseur ancré.
//
// Idée : on connaît tout le texte attendu (verset de départ → fin de sourate).
// On ne fait jamais de transcription "ouverte" : on suit une POSITION (curseur)
// dans ce texte connu. À chaque segment récité (un bout entre deux pauses), on
// l'aligne sur une petite fenêtre autour du curseur et on avance. Comme on se
// ré-ancre à chaque pause, la dérive de l'ASR ne peut pas s'accumuler.

import { streamAlign, align, statusPerExpected } from './align.js';

export function createEngine(passage) {
  // passage : { tokens:[{orig, norm, ayah}], verses:[{ayah, start, end}] }
  const expected = passage.tokens.map((t) => t.norm);
  const status = new Array(expected.length).fill('pending');
  let cursor = 0;

  // Traite un segment récité (tokens normalisés). Renvoie un résumé de l'avancée.
  function processSegment(hyp, slack) {
    if (!hyp.length) return { advanced: 0, lowConfidence: true };

    const winEnd = Math.min(expected.length, cursor + hyp.length + slack);
    const window = expected.slice(cursor, winEnd);
    const res = streamAlign(window, hyp);

    // Garde-fou : sans aucun mot correct, on considère que c'est du bruit ou
    // une récitation hors fenêtre → on n'avance pas (on attend la prochaine pause).
    if (res.matched === 0) return { advanced: 0, lowConfidence: true };

    for (let k = 0; k < res.status.length; k++) {
      status[cursor + k] = res.status[k];
    }
    cursor += res.consumed;
    return {
      advanced: res.consumed,
      matched: res.matched,
      extras: res.extras,
      lowConfidence: false,
    };
  }

  // Mode "une seule passe" : on aligne TOUTE la récitation sur TOUT le passage
  // avec l'alignement global (Needleman-Wunsch) — bien plus robuste qu'un
  // alignement à fin libre quand l'hypothèse est longue et bruitée.
  function applyGlobal(hyp) {
    const ops = align(expected, hyp);
    const st = statusPerExpected(expected.length, ops);
    for (let i = 0; i < expected.length; i++) status[i] = st[i];
    cursor = expected.length;
  }

  // À l'arrêt : tout ce qui reste après le curseur n'a pas été récité = manquant.
  function finalize() {
    for (let i = cursor; i < status.length; i++) {
      if (status[i] === 'pending') status[i] = 'missing';
    }
  }

  return {
    passage,
    processSegment,
    applyGlobal,
    finalize,
    getStatus: () => status,
    getCursor: () => cursor,
    isDone: () => cursor >= expected.length,
    total: expected.length,
  };
}
