import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as Q from '../publish/lib/queue.mjs';
import { tmpDir, fakeVideo, draftItem, approved } from './publish-helpers.mjs';

test('add creates a draft with a caption built from caption + tags', () => {
  const q = Q.emptyQueue();
  const item = draftItem(q, tmpDir());
  assert.equal(item.id, 1);
  assert.equal(item.status, 'draft');
  assert.equal(item.captionText, 'My first post\n\n#demo #test');
  assert.equal(item.approval, null);
  assert.equal(q.nextId, 2);
});

test('approve needs the matching approval code', () => {
  const q = Q.emptyQueue();
  const item = draftItem(q, tmpDir());
  const hash = Q.hashFile(item.file);
  assert.throws(() => Q.approve(q, item.id, { code: 'deadbeef', by: 'tester', currentFileHash: hash }), /approval code does not match/);
  assert.throws(() => Q.approve(q, item.id, { by: 'tester', currentFileHash: hash }), /approval code/);
  assert.equal(item.status, 'draft');
  Q.approve(q, item.id, { code: Q.approvalCode(item).toUpperCase(), by: 'tester', currentFileHash: hash });
  assert.equal(item.status, 'approved');
  assert.equal(item.approval.by, 'tester');
});

test('approve needs a name', () => {
  const q = Q.emptyQueue();
  const item = draftItem(q, tmpDir());
  assert.throws(() => Q.approve(q, item.id, { code: Q.approvalCode(item), by: '  ', currentFileHash: item.fileHash }), /needs a name/);
});

test('the approval code changes when any approved content changes', () => {
  const q = Q.emptyQueue();
  const item = draftItem(q, tmpDir());
  const code = Q.approvalCode(item);
  for (const mutate of [
    (i) => { i.captionText += '!'; },
    (i) => { i.platforms = [...i.platforms, 'youtube']; },
    (i) => { i.fileHash = '0'.repeat(64); },
    (i) => { i.title = 'Other title'; },
  ]) {
    const copy = structuredClone(item);
    mutate(copy);
    assert.notEqual(Q.approvalCode(copy), code);
  }
  // Platform order does not matter.
  assert.equal(Q.approvalCode({ ...item, platforms: [...item.platforms].reverse() }), code);
});

test('approval refuses a file that changed after it was added', () => {
  const dir = tmpDir();
  const q = Q.emptyQueue();
  const item = draftItem(q, dir);
  fs.writeFileSync(item.file, 'edited after adding');
  assert.throws(() => Q.approve(q, item.id, { code: Q.approvalCode(item), by: 'tester', currentFileHash: Q.hashFile(item.file) }), /changed/);
});

test('approvalProblem detects edits made after approval', () => {
  const dir = tmpDir();
  const q = Q.emptyQueue();
  const item = approved(q, dir);
  assert.equal(Q.approvalProblem(item, Q.hashFile(item.file)), null);
  assert.match(Q.approvalProblem(item, 'other-hash'), /file changed/);
  item.captionText = 'sneaky edit';
  assert.match(Q.approvalProblem(item, item.fileHash), /content changed/);
  item.approval = null;
  assert.equal(Q.approvalProblem(item, item.fileHash), 'not approved');
});

test('only drafts can be approved; posted and cancelled are final', () => {
  const q = Q.emptyQueue();
  const item = approved(q, tmpDir());
  assert.throws(() => Q.approve(q, item.id, { code: Q.approvalCode(item), by: 'x', currentFileHash: item.fileHash }), /only drafts/);
  Q.transition(item, 'posting');
  Q.transition(item, 'posted');
  assert.throws(() => Q.cancel(q, item.id), /cannot move/);
  assert.throws(() => Q.transition(item, 'approved'), /cannot move/);
  const other = draftItem(q, tmpDir());
  Q.cancel(q, other.id);
  assert.throws(() => Q.transition(other, 'draft'), /cannot move/);
});

test('drafts cannot jump straight to posting', () => {
  const q = Q.emptyQueue();
  const item = draftItem(q, tmpDir());
  assert.throws(() => Q.transition(item, 'posting'), /cannot move/);
  assert.throws(() => Q.transition(item, 'scheduled'), /cannot move/);
});

test('unapprove returns to draft and clears the approval', () => {
  const q = Q.emptyQueue();
  const item = approved(q, tmpDir());
  Q.unapprove(q, item.id);
  assert.equal(item.status, 'draft');
  assert.equal(item.approval, null);
  assert.throws(() => Q.unapprove(q, item.id), /only approved/);
});

test('reschedule works on drafts and approved items only', () => {
  const q = Q.emptyQueue();
  const item = approved(q, tmpDir());
  const when = new Date('2030-01-01T10:00:00Z');
  Q.reschedule(q, item.id, when);
  assert.equal(item.at, when.toISOString());
  assert.equal(item.status, 'approved');
  Q.cancel(q, item.id);
  assert.throws(() => Q.reschedule(q, item.id, when), /only drafts and approved/);
});

test('retry resets only the failed platforms', () => {
  const q = Q.emptyQueue();
  const item = approved(q, tmpDir());
  Q.transition(item, 'posting');
  item.results = {
    instagram: { status: 'posted', attempts: 1, postId: 'p1' },
    tiktok: { status: 'failed', attempts: 5, error: 'rejected' },
  };
  Q.transition(item, 'failed', 'tiktok failed');
  Q.retry(q, item.id);
  assert.equal(item.status, 'approved');
  assert.equal(item.results.instagram.status, 'posted');
  assert.deepEqual(
    { s: item.results.tiktok.status, a: item.results.tiktok.attempts, e: item.results.tiktok.error },
    { s: 'pending', a: 0, e: null },
  );
  assert.throws(() => Q.retry(q, item.id), /not failed/);
});

test('dueItems: approved/scheduled and due, plus stuck posting items; never drafts', () => {
  const dir = tmpDir();
  const q = Q.emptyQueue();
  const draft = draftItem(q, dir, { file: fakeVideo(dir, 'a.mp4') });
  const due = approved(q, dir, { file: fakeVideo(dir, 'b.mp4') });
  const later = approved(q, dir, { file: fakeVideo(dir, 'c.mp4'), at: new Date(Date.now() + 3600e3) });
  const stuck = approved(q, dir, { file: fakeVideo(dir, 'd.mp4'), at: new Date(Date.now() + 3600e3) });
  Q.transition(stuck, 'posting');
  const ids = Q.dueItems(q).map((i) => i.id);
  assert.ok(ids.includes(due.id));
  assert.ok(ids.includes(stuck.id));
  assert.ok(!ids.includes(draft.id));
  assert.ok(!ids.includes(later.id));
});

test('history records every transition', () => {
  const q = Q.emptyQueue();
  const item = approved(q, tmpDir());
  Q.unapprove(q, item.id);
  assert.deepEqual(item.history.map((h) => h.to), ['draft', 'approved', 'draft']);
});

test('store: save/load round trip and run lock', () => {
  const dir = tmpDir();
  const s = Q.createStore(path.join(dir, 'queue', 'queue.json'));
  assert.deepEqual(s.load(), Q.emptyQueue());
  const q = Q.emptyQueue();
  draftItem(q, dir);
  s.save(q);
  assert.equal(s.load().items.length, 1);
  assert.equal(s.acquireLock(), true);
  assert.equal(s.acquireLock(), false);
  s.releaseLock();
  assert.equal(s.acquireLock(), true);
  s.releaseLock();
});
