// node editor/fx/test/unit.mjs : unit tests of the looks core, in Node, with no browser.
// Placing, background removal, the alpha rule, colours, mirrors, glyph bitmaps, determinism,
// the cost estimate (speed, and accuracy against the exporter's encoder), fitLook and the GIF
// reader. Exits non-zero when a check fails.
import assert from 'node:assert/strict'
import { applyLook, applyLookFrames, normalizeLook, withPreset, fitLook, mirrorCells, placeAsset, fitPlace, removeBackground, estimateCost, renderCells, LOOK_PRESETS, DEFAULT_LOOK, MIRRORS, GLYPH_SETS, PALETTES } from '../index.js'
import { GLYPH_SIZES, GLYPH_IDS, drawGlyph, glyphInk } from '../glyphs.js'
import { SHAPE_IDS, shapeCells } from '../shapes.js'
import { analyseCut } from '../cut.js'
import { decodeGif, gifFrameCount } from '../gif.js'
import { GifWriter } from './gifwriter.mjs'
import { encoderCost } from './helpers.mjs'

let failed = 0
let passed = 0
async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log('ok   ', name)
  } catch (e) {
    failed++
    console.log('FAIL ', name, '\n      ', e.message.split('\n').join('\n       '))
  }
}

/* ---------- Pictures made in code ---------- */

const img = (w, h, f) => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4)
  return { w, h, data }
}
const px = (r, x, y) => Array.from(r.data.subarray((y * r.w + x) * 4, (y * r.w + x) * 4 + 4))
const alphaCount = (r, min = 128) => {
  let n = 0
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i] >= min) n++
  return n
}
// A seeded value noise picture: smooth colour fields with fine texture, like a photo.
const rnd = s => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
const photo = (w = 320, h = 200, seed = 7) => {
  const r = rnd(seed)
  const g = Array.from({ length: 9 * 7 }, () => [r() * 255, r() * 255, r() * 255])
  const at = (gx, gy) => g[Math.min(6, gy) * 9 + Math.min(8, gx)]
  return img(w, h, (x, y) => {
    const fx = (x / w) * 8
    const fy = (y / h) * 6
    const ix = Math.floor(fx)
    const iy = Math.floor(fy)
    const tx = fx - ix
    const ty = fy - iy
    const c = [0, 1, 2].map(k => (at(ix, iy)[k] * (1 - tx) + at(ix + 1, iy)[k] * tx) * (1 - ty) + (at(ix, iy + 1)[k] * (1 - tx) + at(ix + 1, iy + 1)[k] * tx) * ty)
    const n = (r() - 0.5) * 24
    return [c[0] + n, c[1] + n, c[2] + n, 255]
  })
}
// A sticker: an orange disc with a white eye on white, and one dark speck in a corner.
const sticker = () =>
  img(160, 120, (x, y) => {
    const d = Math.hypot(x - 80, y - 60)
    if (Math.hypot(x - 90, y - 55) < 6) return [255, 255, 255, 255]
    if (d < 40) return [235, 120, 40, 255]
    if (x >= 5 && x < 7 && y >= 5 && y < 7) return [20, 20, 20, 255]
    return [255, 255, 255, 255]
  })
// A sprite: a green square on full transparency.
const sprite = () => img(64, 64, (x, y) => (x >= 16 && x < 48 && y >= 16 && y < 48 ? [40, 180, 80, 255] : [0, 0, 0, 0]))

const P = photo()

/* ---------- Placing ---------- */

await test('placeAsset: enlarging takes the nearest pixel, at the place', () => {
  const src = img(2, 2, (x, y) => [x * 255, y * 255, 0, 255])
  const out = placeAsset(src, { x: 10, y: 5, scale: 2 })
  assert.equal(out.w, 320)
  assert.equal(out.h, 200)
  assert.deepEqual(px(out, 10, 5), [0, 0, 0, 255])
  assert.deepEqual(px(out, 11, 6), [0, 0, 0, 255])
  assert.deepEqual(px(out, 12, 5), [255, 0, 0, 255])
  assert.deepEqual(px(out, 13, 8), [255, 255, 0, 255])
  assert.equal(px(out, 9, 5)[3], 0)
  assert.equal(px(out, 14, 5)[3], 0)
  assert.equal(alphaCount(out), 16)
})

await test('placeAsset: shrinking averages the area a cell covers', () => {
  const src = img(4, 4, (x, y) => ((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]))
  const out = placeAsset(src, { x: 0, y: 0, scale: 0.5 })
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const p = px(out, x, y)
    assert.ok(Math.abs(p[0] - 128) <= 2, 'grey expected, got ' + p)
    assert.equal(p[3], 255)
  }
  assert.equal(alphaCount(out), 4)
})

await test('placeAsset: transparent pixels do not darken a shrunk edge', () => {
  const src = img(4, 4, x => (x < 2 ? [250, 250, 250, 255] : [0, 0, 0, 0]))
  const p = px(placeAsset(src, { x: 0, y: 0, scale: 0.25 }), 0, 0)
  assert.ok(p[0] > 240, 'colour kept, got ' + p)
  assert.ok(p[3] > 100 && p[3] < 156, 'half alpha, got ' + p)
})

await test('placeAsset: flipX mirrors, and parts outside the frame are cut off', () => {
  const src = img(2, 1, x => (x ? [255, 0, 0, 255] : [0, 0, 255, 255]))
  const out = placeAsset(src, { x: 0, y: 0, scale: 1, flipX: true })
  assert.deepEqual(px(out, 0, 0), [255, 0, 0, 255])
  assert.deepEqual(px(out, 1, 0), [0, 0, 255, 255])
  const off = placeAsset(src, { x: -1, y: 199, scale: 1 })
  assert.deepEqual(px(off, 0, 199), [255, 0, 0, 255])
  assert.equal(alphaCount(off), 1)
})

await test('fitPlace contains or covers the frame', () => {
  const c = fitPlace(640, 400, 320, 200)
  assert.equal(c.scale, 0.5)
  assert.deepEqual([c.x, c.y], [0, 0])
  const v = fitPlace(100, 100, 320, 200, true)
  assert.ok(Math.abs(v.scale - 3.2) < 1e-9)
})

/* ---------- Background removal ---------- */

await test("removeBackground 'auto' keys a plain border and keeps the white eye inside", () => {
  const s = sticker()
  assert.equal(analyseCut(s).mode, 'key')
  const out = removeBackground(s, { mode: 'auto', specks: 20 })
  assert.equal(px(out, 0, 0)[3], 0, 'corner cleared')
  assert.equal(px(out, 80, 60)[3], 255, 'disc kept')
  assert.equal(px(out, 90, 55)[3], 255, 'enclosed white eye kept (connected)')
  assert.equal(px(out, 5, 5)[3], 0, 'speck dropped')
})

await test("removeBackground 'auto' keeps a sprite's own transparency", () => {
  // A figure with transparency inside its box: auto keeps the art's own alpha.
  const fig = img(64, 64, (x, y) => (Math.hypot(x - 32, y - 32) < 24 ? [40, 180, 80, 255] : [0, 0, 0, 0]))
  assert.equal(analyseCut(fig).mode, 'alpha')
  const n = alphaCount(fig)
  assert.equal(alphaCount(removeBackground(fig, { mode: 'auto' })), n)
  // A plain square: its box border is the subject's own colour; auto must not key it away.
  assert.equal(alphaCount(removeBackground(sprite(), { mode: 'auto' })), 32 * 32)
})

await test("removeBackground 'color', 'light', 'dark', 'none', grow and shrink", () => {
  const s = sticker()
  const byColour = removeBackground(s, { mode: 'color', color: '#ffffff' })
  assert.equal(px(byColour, 0, 0)[3], 0)
  assert.equal(px(byColour, 80, 60)[3], 255)
  assert.equal(px(removeBackground(s, { mode: 'light' }), 0, 0)[3], 0)
  const dark = img(40, 40, (x, y) => (Math.hypot(x - 20, y - 20) < 10 ? [250, 220, 90, 255] : [8, 8, 12, 255]))
  const dOut = removeBackground(dark, { mode: 'dark' })
  assert.equal(px(dOut, 0, 0)[3], 0)
  assert.equal(px(dOut, 20, 20)[3], 255)
  assert.equal(alphaCount(removeBackground(s, { mode: 'none' })), 160 * 120)
  const base = alphaCount(byColour)
  assert.ok(alphaCount(removeBackground(s, { mode: 'color', color: '#ffffff', grow: 2 })) > base, 'grow adds')
  assert.ok(alphaCount(removeBackground(s, { mode: 'color', color: '#ffffff', grow: -2 })) < base, 'shrink takes away')
})

/* ---------- Looks ---------- */

await test('a cell under 50% alpha is empty, at 50% and over it is coloured', () => {
  const a = img(320, 200, x => [200, 60, 60, x < 160 ? 127 : 128])
  const r = applyLook(a, { picture: { smooth: 0 } })
  assert.equal(r.cells[0], 0)
  assert.equal(r.cells[159], 0)
  assert.ok(r.cells[160] > 0)
  assert.equal(r.colors.length, 1)
})

await test('colours: at most the count asked, darkest first, cells index into them', () => {
  for (const count of [2, 5, 16, 40]) {
    const r = applyLook(P, { colors: { count, merge: 0 } })
    assert.ok(r.colors.length <= count && r.colors.length >= Math.min(count, 2), count + ' -> ' + r.colors.length)
    const lum = r.colors.map(h => { const n = parseInt(h.slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) })
    for (let i = 1; i < lum.length; i++) assert.ok(lum[i] >= lum[i - 1], 'sorted darkest first')
    let max = 0
    for (const c of r.cells) if (c > max) max = c
    assert.equal(max, r.colors.length)
  }
})

await test("colours from the project's palette and from a named palette stay in that palette", () => {
  const proj = ['#101020', { hex: '#e0c080' }, { colors: { day: '#4060a0', night: '#203050' } }]
  const r = applyLook(P, { colors: { from: 'project', count: 8 } }, { palette: proj })
  for (const c of r.colors) assert.ok(['#101020', '#e0c080', '#4060a0'].includes(c), c)
  const gb = PALETTES.find(p => p.id === 'gameboy')
  const g = applyLook(P, { colors: { from: 'gameboy', map: 'ramp' } })
  for (const c of g.colors) assert.ok(gb.colors.includes(c), c)
})

await test('mirrors are symmetric', () => {
  for (const m of MIRRORS) {
    const r = applyLook(P, { mirror: m })
    const at = (x, y) => r.cells[y * 320 + x]
    for (let y = 0; y < 200; y += 7) {
      for (let x = 0; x < 320; x += 5) {
        if (m === 'lr' || m === 'quad' || m === 'kaleido') assert.equal(at(x, y), at(319 - x, y), m + ' left-right at ' + x + ',' + y)
        if (m === 'tb' || m === 'quad' || m === 'kaleido') assert.equal(at(x, y), at(x, 199 - y), m + ' top-bottom at ' + x + ',' + y)
      }
    }
  }
  const c = new Uint16Array(320 * 200).map((_, i) => (i % 7) + 1)
  mirrorCells(c, 320, 200, 'kaleido')
  assert.ok(c.every(v => v >= 1 && v <= 7), 'kaleido samples inside the frame')
})

await test('glyph bitmaps: every glyph fits its block at both sizes; ramps go from light to heavy ink', () => {
  for (const [size, sz] of Object.entries(GLYPH_SIZES)) {
    for (const id of GLYPH_IDS) {
      drawGlyph(id, size, 0, 0, (x, y) => {
        assert.ok(x >= 0 && y >= 0 && x < sz.w && y < sz.h, id + ' ' + size + ' out of its block at ' + x + ',' + y)
      })
    }
    assert.equal(glyphInk('sp', size), 0)
    assert.ok(glyphInk('block', size) > glyphInk('dot', size))
    assert.ok(glyphInk('d6', size) > glyphInk('d1', size))
  }
  assert.ok(GLYPH_SETS.length >= 5)
})

await test('shapes fit their block with a gutter and grow with size', () => {
  for (const shape of SHAPE_IDS) {
    for (let k = 3; k <= 8; k++) {
      let last = -1
      for (const s of [0.2, 0.5, 1]) {
        const cells = shapeCells(shape, k, s)
        for (const [x, y] of cells) assert.ok(x >= 0 && y >= 0 && x < k - 1 && y < k - 1, shape + ' k' + k + ' cell ' + x + ',' + y)
        if (shape !== 'ring') assert.ok(cells.length >= last, shape + ' k' + k + ' grows')
        last = cells.length
      }
    }
  }
})

await test('the same input gives the same cells (no randomness)', () => {
  for (const p of LOOK_PRESETS) {
    const look = withPreset(DEFAULT_LOOK, p)
    const a = applyLook(P, look)
    const b = applyLook(P, look)
    assert.deepEqual(a.colors, b.colors, p.id)
    assert.ok(a.cells.every((v, i) => v === b.cells[i]), p.id + ' cells differ')
  }
})

await test('every preset runs on a sprite with transparency and leaves the outside empty', () => {
  const placed = placeAsset(sprite(), { x: 100, y: 50, scale: 2 })
  for (const p of LOOK_PRESETS) {
    const r = applyLook(placed, withPreset(DEFAULT_LOOK, p))
    assert.ok(r.colors.length >= 1 && r.colors.length <= 64, p.id)
    assert.equal(r.cells[0], 0, p.id + ' top-left should stay empty')
    assert.equal(r.cells[199 * 320 + 319], 0, p.id + ' bottom-right should stay empty')
  }
})

await test('normalizeLook clamps and fills in; withPreset keeps the cut', () => {
  const L = normalizeLook({ colors: { count: 999, from: 'nope' }, dither: { algo: 'nope', amount: 7 }, shapes: { on: true, k: 1 }, mirror: 'sideways' })
  assert.equal(L.colors.count, 64)
  assert.equal(L.colors.from, 'art')
  assert.equal(L.dither.algo, 'none')
  assert.equal(L.dither.amount, 1)
  assert.equal(L.shapes.k, 3)
  assert.equal(L.mirror, 'none')
  const w = withPreset({ cut: { mode: 'auto', grow: 2 } }, LOOK_PRESETS[0])
  assert.equal(w.cut.mode, 'auto')
  assert.equal(w.cut.grow, 2)
})

await test('applyLookFrames shares one palette across frames', () => {
  const a = photo(320, 200, 3)
  const b = photo(320, 200, 4)
  const r = applyLookFrames([a, b], { colors: { count: 8 } })
  assert.equal(r.frames.length, 2)
  let max = 0
  for (const f of r.frames) for (const c of f) if (c > max) max = c
  assert.ok(max <= r.colors.length && r.colors.length <= 8)
})

await test('renderCells draws cells at a scale', () => {
  const r = renderCells(new Uint16Array([1, 0, 0, 2]), ['#ff0000', '#0000ff'], 2, 2, 3)
  assert.equal(r.w, 6)
  assert.deepEqual(Array.from(r.data.subarray(0, 4)), [255, 0, 0, 255])
  assert.equal(r.data[(0 * 6 + 3) * 4 + 3], 0)
  assert.deepEqual(Array.from(r.data.subarray((5 * 6 + 5) * 4, (5 * 6 + 5) * 4 + 4)), [0, 0, 255, 255])
})

/* ---------- Cost ---------- */

await test('estimateCost is fast (median under 20 ms) and close to the encoder', async () => {
  const cases = [
    applyLook(P, { colors: { count: 16 } }),
    applyLook(P, withPreset(DEFAULT_LOOK, LOOK_PRESETS.find(p => p.id === 'soft-dither'))),
    applyLook(P, withPreset(DEFAULT_LOOK, LOOK_PRESETS.find(p => p.id === 'halftone'))),
    applyLook(P, withPreset(DEFAULT_LOOK, LOOK_PRESETS.find(p => p.id === 'glyph-glow'))),
  ]
  const times = []
  for (let k = 0; k < 5; k++) for (const r of cases) times.push(estimateCost(r.cells, r.colors).ms)
  times.sort((a, b) => a - b)
  const median = times[times.length >> 1]
  console.log('       estimate time: median', median, 'ms, max', times[times.length - 1], 'ms')
  assert.ok(median < 20, 'median ' + median + ' ms')
  for (const r of cases) {
    const e = estimateCost(r.cells, r.colors)
    const real = await encoderCost(r.cells, r.colors)
    const err = e.chars / real.chars - 1
    console.log('       estimate', e.chars, 'encoder', real.chars, (err * 100).toFixed(1) + '%')
    assert.ok(Math.abs(err) < 0.25, 'off by ' + (err * 100).toFixed(1) + '%')
  }
  assert.equal(estimateCost(new Uint16Array(320 * 200)).chars, 0)
})

await test('fitLook simplifies a look until it fits the budget', () => {
  const busy = { picture: { smooth: 0 }, colors: { count: 32, clean: 0 }, dither: { algo: 'bayer4', amount: 0.8, where: 'all' } }
  const before = applyLook(P, busy)
  const cost0 = estimateCost(before.cells, before.colors).chars
  const budget = Math.round(cost0 * 0.5)
  const f = fitLook(P, busy, { budget })
  console.log('       ' + cost0 + ' -> ' + f.cost + ' (budget ' + budget + '): ' + f.steps.join(', '))
  assert.ok(f.fits && f.cost <= budget, 'cost ' + f.cost)
  assert.ok(f.steps.length > 0)
  const easy = fitLook(P, busy, { budget: cost0 + 1, margin: 0 })
  assert.equal(easy.steps.length, 0)
  assert.deepEqual(easy.look, normalizeLook(busy))
})

/* ---------- GIF reader ---------- */

await test('decodeGif reads frames, delays, transparency, disposal, interlace and local sizes', () => {
  const pal = [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255]]
  const g = new GifWriter(8, 6, pal)
  g.addFrame(new Uint8Array(48).fill(1), 120)
  // A 4 x 3 patch of green at (2, 1), index 0 transparent around a blue centre.
  g.addFrame(new Uint8Array([2, 2, 2, 2, 2, 3, 0, 2, 2, 2, 2, 2]), 50, { x: 2, y: 1, fw: 4, fh: 3, transparent: 0, dispose: 2 })
  g.addFrame(Uint8Array.from({ length: 48 }, (_, i) => (Math.floor(i / 8) % 2 ? 3 : 2)), 70, { interlace: true })
  const bytes = g.finish()
  assert.equal(gifFrameCount(bytes), 3)
  const d = decodeGif(bytes)
  assert.equal(d.w, 8)
  assert.equal(d.h, 6)
  assert.deepEqual(d.frames.map(f => f.delay), [120, 50, 70])
  const at = (f, x, y) => Array.from(d.frames[f].data.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4))
  assert.deepEqual(at(0, 0, 0), [255, 0, 0, 255])
  assert.deepEqual(at(1, 2, 1), [0, 255, 0, 255])
  assert.deepEqual(at(1, 3, 2), [0, 0, 255, 255])
  assert.deepEqual(at(1, 4, 2), [255, 0, 0, 255], 'transparent index shows the frame below')
  assert.deepEqual(at(1, 0, 0), [255, 0, 0, 255])
  // Frame 2 after disposal 2 of frame 1: the interlaced stripes, rows alternate.
  assert.deepEqual(at(2, 0, 0), [0, 255, 0, 255])
  assert.deepEqual(at(2, 0, 1), [0, 0, 255, 255])
  assert.deepEqual(at(2, 5, 4), [0, 255, 0, 255])
  let calls = 0
  decodeGif(bytes, { onFrame: (screen, delay, i) => { calls++; assert.equal(screen.w, 8); assert.equal(i, calls - 1) } })
  assert.equal(calls, 3)
  assert.throws(() => decodeGif(new Uint8Array([1, 2, 3])))
})

console.log('\n' + passed + ' passed, ' + failed + ' failed')
process.exit(failed ? 1 : 0)
