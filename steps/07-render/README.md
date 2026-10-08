# Step 7 · render

Puts it all together with one ffmpeg command: a 1080x1920 MP4.

| Skill card | |
|---|---|
| **Input** | `visuals.json`, `voice.wav`/`voice.json`, `music.wav` (optional), `captions.*`, `script.json`, the template |
| **Output** | `<slug>.mp4`, `render.json` (engine, duration, overlay boxes for QA), `render/` (overlays, ffmpeg args) |
| **Run** | `node steps/07-render/run.mjs <slug>` |
| **Needs** | `ffmpeg` + `ffprobe` on PATH |
| **Cost** | free (CPU time) |
| **Done when** | the MP4 plays and QA passes |

## Template

Everything visual is in [`templates/default.template.json`](../../templates/default.template.json). Copy it to
`jobs/<slug>/template.json` to change one job (deep-merged), or point `config.render.template` at your own file.
Nothing brand-specific is baked in.

| Section | Controls |
|---|---|
| `video` | width, height, fps |
| `safeArea` | margins kept clear of platform UI (QA checks titles and captions against it) |
| `text` | engine (`auto`/`ffmpeg`/`pixel`), font file or family |
| `title` | when the hook title plate shows (`hook`, seconds, or `none`), position, size, colours, wrap |
| `captions` | size, colours, outline, distance above the safe bottom, uppercase |
| `watermark` | optional text you set (empty = none), size, colour, top/bottom |
| `audio` | music gain, ducking (`sidechain`/`static`/`none`), duck threshold/ratio, loudness target, true peak |
| `encoder` | x264 preset, CRF, threads (kept low by default so renders don't hog the machine), audio bitrate |

## Text engines

- `ffmpeg`: `drawtext` + `subtitles` (libass) with your font. Needs an ffmpeg built with libfreetype and libass.
  Set `text.fontFile` to a font you are licensed to use.
- `pixel`: a built-in pixel font rendered to PNG overlays in plain Node. Works with every ffmpeg build.
- `auto` (default): `ffmpeg` when both filters exist, otherwise `pixel`.

## Audio chain

voice → padded to length → (music: gain, loop/trim, fade out, **sidechain-compressed by the voice**) → mix →
`loudnorm` to the target (default -14 LUFS, -1.5 dBTP).

The exact ffmpeg arguments are saved to `render/ffmpeg-args.json` for debugging.
