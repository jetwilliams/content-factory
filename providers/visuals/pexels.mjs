// Stock photos via the Pexels API (free, bring your own key: CF_PEXELS_API_KEY).
// Example adapter: check the provider's current API docs and licence terms before relying on it.
// Credit the photographer in your caption or description where the licence asks for it.
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../../lib/env.mjs';

export default {
  name: 'pexels',
  paid: false,
  async fetch(req, { outBase }) {
    const key = env('CF_PEXELS_API_KEY');
    if (!key) throw new Error('set CF_PEXELS_API_KEY to use stock visuals');
    const q = req.query || req.label;
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=portrait&per_page=1`;
    const res = await fetch(url, { headers: { authorization: key }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`stock search failed: HTTP ${res.status}`);
    const photo = (await res.json()).photos?.[0];
    if (!photo) throw new Error(`no stock result for "${q}"`);
    const img = await fetch(photo.src?.portrait || photo.src?.large2x || photo.src?.original, { signal: AbortSignal.timeout(60000) });
    if (!img.ok) throw new Error(`stock download failed: HTTP ${img.status}`);
    const out = `${outBase}.jpg`;
    fs.writeFileSync(out, Buffer.from(await img.arrayBuffer()));
    return { file: path.basename(out), credit: `${photo.photographer || 'unknown'} (${photo.url || 'pexels'})`, licence: 'Pexels License (check current terms)' };
  },
};
