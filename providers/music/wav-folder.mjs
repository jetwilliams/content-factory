// A folder of your own or royalty-free tracks (WAV/MP3/FLAC/OGG). Set config.music.folder.
// Picks config.music.track by name if set, otherwise a track chosen from the job slug (stable per job).
// Put a LICENCE.txt (or LICENSE.txt) in the folder; its first line is recorded with the job.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../lib/util.mjs';
import { runCmd } from '../../lib/ffmpeg.mjs';

export default {
  name: 'wav-folder',
  paid: false,
  async make({ outFile, config, slug = '' }) {
    if (!config.music?.folder) throw new Error('set config.music.folder');
    const dir = path.resolve(ROOT, config.music.folder);
    const tracks = fs.readdirSync(dir).filter((f) => /\.(wav|mp3|flac|ogg|m4a)$/i.test(f)).sort();
    if (!tracks.length) throw new Error(`no audio files in ${config.music.folder}`);
    let pick = config.music.track && tracks.find((t) => t.startsWith(config.music.track));
    if (!pick) pick = tracks[[...slug].reduce((a, c) => a + c.charCodeAt(0), 0) % tracks.length];
    await runCmd('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(dir, pick), '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', outFile]);
    const licFile = ['LICENCE.txt', 'LICENSE.txt'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
    const licence = config.music.licence || (licFile ? fs.readFileSync(licFile, 'utf8').split('\n')[0].trim() : 'UNKNOWN: add LICENCE.txt to the folder');
    return { file: outFile, source: pick, licence };
  },
};
