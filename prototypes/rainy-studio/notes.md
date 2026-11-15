# Rainy Studio

A desk by a big three-pane window on a rainy city. A green swing-arm lamp stands on a stack of books on the right, with a mustard mug of coffee in its beam. A plant, a succulent on two books and an open notebook with a pencil sit on the desk, and dark red curtains frame the window. Outside, three planes of city: hazy far towers with three landmarks (a spire, a crowned tower and a radio mast), mid towers with lit windows and an elevated railway, and near brick rooftops with a water tank and a neon sign. The window glass carries fog, a diagonal sheen and beads of water.

## Moments

- **Day.** A grey rainy afternoon. Overcast light from the window, the city pale in the haze, the lamp on anyway.
- **Evening.** Blue hour. A warm glow sits low under the cloud, about a fifth of the windows are lit, the mast light comes on, the neon sign glows pink and cyan, and out-of-focus city lights show on the glass. The room is lit mostly by the lamp.
- **Night.** A dark sky, about two fifths of the windows lit, more out-of-focus lights, rain lit by the city. Only the lamp lights the room.

The room's lighting is baked into each moment: the desk, the wall, the curtains, the books and the plant are multiplied by an ambient colour and warmed by the lamp's falloff and cone.

## What moves

All motion runs in whole cells, in `steps()` on the shared 0.05 s clock. Every delay is `calc(<offset> + var(--m))`.

- **Rain, two layers.** A far layer of 95 short streaks moves 1 cell per tick, and a near layer of 26 longer ones moves 2 cells per tick, clipped to the glass.
- **Running drops.** 7 drops on the glass stick for 2.5 to 5 s, slip one row every 2 ticks down their own pane, then fade. Each drop has its own loop of 20, 25 or 30 s, and each leaves a cleared track in the fog.
- **Steam.** 3 ribbons rise from the mug through the lamp beam: 24 cells in 6 s, fading in and out.
- **Mist** between the far and mid city swings ±6 cells on an eased 48 s path, alternating.
- **Train.** An elevated train crosses the mid city once a minute.
- **City windows.** About 10% of the lit windows go off and on, on cycles of 23 to 43 s (evening and night).
- **Mast light.** The red light on the mast dims every 4 s (evening and night).
- **Dust motes.** 7 motes drift in the lamp beam on 10 to 13 s loops.

With reduced motion, `@media (prefers-reduced-motion:reduce){:root *{animation:none!important}}` leaves the finished frame: rain and drops in place, the steam column standing over the mug, the train parked mid-window.

## Files and sizes

| Moment | SVG chars | after the motion scrub (estimate) |
| --- | --- | --- |
| day | 115,949 | 116,344 |
| evening | 124,083 | 124,819 |
| night | 124,686 | 125,464 |

No path holds more than 64 runs. Big still layers sit in 20 to 23 patterns, holding about 11,100 to 11,700 runs. The sizes grew from 86k to 99k with the hairline fix (see Encoding and hairlines); `out/pre-seam/` keeps the earlier files as the pixeldiff reference.

- `build.mjs`: `node build.mjs` writes `out/rainy-studio-{day,evening,night}.svg`. Debug environment variables:
  - `DIAG=1` prints the runs and characters of each layer.
  - `SIZES=1` prints each pattern's box, runs and parts.
  - `DUMP=<dir>` writes each still set's cells as JSON.
  - `LAPS=1` prints how each see-through layer was placed (composited or a new set).
  - Tuning, for experiments only: `MAXA` (cells per tile, 28000), `COMP` (64), `ALIGN` (1), `MERGE` (0).
- `encode.mjs`: the scene's own copy of emitSafe (see Encoding and hairlines). `SPAN=<n>` sets the path box cap (21).
- `palettes.mjs`: the colours of each moment.
- `pixel.mjs`: a copy of `sunfield/tools/pixel.mjs`. Its one change is that a colour may carry alpha (`#rrggbbaa`, shortened to `#rgba` when it can be).
- `render.mjs`: `node render.mjs` draws each SVG through an `<img>` into `out/rainy-studio-<moment>.png` at 1536 x 864, with motion held at its start. It takes these environment variables:
  - `T=<s>` holds the scene at another time.
  - `STILL=1` draws the resting frame.
  - `VW` and `VH` set another picture size.
  - `CROP` and `SCALE` write an enlarged crop.

  It uses `playwright-core` from `node_modules` and the local ms-playwright Chromium.

## Player check

`node "../sunfield/tools/player-check.mjs" out/rainy-studio-<moment>.svg` ran with app code c95e4d2cf, at 1536 x 864 @1.25x, on an RTX 4070 Laptop GPU. The limit is 5.56 ms.

| Moment | window 1 avg / worst | window 2 avg / worst | result |
| --- | --- | --- | --- |
| day | 1.44 / 15.8 ms | 1.47 / 2.1 ms | PLAYS |
| evening | 1.64 / 27.9 ms | 1.61 / 2.3 ms | PLAYS |
| night | 1.90 / 27.6 ms | 1.68 / 2.6 ms | PLAYS |

Measured on 2026-11-15 after the hairline fix.

Most of window 2's cost is the player's read of its 64 x 40 canvas.

## Rule notes and open issues

- **Translucent colours.** Rain, fog, sheen, steam, the beam, the light pool and the out-of-focus lights use 8-digit hex colours. The whitelist and the player accept them.
- **Seams.** No filtered groups are used. The encoding itself keeps hairlines out (see Encoding and hairlines below); the dark under-layer (`<rect>` plus sky bands) is still behind every part.
- **Pinning.**
  - The room and the city stay centred.
  - The plant, the left books and the succulent are pinned left.
  - The lamp, the right books, the mug, the steam, the beam and the motes are pinned right.

  At 4:3 the lamp and plant move in toward the window. The chat column covers the window's middle pane and the notebook. The message box covers the desk front.
- **Time of day.** It is three separate scenes, with no cycle inside one SVG. A mod would pick one by the clock, as Sunfield's does, so a change of moment is a swap, not a fade.
- **Still frame.** The train sits parked mid-window.

## Encoding and hairlines

The first SVGs were drawn with emitCells and showed hairlines at most window sizes. The worst scans were day 2,545 line pixels, evening 4,641 and night 305, with lines even at 6 px a cell. The encoding was redone on 2026-11-15. The cells, colours, pins, groups and motion are unchanged; the style block and the animated groups are identical to `out/pre-seam/`.

### Causes

1. **Paths meeting inside a layer.** Two paths that share a cell edge each antialias it, so what lies beneath leaks through. Two runs of one colour in different paths leaked 16%, even at 6 px a cell.
2. **Outline fringe.** A colour drawn under a layer's outline cells leaks at the outer edge. The leak is about a quarter of (that colour minus what is behind the layer): 22 levels on the mid-tower edges.
3. **Pattern tiles.**
   - The room tile (324 x 203 cells) was past Chromium's tile limit, so it blurred.
   - Tiles had no clear cells at their sides.
   - Tile corners sat half a cell off the grid, so the tile bitmap was resampled. This drew a line at every train row at 9 px a cell.
4. **Culling.** cull() deleted lower cells right up to an upper layer's edge, so the dark under-layer showed along the near roofs, the rail and the mist line.
5. **Small see-through layers.** A small layer such as the pot shadow started a new pattern, and its edge lined against the set below.

### Fixes

- **`encode.mjs`** is a local copy of `engine/encode.mjs` (emitSafe). It is local for two reasons: the scene's `#rrggbbaa` colours need handling the shared one does not have, and the fixes below change its output while 13 scenes share `engine/`. Its changes:
  - See-through colours are nested per connected group and drawn under their solid neighbours.
  - Each colour is also drawn under the cells of the colours that come after it, so a shared edge has the same colour on both sides. The backing is redrawn around cells it cannot sit under.
  - Outline cells get nothing under them. The exception is a soft outline: everything on screen around it, behind the layer, is within 20 levels of the backing. The build tracks what is on screen behind each cell; regions that move or wrap count as unknown.
  - A path's box is capped at 21 cells when both sides are longer, and a path holds at most 64 runs.
  - To save size, gaps that later paths paint are bridged along rows. Two colour orders and bridging on or off are tried, and the shortest result is kept.
- **`build.mjs`**:
  - Tiles hold at most 28,000 cells and have one clear cell on every side. Their corners sit on cell corners (pattern viewBox `0 -.5 W H`, rect at y0 - 1.5). The defs sit at the end of the file.
  - cull() works across consecutive parts in one viewport. It keeps a 1-cell ring under every upper edge, coloured with the nearest colour to the one over it.
  - A see-through layer that overlaps the still set by at most 64 cells is composited into the set. Bigger ones (the beam, the halo, the sign glow) start a new set.
- **Tried, not kept:**
  - tile corners on every 2nd or 4th cell (`ALIGN`), which moved the fails around;
  - merging colours within a few levels (`MERGE`), which was not needed for size.

### Scan results

`node ../../engine/seamscan.mjs out/rainy-studio-*.svg` passes at all 11 default sizes. Most line pixels over those sizes:

| Moment | T=0 | T=37 | T=50 (train mid-window) |
| --- | --- | --- | --- |
| day | 17 | 11 | 15 |
| evening | 17 | 22 | 33 |
| night | 19 | 8 | 21 |

- Every size at 6, 8 or 9 px a cell scans 0.
- At extra sizes:
  - 3840x2160 scans at most 5;
  - 2560x1600 scans 0;
  - 1920x1200 @1.25 (7.5 px a cell) scans day 31, evening 45 and night 25. All pass.
- pixeldiff against `out/pre-seam/`, at 1920x1080 and 1536x864 @1.25:
  - day 1,332 px, evening 4,127, night 2,057;
  - all on 1-px colour edges, mostly the old seams along the mid-tower stripes and the plant leaves.
