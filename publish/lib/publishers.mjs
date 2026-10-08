// Publisher selection. Publishers are adapters like every other provider: one file each in
// providers/publisher/<name>.mjs, selected by "providers.publisher" in config/factory.config.json
// (env CF_PUBLISHER overrides it). The default is "dry", which never posts.
//
// A publisher file default-exports { name, create(overrides?) }. create() returns a plain object:
//
//   name: string                       shown in logs
//   platforms: string[]                which of instagram / tiktok / youtube it can post to
//   dry?: true                         `run` only calls describe(), never publish()
//   ready() -> { ok, missing[] }       are the credentials present? (never return secret values)
//   describe(item, platform, { scheduledAt }) -> string[]
//                                      the exact request a live post would send, secrets REDACTED
//   publish(item, platform, record, { log, save, now }) -> Promise<{ postId?, permalink?, note? }>
//        Post now. `record` is this platform's entry in the queue file (item.results[platform]).
//        Store any provider ids on it and call save() BEFORE the network call, so that a crash or a
//        lost response can be resumed on the next run instead of posting twice. If the record already
//        holds ids from an earlier attempt, resume/poll those first.
//        Throw a PublishError (publish/lib/errors.mjs) with transient: true for errors worth retrying later.
//   schedule?(item, platform, record, { log, save }) -> Promise<{ jobId, note? }>
//        Optional: hand the post to the provider's own scheduler for item.at.
//   cancelScheduled?(item, platform, record, { log, save }) -> Promise<void>
//   metrics?(item, platform, record, { log }) -> Promise<object>
//        Optional: per-post numbers (views, likes, ...) for `stats`.
//
// To add one: copy providers/publisher/template.mjs, implement it, set "providers.publisher" to its name.
import { loadProvider } from '../../lib/providers.mjs';
import { publishSettings } from './settings.mjs';

export async function getPublisher(name = publishSettings().publisher, overrides) {
  const mod = await loadProvider('publisher', name);
  if (typeof mod.create !== 'function') throw new Error(`publisher/${name} must default-export { name, create() }`);
  return mod.create(overrides);
}
