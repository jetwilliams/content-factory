#!/usr/bin/env node
// The publish stage of Content Factory: a queue of finished videos, a human approval gate, then posting.
//   node factory.mjs publish <command>    (same as: node publish/cli.mjs <command>)
// Step 9 (handoff) adds each finished video here as a DRAFT. Nothing is posted until a person has
// previewed it and approved it with its approval code. Secrets come from .env and are never printed.
// See the "Publishing" section of README.md and docs/publishing.md.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { publishSettings } from './lib/settings.mjs';
import * as log from './lib/log.mjs';
import * as Q from './lib/queue.mjs';
import { validateCaption } from './lib/caption.mjs';
import { probe, checkVideo } from './lib/probe.mjs';
import { parseWhen, fmtLocal } from './lib/time.mjs';
import { previewText } from './lib/preview.mjs';
import { runDue } from './lib/runner.mjs';
import { getPublisher } from './lib/publishers.mjs';
import { addDraftFromFile } from './lib/add.mjs';

const USAGE = `usage: node factory.mjs publish <command> [options]     (or: node publish/cli.mjs <command>)

  add <file.mp4> --caption "..." [--tags "a,b,c"] [--at now|+2h|"2026-11-02 18:00"|ISO]
                 [--platforms instagram,tiktok,youtube] [--title "YouTube title"]
                               add any video as a draft (step 9 does this for pipeline videos)
  list [--all]                 queue overview (--all includes posted and cancelled)
  status [<id>]                publisher readiness + queue counts, or one item in full
  preview <id>                 what a reviewer approves, including the approval code
  approve <id> --by "name" [--code CODE]
                               draft -> approved; asks for the code if --code is missing
  unapprove <id>               approved/scheduled -> draft (cancels a provider-side schedule)
  cancel <id>                  never post this item (cancels a provider-side schedule)
  reschedule <id> --at ...     change the time of a draft or approved item
  retry <id>                   failed -> approved; only the platforms that failed run again
  run [--dry-run] [--id N]     post every approved item that is due (safe to run from cron)
  schedule <id>                hand an approved item to the provider's own scheduler
  dry-run <id> [--schedule]    print the exact request(s) a live post would send; sends nothing
  stats [<id>|--all]           fetch per-post metrics into publish/data/stats.jsonl

The publisher is "providers.publisher" in config/factory.config.json (default: dry, which never posts).
Env overrides: CF_PUBLISHER, CF_PUBLISH_QUEUE, CF_PUBLISH_STATS, CF_PUBLISH_LOG_FILE. See .env.example.`;

class UsageError extends Error {}
const fail = (msg) => { throw new UsageError(msg); };

const queueFile = () => publishSettings().queue;
const store = () => Q.createStore(queueFile());
const statsFile = () => publishSettings().stats;
const safeProbe = (file) => (fs.existsSync(file) ? probe(file) : null);

function line(i) {
  const res = Object.entries(i.results || {}).map(([p, r]) => `${p}:${r.status}`).join(' ');
  return `#${String(i.id).padEnd(4)} ${i.status.padEnd(9)} ${fmtLocal(i.at).padEnd(28)} ${i.platforms.join('+').padEnd(25)} ${path.basename(i.file)}${res ? `  [${res}]` : ''}`;
}

// Runs fn on the queue under the run lock and saves afterwards.
const withQueue = (fn) => store().mutate(fn);

async function cancelProviderJobs(item, publisher, save) {
  for (const [p, r] of Object.entries(item.results)) {
    if (!r.jobId || r.status === 'posted') continue;
    if (!publisher.cancelScheduled) fail(`#${item.id} ${p} has provider job ${r.jobId} but publisher "${publisher.name}" cannot cancel it; cancel it in the provider's dashboard`);
    await publisher.cancelScheduled(item, p, r, { log, save });
    r.status = 'pending';
    log.info(`#${item.id} ${p}: provider job cancelled`);
  }
}

const commands = {
  async add(args, o) {
    const file = args[0] ? path.resolve(args[0]) : fail('add needs a video file');
    const { item, media } = await addDraftFromFile({ store: store(), file, caption: o.caption, tags: o.tags || '', at: o.at, platforms: o.platforms, title: o.title });
    console.log(previewText(item, media));
  },

  list(_args, o) {
    const q = store().load();
    const items = q.items.filter((i) => o.all || !['posted', 'cancelled'].includes(i.status));
    if (!items.length) return console.log(o.all ? 'queue is empty' : 'nothing pending (use --all to see posted/cancelled)');
    for (const i of items) console.log(line(i));
  },

  async status(args) {
    const q = store().load();
    if (args[0]) return console.log(JSON.stringify(Q.find(q, args[0]), null, 2));
    const pub = await getPublisher();
    const r = pub.ready();
    console.log(`publisher: ${pub.name}${pub.dry ? ' (dry: never posts)' : ''} - ${r.ok ? 'ready' : 'NOT ready, missing ' + r.missing.join(', ')}`);
    const rel = path.relative(process.cwd(), queueFile());
    console.log(`queue file: ${rel && !rel.startsWith('..') ? rel : queueFile()}`);
    const c = Q.counts(q);
    console.log(`queue: ${Object.entries(c).map(([k, v]) => `${v} ${k}`).join(', ') || 'empty'}`);
    const next = q.items.filter((i) => ['approved', 'scheduled'].includes(i.status)).sort((a, b) => a.at.localeCompare(b.at))[0];
    if (next) console.log(`next: #${next.id} at ${fmtLocal(next.at)}`);
    const drafts = q.items.filter((i) => i.status === 'draft').length;
    if (drafts) console.log(`${drafts} draft(s) waiting for a human: publish preview <id>, then publish approve <id> --by NAME --code CODE`);
  },

  preview(args) {
    const item = Q.find(store().load(), args[0] ?? fail('preview needs an id'));
    console.log(previewText(item, safeProbe(item.file)));
  },

  async approve(args, o) {
    const id = args[0] ?? fail('approve needs an id');
    const by = o.by || fail('approve needs --by "<who is approving>"');
    const item = Q.find(store().load(), id);
    if (!fs.existsSync(item.file)) fail(`file missing: ${item.file}`);
    let code = o.code;
    if (!code) {
      if (!process.stdin.isTTY) fail('approve needs --code (shown by `publish preview <id>`) when not run interactively');
      console.log(previewText(item, safeProbe(item.file)));
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      code = (await rl.question('\nType the approval code to approve exactly this post (empty = abort): ')).trim();
      rl.close();
      if (!code) fail('aborted; nothing approved');
    }
    // Re-loaded under the lock; Q.approve re-checks status, file hash and code against the fresh copy.
    const done = await withQueue((q) => Q.approve(q, id, { code, by, currentFileHash: Q.hashFile(item.file) }));
    log.info(`#${done.id} approved by ${done.approval.by}; posts ${new Date(done.at) <= new Date() ? 'on the next run' : 'at ' + fmtLocal(done.at)}`);
  },

  async unapprove(args) {
    const pub = await getPublisher();
    await withQueue(async (q, save) => {
      const item = Q.find(q, args[0] ?? fail('unapprove needs an id'));
      await cancelProviderJobs(item, pub, save);
      Q.unapprove(q, item.id);
      log.info(`#${item.id} back to draft`);
    });
  },

  async cancel(args) {
    const pub = await getPublisher();
    await withQueue(async (q, save) => {
      const item = Q.find(q, args[0] ?? fail('cancel needs an id'));
      if (item.status === 'posting') fail(`#${item.id} is being posted right now`);
      if (!['posted', 'cancelled'].includes(item.status)) await cancelProviderJobs(item, pub, save);
      Q.cancel(q, item.id);
      log.info(`#${item.id} cancelled`);
    });
  },

  async reschedule(args, o) {
    if (!o.at) fail('reschedule needs --at');
    let at;
    try { at = parseWhen(o.at); } catch (e) { fail(e.message); }
    await withQueue((q) => {
      const item = Q.reschedule(q, args[0] ?? fail('reschedule needs an id'), at);
      log.info(`#${item.id} now at ${fmtLocal(item.at)}`);
    });
  },

  async retry(args) {
    await withQueue((q) => {
      const item = Q.retry(q, args[0] ?? fail('retry needs an id'));
      log.info(`#${item.id} back to approved; failed platforms run again on the next run`);
    });
  },

  async run(_args, o) {
    const s = store();
    if (!s.acquireLock()) return log.info('run: another run is in progress; skipping');
    try {
      const publisher = await getPublisher();
      const r = publisher.ready();
      if (!r.ok && !o['dry-run']) fail(`publisher ${publisher.name} is not ready (missing ${r.missing.join(', ')})`);
      const q = s.load();
      const items = Q.dueItems(q).filter((i) => !o.id || String(i.id) === String(o.id));
      const summary = await runDue({ q, items, publisher, save: () => s.save(q), log, dryRun: !!o['dry-run'], hashFile: Q.hashFile, probe });
      s.save(q);
      if (items.length) log.info(`run: ${Object.entries(summary).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing to do'}`);
    } finally { s.releaseLock(); }
  },

  async schedule(args) {
    const s = store();
    if (!s.acquireLock()) fail('a run is in progress; try again in a minute');
    try {
      const publisher = await getPublisher();
      if (!publisher.schedule) fail(`publisher "${publisher.name}" has no native scheduler; leave the item approved and let \`run\` post it`);
      const r = publisher.ready();
      if (!r.ok) fail(`publisher ${publisher.name} is not ready (missing ${r.missing.join(', ')})`);
      const q = s.load();
      const save = () => s.save(q);
      const item = Q.find(q, args[0] ?? fail('schedule needs an id'));
      if (item.status !== 'approved') fail(`#${item.id} is ${item.status}; only approved items can be scheduled`);
      if (new Date(item.at) < new Date(Date.now() + 5 * 60e3)) fail(`#${item.id} is due ${fmtLocal(item.at)}; native scheduling needs at least 5 minutes of lead time (or just let \`run\` post it)`);
      const problem = Q.approvalProblem(item, Q.hashFile(item.file));
      if (problem) fail(`#${item.id}: ${problem}`);
      let any = false;
      for (const p of item.platforms) {
        const rec = (item.results[p] ||= { status: 'pending', attempts: 0 });
        if (['posted', 'scheduled'].includes(rec.status)) continue;
        try {
          const out = await publisher.schedule(item, p, rec, { log, save });
          Object.assign(rec, { status: 'scheduled', note: out.note ?? null });
          any = true;
          log.info(`#${item.id} ${p}: ${out.note || 'scheduled'} (job ${out.jobId})`);
        } catch (e) {
          rec.error = e.message;
          log.error(`#${item.id} ${p}: could not schedule: ${e.message}`);
        }
        save();
      }
      if (any) Q.transition(item, 'scheduled', `handed to ${publisher.name}`);
      save();
    } finally { s.releaseLock(); }
  },

  async 'dry-run'(args, o) {
    const item = Q.find(store().load(), args[0] ?? fail('dry-run needs an id'));
    const publisher = await getPublisher();
    const media = safeProbe(item.file);
    console.log(`DRY RUN #${item.id} (${item.status}) via ${publisher.name}; nothing is sent`);
    for (const p of item.platforms) {
      const v = media ? checkVideo(media, p) : { errors: ['file missing'], warnings: [] };
      const c = validateCaption(item, p);
      const issues = [...v.errors.map((e) => 'ERROR ' + e), ...c.errors.map((e) => 'ERROR ' + e), ...v.warnings, ...c.warnings];
      console.log(`\n[${p}]${issues.length ? '\n  ' + issues.join('\n  ') : ''}`);
      for (const l of publisher.describe(item, p, { scheduledAt: o.schedule ? item.at : undefined })) console.log('  ' + log.redact(l));
    }
  },

  async stats(args, o) {
    const publisher = await getPublisher();
    if (!publisher.metrics) fail(`publisher "${publisher.name}" does not provide metrics`);
    const q = store().load();
    const items = o.all || !args[0]
      ? q.items.filter((i) => Object.values(i.results).some((r) => r.status === 'posted'))
      : [Q.find(q, args[0])];
    const rows = [];
    const fetchedAt = new Date().toISOString();
    for (const item of items) {
      for (const [p, r] of Object.entries(item.results)) {
        if (r.status !== 'posted') continue;
        const row = { fetchedAt, id: item.id, platform: p, permalink: r.permalink || null };
        try { row.metrics = await publisher.metrics(item, p, r, { log }); } catch (e) { row.error = e.message; }
        rows.push(row);
        const m = row.metrics || {};
        console.log(`#${item.id} ${p.padEnd(9)} views=${m.views ?? '-'} likes=${m.likes ?? '-'} comments=${m.comments ?? '-'} shares=${m.shares ?? '-'}${row.error ? `  (${row.error})` : ''}`);
      }
    }
    if (!rows.length) return console.log('nothing posted yet');
    fs.mkdirSync(path.dirname(statsFile()), { recursive: true });
    fs.appendFileSync(statsFile(), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    log.info(`stats: ${rows.length} row(s) appended to ${path.relative(process.cwd(), statsFile())}`);
  },
};

// ---------------------------------------------------------------- main
// Returns an exit code: 0 ok, 1 error, 2 usage / queue rule refused it.
export async function main(argv) {
  const cmd = argv[0];
  if (!cmd || ['-h', '--help', 'help'].includes(cmd)) { console.log(USAGE); return 0; }
  if (!Object.hasOwn(commands, cmd)) { console.error(`unknown publish command "${cmd}"\n\n${USAGE}`); return 2; }
  try {
    const { positionals, values } = parseArgs({
      args: argv.slice(1),
      allowPositionals: true,
      options: {
        caption: { type: 'string' }, tags: { type: 'string' }, at: { type: 'string' }, platforms: { type: 'string' },
        title: { type: 'string' }, by: { type: 'string' }, code: { type: 'string' }, id: { type: 'string' },
        'dry-run': { type: 'boolean' }, all: { type: 'boolean' }, schedule: { type: 'boolean' },
      },
    });
    await commands[cmd](positionals, values);
    return 0;
  } catch (e) {
    console.error(`error: ${log.redact(e.message)}`);
    return e instanceof UsageError || e.name === 'QueueError' || e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' ? 2 : 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
