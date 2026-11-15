# Moon Keep hairline fix: progress log

## 2026-11-15, entry 1 (resuming after a context break)

Done:
- Baseline kept: out/pre-seam/moon-keep.svg (129,094 chars) and .png. Every check compares with it.
- Mist strips (cause 3): `tiled()` in build.mjs now makes the tile span the layer's rows plus a clear
  row above and below (rect and tile share y = top - 1.5). This took the long lines away (2876 -> ~700).
- Local encoder encode.mjs (copy of engine/encode.mjs) used for every cell layer through `cellsOf()`:
  emitSafe plus three local options: `bridge` (fills row gaps under later colours), `joinAll` (always
  overlap chunk joins), `order: 'both'` (tries darkest-first and largest-first). `emitTerrace` in it is
  unused (terraces cost far more here). The SAFE=1 gate is gone; ENC=old builds the old encoding.
- `mergeNear()`: colours within 6 levels (mean channel) merged per layer; KEEP boxes keep the gate,
  lintel, hanging lantern, lamp post and bridge lanterns exact.
- `cull()`: a covered cell next to a showing cell of the same layer is kept (1-cell margin under the
  layer above).
- `lipsOf()`: quarter-cell "lips" (stroke .5 on the edge) where a layer meets a lower layer's cell of
  nearly its colour (<= 6) but something else (> 28 apart) lies under its own edge cell.

State of build.mjs / out/:
- build.mjs has the "safe lips" variant (lips only where valid at every place a moving part can stand,
  using PLACES and `swept`). It kills almost every lip (12) and is WORSE: T=0 max 135 line px.
- Best result so far is out/trial-lips-ABC.svg (129,361 chars): the earlier lipsOf with categories A
  (same pin), B (cross pin), C (moving layer, rest place only); its code is in the transcript, not on disk.
- out/ also holds trial-*.svg, seams-base/, seams-ms/, debug/ (to delete at the end).

Latest scans (max line px over the 11 sizes; fail > 60):
- pre-seam: 2876.  trial-lips-ABC: T=0 42 (all pass), T=4.8 50 (pass), T=37 106 (fails 1536x864@1 74,
  1440x900@1 106, 1278x719@1.25 68, 1200x780@1.25 79), T=128.4 81 (fails 2).
- trial-safelips (current build): T=0 135, T=37 172, T=128.4 172.
- Remaining T=37 lines in ABC: leaf clumps (lv) of the left tree x~33 y23-30, high cloud bottom y=46
  x~188, grass tips y170-198.

Next step:
1. Rewrite lipsOf: still layers take lips wherever every colour that can show at the far cell (top still
   cell, and any moving part over it at any of its places) is within 6 of the lip; moving layers (gs, lv)
   get per-place lip groups whose opacity is keyed to the layer's own keyframes (class q<cls><j>,
   opacity="0" on non-rest groups so reduced motion shows only rest lips). zb places = [[0,0]].
2. Coordinator tips from low-orbit (encode-local.mjs there): keep backing off outer-edge cells, cover
   four-colour corners with the earliest colour, cap paths at 19 rows. Add as options to encode.mjs,
   measure size and seams.
3. Fit <= 130,872 raw and scrubbed; then pixeldiff vs out/pre-seam (DIFF image), check.mjs,
   player-check (PLAYS), render.mjs + look at PNG, notes.md "Encoding and hairlines", clean out/,
   remove NOTIPS switch.

## 2026-11-15, entry 2

Done since entry 1:
- encode.mjs: added Low Orbit's outer-edge backing (option `edge`, but an edge cell next to a cell of
  the backing's colour stays backed) and four-colour corners (`corners`), and a soft-corner cap in
  chunks(): a path is closed before its box becomes square-ish (short side >= maxRows, long side <=
  MAX_SIDE 60, ratio <= 1.7). build.mjs OPT: EDGE, CORNERS (default on), MAXROWS (set 24).
  Purity at 6 px/cell (owner's window): pre-seam 304 impure cells (moon), now 0.
- lipsOf rewritten: `fits()` (lip only where all that can show under it is within 6), MOTION table,
  per-place lip groups (PLACED, off by default now: too big), LOOSE=moving (moving uppers judge
  moving lowers at rest).
- DUP: moving layers drawn 3 times (`<use href>`), after Deep Reef. Big win.
- Scratchpad is shared with other agents: my scripts there are mk-*.mjs / mk-*.cjs.

Latest (out/trial-d3.svg = MAXROWS=24 LOOSE=moving PLACED=0 DUP=3): 129,929 raw, 130,066 scrubbed.
Seamscan max: T=0 31, T=37 59 (1200x780@1.25), T=128.4 47. All pass.

Next: make these the defaults in build.mjs (MAXROWS 24, LOOSE moving, PLACED 0, DUP 3), player-check
timing, then pixeldiff, check.mjs, PNG, notes.md, cleanup.

## 2026-11-15, entry 3 (done)

Defaults set in build.mjs (MAXROWS 24, LOOSE moving, PLACED off, DUP 3); experiment switches
NOTIPS, ROWPINS, LIPCATS and STATS=lips removed; emitTerrace removed from encode.mjs; headers updated.
out/moon-keep.svg 129,929 raw / 130,066 scrubbed. Seamscan max T=0 31, T=4.8 23, T=37 59,
T=128.4 47 (all pass, no holes). check.mjs ok. player-check PLAYS (1.13 / 1.46 ms). pixeldiff:
only <= 6-level merges plus the moon's corner pixels; gate and lamps unchanged. notes.md has
"Encoding and hairlines". Trial files deleted from out/. Nothing left but the report.
