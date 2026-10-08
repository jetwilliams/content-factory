# Step 9 · handoff

Adds the finished video to the built-in **publish queue** as a **draft**, then prints the preview and the command a
person uses to approve it. This step never approves, schedules or posts anything.

| Skill card | |
|---|---|
| **Input** | `qa.json` (must pass), `render.json`, `script.json` (`title`, `post.caption`, `post.tags`) |
| **Output** | `handoff.json` (queue id, approval code, approve command, review checklist) + a draft in `publish/queue/queue.json` |
| **Run** | `node steps/09-handoff/run.mjs <slug> [--override-qa]` |
| **Cost** | free |
| **Done when** | the draft is in the queue and a human has the preview and the checklist |

- Validates the video and the text for every platform (container, size, duration, hashtags, caption length) before
  queueing. Tags are cleaned (lowercase, letters/digits/_ only, max 5). `config.handoff.at` and `platforms` set the defaults.
- Prints the preview (file, specs, time, platforms, caption, checks, **approval code**) and:
  `approve with: node factory.mjs publish approve <id> --by NAME --code CODE`
- Re-running it for the same job is safe: an identical draft is reused; a changed video or caption replaces the
  older draft of that job (the old one is cancelled), so only the newest version waits for review.
- In a `--dry-run` the draft is still queued (so you can try the approval flow), and it is marked as placeholder
  content in the preview. Cancel it instead of approving it.
- Refuses when QA failed, unless a human re-runs it with `--override-qa`.

The checklist in `handoff.json`: watch it with sound, fact-check, turn on AI-content labels, check licences, then
`publish preview` and `publish approve`. See the "Publishing" section of the main README.
