# Hill Village seam fix: progress log

Brief: no 1-px lines between cells at any window size (the 11 sizes of engine/seamscan.mjs), in
sunrise, day and night, at T=0, T=37 and one rare-event time; picture, light and motion
unchanged; at most 128,000 characters; edit only this folder; no commits. Originals are in
out/pre-seam/ (made by the coordinator; do not overwrite).

## 2026-11-15, entry 1: start

Done: read engine/README.md, _seamfix/STATUS.md (lessons 1-14), tide-line and harbor local
encoders. The scene's own encoder is encode.mjs (Sunfield emitCells + MERGE, joined paths,
TUCK, peek erosion, skirts, seamfix.json pairs for 3 sizes).

State: build.mjs, encode.mjs, seamfix.json as at the end of the art rounds (night halo done).

Next step: baseline seamscan (SAVE=out/seams) of out/hill-village-{sunrise,day,night}.svg at
T=0 and T=37.

## Entry 2: baseline and the encoder switch

Baseline (pre-seam, T=0), max line px over the 11 sizes: sunrise 253 (1200x780@1.25, FAIL),
day 72 (FAIL at 1366, 1680, 1200x780), night 46.

Done:
- encode-local.mjs: copy of tide-line/encode-local.mjs (header to fix).
- encode.mjs: cellsOf is now emitSafe (SAFE from build.mjs, { T: 28 }); peek, skirt and
  seamfix.json machinery removed; cull keeps a 1-cell margin (ERODE on by default); moving
  layers in two coats (<g id> + <use>, COATS=1 turns off). build.mjs passes SAFE, no baseAt/fixes.
  Backups of the old encode.mjs/build.mjs/seamfix.json in the scratchpad (village-*-before).
- Sizes raw / scrub: sunrise 126,359 / 128,164 (over), day 116,018 / 117,229, night 115,135 / 116,254.
- Scan T=0: sunrise max 177 (1680x1050, also 174 at 1366, 140 at 1278: FAIL), day max 19,
  night max 55.

Next step: seamwho sunrise at 1680x1050@1; cut sunrise size under 128,000 scrubbed.

## Entry 3: edge, rings, patterns

Scans (T=0, max line px over the 11 sizes):
- EDGE=anim (no backing or under-colour under the outer cells of moving layers): sunrise 71,
  day 19, night 56. EDGE=all (every layer): sunrise 69, day 91, night 42. The cloud rims were
  the 177 at 1680 (lesson 1); EDGE on still layers costs day a lot (joins under outer cells off).
- RING (lesson 4, a hidden 1-cell ring of the lower layer under the upper one, every colour):
  no change (sunrise 68-72). Off again (RING=0), kept as an option in encode.mjs.
- Patterns drawn in place (scratch test): 1680 sunrise 68 -> 21, but player-check STILL
  (8.4 ms a frame). Patterns stay.
- Cause found at 1680 (lamp top edge, cell 161,151): the merged layer's backing (commonest
  colour) leaks along its outer edge inside the resampled tile. New mode edge:'back' in
  encode-local.mjs: the backing stays off outer cells, joins stay (still layers); moving layers
  keep the full edge. EDGE=back is now the default.

Tools (scratchpad): village-scan.sh (one line per moment), village-full.mjs (every line pixel,
with cells; PX=1), village-unpattern.mjs, village-tree.mjs; encode.mjs debug envs CELLS and PATS.

Next step: scan the EDGE=back build (sunrise 127,181 / 129,016 scrubbed: still over).

## Entry 4: the near edge and fixed layers

- EDGE=back scan: sunrise 74, day 19, night 193 (worse). Dropped.
- Cause at 1680 sunrise, found with village-cellpaths.mjs: in pattern l (bridgeEnd+near+lamps)
  the lamp light #ffda93 was joined under the lamp's dark outer cell (161,152); the tile bitmap
  lands at a 0.5 px offset, so the yellow leaked above the lamp head as a light line.
- New edge mode 'near' (encode-local.mjs): backing off outer cells far from it, and a colour
  joined under an outer cell only when within T of it. Default for still layers (EDGE=near);
  moving layers keep the full edge. Sizes: sunrise 125,523 / 127,328, day 115,074 / 116,279,
  night 114,757 / 115,876. Scan T=0: sunrise 33, day 19, night 43.
- Night 43 at 1536x864@1: light outlines round the mirror cells that cover glints (the glint
  under the same cell traced its edges). Layers that only fade in place (classes gl, lb, tk,
  ta, tb; FIXED env) now drop the cells a still layer above covers. Night 1536@1: 26, 1200: 26.
  Sizes: sunrise 125,375 / 127,174, day 114,926 / 116,125, night 114,266 / 115,343.
- RING default is now '0' (same-colour tuck only, as before).

Rare-event time chosen: T=12 (the cart is on the bridge in all three moments, birds are over
the sky at sunrise and day).

Next step: full scans T=0, T=37, T=12; then pixeldiff, check.mjs, player-check.

## Entry 5: checks and cleanup (done)

Scans, max line px over the 11 sizes, no holes anywhere:
- T=0: sunrise 33 (1366x768@1), day 19 (1680x1050@1), night 26 (1536x864@1, 1200x780@1.25).
- T=37: sunrise 33, day 19, night 28.
- T=12 (cart on the bridge in all three, birds out at sunrise and day): sunrise 34, day 19, night 29.

pixeldiff against out/pre-seam/ (1920x1080 and 1536x864@1.25): day 0 px; sunrise one cell
(74,144) back to its painted colour (an old seamfix.json pair had drawn its neighbour's colour
there); night 112 single corner pixels along the river banks, at most 6 levels.

check.mjs ok (runs <= 64, clock, quotes). Sizes raw / scrub: sunrise 125,375 / 127,174, day
114,926 / 116,125, night 114,266 / 115,343. player-check PLAYS: sunrise 2.03 ms, day 1.97 ms,
night 1.85 ms (window 2; limit 5.56). Full PNGs viewed: picture and lamp halo as before.

Cleanup: old Sunfield run writer removed from encode.mjs (output byte-identical), backErode /
noBack flags removed from build.mjs, the FIX writer removed from seams.mjs, seamfix.json
deleted (copy in the scratchpad as village-seamfix-before.json). encode-local.mjs header names
the Hill Village changes. notes.md has "Encoding and hairlines".

Next step: none; report sent.
