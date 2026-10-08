// Step 3 · visuals: one image or clip per segment (hook, beats, CTA) → visuals.json + visuals/.
// Sources per beat: placeholder | folder (your footage) | stock (your key) | ai (your key, PAID).
// Paid calls: estimate printed first, refused without --allow-spend, refused above the per-run cap.
import fs from 'node:fs';
import path from 'node:path';
import { writeJson } from '../../lib/util.mjs';
import { loadProvider, providerName, needsSpendGate } from '../../lib/providers.mjs';
import { loadScript, segmentsOf } from '../../lib/script-schema.mjs';
import { SpendGuard, SpendCapError } from '../../lib/cost.mjs';
import { requireFfmpeg } from '../../lib/ffmpeg.mjs';
import { stepMain } from '../../lib/step-cli.mjs';

// Build the request list. Dry runs force every segment to the free placeholder.
// Identical requests (the hook and CTA reuse the first/last beat's visual by default) are fetched
// once: `dupOf` points at the segment whose file is reused, so it is never paid for twice.
export function planVisuals(script, config, dryRun) {
  const seen = new Map();
  return segmentsOf(script).map((seg, index) => {
    const v = seg.visual || {};
    const source = dryRun ? 'placeholder' : (v.source || config.visuals?.defaultSource || 'placeholder');
    const req = {
      index, segmentId: seg.id, source, provider: providerName('visuals', { config, dryRun }, source),
      query: v.query || '', prompt: v.prompt || '', file: v.file || '', label: seg.onScreen || seg.id, dupOf: null,
    };
    // Placeholders are labelled per segment, so only real sources are de-duplicated.
    if (source !== 'placeholder') {
      const key = [req.provider, req.query, req.prompt, req.file].join('|');
      if (seen.has(key)) req.dupOf = seen.get(key); else seen.set(key, seg.id);
    }
    return req;
  });
}

export async function run(ctx) {
  await requireFfmpeg();
  const script = await loadScript(ctx);
  const requests = planVisuals(script, ctx.config, ctx.dryRun);
  const providers = {};
  for (const r of requests) providers[r.provider] = providers[r.provider] || (await loadProvider('visuals', r.provider));

  // 1. Estimate everything paid, print it, and authorise against the cap BEFORE any call.
  const guard = new SpendGuard({
    capUsd: Number(ctx.config.visuals?.spendCapUsd ?? 0), allowSpend: ctx.allowSpend,
    ledgerPath: ctx.file('spend.json'), log: ctx.log,
  });
  const paid = requests.filter((r) => !r.dupOf && needsSpendGate(providers[r.provider], providers[r.provider].estimateUsd?.(r, ctx.config)));
  const estimate = guard.estimate(paid.map((r) => ({ provider: r.provider, label: `${r.provider}:${r.segmentId}`, usd: providers[r.provider].estimateUsd?.(r, ctx.config) })));
  if (paid.length) {
    try {
      guard.authorize(estimate);
    } catch (e) {
      if (e instanceof SpendCapError) {
        writeJson(ctx.file('visuals.estimate.json'), { estimate, capUsd: guard.capUsd, requests: paid });
        return { status: 'blocked', note: `${e.message} (${guard.describe(estimate)}; details in visuals.estimate.json)` };
      }
      throw e;
    }
  } else ctx.log.info('no paid visuals in this run: $0.00');

  // 2. Fetch / generate.
  fs.mkdirSync(ctx.file('visuals'), { recursive: true });
  const items = [];
  for (const r of requests) {
    if (r.dupOf) {
      const orig = items.find((i) => i.segmentId === r.dupOf);
      items.push({ ...orig, segmentId: r.segmentId, reusedFrom: r.dupOf });
      ctx.log.info(`${r.segmentId}: reuses ${r.dupOf}`);
      continue;
    }
    const p = providers[r.provider];
    const outBase = path.join(ctx.file('visuals'), r.segmentId);
    const got = await p.fetch(r, { outBase, config: ctx.config, log: ctx.log });
    if (paid.includes(r)) guard.record({ provider: r.provider, label: r.segmentId, usd: got.usd ?? p.estimateUsd?.(r, ctx.config), requestId: got.requestId || null });
    const file = path.isAbsolute(got.file) ? got.file : path.join('visuals', path.basename(got.file));
    items.push({ segmentId: r.segmentId, source: r.source, provider: r.provider, file, credit: got.credit || '', licence: got.licence || '', aiGenerated: Boolean(got.aiGenerated), prompt: got.prompt || null, requestId: got.requestId || null });
    ctx.log.info(`${r.segmentId}: ${r.provider} → ${file}`);
  }
  writeJson(ctx.file('visuals.json'), { items, spentUsd: guard.spentThisRun, aiGenerated: items.some((i) => i.aiGenerated) });
  const local = items.filter((i) => !path.isAbsolute(i.file)).map((i) => i.file);
  return { outputs: ['visuals.json', ...local], note: `${items.length} visuals, spent $${guard.spentThisRun.toFixed(4)}` };
}

stepMain(import.meta.url, 'visuals', run);
