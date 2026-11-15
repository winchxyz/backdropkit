# Harbor seam fix: progress log

Brief: no hairlines at any window size in day, sunset and night, picture unchanged; at most 128,000
characters raw and by the scrub estimate; edit only this folder; no commits. Originals are in
out/pre-seam/ (copied before any change).

## 2026-11-15, entry 1 (state after the first fix pass)

Done:
- build.mjs writes every cell layer with emitSafe (import at the top of build.mjs, used in draw()).
  Still layers of 55+ runs still go into pattern tiles; groups and motion are unchanged.
- Causes found and fixed so far:
  - colour edges inside a layer (emitCells): emitSafe;
  - pattern tiles: content kept off the tile edges (1-cell clear margin);
  - boat hull against its reflection: tuckUnder() carries the reflection a row under the hull;
  - glint and wave groups that twinkle separately but touch: twinkleGroups() moves touching
    near-coloured cells into one group (union-find); this changes which group about 70-165 cells
    belong to, so a few glint/wave cells differ at time 0 (to report);
  - waves meeting the sheen: tuckWaves() (day, sunset);
  - water cells under boat reflections that fringe in one bob state: syncWithBoats() splits them
    into rh/rs layers synced to the bob (new CSS rules rh, rs, steps(1));
  - cull() keeps a hidden 1-cell rim under upper still layers;
  - size: REFL_MERGE 6 (day reflections), TOWN_T 36 (day town).
- seamscan passes at T = 0, 5, 13, 37, 61, 100, 133. Max line px: day ~54 (1440x900@2),
  sunset ~51, night ~49 (1278x719@1.25).
- Sizes raw / scrub: day 126,478 / 125,519; sunset 118,424 / 117,351; night 111,935 / 106,390.

State:
- build.mjs: working, builds all three moments. Still contains unused bleedUnder/bleedSvg code,
  a DBG_CELL debug block and DBG_SIZE output (to remove). LIMIT is 131072 (add the 128,000 aim).
- out/harbor-*.svg: from the latest build. out/pre-seam/: the originals, do not overwrite.
- harbor/encode-local.mjs: just copied from low-orbit/encode-local.mjs, not yet imported.

Next step (coordinator tips from low-orbit):
1. draw(): put the pattern tile corner on a cell corner: y = b.y0 - 1.5 (cell corners are at
   half-integer y), height = b.y1 - b.y0 + 2, so one clear cell all round.
2. Import emitSafe from ./encode-local.mjs (outer-edge backing, 4-colour corners, MAX_ROWS 19)
   and fix its header to say it is harbor's copy.
3. Rebuild, rescan T=0/37/100, check sizes <= 128,000.
4. Then: pixeldiff vs out/pre-seam (DIFF png, look), runs/quotes/clock checks, player-check,
   render.mjs PNG, notes.md "Encoding and hairlines" section, report.

## 2026-11-15, entry 2 (coordinator tips applied)

Done:
- draw(): pattern tile corner now on a cell corner: rect y = b.y0 - 1.5, height = b.y1 - b.y0 + 2
  (one clear cell all round). The old y = b.y0 - 2 blurred every row edge at 9 px a cell
  (pre-seam day: 26,571 impure cells at 1440x900@2; now 654, the same as the non-cell art).
- build.mjs imports emitSafe from ./encode-local.mjs (low-orbit's copy + harbor change 4:
  the 19-row cap is skipped for chunks >= 120 cells across; option `wide`, build passes 120).
  Purity test (scratchpad purity.mjs) on day: same as the plain cap at 4-9 px a cell.
- Removed: bleedUnder, bleedSvg, nn/pr, DBG_CELL, DBG_SIZE. SIZES=1 now lists emitSafe output
  length per drawn layer. emitCells import dropped. Build prints the 128,000 aim.
- build.mjs line endings became LF (Git Bash sed); it was CRLF. Convert back at the end.
- Sizes raw / scrub: day 127,901 / 127,434; sunset 123,501 / 122,890; night 116,780 / 111,715.
- seamscan T=0: all pass. Max lines day 23 (1440x900@1), sunset 51 (1440x900@1),
  night 28 (1536x864@1); 0 at 8 and 9 px a cell; night has 6 at 6 px a cell (to check).

State: build.mjs and encode-local.mjs working; out/*.svg from this build.

Next step: check night's 6 lines at 6 px a cell and sunset's 51; scan T=37 and T=100; then
pixeldiff, checks, player-check, render, notes.md, report.

## 2026-11-15, entry 3 (Deep Reef tips measured, encoder settled)

Done:
- encode-local.mjs: harbor options `narrow` (no row cap for chunks <= 21 cells across), `wide`
  (none for >= 120) and `edge` (false turns Low Orbit's change 1 off). build.mjs SAFE =
  { T: 28, maxRows: 19, narrow: 21, wide: 120, edge: false }. Purity at 4-9 px a cell equals
  the plain 19-row cap in all moments. Change 1 cost 1.7-3k and scanned no better: off.
- Tiles: widest is 327 cells (< 340). Cull keeps a 1-cell rim. Tile edge rows are clear.
- Sizes raw / scrub: day 125,381 / 124,740; sunset 119,996 / 119,235; night 113,025 / 107,738.
- seamscan, holes 0 everywhere, max line px over the 11 sizes:
  T=0   day 21, sunset 47, night 36
  T=37  day 18, sunset 50, night 29 (perched gull's head turned)
  T=50  day 21, sunset 47, night 46 (night: lamp flare, beam facing the viewer)
  T=100 day 16, sunset 41, night 26
  Night's 6 px at whole-pixel sizes is one 1-px sky column (cell 173,50); pre-seam has 6 too.

State: build.mjs, encode-local.mjs final unless pixeldiff shows a problem; out/*.svg current.

Next step: pixeldiff each moment vs out/pre-seam (DIFF png, look at it); then runs/quotes/clock
checks, player-check x3, render.mjs, notes.md section, LF->CRLF for build.mjs, report.

## 2026-11-15, entry 4 (motion and colours restored, Moon Keep tips)

Done:
- pixeldiff showed day's REFL_MERGE 6 changed 1,281 reflection cells by 16 levels in one
  channel, and the wave/glint regrouping changed twinkle timing. Fixed:
  - REFL_MERGE, mergeNear and TOWN_T removed (no colour merges left anywhere).
  - Wave lines keep their original groups; each wave group is drawn 3 times via <use>
    (repeat() in build.mjs, layer.reps). Glints still regrouped (TW_REGROUP default 'gl'):
    glints with reps instead left 66 line px at sunset 1680x1050.
  - Size: day's town layer may be encoded largest-first (AREA_OK, after Moon Keep's order
    'both'): saves ~4k. On all layers 'area' added lines (sunset 1200x780: 27 -> 63).
- Sizes raw / scrub: day 126,912 / 126,671; sunset 120,796 / 120,140; night 113,748 / 108,561.
- Copies of these outputs: scratchpad/harbor-final1/. Scratch tools now named harbor-*.mjs
  (scratchpad is shared).

Next step: seamscan T=0/37/50/100 on all three; cellcmp/pixeldiff vs pre-seam (expect only
glint cells + edge-only changes); then runs/quotes/clock checks, player-check, render, notes.md,
CRLF for build.mjs, report.

## 2026-11-15, entry 5 (finished)

Done:
- Wave groups drawn twice (TW_REPS default 2): scans same as 3 draws, frame time back to the
  original's level. Glints regrouped (only remaining motion change; in notes.md).
- Final sizes raw / scrub: day 126,852 / 126,611; sunset 120,733 / 120,077;
  night 113,688 / 108,501.
- seamscan T=0/37/50/100, holes 0, max line px: day 30, sunset 51, night 44 (before: 3,362 /
  2,643 / 167 at T=0).
- pixeldiff vs pre-seam: day 3,984 px, sunset 9,185, night 1,157; regrouped glint cells plus
  edge pixels of parts between cells at time 0 (clouds, gulls, smoke) and removed hairlines.
  Images: out/seams/diff-*.png, cells-*.png (yellow <= 6 levels, magenta > 6, cyan edge only).
- Rule checks (scratchpad harbor-rules.mjs): runs <= 64, single quotes, 0.05 s clock, hrefs ok.
- player-check: all PLAYS (day 1.05/1.29, sunset 1.28/1.05, night 1.18/1.18 ms).
- render.mjs run; out/harbor-*.png current. notes.md has "Encoding and hairlines".
- build.mjs back to CRLF. Moon Keep's lips and bridge were not adopted (sizes fit without them);
  tiles already have clear rows above and below on the rect's own rows.

Next step: none; report sent to the coordinator.
