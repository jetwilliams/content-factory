// Step 5 · music: a music bed → music.wav + music.json (source + licence travel with the job).
// Adapter from config.providers.music: strudel-command (default) | wav-folder | file | command | none | dry.
// If the chosen adapter is not set up yet, config.providers.musicFallback is used (default "dry").
// Paid adapters go through the same spend gate as visuals (estimate, --allow-spend, per-run cap).
import fs from 'node:fs';
import { readJson, writeJson } from '../../lib/util.mjs';
import { loadProvider, providerName, needsSpendGate } from '../../lib/providers.mjs';
import { SpendGuard, SpendCapError } from '../../lib/cost.mjs';
import { stepMain } from '../../lib/step-cli.mjs';

const NOT_SET_UP = /^set (CF_|config\.)/;

export async function run(ctx) {
  const voice = readJson(ctx.file('voice.json'), null);
  const seconds = voice ? voice.duration + 1 : 60; // the render loops or trims the bed to fit
  let name = providerName('music', ctx);
  let provider = await loadProvider('music', name);
  const args = { seconds, outFile: ctx.file('music.wav'), config: ctx.config, log: ctx.log, slug: ctx.slug };

  let guard = null;
  const est = provider.estimateUsd?.(ctx.config);
  if (needsSpendGate(provider, est)) {
    guard = new SpendGuard({ capUsd: Number(ctx.config.music?.spendCapUsd ?? 0), allowSpend: ctx.allowSpend, ledgerPath: ctx.file('spend.json'), log: ctx.log });
    try {
      guard.authorize(guard.estimate([{ provider: `music:${name}`, label: `music:${name}`, usd: est }]));
    } catch (e) {
      if (e instanceof SpendCapError) return { status: 'blocked', note: e.message };
      throw e;
    }
  }

  let res;
  try {
    res = await provider.make(args);
  } catch (e) {
    const fallback = ctx.config.providers?.musicFallback;
    if (!NOT_SET_UP.test(e.message) || !fallback || fallback === 'none') throw e;
    ctx.log.warn(`${name}: ${e.message}`);
    ctx.log.warn(`using musicFallback "${fallback}" for now`);
    name = fallback;
    provider = await loadProvider('music', name);
    guard = null;
    res = await provider.make(args);
  }
  if (guard) guard.record({ provider: `music:${name}`, label: 'music', usd: res?.usd ?? est });

  if (!res) {
    fs.rmSync(ctx.file('music.wav'), { force: true });
    writeJson(ctx.file('music.json'), { provider: name, file: null });
    return { outputs: ['music.json'], note: 'no music bed' };
  }
  writeJson(ctx.file('music.json'), { provider: name, file: 'music.wav', source: res.source, licence: res.licence });
  return { outputs: ['music.wav', 'music.json'], note: `music via ${name} (${res.licence})` };
}

stepMain(import.meta.url, 'music', run);
