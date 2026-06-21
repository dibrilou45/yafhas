// Récupération du texte du Coran via une API gratuite (sans clé), avec cache
// localStorage. On ne code JAMAIS le texte sacré à la main : la source de vérité
// est le mushaf Uthmani renvoyé par l'API. Après le premier chargement, tout est
// servi depuis le cache → fonctionne hors-ligne.

import { QURAN_API, STORAGE_KEYS } from './config.js';
import { tokenize, tokenizePairs } from './normalize.js';

// Basmala normalisée : sert à détecter/retirer le préfixe que l'édition Uthmani
// ajoute parfois au 1er verset des sourates (sauf Al-Fatiha, où elle est le verset 1).
const BASMALA = tokenize('بسم الله الرحمن الرحيم');

export async function getSurahList() {
  const cached = localStorage.getItem(STORAGE_KEYS.meta);
  if (cached) { try { return JSON.parse(cached); } catch {} }
  const res = await fetch(`${QURAN_API}/surah`);
  const json = await res.json();
  const list = json.data.map((s) => ({
    number: s.number,
    name: s.name,                       // nom arabe
    en: s.englishName,                  // translittération
    tr: s.englishNameTranslation,       // sens
    ayahs: s.numberOfAyahs,
  }));
  localStorage.setItem(STORAGE_KEYS.meta, JSON.stringify(list));
  return list;
}

export async function getSurah(n) {
  const ck = STORAGE_KEYS.surahCache + n;
  const cached = localStorage.getItem(ck);
  if (cached) { try { return JSON.parse(cached); } catch {} }
  const res = await fetch(`${QURAN_API}/surah/${n}/quran-uthmani`);
  const json = await res.json();
  const ayahs = json.data.ayahs.map((a) => ({
    number: a.numberInSurah,
    text: a.text,
  }));
  const data = { number: n, name: json.data.name, ayahs };
  localStorage.setItem(ck, JSON.stringify(data));
  return data;
}

// Retourne le verset prêt pour le drill : jetons appariés {orig, norm}, basmala
// retirée si elle a été préfixée au 1er verset (hors sourate 1).
export function prepareAyah(surahNumber, ayahText) {
  let pairs = tokenizePairs(ayahText);
  if (surahNumber !== 1 && pairs.length > BASMALA.length) {
    const head = pairs.slice(0, BASMALA.length).map((p) => p.norm);
    if (head.every((w, i) => w === BASMALA[i])) {
      pairs = pairs.slice(BASMALA.length);
    }
  }
  return pairs;
}
