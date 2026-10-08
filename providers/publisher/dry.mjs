import path from 'node:path';

// The "dry" publisher: sends nothing, changes nothing. It is the default until you change
// "providers.publisher" in config/factory.config.json (or set CF_PUBLISHER), so a fresh install can never
// post by accident. `run` with this publisher only prints what it would do.
export function createDryPublisher() {
  return {
    name: 'dry',
    dry: true,
    platforms: ['instagram', 'tiktok', 'youtube'],
    ready: () => ({ ok: true, missing: [] }),
    describe(item, platform, { scheduledAt } = {}) {
      return [
        `[dry] would post ${path.basename(item.file)} to ${platform}${scheduledAt ? ` scheduled for ${scheduledAt}` : ''}`,
        `[dry] caption: ${JSON.stringify(item.captionText)}`,
        '[dry] set providers.publisher to "upload-post" (or your own adapter) in config/factory.config.json to post for real',
      ];
    },
    async publish() {
      throw new Error('the dry publisher never posts');
    },
  };
}

export default { name: 'dry', paid: false, create: () => createDryPublisher() };
