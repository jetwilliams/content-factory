# Step 3 · visuals

One image or clip per segment (hook, each beat, CTA).

| Skill card | |
|---|---|
| **Input** | `script.json` (`visual` on each beat) |
| **Output** | `visuals.json` (file, credit, licence, AI flag per segment), `visuals/`, `spend.json` when anything was paid |
| **Run** | `node steps/03-visuals/run.mjs <slug> [--allow-spend]` |
| **Adapters** | `providers.visuals` maps each `visual.source` to an adapter: `placeholder`→`dry`, `folder`→`folder`, `stock`→`pexels`, `ai`→`openai-images` (or `command`) |
| **Cost** | free for `dry`, `folder`, stock APIs with free keys; **paid** for most AI generation |
| **Dry mode** | coloured placeholder cards drawn by ffmpeg, labelled with the beat text |
| **Done when** | every segment has a file you have the right to use |

## The spend gate (paid adapters)

Paid generation is **off by default**, and stays capped when you turn it on:

1. Every paid request is estimated **before** any call. The estimate is printed.
2. Without `--allow-spend` the step stops (status `blocked`) and writes `visuals.estimate.json`.
3. With `--allow-spend`, the whole estimate must fit `config.visuals.spendCapUsd` (default **0**). If not, it stops.
4. An adapter with no price in `config.visuals.prices` is refused, because the cap could not be enforced.
5. Actual charges go to `spend.json`. A charge that passes the cap stops the run.
6. Identical requests (e.g. the hook reusing beat 1's visual) are fetched once and never paid twice.

A free local generator: use the `command` adapter and set its price to `0`.

## Sources

- `folder`: your own footage/images in `config.visuals.folder`. `visual.file` picks by name; otherwise `visual.query`
  words are matched against file names; otherwise files are used in order. Video clips are looped/trimmed to fit.
- `stock`: bring your own key. Credit the creator where the licence asks.
- `ai`: bring your own key. Prompts get "no text, no logos" appended. The job is flagged as containing AI visuals,
  which QA and the hand-off turn into a labelling reminder.

## Check before moving on

- Look at every image. Remove anything misleading for the claim it illustrates.
- No real people's likenesses, no logos or trademarks you don't own, nothing that pretends to be real footage.
- `visuals.json` has a credit and licence for every item.
