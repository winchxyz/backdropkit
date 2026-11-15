# Harbor

A fishing harbour seen from a pier, drawn on Sunfield's 320 x 200 cell grid. It has three moments: day, sunset and night.

```
node build.mjs            # writes out/harbor-day.svg, harbor-sunset.svg, harbor-night.svg
node render.mjs           # writes out/harbor-<moment>.png, 1536 x 864, motion held at its start
```

`build.mjs` imports `Layer`, `tone` and the other helpers from `../../../sunfield/tools/pixel.mjs`, and `paintCloud` and `billow` from `painters.mjs`. Nothing under `sunfield/` was changed. Cells are written by `emitSafe` from `encode-local.mjs`, harbor's copy of the BackdropKit encoder (see "Encoding and hairlines").

## Planes, back to front

1. Sky in banded gradient rows.
   - Day: sun with halo and soft rays, cumulus and cirrus.
   - Sunset: half-set sun, long rays, cloud bands lit from below.
   - Night: moon with halo, stars, thin cloud.
2. Faceted mountains with haze rows.
3. Hill town: church tower, four rows of houses, cypresses and a quay wall with lamps. Windows are lit at sunset (20%) and at night (60%).
4. Headland: cliff with strata and boulders, breakwater, beacon, cottage and the lighthouse.
5. Water.
   - Reflections of the town, quay boats and headland, broken by ripples.
   - Wave lines.
   - Sun or moon column.
   - Night light streaks under the windows and lamps.
6. Mid boats: two sail or fishing boats and a rowboat. A far sail crosses at day and sunset.
7. Foreground.
   - A teal trawler with a wheelhouse, rigging, tyres and a flag.
   - The pier deck with piles and a lamp post.
   - Crates of fish, rope and floats.
   - A gull perched on a pile.

Light: sunset gives rim light on every top edge plus the sun-facing side, and the water turns copper. At night the windows and the trawler's wheelhouse are lit and the lamp pools on the deck.

## What moves

All motion steps on the 0.05 s clock (`steps()`, delays as `calc(l + var(--m))`).

- **Boats:** they bob one cell, the mast tops lean, the reflections move the other way and the trawler's flag flutters in two frames.
- **Water:**
  - wave lines fade in and out in four groups;
  - glints twinkle in the sun or moon column;
  - runs of glints light up one after another along the ripples;
  - reflections sway a cell.
- **Sky:** clouds drift to and fro, rays breathe and stars twinkle (night).
- **Gulls:** three glide on slow loops with wing beats, and the perched gull turns its head every 15 s.
- **Day and sunset:** a far sail crosses the harbour mouth (150 s) and chimney smoke rises.
- **Night:** the lighthouse turns two beams half a turn apart (16 s a turn). The lamp flares softly when a beam faces the viewer, and the window light streaks shimmer in two frames.

In the still frame and with reduced motion, both beams rest on the scene (left one long, right one cut by the edge), so the moment looks finished. `@media (prefers-reduced-motion:reduce)` stops every animation.

## Sizes

After the seam fix (2026-11-15):

| moment | source | after the scrub (estimate) |
|---|---|---|
| day | 126,852 | 126,611 |
| sunset | 120,733 | 120,077 |
| night | 113,688 | 108,501 |

All three are under the 128,000 aim and the 131,072 limit. Before the fix they were 114,441, 112,513 and 107,846 characters.

## Player check

These are the results of `node sunfield/tools/player-check.mjs` at 1536x864 @1.25x on an RTX 4070 Laptop GPU with D3D11, after the seam fix. Other agents were running Chromium at the same time, so the numbers are noisy.

| moment | window 1 | window 2 | result |
|---|---|---|---|
| day | 1.05 ms | 1.29 ms | PLAYS |
| sunset | 1.28 ms | 1.05 ms | PLAYS |
| night | 1.18 ms | 1.18 ms | PLAYS |

The limit is 5.56 ms. Before the fix: day 1.06 / 2.16, sunset 1.22 / 1.30, night 0.95 / 0.90 ms.

## Rules

- Elements used: `svg`, `g`, `path`, `defs`, `pattern`, `rect`, `use`, `clipPath` and `mask`. There are no filters, no `shape-rendering` or `vector-effect`, and no viewport units. Every `url()` is `url(#id)`, every `href` is `#id`, and the only `@media` rule is the reduced-motion one.
- Root and encoding follow Sunfield: single quotes, `font-family='a' color='a'`, `--m:0s`, and a nested `<svg viewBox='0 -.5 320 200' preserveAspectRatio='xMidYMax slice'>`.
- No path has more than 64 runs. Still layers of 55 runs or more go into `<pattern>` tiles.
- The beam is one wedge turned with `scaleX` and opacity around a `transform-origin` at the lamp. Opacity animations sit inside a group with a fixed opacity, because a CSS opacity animation would override the group's attribute.

## Encoding and hairlines

Fixed on 2026-11-15. The originals are in `out/pre-seam/`; the step-by-step log is `seamfix-log.md`.

### Causes found

1. **Colour edges inside a layer.** `emitCells` wrote each colour on its own, so every edge between two colours showed what lay beneath. This was the main cause: up to 3,362 line pixels a size (day).
2. **Pattern tiles half a cell off the grid.** Tiles started at a whole y, but cell corners sit at half-integer y. Every row edge in a tile was resampled across two screen pixels, so it blurred even at 9 px a cell (day at 1440x900@2: 3,362 line pixels).
3. **Soft corners.** The GPU rasteriser rounds every cell corner of a path whose box is square-ish and middling in size.
4. **Abutting layers and parts.**
   - The boat hull against its reflection.
   - Wave lines against the sun's sheen.
   - Still layers whose cells another still layer culled away.
5. **Separately twinkling groups that touch.** Glints, wave lines and the run glints: where two lit cells of different groups meet, the water shows between them.
6. **Water cells under a bobbing boat's reflection.** Their edges lie exactly under the reflection's edges in one of the two bob states.

### What fixed them

- **The encoder.** Every cell layer is written by `emitSafe` from `encode-local.mjs`, a copy of `low-orbit/encode-local.mjs` (the engine encoder plus three changes), with two options of harbor's own. `engine/` is shared and was not changed. Settings (`SAFE` in build.mjs):
  - **4-colour corners** (Low Orbit's change 2): on.
  - **Row cap** (change 3): at most 19 rows a path, but not for paths at most 21 or at least 120 cells across (harbor's change 4). A purity test (pixels that differ from their cell's centre) at 4, 5, 6, 7, 8 and 9 px a cell reads the same as capping every path, and it costs about 2.5k a moment less.
  - **Outer-edge backing** (change 1): off (harbor's option `edge`). It cost 1.7k to 3k a moment and scanned no better.
- **Pattern tiles** start on a cell corner (y = top - 1.5) with one clear cell on every side. The widest is 327 cells.
- **Day's town layer** may also be written largest colour first, whichever is shorter. That saves about 4k and keeps day under 128,000. On every layer it added line pixels.
- **Boats.** `tuckUnder` carries each reflection a row up under its hull, where the hull covers that row in both bob states.
- **Waves and sheen.** `tuckWaves` (day and sunset) carries wave cells a cell under the opaque sheen.
- **Culling.** `cull` keeps a hidden one-cell rim of a lower still layer under the layer above.
- **Wave groups** keep their cells and timing. Each group is drawn twice with `<use>` (`repeat()`), which cuts the leak between two lit groups from a quarter to at most a sixteenth. Three draws scanned the same and doubled the frame time.
- **Glints** are regrouped (`twinkleGroups`): glints that touch across groups go into one group, the one that keeps the still frame where possible. A run glint's flash takes in the near-coloured glint cells it touches. Drawing the glint groups twice instead left 66 line pixels at sunset (1680x1050).
- **Under the boats.** Water cells that a boat's reflection always covers are left out (`gone`). Cells it covers in only one bob state are drawn only in the other (`syncWithBoats`, classes `rh` and `rs`, on the boat's own timing).

### Scan results

`seamscan`, 11 sizes, at T = 0, 37 (the perched gull's head turned), 50 (night: the lamp flare, beam facing the viewer) and 100 s. Holes were 0 everywhere. The table gives the most line pixels over the 11 sizes; the limit is 60.

| moment | before (T=0) | T=0 | T=37 | T=50 | T=100 |
|---|---|---|---|---|---|
| day | 3,362 | 25 | 28 | 28 | 30 |
| sunset | 2,643 | 44 | 51 | 46 | 40 |
| night | 167 | 40 | 28 | 44 | 26 |

At 8 and 9 px a cell every moment now scans 0 line pixels, except 8 on night at T=50. Night shows 6 at the whole-pixel sizes: one 1-px column in the sky at the tip of the lighthouse beam, which is not cell art. The original also shows 6 at those sizes.

### What pixeldiff shows

`pixeldiff` against `out/pre-seam/` at 6 px a cell, holding motion at time 0, counts 3,984 differing pixels on day, 9,185 on sunset and 1,157 on night.

- **Edges only.** Most of these are edge pixels of parts that sit between cells at time 0: drifting clouds, gulls and smoke. The rest are old hairlines that are gone, such as a faint 1-px column in the night sky at x 526.
- **Whole cells: regrouped glints.** About 110 day, 200 sunset and 29 night glint cells look different in the still frame. They are lit where they were dim, or the reverse, because they now twinkle with another group. Their twinkle timing changes too: 85, 165 and 20 glints moved group. This is the one change to the motion.
- **Nothing else.** No colours were merged, and no other cell changed.

## Open issues

- **Glint regrouping.** It changes when about 20 to 165 glints a moment twinkle (see "What pixeldiff shows"). A way to join glints of different groups without moving them was not found.
- **Very large windows.** At 12 px a cell (3840x2160 at 1x) the purity test jumps from about 650 to about 3,000 impure cells on day, with or without the 19-row cap. These are probably soft corners on paths of 19 rows, which are over 200 px tall at that size. This was not fixed: it is beyond the sizes scanned.

- **Narrow windows.** The whole scene sits in one xMidYMax viewport. At 16:9 it shows rows 20 to 200. In a window narrower than 16:10, the lighthouse (x 292) and the town's left edge are cut off first. Pinning the headland right and the town left with nested `slice` viewports would fix this, but was not done.
- **Wheelhouse at sunset.** It still reads a little light against the copper water.
- **Beam edges.** The beam has three opacity levels and a dithered fade, and the steps between levels show at large window sizes.
