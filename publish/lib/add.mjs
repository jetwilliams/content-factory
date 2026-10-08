// Adds a video to the publish queue as a DRAFT. Used by `publish add` and by step 9 (handoff).
// It validates the file and the text for every platform first. It never approves anything.
import fs from 'node:fs';
import * as Q from './queue.mjs';
import { PLATFORMS, normaliseTags, validateCaption, buildCaption } from './caption.mjs';
import { probe as realProbe, checkVideo } from './probe.mjs';
import { parseWhen } from './time.mjs';
import { QueueError } from './errors.mjs';

export function parsePlatforms(s) {
  const list = (Array.isArray(s) ? s : String(s || 'instagram,tiktok,youtube').split(','))
    .map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  for (const p of list) if (!PLATFORMS.includes(p)) throw new QueueError(`unknown platform "${p}" (use ${PLATFORMS.join(', ')})`);
  return list;
}

// Returns { item, media, reused, replaced }.
//   source: optional { job, dryRun } recorded on the item (shown in previews; not part of the approval code).
//   When `source.job` is given, re-adding the same job is idempotent: an identical draft is reused, and an older
//   draft of that job with different content is cancelled ("replaced by #N") so only the newest one waits for review.
export async function addDraftFromFile({ store, file, caption = '', tags = '', at, platforms, title, source, probe = realProbe }) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new QueueError(`file not found: ${file}`);
  const list = parsePlatforms(platforms);
  let cleanTags;
  try { cleanTags = normaliseTags(tags); } catch (e) { throw new QueueError(e.message); }
  const draft = { caption: caption || '', tags: cleanTags, title: title || undefined };
  const media = probe(file);
  const errors = [];
  for (const p of list) errors.push(...validateCaption(draft, p).errors, ...checkVideo(media, p).errors);
  if (errors.length) throw new QueueError(`cannot add:\n  ${[...new Set(errors)].join('\n  ')}`);
  let when;
  try { when = parseWhen(at); } catch (e) { throw new QueueError(e.message); }
  const fileHash = Q.hashFile(file);

  return store.mutate((q) => {
    let replaced = null;
    if (source?.job) {
      const same = q.items.filter((i) => i.source?.job === source.job && i.status === 'draft');
      const code = Q.approvalCode({ fileHash, captionText: buildCaption(draft.caption, cleanTags), tags: cleanTags, title: draft.title, platforms: list });
      const twin = same.find((old) => old.file === file && Q.approvalCode(old) === code && Boolean(old.source?.dryRun) === Boolean(source.dryRun));
      if (twin) return { item: twin, media, reused: true, replaced: null };
      const item = Q.addDraft(q, { file, fileHash, ...draft, platforms: list, at: when });
      item.source = { ...source };
      for (const old of same) {
        Q.transition(old, 'cancelled', `replaced by #${item.id}`);
        replaced = old.id;
      }
      return { item, media, reused: false, replaced };
    }
    const item = Q.addDraft(q, { file, fileHash, ...draft, platforms: list, at: when });
    if (source) item.source = { ...source };
    return { item, media, reused: false, replaced };
  });
}
