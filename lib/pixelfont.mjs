// A tiny built-in 5x7 pixel font that renders text to PNG with Node's stdlib (zlib) only.
// It is the fallback text engine for ffmpeg builds without drawtext/libass, so the pipeline
// always produces titles and captions. Glyphs are original to this project (MIT).
import zlib from 'node:zlib';

const G = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#', B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.', D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####', F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.####', H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '.###.|..#..|..#..|..#..|..#..|..#..|.###.', J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#', L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#', N: '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.', P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#', R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.', T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.', V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.', X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..', Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  0: '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.', 1: '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  2: '.###.|#...#|....#|...#.|..#..|.#...|#####', 3: '####.|....#|....#|.###.|....#|....#|####.',
  4: '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.', 5: '#####|#....|####.|....#|....#|#...#|.###.',
  6: '.###.|#....|#....|####.|#...#|#...#|.###.', 7: '#####|....#|...#.|..#..|.#...|.#...|.#...',
  8: '.###.|#...#|#...#|.###.|#...#|#...#|.###.', 9: '.###.|#...#|#...#|.####|....#|....#|.###.',
  ' ': '.....|.....|.....|.....|.....|.....|.....', '.': '.....|.....|.....|.....|.....|.##..|.##..',
  ',': '.....|.....|.....|.....|.##..|..#..|.#...', '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..',
  '?': '.###.|#...#|....#|...#.|..#..|.....|..#..', "'": '..#..|..#..|.#...|.....|.....|.....|.....',
  '"': '.#.#.|.#.#.|.....|.....|.....|.....|.....', '-': '.....|.....|.....|.###.|.....|.....|.....',
  ':': '.....|.##..|.##..|.....|.##..|.##..|.....', ';': '.....|.##..|.##..|.....|.##..|..#..|.#...',
  '/': '....#|...#.|...#.|..#..|.#...|.#...|#....', '&': '.##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#',
  '+': '.....|..#..|..#..|#####|..#..|..#..|.....', '%': '##..#|##.#.|...#.|..#..|.#...|.#.##|#..##',
  '(': '...#.|..#..|.#...|.#...|.#...|..#..|...#.', ')': '.#...|..#..|...#.|...#.|...#.|..#..|.#...',
  '#': '.#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.', '=': '.....|.....|#####|.....|#####|.....|.....',
  '_': '.....|.....|.....|.....|.....|.....|#####', '*': '.....|#.#.#|.###.|#####|.###.|#.#.#|.....',
};
const GLYPHS = Object.fromEntries(Object.entries(G).map(([k, v]) => [k, v.split('|')]));

export function normaliseText(s) {
  return String(s)
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toUpperCase();
}

export function wrapText(text, maxChars, maxLines = Infinity) {
  const ws = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of ws) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = last.length + 3 <= maxChars ? `${last}...` : `${last.slice(0, Math.max(1, maxChars - 3))}...`;
    return kept;
  }
  return lines;
}

export function parseColour(hex, fallback = [255, 255, 255, 255]) {
  const m = String(hex || '').match(/^#?([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255];
}

// Measure without drawing: width/height in pixels for the given lines and scale.
export function measure(lines, scale, padding = 0) {
  const cols = Math.max(1, ...lines.map((l) => l.length));
  return { width: cols * 6 * scale - scale + padding * 2, height: lines.length * 9 * scale - 2 * scale + padding * 2 };
}

// Render lines of text. Returns { png: Buffer, width, height }.
export function renderText(lines, { scale = 8, colour = '#FFFFFF', background = null, outlineColour = null, outline = 0, padding = 0 } = {}) {
  const norm = lines.map(normaliseText);
  const { width, height } = measure(norm, scale, padding);
  const W = width + outline * 2, H = height + outline * 2;
  const px = new Uint8Array(W * H * 4);
  const bg = background ? parseColour(background) : [0, 0, 0, 0];
  for (let i = 0; i < W * H; i++) px.set(bg, i * 4);
  const fg = parseColour(colour);
  const ol = outlineColour ? parseColour(outlineColour) : null;
  const rect = (x0, y0, w, h, c) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) px.set(c, (y * W + x) * 4);
  };
  const eachPixel = (fn) => {
    norm.forEach((line, li) => {
      const lineW = line.length * 6 * scale - scale;
      const x0 = outline + padding + Math.floor((width - padding * 2 - lineW) / 2);
      const y0 = outline + padding + li * 9 * scale;
      [...line].forEach((ch, ci) => {
        const g = GLYPHS[ch] || GLYPHS['?'];
        g.forEach((row, ry) => [...row].forEach((bit, rx) => { if (bit === '#') fn(x0 + (ci * 6 + rx) * scale, y0 + ry * scale); }));
      });
    });
  };
  if (ol && outline > 0) eachPixel((x, y) => rect(x - outline, y - outline, scale + outline * 2, scale + outline * 2, ol));
  eachPixel((x, y) => rect(x, y, scale, scale, fg));
  return { png: encodePng(px, W, H), width: W, height: H };
}

// --- PNG encoder (RGBA, 8-bit) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePng(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
