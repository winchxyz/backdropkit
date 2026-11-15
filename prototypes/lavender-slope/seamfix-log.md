# Lavender Slope seam fix: progress log

Brief: no hairlines at any window size in day, sunset and night, with the round-3 picture, light
and motion unchanged (encoding only). The originals are in out/pre-seam/ (made by the
coordinator; do not overwrite). Size at most 128,000 chars raw and scrubbed. Edit only this
folder; scratchpad files are prefixed `lavender-`. No commits, nothing published.

Scratchpad: <scratchpad>/
- lavender-build-round3.mjs, lavender-encode-round3.mjs, lavender-moments-round3.mjs: the
  round-3 sources before the seam fix.

## Entry 1: start

Done:
- Read engine/README.md, _seamfix/STATUS.md (lessons 1-14), tide-line and harbor encode-local
  headers.
- Checked out/pre-seam/*.svg are byte-identical to the round-3 out/*.svg (md5).

Next step: baseline seamscan of out/pre-seam/*.svg at T=0 with SAVE=out/seams/pre, then seamwho
at the worst sizes.

## Entry 2: encoder in, field fixes in progress

Done:
- Baseline (out/pre-seam, T=0): every size fails, also the whole-pixel ones (6 px/cell: day 1130,
  sunset 688, night 570 line px). Cause there: runs stroked 1.1 cells high (stroke-width='1.1'
  on the views and defs) tinted the last pixel row of the cell above. Crops in out/seams/pre/.
- encode-local.mjs: copy of tide-line's, plus L1 tones for tile paints (setTone), L2 optional
  corners, L3 joins only where the band beneath is far. Temporary env hooks LAV_X and LAV_T are
  in emitSafe (remove before finishing).
- encode.mjs rewritten: emitSafe for every cell layer, stroke-width 1, pattern corners on cell
  corners (y0 - 1.5), tide-line underlay (rest neighbours, under, BAND_T 20), coats, and
  drawWithBands (the field's bands and cells in one pattern tile). Temporary LAV_DUMP hook.
- build.mjs: tile spikes encoded with emitSafe; hedge tiles at y='-1' (same phase as round 3
  inside the field tile); field as an underlay layer (inTile, encT 28); repaint(field) (cells
  that show the same colour under the row's band or the left neighbour's paint take it);
  unbleed(field) (a tile cell beside an alike cell whose hidden texel would bleed is painted
  plain); spike layers in two coats.
- Found: a tile-painted run is shaded at each edge pixel with the texel at the pixel centre,
  which may be the hidden texel of the next cell (bleed). That made most field lines.

State (T=0, fractional sizes; whole-pixel sizes all 0):
- day 119,011 chars: 171-248 line px.
- sunset 137,753: 57-91.
- night 134,640: 84-248.
- Over 128k: sunset and night. Pixeldiff (sunset) shows 1-px edges only so far.

Next step: find day's and night's remaining sources (scratchpad lavender-linemap.mjs,
lavender-cells.mjs; seamwho), then cut size (merges within 4-6 levels, T).

## Entry 3: piece packing (L5), whole-pixel sizes clean

Done:
- encode-local.mjs L5: a colour's cells are split into 4-connected pieces and whole pieces are
  packed into paths (no joins between them); a piece over 64 runs, or whose box is over 21 rows
  both ways, is cut into rows as before (rowChunks, with joins). This cut the join cost (sunset
  about -10k). A first version let packed boxes run over 21 rows when 120+ cells wide, and
  single pieces past the cap: that brought back soft corners at 6 px/cell (day 51 line px);
  removed.
- Spike layers at COATS=3 for this run (build.mjs default still 2; decide later).

State (T=0): every whole-pixel size 0. Fractional sizes:
- day 114,664 chars: 82-169 line px, holes up to 15.
- sunset 132,117 (over): 26-131, holes up to 19.
- night 128,159 (over): 38-129, holes up to 22.

Next step: linemap the worst fractional sizes (1440x900@1, 1366x768@1) per moment, sort the
causes (field texture bleed, spikes over the field, holes), then cut size.

## Entry 4: causes sorted, field fixes (day only so far)

Done (all temporary switches still on the command line: LAV_FIELDG=1 COATS=3):
- Holes were the crown: a moving layer drawn as a pattern tile is rastered into a cached bitmap,
  and Chromium drew it a fraction of a pixel apart between two renders. Every moving layer is
  now plain runs (encode.mjs; also 2.4-2.7k shorter). Holes 0 everywhere.
- Found: every pattern tile is a bitmap resampled at fractional sizes (tile corner off the pixel
  grid, tile size rounded up), so a tile's hidden content bleeds into the edge pixels of what
  shows. The purity test (scratchpad lavender-purity.mjs, xMidYMax copy of street-purity) is 0
  at 6, 8 and 9 px a cell for the current SVGs (round 3 had 136k-370k impure px from the 1.1
  strokes).
- LAV_FIELDG: the field is a translated group, not a pattern tile (removes the half-pixel blur
  that let field cells under the spike tips bleed into the visible cells; -70 chars).
- Band dashes are two rows tall (one row tall, their edge lay on the next band's edge).
- A field row with no band (the top row) keeps the band cell below it where alike.
- encode-local L6/L7: a colour is not laid under a cell where it would show along that cell's
  other edges (outside: band cells, `shown`; inside: edges no later colour covers), when the
  join it covered does not then show a line.
- unbleed sees the spike tips at rest.

State, day only (T=0): 1536@1 95, 1440@1 73, 1366@1 86, 1680@1 110 line px; 112,439 chars.

Next step: classify day's remaining lines (scratchpad lavender-classify.mjs, lavender-cells3.mjs
with LAV_DUMP and LAV_TEX), then build sunset and night with the same switches and scan.

## Entry 5: near colours merged, leaks weighed; most sizes pass

Done (switches still on the command line: MERGE=4 SAME_T=14 LAV_FIELDG=1 COATS=3):
- encode.mjs MERGE: within a layer, a colour within 4 levels (every channel) of a commoner one
  takes it (sunset -6.3k).
- The band-cell restore checks both bands meeting at the edge. Side texels (LAT_T) tried and
  dropped (default 999): more joins, more lines in day.
- encode-local L6 (one pass, replaces L6/L7 of entry 4): a colour laid under a cell is taken
  back out where what it shows along the cell's other edges (its texel there, and 0.15 of its
  texel across the edge, for the tile blur) would leak more than the join it covers.
- unbleed alike threshold SAME_T 6 -> 14.

State (T=0, all 11 sizes; whole-pixel sizes 0):
- day 118,190: worst 1278x719@1.25 90, rest 34-55.
- sunset 130,876 (over by 2.9k): worst 1278 72, rest 31-45.
- night 124,687: 1200x780@1.25 125, 1680 66, rest 28-59.

Next step: classify night 1200x780@1.25 and the 1278 fails; then size (sunset).

## Entry 6: switches made permanent; T=0 nearly clean

Done:
- Permanent now (no env needed): the field as a translated group (encode.mjs drawWithBands),
  three coats on the spike tips, two on the clouds and the crown, a ring of the lower still
  layer under every edge of a covering one (build.mjs; round 3 kept it under top edges only, so
  the far range and the hills showed the sky between them), per-moment SEAM table in build.mjs:
  unbleed thresholds and the near-colour merge (day 4, sunset 6, night 4 levels).
- unbleed second tier: up to same2 apart, a hidden texel 40+ off still counts.

State (T=0, all 11 sizes; whole-pixel sizes 0, holes 0):
- day 118,334 chars: 39-60, 1278x719@1.25 92 (FAIL).
- sunset 126,119: 21-46.
- night 124,336: 21-39, 1200x780@1.25 66 (FAIL; a cloud's edge over the massif, coats do not
  help there).

Next step: day 1278 (tip edges over the far hedges), then T=37 and a rare-event time.

## Entry 7: field back in a tile (player), crisp covers at the tips, edge rule on coated layers

Found:
- player-check said STILL for day with the field as a group of runs (11-12 ms a frame in
  window 2; round 3 with the field in a tile: 2.8 ms). The field must be a cached tile.
- night's 1200 fail: the low cloud's dark base row had its lit colour laid under it (dilation),
  which showed along the cloud's bottom edge over the dark foot of the massif.
- in the gust (T=1, T=37) the tips stand over other cells: unbleed weighed only the rest pose.

Done:
- encode.mjs drawWithBands: bands and cells in one pattern tile again (corner on a cell corner,
  a clear cell all round: height +1 row, as the last band runs a row deeper and the tile's wrap
  pulled it onto the top row as a line). FIELD_G=1 still gives the group (temporary).
- encode.mjs: moving layers with two coats or more use the local encoder's edge rule (no
  colour laid under an outer-edge cell). NO_EDGE turns it off (temporary).
- build.mjs unbleed: weighs every tip pose (lean1 a cell left, lean2 one and two); cells a tip
  covers in every pose are skipped; per-moment `lean` threshold for pose-only cases.
- build.mjs coverTips: a field cell beside a rest tip, alike to the tip, beside a hidden cell
  far from both, is drawn again in a plain layer over the tile (its own visible colour: same
  picture in every pose, crisp at every size). SEAM `lift` threshold.
- SEAM: day lean 10 lift 30; sunset lean off lift 40; night lean 40 lift 40.
- Tried and dropped: lifting hidden cells out of the tile (gust lines 117-227 in day), five
  tip coats (not needed now), stronger unbleed for day (not needed now).

State (all 11 sizes; holes 0; whole-pixel sizes 0):
- day 124,479 raw / ~124,373 scrubbed: T=0 max 39, T=37 max 41, T=1 max 33.
- sunset 126,094 / ~126,289: T=0 34, T=37 38, T=1 34.
- night 126,314 / ~127,484: T=0 23, T=37 17, T=1 17.

Next step: purity at 6, 8, 9 px/cell for all three; player-check x3; pixeldiff vs out/pre-seam;
check.mjs; render and look; remove temporary hooks; notes.md.

## Entry 8: coats settled, hooks removed

Done:
- player-check (window 2) was 4.2-5.2 ms against 5.56 (round 3: 2.75). The coats were most of
  it (one coat everywhere: 3.3 ms). Tips now two coats (one coat: 54-170 line px; three bought
  nothing more), the crown one (no line change), the clouds two (one: night 1200 25 -> 40).
- Temporary hooks removed (LAV_X, LAV_T, LAV_ROWCHUNKS, WIDE, LAV_DUMP, LAV_WHO, LAV_TEX,
  FIELD_G, NO_EDGE, SEAM_X, TIP_COATS, CROWN_COATS, CLOUD_COATS, LEAN_T, BLEED_T, LAT_T, BAND_T,
  FIELD_T, NO_REPAINT, ALIKE, LINE env). Same output as before the removal (sizes identical).
  Pre-cleanup copies: scratchpad lavender-*-precleanup.mjs.
- encode-local.mjs header: L5 and L6 described.

State (all 11 sizes; holes 0; whole-pixel sizes 0):
- day 124,225 raw / ~124,039 scrubbed: max line px T=0 44, T=37 47, T=1 39.
- sunset 125,887 / ~126,008: T=0 35, T=37 39, T=1 35.
- night 126,069 / ~127,159: T=0 25, T=37 22, T=1 22.

Next step: player-check x3, purity 6/8/9, pixeldiff vs out/pre-seam, check.mjs, render.mjs and
look, notes.md section.

## Entry 9: checks done, notes written

Done:
- player-check: PLAYS for all three; window 2 day 3.75, sunset 4.13, night 3.64 ms (limit 5.56;
  round 3 on the same run about 2.75).
- Purity at 6, 8 and 9 px/cell: 0 for all three, at T=0 and T=1.
- pixeldiff vs out/pre-seam (scratchpad lavender-diffclass.mjs, 6 px/cell): changes are cell-edge
  pixels (the 1.1 stroke's tint gone) and interior merges within 4 levels (6 at sunset); other:
  7 cells day, 2 sunset, 4 night moved 5-7 levels (by the knoll, rows 108 and 127).
- check.mjs: ok for all three (now allows `use`, each pointing at an id in the file).
- render.mjs: PNGs rewritten; day looked at in full (picture intact).
- notes.md: "Encoding and hairlines" replaces the 1.1-stroke section and "Seams"; size and
  player tables, files table, rules and open issues updated.

State: final. No commits, nothing published.
