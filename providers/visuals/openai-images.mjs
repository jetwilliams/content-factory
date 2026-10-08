// AI image generation through an images/generations-style HTTP API. Bring your own key.
//   CF_IMAGE_API_KEY, CF_IMAGE_MODEL, optional CF_IMAGE_BASE_URL (default https://api.openai.com/v1)
// PAID. The step only calls this after: an estimate is printed, --allow-spend is given, and the
// estimate fits config.visuals.spendCapUsd. Set config.visuals.prices["openai-images"] to the
// current price per image for your model and size (check the provider's pricing page).
// Example adapter: check the provider's current API docs; response shapes differ between models.
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../../lib/env.mjs';

export default {
  name: 'openai-images',
  paid: true,
  estimateUsd(req, config) {
    const p = config.visuals?.prices?.['openai-images'];
    return Number.isFinite(p) ? p : null;
  },
  async fetch(req, { outBase, config }) {
    const key = env('CF_IMAGE_API_KEY');
    const model = env('CF_IMAGE_MODEL');
    if (!key || !model) throw new Error('set CF_IMAGE_API_KEY and CF_IMAGE_MODEL');
    const base = env('CF_IMAGE_BASE_URL', 'https://api.openai.com/v1').replace(/\/+$/, '');
    const prompt = `${req.prompt || req.query || req.label}. Vertical composition. No text, no letters, no logos, no watermarks.`;
    const res = await fetch(`${base}/images/generations`, {
      method: 'POST', signal: AbortSignal.timeout(300000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, prompt, size: config.visuals?.imageSize || '1024x1536', n: 1 }),
    });
    const requestId = res.headers.get('x-request-id');
    if (!res.ok) throw new Error(`image generation failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const item = (await res.json()).data?.[0];
    const out = `${outBase}.png`;
    if (item?.b64_json) fs.writeFileSync(out, Buffer.from(item.b64_json, 'base64'));
    else if (item?.url) {
      const img = await fetch(item.url, { signal: AbortSignal.timeout(60000) });
      fs.writeFileSync(out, Buffer.from(await img.arrayBuffer()));
    } else throw new Error('image API returned no image');
    return { file: path.basename(out), credit: `AI-generated (${model})`, licence: "see your provider's terms", aiGenerated: true, requestId, prompt };
  },
};
