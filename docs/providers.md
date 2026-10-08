# Providers (adapters): swap any of them

Every step that talks to a model, an API or an external tool does it through an **adapter**: one small file in
`providers/<kind>/<name>.mjs` with a default-exported object. You choose adapters in **one place**:

```jsonc
// config/factory.config.json  (or jobs/<slug>/config.json for one job)
"providers": {
  "llm": "openai-compatible",
  "tts": "piper",
  "visuals": { "placeholder": "dry", "folder": "folder", "stock": "pexels", "ai": "openai-images" },
  "music": "strudel-command",
  "musicFallback": "dry",
  "captions": "even-split",
  "publisher": "dry"
}
```

- `--dry-run` selects the `dry` adapter of every kind.
- For one run, `CF_LLM_PROVIDER`, `CF_TTS_PROVIDER`, `CF_MUSIC_PROVIDER`, `CF_CAPTIONS_PROVIDER`, `CF_PUBLISHER`
  override the config.
- Keys live in `.env` (see `.env.example`), never in config files.
- `node factory.mjs providers` lists what is installed and what is selected.

## What ships

| Kind | Adapters | Free/local default |
|---|---|---|
| `llm` | `dry`, `openai-compatible`, `command` | `openai-compatible` pointed at a local server (default base URL `http://127.0.0.1:11434/v1`) |
| `tts` | `dry`, `piper`, `command` | `piper` |
| `visuals` | `dry`, `folder`, `pexels`, `openai-images`, `command` | `folder` (your footage) / `dry` |
| `music` | `dry`, `none`, `strudel-command`, `wav-folder`, `file`, `command` | `strudel-command` (your own renderer), else `dry` |
| `captions` | `dry`, `even-split`, `command` | `even-split` |
| `publisher` | `dry`, `upload-post`, `template` (a stub to copy) | `dry` (never posts) |

`pexels` and `openai-images` are **example** adapters for common API shapes. They are not covered by the offline
tests. Check the provider's current API docs, pricing and terms before relying on them.

## Interfaces

All adapters have `name` and `paid` (boolean). Paid adapters also have `estimateUsd(...)`, which returns the price
of one call in USD, or `null` when unknown (unknown = refused by the spend gate). A price of exactly `0` marks a
"paid-type" adapter as free (for example a local generator behind `command`).

### llm

```js
export default {
  name: 'my-llm', paid: false, canned: false,
  async complete({ system, prompt, maxTokens, temperature }) { return 'text reply'; },
};
```

`canned: true` (only the `dry` adapter) tells research/script to use their built-in example output.
The script step extracts the first JSON object from the reply, validates it, and retries once with the errors.

### tts

```js
export default {
  name: 'my-tts', paid: false, licence: 'what the voice licence is',
  // Write a WAV (any rate/format ffmpeg reads) to outFile. words: optional [{word, start, end}] in seconds.
  async synth({ text, outFile, config, log }) { return { file: outFile, words: null }; },
};
```

### visuals

```js
export default {
  name: 'my-visuals', paid: true,
  estimateUsd(request, config) { return config.visuals.prices['my-visuals'] ?? null; },
  // request: { index, segmentId, source, query, prompt, file, label }
  // outBase: path without extension inside jobs/<slug>/visuals/ — add your own extension.
  async fetch(request, { outBase, config, log }) {
    return { file: `${outBase}.png`, credit: 'who made it', licence: 'terms', aiGenerated: true, usd: 0.04, requestId: 'id' };
  },
};
```

Return an absolute path to use a file in place (the `folder` adapter does), or a file inside `visuals/`.
`usd` is the actual charge if the API reports it; otherwise the estimate is recorded.

### music

```js
export default {
  name: 'my-music', paid: false,
  // seconds: the voice length + 1. Write audio to outFile, or return null for no music.
  async make({ seconds, outFile, config, log, slug }) { return { file: outFile, source: 'what it is', licence: 'terms' }; },
};
```

If `make` throws an error starting with `set CF_...` or `set config....` (meaning "not set up yet"), the step falls back
to `providers.musicFallback`.

### captions

```js
export default {
  name: 'my-aligner', paid: false,
  // voice: voice.json contents. Return words with absolute times and the segment id each belongs to.
  async words({ voice, ctx }) { return [{ word: 'Hello', start: 0.0, end: 0.3, segment: 'hook' }]; },
};
```

### publisher

Publishers post **approved** items from the publish queue (see [publishing.md](publishing.md)). They are only called by
`node factory.mjs publish run | schedule | dry-run | cancel | unapprove | stats`, never by a pipeline step, and only
for items a person approved. A publisher file default-exports a factory:

```js
export default { name: 'my-publisher', paid: true, create: (overrides) => createMyPublisher(overrides) };

// create() returns:
{
  name: 'my-publisher',
  platforms: ['instagram', 'tiktok', 'youtube'],
  dry: false,                              // true = run only calls describe(), never publish()
  ready() { return { ok: true, missing: [] }; },          // which keys are missing (names only, never values)
  describe(item, platform, { scheduledAt }) { return ['POST https://...', '  Authorization: Bearer [REDACTED]']; },
  async publish(item, platform, record, { log, save, now }) { return { postId, permalink, note }; },
  // optional:
  async schedule(item, platform, record, { log, save }) { return { jobId, note }; },
  async cancelScheduled(item, platform, record, { log, save }) {},
  async metrics(item, platform, record, { log }) { return { views, likes, comments, shares }; },
}
```

`item` is the queue entry: `file`, `captionText` (caption + hashtags, exactly what was approved), `caption`, `tags`,
`title`, `platforms`, `at`. Rules for `publish`:

- Store any provider ids on `record` (this platform's entry in the queue) and call `save()` **before** sending, so a
  crash or a lost response is resumed on the next run instead of posting twice.
- If `record` already holds ids from an earlier attempt, ask the provider about those first.
- Throw `PublishError` (`publish/lib/errors.mjs`) with `transient: true` for errors worth retrying later (rate limits,
  timeouts, 5xx). Anything else marks the platform failed until a human runs `publish retry <id>`.
- `describe` must print exactly what a live call sends, with secrets replaced by `[REDACTED]`.

To add one:

1. Copy `providers/publisher/template.mjs` to `providers/publisher/my-publisher.mjs` and implement it.
   Read keys with `get('MY_PUBLISHER_API_KEY')` from `publish/lib/settings.mjs`; put non-secret options in the
   `publish` block of the config.
2. Set `"publisher": "my-publisher"` in `providers` (or `CF_PUBLISHER=my-publisher` for one run).
3. Check it with `node factory.mjs publish status`, `publish dry-run <id>` and `publish run --dry-run`.
4. Test it offline with a fake `fetch` (see `test/publish-uploadpost.test.mjs`) or the fake publisher in
   `test/publish-helpers.mjs`.

## Adding a provider

1. Copy the closest existing adapter to `providers/<kind>/<your-name>.mjs`.
2. Read keys with `env('CF_YOUR_KEY')` from `lib/env.mjs`. Never log them. Add the variable names (empty) to `.env.example`.
3. Call external tools with `runCmd` (no shell) and `fillCommand` for templates, so file names with spaces are safe.
4. If it costs money: `paid: true`, an `estimateUsd`, and a price entry in config. The step does the rest
   (estimate, `--allow-spend`, cap, ledger).
5. Select it in `providers` and run the step on a test job.

## Command adapters

Several kinds have a `command` adapter that runs any CLI from a template in `.env`:

| Variable | Placeholders |
|---|---|
| `CF_LLM_COMMAND` | prompt on stdin, answer on stdout |
| `CF_TTS_COMMAND` | `{text_file}` `{out}` (optional `{out}.words.json`) |
| `CF_IMAGE_COMMAND` | `{prompt_file}` `{out}` |
| `CF_MUSIC_COMMAND` | `{seconds}` `{out}` `{prompt}` `{pattern}` |
| `CF_ALIGN_COMMAND` | `{audio}` `{text_file}` `{out}` |
| `CF_STRUDEL_RENDER_CMD` | `{pattern}` `{seconds}` `{out}` |

Each placeholder becomes exactly one argument (no shell), so quoting problems and injection through file names are avoided.
