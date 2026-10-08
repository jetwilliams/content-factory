# Examples

## `how-tides-work/`: the dry example job

`notes.md` and `script.json` for the topic "how tides work". In a dry run, the research and script steps copy these
instead of calling a model (any example folder whose name matches the topic's slug is used the same way).

```bash
node factory.mjs run "how tides work" --dry-run
```

produces `jobs/how-tides-work/how-tides-work.mp4`: about 9 seconds, 1080x1920, with

- coloured placeholder cards drawn by ffmpeg (one per segment),
- a hook title plate and two-word captions (built-in pixel font if your ffmpeg has no text filters),
- a tone-per-word placeholder "voice",
- a generated sine-pad music bed, ducked under the voice and loudness-normalised.

No keys, no network, no spending. The rendered file is git-ignored; generate it yourself.

The last step adds the video to the publish queue as a **draft** marked "made by a --dry-run" and prints its
preview and approval code. It is placeholder content: look at it, then `node factory.mjs publish cancel <id>`.

The notes are written to be accurate, but they are an example: check the sources before reusing any of it.

## `strudel/`: example music patterns

Three short, original patterns (MIT), for the Strudel REPL or your own renderer
(see [steps/05-music](../steps/05-music/README.md) and [docs/licensing.md](../docs/licensing.md)):

| File | Feel |
|---|---|
| `calm-tide.strudel` | slow, soft chords; synth only |
| `bright-steps.strudel` | upbeat groove; loads the default drum samples |
| `night-pulse.strudel` | darker steady pulse; synth only |

Pick one with `config.music.pattern`.

## `telegram-approval/`: approve drafts from your phone (optional)

A small bot that sends each new publish-queue draft (video + preview) to you and accepts `/approve <id> <code>`
only from allowlisted Telegram user IDs in a private chat. It never approves anything by itself.
See [telegram-approval/README.md](telegram-approval/README.md).

## `scheduler/`: run the publish queue on a timer

Ready-made cron, launchd and systemd snippets that run `node factory.mjs publish run` every 10 minutes.
Only items a human has approved, and that are due, are posted.
