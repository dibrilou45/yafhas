// Répétition espacée (système de Leitner simplifié).
// C'est ce qui rend la révision EFFICACE : on ne re-propose pas au hasard, on cible
// les versets anciens/fragiles. Chaque verset progresse dans des "boîtes" ; une
// réussite le fait monter (intervalle plus long), une erreur le ramène à zéro.

import { STORAGE_KEYS } from './config.js';

const DAY = 24 * 3600 * 1000;
// Intervalle (en jours) avant de revoir un verset, selon sa boîte.
const INTERVALS = [0, 1, 3, 7, 16, 35];

export function loadSrs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.srs)) || {}; }
  catch { return {}; }
}

export function saveSrs(srs) {
  localStorage.setItem(STORAGE_KEYS.srs, JSON.stringify(srs));
}

export function keyOf(surah, ayah) {
  return `${surah}:${ayah}`;
}

// Enregistre un passage : success=true → monte d'une boîte, sinon retour boîte 0.
export function review(srs, surah, ayah, success) {
  const key = keyOf(surah, ayah);
  const now = Date.now();
  const cur = srs[key] || { box: 0, seen: 0 };
  const box = success ? Math.min(cur.box + 1, INTERVALS.length - 1) : 0;
  srs[key] = {
    box,
    due: now + INTERVALS[box] * DAY,
    seen: (cur.seen || 0) + 1,
    last: now,
  };
  return srs;
}

// Choisit le prochain verset à réviser parmi les candidats :
// priorité aux jamais-vus, puis aux plus en retard. Un peu d'aléa pour ne pas
// toujours tomber sur le même.
export function pickDue(srs, candidates) {
  const now = Date.now();
  const shuffled = candidates.slice().sort(() => Math.random() - 0.5);
  let best = null;
  let bestScore = -Infinity;
  for (const c of shuffled) {
    const st = srs[keyOf(c.surah, c.ayah)];
    const overdue = st ? now - st.due : Number.POSITIVE_INFINITY; // jamais vu = max
    if (overdue > bestScore) { bestScore = overdue; best = c; }
  }
  return best;
}
