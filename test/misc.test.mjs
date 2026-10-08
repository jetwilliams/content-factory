import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderText, wrapText, normaliseText } from '../lib/pixelfont.mjs';
import { safeAreaChecks } from '../steps/08-qa/run.mjs';
import { cleanTags } from '../steps/09-handoff/run.mjs';
import { segmentSpans, ffColour } from '../steps/07-render/run.mjs';
import { slugify, fillCommand, shQuote } from '../lib/util.mjs';

test('pixel font renders a valid PNG of the expected size', () => {
  const r = renderText(['AB'], { scale: 2, padding: 1 });
  assert.equal(r.png.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(r.width, 2 * 6 * 2 - 2 + 2);
  assert.equal(r.height, 9 * 2 - 4 + 2);
  assert.deepEqual(wrapText('one two three four', 9), ['one two', 'three', 'four']);
  assert.deepEqual(wrapText('one two three four', 9, 2), ['one two', 'three...']);
  assert.equal(normaliseText('Café “quote” – ok'), 'CAFE "QUOTE" - OK');
});

test('safe-area check: captions outside fail, watermark outside warns', () => {
  const opts = { width: 1080, height: 1920, safe: { top: 200, bottom: 400, left: 60, right: 60 } };
  const res = safeAreaChecks([
    { name: 'title', x: 100, y: 300, w: 800, h: 200 },
    { name: 'cap', kind: 'caption', x: 100, y: 1700, w: 400, h: 80 },
    { name: 'wm', kind: 'watermark', x: 400, y: 1850, w: 200, h: 40 },
  ], opts);
  assert.deepEqual(res.map((r) => r.level), ['ok', 'fail', 'warn']);
});

test('segment spans tile the timeline without gaps', () => {
  const voice = { duration: 5, segments: [{ id: 'hook', start: 0, end: 1 }, { id: 'b1', start: 1.1, end: 3 }, { id: 'cta', start: 3.1, end: 4.5 }] };
  const s = segmentSpans(voice);
  assert.deepEqual(s.map((x) => [x.start, x.end]), [[0, 1.1], [1.1, 3.1], [3.1, 5]]);
});

test('hand-off cleans tags: lowercase, no #, letters/digits only, max 5', () => {
  assert.deepEqual(cleanTags(['#Science', 'science', 'a b', 'x', 'y', 'z', 'w']), ['science', 'ab', 'x', 'y', 'z']);
  assert.equal(shQuote("It's"), `'It'\\''s'`);
});

test('helpers', () => {
  assert.equal(slugify('Why is the sky BLUE?'), 'why-is-the-sky-blue');
  assert.equal(slugify('!!!'), 'job');
  assert.deepEqual(fillCommand('tool --in "{text_file}" --out {out}', { text_file: 'a b.txt', out: 'o.wav' }), ['tool', '--in', 'a b.txt', '--out', 'o.wav']);
  assert.equal(ffColour('#FFFFFF80'), '0xFFFFFF@0.5');
});
