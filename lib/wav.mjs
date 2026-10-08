// Minimal PCM16 WAV read/write, plus tiny synth helpers for placeholders. Stdlib only.
import fs from 'node:fs';

export function writeWav(file, samples, sampleRate = 44100) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}

// Reads mono or stereo PCM16 WAV; returns mono Float32Array.
export function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file} is not a WAV file`);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(off + 8), channels: buf.readUInt16LE(off + 10), sampleRate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') { data = buf.subarray(off + 8, off + 8 + size); break; }
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`${file}: missing fmt or data chunk`);
  if (fmt.format !== 1 || fmt.bits !== 16) throw new Error(`${file}: only PCM 16-bit WAV is supported here (convert with ffmpeg)`);
  const frames = Math.floor(data.length / (2 * fmt.channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < fmt.channels; c++) s += data.readInt16LE((i * fmt.channels + c) * 2);
    out[i] = s / fmt.channels / 32768;
  }
  return { samples: out, sampleRate: fmt.sampleRate };
}

export function wavDuration(file) {
  const { samples, sampleRate } = readWav(file);
  return samples.length / sampleRate;
}

// A soft "speech-like" beep per word: a placeholder for real TTS, so timing can be tested end to end.
export function beepWords(wordDurations, sampleRate = 44100, freq = 220) {
  const total = wordDurations.reduce((a, b) => a + b, 0);
  const out = new Float32Array(Math.ceil(total * sampleRate));
  let t0 = 0;
  wordDurations.forEach((d, idx) => {
    const start = Math.floor(t0 * sampleRate);
    const len = Math.floor(d * 0.8 * sampleRate);
    const f = freq * (1 + 0.08 * (idx % 3));
    for (let i = 0; i < len && start + i < out.length; i++) {
      const env = Math.sin(Math.PI * (i / len));
      const t = i / sampleRate;
      out[start + i] = 0.35 * env * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * 2 * f * t));
    }
    t0 += d;
  });
  return out;
}

// A quiet four-chord pad: placeholder music bed (original, trivial, MIT).
export function padBed(seconds, sampleRate = 44100) {
  const chords = [[261.63, 329.63, 392.0], [220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66]];
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  const chordLen = 2.0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const ci = Math.floor(t / chordLen) % chords.length;
    const local = (t % chordLen) / chordLen;
    const env = Math.min(1, local * 6) * Math.min(1, (1 - local) * 6);
    let s = 0;
    for (const f of chords[ci]) s += Math.sin(2 * Math.PI * f * t) + 0.2 * Math.sin(2 * Math.PI * f * 2 * t);
    out[i] = 0.12 * env * s / chords[ci].length;
  }
  return out;
}

export function silence(seconds, sampleRate = 44100) {
  return new Float32Array(Math.max(0, Math.round(seconds * sampleRate)));
}

export function concatSamples(parts) {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
