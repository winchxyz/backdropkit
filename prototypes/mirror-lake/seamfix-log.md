# Mirror Lake seam fix: progress log

Brief: no hairlines at any window size in day, sunset and night, with the picture and motion
unchanged (encoding only). The originals are in out/pre-seam/ (made by the coordinator; do not
overwrite). Size at most 128,000 chars raw and scrubbed. Edit only this folder. No commits,
nothing published. Scratch files go in the session scratchpad, prefixed `mirror-`.

## entry 0 (start)

- No changes yet. out/*.svg are identical to out/pre-seam/.
- Next step: baseline seamscan of the originals (T=0, SAVE=out/seams), then seamwho at the worst sizes.

## entry 1 (encoder and big causes)

Baseline (originals, seamscan T=0, max line px over the 11 sizes): day 2308, sunset 1506,
night 1421; 46-60 even at 6 px a cell. Main causes: the waterline (U and its mirror abut at
113.5 over the underlay) and colour/chunk edges inside the big pattern layers.

Done:
- encode-local.mjs: copy of tide-line's encoder plus Mirror Lake changes: `fill` (backing as one
  filled outline), `groups` (group backing; a try, rarely wins), `cutSegs` + `emitCoated`
  (runs with no joins, cut every 64 runs and at 21 rows for boxes 21-120 cells wide).
- lib.mjs Scene.draw: small layers -> emitSafe (exact). Pattern layers -> the shorter of exact
  and coats: optional backing + <g id='Qn'>runs</g> + 2 x <use> (3 coats in all; leak <= 1/64).
  Scene.tile -> emitSafe. cull(): RIM env keeps a 1-cell rim (off by default: coats cover it).
- build.mjs: `wl` row (row 113 copied to row 114 inside U, under the mirror) removes the
  waterline seam; the underlay now spans rows 111-116 (stroke-width 6 at 113.5) so nothing
  is ever bare under the woods; SIZES=1 lists per-layer sizes; DUMP=name DUMP_TO=dir dumps cells.
- Sizes raw / scrubbed: day 117,636 / 119,872; sunset 119,829 / 122,207; night 120,406 / 122,635.
- Scan (before the box cap) T=0 max: day 203, sunset 209, night 126; 6 px a cell now 0.

Next step: full seamscan of all three; find what is left (scratchpad mirror-lines.mjs maps line
pixels; seamwho); then ripple tiles (x joins, top/bottom rows), moving parts, overlays.

## entry 2

Done:
- Box cap for coated runs (cutSegs: 64 runs, 21 rows for boxes 21-120 cells wide): 6 px a cell
  went from 43-76 line px (rounded corners, dots) to 0.
- Coats for every pattern layer (COAT_IF_SHORTER=1 restores "only when shorter").
- Ripple tiles: one clear row above and below each band's tile and rect (lines at 131.5, 159.5).
- Coat backing stays off outer-edge cells more than T from it.
- Learned: coats inside a pattern do NOT fix edges between two different pattern layers (the
  tile bitmaps are resampled at fractional sizes, so alpha adds up roughly linearly). The cull
  rim is back (4-neighbour, rim cells recoloured from the visible neighbour: cheaper).
- Sizes raw / scrubbed: day 119,508 / 121,849; sunset 121,384 / 123,855; night 122,589 / 124,967.
- Scan T=0 max line px: day 134 (1278x719@1.25, reeds), sunset 71, night 75.

Next step: remaining clusters: reeds and tips (x 47-56, 76-83, 103-107, rows 164-185: moving tips
over still reeds -> draw the tips rect twice?), day spruce column x=301 rows 26-63 at 1680x1050,
night boat/lamp area x~170-205 rows 175-182.

## entry 3

Done:
- Trees+bank keep a backing (build.mjs `back.needBack`): the spruces' 2-cell columns are
  side-by-side vertical runs and the bright sky showed through their joint (day x=301).
- Scene.double (lib.mjs): a part drawn twice (a rect twice, or <g id=Qn> + <use>). Flags:
  `L.twice` on a layer, `twice: true` on a wrap. Set on reed tips A/B/C, reeds, flora, fheads,
  bank tufts, rsway, rheads, bank (trees+bank), glitter sets, boat (rk), boat reflection (rd),
  lamp reflection. Sway moves in whole cells, so these parts abut exactly at every frame.
- Sizes raw / scrubbed: day 120,741 / 123,106; sunset 122,484 / 124,979; night 123,877 / 126,296.
- Scan T=0 max line px: day 39 (1200x780@1.25), sunset 36 (1200x780@1.25), night 26 (1440x900@1).
  Holes 0 everywhere; 6/8/9 px a cell 0-1.

Next step: look at what is left at 1200x780@1.25 (day, sunset), then T=37 and rare-event
scans (fish rings ~T=12-15, mist), then pixeldiff, check.mjs, player-check, PNG, notes.md.

## entry 4

Done:
- Fixed a bug in Scene.draw: `'...'.repeat()` bound to the last string only, so every pattern got
  2 coats and a stray `'/>` text node. Now 3 coats as meant (+~300 chars).
- Tried: backing inside the coats' group (far worse: each coat resets the build-up), backing
  coated on its own (no gain, +500 chars, 7 px at 6 px a cell at night). Kept: backing drawn once.
- Purity test (coordinator's check for tile blur; scratchpad mirror-purity.mjs, bottom-pinned):
  no blur. Impure cells are the sky's band edges, which sit mid-row in the originals too (the
  band strokes reach half a row up under the band above); fewer impure cells than pre-seam.
- Mist (translucent, moving): its row edges meet the water's row edges; the overlay's partial
  coverage lands on the pre-blended pixel (conflation), up to ~26 px at 1200x780@1.25 T=0.
  crispEdges on its pattern changes nothing. Left as is.
- Scans (max line px over 11 sizes): T=0 day 36, sunset 32, night 25; T=20 (mist peak) 13 / 30 /
  23; T=13.4 (fish ring 2) 26 / 31 / 29; T=37 26 / 28 / 46 (night 1200x780@1.25).
- Sizes raw / scrubbed: day 121,046 / 123,516; sunset 122,819 / 125,429; night 124,257 / 126,806.

Next step: look at night T=37 1200x780@1.25 (46); then pixeldiff, check.mjs, player-check,
PNG, notes.md, encoder header, clean-up of debug knobs.

## entry 5

Done:
- pixeldiff found the ripple tiles brighter (up to 12 levels): the seam-proof encoding overlaps
  cells and adds a filled backing, which ignored / doubled the pattern's stroke-opacity. The
  opacity now sits on each ripple rect as fill-opacity (tile drawn opaque, faded as one): same
  picture, and pixeldiff now shows only cell edges where the originals had soft corners and
  seams at 6 px a cell (right spruces, right mountain); purity there improved (spruces 386
  impure cells -> 0, right mountain 100 -> 26).
- Sizes raw / scrubbed: day 121,040 / 123,510; sunset 122,813 / 125,423; night 124,251 / 126,800.

Next step: rescan T=0/T=37 (ripples changed), check.mjs, player-check x3, PNG, notes.md,
encoder header, clean-up.

## entry 6 (done)

Done:
- Clean-up: lib.mjs debug env knobs removed (SAFE_T, NOFILL, COATS, COAT_IF_SHORTER, NORIM, RIM8,
  RIMKEEP; DUMP/DUMP_TO and STATS kept as debug aids), unused `commonest` removed, comments
  brought up to date; build.mjs woods/underlay comments; encode-local.mjs header lists Mirror
  Lake's changes. Output unchanged by the clean-up (same sizes).
- notes.md: sizes, player check, "Encoding and hairlines" section, open issues.
- Final scans (worst line px over 11 sizes, holes 0 everywhere):
  T=0 day 35, sunset 32, night 25; T=37 34 / 28 / 35; T=13.4 24 / 31 / 23; T=20 11 / 29 / 21.
- check.mjs ok (64 runs/path max, no double quotes, clock ok). player-check PLAYS: day 1.67/1.11,
  sunset 1.45/1.11, night 1.60/1.08 ms (window 1 / window 2 averages).
- Purity at 6/8/9 px a cell: no blur; only the sky's mid-row band edges (also in the originals).
- PNGs rendered (node render.mjs) and looked at.

Nothing left to do for the brief. Remaining faint lines: mist and ripple edges (translucent,
moving) and a few in the dark night woods; see notes.md.
