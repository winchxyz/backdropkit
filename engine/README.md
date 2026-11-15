# BackdropKit engine: no hairlines at any size

A scene is a 320 x 200 grid of cells. In the app (and the gallery) it is drawn at whatever size the window has. When one cell is not a whole number of screen pixels, the edge between two shapes falls inside a pixel. Each shape is antialiased on its own, so that pixel is part one shape, part the other, and part whatever lies under both. The result is a thin line along the edge, lighter or darker than both sides, as if the pixels had outlines.

At the owner's window (1536 px wide at 125%, exactly 6 device px per cell) this never shows. In every other window it does. Every scene must be clean at every size.

## Where hairlines come from, and the fix for each

1. **Between colours inside one layer.** Two colours meet and the layer beneath (or the backing) shows through between them.
   - **Fix:** write cell layers with `emitSafe` from `encode.mjs`.
   - Each colour also covers the neighbouring cells of colours drawn after it, darkest first. A later colour's edge then always lies over a solid earlier one.
   - It does this only where the colour beneath would differ by more than `T` (default 28, the mean channel step) from both sides, so the cost stays small.
   - It also tries backing by the commonest colour and keeps whichever is shorter.
   - At whole-pixel sizes the picture is unchanged.
2. **Between two paths of one colour.** A path may hold at most 64 runs, so a big colour is split, and the joins show what is beneath.
   - **Fix:** `emitSafe` makes each later path also cover the cells of earlier ones that touch it.
3. **Pattern tile edges.** A `<pattern>` is drawn into its own bitmap. Where the tile or the rect it fills ends inside a screen pixel, the edge row of that bitmap blends with nothing.
   - **What it looks like:** the scene's longest lines, running straight across the whole picture along a mist strip or band of cloud.
   - **Fix:** the tile needs a clear row or column at every edge that falls inside the picture (an object-bounding-box tile already has a 1-cell clear margin).
   - For a repeating strip whose content crosses the tile joins, one of these:
     - make the rect's edges fall on clear rows;
     - or overlap the copies by a cell (two `<use>` copies of a group instead of a pattern);
     - or keep the content off the join column.
4. **Two layers or parts that abut exactly.** For example an object cut into two moving pieces, a sky band against the next one, or a part against the part beside it.
   - **Fix:** carry the lower one a cell under the upper one, as Sunfield's sky bands do (stroke width 5 for 4-cell bands).

## Tools

All tools draw the scene the way the app's player does, as an `<img>` of the SVG, with motion held at the first frame.

- `node engine/seamscan.mjs <scene.svg ...> [WxH@dpr ...]`
  - Counts holes and 1-px line pixels at 11 window sizes:
    - the owner's;
    - laptop and desktop at 1x, 1.25x, 1.5x and 2x;
    - the gallery stage;
    - an odd window.
  - A size fails at more than 60 line pixels or any hole.
  - Options: `SAVE=dir` writes a 4x crop of the worst spot per size, to look at. `T=37` holds the motion 37 s in, which checks moving parts mid-way.
- `node engine/seamwho.mjs <scene.svg> WxH@dpr`
  - Hides each element in turn and lists the ones whose removal takes away the most line pixels.
  - `DEPTH=n` goes deeper into groups.
- `node engine/pixeldiff.mjs <before.svg> <after.svg>`
  - Compares two pictures at 6 px per cell, where no hairline can form.
  - Changes along 1-px colour edges are the hairlines going away. Changes inside areas mean the picture changed.
  - `DIFF=out.png` marks changed pixels in magenta.

## Using emitSafe

```js
import { emitSafe } from '../../engine/encode.mjs'
// in place of emitCells(L, ox, oy), or a scene's own backing / terrace variants:
emitSafe(L, { ox, oy })            // Sunfield Layer in, '<path stroke="#..." d="..."/>' out
emitSafe(L, { ox, oy, T: 40 })     // cheaper: tolerate steps up to 40
```

- The output has the same shape as `emitCells`: stroke-width-1 runs, with the picture shifted down half a cell by the caller.
- Quotes are `"` unless you pass `q: "'"`.
- The caller still decides patterns, groups and motion.

## What the 13 scenes taught

Every scene in `prototypes/` was fixed with this engine. Most needed a little more than `emitSafe`, so each keeps its own encoder next to its `build.mjs` (`encode-local.mjs`, or `encode.mjs` in deep-reef, moon-keep and rainy-studio). Start a new scene from a copy of `tide-line/encode-local.mjs` or `harbor/encode-local.mjs`; their headers explain each option. What they add:

1. **Backing leaks.** The backing colour can leak along a layer's outer edge and as dots at four-colour corners. Keep it off outer cells (the `edge` option), and let the earliest colour at such a corner cover the 2 x 2 block.
2. **Tell the encoder what lies beneath.** An `under` or `beneath` map lets it lay a colour under its neighbour only where something different would show through.
3. **Pattern tiles on the grid.** Put a tile's corner on a cell corner, with a clear cell on every side. A half-cell offset blurs every row edge at 9 px a cell, and filled edge rows wrap round inside the tile bitmap.
4. **Small tiles.** A tile over about 1,000 cells wide, or over about 28,000 cells in all, is drawn as a scaled bitmap and blurs every cell, even at whole-pixel sizes. Cut big still layers into bands of about 100 rows, each carrying one row under the next.
5. **Soft corners on big paths.** Chromium's GPU raster rounds the corners of a path whose on-screen box is large on both sides. Cap a path once its box is over 21 rows high and 21 cells wide; writing each colour in rows or columns, whichever is shorter, keeps the cost down.
6. **Moving layers over one another.** Draw the upper layer in two coats (`<use href='#id'/>`), which leaves whole cells unchanged; a third coat rarely helps and costs frame time.
7. **Culling.** Cells hidden under still layers can be dropped, but keep a one-cell margin under every edge.
8. **Translucent overlays** (glints, foam, light): give them a skirt in the colour beneath, matched at every opacity they take. A lip (a half-cell stroke along an edge over a lower layer of the same colour) works where everything that can show under it stays within 6 levels.
9. **Colour merges** save characters, but keep them within 4 to 6 levels; bigger steps show on smooth reflections.

`node engine/purity.mjs <scene.svg>` catches the blur of lessons 3 and 4, which `seamscan.mjs` does not count: at 6, 8 and 9 px a cell it counts pixels that differ from their cell's centre. `HIDEGRAD=1` hides gradients (light, mist), which vary inside a cell by design.

The tools look for Playwright's Chromium under `%LOCALAPPDATA%\ms-playwright` (they were written on Windows); `npm install` at the repository root brings `playwright-core`.
