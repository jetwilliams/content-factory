// Step 7 · render: visuals + title plate + captions + voice + ducked music → <slug>.mp4 (1080x1920).
// Everything visual comes from the template (templates/default.template.json + jobs/<slug>/template.json).
//
// Text engines:
//   ffmpeg: drawtext (title, watermark) + libass (captions.ass). Needs an ffmpeg built with
//           libfreetype and libass. Best looking; uses your font.
//   pixel:  the built-in pixel font (lib/pixelfont.mjs) rendered to PNG overlays. Works with any
//           ffmpeg, so the pipeline never fails for lack of a text filter.
//   auto:   ffmpeg when available, otherwise pixel.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, round } from '../../lib/util.mjs';
import { loadTemplate } from '../../lib/template.mjs';
import { loadScript } from '../../lib/script-schema.mjs';
import { requireFfmpeg, ffmpegFilters, runCmd } from '../../lib/ffmpeg.mjs';
import { renderText, wrapText, measure, normaliseText } from '../../lib/pixelfont.mjs';
import { stepMain } from '../../lib/step-cli.mjs';

const VIDEO_EXT = /\.(mp4|mov|webm|m4v|mkv)$/i;

// ffmpeg colour from #RRGGBB[AA]
export function ffColour(hex) {
  const m = String(hex || '').match(/^#?([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (!m) return 'white';
  return `0x${m[1]}${m[2] ? '@' + round(parseInt(m[2], 16) / 255, 2) : ''}`;
}

// Quote a value for use inside a filtergraph option (paths: forward slashes; avoid ':' and quotes in names).
const fq = (s) => `'${String(s).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;

const pixelScale = (fontSize) => Math.max(2, Math.round(fontSize / 10));

// Segment spans: each segment runs from its start to the next segment's start (gap included).
export function segmentSpans(voice) {
  return voice.segments.map((s, i) => {
    const start = i === 0 ? 0 : s.start;
    const end = i < voice.segments.length - 1 ? voice.segments[i + 1].start : voice.duration;
    return { id: s.id, start: round(start), end: round(end), dur: round(end - start) };
  });
}

export function titleWindow(tpl, voice) {
  const show = tpl.title?.show ?? 'hook';
  if (show === 'none') return null;
  if (show === 'hook') return [0, voice.segments[0].end];
  const n = Number(show);
  return Number.isFinite(n) && n > 0 ? [0, Math.min(n, voice.duration)] : null;
}

export async function run(ctx) {
  await requireFfmpeg();
  const tpl = loadTemplate(ctx);
  const script = await loadScript(ctx);
  const voice = readJson(ctx.file('voice.json'), null);
  const visuals = readJson(ctx.file('visuals.json'), null);
  const captions = readJson(ctx.file('captions.json'), null);
  const music = readJson(ctx.file('music.json'), { file: null });
  if (!voice || !visuals || !captions) throw new Error('need voice.json, visuals.json and captions.json: run the earlier steps first');

  const { width: W, height: H, fps } = tpl.video;
  const safe = tpl.safeArea;
  const T = voice.duration;
  const filters = await ffmpegFilters();
  let engine = tpl.text?.engine || 'auto';
  const ffText = filters.has('drawtext') && filters.has('subtitles');
  if (engine === 'auto') engine = ffText ? 'ffmpeg' : 'pixel';
  if (engine === 'ffmpeg' && !ffText) throw new Error('text.engine is "ffmpeg" but this ffmpeg has no drawtext/subtitles filters (needs libfreetype + libass). Use "pixel" or "auto".');
  ctx.log.info(`text engine: ${engine}`);

  const tmpDir = ctx.file('render');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const inputs = [];
  const graph = [];
  const boxes = [];

  // 1. Visual timeline
  const spans = segmentSpans(voice);
  spans.forEach((sp, i) => {
    const item = visuals.items.find((v) => v.segmentId === sp.id);
    if (!item) throw new Error(`no visual for segment ${sp.id}`);
    const file = path.isAbsolute(item.file) ? item.file : ctx.file(item.file);
    if (VIDEO_EXT.test(file)) inputs.push('-stream_loop', '-1', '-t', String(sp.dur), '-i', file);
    else inputs.push('-loop', '1', '-framerate', String(fps), '-t', String(sp.dur), '-i', file);
    graph.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps},format=yuv420p,trim=duration=${sp.dur},setpts=PTS-STARTPTS[v${i}]`);
  });
  graph.push(`${spans.map((_, i) => `[v${i}]`).join('')}concat=n=${spans.length}:v=1:a=0[base]`);
  let nextInput = spans.length;
  const voiceIdx = nextInput++;
  inputs.push('-i', ctx.file('voice.wav'));
  const musicFile = music.file ? ctx.file(music.file) : null;
  const useMusic = musicFile && fs.existsSync(musicFile) && tpl.audio.ducking !== 'none';
  let musicIdx = null;
  if (useMusic) { musicIdx = nextInput++; inputs.push('-stream_loop', '-1', '-i', musicFile); }

  // 2. Text layers
  let vLabel = 'base';
  let n = 0;
  const chain = (filter) => { const out = `t${n++}`; graph.push(`[${vLabel}]${filter}[${out}]`); vLabel = out; };
  const win = titleWindow(tpl, voice);
  const titleLines = wrapText(script.title, tpl.title.maxCharsPerLine, tpl.title.maxLines);
  const capLineChars = (fontSize) => Math.max(6, Math.floor((W - safe.left - safe.right) / (fontSize * 0.62)));

  if (engine === 'pixel') {
    const overlay = (png, name, x, y, enable) => {
      const f = path.join(tmpDir, `${name}.png`);
      fs.writeFileSync(f, png);
      const idx = nextInput++;
      inputs.push('-i', f);
      const en = enable ? `:enable='between(t,${enable[0]},${enable[1]})'` : '';
      graph.push(`[${vLabel}][${idx}:v]overlay=x=${x}:y=${y}${en}[t${n}]`);
      vLabel = `t${n++}`;
    };
    if (win) {
      const r = renderText(titleLines, { scale: pixelScale(tpl.title.fontSize), colour: tpl.title.textColour, background: tpl.title.plateColour, padding: tpl.title.platePadding });
      const x = Math.round((W - r.width) / 2);
      overlay(r.png, 'title', x, tpl.title.y, win);
      boxes.push({ name: 'title', x, y: tpl.title.y, w: r.width, h: r.height });
    }
    const cs = pixelScale(tpl.captions.fontSize);
    const maxChars = Math.floor((W - safe.left - safe.right) / (6 * cs));
    captions.chunks.forEach((c, i) => {
      const lines = wrapText(tpl.captions.uppercase ? normaliseText(c.text) : c.text, maxChars, 2);
      const r = renderText(lines, { scale: cs, colour: tpl.captions.textColour, outlineColour: tpl.captions.outlineColour, outline: Math.max(2, Math.round(tpl.captions.outline * cs / 7)) });
      const x = Math.round((W - r.width) / 2);
      const y = H - safe.bottom - tpl.captions.marginBottom - r.height;
      overlay(r.png, `cap${String(i).padStart(3, '0')}`, x, y, [round(c.start), round(c.end)]);
      boxes.push({ name: `caption${i}`, kind: 'caption', x, y, w: r.width, h: r.height });
    });
    if (tpl.watermark?.text) {
      const r = renderText([tpl.watermark.text], { scale: pixelScale(tpl.watermark.fontSize), colour: tpl.watermark.textColour, outlineColour: '#00000080', outline: 2 });
      const x = Math.round((W - r.width) / 2);
      const y = tpl.watermark.position === 'top' ? tpl.watermark.margin : H - tpl.watermark.margin - r.height;
      overlay(r.png, 'watermark', x, y, null);
      boxes.push({ name: 'watermark', kind: 'watermark', x, y, w: r.width, h: r.height });
    }
  } else {
    const font = tpl.text.fontFile ? `fontfile=${fq(path.resolve(tpl.text.fontFile))}` : `font=${fq(tpl.text.fontFamily || 'Sans')}`;
    if (win) {
      const fs_ = tpl.title.fontSize;
      const lineH = Math.round(fs_ * 1.25);
      titleLines.forEach((line, li) => {
        const tf = path.join(tmpDir, `title${li}.txt`);
        fs.writeFileSync(tf, line);
        chain(`drawtext=textfile=${fq(path.relative(ctx.jobDir, tf))}:${font}:fontsize=${fs_}:fontcolor=${ffColour(tpl.title.textColour)}:box=1:boxcolor=${ffColour(tpl.title.plateColour)}:boxborderw=${tpl.title.platePadding}:x=(w-text_w)/2:y=${tpl.title.y + tpl.title.platePadding + li * lineH}:enable='between(t,${round(win[0])},${round(win[1])})'`);
      });
      const est = titleLines.reduce((a, l) => Math.max(a, l.length), 0) * fs_ * 0.6 + tpl.title.platePadding * 2;
      boxes.push({ name: 'title', x: Math.round((W - est) / 2), y: tpl.title.y, w: Math.round(est), h: titleLines.length * lineH + tpl.title.platePadding * 2, estimated: true });
    }
    const fontsdir = tpl.text.fontFile ? `:fontsdir=${fq(path.dirname(path.resolve(tpl.text.fontFile)))}` : '';
    chain(`subtitles=captions.ass${fontsdir}`);
    const longest = captions.chunks.reduce((a, c) => Math.max(a, Math.min(c.text.length, capLineChars(tpl.captions.fontSize))), 0);
    const cw = Math.round(longest * tpl.captions.fontSize * 0.62);
    boxes.push({ name: 'captions', kind: 'caption', x: Math.round((W - cw) / 2), y: H - safe.bottom - tpl.captions.marginBottom - tpl.captions.fontSize * 1.2, w: cw, h: Math.round(tpl.captions.fontSize * 1.2), estimated: true });
    if (tpl.watermark?.text) {
      const wf = path.join(tmpDir, 'watermark.txt');
      fs.writeFileSync(wf, tpl.watermark.text);
      const y = tpl.watermark.position === 'top' ? tpl.watermark.margin : `h-${tpl.watermark.margin}-text_h`;
      chain(`drawtext=textfile=${fq(path.relative(ctx.jobDir, wf))}:${font}:fontsize=${tpl.watermark.fontSize}:fontcolor=${ffColour(tpl.watermark.textColour)}:x=(w-text_w)/2:y=${y}`);
      const ww = Math.round(tpl.watermark.text.length * tpl.watermark.fontSize * 0.6);
      boxes.push({ name: 'watermark', kind: 'watermark', x: Math.round((W - ww) / 2), y: tpl.watermark.position === 'top' ? tpl.watermark.margin : H - tpl.watermark.margin - tpl.watermark.fontSize, w: ww, h: tpl.watermark.fontSize, estimated: true });
    }
  }
  if (vLabel === 'base') chain('null');
  graph.push(`[${vLabel}]format=yuv420p[vout]`);

  // 3. Audio: voice (padded to length) + music bed, ducked under the voice, then loudness-normalised.
  const A = tpl.audio;
  const fmt = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
  graph.push(`[${voiceIdx}:a]${fmt},apad=whole_dur=${T}[vo0]`);
  if (useMusic) {
    graph.push(`[${musicIdx}:a]${fmt},volume=${A.musicGainDb}dB,atrim=duration=${T},afade=t=out:st=${Math.max(0, round(T - 0.8))}:d=0.8[mu]`);
    if (A.ducking === 'sidechain') {
      graph.push('[vo0]asplit=2[vo][sc]');
      graph.push(`[mu][sc]sidechaincompress=threshold=${A.duckThreshold}:ratio=${A.duckRatio}:attack=20:release=350[bed]`);
      graph.push('[vo][bed]amix=inputs=2:normalize=0:duration=first[mix]');
    } else {
      graph.push('[vo0][mu]amix=inputs=2:normalize=0:duration=first[mix]');
    }
  } else graph.push('[vo0]anull[mix]');
  graph.push(`[mix]loudnorm=I=${A.loudnessTarget}:TP=${A.truePeak}:LRA=11,aresample=48000[aout]`);

  const enc = tpl.encoder;
  const out = `${ctx.slug}.mp4`;
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y', ...inputs,
    '-filter_complex_threads', String(enc.threads || 2),
    '-filter_complex', graph.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', enc.preset, '-crf', String(enc.crf), '-pix_fmt', 'yuv420p', '-threads', String(enc.threads || 2),
    '-r', String(fps), '-c:a', 'aac', '-b:a', enc.audioBitrate, '-t', String(T), '-movflags', '+faststart', out,
  ];
  writeJson(path.join(tmpDir, 'ffmpeg-args.json'), args);
  ctx.log.info(`rendering ${T.toFixed(2)}s at ${W}x${H}...`);
  await runCmd('ffmpeg', args, { cwd: ctx.jobDir });
  writeJson(ctx.file('render.json'), { file: out, engine, width: W, height: H, fps, duration: T, safeArea: safe, boxes, music: Boolean(useMusic), ducking: useMusic ? A.ducking : 'none' });
  return { outputs: [out, 'render.json'], note: `${out} written (${engine} text)` };
}

stepMain(import.meta.url, 'render', run);
