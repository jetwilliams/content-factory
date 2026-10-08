// The dry visuals adapter (script source "placeholder"): a flat coloured card with a stripe and a label, drawn by ffmpeg.
// Free, offline, and obviously a placeholder, so nobody mistakes it for a finished asset.
import fs from 'node:fs';
import path from 'node:path';
import { runCmd } from '../../lib/ffmpeg.mjs';
import { renderText, wrapText } from '../../lib/pixelfont.mjs';

const PALETTE = ['0x2E4057', '0x048A81', '0x54428E', '0x8C2F39', '0x3D5A80', '0x5C7457', '0x6B4E71', '0x33658A'];

export default {
  name: 'dry',
  paid: false,
  async fetch(req, { outBase }) {
    const colour = PALETTE[req.index % PALETTE.length];
    const out = `${outBase}.png`;
    const labelFile = `${outBase}.label.png`;
    const label = wrapText(req.label || req.segmentId, 14, 3);
    fs.writeFileSync(labelFile, renderText(label, { scale: 5, colour: '#FFFFFFB0' }).png);
    await runCmd('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=${colour}:s=540x960`,
      '-i', labelFile,
      '-filter_complex', '[0:v]drawbox=x=0:y=ih*0.62:w=iw:h=ih*0.08:color=white@0.12:t=fill[bg];[bg][1:v]overlay=(W-w)/2:H*0.40',
      '-frames:v', '1', out,
    ]);
    fs.rmSync(labelFile, { force: true });
    return { file: path.basename(out), credit: 'placeholder', licence: 'generated (no licence needed)' };
  },
};
