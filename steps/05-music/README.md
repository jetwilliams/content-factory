# Step 5 · music

A music bed under the voice. The free default is **Strudel**: music written as code.

| Skill card | |
|---|---|
| **Input** | `voice.json` (for length), a pattern file or audio file |
| **Output** | `music.wav`, `music.json` (source + licence) |
| **Run** | `node steps/05-music/run.mjs <slug>` |
| **Adapter** | `providers.music`: `strudel-command` (default), `wav-folder`, `file`, `command`, `none`, `dry` |
| **Cost** | free, except a paid AI music API through `command` (same spend gate as visuals: `config.music.pricePerCall`, `spendCapUsd`, `--allow-spend`) |
| **Dry mode** | a quiet four-chord sine pad generated in JavaScript |
| **Done when** | `music.json` names the source and a licence you are happy with |

If the chosen adapter is not set up yet, `providers.musicFallback` (default `dry`) is used and a warning is printed.
Set it to `"none"` to fail instead.

## Strudel: the licence boundary

[Strudel](https://strudel.cc) is AGPL-3.0. **This repo contains no Strudel code** and does not bundle or import it.
It only calls a renderer **you** install separately, through `CF_STRUDEL_RENDER_CMD`:

```
CF_STRUDEL_RENDER_CMD="node /path/to/your-renderer/render.mjs {pattern} {seconds} {out}"
```

The renderer gets the pattern file, a length in seconds and an output path, and must write a WAV. Ways to build one:

- **Record from the REPL.** Open strudel.cc (or a local copy), paste the pattern, play it, and record the output
  with any audio recorder. Save it as a WAV and use the `file` adapter. No code needed.
- **Headless browser.** A small script that opens a Strudel page in a headless browser, plays the pattern and
  records the audio output for N seconds. Keep it in its own folder with its own licence. If you distribute it,
  the AGPL applies to it, not to this repo.

The three example patterns in `examples/strudel/` are original and MIT. A pattern is your composition; the samples it
loads have their own licences (the default drum bank is fetched from the internet by Strudel: check it before publishing).
Full explanation: [docs/licensing.md](../../docs/licensing.md).

## Other engines

- `wav-folder`: a folder of your own or royalty-free tracks (`config.music.folder`, optional `track`). Put the licence
  in `LICENCE.txt` in that folder.
- `file`: one audio file (`config.music.file`, `config.music.licence`).
- `command`: anything else: another live-coding tool, a local model, or an AI music API wrapper
  (`CF_MUSIC_COMMAND` with `{seconds} {out} {prompt} {pattern}`).

The render loops a short bed, trims a long one, fades it out and ducks it under the voice.
