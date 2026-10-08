// Any TTS CLI. CF_TTS_COMMAND is a template with {text_file} and {out}, for example
//   CF_TTS_COMMAND="my-tts --in {text_file} --wav {out}"
// If the tool can also write word timings, write them as JSON to {out}.words.json:
//   [{ "word": "Hello", "start": 0.00, "end": 0.31 }, ...]   (seconds, relative to this clip)
import fs from 'node:fs';
import { env } from '../../lib/env.mjs';
import { runCmd } from '../../lib/ffmpeg.mjs';
import { fillCommand } from '../../lib/util.mjs';

export default {
  name: 'command',
  paid: false, // depends on the tool
  licence: 'depends on your engine and voice',
  async synth({ text, outFile }) {
    const tpl = env('CF_TTS_COMMAND');
    if (!tpl) throw new Error('set CF_TTS_COMMAND (see .env.example)');
    const textFile = `${outFile}.txt`;
    fs.writeFileSync(textFile, String(text));
    const [cmd, ...args] = fillCommand(tpl, { text_file: textFile, out: outFile });
    await runCmd(cmd, args);
    if (!fs.existsSync(outFile)) throw new Error('TTS command produced no audio');
    let words = null;
    const wf = `${outFile}.words.json`;
    if (fs.existsSync(wf)) words = JSON.parse(fs.readFileSync(wf, 'utf8'));
    return { file: outFile, words };
  },
};
