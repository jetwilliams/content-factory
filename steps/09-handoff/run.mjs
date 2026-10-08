// Step 9 · handoff: adds the finished video to the built-in publish queue as a DRAFT.
// Prints the preview (checks + approval code) and the exact approve command for a human.
// It never approves, schedules or posts: that stays a human decision (node factory.mjs publish approve ...).
import path from 'node:path';
import { readJson, writeJson } from '../../lib/util.mjs';
import { stepMain } from '../../lib/step-cli.mjs';
import * as Q from '../../publish/lib/queue.mjs';
import { addDraftFromFile } from '../../publish/lib/add.mjs';
import { previewText } from '../../publish/lib/preview.mjs';
import { publishSettings } from '../../publish/lib/settings.mjs';

// Lowercase, letters/digits/_ only, deduplicated, max 5.
export function cleanTags(tags = []) {
  return [...new Set(tags.map((t) => String(t).toLowerCase().replace(/^#/, '').replace(/[^a-z0-9_]/g, '')).filter(Boolean))].slice(0, 5);
}

export function approveCommand(item) {
  return `node factory.mjs publish approve ${item.id} --by NAME --code ${Q.approvalCode(item)}`;
}

export async function run(ctx) {
  const qa = readJson(ctx.file('qa.json'), null);
  const render = readJson(ctx.file('render.json'), null);
  const script = readJson(ctx.file('script.json'), null);
  if (!qa || !render || !script) throw new Error('need qa.json, render.json and script.json: run the earlier steps first');
  if (!qa.pass && !ctx.args?.overrideQa) {
    return { status: 'blocked', note: 'QA failed (see qa.json). Fix and re-render, or re-run this step with --override-qa after a human has looked.' };
  }
  const file = path.resolve(ctx.file(render.file));
  const caption = (script.post?.caption || script.title).trim();
  const tags = cleanTags(script.post?.tags);
  const h = ctx.config.handoff || {};
  const settings = publishSettings(ctx.config);
  const store = Q.createStore(settings.queue);

  const { item, media, reused, replaced } = await addDraftFromFile({
    store, file, caption, tags, at: h.at, platforms: h.platforms, title: script.title,
    source: { job: ctx.slug, dryRun: Boolean(ctx.dryRun) },
  });
  const approve = approveCommand(item);
  const preview = previewText(item, media);

  const checklist = [
    'Watch the whole video with sound on.',
    'Fact-check every claim against notes.md sources; set script.json factCheck.status to "checked".',
    'Turn on each platform\'s AI-content label if any part is synthetic (voice, visuals).',
    'Check music, footage and voice licences (music.json, visuals.json, voice.json).',
    `Preview it (node factory.mjs publish preview ${item.id}), then approve it yourself: ${approve}`,
  ];
  writeJson(ctx.file('handoff.json'), {
    queueId: item.id, queueFile: settings.queue, status: item.status, approvalCode: Q.approvalCode(item),
    approveCommand: approve, file, caption, tags, at: item.at, platforms: item.platforms,
    dryRun: Boolean(ctx.dryRun), qaPass: qa.pass, reused, replaced, checklist,
  });

  console.log(`\n${preview}\n`);
  if (replaced) ctx.log.info(`older draft #${replaced} of this job was cancelled (replaced by #${item.id})`);
  if (ctx.dryRun) ctx.log.warn('dry run: this draft is placeholder content. Cancel it (node factory.mjs publish cancel ' + item.id + ') rather than approve it.');
  ctx.log.info(`approve with: ${approve}`);
  return {
    outputs: ['handoff.json'],
    note: `${reused ? 'already in' : 'added to'} the publish queue as draft #${item.id}. Nothing is posted until a human approves it.`,
  };
}

stepMain(import.meta.url, 'handoff', run);
