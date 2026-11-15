# Sunbeam Wood seam fix: progress log

Brief: no hairlines at any window size in morning, day and night, with the picture and motion
unchanged (encoding only). Originals are in out/pre-seam/ (made by the coordinator; never
overwrite). Size at most 128,000 chars raw and scrubbed. Edit only this folder. No commits,
nothing published. Scratch files in the shared scratchpad are prefixed `sunbeam-`.

## 2026-11-15, entry 1 (baseline)

Done:
- Read engine/README.md, _seamfix/STATUS.md (lessons 1-14), tide-line and harbor encoders/logs.
- out/pre-seam/ holds the three originals (identical to out/*.svg at the start).
- Baseline seamscan T=0 (max line px over the 11 sizes; holes 0 everywhere):
  morning 1012 (1440x900@2), day 958 (1440x900@2), night 968 (1440x900@2).
  Even 6 px a cell has lines: morning 34, day 64, night 3. Crops in out/seams/.

State: build.mjs untouched.

Next step: look at the crops, run seamwho at the worst sizes, copy tide-line's
encode-local.mjs into this folder and wire it into build.mjs (cellsOf), put pattern tile
corners on cell corners (y = b.y0 - 1.5, height b.y1 - b.y0 + 2).

## entry 2 (encoder wired in; night passes at T=0, all too big)

Done:
- encode-local.mjs: copy of tide-line's, plus `wide` (no row cap for chunks >= 120 cells
  across, after harbor) and `edge: true` as the default (backing and joined colours kept off
  outer-edge cells; fixed dark lines along light rims: plane-3 trunk rims, giantL right rim).
- build.mjs: cellsOf -> emitSafe(L, L.enc); tile corner y = b.y0 - 1.5, height + 2;
  underlay(): tide-line's vertical-neighbour rule, extended to rows with no band of their own
  (the floor's far edge: the first band's top edge leaked the haze, a line across the floor);
  `under` falls back to beneath() where a row has no band.
- beneath(parts): map of what lies under each pB cell (cells, glow/mist tints, the plane-3
  trunk backing; other pins, moving layers and shafts = unknown); each still run gets
  L.enc.under from it; glints and doe heads too. coats option in renderLayers (not used yet).
- TEMP in build.mjs (remove at the end): OLDENC=1 (pre-seam encoding for size comparisons),
  DUMP=dir (writes each drawn layer's cells). Scratch: sunbeam-try.mjs, sunbeam-near.mjs,
  sunbeam-lines.mjs (line pixels by pB cell, OUT= crop), sunbeam-tree.mjs.
- Build takes ~50 s a moment.

Scan T=0 night: max 37 (1440x900@1), all pass. Sizes: night 129,567 (~130,955 scrubbed).
Morning 137.6k / day 133.7k before edge (need <= ~126.9k raw so the scrub stays <= 128k).

Next step: rebuild morning and day, scan; then cut size (candidates: merge colours within
4-6 levels per layer, row cap off where purity allows, T up to 36 on the giants); then
moving parts (coats), skirts for glints/doe heads, T=37 scans.

## entry 3 (column chunks; all three pass at T=0 and fit)

Done:
- encode-local.mjs: `axis` (default 'both'): each colour is chunked in whole rows or in whole
  columns, whichever writes shorter; the row cap applies to columns the same way (a column
  chunk taller than 21 rows spans at most 21 columns). The giants' bark furrows are long
  vertical runs that the row cap cut every 21 rows: giantR 14.7k -> 11.0k, giantL 10.5k ->
  7.9k, blades group 20.2k -> 17.7k, p1/p2 -0.8/-0.6k. Purity at 6/8/9 px a cell unchanged
  (0 impure at 6 px; no cap at all gave 108 soft px at 6 px on giantR, so the cap stays).
- build.mjs: coats (2) for moving layers of class gs (fern tips) and sw (sprays) only; small
  sprites and mist need none (their edges meet nothing a coat would cover).
- Sizes: morning ~125.1k (+coats), day 122,067 (~122,736 scrubbed), night ~119.9k.

Scan T=0 (before coats): morning max 61, day 68, night 37; day with coats: max 35.

Next step: rebuild morning and night with coats; scan T=0 and T=37; then skirts for the
glints (over water) and doe heads; corner dots in the canopy (low-orbit change 2) if needed.

## entry 4 (edge rule relaxed for near colours; all rebuilt with coats)

Done:
- encode-local.mjs: the edge rule now skips a join to an outer-edge cell only when the two
  colours are more than T apart. The floor's far edge (last partial row over the first full
  one) skipped its join, so the haze showed through: morning T=37 1680x1050 had 59.
- All three rebuilt (coats on gs/sw). Sizes: morning 126,316 (~126,997 scrubbed), day 122,981
  (~123,656), night 120,992 (~122,037).

Scan (max line px over 11 sizes, holes 0, all ok):
  morning T=0 17, T=37 32; day T=0 34, T=37 50 (1440x900@1); night T=0 13, T=37 15.

Next step: find day T=37 lines (1440x900@1, 1680x1050@1) with sunbeam-lines.mjs; then skirts
for glints and doe heads; rare-event scans; pixeldiff; checks; cleanup TEMP code; notes.md.

## entry 5 (big tiles cut into bands: blur fixed)

Coordinator's check (from side-street): seamscan does not catch blur from big pattern tiles.
Found: the whole-picture tile (blades+flowers+under3+plane3, 323 x 204 cells) blurred every
cell at 8 and 9 px a cell (scratch sunbeam-tilepure.mjs draws each tile alone); at 10-12 px a
cell the p1/p2 tiles (47k cells) blurred too. Limit looks like ~4.2M device px (2048^2).

Done:
- build.mjs split(): a still tile over TILE_MAX (28,000 cells, clear cells included) is cut
  into bands of rows or columns; each band carries the next band's first line under it. The
  cuts are planned for few bands/colours/carried cells (two weightings, rows and columns), and
  the shortest written plan is kept: p1/p2 cut in columns between trunks (no cost), blades in
  2 row bands at about row 136 (+0.8k).
- encode-local.mjs: `around` option (other bands' cells count as inside for the edge rules).
- Sizes: morning 126,887 (~127,664 scrubbed; tight), day 123,878 (~124,667), night 121,861
  (~123,008). check.mjs ok.
- TEMP: TILE_MAX env override and SPLITLOG print in build.mjs (remove at the end).

Checks: tile purity 0 at 6/8/9 px for every tile (12 px: small counts on spray tiles etc.,
chunk soft corners; out of scope). Whole-picture purity with gradient overlays hidden (scratch
sunbeam-purity.mjs HIDEGRAD=1 TOL=9): 0 impure px at 6/8/9 px, all moments (pre-seam day:
53k/183k at 8/9 px). Scan max: morning T=0 22, T=37 35; day 34/50; night 16/18.

Next step: rare-event scans (leaf fall, butterfly, doe head swap, fireflies); skirts for
glints/doe heads only if those scans show lines (morning has ~330 chars of room); pixeldiff;
player-check; cleanup TEMP; notes.md.

## entry 6 (fern fronds coated; coats as <use>; all well under 60)

Done:
- Scan at T=2.8 (a leaf at half opacity; fern tips at rest) found the right fern's tips
  against their fronds: day 57 at 1680x1050. Fronds (fernL/R/M still layers) now get two
  coats too (coats for still runs in renderLayers, helper coat()); where a coated tip meets a
  coated frond, the roots beneath show by 1/16 at most. day T=2.8: 57 -> 14.
- coat(): a coated tile rect is written once with an id plus <use href> (saves ~35 a coat).
- split(): the plain greedy plan is a third candidate (p1/p2 a little shorter).
- Sizes: morning 126,700 (~127,476 scrubbed), day 123,699 (~124,481), night 121,762
  (~122,914).

Scan max line px (holes 0, all ok): T=0 morning 16, day 15, night 10; T=37 16 / 25 / 13;
T=2.8 11 / 14 / 18.

Next step: check shafts/motes edges (lesson 12) and glints/doe heads; rare-event scan at a
firefly time (night) and the deer swap; pixeldiff vs pre-seam; player-check x2; render.mjs and
look at a PNG; remove TEMP code (OLDENC/oldCells, DUMP, NOCAP, TILE_MAX env); notes.md.

## entry 7 (done: checks, cleanup, notes)

Done:
- Skirts: not needed. No line px at the glints, doe heads, shafts or motes at any of the 11
  sizes (scratch sunbeam-linesall.mjs sums line px by cell over all sizes).
- pixeldiff vs out/pre-seam (6 px a cell): morning 1,265, day 1,835, night 988 px, all on 1-px
  edges where the originals had soft/rounded edges (original night: 1,010 impure px at 6 px
  with gradients hidden; new: 0). DIFF images in out/seams/diff-<moment>-1920/1536.png.
- TEMP code removed from build.mjs (OLDENC/oldCells, DUMP, NOCAP, TILE_MAX env, SPLITLOG,
  BAND_T env, emitCells import). encode-local.mjs header lists all Sunbeam changes. Rebuilt:
  same sizes as before the cleanup.
- check.mjs ok. Final scans (max line px over 11 sizes, holes 0, all ok):
  T=0 morning 16, day 15, night 10; T=37 16 / 25 / 13; T=2.8 11 / 14 / 18.
- player-check: PLAYS for all three (quiet runs 1.2-1.8 ms; contended runs up to 5.62 ms in
  window 2 on 46 frames, once past the limit for morning; reruns 1.33-1.74 ms).
- render.mjs: out/sunbeam-wood-<moment>.png rewritten; morning PNG looked at, no lines.
- notes.md: Size and player check tables, Rules notes, "Encoding and hairlines" section (the
  old Seams section replaced), Open issues.

State: finished. Nothing left but the report.
