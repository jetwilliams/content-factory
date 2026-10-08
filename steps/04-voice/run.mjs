// Step 4 · voice: script.json → voice.wav + voice.json (segment times, word times when available).
import fs from 'node:fs';
import path from 'node:path';
import { writeJson, round } from '../../lib/util.mjs';
import { loadProvider, providerName } from '../../lib/providers.mjs';
import { loadScript, segmentsOf } from '../../lib/script-schema.mjs';
import { readWav, writeWav, silence, concatSamples } from '../../lib/wav.mjs';
import { runCmd, hasBinary } from '../../lib/ffmpeg.mjs';
import { stepMain } from '../../lib/step-cli.mjs';

const RATE = 44100;

async function normalise(file) {
  try {
    const w = readWav(file);
    if (w.sampleRate === RATE) return w.samples;
  } catch { /* not PCM16, or another format: convert below */ }
  if (!(await hasBinary('ffmpeg'))) throw new Error(`${path.basename(file)} needs converting to 44.1 kHz PCM16 and ffmpeg is not installed`);
  const out = file.replace(/\.\w+$/, '.norm.wav');
  await runCmd('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-ac', '1', '-ar', String(RATE), '-c:a', 'pcm_s16le', out]);
  return readWav(out).samples;
}

export async function run(ctx) {
  const script = await loadScript(ctx);
  const name = providerName('tts', ctx);
  const tts = await loadProvider('tts', name);
  const gap = Number(ctx.config.voice?.gapSec ?? 0.12);
  const tail = Number(ctx.config.voice?.tailSec ?? 0.4);
  fs.mkdirSync(ctx.file('voice'), { recursive: true });

  const parts = [];
  const segments = [];
  let t = 0;
  for (const seg of segmentsOf(script)) {
    const outFile = path.join(ctx.file('voice'), `${seg.id}.wav`);
    const res = await tts.synth({ text: seg.voice, outFile, config: ctx.config, log: ctx.log });
    const samples = await normalise(res.file);
    const dur = samples.length / RATE;
    const entry = { id: seg.id, text: seg.voice, start: round(t), end: round(t + dur) };
    if (Array.isArray(res.words) && res.words.length) {
      entry.words = res.words.map((w) => ({ word: w.word, start: round(t + w.start), end: round(t + w.end) }));
    }
    segments.push(entry);
    parts.push(samples, silence(gap, RATE));
    t += dur + gap;
    ctx.log.info(`${seg.id}: ${dur.toFixed(2)}s`);
  }
  parts.push(silence(Math.max(0, tail - gap), RATE));
  const all = concatSamples(parts);
  writeWav(ctx.file('voice.wav'), all, RATE);
  const duration = round(all.length / RATE);
  writeJson(ctx.file('voice.json'), {
    provider: name, licence: tts.licence || 'unknown', duration, gapSec: gap, tailSec: tail,
    wordTimings: segments.some((s) => s.words) ? 'engine' : 'even-split', segments,
  });
  return { outputs: ['voice.wav', 'voice.json'], note: `voice ${duration}s via ${name}` };
}

stepMain(import.meta.url, 'voice', run);
