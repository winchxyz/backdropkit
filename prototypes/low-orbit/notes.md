# Low Orbit

The edge of the Earth seen from orbit, with a gold-foil satellite passing in front. The sun sits
just past the right edge, above the limb. The day-night line falls where the real sun puts it at
the chosen moment, and cities glow on the night side.

## Build

    node build.mjs          # writes out/low-orbit-a.svg and out/low-orbit-b.svg
    node render.mjs         # writes out/low-orbit-a.png and out/low-orbit-b.png (1536x864, motion held at start)

Debug switches: `MAP=1 node build.mjs` prints an ASCII map of the invented world; `AT=25 node render.mjs a`
renders 25 s into the motion; `ZOOM=x,y,w,h node render.mjs a` writes a 6 px/cell crop; `GEO` moves the
world under the camera; `DZ` scales ground dithering.

`build.mjs` imports `sunfield/tools/pixel.mjs` by path. Nothing under `sunfield/` was changed.

## The two moments (2026-11-15, camera over 14N 30E, UTC+2)

- A, 04:45: the line stands right of centre. Night covers most of the frame: city lights, an aurora
  along the dark limb, the dawn band where the line meets the air.
- B, 07:40: the line has moved to left of centre. Day covers most of the frame: clouds with relief and
  shadows, a sea reflecting the warm light near the line.

The sun position comes from the NOAA declination and equation-of-time formulas.

## What moves

All motion uses CSS animations with `steps()` on the 0.05 s clock. Every start frame equals the
reduced-motion frame.

- Satellite: crosses left to right and slightly up, 120 s of every 150 s, at about 0.2 cells a tick.
- Wing glint: a sun reflection on the right wing, mid-pass. It fades in over 4.5 s (1.5 s steps), holds 4.5 s, then fades out the same way.
- Antenna light: a soft red pulse every 3 s (between 0.3 and 1 opacity, no hard flash).
- A tiny distant craft: drifts right to left, 60 s of every 100 s.
- Aurora: two sets of brighter rays take turns in 9 one-second steps.
- Seven big stars: each dims briefly on its own 10 to 25 s cycle.

## Sizes and player-check

| SVG | chars | after scrub | player-check |
| --- | --- | --- | --- |
| low-orbit-a.svg | 103,988 | about 106,130 | PLAYS (1.03 / 1.07 ms avg, 15.4 ms worst) |
| low-orbit-b.svg | 112,246 | about 114,520 | PLAYS (0.85 / 0.87 ms avg, 16 ms worst) |

Measured on this laptop (RTX 4070 laptop GPU), 2026-11-15, after the hairline fix, while other
Chromium jobs ran; the pre-fix files measured the same at that time (1.02 / 1.08 and 0.80 / 0.83 ms).
The cost numbers vary between runs. The build fails above 128,000 characters, raw or after the scrub.

## Encoding and hairlines

At window sizes where a cell is not a whole number of screen pixels, the scene showed thin lines
between cells (seamscan: up to 48 line pixels a size in A and 62 in B, B failing at 1536x864).
Fixed 2026-11-15 by changing only how the cells are written; the painting is untouched.

What caused them, and what fixed each:

- **Colours meeting inside a layer, and the joins between paths of one colour.** Cells were written
  with Sunfield's `emitCells`, so wherever two cells met inside a screen pixel, what lay beneath both
  showed through. Every cell layer is now written by `encode-local.mjs`, a local copy of the kit's
  `engine/encode.mjs` (`emitSafe`): darker colours run under the lighter ones beside them, and split
  paths of one colour overlap. Patterns, groups and motion are as they were.
- **The shared encoder's backing, in B.** `emitSafe` lays a layer's commonest colour under all of it.
  For B's globe that is the white of the day clouds, and it showed through the dark night side: as a
  bright line along the night limb and the airglow (it lay under the layer's outer edge too), and as a
  dot at every corner where four dithered colours met (the 4-neighbour cover leaves those corners
  open). With the shared encoder, B still scanned up to 210 line pixels. The local copy keeps the
  backing off outer-edge cells it is far from, and has the earliest colour of such a corner cover the
  whole 2 x 2 block. That is why the encoder is a local copy; the reasons are in its header.
- **The limb.** The Earth and its air were two layers (two patterns) meeting exactly at the limb, with
  space beneath. They are now one layer, `globe`, so the encoder treats the limb as any other colour edge.
- **Layers cut away under the globe.** The sky, the stars and the aurora were deleted wherever the
  globe covers them, so they ended exactly at its edge. They now carry on one cell under it
  (`tuckUnder`), hidden, so the edge blends with them and not with space.
- **Pattern tiles.** Each big layer is a one-tile pattern on a rect. The rect's left and right edges
  touched the cells; there is now a clear cell on every side. The tile's corner sat half a cell off
  the cell grid (rows are drawn half a cell low), so the tile's bitmap was resampled at sizes where
  half a cell is not whole pixels: at 9 px a cell every row edge of the sky and the Earth was a soft
  1-px band (about 80,000 off-colour pixels in A, 114,000 in B). The tile now starts on a cell corner.
- **Soft, rounded cell corners.** Chromium's GPU raster draws a path whose box on screen is square-ish
  and middling (both sides over about 200-256 px, area under about 100k px) with a softer antialiasing
  that rounds each cell's corners and blurs its edges a little, even at whole-pixel sizes. In B the
  day-night band's colours (about 45 x 50 cells a path) hit it at 6 px a cell, the owner's window:
  about 1,900 such pixels before the fix. It depends on a path's box, not its run count (isolated
  paths of 200 runs stay square). The local encoder also caps a path at 19 rows, which keeps every box
  under about 200 px tall up to 10 px a cell.
- **The triple merge filter on the globe** was a cover for these lines. It stays, because its merge
  runs in linearRGB and rounds the darkest night tones; without it the night side shifts by a few
  levels from what the owner has seen.

Size: A 97,634 -> 103,988 characters (106,130 after the scrub), B 108,174 -> 112,246 (114,520).
Nothing was culled, merged or cut. The second aurora ray layer in A now has enough runs to be
written as a pattern, by the scene's own rule; it draws the same.

Scan results (`engine/seamscan.mjs`, line pixels per size; no holes anywhere):

| moment, time | most line pixels over the 11 sizes | at whole-pixel sizes (6, 8, 9 px a cell) |
| --- | --- | --- |
| A, T=0 | 9 (1440x900) | 0 |
| A, T=37 | 9 (1440x900) | 0 to 2 |
| A, T=20 (wing glint full, far craft mid-way) | 9 (1440x900) | 0 |
| B, T=0 | 27 (1366x768) | 0 |
| B, T=37 | 26 (1366x768) | 0 to 2 |
| B, T=20 | 26 (1366x768) | 0 |

What is left at fractional sizes is mostly single pixels at cell corners, about 10-15 levels off
their neighbours. The longest is one stretch of 8 px (two cells) in B at 1366x768, about 15 levels
darker, between two near-white cloud cells where a darker colour run under one of them shows at
their shared edge (the encoder skips cover between colours that are both near the backing, and does
not know another colour lies under one side). At T=37 the 2 at 6 px a cell are on the moving
satellite, which stands a fraction of a cell off the grid by design.

`engine/pixeldiff.mjs` against the files before the fix (kept in `out/pre-seam/`): A 1,415 and B
3,911 pixels differ at 6 px a cell, every one of them on a 1-px colour edge of the old picture (the
old soft corners now square, and the satellite's and far craft's seams); none inside an area. The
marked pictures are `out/diff-a-1920.png` and `out/diff-b-1920.png`. Cells checked against their own
centre at 6, 8 and 9 px a cell: 0 off-colour pixels in both moments (before: up to 1,916, 267 and
113,833).

Checks: at most 64 runs a path, no double quotes, the CSS (motion, 0.05 s clock) byte for byte as
before, both under 128,000 both ways, player-check PLAYS for both.

## Rule notes and open issues

- The sun glare is a smooth `radialGradient` ellipse rather than cells. It and the pixel rays use
  `mix-blend-mode: screen`. Both passed player-check, but this is the one non-cell element in the scene.
- The geography is invented (procedural noise). No real map data is used, so the coastlines and cities
  don't match the real places under the camera.
- The longitudes are stretched 2.6 times so the frame holds about half the globe, which keeps the line in
  view most hours. Near local noon or midnight no line would show.
- The real sun at these times is behind the camera and to the right (azimuth 105 to 117 degrees). The
  glare and rays at the right edge are artistic. The satellite is lit from the right, which suits a
  morning sun. An evening sun would come from the left.
- To place the line live, the mod would need to repaint the Earth (the painter is deterministic JS; the
  line moves about 3 cells every 5 minutes) or lay a clipped night layer over a day layer.
- The city lights still look a little blobby, and the dish reads as a small module.
