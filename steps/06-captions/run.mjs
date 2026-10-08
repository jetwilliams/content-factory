// Step 6 · captions: voice.json (+ voice.wav) → captions.json + captions.srt + captions.ass.
// Adapter from config.providers.captions: even-split (default: engine word times when the TTS gave
// them, otherwise an even split weighted by word length) | command (any aligner) | dry.
import { readJson, writeJson, writeText } from '../../lib/util.mjs';
import { loadTemplate } from '../../lib/template.mjs';
import { loadProvider, providerName } from '../../lib/providers.mjs';
import { chunkWords, toSrt, toAss } from '../../lib/captions-core.mjs';
import { stepMain } from '../../lib/step-cli.mjs';

export async function run(ctx) {
  const voice = readJson(ctx.file('voice.json'), null);
  if (!voice) throw new Error('voice.json is missing: run the voice step first');
  const tpl = loadTemplate(ctx);
  const name = providerName('captions', ctx);
  const captioner = await loadProvider('captions', name);
  const words = await captioner.words({ voice, ctx });
  const chunks = chunkWords(words, ctx.config.captions?.wordsPerCaption ?? 2);
  const timing = name === 'command' ? 'aligner' : voice.wordTimings;
  writeJson(ctx.file('captions.json'), { provider: name, timing, words, chunks });
  writeText(ctx.file('captions.srt'), toSrt(chunks));
  writeText(ctx.file('captions.ass'), toAss(chunks, {
    width: tpl.video.width, height: tpl.video.height, font: tpl.text.fontFamily, fontSize: tpl.captions.fontSize,
    textColour: tpl.captions.textColour, outlineColour: tpl.captions.outlineColour, outline: tpl.captions.outline,
    marginBottom: tpl.safeArea.bottom + tpl.captions.marginBottom, marginSide: tpl.safeArea.left, uppercase: tpl.captions.uppercase,
  }));
  return { outputs: ['captions.json', 'captions.srt', 'captions.ass'], note: `${chunks.length} captions (${timing} timing)` };
}

stepMain(import.meta.url, 'captions', run);
