# BackdropKit editor: the project contract

The editor (`editor/app/`) and the exporter (`editor/lib/`) are built side by side against this file. The editor owns the project while you work; the exporter turns a project into scenes the Claude desktop app plays, and into an installable theme archive. Change this file only together with both sides.

## Where things live

- `editor/app/`: the editor page (`index.html`, `editor.css`, `editor.js` and its modules). Plain ES modules, no framework, no build step, no CDN scripts. Fonts as on the landing page (`site/src/site.css`): SF first, then Inter and Geist Mono from Google Fonts. Never Arial, Segoe, Helvetica or `system-ui`.
- `editor/lib/`: the exporter. Plain ES modules with no dependencies that run both in the browser and in Node 24 (no `fs`, no DOM in the core; DOM-only helpers live in `editor/lib/browser.js`).
- `editor/test/`: Node checks of the exporter against the real player checks.
- `site/build.mjs` copies `editor/app/`, `editor/lib/` and `engine/theme-mod/hooks/` into `docs/editor/` (`docs/editor/index.html`, `docs/editor/lib/…`, `docs/editor/mod/hooks/…`). The editor loads the 14 site themes from `../scenes/<slug>/*.svg` and `../themes/packs.json` (same origin), and imports the exporter as `./lib/export.js`.

## The project (`project.json`)

```js
{
  format: 'backdropkit-project',
  version: 1,
  name: 'Quiet Bay',            // shown name
  slug: 'quiet-bay',            // [a-z0-9-], 2-40 characters, starts with a letter: the plugin name
  line: 'A small bay at dusk.', // one line about the theme
  w: 320, h: 200,               // cells; always 320 x 200 in version 1
  palette: [                    // slot n is palette[n - 1]; at most 1024 slots
    { id: 'c1', colors: { day: '#9cc7f0', sunset: '#e7a07a', night: '#1b2445' } },
  ],
  moments: [                    // 1 to 6, in the order of the day
    { id: 'day', name: 'Day', start: 6 },       // start: hour 0-24 it begins; it lasts until the next one
    { id: 'sunset', name: 'Sunset', start: 17 },
    { id: 'night', name: 'Night', start: 21 },
  ],
  layers: [                     // bottom first
    {
      id: 'l1',
      name: 'Sky',
      kind: 'paint',            // paint | picture | sky | sun | stars | clouds | ridge | trees | water
      visible: true,            // shown in the editor; hidden layers are not exported
      show: { night: false },   // per moment; a missing moment means shown
      cells: '<base64>',        // Uint16Array(w * h), little-endian; 0 = empty, n = palette slot n
      byMoment: {},             // optional: { momentId: '<base64>' } cells for that moment instead of `cells`
      gen: null,                // generator kinds: the parameters that last wrote `cells` (editor-only)
      motion: { type: 'none' }, // see Motion
    },
  ],
}
```

- A cell's colour at a moment is `palette[slot - 1].colors[momentId]`. A slot with no colour for a moment falls back to its first moment's colour.
- Moment ids are lower-case `[a-z0-9-]`. Usual ones: `dawn`, `sunrise`, `morning`, `day`, `golden`, `sunset`, `dusk`, `evening`, `twilight`, `night`.
- `picture` layers come from the 14 site themes or the visitor's own image. A theme opened as a starter becomes one `picture` layer with `byMoment` cells, one per moment of that theme, and the theme's own schedule from `packs.json`. Its motion does not come along (the picture is taken with motion at rest); motion is added with layers on top.
- Generator layers (`sky`, `sun`, `stars`, `clouds`, `ridge`, `trees`, `water`) keep their parameters in `gen` so the editor can run them again. The exporter only reads `cells`, `byMoment`, `show`, `palette` and `motion`.
- The editor keeps the last project in the browser (IndexedDB) and saves `project.json` on request; an exported archive carries it too, and the editor opens either.

## Motion

Every motion moves whole cells, on the one shared 0.05 s clock the scenes use, with the CSS the app's player keeps (the same as the 14 themes; the exporter owns the details).

| `type` | Fields | What it does |
| --- | --- | --- |
| `none` | | Still. |
| `drift` | `period` s (20-600), `dir` 1 or -1 | The layer scrolls sideways and wraps round the 320-cell width, one loop per period. Clouds, far birds. |
| `fall` | `period` s (4-120) | The layer scrolls down and wraps round the 200 rows. Snow, rain. |
| `sway` | `period` s (2-20), `amount` 1-3 cells | The layer moves left and right and back, eased. Grass, leaves, reeds. |
| `bob` | `period` s (2-20), `amount` 1-3 cells | The same, up and down. Boats, buoys. |
| `twinkle` | `period` s (2-20) | The layer's cells are split into 4 fixed groups that fade down and back in turn. Stars, glints. |

Moving area costs frame time in the player (its limit is 5.56 ms a frame at 1536 x 864 at 1.25x). The exporter estimates it and says which layer costs most.

## The exporter (`editor/lib/export.js`)

```js
exportScene(project, momentId)   // -> { svg, chars, problems: [{ level: 'error' | 'warn', text, layer? }] }
exportAll(project)               // -> { scenes: [{ id, svg, chars }], ok, problems }
checkProject(project)            // -> problems without encoding (names, slug, schedule, empty moments)
themeModule(project, scenes, looks) // -> the text of mod/hooks/theme.js, in engine/theme-mod's shape
buildArchive(project, { scenes, looks, preview, modFiles }) // -> Uint8Array: the theme zip
promptFor(project)               // -> the install prompt text (as on the landing page)
```

- `chars` is the length the app counts (after its still-frame scrub). Every scene must be at most 131,072; over that is an error naming the layers that cost most.
- Each scene is hairline-safe at any window size (the engine's encoder, see `engine/README.md`), has at most 64 runs per path, and plays in the app's own picture player.
- `looks` per moment is `{ tone: 'light' | 'dark', tint, opacity }`, as `engine/pack.mjs` computes them; `editor/lib/browser.js` exports `measureLook(svg)` for the browser.
- The archive is the same as the site's theme archives (`engine/pack.mjs`): marketplace `backdropkit-<slug>`, `mod/` from `engine/theme-mod` with the slug stamped in and the generated `theme.js`, `README.md`, `preview.png`, and `project.json` (this project).

## Your own art, looks and live effects (added 2026-11-16, owner's ask)

The owner wants a real custom editor, not only pixel painting: people bring their own art and assets (a background painting, sprites, an animated GIF) and turn them into a theme, with many effects. Effects come from the owner's two earlier apps, Nightgrain (`../nightgrain/`, dithering, palettes, picture controls, pixel shapes, colour cycling, glint) and Afterglyph (`../glyph-bloom/index.html`, glyph art, background removal, glow looks). Both are the owner's own MIT code: port what fits.

**The hard limit.** The app's player shows one SVG of at most 131,072 characters. Its scrub removes `<image>`, every `data:` or outside `href`, scripts and `foreignObject`, and the page has `img-src 'none'`. So no picture can be embedded: everything a theme shows is cells on the 320 x 200 grid, coloured from palette slots. Uploaded art is turned into cells by a **look**; the editor says so plainly where art comes in.

### Assets

```js
assets: {                       // in project.json; originals kept so a look can be re-run
  a1: { name: 'boat.png', w: 412, h: 260, frames: [{ png: '<base64 PNG>', delay: 100 }] },
}
```

- A still keeps one frame, scaled down so the longer side is at most 960 px. An animated GIF or WebP keeps up to 48 frames at most 480 px, with each frame's delay in ms.
- Transparency is kept; it becomes empty cells.

### Image layers

```js
{ id, name, kind: 'image', visible, show,
  asset: 'a1',
  place: { x: 12, y: 80, scale: 0.5, flipX: false },  // cells; scale of the asset's pixels to cells
  look: { ... },              // editor-only: the effect stack that made the cells (see Looks)
  cells: '<base64>',          // the result, as for every layer
  frames: ['<base64>', ...],  // animated assets: cells per frame (then `cells` is frame 0)
  anim: { fps: 10 },          // frames per second; the exporter snaps each frame to the 0.05 s clock
  motion, live }
```

- The look's colours join the shared palette as slots (an exact colour already there is reused), so Relight gives uploaded art its sunset and night colours like everything else.
- Two editor-only fields (the exporter ignores them): `own: [slot, ...]`, the slots the art's colours were given, so a new look or a move reuses them instead of adding slots; and `lit: true`, the art is taken as drawn by day and relit for each moment's light. Without `lit` the art keeps its own colours at every moment.
- `frames` and `anim` are allowed on any layer. A walking cat can play its frames and drift at the same time.
- One more editor-only field: `versions: { momentId: assetId }`, other pictures of the same scene for some moments (a day picture with a night one). At a moment listed there the layer shows that asset instead of `asset`; at every other moment it shows `asset`. All of them share `look` and `place` (a version as wide as `asset`, standing on the same foot). The editor bakes each picture through the look and writes the result to `byMoment` for every moment, so the exporter needs nothing new: it reads `byMoment` as for any layer. A layer with versions is a still (no `frames`; an animated asset gives its first frame), and its slots take, at each moment, the colours of the picture shown then, so `lit` does not apply to it. Moment ids and asset ids that do not exist are dropped on open.

### Looks (the effect stack, baked into cells; editor-only)

These run in order on the asset's pixels after placing, and the result is cells. They live in `editor/fx/` (pure functions on `{ w, h, data: Uint8ClampedArray }`, browser and Node).
- **Cut:** background removal (auto, by picked colour, dark, light), edge grow or shrink, speck cleanup.
- **Picture:** exposure, contrast, saturation, hue, warmth.
- **Colours:** 2 to 64 colours (pulled from the art, from the project's palette, or one of the Nightgrain palettes).
- **Dither:** Nightgrain's patterns with an amount. Ordered ones (Bayer, blue noise) cost less than diffusion; the cost is shown.
- **Pixel shapes:** the layer in k x k blocks (k 3 to 8), each drawn as a dot, ring, diamond, plus or square of cells, sized by brightness.
- **Glyphs:** Afterglyph's idea at cell scale: blocks of 5 x 7 or 7 x 9 cells, each a glyph picked by brightness and edge direction.
- **Outline:** a 1-cell contour in a chosen slot.
- **Mirror:** left-right, or a kaleidoscope.

Ready-made **looks** (presets of the stack) get live previews on the visitor's own art, as in Nightgrain.

### Live effects (they play in the app; the exporter writes them)

`live: [{ type, ... }]` per layer, on the same 0.05 s clock, alongside `motion`:

| `type` | Fields | What it does |
| --- | --- | --- |
| `cycle` | `period` s (2-60) | The layer's colours step through each other in order, like Nightgrain's colour cycling. Water, neon, fire. |
| `pulse` | `period` s (2-20), `low` 0.4-0.95 | The layer's opacity breathes down to `low` and back. Lights, glow. |
| `glint` | `period` s (4-60), `slot` | A narrow band of light sweeps across the layer's cells now and then. Only if the player draws it cleanly and inside the frame budget; otherwise the exporter says it is not available. |

Every live effect and motion counts in the frame-cost estimate, and the checks name the layer that costs most.

### Where the new code goes

- `editor/fx/`: the looks (a third helper builds it). The site build copies it to `docs/editor/fx/`.
- `editor/lib/`: assets and `frames`/`anim`/`live` in the exporter, and the per-layer cost shares.
- `editor/app/`: upload (file, drop, paste), place (drag, scale, flip), the look inspector with presets, live effects, and "hold to compare with the original".

## Changes

### 2026-11-16, the exporter as built (`editor/lib/`)

Nothing above is removed; these are additions and the places where the exporter had to decide. `editor/lib/NOTES.md` has the reasons and the test results.

**API.**

- `exportScene(project, momentId)` returns `{ svg, chars, raw, problems, costs, ms, merged }`:
  - `raw` is the file's own length. `register.tsx` stamps `--m:-<seconds>s` into the scene, so a scene fits when `chars <= 131072` and `raw + 16 <= 131072` (`LIMIT`, `HEADROOM`).
  - `costs` is `[{ layer, name, chars, ms }]`, one entry per layer. Cells the exporter filled have `layer: null`.
  - `ms` is the estimated frame cost.
  - `merged` is the colour merge level the scene needed (0 to 6).
  - An optional third argument, `{ levels, encoder }`, is for tests.
- `exportAll(project)`: each of its `scenes` has `{ id, svg, chars, raw, ms, merged, costs, problems }`.
- `buildArchive(project, { scenes, looks, preview, modFiles, deflate })`:
  - `deflate` is an optional raw-deflate function. Without it, entries are stored, since the browser has no synchronous deflate.
  - It throws an `Error` on a project error, a missing template, or a scene over the limit.
  - Editor archives credit "Made with the BackdropKit editor" and list "BackdropKit editor" as the author.
- More exports from `export.js`:
  - functions: `mergeMoments`, `scrubbedLength`, `encodeCells`, `decodeCells`, `playMotion` (the plan a motion snaps to);
  - constants: `LIMIT`, `HEADROOM`, `FRAME_LIMIT_MS`, `MERGE_LEVELS`, `MOD_FILES` (the 8 file names to fetch from `docs/editor/mod/hooks/`), `SITE_SLUGS`, `FRAME_MODEL`.
- Every helper in `browser.js` is async:
  - `measureLook(svg)`;
  - `previewPng(svg)` or `previewPng(project, scenes)`, which takes the hero moment;
  - `pictureFromSvg(svg, { maxColors })` returns `{ colors, cells, exact }`;
  - `pictureFromSvgs({ momentId: svg })` returns `{ palette, byMoment, pictures }`, a starter's picture layer;
  - `pictureFromImage(source, { colors: 2-64 (default 24), dither: 0-1 or true })` returns `{ colors, cells }`;
  - `canvasOf(svg, w, h, background)`.
- Picture cells are 1-based: cell `n > 0` is `colors[n - 1]`, and 0 is empty.
- `engine/pack.mjs` now imports `editor/lib/archive.js`, `look.js` and `zip.js`. The 13 site archives come out byte for byte as before.

**Times snap to whole 0.05 s ticks:**

| What | Snaps to |
| --- | --- |
| `drift` | `16k/m` s (m from 1, 2, 4, 5, 8, 10 cells a step, a step every k ticks), the nearest to the asked period |
| `fall` | `10k/m` s |
| `twinkle` | a multiple of 0.2 s |
| `cycle` | a multiple of (number of colours) x 0.05 s |
| a frame of `frames` | `round(20 / fps)` ticks, so 8 fps plays at 6.7 |

**Decisions.**

- Every scene is pinned to the bottom centre (`xMidYMax slice`), as the site's themes are.
- A layer with `frames` uses them at every moment and ignores `byMoment`. Frame 0 is the still frame.
- Each layer takes one live effect of each type. A second one of a type is left out with a warning.
- `glint` is available, but not on a layer with `frames` or one under three cells thick; those get a warning and no glint.
- Cycling colours are never merged.
- A slug equal to one of the 14 site themes is a warning: installed, it would replace that theme.
- The exporter does not read `assets`, `place`, `look` or `gen`.

## fx API (`editor/fx/`, as built 2026-11-16)

Plain ES modules, no dependencies. `index.js` (and everything it imports) runs in the browser and in Node; `browser.js` needs the DOM. The full field list is the comment at the top of `editor/fx/index.js`; notes, costs and what was tuned are in `editor/fx/NOTES.md`.

```js
import { applyLook, applyLookFrames, fitLook, estimateCost, placeAsset, fitPlace, removeBackground,
  normalizeLook, withPreset, renderCells, DEFAULT_LOOK, LOOK_PRESETS, PALETTES, ALGOS } from './fx/index.js'
import { decodeAsset, rgbaFromFrame, previewLook } from './fx/browser.js'

decodeAsset(file)                       // -> Promise<{ name, w, h, frames: [{ png, delay }] }>, the `assets` entry
rgbaFromFrame(asset.frames[i])          // -> Promise<{ w, h, data }>
placeAsset(rgba, place)                 // -> { w: 320, h: 200, data }: the frame on the grid (nearest when enlarging, area average when shrinking)
applyLook(placed, look, { palette })    // -> { cells: Uint16Array(64000), colors: ['#rrggbb', ...], w, h }
applyLookFrames([placed, ...], look)    // -> { frames: [Uint16Array], colors }: one palette for every frame
estimateCost(cells, colors)             // -> { chars, runs, paths, colors, ms }: the layer's SVG size, a few ms
fitLook(placed, look, { budget, measure }) // -> { look, frames, colors, cost, steps, fits }: simplified until it fits
previewLook(placed, look, scale)        // -> a canvas (for preset thumbnails on the visitor's art)
```

- A look is `{ cut, picture, colors, dither, shapes, glyphs, outline, mirror }`; missing fields take `DEFAULT_LOOK`'s. `normalizeLook` clamps; `withPreset(look, preset)` lays a preset over a look and keeps the look's `cut`. `LOOK_PRESETS` is `[{ id, name, hint, look }]`.
- Cells: 0 is empty (the art under 50% alpha), n is `colors[n - 1]`; colours come darkest first. The editor maps them to palette slots (reusing an exact colour already there) when it writes the layer's `cells`.
- `colors.from: 'project'` takes `opts.palette` (the project's palette entries or hex strings); `opts.colors` forces an exact list.
- `estimateCost` counts the encoder's runs and paths (under-dilation, corners, backing, 64-run paths) and is fitted to `emitSafe` in `editor/lib/encode.js` (`editor/fx/test/calibrate.mjs`): within 4% at the median and 10% at p90 (worst about 35%, on dot patterns). A whole exported scene differs more (the exporter tiles still pictures): 7% at the median, up to about 30%. Fast enough for every slider move (about 9 ms). `fitLook` is not (one applyLook per step): run it on a button or after the slider is let go; pass `measure: (frames, colors) => exportScene(...).chars` and `margin: 0` to fit the exporter's own count.
