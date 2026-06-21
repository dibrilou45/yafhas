// Orchestration + interface de Yafhas (mode streaming).
// Flux : onboarding (cocher les sourates mémorisées) → drill (on affiche le début
// d'un verset, l'utilisateur récite EN CONTINU jusqu'à la fin de la sourate) →
// validation live mot à mot (overlap-commit + curseur ancré) → sourate suivante.

import { FOCUS_RANGE, PASS_THRESHOLD, STORAGE_KEYS } from './config.js';
import { tokenize } from './normalize.js';
import { getSurahList, getSurah, buildPassage } from './quran.js';
import { startRecording, stopRecording, getPartial16k } from './audio.js';
import { transcribe } from './asr.js';
import { createEngine } from './engine.js';
import { loadSrs, saveSrs, review, pickDue } from './srs.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  list: [],
  learned: new Set(),
  srs: loadSrs(),
  current: null,   // { surah, surahName, surahEn, startAyah }
  engine: null,
  cueEnd: 0,
  recording: false,
  modelReady: false,
  liveTimer: null,
  ticking: false,
};

const HOP_MS = 2500; // fréquence de re-transcription en direct

// ---------- Persistance des sourates apprises ----------

function loadLearned() {
  try {
    state.learned = new Set(JSON.parse(localStorage.getItem(STORAGE_KEYS.learned)) || []);
  } catch { state.learned = new Set(); }
}
function saveLearned() {
  localStorage.setItem(STORAGE_KEYS.learned, JSON.stringify([...state.learned]));
}

// ---------- Vues ----------

function show(view) {
  for (const v of ['onboarding', 'revision']) $('#' + v).hidden = v !== view;
}

function renderOnboarding() {
  const focus = state.list.filter((s) => s.number >= FOCUS_RANGE.from && s.number <= FOCUS_RANGE.to);
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
  btn.textContent = n === 0 ? 'Cochez au moins une sourate' : `Réviser (${n} sourate${n > 1 ? 's' : ''})`;
}

// ---------- Choix du passage à réviser ----------

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
  if (state.liveTimer) { clearInterval(state.liveTimer); state.liveTimer = null; }
  state.recording = false;
  const candidates = learnedCandidates();
  if (!candidates.length) { show('onboarding'); return; }

  const pick = pickDue(state.srs, candidates);
  setStatus('Chargement de la sourate…');

  const surah = await getSurah(pick.surah);
  const meta = state.list.find((s) => s.number === pick.surah);
  const passage = buildPassage(pick.surah, pick.ayah, surah.ayahs);

  state.engine = createEngine(passage);
  state.current = {
    surah: pick.surah,
    surahName: meta ? meta.name : '',
    surahEn: meta ? meta.en : '',
    startAyah: pick.ayah,
  };

  // Indice : 1 à 2 premiers mots du verset de départ.
  const v0 = passage.verses[0];
  const firstLen = v0.end - v0.start;
  state.cueEnd = v0.start + Math.min(firstLen <= 3 ? 1 : 2, firstLen);

  $('#drill-surah').textContent = meta ? meta.en : '';
  $('#drill-surah-ar').textContent = meta ? meta.name : '';
  $('#drill-ayah').textContent = `verset ${pick.ayah} → fin · ${passage.verses.length} v.`;

  renderPassage();
  hideDebug();
  setStatus('Récitez du verset indiqué jusqu’à la fin de la sourate.');
  setRecordButton('idle');
}

// ---------- Rendu du passage ----------

function toArabicNum(n) {
  return String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
}

function renderPassage() {
  const eng = state.engine;
  const p = eng.passage;
  const status = eng.getStatus();
  const cursor = eng.getCursor();
  const el = $('#verse');
  el.innerHTML = '';

  for (const v of p.verses) {
    for (let i = v.start; i < v.end; i++) {
      const span = document.createElement('span');
      span.className = 'word';
      const st = status[i];
      const isCue = i < state.cueEnd;
      if (isCue) {
        span.classList.add('cue');
        span.textContent = p.tokens[i].orig;
      } else if (st === 'pending' && i >= cursor) {
        span.classList.add('masked');
        span.textContent = '•'.repeat(Math.max(2, [...p.tokens[i].norm].length));
      } else {
        span.classList.add(st === 'pending' ? 'cue' : st);
        span.textContent = p.tokens[i].orig;
      }
      el.appendChild(span);
      el.appendChild(document.createTextNode(' '));
    }
    const mark = document.createElement('span');
    mark.className = 'ayah-mark';
    mark.textContent = '۝' + toArabicNum(v.ayah);
    el.appendChild(mark);
    el.appendChild(document.createTextNode(' '));
  }
}

// ---------- Reconnaissance en direct (re-transcription périodique) ----------

async function liveTick() {
  if (!state.recording || state.ticking) return;
  state.ticking = true;
  try {
    const part = await getPartial16k();
    if (part && part.audio.length) {
      const text = await transcribe(part.audio, onModelProgress);
      state.modelReady = true;
      hideProgress();
      showDebug(text);
      const hyp = tokenize(text);
      if (hyp.length && state.recording) {
        state.engine.applyLive(hyp);
        renderPassage();
        setStatus('Reconnaissance en direct…');
      }
    }
  } catch { /* on réessaie au tick suivant */ }
  finally { state.ticking = false; }
}

// ---------- Enregistrement + reconnaissance (analyse finale à l'arrêt) ----------

async function onRecordClick() {
  if (!state.recording) {
    try {
      await startRecording();
    } catch (e) {
      setStatus('Accès micro refusé : ' + e.message);
      return;
    }
    state.recording = true;
    setRecordButton('recording');
    hideDebug();
    state.liveTimer = setInterval(liveTick, HOP_MS);
    setStatus(state.modelReady
      ? 'Récitez… les mots s’allument au fur et à mesure.'
      : 'Récitez… (le modèle se charge au 1er usage)');
    return;
  }

  // Arrêt → on stoppe le live, on transcrit tout une dernière fois, on aligne.
  state.recording = false;
  if (state.liveTimer) { clearInterval(state.liveTimer); state.liveTimer = null; }
  while (state.ticking) await new Promise((r) => setTimeout(r, 60));
  setRecordButton('working');
  let rec;
  try {
    rec = await stopRecording();
  } catch (e) {
    setStatus('Problème micro : ' + e.message);
    setRecordButton('idle');
    return;
  }
  if (!rec.audio.length) {
    setStatus(`Aucun son capté (${rec.bytes || 0} o). Vérifiez l’autorisation du micro.`);
    setRecordButton('done');
    return;
  }

  if (!state.modelReady) showProgress('Préparation du modèle…');
  setStatus(`Analyse de la récitation… (${rec.durationSec.toFixed(1)} s captées)`);
  try {
    const text = await transcribe(rec.audio, onModelProgress);
    state.modelReady = true;
    hideProgress();
    showDebug(text);

    const hyp = tokenize(text);
    if (!hyp.length) {
      setStatus('Aucune parole arabe reconnue — parlez plus près du micro, ou réessayez.');
      setRecordButton('done');
      return;
    }
    // Alignement global du passage : toute la récitation alignée sur tout le texte.
    state.engine.applyGlobal(hyp);
    renderPassage();
    finalizePassage();
  } catch (e) {
    hideProgress();
    setStatus('Erreur de reconnaissance : ' + e.message);
  }
  setRecordButton('done');
}

function finalizePassage() {
  const eng = state.engine;
  eng.finalize();
  renderPassage();

  const status = eng.getStatus();
  // Répétition espacée : un verset est réussi si la plupart de ses mots sont corrects.
  for (const v of eng.passage.verses) {
    let correct = 0;
    const total = v.end - v.start;
    for (let i = v.start; i < v.end; i++) if (status[i] === 'correct') correct++;
    const ok = total ? correct / total >= PASS_THRESHOLD : false;
    state.srs = review(state.srs, state.current.surah, v.ayah, ok);
  }
  saveSrs(state.srs);

  const total = status.length;
  const correct = status.filter((s) => s === 'correct').length;
  const pct = total ? Math.round((correct / total) * 100) : 0;
  if (correct === 0) {
    setStatus('Aucun mot reconnu comme correct. Comparez avec « entendu » ci-dessous : si le texte est faux, c’est le modèle ASR qu’il faut améliorer.');
  } else {
    setStatus(`Terminé — ${pct}% des mots corrects sur ${eng.passage.verses.length} versets.`);
  }
}

// ---------- Utilitaires d'UI ----------

function setStatus(msg) { $('#status').textContent = msg; }

function setRecordButton(mode) {
  const btn = $('#record-btn');
  btn.classList.remove('recording', 'working');
  btn.disabled = false;
  if (mode === 'idle') btn.textContent = '● Réciter';
  else if (mode === 'recording') { btn.textContent = '■ Arrêter'; btn.classList.add('recording'); }
  else if (mode === 'working') { btn.textContent = '…'; btn.classList.add('working'); btn.disabled = true; }
  else if (mode === 'done') btn.textContent = '● Recommencer';
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

function showDebug(text) {
  const el = $('#debug');
  el.hidden = false;
  el.textContent = 'entendu : ' + (text && text.trim() ? text.trim() : '(rien)');
}
function hideDebug() { const el = $('#debug'); el.hidden = true; el.textContent = ''; }

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

  $('#start-btn').addEventListener('click', async () => { show('revision'); await nextDrill(); });
  $('#back-btn').addEventListener('click', () => { renderOnboarding(); show('onboarding'); });
  $('#next-btn').addEventListener('click', () => nextDrill());
  $('#reveal-btn').addEventListener('click', () => {
    state.cueEnd = state.engine ? state.engine.passage.tokens.length : 0;
    renderPassage();
  });
  $('#record-btn').addEventListener('click', onRecordClick);

  try {
    state.list = await getSurahList();
    renderOnboarding();
  } catch {
    setStatus('Impossible de charger la liste des sourates (réseau ?).');
  }
}

init();
