// Step 9 → publish queue, and the publisher selection. Offline: fake "videos", temp queue files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as Q from '../publish/lib/queue.mjs';
import { run as handoff, approveCommand } from '../steps/09-handoff/run.mjs';
import { publishSettings } from '../publish/lib/settings.mjs';
import { getPublisher } from '../publish/lib/publishers.mjs';
import { providerName } from '../lib/providers.mjs';
import { silentLogger } from '../lib/util.mjs';
import { tmpDir } from './publish-helpers.mjs';

function fakeJob({ pass = true, caption = 'Tides, explained in 30 seconds', video = 'not really a video' } = {}) {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'job.mp4'), video);
  fs.writeFileSync(path.join(dir, 'qa.json'), JSON.stringify({ pass }));
  fs.writeFileSync(path.join(dir, 'render.json'), JSON.stringify({ file: 'job.mp4' }));
  fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify({ title: 'How tides work', post: { caption, tags: ['#Science', 'tides'] } }));
  const queue = path.join(dir, 'queue', 'queue.json');
  const ctx = (extra = {}) => ({
    slug: 'how-tides-work', jobDir: dir, dryRun: true, args: {}, log: silentLogger,
    file: (f) => path.join(dir, f),
    config: { handoff: { platforms: 'instagram,tiktok', at: '+2h' }, publish: { queue } },
    ...extra,
  });
  return { dir, queue, ctx };
}

const quiet = async (fn) => {
  const log = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = log; }
};

test('handoff adds a DRAFT to the publish queue and never approves it', async () => {
  const { dir, queue, ctx } = fakeJob();
  const out = await quiet(() => handoff(ctx()));
  assert.deepEqual(out.outputs, ['handoff.json']);
  const q = Q.createStore(queue).load();
  assert.equal(q.items.length, 1);
  const item = q.items[0];
  assert.equal(item.status, 'draft');
  assert.equal(item.approval, null);
  assert.deepEqual(item.platforms, ['instagram', 'tiktok']);
  assert.deepEqual(item.tags, ['science', 'tides']);
  assert.deepEqual(item.source, { job: 'how-tides-work', dryRun: true });
  const h = JSON.parse(fs.readFileSync(path.join(dir, 'handoff.json'), 'utf8'));
  assert.equal(h.queueId, item.id);
  assert.equal(h.approvalCode, Q.approvalCode(item));
  assert.equal(h.approveCommand, `node factory.mjs publish approve ${item.id} --by NAME --code ${Q.approvalCode(item)}`);
  assert.equal(approveCommand(item), h.approveCommand);
});

test('re-running handoff reuses an identical draft and replaces a changed one', async () => {
  const { dir, queue, ctx } = fakeJob();
  await quiet(() => handoff(ctx()));
  const again = await quiet(() => handoff(ctx()));
  assert.match(again.note, /already in/);
  assert.equal(Q.createStore(queue).load().items.length, 1);

  fs.writeFileSync(path.join(dir, 'job.mp4'), 'a re-rendered video');
  await quiet(() => handoff(ctx()));
  const q = Q.createStore(queue).load();
  assert.deepEqual(q.items.map((i) => i.status), ['cancelled', 'draft']);
  assert.match(q.items[0].history.at(-1).note, /replaced by #2/);
});

test('handoff is blocked when QA failed, unless a human overrides it', async () => {
  const { queue, ctx } = fakeJob({ pass: false });
  const r = await quiet(() => handoff(ctx()));
  assert.equal(r.status, 'blocked');
  assert.equal(fs.existsSync(queue), false);
  await quiet(() => handoff(ctx({ args: { overrideQa: true } })));
  assert.equal(Q.createStore(queue).load().items[0].status, 'draft');
});

test('handoff refuses a draft that breaks platform rules (too many hashtags in the caption)', async () => {
  const { queue, ctx } = fakeJob({ caption: 'Tides #a #b #c #d #e' });
  await assert.rejects(quiet(() => handoff(ctx())), /hashtags/);
  assert.equal(fs.existsSync(queue), false);
});

test('publisher: "dry" by default, chosen in config, overridable by CF_PUBLISHER', async () => {
  assert.equal(publishSettings({ providers: {} }).publisher, 'dry');
  assert.equal(publishSettings({ providers: { publisher: 'upload-post' } }).publisher, 'upload-post');
  process.env.CF_PUBLISHER = 'dry';
  try { assert.equal(publishSettings({ providers: { publisher: 'upload-post' } }).publisher, 'dry'); } finally { delete process.env.CF_PUBLISHER; }
  assert.equal(providerName('publisher', { config: { providers: { publisher: 'upload-post' } }, dryRun: true }), 'dry');
  const dry = await getPublisher('dry');
  assert.equal(dry.dry, true);
  await assert.rejects(dry.publish(), /never posts/);
  const up = await getPublisher('upload-post', { apiKey: '', user: '' });
  assert.deepEqual(up.ready().missing, ['UPLOAD_POST_API_KEY', 'UPLOAD_POST_USER']);
  await assert.rejects(getPublisher('nope'), /no publisher provider "nope"/);
});

test('repo default config selects the dry publisher and a gitignored queue path', () => {
  const s = publishSettings();
  assert.equal(s.publisher, process.env.CF_PUBLISHER || 'dry');
  assert.match(s.queue, /publish[\\/]queue[\\/]queue\.json$/);
});
