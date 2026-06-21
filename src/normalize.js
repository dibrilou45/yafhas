// Normalisation du texte arabe pour la COMPARAISON (pas pour l'affichage).
// Objectif : rendre l'alignement robuste aux différences de diacritiques (tashkeel),
// de variantes de hamza/alef, etc., entre le texte du mushaf et la sortie de l'ASR.

// Diacritiques, signes coraniques d'annotation, tatweel.
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ࣓-ࣿـ]/g;

export function normalizeWord(word) {
  if (!word) return '';
  let t = word.normalize('NFC');
  t = t.replace(MARKS, '');
  t = t.replace(/[آأإٱ]/g, 'ا'); // آ أ إ ٱ → ا
  t = t.replace(/ى/g, 'ي');                     // ى → ي
  t = t.replace(/ة/g, 'ه');                     // ة → ه
  t = t.replace(/ؤ/g, 'و');                     // ؤ → و
  t = t.replace(/ئ/g, 'ي');                     // ئ → ي
  // On ne garde que les lettres arabes (le reste — ponctuation, chiffres — disparaît).
  t = t.replace(/[^ء-ي]/g, '');
  return t;
}

export function normalizeText(text) {
  return (text || '')
    .split(/\s+/)
    .map(normalizeWord)
    .filter(Boolean)
    .join(' ');
}

export function tokenize(text) {
  const n = normalizeText(text);
  return n ? n.split(' ') : [];
}

// Découpe un verset en gardant l'appariement {affichage original ↔ forme normalisée}.
// Les jetons dont la forme normalisée est vide (ponctuation isolée) sont écartés.
export function tokenizePairs(text) {
  const pairs = [];
  for (const raw of (text || '').split(/\s+/)) {
    if (!raw) continue;
    const norm = normalizeWord(raw);
    if (norm) pairs.push({ orig: raw, norm });
  }
  return pairs;
}
