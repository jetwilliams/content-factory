import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SpendGuard, SpendCapError } from '../lib/cost.mjs';
import { needsSpendGate, providerName } from '../lib/providers.mjs';
import { silentLogger } from '../lib/util.mjs';

const items = (n, usd) => Array.from({ length: n }, (_, i) => ({ provider: 'gen', label: `gen:${i}`, usd }));

test('no paid calls means nothing to authorise', () => {
  const g = new SpendGuard({ capUsd: 0, log: silentLogger });
  assert.equal(g.authorize(g.estimate([])), true);
});

test('paid calls are refused without --allow-spend, even under the cap', () => {
  const g = new SpendGuard({ capUsd: 10, allowSpend: false, log: silentLogger });
  assert.throws(() => g.authorize(g.estimate(items(2, 0.5))), (e) => e instanceof SpendCapError && /--allow-spend/.test(e.message));
});

test('unknown prices are refused, so the cap can always be enforced', () => {
  const g = new SpendGuard({ capUsd: 10, allowSpend: true, log: silentLogger });
  assert.throws(() => g.authorize(g.estimate([{ provider: 'gen', label: 'gen:0', usd: null }])), /no price is configured/);
});

test('an estimate above the cap is refused before any call', () => {
  const g = new SpendGuard({ capUsd: 1.0, allowSpend: true, log: silentLogger });
  const est = g.estimate(items(6, 0.2));
  assert.equal(est.usd, 1.2);
  assert.throws(() => g.authorize(est), /would exceed the per-run cap of \$1\.00/);
});

test('the default cap of 0 refuses every paid call', () => {
  const g = new SpendGuard({ allowSpend: true, log: silentLogger });
  assert.throws(() => g.authorize(g.estimate(items(1, 0.01))), /exceed/);
});

test('within the cap: authorised, recorded in the ledger, and counted against later calls', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-cost-'));
  const ledgerPath = path.join(dir, 'spend.json');
  const g = new SpendGuard({ capUsd: 1.0, allowSpend: true, ledgerPath, log: silentLogger });
  assert.equal(g.authorize(g.estimate(items(4, 0.2))), true);
  for (let i = 0; i < 4; i++) g.record({ provider: 'gen', label: `b${i}`, usd: 0.2, requestId: `r${i}` });
  assert.equal(g.spentThisRun, 0.8);
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(ledger.entries.length, 4);
  assert.equal(ledger.totalUsd, 0.8);
  // 0.8 spent + 0.4 more would pass the 1.0 cap
  assert.throws(() => g.authorize(g.estimate(items(2, 0.2))), /would exceed/);
});

test('an actual charge above the cap stops the run', () => {
  const g = new SpendGuard({ capUsd: 0.5, allowSpend: true, log: silentLogger });
  g.authorize(g.estimate(items(1, 0.4)));
  assert.throws(() => g.record({ provider: 'gen', label: 'x', usd: 0.7 }), /passed the cap/);
});

test('bad caps are rejected', () => {
  assert.throws(() => new SpendGuard({ capUsd: -1 }), /cap/);
  assert.throws(() => new SpendGuard({ capUsd: NaN }), /cap/);
});

test('spend gate applies to paid adapters unless their price is exactly 0', () => {
  assert.equal(needsSpendGate({ paid: true }, 0.04), true);
  assert.equal(needsSpendGate({ paid: true }, null), true);
  assert.equal(needsSpendGate({ paid: true }, 0), false);
  assert.equal(needsSpendGate({ paid: false }, 5), false);
});

test('dry runs always select the dry adapter', () => {
  const config = { providers: { tts: 'piper', visuals: { ai: 'openai-images' } } };
  assert.equal(providerName('tts', { config, dryRun: true }), 'dry');
  assert.equal(providerName('visuals', { config, dryRun: true }, 'ai'), 'dry');
  assert.equal(providerName('visuals', { config }, 'ai'), 'openai-images');
});
