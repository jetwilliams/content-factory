// Strudel (https://strudel.cc) pattern → WAV through YOUR OWN, separately installed renderer.
//
// This project does not include, copy or bundle any Strudel code. Strudel is AGPL-3.0 licensed;
// keeping it a separate program that we only call keeps this repo MIT. See docs/licensing.md.
//
// CF_STRUDEL_RENDER_CMD is a template with {pattern}, {seconds} and {out}, for example
//   CF_STRUDEL_RENDER_CMD="node /path/to/your-strudel-renderer/render.mjs {pattern} {seconds} {out}"
// It must write a WAV to {out}. How you build that renderer (a headless browser recording the
// REPL, or a recorded take) is up to you: steps/05-music/README.md describes the options.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, fillCommand } from '../../lib/util.mjs';
import { env } from '../../lib/env.mjs';
import { runCmd } from '../../lib/ffmpeg.mjs';

export default {
  name: 'strudel-command',
  paid: false,
  async make({ seconds, outFile, config }) {
    const tpl = env('CF_STRUDEL_RENDER_CMD');
    if (!tpl) throw new Error('set CF_STRUDEL_RENDER_CMD to your own Strudel renderer (see steps/05-music/README.md), or use music provider "file" with a WAV');
    const pattern = path.resolve(ROOT, config.music?.pattern || '');
    if (!fs.existsSync(pattern)) throw new Error(`pattern file not found: ${config.music?.pattern}`);
    const [cmd, ...args] = fillCommand(tpl, { pattern, seconds: Math.ceil(seconds), out: outFile });
    await runCmd(cmd, args, { timeoutMs: 15 * 60 * 1000 });
    if (!fs.existsSync(outFile)) throw new Error('the Strudel renderer wrote no WAV');
    return { file: outFile, source: `strudel pattern ${path.basename(pattern)}`, licence: config.music?.licence || 'your pattern; check the licences of any samples it loads' };
  },
};
