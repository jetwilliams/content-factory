import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/util.mjs';
import { validateScript, segmentsOf, extractJson } from '../lib/script-schema.mjs';

const example = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/how-tides-work/script.json'), 'utf8'));

test('the shipped example script is valid', () => {
  const v = validateScript(example());
  assert.equal(v.ok, true, v.errors.join('; '));
});

test('beat count limits come from the rules', () => {
  const s = example();
  s.beats = s.beats.slice(0, 2);
  const v = validateScript(s);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(), /beats has 2 items \(need 4-8\)/);
  assert.equal(validateScript(s, { minBeats: 2 }).ok, true);
});

test('rejects missing voice, long on-screen text, bad visual source and bad tags', () => {
  const s = example();
  delete s.hook.voice;
  s.beats[0].onScreen = 'x'.repeat(100);
  s.beats[1].visual.source = 'magic';
  s.post.tags = 'not-an-array';
  const errs = validateScript(s).errors.join('\n');
  assert.match(errs, /hook\.voice must be a non-empty string/);
  assert.match(errs, /beats\[0\]\.onScreen is 100 chars/);
  assert.match(errs, /beats\[1\]\.visual\.source must be one of/);
  assert.match(errs, /post\.tags must be an array of strings/);
});

test('rejects too many words per beat and an over-long title', () => {
  const s = example();
  s.beats[2].voice = Array(40).fill('word').join(' ');
  s.title = 'T'.repeat(41);
  const errs = validateScript(s).errors.join('\n');
  assert.match(errs, /beats\[2\]\.voice has 40 words/);
  assert.match(errs, /title is 41 chars/);
});

test('non-objects are rejected cleanly', () => {
  assert.equal(validateScript(null).ok, false);
  assert.equal(validateScript([]).ok, false);
  assert.equal(validateScript('{}').ok, false);
});

test('segmentsOf orders hook, beats, cta and inherits visuals', () => {
  const s = example();
  delete s.hook.visual;
  const segs = segmentsOf(s);
  assert.deepEqual(segs.map((x) => x.id), ['hook', 'beat1', 'beat2', 'beat3', 'beat4', 'cta']);
  assert.deepEqual(segs[0].visual, s.beats[0].visual);
  assert.deepEqual(segs.at(-1).visual, s.beats.at(-1).visual);
});

test('extractJson tolerates fences and chatter', () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a": 1}\n```\nDone.'), { a: 1 });
  assert.deepEqual(extractJson('noise {"b": [1, 2]} trailing'), { b: [1, 2] });
  assert.throws(() => extractJson('no json here'), /no JSON object/);
});
