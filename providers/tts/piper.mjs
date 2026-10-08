// Piper: a free, local, offline TTS engine. https://github.com/rhasspy/piper (and its successors)
//   CF_PIPER_BIN    the piper executable (default "piper")
//   CF_PIPER_MODEL  path to a voice .onnx (its .onnx.json must sit next to it)
//
// LICENCES: Piper voices have their own licences, set by the dataset each was trained on.
// Read the voice's MODEL_CARD before you publish anything. Voices trained on public-domain
// data (for example the LJ Speech dataset) are the safest choice for public content.
import fs from 'node:fs';
import { env } from '../../lib/env.mjs';
import { runCmd } from '../../lib/ffmpeg.mjs';

export default {
  name: 'piper',
  paid: false,
  licence: 'see the MODEL_CARD of the voice you chose',
  async synth({ text, outFile }) {
    const model = env('CF_PIPER_MODEL');
    if (!model || !fs.existsSync(model)) throw new Error('set CF_PIPER_MODEL to a Piper .onnx voice file (see steps/04-voice/README.md)');
    await runCmd(env('CF_PIPER_BIN', 'piper'), ['--model', model, '--output_file', outFile], { input: String(text) + '\n' });
    if (!fs.existsSync(outFile)) throw new Error('piper produced no audio');
    return { file: outFile, words: null }; // Piper gives no word timings; captions use the even split.
  },
};
