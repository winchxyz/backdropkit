# Rainy Studio seam fix: progress log

## 2026-11-15, entry 1

**Done**
- `out/pre-seam/` holds the three original SVGs (86,407 / 92,586 / 98,779 chars). They are the reference for pixeldiff. Do not overwrite them.
- Original scan (fail, worst sizes): day 2,545 line px, evening 4,641, night 305. Evening and day also showed lines at 6 px a cell.
- Causes found:
  1. emitCells seams inside layers, including a 16% leak between two vertical runs of one colour in different paths, even at 6 px a cell.
  2. The room pattern (324 x 203 cells) is bigger than Chromium's pattern-tile limit (about 2048 x 2048 device px). It blurs at 12 px a cell.
  3. Pattern tiles had no clear column at their sides.
  4. cull() deleted lower cells right up to the edge of the upper layers (near roofs, the rail).
  5. Backing and under-drawn colours fringe a layer's outer edge (seen on the mid-tower ledges in day).
- `encode.mjs` (new, local) is emitSafe extended for #rrggbbaa colours. It adds:
  - nested alpha levels per connected group;
  - see-through colours drawn under solid neighbours;
  - a chunker that keeps runs whole;
  - edge cells (outline and cut) that nothing is drawn under.
- `build.mjs`:
  - imports encode.mjs;
  - draw() uses emitSafe, splits big layers (pieces(), MAXA = 28000 cells, with cut copies and edge sets), and gives the tile a 1-cell side margin and a 1.5-cell top and bottom margin;
  - cull() keeps a 1-cell border under upper layers;
  - renderLayers() flushes only when see-through cells overlap.
  - Debug env vars: SIZES=1 and DUMP=dir.

**State of out/**
- Holds a build from before the latest encode.mjs edits: day 117.8k, evening 126.8k, night 130.5k (over 128k).
- Scan of that build fails only at:
  - day: 1440x900@1 73, 1680x1050@1 61, 1278x719@1.25 102;
  - evening: 1440x900@1 77, 1278x719@1.25 64;
  - night: 1278x719@1.25 92.
- Every other size is at most 42.

**In progress** (encode.mjs and build.mjs are being edited)
- Outline cells within T of the backing keep the backing; only the far ones are edge cells. Done in encode.mjs, not yet built.
- Next:
  - cull border cells take the colour of a visible neighbour in the same layer, not the upper layer's colour, so they add no new colours;
  - cap each path's box at a span of 19 rows or columns (soft corners, coordinator tip 3);
  - put pattern tile corners on cell corners (tip 2: pattern viewBox `0 -.5 W H`, rect y = y0 - 1.5).

**Next step**
- `node build.mjs`. Then run `node ../../engine/seamscan.mjs out/rainy-studio-*.svg` (all 3).
- Check sizes are at most 128k. If not: merge colours within 6 levels, or raise T to 36-40 on the busy layers.
- Then pixeldiff against `out/pre-seam` and look at the DIFF image.

## 2026-11-15, entry 2

**Done**
- cull() border cells take a visible same-layer neighbour's colour (no new colours).
- encode.mjs:
  - path box cap: a path is split when its box is over 21 cells in both directions (coordinator tip 3, deep-reef's 21); the chunker finds the longest stretch by binary search;
  - the backing redraw after the edge pass also covers the inner 8-neighbours of the redrawn cells (fixed a dark line along the train's lower band at every window pillar);
  - an inner colour's path also takes its own colour's edge cells next to inner cells that got another colour under them (fixed dark rows inside the lamp-lit plant rim).
- Rebuilt: day 117,745 / evening 121,027 / night 121,540 chars (scrub 117,882 / 121,217 / 121,838).
- seamscan T=0, 11 default sizes: all pass. Most line px: day 30, evening 20, night 38. 0 at 6 px a cell and above.

**Next step**
- seamscan at T=37 and at a train/runner time; pixeldiff against out/pre-seam with DIFF; checks; player-check; notes.md.

## 2026-11-15, entry 3

**Done since entry 2**
- Tiles: corner on a cell corner (rect y = y0 - 1.5, pattern viewBox `0 -.5 W H`, one clear cell on every side); defs moved to the end of the file so the first viewBox is the scene's (seamscan reads it). Fixed a line at every train row at 9 px a cell.
- A small see-through layer (at most 64 cells over the set, e.g. the pot shadow) is composited into the still set instead of starting a new pattern. Big ones (beam, halo, sign glow) still start a new set (compositing them all put night at 130k).
- cull(): consecutive parts in one viewport are culled together (the room now hides the city behind its walls: about -10k); every still layer keeps a 1-cell ring under the upper layer's edges, also where it only meets it (mist row 141 / sill row 142); border and ring cells take the colour nearest the colour over them.
- encode.mjs: an outline cell never has the backing under it (the `near` relaxation was wrong: the fringe is a quarter of backing minus what is behind the layer, 22 levels on a tower edge); bridges along rows (tried with and without, shorter kept); order lum and area tried, shorter kept; no redraw for edge cells of the backing colour.
- Tried: ALIGN 2/4 (tile corners on even cells): moved fails around, not kept (ALIGN stays 1).

**State**: seamscan T=0 all moments pass at 11 sizes (most: day 19, evening 17, night 29) before the size work; night was 133k, over. Testing MERGE (colours within N levels per set) 3/4/6.

**Next step**: pick MERGE, rebuild, rescan T=0/37/50, pixeldiff, checks, player-check, notes.md.

## 2026-11-15, entry 4 (finished)

**Done**
- MERGE stays 0. Soft outlines (nothing under an outline cell unless what is on screen around it is within 20 levels of the backing), order and bridge search, and cross-part culling brought the sizes under 128k without merging colours.
- Final out/:

  | Moment | raw chars | scrub estimate |
  | --- | --- | --- |
  | day | 115,949 | 116,344 |
  | evening | 124,083 | 124,819 |
  | night | 124,686 | 125,464 |

  - Patterns: 20, 23 and 23.
  - No path over 64 runs, no double quotes.
  - The style block and the animated groups are identical to pre-seam.
- seamscan, 11 default sizes, all pass. Most line px:
  - day 17 / 11 / 15 (T=0 / 37 / 50);
  - evening 17 / 22 / 33;
  - night 19 / 8 / 21.
  - 0 at 6, 8 and 9 px a cell.
  - Extra sizes: 3840x2160 at most 5; 2560x1600 0; 1920x1200 @1.25: 31 / 45 / 25.
- pixeldiff against pre-seam: day 1,332, evening 4,127, night 2,057 px. The DIFF crops show only 1-px colour edges: the old seams along the mid-tower stripes, and the plant leaf edges.
- player-check: all PLAYS.
  - day: 1.44 / 1.47 ms average;
  - evening: 1.64 / 1.61 ms;
  - night: 1.90 / 1.68 ms.
- render.mjs PNGs looked at (evening at full size); the picture is unchanged.
- notes.md now has an "Encoding and hairlines" section, plus the new size and player tables.

**Left (not done)**
- Lips.
- `<use>` copies of the upper moving layer.
- Low Orbit's outer-edge backing trick.
- Moving-layer edges (the train, the mist, the drops) get no special treatment beyond the scan passing at T=37 and T=50.

**Next step**: none; report sent.
