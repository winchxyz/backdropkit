# Tide Line

A low view from the beach at the water's edge. A headland with a lighthouse sits on the left and a low island on the right, with a boat on the horizon. Three waves run up the sand in lobes of their own. Wet sand mirrors the sky. A marram dune is in the bottom-left corner and a driftwood log in the bottom right.

- `node build.mjs` writes `out/tide-line-{sunrise,sunset,night}.svg`. `STATS=1` lists the layers with the most runs.
- `node render.mjs [moments]` writes `out/tide-line-<m>.png` at 1536x864, drawn as an `<img>` with animations held at their start.
  - `T=3,6` writes motion frames to `out/frames/<m>-<t>.png`.
  - `CROP=x,y,w,h ZOOM=n` writes a zoomed crop.
- `node check.mjs` checks size, banned properties, viewport units, `@media`, `url()`, runs per path and the 0.05 s clock.
- The scene is painted in `build.mjs`. Palettes, clouds and wave lobes for each moment are in `moments.mjs`. Sunfield's `pixel.mjs` and `painters.mjs` are imported by path and nothing under `sunfield/` was changed.

## Moments

- **Sunset:** a big sun on the horizon with breathing rays and a lit cloud bank. The glitter path runs into a warm streak in the wet sand, and there is spray haze in the backlit surf.
- **Sunrise:** a smaller, higher sun, pastel pink and violet, with morning mist rows over the sea.
- **Night:** a full moon with a moon path and glitter. There are twinkling stars, a warm lighthouse lamp, lit windows on the headland, and a lamp on the boat. There are no rays or gulls.

## What moves

All motion uses `steps()` on the 0.05 s clock. Every delay is `calc(... + var(--m))`. One reduced-motion rule (`:root *{animation:none!important}`) stops everything.

- **Waves:** three lobes on 10 s, 12.5 s and 11 s cycles, out of phase. In each cycle:
  1. The swells move up a row.
  2. The breaking line glides 13 cells shoreward in slowing steps and fades.
  3. The swash sheet runs up the sand, fast at first and then slower, rests 0.4 s, and slides back.
  4. Its foam front follows and fades over 3 s, and lace left on the water fades out.
- **Glitter:** three spark sets on the sun or moon path take turns on a 1.5 s cycle, so each set holds 0.5 s. That is at most 2 toggles a second.
- **Light and sky:**
  - The sun rays breathe in opacity over 24 s.
  - At night the lighthouse lamp glows over 8 s and the stars twinkle on 4–6 s cycles.
  - Clouds drift by whole cells, there and back, over 40–64 s.
  - The see-through haze drifts over 40 s.
- **Small life:**
  - The boat drifts 40 cells over 100 s and back.
  - The grass tips sway on 4–6 s cycles.
  - Gulls (sunset and sunrise only) cross the sky over 120 s, bobbing and flapping their wings.

Frame 0 is a finished picture. Lobe 1's swash and foam rest up on the sand, and the other lobes show swells and remnant foam.

## Sizes (characters)

| SVG | chars | scrubbed (est.) | CSS | patterns | runs | max runs/path |
|---|---|---|---|---|---|---|
| sunset | 127,386 | ~122,400 | 10,835 | 34 | 12,460 | 64 |
| sunrise | 125,041 | ~119,700 | 11,161 | 35 | 12,118 | 64 |
| night | 120,874 | ~115,700 | 10,835 | 34 | 11,892 | 64 |

After the seam fix (see "Encoding and hairlines") all three SVGs are under the 128,000-character cap set for that fix, raw and scrubbed, and under the 131,072 limit; the earlier 120,000 target no longer holds. `check.mjs` reports ok for each.

## Player check

`node sunfield/tools/player-check.mjs` was run on each SVG at 1536x864 @1.25x (RTX 4070 Laptop, D3D11). The limit is 5.56 ms per frame. Other agents were running at the same time, so the numbers are noisy.

| SVG | window 1 avg / worst | window 2 avg / worst | result |
|---|---|---|---|
| sunset | 0.92 / 12.6 ms | 1.77 / 3.1 ms | PLAYS |
| sunrise | 1.22 / 9.1 ms | 1.94 / 3.3 ms | PLAYS |
| night | 0.94 / 8.9 ms | 1.85 / 2.8 ms | PLAYS |

(Measured after the seam fix, 2026-11-15.)

## Rule notes and open issues

- **No rule is broken.**
  - Only whitelisted elements are used, with single-quoted attributes and `url(#id)` only. Since the seam fix, `<use href='#id'/>` draws a second coat of some moving wave parts; the player check accepts it.
  - There is no `shape-rendering`, no `vector-effect` and no viewport units.
  - `@media` is used only for reduced motion.
- **Opacity changes.** The haze, the lamp, the rays, the star twinkles and the wave fades all change opacity. Each changes in single steps on the clock and never toggles more than twice a second. The haze layer also has an `opacity` attribute, which the whitelist allows.
- **Shared CSS.** All three moments carry the same CSS rule set. At night the ray and gull rules are unused, which costs about 0.5 KB.
- **Wide and tall windows.** Everything is pinned to the bottom of the window. The headland and dune keep to the left edge and the island and log to the right, and the horizon stays put. Windows narrower than 16:10 crop the sides of the middle layers. Wider windows crop the sky from the top: rows 0–19 are hidden at 16:9.
- **Weak spots.**
  - The driftwood log is still a fairly dark silhouette (it is backlit).
  - The far-left sea in the sunset is calmer than before, but it is still the busiest flat area.

## Encoding and hairlines

Fixed 2026-11-15: at fractional cell sizes the scene showed thin lines between cells. Encoding only; the art, light, composition and motion are unchanged. The originals are kept in `out/pre-seam/`, and the step-by-step log is in `seamfix-log.md`.

**Causes found and fixes**

- **Cell layers.** Every layer is now written by the engine's seam-proof encoder, through a local copy (`encode-local.mjs`; its header says what differs and why).
- **Pattern tiles.** Tile corners sat half a cell off the grid, so at 9 px a cell the whole bitmap was resampled. Tiles now start on a cell corner, with a clear cell on every side.
- **Sky, sea and sand bands.** These are full-width band strokes with the odd cells over them.
  - A cell whose band is far from it now keeps its vertical neighbour over the band.
  - The encoder is told which band lies under each edge (`under`). This joins cells only where needed; otherwise the sand alone costs about 6,000 more characters.
- **The horizon.** The sky, rays, sun, headland and island run one row under the sea (`underSea`), so no sky shows along the sea's top edge.
- **Still overlays** (glints, foam lace, the breaking lip; shown and hidden, never moved) leaked the sea under their edges.
  - Each now gets a skirt: around its edge it paints the colour already there.
  - Skirts go only where the colour beneath the edge is far from both sides and the outside is within 32 levels of the overlay, at each opacity the overlay takes.
  - Skirts stay off cells where glints or wave parts drawn earlier can show.
- **Layer edges** (encoder option `edge`). Nothing else lies under a cell on a layer's outer edge: neither the backing colour nor a neighbour's colour joined under it.
  - Without this, a swell's dark trough showed along its lit crest.
  - The pale backing of the grass tips showed under their dark foot.
  - The log's backing showed under its shadow.
  - Used by the log, the skirted overlays, the grass tips and the moving wave parts.
- **Grass tips against still blades.** The tips sway 0, 1 or 2 cells, and where a tip touched a still cell of its colour, the sand showed between them.
  - Each clump has three still groups (`j0`, `j1`, `j2`), copies of the cells on both sides of each such joint for one sway position.
  - Each group is shown only while the tips hold that position (keyframes beside `gs`), and lies under all the tips.
  - Hidden under the tip and the still blade, the copies change nothing.
- **Moving wave parts over the sea and sand** (swells, spray, bore, swash sheet, foam front). The colours under their edges change as they move, so they cannot be matched.
  - They are drawn in two coats (a repeated pattern rect, or `<use>`). A third coat on the bore made night worse.
- **Rounded, soft cell corners at 8–9 px a cell** on the moon and sun glitter, which the original had too. Chromium softens paths whose screen box is square-ish and middling, so a path more than 21 cells wide now spans at most 21 rows.
- **Size.**
  - The encoder tries darkest-first and largest-first and keeps the shorter, except for edge layers, where largest-first made lines.
  - Sunset's sand merges colours within 4 levels into a commoner one. This is the only change visible at whole-pixel sizes.

**Results** (seamscan, 11 default sizes; worst line pixels over the sizes; no holes anywhere)

| SVG | T=0 | T=37 | T=9 (lobe 1's swash half up) |
|---|---|---|---|
| sunset | 27 | 55 | 42 |
| sunrise | 44 | 57 | 44 |
| night | 52 | 60 | 40 |

- **Pixeldiff against `out/pre-seam/`** at 1920x1080 and 1536x864@1.25:
  - sunrise and night: 0 pixels differ;
  - sunset: 7,848 pixels differ, all in the wet and dry sand where colours were merged (steps of 4 levels at most).
- **Purity at 6, 8 and 9 px a cell:** 0 impure pixels. Before the fix, night had about 3,000 at 8 px and 8,000 at 9 px.

**Left**

- The moving wave parts still leak a little of the sea or sand under their edges, and so do grass tips where two clumps sway past each other.
- Every size passes, but a few sit near the limit: night 60 and sunrise 57 at T=37. The residue moves on with the wave, so it is never a fixed line.
