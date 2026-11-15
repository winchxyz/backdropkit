# Mirror Lake

A still mountain lake in a wide valley. The water mirrors the whole upper scene: the sky, the clouds, a snow-streaked massif with a tall summit left of centre, a second peak on the right, a pale far range in the gap between them, and wooded shores. In front of that sit a jetty with a lamp post, a moored rowboat, a stony left shore with reed clumps, a grassy right bank with three spruces, and flowers. There is a thin waterfall in a gully over the left woods.

`node build.mjs` writes `out/mirror-lake-{day,sunset,night}.svg`. `node render.mjs` writes the matching PNGs: 1536 x 864, drawn as an `<img>` of the SVG with every animation held at its start. `node check.mjs` checks the rules.

## Moments

- **day**: the sun is upper left. Three slow light shafts cross the left of the sky. Clouds are white, peaks lilac and white, the water blue.
- **sunset**: alpenglow (orange and pink) lights the peaks above a ragged shadow line. The shadow line sits lower on the left, nearer the range that casts it. Below it the slopes are in violet shade. The sky is violet to gold and mirrored in the lake. Warm shafts, orange rims on the near spruces.
- **night**: stars, and a moon over the right shoulder. Both are in the mirrored group, so the lake reflects them. The moon's glitter path runs down the water. Peaks are blue. A lantern burns at the end of the jetty, with a soft glow and a broken warm reflection.

In every moment:
- The sky is bands of its colour ramp, each dithered into the next over three rows (a quarter, a half, three quarters), so it reads as a gradient.
- Where the water meets the far shore there is a broken glint. It is gathered, longer and brighter under the light: the sun's side by day, the sky glow at sunset, the moon at night. Elsewhere it is rare, short and barely lighter than the water.
- The rowboat has a sheer that rises to the bow, a keel that lifts at both ends, a pale rim along the near gunwale, a dark strake, a painted stripe and a lit stem. Water laps at its bow and stern.

## What moves

All motion is in `steps()` on the 0.05 s clock. The reduced-motion rule stops all of it.

- Clouds drift a few cells there and back over 46-70 s. Their reflections drift with them, because the lake draws the upper scene again through `<use>`.
- Ripple streaks and broken sky-coloured ripple bands slide across the water in three tiles, at 0.9, 0.6 and 0.4 s a cell.
- The waterfall's bright dashes slide down a cell every 0.2 s. Its reflection moves with it.
- Reed tips (three groups), flower heads and grass tips sway one or two cells, on 4-7 s cycles.
- The rowboat rises a cell for 2.4 s of every 6.4 s, and its reflection dips.
- Now and then:
  - **Birds**: two birds cross the valley in 71 s (a cell every 0.2 s) and then are gone for 29 s. Their wings flap in two poses, 0.45 s each, and they are mirrored in the lake.
  - **Fish rings**: a ring spreads in five 0.6 s steps, at two spots, each once every 25 s.
  - **Mist**: wisps low over the water drift 9 cells and thicken and thin away over 50 s.
- Light shafts (day and sunset) swell and ebb in 20 steps over 13-23 s.
- The moon's glitter and the lantern's reflection sway a cell.

Nothing flashes, blinks or shakes. The stars are still.

## Sizes

| SVG | chars | after the app's scrub (est.) | stroke runs | patterns |
|---|---|---|---|---|
| day | 121,040 | ~123,510 | 14,383 | 21 |
| sunset | 122,813 | ~125,423 | 14,220 | 23 |
| night | 124,251 | ~126,800 | 14,803 | 26 |

The most runs in any path is 64. No filters are used. Before the seam fix the three were 114,958, 118,015 and 117,969 chars.

## Player check

I ran `node sunfield/tools/player-check.mjs` on each SVG at 1536x864 @1.25x (RTX 4070 Laptop, D3D11). The limit is 5.56 ms. Other work was running at the same time, so the numbers are noisy.

| SVG | window 1 avg / worst | window 2 avg / worst | result |
|---|---|---|---|
| day | 1.67 / 38.7 ms | 1.11 / 2.0 ms | PLAYS |
| sunset | 1.45 / 31.3 ms | 1.11 / 1.9 ms | PLAYS |
| night | 1.60 / 39.2 ms | 1.08 / 2.2 ms | PLAYS |

These are after the seam fix (2026-11-15). Before it: day 0.91 / 1.59, sunset 0.95 / 1.54, night 0.75 / 1.40 ms on average. Window 1's worst frame rose from 11-16 ms to 31-39 ms (most likely the first rasters of the coated patterns); window 2 is faster than before.

Cost lessons from this scene:

- The app redraws the whole image every frame, and the lake draws the upper scene a second time. The first version had two more mirrored copies clipped into bands, and a sky dithered with dashed strokes. It ran at 8-9 ms and stayed still.
- Dropping the dashes alone brought it to about 2 ms.
- The sky's dashed dither is back now, as the content of a pattern. A pattern keeps its raster between frames, so the dashes cost nothing per frame (see the table).
- Each band edge's dither is a single path dashed 1 on, 3 off. A dash pattern restarts with each subpath, so one, two or three subpaths a column apart cover a quarter, a half or three quarters of a row. This uses a third of the paths that three dash patterns would.
- The clipped copies also left hairlines at their clip edges. The ripple bands are now painted into the sliding ripple tiles instead.

## Seams

The first version's notes (kept for history): the sky stops three rows above the waterline, and the build checks that woods or mountains cover every column there. Behind the mirror's edge sits an underlay: a mid forest colour, plus the beach's own colour under the far shore's flat stretch. The seam fix below replaced the rest of this section.

## Encoding and hairlines

Fixed 2026-11-15: at fractional cell sizes the scene showed thin lines between cells (seamscan, worst over 11 sizes at T=0: day 2,308 px, sunset 1,506, night 1,421; 46-60 even at 6 px a cell). Encoding only; the art, light, composition and motion are unchanged. The originals are kept in `out/pre-seam/`, and the step-by-step log is in `seamfix-log.md`.

**Causes found and fixes**

- **Cell layers.** Every layer is now written by a seam-proof encoder, a local copy of tide-line's (`encode-local.mjs`; its header lists Mirror Lake's changes). Small layers are written exactly (each cell's neighbours joined under it).
- **Big (pattern) layers in coats.** The exact encoding put the scene over 128,000 characters. Instead, a pattern layer's runs are written with no joins and drawn three times inside its pattern (`<g id>` + two `<use>`). Where two runs meet inside a pixel, what shows through drops from f(1-f) to (f(1-f))³, at most 1/64. Whole cells are unchanged, and the pattern keeps its raster between frames, so the coats cost nothing per frame.
  - Runs are cut every 64, and at 21 rows for paths 21-120 cells wide: Chromium softens and rounds every cell corner of a square-ish path box, which showed as dots at 6 px a cell.
  - The backing (when a layer has one) is one filled outline, drawn once under the coats. Inside the coats each coat would reset the build-up (far worse); coated on its own it gained nothing.
  - The spruces and bank keep a backing: their 2-cell columns are side-by-side runs, and the day sky showed through the joint.
- **The waterline.** The upper scene (`U`) and its mirror met edge to edge at 113.5, over the underlay. The upper scene's last row is now drawn again a row lower (`wl`), under the mirror's first row (which mirrors that same row), and the underlay spans rows 111-116. Hidden at every size.
- **Pattern layers over one another.** Two tiles' edges do not add up like coats (each tile bitmap is resampled), so culling keeps a one-cell rim of the lower layer under every upper edge, in the colour of the visible cell beside it.
- **Ripple tiles.** One clear row above and below each band's tile and rect (lines along the band joins). Their opacity moved from the pattern's strokes to the rect (`fill-opacity`): the seam-proof encoding overlaps cells and adds a filled backing, which made the streaks up to 12 levels brighter. Faded as one, they look as before.
- **Moving parts** (reed tips, flower heads, grass tips, the boat and its reflection, the lamp's reflection, the moon's glitter). They sway or rise in whole cells, so at every frame they abut what they stand on exactly. These parts, and the still layers they stand on (reeds, flora, bank tufts, the spruces and bank), are drawn twice (`Scene.double`: a repeated rect, or `<use>`).
- **Purity at 6, 8 and 9 px a cell** (the blur check): no blurred tiles. The impure cells left are the sky's band edges, which sit mid-row in the original too (each band stroke reaches half a row up under the band above). There are fewer impure cells than before; the spruces went from 386 to 0.

**Results** (seamscan, 11 default sizes; worst line pixels over the sizes; no holes anywhere)

| SVG | T=0 | T=37 (fish ring 2) | T=13.4 (fish ring 2) | T=20 (mist at its thickest) |
|---|---|---|---|---|
| day | 35 | 34 | 24 | 11 |
| sunset | 32 | 28 | 31 | 29 |
| night | 25 | 35 | 23 | 21 |

The birds are on screen at T=0 and T=37.

- **Pixeldiff against `out/pre-seam/`** at 1920x1080 and 1536x864@1.25 (6 px a cell): day 5,760, sunset 4,069 and night 3,277 pixels differ. All of them are 1-px cell edges where the original had soft corners and seams at 6 px a cell: the right spruces, the right mountain behind them, a few flowers.

**Left**

- The mist is translucent and drifts, and its row edges meet the water's row edges. Its partial cover lands on the already-blended pixel, so a faint line can show along a mist edge (up to about 26 px at 1200x780@1.25). The colour under it changes as it drifts, so it cannot be skirted.
- The ripple streaks do the same on the reflection, and the very dark night woods show a few short faint lines (light leaks of 30-40 levels summed).
- Every size passes; the worst is night at T=37 (35 px).

## Rules

No rule is broken. Everything follows Sunfield's root and encoding:
- 320 x 200 cells, single quotes
- only allowed elements and attributes
- no shape-rendering, vector-effect or viewport units
- `url(#id)` only
- the only `@media` rule is reduced motion
- no filters
- at most 64 runs a path

`check.mjs` also confirms that every duration, delay, keyframe moment and step lands on the 0.05 s clock.

## Open issues

- After the seam fix night is about 1,200 chars under 128,000 after the scrub (sunset about 2,600, day about 4,500), so there is little room for more detail.
- To fit the sky's dither, the light shafts' gradient now fades in 8 steps instead of 12. Close up there is no visible change.
- The birds also fly at night. They are dark against a dark sky there, so they are barely visible.
