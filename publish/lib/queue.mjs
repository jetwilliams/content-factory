// The queue and its state machine.
//
//   draft ──approve──▶ approved ──run──▶ posting ──▶ posted
//     ▲                 │  │  ▲                │
//     └───unapprove─────┘  │  └─(transient)────┤
//                          │                   ▼
//                          └─schedule─▶ scheduled ─run─▶ posted / failed ──retry──▶ approved
//
//   draft / approved / scheduled / failed ──cancel──▶ cancelled
//
// Approval is bound to the exact content: a SHA-256 of the video file plus the caption, tags, title and
// platforms. The resulting "approval code" is shown in `preview` and must be given back to `approve`.
// If any of that changes after approval, `run` refuses to post it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { QueueError } from './errors.mjs';
import { buildCaption } from './caption.mjs';

export const STATUSES = ['draft', 'approved', 'scheduled', 'posting', 'posted', 'failed', 'cancelled'];

export const TRANSITIONS = {
  draft: ['approved', 'cancelled'],
  approved: ['draft', 'posting', 'scheduled', 'failed', 'cancelled'],
  scheduled: ['draft', 'posting', 'approved', 'failed', 'cancelled'],
  posting: ['posted', 'failed', 'approved'],
  failed: ['approved', 'cancelled'],
  posted: [],
  cancelled: [],
};

export const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

export function transition(item, to, note, now = new Date()) {
  if (item.status === to) return item;
  if (!canTransition(item.status, to)) throw new QueueError(`#${item.id} is ${item.status}; cannot move to ${to}`);
  item.history.push({ at: now.toISOString(), from: item.status, to, ...(note ? { note } : {}) });
  item.status = to;
  return item;
}

// ---------------------------------------------------------------- persistence
export const emptyQueue = () => ({ version: 1, nextId: 1, items: [] });

export function createStore(file) {
  const lockFile = path.join(path.dirname(file), 'run.lock');
  return {
    file,
    load() {
      if (!fs.existsSync(file)) return emptyQueue();
      const q = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(q.items) || typeof q.nextId !== 'number') throw new QueueError(`${file} is not a queue file`);
      return q;
    },
    // Atomic: write a temp file, then rename over the original.
    save(q) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(q, null, 2) + '\n');
      fs.renameSync(tmp, file);
    },
    // One `run`/`schedule` at a time. A lock older than staleMs (crashed process) is taken over.
    acquireLock(staleMs = 30 * 60e3) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      try {
        fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: 'wx' });
        return true;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        const age = Date.now() - fs.statSync(lockFile).mtimeMs;
        if (age < staleMs) return false;
        fs.rmSync(lockFile, { force: true });
        return this.acquireLock(staleMs);
      }
    },
    releaseLock() { fs.rmSync(lockFile, { force: true }); },
    // Load, change, save, all under the lock, so an edit can never be overwritten by a `run` that
    // loaded the queue earlier. Waits up to waitMs for a running `run` to finish.
    async mutate(fn, { waitMs = 15e3 } = {}) {
      const until = Date.now() + waitMs;
      while (!this.acquireLock()) {
        if (Date.now() > until) throw new QueueError('the queue is busy (a run is in progress); try again in a minute');
        await new Promise((r) => setTimeout(r, 250));
      }
      try {
        const q = this.load();
        const out = await fn(q, () => this.save(q));
        this.save(q);
        return out;
      } finally { this.releaseLock(); }
    },
  };
}

// ---------------------------------------------------------------- hashing / approval codes
export function hashFile(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

// Everything a human approves. Change any of it and the code changes.
export function approvalCode(item) {
  const content = JSON.stringify({
    fileHash: item.fileHash,
    captionText: item.captionText,
    tags: item.tags,
    title: item.title || null,
    platforms: [...item.platforms].sort(),
  });
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
}

// Returns null when the item may be posted, otherwise the reason it may not.
export function approvalProblem(item, currentFileHash) {
  if (!item.approval) return 'not approved';
  if (item.approval.code !== approvalCode(item)) return 'content changed since approval';
  if (currentFileHash !== item.fileHash) return 'video file changed since approval; add it again and re-approve';
  return null;
}

// ---------------------------------------------------------------- operations
export function find(q, id) {
  const item = q.items.find((i) => String(i.id) === String(id).replace(/^#/, ''));
  if (!item) throw new QueueError(`no item #${id}`);
  return item;
}

export function addDraft(q, { file, fileHash, caption = '', tags = [], platforms, at, title }, now = new Date()) {
  if (!platforms?.length) throw new QueueError('at least one platform is required');
  const item = {
    id: q.nextId++,
    status: 'draft',
    file,
    fileHash,
    platforms: [...new Set(platforms)],
    caption,
    tags,
    captionText: buildCaption(caption, tags),
    ...(title ? { title } : {}),
    at: new Date(at ?? now).toISOString(),
    createdAt: now.toISOString(),
    approval: null,
    results: {},
    history: [{ at: now.toISOString(), from: null, to: 'draft' }],
  };
  q.items.push(item);
  return item;
}

export function approve(q, id, { code, by, currentFileHash, now = new Date() }) {
  const item = find(q, id);
  if (item.status !== 'draft') throw new QueueError(`#${item.id} is ${item.status}; only drafts can be approved`);
  if (currentFileHash !== item.fileHash) throw new QueueError(`#${item.id}: the video file changed since it was added; add it again`);
  const expected = approvalCode(item);
  if (!code || String(code).trim().toLowerCase() !== expected) {
    throw new QueueError(`#${item.id}: approval code does not match; run \`node factory.mjs publish preview ${item.id}\` and check what you are approving`);
  }
  if (!by || !String(by).trim()) throw new QueueError('approval needs a name (--by)');
  item.approval = { code: expected, by: String(by).trim(), at: now.toISOString() };
  return transition(item, 'approved', `approved by ${item.approval.by}`, now);
}

export function unapprove(q, id, now = new Date()) {
  const item = find(q, id);
  if (!['approved', 'scheduled'].includes(item.status)) throw new QueueError(`#${item.id} is ${item.status}; only approved or scheduled items can be unapproved`);
  if (Object.values(item.results).some((r) => r.status === 'posted')) throw new QueueError(`#${item.id} is already live on some platforms; cancel it instead`);
  item.approval = null;
  return transition(item, 'draft', 'unapproved', now);
}

export function cancel(q, id, now = new Date()) {
  const item = find(q, id);
  return transition(item, 'cancelled', 'cancelled', now);
}

export function reschedule(q, id, at, now = new Date()) {
  const item = find(q, id);
  if (!['draft', 'approved'].includes(item.status)) throw new QueueError(`#${item.id} is ${item.status}; only drafts and approved items can be rescheduled`);
  const old = item.at;
  item.at = new Date(at).toISOString();
  item.history.push({ at: now.toISOString(), from: item.status, to: item.status, note: `rescheduled ${old} -> ${item.at}` });
  return item;
}

// failed -> approved. Platforms that already posted stay posted; only the failed ones run again.
export function retry(q, id, now = new Date()) {
  const item = find(q, id);
  if (item.status !== 'failed') throw new QueueError(`#${item.id} is ${item.status}, not failed`);
  if (!item.approval) throw new QueueError(`#${item.id} was never approved`);
  for (const r of Object.values(item.results)) {
    if (r.status === 'failed') Object.assign(r, { status: 'pending', attempts: 0, nextAttemptAt: null, error: null });
  }
  return transition(item, 'approved', 'retry', now);
}

// Items `run` should look at: approved/scheduled ones that are due, plus anything left in `posting`
// by a crashed run (the publisher resumes those from the ids it saved).
export function dueItems(q, now = new Date()) {
  return q.items
    .filter((i) => i.status === 'posting' || (['approved', 'scheduled'].includes(i.status) && new Date(i.at) <= now))
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function counts(q) {
  const c = {};
  for (const i of q.items) c[i.status] = (c[i.status] || 0) + 1;
  return c;
}
