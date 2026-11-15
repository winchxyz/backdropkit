# Moon Keep

A gothic castle of spires and buttresses stands on a crag under a huge full moon, in a cold blue night.

- **Left:** a hill with a winding path, a lamp post, broken walls and a gate with a hanging lantern at the bridgehead.
- **Middle:** a stone bridge with lanterns crosses a gorge filled with fog.
- **Front:** a red meadow with a gravestone, a fallen column, its capital and a broken pillar.
- **Frame:** crimson trees on both sides.
- **Far back:** a far keep in haze and a hazy ridge.

The layout is not the reference's. Here the moon is left of centre and the castle stands right on a crag across a gorge. In the reference the castle sits on the left and the moon on the right. There is no character.

- `node build.mjs` writes `out/moon-keep.svg` and prints its size. `STATS=1` lists the costliest layers, and `STATS=2` lists the parts of the merged ones. `STATS=cmp` compares the encoders per layer. `ENC=old` builds the encoding from before the hairline fix.
- `node render.mjs` writes `out/moon-keep.png`: 1536 x 864, drawn as the app draws it (an `<img>` of the SVG, GPU raster), with every animation held at its start.
  - `T=31` draws 31 s in.
  - `SIZE`, `DPR` and `CROP`/`ZOOM` cut out details.
- `node debug.mjs` writes the two lighting checks from `_refs/lighting.md` into `out/debug/`:
  - `value.png`: luminance only.
  - `light.png`: a ray from the moon to each solid, and a magenta arrow where its shadow should fall.
- `node check.mjs` checks the rules (see Rules).
- `node seams.mjs` scans for 1-px lines. `CASES` sets the window sizes and `T` the moment.
- The painting tools come from Sunfield by path (`../../../sunfield/tools/pixel.mjs`, `painters.mjs`). Nothing under `sunfield/` was changed.

## Light

The constants are at the top of `build.mjs` (`KEY`, `shadowRun`, `LAMPS`, `WARM_POOL`).

- **Key light:** the full moon, in the frame left of centre at cell (112, 62). The review's "about (112, 40)" is the same moon: at 16:9 the top 20 rows are cropped, so it shows about 40 rows below the window's top edge.
  - It is high and behind the scene, so everything is backlit from the upper left.
  - Moonlight is a cold blue-white (`#dce4f8`).
  - Shadows are deep blue (`#141a3a`), never black or grey.
- **Where the light falls:**
  - Planes turned toward the moon take a cold rim:
    - the left faces of the castle, its towers and spires, the crag buttresses and the bridge piers;
    - the right side of the left tree's trunk and the left side of the right one's;
    - the moon side of every stone and ruin.
  - The far sides fall two or more ramp steps darker, into deep blue.
- **Where the shadows fall:** away from the moon along the ground and toward the viewer. They are short and faint under a high moon.
  - Objects right of x 112 throw their shadows down and to the right, and the shift grows the further right they stand.
  - In the castle, each nearer plane shades the plane behind it for 3 cells to its right.
- **Local lights:** warm (`#e08a40`), each with a reach in cells:
  - the hill lamp post (12);
  - the gate lantern (9);
  - the two bridge lanterns (11 each);
  - the lit windows, rose window, portal and gate.

## Form, shadows and warm light

- **Castle:**
  - Every square tower and wall has a lit side face toward the moon (the left 20%, up to 3 cells) and a shadow face on the far side. Round towers shade from lit to dark across.
  - Every spire, roof and gable is two planes: the left lit, the right in shadow.
  - Pinnacles have a lit and a shadow side.
  - Each plane behind is shaded by the nearer planes for 3 cells to their right.
  - Each lit window throws a warm pool on the wall below it and a little to its sides, in two steps with a dithered edge. The gate does the same on the wall and the crag top under it.
- **Crag:** leaning buttresses of rock, each with two planes:
  - the plane toward the moon is lit, with a bright ridge on its left edge;
  - the plane turned away is in deep blue shadow, with a dark crack where the next buttress begins;
  - the rock darkens in two steps toward the foot, where the fog sits.
  - The earlier ledges looked like masonry and are gone.
- **Hill:** six knolls, each lit by its slope toward the moon: cool rose on the sides that face it, falling into shadow toward the mist. The bands are Bayer-dithered (0.16).
  - Tufts and loose stones line the path.
  - The lamp post warms the path, the grass round it and its own post.
  - The ruined walls are lit on the moon side and dark on the other.
- **Bridge:**
  - Each pier has a lit face toward the moon and a shadow side, and darkens down into the fog.
  - The lanterns warm the parapet, the posts and the deck round them.
  - The piers throw shadows into the fog in front of them: darker shafts falling toward the viewer and slightly right, dithered out with distance, see-through over the mist.
- **Stones in the meadow:** the gravestone, column, capital and pillar each have:
  - a lit side toward the moon and a dark blue far side;
  - a dark contact seam where they meet the grass;
  - a short, faint plum-blue cast shadow falling down and to the right, hard near the stone and dithered far from it.
- **Trees:** the bark has a cold moon rim on the side facing the moon, over a dark trunk in shadow. The trunks stand on the bottom edge, so their cast shadows (toward the viewer) fall outside the frame.

## Lamps and the gate (redrawn)

- **Bridgehead gate:** two equal straight posts, 3 cells wide, at x 97–99 and 109–111. A two-row lintel and a cornice run across the top. The lantern hangs on a short chain from the lintel's centre (x 104).
- **Hill lamp post:** one straight post on a stepped foot with a contact shadow. The lantern sits centred on top: finial, roof, two glass cells, and a frame lit on the moon side.
- **Bridge lanterns:** the same lantern, centred on the parapet posts at x 133 and 161.

## What moves

Everything moves in whole cells, on `steps()`, on the 0.05 s clock. Every delay is `calc(... + var(--m))`.

| What | How |
| --- | --- |
| Wisps over the moon | One 320-cell tile slides right, 1 cell per 0.8 s (256 s cycle), and crosses the moon. |
| Cloud banks | The high bank drifts 6 cells and back over 90 s. The bank under the moon drifts 4 cells and back over 70 s. |
| Mist | The far valley strip and the gorge bank slide right, 1 cell per 1.2 s. The hollow bank slides left, 1 cell per 0.9 s. The tiles repeat every 160, 128 and 96 cells. The pier shadows stay put while the fog flows through them. |
| Lamps (4) | Each halo breathes slowly between 60% and 100% in 20 steps, on 8, 9 or 10 s cycles, out of phase. Windows and the warm pools stay steady. Nothing flickers. |
| Bats (4) | They circle the spires on two shared orbits (24 x 8 and 14 x 6 cells), on 9.6 s and 8 s cycles. Two fly loops, with their y on half the period. Wings beat every 0.3 to 0.5 s (two frames). |
| Bat depth | The first bat circles the central spire in depth. On the far (upper) half of its orbit, a copy of the spire cells it crosses (x 224–256, y 28–39) shows over it, so it passes behind the spires. The copy toggles at 25% and 75% of the orbit, when the bat is clear of the spire. |
| Falling leaves (6) | They let go of the canopies and fall 1 cell per 0.3 s (50 to 53 s), drifting 8 to 24 cells with the wind and turning over every 1 to 1.4 s. Each is below the grid before it starts again. |
| Grass | Blade tips sway 1 cell in 8 bands across the field, on a 5 s cycle, out of phase, so a gust runs left to right. |
| Leaf clumps (13) | Each sways 1 cell, on a 7 to 9 s cycle. |

The first frame is a finished picture. With the motion scrubbed or reduced, the bats sit at their orbit centres with their wings up and the leaves sit in the canopies. `@media (prefers-reduced-motion:reduce){:root *{animation:none!important}}` stops everything.

## Size and player check

- **SVG:** 129,929 characters (before the hairline fix: 129,094). The build estimates 130,066 after the app's scrub. The limit is 131,072; the build fails within 200 of it (130,872).
  - Round 1 was 119,888 characters; round 2 (hill, crag, bat depth) was 127,483.
  - The light pass added the form shading, warm pools, cast and contact shadows, and pier shadows. The big castle layer also needs its backing again: without it the sky showed through as light 1-px lines at 1536 x 864, and the backing costs about 300 runs.
  - To pay for it, these went:
    - the hill's dither, cut from 0.28 to 0.16 (about 3.6 KB);
    - the crag's ledges;
    - the scattered low tufts in the meadow;
    - a small cloud hidden behind the left tree;
    - one falling leaf.
- **Patterns:** 34 hold 12,474 runs. 321 runs are plain paths. The CSS is 4,634 characters.
- **`player-check.mjs`** ends with `PLAYS: the app would run its motion`. Last run, at 1536 x 864 @1.25x on the RTX 4070 (D3D11):
  - window 1: 1.13 ms average (15.1 ms worst);
  - window 2: 1.46 ms average (2.7 ms worst).
  - The limit is 5.56 ms. Other agents were working on the machine at the same time.

## Encoding and hairlines

At any window where a cell is not a whole number of pixels, the scene showed 1-px lines (`engine/README.md`). Before the fix, `seamscan` found up to 2,876 line pixels a size (1278 x 719 @1.25), and 600 to 965 at the common laptop sizes. Only the owner's window (6 px a cell) was clean.

What caused them, and what fixed each:

- **The mist strips (most of it).** A strip's pattern tile was exactly as tall as its rect, and a pattern repeats down too. Where the rect's top or bottom edge fell inside a pixel, the tile's other edge row bled in: a line of mist along the whole strip. `tiled()` now makes the tile span the strip's rows plus a clear row above and below, with the rect and the tile on the same rows (2,876 down to about 700).
- **Colours inside a layer, and the joins of one colour's paths.** Every cell layer is written by `emitSafe` from Moon Keep's copy of the engine encoder, `encode.mjs` (the engine is shared, so the changes live here; its header lists them). Each colour lies under the neighbouring cells of colours drawn after it, and a colour's chunks overlap where they meet. The copy adds:
  - `bridge`: a colour fills row gaps that only later colours cover, which writes shorter;
  - `joinAll`: chunks always overlap, also for colours near the backing (with a higher T those joins showed);
  - `order: 'both'`: tries darkest first and largest first, and keeps the shorter;
  - `edge` and `corners` (from Low Orbit): no backing under outer-edge cells far from it, and the earliest colour covers a four-colour corner. They changed the scan very little and made the scene about 640 characters smaller, so they stay.
  - The `SAFE=1` gate is gone: this is the only encoding.
- **Colours a step apart.** `mergeNear()` makes colours within 6 levels (mean channel) one colour inside a layer, keeping the commonest. That step cannot be seen, and it removes edges. The bridgehead gate, its lintel and hanging lantern, the lamp post and the bridge lanterns keep their colours exactly (`KEEP`).
- **Abutting layers and parts.** `cull()` drops still cells hidden under a later still layer, but keeps a one-cell margin under the upper layer's edge.
- **Edges against a lower layer of the same colour.** Where a cell meets a lower layer's cell of nearly its colour, the edge pixel showed whatever lay under its own cell: a line between two cells of one colour. Carrying the lower cell under the upper one would show wherever the parts do not line up (moving parts, and the corner-pinned trees in windows narrower than 16:10). So the upper cell carries a lip: a stroke half a cell wide, of its own colour, along that edge (`lipsOf()`, 218 lips). A lip is laid only where everything that can show under its far half is within 6 levels of it, including every place a moving part below can stand. A moving layer's lips judge the moving layers below at rest.
- **Moving layers.** The grass tips and leaf clumps move a cell, so no exact fix holds in every frame. Each moving layer is drawn three times (`<use>`, after Deep Reef): where its edge falls inside a pixel, what lies beneath shows by (1 - f)^3 instead of 1 - f. Whole cells do not change.
- **Soft corners.** Chromium's GPU raster rounds and blurs the cell corners of a path whose screen box is square-ish and middling, even at 6 px a cell. Before the fix the moon had them at the owner's window (304 impure cells); the new encoding gave them to the trees as well. The encoder now closes a path before its box becomes one (short side 24 cells or more, long side 60 or less, ratio under 1.7): 0 impure cells at 6 and 8 px a cell.

Tried and dropped:

- Terraces (each colour under every lighter cell): far longer than `emitSafe` on every layer here (the castle 156k characters against 26k).
- Lips only where they hold at every place of every moving part: too few (12), and worse everywhere.
- Lips for each place a moving layer stands at, shown by an opacity animation on the layer's own clock: good (T=0 at most 22), but 135,042 characters, 4.2 KB over the limit. `PLACED=1` builds it.

Results (`node engine/seamscan.mjs prototypes/moon-keep/out/moon-keep.svg`, the most line pixels at any of the 11 sizes; a size fails over 60; no holes anywhere):

| Moment | Before | Now | Worst size now |
| --- | --- | --- | --- |
| 0 s | 2,876 | 31 | 1200 x 780 @1.25 |
| 4.8 s | | 23 | 1366 x 768, 1680 x 1050 |
| 37 s | | 59 | 1200 x 780 @1.25 |
| 128.4 s (the wisps half way) | | 47 | 1200 x 780 @1.25 |

The owner's window, 1920 x 1080, 1280 x 720 @1.5 and 2560 x 1440 show 0 at every moment. Crops of the worst spot at each size (`SAVE=out/seams`, at 0 s) are in `out/seams/`.

`pixeldiff` against `out/pre-seam/` at 6 px a cell: no pixel changes by more than 6 levels except single corner pixels of the moon's cells, which were rounded before and are square now (`out/pixeldiff18-1920.png`, TOL=18). The areas marked in `out/pixeldiff-1920.png` (TOL=6) are the merged colours, at most 6 levels. The gate, the lamp post and the bridge lanterns do not change at all.

What is left: short lines of 4 px or less at fractional sizes, where a moving part crosses an edge of another (leaf clumps over clumps, the high cloud's lower edge, the grass), and where the corner-pinned trees meet the middle part in windows narrower than 16:10.

## Rules

- **Root:** as Sunfield's: single quotes, `font-family='a' color='a'`, `--m:0s` clock.
- **Pins:** each part is a nested `<svg viewBox='0 -.5 320 200' preserveAspectRatio='… slice'>`, pinned bottom-centre, bottom-left (left tree) or bottom-right (right tree).
- **Elements:** `svg`, `g`, `style`, `defs`, `pattern`, `rect`, `path`, `use` (the second and third draw of each moving layer). There are no filters.
- **`check.mjs` reports ok:**
  - no `shape-rendering`, `vector-effect`, viewport units or double quotes;
  - every `url()` is `url(#id)`, and the only `@media` is reduced motion;
  - at most 64 runs per path;
  - every duration, delay, keyframe and step of every animated group lands on the 0.05 s clock, with inherited custom properties resolved.
- **Opacity:** lamp breathing (single steps, 0.4 to 0.5 s apart), the wing and leaf frame swaps, the spire copy (twice per 9.6 s), and fixed `opacity` attributes on the mist, halo and pier-shadow groups. The wing frames swap up to 6 times a second, but a bat is 7 x 2 cells: well under a pixel of the player's 64 x 40 detector canvas.
- **Seams:** see Encoding and hairlines.
  - Pattern tiles keep a clear one-cell margin; the sliding strips keep a clear row above and below.
  - The two clouds over the moon are drawn plain (no backing), because a backing showed as a line at their lit edges against the moon.
  - Window glass is undithered.

## Open issues

- **Hairlines:** a few short, faint ones are left at fractional sizes (at most 59 line pixels a size, at 1200 x 780 37 s in; see Encoding and hairlines).
- **Meadow shadows:** they are faint, as a high moon gives, and the dark red ground keeps them subtle. The tree trunks' shadows fall out of frame.
- **Bats:** only the first bat passes behind the spires.
- **Size:** about 0.8 KB is left under the build limit (scrubbed estimate 130,066 of 130,872).
- **Fog banks:** their billow tops repeat every 128 and 96 cells.
- **16:9 crop:** windows at 16:9 crop rows 0 to 19, so the tops of the tree canopies are cut.
- **Untested in the app:** the scene has not been run in the desktop app itself. Only the cached app code ran, through `player-check`.
