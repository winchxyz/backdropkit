# Cloud Sea seam fix: progress log

Brief: no hairlines at any window size in day, sunset and night, with the picture and motion
unchanged (encoding only). The originals are in out/pre-seam/ (made by the orchestrator; never
overwrite). Size at most 128,000 chars raw and scrubbed. Edit only this folder. No commits,
nothing published. Scratch files in the session scratchpad are prefixed `cloudsea-`.

## entry 1: start

- out/pre-seam/ holds the three original SVGs; `node build.mjs` reproduces them byte for byte
  (checked with cmp before any change).
- Next: run seamscan (SAVE=out/seams) on the three SVGs at T=0 and T=37, read the crops, run
  seamwho at the worst sizes.

## entry 2: encoder in

- encode-local.mjs: copy of tide-line/encode-local.mjs plus an opt-in `corners` option (low-orbit
  change 2, 2x2 blocks), not used yet.
- build.mjs: cellsOf() -> emitSafe (all cell layers and tiles); underlay() is Tide Line's fixed
  one (BAND_T 20, `under`); renderLayers passes `enc` of merged still layers and supports
  `coats`; cull() keeps a 1-cell margin under the edges of layers in front.
- Sizes: day 124,846 (scrub ~124,986), sunset 128,179 (~128,422), night 127,703 (~129,629):
  sunset and night are OVER 128,000; size must come down.
- seamscan T=0 max line px: day 111 (1680x1050), sunset 48, night 139 (1680x1050). Was
  1,000-2,800 before.
- Next: seamwho at night 1680x1050@1 and day 1680x1050@1, read crops; then cut size.

## entry 3: causes found, main fixes in (T=0 scans pass)

Findings (seamwho, cloudsea-lines/dump/probe):
- Plane tiles: each plane's backing lay under its lit top lip; the pattern bitmap is resampled
  at fractional sizes, so that backing showed as a dark fringe along every cloud top (row 99/100
  at day). Fix: encoder `edge: 'back'` for plane bodies (backing kept off outer cells, joins
  still allowed; both orders). `edge: true` with lum order cost +6k on day; with area order it
  made lines; 'light' order made lines.
- Two coats on the rolling planes made lines WORSE (day 111 -> 166): left at one coat
  (COATS env, default 1).
- Spires, ground group, tree, high clouds, wisps etc.: backing leaked along outer edges ->
  `edge: true` (now the default in cellsOf); spires with 'back' were worse.
- Grass tips (moving) against still turf/blades of the same colour: joint groups j0/j1/j2 as
  Tide Line's (JOINT_T 8), CSS keyframes beside gs (offsets -1/-2 here).
- Size: MERGE (env) merges ground/tree/rock/spire colours within N levels in every channel
  into a commoner one (night's dark tones are 2-4 apart).
Code state: encode-local.mjs has options corners (unused), inside, edge:'back', order 'light'.
build.mjs: ENCMAP/PROBE/COATS/NOJOINTS/MERGE env switches for experiments; defaults below.
Scan T=0, 6 fractional sizes (1536@1/1366/1440/1680/1278@1.25/1200@1.25), MERGE=4 + joints:
day 46/21/26/29/41/24, sunset 16/11/12/11/13/17, night 39/24/27/27/28/39.
Sizes MERGE=4 + joints: day 125,332 (~125,231), sunset 127,482 (~127,472), night 123,612
(~125,111). Sunset is tight.
Next: make MERGE=4 the default in code, scan T=37, look at day 1536x864@1 (46) and night;
then pixeldiff, check, player-check.

## entry 4: rim skirts, edgeNear, leaf tips

Done since entry 3:
- MERGE default 4 (in code). Rim overlays get skirts (SKIRT_T 20, SKIRT_SAME 32, at every lt
  opacity; wrap-aware): fixed night T=37 row-100 lines (116 -> 47).
- encode-local.mjs: `edgeNear` (a colour within N of an outer cell may lie under it; default 8
  in cellsOf) fixed the range ridge (rim vs snow 2 levels apart leaked the sky); `wide` (no row
  cap for chunks >= 120 cells across, harbor's change 4) saves ~0.3k.
- Leaf tips (ts): the pad cell beneath each tip's right-hand cell is hidden at both sway places,
  so it takes the colour of the cell to its right (no size cost). A joint-layer version (env
  CTJOINTS) cost +1.3k and is off.
- Joint groups with no cells are no longer written.
Scans (6 fractional sizes): T=0 day 19/5/12/11/12/12, sunset 16/11/12/11/13/18, night
34/18/28/32/25/31; T=37 day 14/2/8/5/12/9, sunset 19/6/18/13/25/17, night 40/29/46/34/29/32.
Sizes: day 124,830 (~124,584), sunset 127,730 (~127,593), night 123,771 (~125,143).
Next: night T=37 1440x900 (46) and T=0; a third time (wisps/birds mid-motion); then remove
debug-only bits (k1 CSS rule), full 11-size scans, pixeldiff, check, player-check, purity.

## entry 5: settings fixed, debug bits out

Done since entry 4:
- Leaf tips (ts): two coats (CTCOATS default 2, ~150 chars) on top of the hidden-cell trick.
- Rays (sunset): `under` hint to the sky (back 'none', edge false) saves ~290 chars.
- Grass tips (gs): two coats (GSCOATS default 2); colour merges MERGE default 5 (ground, rocks,
  cairn, grass, trunk, crown, tips, spires; max 5 levels in any channel) pays for it.
- Unused leaf-tip joint code (CTJOINTS, .k1 CSS) removed; plane comment corrected (one coat).
- check.mjs: `use` + `href` allowed when href is '#id' (the app's scrub keeps those; see
  sunfield/tools/app-check.mjs); any other href is flagged.
- Purity (cloudsea-purity.mjs, T=0): 0 impure px at 6, 8 and 9 px a cell, all three moments
  (originals: day 1,225, sunset 952 at 6 px). No band cutting needed.
Sizes: day 125,097 (~124,992), sunset 127,317 (~127,332), night 120,394 (~121,804). check ok.
Next: full 11-size seamscan T=0, T=37 and a rare-event time for each moment; purity at T=37;
pixeldiff vs out/pre-seam with DIFF images; player-check x2; render.mjs and look at a PNG;
notes.md section; report.

## entry 6: final settings, full scans pass

- Colour merges only where size needs them: MERGE_BY day 0, sunset 4, night 4 (env MERGE
  overrides). MERGE 5 everywhere was tried; per-moment 4/0 keeps the picture closer.
- Sizes: day 125,399 (~125,348), sunset 127,849 (~127,858), night 124,176 (~125,694). check ok.
- seamscan, all 11 sizes, all pass (max line px): T=0 day 11, sunset 16, night 28; T=37 day 6,
  sunset 22, night 38; T=9 (wisps mid-rise, birds off rest, grass leaning) day 14, sunset 25,
  night 40. 0 holes. 0 at the whole-pixel sizes.
- Purity 0 impure px at 6/8/9 px a cell, T=0 and T=37, all moments.
- pixeldiff vs pre-seam (TOL 6): day 1,370 px (tree trunk/branch 1-px edges: the original was
  blurred there at 6 px; 693 over TOL 15), sunset 59,481 (merges <= 4 levels on spires and
  crown; 551 over TOL 15, the same trunk edges), night 86,328 (merges; 0 over TOL 15).
Next: player-check x2 per moment, render.mjs + look at a PNG, notes.md section, report.

## entry 7: done

- player-check x2: PLAYS for all; window averages day 0.96-1.19 ms, sunset 1.14-1.47 ms,
  night 1.48-1.66 ms.
- Real scrub (DOMPurify as app-check, scratch cloudsea-scrub.mjs): every `use` kept (16-17).
- Mid-motion pixeldiff (scratch cloudsea-pixeldiff-t.mjs, T=9 and T=37, TOL 15): only the trunk
  edges differ (day ~675, sunset ~540, night 0): joints/hidden cells/coats change no motion.
- render.mjs PNGs redrawn; night PNG looked at: no lines.
- notes.md: size/player tables updated, "Encoding and hairlines" section added.
Next: nothing; report to the coordinator.
