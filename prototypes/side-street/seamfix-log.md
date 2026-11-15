# Side Street seam fix: progress log

Brief (coordinator, owner approved "Yes, fix all 13"): no 1-px lines between cells at any window
size in day, evening and night; picture, light and motion unchanged (encoding only). Originals are
in out/pre-seam/ (made by the coordinator, do not overwrite). Size <= 128,000 chars. Edit only this
folder; scratchpad files prefixed street-; no commits, nothing published.

## 2026-11-15, entry 0 (start)

- out/pre-seam/side-street-{day,evening,night}.svg are identical to out/ (113,992 / 114,015 /
  102,957 chars).
- Nothing changed yet.

Next step: baseline seamscan with SAVE=out/seams at T=0 and T=37 on the three SVGs.

## entry 1 (baseline measured, pre-seam = current)

seamscan, max line px over the 11 sizes, holes 0 everywhere (the earlier rework's own seam
fixes: sRGB merge filter, plain dilated slices, mends):
- T=0   day 34 (1440x900@1), evening 38 (1680x1050@1), night 38 (1278x719@1.25)
- T=37  day 41, evening 20, night 48
- train / cyclist: T=26 day 46 / evening 35 / night 50; T=30 46/36/43; T=33 46/40/46;
  T=41 45/42/50; T=64 (cyclist) 34/37/37.
- Lines at exactly 6 px a cell: evening 13, night 27 (should be 0): crops show light dots at
  cell corners (roofs).
Purity (scratchpad street-purity.mjs: px differing from their cell's centre at whole px a cell):
- 9 px a cell (1440x900@2): day 338,430 px in 26,795 cells, evening 20,557 cells, night 15,280:
  the pattern tiles sit half a cell off (rect y = b.y0 - 2): every row edge blurred.
- 6 px: day 0, evening 91 cells, night 55. 8 px: day 0, evening 143, night 314.

Next step: copy harbor/encode-local.mjs to encode-local.mjs (corners, row cap, narrow/wide,
edge), route draw()/cellsOf through emitSafe, pattern rect y = b.y0 - 1.5 with a clear row and
column on every side.

## entry 2 (local encoder in, scans pass at T=0)

Done:
- encode-local.mjs: harbor's copy + two Side Street options (header items 6, 7):
  - `filled`: for the still scene (base, base-far) inside the merge filter Q: no joins, no
    corner cover, never backed. Joins there cost ~15k a moment (day was 135.7k).
  - `rim`: no colour laid under a layer's outer-edge cell (tide-line's edge, second half).
    Without it the slices fringed (vending machine red over the crossing lamps): 100-214 line px.
- build.mjs: cellsOf = emitSafe(L, { T 28, maxRows 19, narrow 21, wide 120, rim, ...L.safe });
  base/base-far L.safe = { filled, join: false }; mend()/splitColours removed; pattern rect
  y = b.y0 - 1.5, width + 3, height + 3 (clear row/column all round).
  TEMP in build.mjs (remove at the end): OLD_ENC bisect switch + emitCells import, SAFE_BASE,
  SAFE_SLICE, PAT_DY env; SIZES=1 per-layer listing (keep, document).
- Sizes raw / scrubbed: day 122,671 / 126,362; evening 121,719 / 124,832; night 104,400 / 107,014.
- seamscan T=0: max line px day 25, evening 27, night 17; 0 at 6, 8, 9 px a cell; holes 0.

Next step: seamscan T=37 and train/cyclist times (26, 30, 33, 41, 64); purity at 6/8/9 px.

## entry 3 (9 px blur, size)

Done:
- Purity at 9 px a cell still showed 13.4k soft cells by day after the tile offset fix: the
  base tile was the whole scene (323 x 203 cells, 2907 x 1827 device px), drawn as a scaled
  bitmap. build.mjs drawBanded(): the filtered still layers are cut into bands of
  BAND_ROWS = 100 rows (+1 carried row), each its own tile. Purity now 0 at 6, 8, 9 px a cell
  in all three moments, at T=0 and T=30 (train on screen).
- encode-local.mjs option 8 `slab`: chunks cut in column slabs first. build.mjs SPRITE_SAFE
  gives the train { slab: 160 }: its encoding 11,855 -> 6,930 chars by day.
- Sizes raw / scrubbed: day 119,537 / 123,462; evening 119,008 / 122,349; night 105,352 / 108,206.
- seamscan max line px (holes 0 everywhere):
  T=0 day 14, evening 23, night 16; T=37 34 / 17 / 46; T=26 26/23/22; T=30 26/23/17;
  T=33 34/25/11; T=41 26/24/22; T=64 14/25/17.
  TEMP still in build.mjs: OLD_ENC, DUMP, SAFE_BASE, SAFE_SLICE, PAT_DY, BAND_CARRY env.

Next step: seamwho night T=37 1536x864@1 (46); then two coats on moving parts if they show;
then pixeldiff vs pre-seam, check.mjs, rules, player-check, render, notes.md, clean TEMP code.

## entry 4 (two coats)

Done:
- seamwho has no T; scratchpad street-seamwho.mjs (copy with T). Night T=37: the train (30) and
  the near tier over it (34): lit windows and the pole in front of the train.
- build.mjs coats(): every animated layer laid twice (pattern rect repeated, or <g id> + <use>).
- Sizes raw / scrubbed: day 120,686 / 124,760; evening 120,124 / 123,617; night 106,787 / 109,847.
- seamscan max line px (holes 0): T=0 day 14, evening 14, night 7; T=37 32 / 10 / 34;
  T=26 26/14/16; T=30 26/14/11; T=33 34/14/15; T=41 26/14/20; T=64 14/14/12; T=80 14/10/7.

Next step: pixeldiff vs out/pre-seam (DIFF png, look); rules (check.mjs, runs, quotes, clock,
hrefs), player-check, render.mjs, notes.md section, remove TEMP env code, final rebuild + scan.

## entry 5 (finished)

- pixeldiff vs pre-seam (6 px a cell): day 0 px; evening 395, night 190, all on cell edges and
  corners (the old soft corners): out/seams/diff-*.png, looked at.
- check.mjs ok (max 64 runs a path); scratchpad harbor-rules.mjs: single quotes, clock, hrefs
  ok (tr/cy "not stepped" is its parser; pre-seam reads the same); new tag <use>.
- player-check PLAYS, all nine copies (as built, --m:-30s, --m:-62s), 1.02-1.52 ms.
- TEMP env code removed (OLD_ENC, DUMP, SAFE*, PAT_DY, BAND_*, COATS env); rebuilt: same sizes.
- Final seamscan, line px per size (11 sizes in seamscan order), holes 0:
  T=0  day 0 5 0 3 14 0 10 0 0 2 8; evening 0 11 0 8 2 0 3 0 0 5 14; night 0 4 0 1 2 0 5 0 0 3 7
  T=37 day 0 5 0 5 26 0 23 0 0 17 32; evening 0 9 0 8 5 0 7 0 0 9 10; night 0 34 0 10 6 0 5 0 0 7 20
- render.mjs PNGs rewritten and looked at (day). notes.md: "Encoding and hairlines" section,
  sizes and player tables, Files rows; old Seams section marked as earlier rounds.
Nothing left for the brief.
