# Publishing: the queue, the approval gate, and posting

The pipeline's last step (9, handoff) puts each finished video into the **publish queue** as a **draft**.
From there, nothing posts until a person has looked at that exact item and approved it.

```
step 9 ──▶ draft ──(human: preview + approve with code)──▶ approved ──(publish run, when due)──▶ posted
```

All commands are `node factory.mjs publish <command>` (or `node publish/cli.mjs <command>`, the same thing).

## Why an approval gate?

Automated posting is useful, and it is also how accounts post the wrong cut, a caption with a typo, or something
that should never have gone out. Content Factory automates everything except the one decision that needs a human:

- **Approval is explicit.** `approve` needs a name (`--by`) and an **approval code** that `preview` shows you. You
  can't approve something you haven't previewed by accident, and a script can't "approve all".
- **Approval is bound to the content.** The code is a SHA-256-derived hash of the video file plus the caption, tags,
  title and platforms. If the file is re-rendered or the caption is edited after approval, `run` refuses to post it
  and marks it failed. Queue it again and approve the new version.
- **Safe by default.** A fresh install uses the `dry` publisher and only prints what it would send. You turn on real
  posting yourself, in `config/factory.config.json`.
- **No silent retries of bad posts.** Only transient errors (rate limits, timeouts, 5xx) are retried automatically.
  Anything else waits for a human to run `retry <id>`.
- **The pipeline never approves.** Step 9 only adds drafts. There is no flag that approves or posts from the pipeline.

## Walkthrough

```bash
node factory.mjs run "how tides work" --dry-run   # step 9 queues a draft and prints its preview + approval code
node factory.mjs publish list
node factory.mjs publish preview 1                # checks + the approval code
node factory.mjs publish approve 1 --by "Alex" --code 3f9c2a1b
node factory.mjs publish run --dry-run            # see exactly what would happen; sends nothing
```

(The dry example is placeholder content: cancel it with `publish cancel 1` instead of approving it for real.)

To queue a video that did not come from the pipeline: `node factory.mjs publish add my.mp4 --caption "..." --tags a,b`.

When you are ready to post for real: set up a publisher (below), set `"publisher"` in `config/factory.config.json`,
run `publish dry-run <id>` once to check the request, and put `publish run` on a timer.

`ffprobe` is used to check duration, aspect ratio, resolution and frame rate. Without it only the file type and size
are checked, with a warning.

## Commands

| Command | What it does |
|---|---|
| `add <file> --caption "..." [--tags a,b] [--at WHEN] [--platforms ...] [--title "..."]` | Validates the file and text, then adds a **draft** |
| `list [--all]` | Queue overview. `--all` includes posted and cancelled items |
| `status [<id>]` | Publisher readiness and queue counts, or one item's full record |
| `preview <id>` | Human-readable summary: file, specs, time, platforms, caption, checks, approval code |
| `approve <id> --by NAME [--code CODE]` | Draft to approved. Without `--code` it shows the preview and asks you to type the code |
| `unapprove <id>` | Approved/scheduled back to draft (cancels a provider-side schedule) |
| `cancel <id>` | Never post it (cancels a provider-side schedule) |
| `reschedule <id> --at WHEN` | Change the time of a draft or approved item |
| `retry <id>` | Failed back to approved. Platforms that already posted are not posted again |
| `run [--dry-run] [--id N]` | Post every approved item that is due. Safe to run from cron |
| `schedule <id>` | Hand an approved item to the provider's own scheduler |
| `dry-run <id> [--schedule]` | Print the exact request(s) a live post would send, with the API key redacted |
| `stats [<id>\|--all]` | Fetch per-post metrics (where the publisher supports them) into `publish/data/stats.jsonl` |

`--at` accepts `now`, `+30m`, `+2h`, `+1d`, `"2026-11-02 18:00"` (local time) or an ISO timestamp.
`--platforms` is a comma list of `instagram`, `tiktok`, `youtube` (default: all three). Step 9 uses
`config.handoff.at` and `config.handoff.platforms`.

Exit codes: `0` ok, `1` error, `2` refused (usage error or a queue rule, e.g. a wrong approval code).

### States

```
draft ──approve──▶ approved ──run──▶ posting ──▶ posted
  ▲                 │   │                 │
  └──unapprove──────┘   │                 ├─(transient error)─▶ approved, retried later with backoff
                        │                 └─(other error)─────▶ failed ──retry──▶ approved
                        └──schedule──▶ scheduled ──run (confirms)──▶ posted / failed

draft / approved / scheduled / failed ──cancel──▶ cancelled
```

Each platform is tracked separately inside an item (`results.instagram`, `results.tiktok`, ...), so a TikTok
failure never re-posts the Instagram copy.

Re-running step 9 for the same job is safe: an identical draft is reused, and a changed video or caption replaces
the job's older draft (which is cancelled with a note), so only the newest version waits for review.

## Validation

`add` (and step 9) refuses an item, and `run` refuses a platform, when:

- the file does not exist, or its container/size is not accepted by the platform;
- with ffprobe: there is no video stream, or the duration is outside the platform's range
  (Instagram 3 s to 15 min, TikTok 3 s to 10 min);
- there are more than **5 hashtags** (tags plus any `#tags` inside the caption);
- the caption is too long (Instagram and TikTok 2,200 characters, YouTube description 5,000 bytes),
  Instagram has more than 20 @mentions, or the YouTube text contains `<` or `>`.

Warnings (shown, not blocking): not 9:16, landscape, low resolution, unusual frame rate, no audio, YouTube video over
3 minutes (it will not be a Short), empty caption.

Platform limits change. The numbers live in `publish/lib/caption.mjs` (`LIMITS`) and `publish/lib/probe.mjs`
(`RULES`). Check them against the platforms' current documentation.

## Configuration

Like every other provider, the publisher is chosen in one place:

```jsonc
// config/factory.config.json
"providers": { ..., "publisher": "dry" },          // dry | upload-post | your own
"publish": {
  "queue": "publish/queue/queue.json",
  "stats": "publish/data/stats.jsonl",
  "logFile": "",
  "upload-post": { "aiLabel": true, "igShareToFeed": true, "tiktokPrivacy": "", "youtubePrivacy": "public", ... }
}
```

| Override (env) | Meaning |
|---|---|
| `CF_PUBLISHER` | Publisher for this run |
| `CF_PUBLISH_QUEUE` | Queue file |
| `CF_PUBLISH_STATS` | Where `stats` appends rows |
| `CF_PUBLISH_LOG_FILE` | Also append log lines to this file |
| `UPLOAD_POST_API_KEY`, `UPLOAD_POST_USER` | Upload-Post credentials (`.env` only) |
| `UPLOAD_POST_*` | Override any `publish.upload-post` option for one run |

Secrets are never printed. Values of any variable whose name contains `KEY`, `TOKEN`, `SECRET` or `PASSWORD` are
scrubbed from log output, and `dry-run` shows `Apikey [REDACTED]`.

The queue, logs and stats (`publish/queue/`, `publish/logs/`, `publish/data/`) and `.env` are git-ignored.

## How scheduling works

There are two ways an approved item gets posted.

**1. `publish run` on a timer (default).** Run it every 10 minutes from cron, launchd or a systemd timer
(snippets in [`examples/scheduler/`](../examples/scheduler)). Each run:

1. takes a lock (`run.lock` next to the queue file), so two runs never overlap; a stale lock from a crashed run
   expires after 30 minutes;
2. picks approved items whose time has passed, plus anything a crashed run left in `posting`;
3. re-checks that the file and text still match the approval;
4. for each platform not yet posted: saves the item as `posting` **before** the network call, posts, and records
   the post id and URL;
5. on a transient error, leaves that platform pending with exponential backoff (5 min, 10 min, 20 min, ... capped
   at 6 h; 5 attempts by default), then marks it failed.

`run` is idempotent: running it twice in a row never posts twice. The queue file is written atomically (temp file +
rename), and every edit command loads, changes and saves the queue under the same lock, so a `run` can never
overwrite an approval or a cancel. The Upload-Post publisher also saves a request id before uploading and sends it
as an idempotency key, so a lost response is resumed by polling rather than uploading again.

Your machine has to be awake for this mode.

**2. `publish schedule <id>` (provider-side).** Hands an approved item, with a time at least 5 minutes away, to the
provider's own scheduler. The provider posts it even if your machine is off. The item becomes `scheduled`; once it
is due, the next `run` asks the provider for the result and marks it `posted` (or `failed`). `cancel` and
`unapprove` also cancel the provider-side job.

## Publishers

Publishers are adapters in `providers/publisher/`. See [providers.md](providers.md#publisher) for the interface and
how to add one.

### Upload-Post

[Upload-Post](https://www.upload-post.com) is a paid API that posts to the accounts you connect in its dashboard,
so you do not need your own Meta, TikTok or Google developer apps.

1. Create an account and a profile, and connect your Instagram (professional account), TikTok and YouTube accounts
   to the profile.
2. Put the API key and the profile name in `.env` as `UPLOAD_POST_API_KEY` and `UPLOAD_POST_USER`, and set
   `"publisher": "upload-post"` in `config/factory.config.json`.
3. `node factory.mjs publish status` should say `ready`. Run `publish dry-run <id>` and compare the request with the
   [current API docs](https://docs.upload-post.com).

Each platform is uploaded separately, so a retry only repeats the platform that failed. Check your plan's limits and
pricing; every upload uses quota. `publish.upload-post.aiLabel` (on by default) marks posts as AI-generated where the
platform supports it.

## Telegram approval (optional)

[`examples/telegram-approval/`](../examples/telegram-approval) has a small bot that sends each new draft (video and
preview) to you on Telegram and accepts `/approve <id> <code>` **only** from the user IDs you allowlist in `.env`,
and only in a private chat. It does not auto-approve anything: it carries a human's decision from a phone to the queue.

## Limits and caveats

- **Follow the rules.** You are responsible for following the terms of service and community guidelines of every
  platform you post to, and of any provider you post through. That includes rules on automation, rate limits,
  disclosure of AI-generated or sponsored content, copyright and music licensing. See [responsible-use.md](responsible-use.md).
- Only post content you have the rights to.
- Platform limits and provider APIs change. Field names in the Upload-Post adapter follow its public docs at the
  time of writing; verify them with `dry-run` before your first live post.
- Single machine, single queue file. It is not built for many concurrent writers or very large queues.
- YouTube decides by itself whether a video is a Short (vertical or square, 3 minutes or less).
- TikTok may apply its own privacy defaults, and unaudited API clients can be limited to private posts.
- `stats` depends on what the provider exposes; some numbers arrive hours after posting.
