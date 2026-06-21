// Orchestration + interface de Yafhas.
// Flux : onboarding (cocher les sourates mémorisées) → drill (on affiche le début
// d'un verset, l'utilisateur le complète de mémoire à voix haute) → résultat
// (chaque mot surligné juste/faux/manquant) → verset suivant (choisi par la
// répétition espacée).

import { FOCUS_RANGE, PASS_THRESHOLD, STORAGE_KEYS } from './config.js';
import { tokenize } from './normalize.js';
import { getSurahList, getSurah, prepareAyah } from './quran.js';
import { startRecording, stopRecording } from './audio.js';
import { transcribe } from './asr.js';
import { align, statusPerExpected, score, extras } from './align.js';
import { loadSrs, saveSrs, review, pickDue } from './srs.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  list: [],
  learned: new Set(),
  srs: loadSrs(),
  current: null,   // { surah, surahName, ayah, pairs, cueCount }
  recording: false,
  modelReady: false,
};

// ---------- Persistance des sourates apprises ----------

function loadLearned() {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE_KEYS.learned)) || [];
    state.learned = new Set(arr);
  } catch { state.learned = new Set(); }
}
function saveLearned() {
  localStorage.setItem(STORAGE_KEYS.learned, JSON.stringify([...state.learned]));
}

// ---------- Vues ----------

function show(view) {
  for (const v of ['onboarding', 'revision']) {
    $('#' + v).hidden = v !== view;
  }
}

function renderOnboarding() {
  const focus = state.list.filter(
    (s) => s.number >= FOCUS_RANGE.from && s.number <= FOCUS_RANGE.to
  );
  const grid = $('#surah-grid');
  grid.innerHTML = '';
  for (const s of focus) {
    const checked = state.learned.has(s.number);
    const label = document.createElement('label');
    label.className = 'surah' + (checked ? ' is-on' : '');
    label.innerHTML = `
      <input type="checkbox" ${checked ? 'checked' : ''} data-n="${s.number}">
      <span class="surah-name" lang="ar" dir="rtl">${s.name}</span>
      <span class="surah-meta">${s.number} · ${s.en} · ${s.ayahs} v.</span>`;
    grid.appendChild(label);
  }
  updateStartButton();
}

function updateStartButton() {
  const btn = $('#start-btn');
  const n = state.learned.size;
  btn.disabled = n === 0;
  btn.textContent = n === 0
    ? 'Cochez au moins une sourate'
    : `Réviser (${n} sourate${n > 1 ? 's' : ''})`;
}

// ---------- Drill ----------

function learnedCandidates() {
  const out = [];
  for (const num of state.learned) {
    const meta = state.list.find((s) => s.number === num);
    if (!meta) continue;
    for (let a = 1; a <= meta.ayahs; a++) out.push({ surah: num, ayah: a });
  }
  return out;
}

async function nextDrill() {
  const candidates = learnedCandidates();
  if (!candidates.length) { show('onboarding'); return; }

  const pick = pickDue(state.srs, candidates);
  setStatus('Chargement du verset…');

  const surah = await getSurah(pick.surah);
  const meta = state.list.find((s) => s.number === pick.surah);
  const ayahObj = surah.ayahs.find((a) => a.number === pick.ayah) || surah.ayahs[0];
  const pairs = prepareAyah(pick.surah, ayahObj.text);

  // Indice : on dévoile les 1 à 2 premiers mots, l'utilisateur complète le reste.
  const cueCount = Math.min(pairs.length <= 3 ? 1 : 2, pairs.length);

  state.current = {
    surah: pick.surah,
    surahName: meta ? meta.name : '',
    surahEn: meta ? meta.en : '',
    ayah: ayahObj.number,
    pairs,
    cueCount,
  };

  renderDrill();
}

function renderDrill() {
  const c = state.current;
  $('#drill-surah').textContent = c.surahEn;
  $('#drill-surah-ar').textContent = c.surahName;
  $('#drill-ayah').textContent = `verset ${c.ayah}`;

  // Verset masqué : indice visible, reste caché sous des pastilles.
  const verse = $('#verse');
  verse.innerHTML = '';
  verse.dataset.state = 'masked';
  c.pairs.forEach((p, i) => {
    const span = document.createElement('span');
    span.className = 'word';
    if (i < c.cueCount) {
      span.classList.add('cue');
      span.textContent = p.orig;
    } else {
      span.classList.add('masked');
      span.textContent = '•'.repeat(Math.max(2, [...p.norm].length));
    }
    verse.appendChild(span);
    verse.appendChild(document.createTextNode(' '));
  });

  $('#result-note').textContent = '';
  setStatus('Récitez le verset à partir de l’indice, puis arrêtez.');
  setRecordButton('idle');
}

function revealResult(status, extraWords) {
  const c = state.current;
  const verse = $('#verse');
  verse.dataset.state = 'revealed';
  [...verse.querySelectorAll('.word')].forEach((span, i) => {
    span.className = 'word';
    span.textContent = c.pairs[i].orig;
    if (i < c.cueCount) { span.classList.add('cue'); return; }
    span.classList.add(status[i] || 'missing');
  });

  const ratio = score(status);
  const pct = Math.round(ratio * 100);
  const success = ratio >= PASS_THRESHOLD;

  state.srs = review(state.srs, c.surah, c.ayah, success);
  saveSrs(state.srs);

  let note = success
    ? `Bien — ${pct}% de mots corrects.`
    : `À retravailler — ${pct}% de mots corrects.`;
  if (extraWords.length) note += ` (mots en trop : ${extraWords.length})`;
  $('#result-note').textContent = note;
  setStatus(success ? 'Verset validé. Au suivant quand vous voulez.' : 'On le reverra bientôt.');
}

// ---------- Enregistrement + reconnaissance ----------

async function onRecordClick() {
  if (state.recording) {
    setRecordButton('working');
    setStatus('Analyse de la récitation…');
    state.recording = false;
    let float;
    try {
      float = await stopRecording();
    } catch (e) {
      setStatus('Micro indisponible : ' + e.message);
      setRecordButton('idle');
      return;
    }
    try {
      const text = await transcribe(float, onModelProgress);
      state.modelReady = true;
      hideProgress();
      const hyp = tokenize(text);
      const expected = state.current.pairs.map((p) => p.norm);
      const ops = align(expected, hyp);
      const status = statusPerExpected(expected.length, ops);
      revealResult(status, extras(ops));
    } catch (e) {
      hideProgress();
      setStatus('Erreur de reconnaissance : ' + e.message);
    }
    setRecordButton('done');
    return;
  }

  // Démarrage
  try {
    await startRecording();
    state.recording = true;
    setRecordButton('recording');
    if (!state.modelReady) setStatus('Récitez… (le modèle se charge en arrière-plan au 1er usage)');
    else setStatus('Récitez… appuyez pour arrêter.');
  } catch (e) {
    setStatus('Accès micro refusé : ' + e.message);
  }
}

// ---------- Petits utilitaires d'UI ----------

function setStatus(msg) { $('#status').textContent = msg; }

function setRecordButton(mode) {
  const btn = $('#record-btn');
  btn.classList.remove('recording', 'working');
  btn.disabled = false;
  if (mode === 'idle') { btn.textContent = '● Réciter'; }
  else if (mode === 'recording') { btn.textContent = '■ Arrêter'; btn.classList.add('recording'); }
  else if (mode === 'working') { btn.textContent = '…'; btn.classList.add('working'); btn.disabled = true; }
  else if (mode === 'done') { btn.textContent = '● Recommencer'; }
}

function onModelProgress(p) {
  if (p.status === 'progress' && p.total) {
    showProgress(`Téléchargement du modèle… ${Math.round((p.loaded / p.total) * 100)}%`);
  } else if (p.status === 'ready' || p.status === 'done') {
    hideProgress();
  }
}
function showProgress(msg) { const el = $('#progress'); el.hidden = false; el.textContent = msg; }
function hideProgress() { $('#progress').hidden = true; }

// ---------- Init ----------

async function init() {
  loadLearned();
  setStatus('');

  $('#surah-grid').addEventListener('change', (e) => {
    const cb = e.target.closest('input[type=checkbox]');
    if (!cb) return;
    const n = Number(cb.dataset.n);
    if (cb.checked) state.learned.add(n); else state.learned.delete(n);
    cb.closest('.surah').classList.toggle('is-on', cb.checked);
    saveLearned();
    updateStartButton();
  });

  $('#start-btn').addEventListener('click', async () => {
    show('revision');
    await nextDrill();
  });
  $('#back-btn').addEventListener('click', () => { renderOnboarding(); show('onboarding'); });
  $('#next-btn').addEventListener('click', () => nextDrill());
  $('#reveal-btn').addEventListener('click', () => {
    const c = state.current;
    if (!c) return;
    revealResult(new Array(c.pairs.length).fill('missing'), []);
  });
  $('#record-btn').addEventListener('click', onRecordClick);

  try {
    state.list = await getSurahList();
    renderOnboarding();
  } catch (e) {
    setStatus('Impossible de charger la liste des sourates (réseau ?).');
  }
}

init();
