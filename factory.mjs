#!/usr/bin/env node
// content-factory orchestrator. Runs the steps in order for one job folder (jobs/<slug>/).
import path from 'node:path';
import { ROOT, parseArgs, readJson } from './lib/util.mjs';
import { loadEnv } from './lib/env.mjs';
import { runPipeline, STEP_ORDER, STEP_DIRS, loadState, loadConfig } from './lib/orchestrator.mjs';
import { KINDS, listProviders, providerName } from './lib/providers.mjs';

const HELP = `content-factory: topic → short vertical video, one step at a time.

usage:
  node factory.mjs run <topic> [options]     run the pipeline (resumes a job that already exists)
  node factory.mjs status <job-slug>         show each step's state
  node factory.mjs steps                     list the steps and their skill cards
  node factory.mjs providers                 list the adapters and which ones config selects
  node factory.mjs publish <command>         the publish queue: preview, approve (a human), run, ...
                                             (node factory.mjs publish help for all commands)

run options:
  --dry-run            no keys, no network, no spending: dry adapters everywhere
  --steps a,b          only these steps (e.g. --steps voice,captions,render)
  --from <step>        start at this step
  --force              redo selected steps even if they are done
  --job <slug>         job folder name (default: from the topic)
  --allow-spend        permit paid calls, still within the per-run caps in config
  --override-qa        handoff: queue the draft although QA failed (a human has checked it)

steps: ${STEP_ORDER.join(' → ')} → publish queue (a human approves) → post
`;

async function main() {
  loadEnv();
  if (process.argv[2] === 'publish') {
    const { main: publishMain } = await import('./publish/cli.mjs');
    return publishMain(process.argv.slice(3));
  }
  const args = parseArgs(process.argv.slice(2), ['dryRun', 'allowSpend', 'force', 'overrideQa', 'help']);
  const [cmd, ...rest] = args._;
  if (!cmd || args.help || cmd === 'help') { console.log(HELP); return 0; }

  if (cmd === 'steps') {
    for (const s of STEP_ORDER) console.log(`${s.padEnd(9)} steps/${STEP_DIRS[s]}/README.md`);
    return 0;
  }
  if (cmd === 'providers') {
    const config = loadConfig(null);
    for (const k of KINDS) {
      const sel = k === 'visuals'
        ? ['placeholder', 'folder', 'stock', 'ai'].map((s) => `${s}→${providerName('visuals', { config }, s)}`).join(', ')
        : providerName(k, { config });
      console.log(`${k.padEnd(9)} selected: ${sel}\n          available: ${listProviders(k).join(', ')}`);
    }
    return 0;
  }
  if (cmd === 'status') {
    const slug = rest[0];
    if (!slug) { console.error('usage: node factory.mjs status <job-slug>'); return 1; }
    const state = loadState(path.join(ROOT, 'jobs', slug));
    if (!state) { console.error(`no job "${slug}"`); return 1; }
    console.log(`job ${slug}: "${state.topic}"`);
    for (const s of STEP_ORDER) {
      const r = state.steps[s];
      console.log(`  ${s.padEnd(9)} ${r ? r.status : 'pending'}${r?.dryRun ? ' (dry)' : ''}${r?.note ? ` · ${r.note}` : ''}${r?.error ? ` · ${r.error}` : ''}`);
    }
    const qa = readJson(path.join(ROOT, 'jobs', slug, 'qa.json'), null);
    if (qa) console.log(`  qa: ${qa.pass ? 'PASS' : 'FAIL'} ${JSON.stringify(qa.counts)}`);
    return 0;
  }
  if (cmd === 'run') {
    const topic = rest.join(' ').trim();
    if (!topic && !args.job) { console.error('usage: node factory.mjs run <topic> [--dry-run]'); return 1; }
    const r = await runPipeline({
      topic: topic || undefined, slug: args.job, dryRun: Boolean(args.dryRun), allowSpend: Boolean(args.allowSpend),
      force: Boolean(args.force), steps: args.steps, from: args.from, extra: { args },
    });
    console.log(`\njob folder: ${path.relative(process.cwd(), r.jobDir) || '.'}`);
    if (r.failed) { console.log(`stopped: ${r.failed.step} failed. Fix it, then run the same command again to resume.`); return 1; }
    if (r.blocked) { console.log(`paused at ${r.blocked.step}: ${r.blocked.note}`); return 2; }
    console.log(`ran: ${r.ran.join(', ') || '(nothing)'}${r.skipped.length ? ` · skipped (done): ${r.skipped.join(', ')}` : ''}`);
    return 0;
  }
  console.error(`unknown command "${cmd}"\n\n${HELP}`);
  return 1;
}

main().then((code) => process.exit(code), (e) => { console.error(e.message); process.exit(1); });
