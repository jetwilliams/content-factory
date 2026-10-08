# Step 6 · captions

Word-by-word (or N-words-at-a-time) captions.

| Skill card | |
|---|---|
| **Input** | `voice.json` (+ `voice.wav` for aligners) |
| **Output** | `captions.json` (words + chunks), `captions.srt`, `captions.ass` (styled from the template) |
| **Run** | `node steps/06-captions/run.mjs <slug>` |
| **Adapter** | `providers.captions`: `even-split` (default, free), `command` (any aligner / speech-to-text with word times), `dry` |
| **Cost** | free |
| **Done when** | captions match the voice |

Timing, in order of preference:

1. **Aligner** (`command` adapter, `CF_ALIGN_COMMAND`): real word times from the audio.
2. **Engine timings**: some TTS engines report word times; the `even-split` adapter uses them when present.
3. **Even split**: each segment's words share its time span, weighted by word length. Good enough for short
   lines; it drifts on long ones, so keep beats short or use an aligner.

`config.captions.wordsPerCaption` sets the chunk size (default 2). Chunks never cross a segment boundary.

## Check before moving on

- Spot-check `captions.srt`. It is also a normal subtitle file you can upload to platforms that accept one.
