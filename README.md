# Content Factory

A model-agnostic, step-by-step pipeline that turns a **topic** into a finished **short vertical video**
(an explainer or an entertainment reel), built as small independent steps that an AI agent or a person can run,
check and redo one at a time. It ends in a built-in **publish stage**: every finished video waits in a queue as a
draft until a human previews it and approves it with a code bound to that exact file and caption. Only then is it posted.

```
topic → research → script → visuals → voice → music → captions → render → qa → publish (human approves) → post
```

- **A human approves every post.** The pipeline queues drafts; it can't approve or post. Approval needs a name and an
  approval code from the preview, and it is bound to the exact video and text: change either and it won't post.
  See [Publishing](#publishing).
- **Swap any provider.** LLM, voice, visuals (your footage, stock, AI generation), music engine and captioner are
  adapters, selected in one config file. Every kind has a free `dry` adapter and a free/local default.
- **Runs with no keys.** `--dry-run` uses placeholder cards, a tone "voice" and a generated pad, and still produces
  a real MP4.
- **Spending is opt-in and capped.** Paid calls are estimated first, refused without `--allow-spend`, and refused
  above a per-run cap (default $0).
- **Resumable.** Each video is a folder (`jobs/<slug>/`) with a `state.json`. Re-run the same command and it picks up
  where it stopped. Edit any file by hand and re-run from there.
- **No house style.** The script structure and the render template (fonts, colours, title plate, captions,
  watermark, ducking, loudness) are yours to set.
- **Posts on a schedule once approved**: Instagram Reels, TikTok and YouTube Shorts through a swappable publisher
  (Upload-Post adapter included; the default `dry` publisher never sends anything). Crash-safe, never double-posts.
- Zero npm dependencies. Node 20+ and ffmpeg.

## Quick start

```bash
# needs Node 20+ and ffmpeg/ffprobe on PATH
node factory.mjs run "how tides work" --dry-run
# → jobs/how-tides-work/how-tides-work.mp4  (about 9 seconds, 1080x1920, no keys, no spending)
# → and a DRAFT in the publish queue, with its preview and approval code printed

npm test                              # offline unit tests
node factory.mjs status how-tides-work
node factory.mjs providers            # which adapters are installed and selected
node factory.mjs publish list         # the publish queue (the dry example's draft is placeholder: cancel it)
```

The dry example uses the ready-made notes and script in [`examples/how-tides-work/`](examples/how-tides-work).

## Make a real one

1. `cp .env.example .env` and set up what you'll use (all optional, all free options first):
   - **LLM**: run a local model server (the default adapter talks to one at `127.0.0.1:11434`) and set
     `CF_LLM_MODEL`, or point `CF_LLM_BASE_URL` + `CF_LLM_API_KEY` at a hosted API, or use any CLI via `CF_LLM_COMMAND`.
   - **Voice**: install Piper and set `CF_PIPER_MODEL` to a voice whose licence allows your use
     (public-domain-trained voices are safest; see [steps/04-voice](steps/04-voice/README.md)).
   - **Music**: set up a Strudel renderer (`CF_STRUDEL_RENDER_CMD`), or point the `wav-folder`/`file` adapter at
     music you have rights to. Until then the step falls back to the generated pad.
   - **Visuals**: your own footage folder (`config.visuals.folder`), a stock key, or an AI image key with a price and a cap.
2. Optional: put 2-5 good source URLs in `jobs/<slug>/sources.txt`.
3. Run it step by step and check each output:

```bash
node factory.mjs run "why the sky is blue" --steps research   # read notes.md, check the sources
node factory.mjs run "why the sky is blue" --steps script     # read script.json aloud, edit it
node factory.mjs run "why the sky is blue"                    # the rest (resumes)
```

4. The last step adds the video to the publish queue as a **draft** and prints its preview and approval code.
   Watch the video, fact-check it, then approve it yourself:
   `node factory.mjs publish approve <id> --by NAME --code CODE` (see [Publishing](#publishing)).

## The steps

Each step is a folder with a runnable `run.mjs` and a README "skill card" (inputs, outputs, adapters, cost, checks).

| # | Step | Writes | Default adapter (free/local) |
|---|---|---|---|
| 1 | [research](steps/01-research/README.md) | `notes.md` with sources | `openai-compatible` (local server) |
| 2 | [script](steps/02-script/README.md) | `script.json` (title, hook, 4-8 beats, CTA, post text) | same LLM |
| 3 | [visuals](steps/03-visuals/README.md) | `visuals.json` + images/clips | own folder / stock / AI (spend-capped) |
| 4 | [voice](steps/04-voice/README.md) | `voice.wav` + timings | `piper` |
| 5 | [music](steps/05-music/README.md) | `music.wav` + licence | `strudel-command` (your renderer) |
| 6 | [captions](steps/06-captions/README.md) | `.srt` + `.ass` + word timings | `even-split` |
| 7 | [render](steps/07-render/README.md) | `<slug>.mp4` 1080x1920 | ffmpeg + template |
| 8 | [qa](steps/08-qa/README.md) | `qa.json` (duration, aspect, loudness, safe margins) | ffmpeg |
| 9 | [handoff](steps/09-handoff/README.md) | `handoff.json` + a **draft** in the publish queue | never approves or posts |
| → | [publish](docs/publishing.md) | preview → **human approval** → posted on schedule | `dry` publisher (never posts) |

Run one step: `node steps/04-voice/run.mjs <slug>`. Run some: `--steps voice,captions,render` or `--from render`.
Redo: `--force`.

## Swap any provider

```jsonc
// config/factory.config.json → "providers"  (or jobs/<slug>/config.json for one video)
"llm": "openai-compatible",   // dry | openai-compatible | command
"tts": "piper",               // dry | piper | command
"visuals": { "placeholder": "dry", "folder": "folder", "stock": "pexels", "ai": "openai-images" },
"music": "strudel-command",   // dry | none | strudel-command | wav-folder | file | command
"captions": "even-split",     // dry | even-split | command
"publisher": "dry"            // dry (never posts) | upload-post | your own
```

Adding your own is one small file: see [docs/providers.md](docs/providers.md).

## Publishing

The publish stage is the **approval gate**. It is a feature, not an afterthought: this tool makes videos cheap to
produce, so the one step it never automates is the decision to put one in public.

```
step 9 ──▶ draft ──(a human: preview + approve with code)──▶ approved ──(publish run, when due)──▶ posted
```

- **Drafts only.** Step 9 adds the finished video to the queue as a draft and prints the preview and
  `approve with: node factory.mjs publish approve <id> --by NAME --code CODE`. Nothing in the pipeline can approve or post.
- **Approval is explicit and bound to the content.** `approve` needs a name and the approval code shown by `preview`.
  The code is derived from the video file's hash plus the caption, tags, title and platforms. Re-render the video or
  edit the caption and the old approval stops working: `run` refuses to post it.
- **Safe by default.** The default publisher is `dry`: `run` only prints what it would send. Real posting is one
  config line (`providers.publisher`), plus keys in `.env`.
- **Crash-safe.** One run at a time (lock file), atomic queue writes, each item saved as `posting` before any network
  call, per-platform tracking (a TikTok failure never re-posts Instagram), backoff for transient errors only, and
  `retry` for the rest.

```bash
node factory.mjs publish list                       # what is waiting
node factory.mjs publish preview 1                  # checks + approval code
node factory.mjs publish approve 1 --by "Alex" --code 3f9c2a1b
node factory.mjs publish run --dry-run              # exactly what would be sent; sends nothing
node factory.mjs publish run                        # post approved, due items (put this on a timer)
```

Also: `add`, `status`, `unapprove`, `cancel`, `reschedule`, `retry`, `schedule` (hand to the provider's own
scheduler), `dry-run <id>`, `stats`. Full reference, states, validation rules and the Upload-Post setup:
[docs/publishing.md](docs/publishing.md). Approve from your phone: [examples/telegram-approval](examples/telegram-approval).
Timers: [examples/scheduler](examples/scheduler).

## Orchestrator

```
node factory.mjs run <topic> [--dry-run] [--steps a,b] [--from step] [--force] [--job slug]
                             [--allow-spend] [--override-qa]
node factory.mjs status <slug> | steps | providers
node factory.mjs publish <command>          (same as node publish/cli.mjs <command>)
```

Exit codes: `0` done, `1` failed, `2` paused (a step is blocked, e.g. waiting for spend approval).

## Docs

- [Architecture](docs/architecture.md): steps, files, state and resume, the step interface
- [Providers](docs/providers.md): adapter interfaces and how to add an LLM, TTS, visuals, music, caption or publisher provider
- [Publishing](docs/publishing.md): the queue, the approval gate, scheduling, Upload-Post, Telegram approval
- [Agents](docs/agents.md): running the steps as skills with Claude Code, Codex or any agent
- [Responsible use](docs/responsible-use.md): human approval, fact-checking, AI labels, no impersonation or spam
- [Licensing](docs/licensing.md): the Strudel (AGPL) boundary, voice, model, stock and music licences

## Requirements

- Node.js 20 or newer
- FFmpeg (`ffmpeg` and `ffprobe`). Any build works; builds with libfreetype + libass get nicer text
  (otherwise a built-in pixel font is used).
- Optional: Piper, a local or hosted LLM, a Strudel renderer, API keys for stock or generation, a publisher account
  (for example Upload-Post) for posting.

## Licence

MIT. See [LICENSE](LICENSE). Third-party tools, models, voices and media you plug in keep their own licences:
see [docs/licensing.md](docs/licensing.md).

---

Made by Jet Williams · jetworks: https://jetworks.io
