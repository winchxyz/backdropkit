# Exporter notes (editor/lib)

The exporter turns an editor project (`editor/PROJECT.md`) into the scenes the Claude desktop app plays and into an installable theme archive. This file is the log: what each module does, what was decided and why, and what the tests showed. A later agent should be able to carry on from here.

## Modules

| File | Runs in | What it does |
| --- | --- | --- |
| `export.js` | anywhere (Node, page, worker) | The API: `exportScene`, `exportAll`, `checkProject`, `themeModule`, `buildArchive`, `promptFor`, plus `mergeMoments`, `scrubbedLength`, `encodeCells`/`decodeCells`, `playMotion`, constants (`LIMIT`, `HEADROOM`, `FRAME_LIMIT_MS`, `MOD_FILES`, `SITE_SLUGS`, `MERGE_LEVELS`, `FRAME_MODEL`). Builds each moment's picture, encodes it, merges colours when over the limit. |
| `encode.js` | anywhere | The engine's hairline-safe encoder (`engine/encode.mjs` plus the Harbor and Tide Line local changes) on dense typed arrays: `emitSafe(L, opts)`, `costOf`, `runsIn`, the frame grid (`FX`, `FW`, `FH`, `FN`, `at`). The same output as Harbor's `encode-local.mjs` (checked on harbor-day: 148,572 characters both), about 100 times faster. |
| `motion.js` | anywhere | Time: `plan(motion)`, `planLive(effect)`, `flipPlan(frames, fps)`, `cycleBody`, `ruleBook()` (one CSS rule per distinct plan), `secs`, `TICK`. Every time is whole 0.05 s ticks; every animation starts at `calc(var(--l,0s) + var(--m))`. |
| `archive.js` | anywhere | The archive's text, shared with `engine/pack.mjs`: `themeJs`, `readme`, `description`, `stampRegister`, `archiveEntries`, `installPrompt`, `heroOf`, `clock`. Flavour `by: 'packer'` (the site's 13, byte for byte as before) or `'editor'`. |
| `zip.js` | anywhere | `zip(entries, { deflate })` and `unzip(bytes, { inflate })`, the format of `app/tools/zip.mjs`. Stored entries in the browser; `engine/pack.mjs` passes zlib's deflate and gets the same bytes as before. |
| `look.js` | anywhere | `stillOf`, `statsOf`, `glassOf`: the tone and glass of a moment, exactly as `engine/pack.mjs` measured them (it imports them now). |
| `color.js` | anywhere | Hex helpers, `levels` (largest channel step), base64 cells (`encodeCells`, `decodeCells`), `utf8`. |
| `browser.js` | page only | `measureLook(svg)`, `previewPng(svg)` or `previewPng(project, scenes, looks)`, `pictureFromSvg(svg, { maxColors })`, `pictureFromSvgs({ id: svg })`, `pictureFromImage(source, { colors, dither })`, `canvasOf(svg, w, h, bg)`. All async. |

`engine/pack.mjs` now imports `archive.js`, `look.js` and `zip.js`. After the change it packed all 13 site themes into the same bytes as before (`cmp` of every zip, and `packs.json` identical), and `engine/check-packs.mjs` passed all 13.

## How a scene is made (export.js)

1. **Layers of the moment.** Visible layers whose `show[moment]` is not false, bottom first. A layer's cells are `frames` when it has them (every moment), else `byMoment[moment]`, else `cells`. Slots past the palette are an error and left empty. A slot without a colour for the moment takes the first moment's colour it has.
2. **Units.** A layer with no motion, one frame and no live effect is still. Neighbouring still layers are flattened into one still picture (the upper cell wins). Every other layer is its own moving unit.
3. **Fill.** Every cell no still picture covers is filled into the bottom still picture (a new one at the bottom when the bottom layer moves), from the nearest colour shown at rest (breadth-first). Under a moving layer that is the layer's own colour at rest, so whatever it uncovers as it moves looks like it. Cells empty in every layer are a warning.
4. **Cull.** A still cell under a still picture above it is dropped unless one of its 8 neighbours shows: a one-cell margin under every edge. Moving layers are never culled and never cull.
5. **Encode.** Still pictures with 55 runs or more go in pattern tiles (`<pattern width='1' height='1'>` on a rect from `x0 - 1, y0 - 1.5`, one clear cell all round, the corner on a cell corner). A tile over 28,000 cells or 1,000 wide is cut into bands that overlap by two rows (see below). Small pictures and every moving layer are plain paths. Encoder settings (Harbor's): T 28, maxRows 19 for paths between 21 and 120 cells across, no outer-edge backing, two orders (darkest first, and 'group', see Decisions), three backings tried; the shortest wins.
6. **Motion** (`motion.js`), in two coats for every moving layer (`<g id>` plus `<use>`):
   - drift: the layer plus a copy one width behind (`<use x='-320'>`, or `x='320'` going left), each extended by one wrapped column on both sides so the seam lies over the same colour; `translateX` in `steps(320/m)`. The loop is `(320/m) * k` ticks, m cells a step every k ticks: m is the smallest step (1, 2, 4, 5, 8, 10) that brings the period close, so the period plays as `16k/m` s (asked 120 s: 120; asked 20 s: 16).
   - fall: the same down the 200 rows (`y='-200'`), `10k/m` s.
   - sway and bob: `translateX/Y` by whole cells, `round(amount * sin)`, keyframes only where the offset changes, `steps(1)`.
   - twinkle: 8-connected pieces of the layer dealt into 4 groups; each group dims 1, .7, .4, .7, 1 in its own quarter of the period (period a multiple of 4 ticks), the opacity on the group outside its two coats.
7. **Frames** (`frames` + `anim.fps`): each frame lasts `round(20 / fps)` ticks (8 fps plays at 6.7). Frames are groups inside the coats; frame 0 is shown when still, the rest carry `opacity='0'`, and one shared rule shows each in its slot (`--l`). Works with any motion (the drifting cat in the art test).
8. **Live effects**, one of each per layer:
   - cycle: the layer's colours (its slots in slot order) step through each other: one rule holds the sequence as `stroke` keyframes and each colour's paths get `--l` so colour i runs i steps ahead. Cycling colours get their own entries in the colour table, are never merged, and are encoded with T -1 (every edge covered whatever colours meet there) and no backing.
   - pulse: the layer's outer group, opacity eased 1 to `low` and back in steps of .05.
   - glint: available. The layer's inner cells (all 4 neighbours in the layer, so the band never touches the layer's outer edge) are cut into at most 32 diagonal stripes, each a group in the glint colour (`slot`, else white) at opacity .75 for one tick at the start of each period, one after another. Each stripe is shown alone, so no two stripes ever meet. Not on a layer with frames (warned and left out). Checked on art-wall's lamp:
   - Drawn cleanly: seamscan at T=0, 0.1 and 1, while stripes are lit, finds 0 holes and at most 33 line px.
   - Scrub-safe: every stripe is `opacity='0'` in the still frame, which app-check keeps with no change.
   - Within the frame budget: about 0.8 ms a frame in the player.

   So glint is available rather than reported as "not available".
9. **CSS**: one rule per distinct plan (`.ka{animation:...}` with `@keyframes ka`), and the reduced-motion rule. Root: `<svg xmlns fill='none' font-family='a' color='a' style='--m:0s'>`, `<style>`, `<defs>` (the tiles), then `<svg viewBox='0 -.5 320 200' preserveAspectRatio='xMidYMax slice'>` holding the body. Every layer is pinned bottom-centre, as the site's themes are.
10. **Size.** `chars` is the length after the app's still-frame scrub (`scrubbedLength`: each CSS rule becomes `sel { }`, keyframes go, every `<tag/>` becomes `<tag></tag>`). It matched `app-check.mjs STILL=1` exactly on every test scene. The raw file must also leave 16 characters for the `--m` stamp that `register.tsx` writes. Over either, the encode is run again with near colours merged at 1, 2, ... 6 levels (largest channel step): colours are taken commonest first and each joins the nearest kept colour within the level. The first level that fits wins; when none does, the smallest result is reported with an error naming the three costliest layers (and, for art, how many colours they use and what to change).
11. **Costs.** `costs: [{ layer, name, chars, ms }]` per layer (a still picture's characters shared out by the runs each layer starts in it, not by its cells, so a plain wall under a dithered painting costs little; filled cells are their own entry with `layer: null`), and `ms`, the frame estimate (`FRAME_MODEL`): 0.3 ms, plus 0.002 ms per thousand still characters, plus `0.08 * K^0.69` for the K thousand characters of moving parts drawn each frame (coats and copies counted), shared out among the moving layers by their K, plus 0.002 ms per animated element. Over 80% of the 5.56 ms limit is a warning, over it an error; both name the costliest layer.

## Decisions

- **Bands overlap by two rows.** With Snowfall Ridge's split (the lower band repeats the upper band's last row as strict cells, one row of overlap) the first generated test scene had holes and up to 560 line pixels along the whole join at every fractional size: the edge between the strict row and the row under it lay over the upper tile's own bitmap edge. Snowfall Ridge had a `hidden` option for that; here the upper band simply carries the lower band's first row too. After the change: 0 holes, at most 8 line pixels.
- **Colour orders: darkest first and 'group', not largest first.** The first full run had the Harbor starter (day, sunset) and the near-limit scene failing seamscan: up to 108 line pixels, along rows where two near-equal colours meet (`#add2f6` over `#b4d5f6` with a `#a6c7eb` line between). A lower T did not help (T 16: 119), so it was not the backing showing. It was the colour drawn *between* the two: when A is drawn before D and D before B, D's under-dilation covers B's cell and shows at about a quarter on the A/B edge. Darkest first keeps near colours next to each other in the order, so what is drawn between them is near too (52 at worst on harbor day), but it is 8% longer. Largest first, which `'both'` adds, was the shortest and the worst (Harbor's own notes found the same: "On all layers 'area' added lines"). The new `'group'` order in `encode.js` chains colours into groups, draws groups largest first and each group darkest first. Harbor day at merge level 2, line px at 1680x1050@1, 1440x900@1, 1536x864@1 and 1200x780@1.25: area 127,431 chars and 108/44/23/90, lum 138,022 and 58/3/28/10, group (any two palette colours within 10) 131,302 and 43/15/14/33. That still failed sunset (75 at 1440x900@1): `#361a38` under `#2d1532` (20 apart, so in two groups) with an orange drawn between them that covered the upper cell, showing through at about 15%. Linking any palette colours within a larger distance made the results jump about (16: day 11, sunset 69; 20: day 62), so groups now link only colours that actually meet in the layer, side by side or one above the other, within `near` 40. With the merge ladder: day 130,533 (level 2) 20/13/4/8, sunset 129,390 (level 3) 0/2/1/0, night 131,054 (level 0) 0/0/3/1, near-limit 124,210 (level 3) 1/0/0/0. The exporter tries `['lum', 'group']` with `near: 40`.
- **The frame model goes with the moving parts.** player.mjs splits a frame into draw, read and detector, and the read (waiting for the picture to be drawn again) is nearly all of it. Harbor's 130k still characters under one small drifting cloud layer measure 0.55-0.6 ms; the valley's 100k under 30k drawn moving characters, 1.1-1.5 ms; the valley with its dithered sky drifting (512k drawn), 6.39 ms (STILL); with both ridges drifting (49k), 1.64 ms. A straight line through characters could not fit both ends (0.032 per k: 17.7 ms for the sky; 0.011: everything small under by 0.3-0.5), so the moving term is a power, `0.08 * K^0.69`. It came out within about 0.3 ms at all 11 points (scratch fit, two test runs; the player's own numbers move by about 0.3 ms from run to run). Not measured: big flat moving areas with few characters, and other GPUs.
- **Merges are Chebyshev, commonest first.** Merging by adjacency was worse. Results are not monotonic in the level (a level can come out longer than the one before), so the ladder stops at the first that fits and otherwise reports the smallest.
- **Exact multi-moment pictures.** `mergeMoments` pairs colours across moments by how often they share cells, then fills each moment's leftovers side by side into slots with no colour yet for that moment: every moment comes back exactly (Harbor: 693, 781 and 971 colours in 971 slots, every cell exact). A slot pairing that loses colours (an earlier draft lost about 6% of cells) is not acceptable for a starter.
- **Pictures are 1-based**: in `pictureFromSvg` and `pictureFromImage`, cell n > 0 is `colors[n - 1]`, 0 empty.
- **Rest state** for `pictureFromSvg` is `*{animation:none!important}`: frame 0, motion at its start, glints hidden (they are `opacity='0'` when still), pulses and twinkles at full.
- **Editor archives**: credit "Made with the BackdropKit editor (repo). Not made by Anthropic.", author "BackdropKit editor", README says project.json opens in the editor, project.json is the project. In the browser they are stored (no synchronous deflate), so about the size of their files.
- **Slugs**: a project slug equal to one of the 14 site themes is a warning (it would install over that theme).
- **Not read**: `assets`, `place`, `look`, `gen` (editor-only). Image layers export from `cells`/`frames` like any layer.

## Tools in editor/test

- `node editor/test/run.mjs [outDir]`: everything below, on the test projects. `ONLY=slug,...`, `SKIP=seam,app,player,archive`.
- `node editor/test/player.mjs <scene.svg>`: a port of `sunfield/tools/player-check.mjs`. That tool stops with "the app's scene list code has changed shape": on 2026-11-15 the app split its player code across modules (the allowlist in one, the flash counter in another, importing its brightness ramp from the first). `app-player.mjs` reads the app's HTTP cache, finds both shapes, and extracts the allowlist, parser and flash counter with their dependencies. Same page, same measure, same output as player-check; harbor-day plays at about 1.3 ms.
- `page.mjs`: a Chromium page serving the repository at `http://kit.test/`, so `browser.js` runs as in the editor.
- `projects.mjs`: the test projects.

`playwright-core` must resolve from `editor/test/` (a `node_modules` above the repository will do) or be named by `PLAYWRIGHT_CORE`, with a Playwright Chromium under `%LOCALAPPDATA%/ms-playwright`. app-check is `../sunfield/tools/app-check.mjs`, next to this repository. check-packs needs `claude` and `tsc` on the PATH.

## Test projects

1. **test-valley** (generator scene). The layers:
   - Sky: 10 dithered bands.
   - Stars: twinkle 6 s, hidden by day.
   - Clouds: drift 120 s.
   - Far ridge and Near ridge.
   - Lake: bob 4 s, 1 cell.
   - Snow: fall 30 s.

   Three moments (day, sunset, night), with the colours per moment in the palette.
2. **harbor-clouds** (starter). Harbor's three scenes go through `pictureFromSvgs` into one picture layer: 971 slots, 693, 781 and 971 colours, every cell exact. On top is a Clouds layer, drift 90 s leftwards.
3. **near-limit**:
   - Field: a 64-step ramp across the whole scene.
   - Speckle: 1,500 dots.
   - Birds: drift 200 s.

   It is 239,666 characters unmerged and has to merge to fit.
4. **too-much**: near-limit with 9,000 dots and a 24-colour checker image, Grain. It cannot fit at any level, so it checks the error path: the error must name Grain.
5. **art-wall** (uploaded art). Mirror Lake's day scene, drawn at 960 x 600, goes through `pictureFromImage` (24 colours, Bayer dither 0.5) and becomes the Painting image layer on a framed Wall. The other layers:
   - Ground.
   - Cat: 6 frames at 8 fps, drift 60 s.
   - Sign: cycle 2 s.
   - Lamp: pulse 4 s (low .6) and glint 8 s.

   Two moments.

## Test results (2026-11-16, final run)

Command: `node editor/test/run.mjs <outDir>`. It took 210 s and every check passed.

The checks:

- seamscan over its 11 default sizes (1536x864 at 1 and 1.25, 1920x1080, 1366x768, 1440x900 at 1 and 2, 1280x720@1.5, 1680x1050, 2560x1440, 1278x719@1.25, 1200x780@1.25), at T=0 and T=37. Art-wall is also scanned at T=0.1 and T=1, when glint stripes are lit.
- `STILL=1 app-check.mjs`. Its length after the scrub equals the exporter's `chars` in every scene, and the still frame is kept (0 px change in 2 s).
- The rest picture drawn back by `pictureFromSvg` equals the project's picture in every cell, within the merge level.
- player.mjs at 1536x864@1.25 (RTX 4070 Laptop, D3D11).

| Scene | chars (raw) | merged | seamscan: holes, worst line px (size) | player worst ms (estimate) |
| --- | --- | --- | --- | --- |
| test-valley/day | 103,112 (101,659) | 0 | 0, 6 (1680x1050@1, T=37) | 0.84 (1.21) |
| test-valley/sunset | 106,537 (105,153) | 0 | 0, 9 (1536x864@1, T=37) | 1.14 (1.35) |
| test-valley/night | 105,252 (103,886) | 0 | 0, 1 | 1.10 (1.30) |
| harbor-clouds/day | 130,533 (126,131) | 2 | 0, 20 (1680x1050@1) | 0.56 (0.67) |
| harbor-clouds/sunset | 129,390 (125,126) | 3 | 0, 2 | 0.82 (0.67) |
| harbor-clouds/night | 131,054 (124,030) | 0 | 0, 3 | 0.81 (0.68) |
| near-limit/day | 124,210 (122,515) | 3 | 0, 1 | 0.65 (0.63) |
| art-wall/day | 117,759 (116,557) | 0 | 0, 33 (1536x864@1, T=0) | 0.82 (0.90) |
| art-wall/night | 113,968 (112,802) | 0 | 0, 0 | 0.82 (0.89) |

More results from the same run:

- **Before merging:** harbor day was 144,100 characters and sunset 139,966. Each was brought to fit with one merge level.
- **too-much:** 396,970 characters, 265,898 over the limit at its smallest. The error names Grain (image, 24 colours, 246,652), Field and Speckle, and adds the art hint.
- **Costs:**
  - art-wall day: Painting 105,775, Wall 8,846, Cat 1,237, Lamp 850, Sign 624, Ground 116.
  - harbor day: Harbor 129,858, Clouds 402.
- **Archives:**
  - Built in the page, as the editor builds them: `measureLook`, `previewPng`, the template fetched from `/docs/editor/mod/hooks/`, then `buildArchive` (stored).
  - Sizes: test-valley 1,644,274 bytes, harbor-clouds 1,454,458, near-limit 801,250, art-wall 2,415,805.
  - theme.js imported back returns every scene byte for byte, in start order.
  - `engine/check-packs.mjs` passed all 4: contents, `claude plugin validate` on the mod and on the marketplace, `tsc`, and `claude plugin test` (5 to 7 tests each). Versions: claude 2.1.325, TypeScript 5.9.3.
- **engine/pack.mjs** after the move to `editor/lib/`: `node engine/pack.mjs docs/themes` wrote all 13 zips byte for byte as before, with `packs.json` unchanged. `node engine/check-packs.mjs docs/themes <scratch>/unpacked` passed 13 of 13.

## Not verified, and open

- **Not tried in the app.** No exported archive has been installed into the Claude app. The checks are the app's own code taken from its cache (app-check, player.mjs) and `claude plugin test`.
- **Editor wiring not tested.** The exporter has not been run from `editor/app/`.
- **`docs/editor/lib/` is a copy** made by `site/build.mjs` (`EDITOR_ONLY=1` for the quick loop). It is stale until the site is built again.
- **The frame model** was fitted on one GPU, with no large flat moving area measured.
- **Line pixels are sensitive to the picture.** Harbor day is 20 of the allowed 60. A new picture can land elsewhere, so the editor should keep seamscan-like checks to the tests, not promise them.
