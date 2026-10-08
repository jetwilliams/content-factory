// script.json: the contract between the script step and everything after it.
//
// {
//   "topic": "how tides work",
//   "title": "Why two tides a day?",            // hook title plate text (short)
//   "hook":  { "voice": "...", "onScreen": "..." },
//   "beats": [ { "voice": "...", "onScreen": "...", "visual": { "source": "placeholder|folder|stock|ai", "query": "...", "prompt": "...", "file": "..." } } ],
//   "cta":   { "voice": "...", "onScreen": "..." },
//   "post":  { "caption": "...", "tags": ["a", "b"] },
//   "factCheck": { "status": "unchecked|checked", "by": "", "notes": "" }
// }
//
// Beat count and length limits come from config.script, so the structure is yours to change.

export const DEFAULT_RULES = {
  minBeats: 4,
  maxBeats: 8,
  maxVoiceWordsPerBeat: 30,
  maxOnScreenChars: 48,
  maxTitleChars: 40,
};

export const VISUAL_SOURCES = ['placeholder', 'folder', 'stock', 'ai'];

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);

function checkLine(obj, where, rules, errors, { needVoice = true } = {}) {
  if (!obj || typeof obj !== 'object') { errors.push(`${where} must be an object`); return; }
  if (needVoice) {
    if (typeof obj.voice !== 'string' || !obj.voice.trim()) errors.push(`${where}.voice must be a non-empty string`);
    else if (words(obj.voice).length > rules.maxVoiceWordsPerBeat) errors.push(`${where}.voice has ${words(obj.voice).length} words (max ${rules.maxVoiceWordsPerBeat})`);
  }
  if (obj.onScreen !== undefined && typeof obj.onScreen !== 'string') errors.push(`${where}.onScreen must be a string`);
  else if (obj.onScreen && obj.onScreen.length > rules.maxOnScreenChars) errors.push(`${where}.onScreen is ${obj.onScreen.length} chars (max ${rules.maxOnScreenChars})`);
  if (obj.visual !== undefined) {
    const v = obj.visual;
    if (!v || typeof v !== 'object') errors.push(`${where}.visual must be an object`);
    else if (v.source !== undefined && !VISUAL_SOURCES.includes(v.source)) errors.push(`${where}.visual.source must be one of ${VISUAL_SOURCES.join(', ')}`);
  }
}

export function validateScript(script, rulesIn = {}) {
  const rules = { ...DEFAULT_RULES, ...rulesIn };
  const errors = [];
  if (!script || typeof script !== 'object' || Array.isArray(script)) return { ok: false, errors: ['script must be a JSON object'] };
  if (typeof script.title !== 'string' || !script.title.trim()) errors.push('title must be a non-empty string');
  else if (script.title.length > rules.maxTitleChars) errors.push(`title is ${script.title.length} chars (max ${rules.maxTitleChars})`);
  checkLine(script.hook, 'hook', rules, errors);
  if (!Array.isArray(script.beats)) errors.push('beats must be an array');
  else {
    if (script.beats.length < rules.minBeats || script.beats.length > rules.maxBeats) {
      errors.push(`beats has ${script.beats.length} items (need ${rules.minBeats}-${rules.maxBeats})`);
    }
    script.beats.forEach((b, i) => checkLine(b, `beats[${i}]`, rules, errors));
  }
  checkLine(script.cta, 'cta', rules, errors);
  if (script.post !== undefined) {
    if (typeof script.post !== 'object' || script.post === null) errors.push('post must be an object');
    else {
      if (script.post.caption !== undefined && typeof script.post.caption !== 'string') errors.push('post.caption must be a string');
      if (script.post.tags !== undefined && (!Array.isArray(script.post.tags) || script.post.tags.some((t) => typeof t !== 'string'))) errors.push('post.tags must be an array of strings');
    }
  }
  return { ok: errors.length === 0, errors };
}

// Flatten a script into the ordered segments that get voiced and shown: hook, beats..., cta.
export function segmentsOf(script) {
  const segs = [{ id: 'hook', kind: 'hook', ...script.hook }];
  script.beats.forEach((b, i) => segs.push({ id: `beat${i + 1}`, kind: 'beat', ...b }));
  segs.push({ id: 'cta', kind: 'cta', ...script.cta });
  // The hook and CTA reuse the first/last beat's visual unless they set their own.
  if (!segs[0].visual) segs[0].visual = script.beats[0]?.visual;
  if (!segs.at(-1).visual) segs.at(-1).visual = script.beats.at(-1)?.visual;
  return segs;
}

// Pull the first JSON object out of an LLM reply (tolerates ```json fences and chatter).
export function extractJson(text) {
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : String(text);
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object found in the model reply');
  return JSON.parse(body.slice(start, end + 1));
}

// Read and re-validate a job's script.json (people edit it by hand between steps).
export async function loadScript(ctx) {
  const { readFileSync, existsSync } = await import('node:fs');
  const file = ctx.file('script.json');
  if (!existsSync(file)) throw new Error('script.json is missing: run the script step first');
  const script = JSON.parse(readFileSync(file, 'utf8'));
  const v = validateScript(script, { ...DEFAULT_RULES, ...(ctx.config?.script || {}) });
  if (!v.ok) throw new Error(`script.json is invalid:\n  ${v.errors.join('\n  ')}`);
  return script;
}
