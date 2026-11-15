# Deep Reef hairline fix: progress log

## 2026-11-15, entry 1

**Done**
- `out/pre-seam/` holds the original (`deep-reef.svg`, `build.mjs.orig`).
- `encode.mjs`: a local copy of `engine/encode.mjs`, with a `lift` option (see its header) and now a `maxRows` option (env `MAX_ROWS`, default no cap) that limits how many rows one path spans.
- `build.mjs`:
  - every layer goes through `emitSafe`;
  - `mergeNear` merges colours within 6 levels (mean channel; env `MERGE`);
  - `cull` keeps a colour-matched margin under upper layers' edges;
  - surface tiles have clear edge rows, and the near tile uses `lift`;
  - the caustics clip is gone (row 179 now shows whole);
  - the upper moving layers are drawn more than once: glow ×3 via `<use>`, caustics ×2, every kelp band ×2.
- Checks passed on the build without a row cap (120,526 chars, 122,136 by the scrub estimate):
  - seamscan at T=0, 37 and 50: all 11 sizes ok, worst 55 (1278x719 at T=37);
  - pixeldiff: changes are merges (≤18 summed), 1-px edges, and the top half of caustic row 179;
  - runs ≤64, no `"`, 0.05 s clock;
  - player-check PLAYS, 2.29–2.51 ms (the original reads 2.33 ms at the same time);
  - render.mjs PNG looked at: fine.

**In progress: tip 3 from the coordinator (soft corners from a path's box)**
- At 8 and 9 px/cell, the line pixels (42 and 47) are rounded kelp-rim corners. Capping paths at 19 rows takes both to 0, but the size goes to 127,382 raw and 130,732 by the scrub estimate, which is over the 128,000 limit.
- **State:** `out/deep-reef.svg` is currently the 19-row test build. Running `node build.mjs` (no env) restores the 120,526 build.

**Next step**
- Cap a path only when its box is square-ish, i.e. both its rows and its column span are over about 21 cells. Check the size, then rerun seamscan at T=0, 37 and 50.
- After that:
  - re-check tips 1 (backing on outer edges and corners), 2 (tile corners on the grid: already on the grid) and 4;
  - rerun pixeldiff, the checks and player-check;
  - write the "Encoding and hairlines" section in notes.md;
  - report.

## 2026-11-15, entry 2

**Done**
- Tip 3 (soft corners): `encode.mjs` now caps square-ish paths (MAX_ROWS = 21; a path past 21 rows grows only while its box is at most 21 cells wide). At 8 and 9 px/cell the kelp lines went 42/47 -> 0.
- Water tile (tip 2 and a bitmap-size problem): in `build.mjs` water(), the tile now sits on the cell grid (OY 40.5) and is only 336 cells wide (WX 8), down from 1,120. The wide tile had been drawn as a scaled bitmap, which made the dither cells soft at 6, 8 and 9 px/cell. pixeldiff shows the change only as 1-px rings at the dither cells' edges.
- `out/deep-reef.svg` is the current build: 123,851 chars raw, 126,343 by the scrub estimate.

**Found, left as is (original art)**
- The solid water bands are written half a cell above the dither rows. In the last dither row of each band, the gap cells are therefore half the colour above and half the colour below. Fixing it would change those half cells by 4 to 11 levels, so it stays.

**Next step**
- Run the full seamscan at T=0, 37 and 50 on this build.
- Then try tip 1 (backing kept off outer-edge cells; corner blocks) as an experiment; keep it only if it lowers line counts within the size budget (128,000 by the scrub estimate).
- Then pixeldiff against pre-seam, the checks, player-check, render, notes.md, and the report.

## 2026-11-15, entry 3

**Done**
- seamscan of the current build (123,851 chars): every size passes at all three times.
  - T=0: 0, 38, 0, 19, 22, 0, 24, 0, 0, 44, 32;
  - T=37: worst 55 (1278x719);
  - T=50: worst 47.
- Tip 1 (Low Orbit's outer-edge backing and corner blocks) was tried in `encode.mjs` and dropped. It cost about 900 chars, and line counts were mixed: T=0 went 38/19/22/24/44/32 -> 33/21/24/27/53/26. The encoder is back to entry 2's version, and the build is unchanged.
- Tip 4 (abutting layers): already handled. The near and far surface tiles use `lift` plus a carried row, the water bands overlap by a cell, and the kelp bands are drawn twice.

**Next step**
- pixeldiff against `out/pre-seam/` (DIFF image), the scene checks, player-check, and the render PNG.
- Then the "Encoding and hairlines" section in notes.md, the Size/Rules updates, and the report.

## 2026-11-15, entry 4 (finished)

**Done**
- pixeldiff against `out/pre-seam/` (`out/pre-seam/diff-1920.png`): the changes are merges (at most 18 summed), 1-px rings at the water dither cells, 1-px edges, and the top half of caustic row 179.
- Scene checks pass: runs ≤64, no `"`, the 0.05 s clock, and `url()`/`href` all `#id`.
- player-check: PLAYS, 2.06 / 1.88 ms on the rerun (the first run read 2.78 / 2.14).
- render.mjs: `out/deep-reef.png` looked at; it is fine.
- notes.md now has the "Encoding and hairlines" section, and its Size and Rules sections are updated.
- build.mjs has comments at every fix.

**State**
- `out/deep-reef.svg` = `node build.mjs`: 123,851 chars raw, 126,343 by the scrub estimate.
- Nothing is committed or published.

**Next step**
- None. The report goes to the coordinator.
