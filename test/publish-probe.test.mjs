import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkVideo, fromFfprobe } from '../publish/lib/probe.mjs';

const base = { size: 5e6, ext: '.mp4', probed: true, hasVideo: true, hasAudio: true, duration: 20, width: 1080, height: 1920, fps: 30 };

test('a vertical 20 s mp4 passes everywhere', () => {
  for (const p of ['instagram', 'tiktok', 'youtube']) assert.deepEqual(checkVideo(base, p), { errors: [], warnings: [] });
});

test('duration limits', () => {
  assert.match(checkVideo({ ...base, duration: 2 }, 'instagram').errors[0], /shorter/);
  assert.match(checkVideo({ ...base, duration: 700 }, 'tiktok').errors[0], /longer/);
  const yt = checkVideo({ ...base, duration: 200 }, 'youtube');
  assert.deepEqual(yt.errors, []);
  assert.match(yt.warnings[0], /not a Short/);
});

test('landscape and odd aspect ratios are warnings', () => {
  assert.match(checkVideo({ ...base, width: 1920, height: 1080 }, 'instagram').warnings[0], /landscape/);
  assert.match(checkVideo({ ...base, width: 1080, height: 1350 }, 'tiktok').warnings[0], /not 9:16/);
});

test('container and size errors', () => {
  assert.match(checkVideo({ ...base, ext: '.webm' }, 'instagram').errors[0], /container/);
  assert.match(checkVideo({ ...base, size: 400e6 }, 'instagram').errors[0], /MB/);
});

test('without ffprobe only size and extension are checked, with a warning', () => {
  const r = checkVideo({ size: 1e6, ext: '.mp4', probed: false, probeError: 'ffprobe not found' }, 'tiktok');
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings[0], /ffprobe not found/);
});

test('fromFfprobe swaps width/height for rotated phone video', () => {
  const p = fromFfprobe({
    format: { duration: '12.5' },
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, r_frame_rate: '30/1', side_data_list: [{ rotation: -90 }] },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  });
  assert.equal(p.width, 1080);
  assert.equal(p.height, 1920);
  assert.equal(p.duration, 12.5);
  assert.equal(p.fps, 30);
});
