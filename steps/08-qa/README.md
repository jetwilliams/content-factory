# Step 8 · qa

Automatic checks on the finished MP4. Writes `qa.json`.

| Skill card | |
|---|---|
| **Input** | `<slug>.mp4`, `render.json`, `script.json`, `visuals.json`, `music.json` |
| **Output** | `qa.json`: `pass`, counts, and every check with `ok` / `fail` / `warn` / `info` |
| **Run** | `node steps/08-qa/run.mjs <slug>` |
| **Cost** | free |
| **Done when** | `pass` is true and a human has read every `warn` |

| Check | Level if it fails |
|---|---|
| video + audio streams present | fail |
| resolution matches the template, exact 9:16 | fail |
| duration within `config.qa.minDurationSec`..`maxDurationSec` | fail |
| duration matches the voice track | warn |
| integrated loudness within `loudnessToleranceLu` of the target (ffmpeg `ebur128`) | warn |
| true peak under the template limit | warn |
| title and caption boxes inside the safe area | fail (watermark: warn) |
| `script.json` `factCheck.status` is `"checked"` | warn (info in dry runs) |
| AI-content label reminder, music licence | info (warn if the licence is unknown) |

In `ffmpeg` text mode, box sizes are estimated from font size (marked `estimated`). Look at the video anyway:
QA catches mechanical problems, not wrong facts or bad taste.
