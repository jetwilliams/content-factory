import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Q from '../publish/lib/queue.mjs';
import { runDue, backoffMs } from '../publish/lib/runner.mjs';
import { createDryPublisher } from '../providers/publisher/dry.mjs';
import { memoryLogger } from '../publish/lib/log.mjs';
import { tmpDir, draftItem, approved, fakePublisher, goodProbe } from './publish-helpers.mjs';

async function run(q, publisher, opts = {}) {
  let saves = 0;
  const log = memoryLogger();
  const now = opts.now || new Date();
  const summary = await runDue({
    q, items: Q.dueItems(q, now), publisher, log, now,
    save: () => { saves++; }, hashFile: Q.hashFile, probe: goodProbe, ...opts,
  });
  return { summary, saves, log };
}

test('posts a due approved item to every platform and marks it posted', async () => {
  const q = Q.emptyQueue();
  const item = approved(q, tmpDir());
  const pub = fakePublisher();
  const { summary } = await run(q, pub);
  assert.equal(item.status, 'posted');
  assert.deepEqual(pub.calls, ['1:instagram', '1:tiktok']);
  assert.equal(item.results.instagram.permalink, 'https://example.com/instagram/1');
  assert.equal(summary.posted, 2);
});

test('never posts drafts', async () => {
  const q = Q.emptyQueue();
  draftItem(q, tmpDir());
  const pub = fakePublisher();
  await run(q, pub);
  assert.deepEqual(pub.calls, []);
  assert.equal(q.items[0].status, 'draft');
});

test('is idempotent: a second run sends nothing again', async () => {
  const q = Q.emptyQueue();
  approved(q, tmpDir());
  const pub = fakePublisher();
  await run(q, pub);
  await runDue({ q, items: q.items, publisher: pub, log: memoryLogger(), save() {}, hashFile: Q.hashFile, probe: goodProbe });
  assert.equal(pub.calls.length, 2);
});

test('transient errors back off and retry only that platform', async () => {
  const q = Q.emptyQueue();
  const item = approved(q, tmpDir());
  const pub = fakePublisher({ tiktok: ['transient'] });
  const t0 = new Date();
  await run(q, pub, { now: t0 });
  assert.equal(item.results.instagram.status, 'posted');
  assert.equal(item.results.tiktok.status, 'pending');
  assert.equal(item.status, 'approved');
  assert.equal(new Date(item.results.tiktok.nextAttemptAt).getTime(), t0.getTime() + backoffMs(1));

  // Too early: nothing is sent.
  await run(q, pub, { now: new Date(t0.getTime() + 60e3) });
  assert.deepEqual(pub.calls, ['1:instagram', '1:tiktok']);

  // After the backoff: only tiktok is sent again.
  await run(q, pub, { now: new Date(t0.getTime() + backoffMs(1) + 1) });
  assert.deepEqual(pub.calls, ['1:instagram', '1:tiktok', '1:tiktok']);
  assert.equal(item.status, 'posted');
});

test('gives up after maxAttempts transient errors', async () => {
  const q = Q.emptyQueue();
  const item = approved(q, tmpDir(), { platforms: ['youtube'] });
  const pub = fakePublisher({ youtube: ['transient', 'transient'] });
  let now = new Date();
  await run(q, pub, { now, maxAttempts: 2 });
  now = new Date(now.getTime() + backoffMs(1) + 1);
  await run(q, pub, { now, maxAttempts: 2 });
  assert.equal(item.results.youtube.status, 'failed');
  assert.equal(item.status, 'failed');
});

test('a fatal error fails the platform; retry re-sends only that platform', async () => {
  const q = Q.emptyQueue();
  const item = approved(q, tmpDir());
  const pub = fakePublisher({ tiktok: ['fatal'] });
  await run(q, pub);
  assert.equal(item.status, 'failed');
  assert.equal(item.results.instagram.status, 'posted');
  assert.equal(item.results.tiktok.status, 'failed');
  Q.retry(q, item.id);
  await run(q, pub);
  assert.equal(item.status, 'posted');
  assert.deepEqual(pub.calls, ['1:instagram', '1:tiktok', '1:tiktok']);
});

test('refuses to post when the file changed after approval', async () => {
  const q = Q.emptyQueue();
  const item = approved(q, tmpDir());
  fs.writeFileSync(item.file, 'swapped video');
  const pub = fakePublisher();
  await run(q, pub);
  assert.deepEqual(pub.calls, []);
  assert.equal(item.status, 'failed');
  assert.match(item.history.at(-1).note, /changed since approval/);
});

test('refuses to post when the caption was edited after approval', async () => {
  const q = Q.emptyQueue();
  const item = approved(q, tmpDir());
  item.captionText = 'edited in the JSON by hand';
  const pub = fakePublisher();
  await run(q, pub);
  assert.deepEqual(pub.calls, []);
  assert.equal(item.status, 'failed');
});

test('--dry-run and the dry publisher change nothing', async () => {
  const q = Q.emptyQueue();
  const item = approved(q, tmpDir());
  const before = JSON.stringify(item);
  const pub = fakePublisher();
  const a = await run(q, pub, { dryRun: true });
  assert.deepEqual(pub.calls, []);
  assert.equal(a.saves, 0);
  const b = await run(q, createDryPublisher());
  assert.equal(b.saves, 0);
  assert.equal(JSON.stringify(item), before);
  assert.ok(a.log.lines.some((l) => l.includes('would send')));
});

test('resumes an item left in "posting" by a crashed run', async () => {
  const q = Q.emptyQueue();
  const item = approved(q, tmpDir(), { at: new Date(Date.now() + 3600e3) });
  Q.transition(item, 'posting');
  item.results.instagram = { status: 'posted', attempts: 1 };
  item.results.tiktok = { status: 'posting', attempts: 1, fakeRef: 'saved-before-crash' };
  const pub = fakePublisher();
  await run(q, pub);
  assert.deepEqual(pub.calls, ['1:tiktok']);
  assert.equal(item.status, 'posted');
});

test('validation errors fail the platform without calling the publisher', async () => {
  const q = Q.emptyQueue();
  const item = approved(q, tmpDir(), { platforms: ['instagram'] });
  const pub = fakePublisher();
  await run(q, pub, { probe: (f) => ({ ...goodProbe(f), duration: 1200 }) });
  assert.deepEqual(pub.calls, []);
  assert.equal(item.results.instagram.status, 'failed');
  assert.equal(item.status, 'failed');
});

test('backoff grows exponentially and is capped', () => {
  assert.equal(backoffMs(1, { backoffBaseMs: 1000 }), 1000);
  assert.equal(backoffMs(3, { backoffBaseMs: 1000 }), 4000);
  assert.equal(backoffMs(30, { backoffBaseMs: 1000, backoffMaxMs: 5000 }), 5000);
});
