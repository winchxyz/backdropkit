// Builds Deep Reef: a pixel-art view from under the water, as one animated SVG the Claude
// desktop app can play as a backdrop. node build.mjs  ->  out/deep-reef.svg
//
// Same pipeline as Sunfield (../../../sunfield/tools/build.mjs): a 320 x 200 cell grid (x right,
// y down), cells written as stroke runs of at most 64 per path, big still layers in <pattern>s,
// each part in a nested viewport pinned to its corner, all motion in CSS steps() on a shared
// 0.05 s clock, a reduced-motion rule that stops it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Layer, bayer, bounds, clamp, emitCells, hex, lerp, rgb, rng, smooth, tone } from '../../../sunfield/tools/pixel.mjs'
import { line } from '../../../sunfield/tools/painters.mjs'
import { emitSafe } from './encode.mjs' // the engine's encoder plus 'lift' and a row cap (see encode.mjs)

const HERE = path.dirname(fileURLToPath(import.meta.url))
const W = 320
const H = 200
const f1 = v => Math.round(v * 10) / 10
const f2 = v => Math.round(v * 100) / 100
const f3 = v => Math.round(v * 1000) / 1000

// ---------------------------------------------------------------- helpers

const mix = (a, b, t) => {
  const A = rgb(a)
  const B = rgb(b)
  return hex([lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)])
}

function norm(v) {
  const l = Math.hypot(...v)
  return v.map(c => c / l)
}

function hash(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// Smooth value noise in 0..1.
function noise(x, y, s = 0) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = x - xi
  const fy = y - yi
  const u = fx * fx * (3 - 2 * fx)
  const v = fy * fy * (3 - 2 * fy)
  return lerp(lerp(hash(xi, yi, s), hash(xi + 1, yi, s), u), lerp(hash(xi, yi + 1, s), hash(xi + 1, yi + 1, s), u), v)
}

// Distance to the nearest of points scattered one to a g x g square (cellular noise).
function worley(x, y, g, s) {
  const gx = Math.floor(x / g)
  const gy = Math.floor(y / g)
  let best = Infinity
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = gx + i
      const cy = gy + j
      best = Math.min(best, Math.hypot(x - (cx + hash(cx, cy, s)) * g, y - (cy + hash(cx, cy, s + 1)) * g))
    }
  }
  return best
}

// The gap between the nearest and second nearest of points scattered one to a gx x gy cell,
// repeating every nx cells across and ny down: small along the lines of a net.
function net(u, v, gx, gy, nx, ny, s) {
  const cx = Math.floor(u / gx)
  const cy = Math.floor(v / gy)
  let f1 = Infinity
  let f2 = Infinity
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const ix = cx + i
      const iy = cy + j
      const wx = ((ix % nx) + nx) % nx
      const wy = ny ? ((iy % ny) + ny) % ny : iy
      const d = Math.hypot(u - (ix + 0.15 + 0.7 * hash(wx, wy, s)) * gx, v - (iy + 0.15 + 0.7 * hash(wx, wy, s + 1)) * gy)
      if (d < f1) {
        f2 = f1
        f1 = d
      } else if (d < f2) f2 = d
    }
  }
  return f2 - f1
}

// The cells of a layer as [x, y, colour].
function* cells(L) {
  for (const [k, c] of L.m) yield [(k % 4096) - 1000, Math.floor(k / 4096) - 1000, c]
}

// SZ=1 prints what a layer costs as paths.
const sz = (L, what) => { if (process.env.SZ) console.log('  ' + (what ?? L.name), emitSafe(L).length); return L }

function merge(dst, src) {
  for (const [k, c] of src.m) dst.m.set(k, c)
  return dst
}

// Light from above: cells with nothing over them take the rim colour.
function rim(L, top, test = null) {
  const set = []
  for (const [x, y] of cells(L)) if (!L.has(x, y - 1) && (!test || test(x, y))) set.push([x, y])
  for (const [x, y] of set) L.set(x, y, top)
  return L
}

// Recolours cells of one palette into the same step of another where `test` holds.
function recolor(L, from, to, test) {
  for (const [x, y, c] of cells(L)) {
    const i = from.indexOf(c)
    if (i >= 0 && test(x, y)) L.set(x, y, to[Math.round((i / (from.length - 1)) * (to.length - 1))])
  }
  return L
}

// The highest cell of each column.
function tops(L) {
  const t = new Map()
  for (const [x, y] of cells(L)) if (!t.has(x) || y < t.get(x)) t.set(x, y)
  return t
}

// ---------------------------------------------------------------- water

// Down the water, bright under the surface to deep blue at the floor (scene rows).
const WATER = [
  [-40, '#8eeeea'],
  [12, '#7ae4e4'],
  [26, '#5ccede'],
  [42, '#40b6d4'],
  [62, '#2b9cc8'],
  [86, '#1f84ba'],
  [110, '#186ea8'],
  [135, '#135a96'],
  [160, '#104984'],
  [185, '#0e3c74'],
  [210, '#0d3268'],
  [240, '#0c2a5c'],
]

function waterAt(y) {
  for (let i = 0; i < WATER.length - 1; i++) {
    const [ya, ca] = WATER[i]
    const [yb, cb] = WATER[i + 1]
    if (y <= yb) return mix(ca, cb, clamp((y - ya) / (yb - ya), 0, 1))
  }
  return WATER[WATER.length - 1][1]
}

// A palette sunk into the water at row y by f (0 none, 1 all water).
const fog = (pal, f, y) => pal.map(c => mix(c, waterAt(y), f))

// ---------------------------------------------------------------- output pieces

const defs = []
let ids = 0
// Pattern ids are lower-case letters; every other id is upper-case.
const nextId = () => {
  let n = ids++
  let s = ''
  do {
    s = String.fromCharCode(97 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}
const PATTERN_MIN = 55
const stats = { patterns: 0, patternRuns: 0, plainRuns: 0, big: [] }

// A layer's cells: plain paths when small, a rect filled with a pattern of them when big
// (a pattern keeps its raster between frames, so the player redraws it for free).
// Colours of one layer that differ by MERGE levels or less (mean of the channels) become the
// commoner of them: no eye tells them apart, and every colour less is a path less and a seam
// less to cover.
const MERGE = Number(process.env.MERGE ?? 6)
function mergeNear(L) {
  if (!MERGE) return L
  const count = new Map()
  for (const c of L.m.values()) count.set(c, (count.get(c) ?? 0) + 1)
  const apart = (p, q) => {
    const a = rgb(p)
    const b = rgb(q)
    return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3
  }
  const kept = []
  const to = new Map()
  for (const c of [...count.keys()].sort((a, b) => count.get(b) - count.get(a))) {
    const k = kept.find(q => apart(c, q) <= MERGE)
    if (k) to.set(c, k)
    else kept.push(c)
  }
  if (to.size) for (const [k, c] of L.m) if (to.has(c)) L.m.set(k, to.get(c))
  return L
}

function draw(L) {
  mergeNear(L)
  const plain = emitSafe(L, L.T ? { T: L.T } : {})
  const runs = (plain.match(/[hv]-?\d/g) ?? []).length
  if (runs < PATTERN_MIN) {
    stats.plainRuns += runs
    return plain
  }
  stats.patterns++
  stats.patternRuns += runs
  // A clear cell on each side: the tile repeats, and where its edge falls inside a screen pixel
  // the far edge would bleed in there as a line.
  const b = bounds(L)
  const id = nextId()
  const pat = '<pattern id="' + id + '" width="1" height="1">' + emitSafe(L, { ox: b.x0 - 1, oy: b.y0 - 1.5, ...(L.T ? { T: L.T } : {}) }) + '</pattern>'
  stats.big.push(L.name + ':' + pat.length)
  defs.push(pat)
  const rect = '<rect x="' + (b.x0 - 1) + '" y="' + (b.y0 - 1.5) + '" width="' + (b.x1 - b.x0 + 2) + '" height="' + (b.y1 - b.y0 + 2) + '" fill="url(#' + id + ')"/>'
  return L.twice ? twice(rect) : rect
}

// A layer repeated as a tile of tw x th cells from (0, y0), filling the box x, y, w, h (cells).
// The tile's cells must lie in 0..tw-1, y0..y0+th-1.
function tiled(L, tw, th, y0, box, opts = {}) {
  const id = nextId()
  defs.push(
    '<pattern id="' + id + '" patternUnits="userSpaceOnUse" y="' + (y0 - 0.5) + '" width="' + tw + '" height="' + th + '">' + emitSafe(L, { oy: y0 - 0.5, ...opts }) + '</pattern>',
  )
  return '<rect x="' + box[0] + '" y="' + box[1] + '" width="' + box[2] + '" height="' + box[3] + '" fill="url(#' + id + ')"/>'
}

const anim = (cls, style, extra = '') => ({ cls, style, extra })

// An element drawn twice over itself: see the caustics below.
const twice = el => el + el

// Cells that a still layer above them in the same part always covers are dropped, except under
// that layer's edge. There the lower layer keeps a cell in the colour of its own visible cell
// just outside the edge (or none, if it has none there), so where the edge falls inside a
// screen pixel it blends with exactly what shows beside it, not with what lies below both.
function cull(layers) {
  const covered = new Set()
  const NB = [-1, 1, -4096, 4096]
  for (let i = layers.length - 1; i >= 0; i--) {
    const L = layers[i]
    if (L.wrap || L.anim || L.raw !== undefined) continue
    const set = []
    const drop = []
    for (const k of L.m.keys()) {
      if (!covered.has(k)) continue
      const out = NB.map(d => k + d).find(n => !covered.has(n) && L.m.has(n))
      if (out === undefined) drop.push(k)
      else set.push([k, L.m.get(out)])
    }
    for (const k of L.m.keys()) covered.add(k)
    for (const k of drop) L.m.delete(k)
    for (const [k, c] of set) L.m.set(k, c)
  }
}

function renderLayers(layers) {
  let out = ''
  let still = null
  const flush = () => {
    if (still) out += draw(still)
    still = null
  }
  for (const L of layers) {
    if (L.raw !== undefined) {
      flush()
      out += L.raw
      continue
    }
    if (L.wrap) {
      flush()
      out += L.wrap + renderLayers(L.layers) + L.end
      continue
    }
    if (!L.size) continue
    if (!L.anim) {
      // Still cells outside the grid never show in any window: every viewport is sliced.
      still ??= Object.assign(new Layer(L.name), { twice: L.twice })
      for (const [x, y, c] of cells(L)) if (x >= 0 && x < W && y >= 0 && y < H) still.set(x, y, c)
      continue
    }
    flush()
    out += '<g class="' + L.anim.cls + '"' + (L.anim.style ? ' style="' + L.anim.style + '"' : '') + L.anim.extra + '>' + draw(L) + '</g>'
  }
  flush()
  return out
}

const parts = [] // { cls (the corner it is pinned to), layers } in paint order
const part = (cls, layers) => parts.push({ cls, layers })

// ---------------------------------------------------------------- the water itself

// Bands of colour down the water, each dithered into the next over its last rows with dashed
// strokes (a dash of 1 and a gap of 3 is a quarter of the cells), all in one pattern tile.
const BANDS = [-40, -16, 0, 10, 18, 26, 34, 42, 51, 60, 70, 80, 91, 102, 114, 126, 138, 150, 163, 176, 190, 205, 240]
function water() {
  // The tile's corner sits on a cell corner (the top of row -40), and it reaches only 8 cells
  // past each side: the part is sliced, so x outside 0..320 never shows. At 1,120 cells wide it
  // was drawn as a bitmap too big to keep, scaled, and every dither cell came out soft-edged
  // (rings at 6 px a cell, blur at 8 and 9). The 8 keeps the dashes' phase (a multiple of 4).
  const OY = 40.5
  const WX = 8
  const WW = 2 * WX + 320
  const col = BANDS.slice(0, -1).map((y, i) => waterAt((y + BANDS[i + 1]) / 2))
  let solid = ''
  const dash = { '1 3': '', '1 1': '', '3 1': '' }
  for (let i = 0; i < col.length; i++) {
    const y0 = BANDS[i]
    const h = BANDS[i + 1] - y0
    solid += '<path stroke="' + col[i] + '" stroke-width="' + (h + 1) + '" d="M0 ' + (y0 + OY + (h - 1) / 2) + 'h' + WW + '"/>'
    if (i + 1 < col.length) {
      const c = col[i + 1]
      const r = BANDS[i + 1] - 4 + OY
      dash['1 3'] += '<path stroke="' + c + '" d="M0 ' + r + 'h' + WW + 'M2 ' + (r + 1) + 'h' + WW + '"/>'
      dash['1 1'] += '<path stroke="' + c + '" d="M1 ' + (r + 2) + 'h' + WW + '"/>'
      dash['3 1'] += '<path stroke="' + c + '" d="M2 ' + (r + 3) + 'h' + WW + '"/>'
    }
  }
  let tile = solid
  for (const [k, v] of Object.entries(dash)) tile += '<g stroke-dasharray="' + k + '">' + v + '</g>'
  defs.push('<pattern id="Wt" width="1" height="1">' + tile + '</pattern>')
  return '<rect x="' + -WX + '" y="' + -OY + '" width="' + WW + '" height="282" fill="url(#Wt)"/>'
}

// ---------------------------------------------------------------- the surface

// The underside of the surface, seen from below: bright overhead, paler toward the far edge,
// crossed by wavy crests of light that crowd together and shorten as the surface recedes;
// the edge itself uneven. Two tiles 64 cells wide drift sideways at different speeds, the
// nearer one faster. Every wave fits the tile a whole number of times.
const SURF = ['#2fa8c8', '#4cc4da', '#74dce6', '#a4eef0', '#d4fbf6', '#f4fffc']
function surface() {
  const TW = 64
  const K = n => (2 * Math.PI * n) / TW
  const near = new Layer('surfNear')
  const far = new Layer('surfFar')
  const edge = x => 13 + Math.round(1.1 * Math.sin(K(4) * x) + 0.9 * Math.sin(K(2) * x + 1.3))
  // y, amplitude, waves across the tile, phase
  const crests = [
    [1.2, 1.3, 1, 0],
    [4, 1.1, 2, 2],
    [6.5, 0.9, 3, 4],
    [8.6, 0.75, 4, 1],
    [10.4, 0.6, 5, 3],
    [11.9, 0.45, 7, 5],
  ]
  for (let y = 0; y <= 16; y++) {
    for (let x = 0; x < TW; x++) {
      const e = edge(x)
      if (y > e) continue
      let b = 0.44 - 0.018 * y
      for (const [y0, a, n, p] of crests) {
        const yl = y0 + a * Math.sin(K(n) * x + p) + a * 0.45 * Math.sin(K(2 * n + 1) * x + p * 2)
        const d = y + 0.5 - yl
        const broken = Math.sin(K(n + 2) * x + p * 3) < -0.45
        // White only on the crest lines nearest the window; deeper ones stay pale cyan.
        if (Math.abs(d) < 0.5 && !broken) b = y0 < 7 ? 0.97 : 0.8
        else if (d > 0.5 && d < 1.5 && !broken) b = Math.max(b, 0.62)
      }
      if (y === e) b = 0.22
      ;(y < 6 ? near : far).set(x, y, tone(SURF, b, x, y, 0.12))
    }
  }
  // The far tile runs one row under the near one (a copy of its own top row), so where their
  // edges meet inside a screen pixel the two surfaces blend, not the water behind them.
  for (let x = 0; x < TW; x++) far.set(x, 5, far.get(x, 6))
  // Each tile keeps a clear row above and below: a tile's bitmap wraps, and a filled edge row
  // would bleed into the opposite edge as a line.
  const box = (y0, h) => [-64, y0 - 0.5, 448, h]
  return {
    // The near tile's bottom row is its edge over the far tile: what the near tile lays under that
    // row (its backing) showed there between two white crests, so it is lifted off the edge.
    near: tiled(near, TW, 8, -1, box(-1, 8), { lift: { row: 5, by: 0.25 } }),
    far: tiled(far, TW, 13, 4, box(4, 13)),
  }
}

// The bright window overhead where the sun comes through.
function sunGlow() {
  const L = new Layer('glow')
  const cx = 104
  for (let y = 0; y < 9; y++) {
    for (let x = cx - 40; x < cx + 40; x++) {
      const d = Math.hypot((x + 0.5 - cx) / 34, (y + 0.5) / 7.5)
      if (d >= 1) continue
      const v = 1 - d
      if (v + bayer(x, y) * 0.5 > 0.42) L.set(x, y, v > 0.62 ? '#ffffff' : '#e8fffb')
    }
  }
  return L
}

// ---------------------------------------------------------------- light rays

// Shafts from the window overhead, fanning down and fading with depth in steps.
const RAYS = [
  // top centre, slope (cells across per row), top width, widening per row, cycle s
  { x: 64, s: -0.2, w: 7, g: 0.05, d: 13 },
  { x: 86, s: -0.08, w: 12, g: 0.07, d: 17 },
  { x: 104, s: 0.04, w: 6, g: 0.04, d: 11 },
  { x: 118, s: 0.14, w: 14, g: 0.08, d: 19 },
  { x: 138, s: 0.27, w: 8, g: 0.05, d: 15 },
  { x: 160, s: 0.42, w: 10, g: 0.06, d: 21 },
  { x: 182, s: 0.58, w: 6, g: 0.04, d: 14 },
]
// A staircase outline of rows y0..y1, row y spanning xl(y)..xr(y), in relative steps.
function stair(y0, y1, xl, xr) {
  let d = 'M' + xl(y0) + ' ' + (y0 - 0.5) + 'h' + (xr(y0) - xl(y0))
  let cur = xr(y0)
  let run = 0
  for (let y = y0; y <= y1; y++) {
    run++
    const nx = y < y1 ? xr(y + 1) : null
    if (nx !== cur) {
      d += 'v' + run
      run = 0
      if (nx !== null) {
        d += 'h' + (nx - cur)
        cur = nx
      }
    }
  }
  d += 'h' + (xl(y1) - cur)
  cur = xl(y1)
  run = 0
  for (let y = y1; y >= y0; y--) {
    run++
    const nx = y > y0 ? xl(y - 1) : null
    if (nx !== cur) {
      if (nx === null) break
      d += 'v-' + run
      run = 0
      d += 'h' + (nx - cur)
      cur = nx
    }
  }
  return d + 'z'
}

function rays() {
  const Y0 = 4
  const Y1 = 178
  // The fill fades in steps of whole rows: two stops at each step.
  const levels = Array.from({ length: 15 }, (_, i) => f3(0.015 + 0.285 * (1 - i / 14) ** 1.6))
  let stops = ''
  const span = Y1 - Y0 + 1
  levels.forEach((a, i) => {
    const o0 = f2(i / levels.length)
    const o1 = f2((i + 1) / levels.length)
    stops += '<stop offset="' + o0 + '" stop-color="#d8fff6" stop-opacity="' + a + '"/><stop offset="' + o1 + '" stop-color="#d8fff6" stop-opacity="' + a + '"/>'
  })
  defs.push('<linearGradient id="R" gradientUnits="userSpaceOnUse" x1="0" y1="' + (Y0 - 0.5) + '" x2="0" y2="' + (Y0 - 0.5 + span) + '">' + stops + '</linearGradient>')
  let out = '<g fill="url(#R)">'
  RAYS.forEach((r, i) => {
    const c = y => r.x + r.s * y
    const core = stairs(Y0, Y1, y => Math.round(c(y) - r.w / 2 - r.g * y), y => Math.round(c(y) + r.w / 2 + r.g * y))
    const soft = stairs(Y0, Y1, y => Math.round(c(y) - r.w / 2 - r.g * y - 2 - 0.03 * y), y => Math.round(c(y) + r.w / 2 + r.g * y + 2 + 0.03 * y))
    out += '<g class="ry" style="--d:' + r.d + 's;--l:' + f1(-((i * 3.7) % r.d)) + 's">' + soft + core + '</g>'
  })
  return out + '</g>'
}
// Rows y0..y1 of a staircase as paths of at most 64 runs each.
function stairs(y0, y1, xl, xr) {
  const d = stair(y0, y1, xl, xr)
  if (y0 === y1 || (d.match(/[hv]/g) ?? []).length <= 64) return '<path d="' + d + '"/>'
  const m = (y0 + y1) >> 1
  return stairs(y0, m, xl, xr) + stairs(m + 1, y1, xl, xr)
}

// ---------------------------------------------------------------- painters

// Bodies made of spheres, lit from above and a little to the left. `warp` bends the outline
// with noise so they read as rock, not balls.
function paintBlobs(L, blobs, o) {
  const lv = norm(o.light ?? [-0.35, -0.85, 0.45])
  const seed = o.seed ?? 0
  const warp = o.warp ?? 0
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const b of blobs) {
    x0 = Math.min(x0, b.x - b.r - warp)
    x1 = Math.max(x1, b.x + b.r + warp)
    y0 = Math.min(y0, b.y - b.r / (b.sy ?? 1) - warp)
    y1 = Math.max(y1, b.y + b.r / (b.sy ?? 1) + warp)
  }
  const floor = o.floor ?? y1
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
      if (y + 0.5 > floor) continue
      const px = x + 0.5 + (warp ? warp * (noise(x * 0.13, y * 0.13, seed) - 0.5) : 0)
      const py = y + 0.5 + (warp ? warp * (noise(x * 0.13, y * 0.13, seed + 9) - 0.5) : 0)
      let best = null
      let bz = -Infinity
      let z2 = -Infinity
      for (const b of blobs) {
        const sy = b.sy ?? 1
        const dx = px - b.x
        const dy = (py - b.y) * sy
        const d2 = dx * dx + dy * dy
        if (d2 >= b.r * b.r) continue
        const nz = Math.sqrt(b.r * b.r - d2)
        const z = nz + (b.z ?? 0)
        if (z > bz) {
          z2 = bz
          bz = z
          best = { b, dx, dy, nz }
        } else if (z > z2) z2 = z
      }
      if (!best) continue
      const { b, dx, dy, nz } = best
      const n = [dx / b.r, dy / b.r, nz / b.r]
      let v = (o.amb ?? 0.42) + (o.diff ?? 0.55) * (n[0] * lv[0] + n[1] * lv[1] + n[2] * lv[2])
      v -= (o.edge ?? 0.15) * Math.pow(1 - n[2], 2)
      if (bz - z2 < (o.crease ?? 1.4) && dy > -b.r * 0.2) v -= o.creaseDark ?? 0.15
      if (o.tex) v += o.tex(x, y, n)
      if (o.shadeH) v -= (o.floorShade ?? 0.3) * smooth((y + 0.5 - (floor - o.shadeH)) / o.shadeH)
      L.set(x, y, tone(o.tones, v, x, y, o.dither ?? 0.3))
    }
  }
  return L
}

// Lumps and pits lit from the upper left: the difference of a noise height across a diagonal.
const emboss = (s, k = 1.4, f = 0.22) => (x, y) => {
  const h = (a, b) => noise(a * f, b * f * 1.15, s) + 0.5 * noise(a * f * 2.3, b * f * 2.5, s + 1)
  return k * (h(x, y) - h(x - 1, y - 1))
}

// Staghorn coral: branches that fork upward, lit on the left, pale at the tips.
function branchCoral(L, rand, o) {
  const stamps = []
  const max = o.depth ?? 4
  function br(x, y, a, len, w, depth) {
    const n = Math.max(1, Math.ceil(len * 1.5))
    for (let i = 0; i <= n; i++) {
      const t = i / n
      stamps.push({ x: x + Math.cos(a) * len * t, y: y + Math.sin(a) * len * t, r: w / 2, t: (depth + t) / (max + 1), tip: depth === max && t > 0.7 })
    }
    if (depth >= max) return
    const ex = x + Math.cos(a) * len
    const ey = y + Math.sin(a) * len
    const k = rand() < 0.35 ? 3 : 2
    for (let j = 0; j < k; j++) {
      const spread = (j - (k - 1) / 2) * (o.spread ?? 0.75) + (rand() - 0.5) * 0.3
      const na = lerp(a + spread, -Math.PI / 2, o.up ?? 0.3)
      br(ex, ey, na, len * (0.68 + rand() * 0.2), Math.max(1, w * 0.78), depth + 1)
    }
  }
  br(o.x, o.y, -Math.PI / 2 + (o.tilt ?? 0), o.len, o.w, 0)
  for (const s of stamps) {
    const r = Math.max(s.r, 0.5)
    for (let y = Math.floor(s.y - r - 1); y <= Math.ceil(s.y + r); y++) {
      for (let x = Math.floor(s.x - r - 1); x <= Math.ceil(s.x + r); x++) {
        const dx = x + 0.5 - s.x
        const dy = y + 0.5 - s.y
        if (dx * dx + dy * dy > r * r + 0.25) continue
        const side = clamp(dx / r, -1, 1)
        const v = s.tip ? 0.95 : 0.35 + 0.35 * s.t - 0.28 * side
        L.set(x, y, tone(o.tones, v, x, y, 0.25))
      }
    }
  }
  return L
}

// A sea fan: a fine net spread in a fan, over it the branches that carry it.
function seaFan(L, rand, o) {
  const net = new Layer('net')
  const brs = new Layer('branches')
  const sy = o.sy ?? 1
  const reach = a => o.R * (0.8 + 0.2 * noise(a * 2.5 + 3, 0.5, o.seed ?? 1))
  const inside = (x, y) => {
    const dx = x + 0.5 - o.x
    const dy = (y + 0.5 - o.y) * sy
    const a = Math.atan2(dx, -dy) - (o.tilt ?? 0)
    const d = Math.hypot(dx, dy)
    return Math.abs(a) < o.spread * (1 - 0.15 * (d / o.R) ** 2) * (d < 4 ? d / 4 : 1) + 0.02 && d < reach(a) ? d / o.R : -1
  }
  for (let y = Math.floor(o.y - o.R / sy - 2); y <= o.y; y++) {
    for (let x = Math.floor(o.x - o.R - 2); x <= o.x + o.R + 2; x++) {
      const t = inside(x, y)
      if (t < 0) continue
      // A lace pierced by small round holes, scattered.
      if (worley(x + 0.5, y + 0.5, o.mesh ?? 3.2, o.seed ?? 1) > 0.95) net.set(x, y, tone(o.tones, 0.18 + 0.32 * t, x, y, 0.06))
    }
  }
  const segs = []
  function br(x, y, a, len, depth) {
    const ex = x + Math.sin(a) * len
    const ey = y - (Math.cos(a) * len) / sy
    segs.push([x, y, ex, ey, depth])
    if (depth >= o.depth) return
    for (const s of [-1, 1]) {
      if (depth > 2 && rand() < 0.3) continue
      const na = clamp(a + s * (0.18 + rand() * 0.22), (o.tilt ?? 0) - o.spread, (o.tilt ?? 0) + o.spread)
      br(ex, ey, na, len * (0.78 + rand() * 0.18), depth + 1)
    }
  }
  br(o.x, o.y, o.tilt ?? 0, o.len, 0)
  for (const [x0, y0, x1, y1, depth] of segs) {
    for (const [x, y] of line(x0, y0, x1, y1)) {
      const t = inside(x, y)
      if (t < 0 && depth > 0) continue
      const v = 0.5 + 0.35 * Math.max(t, 0)
      brs.set(x, y, tone(o.tones, v, x, y, 0.08))
      if (depth < 2) brs.set(x + 1, y, tone(o.tones, v - 0.2, x + 1, y, 0.08))
    }
  }
  merge(L, net)
  merge(L, brs)
  return L
}

// A tube sponge: an upright cylinder with a dark mouth, lit on the left.
function tube(L, o) {
  const r = o.w / 2
  for (let y = o.y - o.h; y <= o.y; y++) {
    for (let x = Math.floor(o.x - r); x < o.x + r; x++) {
      const u = (x + 0.5 - o.x) / r
      if (Math.abs(u) > 1) continue
      let v = 0.62 - 0.38 * u - 0.15 * u * u
      const top = y - (o.y - o.h)
      if (top < 2 && Math.abs(u) < 0.62) v = top === 0 ? 0.05 : 0.18 // the mouth
      else if (top === 0) v += 0.25
      v -= 0.2 * smooth((y - (o.y - 4)) / 4)
      L.set(x, y, tone(o.tones, v, x, y, 0.3))
    }
  }
  return L
}

// An anemone: a mound of short tentacles, pale at the tips.
function anemone(L, rand, o) {
  const n = o.n ?? 26
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const a = -Math.PI + 0.25 + t * (Math.PI - 0.5) + (rand() - 0.5) * 0.15
    const len = o.len * (0.65 + 0.5 * Math.sin(t * Math.PI)) * (0.85 + rand() * 0.3)
    const bend = (rand() - 0.5) * 0.8
    let px = o.x + (t - 0.5) * o.w
    let py = o.y
    for (let s = 0; s < len; s++) {
      const q = s / len
      px += Math.cos(a + bend * q) * 0.9
      py += Math.sin(a + bend * q) * 0.9
      const v = q > 0.8 ? 0.95 : 0.35 + 0.45 * q - 0.12 * Math.cos(a)
      L.set(px, py, tone(o.tones, v, Math.floor(px), Math.floor(py), 0.2))
    }
  }
  return L
}

// Sea grass: thin blades bending with the current.
function grass(L, rand, o) {
  for (let i = 0; i < o.n; i++) {
    const x = o.x + (rand() - 0.5) * o.w
    const h = o.h * (0.5 + rand() * 0.6)
    const bend = (0.2 + rand() * 0.5) * (o.lean ?? 1)
    for (let s = 0; s < h; s++) {
      const q = s / h
      const px = x + bend * q * q * h * 0.5
      L.set(px, o.y - s, tone(o.tones, 0.3 + 0.55 * q, Math.floor(px), o.y - s, 0.3))
    }
  }
  return L
}

// A ribbon of kelp from (x, y): it leaves at angle a from upright (+ to the right), lifts
// toward upright, and its tip curls by `curl`. Lit on its left, with a pale vein.
function ribbon(L, o) {
  const mask = new Map()
  let px = o.x
  let py = o.y
  const step = 0.45
  for (let s = 0; s <= o.len; s += step) {
    const q = s / o.len
    const h = o.a * (1 - 0.55 * q) + (o.curl ?? 0) * q * q
    px += Math.sin(h) * step
    py -= Math.cos(h) * step
    const hw = o.w * (q < 0.25 ? Math.sqrt(q / 0.25) : Math.pow((1 - q) / 0.75, 0.7)) * (1 + 0.18 * Math.sin(q * 22))
    const nx = Math.cos(h)
    const ny = Math.sin(h)
    for (let k = -hw; k <= hw + 0.01; k += 0.35) {
      const key = Math.floor(px + nx * k) + ',' + Math.floor(py + ny * k)
      if (!mask.has(key)) mask.set(key, { side: hw > 0.4 ? k / hw : 0, q })
    }
    const key = Math.floor(px) + ',' + Math.floor(py)
    if (!mask.has(key)) mask.set(key, { side: 0, q })
  }
  for (const [k, m] of mask) {
    const [x, y] = k.split(',').map(Number)
    let v = (o.shade ?? 0.5) + (m.side < -0.25 ? 0.16 : m.side > 0.45 ? -0.14 : 0) + 0.1 * m.q
    if (Math.abs(m.side) < 0.15 && m.q > 0.1 && m.q < 0.85) v += 0.1
    L.set(x, y, tone(o.tones, v, x, y, 0.08))
  }
  return L
}

// ---------------------------------------------------------------- palettes

const ROCK = ['#0e1230', '#151b3e', '#1c264a', '#243354', '#2e425e', '#3a5468', '#486870', '#5a7e7a', '#74988a']
const CORALLINE = ['#1c1636', '#2e1f48', '#45305c', '#5e406e', '#7a5482', '#986c94', '#b88aa8']
const BRAIN = ['#3a2a20', '#5c4626', '#82682e', '#a88a3a', '#c8aa4c', '#e2c868', '#f4e494']
const STAG = ['#341646', '#52226a', '#76368e', '#9a52ac', '#bc76c6', '#dca4de', '#f6d4f2']
const FAN = ['#3a0c2c', '#621640', '#922254', '#c23466', '#e6527a', '#ff8098', '#ffb8c4']
const TABLE = ['#0c2e3a', '#11484e', '#186660', '#248674', '#3ea888', '#68c8a0', '#a2e6c0']
const SPONGE = ['#3e1410', '#6a2414', '#9a3a18', '#c85a22', '#ec8030', '#ffaa52', '#ffd08a']
const VIOLET = ['#1e1446', '#30206a', '#463290', '#604ab0', '#7e68cc', '#a08ee0', '#c8b8f2']
const ANEM = ['#5a1a46', '#8a2e6a', '#b84c90', '#de72b2', '#fca2d2', '#ffd2ea']
const SAND = ['#1d4466', '#285676', '#346a84', '#467e8e', '#5c9496', '#78aa9e', '#98c0a8', '#bcd6b4', '#e0ecc4']
const BLUE = ['#0e1a4a', '#16296e', '#203c94', '#2e54b8', '#4472d4', '#6c96e8', '#a4c4f8']
const GREEN = ['#10301e', '#1a4826', '#28622c', '#3c7c30', '#58963a', '#7ab04a', '#a4cc64']
const KELP = ['#061418', '#0a1f22', '#0f2b2a', '#153a30', '#1d4a34', '#285c38', '#376e3a', '#4a823c', '#62983e']
const GRASS = ['#0e3a36', '#16503e', '#226846', '#348050', '#509a5a', '#78b46a']

// ---------------------------------------------------------------- distant planes

// A silhouette of reef in the haze: its top follows the highest of its peaks (steep sides,
// rounded crowns) with a ragged edge; the fill is flat with a lit rim and a darker foot.
// peaks: [x, top, half width]
function silhouette(L, peaks, o) {
  const pal = o.pal // dark, body, lit, rim
  const topAt = x => {
    let t = o.base
    for (const [px, py, w] of peaks) {
      const d = Math.abs(x + 0.5 - px) / w
      if (d < 1) t = Math.min(t, py + (o.base - py) * Math.pow(d, o.p ?? 2.6))
    }
    return Math.round(t + (o.rag ?? 2.5) * (noise(x * 0.21, 0, o.seed) - 0.5) + (o.rag ?? 2.5) * 0.5 * (noise(x * 0.6, 1, o.seed) - 0.5))
  }
  for (let x = o.x0; x < o.x1; x++) {
    const top = topAt(x)
    const lit = topAt(x - 1) > top
    for (let y = top; y < o.bottom; y++) {
      const d = y - top
      let c = pal[1]
      if (d === 0) c = pal[3]
      else if (d === 1 && lit) c = pal[2]
      else if (o.foot && y > o.foot && bayer(x, y) + 0.5 < (y - o.foot) / 6) c = pal[0]
      L.set(x, y, c)
    }
  }
  return topAt
}

// Spires far off in the blue, barely darker than the water.
function ghosts() {
  const L = new Layer('ghosts')
  const pal = [ROCK[3], ROCK[4], ROCK[6], ROCK[8]].map((c, i) => mix(c, waterAt(120), [0.86, 0.85, 0.8, 0.72][i]))
  silhouette(
    L,
    [
      [-4, 52, 22],
      [30, 82, 16],
      [196, 92, 13],
      [212, 70, 15],
      [300, 34, 20],
      [326, 60, 16],
      [150, 124, 18],
    ],
    { x0: 0, x1: 320, base: 168, bottom: 172, seed: 31, pal, rag: 3 },
  )
  return L
}

// The far reef: a low ridge across the floor with coral heads, hazy.
function farReef() {
  const L = new Layer('farReef')
  const pal = [ROCK[2], ROCK[3], ROCK[5], ROCK[7]].map((c, i) => mix(c, waterAt(150), [0.64, 0.62, 0.55, 0.45][i]))
  const ridgeTop = silhouette(
    L,
    [
      [44, 128, 30],
      [94, 146, 26],
      [150, 150, 30],
      [196, 142, 24],
      [238, 126, 26],
      [290, 138, 28],
    ],
    { x0: 0, x1: 320, base: 162, bottom: 184, seed: 32, pal, rag: 2.5, foot: 168 },
  )
  const ridge = x => ridgeTop(Math.round(x))
  const heads = new Layer('farHeads')
  for (const [x, w, P] of [
    [112, 6, STAG],
    [134, 4, FAN],
    [172, 7, BRAIN],
    [192, 5, TABLE],
    [212, 4, FAN],
  ]) {
    const y = Math.round(ridge(x))
    paintBlobs(heads, [{ x, y, r: w, sy: 1.3 }, { x: x + w * 0.7, y: y + 1, r: w * 0.6, sy: 1.3 }], {
      tones: fog(P.slice(1, 6), 0.68, 150),
      floor: y + 1,
      dither: 0.2,
    })
  }
  rim(heads, mix('#bff6ff', waterAt(150), 0.5))
  return merge(L, heads)
}

// ---------------------------------------------------------------- the near reef

// Reef rock: warped boulders, mostly in shade under the corals, patches of pink coralline crust,
// lit edges.
function reef(name, blobs, seed, f = 0.16) {
  const L = new Layer(name)
  const pal = fog(ROCK, f, 175)
  paintBlobs(L, blobs, { tones: pal, warp: 9, seed, amb: 0.32, diff: 0.5, dither: 0.1, crease: 2 })
  // Seated: every column runs down to the floor, in shadow below the boulders.
  const low = new Map()
  for (const [x, y] of cells(L)) if (!low.has(x) || y > low.get(x)) low.set(x, y)
  for (const [x, y] of low) for (let k = y + 1; k < 202; k++) L.set(x, k, pal[k - y < 3 ? 1 : 0])
  recolor(L, pal, fog(CORALLINE, f, 175), (x, y) => noise(x * 0.09, y * 0.12, seed + 3) > 0.64)
  rim(L, mix('#9ee6dc', pal[7], 0.3))
  return L
}

// Coral colonies.
const brainTex = s => (x, y) => (Math.sin(x * 1.1 + 2.2 * Math.sin(y * 0.8 + x * 0.25 + s)) > 0.45 ? -0.24 : 0.04)
function dome(L, x, y, r, pal, o = {}) {
  const D = paintBlobs(new Layer('dome'), [{ x, y, r, sy: o.sy ?? 1.25 }, ...(o.more ?? [])], {
    tones: pal,
    floor: y + (o.sink ?? 1),
    amb: o.amb ?? 0.45,
    tex: o.tex,
    dither: 0.15,
  })
  if (o.rim) rim(D, o.rim)
  return merge(L, D)
}
// Polyps: a mound speckled with pale dots.
const polyps = s => (x, y) => (hash(x, y, s) > 0.86 ? 0.28 : 0)
// Finger coral: short upright fingers in a clump, lit at the tips.
function fingers(L, rand, o) {
  for (let i = 0; i < o.n; i++) {
    const x = Math.round(o.x + (i - (o.n - 1) / 2) * 2 + (rand() - 0.5))
    const h = Math.round(o.h * (0.55 + 0.45 * Math.sin(((i + 0.5) / o.n) * Math.PI)) * (0.85 + rand() * 0.3))
    for (let k = 0; k < h; k++) {
      L.set(x, o.y - k, tone(o.tones, k === h - 1 ? 0.95 : 0.55 - 0.25 * (1 - k / h), x, o.y - k, 0.1))
      L.set(x + 1, o.y - k, tone(o.tones, k === h - 1 ? 0.7 : 0.3 - 0.2 * (1 - k / h), x + 1, o.y - k, 0.1))
    }
  }
  return L
}
// A giant clam: ridged shell halves gaping on a bright blue, spotted mantle.
function clam(L, x, y) {
  const SHELL = ['#4a5a6a', '#7a8a98', '#aebcc4', '#dde6e6']
  const MANTLE = ['#0a2e78', '#1660c8', '#22a2ec', '#86eaff']
  for (let i = -10; i <= 10; i++) {
    const h = Math.round(4.4 * Math.sqrt(1 - (i / 10.6) ** 2))
    const zz = ((i % 3) + 3) % 3
    const up = zz === 0 ? -2 : -1
    const lo = zz === 1 ? 2 : 1
    for (let j = -h; j <= h; j++) {
      let c
      if (j >= up && j <= lo) c = j === up || j === lo ? MANTLE[1] : hash(i, j, 3) > 0.72 ? MANTLE[3] : MANTLE[2]
      else c = SHELL[clamp(Math.round(2.4 - j * 0.45 - (zz === 2 ? 1 : 0) - Math.abs(i) * 0.06), 0, 3)]
      L.set(x + i, y + j, c)
    }
  }
  return L
}
// A leather coral: a wavy cap on a stalk.
function leather(L, x, y, o) {
  for (let k = 0; k < o.stalk; k++) for (let i = -1; i <= 1; i++) L.set(x + i, y - k, tone(o.tones, 0.45 - 0.15 * i, x + i, y - k, 0.1))
  dome(L, x, y - o.stalk - 1, o.r, o.tones, { sy: 2.4, amb: 0.5, rim: o.rim, tex: (a, b) => (Math.sin(a * 0.9) > 0.6 ? -0.15 : 0) })
  return L
}

function leftReef() {
  const r = rng(101)
  const back = []
  // A red sea fan standing behind the reef.
  const fan = seaFan(new Layer('lfan'), r, { x: 50, y: 152, R: 26, spread: 0.8, sy: 1.1, len: 7, depth: 6, tilt: -0.12, tones: fog(FAN, 0.2, 130), seed: 4 })
  rim(fan, fog(['#ffb8c4'], 0.2, 130)[0], (x, y) => !fan.has(x, y - 2) && !fan.has(x, y - 3))
  back.push(sz(fan, 'left fan'))
  const rock = reef(
    'lrock',
    [
      { x: -14, y: 150, r: 28, sy: 1.1 },
      { x: 20, y: 158, r: 20, sy: 1.25 },
      { x: 44, y: 172, r: 17, sy: 1.3 },
      { x: 70, y: 182, r: 15, sy: 1.35 },
      { x: 94, y: 192, r: 13, sy: 1.4 },
      { x: 114, y: 199, r: 9, sy: 1.4 },
      { x: 6, y: 128, r: 13, sy: 1.2 },
    ],
    3,
  )
  back.push(sz(rock, 'left rock'))
  const t = tops(rock)
  const top = x => t.get(Math.round(x)) ?? 200
  const C = new Layer('lcoral')
  // On the crest, back to front.
  branchCoral(C, r, { x: 8, y: top(8) + 3, len: 8, w: 3, depth: 3, tones: fog(STAG, 0.15, 150), spread: 0.8, up: 0.25 })
  for (const [x, h, w] of [
    [22, 16, 5],
    [28, 25, 6],
    [34, 13, 5],
  ])
    tube(C, { x, y: top(x) + 3, h, w, tones: fog(SPONGE, 0.12, 140) })
  dome(C, 41, top(41) + 3, 7, fog(GREEN, 0.1, 160), { tex: polyps(5), rim: '#d8ffa0' })
  dome(C, 62, top(62) + 6, 11, fog(BRAIN, 0.12, 160), { tex: brainTex(1), rim: '#fff2b0' })
  fingers(C, r, { x: 76, y: top(76) + 2, n: 4, h: 7, tones: fog(BRAIN, 0.05, 160) })
  anemone(C, r, { x: 87, y: top(87) + 2, w: 13, len: 7, tones: ANEM, n: 28 })
  dome(C, 99, top(99) + 3, 6, fog(BLUE, 0.08, 170), { tex: polyps(6), rim: '#c4dcff' })
  branchCoral(C, r, { x: 106, y: top(106) + 2, len: 7, w: 3, depth: 3, tones: fog(STAG, 0.1, 160), spread: 0.8, up: 0.25 })
  branchCoral(C, r, { x: 115, y: top(115) + 2, len: 5, w: 2.5, depth: 3, tones: fog(STAG, 0.1, 160), spread: 0.8, up: 0.25, tilt: 0.3 })
  // On the face below the crest.
  dome(C, 16, top(16) + 17, 8, VIOLET, { tex: polyps(7), rim: '#dcd0ff' })
  dome(C, 34, top(34) + 15, 10, TABLE, { sy: 3.2, amb: 0.5, rim: '#d4fff0', more: [{ x: 40, y: top(34) + 14, r: 6, sy: 3.4 }] })
  fingers(C, r, { x: 52, y: top(52) + 13, n: 5, h: 6, tones: SPONGE })
  dome(C, 70, top(70) + 12, 6, BRAIN, { tex: brainTex(3), rim: '#fff2b0' })
  dome(C, 90, top(90) + 9, 5, GREEN, { tex: polyps(9), rim: '#d8ffa0' })
  grass(C, r, { x: 26, y: top(26) + 22, w: 8, h: 7, n: 6, tones: GRASS })
  grass(C, r, { x: 82, y: top(82) + 14, w: 6, h: 6, n: 5, tones: GRASS })
  back.push(sz(C, 'left corals'))
  part('pBL', back)
  return { top }
}

function rightReef() {
  const r = rng(202)
  const layers = []
  // The big sea fan rising behind the reef, against the light.
  const fan = seaFan(new Layer('rfan'), r, { x: 262, y: 142, R: 60, spread: 0.85, sy: 1.15, len: 11, depth: 8, tilt: 0.06, tones: fog(FAN, 0.06, 120), seed: 7 })
  rim(fan, '#ffc8d0', (x, y) => !fan.has(x, y - 2) && !fan.has(x, y - 3))
  layers.push(sz(fan, 'right fan'))
  const rock = reef(
    'rrock',
    [
      { x: 338, y: 140, r: 32, sy: 1.1 },
      { x: 304, y: 152, r: 22, sy: 1.2 },
      { x: 280, y: 166, r: 18, sy: 1.3 },
      { x: 256, y: 178, r: 16, sy: 1.35 },
      { x: 232, y: 188, r: 14, sy: 1.4 },
      { x: 212, y: 197, r: 9, sy: 1.4 },
      { x: 318, y: 118, r: 12, sy: 1.2 },
    ],
    4,
  )
  layers.push(sz(rock, 'right rock'))
  const t = tops(rock)
  const top = x => t.get(Math.round(x)) ?? 200
  const C = new Layer('rcoral')
  // On the crest, back to front.
  for (const [x, h, w] of [
    [298, 20, 6],
    [306, 28, 7],
    [314, 16, 5],
  ])
    tube(C, { x, y: top(x) + 3, h, w, tones: VIOLET })
  fingers(C, r, { x: 219, y: top(219) + 2, n: 4, h: 6, tones: fog(SPONGE, 0.1, 170) })
  const tb = top(236)
  for (let y = tb - 6; y < tb + 2; y++) for (let x = 234; x < 238; x++) C.set(x, y, tone(TABLE, 0.3 - (x - 234) * 0.05, x, y, 0.2))
  dome(C, 236, tb - 8, 15, fog(TABLE, 0.1, 160), { sy: 3.4, amb: 0.5, rim: '#d4fff0', more: [{ x: 246, y: tb - 9, r: 9, sy: 3.6 }] })
  branchCoral(C, r, { x: 258, y: top(258) + 2, len: 8, w: 3, depth: 3, tones: STAG, spread: 0.8, up: 0.25, tilt: -0.2 })
  dome(C, 268, top(268) + 3, 6, fog(GREEN, 0.1, 160), { tex: polyps(8), rim: '#d8ffa0' })
  dome(C, 284, top(284) + 5, 10, fog(BRAIN, 0.1, 150), { sy: 1.2, tex: brainTex(2), rim: '#fff2b0' })
  leather(C, 296, top(296) + 2, { stalk: 3, r: 7, tones: fog(BRAIN.slice(1), 0.15, 160), rim: '#f4ec9c' })
  // On the face below the crest.
  clam(C, 248, top(248) + 9)
  dome(C, 228, top(228) + 10, 6, BLUE, { tex: polyps(10), rim: '#c4dcff' })
  dome(C, 274, top(274) + 13, 8, VIOLET, { tex: polyps(11), rim: '#dcd0ff' })
  fingers(C, r, { x: 298, y: top(298) + 15, n: 5, h: 7, tones: BRAIN })
  branchCoral(C, r, { x: 314, y: top(314) + 18, len: 6, w: 3, depth: 3, tones: FAN, spread: 0.8, up: 0.25, tilt: -0.3 })
  dome(C, 262, top(262) + 16, 5, SPONGE, { tex: polyps(12), rim: '#ffe0b0' })
  grass(C, r, { x: 240, y: top(240) + 16, w: 6, h: 7, n: 5, tones: GRASS, lean: 1 })
  grass(C, r, { x: 288, y: top(288) + 18, w: 8, h: 7, n: 6, tones: GRASS, lean: 1 })
  layers.push(sz(C, 'right corals'))
  part('pBR', layers)
  return { top }
}

// The sand between the reefs: hazy where it recedes, lighter where the rays fall, a few
// ripple crests. Hard, wavy bands, as pixel art does it.
function sand() {
  const L = new Layer('sand')
  const top = x => 179 + Math.round(1.6 * Math.sin(x * 0.045 + 1) + 1.1 * Math.sin(x * 0.13))
  const far = fog(SAND, 0.4, 176)
  const z1 = x => 3 + Math.round(1.2 * Math.sin(x * 0.07 + 2))
  const z2 = x => 8 + Math.round(1.5 * Math.sin(x * 0.05 + 4))
  const z3 = x => 15 + Math.round(2 * Math.sin(x * 0.04 + 1))
  for (let x = 0; x < 320; x++) {
    const t0 = top(x)
    for (let y = t0; y < 202; y++) {
      const d = y - t0
      let i = d < z1(x) ? 4 : d < z2(x) ? 5 : d < z3(x) ? 6 : 7
      // The pool of light under the rays.
      if (Math.hypot((x - 150) / 72, (y - 193) / 11) + 0.06 * Math.sin(x * 0.4) < 0.9) i++
      const rip = Math.sin(x * 0.09 + y * 1.05 + 2 * Math.sin(x * 0.035))
      if (rip > 0.975 && d > 2) i++
      else if (rip < -0.98 && d > 2) i--
      if (d === 0) i = 6
      L.set(x, y, d < z1(x) ? far[clamp(i, 0, 8)] : SAND[clamp(i, 0, 8)])
    }
  }
  return L
}

// ---------------------------------------------------------------- kelp

// A kelp stalk rising from the floor: a thin stipe and long ribbons on alternate sides, each with
// a float at its base. Painted into bands by height, so the higher ones can sway further.
function kelp(rand, o) {
  const bands = Array.from({ length: o.bands }, (_, i) => new Layer('kelp' + o.x + '_' + i))
  const h = o.bottom - o.top
  const cx = y => {
    const t = (o.bottom - y) / h
    return o.x + (o.lean ?? 0) * t * t * h + (o.amp ?? 2) * Math.sin(t * (o.freq ?? 5) + (o.phase ?? 0))
  }
  const band = y => clamp(Math.floor(((o.bottom - y) / h) * o.bands), 0, o.bands - 1)
  const pal = o.tones ?? KELP
  for (let y = o.top; y <= o.bottom; y++) bands[band(y)].set(Math.floor(cx(y)), y, pal[3])
  let side = rand() < 0.5 ? -1 : 1
  for (let y = o.bottom - 6; y > o.top + 2; y -= o.gap * (0.8 + rand() * 0.4)) {
    const t = (o.bottom - y) / h
    const B = bands[band(y)]
    const blade = new Layer('blade')
    const x = cx(y) + (side > 0 ? 1 : 0)
    ribbon(blade, {
      x,
      y,
      a: side * (0.45 + rand() * 0.35) + (o.drift ?? 0.12),
      len: lerp(o.len[0], o.len[1], t) * (0.8 + rand() * 0.4),
      w: lerp(o.w[0], o.w[1], t) * (0.9 + rand() * 0.2),
      curl: side * (0.3 + rand() * 0.4),
      shade: o.shade ?? 0.5,
      tones: pal,
    })
    rim(blade, o.rim ?? '#c2dc6a')
    merge(B, blade)
    // The float.
    B.set(x - (side > 0 ? 1 : 0), y - 1, pal[pal.length - 1])
    B.set(x - (side > 0 ? 1 : 0), y, pal[5])
    side = -side
  }
  return bands
}

function kelpPart(cls, list, seed) {
  const r = rng(seed)
  const layers = []
  for (const o of list) {
    kelp(r, o).forEach((B, i) => {
      // The bands and plants sway apart, so at an edge inside a screen pixel the cell hidden under
      // the upper band shows through. Drawing each band twice halves that (at 1278 x 719, 71 line
      // pixels became 44); whole cells look the same.
      B.twice = true
      if (i > 0) B.anim = anim('k' + Math.min(i, 3), '--d:' + o.d + 's;--l:' + f1(-(o.phase0 ?? 0) - i * 0.4) + 's')
      layers.push(B)
    })
  }
  part(cls, layers)
}

// ---------------------------------------------------------------- fish

// Sprites, facing right; letters pick colours.
const FUSILIER = {
  a: ['y..bbb..', '.ybbbbbe', 'y.lllll.'],
  b: ['...bbb..', 'yybbbbbe', '..lllll.'],
  c: { y: '#ffd23c', b: '#2c6ee0', l: '#a8dcf4', e: '#0a1a40' },
}
const DASH = {
  a: ['x.xx', '.xxx'],
  b: ['.xxx', 'x.xx'],
}

function sprite(L, x, y, rows, colors, flip = false) {
  rows.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && L.set(flip ? x + row.length - 1 - i : x + i, y + j, colors[ch])))
  return L
}

// A school: each fish flips between two frames on its own beat.
function school(name, list, spr, colors, seed, flip = false) {
  const layers = []
  const r = rng(seed)
  for (const [x, y] of list) {
    const a = sprite(new Layer(name + 'A' + x + y), x, y, spr.a, colors, flip)
    const b = sprite(new Layer(name + 'B' + x + y), x, y, spr.b, colors, flip)
    const per = Math.round((0.5 + r() * 0.4) * 10) / 10
    const lag = f1(-r() * 2)
    a.anim = anim('fa', '--f:' + per + 's;--l:' + lag + 's')
    b.anim = anim('fb', '--f:' + per + 's;--l:' + lag + 's', ' opacity="0"')
    layers.push(a, b)
  }
  return layers
}

function farSchool() {
  const r = rng(61)
  const a = new Layer('fsA')
  const b = new Layer('fsB')
  const c = mix('#0a2a5a', waterAt(88), 0.45)
  for (let i = 0; i < 26; i++) {
    const t = r() * Math.PI * 2
    const d = Math.sqrt(r())
    const x = Math.round(150 + Math.cos(t) * d * 22)
    const y = Math.round(88 + Math.sin(t) * d * 8)
    const odd = r() < 0.5
    sprite(a, x, y, odd ? DASH.a : DASH.b, { x: c })
    sprite(b, x, y, odd ? DASH.b : DASH.a, { x: c })
  }
  a.anim = anim('fa', '--f:1.2s;--l:0s')
  b.anim = anim('fb', '--f:1.2s;--l:0s', ' opacity="0"')
  part('', [{ wrap: '<g class="s1"><g class="bob">', end: '</g></g>', layers: [a, b] }])
}

function midSchool() {
  const list = [
    [60, 112],
    [72, 108],
    [70, 117],
    [84, 113],
    [82, 104],
    [95, 109],
    [94, 118],
    [106, 114],
    [58, 103],
    [108, 104],
    [120, 110],
  ]
  const layers = school('ms', list, FUSILIER, FUSILIER.c, 63)
  part('', [{ wrap: '<g class="s2"><g class="bob" style="animation-duration:7s">', end: '</g></g>', layers }])
}

// A sea turtle gliding left: a domed shell with its plates, a pale rim, head and flippers. Two
// frames, the front flipper down and swept back.
function turtle(cx, cy, frame) {
  const L = new Layer('turtle' + frame)
  const SH = fog(['#262812', '#3e4019', '#5a5a24', '#7a7830', '#9e9a42', '#c2bc5c'], 0.2, 70)
  const SK = fog(['#2a3428', '#44543a', '#627452', '#86986e', '#aebc92'], 0.2, 70)
  const RIMC = fog(['#d8cc8a'], 0.2, 70)[0]
  const limb = (x0, y0, dx, dy, len, w) => {
    for (let s = 0; s <= len; s += 0.4) {
      const q = s / len
      const hw = w * Math.sin(Math.PI * Math.min(0.9, 0.25 + q * 0.75))
      for (let k = -hw; k <= hw; k += 0.4) {
        const x = Math.floor(x0 + dx * s - dy * k)
        const y = Math.floor(y0 + dy * s + dx * k)
        L.set(x, y, tone(SK, 0.55 - 0.3 * (k / Math.max(hw, 0.5)) + 0.15 * (1 - q), x, y, 0.15))
      }
    }
  }
  // Far flippers first, darker, then the shell, then the near ones.
  if (frame === 0) limb(cx - 4, cy + 1, 0.2, -0.98, 6, 1.4)
  else limb(cx - 4, cy + 1, 0.9, -0.42, 6, 1.4)
  limb(cx + 7, cy + 1, 0.9, -0.3, 4, 1)
  for (let y = cy - 6; y <= cy + 3; y++) {
    for (let x = cx - 10; x <= cx + 10; x++) {
      const dx = (x + 0.5 - cx) / 9.5
      const dy = (y + 0.5 - cy) / 5
      if (dx * dx + dy * dy > 1 || y > cy + 2) continue
      let v = 0.55 - 0.3 * dx * 0.5 - 0.35 * dy
      const plate = Math.abs(((x - cx + 0.6 * (y - cy) + 40) % 5) - 2.5) < 0.6 || y === cy - 2
      if (plate) v -= 0.22
      if (dx * dx + dy * dy > 0.72 && dy > -0.2) L.set(x, y, RIMC)
      else L.set(x, y, tone(SH, v, x, y, 0.15))
    }
  }
  for (let x = cx - 7; x <= cx + 7; x++) L.set(x, cy + 3, SK[4])
  // Head and neck, an eye.
  for (let y = cy - 1; y <= cy + 3; y++) {
    for (let x = cx - 15; x <= cx - 9; x++) {
      const dx = (x + 0.5 - (cx - 12.5)) / 3
      const dy = (y + 0.5 - (cy + 1.2)) / 2
      if (dx * dx + dy * dy < 1) L.set(x, y, tone(SK, 0.65 - 0.3 * dy - 0.1 * dx, x, y, 0.15))
    }
  }
  L.set(cx - 14, cy, '#0c1010')
  if (frame === 0) limb(cx - 6, cy + 3, 0.45, 0.89, 9, 1.8)
  else limb(cx - 6, cy + 3, 0.94, 0.33, 9, 1.8)
  limb(cx + 8, cy + 3, 0.85, 0.5, 4, 1.2)
  return L
}

// Clownfish over their anemone and blue tangs by the right reef.
const CLOWN = {
  a: ['...owoowo.', 'o.oowoowoe', 'oooowoowoo', 'o..dwddw..'],
  b: ['...owoowo.', '.ooowoowoe', 'o.oowoowoo', '...dwddw..'],
  c: { o: '#ff7a1a', w: '#ffffff', e: '#101018', d: '#c84a10' },
}
const TANG = {
  a: ['...bbbb...', '.BBkkkkbyy', 'eBBBBkbbyy', '.bBBbbbby.', '...bbbb...'],
  b: ['...bbbb...', '.BBkkkkby.', 'eBBBBkbbyy', '.bBBbbbbyy', '...bbbb...'],
  c: { b: '#2a5ad8', B: '#5a8cff', k: '#0a1030', y: '#ffd030', e: '#000000' },
}

// ---------------------------------------------------------------- bubbles, specks, caustics

// Bubbles rise from the clam and from a vent, wobbling, into the surface.
const BUB = {
  big: ['.o.', 'oho', '.o.'],
  mid: ['oh', 'oo'],
  small: ['o'],
}
function bubbles(cls, src, list, seed) {
  const r = rng(seed)
  const layers = []
  for (const [dx, y, kind] of list) {
    const L = new Layer('bub' + dx + y)
    BUB[kind].forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && L.set(src[0] + dx + i, y + j, ch === 'h' ? '#ffffff' : '#a6ecff')))
    const a = src[1] - y // cells down to the source
    const b = -20 - y
    const n = a - b
    const wob = f1(0.6 + Math.round(r() * 4) * 0.2)
    layers.push({
      wrap:
        '<g class="bu" style="--a:' + a + 'px;--b:' + b + 'px;--d:' + f1(n * 0.1) + 's;--n:' + n + ';--l:' + f1(-a * 0.1) + 's"><g class="wb" style="--w:' + wob + 's">',
      end: '</g></g>',
      layers: [L],
    })
  }
  part(cls, layers)
}

// Specks of marine snow in a tile.
function snow(seed, n, tw, th, colors) {
  const r = rng(seed)
  const L = new Layer('snow' + seed)
  for (let i = 0; i < n; i++) {
    const x = Math.floor(r() * tw)
    const y = Math.floor(r() * th)
    L.set(x, y, colors[Math.floor(r() * colors.length)])
  }
  return L
}

// A net of light for the sand, squashed as the floor recedes. One tile covers the whole lit
// floor, rows y0..y0+th-1, so it repeats only across; its lines thin toward the back.
function causticTile(tw, th, seed, y0) {
  const L = new Layer('caustic' + seed)
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const q = y / (th - 1)
      if (net(x + 0.5, (y + 0.5) * (1.25 - 0.45 * q), 8, 4, tw / 8, 0, seed) < 0.32 + 0.26 * q) L.set(x, y0 + y, '#e8fff0')
    }
  }
  return L
}

// ---------------------------------------------------------------- the scene, back to front

part('', [{ raw: water() }])
part('pB', [ghosts()])
farSchool()
part('pB', [farReef()])
part('pT', [{ raw: rays() }])
const SN_FAR = snow(71, 40, 96, 64, ['#a8e4ec', '#7cc8de'])
part('', [{ raw: '<g opacity=".55"><g class="sn" style="--d:' + f1(64 * 0.8) + 's;--n:64;--h:64px">' + tiled(SN_FAR, 96, 64, 0, [-200, -100.5, 720, 384]) + '</g></g>' }])
part('pB', [sand()])
const CA = causticTile(48, 22, 1, 179)
const CB = causticTile(40, 22, 2, 179)
// Each tile holds rows 179..200 between two clear rows, 178 and 201: a tile's bitmap wraps, and
// a filled edge row would bleed into the opposite one. (A clip at y 179 used to cut row 179 in
// half, a half-cell strip that drew as a 1-px line below 6 px per cell; the row now shows whole.)
// The two nets slide against each other, so where a cell of one meets a cell of the other inside
// a screen pixel each covers only its part and the light dips between them; each net is drawn
// twice, which fills that dip in (whole cells look the same: the group's opacity applies after).
part('pB', [
  {
    raw:
      '<g opacity=".45"><g class="sf" style="--d:' + f1(48 * 0.6) + 's;--n:48;--w:48px">' + twice(tiled(CA, 48, 24, 178, [-48, 177.5, 416, 24])) + '</g>' +
      '<g class="sf" style="--d:' + f1(40 * 0.9) + 's;--n:40;--w:-40px">' + twice(tiled(CB, 40, 24, 178, [-40, 177.5, 400, 24])) + '</g></g>',
  },
])
const LR = leftReef()
const RR = rightReef()
{
  const ay = LR.top(87) - 8
  const clowns = [...school('cf', [[80, ay], [92, ay + 4]], CLOWN, CLOWN.c, 64)]
  part('pBL', [{ wrap: '<g class="hv" style="--d:7s;--l:-2s">', end: '</g>', layers: clowns.slice(0, 2) }, { wrap: '<g class="hv" style="--d:9s;--l:-6s">', end: '</g>', layers: clowns.slice(2) }])
  const tangs = school('tg', [[226, 130], [240, 137]], TANG, TANG.c, 65)
  part('pBR', [{ wrap: '<g class="hv2" style="--d:11s;--l:-3s">', end: '</g>', layers: tangs.slice(0, 2) }, { wrap: '<g class="hv2" style="--d:13s;--l:-9s">', end: '</g>', layers: tangs.slice(2) }])
}
midSchool()
{
  const a = turtle(222, 58, 0)
  const b = turtle(222, 58, 1)
  a.anim = anim('fa', '--f:3.2s;--l:0s')
  b.anim = anim('fb', '--f:3.2s;--l:0s', ' opacity="0"')
  part('', [{ wrap: '<g class="s3"><g class="bob" style="animation-duration:6s">', end: '</g></g>', layers: [a, b] }])
}
bubbles('pBR', [244, 166], [[0, 150, 'big'], [1, 128, 'mid'], [-1, 104, 'small'], [0, 80, 'big'], [1, 52, 'mid'], [0, 24, 'small']], 81)
bubbles('pBL', [76, 160], [[0, 134, 'mid'], [0, 100, 'small'], [1, 70, 'big'], [0, 36, 'small']], 82)
const SN_NEAR = snow(72, 18, 128, 80, ['#e0fbff', '#b8eef6'])
part('', [{ raw: '<g class="sn" style="--d:' + f1(80 * 0.4) + 's;--n:80;--h:80px">' + tiled(SN_NEAR, 128, 80, 0, [-256, -120.5, 832, 400]) + '</g>' }])
kelpPart(
  'pBL',
  [
    { x: 30, bottom: 202, top: 74, bands: 4, gap: 11, len: [22, 14], w: [2.2, 1.6], lean: 0.1, amp: 2, freq: 4, phase: 1, d: 9, shade: 0.42 },
    { x: 6, bottom: 202, top: 8, bands: 4, gap: 12, len: [28, 16], w: [2.6, 1.8], lean: 0.08, amp: 3, freq: 5, phase: 0, d: 11, shade: 0.38 },
    { x: 17, bottom: 202, top: 44, bands: 4, gap: 11, len: [24, 15], w: [2.4, 1.7], lean: 0.12, amp: 2.5, freq: 4.5, phase: 2, d: 10, shade: 0.45 },
  ],
  301,
)
kelpPart('pBR', [{ x: 312, bottom: 202, top: 26, bands: 4, gap: 12, len: [26, 15], w: [2.5, 1.8], lean: -0.04, amp: 2.5, freq: 4, phase: 3, d: 12, shade: 0.4 }], 302)
const surf = surface()
part('pT', [{ raw: '<g class="sf" style="--d:' + f1(64 * 0.8) + 's;--n:64;--w:64px">' + surf.far + '</g>' }])
part('pT', [{ raw: '<g class="sf" style="--d:' + f1(64 * 0.4) + 's;--n:64;--w:-64px">' + surf.near + '</g>' }])
// The glow is still and the surface slides under it, so at a glow cell's edge inside a screen
// pixel the surface cell hidden under the glow shows too (a line where the surface beside it is
// as white as the glow). Drawing the glow three times lets that hidden cell through at a fifth
// of the strength at most, under what shows as a line; whole cells look the same.
defs.push('<g id="G">' + emitSafe(sunGlow()) + '</g>')
part('pT', [{ raw: '<use href="#G"/>'.repeat(3) }])

// ---------------------------------------------------------------- motion

// Kelp sways by whole cells: band k leans up to k cells, easing in and out, each band a beat
// behind the one below.
function sway(name, A) {
  let k = ''
  let last = null
  for (let i = 0; i <= 20; i++) {
    const v = Math.round((A * (1 - Math.cos((Math.PI * 2 * i) / 20))) / 2)
    if (v !== last || i === 20) k += i * 5 + '%{transform:' + (v ? 'translateX(' + v + 'px)' : 'none') + '}'
    last = v
  }
  return '@keyframes ' + name + '{' + k + '}'
}
// A ray breathes: its light swells and ebbs in twenty steps.
function breathe() {
  let k = ''
  for (let i = 0; i <= 20; i++) k += i * 5 + '%{opacity:' + f2(0.55 + 0.45 * (0.5 + 0.5 * Math.cos((Math.PI * 2 * i) / 20))) + '}'
  return '@keyframes ry{' + k + '}'
}
// The schools cross in 80% of their cycle, a cell at a time, and wait off to the side; at the
// start they are where they are painted.
const cross = (name, s) => {
  const n = Math.abs(s.to - s.from)
  const D = f2((n * s.step) / 0.8)
  const l = f1(-Math.abs(s.from) * s.step)
  return (
    '.' + name + '{animation:' + name + ' ' + D + 's steps(1) calc(' + l + 's + var(--m)) infinite}' +
    '@keyframes ' + name + '{0%{transform:translateX(' + s.from + 'px);animation-timing-function:steps(' + n + ')}80%,100%{transform:translateX(' + s.to + 'px)}}'
  )
}
const from = l => 'calc(' + l + ' + var(--m))'
const RULES = [
  '.k1{animation:k1 var(--d) steps(1) ' + from('var(--l)') + ' infinite}' + sway('k1', 1),
  '.k2{animation:k2 var(--d) steps(1) ' + from('var(--l)') + ' infinite}' + sway('k2', 2),
  '.k3{animation:k3 var(--d) steps(1) ' + from('var(--l)') + ' infinite}' + sway('k3', 3),
  '.ry{animation:ry var(--d) steps(1) ' + from('var(--l)') + ' infinite}' + breathe(),
  '.sf{animation:sf var(--d) steps(var(--n)) var(--m) infinite}@keyframes sf{to{transform:translateX(var(--w))}}',
  '.sn{animation:sn var(--d) steps(var(--n)) var(--m) infinite}@keyframes sn{to{transform:translateY(var(--h))}}',
  cross('s1', { from: -160, to: 300, step: 0.25 }),
  cross('s2', { from: -180, to: 360, step: 0.15 }),
  cross('s3', { from: 140, to: -280, step: 0.4 }),
  // Fish hovering by the reef drift a few cells to and fro.
  '.hv{animation:hv var(--d) steps(1) ' + from('var(--l)') + ' infinite}' + sway('hv', 3).replace(/translateX\((\d)px\)/g, (m, v) => 'translate(' + v + 'px,' + (v > 1 ? -1 : 0) + 'px)'),
  '.hv2{animation:hv2 var(--d) steps(1) ' + from('var(--l)') + ' infinite}' + sway('hv2', -4),
  // Swimmers rise and sink a whole cell each way, a quarter of the cycle at a time.
  '.bob{animation:bob 5s steps(1) var(--m) infinite}@keyframes bob{0%{transform:none}25%{transform:translateY(-1px)}50%{transform:none}75%{transform:translateY(1px)}100%{transform:none}}',
  '.fa{animation:fa var(--f) steps(1) ' + from('var(--l)') + ' infinite}@keyframes fa{0%{opacity:1}50%,100%{opacity:0}}',
  '.fb{animation:fb var(--f) steps(1) ' + from('var(--l)') + ' infinite}@keyframes fb{0%{opacity:0}50%,100%{opacity:1}}',
  '.bu{animation:bu var(--d) steps(var(--n)) ' + from('var(--l)') + ' infinite}@keyframes bu{from{transform:translateY(var(--a))}to{transform:translateY(var(--b))}}',
  '.wb{animation:wb var(--w) steps(1) var(--m) infinite}@keyframes wb{0%{transform:none}50%{transform:translateX(1px)}}',
  '@media (prefers-reduced-motion:reduce){:root *{animation:none!important}}',
]
const CSS = RULES.join('')

// What of the CSS survives the app's scrub (see Sunfield's build).
function keptLength(css) {
  let n = 0
  for (const m of css.matchAll(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}|@media[^{]*\{[^{}]*\{[^{}]*\}\}|([^{}]+)\{([^{}]*)\}/g)) {
    if (m[0].startsWith('@keyframes')) continue
    if (m[0].startsWith('@media')) {
      n += m[0].length + 12
      continue
    }
    const decls = m[2].split(';').filter(d => d && !/^animation/.test(d))
    n += m[1].length + 3 + (decls.length ? decls.join('; ').length + 2 : 0) + 1
  }
  return n
}

// ---------------------------------------------------------------- assemble

const PIN = { '': 'xMidYMid', pT: 'xMidYMin', pB: 'xMidYMax', pBL: 'xMinYMax', pBR: 'xMaxYMax' }
const view = cls => '<svg viewBox="0 -.5 ' + W + ' ' + H + '" preserveAspectRatio="' + PIN[cls] + ' slice">'
const sizes = []
const pieces = []
for (const p of parts) {
  cull(p.layers)
  const body = renderLayers(p.layers)
  pieces.push([p.cls, body])
  sizes.push([p.cls || '-', body.length])
}
function inViews(list) {
  let out = ''
  let pin = null
  for (const [cls, html] of list) {
    if (cls !== pin) {
      if (pin !== null) out += '</svg>'
      out += view(cls)
      pin = cls
    }
    out += html
  }
  return pin === null ? out : out + '</svg>'
}
const body = inViews(pieces)
let svg =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" font-family="a" color="a" style="--m:0s">' +
  '<style>' + CSS + '</style><defs>' + defs.join('') + '</defs>' + body + '</svg>'
svg = svg.replaceAll('"', "'")

const LIMIT = 131072 - 200
const scrubbed = svg.length - CSS.length + keptLength(CSS) + [...svg.matchAll(/<(\w+)[^>]*\/>/g)].reduce((n, m) => n + 2 + m[1].length, 0)
fs.mkdirSync(path.join(HERE, 'out'), { recursive: true })
fs.writeFileSync(path.join(HERE, 'out', 'deep-reef.svg'), svg)
console.log('scene', svg.length, 'chars,', scrubbed, 'after the app scrub, of', LIMIT, scrubbed <= LIMIT && svg.length <= LIMIT ? 'OK' : 'TOO BIG')
console.log('css', CSS.length, '| patterns', stats.patterns, 'holding', stats.patternRuns, 'runs; plain runs', stats.plainRuns)
console.log('big:', stats.big.join('  '))
console.log('parts:', sizes.map(s => s.join(':')).join('  '))
if (scrubbed > LIMIT || svg.length > LIMIT) process.exitCode = 1
