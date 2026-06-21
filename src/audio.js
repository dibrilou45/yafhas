// Captation micro CONTINUE pour le mode streaming.
// On accumule l'audio dans un tampon défilant ; le streamer le re-transcrit
// régulièrement et peut le rogner (trimSeconds) une fois des mots validés.
// Tout reste local au navigateur ; rien n'est envoyé sur le réseau.

let cap = null;

export async function startCapture() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  cap = { samples: [], rate: ctx.sampleRate, stream, ctx, source, processor };

  processor.onaudioprocess = (e) => {
    const b = e.inputBuffer.getChannelData(0);
    // Concatène le bloc courant au tampon.
    const arr = cap.samples;
    for (let i = 0; i < b.length; i++) arr.push(b[i]);
  };
  source.connect(processor);
  processor.connect(ctx.destination);
}

// Renvoie le tampon courant ré-échantillonné en 16 kHz + son énergie (RMS),
// pour décider de transcrire ou non (silence pur → on saute).
export async function getChunk16k() {
  if (!cap || cap.samples.length === 0) return null;
  const f = Float32Array.from(cap.samples);
  let sum = 0;
  for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
  const rms = Math.sqrt(sum / f.length);
  const audio = await resampleTo16k(f, cap.rate);
  return { audio, rms, durationSec: f.length / cap.rate };
}

// Coupe les `sec` premières secondes du tampon (audio déjà validé).
export function trimSeconds(sec) {
  if (!cap) return;
  const drop = Math.floor(sec * cap.rate);
  if (drop > 0) cap.samples.splice(0, Math.min(drop, cap.samples.length));
}

export async function stopCapture() {
  if (!cap) return;
  try {
    cap.processor.disconnect();
    cap.processor.onaudioprocess = null;
    cap.source.disconnect();
    cap.stream.getTracks().forEach((t) => t.stop());
    await cap.ctx.close();
  } finally {
    cap = null;
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
