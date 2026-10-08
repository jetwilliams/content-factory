// Provider (adapter) loader and selection.
//
// A provider is a file at providers/<kind>/<name>.mjs with a default-exported object. Interfaces
// per kind are documented in docs/providers.md. Which provider each step uses is chosen in ONE
// place: the "providers" block of config/factory.config.json (per job: jobs/<slug>/config.json).
// An environment variable can override it for a single run, e.g. CF_TTS_PROVIDER=piper.
// "publisher" is used by the publish stage (publish/), not by a pipeline step; its default is "dry" (never posts).
// --dry-run always selects the "dry" adapter of every kind: free, offline, no keys.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './util.mjs';
import { env } from './env.mjs';

export const KINDS = ['llm', 'tts', 'visuals', 'music', 'captions', 'publisher'];

const ENV_OVERRIDE = { llm: 'CF_LLM_PROVIDER', tts: 'CF_TTS_PROVIDER', music: 'CF_MUSIC_PROVIDER', captions: 'CF_CAPTIONS_PROVIDER', publisher: 'CF_PUBLISHER' };

// Which adapter a step should use. For visuals, pass the script's source (placeholder|folder|stock|ai).
export function providerName(kind, { config = {}, dryRun = false } = {}, source) {
  if (dryRun) return 'dry';
  const p = config.providers || {};
  if (kind === 'visuals') {
    const map = { placeholder: 'dry', folder: 'folder', stock: 'pexels', ai: 'openai-images', ...(p.visuals || {}) };
    return map[source || 'placeholder'] || 'dry';
  }
  return env(ENV_OVERRIDE[kind] || '', '') || p[kind] || 'dry';
}

export function listProviders(kind) {
  return fs.readdirSync(path.join(ROOT, 'providers', kind)).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4)).sort();
}

export async function loadProvider(kind, name) {
  if (!KINDS.includes(kind)) throw new Error(`unknown provider kind "${kind}"`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(name))) throw new Error(`bad provider name "${name}"`);
  const file = path.join(ROOT, 'providers', kind, `${name}.mjs`);
  if (!fs.existsSync(file)) throw new Error(`no ${kind} provider "${name}". Available: ${listProviders(kind).join(', ')}`);
  const mod = await import(file);
  const p = mod.default || mod;
  if (!p || typeof p !== 'object') throw new Error(`${kind}/${name} must export a default object`);
  return p;
}

// A provider call needs the spend gate when it is marked paid and its price is not exactly 0.
export function needsSpendGate(provider, estimateUsd) {
  return Boolean(provider.paid) && estimateUsd !== 0;
}
