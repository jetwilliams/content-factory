// The human-readable summary a reviewer sees before approving. Used by the publish CLI, step 9 (handoff)
// and the Telegram example.
import path from 'node:path';
import { approvalCode } from './queue.mjs';
import { youtubeTitle, validateCaption } from './caption.mjs';
import { checkVideo } from './probe.mjs';
import { fmtLocal, fmtBytes } from './time.mjs';

export function previewText(item, media) {
  const spec = !media ? '' : media.probed
    ? ` (${media.width}x${media.height}, ${media.duration.toFixed(1)}s, ${fmtBytes(media.size)})`
    : ` (${fmtBytes(media.size)}, not probed)`;
  const issues = [];
  for (const p of item.platforms) {
    const v = media ? checkVideo(media, p) : { errors: [], warnings: [] };
    const c = validateCaption(item, p);
    for (const e of [...v.errors, ...c.errors]) issues.push(`  ERROR   ${e}`);
    for (const w of [...v.warnings, ...c.warnings]) issues.push(`  warning ${w}`);
  }
  const code = approvalCode(item);
  return [
    `#${item.id} [${item.status}] ${path.basename(item.file)}${spec}`,
    ...(item.source?.job ? [`from job:  ${item.source.job}`] : []),
    `when:      ${fmtLocal(item.at)}`,
    `platforms: ${item.platforms.join(', ')}`,
    ...(item.platforms.includes('youtube') ? [`yt title:  ${youtubeTitle({ title: item.title, caption: item.caption, fallback: path.basename(item.file, path.extname(item.file)) })}`] : []),
    'caption:',
    ...(item.captionText ? item.captionText.split('\n').map((l) => `  | ${l}`) : ['  (none)']),
    ...(issues.length ? ['checks:', ...[...new Set(issues)]] : ['checks:    ok']),
    ...(item.approval ? [`approved:  by ${item.approval.by} at ${fmtLocal(item.approval.at)}`] : []),
    `approval code: ${code}`,
    ...(item.source?.dryRun ? ['NOTE:      made by a --dry-run (placeholder content). Do not approve it for a real post.'] : []),
    ...(item.status === 'draft' ? [`approve with: node factory.mjs publish approve ${item.id} --by NAME --code ${code}`] : []),
  ].join('\n');
}
