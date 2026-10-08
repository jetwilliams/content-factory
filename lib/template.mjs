// Render template: templates/default.template.json (or config.render.template), deep-merged with
// an optional jobs/<slug>/template.json for per-job tweaks.
import path from 'node:path';
import { ROOT, readJson, deepMerge } from './util.mjs';

export function loadTemplate(ctx) {
  const base = readJson(path.resolve(ROOT, ctx.config.render?.template || 'templates/default.template.json'));
  return deepMerge(base, readJson(ctx.file('template.json'), {}));
}
