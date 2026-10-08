// Free, local, default captioner. Uses word timings from the TTS engine when it provided them,
// otherwise spreads each segment's words across its time span, weighted by word length.
import { wordTimings } from '../../lib/captions-core.mjs';

export default {
  name: 'even-split',
  paid: false,
  async words({ voice }) {
    return wordTimings(voice.segments);
  },
};
