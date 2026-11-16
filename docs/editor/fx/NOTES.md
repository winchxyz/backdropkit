# editor/fx: notes

The looks module: art in, cells out. API and fields are at the top of `index.js` and in the "fx API" section at the end of `editor/PROJECT.md`. This file is the log: what is where, why, what it costs, and what did not work.

## Modules

| File | What it does | From |
| --- | --- | --- |
| `index.js` | The look stack, `applyLook`, `applyLookFrames`, `fitLook`, presets, outline, mirror, previews (`renderCells`) | new; glyph picking after Afterglyph |
| `cut.js` | `removeBackground`: auto, colour key, dark, light; grow/shrink; specks | Afterglyph (`analyzeSource`, `findSubject`, soft key, `morph`, `dropSpecks`) |
| `place.js` | `placeAsset` (nearest when enlarging, premultiplied area average when shrinking), `fitPlace` | new |
| `picture.js` | Exposure, contrast, saturation, hue, warmth, auto levels, edge-keeping smooth | Nightgrain's tone stage (`engine.js`); bilateral and Kuwahara new |
| `quantize.js` | Histogram, k-means in OKLab (median-cut start), near-colour merge, snapping to a fixed list, nearest/pair mappers | median cut after Nightgrain's `buildPalette`; the rest new |
| `dither.js` | Nightgrain's 18 algorithm ids, threshold maps and diffusion kernels; pair mixing, `amount`, `where: 'smooth'` | Nightgrain `js/dither.js` |
| `palettes.js` | Nightgrain's 24 palettes plus `sunset`, `pastel`, `nightgrain` | Nightgrain `js/palettes.js` |
| `shapes.js` | Dot, ring, diamond, plus, square in whole cells, sized by brightness | idea from Nightgrain's shape stage |
| `glyphs.js` | Hand-made 5 x 7 and 7 x 9 bitmaps, sets, Afterglyph's signal ramp and stroke picking | Afterglyph (`compose` ~1600-1700, `GLYPH_CH` ~2563); bitmaps new |
| `cost.js` | `estimateCost`, fitted to the exporter's encoder | new, modelled on `editor/lib/encode.js` |
| `gif.js` | GIF reader (frames, disposal, transparency, interlace) | Nightgrain `js/gif.js` (`decodeGif`, `unlzw`, `interlaceRows`) |
| `color.js` | sRGB/linear/OKLab, hex, hashes | OKLab from its published formulas; `hash` from Nightgrain |
| `browser.js` | `decodeAsset`, `rgbaFromFrame`, `previewLook` (DOM) | new; GIF through `gif.js`, WebP/APNG through `ImageDecoder` |

## Decisions

- **Cells are runs.** The encoder writes horizontal runs per colour, so cost is roughly the number of (colour, row) stretches. Everything that keeps runs long is cheap: flat areas, few colours, patterns that repeat along a row. Isolated cells and checkerboards are the expensive part. Every stage was tuned with that in mind.
- **Smoothing before colours.** Art (photos, paintings, JPEG thumbnails) carries texture that becomes a speckle of colours. A Kuwahara filter flattened it but turned small details to mush; one or two bilateral passes keep edges and fine lines and still flatten the texture. Kuwahara stays for level 3 (Poster, Ink outline), where mush is the point.
- **Colours in OKLab, weighted against the sky.** Plain k-means gave most colours to big smooth areas (sky, water). Bin weights are damped (`count^0.6`) so small, distinct areas (a red roof, a lighthouse) keep their own colour. Near colours are merged after (OKLab, lightness weighted 1.4), which often frees a slot or two.
- **Dither mixes two colours, in a band.** Nightgrain's ordered dither mixes many palette entries; here each cell mixes its nearest colour with the best partner along the segment between them, and `amount` narrows the band around the midpoint where mixing happens. `where: 'smooth'` (the default) only dithers where the picture changes gently (3 x 3 luma spread under 0.025 fully, fading out by 0.07): gradients get the pattern, busy areas stay flat, where a pattern only adds noise and cost.
- **Stray cells go** (`colors.clean`): isolated cells, near-isolated ones, and single cells breaking a horizontal run. Not where dither is at work.
- **Shapes and glyphs run on blocks**, with the ground colour first and the shape or glyph in the block's colour on top. A ground of `'dark'`/`'light'` takes that end of the palette and keeps it out of the inks.
- **Glyph strokes only on the picture's strongest edges.** Afterglyph's absolute edge energy put strokes on every gradient and texture at this scale; energy is now relative to the picture (between its 78th and 97th percentile of block energy), so strokes follow real outlines.
- **Halftone on near black.** Dots on paper (light ground) lost bright pictures entirely (sky and clouds become blank paper) and the dark version read better on every test picture; for backdrops behind a dark app it also suits better. Paper is one setting away (`ground: 'light'` or a hex).
- **Background removal works on the placed picture**, inside the box of opaque pixels, so a placed sprite's transparent surroundings do not count as "the art has its own alpha". `connected` (new) only removes background that touches the outside, so a white eye inside a sprite on white stays. When 'auto' would key away nearly everything (a sprite of one plain colour), it leaves the art as it is.
- **`fitLook` instead of cheaper presets.** Presets are tuned for a median full-screen picture around 50-80k; the busiest pictures go over 90k. `fitLook` takes those down step by step (lighter dither, smoother, fewer stray cells, fewer colours, no dither, bigger shapes or glyphs) and says what it changed. It aims 6% under the budget for the estimate's error.

## Cost estimate

`estimateCost` counts what the encoder (`emitSafe` in `editor/lib/encode.js`) writes: the sets each colour draws (own cells, under-dilation into lighter neighbours, the corner rule on full 2 x 2 blocks), both unbacked and backed by the commonest colour (cheaper wins), the chunking into paths of at most 64 runs (19 rows when 21-120 wide) with the row of overlap every later path takes, and thin upright strokes written as one column run. Then

`chars = runs * (5.65 + 0.27 * log2(cells per run)) + 24 * paths + 20 * colours`

(`COST_FIT`; perRun and perLog fitted by `test/calibrate.mjs`, the per-path and per-colour markup set by hand).

Against `emitSafe` on 288 layers (12 presets and 4 extra looks on 18 pictures): the run count is within a few % for everything (rings -9%); the character estimate is within **4.0% at the median, 10% at p90**, worst 37% (one halftone; dots and rings are the least exact, then glyphs and Game Boy at up to +20-22%: the encoder writes many glyph parts as columns, and only one-cell-wide strokes are modelled). See `node test/calibrate.mjs`. Time: 9 ms median, 16 ms at p90 for a 320 x 200 layer (the first call, while the engine compiles, can take ~50-80 ms).

Against a whole exported scene (`exportScene`, one picture layer, `test/export.mjs`) the error is larger, because the exporter writes still pictures differently (pattern tiles in bands, three backings tried, a second colour order): over the 192 scenes below the estimate is within 6.7% at the median, 17.5% at p90 and 33% at worst, and 4% high on average (it overestimates the busy pixel-art stills, which the exporter tiles well, and underestimates the drawn painting by up to 13%). So the estimate is a guide for the live readout; the exporter's count is the truth.

## Presets and what they cost

A full-screen picture through each preset, exported as a one-layer scene (`node test/export.mjs`; what the app counts), over 16 pictures (the 14 theme stills, which are busy pixel art, plus a drawn landscape and a drawn painting):

| Preset | Median | Max (picture) | Over 90k | Harbor |
| --- | --- | --- | --- | --- |
| Clean pixels | 55.1k | 99.7k (painting) | 1 | 55.1k |
| Soft dither | 64.8k | 111.9k (painting) | 3 | 61.8k |
| Night grain | 73.0k | 103.1k (lavender-slope) | 3 | 75.1k |
| Poster | 27.5k | 68.7k (painting) | 0 | 27.5k |
| Glyph glow | 73.3k | 94.9k (lavender-slope) | 1 | 80.6k |
| Halftone dots | 63.4k | 75.8k (rainy-studio) | 0 | 64.9k |
| Ink outline | 37.0k | 83.1k (painting) | 0 | 37.0k |
| Retro 16 | 64.9k | 87.0k (painting) | 0 | 74.6k |
| Game Boy | 61.4k | 84.4k (side-street) | 0 | 63.1k |
| Pastel | 49.5k | 89.4k (painting) | 0 | 48.3k |
| Blueprint | 40.3k | 58.3k (painting) | 0 | 40.3k |
| Sunset wash | 74.7k | 107.1k (lavender-slope) | 3 | 77.4k |

None of the 192 scenes is over the app's 131,072; 11 are over 90k (92.9k to 111.9k), all dithered or detailed looks on the busiest pictures.

On the drawn sprite (a cat, 180 x 180 cells on transparency) every preset costs 8-19k.

`fitLook` at 90k on those 11, measured by the estimate (0.1-0.4 s each): one to three steps, usually "Lighter dither" and "Smoother picture" (Night grain on lavender-slope 103.1k to 71.4k, Sunset wash there 107.1k to 73.9k); 7 of the 11 scenes end under 90k, the other 4 at 90.0-94.9k, where the estimate reads the exporter low. With the exporter itself as `measure` (`margin: 0`) all 4 land at 87.4-90.0k, in 2-5.5 s each.

Four exported scenes checked in the player (sunfield's `tools/app-check.mjs`, `STILL=1`) all passed the app's checks: painting/Soft dither 111.9k, harbor/Night grain 75.1k, harbor/Glyph glow 79.4k, landscape/Halftone 69.1k (all `ok: true`, nothing scrubbed).

## What looked bad, and what fixed it

- Kuwahara at levels 1-2: mush, lost windows and masts. Now bilateral.
- K-means spent 10 of 16 colours on the sky. Damped weights.
- Glyph glow: unreadable at 7 x 9, strokes everywhere. Now 5 x 7, strokes only on the strongest edges, no solid block glyph (rows of white bars read as a glitch). Still the weakest preset: on pictures that are mostly mid-tone (a sky over a sea) it reads as texture more than as the picture. It works best on bold, high-contrast art and on sprites.
- Halftone on paper (Riso inks) was pale and lost bright pictures; now dots on near black, in the art's own colours.
- Dithered presets were 110-160k on busy stills. Smoothing level 2, `where: 'smooth'`, amounts 0.3-0.35, `clean: 2`; now 61-75k median as exported scenes.
- Blueprint's horizontal lines: one threshold per row (`linesh`) makes whole-row runs, the cheapest pattern there is.
- Retro 16 on soft gradients: the fixed palette has no in-between, so a sunset sky turns into pink and orange bands. It is that palette's character; left as is.

## Tests

From the backdropkit folder (they use playwright-core and the ms-playwright Chromium, as `engine/seamscan.mjs` does; `FX_OUT` is where pictures go, `FX_CACHE` keeps decoded test pictures between runs):

- `node editor/fx/test/unit.mjs`: placing, cut, alpha rule, colours, mirrors, glyph bitmaps, shapes, determinism, estimate speed and accuracy, `fitLook`, GIF reader (22 checks, no browser).
- `node editor/fx/test/browser.mjs`: `decodeAsset` on a big PNG, JPEG, WebP, a 100-frame GIF (48 frames kept, total time kept), a short GIF, an APNG through `ImageDecoder`; `rgbaFromFrame` round trip; `previewLook`.
- `node editor/fx/test/presets.mjs`: every preset on harbor, landscape, painting and sprite, previews and one sheet per picture; `THUMBS=1` adds every theme still to the cost table.
- `node editor/fx/test/calibrate.mjs`: estimate against the encoder, and the refitted numbers.
- `node editor/fx/test/export.mjs`: one-layer scenes through `editor/lib/export.js`, sizes, SVGs for the player check.

## Not done, and limits

- Animated WebP and APNG need `ImageDecoder` (Chromium, Edge, Firefox 133+); elsewhere only the first frame is kept. GIF works everywhere (own decoder).
- Glyph and shape looks cost what their pattern costs; `fitLook` can only make shapes or glyphs bigger and colours fewer.
- `estimateCost` models `emitSafe`, not the exporter's tiled still pictures; see above.
- No colour cycling or glint here: those are live effects, written by the exporter.
