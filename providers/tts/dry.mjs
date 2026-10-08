// The dry TTS adapter: a placeholder "voice": one soft tone per word, timed like speech. No install, no licence questions.
// It exists so the whole pipeline (timing, captions, ducking, render) can be tested with no TTS.
import { beepWords, writeWav } from '../../lib/wav.mjs';
import { evenSplitWords } from '../../lib/captions-core.mjs';

export default {
  name: 'dry',
  paid: false,
  licence: 'generated tones (no licence needed)',
  async synth({ text, outFile, config }) {
    const wps = config?.voice?.placeholderWordsPerSec || 3.5;
    const n = String(text).trim().split(/\s+/).filter(Boolean).length;
    const seconds = Math.max(0.6, n / wps);
    const words = evenSplitWords(text, 0, seconds);
    writeWav(outFile, beepWords(words.map((w) => w.end - w.start)), 44100);
    return { file: outFile, words };
  },
};
