// Small shared helpers. Zero dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function slugify(text) {
  const s = String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return s || 'job';
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (fallback !== undefined && err.code === 'ENOENT') return fallback;
    throw new Error(`could not read ${path.basename(file)}: ${err.message}`);
  }
}

// Write to a temp file then rename, so a crash never leaves half a JSON file.
export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export const exists = (p) => fs.existsSync(p);

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge(base, over) {
  if (!isPlainObject(base) || !isPlainObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isPlainObject(v) ? deepMerge(base[k], v) : v;
  return out;
}

// Minimal argv parser: positionals, --flag, --key value, --key=value.
export function parseArgs(argv, booleans = []) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    const key = (eq > 0 ? a.slice(2, eq) : a.slice(2)).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (eq > 0) out[key] = a.slice(eq + 1);
    else if (booleans.includes(key) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

export function makeLogger(prefix = '') {
  const tag = prefix ? `[${prefix}] ` : '';
  return {
    info: (...a) => console.log(tag + a.join(' ')),
    warn: (...a) => console.warn(`${tag}WARN ` + a.join(' ')),
    error: (...a) => console.error(`${tag}ERROR ` + a.join(' ')),
  };
}

export const silentLogger = { info() {}, warn() {}, error() {} };

export function round(n, dp = 3) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// Shell-quote one argument for a POSIX shell (used only for printed commands).
export function shQuote(s) {
  const str = String(s);
  if (/^[A-Za-z0-9_\-.,/:=+@%]+$/.test(str)) return str;
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

// Fill {name} placeholders in a command template and split into argv without a shell.
// Each placeholder becomes exactly one argument, so file names with spaces are safe.
export function fillCommand(template, values) {
  const tokens = String(template).trim().match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return tokens.map((t) => {
    const unq = /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t;
    return unq.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
  });
}
