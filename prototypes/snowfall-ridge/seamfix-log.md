# Seam fix log (snowfall-ridge)

## Entry 1 (2026-11-15)

**Done**
- `out/pre-seam/` holds the original SVGs, for pixeldiff.
- Causes found:
  - Big pattern tiles (stroke-width 1.25 rows plus a commonest-colour underlay) leaked the underlay between colours.
  - Two abutting mist paths.
  - emitSafe's backing and whole-cell dilations sat under the outer edge of outline cells.
  - Over a backing, a dark dilated colour's edge sat over the backing alone.
- `encode-local.mjs` is the local variant of `engine/encode.mjs`. It adds:
  - half covers (DELTA 0.3 strips with insets) into outline cells;
  - an "exposed / force" side test;
  - hidden cells (culled under still layers above);
  - x-blocks in the walk;
  - the 3–5 commonest colours tried as backing.
- `lib.mjs`:
  - `draw` uses the local emitSafe, with no underlays and no stroke-width 1.25;
  - neighbouring still layers merge into one layer;
  - `cull` keeps an 8-neighbour ring and records the culled cells as `hidden`;
  - `mergeNear` (env MERGE) merges near colours.
- `build.mjs`: the mist is one path; there are no underlay flags.
- `paint.mjs`: `glow()` writes `vN`, not `v1v1…`. The outline is the same.

**Build:** `BACKS=5 MERGE=6 SEAM_T=36 node build.mjs` (the env defaults are not yet set in code). With T=40 and BACKS=5, morning is 127,861 chars.

**Scans** (MERGE=6, T=36, BACKS=3, before the glow change): every size passes. Worst line pixels per moment, over the 11 sizes:

| Moment | Worst |
|---|---|
| Morning | 31 |
| Day | 59 |
| Night | 42 |

**Debug left in code (remove before the end)**
- `lib.mjs` `draw`: the STATS and DUMP lines, and the `explain` import.
- `encode-local.mjs`: the `explain()` export, the SDBG and NOEXT hooks, and the DELTA / BACKS / NOINSET env.
- `lib.mjs`: PATMIN env.

**Next**
1. Pattern rects sit half a cell off the cell grid (rect `y` is an integer, cell edges are at .5). Make `y = b.y0 - 1.5`, height `b.y1 - b.y0 + 2`.
2. Consider the 2x2 corner cover and the MAX_ROWS 19 soft-corner cap from `low-orbit/encode-local.mjs`.
3. Set the defaults in code (MERGE 6, T 36–40, BACKS 5) and remove the debug hooks.
4. Full checks:
   - seamscan at T=0, T=37 and a rare-event time;
   - pixeldiff;
   - player-check;
   - size;
   - render.mjs.
5. Write notes.md "Encoding and hairlines", then report.

## Entry 2 (2026-11-15)

**Done since entry 1**
- Pattern rects now sit on the cell grid: `y = b.y0 - 1.5`, height `b.y1 - b.y0 + 2`. Morning 1440x900@2 went from 31 to 2 line pixels.
- `JOIN_T = 12` in `encode-local.mjs`: a colour's chunk joins overlap unless the backing is within 12 of it. Without this, a full-width join of #5f5e9e drew 746 line pixels in morning at 1278x719@1.25.
- Tried and dropped: moving each chunk break up to 6 rows earlier, to the row boundary with the fewest touching cells. Morning got bigger (132.2k against 130.4k).
- Measured, morning at T=40 with RING4:

  | Change | Morning chars | Saving |
  |---|---|---|
  | Base | 130,438 | — |
  | No half covers | 113,573 | 17k |
  | No join overlaps | 120,112 | 10k |
  | MERGE 8 | 127,097 | 3k (too far from 6) |
  | JOIN_T 20–32 | 128,617 | 1.8k |

- New: **bridges** in `encodeWith`. A gap in a row of a colour's cover is filled when every gap cell is either:
  - hidden: not in the layer, and under an opaque still layer above;
  - a later colour the colour may lie under, by the same rule as a dilation.

  Morning: 101,909 chars.
  - The first try also bridged hidden cells that the layer itself has (a forest cell over a culled mountain cell). That painted the mountain over the far forest; pixeldiff caught it.
  - Fixed: `hid.has(g) && !has(g)`.
- `motion.mjs` `tk()` now writes times without float noise (-0.35, not -0.35000000000000003). The clock is unchanged.
- Debug env added: `SHIFT` (removed again), `JOIN_T`, `JDBG`, `NOBRIDGE`; `build.mjs` `OUTDIR`. All to be removed.

**Next**
1. Pixeldiff the fixed bridge build against the unbridged one: it should show no change.
2. If morning fits with room to spare, go back to the 8-neighbour ring (drop RING4). Then try lower settings for the least change to the art: MERGE 0 or 6, and T 36–40.
3. Rebuild all moments, then run the full checks (see entry 1, Next 4).

## Entry 3 (2026-11-15)

**Done**
- With the bridge fix, pixeldiff of the bridged build against the unbridged one shows only snowflake marks. Those came from the `tk()` change, which shifted a step boundary at T=0. The bridge changes nothing in the picture.
- The `tk()` change is reverted; `motion.mjs` is as it was.
- Bridges make the colour merge unnecessary. Settings compared, all with the 8-neighbour ring, no merge, BACKS 5 and bridges:

  | T | Morning chars | Worst line pixels (11 sizes) |
  |---|---|---|
  | 28 | 127,225 | 24 |
  | 36 | 123,377 | 22 |
  | 40 | 123,199 | 22 |

  At T 36, day is 117,211 and night 115,778.
- **Chosen:** T 36, no merge (`mergeNear` removed, colours untouched), BACKS 5, DELTA 0.3, JOIN_T 12, the 8-neighbour ring.
- Debug hooks removed:
  - `lib.mjs`: STATS, DUMP, `explain`, PATMIN, SEAM_T, MERGE, RING4;
  - `encode-local.mjs`: SDBG, TRACE, JDBG, NOEXT, NOINSET, NOBRIDGE, DELTA, JOIN_T and BACKS env, and `explain()`;
  - `build.mjs`: OUTDIR.
- `build.mjs` keeps its COST env line.
- Final build of all moments to `out/` is running: plain `node build.mjs`, no env needed.

**Next**
- Final checks on `out/`:
  - seamscan at T=0, T=37, and T=7.85 (4 glints lit);
  - pixeldiff against `pre-seam` with DIFF;
  - ad-hoc checks (scratchpad `snowfall-checks.mjs`: runs per path, quotes, clock);
  - player-check;
  - render.mjs.
- Then the notes.md section, and the report.

## Entry 4 (2026-11-15)

**Final build of entry 3** (T 36, no merge): morning 123,462, day 117,296, night 115,863.
- Every scan passes at T=0 and T=37.
- At T=7.85, day failed at 1440x900@2 with 67 line pixels.
- The ad-hoc checks pass: ≤64 runs per path, no double quotes, all times on the 0.05 s clock.

**Cause of the day failure:** Skia's 4-Mpx picture-shader cap. At 9 px a cell, five tiles pass it:
- the three snow layers (about 318x201 boxes);
- two big still groups (361x169 and 391x131).

They are drawn smaller and scaled back, so their edges go soft and slide off the cell grid. A sharp flake next to a soft background edge leaves a 1-px line.

**Changes in `lib.mjs` `Scene.draw`:**
- **Sparse layers stay plain.** A layer that fills less than 1/20 of its box (`SPARSE`) is never a tile, and is encoded with T 0. This covers the snow, and the stars at night. A near flake's two colours on white snow showed the within-T leak as a line.
- **Big tiles are cut into two bands.** A tile box over `TILE_MAX` = 46,000 cells is cut in two:
  - `splitRow` picks the cut with the fewest runs in the repeated row, and the fewest colours in both bands;
  - the lower band repeats the upper band's last row;
  - for the upper band, the lower band's cells count as hidden;
  - the lower band's first row is `strict` (new emitSafe option): no other colour reaches its outer edges, even within T.
- **Bug found:** a merged still group's `hidden` set also holds cells that the group paints itself. Handed to the lower band, these let the backing run to the band's top edge over the upper band: 255 line pixels at the 1x sizes. Fixed by keeping in the lower band's hidden set only the cells outside the layer.

Day after the cut, before the hidden fix: 1440x900@2 had 0 lines, but the 1x sizes failed (the bug above).

**Next**
1. Check the day scans with the hidden fix.
2. Rebuild all moments and run the full checks.
3. Morning size will be about 127k: watch the 128,000 limit.

## Entry 5 (2026-11-15)

**Done**
- Day with the hidden fix: 1440x900@2 dropped to 5 line pixels. The 1x sizes then reached 59–60 at T=7.85.
- **Abutting still groups.** The 8-neighbour ring cells that cull keeps under the edge of a group above now take the colour of a visible neighbour in their own layer, across that edge (`lib.mjs` `cull`). Example: a dark #183a44 forest cell under the snowfield's edge drew a dark 1-px line. These cells are covered at whole-pixel sizes.
- **Snow drawn three times in place.** The inner group has two `<use>`, set in the `motion.mjs` snow wrap; the fall and sway are unchanged. A flake's edge that falls on the edge of a dark cell beneath let that cell show through. Three passes cut the leak from about 38% to about 5%.
- Day after both: T=0 max 42, T=7.85 max 51 (1536x864@1), 9 px a cell 5.
- `TILE_MAX` env removed. No `process.env` is left in the scene code except build.mjs's ONLY and COST.
- A full build of all moments is running.

**Next**
- Full checks on `out/`: seamscan at 3 times, pixeldiff, ad-hoc checks, player-check, render.
- notes.md, then the report.

## Entry 6 (2026-11-15)

**Done**
- Build #2 (before this entry): morning 123,608, day 117,455, night 114,525. Copied to the scratchpad (`snowfall-build2/`).
- **Purity test** (`snowfall-purity.mjs`, a copy of side-street's with HIDE): every pixel against its cell's centre pixel, TOL 9.
  - The pre-seam day file: 380,332 impure pixels at 9 px a cell.
  - Build #2: 0 at 6 and 8 px a cell in every moment. At 9 px a cell, morning 133, day 329, night 244, all in the creek (cells x 105..122, rows 171..182).
- **Cause:** the creek's dark #163f78 path in tile d (layer 1's lower band) has a 31 x 31 cell box. The pixel dump shows its edge pixels at about 82% dark and 18% of the #d2e1f4 backing beneath, even though every edge falls on a whole pixel. The same happens with the tile content drawn inline, so the tile itself is not the cause.
  - With the path cut in two (boxes 9 x 8 and 24 x 23), the edges are pure.
  - Adding a speck to one half to set its box size: 27 x 27 crisp, 28 x 28 crisp, 29 x 29 soft, 31 x 31 soft; 80 x 11, 112 x 8 and 136 x 8 crisp.
  - So Chromium softens a path whose screen box is over about 256 px on both sides. Deep-reef and low-orbit found the same rule.
- **Fix** in `encode-local.mjs` `chunks()`: once a path spans BOX = 21 rows, it takes another row only while its box stays at most 21 cells wide (deep-reef's rule).
- **Final build** (BOX 21, TILE_MAX 46,000, T 36):

  | Moment | Raw | Scrub estimate | Live scrub (still-check) |
  |---|---|---|---|
  | Morning | 124,748 | 125,220 | 127,889 |
  | Day | 118,859 | 119,253 | 121,922 |
  | Night | 115,915 | 116,549 | 119,218 |

  A rebuild reproduces `out/` byte for byte.
- **Purity:** 0 impure pixels in every moment at 6, 8 and 9 px a cell at T=0, and at 8 and 9 px a cell at T=7.85 and T=37.
- **seamscan:** every size passes, with 0 holes. 1440x900@2 is now 0 everywhere (it was 5). Worst line pixels:

  | Moment | T=0 | T=37 | T=7.85 |
  |---|---|---|---|
  | Morning | 14 | 13 | 12 |
  | Day | 41 | 25 | 51 |
  | Night | 25 | 13 | 15 |

- **pixeldiff against `pre-seam`:** 101k–104k pixels per moment, all on colour edges. 2x2 changed blocks (374–856) lie only where the old over-cap tiles were blurred, for example the creek's top end, now crisp. Against build #2: 0 pixels, so the box cap changes nothing at 6 px a cell.
- **Ad-hoc checks:** ≤64 runs per path; no double quotes; every time on the clock. The CSS is byte-identical to the pre-seam files.
- **player-check:** PLAYS in every moment, averages 0.97–1.32 ms.
- **still-check:** ok live; 0 pixels changed with STILL=1. Its PNGs were moved to the scratchpad.
- **render.mjs:** PNGs rewritten; morning looked at.
- **Tried and dropped:** TILE_MAX 28,000 (rainy-studio's cap) takes morning to 127,717 raw and 128,333 by the scrub estimate, over the limit. Kept 46,000. The biggest tile (391 x 117) passes the 4-Mpx cap only above about 9.3 px a cell.
- notes.md now has the "Encoding and hairlines" section, and its Files, Sizes, Player check, Rules and Open issues are updated.

**Next**
- The report (SubagentHandback). Nothing else is pending.
