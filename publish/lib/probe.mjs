// Video sanity checks. Uses ffprobe when it is on PATH; without it only the file size and extension
// are checked (and a warning says so). Limits are deliberately conservative; see LIMITS in caption.mjs
// for the text side.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function probe(file, { ffprobe = process.env.FFPROBE_PATH || 'ffprobe' } = {}) {
  const st = fs.statSync(file);
  const out = { size: st.size, ext: path.extname(file).toLowerCase(), probed: false };
  const r = spawnSync(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    out.probeError = r.error?.code === 'ENOENT' ? 'ffprobe not found' : (r.stderr || 'ffprobe failed').trim().split('\n')[0];
    return out;
  }
  let json;
  try { json = JSON.parse(r.stdout); } catch { out.probeError = 'ffprobe output was not JSON'; return out; }
  return { ...out, ...fromFfprobe(json) };
}

// Exported for tests: turns ffprobe JSON into the fields the checks need.
export function fromFfprobe(json) {
  const streams = json.streams || [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  let width = v?.width;
  let height = v?.height;
  const rotation = Number(v?.tags?.rotate ?? v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0);
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  const [fn, fd] = String(v?.r_frame_rate || '0/1').split('/').map(Number);
  return {
    probed: true,
    hasVideo: !!v,
    hasAudio: !!a,
    duration: Number(json.format?.duration ?? v?.duration ?? 0),
    width,
    height,
    fps: fd ? fn / fd : 0,
    vcodec: v?.codec_name,
    acodec: a?.codec_name,
  };
}

const RULES = {
  instagram: { exts: ['.mp4', '.mov'], maxBytes: 300e6, minSec: 3, maxSec: 900 },
  tiktok: { exts: ['.mp4', '.mov', '.webm'], maxBytes: 4e9, minSec: 3, maxSec: 600 },
  youtube: { exts: ['.mp4', '.mov', '.webm', '.m4v'], maxBytes: 256e9, minSec: 1, maxSec: 180 },
};

export function checkVideo(p, platform) {
  const errors = [];
  const warnings = [];
  const rule = RULES[platform];
  if (!rule) return { errors: [`unknown platform "${platform}"`], warnings };
  if (!rule.exts.includes(p.ext)) errors.push(`${platform}: container ${p.ext || '(none)'} not accepted (${rule.exts.join(', ')})`);
  if (p.size > rule.maxBytes) errors.push(`${platform}: file is ${(p.size / 1e6).toFixed(0)} MB (limit ${(rule.maxBytes / 1e6).toFixed(0)} MB)`);
  if (!p.probed) {
    warnings.push(`duration/aspect not checked (${p.probeError || 'ffprobe unavailable'})`);
    return { errors, warnings };
  }
  if (!p.hasVideo) { errors.push('no video stream'); return { errors, warnings }; }
  if (p.duration < rule.minSec) errors.push(`${platform}: ${p.duration.toFixed(1)}s is shorter than ${rule.minSec}s`);
  if (p.duration > rule.maxSec) {
    if (platform === 'youtube') warnings.push(`youtube: ${p.duration.toFixed(0)}s is over ${rule.maxSec}s, so it will be a normal video, not a Short`);
    else errors.push(`${platform}: ${p.duration.toFixed(0)}s is longer than ${rule.maxSec}s`);
  }
  if (p.width && p.height) {
    const ratio = p.width / p.height;
    if (ratio > 1) warnings.push(`landscape ${p.width}x${p.height}: short-form feeds expect vertical 9:16${platform === 'youtube' ? ' (and it will not count as a Short)' : ''}`);
    else if (Math.abs(ratio - 9 / 16) > 0.02 && Math.abs(ratio - 1) > 0.02) warnings.push(`aspect ${p.width}x${p.height} is not 9:16; it may be cropped or letterboxed`);
    if (Math.min(p.width, p.height) < 540) warnings.push(`low resolution ${p.width}x${p.height} (1080x1920 recommended)`);
  }
  if (p.fps && (p.fps < 23 || p.fps > 60)) warnings.push(`${p.fps.toFixed(2)} fps (23-60 is safest)`);
  if (!p.hasAudio) warnings.push('no audio track');
  return { errors, warnings };
}
