# Step 4 · voice

Speaks each segment and joins them into one track.

| Skill card | |
|---|---|
| **Input** | `script.json` |
| **Output** | `voice.wav` (44.1 kHz mono), `voice.json` (segment start/end, word times when the engine gives them), `voice/` |
| **Run** | `node steps/04-voice/run.mjs <slug>` |
| **Adapter** | `providers.tts`: `piper` (default, free, local), `command` (any TTS CLI), `dry` |
| **Cost** | free with Piper; hosted TTS bills per character |
| **Dry mode** | a soft tone per word, timed like speech, so the whole pipeline can be tested without a voice |
| **Done when** | `voice.wav` sounds right and `voice.json` has every segment |

## Piper (free, local)

1. Install Piper (see its project page) so `piper` is on your PATH, or set `CF_PIPER_BIN`.
2. Download a voice: the `.onnx` file **and** its `.onnx.json`, side by side.
3. Set `CF_PIPER_MODEL=/path/to/voice.onnx` in `.env`.

**Voice licences differ.** Each Piper voice inherits the licence of the dataset it was trained on, and some are
not cleared for commercial use. Read the voice's `MODEL_CARD` before publishing. Voices trained on public-domain
recordings (for example the LJ Speech dataset, `en_US-ljspeech-*`) are the safest default for public content.
Never clone or imitate a real person's voice without their written permission.

Settings: `config.voice.gapSec` (pause between segments), `tailSec` (silence at the end).

## Check before moving on

- Listen to the whole track. Fix mispronunciations by respelling words in `script.json` `voice` (keep `onScreen` correct).
