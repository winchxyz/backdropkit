# Cloud Sea

A grassy cliff top high above a sea of clouds. Six banks of cloud roll out to the horizon. Rock spires stand up through them: a tall near one at the left, a cluster in the middle distance, and a far snowy range behind. On the right, the ground rises into a knoll with a windswept tree and a cairn. The reference set the mood, the palette family and the quality bar. The layout is my own:

- the sun sits right of centre;
- there is no big cliff wall;
- the tree and cairn stand on a low knoll;
- the near spire is at the left.

- `node build.mjs` writes `out/cloud-sea-{day,sunset,night}.svg` and prints each size, the app-scrub estimate, the pattern count and the run count.
- `node render.mjs [moments]` writes `out/cloud-sea-<moment>.png` at 1536 x 864. It draws the picture as an `<img>` of the SVG on the GPU raster, with every animation held at its start.
  - `T=12` draws 12 s in.
  - `SIZE`, `DPR` and `CROP`/`ZOOM` cut out details.
  - Anything other than the plain start frame goes to `out/frames/`.
- `node seams.mjs [moments]` draws each SVG over black and over white at 1536 x 864 @1x, at @1.25x, and at 1366 x 768. It counts see-through pixels and 1-px dark lines. `T=` checks a later moment.
- `node check.mjs` runs the rule check:
  - size;
  - the element and attribute whitelist;
  - banned properties, viewport units, quotes, `@media` and `url()`;
  - runs per path and filtered groups;
  - the 0.05 s clock, which includes every keyframe stop multiplied by each duration it runs at.
- The painting tools come from Sunfield by path (`../../../sunfield/tools/pixel.mjs`, `painters.mjs`). Nothing outside this folder was changed.
- The colours and light for each moment are in `moments.mjs`. The drawing is the same in all three.

## Planes, back to front

1. Sky: hard-stepped row bands with a glow around the sun or moon. Night adds stars and the moon. Sunset adds the sun on the cloud horizon with eight rays.
2. High streak clouds, five of them. At sunset they are lit from below.
3. The far range, with snow and rim light.
4. Six cloud planes, from thin far lines to big near heaps. Each plane is made of:
   - cumulus heaps;
   - a carpet of billows on an undulating floor;
   - deep shade below that floor.

   The near plane is drawn differently, so it reads as soft cloud rather than stones:
   - Its billows are fewer and larger, at one level only. Their radius is 10 to 16 cells, about 1.5 to 2 times the lumps of the plane behind.
   - Wrapped light gives no dark edge or crease, so neighbouring billows merge.
   - Each body falls off into a cool underside with Bayer dithering (`near` ramp in `moments.mjs`).
   - Only tops facing the light get the lit rim.

   The spires stand between the planes at their own depths. A still sheen of sun or moon light lies on plane 3, behind plane 4 (sunset and night only). The birds fly between planes 5 and 6.
5. Four rising wisps of mist. Each is a soft cluster of five blobs whose fields add up, so they melt into one mass. Core, body and fringe sit at 100%, 65% and 30% opacity, so the edge fades instead of ending on a line.
6. The ground. On the left it is a low grassy rim. On the right it rises into the knoll, with turf swells, lighter and darker grass patches, the tree's shadow, nine sunk pebbles, and small flowers in clusters (day and sunset).
7. Then come the rocks, the cairn, the grass clumps and the tree.

The light comes from the sun or moon. It sets the rim side of every spire, rock, cairn stone and tree pad:

- day: deep blue sky, white sea;
- sunset: backlit, with gold tops, violet undersides and a dark silhouetted tree;
- night: navy sky, silver sea, stars.

## What moves

All motion moves in whole cells on `steps()`, on the 0.05 s clock. At t = 0 everything sits where it is painted, so the first frame is the finished picture.

| What | How |
| --- | --- |
| Cloud planes, 6 | Each rolls left as a tiled band, one cell per step. From back to front a step takes 6, 4, 2.6, 1.7, 1.1 and 0.7 s, so the parallax is slow far off and quicker near. Each loop is seamless: 960, 640, 832, 544, 352 and 224 s. |
| Light on cloud tops | Each plane's lit-rim layer breathes between 62% and 100% opacity in 5% steps. The cycles run from 17 to 37 s, out of phase with each other. |
| High streak clouds, 5 | Drift 3 to 6 cells to and fro over 44 to 70 s. |
| Wisps, 4 | A soft puff of mist fades in at the cliff edge, rises 30 cells and drifts 12 cells left, then fades out. Cycles are 16 or 20 s, staggered. |
| Birds, 3 (day and sunset) | Circle far below. They swing 24 cells each way across and 6 cells up and down, a quarter turn behind, at 16 s a side. Wings flap every 0.7 to 0.9 s. |
| Grass, 12 clumps | Tips lean 1 to 2 cells downwind and back, over 4 to 6 s cycles. |
| Tree, 5 pads | Leaf tips sway 1 cell over 7 to 11 s. |
| Sunset rays | The fan breathes between 45% and 100% over 24 s. |
| Night stars, 14 groups | Each group dims to 62% and back in four steps near the end of its 5 to 20 s cycle. It is a slow twinkle with no on/off blink. |

With reduced motion on, `@media (prefers-reduced-motion:reduce){:root *{animation:none!important}}` stops every animation, and the scene rests on its first frame.

## Size and player check

After the hairline fix (2026-11-15; the sizes before it are in brackets):

| Moment | SVG chars | Scrub estimate | Patterns | Runs |
| --- | --- | --- | --- | --- |
| day | 125,399 (114,278) | 125,348 | 22 | 14,205 |
| sunset | 127,849 (117,116) | 127,858 | 24 | 14,003 |
| night | 124,176 (115,264) | 125,694 | 22 | 14,321 |

`player-check.mjs` ends with `PLAYS: the app would run its motion` for all three. The last two runs were at 1536 x 864 @1.25x on the RTX 4070, against a limit of 5.56 ms. The numbers are noisy, because other agents share the machine.

| Moment | Window 1 average | Window 2 average |
| --- | --- | --- |
| day | 1.16-1.19 ms | 0.96-0.97 ms |
| sunset | 1.35-1.47 ms | 1.14-1.30 ms |
| night | 1.49-1.66 ms | 1.48-1.66 ms |

The worst single frames were 7.9 to 21.4 ms (the first window holds the start-up frames). Before the fix the averages were 1.0 to 1.9 ms.

## Rules

- **Root:** as Sunfield's: `<svg xmlns fill='none' font-family='a' color='a' style='--m:0s'>`, all single quotes.
- **Viewport:** the picture is one nested `<svg viewBox='0 -.5 320 200' preserveAspectRatio='xMidYMax slice'>` on the 320 x 200 grid.
- **Elements used:** `svg`, `g`, `defs`, `style`, `pattern`, `rect`, `path` and `use` (`href='#id'` only, for second coats of the swaying tips; the app's scrub keeps those). There are no filters (0 filtered groups) and no gradients.
- **Checks:** no `shape-rendering`, `vector-effect`, viewport units or `data:`. Every `url()` is `url(#id)`. The only `@media` is reduced motion.
- **Paths:** at most 64 runs each, as stroked 1-cell runs.
- **Patterns:**
  - Big still layers sit in `width=1 height=1` patterns with a clear margin.
  - The rolling planes are `userSpaceOnUse` tiles, 160 or 320 cells wide, moved in whole cells.
- **Seams:** see "Encoding and hairlines" below. (`seams.mjs` counts only see-through pixels and dark lines at three sizes; `../../engine/seamscan.mjs` is the check now.)
  - An underpaint of row bands sits behind the cloud sea, so a sub-pixel gap between planes shows a matching colour, not the window.
- **Rule breaks:** none.

## Open issues

- **Near cloud plane:** it reads as a row of soft domes. A little more cauliflower detail on the lobes would help.
- **Bayer checker:** the dither shows in the near plane's falloff when zoomed in.
- **Day wisps:** they show against the blue gaps but almost vanish against the white near clouds.
- **Size:** after the hairline fix sunset is 127,849 chars (scrub estimate 127,858), about 150 under the 128,000 cap. Any later addition needs a cut first.
- **Tree:** at sunset and night it is a near-black silhouette. That is right for backlight, but the crown loses its leaf detail.
- **Untested:** not yet run in the desktop app itself. Only the cached app code ran, through player-check.

## Encoding and hairlines

Fixed 2026-11-15 (encoding only; the originals are in `out/pre-seam/`, the step log in `seamfix-log.md`).

**What made the lines.** Before the fix, `../../engine/seamscan.mjs` counted about 200 to 2,800 line pixels at the fractional cell sizes (4.3 to 5.3 px a cell). The purity test at 6 px a cell also found 1,225 blurred pixels in day and 952 in sunset, along the tree trunk and branches.
- **Backing:** the old encoder drew each layer's commonest colour under the whole layer. Along the outer edge of the spires, the ground, the tree and the high clouds, that backing showed through the anti-aliased edge as a dark or light line.
- **Cloud tops:** each rolling plane's backing lay under its lit top lip. The plane is a pattern tile, so its bitmap is resampled at fractional sizes, and the backing showed as a dark fringe along every cloud top.
- **Rim light:** the lit rims breathe between 62% and 100% opacity over their plane. Where a rim cell sits on a body colour far from its neighbour's, the edge showed the body through.
- **Far range:** the ridge rim and the snow are 2 levels apart, so the encoder treated them as separate, and the sky leaked between them.
- **Swaying parts:** grass tips against still blades of their own colour, and leaf tips moving off their cells, leaked at their edges.

**What fixed them.** All in this folder:
- `encode-local.mjs`: a copy of `tide-line/encode-local.mjs`, plus `inside` (wrap-aware for tiles), `edge: 'back'` (no backing under outer cells, joins kept), `edgeNear` (a colour within N levels may lie under an outer cell) and `wide` (no row cap for chunks at least 120 cells across). It also has `corners` and `order: 'light'`, which are opt-in and unused.
- `build.mjs`:
  - Every cell layer and tile goes through `emitSafe` with `edge: true, edgeNear: 8, wide: 120`.
  - Plane bodies use `edge: 'back'`; plane rims get skirts in the body colour beneath, matched at every rim opacity.
  - The underpaint is Tide Line's `under()` (BAND_T 20).
  - Culling keeps a one-cell margin under the edges of the layers in front.
  - Grass tips get still joint copies (`j0`/`j1`/`j2`, keyframes in step with the sway) and two coats.
  - Each leaf tip's hidden pad cell takes the colour of the cell to its right, and the leaf tips get two coats.
  - The sunset rays get an `under` hint to the sky.
- **Colour merges** pay for the size: `MERGE_BY` is day 0, sunset 4 and night 4. Ground, rock, cairn, grass, tree and spire colours within 4 levels in every channel take the commoner colour. Env `MERGE` overrides.
- **What did not work:**
  - Two coats on the rolling planes made more lines (111 to 166 px), so they keep one.
  - `edge: true` on the planes cost 6k or added lines.
  - Raising the planes' T to 38 or 44 added lines at 4.3 to 4.5 px a cell.
  - Leaf-tip joint layers cost 1.3k.

**Results.** The table gives the most line pixels over the 11 seamscan sizes, with 0 holes. All sizes pass, and every whole-pixel size scores 0.

| Moment | t = 0 | t = 9 s | t = 37 s |
| --- | --- | --- | --- |
| day | 11 | 14 | 6 |
| sunset | 16 | 25 | 22 |
| night | 28 | 40 | 38 |

At t = 9 s the wisps are mid-rise, the birds are off their rest places and the grass leans. The scene has no rarer event than that.
- **Purity:** 0 impure pixels at 6, 8 and 9 px a cell, at t = 0 and t = 37 s, in all three moments. No still tile needed cutting into bands.
- **Pixeldiff against `out/pre-seam/`** (TOL 6 summed over RGB):
  - day: 1,370 px, all on 1-px edges of the trunk and branches, where the original was blurred;
  - sunset: 59,481 px, the 4-level merges on the spires and the crown, plus the same trunk edges (551 px over TOL 15);
  - night: 86,328 px, the merges only (0 px over TOL 15).
- **Motion:** at t = 9 s and t = 37 s (scratch `cloudsea-pixeldiff-t.mjs`), the only pixels over TOL 15 are the same trunk edges, so the motion is unchanged.
- **Left:** night scores highest, 28 to 40 px. They are scattered over the far cloud tops and the spire edges, and no line can be picked out in the 4x crops (`out/seams/`). Sunset has about 150 characters of room under 128,000.
