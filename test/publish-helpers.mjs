import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as Q from '../publish/lib/queue.mjs';

export function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cf-publish-test-'));
}

// A fake "video": any bytes will do, since hashing is all the queue needs.
export function fakeVideo(dir, name = 'demo.mp4', content = 'not really a video') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

export function draftItem(q, dir, overrides = {}) {
  const file = overrides.file || fakeVideo(dir);
  return Q.addDraft(q, {
    file,
    fileHash: Q.hashFile(file),
    caption: 'My first post',
    tags: ['demo', 'test'],
    platforms: ['instagram', 'tiktok'],
    at: new Date(Date.now() - 60e3),
    ...overrides,
  });
}

export function approved(q, dir, overrides = {}) {
  const item = draftItem(q, dir, overrides);
  Q.approve(q, item.id, { code: Q.approvalCode(item), by: 'tester', currentFileHash: Q.hashFile(item.file) });
  return item;
}

// A publisher whose behaviour per platform is scripted: a list of 'ok' | 'transient' | 'fatal' outcomes.
export function fakePublisher(script = {}) {
  const calls = [];
  return {
    name: 'fake',
    platforms: ['instagram', 'tiktok', 'youtube'],
    calls,
    ready: () => ({ ok: true, missing: [] }),
    describe: (item, platform) => [`fake ${platform} ${item.id}`],
    async publish(item, platform, record, { save }) {
      calls.push(`${item.id}:${platform}`);
      record.fakeRef = `ref-${item.id}-${platform}`;
      save();
      const outcome = (script[platform] || []).shift() || 'ok';
      if (outcome === 'transient') throw Object.assign(new Error('rate limited'), { transient: true });
      if (outcome === 'fatal') throw Object.assign(new Error('rejected'), { transient: false });
      return { postId: `post-${item.id}-${platform}`, permalink: `https://example.com/${platform}/${item.id}` };
    },
  };
}

// Pure probe stand-in: a valid vertical 15 s clip.
export const goodProbe = (file) => ({ size: 1e6, ext: path.extname(file), probed: true, hasVideo: true, hasAudio: true, duration: 15, width: 1080, height: 1920, fps: 30 });
