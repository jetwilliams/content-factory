import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPipeline, STEP_ORDER, loadState, selectSteps } from '../lib/orchestrator.mjs';
import { silentLogger } from '../lib/util.mjs';

// Fake steps: each writes <name>.out and counts its calls. No ffmpeg, no network.
function fakeRegistry(behaviour = {}) {
  const calls = {};
  const reg = {};
  for (const name of STEP_ORDER) {
    reg[name] = async (ctx) => {
      calls[name] = (calls[name] || 0) + 1;
      const b = behaviour[name];
      if (b === 'fail') throw new Error(`${name} exploded`);
      if (b === 'block') return { status: 'blocked', note: 'needs --allow-spend' };
      fs.writeFileSync(ctx.file(`${name}.out`), `${name} ${calls[name]}`);
      return { outputs: [`${name}.out`] };
    };
  }
  return { reg, calls };
}

const tmpJobs = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cf-jobs-'));
const base = (jobsRoot, registry, extra = {}) => runPipeline({ topic: 'how tides work', jobsRoot, registry, log: silentLogger, ...extra });

test('runs every step in order and records state', async () => {
  const jobsRoot = tmpJobs();
  const order = [];
  const { reg } = fakeRegistry();
  for (const n of STEP_ORDER) { const f = reg[n]; reg[n] = async (ctx) => { order.push(n); return f(ctx); }; }
  const r = await base(jobsRoot, reg);
  assert.deepEqual(order, STEP_ORDER);
  assert.deepEqual(r.ran, STEP_ORDER);
  const state = loadState(path.join(jobsRoot, 'how-tides-work'));
  assert.ok(STEP_ORDER.every((s) => state.steps[s].status === 'done'));
});

test('a second run resumes: finished steps are skipped', async () => {
  const jobsRoot = tmpJobs();
  const { reg, calls } = fakeRegistry();
  await base(jobsRoot, reg);
  const r2 = await base(jobsRoot, reg);
  assert.deepEqual(r2.ran, []);
  assert.deepEqual(r2.skipped, STEP_ORDER);
  assert.ok(STEP_ORDER.every((s) => calls[s] === 1));
});

test('a missing output re-runs that step and everything after it', async () => {
  const jobsRoot = tmpJobs();
  const { reg, calls } = fakeRegistry();
  await base(jobsRoot, reg);
  fs.rmSync(path.join(jobsRoot, 'how-tides-work', 'voice.out'));
  const r = await base(jobsRoot, reg);
  const i = STEP_ORDER.indexOf('voice');
  assert.deepEqual(r.skipped, STEP_ORDER.slice(0, i));
  assert.deepEqual(r.ran, STEP_ORDER.slice(i));
  assert.equal(calls.script, 1);
  assert.equal(calls.render, 2);
});

test('a failure stops the run; the next run resumes at the failed step', async () => {
  const jobsRoot = tmpJobs();
  const bad = fakeRegistry({ render: 'fail' });
  const r1 = await base(jobsRoot, bad.reg);
  assert.equal(r1.failed.step, 'render');
  assert.equal(bad.calls.qa, undefined);
  const state = loadState(path.join(jobsRoot, 'how-tides-work'));
  assert.equal(state.steps.render.status, 'failed');
  assert.match(state.steps.render.error, /exploded/);

  const good = fakeRegistry();
  const r2 = await base(jobsRoot, good.reg);
  assert.deepEqual(r2.ran, ['render', 'qa', 'handoff']);
  assert.equal(good.calls.visuals, undefined);
});

test('a blocked step pauses the pipeline and is retried next time', async () => {
  const jobsRoot = tmpJobs();
  const blocked = fakeRegistry({ visuals: 'block' });
  const r1 = await base(jobsRoot, blocked.reg);
  assert.equal(r1.blocked.step, 'visuals');
  assert.deepEqual(r1.ran, ['research', 'script']);
  const good = fakeRegistry();
  const r2 = await base(jobsRoot, good.reg);
  assert.equal(r2.ran[0], 'visuals');
});

test('--force and --steps redo only what is asked (and mark later steps stale)', async () => {
  const jobsRoot = tmpJobs();
  const { reg, calls } = fakeRegistry();
  await base(jobsRoot, reg);
  const r = await base(jobsRoot, reg, { steps: 'captions', force: true });
  assert.deepEqual(r.ran, ['captions']);
  assert.equal(calls.captions, 2);
  const state = loadState(path.join(jobsRoot, 'how-tides-work'));
  assert.equal(state.steps.render.status, 'stale');
  const r3 = await base(jobsRoot, reg);
  assert.deepEqual(r3.ran, ['render', 'qa', 'handoff']);
});

test('switching between dry and real runs redoes the steps', async () => {
  const jobsRoot = tmpJobs();
  const { reg } = fakeRegistry();
  await base(jobsRoot, reg, { dryRun: true });
  const r = await base(jobsRoot, reg, { dryRun: false });
  assert.deepEqual(r.ran, STEP_ORDER);
});

test('a different topic cannot overwrite an existing job', async () => {
  const jobsRoot = tmpJobs();
  const { reg } = fakeRegistry();
  await base(jobsRoot, reg);
  await assert.rejects(runPipeline({ topic: 'why the sky is blue', slug: 'how-tides-work', jobsRoot, registry: reg, log: silentLogger }), /already exists/);
});

test('step selection validates names', () => {
  assert.deepEqual(selectSteps({ from: 'qa' }), ['qa', 'handoff']);
  assert.deepEqual(selectSteps({ steps: 'render,voice' }), ['voice', 'render']);
  assert.throws(() => selectSteps({ steps: 'nope' }), /unknown step/);
});
