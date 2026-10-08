// Any forced-alignment or speech-to-text tool that can output word timings (local or remote).
// CF_ALIGN_COMMAND is a template with {audio}, {text_file} and {out}. The tool must write JSON to
// {out}: [{ "word": "Hello", "start": 0.00, "end": 0.31 }, ...] in seconds from the start of voice.wav.
import fs from 'node:fs';
import { env } from '../../lib/env.mjs';
import { runCmd } from '../../lib/ffmpeg.mjs';
import { fillCommand } from '../../lib/util.mjs';

export default {
  name: 'command',
  paid: false, // depends on the tool
  async words({ voice, ctx }) {
    const tpl = env('CF_ALIGN_COMMAND');
    if (!tpl) throw new Error('set CF_ALIGN_COMMAND (see providers/captions/command.mjs)');
    const textFile = ctx.file('voice.txt');
    fs.writeFileSync(textFile, voice.segments.map((s) => s.text).join('\n'));
    const out = ctx.file('align.json');
    const [cmd, ...args] = fillCommand(tpl, { audio: ctx.file('voice.wav'), text_file: textFile, out });
    await runCmd(cmd, args);
    const words = JSON.parse(fs.readFileSync(out, 'utf8'));
    if (!Array.isArray(words)) throw new Error('aligner output must be a JSON array of words');
    // Tag each word with the segment it falls in, so captions never straddle two segments.
    return words.map((w) => ({ ...w, segment: (voice.segments.find((s) => w.start < s.end + 0.05) || voice.segments.at(-1)).id }));
  },
};
