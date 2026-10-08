// Any other music engine you can call from the command line: another live-coding tool, a local
// generative model, or a wrapper around an AI music API. CF_MUSIC_COMMAND is a template with
// {seconds}, {out}, {prompt} and {pattern}. It must write a WAV (or any ffmpeg-readable audio) to {out}.
// If it costs money, set config.music.pricePerCall: the step then prints an estimate and needs
// --allow-spend and config.music.spendCapUsd, exactly like paid visuals.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, fillCommand } from '../../lib/util.mjs';
import { env } from '../../lib/env.mjs';
import { runCmd } from '../../lib/ffmpeg.mjs';

export default {
  name: 'command',
  paid: true, // a pricePerCall of 0 marks it free (no spend gate)
  estimateUsd(config) {
    const p = config.music?.pricePerCall;
    return Number.isFinite(p) ? p : null;
  },
  async make({ seconds, outFile, config }) {
    const tpl = env('CF_MUSIC_COMMAND');
    if (!tpl) throw new Error('set CF_MUSIC_COMMAND (see providers/music/command.mjs)');
    const pattern = config.music?.pattern ? path.resolve(ROOT, config.music.pattern) : '';
    const [cmd, ...args] = fillCommand(tpl, { seconds: Math.ceil(seconds), out: outFile, prompt: config.music?.prompt || '', pattern });
    await runCmd(cmd, args, { timeoutMs: 15 * 60 * 1000 });
    if (!fs.existsSync(outFile)) throw new Error('music command wrote no file');
    return { file: outFile, source: `command (${path.basename(cmd)})`, licence: config.music?.licence || "UNKNOWN: check your engine's / API's terms" };
  },
};
