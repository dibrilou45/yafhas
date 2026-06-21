// Captation micro via MediaRecorder (fiable PC + mobile), pour le flux
// « enregistrer puis transcrire ». On enregistre dans un Blob, puis on décode
// en mono 16 kHz (format attendu par Whisper). Rien ne quitte le navigateur.

let mediaRecorder = null;
let chunks = [];
let stream = null;

function pickMime() {
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
    for (const c of cands) if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

export async function startRecording() {
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  chunks = [];
  const mime = pickMime();
  mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  // timeslice : on reçoit des morceaux réguliers → on peut transcrire en cours de route.
  mediaRecorder.start(1000);
}

// Transcription partielle : décode tout l'audio capté jusqu'ici (pour le live).
// Renvoie { audio, durationSec } ou null si pas encore décodable.
export async function getPartial16k() {
  if (!mediaRecorder || chunks.length === 0) return null;
  try {
    const blob = new Blob(chunks.slice(), { type: mediaRecorder.mimeType || 'audio/webm' });
    if (blob.size === 0) return null;
    const { data, rate } = await decode(await blob.arrayBuffer());
    return { audio: await resampleTo16k(data, rate), durationSec: data.length / rate };
  } catch {
    return null; // morceaux pas encore décodables (header incomplet) → on réessaiera
  }
}

// Arrête et renvoie { audio: Float32Array @16kHz, durationSec, bytes }.
export function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder) { reject(new Error('aucun enregistrement en cours')); return; }
    mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        if (stream) stream.getTracks().forEach((t) => t.stop());
        if (blob.size === 0) { resolve({ audio: new Float32Array(0), durationSec: 0, bytes: 0 }); return; }
        const { data, rate } = await decode(await blob.arrayBuffer());
        const audio = await resampleTo16k(data, rate);
        resolve({ audio, durationSec: data.length / rate, bytes: blob.size });
      } catch (e) { reject(e); }
    };
    mediaRecorder.stop();
  });
}

async function decode(arrayBuffer) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    return { data: decoded.getChannelData(0), rate: decoded.sampleRate };
  } finally {
    await ctx.close();
  }
}

async function resampleTo16k(float32, srcRate) {
  if (srcRate === 16000) return float32;
  const frames = Math.max(1, Math.ceil((float32.length * 16000) / srcRate));
  const off = new OfflineAudioContext(1, frames, 16000);
  const buf = off.createBuffer(1, float32.length, srcRate);
  buf.getChannelData(0).set(float32);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  return rendered.getChannelData(0);
}
