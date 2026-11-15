# Hill Village

A village runs down a wooded hillside on the left into a valley. The far ridges are layered conifer bands that fade into haze, and the sun sits behind the farthest ridge. Elements:

- **Village:** half-timbered houses with steep roofs, in five rows that step up the hill on terraces.
- **Bell tower:** onion dome and clock, beside the church nave.
- **Trees:** rust, orange and gold.
- **Valley:**
  - a stone bridge over a river that mirrors the sky;
  - a lane with iron lamps;
  - terraced gardens with hedges and pumpkins;
  - haystacks.
- **Framing:**
  - a rust tree on the left edge;
  - a stone wall with a lamp and a cat at bottom right;
  - a leafy branch at top right.

The reference (`_refs/ref-4.webp`) set the mood, the palette family and the quality bar. The composition is my own.

## Build

```
node "prototypes/hill-village/build.mjs"     # out/hill-village-{sunrise,day,night}.svg, out/debug/<moment>-light.json
node "prototypes/hill-village/render.mjs"    # out/hill-village-<moment>.png, 1536x864, as an <img>, motion held at its start
python "prototypes/hill-village/debug.py"    # out/debug/<moment>-values.png and <moment>-light.png
node "prototypes/hill-village/check.mjs"     # encoding rules (size, scrub, units, quotes, media, url, runs, 0.05 s clock, reduced motion)
node "prototypes/hill-village/seams.mjs"     # old 1-px hairline scan (3 sizes); SIZE=WxH DPR=n MARK=1
node "engine/seamscan.mjs" "prototypes/hill-village/out/hill-village-sunrise.svg"     # the 11-size hairline check; T=seconds, SAVE=dir
node "prototypes/hill-village/sizes.mjs" day # where the characters go
```

The moment palettes, rays, bloom and haze are in `moments.mjs`. The key light of each moment and the local lights are `KEYLIGHT` and `LOCAL` at the top of `build.mjs`.

## Light

The light is fixed first, per `_refs/lighting.md`. Every surface is shaded by how squarely it faces the key light. A cell in shadow keeps only the ambient term, which is the cool sky colour and never black.

| Moment | Key light | Direction (x right, y up, z away) | Colour | Shadow colour | Shadows fall |
| --- | --- | --- | --- | --- | --- |
| sunrise | Sun on the far ridge, low right and behind, cell (238, 84) | 0.62, 0.42, 0.67 | `#ffc88a` | `#5a3c7c` violet | Long, left and a little toward us: 2.43 cells left and 0.48 down per cell of height |
| day | Sun high at the upper right, cell (200, 24) | 0.233, 0.778, 0.583 | `#fff4dc` | `#7088b0` | Short, down and left, hugging the base: 0.75 left and 0.23 down per cell of height |
| night | Moon at the upper left, over the big tree, cell (26, 52) | -0.46, 0.82, 0.26 | `#a8b8e0` | `#121a34` | Faint and short, to the right: 0.37 right and 0.1 down per cell of height |

### Rims

Only the edges that face the key light catch a rim. Each outline cell's outward direction is compared with the moment's rim direction (`rim` in `KEYLIGHT`, on screen). An edge turned more than 60 degrees from it gets no rim.

| Moment | Rimmed edges | Rim direction (x right, y down) | Strength |
| --- | --- | --- | --- |
| sunrise | right and upper right | 1, -0.5 | full |
| day | top and right | 0.6, -0.8 | 0.75 of the moment's rim |
| night | left, in cool moonlight | -1, -0.25 | full |

The sun's disc sits at (238, 87) with radius 9. Its bright centre reads at about (237, 69) in a 1536x864 window because of the bottom-pinned crop.

### Sunrise

- **Lit sides:** right walls, right-facing roof planes and the terrace tops take warm light. Rims sit only on right and upper-right edges.
- **Shaded sides:** fronts, left walls, the terrace walls and the far roof planes are violet.
- **Cast shadows:** every house throws a long violet band to the left and toward us, over the gold lawn in front of its row. The longer ones (the gable peaks, the tower, the big trees) run on over the path and drop over the terrace wall onto the terrace below, where they jump further left. Between the bands the lawn stays lit.
- **Casters:** every house, tree, haystack, the lamp, the cart and the bridge cast shadows. The bridge darkens the river below it.

### Night

- **Moon:** the moon sits in the upper-left corner, over the big tree, and rims the left edges in cool blue. It moved there from (64, 40) so that every shadow points away from it, including those of the leftmost houses.
- **Local lights:** lit windows and lamps throw warm pools on the walls around them and on the ground below. Warm light wins near each source.

| Local light | Colour | Reach (cells) | What it lights |
| --- | --- | --- | --- |
| Window | `#ffcf6e` | 4 (5 on the front row) | its wall; a low window also lights the yard below it |
| Lane lamp | `#ffd88a` | 8 | the ground, the houses and the bridge around it |
| Bridge lamp | `#ffe0a0` | 15 | the wall top, the post and the meadow and river bank below |

Each pool falls off in two dithered steps. The bridge lamp's lantern has a round halo: solid next to the glass, then an ordered (4x4 Bayer) dither that thins out to about 8.5 cells, warm near and dim far.

### Shadows

Each moment's light direction gives a ray per unit of height.

- **Casters:** every object that throws a shadow is registered as a shape: a house box with its roof, a tree crown ellipsoid, a conifer cone, a lamp post, the bridge minus its arch, the tower box with its dome and spike. The hill itself is a caster too: a ray that passes under the ground behind a terrace wall is blocked.
- **Terrace heights:** each terrace wall lifts the ground behind it by its height. The bottom terrace, the meadow, the stream and the bridge are at 0. The terraces of the house rows are 3, 6 and 8 cells up, and every house, tree, lamp and the church stands at its terrace's height. A shadow that reaches a wall's edge drops to the terrace below and lands further from its caster, so it bends over the edge.
- **Visibility:** a cell is shadowed when its ray toward the light hits a caster. Three slightly turned rays give a soft edge.
- **Shading:** a shadowed cell gets the ambient term only, so a shadow is a darker, cooler version of the surface it falls on. On the ground a cell is either lit or in shadow, and the soft far edge is a dither of the two.
- **Edges:** shadows are hard near the object and break up farther out.
- **Contact:** every house, haystack, the lamp and the cart has a dark seam at its foot. Every terrace wall has a dark seam where it meets the ground below.

### Space

The village has six planes plus the sky:

1. far ridges in haze;
2. the valley floor, river and bridge;
3. the hill's terraces;
4. the house rows;
5. the lane, wall and lamp;
6. the framing tree and branch.

Each house row stands on a terrace:

- **Top:** one calm plane of dry grass, lit or in shadow and nothing else. It has 3 to 4 rows of open lawn in front of the houses for their shadows to fall on.
- **Path:** a 2-row ribbon of packed earth along the front edge.
- **Wall:** 2 or 3 rows dropping to the next terrace, a shaded stone face with a few joints and a dark seam at its foot.

So the tops are lit and the risers are in shade, which gives the hill its form. Kitchen gardens sit only on open terrace tops. The back rows are smaller and hazier, and the rows overlap.

### The bridge lamp

The bridge lamp is a straight post with:

- a plinth;
- a collar;
- a crossbar with drops;
- a framed lantern with four panes and a cap and finial.

It is lit on the sun side. At night it throws a pool on the wall, the post and the meadow.

### Debug renders (`out/debug/`)

- **`<moment>-values.png`:** luminance only.
- **`<moment>-light.png`:** the picture with the key light circled and six named buildings marked, far to near: the tower and five houses (far right, middle left, middle centre, near left, near centre). Each has a dot on its base, under its highest point, and an arrow to where that point's shadow lands. The arrow follows the ray down over the terrace walls.
- **`<moment>-light.json`:** the light position, the screen shadow vector and the six marks. Each mark gives:
  - its base, the shadow's end and the height;
  - `away`: whether the arrow points away from the light's disc;
  - `shadowed`: how much of the ground along the arrow, past the building, the build has in shadow.
- **`<moment>-crop2x.png`:** the village centre at 2x (crop x 150-850, y 420-820 of the 1536x864 render, scaled up by whole pixels).

`python debug.py` prints the marks. In all three moments all six point away from the light, and the ground along each arrow is 100% in shadow.

## Moments

| Moment | Look |
| --- | --- |
| sunrise | Peach and gold sky. The sun sits on the far ridge with 6 rays down the valley and 3 up. The light comes from behind, so the village has rims and long violet shadows. Warm bloom and valley mist lit from behind. |
| day | High sun, blue sky, white clouds, 4 soft rays and cool haze. Short shadows, and the same sides are lit with less contrast. |
| night | Moon and stars, a cool blue valley. Moon rims on the left, and warm pools under the windows and lamps. |

## What moves

Everything runs on CSS animations with `steps()`. Every duration, delay and step falls on the 0.05 s clock. The `--m` root clock offsets every delay, and the reduced-motion rule stops all of it.

| Element | Motion | Timing | Moments |
| --- | --- | --- | --- |
| Clouds (7) | Drift 3-6 cells and back | 44-70 s | all |
| Mist bands (3) | Drift 8 cells and back | 36-48 s | all |
| Chimney smoke (4 chimneys, 3 puffs each) | Puffs rise, drift with the wind and fade | 9 s | all |
| Sun rays (9 at sunrise, 4 by day) | Breathe in opacity | 9-17 s | sunrise, day |
| River glints (3) | Brief sparkle | 4 s | all |
| Falling leaves (4 from the branch, 3 from the left tree) | Two-frame tumble with sway | 36-37 s fall cycles; sway 4 s | all |
| Birds (flock of 5) | Two-frame wing beat while crossing the sky | 90 s cycle | sunrise, day |
| Horse cart | Crosses the bridge one cell every 0.3 s and bumps over the arch; two-frame legs; casts a shadow on the road | 96 s cycle (about 50 s of travel); legs 0.6 s | all; lantern at night |
| Cat on the wall | Tail swish | 7 s | all |
| Stars (12) | Slow twinkle | 5-20 s | night |
| Bridge lamp halo | Outer rings breathe in opacity, 20 steps | 6 s | night |

Leaves, birds and the cart spend part of each cycle off screen or hidden, so the first frame is a finished picture.

## Encoding and hairlines

A hairline is a 1-px line where two cells meet inside a screen pixel and what lies under both shows through. The scene passes `engine/seamscan.mjs` at all 11 sizes, with at most 34 stray line pixels against a limit of 60 (see Seams). The 2026-11-15 pass changed only the encoding; `seamfix-log.md` has its steps.

`encode.mjs` writes the scene:

- **Cell layers:** every one goes through `emitSafe` in `encode-local.mjs`, a copy of Tide Line's local encoder (T 28, row cap at 21 rows, overlapping split paths). Colours are joined under one another, so the colour under an edge is one of its two sides.
- **Edges of still layers:** the `'near'` edge mode, added here, has two parts:
  - the backing stays off outer cells far from it;
  - a colour is joined under an outer cell only when it is within T of that cell.
  - Why: still layers are drawn as pattern tiles, and a tile's bitmap lands at a fractional screen offset. So even edges on whole pixels blur, and anything laid under an outer cell shows along the outside. Example: the lamp light under the lamp head's dark cells showed as a light line above it.
- **Edges of moving layers:** clouds, mist, smoke, birds, the cart and the leaves get the full `edge`. Nothing lies under their outer cells, since the sky outside a cloud's rim is close to the rim's colour.
- **Moving layers:** each is drawn in two coats, the second a `<use>` of the first inside the same animated group.
- **Fading layers:** glints, star and window twinkles, the lamp halo and the cat's tail only fade in place (classes `gl`, `lb`, `tk`, `ta`, `tb`). They drop the cells a still layer above covers, because those cells' edges traced the cover as light outlines.
- **Pattern tiles:** each tile's corner sits on a cell corner, with a clear cell all round. The widest tile is 322 cells.
  - Patterns stay: drawn in place, the same scene took 8.4 ms a frame, which is STILL.
- **Cull:** a still cell under a still layer above is dropped only when all four of its neighbours are covered too. So a cell of the layer below lies under every edge of the one above.
- **Kept from before:**
  - colour merge within 12, summed over R, G and B;
  - full-row bands;
  - one list per viewport;
  - the same-colour tuck.
- **Removed:** the old skirts, backing peek and `seamfix.json` pairs. They covered three sizes only, and one pair had painted a neighbour's colour over a cell.
- **Options:** environment switches for tests: `EDGE`, `RING`, `FIXED`, `COATS`, `ERODE`, `SAFE_T`, `MERGE` and `TUCK`. Debug switches: `CELLS='x,y ...'` prints each layer's colour at those cells, and `PATS=1` maps pattern ids to layers.

## Sizes

| Moment | Characters | After the app's scrub |
| --- | --- | --- |
| sunrise | 125,375 | 127,174 |
| day | 114,926 | 116,125 |
| night | 114,266 | 115,343 |

All three are under 128,000, both as written and after the scrub.

## Player check

`sunfield/tools/player-check.mjs` reports PLAYS for all three. It ran at 1536x864 @1.25x on an RTX 4070 Laptop with D3D11, against a limit of 5.56 ms. These numbers are noisy because other agents share the GPU.

| Moment | Window 1 | Window 2 |
| --- | --- | --- |
| sunrise | 1.83 ms avg (19.1 ms worst) | 2.03 ms avg |
| day | 2.17 ms avg (40.2 ms worst) | 1.97 ms avg |
| night | 2.12 ms avg (24.9 ms worst) | 1.85 ms avg |

## Seams

`engine/seamscan.mjs` checks 11 sizes, from 1200x780 to 2560x1440, at 1x to 2x. It fails a size at more than 60 line pixels or any hole. The table gives the most line pixels over those sizes. No size has a hole.

| Moment | T=0 | T=37 | T=12 (cart on the bridge, birds out) |
| --- | --- | --- | --- |
| sunrise | 33 (1366x768 @1x) | 33 | 34 |
| day | 19 (1680x1050 @1x) | 19 | 19 |
| night | 26 (1536x864 @1x) | 28 | 29 |

Before this pass the counts at T=0 were 253 for sunrise, 72 for day and 46 for night.

`engine/pixeldiff.mjs` compared the picture with `out/pre-seam/` at whole-pixel sizes:

- day is unchanged;
- sunrise changes one cell, at (74, 144) next to a house, which now shows its painted colour;
- night changes 112 single pixels at cell corners along the river banks, each by at most 6 levels.

`seams.mjs` is the older scanner (three sizes, lines of 6 px or longer).

## Rules

`check.mjs` reports ok for all three moments:

- single quotes;
- no `shape-rendering` or `vector-effect`;
- no viewport units;
- `url(#id)` only;
- the only `@media` is reduced motion;
- at most 64 runs per path;
- every time on the 0.05 s clock.

The scene uses no filters. Light comes from:

- gradients: radial bloom and sun rays, linear haze and the sky base;
- one clip path, which hides the cart outside the bridge span.

### Rule breaks and notes

- **Gradients:** I used gradients in place of filters for bloom, rays and haze. The rays are stepped outlines filled by a gradient, so they keep the pixel look.
- **Corner layers:** the left tree, the wall and the branch are drawn in their own corner-pinned viewports (pBL, pBR, pTR). The valley sits in the bottom-pinned viewport.

## Open issues

- **Size:** sunrise is about 0.8K under 128,000 after the scrub, so there is little room for more art.
- **Sunrise shadows overlap:** the shadows are 2 to 3 times as long as the houses are tall, and the houses stand closer together than that. Each band runs into the next house's shadow, so the lit lawn shows as wedges between bands rather than around separate shapes.
- **Other window sizes:** each of the 11 scanned sizes still shows 0 to 34 single line pixels, mostly at cell corners and the cloud rims. Untested sizes should look the same.
- **Small details:** the haystacks and the cart read as small at 1x.
- **Not tested in the app:** the scenes have not been loaded in the real app. Player-check and the `<img>` renders stand in for it.
