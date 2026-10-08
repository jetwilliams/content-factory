// Any server that speaks the common /chat/completions shape: hosted APIs, routers, or a local
// server. Free/local default: with CF_LLM_BASE_URL unset it talks to Ollama on this machine
// (http://127.0.0.1:11434/v1), so `ollama pull <model>` + CF_LLM_MODEL=<model> is enough.
//   CF_LLM_BASE_URL  e.g. https://api.example.com/v1 (hosted, bring your own key)
//   CF_LLM_API_KEY   (optional for local servers)
//   CF_LLM_MODEL     the model id your provider uses
import { env } from '../../lib/env.mjs';

export default {
  name: 'openai-compatible',
  paid: false, // free on a local server; hosted APIs bill per token: check your provider's pricing.
  canned: false,
  async complete({ system = '', prompt, maxTokens = 2000, temperature = 0.4 }) {
    const base = env('CF_LLM_BASE_URL', 'http://127.0.0.1:11434/v1');
    const model = env('CF_LLM_MODEL');
    if (!model) throw new Error('set CF_LLM_MODEL (and CF_LLM_BASE_URL for a hosted API). See .env.example');
    const headers = { 'content-type': 'application/json' };
    const key = env('CF_LLM_API_KEY');
    if (key) headers.authorization = `Bearer ${key}`;
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });
    const res = await fetch(`${base.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', headers, signal: AbortSignal.timeout(180000),
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
    });
    if (!res.ok) throw new Error(`LLM request failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('LLM reply had no message content');
    return text;
  },
};
