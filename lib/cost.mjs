// Spend guard for paid providers.
//
// Rules:
//  1. Every paid call is estimated BEFORE it is made, and the estimate is printed.
//  2. A run may not spend more than its cap (`spendCapUsd`, default 0 = no paid calls at all).
//  3. Nothing paid runs unless the caller explicitly allows spending (`--allow-spend`).
//  4. A provider with no known price cannot be authorised, because the cap could not be enforced.
//  5. Actual spend is recorded in the job's spend ledger (spend.json) for reporting.
import fs from 'node:fs';
import { readJson, writeJson, round } from './util.mjs';

export class SpendCapError extends Error {
  constructor(message, details = {}) { super(message); this.name = 'SpendCapError'; this.details = details; }
}

export class SpendGuard {
  constructor({ capUsd = 0, allowSpend = false, ledgerPath = null, log = console } = {}) {
    if (!(Number.isFinite(capUsd) && capUsd >= 0)) throw new Error('spend cap must be a number >= 0');
    this.capUsd = capUsd;
    this.allowSpend = Boolean(allowSpend);
    this.ledgerPath = ledgerPath;
    this.log = log;
    this.spentThisRun = 0;
  }

  // items: [{ provider, label, usd }] (usd null/undefined = unknown price)
  estimate(items) {
    const unknown = items.filter((i) => !(Number.isFinite(i.usd) && i.usd >= 0));
    const usd = round(items.reduce((a, i) => a + (Number.isFinite(i.usd) ? i.usd : 0), 0), 4);
    return { usd, count: items.length, unknown: unknown.map((i) => i.label || i.provider) };
  }

  describe(est) {
    return `estimated cost: $${est.usd.toFixed(4)} for ${est.count} paid call(s); cap for this run: $${this.capUsd.toFixed(2)}; already spent this run: $${this.spentThisRun.toFixed(4)}`;
  }

  // Throws SpendCapError unless the whole estimate fits. Call before any paid request.
  authorize(est) {
    if (est.count === 0) return true;
    this.log.info?.(this.describe(est));
    if (est.unknown.length) {
      throw new SpendCapError(`no price is configured for: ${est.unknown.join(', ')}. Set it in config.visuals.prices so the cap can be enforced.`, { est });
    }
    if (!this.allowSpend) {
      throw new SpendCapError('paid calls are disabled by default. Re-run with --allow-spend after checking the estimate.', { est });
    }
    if (round(this.spentThisRun + est.usd, 4) > this.capUsd) {
      throw new SpendCapError(`estimate $${est.usd.toFixed(4)} would exceed the per-run cap of $${this.capUsd.toFixed(2)} (spent so far $${this.spentThisRun.toFixed(4)}). Raise config.visuals.spendCapUsd or reduce paid beats.`, { est });
    }
    return true;
  }

  // Record an actual charge (or the estimate, when the provider can't report one).
  record({ provider, label, usd, requestId = null }) {
    const amount = Number.isFinite(usd) ? usd : 0;
    if (round(this.spentThisRun + amount, 4) > this.capUsd) {
      // The provider charged more than estimated. Stop further calls in this run.
      this.spentThisRun = round(this.spentThisRun + amount, 4);
      this.appendLedger({ provider, label, usd: amount, requestId, overCap: true });
      throw new SpendCapError(`actual spend $${this.spentThisRun.toFixed(4)} passed the cap of $${this.capUsd.toFixed(2)}; stopping.`);
    }
    this.spentThisRun = round(this.spentThisRun + amount, 4);
    this.appendLedger({ provider, label, usd: amount, requestId });
  }

  appendLedger(entry) {
    if (!this.ledgerPath) return;
    const ledger = fs.existsSync(this.ledgerPath) ? readJson(this.ledgerPath) : { totalUsd: 0, entries: [] };
    ledger.entries.push({ at: new Date().toISOString(), ...entry });
    ledger.totalUsd = round(ledger.entries.reduce((a, e) => a + (e.usd || 0), 0), 4);
    writeJson(this.ledgerPath, ledger);
  }
}
