// `run`: posts every due, APPROVED item through the configured publisher.
//
// Safety properties:
//   - Only items whose approval still matches the file + text are posted (see approvalProblem).
//   - Idempotent: platforms already marked posted are never sent again, and the item is saved as
//     `posting` BEFORE any network call, so a crash is resumed (not repeated) on the next run.
//   - Each platform is tracked on its own. A transient error (rate limit, timeout, 5xx) leaves that
//     platform pending with an exponential backoff; anything else, or too many attempts, marks it failed.
//
// All I/O is injected, so this file is tested without network or real videos.
import { transition, approvalProblem } from './queue.mjs';
import { checkVideo } from './probe.mjs';
import { validateCaption } from './caption.mjs';

export const DEFAULTS = { maxAttempts: 5, backoffBaseMs: 5 * 60e3, backoffMaxMs: 6 * 3600e3 };

export function backoffMs(attempts, { backoffBaseMs = DEFAULTS.backoffBaseMs, backoffMaxMs = DEFAULTS.backoffMaxMs } = {}) {
  return Math.min(backoffBaseMs * 2 ** Math.max(attempts - 1, 0), backoffMaxMs);
}

export async function runDue({
  q, items, publisher, save, log, now = new Date(),
  dryRun = false, hashFile, probe,
  maxAttempts = DEFAULTS.maxAttempts, backoffBaseMs = DEFAULTS.backoffBaseMs, backoffMaxMs = DEFAULTS.backoffMaxMs,
}) {
  const dry = dryRun || publisher.dry === true;
  const summary = { posted: 0, failed: 0, pending: 0, skipped: 0, dry: 0 };
  log.info(`run: ${items.length} due item(s) via ${publisher.name}${dry ? ' (DRY RUN: nothing is sent, nothing changes)' : ''}`);

  for (const item of items) {
    // 1. The approval must still cover exactly this content.
    let currentHash;
    try { currentHash = hashFile(item.file); } catch { currentHash = null; }
    const problem = currentHash === null ? 'video file is missing' : approvalProblem(item, currentHash);
    if (problem) {
      log.error(`#${item.id}: not posting: ${problem}`);
      if (!dry) { transition(item, 'failed', problem, now); save(); }
      summary.failed++;
      continue;
    }

    let media = null;
    try { media = probe(item.file); } catch (e) { log.warn(`#${item.id}: probe failed (${e.message})`); }

    for (const platform of item.platforms) {
      const r = item.results[platform] || { status: 'pending', attempts: 0 };
      if (!dry) item.results[platform] = r;
      if (r.status === 'posted') continue;
      if (r.status === 'failed') { summary.failed++; continue; }
      if (r.nextAttemptAt && new Date(r.nextAttemptAt) > now) {
        log.info(`#${item.id} ${platform}: backing off until ${r.nextAttemptAt}`);
        summary.pending++;
        continue;
      }

      const v = media ? checkVideo(media, platform) : { errors: [], warnings: [] };
      const c = validateCaption(item, platform);
      const errors = [...v.errors, ...c.errors];
      for (const w of [...v.warnings, ...c.warnings]) log.warn(`#${item.id} ${platform}: ${w}`);
      if (errors.length) {
        log.error(`#${item.id} ${platform}: ${errors.join('; ')}`);
        if (!dry) { Object.assign(r, { status: 'failed', error: errors.join('; ') }); save(); }
        summary.failed++;
        continue;
      }

      if (dry) {
        log.info(`#${item.id} ${platform}: would send:`);
        for (const line of publisher.describe(item, platform)) log.info(`    ${line}`);
        summary.dry++;
        continue;
      }

      // 2. Mark as posting and persist BEFORE the network call.
      if (item.status !== 'posting') transition(item, 'posting', null, now);
      r.status = 'posting';
      r.attempts = (r.attempts || 0) + 1;
      r.lastAttemptAt = now.toISOString();
      save();

      try {
        const out = await publisher.publish(item, platform, r, { log, save, now });
        Object.assign(r, { status: 'posted', postId: out.postId ?? null, permalink: out.permalink ?? null, postedAt: new Date().toISOString(), note: out.note ?? null, error: null, nextAttemptAt: null });
        log.info(`#${item.id} ${platform}: POSTED ${r.permalink || r.postId || ''}`.trim());
        summary.posted++;
      } catch (e) {
        r.error = e.message;
        if (e.transient && r.attempts < maxAttempts) {
          const wait = backoffMs(r.attempts, { backoffBaseMs, backoffMaxMs });
          Object.assign(r, { status: 'pending', nextAttemptAt: new Date(now.getTime() + wait).toISOString() });
          log.warn(`#${item.id} ${platform}: attempt ${r.attempts}/${maxAttempts} failed (transient), retrying after ${Math.round(wait / 60e3)} min: ${e.message}`);
          summary.pending++;
        } else {
          r.status = 'failed';
          log.error(`#${item.id} ${platform}: FAILED: ${e.message}`);
          summary.failed++;
        }
      }
      save();
    }

    if (!dry) { settle(item, now); save(); }
  }
  return summary;
}

// Derives the item status from its per-platform results.
export function settle(item, now = new Date()) {
  const states = item.platforms.map((p) => item.results[p]?.status || 'pending');
  if (states.every((s) => s === 'posted')) {
    if (item.status === 'scheduled') transition(item, 'posting', 'confirmed from provider schedule', now);
    return transition(item, 'posted', null, now);
  }
  if (states.includes('failed') && !states.some((s) => s === 'pending' || s === 'posting' || s === 'scheduled')) {
    const why = item.platforms.map((p) => item.results[p]?.error && `${p}: ${item.results[p].error}`).filter(Boolean).join(' | ');
    return transition(item, 'failed', why.slice(0, 500), now);
  }
  if (item.status === 'posting') return transition(item, 'approved', 'waiting for retry', now);
  return item;
}
