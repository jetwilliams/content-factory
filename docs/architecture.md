# Architecture

content-factory is a row of small, independent steps that read and write files in one job folder.
An orchestrator runs them in order; you, or an agent, can also run any one of them alone.

```
topic
  │
  ▼
1 research ──▶ notes.md
2 script   ──▶ script.json            (the contract for everything after it)
3 visuals  ──▶ visuals.json + visuals/   (spend gate for paid adapters)
4 voice    ──▶ voice.wav + voice.json
5 music    ──▶ music.wav + music.json
6 captions ──▶ captions.json/.srt/.ass
7 render   ──▶ <slug>.mp4 + render.json
8 qa       ──▶ qa.json
9 handoff  ──▶ handoff.json + a DRAFT in the publish queue
                 │
publish stage    ▼
  draft ──(human: preview + approve --by NAME --code CODE)──▶ approved ──(publish run, when due)──▶ posted
```

The publish stage is not a pipeline step: it is a queue (`publish/queue/queue.json`) with its own CLI
(`node factory.mjs publish ...`), driven by people and timers rather than by the orchestrator. See [publishing.md](publishing.md).

## Principles

- **Files are the interface.** Each step reads named files and writes named files. Nothing is passed in memory
  between steps, so any step can be re-run, replaced, or done by hand (edit `script.json`, drop in your own `voice.wav`).
- **Swap any provider.** Each step that talks to the outside world does it through an adapter in
  `providers/<kind>/`, chosen in one place (`providers` in `config/factory.config.json`). See [providers.md](providers.md).
- **Every kind has a `dry` adapter**, and `--dry-run` selects all of them: no keys, no network, no spending,
  but a real MP4 at the end.
- **Free and local by default**: a local LLM server, Piper for voice, Strudel or your own audio for music,
  ffmpeg for rendering. Paid services are opt-in, priced and capped.
- **Humans approve.** The pipeline ends at a draft in the publish queue. It never approves or posts. Posting happens
  only for items a person approved with the code bound to that exact file and text.

## Folders

```
factory.mjs                 orchestrator CLI (and `publish <command>`)
config/factory.config.json  defaults: provider selection (incl. the publisher), limits, caps, publish paths
templates/                  render templates (look and sound)
steps/NN-name/              run.mjs + README.md (the skill card) per step
providers/<kind>/<name>.mjs adapters: llm, tts, visuals, music, captions, publisher
lib/                        shared code (orchestrator, schema, captions, spend guard, ffmpeg, pixel font, wav)
publish/cli.mjs             the publish CLI: add, preview, approve, run, schedule, cancel, retry, stats, ...
publish/lib/                queue + state machine, approval codes, caption/video rules, run loop, settings
publish/queue|logs|data/    the queue file + run lock, optional log file, stats (git-ignored)
examples/                   the dry example job, Strudel patterns, Telegram approval bot, scheduler snippets
jobs/<slug>/                one folder per video (git-ignored)
test/                       offline unit tests (node --test)
```

## Job folder and state

`jobs/<slug>/state.json` records each step:

```json
{ "topic": "how tides work", "slug": "how-tides-work",
  "steps": { "voice": { "status": "done", "dryRun": true, "outputs": ["voice.wav", "voice.json"], "at": "..." } } }
```

Statuses: `running`, `done`, `stale`, `blocked`, `failed`.

Resume rules (in `lib/orchestrator.mjs`):

1. A step is skipped when it is `done`, all its listed outputs still exist, and it ran in the same mode (dry or real).
2. When a step runs, every later step that was `done` becomes `stale`, so it runs again next time.
3. A step can return `blocked` (for example a paid call without `--allow-spend`). The run stops there; the next run
   starts at that step.
4. A failure is recorded with its error and stops the run. Fix it and run the same command again.
5. `--force` redoes the selected steps. `--steps a,b` and `--from step` select steps.

Per-job overrides: `jobs/<slug>/config.json` (deep-merged over the defaults) and `jobs/<slug>/template.json`.

## Step interface

A step is `steps/NN-name/run.mjs` exporting `async function run(ctx)`:

```js
ctx = {
  name, jobDir, slug, topic,
  dryRun,        // true: use dry adapters, no network, no spending
  allowSpend,    // true only with --allow-spend
  config,        // merged config
  state,         // state.json contents
  log,           // { info, warn, error }
  file(name),    // absolute path inside the job folder
  args,          // parsed CLI flags (e.g. args.overrideQa)
}
// returns { outputs: ['file', ...], note?: '...' }  or  { status: 'blocked', note: '...' }
// throws on failure
```

Each `run.mjs` also runs on its own (`node steps/04-voice/run.mjs <slug>`): it goes through the orchestrator with
`force`, so `state.json` stays correct.

## Adding a step

1. Create `steps/NN-name/run.mjs` and `README.md` (copy an existing skill card).
2. Add the name to `STEP_ORDER` and `STEP_DIRS` in `lib/orchestrator.mjs`.
3. Write its outputs into the job folder and list them in the return value.
4. Add a test if it has logic worth testing without network.

## The publish queue

`publish/lib/queue.mjs` holds the state machine (`draft → approved → posting → posted`, plus `scheduled`, `failed`,
`cancelled`) and the approval code: a hash of the video file's SHA-256 plus caption, tags, title and platforms.
`publish/lib/runner.mjs` is the `run` loop. It takes all its I/O (publisher, save, hash, probe) as arguments, so it is
tested offline with fakes.

Crash safety:

- one `run`/`schedule` at a time (`run.lock` next to the queue; stale after 30 minutes);
- edit commands (`approve`, `cancel`, ...) load, change and save under the same lock;
- the queue file is written atomically (temp file, then rename);
- an item is saved as `posting` before any network call, and publishers save provider ids before sending, so a crash
  is resumed on the next run instead of repeated;
- every platform has its own record, so a failure on one never re-posts another.
