// Lets every step file run on its own:
//   node steps/03-visuals/run.mjs <job-slug | jobs/<slug>> [--dry-run] [--allow-spend]
// The step is run through the orchestrator (forced), so state.json stays correct.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, ROOT } from './util.mjs';
import { loadEnv } from './env.mjs';
import { runPipeline } from './orchestrator.mjs';

export function stepMain(moduleUrl, name, run) {
  if (!process.argv[1] || path.resolve(process.argv[1]) !== fileURLToPath(moduleUrl)) return;
  const args = parseArgs(process.argv.slice(2), ['dryRun', 'allowSpend', 'overrideQa', 'help']);
  if (args.help || !args._[0]) {
    console.log(`usage: node ${path.relative(ROOT, fileURLToPath(moduleUrl))} <job-slug | path/to/job> [--dry-run] [--allow-spend]\nSee the README.md next to this file.`);
    process.exit(args.help ? 0 : 1);
  }
  loadEnv();
  const target = path.resolve(args._[0]);
  const jobsRoot = args._[0].includes('/') ? path.dirname(target) : path.join(ROOT, 'jobs');
  const slug = path.basename(target);
  runPipeline({
    slug, jobsRoot, steps: [name], force: true, registry: { [name]: run },
    dryRun: Boolean(args.dryRun), allowSpend: Boolean(args.allowSpend), extra: { args },
  }).then((r) => {
    if (r.failed || r.blocked) process.exit(r.failed ? 1 : 2);
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
