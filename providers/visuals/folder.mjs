// Your own footage or images. Set config.visuals.folder (absolute, or relative to the repo).
// Per beat: visual.file picks a file by name; otherwise visual.query words are matched against
// file names; otherwise files are used in order.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../lib/util.mjs';

const MEDIA = /\.(png|jpe?g|webp|mp4|mov|webm|m4v)$/i;

export default {
  name: 'folder',
  paid: false,
  async fetch(req, { config }) {
    const dirSetting = config.visuals?.folder;
    if (!dirSetting) throw new Error('set config.visuals.folder to use your own footage');
    const dir = path.resolve(ROOT, dirSetting);
    const files = fs.readdirSync(dir).filter((f) => MEDIA.test(f)).sort();
    if (!files.length) throw new Error(`no images or videos in ${dirSetting}`);
    let pick = req.file && files.find((f) => f === req.file || f.startsWith(req.file));
    if (!pick && req.query) {
      const words = req.query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
      let best = 0;
      for (const f of files) {
        const score = words.filter((w) => f.toLowerCase().includes(w)).length;
        if (score > best) { best = score; pick = f; }
      }
    }
    pick = pick || files[req.index % files.length];
    return { file: path.join(dir, pick), credit: 'own footage', licence: 'yours' };
  },
};
