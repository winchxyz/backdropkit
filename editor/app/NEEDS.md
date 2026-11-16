# editor/app: needs

What the editor would like from the exporter (`editor/lib/`), the looks (`editor/fx/`) and the contract (`editor/PROJECT.md`). Each one says what the editor does today without it. None of them blocks the editor.

## The contract (editor/PROJECT.md)

1. **Two editor-only fields on image layers.** The editor writes `own: [slot, ...]` (the slots the art's colours were given, so a new look or a move reuses them instead of adding slots) and `lit: true` (the art is taken as drawn by day and relit for each moment's light; without it the art keeps its own colours at every moment). The exporter ignores both, as it should. Please add them to "Image layers" so the next reader knows.

## The exporter (editor/lib)

2. **A code on every problem.** Problems come as `{ level, text, layer? }`. The editor keeps "The theme has no line about it" out of the status (the export form asks for the line) by matching its text, which breaks when the wording changes. A stable `code` (`'no-line'`, `'site-slug'`, `'over-limit'`, ...) and a `moment` id where one applies would let the editor sort and point at them properly.
3. **Faster checks after small edits.** The editor re-runs `exportAll` after each pause in editing (700 ms), in a worker, newest replacing oldest. On the 12-layer test project that is 1.2 to 1.5 s for 3 moments. A way to reuse unchanged layers' encodings between calls (a cache keyed by the layer's cells and colours, or `exportAll(project, { previous })`) would make the status feel instant.
4. **A measure for fitLook.** `fx.fitLook` takes `measure(frames, colors) -> chars` to use the exporter's count instead of the estimate. A helper like `measureLayer(project, layerId, frames, colors, momentId)` (the scene's size with that layer's cells replaced) would let Make it fit aim at the real scene instead of fx's estimate of the other layers.
5. **The install prompt unwrapped.** `promptFor` hard-wraps long steps with indented continuation lines. The editor joins them for display (Copy gives the original). One line per step would read well at any width, in the editor and in the README.
6. **The merge level in the checks.** `exportAll` scenes carry `merged`; the editor does not show it yet. A short word for what it means to the visitor ("2 colours merged to fit") from the exporter would keep the wording in one place.

## The looks (editor/fx)

7. **The field words in fx.** `fxa.js` carries its own schema of every look field: label, range, unit, help, and when a field shows. fx owns the fields, so a `LOOK_FIELDS` export (the same shape) would keep the inspector right when a field is added or a range changes. Until then, a new fx field does nothing in the inspector until `fxa.js` lists it.
8. **Asset names without the extension.** `decodeAsset` keeps `file.name` as is ("dusk photo.png"); the editor strips the extension for the layer name. Either is fine; a word in the API notes on which one is meant would settle it.
9. **fitLook on the clock.** A heavy picture takes `fitLook` about a second on the page's thread (each step is one `applyLookFrames`). It runs on demand only, so this is fine; a worker-friendly variant (taking RGBA arrays, no canvas) would let the button stay responsive on slow machines. It already is pure, so this may only need a note that it runs in a worker.
