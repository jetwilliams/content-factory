// Upload-Post adapter tests with a fake fetch: no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUploadPostPublisher, buildFields } from '../providers/publisher/upload-post.mjs';
import { memoryLogger } from '../publish/lib/log.mjs';
import { tmpDir, fakeVideo } from './publish-helpers.mjs';

const FAKE_KEY = 'test-key-not-real-0000';
const cfg = { apiKey: FAKE_KEY, user: 'demo-profile', base: 'https://api.example.test', pollEverySec: 0, pollMaxMin: 1, retryBaseMs: 1, igShareToFeed: true, youtubePrivacy: 'public', youtubeCategory: '22' };

function item(dir) {
  return { id: 7, file: fakeVideo(dir), caption: 'My first post', tags: ['demo'], captionText: 'My first post\n\n#demo', platforms: ['instagram', 'youtube'], at: new Date().toISOString() };
}

const json = (status, body) => ({ ok: status < 400, status, headers: new Headers(), text: async () => JSON.stringify(body) });

test('buildFields: per-platform fields, request id and schedule date', () => {
  const it = item(tmpDir());
  const ig = Object.fromEntries(buildFields(it, 'instagram', cfg, { requestId: 'r1' }).map(([k, v]) => [k, v]));
  assert.equal(ig.user, 'demo-profile');
  assert.equal(ig['platform[]'], 'instagram');
  assert.equal(ig.title, 'My first post\n\n#demo');
  assert.equal(ig.media_type, 'REELS');
  assert.equal(ig.request_id, 'r1');
  const yt = buildFields(it, 'youtube', cfg, { scheduledAt: '2030-01-01T00:00:00Z' });
  assert.ok(yt.some(([k, v]) => k === 'title' && v === 'My first post'));
  assert.ok(yt.some(([k, v]) => k === 'scheduled_date' && v === '2030-01-01T00:00:00.000Z'));
});

test('describe never contains the API key', () => {
  const pub = createUploadPostPublisher({ ...cfg, fetch: () => { throw new Error('no network in tests'); } });
  const text = pub.describe(item(tmpDir()), 'instagram').join('\n');
  assert.ok(!text.includes(FAKE_KEY));
  assert.match(text, /Apikey \[REDACTED\]/);
});

test('ready() reports missing settings by name only', () => {
  const pub = createUploadPostPublisher({ ...cfg, apiKey: undefined, user: undefined });
  assert.deepEqual(pub.ready(), { ok: false, missing: ['UPLOAD_POST_API_KEY', 'UPLOAD_POST_USER'] });
});

test('publish saves the request id before uploading, then polls to completion', async () => {
  const calls = [];
  const record = {};
  let savedIdAtUpload = null;
  const fetch = async (url, opts) => {
    calls.push(`${opts.method} ${new URL(url).pathname}`);
    if (url.endsWith('/upload')) {
      savedIdAtUpload = record.requestId;
      assert.equal(opts.headers['Idempotency-Key'], record.requestId);
      return json(200, { success: true, request_id: record.requestId });
    }
    return json(200, { status: 'completed', results: [{ platform: 'instagram', status: 'completed', post_url: 'https://example.com/p/1', platform_post_id: '1' }] });
  };
  const pub = createUploadPostPublisher({ ...cfg, fetch });
  const out = await pub.publish(item(tmpDir()), 'instagram', record, { log: memoryLogger(), save() {} });
  assert.ok(savedIdAtUpload, 'request id existed before the upload');
  assert.deepEqual(calls, ['POST /upload', 'GET /uploadposts/status']);
  assert.equal(out.permalink, 'https://example.com/p/1');
});

test('publish resumes a saved request instead of uploading again', async () => {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push(`${opts.method} ${new URL(url).pathname}`);
    return json(200, { results: [{ platform: 'instagram', status: 'completed', post_url: 'https://example.com/p/2' }] });
  };
  const pub = createUploadPostPublisher({ ...cfg, fetch });
  const out = await pub.publish(item(tmpDir()), 'instagram', { requestId: 'existing' }, { log: memoryLogger(), save() {} });
  assert.deepEqual(calls, ['GET /uploadposts/status']);
  assert.equal(out.permalink, 'https://example.com/p/2');
});

test('a rate-limited platform failure is transient', async () => {
  const fetch = async (url) => (url.endsWith('/upload')
    ? json(200, { success: true })
    : json(200, { results: [{ platform: 'instagram', success: false, error: 'Rate limit reached, try again later' }] }));
  const pub = createUploadPostPublisher({ ...cfg, fetch });
  const record = {};
  await assert.rejects(pub.publish(item(tmpDir()), 'instagram', record, { log: memoryLogger(), save() {} }), (e) => e.transient === true);
  assert.ok(record.failedRef, 'keeps a reference for a server-side retry');
});
