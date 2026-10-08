// Caption + hashtag rules. Pure functions, no I/O.
//
// Platform limits change. These were taken from each platform's public documentation at the time of
// writing; check them again before relying on them, and adjust LIMITS if a platform changes its rules.

export const PLATFORMS = ['instagram', 'tiktok', 'youtube'];

// A deliberate house rule, not a platform limit: more than a handful of hashtags reads as spam and
// Instagram now caps hashtags per post at a low number too.
export const MAX_TAGS = 5;

export const LIMITS = {
  instagram: { caption: 2200, mentions: 20 },
  tiktok: { caption: 2200 },
  youtube: { title: 100, description: 5000 },
};

const TAG_RE = /^[\p{L}\p{N}_]+$/u;
const INLINE_TAG_RE = /#[\p{L}\p{N}_]+/gu;

// "a, #b c" -> ["a", "b", "c"] (deduplicated, case kept, "#" stripped).
export function normaliseTags(tags) {
  const list = (Array.isArray(tags) ? tags : String(tags ?? '').split(/[,\s]+/))
    .map((t) => String(t).trim().replace(/^#+/, ''))
    .filter(Boolean);
  for (const t of list) {
    if (!TAG_RE.test(t)) throw new Error(`hashtag "#${t}" may only contain letters, numbers and _`);
  }
  const seen = new Set();
  return list.filter((t) => {
    const k = t.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const inlineTags = (caption) => String(caption ?? '').match(INLINE_TAG_RE) || [];

// The text that is actually posted: caption, a blank line, then the hashtags.
export function buildCaption(caption, tags) {
  const list = normaliseTags(tags);
  const inline = new Set(inlineTags(caption).map((t) => t.slice(1).toLowerCase()));
  const extra = list.filter((t) => !inline.has(t.toLowerCase()));
  return [String(caption ?? '').trim(), extra.map((t) => '#' + t).join(' ')].filter(Boolean).join('\n\n');
}

// YouTube title: --title, else the first line of the caption without hashtags. Max 100 chars, no < or >.
export function youtubeTitle({ title, caption, fallback = 'Untitled' }) {
  const src = title || String(caption ?? '').split('\n')[0].replace(INLINE_TAG_RE, '');
  let t = src.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  if (t.length > LIMITS.youtube.title) t = t.slice(0, LIMITS.youtube.title).replace(/\s+\S*$/, '').trim();
  return t || fallback;
}

// Returns { errors: [], warnings: [] } for one platform. `caption` is the raw caption, `tags` the --tags list.
export function validateCaption({ caption = '', tags = [], title }, platform) {
  const errors = [];
  const warnings = [];
  if (!PLATFORMS.includes(platform)) return { errors: [`unknown platform "${platform}"`], warnings };

  let list = [];
  try { list = normaliseTags(tags); } catch (e) { errors.push(e.message); }
  const text = buildCaption(caption, list);
  const allTags = new Set([...list.map((t) => t.toLowerCase()), ...inlineTags(caption).map((t) => t.slice(1).toLowerCase())]);
  if (allTags.size > MAX_TAGS) errors.push(`${allTags.size} hashtags (max ${MAX_TAGS}, counting any inside the caption)`);
  if (!String(caption).trim()) warnings.push('caption is empty');

  const lim = LIMITS[platform];
  if (lim.caption && text.length > lim.caption) errors.push(`${platform}: caption is ${text.length} chars (limit ${lim.caption})`);
  if (lim.mentions) {
    const mentions = (text.match(/(^|\s)@[\w.]+/g) || []).length;
    if (mentions > lim.mentions) errors.push(`${platform}: ${mentions} @mentions (limit ${lim.mentions})`);
  }
  if (platform === 'youtube') {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > lim.description) errors.push(`youtube: description is ${bytes} bytes (limit ${lim.description})`);
    if (/[<>]/.test(text)) errors.push('youtube: description may not contain < or >');
    if (title && title.length > lim.title) errors.push(`youtube: title is ${title.length} chars (limit ${lim.title})`);
    if (!title && !youtubeTitle({ caption }).trim()) warnings.push('youtube: no title; pass --title or start the caption with a line of text');
  }
  return { errors, warnings };
}
