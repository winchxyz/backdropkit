# Snowfall Ridge

A mountain ridge over a spruce forest, a log cabin below with smoke from its chimney, and snow falling in three depths. The picture is the same in all three moments; only the light changes.

- **Morning:** alpenglow. The sun is in the col on the left, the peaks are pink, and the valley lies in lavender shade. Rays fan through the sky and light shafts reach the field.
- **Day:** clear noon. White snow, blue shade, teal forest, and white shafts from the upper left.
- **Night:** stars and a moon on the left, blue snow, warm cabin windows, and window-shaped pools of light on the snow.

## Files

| File | What it does |
|---|---|
| `build.mjs` | `node build.mjs` writes `out/snowfall-ridge-{morning,day,night}.svg`. `ONLY=night` builds one moment. |
| `paint.mjs` | The painters: sky, glow, rays, clouds, mountains, spruce, forest bands, snowfield, creek. |
| `palettes.mjs` | The three moments' colours. |
| `motion.mjs` | Everything that moves, and the CSS for it. |
| `lib.mjs` | Assembly helpers: the layer encoding (through `encode-local.mjs`), pattern tiles (cut into bands when big), the cull, and the scrub-length estimate. |
| `encode-local.mjs` | This scene's copy of BackdropKit's seam-proof encoder (`engine/encode.mjs` `emitSafe`), with local changes. See "Encoding and hairlines". |
| `render.mjs` | `node render.mjs [moments]` writes the 1536x864 PNGs. Each is drawn as an `<img>` of the SVG with the motion held at its start. |
| `still-check.mjs` | A copy of `sunfield/tools/app-check.mjs` that writes into this folder's `out/`. `STILL=1` applies the app's still-frame scrub; `REDUCE=1` turns on reduced motion. |

Sunfield's `tools/pixel.mjs` is imported by path. Nothing under `sunfield/` was changed.

## What moves

Every animation steps on the shared 0.05 s clock. All durations and delays are multiples of 0.05 s, and the delays count from the root's `--m`.

- **Snow** falls in three layers, each looping seamlessly as a group plus a `<use>` copy one frame higher:
  - far: 150 one-cell flakes, a cell every 0.25 s;
  - mid: 80 flakes, a cell every 0.15 s, swaying one cell over 6 s;
  - near: 26 flakes of 2x2 cells, a cell every 0.1 s, swaying two cells over 8 s.
- **Chimney smoke:** 8 puffs on a 12 s cycle. Each puff:
  - rises 40 cells, one cell a step, and drifts 14 cells right, faster as it climbs;
  - grows through three sizes, then fades out in 6 steps.
- **Spindrift** slides off the summit to the right: 25 cells in 5 s, thinning, on an 8 s cycle.
- **Clouds:** four drift across, a cell a second.
- **Mist:** the wisps at the foot of the ridge swing 8 cells back and forth over 50 s.
- **Glints:** 12 stars dim briefly near the end of their cycles; 9 glints on the creek and the sparkles on the front drift light up for a moment.

Nothing flashes or shakes, and the camera does not move.

### Still frame

With the app's still scrub (reduced motion, or a scene the app will not animate), a still layer of smoke stands in at the chimney. While the motion runs, a `steps(1)` rule hides that still smoke. The animated puffs, the spindrift and the glints have a base opacity of 0, so they disappear at rest.

## Sizes

All three are under 128,000 in every measure, and so under the 131,072 limit. The seam-proof encoding made them about 23,000 characters longer than before.

The table gives the build's scrub estimate, and the lengths `still-check.mjs` measured after the app's still scrub and after its live scrub.

| Moment | Characters | Scrub estimate | After the still scrub | After the live scrub |
|---|---|---|---|---|
| Morning | 124,748 | 125,220 | 125,194 | 127,889 |
| Day | 118,859 | 119,253 | 119,227 | 121,922 |
| Night | 115,915 | 116,549 | 116,523 | 119,218 |

## Player check

Run with `sunfield/tools/player-check.mjs` on an RTX 4070 laptop at 1536x864 @1.25. The limit is 5.56 ms a frame on average. The numbers are noisy.

| Moment | Window 1 average | Window 1 worst | Window 2 average | Window 2 worst | Result |
|---|---|---|---|---|---|
| Morning | 1.29 ms | 16.6 ms | 1.19 ms | 2.2 ms | PLAYS |
| Day | 0.97 ms | 7.6 ms | 1.08 ms | 1.9 ms | PLAYS |
| Night | 1.32 ms | 8.2 ms | 1.05 ms | 3.3 ms | PLAYS |

These are for the seam-proof build (2026-11-15). Before it, the averages were 0.94–2.27 ms.

`still-check.mjs` (the copy of app-check) gave these results:
- Live, all three: `ok`, with about 43,000 pixels changed in 2 s (52,000 before the seam fix).
- With `STILL=1`, or with `REDUCE=1`: 0 pixels changed, and the picture looks finished.

## Rules

| Rule | Status |
|---|---|
| Grid and root | A 320x200 cell grid in nested viewports, viewBox `0 -.5 320 200` with slice. The sky is pinned to the middle, the land to the bottom. The root is `fill='none' font-family='a' color='a'`, with single-quoted attributes only. |
| Allowed markup | No `shape-rendering`, no `vector-effect`, no viewport units. Every `href` and `url()` points to a `#id`. The only `@media` rule is the reduced-motion stop. |
| Stroke paths | At most 64 runs per path, stroke width 1. No path's box is over 21 cells on both sides. |
| Big still layers | Drawn in 6 pattern tiles (7 in the day and at night). No tile's box holds over 46,000 cells. |

These are the departures from Sunfield's plain recipe:

- **Seam-proof encoding.** Every layer goes through `encode-local.mjs` (see "Encoding and hairlines"). There are no underlays and no wider strokes.
- **Tile margins.** Each tile has one clear cell all round, and its corner sits on the cell grid (`y` at a half cell), so a tile's edge rows do not bleed into the opposite edge.

## Encoding and hairlines

Fixed 2026-11-15. This was an encoding fix only: the art, the light, the composition and the motion are unchanged. `out/pre-seam/` holds the files from before. The progress log is `seamfix-log.md`.

### Causes found

- **Underlays and wide strokes.** Big tiles had a filled underlay in their commonest colour and `stroke-width='1.25'` rows. The underlay showed between colours at fractional scales.
- **Tiles over Skia's 4-Mpx picture-shader cap.** At 9 px a cell, the big still tiles and the snow tiles are drawn smaller and scaled back up, so their edges go soft and slide off the cell grid. The pre-seam day file had 380,332 impure pixels at 9 px a cell (purity test below).
- **Tile rects half a cell off the grid.** The rects had a whole-number `y`, but cell edges lie at half cells.
- **Paint under outer edges.** In `emitSafe`, the backing and the whole-cell dilations reach an outline cell's outer edge. Where that edge falls inside a screen pixel, the colour beneath shows. This outlined every still group: dark needles under the snow on a spruce, a dark backing under a pale drift.
- **Chunk joins.** Where the 64-run cut fell over a backing, the join showed as a line: 746 line pixels in morning at 1278x719@1.25.
- **Abutting layers:**
  - two mist paths side by side;
  - cull ring cells left in a dark colour under the edge of the group above.
- **Snow:**
  - a near flake's two colours on white snow showed a step within T;
  - a flake's edge over a dark cell's edge let that cell show through.
- **Big paths drawn soft.** Chromium's GPU raster draws a path whose screen box is over about 256 px on both sides with a softer antialiasing. Even on whole pixels, its edge pixels let about 18% of what lies beneath show. Measured at 9 px a cell with the creek's dark path:
  - 31 x 31 cells: soft;
  - 29 x 29: soft;
  - 28 x 28: crisp;
  - 80 x 11 and 136 x 8: crisp.

### What fixed them

**`encode-local.mjs`**, a local variant of the engine's `emitSafe`. It is a copy because `engine/` is shared with the other scenes being fixed at the same time. Changes:
- Nothing drawn under a cell reaches that cell's outer edge unless it is within T of the cell's colour. Outline cells are covered from inside by half covers (strips 0.3 of a cell deep).
- `hidden`: cells that an opaque still layer above always covers. An edge toward one is not an outer edge.
- `strict`: cells whose outer edge lies over the same colours (a band's first row). Nothing but their own colour reaches them.
- Bridges, for size: a row runs on across hidden cells, or across later colours it may lie under.
- The 5 commonest colours are each tried as the backing; the shortest is kept.
- Joins between a colour's paths overlap unless the backing is within 12 of it (`JOIN_T`).
- Row and column orders, and blocks walked one at a time; the shortest is kept.
- No path's box is over 21 cells on both sides (`BOX`).

**`lib.mjs`:**
- No underlays; stroke width 1. Tile rects sit on the cell grid, with one clear cell all round.
- Sparse layers never become tiles. A layer that fills under 1/20 of its box (the snow, the stars) is drawn plain with T 0.
- A tile box over 46,000 cells is cut into two bands. The lower band repeats the upper band's last row, and that row is `strict`.
- The cull keeps an 8-neighbour ring under the group above. Ring cells take the colour of a visible neighbour in their own layer.
- T is 36 (the largest step a hairline may show, as a mean channel difference). No colours were merged.

**`motion.mjs`:** the snow is drawn three times in place (two `<use>` of the inner group). The fall, the sway and every time are unchanged.

**`build.mjs`:** the mist is one path.

### Scan results

**seamscan**, 11 default sizes. Every size passes with 0 holes, and every 6, 8 and 9 px a cell size shows 0 line pixels. The worst line pixels per moment are all at 1x and 1.25x sizes:

| Moment | T=0 | T=37 | T=7.85 (4 of 19 glints lit) |
|---|---|---|---|
| Morning | 14 | 13 | 12 |
| Day | 41 | 25 | 51 |
| Night | 25 | 13 | 15 |

What remains are scattered single pixels where cell edges fall inside a screen pixel: flake edges, and still layers' corners. The limit is 60.

**Purity** (every pixel against its cell's centre pixel, summed RGB difference over 9) at 6, 8 and 9 px a cell (1920x1200@1, 2560x1600@1, 1440x900@2): 0 impure pixels in every moment. Checked at T=0; at 8 and 9 px a cell also at T=7.85 and T=37.

**pixeldiff** against `out/pre-seam/` at 6 px a cell:
- About 101,000–104,000 pixels differ per moment, all along colour edges:
  - the 1-px rows where the old 1.25-wide strokes reached 0.75 px over;
  - the soft edges of the old over-cap tiles.
- Against the build just before the box cap: 0 pixels.

**Other checks:**
- At most 64 runs per path; single quotes only.
- Every time is on the 0.05 s clock. The CSS is identical to the pre-seam files.
- player-check: PLAYS in every moment.

## Open issues

- The smoke has low contrast in the morning (pale puffs against the lavender peak) and is fainter still in the day (grey against white snow). It reads best at night.
- Spindrift is subtle at night.
- The night windows are a flat warm colour. There is no flicker, by choice.
- The biggest tile (391 x 117 cells, 45,747) reaches Skia's 4-Mpx picture-shader cap above about 9.3 px a cell, beyond the 11 checked sizes. There it would be drawn soft. A 28,000-cell cap fixes that, but takes morning to 128,333 after the scrub, over the 128,000 limit.
