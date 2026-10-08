// Any royalty-free or self-made audio file: set config.music.file (and config.music.licence so the
// licence travels with the job). Converted to WAV by ffmpeg; the render loops it if it is short.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../lib/util.mjs';
import { runCmd } from '../../lib/ffmpeg.mjs';

export default {
  name: 'file',
  paid: false,
  async make({ outFile, config }) {
    const src = config.music?.file && path.resolve(ROOT, config.music.file);
    if (!src || !fs.existsSync(src)) throw new Error('set config.music.file to an audio file you have the rights to use');
    await runCmd('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', outFile]);
    return { file: outFile, source: path.basename(src), licence: config.music?.licence || 'UNKNOWN: record the licence in config.music.licence' };
  },
};
