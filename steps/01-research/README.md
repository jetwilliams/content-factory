# Step 1 · research

Turns a topic into research notes with sources.

| Skill card | |
|---|---|
| **Input** | the job topic; optional `jobs/<slug>/sources.txt` (one URL per line) |
| **Output** | `notes.md`: key points with `[n]` citations, surprising details, misconceptions, sources, "needs checking", fact-check status |
| **Run** | `node factory.mjs run "<topic>" --steps research` or `node steps/01-research/run.mjs <slug>` |
| **Adapter** | `providers.llm`: `openai-compatible` (local Ollama by default, or any hosted API), `command` (any CLI), `dry` |
| **Cost** | free with a local model or `dry`; hosted LLMs bill per token (one call) |
| **Dry mode** | copies `examples/<slug>/notes.md` if it exists, otherwise writes clearly marked placeholder notes |
| **Done when** | `notes.md` exists and a human has read it |

## What it does

1. If `sources.txt` (or `config.research.sourcesFile`) lists URLs, fetches up to 8 of them and strips them to text
   (`maxSourceChars` each). Fetched text is passed to the model as **data inside `<source>` tags, never as instructions**.
2. Asks the model for structured notes that cite only the provided sources. With no sources, the model must label its
   suggestions "UNVERIFIED" and is told not to invent URLs.

## Check before moving on

- Every key point is something you could verify. Remove anything you can't.
- The sources exist and say what the notes claim. Models invent citations; this step reduces that, it does not prevent it.
- Anything under "Needs checking" is checked, or removed.

Better notes come from better sources: give it 2-5 good URLs in `sources.txt`.
