# Lavender Slope

A lavender field runs down toward the viewer. Its rows are continuous hedges that converge on a stone farmhouse at the end of a dirt track.

- **Beyond the field:** a misty valley floor with one small, calm lake.
- **Left:** a wooded hill, and behind it a far range.
- **Back:** a wall of jagged snow peaks; the highest stands centre right.
- **Right corner:** a lone wind-bent tree on a grassy knoll with boulders frames the view.

The reference gave the theme, the mood and the palette family. The composition is our own: summit centre right, rows converging on the farmhouse, a lake in the valley, and the tree on the right, bent left by a wind from the right.

## Files and commands

| Command or file | What it does |
| --- | --- |
| `node build.mjs [moment ...]` | Writes `out/lavender-slope-{day,sunset,night}.svg` and prints each size. `STATS=1` also lists runs per layer. Also writes `out/debug/light.json` for the light check. |
| `node render.mjs [moment ...]` | Writes `out/lavender-slope-<moment>.png` at 1536 x 864. The SVG is drawn as the app draws it (an `<img>`, GPU raster), with every animation held at its start. |
| `node debug.mjs [moment ...]` | Writes the two lighting checks to `out/debug/` from those PNGs (see "Light checks"). |
| `node check.mjs` | Checks the rules below on all three SVGs. |
| `moments.mjs` | The three palettes. |
| `lib.mjs` | Grid, noise, colour, haze and keyframe helpers. |
| `encode.mjs` | Layers to stroke runs, patterns and pinned viewports, after Tide Line's encoder. |
| `encode-local.mjs` | The run encoder for every cell layer: Tide Line's local copy of the engine encoder, with Lavender Slope's changes L1 to L6 in its header. |
| `seamfix-log.md` | The hairline fix, step by step. |
| `out/pre-seam/` | The round-3 SVGs, before the hairline fix. |

`render.mjs` options:

| Variable | Effect |
| --- | --- |
| `T=` | Draws that many seconds into the motion. |
| `DPR=`, `SIZE=WxH` | Device pixel ratio and window size. |
| `CROP=x,y,w,h` with `ZOOM=` | Renders a close-up. The near-field checks use `CROP=200,520,760,344 ZOOM=2`. |
| `SEAMS=1` | Scans for hairlines. `SEAMTHR` sets the contrast threshold (default 10). |
| `OUT=` | Writes the PNG to another path. |

The painting tools come from Sunfield by path. Nothing outside this folder was changed.

## Light

The light is fixed before painting, after `../_refs/lighting.md`. Its constants are `LIGHT` at the top of `build.mjs`. Each moment has one key light on the left, and every object obeys it.

The constants per moment:

- `L` is the direction toward the light. It shades every surface whose facing is known: the hedge mounds, the boulders and the house roof.
- `foot` is the point on the horizon under the light. The cast shadows of the house and the rocks run straight away from it, through the same ground projection the field is laid out on, so they converge in perspective.
- `len` is the shadow length in object heights.
- `sink` and `drop` set how far a shadow sinks the ground into the shadow colour and how much darker it makes it.

`LIGHT_ZONES` holds the thresholds that split a hedge into its parts per moment (see "Hedges" below).

| | Key light | Light colour | Shadow colour | Local lights |
| --- | --- | --- | --- | --- |
| day | The sun, off the frame at the upper left, 45 degrees up, a little behind the scene | `#fff4dc` | `#4f5fa8` (sky blue) | none |
| sunset | The setting sun in the frame at cell (40, 76), 4 degrees up, behind the scene: backlight | `#ffc890` | `#43367a` (violet) | the middle window, `#ffd27a`, 2 cells |
| night | The moon in the frame at cell (54, 40), behind the scene at the upper left | `#a8b4e0` | `#10153a` (deep blue) | three windows, `#ffd480`, a pool of 14 cells |

Where the light falls and the shadows go:

- **day:**
  - Lit sides face up and to the left: the left faces of the peaks, the crests and left flanks of the hedges, the left of the boulders, the gable and the roof.
  - The hedges' crests are lilac-white. Their right flanks are in shade, and their short shadows fall into the furrow on their right; the left half of each furrow is in the light.
  - Contrast is soft: ambient 0.4.
- **sunset:**
  - The scene is backlit. The peaks' left faces are lit pink down to about row 84, and their right faces sit in violet shade.
  - The hedges' crests and spike tips catch a warm pink-lilac rim, and their bodies are mid violet. The face toward the viewer is deep cool violet.
  - The sun is 4 degrees up, so each row's shadow reaches about two rows to the right. The furrows lie in cool shade.
  - A broad band of warm light lies across the left and middle of the field and cools to the right. There the crests, the flanks under them, the spike tips and their stalks take warmer colours.
  - The house front, the boulders and the tree are in shade, each with a warm rim on the edges facing the sun.
  - The house and the rocks throw long shadows (4 heights) toward the viewer and to the right, converging on the sun's point on the horizon.
- **night:**
  - The moon gives the same structure as the day in cool blues: crests and left flanks lit, the right flanks and furrows in shade, and short shadows to the right. It also lights the peaks' left faces.
  - The windows are warm, and their light pools on the wall under them. A dithered pool spreads on the track before the house, with a scatter of lit heads on the nearest rows.

How each kind of object takes the light:

- **Peaks.**
  - The main spur splits each peak into a lit and a shaded face. The shaded faces sit two ramp steps lower and cooler, in two values from their facets.
  - The lit faces of the three largest peaks are laid in snowfields and rock planes. These are bands that follow the ridgeline above them, broken by noise, so they slant with the slope instead of running down the fall line.
  - The smaller peaks keep their gullies: broken one-cell grooves along the fall line.
  - A rim runs along the lit crests and the main arete. There is none on the shaded side.
- **Hedges.** See the next section.
- **House.**
  - The gable faces the light, and the front is two steps darker and cooler.
  - Under the eaves runs a band of deeper shade, two rows by day and one when backlit.
  - The roof is lit by day. When backlit it is in shade, with only the ridge and the verge over the gable catching the light.
  - The chimney has a lit and a shaded side.
  - The house sits on a contact seam and throws its shadow over the rows.
- **Cypresses:** lit on the left, with a shadow and contact seam at the foot.
- **Boulders.**
  - The knoll stones are shaded from their normals against `L`. They are dithered by day, and nearly flat with a rim when backlit.
  - They throw shadows across the knoll grass and sit on contact seams.
  - The two field rocks stand in a small clearing among the rows. They are lit on their top and left faces (backlit: dark, with a rim there), throw shadows and sit on contact seams.
- **Tree.**
  - The trunk has a lit edge and a dark edge.
  - The crown is lit on top and to the left by day. When backlit it is dark, with a rim on its top and left edges. Its underside is always darkest.
- **Water.**
  - The lake mirrors what stands behind it, in broad 8-cell blocks, so the reflection lies in calm bands. The far shore is a dark line.
  - Neither the sun nor the moon stands over it, so no light path crosses the water and there are no glints. What flickers is ripples: short streaks a step lighter.

### Hedges

Each row is one continuous hedge of flower spikes on a low mound. The rows run down the slope toward the farmhouse, with bare furrows between them.

- **Painted as a height field.** Each column of the frame is swept from the horizon down. Every strip of ground under a hedge raises a column of the hedge's height over itself, and the nearer column overwrites the farther. Each column is a little taller or shorter than its neighbours, which gives the hedge a ragged top.
  - A hedge is 0.72 of a row wide (`HW` 0.36) and 0.3 of a row high (`HR`).
  - Across a hedge, `s` runs from -1 at its left foot to 1 at its right. The mound faces up at the crest and sideways down its flanks.
- **The parts of a hedge** (`zoneOf`):
  - the crest (`top`);
  - the flank toward the light (`lit`);
  - the flank half in shade (`body`);
  - the deep shade (`deep`): the face toward the viewer, and anything the rows on the light's side shade;
  - near rows only: short grey-green stems at the foot (`stem`).
- **Row shadows.** The light drops `slope` per row across, from `L`'s upward and sideways parts. A table (`SH`) gives the height of a row's shadow edge at each distance on the side away from the light. A point is shaded when it lies under the shadow edge of any of the next three rows on the light's side. The bare ground uses the same test.
- **Textures.** Each part of a hedge in each distance band is a pattern tile (`makeTile`, `TILE_BANDS`), stroked into the runs of that part. A tile is a base colour with a dense comb of short vertical spike strokes, each under a lighter head. The tiles are in `userSpaceOnUse`, aligned to the cells, so the spikes stand straight across runs.
  - near: 11 x 14 cells, spikes 3 to 6 cells;
  - mid: 9 x 9 cells, spikes 2 to 3 cells, one haze step;
  - far: 7 x 6 cells, spikes 1 to 2 cells, two haze steps.
  - Day uses 9 tiles, sunset 12 and night 8.
- **Distance bands.** Nearer than 20 rows from the horizon the rows merge into one fine striped texture: the far tile, paler, pinker at sunset and lower in contrast. Then come the mid rows (to about 55 rows) and the near rows. The band edges are noisy, so no line shows between them.
- **Spikes along the top.** Over each hedge's top edge stand single spikes, 1 cell wide: 2 to 5 cells tall in the near rows and 1 to 2 in the mid rows. Their heads are lit (warm in the sunset band), and they stop at anything nearer.
- **Furrows:** bare earth, darkened and cooled where the rows' shadows fall. The two rocks stand in a clearing in the rows on the left.

### Planes and value

The planes, back to front:

1. the sky;
2. the far range (hazed);
3. the massif;
4. the valley floor, the lake and the foothills;
5. the far field texture;
6. the mid-distance rows (paler);
7. the near rows;
8. the knoll and tree.

The darkest darks are in the nearest plane: the hedges' deep faces, the backlit knoll and the tree. The brightest lights at sunset and night are the near crests and spike tips, plus the sun, the snow and the moon.

### Light checks

`debug.mjs` writes two files per moment:

- `out/debug/<moment>-value.png`: the picture as luminance, and under it the same in four value groups.
  - day: sky and lit snow light; valley mid-light; the hedges mid, with light crests; deep faces dark.
  - sunset: lit faces and sky light; valley mid; the rows mid with light crests, the deep faces and furrows dark.
  - night: the moon, the windows and the lit snow light; everything else dark, with mid crests.
- `out/debug/<moment>-light.png`: a yellow arrow along the key light, and cyan arrows from the foot of the house, the field rocks and two near hedges to where their shadows must fall.

Close-ups of the near field at 2x are in `out/debug/<moment>-near-2x.png`.

All three were checked: every lit side faces the arrow, every shadow runs the way its probe points, and the near field reads as lavender in each moment.

## The scene, back to front

1. **Sky.**
   - A banded ramp that bulges up around the sun or moon.
   - Sunset: five rays and the sun.
   - Night: stars and the moon.
2. **Back clouds**, four of them.
3. **Far range:** flat and hazed, its summits rock. Its foot sinks into the mist (`foot` 0.45).
4. **The massif:** six peaks.
   - Facets fan out from each summit, and the summits are rock.
   - Snowfields and rock planes along the ridgelines on the big lit faces; gullies on the smaller ones.
   - Below the snow line there is rock, then dark wood. The foot sinks into the mist over the lowest 30 rows (`foot` 0.9).
5. **A low cloud** in front of the massif.
6. **The valley floor:** rows 100 to 123, each row one colour across the frame, in a six-step gradient from the mist colour at the top to the meadow by the field. The encoder lays the rows as bands and dithers each band into the next.
7. **The lake:** one calm ellipse under the peaks, mirroring them, with ripples.
8. **Foothills:** a wooded hill on the left and a lower one on the right, fading into the same mist toward the valley floor.
9. **Mist:** thirteen thin wisps at the foot of the peaks. Each is a lens thinning to a row at its ends and fraying into a dotted tail, at 55% opacity.
10. **The field:** the hedges, the track, the farmhouse with its cypresses, the night window pool and the two rocks (see "Hedges").
11. **Spikes** along the hedges' tops, in eight wind bands.
12. **The knoll and the tree**, pinned bottom right:
    - three rounded boulders with moss on their tops, sunk in a grassy knoll;
    - grass growing over their feet.
13. **Small life:** florets, butterflies, bees and fireflies.

## What moves

All motion is on `steps()` and a 0.05 s clock, and moves in whole cells. At t = 0 every wind band and the tree's crown are at rest.

| What | How |
| --- | --- |
| Lavender wind | A gust every 9 s sweeps the field in 8 bands, from the far right to the near left, each band 0.4 s after the last. The heads of the near spikes 3 cells or taller lean 2 cells; the other heads and the stalks lean 1. They settle back over 1.85 s. |
| Tree crown | Leans 1 cell as the gust passes it, for 1.3 s in each 9 s. |
| Clouds | Five clouds drift 8 to 14 cells and back, a cell at a time, over 60 to 90 s. |
| Mist | Drifts 6 cells and back over 50 s. |
| Lake ripples | Three sets of ripple streaks take turns, 1.2 s each. |
| Butterflies (day, sunset) | Three white butterflies cross right to left, a cell every 0.25 or 0.3 s (cycles of 95 and 114 s). They bob 3 cells and beat their wings every 0.4 to 0.5 s. |
| Bees (day, sunset) | Three bees hop a cell at a time around a spike, in a 6 s loop. |
| Florets (day, sunset) | Nine florets blow 216 cells to the left over 10.8 s of an 18 s cycle. They fade in and out at the ends and bob 3 cells. |
| Rays (sunset) | Five rays at 20% opacity breathe between full and 45%, in steps over 24 s. |
| Stars (night) | Twelve stars dim in two steps to 40% and back for about a second, every 5, 10 or 15 s. |
| Fireflies (night) | Sixteen fireflies glow up and fade over 5 to 8 s, drifting 4 cells over 9 to 13 s. |

With reduced motion on, `@media (prefers-reduced-motion:reduce){:root *{animation:none!important}}` stops everything, and the scene rests on its first frame.

## Size and player check

| | day | sunset | night |
| --- | --- | --- | --- |
After the hairline fix (round 3 in brackets):

| | day | sunset | night |
| --- | --- | --- | --- |
| SVG characters | 124,225 (113,303) | 125,887 (125,821) | 126,069 (122,671) |
| After the app's scrub (estimate) | ~124,039 | ~126,008 | ~127,159 |
| Hedge tiles | 9 | 12 | 8 |
| Encoder patterns | 5 | 6 | 7 |
| Runs | 13,579 | 13,313 | 13,921 |
| CSS characters | 4,910 | 5,137 | 3,525 |

The aim is 128,000 characters, and the hard limit after the scrub is 131,072. To fit, colours of a layer within 4 levels of a commoner one (6 at sunset, every channel) were merged into it.

`player-check.mjs` (`sunfield/tools/`) ends with `PLAYS: the app would run its motion` for all three. Last run, at 1536 x 864 @1.25x on the RTX 4070 Laptop GPU, against a limit of 5.56 ms:

| | day | sunset | night |
| --- | --- | --- | --- |
| Window 1 average | 1.45 ms | 1.55 ms | 1.42 ms |
| Window 2 average | 3.75 ms | 4.13 ms | 3.64 ms |
| Worst frame | 7.7 ms | 6.8 ms | 10.6 ms |

On the same run the round-3 SVGs read about 2.75 ms in window 2, so the fix costs about 1 to 1.4 ms a frame. Most of that is the second coat on the spike tips and the clouds (see "Encoding and hairlines").

## Rules

- **Root:** the same as Sunfield's: `<svg xmlns fill='none' font-family='a' color='a' style='--m:0s'>`, single quotes throughout.
- **Parts:** nested `<svg viewBox='0 -.5 320 200' preserveAspectRatio='… slice'>` views.
  - Pinned bottom centre (`xMidYMax`): everything except the outcrop.
  - Pinned bottom right (`xMaxYMax`): the knoll, the tree and the crown.
  - At 16:9 rows 0 to 19 are cut off at the top.
- **Elements:** `svg`, `style`, `defs`, `pattern`, `rect`, `path`, `g`, and `use` for the coats (`<use href='#id'/>`). No filters.
- **Checks:** no `shape-rendering`, `vector-effect`, viewport units or `data:`.
  - Every `url()` is `url(#id)`.
  - The only `@media` is reduced motion.
  - Every duration and delay is a multiple of 0.05 s.
  - Every path has at most 64 runs, inside the tiles too.
  - `check.mjs` verifies all of this.
- **Patterns:**
  - Big still layers sit in `width=1 height=1` patterns. Each tile's corner is on a cell corner, with a clear cell all round. Every tile is under 340 cells wide and about 100 rows high.
  - Moving layers are never in a pattern.
  - The hedge tiles are `userSpaceOnUse` patterns that runs stroke with `stroke='url(#T…)'`.

## Encoding and hairlines

Round 3 stroked every run 1.1 cells high to hide the hairlines between paths. That tinted the last pixel row of every cell above an edge, at every size, so it was removed. Runs are 1 cell high now, and each cause of a hairline is fixed where it starts. The picture, the light and the motion are round 3's.

**Every cell layer goes through the local encoder** (`encode-local.mjs`, after Tide Line's):

- A colour is laid under its neighbours' cells only where what lies beneath their edge is far from both (`under`).
- Pieces of one colour are packed into paths whole, with no join between them (L5). A piece too busy for one path, or over 21 rows both ways, is cut into rows. Chromium rounds the corners of bigger path boxes.
- A colour laid under a cell is taken back out where it would show along the cell's other edges more than the join it covers would (L6).

**Pattern tiles.** Big still layers are cached tiles, each with its corner on a cell corner and a clear cell all round. Moving layers are never in a tile: Chromium drew a moving tile a fraction of a pixel apart from frame to frame.

**The field.** The field is one tile, its rows laid as bands under the odd cells:

- **Why a tile.** Drawn as runs every frame, it took player-check past its limit (11 to 12 ms a frame).
- **Height.** The last band runs a row deeper, so the tile is one row taller. Otherwise its wrap pulled that band onto the top row as a line.

At fractional sizes the tile is resampled: a cell blurs about a pixel into its neighbours. `build.mjs` keeps what that blur shows alike:

- **`repaint`:** a cell that shows the same colour as its row's band, or as the paint on its left, takes that paint.
- **`unbleed`:** a hedge-tile cell beside an alike cell, whose texel on the far side of the edge is far from both, is painted plain in its own visible colour. The spike tips count in every pose of the gust (lean1 one cell left, lean2 one and two). A cell a tip covers in every pose is skipped.
- **`coverTips`:** under a resting tip, a field cell far from the tip used to bleed into the cell beside it when that cell is alike to the tip. The cell beside it is now drawn again over the tile, in a plain layer, in the colour it already shows. The picture is the same in every pose, and the tip's edge lies over a crisp edge.

These thresholds are per moment, in the `SEAM` table in `build.mjs`.

**Moving layers** get coats (`<use>` copies): at an edge inside a pixel, what lies beneath shows through less.

| Layer | Coats | Why |
| --- | --- | --- |
| Spike tips | 2 | One coat left 54 to 170 line pixels; three cost about 1 ms a frame for nothing more. |
| Clouds | 2 | One coat put night at 1200 x 780 back to 40. |
| Crown | 1 | A second coat changed nothing. |

With two coats, no colour is laid under a cell on the layer's outer edge (the encoder's `edge` rule). At night the low cloud had its lit colour laid under its dark base, and that showed along the base over the dark foot of the massif.

**Still layers on one pin.** Where a later still layer covers a cell, the earlier one keeps a ring of one cell under every edge of the covering layer, not only its top edge. Without it, the far range and the hills showed the sky between them along their sides.

**Size.** Within a layer, a colour within 4 levels of a commoner one (6 at sunset, every channel) takes the commoner colour.

### Hairline scan

`engine/seamscan.mjs` at its 11 sizes, motion held at T = 0, at T = 37, and at T = 1 (the gust: wind bands 5 to 7 and the crown leaning). Holes are 0 at every size. The line pixels at the worst size (the scan fails above 60):

| | T = 0 | T = 37 | T = 1 |
| --- | --- | --- | --- |
| day | 44 | 47 | 39 |
| sunset | 35 | 39 | 35 |
| night | 25 | 22 | 22 |

- **Whole-pixel sizes** (6, 8 and 9 px a cell) show 0 line pixels.
- **Purity test** (every pixel the colour of its cell's centre): 0 at those sizes, at T = 0 and T = 1.
- **Before the fix:** round 3 failed every size, even 6 px a cell (day 1,130 line pixels there).

### Against round 3

`engine/pixeldiff.mjs` against `out/pre-seam/` at 6 px a cell. Changed pixels are of three kinds:

- **Cell edges:** the first or last pixel row or column of a cell, where the 1.1 stroke used to tint.
- **Merges:** cell interiors that moved at most 4 levels (6 at sunset).
- **Other:** 7 cells in day, 2 at sunset and 4 at night moved 5 to 7 levels. They are by the knoll, on the lake's edge row (108) and the field's top row (127).

## Open issues

- **Not tested in the app.** The scene has only run through player-check's copy of the app code, not in the desktop app itself.
- **No warm soil at sunset.** With the sun 4 degrees up, each row shades about two rows to its right, so no light reaches the furrows and no warm soil shows between the rows. Breaks in the rows (gaps where the light gets through) would let warm soil show, at some cost in size.
- **Left-edge rim.** At sunset the warm rim is on the crests and spike tips. The hedges' left flanks are mid violet, not rimmed.
- **Size margin.** After the scrub, night has about 840 characters left under 128,000, sunset about 2,000 and day about 3,900.
- **Frame time.** player-check reads 3.6 to 4.1 ms a frame against the 5.56 ms limit, up from about 2.75 ms in round 3.
- **Faint lines left.** At fractional sizes up to 47 line pixels remain (day, 1440 x 900 during the gust). They are mostly the tips' edges, about 25 to 40 levels summed.
- **Small life.** Butterflies are 3 cells wide and read as white flecks.
