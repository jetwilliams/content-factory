import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseTags, buildCaption, validateCaption, youtubeTitle, MAX_TAGS, LIMITS } from '../publish/lib/caption.mjs';

test('normaliseTags strips #, splits on commas/spaces and dedupes case-insensitively', () => {
  assert.deepEqual(normaliseTags('#one, two  three,ONE'), ['one', 'two', 'three']);
  assert.deepEqual(normaliseTags(['#a', 'b']), ['a', 'b']);
  assert.deepEqual(normaliseTags(''), []);
});

test('normaliseTags rejects punctuation inside a tag', () => {
  assert.throws(() => normaliseTags('good, bad-tag'), /letters, numbers/);
});

test('buildCaption appends tags after a blank line and skips ones already inline', () => {
  assert.equal(buildCaption('My first post', ['demo', 'test']), 'My first post\n\n#demo #test');
  assert.equal(buildCaption('Hello #demo', ['demo', 'extra']), 'Hello #demo\n\n#extra');
  assert.equal(buildCaption('', ['only']), '#only');
  assert.equal(buildCaption('No tags', []), 'No tags');
});

test(`at most ${MAX_TAGS} hashtags, counting inline ones`, () => {
  assert.deepEqual(validateCaption({ caption: 'ok', tags: ['a', 'b', 'c', 'd', 'e'] }, 'instagram').errors, []);
  assert.match(validateCaption({ caption: 'ok', tags: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'instagram').errors[0], /6 hashtags/);
  assert.match(validateCaption({ caption: 'ok #x #y', tags: ['a', 'b', 'c', 'd'] }, 'tiktok').errors[0], /6 hashtags/);
  // The same tag inline and in --tags counts once.
  assert.deepEqual(validateCaption({ caption: 'ok #a', tags: ['a', 'b', 'c', 'd', 'e'] }, 'tiktok').errors, []);
});

test('caption length limits per platform', () => {
  const long = 'x'.repeat(LIMITS.instagram.caption + 1);
  assert.match(validateCaption({ caption: long }, 'instagram').errors[0], /instagram: caption is 2201 chars/);
  assert.match(validateCaption({ caption: long }, 'tiktok').errors[0], /tiktok: caption/);
  assert.deepEqual(validateCaption({ caption: 'x'.repeat(2200) }, 'instagram').errors, []);
  // YouTube counts bytes in the description (5000).
  assert.deepEqual(validateCaption({ caption: long }, 'youtube').errors, []);
  assert.match(validateCaption({ caption: 'é'.repeat(2600) }, 'youtube').errors[0], /bytes/);
});

test('youtube rejects angle brackets and long titles', () => {
  assert.match(validateCaption({ caption: 'a <b> c' }, 'youtube').errors.join(), /< or >/);
  assert.match(validateCaption({ caption: 'ok', title: 't'.repeat(101) }, 'youtube').errors.join(), /title is 101/);
});

test('instagram caps @mentions', () => {
  const caption = Array.from({ length: 21 }, (_, i) => `@user${i}`).join(' ');
  assert.match(validateCaption({ caption }, 'instagram').errors.join(), /21 @mentions/);
});

test('empty caption is a warning, unknown platform an error', () => {
  assert.deepEqual(validateCaption({ caption: '' }, 'tiktok').warnings, ['caption is empty']);
  assert.match(validateCaption({ caption: 'x' }, 'myspace').errors[0], /unknown platform/);
});

test('youtubeTitle uses --title, else the first caption line without hashtags, max 100 chars', () => {
  assert.equal(youtubeTitle({ title: 'Given', caption: 'ignored' }), 'Given');
  assert.equal(youtubeTitle({ caption: 'My first post #demo\nsecond line' }), 'My first post');
  assert.equal(youtubeTitle({ caption: '#only #tags', fallback: 'demo' }), 'demo');
  const t = youtubeTitle({ caption: 'word '.repeat(40) });
  assert.ok(t.length <= 100 && !t.endsWith(' '));
});
