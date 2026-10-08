import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evenSplitWords, wordTimings, chunkWords, srtTime, assTime, toSrt, toAss, assColour } from '../lib/captions-core.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('even split covers the span exactly, in order, with no gaps', () => {
  const w = evenSplitWords('The Moon pulls the near ocean most.', 1.0, 3.0);
  assert.equal(w.length, 7);
  close(w[0].start, 1.0);
  close(w.at(-1).end, 3.0);
  for (let i = 0; i < w.length; i++) {
    assert.ok(w[i].end > w[i].start, 'positive duration');
    if (i) close(w[i].start, w[i - 1].end);
  }
});

test('longer words get more time than short ones', () => {
  const [a, b] = evenSplitWords('a extraordinary', 0, 1);
  assert.ok(b.end - b.start > a.end - a.start);
});

test('empty text or zero span gives no words', () => {
  assert.deepEqual(evenSplitWords('', 0, 1), []);
  assert.deepEqual(evenSplitWords('hello', 2, 2), []);
});

test('engine word timings are used when present', () => {
  const segs = [
    { id: 'hook', text: 'Hi there', start: 0, end: 1, words: [{ word: 'Hi', start: 0, end: 0.3 }, { word: 'there', start: 0.35, end: 0.9 }] },
    { id: 'beat1', text: 'one two three', start: 1.1, end: 2.0 },
  ];
  const w = wordTimings(segs);
  assert.equal(w.length, 5);
  assert.equal(w[1].end, 0.9);
  assert.equal(w[2].segment, 'beat1');
  close(w[2].start, 1.1);
});

test('chunks never cross a segment and respect the size', () => {
  const words = wordTimings([
    { id: 'a', text: 'one two three', start: 0, end: 1.5 },
    { id: 'b', text: 'four five', start: 1.6, end: 2.5 },
  ]);
  const chunks = chunkWords(words, 2);
  assert.deepEqual(chunks.map((c) => c.text), ['one two', 'three', 'four five']);
  assert.ok(chunks.every((c) => c.end > c.start));
  close(chunks[0].end, chunks[1].start); // no flicker inside a segment
  assert.equal(chunks[1].end, 1.5);      // but the segment gap is kept
});

test('time formats', () => {
  assert.equal(srtTime(0), '00:00:00,000');
  assert.equal(srtTime(3723.456), '01:02:03,456');
  assert.equal(assTime(61.25), '0:01:01.25');
  assert.equal(srtTime(-1), '00:00:00,000');
});

test('srt and ass output', () => {
  const chunks = [{ text: 'hello {world}', start: 0, end: 0.5 }];
  assert.equal(toSrt(chunks), '1\n00:00:00,000 --> 00:00:00,500\nhello {world}\n');
  const ass = toAss(chunks, { uppercase: true });
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:00\.50,Caption,,0,0,0,,HELLO \\\{WORLD\\\}/);
  assert.equal(assColour('#FF8800'), '&H000088FF');
  assert.equal(assColour('#FFFFFF80'), '&H7FFFFFFF');
});
