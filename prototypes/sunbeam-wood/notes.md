# Sunbeam Wood

An old forest seen from inside a glade. Two giant mossy trunks frame it: one on the left, and a bigger one on the right with buttress roots, a great limb and shelf fungus. Behind them, three planes of trunks fade into the haze.

Light comes from the upper left through a gap in the canopy. Shafts slant down to the right onto:

- grass and small flowers;
- a stream that winds out of the mist toward us;
- a mossy fallen log bridging the stream, with mushrooms;
- a stone, ferns, and low bushes along the glade's edge.

A doe grazes at the far edge, right of the stream.

The reference (`_refs/ref-5.png`) supplied only the theme, mood and palette family. Its layout puts the light at the centre back with the shafts slanting "/". This layout differs:

- the light comes from the upper left and the shafts slant down to the right;
- the giant trunk is on the right;
- the stream and the log bridge are the subject.

## Files and commands

- `node build.mjs [moment ...]` writes `out/sunbeam-wood-<moment>.svg` (morning, day, night). With `STATS=1` it also lists the costliest layers.
- `node render.mjs [moment ...]` writes `out/sunbeam-wood-<moment>.png`. It draws the SVG at 1536 x 864 the way the app does (an `<img>` of the SVG, GPU raster), with every animation held at its start. Options:
  - `T=7` moves 7 s into the motion.
  - `STILL=1` draws the rest frame (no animation).
  - `SIZE`, `DPR`, `CROP`, `ZOOM` and `UPSCALE` cut out details.
  - Anything other than the default writes to `out/frames/`.
- `node check.mjs` checks the rules (see Rules).
- `node seams.mjs` scans for hairlines at 1536 x 864 @1x and @1.25x, and at 1366 x 768. The seam fix used the engine's `seamscan.mjs` instead, at 11 sizes, for example `T=37 node ../../engine/seamscan.mjs out/sunbeam-wood-day.svg`, along with `pixeldiff.mjs`.
- `encode-local.mjs` is the scene's own copy of Tide Line's seam-proof encoder. Its header lists what Sunbeam Wood changed.
- `moments.mjs` holds the three palettes. Every ramp keeps its length across moments.
- The painting helpers come from Sunfield by path (`../../../sunfield/tools/pixel.mjs`). Nothing outside this folder was changed.

## Planes, back to front

1. **Haze.** Full-width band strokes. A stepped radial-gradient glow sits over them, at the light.
2. **Far crowns, plane 1 (16 thin trunks), plane 2 (10 trunks).** Each plane is a few flat fogged colours, with a mist gradient over it.
3. **Low bushes and the floor.** Bushes stand along the far edge. The floor shows light pools where the shafts land, and trunk shadows that run with the slant.
4. **Plane 3.** Four trunks at the glade's edge: moss, light where the shafts cross them, and a one-cell rim.
5. **The doe.**
6. **Floor details.** The stream with glints, drifting floor mist, the log, the stone and the mushrooms.
7. **Light shafts, motes and the butterfly.** Fireflies take this place at night.
8. **The two giants.** The bough on the right giant's limb and the ferns sit with them.
9. **Canopy.** Falling leaves come out from behind it. Leafy twigs hang at both top corners.

## What moves

All motion moves in whole cells on `steps()`, on a 0.05 s clock. Delays count from the root's `--m:0s`.

| What | How |
| --- | --- |
| Light shafts (6; 4 at night) | Breathe between 62% and 100% in 20 steps. Cycles of 11 to 23 s, out of phase. |
| Dust motes (about 40) | Wander 1 to 3 cells inside the shafts on 7 to 14 s loops, dimming and brightening. |
| Floor mist | Two cell layers drift 8 cells there and back, over 50 s and 40 s. |
| Water | Three sets of glints take turns, each shown for 0.8 s of a 2.4 s cycle. |
| Corner twigs | Sway 1 to 2 cells over 7 s and 8 s. |
| Fern tips (3 clumps) | Stir 1 cell over 4 to 6 s. |
| Falling leaves (6) | Each leaf is on a 40 s cycle. It comes out from behind the canopy and falls 130 cells, 0.15 s per cell (19.5 s). As it falls it sways 4 cells over 3 to 4 s and turns over every 0.6 s. It dims for a step, then is gone until its next turn. A leaf falls about every 6.7 s. |
| Doe (morning and day) | On a 16 s cycle: head up for 6 s, head down grazing for 10 s. |
| Butterfly (morning and day) | An 18 s loop of seven straight hops over the log, 0.15 s per cell on both axes, then rests 2.7 s where it began. Wings beat on a 0.5 s cycle. |
| Fireflies (night, 15) | Each wanders up to 4 cells on its own pair of X and Y loops (9 to 15 s and 7 to 12 s). Its glow cycle runs 8 to 14 s: it rises in three steps over about 1 s, holds, fades, and stays dark. |

Reduced motion stops every animation with `@media (prefers-reduced-motion:reduce){:root *{animation:none!important}}`. The rest frame looks finished:

- the doe stands head up;
- the butterfly is open at its start;
- all the fireflies are lit;
- leaves and the second-frame sprites have base `opacity='0'`.

## Moments

- **morning.** The reference's mood: low warm gold shafts slanting 0.6 cells per row, a gold glow at the upper left, and thick cream mist.
- **day.** Greener and whiter light, set higher. The shafts are steeper (0.24 per row), the mist is thinner, and the butterfly is white.
- **night.** A cool blue moonlit gap with four pale blue shafts and blue-grey mist. The doe and the butterfly are not drawn; 15 fireflies are.

## Size and player check

| Moment | Characters | After the app's scrub (estimate) | CSS |
| --- | --- | --- | --- |
| morning | 126,700 | 127,476 | 4,310 |
| day | 123,699 | 124,481 | 4,310 |
| night | 121,762 | 122,914 | 3,839 |

- The app's limit is 131,072; the seam fix kept each file at 128,000 or less, raw and scrubbed. Morning has about 500 characters to spare.
- The seam-proof encoding (see Encoding and hairlines) cost about 6,700 to 6,900 characters a moment over the first build (119,989 / 116,990 / 116,294).
- Each SVG has 23 or 24 patterns, about 12,100 to 12,500 runs, and 117 to 126 colours.

`player-check.mjs` ends with `PLAYS: the app would run its motion` for all three. Last run, at 1536 x 864 @1.25x on the RTX 4070 laptop GPU:

| Moment | Window 1 | Window 2 |
| --- | --- | --- |
| morning | 1.51 ms average (9.6 ms worst) | 1.33 ms average |
| day | 1.40 ms average | 1.21 ms average |
| night | 1.31 ms average | 1.43 ms average |

The limit is 5.56 ms. These are the quiet runs after the seam fix (the original morning gave 1.35 / 1.28 ms in the same conditions; drawing takes about 0.2 to 0.3 ms of each frame in both). With other agents running Chromium, window 2 rose to 2.7 to 5.6 ms on fewer frames: one morning run went just past the limit (5.62 ms over 46 frames), and the reruns gave 1.33 to 1.74 ms.

## Rules

`check.mjs` passes on all three. It checks:

- the size limit and the element whitelist;
- `use` links are `#id` only;
- no `shape-rendering`, `vector-effect` or viewport units;
- single quotes only;
- `url(#id)` only, and the only `@media` is reduced motion;
- at most 64 runs per path, and no filters (0 filtered groups);
- every time in the CSS is on the 0.05 s clock;
- the reduced-motion stop is present.

The root and its encoding are Sunfield's: `viewBox` with slice pins, `font-family='a' color='a'`, single-quoted attributes, and nested pinned `<svg>` parts. Big still layers sit in `width=1 height=1` patterns, with a clear cell margin round each tile, the tile's corner on a cell corner, and at most 28,000 cells a tile.

**Rule notes**, where this prototype goes past the earlier ones:

- **Glow and mist are gradient overlays, not cells.** They are a `radialGradient` and `linearGradient`s with hard-stepped stops, laid over the planes. Painting the air into the cells cost 2,400 colours, put the first build at 233k characters, and left seams over the band strokes. The steps are soft, so the glow reads as smooth rather than as pixel cells.
- **Shafts are strokes, not filled outlines.** Each shaft is a stepped centre line of vertical strokes, defined once in `<defs>` as `<g id='Sxy'>`. It is drawn twice with `<use>`: wide and faint for the halo, narrow for the core. The lower half is one cell wider each side. This took the morning shafts from 15.3k to 5.1k characters. The edges stay stepped by whole cells. The stroke uses the gradient `R`, which has 16 stepped opacity levels fading with depth.
- **The plane-3 trunks have a plain backing.** A stepped fill sits half a cell inside them, so the bright haze does not show where two colours meet inside a screen pixel. Every other layer is now made seam-proof by the encoder (see Encoding and hairlines); the log's old forced backing is gone.
- **Keyframe step timing.** The butterfly, falling leaves and Sunfield-style motion set `animation-timing-function:steps(n)` inside keyframes, as Sunfield does.

## Encoding and hairlines

The seam fix of 2026-11-15 (step by step in `seamfix-log.md`). It changed only how the cells are written; the art, light, composition and motion are as they were.

**Before.** The engine's `seamscan.mjs` found up to 1,012 line pixels in morning, 958 in day and 968 in night, at one of its 11 window sizes, with the motion at 0. There were lines even at a whole 6 px a cell. The whole-picture tile also blurred every cell at 8 and 9 px a cell, which seamscan does not count.

**What caused the lines, and what fixed them:**

- **Colours meeting inside a screen pixel.** Where two colours of a layer meet inside a pixel, what lies beneath shows between them by up to a quarter: the haze, the water, the roots.
  - Every cell layer now goes through `encode-local.mjs`, a copy of Tide Line's encoder. The earlier colour runs on under the later one wherever something different lies beneath.
  - `beneath()` in `build.mjs` maps what lies under each bottom-pinned cell: the cells, the glow and mist tints, and the trunk backing. Other pins, moving layers and the shafts count as unknown. Each run of still layers, the glints and the doe's heads get this map as `under`, so the encoder runs a colour on only where it is needed.
- **Pattern tiles.** Each tile's corner now sits on a cell corner (`y = y0 - 1.5`), with a clear cell all round. A half-cell offset blurred every row edge at 9 px a cell.
- **Blur from big tiles.** Chromium draws a tile over about 4.2 million device pixels as a scaled bitmap. The 323 x 204 cell tile of plane 3 and the blades blurred at 8 and 9 px a cell; the 47,000-cell tiles of planes 1 and 2 blurred at 10 to 12 px a cell.
  - Tiles now hold at most 28,000 cells. `split()` cuts a bigger layer into bands of rows or columns, whichever writes shorter, and each band carries the next band's first line under it.
  - Planes 1 and 2 are cut between trunks, at no cost. Plane 3 and the blades are cut in two under the dense floor rows, for about 800 characters.
- **The floor bands.**
  - A cell left over a band keeps its band-coloured neighbours as cells, where the band would show between two other colours.
  - This also covers the floor's far edge, where the rows are partial. There the haze showed through as a line across the floor.
- **Outer edges.** No backing or run-on colour lies under a layer's outer cells, because it showed as dark lines along the light rims of the plane-3 trunks and the left giant. The one exception is between near colours (the floor's last partial row).
- **Soft corners.** Square-ish chunks are capped at 21 rows. Chunks 120 cells wide or more are left whole. Each colour is chunked in rows or in columns, whichever is shorter, which saves about 10k characters a moment on the bark furrows and thin trunks.
- **Moving parts.**
  - The fern tips and the hanging sprays are drawn in two coats, inside their moving group.
  - The still fern fronds get two coats as well. Where a tip meets its frond, the dark roots beneath then show by a sixteenth at most (the right fern gave 57 line pixels at rest before this).
  - Coats are a `<use>` of the tile or group.
- **Skirts were not needed.** Glints, the doe's heads, shafts and motes showed no line pixels at any of the 11 sizes at the three times scanned.

**Line pixels now** (seamscan: the most at any of the 11 sizes; no holes, all sizes ok). The scans were run at 0 s, 37 s and 2.8 s. At 2.8 s, a leaf is at half opacity and the fern tips are at rest; leaves are falling at all three times, and the doe's head is up at 0 s and 2.8 s and down at 37 s.

| Moment | T=0 | T=37 | T=2.8 |
| --- | --- | --- | --- |
| morning | 16 | 16 | 11 |
| day | 15 | 25 | 14 |
| night | 10 | 13 | 18 |

**Purity.** At 6, 8 and 9 px a cell, with the gradient overlays hidden, every pixel equals its cell's colour in all three moments. The original day had 1.5k, 53k and 183k pixels off.

**Pixeldiff against `out/pre-seam/`** at 6 px a cell:

- 1,265 pixels differ in morning, 1,835 in day and 988 in night.
- All of them lie on 1-px edges where the original drew soft or rounded edges: the stream banks and glints, the left canopy and the left fern. The original night had 1,010 such pixels at that size; the new files have none.
- At fractional sizes, coated edges are a touch crisper. No colours were merged.

The old `seams.mjs` notes, about runs of 12 px or more and dashed lines in the first build, no longer apply.

## Open issues

- **Leftover line pixels.** After the seam fix (see Encoding and hairlines), at most 25 line pixels remain at any of the 11 sizes, in scattered single cells. The first build's faint column inside the left giant at 1366 x 768 is gone. The leftovers are:
  - a few fern-tip joints while the tips are moving;
  - four-colour corner dots in the canopy;
  - single motes.
- **Above 9 px a cell.** At 12 px a cell (4K at 150%), a few tiles show soft chunk corners: up to 1,700 pixels on the spray tiles, and a few to 3,200 elsewhere. The row cap of 21 is set for 9 px a cell or less. The tiles themselves stay sharp up to 12 px a cell.
- **Size headroom.** Morning is about 500 characters under 128,000 after the scrub. Any added detail needs savings elsewhere.
- **Far horizon.** The floor still meets the haze along a fairly straight line about two-thirds down. Bushes and mist break it only partly.
- **Canopy.** It still reads as clustered round puffs rather than leaves.
- **Small creatures.** The doe and the butterfly are tiny sprites. The doe reads clearly in both poses; the butterfly reads at full size but not much more. The wing beat (0.25 s per frame) is the fastest motion in the scene. It is a 5 x 3 sprite, so it does not trip the flash detector.
- **Untested in the app.** Only the cached app code ran, through player-check.
