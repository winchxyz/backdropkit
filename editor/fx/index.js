// BackdropKit looks: turning someone's own art into cells for a theme.
//
// Everything a theme shows is cells on the 320 x 200 grid, each coloured from a palette slot,
// and a whole scene must stay under 131,072 characters of SVG. A look is the stack of effects
// that turns placed art (RGBA pixels, one per cell) into those cells: it decides how the art
// reads, and also what it costs. Flat areas, clean edges and regular ordered patterns are cheap;
// many colours and noisy dither are not. Plain ES modules with no dependencies: the core runs in
// the browser and in Node; DOM helpers live in browser.js.
//
// The API
//   applyLook(rgba, look, { palette, colors }) -> { cells: Uint16Array(w*h), colors: ['#rrggbb'], w, h }
//     rgba: { w: 320, h: 200, data: Uint8ClampedArray }, already placed (see placeAsset).
//     A cell under 50% alpha is empty (0); otherwise it is an index + 1 into `colors`.
//     `colors` comes out darkest first (Rec. 709, the order the exporter's encoder draws in).
//     palette: the project's colours, for colors.from = 'project' (hex strings, or the project's
//       palette entries { colors: { momentId: hex } }, whose first colour is used).
//     colors: a fixed list of hex colours to map to instead of building a palette.
//   applyLookFrames([rgba, ...], look, opts) -> { frames: [Uint16Array], colors }
//     The same for an animated asset: one palette shared by every frame, so nothing flickers.
//   removeBackground(rgba, cut) -> rgba            (cut.js; the `cut` stage on its own)
//   placeAsset(frameRgba, place, w = 320, h = 200) -> rgba    (place.js)
//   estimateCost(cells, colors?) -> { chars, runs, paths, colors, ms }   (cost.js)
//   fitLook(rgba | [rgba], look, { budget = 90000, margin = 0.06, measure, palette, colors })
//     -> { look, frames, colors, cost, steps, fits }
//     The look simplified step by step (lighter dither, smoother, fewer colours...) until its
//     estimated cost (or measure(frames, colors)) fits the budget; `steps` names the changes.
//     Up to ~1 s with the estimate: run on demand.
//   renderCells(cells, colors, w, h, scale = 1) -> rgba        (for previews and tests)
//   normalizeLook(look) -> a complete look; withPreset(look, preset) -> the preset over a look,
//     keeping the look's own cut (a cut belongs to the art, not to the look).
//   mirrorCells(cells, w, h, mode) (the mirror stage on its own, in place)
//   DEFAULT_LOOK, LOOK_PRESETS ([{ id, name, hint, look }]), PALETTES, ALGOS, SHAPE_IDS,
//   GLYPH_SETS, CUT_MODES, MIRRORS: the choices, for the inspector's lists
//
// The look stack, in order. Every stage has `on` (default true where it has its own "none"
// value, false for shapes, glyphs and outline); missing fields take DEFAULT_LOOK's.
//   cut:     { mode: 'none' | 'auto' | 'color' | 'dark' | 'light', color: '#rrggbb', tol 0.02-0.6,
//              soft 0-1, grow -6..6 (cells), specks 0-300 (cells), connected: bool }
//            Background removal. 'auto' keeps the art's own transparency, else keys a plain
//            border colour, else finds the subject by a flood from the border.
//   picture: { exposure -2..2 (stops), contrast -1..1, saturation 0-2, hue -180..180,
//              warmth -1..1, levels: bool (auto levels), smooth 0-3 (edge-keeping passes) }
//   colors:  { count 2-64, from: 'art' | 'project' | <palette id>, map: 'nearest' | 'ramp',
//              merge 0-1 (merge near colours; art only), clean 0-3 (drop stray cells; only
//              without dither) }
//            'ramp' maps brightness along the palette, darkest to lightest (a gradient map).
//   dither:  { algo: one of ALGOS ids (Nightgrain's), amount 0-1 (how wide the mixing band
//              between two colours is), scale 1-4 (pattern cell size),
//              where: 'smooth' (only where the art changes gently: skies, gradients) | 'all' }
//            'smooth' keeps busy areas flat, where a pattern adds only noise and cost.
//   shapes:  { on, k 3-8, shape: 'dot' | 'ring' | 'diamond' | 'plus' | 'square', bySize: bool,
//              ground: 'none' | 'dark' | 'light' | '#rrggbb' }
//            The layer in k x k blocks, each one shape of whole cells. With bySize the shape
//            grows with brightness (with darkness on a light ground). 'dark' and 'light' take
//            that end of the palette as the ground and keep it out of the shapes.
//   glyphs:  { on, size: '5x7' | '7x9', set: 'signal' | 'ascii' | 'dots' | 'blocks' | 'lines' |
//              'digits' | 'binary', edges: bool, ground (as for shapes) }
//            Blocks of 5 x 7 or 7 x 9 cells, each a hand-made glyph picked by brightness and, with
//            edges, a stroke along strong edges. Shapes win when both are on.
//   outline: { on, color: 'dark' | 'light' | '#rrggbb', inner 0-1 }
//            A 1-cell contour outside the subject; `inner` also inks the edges between areas
//            that differ strongly (0 off, 1 the most lines).
//   mirror:  'none' | 'lr' | 'tb' | 'quad' | 'kaleido'
//            Left half onto the right, top onto bottom, top-left quarter into all four, or an
//            eightfold kaleidoscope round the centre. Applied to the finished cells.

import { removeBackground, CUT_MODES, DEFAULT_CUT } from './cut.js'
import { placeAsset, fitPlace } from './place.js'
import { adjustPicture, lumaPercentiles } from './picture.js'
import { newHistogram, addToHistogram, histogramBins, kmeansLab, mergeNearLab, pickFromList, makePalette, labsToHex } from './quantize.js'
import { mapGrid, smoothness, ALGOS, ALGO_IDS } from './dither.js'
import { shapeCells, SHAPE_IDS } from './shapes.js'
import { pickGlyph, drawGlyph, GLYPH_SIZES, GLYPH_SETS } from './glyphs.js'
import { PALETTES, paletteById } from './palettes.js'
import { estimateCost } from './cost.js'
import { hexToRgb, rgbToHex, hexToLab, labToHex, lum709, luma, isHex, clamp, hash } from './color.js'

export { removeBackground, placeAsset, fitPlace, estimateCost, PALETTES, paletteById, ALGOS, SHAPE_IDS, GLYPH_SETS, CUT_MODES }

export const MIRRORS = ['none', 'lr', 'tb', 'quad', 'kaleido']

export const DEFAULT_LOOK = Object.freeze({
  cut: { on: true, ...DEFAULT_CUT },
  picture: { on: true, exposure: 0, contrast: 0, saturation: 1, hue: 0, warmth: 0, levels: false, smooth: 1 },
  colors: { on: true, count: 16, from: 'art', map: 'nearest', merge: 0.3, clean: 1 },
  dither: { on: true, algo: 'none', amount: 0.5, scale: 1, where: 'smooth' },
  shapes: { on: false, k: 5, shape: 'dot', bySize: true, ground: 'dark' },
  glyphs: { on: false, size: '5x7', set: 'signal', edges: true, ground: 'dark' },
  outline: { on: false, color: 'dark', inner: 0 },
  mirror: 'none',
})

// Ready-made looks. They leave `cut` out: the art keeps its own background setting.
export const LOOK_PRESETS = [
  {
    id: 'clean',
    name: 'Clean pixels',
    hint: 'Your art as tidy pixel art: smoothed into flat areas, 14 colours, no grain.',
    look: { picture: { smooth: 2, saturation: 1.08 }, colors: { count: 14, merge: 0.4, clean: 2 }, dither: { algo: 'none' } },
  },
  {
    id: 'soft-dither',
    name: 'Soft dither',
    hint: 'Ten colours with a fine Bayer pattern where one colour turns gently into the next.',
    look: { picture: { smooth: 2 }, colors: { count: 10, merge: 0.35, clean: 2 }, dither: { algo: 'bayer4', amount: 0.3 } },
  },
  {
    id: 'night-grain',
    name: 'Night grain',
    hint: "Nightgrain's moonlit blues with warm highlights, mixed on an 8 x 8 grid.",
    look: { picture: { levels: true, contrast: 0.1, smooth: 2 }, colors: { from: 'nightgrain', map: 'ramp', clean: 2 }, dither: { algo: 'bayer8', amount: 0.3 } },
  },
  {
    id: 'poster',
    name: 'Poster',
    hint: 'Seven bold flat colours, like a screen print.',
    look: { picture: { smooth: 3, contrast: 0.2, saturation: 1.25 }, colors: { count: 7, merge: 0.5, clean: 3 }, dither: { algo: 'none' } },
  },
  {
    id: 'glyph-glow',
    name: 'Glyph glow',
    hint: "Afterglyph's symbols in the art's own colours on near black; strokes follow the edges.",
    look: { picture: { saturation: 1.4, contrast: 0.15, levels: true, smooth: 1 }, colors: { count: 8, merge: 0.3 }, dither: { algo: 'none' }, glyphs: { on: true, size: '5x7', set: 'signal', edges: true, ground: '#07080f' } },
  },
  {
    id: 'halftone',
    name: 'Halftone dots',
    hint: "Round dots in the art's own colours on near black, bigger where it is brighter, like a lit sign.",
    look: { picture: { smooth: 1, saturation: 1.3, contrast: 0.15 }, colors: { count: 8, merge: 0.3 }, dither: { algo: 'none' }, shapes: { on: true, k: 5, shape: 'dot', bySize: true, ground: '#0b0c14' } },
  },
  {
    id: 'ink-outline',
    name: 'Ink outline',
    hint: 'Flat colours with dark ink lines round the shapes, like a cartoon.',
    look: { picture: { smooth: 3, saturation: 1.15 }, colors: { count: 9, merge: 0.4, clean: 3 }, dither: { algo: 'none' }, outline: { on: true, color: 'dark', inner: 0.5 } },
  },
  {
    id: 'retro-16',
    name: 'Retro 16',
    hint: 'Up to twelve colours of a sixteen-colour fantasy console, with a light Bayer mix.',
    look: { picture: { smooth: 2, saturation: 1.2 }, colors: { from: 'console16', count: 12, clean: 2 }, dither: { algo: 'bayer4', amount: 0.3 } },
  },
  {
    id: 'game-boy',
    name: 'Game Boy',
    hint: 'Four greens of the old handheld, by brightness, with a fine Bayer grid.',
    look: { picture: { levels: true, smooth: 2 }, colors: { from: 'gameboy', map: 'ramp', clean: 2 }, dither: { algo: 'bayer4', amount: 0.35 } },
  },
  {
    id: 'pastel',
    name: 'Pastel',
    hint: "Soft, light colours from the art's own hues, flat and calm.",
    look: { picture: { exposure: 0.35, contrast: -0.35, saturation: 0.75, smooth: 2 }, colors: { count: 10, merge: 0.4, clean: 2 }, dither: { algo: 'none' } },
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    hint: 'Blueprint blues in engraved lines, with white ink on the edges.',
    look: { picture: { levels: true, smooth: 2 }, colors: { from: 'blueprint', map: 'ramp' }, dither: { algo: 'linesh', amount: 0.6 }, outline: { on: true, color: 'light', inner: 0.35 } },
  },
  {
    id: 'sunset-wash',
    name: 'Sunset wash',
    hint: 'The art recoloured by brightness, from deep plum to warm cream.',
    look: { picture: { levels: true, smooth: 2 }, colors: { from: 'sunset', map: 'ramp', clean: 2 }, dither: { algo: 'bayer8', amount: 0.3 } },
  },
]

/* ---------- Looks ---------- */

const num = (v, d, lo, hi) => {
  const x = Number(v)
  return Number.isFinite(x) ? clamp(x, lo, hi) : d
}

// A complete look: every stage present, values in range.
export function normalizeLook(look = {}) {
  const D = DEFAULT_LOOK
  const L = look ?? {}
  const st = k => ({ ...D[k], ...(L[k] && typeof L[k] === 'object' ? L[k] : {}) })
  const cut = st('cut')
  const picture = st('picture')
  const colors = st('colors')
  const dither = st('dither')
  const shapes = st('shapes')
  const glyphs = st('glyphs')
  const outline = st('outline')
  return {
    cut: {
      on: cut.on !== false,
      mode: CUT_MODES.includes(cut.mode) ? cut.mode : 'none',
      color: isHex(cut.color) ? cut.color : '#ffffff',
      tol: num(cut.tol, 0.16, 0.02, 0.6),
      soft: num(cut.soft, 0.5, 0, 1),
      grow: Math.round(num(cut.grow, 0, -6, 6)),
      specks: Math.round(num(cut.specks, 0, 0, 300)),
      connected: cut.connected !== false,
    },
    picture: {
      on: picture.on !== false,
      exposure: num(picture.exposure, 0, -2, 2),
      contrast: num(picture.contrast, 0, -1, 1),
      saturation: num(picture.saturation, 1, 0, 2),
      hue: num(picture.hue, 0, -180, 180),
      warmth: num(picture.warmth, 0, -1, 1),
      levels: !!picture.levels,
      smooth: Math.round(num(picture.smooth, 0, 0, 3)),
    },
    colors: {
      on: colors.on !== false,
      count: Math.round(num(colors.count, 16, 2, 64)),
      from: colors.from === 'project' || colors.from === 'art' || paletteById(colors.from) ? colors.from : 'art',
      map: colors.map === 'ramp' ? 'ramp' : 'nearest',
      merge: num(colors.merge, 0.3, 0, 1),
      clean: Math.round(num(colors.clean, 1, 0, 3)),
    },
    dither: {
      on: dither.on !== false,
      algo: ALGO_IDS.has(dither.algo) ? dither.algo : 'none',
      amount: num(dither.amount, 0.5, 0, 1),
      scale: Math.round(num(dither.scale, 1, 1, 4)),
      where: dither.where === 'all' ? 'all' : 'smooth',
    },
    shapes: {
      on: !!shapes.on,
      k: Math.round(num(shapes.k, 5, 3, 8)),
      shape: SHAPE_IDS.includes(shapes.shape) ? shapes.shape : 'dot',
      bySize: shapes.bySize !== false,
      ground: groundOf(shapes.ground),
    },
    glyphs: {
      on: !!glyphs.on,
      size: glyphs.size === '7x9' ? '7x9' : '5x7',
      set: GLYPH_SETS.some(s => s.id === glyphs.set) ? glyphs.set : 'signal',
      edges: glyphs.edges !== false,
      ground: groundOf(glyphs.ground),
    },
    outline: {
      on: !!outline.on,
      color: outline.color === 'light' || isHex(outline.color) ? outline.color : 'dark',
      inner: num(outline.inner, 0, 0, 1),
    },
    mirror: MIRRORS.includes(L.mirror) ? L.mirror : 'none',
  }
}
const groundOf = g => (g === 'none' || g === 'dark' || g === 'light' || isHex(g) ? g : 'none')

// A preset's look laid over a current look. Stages the preset names replace the current ones
// (from the defaults, so nothing of an earlier preset lingers); the cut stays.
export function withPreset(current, preset) {
  const p = preset?.look ?? preset ?? {}
  const out = normalizeLook(p)
  if (current?.cut) out.cut = normalizeLook({ cut: current.cut }).cut
  return out
}

/* ---------- Applying a look ---------- */

export function applyLook(rgba, look, opts = {}) {
  const r = applyLookFrames([rgba], look, opts)
  return { cells: r.frames[0], colors: r.colors, w: rgba.w, h: rgba.h }
}

export function applyLookFrames(frames, look, opts = {}) {
  const L = normalizeLook(look)
  if (!frames.length) return { frames: [], colors: [] }
  const preps = frames.map(f => prepare(f, L))
  const list = buildColors(preps, L, opts)
  const plan = colourPlan(list, L)
  const out = preps.map(p => render(p, L, plan))
  return finish(out, plan.table, preps[0].w, preps[0].h)
}

/* ---------- Fitting a budget ---------- */

// The steps fitLook takes, in order; each returns a simpler look, or null when it does not apply.
const FIT_STEPS = (() => {
  const dithered = L => L.dither.on && L.dither.algo !== 'none' && L.dither.amount > 0
  const plain = L => !L.shapes.on && !L.glyphs.on
  const lighter = L => (dithered(L) && L.dither.amount > 0.2 ? ['Lighter dither', { ...L, dither: { ...L.dither, amount: +(L.dither.amount * 0.6).toFixed(3) } }] : null)
  const smoothOnly = L => (dithered(L) && L.dither.where === 'all' ? ['Dither only in smooth areas', { ...L, dither: { ...L.dither, where: 'smooth' } }] : null)
  const smoother = L => (plain(L) && (!L.picture.on || L.picture.smooth < 3) ? ['Smoother picture', { ...L, picture: { ...L.picture, on: true, smooth: L.picture.on ? L.picture.smooth + 1 : 1 } }] : null)
  const cleaner = L => (L.colors.clean < 3 ? ['Fewer stray cells', { ...L, colors: { ...L.colors, on: true, clean: L.colors.clean + 1, merge: Math.min(1, L.colors.merge + 0.15) } }] : null)
  const fewer = L => {
    const named = paletteById(L.colors.from)
    if (named && L.colors.map === 'ramp') return null
    const now = L.colors.on ? L.colors.count : 64
    const cap = named ? Math.min(now, named.colors.length) : now
    if (cap <= 4) return null
    return ['Fewer colours', { ...L, colors: { ...L.colors, on: true, count: Math.max(4, Math.round(cap * 0.75)) } }]
  }
  const noDither = L => (dithered(L) ? ['No dither', { ...L, dither: { ...L.dither, algo: 'none' } }] : null)
  const bigger = L => {
    if (L.shapes.on && L.shapes.k < 8) return ['Bigger shapes', { ...L, shapes: { ...L.shapes, k: L.shapes.k + 1 } }]
    if (!L.shapes.on && L.glyphs.on && L.glyphs.size === '5x7') return ['Bigger glyphs', { ...L, glyphs: { ...L.glyphs, size: '7x9' } }]
    return null
  }
  return [lighter, smoothOnly, smoother, cleaner, fewer, lighter, smoother, noDither, bigger, fewer, cleaner, bigger, fewer, bigger, fewer, fewer]
})()

/**
 * fitLook(rgba | [rgba, ...], look, { budget = 90000, margin = 0.06, measure, palette, colors })
 *   -> { look, frames, colors, cost, steps, fits }
 * Applies the look and, while the estimated cost (all frames together) is over the budget,
 * simplifies it a step at a time: a lighter dither, a smoother picture, fewer stray cells,
 * fewer colours, no dither, bigger shapes or glyphs. `steps` names what was changed; `fits` is
 * false when even the simplest look stays over. It aims `margin` (6%) under the budget, for
 * the estimate's error. `measure(frames, colors) -> chars` replaces the estimate: the
 * exporter's own count of the scene with these cells, say (then pass margin: 0). Each step is
 * one applyLook (and one measure), so this takes up to a second or so on a big picture with
 * the estimate, more with the exporter: run it on demand, not on every slider move.
 */
export function fitLook(input, look, opts = {}) {
  const frames = Array.isArray(input) ? input : [input]
  // The estimate is within about 5% of the encoder on most pictures (worse on a few), so it
  // aims a little under the budget.
  const budget = opts.budget ?? 90000
  const target = budget * (1 - (opts.margin ?? 0.06))
  const run = L => {
    const r = applyLookFrames(frames, L, opts)
    let cost = 0
    if (opts.measure) cost = opts.measure(r.frames, r.colors)
    else for (const c of r.frames) cost += estimateCost(c, r.colors, { w: r.w }).chars
    return { ...r, cost }
  }
  let L = normalizeLook(look)
  let r = run(L)
  const steps = []
  for (const step of FIT_STEPS) {
    if (r.cost <= target) break
    const s = step(L)
    if (!s) continue
    const r2 = run(s[1])
    // A step that saves nothing is not taken.
    if (r2.cost >= r.cost) continue
    L = s[1]
    r = r2
    steps.push(s[0])
  }
  return { look: L, frames: r.frames, colors: r.colors, cost: r.cost, steps, fits: r.cost <= budget }
}

// Cut, picture, and the grid the colours are picked on (cells, or blocks for shapes and glyphs).
function prepare(rgba, L) {
  const { w, h } = rgba
  const n = w * h
  const cutOn = L.cut.on && (L.cut.mode !== 'none' || L.cut.grow || L.cut.specks)
  const src = cutOn ? removeBackground(rgba, L.cut) : rgba
  const d = src.data
  const R = new Float32Array(n)
  const G = new Float32Array(n)
  const B = new Float32Array(n)
  const M = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    R[i] = d[4 * i] / 255
    G[i] = d[4 * i + 1] / 255
    B[i] = d[4 * i + 2] / 255
    M[i] = d[4 * i + 3] >= 128 ? 1 : 0
  }
  adjustPicture(R, G, B, M, w, h, L.picture)
  let bw = 1
  let bh = 1
  if (L.shapes.on) bw = bh = L.shapes.k
  else if (L.glyphs.on) {
    const sz = GLYPH_SIZES[L.glyphs.size]
    bw = sz.w
    bh = sz.h
  }
  const p = { w, h, n, R, G, B, M, bw, bh }
  if (bw === 1 && bh === 1) {
    Object.assign(p, { gw: w, gh: h, gn: n, gR: R, gG: G, gB: B, gM: M, ox: 0, oy: 0 })
    return p
  }
  // Blocks, centred on the frame.
  const gw = Math.ceil(w / bw)
  const gh = Math.ceil(h / bh)
  const ox = Math.floor((w - gw * bw) / 2)
  const oy = Math.floor((h - gh * bh) / 2)
  const gn = gw * gh
  const gR = new Float32Array(gn)
  const gG = new Float32Array(gn)
  const gB = new Float32Array(gn)
  const gM = new Uint8Array(gn)
  const cover = new Float32Array(gn)
  const blockOf = new Int32Array(n)
  for (let y = 0; y < h; y++) {
    const by = ((y - oy) / bh) | 0
    for (let x = 0; x < w; x++) {
      const b = by * gw + (((x - ox) / bw) | 0)
      const i = y * w + x
      blockOf[i] = b
      if (!M[i]) continue
      gR[b] += R[i]
      gG[b] += G[i]
      gB[b] += B[i]
      cover[b] += 1
    }
  }
  for (let b = 0; b < gn; b++) {
    const c = cover[b]
    if (c > 0) {
      gR[b] /= c
      gG[b] /= c
      gB[b] /= c
    }
    gM[b] = c >= (bw * bh) / 2 ? 1 : 0
  }
  Object.assign(p, { gw, gh, gn, gR, gG, gB, gM, ox, oy, blockOf })
  if (L.glyphs.on && !L.shapes.on) p.tensor = blockTensor(p)
  return p
}

// Afterglyph's per-cell structure tensor (measure), summed per block and smoothed over the
// 3 x 3 blocks around: { xx, yy, xy } per block.
function blockTensor(p) {
  const { w, h, R, G, B, M, gw, gh, gn, ox, oy, bw, bh } = p
  const Y = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) Y[i] = luma(R[i], G[i], B[i])
  const jxx = new Float32Array(gn)
  const jyy = new Float32Array(gn)
  const jxy = new Float32Array(gn)
  for (let y = 0; y < h; y++) {
    const yu = y > 0 ? -w : 0
    const yd = y < h - 1 ? w : 0
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!M[i]) continue
      const xl = x > 0 ? -1 : 0
      const xr = x < w - 1 ? 1 : 0
      const gx = (Y[i + xr] - Y[i + xl]) * M[i + xr] * M[i + xl]
      const gy = (Y[i + yd] - Y[i + yu]) * M[i + yd] * M[i + yu]
      const b = p.blockOf[i]
      jxx[b] += gx * gx
      jyy[b] += gy * gy
      jxy[b] += gx * gy
    }
  }
  const N = bw * bh
  const xx = new Float32Array(gn)
  const yy = new Float32Array(gn)
  const xy = new Float32Array(gn)
  for (let by = 0; by < gh; by++) {
    for (let bx = 0; bx < gw; bx++) {
      let a = 0
      let b = 0
      let e = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy2 = by + dy
        if (yy2 < 0 || yy2 >= gh) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx2 = bx + dx
          if (xx2 < 0 || xx2 >= gw) continue
          const k = yy2 * gw + xx2
          const wt = dx || dy ? 0.5 : 1
          a += jxx[k] * wt
          b += jyy[k] * wt
          e += jxy[k] * wt
        }
      }
      const c = by * gw + bx
      xx[c] = a / 5 / N
      yy[c] = b / 5 / N
      xy[c] = e / 5 / N
    }
  }
  void ox
  void oy
  return { xx, yy, xy }
}

// The project's colours as hex: strings, { hex }, or palette entries { colors: { moment: hex } }.
function projectHexes(palette) {
  if (!Array.isArray(palette)) return []
  const out = []
  for (const e of palette) {
    let h = null
    if (typeof e === 'string') h = e
    else if (e && typeof e === 'object') {
      if (isHex(e.hex)) h = e.hex
      else if (e.colors && typeof e.colors === 'object') h = Object.values(e.colors).find(isHex) ?? null
    }
    if (isHex(h)) out.push(rgbToHex(...hexToRgb(h)))
  }
  return [...new Set(out)]
}

// The colours the look maps to, from the art (k-means in OKLab, near ones merged), the
// project's palette or a named palette.
function buildColors(preps, L, opts) {
  if (Array.isArray(opts.colors) && opts.colors.length) return [...new Set(opts.colors.filter(isHex).map(h => rgbToHex(...hexToRgb(h))))]
  const hist = newHistogram()
  for (const p of preps) addToHistogram(hist, p.gR, p.gG, p.gB, p.gM, p.gn, 1 / preps.length)
  const bins = histogramBins(hist)
  if (!bins.n) return []
  const C = L.colors
  const count = C.on ? C.count : 64
  const proj = C.from === 'project' ? projectHexes(opts.palette) : []
  if (C.from === 'project' && proj.length) return pickFromList(bins, proj, count)
  const named = paletteById(C.from)
  if (named) return C.map === 'ramp' ? named.colors.slice() : pickFromList(bins, named.colors, count)
  const km = kmeansLab(bins, count, 8)
  const merged = C.on ? mergeNearLab(km, C.merge * 0.1) : km
  return [...new Set(labsToHex(merged.lab, merged.k))]
}

// The working colour table: the ink colours the grid maps to, then the ground and outline.
function colourPlan(list, L) {
  const table = list.slice()
  let ink = list.slice()
  let ground = -1
  const st = L.shapes.on ? L.shapes : L.glyphs.on ? L.glyphs : null
  if (st && st.ground !== 'none' && list.length) {
    if (isHex(st.ground)) {
      ground = table.push(rgbToHex(...hexToRgb(st.ground))) - 1
    } else {
      const lums = list.map(h => lum709(...hexToRgb(h)))
      let gi = 0
      for (let i = 1; i < list.length; i++) if (st.ground === 'dark' ? lums[i] < lums[gi] : lums[i] > lums[gi]) gi = i
      ground = gi
      if (list.length >= 2) ink = list.filter((_, i) => i !== gi)
    }
  }
  // Ink index -> table index.
  const inkToTable = ink.map(h => table.indexOf(h))
  let outline = -1
  if (L.outline.on && list.length) outline = table.push(outlineColour(L.outline.color, list)) - 1
  return { table, ink, inkToTable, ground, outline, inkLab: list.map(hexToLab) }
}

// 'dark': the palette's darkest colour, deepened when it is not dark enough to read as ink;
// 'light' the same at the other end; or a hex colour.
function outlineColour(spec, list) {
  if (isHex(spec)) return rgbToHex(...hexToRgb(spec))
  const labs = list.map(hexToLab)
  let pick = 0
  for (let i = 1; i < labs.length; i++) if (spec === 'light' ? labs[i][0] > labs[pick][0] : labs[i][0] < labs[pick][0]) pick = i
  const [Lv, a, b] = labs[pick]
  if (spec === 'light') return Lv >= 0.9 ? list[pick] : labToHex(Math.max(0.94, Lv), a * 0.4, b * 0.4)
  return Lv <= 0.22 ? list[pick] : labToHex(Math.min(0.2, Lv * 0.45), a * 0.6, b * 0.6)
}

// Stray cells go (colors.clean): pass 1 replaces cells none of whose 8 neighbours share their
// colour; pass 2 also cells with one such neighbour when six or more agree on another colour;
// pass 3 also single cells that break a horizontal run between two of the same colour.
function cleanIdx(idx, w, h, passes, skip = null) {
  const cnt = new Map()
  for (let p = 1; p <= passes; p++) {
    const src = idx.slice()
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const c = src[i]
        if (c < 0 || (skip && skip[i] > 0.02)) continue
        cnt.clear()
        let same = 0
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= h) continue
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue
            const xx = x + dx
            if (xx < 0 || xx >= w) continue
            const v = src[yy * w + xx]
            if (v < 0) continue
            if (v === c) same++
            else cnt.set(v, (cnt.get(v) ?? 0) + 1)
          }
        }
        let best = -1
        let bc = 0
        for (const [v, k] of cnt) {
          if (k > bc) {
            bc = k
            best = v
          }
        }
        if (best < 0) continue
        if (same === 0 && bc >= 3) idx[i] = best
        else if (p >= 2 && same === 1 && bc >= 6) idx[i] = best
        else if (p >= 3 && x > 0 && x < w - 1) {
          const l = src[i - 1]
          const r = src[i + 1]
          if (l === r && l >= 0 && l !== c && ((y > 0 && src[i - w] === l) || (y < h - 1 && src[i + w] === l))) idx[i] = l
        }
      }
    }
  }
}

// Maps one prepared frame to cells (values: table index + 1).
function render(p, L, plan) {
  const { w, h, n } = p
  const cells = new Uint16Array(n)
  if (!plan.ink.length) return cells
  const pal = makePalette(plan.ink)
  const C = L.colors
  const ramp = C.map === 'ramp' ? lumaPercentiles(p.gR, p.gG, p.gB, p.gM, p.gn, 0.02, 0.98) : null
  const D = L.dither
  const algo = D.on ? D.algo : 'none'
  // mapGrid may change the planes (diffusion), so it gets copies when they are the cell planes.
  const gR = p.bw === 1 ? new Float32Array(p.gR) : p.gR
  const gG = p.bw === 1 ? new Float32Array(p.gG) : p.gG
  const gB = p.bw === 1 ? new Float32Array(p.gB) : p.gB
  const dithered = algo !== 'none' && D.amount > 0
  const where = dithered && D.where === 'smooth' ? smoothness(p.gR, p.gG, p.gB, p.gM, p.gw, p.gh) : null
  const idx = mapGrid({ R: gR, G: gG, B: gB, mask: p.gM, w: p.gw, h: p.gh, pal, algo, amount: D.amount, scale: D.scale, ramp, where })
  // Stray cells go where nothing is dithered: everywhere without dither, in the busy parts with
  // dither only in smooth areas.
  if (C.on && C.clean > 0 && (!dithered || where)) cleanIdx(idx, p.gw, p.gh, C.clean, where)
  const toT = plan.inkToTable
  const groundV = plan.ground >= 0 ? plan.ground + 1 : 0

  if (p.bw === 1 && p.bh === 1) {
    for (let i = 0; i < n; i++) if (idx[i] >= 0) cells[i] = toT[idx[i]] + 1
  } else {
    // Ground on every opaque cell first; shapes or glyphs over it.
    if (groundV) for (let i = 0; i < n; i++) if (p.M[i]) cells[i] = groundV
    const put = v => (x, y) => {
      if (x >= 0 && y >= 0 && x < w && y < h) cells[y * w + x] = v
    }
    // Brightness of each block, levelled over the blocks.
    const { lo, hi } = lumaPercentiles(p.gR, p.gG, p.gB, p.gM, p.gn, 0.04, 0.97)
    const span = Math.max(0.05, hi - lo)
    if (L.shapes.on) {
      const S = L.shapes
      const light = S.ground === 'light' || (isHex(S.ground) && luma(...hexToRgb(S.ground)) > 140)
      for (let by = 0; by < p.gh; by++) {
        for (let bx = 0; bx < p.gw; bx++) {
          const b = by * p.gw + bx
          if (!p.gM[b] || idx[b] < 0) continue
          let s = 1
          if (S.bySize) {
            let v = clamp((luma(p.gR[b], p.gG[b], p.gB[b]) - lo) / span)
            if (light) v = 1 - v
            s = v < 0.04 ? 0 : Math.sqrt(v)
          }
          if (s <= 0) continue
          const f = put(toT[idx[b]] + 1)
          const x0 = p.ox + bx * S.k
          const y0 = p.oy + by * S.k
          for (const [x, y] of shapeCells(S.shape, S.k, s)) f(x0 + x, y0 + y)
        }
      }
    } else {
      const Gl = L.glyphs
      const T = p.tensor
      // Edge energy relative to the picture's own: only its strongest edges (about the top
      // fifth of the blocks) can turn into strokes, so textures and gradients stay glyphs.
      const ens = []
      for (let b = 0; b < p.gn; b++) if (p.gM[b]) ens.push(Math.sqrt(T.xx[b] + T.yy[b]))
      ens.sort((a, b) => a - b)
      const pct = q => (ens.length ? ens[Math.min(ens.length - 1, (q * ens.length) | 0)] : 0)
      const e0 = Math.max(0.012, pct(0.78))
      const e1 = Math.max(e0 + 0.03, pct(0.97))
      for (let by = 0; by < p.gh; by++) {
        for (let bx = 0; bx < p.gw; bx++) {
          const b = by * p.gw + bx
          if (!p.gM[b] || idx[b] < 0) continue
          let Lv = clamp((luma(p.gR[b], p.gG[b], p.gB[b]) - lo) / span)
          Lv = Math.pow(Lv, 0.85)
          const a = T.xx[b]
          const bb = T.yy[b]
          const e = T.xy[b]
          const tr = a + bb
          const df = a - bb
          const en = clamp((Math.sqrt(tr) - e0) / (e1 - e0))
          const ch = tr > 1e-7 ? Math.sqrt(df * df + 4 * e * e) / tr : 0
          const q = ((Math.round((0.5 * Math.atan2(2 * e, df) + Math.PI / 2) / (Math.PI / 4)) % 4) + 4) % 4
          const g = pickGlyph(Lv, en, ch, q, hash(bx, by, 11), Gl.set, Gl.edges)
          drawGlyph(g, Gl.size, p.ox + bx * p.bw, p.oy + by * p.bh, put(toT[idx[b]] + 1))
        }
      }
    }
  }
  if (plan.outline >= 0) outlineCells(cells, w, h, plan, L.outline)
  if (L.mirror !== 'none') mirrorCells(cells, w, h, L.mirror)
  return cells
}

// Ink lines: inner edges first (on the lighter cell of a strongly differing pair), then the
// contour outside the subject (empty cells next to it, 4-neighbourhood).
function outlineCells(cells, w, h, plan, O) {
  const v = plan.outline + 1
  const n = w * h
  const mark = new Uint8Array(n)
  if (O.inner > 0) {
    const labs = plan.table.map(hexToLab)
    const lums = plan.table.map(hx => lum709(...hexToRgb(hx)))
    const thr = 0.4 - 0.28 * O.inner
    const t2 = thr * thr
    const far = (a, b) => {
      const A = labs[a - 1]
      const B = labs[b - 1]
      const x = A[0] - B[0]
      const y = A[1] - B[1]
      const z = A[2] - B[2]
      return x * x + y * y + z * z > t2
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const c = cells[i]
        if (!c || c === v) continue
        for (const j of [x < w - 1 ? i + 1 : -1, y < h - 1 ? i + w : -1]) {
          if (j < 0) continue
          const d = cells[j]
          if (!d || d === v || d === c || !far(c, d)) continue
          mark[lums[c - 1] >= lums[d - 1] ? i : j] = 1
        }
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (cells[i]) continue
      if ((x > 0 && cells[i - 1]) || (x < w - 1 && cells[i + 1]) || (y > 0 && cells[i - w]) || (y < h - 1 && cells[i + w])) mark[i] = 1
    }
  }
  for (let i = 0; i < n; i++) if (mark[i]) cells[i] = v
}

// Mirrors finished cells in place.
export function mirrorCells(cells, w, h, mode) {
  const src = cells.slice()
  const at = (x, y) => src[y * w + x]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sx = x
      let sy = y
      if (mode === 'lr' || mode === 'quad') sx = x < w / 2 ? x : w - 1 - x
      if (mode === 'tb' || mode === 'quad') sy = y < h / 2 ? y : h - 1 - y
      if (mode === 'kaleido') {
        // Eightfold: fold the offset from the centre into the wedge between the horizontal
        // axis and the diagonal, on the right; always inside the frame.
        const cx = w / 2
        const cy = h / 2
        let a = Math.abs(x + 0.5 - cx)
        let b = Math.abs(y + 0.5 - cy)
        if (b > a) [a, b] = [b, a]
        sx = Math.min(w - 1, Math.floor(cx + a))
        sy = Math.min(h - 1, Math.floor(cy + b))
      }
      cells[y * w + x] = at(sx, sy)
    }
  }
}

// Only the colours in use, darkest first (Rec. 709, the encoder's order), and the cells renumbered.
function finish(frames, table, w, h) {
  const used = new Uint8Array(table.length + 1)
  for (const c of frames) for (let i = 0; i < c.length; i++) used[c[i]] = 1
  const keep = []
  for (let v = 1; v <= table.length; v++) if (used[v]) keep.push(v)
  // Equal colours (a ground equal to an ink, say) share one slot.
  const lumOf = v => lum709(...hexToRgb(table[v - 1]))
  keep.sort((a, b) => lumOf(a) - lumOf(b) || a - b)
  const colors = []
  const remap = new Uint16Array(table.length + 1)
  for (const v of keep) {
    const hx = table[v - 1]
    let j = colors.indexOf(hx)
    if (j < 0) j = colors.push(hx) - 1
    remap[v] = j + 1
  }
  for (const c of frames) for (let i = 0; i < c.length; i++) c[i] = remap[c[i]]
  return { frames, colors, w, h }
}

/* ---------- Previews ---------- */

// Cells as RGBA pixels, each cell scale x scale (nearest). Empty cells are transparent, or the
// `bg` colour when given.
export function renderCells(cells, colors, w = 320, h = 200, scale = 1, bg = null) {
  const s = Math.max(1, scale | 0)
  const W = w * s
  const H = h * s
  const data = new Uint8ClampedArray(W * H * 4)
  const rgb = colors.map(hexToRgb)
  const back = bg ? hexToRgb(bg) : null
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = cells[y * w + x]
      const c = v ? rgb[v - 1] : back
      if (!c) continue
      for (let yy = 0; yy < s; yy++) {
        let o = ((y * s + yy) * W + x * s) * 4
        for (let xx = 0; xx < s; xx++, o += 4) {
          data[o] = c[0]
          data[o + 1] = c[1]
          data[o + 2] = c[2]
          data[o + 3] = 255
        }
      }
    }
  }
  return { w: W, h: H, data }
}
