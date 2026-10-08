// Step 8 · qa: checks the rendered MP4 and writes qa.json.
// Checks: duration, resolution + 9:16 aspect, audio present, loudness (EBU R128) + true peak,
// title/caption boxes inside the safe area, fact-check status, AI-content labelling reminder.
// Levels: "fail" blocks the hand-off; "warn" is shown to the human reviewer; "info" is a reminder.
import { readJson, writeJson, round } from '../../lib/util.mjs';
import { loadTemplate } from '../../lib/template.mjs';
import { requireFfmpeg, probe, measureLoudness } from '../../lib/ffmpeg.mjs';
import { stepMain } from '../../lib/step-cli.mjs';

// Pure check of overlay boxes against the safe area (exported for tests).
export function safeAreaChecks(boxes, { width, height, safe }) {
  return boxes.map((b) => {
    const inside = b.x >= safe.left && b.x + b.w <= width - safe.right && b.y >= safe.top && b.y + b.h <= height - safe.bottom;
    const level = b.kind === 'watermark' ? 'warn' : 'fail';
    return {
      name: `safe-area:${b.name}`, ok: inside, level: inside ? 'ok' : level,
      detail: `box x=${b.x} y=${b.y} w=${b.w} h=${b.h}${b.estimated ? ' (estimated)' : ''}; safe area ${safe.left}..${width - safe.right} x ${safe.top}..${height - safe.bottom}`,
    };
  });
}

export async function run(ctx) {
  await requireFfmpeg();
  const tpl = loadTemplate(ctx);
  const render = readJson(ctx.file('render.json'), null);
  if (!render) throw new Error('render.json is missing: run the render step first');
  const script = readJson(ctx.file('script.json'), {});
  const visuals = readJson(ctx.file('visuals.json'), { items: [] });
  const music = readJson(ctx.file('music.json'), {});
  const q = ctx.config.qa || {};
  const checks = [];
  const add = (name, ok, level, detail) => checks.push({ name, ok, level: ok ? 'ok' : level, detail });

  const info = await probe(ctx.file(render.file));
  const v = info.streams.find((s) => s.codec_type === 'video');
  const a = info.streams.find((s) => s.codec_type === 'audio');
  const dur = Number(info.format.duration);
  add('video-stream', Boolean(v), 'fail', v ? `${v.codec_name} ${v.width}x${v.height}` : 'no video stream');
  add('audio-stream', Boolean(a), 'fail', a ? `${a.codec_name} ${a.sample_rate} Hz` : 'no audio stream');
  if (v) {
    add('resolution', v.width === tpl.video.width && v.height === tpl.video.height, 'fail', `${v.width}x${v.height} (template ${tpl.video.width}x${tpl.video.height})`);
    add('aspect-9:16', v.width * 16 === v.height * 9, 'fail', `${v.width}:${v.height}`);
  }
  add('duration', dur >= (q.minDurationSec ?? 3) && dur <= (q.maxDurationSec ?? 60), 'fail', `${round(dur, 2)}s (allowed ${q.minDurationSec ?? 3}-${q.maxDurationSec ?? 60}s)`);
  add('duration-matches-voice', Math.abs(dur - render.duration) < 0.35, 'warn', `${round(dur, 2)}s vs voice ${render.duration}s`);

  if (a) {
    const L = await measureLoudness(ctx.file(render.file));
    const target = tpl.audio.loudnessTarget;
    const tol = q.loudnessToleranceLu ?? 2.5;
    add('loudness', L.integratedLufs !== null && Math.abs(L.integratedLufs - target) <= tol, 'warn', `${L.integratedLufs} LUFS (target ${target} ± ${tol})`);
    add('true-peak', L.truePeakDbfs !== null && L.truePeakDbfs <= tpl.audio.truePeak + 0.5, 'warn', `${L.truePeakDbfs} dBFS (limit ${tpl.audio.truePeak})`);
  }

  checks.push(...safeAreaChecks(render.boxes || [], { width: render.width, height: render.height, safe: render.safeArea }));

  const fc = script.factCheck?.status;
  add('fact-check', fc === 'checked', ctx.dryRun ? 'info' : 'warn', fc === 'checked' ? `checked by ${script.factCheck.by || 'someone'}` : 'script.json factCheck.status is not "checked": a human must verify every claim before posting');
  const ai = visuals.items.some((i) => i.aiGenerated);
  checks.push({ name: 'ai-label', ok: true, level: 'info', detail: ai ? 'contains AI-generated visuals: turn on each platform\'s AI-content label when posting (see docs/responsible-use.md)' : 'no AI-generated visuals recorded; label anyway if any part is synthetic (the voice may be)' });
  checks.push({ name: 'music-licence', ok: true, level: /UNKNOWN/.test(music.licence || '') ? 'warn' : 'info', detail: music.file ? `${music.source}: ${music.licence}` : 'no music' });

  const pass = !checks.some((c) => c.level === 'fail');
  const counts = Object.fromEntries(['fail', 'warn', 'info'].map((l) => [l, checks.filter((c) => c.level === l).length]));
  writeJson(ctx.file('qa.json'), { pass, file: render.file, duration: round(dur, 3), counts, checks });
  for (const c of checks) if (c.level !== 'ok') ctx.log[c.level === 'fail' ? 'error' : c.level === 'warn' ? 'warn' : 'info'](`${c.name}: ${c.detail}`);
  return { outputs: ['qa.json'], note: `${pass ? 'PASS' : 'FAIL'} (${counts.fail} fail, ${counts.warn} warn, ${counts.info} info)` };
}

stepMain(import.meta.url, 'qa', run);
