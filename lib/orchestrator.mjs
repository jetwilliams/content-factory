// Runs steps in order inside a per-job folder (jobs/<slug>/) with resumable state (state.json).
//
// Resume rules:
//  - A step is skipped when state says "done", every output it listed still exists, and it was
//    produced in the same mode (dry vs real) as this run.
//  - When a step actually runs, every later step that was "done" becomes "stale" and runs again.
//  - A step can return status "blocked" (e.g. a paid call needs --allow-spend). The pipeline stops
//    there and the next run picks up from that step.
//  - --force re-runs the selected steps even if they are done.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJson, writeJson, deepMerge, slugify, makeLogger } from './util.mjs';

export const STEP_ORDER = ['research', 'script', 'visuals', 'voice', 'music', 'captions', 'render', 'qa', 'handoff'];
export const STEP_DIRS = {
  research: '01-research', script: '02-script', visuals: '03-visuals', voice: '04-voice', music: '05-music',
  captions: '06-captions', render: '07-render', qa: '08-qa', handoff: '09-handoff',
};

export function loadConfig(jobDir, defaultsPath = path.join(ROOT, 'config', 'factory.config.json')) {
  const defaults = readJson(defaultsPath, {});
  const override = jobDir ? readJson(path.join(jobDir, 'config.json'), {}) : {};
  return deepMerge(defaults, override);
}

export function loadState(jobDir) {
  return readJson(path.join(jobDir, 'state.json'), null);
}

export function saveState(jobDir, state) {
  state.updatedAt = new Date().toISOString();
  writeJson(path.join(jobDir, 'state.json'), state);
}

export async function loadRegistry() {
  const reg = {};
  for (const name of STEP_ORDER) {
    const mod = await import(path.join(ROOT, 'steps', STEP_DIRS[name], 'run.mjs'));
    reg[name] = mod.run;
  }
  return reg;
}

export function selectSteps({ steps, from } = {}) {
  let list = STEP_ORDER;
  if (from) {
    const i = STEP_ORDER.indexOf(from);
    if (i < 0) throw new Error(`unknown step "${from}". Steps: ${STEP_ORDER.join(', ')}`);
    list = STEP_ORDER.slice(i);
  }
  if (steps) {
    const want = (Array.isArray(steps) ? steps : String(steps).split(',')).map((s) => s.trim()).filter(Boolean);
    for (const s of want) if (!STEP_ORDER.includes(s)) throw new Error(`unknown step "${s}". Steps: ${STEP_ORDER.join(', ')}`);
    list = list.filter((s) => want.includes(s));
  }
  return list;
}

function outputsExist(jobDir, rec) {
  return Array.isArray(rec.outputs) && rec.outputs.every((o) => fs.existsSync(path.join(jobDir, o)));
}

export async function runPipeline({
  topic, slug, jobsRoot = path.join(ROOT, 'jobs'), dryRun = false, allowSpend = false, force = false,
  steps, from, registry, log = makeLogger('factory'), extra = {},
}) {
  if (!slug && !topic) throw new Error('need a topic or a job slug');
  slug = slug || slugify(topic);
  const jobDir = path.join(jobsRoot, slug);
  fs.mkdirSync(jobDir, { recursive: true });

  let state = loadState(jobDir);
  if (!state) {
    if (!topic) throw new Error(`no job "${slug}" yet: give a topic to start one`);
    state = { topic, slug, createdAt: new Date().toISOString(), steps: {} };
  } else if (topic && state.topic !== topic) {
    throw new Error(`job "${slug}" already exists for topic "${state.topic}". Use --job <other-slug> for a new topic.`);
  }
  saveState(jobDir, state);

  registry = registry || (await loadRegistry());
  const selected = selectSteps({ steps, from });
  const result = { jobDir, slug, ran: [], skipped: [], blocked: null, failed: null };
  const config = loadConfig(jobDir);

  for (const name of selected) {
    const rec = state.steps[name];
    const reusable = rec && rec.status === 'done' && rec.dryRun === dryRun && outputsExist(jobDir, rec);
    if (reusable && !force) {
      log.info(`${name}: done already, skipping (use --force to redo)`);
      result.skipped.push(name);
      continue;
    }
    const ctx = {
      name, jobDir, slug, topic: state.topic, dryRun, allowSpend, config, state,
      log: makeLogger(name), file: (f) => path.join(jobDir, f), ...extra,
    };
    log.info(`${name}: running${dryRun ? ' (dry run)' : ''}`);
    state.steps[name] = { status: 'running', startedAt: new Date().toISOString(), dryRun };
    saveState(jobDir, state);
    let out;
    try {
      out = (await registry[name](ctx)) || {};
    } catch (err) {
      state.steps[name] = { status: 'failed', at: new Date().toISOString(), dryRun, error: err.message };
      saveState(jobDir, state);
      log.error(`${name}: ${err.message}`);
      result.failed = { step: name, error: err.message };
      return result;
    }
    if (out.status === 'blocked') {
      state.steps[name] = { status: 'blocked', at: new Date().toISOString(), dryRun, note: out.note || '' };
      saveState(jobDir, state);
      log.warn(`${name}: blocked. ${out.note || ''}`);
      result.blocked = { step: name, note: out.note || '' };
      return result;
    }
    state.steps[name] = { status: 'done', at: new Date().toISOString(), dryRun, outputs: out.outputs || [], note: out.note || '' };
    // Anything downstream was built from older inputs: mark it stale so it runs again.
    for (const later of STEP_ORDER.slice(STEP_ORDER.indexOf(name) + 1)) {
      if (state.steps[later]?.status === 'done') state.steps[later].status = 'stale';
    }
    saveState(jobDir, state);
    result.ran.push(name);
    if (out.note) log.info(`${name}: ${out.note}`);
  }
  return result;
}
