#!/usr/bin/env node
// Optional example: review publish-queue drafts from your phone over Telegram.
//
// What it does:
//   - Every minute, sends each NEW draft's preview (and the video, if it is small enough) to the
//     approvers' private chats.
//   - Accepts commands ONLY from Telegram user IDs listed in TELEGRAM_APPROVER_IDS, and only in a
//     private chat with the bot. Every other message is ignored.
//   - /approve <id> <code> approves exactly the version that was previewed (the code is tied to the
//     video file and the caption; if either changes, the old code stops working).
//
// What it deliberately does NOT do: approve anything by itself. There is no auto-approve, no
// "approve all", and no approval from a group chat. A human looking at the post is the whole point.
//
// Run:  node examples/telegram-approval/bot.mjs
// Env (.env in the repo root): TELEGRAM_BOT_TOKEN, TELEGRAM_APPROVER_IDS (comma-separated numeric IDs).
// It uses the same queue file as `node factory.mjs publish` (config "publish.queue" / CF_PUBLISH_QUEUE).
import fs from 'node:fs';
import path from 'node:path';
import { get, publishSettings } from '../../publish/lib/settings.mjs';
import * as log from '../../publish/lib/log.mjs';
import * as Q from '../../publish/lib/queue.mjs';
import { previewText } from '../../publish/lib/preview.mjs';
import { probe } from '../../publish/lib/probe.mjs';

const TOKEN = get('TELEGRAM_BOT_TOKEN');
const APPROVERS = new Set(String(get('TELEGRAM_APPROVER_IDS', '')).split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s)));
if (!TOKEN) { console.error('set TELEGRAM_BOT_TOKEN in .env'); process.exit(1); }
if (!APPROVERS.size) { console.error('set TELEGRAM_APPROVER_IDS in .env (numeric Telegram user IDs, comma-separated)'); process.exit(1); }

const API = `https://api.telegram.org/bot${TOKEN}`;
const settings = publishSettings();
const store = Q.createStore(settings.queue);
const NOTIFIED_FILE = path.join(path.dirname(settings.stats), 'telegram-notified.json');
const MAX_VIDEO_BYTES = 50e6; // Bot API upload limit

async function tg(method, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: isForm ? undefined : { 'content-type': 'application/json' },
    body: isForm ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`telegram ${method}: ${data.description || res.status}`);
  return data.result;
}

const send = (chatId, text) => tg('sendMessage', { chat_id: chatId, text: text.slice(0, 4000) });

async function sendPreview(chatId, item) {
  let media = null;
  try { media = probe(item.file); } catch { /* file missing: preview says so via checks */ }
  if (media && media.size <= MAX_VIDEO_BYTES) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', `Draft #${item.id}: review the video, then the text below.`);
    form.append('video', await fs.openAsBlob(item.file, { type: 'video/mp4' }), path.basename(item.file));
    try { await tg('sendVideo', form); } catch (e) { log.warn(`could not send the video for #${item.id}: ${e.message}`); }
  }
  const code = Q.approvalCode(item);
  await send(chatId, `${previewText(item, media)}\n\nTo approve exactly this post, reply:\n/approve ${item.id} ${code}\nTo drop it: /cancel ${item.id}`);
}

function loadNotified() {
  try { return new Set(JSON.parse(fs.readFileSync(NOTIFIED_FILE, 'utf8'))); } catch { return new Set(); }
}
function saveNotified(set) {
  fs.mkdirSync(path.dirname(NOTIFIED_FILE), { recursive: true });
  fs.writeFileSync(NOTIFIED_FILE, JSON.stringify([...set]));
}

// Notify approvers about drafts they have not seen yet (keyed by id + approval code, so an edited
// draft is sent again).
async function announceDrafts() {
  const notified = loadNotified();
  for (const item of store.load().items.filter((i) => i.status === 'draft')) {
    const key = `${item.id}:${Q.approvalCode(item)}`;
    if (notified.has(key)) continue;
    for (const id of APPROVERS) {
      try { await sendPreview(id, item); } catch (e) { log.warn(`preview #${item.id} to an approver failed: ${e.message}`); }
    }
    notified.add(key);
    saveNotified(notified);
  }
}

async function handle(msg) {
  const from = String(msg.from?.id || '');
  // The allowlist check comes first. Unknown senders get no reply at all.
  if (!APPROVERS.has(from) || msg.chat?.type !== 'private') {
    log.info(`ignored a message from a non-approved sender or chat (${msg.chat?.type || 'unknown'} chat)`);
    return;
  }
  const [cmd, id, code] = String(msg.text || '').trim().split(/\s+/);
  const reply = (t) => send(msg.chat.id, t);
  try {
    switch (cmd) {
      case '/start':
      case '/help':
        return reply('/drafts: list drafts\n/preview <id>: show one\n/approve <id> <code>: approve exactly what was previewed\n/cancel <id>: never post it');
      case '/drafts': {
        const drafts = store.load().items.filter((i) => i.status === 'draft');
        return reply(drafts.length ? drafts.map((i) => `#${i.id} ${path.basename(i.file)}`).join('\n') : 'no drafts waiting');
      }
      case '/preview':
        return sendPreview(msg.chat.id, Q.find(store.load(), id));
      case '/approve': {
        if (!id || !code) return reply('usage: /approve <id> <code> (the code is in the preview)');
        const item = await store.mutate((q) => {
          const it = Q.find(q, id);
          return Q.approve(q, id, { code, by: `telegram user ${from}`, currentFileHash: Q.hashFile(it.file) });
        });
        log.info(`#${item.id} approved via Telegram`);
        return reply(`#${item.id} approved. It posts at ${new Date(item.at).toISOString()} (or on the next run if that time has passed).`);
      }
      case '/cancel': {
        const item = await store.mutate((q) => {
          const it = Q.find(q, id);
          if (it.status !== 'draft') throw new Error(`#${it.id} is ${it.status}; cancel it from the CLI (it may have a provider-side schedule)`);
          return Q.cancel(q, id);
        });
        return reply(`#${item.id} cancelled.`);
      }
      default:
        return reply('unknown command; /help');
    }
  } catch (e) {
    return reply(`not done: ${e.message}`);
  }
}

async function main() {
  // Skip any backlog so old messages are never acted on after a restart.
  const backlog = await tg('getUpdates', { offset: -1, timeout: 0 });
  let offset = backlog.length ? backlog.at(-1).update_id + 1 : 0;
  log.info(`telegram approval bot running for ${APPROVERS.size} approver(s)`);

  let lastAnnounce = 0;
  for (;;) {
    if (Date.now() - lastAnnounce > 60e3) {
      lastAnnounce = Date.now();
      await announceDrafts().catch((e) => log.warn(`announce: ${e.message}`));
    }
    let updates = [];
    try {
      updates = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
    } catch (e) {
      log.warn(e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
    for (const u of updates) {
      offset = u.update_id + 1;
      if (u.message) await handle(u.message);
    }
  }
}

main().catch((e) => { log.error(e.message); process.exit(1); });
