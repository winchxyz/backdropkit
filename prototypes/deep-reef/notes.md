# Deep Reef

The view from under the water. Light comes down from a bright window in the surface in seven shafts, past drifting snow and rising bubbles, onto a lit sand floor between two reefs. Kelp frames both edges and a sea turtle swims overhead. The scene is not tied to the time of day.

- `node build.mjs` writes `out/deep-reef.svg` and prints its size.
- `node render.mjs` writes `out/deep-reef.png`: 1536 x 864, drawn as the app draws it (an `<img>` of the SVG, GPU raster), with every animation held at its start.
  - `T=12` draws 12 s in; `DPR`, `SIZE` and `CROP`/`ZOOM` cut out details.
- `node frames.mjs` draws `out/frames.png`, a sheet of moments (`TIMES="0,2,5,12,30,60"`).
- The painting tools come from Sunfield by path (`../../../sunfield/tools/pixel.mjs`, `painters.mjs`); nothing under `sunfield/` was changed.

## Planes, back to front

1. Water: a gradient from pale cyan to deep blue, in dithered bands.
2. Ghost spires, then a far ridge with muted coral heads.
3. A far school of fish in silhouette.
4. Light rays.
5. Far snow.
6. Sand with moving caustics.
7. The two reefs:
   - left: a small sea fan, staghorn, tubes, brain and dome corals, an anemone with clownfish;
   - right: a big sea fan, a table coral, a giant clam, sponges, blue tangs.
8. The mid school, the turtle, bubbles, near snow.
9. Kelp at both edges.
10. The surface and the sun window on top.

## What moves

All motion moves in whole cells, on `steps()`, on a 0.05 s clock. At t = 0 everything sits where it is painted.

| What | How |
| --- | --- |
| Kelp, 4 plants | Sway in height bands: the lower band 1 cell, the upper bands 2 and 3, so the plant bends. Cycles of 9 to 12 s, each band 0.4 s behind the one below. |
| Light rays | Each shaft breathes, its light swelling and ebbing between 55% and 100% in 20 steps. Cycles of 11 to 21 s, out of phase with each other. |
| Surface | Two crest tiles slide in opposite directions: near 1 cell per 0.4 s, far 1 cell per 0.8 s. |
| Caustics on the sand | Two net tiles slide in opposite directions, 1 cell per 0.6 s and per 0.9 s. |
| Snow | Two depths sink, 1 cell per 0.8 s and per 0.4 s. |
| Bubbles | Two streams rise from the reefs, 1 cell per 0.1 s, wobbling 1 cell. |
| Mid school (12 fusiliers) | Crosses left to right, 1 cell per 0.15 s (81 s across, 101.25 s cycle). Bobs 1 cell over 7 s; tails flick 0.5 to 0.9 s, each fish on its own phase. |
| Far school | Crosses left to right, 1 cell per 0.25 s, swapping between two frames (143.75 s cycle). |
| Turtle | Crosses right to left, 1 cell per 0.4 s (168 s across, 210 s cycle). Flippers beat every 3.2 s; bobs 1 cell over 6 s. |
| Clownfish and tangs | Hover 3 to 4 cells to and fro by the reef (7 to 13 s cycles), tails flicking. |

With reduced motion on, `@media (prefers-reduced-motion:reduce){:root *{animation:none!important}}` stops every animation; the scene rests on its first frame.

## Size and player check

- **SVG:** 123,851 characters. The build estimates 126,343 after the app's scrub. The limit is 131,072; since the hairline fix, the target has been 128,000 or less by both counts.
- **Patterns:** 25 hold 10,082 runs, and 273 runs are plain paths. The CSS is 3,344 characters.
- **`player-check.mjs`:** ends with `PLAYS: the app would run its motion`. Last run, at 1536 x 864 @1.25x on the RTX 4070:
  - window 1: 2.06 ms average (24.7 ms worst);
  - window 2: 1.88 ms average.
  - The limit is 5.56 ms.
  - Readings vary with other agents' load on the machine. On the same machine at the same time, the pre-fix scene read 2.33 ms.

## Rules

- **Root:** as Sunfield's: single quotes, `font-family='a' color='a'`, `--m:0s` clock.
- **Parts:** each pinned part is a nested `<svg viewBox='0 -.5 320 200' preserveAspectRatio='… slice'>`. Pins:
  - top: rays, surface;
  - bottom: far reef, sand;
  - bottom-left and bottom-right: the reefs, kelp, bubbles.
- **Elements used:** `svg`, `g`, `defs`, `style`, `pattern`, `rect`, `path`, `linearGradient`, `stop`, `use`. There are no filters.
  - `use` draws the sun glow three times (`href='#G'`, which the app's whitelist allows).
  - The caustics clipPath is gone.
- **Checks:** no `shape-rendering`, `vector-effect`, viewport units or `data:`. Every `url()` is `url(#id)`. The only `@media` is reduced motion.
- **Timing:** every duration, delay and step length is a multiple of 0.05 s (checked by script).
- **Paths:** at most 64 runs each. The rays are filled staircase outlines, not stroked runs, and are split into row bands to stay within 64.
- **Patterns:**
  - Big still layers sit in `width=1 height=1` patterns.
  - The repeating layers are `userSpaceOnUse` tiles moved in whole cells: surface, caustics, snow.
- **Ray light:** one `linearGradient` with 15 hard-stepped `stop-opacity` levels, fading with depth.
- **Seams:** see "Encoding and hairlines" below.

## Encoding and hairlines

Fixed on 2026-11-15, as an encoding change only: the art, light, composition and motion are unchanged. The original is kept in `out/pre-seam/` (`deep-reef.svg`, `build.mjs.orig`), and the step-by-step log is in `seamfix-log.md`.

### Before

seamscan (`engine/seamscan.mjs`, T=0) failed 6 of 11 sizes:

| Size | px/cell | Line pixels |
| --- | --- | --- |
| 1536x864@1 | 4.80 | 1,697 |
| 1366x768@1 | 4.27 | 2,072 |
| 1440x900@1 | 4.50 | 840 |
| 1680x1050@1 | 5.25 | 1,893 |
| 1278x719@1.25 | 4.99 | 198 |
| 1200x780@1.25 | 4.88 | 1,769 |

### Causes and fixes

1. **Edges between colours inside a layer** (README cause 1), everywhere.
   - **Fix:** every layer goes through `emitSafe` (the local `encode.mjs`), in place of `emitCells`.
   - Patterns, groups and motion are kept as they were.
2. **Surface tile edges** (cause 3). The near and far crest tiles had filled edge rows, which wrapped in the tile bitmap.
   - **Fix:** each tile now has a clear row above and below.
3. **Near and far surface meeting at one edge** (cause 4).
   - **Fix:** the far tile carries a copy of its top row one row up, under the near tile.
   - Even so, the near tile's backing showed along its own bottom edge, between two white crests. That is why `encode.mjs` has the `lift` option: the cells of that row that are covered only to lie under another colour are drawn a quarter cell higher, so they stop short of the edge.
4. **Caustics clipped through the middle of a cell.** A clip at y 179 cut row 179 in half, and the half-cell strip drew as a line at every size below 6 px a cell.
   - **Fix:** the clip is removed, and each caustic tile keeps clear rows 178 and 201.
   - **Visible change:** the caustic cells on row 179 now show whole; before, only their lower half showed. This is the only change inside areas.
5. **Holes left by `cull`.** Cells hidden under a still layer were dropped right up to that layer's edge, so the water showed through at the edge.
   - **Fix:** the lower layer keeps a one-cell margin under the edge, coloured like its own visible neighbour.
6. **Moving layers over each other:**
   - the still sun glow over the sliding surface;
   - caustic net A against net B;
   - kelp bands and plants against each other.

   Where an edge falls inside a screen pixel, the cell hidden under the upper layer shows by f(1-f).
   - **Fix:** the upper layer is drawn more than once, which leaves whole cells as they are. Drawing it k times cuts the leak to f(1-f)^k.
     - the glow: three times, through `<use href='#G'/>`;
     - each caustic net: twice, inside its opacity group;
     - each kelp band: twice.
7. **Soft, rounded cell corners at 8 and 9 px a cell.** The cause was found by Low Orbit's fix. Chromium's GPU raster softens every corner of a path whose screen box is square-ish and over about 200 px on both sides, here the kelp rims.
   - **Fix:** `encode.mjs` caps such paths. A path past 21 rows takes another row only while its box stays at most 21 cells wide.
   - This took 2560x1440 from 42 line pixels to 0, and 1440x900@2 from 47 to 0.
8. **Water tile too wide.** The water pattern was 1,120 cells wide. It was drawn as a bitmap too big to keep and then scaled, so every dither cell had soft edges at 6, 8 and 9 px a cell.
   - **Fix:** the tile is now 336 cells wide (the part is sliced, so only x 0..320 ever shows), and its corner sits on a cell corner.

### Size savings

- Colours within 6 levels (mean channel) of a commoner colour in the same layer are merged (`MERGE`). This keeps the size under the target despite the extra encoding.
- Hidden cells are culled as before.

### Checks after the fix

- **seamscan:** every size passes at T=0, T=37 and T=50, with both schools and the turtle mid-crossing. No holes anywhere.

  | Size | T=0 | T=37 | T=50 |
  | --- | --- | --- | --- |
  | 1536x864@1.25 | 0 | 0 | 0 |
  | 1536x864@1 | 38 | 46 | 47 |
  | 1920x1080@1 | 0 | 0 | 0 |
  | 1366x768@1 | 19 | 34 | 26 |
  | 1440x900@1 | 22 | 30 | 33 |
  | 1280x720@1.5 | 0 | 0 | 0 |
  | 1680x1050@1 | 24 | 19 | 35 |
  | 2560x1440@1 | 0 | 0 | 0 |
  | 1440x900@2 | 0 | 0 | 0 |
  | 1278x719@1.25 | 44 | 55 | 22 |
  | 1200x780@1.25 | 32 | 39 | 44 |

- **pixeldiff against `out/pre-seam/`** (6 px a cell, DIFF image `out/pre-seam/diff-1920.png`). The changes are:
  - colour merges of at most 6 levels: the sand's back rows and the rock edges, among others;
  - 1-px rings at the water's dither cells, from the sharper water tile;
  - 1-px edges;
  - the top half of caustic row 179.
- **Scene checks:**
  - at most 64 runs per path;
  - no double quotes;
  - every time on the 0.05 s clock;
  - every `url()` and `href` is `#id`.
- **player-check:** PLAYS.

### Left as is

- **What the remaining line pixels are:** mostly kelp rim cells where the swaying bands meet, plus a few dots elsewhere. They come from moving layers leaking at edges inside a screen pixel. Repeat draws reduce this leak but cannot remove it.
- **Tried and dropped:** Low Orbit's outer-edge backing rule and corner blocks. They cost about 900 characters and gave mixed counts, so they were not kept.
- **Half cells in the water (original art):** the solid water bands are written half a cell above the dither rows. So in the last dither row of each band, the gap cells are half the colour above and half the colour below. Making them whole would change those half cells by 4 to 11 levels, so it is left.

## Open issues

- **Mid school:** about every 100 s it swims across the face of the big sea fan. It passes in front, which reads fine but is busy for a few seconds.
- **Far ridge coral heads:** they read as small soft domes, not coral.
- **Sand:** up close the banded sand and caustics read a little like tiles.
- **Untested:** the scene has not been run in the desktop app itself. Only the cached app code ran, through player-check.
