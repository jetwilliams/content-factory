# Step 2 · script

Turns notes into `script.json`: the contract every later step reads.

| Skill card | |
|---|---|
| **Input** | `notes.md` |
| **Output** | `script.json` (validated) |
| **Run** | `node factory.mjs run "<topic>" --steps script` or `node steps/02-script/run.mjs <slug>` |
| **Adapter** | `providers.llm` (same as research) |
| **Cost** | one LLM call, plus one retry if the reply is invalid |
| **Dry mode** | copies `examples/<slug>/script.json` if it exists, otherwise a placeholder script |
| **Done when** | `script.json` validates and reads well out loud |

## Shape

```json
{
  "topic": "how tides work",
  "title": "Why two tides a day?",
  "hook":  { "voice": "...", "onScreen": "..." },
  "beats": [ { "voice": "...", "onScreen": "...", "visual": { "source": "placeholder|folder|stock|ai", "query": "...", "prompt": "...", "file": "..." } } ],
  "cta":   { "voice": "...", "onScreen": "..." },
  "post":  { "caption": "...", "tags": ["science"] },
  "factCheck": { "status": "unchecked", "by": "", "notes": "" }
}
```

- `title` is shown big on the hook title plate. `voice` is spoken. `onScreen` is the short text for that beat
  (used as the placeholder-card label, and available to your own templates).
- The hook and CTA reuse the first/last beat's `visual` unless they set their own.
- The limits are **yours**: `config.script` sets `minBeats`/`maxBeats` (default 4-8), words per beat, on-screen
  length, title length, target length, audience, tone and the CTA hint. There is no house style.

## Check before moving on

- Read it aloud. Does the hook say what this is about in the first line?
- Every claim is in `notes.md`. No new numbers.
- Edit `script.json` by hand as much as you like; every later step re-validates it.
- When a human has verified the facts, set `factCheck.status` to `"checked"` and `factCheck.by` to their name.
