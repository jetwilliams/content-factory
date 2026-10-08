# Licensing

This repository is **MIT** (see `LICENSE`). Everything in it was written for this project, including the example
notes, script and Strudel patterns. The things you plug into it have their own licences, and those decide what you
may publish. This page is practical guidance, not legal advice.

## Strudel (AGPL-3.0): the boundary

[Strudel](https://strudel.cc) is licensed under the **GNU AGPL-3.0**. The AGPL is a strong copyleft licence: if you
copy Strudel's code into a program, or distribute or network-serve a modified version, that program must be offered
under the AGPL too.

To keep this repo MIT, it follows three rules:

1. **No Strudel code here.** Nothing is copied, vendored, bundled, imported or required from Strudel's source.
2. **Separate program, called at arm's length.** The `strudel-command` adapter only runs a command *you* configure
   (`CF_STRUDEL_RENDER_CMD`) with a file path, a number and an output path, and reads back a WAV. That is ordinary
   communication between separate programs.
3. **Patterns are yours.** A pattern file is your composition written in Strudel's notation. The three in
   `examples/strudel/` are original and MIT.

If you write a renderer that embeds or modifies Strudel (for example a headless-browser script that bundles it),
**that renderer** is under the AGPL's terms when you distribute it or serve it over a network. Keep it in its own
repository with its own licence, and don't copy it into this one.

**Audio you render** with Strudel is generally your own musical output, but the **samples** a pattern loads have their own
licences. Strudel's default sound banks are fetched from third-party sources; check what you use before publishing.
The safest choice is synth-only patterns (like `calm-tide` and `night-pulse`) or samples you made or that are CC0.

## Voices (TTS)

- **Piper** (the engine) is open source, but **each voice model has its own licence**, inherited from the dataset it
  was trained on. Some datasets do not allow commercial use. Read the voice's `MODEL_CARD` before publishing.
- Voices trained on public-domain recordings (for example LJ Speech) are the safest for public, commercial content.
- Operating-system voices are often licensed for personal use only. Check before using them in anything you publish.
- Never clone or imitate a real person's voice without their written permission.

## Models (LLMs, image and video generators)

- Each hosted API has terms covering what you may do with outputs, attribution, and prohibited content. Read them.
- Open-weight models have licences too (some restrict commercial use or require attribution).
- Generated output may still resemble protected work. Don't prompt for living artists' styles, characters, logos or
  real people, and review every image.

## Stock footage, photos and music

- "Royalty-free" is not "no rules". Stock licences often forbid redistribution of the raw file, use in trademarks,
  or misleading use with identifiable people. Some require credit.
- Keep the credit and licence that the visuals and music steps record (`visuals.json`, `music.json`), and add credits
  to your caption where required.
- Music: use tracks you made, CC0, or licences that explicitly allow use on social platforms. Platform music
  libraries usually only cover posts made inside that platform's own app.

## Fonts

The `ffmpeg` text engine uses the font you set in the template. Use a font whose licence allows embedding in video
(many open fonts, such as those under the SIL Open Font License, do). The built-in pixel font is part of this repo (MIT).

## Your content

You own (or must have rights to) what goes in, and you are responsible for what goes out. See
[responsible-use.md](responsible-use.md).
