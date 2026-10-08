// Thin wrappers around ffmpeg / ffprobe and other external commands (execFile, never a shell).
import { execFile } from 'node:child_process';

export function runCmd(cmd, args, { cwd, input, timeoutMs = 10 * 60 * 1000, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: env || process.env },
      (err, stdout, stderr) => {
        if (err) {
          const tail = String(stderr || '').trim().split('\n').slice(-12).join('\n');
          const e = new Error(`${cmd} failed (${err.code ?? err.signal}): ${tail || err.message}`);
          e.stderr = stderr; e.stdout = stdout; e.code = err.code;
          reject(e);
        } else resolve({ stdout: String(stdout), stderr: String(stderr) });
      });
    if (input !== undefined) { child.stdin.end(input); }
  });
}

export async function hasBinary(name) {
  // A binary that exists but rejects -version still counts as installed.
  try { await runCmd(name, ['-version'], { timeoutMs: 15000 }); return true; } catch (e) { return e.code !== 'ENOENT'; }
}

let filterCache = null;
export async function ffmpegFilters() {
  if (filterCache) return filterCache;
  const { stdout } = await runCmd('ffmpeg', ['-hide_banner', '-filters']);
  filterCache = new Set();
  for (const line of stdout.split('\n')) {
    const m = line.match(/^\s*[A-Z.|]{2,3}\s+(\w+)\s/);
    if (m) filterCache.add(m[1]);
  }
  return filterCache;
}

export async function requireFfmpeg() {
  if (!(await hasBinary('ffmpeg')) || !(await hasBinary('ffprobe'))) {
    throw new Error('ffmpeg and ffprobe are required for this step. Install FFmpeg (https://ffmpeg.org) and make sure both are on PATH.');
  }
}

export async function probe(file) {
  const { stdout } = await runCmd('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  return JSON.parse(stdout);
}

export async function mediaDuration(file) {
  const info = await probe(file);
  return Number(info.format?.duration || 0);
}

// Integrated loudness (LUFS) and true peak via the ebur128 filter.
export async function measureLoudness(file) {
  const { stderr } = await runCmd('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-']);
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const I = summary.match(/I:\s*(-?[\d.]+|-inf)\s*LUFS/);
  const peak = summary.match(/Peak:\s*(-?[\d.]+|-inf)\s*dBFS/);
  const num = (m) => (m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : null);
  return { integratedLufs: num(I), truePeakDbfs: num(peak) };
}
