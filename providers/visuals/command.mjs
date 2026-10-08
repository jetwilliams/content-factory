// Any image/video generator you can call from the command line (local or remote).
// CF_IMAGE_COMMAND is a template with {prompt_file} and {out}, for example
//   CF_IMAGE_COMMAND="my-gen --prompt-file {prompt_file} --out {out}"
// If the command costs money, set config.visuals.prices.command to the price per call so the
// spend cap can be enforced. With no price set it is treated as paid-with-unknown-price and refused.
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../../lib/env.mjs';
import { runCmd } from '../../lib/ffmpeg.mjs';
import { fillCommand } from '../../lib/util.mjs';

export default {
  name: 'command',
  paid: true,
  estimateUsd(req, config) {
    const p = config.visuals?.prices?.command;
    return Number.isFinite(p) ? p : null;
  },
  async fetch(req, { outBase }) {
    const tpl = env('CF_IMAGE_COMMAND');
    if (!tpl) throw new Error('set CF_IMAGE_COMMAND');
    const promptFile = `${outBase}.prompt.txt`;
    fs.writeFileSync(promptFile, `${req.prompt || req.query || req.label}. No text, no logos.`);
    const out = `${outBase}.png`;
    const [cmd, ...args] = fillCommand(tpl, { prompt_file: promptFile, out });
    await runCmd(cmd, args);
    if (!fs.existsSync(out)) throw new Error('generator wrote no file');
    return { file: path.basename(out), credit: 'AI-generated', licence: "see your generator's terms", aiGenerated: true };
  },
};
