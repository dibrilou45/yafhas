// Capture micro → signal mono 16 kHz (format attendu par Whisper).
// Tout reste local au navigateur ; l'audio n'est jamais envoyé nulle part.

let mediaRecorder = null;
let chunks = [];
let stream = null;

export async function startRecording() {
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  chunks = [];
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  mediaRecorder.start();
}

export function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder) { reject(new Error('Aucun enregistrement en cours')); return; }
    mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach((t) => t.stop());
        resolve(await decodeToMono16k(await blob.arrayBuffer()));
      } catch (e) { reject(e); }
    };
    mediaRecorder.stop();
  });
}

async function decodeToMono16k(arrayBuffer) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const decoded = await ctx.decodeAudioData(arrayBuffer);
  ctx.close();

  const targetRate = 16000;
  const frames = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const off = new OfflineAudioContext(1, frames, targetRate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  return rendered.getChannelData(0);
}
