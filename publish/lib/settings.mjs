// Publish settings. Same rules as the rest of Content Factory:
//   - non-secret settings live in config/factory.config.json ("providers.publisher" and the "publish" block);
//   - keys live in .env (never in config);
//   - an environment variable overrides the config for one run (CF_PUBLISHER, CF_PUBLISH_QUEUE, ...).
import path from 'node:path';
import { ROOT, readJson, deepMerge } from '../../lib/util.mjs';
import { loadEnv } from '../../lib/env.mjs';

export { ROOT };

// Returns undefined when unset or empty (unlike lib/env.mjs, which returns '').
export function get(name, fallback) {
  loadEnv();
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

export function flag(name, fallback = false) {
  const v = get(name);
  if (v === undefined) return typeof fallback === 'boolean' ? fallback : /^(1|true|yes|on)$/i.test(String(fallback));
  return /^(1|true|yes|on)$/i.test(v);
}

// Values of variables whose names look like secrets. They are scrubbed from every log line.
export function secretValues() {
  loadEnv();
  return Object.entries(process.env)
    .filter(([k, v]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(k) && v && v.length >= 6)
    .map(([, v]) => v);
}

export function loadFactoryConfig(file = path.join(ROOT, 'config', 'factory.config.json')) {
  return readJson(file, {});
}

// The resolved publish settings. `config` is the merged factory config (a step passes ctx.config);
// without it the repo defaults are read.
export function publishSettings(config) {
  const c = config || loadFactoryConfig();
  const p = deepMerge({ queue: 'publish/queue/queue.json', stats: 'publish/data/stats.jsonl', logFile: '' }, c.publish || {});
  const abs = (f) => (f ? path.resolve(ROOT, f) : '');
  return {
    publisher: get('CF_PUBLISHER', c.providers?.publisher || 'dry'),
    queue: abs(get('CF_PUBLISH_QUEUE', p.queue)),
    stats: abs(get('CF_PUBLISH_STATS', p.stats)),
    logFile: abs(get('CF_PUBLISH_LOG_FILE', p.logFile)),
    uploadPost: p['upload-post'] || {},
  };
}
