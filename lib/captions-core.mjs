// Caption timing and subtitle file writers. Pure functions, no I/O.

const tokenise = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);

// Even-split fallback: spread a segment's words across its time span, weighted by word length
// (longer words take longer to say). Used when the TTS engine gives no word timings.
export function evenSplitWords(text, start, end) {
  const ws = tokenise(text);
  if (!ws.length || end <= start) return [];
  const weights = ws.map((w) => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, '').length) + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const span = end - start;
  let t = start;
  return ws.map((w, i) => {
    const d = (span * weights[i]) / total;
    const word = { word: w, start: t, end: i === ws.length - 1 ? end : t + d };
    t += d;
    return word;
  });
}

// voice.json segments → word list. Segments that already carry `words` (from a TTS engine with
// alignment) are used as-is; the rest fall back to the even split.
export function wordTimings(segments) {
  const out = [];
  for (const seg of segments) {
    if (Array.isArray(seg.words) && seg.words.length) out.push(...seg.words.map((w) => ({ ...w, segment: seg.id })));
    else out.push(...evenSplitWords(seg.text, seg.start, seg.end).map((w) => ({ ...w, segment: seg.id })));
  }
  return out;
}

// Group words into caption chunks of up to n words, never crossing a segment boundary.
export function chunkWords(words, n = 1) {
  const size = Math.max(1, Math.floor(n));
  const chunks = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    chunks.push({ text: cur.map((w) => w.word).join(' '), start: cur[0].start, end: cur.at(-1).end, segment: cur[0].segment });
    cur = [];
  };
  for (const w of words) {
    if (cur.length && (cur.length >= size || cur[0].segment !== w.segment)) flush();
    cur.push(w);
  }
  flush();
  // Close tiny gaps so captions don't flicker between chunks of the same segment.
  for (let i = 0; i < chunks.length - 1; i++) {
    if (chunks[i].segment === chunks[i + 1].segment) chunks[i].end = chunks[i + 1].start;
  }
  return chunks;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

export function assTime(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  return `${Math.floor(cs / 360000)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
}

export function toSrt(chunks) {
  return chunks.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}

// #RRGGBB[AA] → ASS &HAABBGGRR (ASS alpha: 00 = opaque).
export function assColour(hex) {
  const m = String(hex).match(/^#?([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (!m) return '&H00FFFFFF';
  const [r, g, b] = [0, 2, 4].map((i) => m[1].slice(i, i + 2));
  const a = m[2] ? (255 - parseInt(m[2], 16)).toString(16).padStart(2, '0') : '00';
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

const assEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\N');

export function toAss(chunks, { width = 1080, height = 1920, font = 'Sans', fontSize = 72, textColour = '#FFFFFF', outlineColour = '#000000', outline = 5, marginBottom = 500, marginSide = 70, uppercase = true } = {}) {
  const head = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,${font},${fontSize},${assColour(textColour)},${assColour(textColour)},${assColour(outlineColour)},&H80000000,1,0,0,0,100,100,0,0,1,${outline},0,2,${marginSide},${marginSide},${marginBottom},1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const lines = chunks.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Caption,,0,0,0,,${assEscape(uppercase ? c.text.toUpperCase() : c.text)}`);
  return head.concat(lines).join('\n') + '\n';
}
