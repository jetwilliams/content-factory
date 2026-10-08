# Telegram approval (example)

Review publish-queue drafts from your phone. When step 9 (handoff) or `node factory.mjs publish add` queues a
draft, the bot sends it (the video plus the text preview) to you, and you approve it by replying with the draft's
id and approval code.

**The human approval gate is the point of the publish stage.** This bot only relays a human decision:

- It never approves anything on its own. There is no auto-approve and no "approve all".
- It only listens to the Telegram user IDs in `TELEGRAM_APPROVER_IDS`, and only in a private chat with
  the bot. Messages from anyone else, and from group chats, are ignored without a reply.
- `/approve <id> <code>` needs the approval code from the preview. The code is derived from the video
  file and the caption, so it approves exactly what you saw. If either changes, you get a new preview
  and the old code stops working.
- Old messages are skipped when the bot starts, so a restart never replays an approval.

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Find your numeric Telegram user ID (for example by messaging a "user info" bot, or by reading
   `message.from.id` from the Bot API `getUpdates` call after you message your bot).
3. In the repo's `.env`:

   ```
   TELEGRAM_BOT_TOKEN=<token from BotFather>
   TELEGRAM_APPROVER_IDS=<your numeric user id>
   ```

4. Message your bot once (`/start`) so it is allowed to message you, then run:

   ```
   node examples/telegram-approval/bot.mjs
   ```

It reads the same queue as `node factory.mjs publish` (`publish.queue` in `config/factory.config.json`). Posting
still happens through `node factory.mjs publish run` and the publisher selected in config.

Keep the bot running next to your scheduler (tmux, a systemd service, a launchd agent, ...). Only
run one copy per bot token: two processes polling the same bot steal each other's updates.

## Commands

| Command | What it does |
|---|---|
| `/drafts` | List drafts waiting for review |
| `/preview <id>` | Send the video and preview again |
| `/approve <id> <code>` | Approve exactly the previewed version |
| `/cancel <id>` | Cancel a draft (approved/scheduled items are cancelled from the CLI) |

Treat the bot token like a password: anyone with it can impersonate the bot (though not you, the
approver, because approvals are checked against your user ID).
