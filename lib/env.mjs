// Load KEY=value lines from .env without overriding real environment variables.
// Values are never printed anywhere by this project.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './util.mjs';

let loaded = false;

export function loadEnv(file = path.join(ROOT, '.env')) {
  if (loaded) return;
  loaded = true;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

export function env(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

// For logs and errors: say whether a secret is set, never what it is.
export function describeSecret(name) {
  return env(name) ? `${name} is set` : `${name} is not set`;
}
