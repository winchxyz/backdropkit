# Side Street: notes

A steep residential lane in a quiet Japanese seaside town, seen in one-point perspective.

**The view**
- The lane runs down to a level crossing on an embankment. Beyond it are:
  - the roofs of the lower town;
  - a bay with a breakwater;
  - a green headland.
- Left: the lane is edged by a sloping stone parapet. Below the parapet are blue, brown, tin and silver roofs, and a persimmon tree.
- Right: a two-storey corner shop with:
  - a balcony with laundry and a futon;
  - an awning and a vertical sign;
  - drainpipes, a meter and an AC unit with an outdoor fan;
  - two vending machines, a recycling bin, potted plants and a parked bicycle.
- Further down the right side: a house with a hedge and a pine, a block wall, and a traffic mirror.
- Past the crossing: a small torii and stone lanterns in a grove.
- Overhead: three utility poles (one has a transformer) with sagging power lines and street lamps. The railway has catenary masts.
- Signs are shapes and colours only. The red inverted triangle has no characters.

**How it is made**
- The scene is modelled in metres (`scene.mjs`) and rendered onto the 320 x 200 cell grid (`core.mjs`).
- `build.mjs` lights each cell for the moment:
  - one key light (sun or moon, `KEY` in `build.mjs`), sky ambient, and cast shadows with a soft, dithered edge away from the thing that throws them;
  - line shadows for things thinner than a cell (cables, crossing posts, sign post, torii posts, the bicycle), and contact shadows where upright things meet the ground;
  - lamp cones and pools, specular glare on the asphalt and rim light;
  - bloom from emissive cells, aerial haze and a grade.
- It then reduces each material to a few colours and encodes the result the way Sunfield does.
- `motion.mjs` paints the moving parts. `moments.mjs` holds the light, sky and palette of each moment.

## Files

| File | Purpose |
| --- | --- |
| `build.mjs` | `node build.mjs [moment...]` writes `out/side-street-{day,evening,night}.svg`. Debug env: `STATS`, `SIZES`, `KEYS`, `PROBE`, `WHO`, `PREVIEW`. |
| `encode-local.mjs` | The cell encoder (`emitSafe`): harbor's copy of the engine encoder plus three options of Side Street's own. See "Encoding and hairlines". |
| `seamfix-log.md` | Step-by-step log of the hairline fix. |
| `out/pre-seam/` | The three SVGs as they were before the hairline fix (for `pixeldiff`). |
| `render.mjs` | `node render.mjs` writes `out/side-street-<moment>.png` at 1536x864: an `<img>` drawn with playwright-core and its Chromium (d3d11 GPU raster), animations held at their start. Env: `T` (a time in the cycle), `VW`/`VH`, `CROP`+`ZOOM`, `TAG`; these write into `out/frames/`. |
| `check.mjs` | Rule check: size, banned properties, viewport units, quotes, @media, `url()`, runs per path, the 0.05 s clock, the reduced-motion stop. |
| `debug.mjs` | `node debug.mjs` writes the lighting checks into `out/debug/` from the PNGs and `out/debug/keys.json` (written by `build.mjs`): `<moment>-value.png` (luminance, and the same cut into four value groups) and `<moment>-light.png` (the key light marked, and an arrow from the base of each standing thing to where its shadow must end). |
| `out/frames/` | Seam renders (1920x1080, 1366x768), motion frames (T=32 train, T=60.5–66 cyclist), crops, and the `--m`-shifted SVG copies used for player-check. |

## Key lights

Set as constants in `build.mjs` (`KEY`); colours in `moments.mjs`. Shadows take the sky colour, never grey.

| Moment | Key light | Lit faces | Shadows |
| --- | --- | --- | --- |
| day | Sun 50 degrees up, upper left and behind the viewer (azimuth -135 degrees: as far left as behind). Colour `#ffc282` x 1.24. | Warm: peach asphalt, cream and sand walls, the street-facing walls and the faces toward us. | Cobalt from the sky (`#5c85b8`). Poles and crossing posts throw diagonals to the right and down the lane. A tall house and tree behind us on the left lay a wide band across the foot of the lane. The parapet shades its road face and a strip of the green lane. The balcony, awning and eaves shade the shop. |
| evening | Sun in the frame at cell (140, 60), about 4 degrees up, straight down the view. Colour `#ffb36e` x 1.25. | Backlit: rims and glare toward the sun. | Long shadows running toward the viewer from the sun's foot on the horizon. Fronts are dark and violet (`#8f86c2`). |
| night | Moon at cell (100, 21), high ahead-left, faint and cool (`#9fb8ee` x 0.34). | Moonlit roofs and tops cool blue. | Local lights win near their source: three street lamps (cone pools with a dithered falloff, a glow on each post and a glowing head), the shop window (two warm pools along the walk), and the vending machines (a warm-white pool on the lot). |

**Light checks.** Rule 7 of `_refs/lighting.md`. `out/debug/` holds a value map and a light check for each moment, and all six were viewed. Fixes made from them:
- The day key moved from azimuth -125 to -135. At -125 the faces toward us got only 37% of the sun and went grey; now the shop's upper floor reads sand.
- The crossing posts, sign post and torii posts are thinner than a cell, so the box casters hit only a few cell centres. They now cast line shadows.
- Only the thick cables cast lines now. The fine wires had scattered dotted lines over the lot.
- The lot and gutter were lightened less so they no longer burn out next to the road. The road was shifted toward ref-6's lit asphalt.
- The off-frame occluder was raised, so its band now spans the whole width of the foreground.
- The shop's gable boards were lightened, so their shadow under the eaves reads dark slate rather than black.
- Night lamp heads seen from the side now glow. The window and vending pools were moved out onto the walk and the lot and made warmer.

**Day palette against ref-6.** Sampled from the 1536x864 render, ours then ref-6:

| Surface | Ours | ref-6 |
| --- | --- | --- |
| Sky top | `#1c67ca` | `#0268be` |
| Horizon | `#94d1f6` | (lighter cyan) |
| Clouds | `#ffffff` | `#f7f7f7` |
| Lit asphalt | `#e0bfb7` | `#e8cdc0` |
| Road shadow | `#3d5477` | `#3c5671` |
| Sunlit siding | `#c5a579` | plaster `#c9b096`, yellow building `#d0ad7c` |
| Shaded wall | `#3e5364` | teal building `#405556` |

## Sizes

All three are under the 128,000-character limit, raw and after the scrub estimate. The app's scrub adds about 3%. The hairline fix added about 4–7k a moment (before it: 113,992, 114,015 and 102,957).

| SVG | Characters | After scrub (est.) | Patterns | Runs |
| --- | --- | --- | --- | --- |
| day | 120,686 | ~124,760 | 16 | 12,235 |
| evening | 120,124 | ~123,617 | 14 | 12,485 |
| night | 106,787 | ~109,847 | 13 | 10,864 |

## Player check

Every check ended with **PLAYS**.

The limit is 5.56 ms; the figures are the average per frame. The `--m:-30s` copies start mid-train and the `--m:-62s` copies start mid-cyclist, because the check only watches 9 s.

| Copy | day | evening | night |
| --- | --- | --- | --- |
| As built (windows 1 / 2) | 1.05 / 1.09 ms | 1.34 / 1.22 ms | 1.05 / 1.05 ms |
| `--m:-30s`, train crossing | 1.24 / 1.08 ms | 1.47 / 1.40 ms | 1.51 / 1.45 ms |
| `--m:-62s`, cyclist | 1.37 / 1.02 ms | 1.52 / 1.38 ms | 1.47 / 1.33 ms |

Measured after the hairline fix (before it: 0.83–1.21 ms), while other builds shared the machine. The worst single frames were 10–24 ms. The numbers are noisy.

## What moves

Everything runs on the 0.05 s clock with `steps()`. Hidden-at-rest parts carry `opacity='0'`, so the reduced-motion still is the clean first frame.

**One 90 s cycle**
- The crossing lamps fade on at 20.0, 20.1 and 20.2 s. They glow steadily, never alternating, then fade off at 45.0–45.2 s.
- Both arms come down in three frames: half at 22.5 s, down at 23.5 s, half up at 43.5 s, up at 44.5 s.
- A two-car train with a teal band crosses from 21.95 s to 42.6 s, one cell per step, behind the near-side posts.
  - At night its windows are lit.
- A cyclist rides along the far path between 59 and 70 s, pedalling in two frames on a 1 s beat.
  - He is seen across the centre and passes behind the crossing posts.

**Loops**

| What | How it moves |
| --- | --- |
| Clouds | Drift a whole cell at a time, back and forth, over 70–90 s each. |
| Wires | Three spans sway one cell: the two thick spans and the service drop to the shop, on 7, 8.5 and 6 s. |
| Cat | The calico on the parapet flicks its tail twice every 9 s. |
| Laundry | Towels, a shirt and socks stir in three frames over 7.5 s. |
| Sea glints | Three sets of single cells alternate every 0.5 s. They are spread over the bay by day and follow the sun or moon path in the evening and at night. |
| Sun rays (evening) | Breathe between 0.2 and 0.3 opacity over 24 s. |
| Stars (night) | 12 dim to 0.4 briefly at their own rates. |

## Moments

- **day:**
  - Late morning, after ref-6's bright countryside look.
  - Cobalt sky with crisp white cumulus shaded blue-lavender, a lush green headland lit on its left slopes, and a turquoise bay with glints.
  - Peach asphalt with a wide cobalt shadow band across the foot of the lane and pole shadows across it.
  - Colour accents: orange tile and blue glazed roofs, red and blue sign, red and white vending machines, a green awning, the green lane, a teal bicycle, a red torii, an orange mirror and laundry.
- **evening:**
  - Orange sky with the sun low over the sea straight down the view.
  - Rays and a glare path on the water, long shadows, and edges rimmed in orange.
  - Lamps just on, a few windows lit, the vending machines bright.
- **night:**
  - Moon and stars, thin clouds.
  - Warm lamp pools on the lane, each lamp's post and head glowing; glowing vending machines with a pool on the lot; warm pools from the shop window along the walk.
  - The lit balcony door with the laundry in silhouette, lit windows.
  - A few village lights along the headland shore.
  - The cat is a dark shape with an eye glint.

## Encoding and hairlines

The hairline fix for all 13 scenes (owner approved 2026-11-15). Goal: no 1-px lines between cells at any window size, in every moment, with the picture, light and motion unchanged. Progress is logged in `seamfix-log.md`; the SVGs from before it are in `out/pre-seam/`.

**Result** (`../../engine/seamscan.mjs`, 11 window sizes, fails at over 60 line pixels or any hole; no holes anywhere):

| Moment | Most line px, T=0 | T=37 (train) | Train and cyclist (T=26, 30, 33, 41, 64) | Before the fix (T=0 / T=37) |
| --- | --- | --- | --- | --- |
| day | 14 (1440x900) | 32 (1200x780@1.25) | 34 at most | 34 / 41 |
| evening | 14 (1200x780@1.25) | 10 | 14 at most | 38 / 20 |
| night | 7 (1200x780@1.25) | 34 (1536x864@1) | 20 at most | 38 / 48 |

At whole-pixel cell sizes (6, 8 and 9 px a cell), no pixel now differs from its cell's colour, at T=0 and with the train on screen. Before the fix, 9 px a cell (1440x900 at 2x) blurred 15,000–27,000 cells a moment, and 6 and 8 px a cell left 55–314 soft cells at night and in the evening.

**What caused the lines, and the fixes** (all in `build.mjs`, `encode()`, and `encode-local.mjs`):
1. **Colours inside a layer, and split paths of one colour.** Every layer now goes through `emitSafe` from `encode-local.mjs`, a copy of `harbor/encode-local.mjs`:
   - colours are drawn darkest first, each also laid under the neighbouring cells of later ones;
   - split paths of one colour overlap;
   - the layer is backed by its commonest colour when that is shorter, but never along its outer edge;
   - four-colour corners are covered;
   - a path whose box is square-ish is cut at 19 rows (`narrow` 21, `wide` 120), because GPU raster rounds its cell corners at 6 and 8 px a cell otherwise.
   This replaces the backing and mend variants from the rework round.
2. **Pattern tiles.** A tile's corner sat half a cell off the grid, which blurred every row at 9 px a cell. Its corner now sits on a cell corner (`y = y0 - 1.5`), with a clear row and column on every side.
   - The still scene's tile was the whole picture (323 x 203 cells), which Chromium draws as a scaled bitmap at 9 px a cell.
   - It is now cut into bands of 100 rows, each its own tile, with each band carrying the next band's first row. All tiles are at most 323 cells wide.
3. **The still scene (`base`, `base-far`) stays in the triple merge filter.** That filter already fills the pixels two cells share. Its layers use the local option `filled`: no joins and no backing; only the row cap. Full joins there would cost about 15k characters a moment, over the limit.
4. **Fringes beyond a layer's edge.** A colour laid under its neighbour reaches the far side of that neighbour. Where that side is the layer's outer edge, the colour showed one cell out: a red fringe beyond the vending machine's slice, 100–210 line px a size.
   - The local option `rim` (from tide-line's `edge`) never lays a colour under an outer-edge cell.
5. **Moving parts in two coats.** Every animated layer is drawn twice (a repeated pattern rect, or a group plus `<use>`): the train, cyclist, cat tail, laundry, crossing arms and lamps, wires, clouds, glints and rays. This took the night train pass from 46 to 34 line px and T=0 from 16 to 7.
6. **The train's size.** The train is a strip about 290 x 26 cells. Its window colours hold so many runs per row that each path was one row, and the overlap of split paths doubled them.
   - The local option `slab` cuts it into 160-column slabs first: 11,855 down to 6,930 characters by day.
7. **Bands.** The sky's full-row bands already ran one row under the next band (stroke width + 1), so nothing changed there.

**Not needed here.**
- *Skirts:* the only translucent overlays (rays and glints) are animated and scan clean.
- *Lips and colour merges:* the sizes fit without them.
- *Separate abutting-part fixes:* the wall, crossing and train against the street come from the tiered still scene, whose join the merge filter and the slices' one-cell ring already cover.

**Picture and motion.** `pixeldiff` against `out/pre-seam/` at 6 px a cell:
- day: 0 pixels differ;
- evening: 395 px; night: 190 px. All are on 1-px cell edges and corners: the old soft corners going away (`out/seams/diff-*.png`).

Motion is unchanged: the same groups, classes and timings. The second coat makes a moving part's edge pixels a little more solid at fractional window sizes only.

**Checks.**
- `check.mjs`: ok; at most 64 runs a path.
- Single quotes, the 0.05 s clock and `href` targets: ok.
- New element: `<use>`, which harbor and deep-reef use too.
- player-check: PLAYS (see the table above).

## Seams (earlier rounds)

These fixes came before the hairline fix above.
- Fixes 2 (plain slices) and 6 (mends) were replaced by `emitSafe`.
- Fixes 1, 3, 4 and 5 still stand.

Seams were checked at 1536x864 (1x), 1920x1080 (1.25x) and 1366x768, and in the train (T=32) and cyclist (T=64) frames. A script looked for one-pixel lines whose two neighbours agree, and it was run on every render. That check found none. The engine's 11-size seamscan later found up to 48 line px.

**Fixes made in this round**
1. **Filter colour space.** The seam filter now merges in sRGB (`color-interpolation-filters='sRGB'` on `feMerge`; Sunfield uses the same attribute on its other filter primitives).
   - In linearRGB, a dark pixel shared by two cells came out darker than both: a black hairline at night.
   - It also lost a little green from every dark colour.
2. **Plain slices.** Slices are drawn plain, not backed. A backing colour showed through the cyclist's slice along the crossing.
3. **Frames overlap the still layer.** Diff frames (laundry, wires, tail) keep the still cells around them, so a frame and the still layer never share a pixel edge.
4. **Slices grow by one cell.** Each slice also takes one ring of cells that its sprite never covers, so a wire behind the sign no longer shows as a stair-step hairline.
5. **Near-identical colours merged.** Colours within 6 levels are merged in the still picture, and within 15 levels inside each sprite, so neighbouring cells share a path. This also saved about 8k characters.
6. **Split colours mended (rework round).** A colour with more than 64 runs is split over several paths, and where two of them meet at a fractional pixel the colour beneath shows. Two changes in `cellsOf` fixed this:
   - A split colour is tried as the layer's backing.
   - In moving layers (clouds, the train), each colour still split is laid once more under the layer's other colours. That copy leaves out its first rows, so its own path breaks fall elsewhere.
   - This closed both hairlines left open in the first round: inside the evening cloud, and at the foot of the left crossing post during the train pass. It costs about 3k characters a moment.

## Open issues

- **The house A roof's light/shadow split is a cast shadow.** The big blue roof at the bottom left shows only the plane facing the lane; its ridge lies outside the frame. Its split is the band thrown by the tall house behind us, with tile rows on both sides. Under this sun, a plane facing away to the right would be in shadow only if it were steeper than about 59 degrees.
- **The bicycle's day shadow is small.** With the sun behind us, the shadow falls behind the bicycle, toward the machines. Only a sliver shows past the wheels, plus the contact shadow.
- **Small at 1x.**
  - The cyclist is only visible across the centre of the scene, about cells 125–208, because the side walls hide the far path.
  - The cat is small: about 13 x 12 cells.
- **Glints are the busiest motion.** The sea glints switch every 0.5 s. They are small single cells and player-check passes, but if the owner finds them busy, `glitter()` in `motion.mjs` can slow them to 0.75 s.
- **Rules.**
  - No rule is broken.
  - `color-interpolation-filters` on `feMerge` is new compared with Sunfield's base filter, but it is the same attribute Sunfield already uses. player-check, which runs the app's own code, plays it.
