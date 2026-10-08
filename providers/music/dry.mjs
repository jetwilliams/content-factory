// The dry music adapter: a quiet four-chord sine pad, synthesised in plain JavaScript. Original to this project (MIT).
// Good enough to hear the ducking work; replace it with real music before publishing.
import { padBed, writeWav } from '../../lib/wav.mjs';

export default {
  name: 'dry',
  paid: false,
  async make({ seconds, outFile }) {
    writeWav(outFile, padBed(seconds), 44100);
    return { file: outFile, source: 'placeholder pad (generated)', licence: 'MIT (this project)' };
  },
};
