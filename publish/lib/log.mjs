// Tiny logger. Every line passes through redact() so secrets never reach the terminal or a log file.
import fs from 'node:fs';
import { secretValues, publishSettings } from './settings.mjs';

let logFile;

export function redact(value) {
  let s = typeof value === 'string' ? value : JSON.stringify(value);
  if (s === undefined) return '';
  for (const secret of secretValues()) s = s.split(secret).join('[REDACTED]');
  return s
    .replace(/(Apikey|Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 [REDACTED]')
    .replace(/(bot)\d{6,}:[A-Za-z0-9_-]{20,}/g, '$1[REDACTED]');
}

function write(level, msg, extra) {
  const line = `${new Date().toISOString()} ${level.padEnd(5)} ${redact(msg)}${extra !== undefined ? ' ' + redact(extra) : ''}`;
  (level === 'ERROR' || level === 'WARN' ? console.error : console.log)(line);
  if (logFile === undefined) { try { logFile = publishSettings().logFile; } catch { logFile = ''; } }
  const file = logFile;
  if (file) {
    try { fs.appendFileSync(file, line + '\n'); } catch { /* logging must never crash a run */ }
  }
}

export const info = (msg, extra) => write('INFO', msg, extra);
export const warn = (msg, extra) => write('WARN', msg, extra);
export const error = (msg, extra) => write('ERROR', msg, extra);

// A logger that records instead of printing (used by tests).
export function memoryLogger() {
  const lines = [];
  const rec = (level) => (msg, extra) => lines.push(`${level} ${msg}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  return { lines, info: rec('INFO'), warn: rec('WARN'), error: rec('ERROR') };
}
