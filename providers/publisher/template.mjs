// Starting point for a new publisher. Copy this file to providers/publisher/my-provider.mjs, fill in the
// TODOs, change the default export's name, then select it in config/factory.config.json:
//
//   "providers": { ..., "publisher": "my-provider" }
//
// (or CF_PUBLISHER=my-provider for one run). The interface is documented at the top of
// publish/lib/publishers.mjs and in docs/providers.md. Keys go in .env, never in config.
import crypto from 'node:crypto';
import { get } from '../../publish/lib/settings.mjs';
import { PublishError } from '../../publish/lib/errors.mjs';

export function createTemplatePublisher() {
  const key = () => get('MY_PROVIDER_API_KEY');

  return {
    name: 'template',
    platforms: ['instagram', 'tiktok', 'youtube'],

    ready() {
      return key() ? { ok: true, missing: [] } : { ok: false, missing: ['MY_PROVIDER_API_KEY'] };
    },

    describe(item, platform) {
      // Print the request with the key replaced by [REDACTED]. Never print the real value.
      return [`POST https://api.example.com/v1/posts`, '  Authorization: Bearer [REDACTED]', `  platform=${platform}`, `  caption=${JSON.stringify(item.captionText)}`];
    },

    async publish(item, platform, record, { save }) {
      if (!key()) throw new PublishError('MY_PROVIDER_API_KEY is not set');
      // 1. Resume: if an earlier attempt saved an id, ask the provider what happened to it first.
      if (record.requestId) {
        // TODO: GET the status for record.requestId; if it was posted, return it instead of re-posting.
      }
      // 2. Save an idempotency id before sending anything.
      record.requestId ||= crypto.randomUUID();
      save();
      // 3. TODO: upload item.file with item.captionText, sending record.requestId as the idempotency key.
      //    Map 429/5xx/timeouts to new PublishError(msg, { transient: true }).
      throw new PublishError('template publisher: not implemented');
    },
  };
}

export default { name: 'template', paid: true, create: () => createTemplatePublisher() };
