// Cloud Sea: a cliff top above a sea of clouds, rock spires poking through it, as one animated
// pixel-art SVG in three moments (day, sunset, night).
// node build.mjs [moment ...]  ->  out/cloud-sea-<moment>.svg      STATS=1 lists the heaviest layers.
//
// Painted on a 320 x 200 cell grid (x right, y down) and encoded the way Sunfield's build does it
// (../../../sunfield/tools/build.mjs): cells as 1-cell stroke runs, at most 64 runs a path, big
// still layers in patterns, a nested viewport with viewBox and slice, single-quoted attributes,
// CSS motion in steps() on a shared 0.05 s clock, a reduced-motion rule that stops it. The
// encoder (backed cells, row underlay, pattern tiles with a clear margin) is Tide Line's.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Layer, bayer, bounds, clamp, emitCells, hex, lerp, rgb, rng, smooth, tone } from '../../../sunfield/tools/pixel.mjs'
import { line } from '../../../sunfield/tools/painters.mjs'
import { emitSafe } from './encode-local.mjs'
import { MOMENTS } from './moments.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const W = 320
const H = 200
const H0 = 100 // the cloud horizon
const TICK = 0.05
const f2 = v => String(Math.round(v * 100) / 100).replace(/^0\./, '.').replace(/^-0\./, '-.')
const ROW = 4096
const cellXY = k => [(k % ROW) - 1000, Math.floor(k / ROW) - 1000]

// ---------------------------------------------------------------- noise and colour

function hash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function noise(x, y, s) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const u = smooth(x - xi)
  const v = smooth(y - yi)
  return lerp(lerp(hash(xi, yi, s), hash(xi + 1, yi, s), u), lerp(hash(xi, yi + 1, s), hash(xi + 1, yi + 1, s), u), v)
}
const mix = (a, b, t) => {
  const A = rgb(a)
  const B = rgb(b)
  return hex([lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)])
}
function ramp(stops, t) {
  if (t <= stops[0][0]) return stops[0][1]
  for (let i = 0; i < stops.length - 1; i++) {
    const [ta, ca] = stops[i]
    const [tb, cb] = stops[i + 1]
    if (t <= tb) return mix(ca, cb, (t - ta) / (tb - ta))
  }
  return stops[stops.length - 1][1]
}
const norm3 = v => {
  const l = Math.hypot(...v)
  return v.map(c => c / l)
}
const wrapD = (d, p) => ((((d + p / 2) % p) + p) % p) - p / 2
// n tones spread evenly over a palette, its ends kept.
const pick = (list, n) => Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))])

// ---------------------------------------------------------------- the drawing (the same in every moment)

// The cloud sea: planes from the horizon toward us. Each is a flat floor of cloud at row `base`
// with heaps of cumulus rising from it (w: widths, h: heights, gap: open floor between heaps),
// repeating every TW cells and rolling left a cell every `step` seconds. `sy` squashes the
// billows: flatter far off.
const PLANES = [
  { TW: 160, seed: 11, step: 6, haze: 0.66, base: 101, sy: 1.9, w: [5, 12], h: [1.5, 3], gap: [-0.2, 0.5] },
  { TW: 160, seed: 12, step: 4, haze: 0.52, base: 105, sy: 1.7, w: [9, 20], h: [2.5, 5.5], gap: [-0.2, 0.4] },
  { TW: 320, seed: 13, step: 2.6, haze: 0.38, base: 112, sy: 1.55, w: [14, 30], h: [4, 10], gap: [-0.25, 0.3] },
  { TW: 320, seed: 14, step: 1.7, haze: 0.24, base: 124, sy: 1.4, w: [22, 46], h: [7, 15], gap: [-0.25, 0.25] },
  { TW: 320, seed: 15, step: 1.1, haze: 0.12, base: 142, sy: 1.3, w: [32, 64], h: [11, 23], gap: [-0.25, 0.2] },
  // The near plane: fewer, larger billows (one level, 10 to 17 cells across their radius,
  // about 1.5-2x the lumps of the plane behind) that merge, shaded softly (see `soft`).
  { TW: 320, seed: 16, step: 0.7, haze: 0, base: 190, sy: 1.22, w: [60, 100], h: [30, 52], gap: [-0.3, 0.05], carpet: 0.85, bill: { levels: 1, per: 9, rr: [10, 16] }, soft: true },
]

for (const pl of PLANES) {
  const r = rng(pl.seed)
  const puffs = []
  const add = (x, y, rad, z) => puffs.push({ x: ((x % pl.TW) + pl.TW) % pl.TW, y, r: rad, z })
  // The floor rises and falls gently along the plane (a whole number of waves per tile).
  const amp = pl.h[0] * 0.4
  const ph = r() * 6.28
  const waves = pl.TW / 160 + 1
  pl.baseAt = x => pl.base + Math.round(amp * Math.sin((2 * Math.PI * waves * x) / pl.TW + ph))
  // Heaps packed along the plane, overlapping or with a little open floor between them.
  let x = r() * pl.w[0]
  const end = x + pl.TW
  while (x < end - pl.w[0] * 0.6) {
    const w = Math.min(lerp(pl.w[0], pl.w[1], r()), end - x + pl.w[0] * 0.3)
    const h = lerp(pl.h[0], pl.h[1], Math.pow(r(), 1.2))
    // Domes across the heap, highest near its middle.
    const n = Math.max(1, Math.round(w / (h * 0.85)))
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0.5 : i / (n - 1)
      const hh = h * (0.55 + 0.45 * Math.sin(Math.PI * (0.1 + 0.8 * u))) * (0.85 + 0.3 * r())
      const rad = Math.max(1.2, Math.min(hh * 1.1, (w / n) * 0.9))
      const dx = x + w * (0.1 + 0.8 * u) + (r() - 0.5) * 3
      add(dx, pl.baseAt(dx) - hh + rad / pl.sy, rad, r() * rad * 0.3)
    }
    x += w * (1 + lerp(pl.gap[0], pl.gap[1], r()))
  }
  // A carpet of lower billows along the floor, so open floor is rarely seen.
  const fr = Math.max(1.4, pl.h[0] * 0.6)
  for (let fx = r() * 6; fx < pl.TW; fx += fr * (1.1 + 0.6 * r())) {
    const rad = fr * (0.8 + 0.4 * r())
    puffs.push({ x: fx, y: pl.baseAt(fx) - pl.h[0] * (pl.carpet ?? 0.7) * (0.8 + 0.4 * r()) + rad / pl.sy, r: rad, z: -fr, level: 1 })
  }
  // Billows on the upper rim of the bigger puffs, two levels deep, so the tops boil.
  for (let level = 0; level < (pl.bill?.levels ?? 2); level++) {
    for (const p of [...puffs]) {
      if (p.r < 3 || (p.level ?? 0) !== level) continue
      const k = Math.max(1, Math.round(p.r / (pl.bill?.per ?? 4)))
      for (let i = 0; i < k; i++) {
        const a = -Math.PI * (0.08 + 0.84 * ((i + r()) / k))
        let rr = p.r * (0.36 + 0.2 * r())
        if (pl.bill) rr = clamp(rr, pl.bill.rr[0], pl.bill.rr[1])
        const dist = p.r - rr * (0.3 + 0.3 * r())
        puffs.push({ x: (p.x + Math.cos(a) * dist + pl.TW) % pl.TW, y: p.y + (Math.sin(a) * dist) / pl.sy, r: rr, z: p.z + p.r * 0.32, level: level + 1 })
      }
    }
  }
  pl.puffs = puffs
  pl.fillY = pl.base
  pl.y0 = Math.floor(Math.min(...puffs.map(p => p.y - p.r / pl.sy))) - 1
  // Each cell's nearest sphere and how close the next one comes (a crease where one billow
  // rolls over another), as in Sunfield's paintCloud; below the base, the floor.
  const own = new Map()
  const top = new Array(pl.TW).fill(Infinity)
  for (let y = pl.y0; y <= 200; y++) {
    for (let x = 0; x < pl.TW; x++) {
      let best = null
      let bz = -Infinity
      let z2 = -Infinity
      // Heaps stand on the floor: under it there is only floor.
      const bx = pl.baseAt(x)
      for (const p of y <= bx ? puffs : []) {
        const dx = wrapD(x + 0.5 - p.x, pl.TW)
        const dy = (y + 0.5 - p.y) * pl.sy
        const d2 = dx * dx + dy * dy
        if (d2 >= p.r * p.r) continue
        const nz = Math.sqrt(p.r * p.r - d2)
        const z = nz + p.z
        if (z > bz) {
          z2 = bz
          bz = z
          best = { p, dx, dy, nz }
        } else if (z > z2) z2 = z
      }
      if (best) {
        best.crease = bz - z2 < 1.1 && best.dy > -best.p.r * 0.25
        own.set(x + ',' + y, best)
      } else if (y >= bx) own.set(x + ',' + y, 'fill')
      if ((best || y >= bx) && y < top[x]) top[x] = y
    }
  }
  // Under an overhanging billow the column is open: fill it with the deep shade, so each plane
  // is solid from its top down and nothing behind it shows through.
  for (let x = 0; x < pl.TW; x++) for (let y = top[x]; y <= 200; y++) if (!own.has(x + ',' + y)) own.set(x + ',' + y, 'fill')
  pl.own = own
  pl.top = top
  pl.maxTop = Math.max(...top)
}

// The ground we stand on: a low grassy rim along the bottom, rising on the right into a knoll.
const knollTop = x => 151 + Math.pow((x - 292) / 52, 2) * 5 + (noise(x * 0.15, 1, 31) - 0.5) * 2
const rimTop = x => 189 + Math.sin(x * 0.04) * 1.5 + (noise(x * 0.2, 2, 32) - 0.5) * 2.5
const GT = []
for (let x = -2; x < W + 2; x++) GT[x + 2] = Math.round(lerp(rimTop(x), knollTop(x), smooth((x - 140) / 110)))
const groundTop = x => GT[clamp(Math.round(x), -2, W + 1) + 2]
// The last plane is cut where the ground always covers it.
let maxGround = 0
for (let x = 0; x < W; x++) maxGround = Math.max(maxGround, groundTop(x))
PLANES.forEach((pl, k) => {
  pl.cut = k + 1 < PLANES.length ? PLANES[k + 1].maxTop : maxGround
})

// Rock spires through the cloud sea: far, middle and near. Each stands in front of the planes
// before `plane` and is hidden under that plane from its lowest dip down.
const SPIRES = [
  { cx: 104, top: 92, w: [1, 2.6], seed: 3, depth: 0.7, plane: 1 },
  { cx: 263, top: 89, w: [1.3, 3.2], seed: 1, depth: 0.68, plane: 1 },
  { cx: 272, top: 94, w: [1, 2.3], seed: 2, depth: 0.7, plane: 1 },
  { cx: 140, top: 63, w: [2.2, 9], seed: 4, depth: 0.42, plane: 3, veg: true },
  { cx: 156, top: 76, w: [1.4, 6], seed: 5, depth: 0.45, plane: 3 },
  { cx: 168, top: 86, w: [1, 4.2], seed: 6, depth: 0.48, plane: 3 },
  { cx: 84, top: 100, w: [3, 6.5], seed: 8, depth: 0.14, plane: 5, veg: true },
  { cx: 50, top: 40, w: [6, 17], seed: 7, depth: 0.03, plane: 5, veg: true, pine: true },
]

// The far range on the left: [x, height above the horizon, half width].
const RANGE = [[-10, 16, 24], [14, 25, 30], [44, 37, 40], [74, 24, 28], [99, 31, 30], [126, 15, 22], [150, 7, 14]]

// High clouds: streaks of [x, y, rx, ry] puffs, and their drift there and back
// ([seconds, cells, seconds into the swing]).
const HI = [
  { seed: 1, puffs: [[22, 25, 40, 2.6], [64, 22, 24, 3.4], [92, 24, 16, 2]], drift: [70, 6, 10] },
  { seed: 2, puffs: [[172, 18, 30, 2.4], [206, 16, 20, 3], [228, 18, 12, 1.8]], drift: [64, 5, 30] },
  { seed: 3, puffs: [[112, 44, 22, 2.2], [138, 42, 14, 2.8], [156, 44, 10, 1.6]], drift: [58, 5, 20] },
  { seed: 4, puffs: [[296, 60, 24, 2.2], [326, 58, 16, 2.8]], drift: [52, 4, 5] },
  { seed: 6, puffs: [[220, 84, 22, 1.4], [246, 85, 14, 1.2]], drift: [44, 3, 12] },
]

// The windswept tree on the knoll: a trunk bent to the left and flat pads of foliage flagged
// downwind.
const TREE = { x0: 292, x1: 303, y1: 126, x2: 266, y2: 103 }
const PADS = [
  { x: 262, y: 101, rx: 21, ry: 5.5, from: 1, seed: 1 },
  { x: 246, y: 111, rx: 13, ry: 4, from: 0.86, seed: 2 },
  { x: 276, y: 117, rx: 15, ry: 4.5, from: 0.64, seed: 3 },
  { x: 259, y: 125, rx: 10, ry: 3.5, from: 0.52, seed: 4 },
  { x: 292, y: 133, rx: 9, ry: 3, from: 0.36, seed: 5 },
]

// The cairn on the knoll's flank: stones bottom up, [dx, width, height].
const CAIRN = { x: 214, stones: [[0, 15, 5], [1, 12, 4], [-1, 10, 4], [1, 9, 3], [0, 7, 3], [-1, 5, 3], [0, 4, 2]] }

// Boulders in the turf: [x, sink, rx, ry].
const ROCKS = [[18, 1, 5, 3], [62, 1, 6, 3], [113, 0, 7, 4], [125, 1, 4, 2.5], [180, 0, 6, 3.5], [236, 0, 8, 4.5], [314, 0, 6, 3]]

// ---------------------------------------------------------------- the scene

function scene(name) {
  const P = MOMENTS[name]
  const items = [] // paint order: layers, { under }, { raw }, { wrap, layers, end }
  const kf = new Map()
  const addKf = (k, text) => kf.set(k, text)
  const anim = (cls, style = '', extra = '') => ({ cls, style, extra })
  const E = encoder()
  const side = x => Math.sign(P.light.x - x) || 1

  // ------------------------------------------------ sky
  // Bands of the sky's ramp, three rows high up high and two near the horizon. Around the sun
  // (or moon) the bands bulge up: a cell there takes the colour of a lower row.
  const edges = []
  for (let t = -60; t < 60; t += 3) edges.push(t)
  for (let t = 60; t < 240; t += 2) edges.push(t)
  const bandCols = edges.map((e, i) => ramp(P.sky, (e + (edges[i + 1] ?? e + 2)) / 2 - 0.5))
  const band = t => {
    let i = 0
    while (i < edges.length - 1 && edges[i + 1] <= t) i++
    return i
  }
  const G = P.glow
  const lift = (x, y) => G.lift * Math.exp(-(((x + 0.5 - G.x) / G.rx) ** 2) - ((y + 0.5 - G.y) / G.ry) ** 2)
  const skyT = (x, y) => y + lift(x, y)
  const skyAt = (x, y) => bandCols[band(skyT(x, y))]
  const sky = new Layer('sky')
  const SKY_END = PLANES[0].maxTop
  for (let y = -1; y <= SKY_END; y++) for (let x = 0; x < W; x++) sky.set(x, y, skyAt(x, y))
  items.push({ under: true, layer: sky })
  // Behind the cloud sea, each row's commonest colour at the start in a band: where two cells
  // meet inside a screen pixel a matching colour shows through, not the window.
  const underpaint = { raw: '' }
  items.push(underpaint)

  // Rays from the sun: wedges where the bands sit a little lower (light) or higher (shade).
  if (P.rays) {
    const rays = new Layer('rays')
    const { x: rx, y: ry, list, reach } = P.rays
    for (let y = -1; y < H0; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x + 0.5 - rx
        const dy = ry - (y + 0.5)
        const d = Math.hypot(dx, dy)
        if (d < 20) continue
        const a = (Math.atan2(dy, dx) * 180) / Math.PI
        let s = 0
        for (const [deg, w, k] of list) {
          const q = 1 - Math.abs(a - deg) / w
          if (q > 0) s += k * Math.min(1, q * 1.6)
        }
        if (!s) continue
        const t = skyT(x, y) + s * smooth((d - 20) / 26) * Math.exp(-d / reach)
        const c = bandCols[band(t)]
        if (c !== sky.get(x, y)) rays.set(x, y, c)
      }
    }
    rays.anim = anim('ry')
    // Encoding: the sky beneath the rays is known, so two ray cells are joined only where the sky
    // under their edge is far from both.
    if (!process.env.NORAYUNDER) rays.enc = { edge: false, back: 'none', under: (k, n) => [sky.m.get(k), sky.m.get(n)] }
    items.push(rays)
  }

  // Stars, a few of them dimming for a moment now and then.
  if (P.stars) {
    const r = rng(211)
    const still = new Layer('stars')
    const tw = []
    for (let i = 0; i < 130; i++) {
      const x = Math.floor(r() * W)
      const y = Math.floor(2 + Math.pow(r(), 1.3) * 86)
      const bright = i < 14
      if (Math.hypot(x - P.moon.x, y - P.moon.y) < 15) continue
      if (bright) {
        const L = new Layer('star' + i)
        L.set(x, y, P.stars[0])
        if (i < 6) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) L.set(x + dx, y + dy, P.stars[2])
        const d = 5 * (1 + Math.floor(r() * 4))
        L.anim = anim('tk', '--d:' + d + 's;--l:' + -Math.round(r() * d * 10) / 10 + 's')
        tw.push(L)
      } else still.set(x, y, P.stars[r() < 0.35 ? 1 : 2])
    }
    items.push(still, ...tw)
  }

  // The moon: a disc lit from the upper left, with a dotted ring of halo.
  if (P.moon) {
    const moon = new Layer('moon')
    const { x: cx, y: cy, r: R, tones, halo } = P.moon
    const craters = new Set(['-3,-2', '-2,-2', '-2,-1', '1,2', '2,2', '2,1', '-1,3', '3,-3', '-4,1'])
    for (let y = -R - 3; y <= R + 2; y++) {
      for (let x = -R - 3; x <= R + 2; x++) {
        const dx = x + 0.5
        const dy = y + 0.5
        const d = Math.hypot(dx, dy)
        if (d >= R) {
          if (d < R + 1.5 && (x + y) % 2 === 0) moon.set(cx + x, cy + y, halo)
          continue
        }
        const nz = Math.sqrt(R * R - d * d) / R
        let v = 0.5 + 0.5 * ((-dx / R) * 0.45 + (-dy / R) * 0.55 + nz * 0.55)
        if (craters.has(x + ',' + y)) v -= 0.22
        moon.set(cx + x, cy + y, tone(tones, v, x, y, 0.4))
      }
    }
    items.push(moon)
  }

  // The sun: a pale disc with a warm rim, its lower part in the cloud sea.
  if (P.sun) {
    const sun = new Layer('sun')
    const { x: cx, y: cy, r: R, sq, tones, halo } = P.sun
    for (let y = Math.floor(cy - R - 3); y <= Math.min(cy + R + 3, SKY_END); y++) {
      for (let x = Math.floor(cx - R - 3); x <= cx + R + 3; x++) {
        const d = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) / sq) / R
        if (d >= 1) {
          if (d < 1 + 1 / R) sun.set(x, y, halo)
          else if (d < 1 + 2.2 / R && (x + y) % 2 === 0 && (x + 2 * y) % 3 === 0) sun.set(x, y, halo)
          continue
        }
        const low = smooth((y + 0.5 - (cy - R * sq)) / (2 * R * sq))
        const v = 1 - 0.9 * Math.pow(d, 5) - 0.22 * low
        sun.set(x, y, tone(tones, v, x, y, 0.25))
      }
    }
    items.push(sun)
  }

  // ------------------------------------------------ high clouds
  // Thin streaks, lit along the edge that faces the light, brightest near it.
  {
    const C = P.hi
    for (const c of HI) {
      const L = new Layer('hi' + c.seed)
      const cells = new Set()
      let x0 = Infinity
      let x1 = -Infinity
      let y0 = Infinity
      let y1 = -Infinity
      for (const [px, py, rx, ry] of c.puffs) {
        x0 = Math.min(x0, px - rx - 2)
        x1 = Math.max(x1, px + rx + 2)
        y0 = Math.min(y0, py - ry - 2)
        y1 = Math.max(y1, py + ry + 2)
      }
      for (let y = Math.floor(y0); y <= y1; y++) {
        for (let x = Math.floor(x0); x <= x1; x++) {
          let q = -Infinity
          for (const [px, py, rx, ry] of c.puffs) q = Math.max(q, 1 - (((x + 0.5 - px) / rx) ** 2 + ((y + 0.5 - py) / ry) ** 2))
          if (q + (noise(x * 0.3, y * 0.8, c.seed) - 0.5) * 0.3 > 0) cells.add(x + ',' + y)
        }
      }
      const has = (x, y) => cells.has(x + ',' + y)
      for (const k of cells) {
        const [x, y] = k.split(',').map(Number)
        const dir = C.below ? 1 : -1
        let lit = 0
        while (lit < 5 && has(x, y + dir * (lit + 1))) lit++
        const edge = !has(x, y - dir)
        let v = C.base
        v += C.rim * [1, 0.68, 0.42, 0.22, 0.1, 0][lit]
        if (edge && lit > 1) v += 0.06
        v += C.sun * Math.exp(-(((x - C.lx) / C.lw) ** 2) - ((y - C.ly) / 70) ** 2)
        v += (noise(x * 0.25, y * 0.6, c.seed + 9) - 0.5) * 0.08
        L.set(x, y, tone(C.tones, v, x, y, 0.18))
      }
      const [d, a, l] = c.drift
      addKf('d' + a, swingKf('d' + a, a))
      L.anim = anim('cd d' + a, '--d:' + d + 's;--l:' + -l + 's')
      items.push(L)
    }
  }

  // ------------------------------------------------ the far range
  {
    const RG = P.range
    const L = new Layer('range')
    const hAt = x => {
      let best = 0
      let pk = null
      for (const p of RANGE) {
        const h = p[1] * Math.pow(Math.max(0, 1 - Math.abs(x + 0.5 - p[0]) / p[2]), 1.1)
        if (h > best) {
          best = h
          pk = p
        }
      }
      return [best, pk]
    }
    const end = PLANES[0].maxTop
    for (let x = 0; x < 172; x++) {
      const [h, pk] = hAt(x)
      if (h < 1) continue
      const top = Math.round(H0 - h - (noise(x * 0.3, 0, 51) - 0.5) * 2.4)
      const right = x + 0.5 > pk[0]
      const lit = right === side(x) > 0
      const snowLine = H0 - 21 + Math.round((noise(x * 0.25, 4, 53) - 0.5) * 7)
      for (let y = top; y <= end; y++) {
        const e = y - top
        // Gullies: streaks running down each flank.
        const g = noise((x + (right ? -1 : 1) * e * 0.9) * 0.22, 3, 52)
        let v = lit ? 0.66 : 0.3
        if (g > 0.64) v += lit ? -0.2 : 0.16
        else if (g < 0.24) v += lit ? 0.1 : -0.08
        v += 0.24 * smooth((y - (H0 - 16)) / 16)
        let c
        if (y < snowLine && e < 12 + g * 8) c = tone(RG.snow, lit ? 0.8 - (g > 0.64 ? 0.3 : 0) : 0.15 + (g > 0.64 ? 0.3 : 0), x, y, 0)
        else c = tone(RG.tones, v, x, y, 0.04)
        if (e === 0 && lit) c = RG.rim
        L.set(x, y, c)
      }
    }
    items.push(L)
  }

  // ------------------------------------------------ cloud planes and spires
  const L3 = norm3(P.cloudL)
  const seenSea = new Map()
  const plane = (pl, k) => {
    const tones = pick(P.cloud, k < 3 ? 5 : 7).map(c => mix(c, P.haze, pl.haze))
    const body = new Layer('plane' + k)
    const rim = new Layer('rim' + k)
    const own = (x, y) => pl.own.get(((x % pl.TW) + pl.TW) % pl.TW + ',' + y)
    const topAt = x => pl.top[((x % pl.TW) + pl.TW) % pl.TW]
    const shadeH = Math.max(2, pl.h[1] * 0.55)
    const B = P.cloudBright ?? 0.6
    const nearTones = P.near ?? P.cloud
    for (let y = pl.y0; y <= pl.cut; y++) {
      for (let x = 0; x < pl.TW; x++) {
        const o = own(x, y)
        if (!o) continue
        const e = y - topAt(x)
        let v
        if (o === 'fill' && pl.soft) {
          body.set(x, y, tone(nearTones, 0.16 + (P.nearLift ?? 0), x, y, 0))
          continue
        }
        if (o === 'fill') {
          // The open floor between heaps: flat, in their shade, a lit lip where it shows.
          // Deep shade between the banks, darker further down.
          v = B - 0.42 - 0.14 * smooth((y - pl.baseAt(x)) / 10)
          if (e === 0) {
            body.set(x, y, tone(tones, v + 0.12, x, y, 0))
            continue
          }
          body.set(x, y, tone(tones, v, x, y, 0.06))
          continue
        }
        const { p, dx, dy, nz, crease } = o
        const n0 = dx / p.r
        const n1 = dy / p.r
        const n2 = nz / p.r
        if (pl.soft) {
          // Soft cloud: wrapped light with no dark edge or crease, so billows merge; a long
          // Bayer-dithered fall into a cool underside; a lit rim only on tops facing the light.
          const lit = n0 * L3[0] + n1 * L3[1] + n2 * L3[2]
          const shH = pl.h[1] * 0.75
          let sv = 0.2 + 0.68 * clamp((lit + 0.55) / 1.55, 0, 1)
          sv -= 0.26 * smooth((y + 0.5 - (pl.baseAt(x) - shH)) / shH)
          sv += P.nearLift ?? 0
          const NT = nearTones
          if (e === 0 && lit > 0.25) {
            body.set(x, y, tone(NT, sv + 0.06, x, y, 0))
            rim.set(x, y, tone(NT, Math.max(sv, 0.62) + 0.22, x, y, 0))
          } else if (e === 1 && lit > 0.45) body.set(x, y, tone(NT, sv + 0.08, x, y, 0))
          else body.set(x, y, tone(NT, sv, x, y, P.nearDither ?? 0.6))
          continue
        }
        v = B + 0.5 * (n0 * L3[0] + n1 * L3[1] + n2 * L3[2]) - 0.12 * (1 - n2) ** 2
        if (crease) v -= 0.11
        v -= 0.4 * smooth((y + 0.5 - (pl.baseAt(x) - shadeH)) / shadeH)
        v += 0.08 * (1 - smooth(e / 4))
        if (e === 0) {
          body.set(x, y, tone(tones, Math.max(v, B) + 0.04, x, y, 0))
          rim.set(x, y, tone(tones, Math.max(v, B) + 0.2, x, y, 0))
        } else body.set(x, y, tone(tones, v, x, y, 0.03))
      }
    }
    // Encoding: the tile wraps, so its end columns are not outer edges, and the next plane always
    // covers the rows below the cut.
    const wrapIn = L => n => {
      const [x, y] = cellXY(n)
      return y > pl.cut || L.m.has((y + 1000) * ROW + (((x % pl.TW) + pl.TW) % pl.TW) + 1000)
    }
    if (process.env.PLANEMERGE) console.log('plane' + k, 'merged', mergeNear([body], Number(process.env.PLANEMERGE)))
    if (process.env.PLANESTAT) {
      // Debug: how much of the body its rows' commonest colours would hold.
      const rows = new Map()
      for (const [kk, c] of body.m) {
        const y = cellXY(kk)[1]
        if (!rows.has(y)) rows.set(y, new Map())
        rows.get(y).set(c, (rows.get(y).get(c) ?? 0) + 1)
      }
      let full = 0
      let hit = 0
      for (const [, m] of rows) {
        let n = 0
        for (const v of m.values()) n += v
        if (n < pl.TW) continue
        full += n
        hit += Math.max(...m.values())
      }
      console.log('plane' + k, 'cells', body.size, 'in full rows', full, 'row-commonest', hit, (hit / body.size).toFixed(2))
    }
    body.enc = { edge: 'back', inside: wrapIn(body) }
    rim.enc = { inside: wrapIn(rim) }
    // The rim is a still overlay on the body (both roll together) at the light's opacity: where
    // the body beneath one of its cells differs a lot from the body just outside it, and the rim
    // there (at some opacity it takes) matches that outside, the body beneath showed along the
    // rim's edge as a line between two alike colours. There the rim gets a skirt cell in the
    // colour already there (as Tide Line's skirts): it shows exactly what lies under it.
    if (!process.env.NOSKIRT) {
      const wrapK = n => {
        const [x, y] = cellXY(n)
        return (y + 1000) * ROW + (((x % pl.TW) + pl.TW) % pl.TW) + 1000
      }
      for (const [k, c] of [...rim.m]) {
        const bu = body.m.get(k)
        if (bu === undefined || apart(bu, c) <= SKIRT_T) continue
        for (const n0 of [k - 1, k + 1, k - ROW, k + ROW]) {
          const n = wrapK(n0)
          if (rim.m.has(n)) continue
          const bo = body.m.get(n)
          if (bo === undefined || apart(bu, bo) <= SKIRT_T) continue
          if (LT_OPS.some(op => apart(mix(bu, c, op), bo) <= SKIRT_SAME)) rim.m.set(n, bo)
        }
      }
      rim.enc.edge = true
    }
    // The band repeats every TW cells and rolls left by TW over its cycle.
    const d = Math.round(pl.step * pl.TW * 100) / 100
    const roll = '--d:' + d + 's;--n:' + pl.TW + ';--w:' + -pl.TW + 'px'
    const lt = '--d:' + (17 + 4 * k) + 's;--l:' + -(5 * k + 3) + 's'
    for (const [key, c] of body.m) {
      const [x, y] = cellXY(key)
      for (let xx = x; xx < W; xx += pl.TW) seenSea.set(y * 1000 + xx, c)
    }
    PROBED.push(['plane' + k, body, pl.TW, k, pl.step], ['rim' + k, rim, pl.TW, k, pl.step])
    // Each plane rolls over the planes behind it at its own speed, so what lies under its edges
    // keeps changing and cannot be matched. Two coats (lesson 7) were tried here and made MORE
    // lines (day 1680x1050: 111 -> 166 px): a coat is a second resampled pattern bitmap, and its
    // soft edge doubles the dark fringe instead of covering it. So the planes keep one coat
    // (env COATS to try more); their edges are handled by the encoder (edge 'back') instead.
    const coats = Number(process.env.COATS ?? 1)
    return { planeK: k, raw: "<g class='rl' style='" + roll + "'>" + E.tiled(body, pl.TW, pl.y0, pl.cut).repeat(k ? coats : 1) + "<g class='lt' style='" + lt + "'>" + E.tiled(rim, pl.TW, pl.y0, pl.cut).repeat(k ? coats : 1) + '</g></g>' }
  }

  const spire = s => {
    const L = new Layer('spire' + s.seed)
    const tones = P.rock.map(c => mix(c, P.haze, s.depth))
    const rimC = P.rockRim.map(c => mix(c, P.haze, s.depth * 0.8))
    const veg = P.veg.map(c => mix(c, P.haze, s.depth))
    const sd = side(s.cx)
    const bottom = PLANES[s.plane].maxTop
    const hTot = bottom - s.top
    const r = rng(s.seed * 31)
    // Partial ledges: [row, from, to] across the width (-1..1), and long cracks [u, row, length].
    const ledges = []
    for (let y = s.top + 6 + Math.floor(r() * 8); y < bottom - 3; y += 11 + Math.floor(r() * 14)) {
      const a = -1 + r() * 0.9
      ledges.push([y, a, Math.min(1, a + 0.3 + r() * 0.6)])
    }
    const cracks = []
    for (let i = 0; i < Math.round(hTot / 7); i++) cracks.push([-0.7 + r() * 1.4, s.top + 2 + Math.floor(r() * hTot), 8 + Math.floor(r() * 22)])
    const rows = []
    for (let y = s.top; y <= bottom; y++) {
      const t = (y - s.top) / hTot
      let hw = lerp(s.w[0], s.w[1], Math.pow(t, 1.3))
      // Eroded bands: the column swells and narrows.
      hw *= 1 + (noise(y * 0.07, 7, s.seed) - 0.5) * 0.3
      const cap = (y - s.top + 1) / Math.max(2, s.w[0] * 0.9)
      if (cap < 1) hw *= Math.sqrt(cap * (2 - cap))
      const nl = (noise(y * 0.3, 1, s.seed) - 0.5) * 2 + (noise(y * 0.05, 2, s.seed) - 0.5) * s.w[1] * 0.25
      const nr = (noise(y * 0.3, 3, s.seed) - 0.5) * 2 + (noise(y * 0.05, 4, s.seed) - 0.5) * s.w[1] * 0.25
      rows.push([y, Math.round(s.cx - hw + nl), Math.round(s.cx + hw + nr)])
    }
    const inS = new Set()
    for (const [y, xl, xr] of rows) for (let x = xl; x <= xr; x++) inS.add(x + ',' + y)
    const has = (x, y) => inS.has(x + ',' + y)
    for (const [y, xl, xr] of rows) {
      const wd = Math.max(1, xr - xl + 1)
      // Three faces: in shade, half lit, lit; their edges wander down the column.
      const b1 = -0.35 + (noise(y * 0.06, 5, s.seed) - 0.5) * 0.5
      const b2 = 0.3 + (noise(y * 0.06, 6, s.seed) - 0.5) * 0.5
      for (let x = xl; x <= xr; x++) {
        const u = (((x + 0.5 - xl) / wd) * 2 - 1) * sd
        let v = u > b2 ? 0.7 : u > b1 ? 0.44 : 0.2
        for (const [cu, cy, cl] of cracks) if (y >= cy && y < cy + cl && Math.round(lerp(xl, xr, (cu * sd + 1) / 2) + (y - cy) * 0.08) === x) v -= 0.2
        for (const [ly, a, b] of ledges) {
          if (u < a || u > b) continue
          if (y === ly) v += 0.24
          else if (y === ly + 1) v -= 0.22
        }
        // Light bounced up from the cloud tops on the lower rock.
        v += 0.1 * smooth((y - (bottom - 16)) / 16)
        let c = tone(tones, v, x, y, 0)
        const litEdge = sd > 0 ? !has(x + 1, y) : !has(x - 1, y)
        if (!has(x, y - 1)) c = rimC[u > -0.2 ? 1 : 0]
        else if (litEdge) c = rimC[1]
        L.set(x, y, c)
      }
    }
    // Tufts of green on the lit end of some ledges.
    for (const [ly, a, b] of ledges) {
      if (b < 0.2 || hash(ly, 1, s.seed) < 0.4) continue
      const row = rows[ly - s.top]
      const ux = lerp(row[1], row[2], ((Math.min(b, 0.9) * sd + 1) / 2))
      for (let i = -1; i <= 1; i++) {
        L.set(Math.round(ux) + i, ly - 1, veg[i === sd ? 5 : 3])
        L.set(Math.round(ux) + i, ly, veg[2])
      }
    }
    // A cap of turf and shrubs on top.
    if (s.veg) {
      const [, xl, xr] = rows[Math.min(rows.length - 1, 2)]
      for (let x = xl - 1; x <= xr + 1; x++) {
        const h = 1 + Math.round(noise(x * 0.5, 2, s.seed + 40) * 2.4)
        const base = rows.find(r => x >= r[1] && x <= r[2])?.[0] ?? s.top + 2
        for (let j = 0; j < h + 1; j++) {
          const y = base - h + j
          const lit = j === 0
          L.set(x, y, veg[lit ? (sd * (x - s.cx) > -2 ? 5 : 4) : j === 1 ? 3 : Math.min(2, j - 1)])
        }
      }
    }
    // A small pine on the near spire, flagged downwind.
    if (s.pine) {
      const sprite = ['....x....', '...xxx...', '..xxxx...', '..xxxxx..', '.xxxxxx..', 'xxxxxxx..', '..xxxxxx.', '.xxxxxxxx', '....x....', '....x....']
      const px = s.cx - 2
      const py = s.top - sprite.length
      sprite.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) {
          if (row[i] !== 'x') continue
          const edge = sd > 0 ? row[i + 1] !== 'x' : row[i - 1] !== 'x'
          const topE = j === 0 || sprite[j - 1][i] !== 'x'
          const trunk = j >= 8
          L.set(px + i, py + j, trunk ? P.bark[1] : edge || topE ? veg[5] : veg[(i + j) % 3 === 0 ? 2 : 1])
        }
      })
    }
    return L
  }

  const spireLs = []
  PLANES.forEach((pl, k) => {
    for (const s of SPIRES) if (s.plane === k) items.push(spire(s))
    spireLs.push(...items.filter(L => L instanceof Layer && /^spire/.test(L.name) && !spireLs.includes(L)))
    if (k === 5 && P.birds !== false && P.bird) items.push(...birds())
    items.push(plane(pl, k))
    if (P.glare && k === (P.glare.after ?? 2)) items.push(glare())
  })
  {
    const rows = []
    for (let y = PLANES[0].maxTop + 1; y <= H; y++) {
      const n = new Map()
      for (let x = 0; x < W; x++) {
        const c = seenSea.get(y * 1000 + x)
        if (c) n.set(c, (n.get(c) ?? 0) + 1)
      }
      let best = null
      for (const [c, k] of n) if (!best || k > best[1]) best = [c, k]
      rows.push([y, best ? best[0] : rows[rows.length - 1][1]])
    }
    let i = 0
    while (i < rows.length) {
      let j = i
      while (j + 1 < rows.length && rows[j + 1][1] === rows[i][1]) j++
      const h = j - i + 1
      underpaint.raw += "<path stroke='" + rows[i][1] + "' stroke-width='" + (h + 1) + "' d='M0 " + f2(rows[i][0] + h / 2) + "h" + W + "'/>"
      i = j + 1
    }
  }

  // ------------------------------------------------ glare over the far cloud sea
  function glare() {
    const Gl = P.glare
    const L = new Layer('glare')
    for (let y = Gl.y0; y <= Gl.y1; y++) {
      const fy = Math.exp(-(((y - Gl.y0 - 2) / ((Gl.y1 - Gl.y0) * 0.5)) ** 2))
      const hw = Gl.w * fy
      for (let x = Math.floor(Gl.x - hw - 6); x <= Gl.x + hw + 6; x++) {
        const d = Math.abs(x + 0.5 - Gl.x) / Math.max(1, hw)
        const n = noise(x * 0.07, y * 0.6, 91)
        const q = (1 - d) * (0.55 + 0.9 * n)
        if (q > 0.38) L.set(x, y, q > 0.85 ? Gl.tones[1] : Gl.tones[0])
      }
    }
    L.noCover = true
    return { wrap: "<g opacity='" + f2(Gl.o) + "'>", end: '</g>', layers: [L] }
  }

  // ------------------------------------------------ birds circling far below
  function birds() {
    const A = ['x.x', '.x.']
    const B = ['.x.', 'x.x']
    const out = []
    const cx = 150
    const cy = 127
    ;[0, 1, 2].forEach(i => {
      const a = new Layer('ba' + i)
      const b = new Layer('bb' + i)
      const x = cx - 1 + [0, 4, -3][i]
      const y = cy + [0, 2, 3][i]
      A.forEach((row, j) => [...row].forEach((ch, k) => ch === 'x' && a.set(x + k, y + j, P.bird)))
      B.forEach((row, j) => [...row].forEach((ch, k) => ch === 'x' && b.set(x + k, y + j, P.bird)))
      const per = [0.8, 0.9, 0.7][i]
      a.anim = anim('fa', '--f:' + per + 's;--l:' + -i * 0.3 + 's')
      b.anim = anim('fb', '--f:' + per + 's;--l:' + -i * 0.3 + 's', " opacity='0'")
      const l = -[0, 9, 19][i]
      out.push({ wrap: "<g class='cx' style='--l:" + l + "s'><g class='cy'>", end: '</g></g>', layers: [a, b] })
    })
    return out
  }

  // ------------------------------------------------ wisps rising past the edge
  {
    // [x, foot y, foot radius, seconds into the cycle, cycle]; a cycle is a multiple of 4 s so
    // every step of the rise and the drift lands on the 0.05 s clock.
    const WI = [[64, 197, 7, -4, 16], [118, 196, 8, -9, 20], [156, 194, 6.5, -13, 16], [190, 190, 7.5, -2, 20]]
    WI.forEach(([wx, wy, R, l, d], i) => {
      const L = new Layer('wisp' + i)
      const Bd = new Layer('wispb' + i)
      const F = new Layer('wispf' + i)
      // A soft rising puff of mist: a broad rounded foot with two smaller puffs climbing from it,
      // leaning downwind (left). Core, body and fringe are separate cells at falling opacity,
      // so the edge fades out instead of ending on a line.
      // Blobs of the puff [dx, dy, r] in foot radii; their fields add up (metaballs), so they melt
      // into one soft mass instead of reading as separate rings.
      const blobs = [[0, 0, 1], [0.95, -0.15, 0.7], [-0.9, -0.3, 0.75], [-0.35, -0.85, 0.62], [0.35, -1.2, 0.45]]
      for (let y = Math.floor(wy - R * 2); y <= wy + R; y++) {
        for (let x = Math.floor(wx - R * 2.2); x <= wx + R * 2; x++) {
          let f = 0
          for (const [bx, by, br] of blobs) {
            const dd = ((x + 0.5 - wx - bx * R) ** 2 + ((y + 0.5 - wy - by * R) * 1.7) ** 2) / (br * R) ** 2
            if (dd < 1) f += (1 - dd) ** 2
          }
          f += (noise(x * 0.3, y * 0.45, 60 + i) - 0.5) * 0.35
          if (f > 0.7) L.set(x, y, P.wisp.tones[1])
          else if (f > 0.32) Bd.set(x, y, P.wisp.tones[0])
          else if (f > 0.1) F.set(x, y, P.wisp.tones[0])
        }
      }
      for (const X of [L, Bd, F]) X.noCover = true
      items.push({
        wrap: "<g opacity='" + f2(P.wisp.o) + "'><g class='wy' style='--d:" + d + 's;--l:' + l + "s'><g class='wx'><g class='wo'>",
        end: '</g></g></g></g>',
        layers: [{ wrap: "<g opacity='.3'>", end: '</g>', layers: [F] }, { wrap: "<g opacity='.65'>", end: '</g>', layers: [Bd] }, L],
      })
    })
  }

  // ------------------------------------------------ the ground
  const ground = new Layer('ground')
  {
    const gv = P.groundV ?? 0.5
    const n = P.grass.length
    for (let x = 0; x < W; x++) {
      const t = groundTop(x)
      for (let y = t; y <= H; y++) {
        const e = y - t
        // Turf in level bands, darker toward us.
        let v = gv - 0.34 * smooth((y - 156) / 42)
        // Broad swells in the turf, and the tree's shadow thrown away from the light.
        v += 0.1 * (noise(x * 0.045, y * 0.16, 47) - 0.5)
        // Patches of lighter and darker grass, wider than tall, as on a real slope.
        const pn = noise(x * 0.09, y * 0.3, 49)
        if (pn > 0.68) v += 0.09
        else if (pn < 0.3) v -= 0.07
        const sx = TREE.x0 - side(TREE.x0) * 10
        const sh = ((x + 0.5 - sx) / 16) ** 2 + ((y + 0.5 - groundTop(TREE.x0) - 3) / 3.2) ** 2
        if (sh < 1) v -= 0.16 * smooth((1 - sh) * 3)
        let c = tone(P.grass, v, x, y, 0.05)
        if (e === 0) c = P.grass[n - 1]
        else if (e === 1) c = P.grass[n - 2]
        else if (e === 2 && hash(x, y, 41) > 0.5) c = P.grass[n - 3]
        ground.set(x, y, c)
      }
    }
    // Tufts on a loose grid: a lit tip over a darker root, catching the light like the edge.
    const r = rng(43)
    for (let gy = 0; gy < 60; gy += 4) {
      for (let gx = 0; gx < W; gx += 7) {
        const x = gx + Math.floor(r() * 6)
        const e = gy + Math.floor(r() * 3) + 3
        const y = groundTop(x) + e
        if (y >= H - 1 || r() < 0.5) continue
        const v = gv - 0.34 * smooth((y - 156) / 42)
        ground.set(x, y, tone(P.grass, v + 0.22, x, y, 0))
        ground.set(x - 1, y + 1, tone(P.grass, v + 0.12, x, y, 0))
        ground.set(x + 1, y + 1, tone(P.grass, v + 0.12, x, y, 0))
        ground.set(x, y + 1, tone(P.grass, v - 0.14, x, y, 0))
      }
    }
    // Pebbles half sunk in the turf on the knoll: a lit top, a dark base.
    if (P.pebbles !== false) {
      const rp = rng(57)
      for (let k = 0; k < 9; k++) {
        const x = 214 + Math.floor(rp() * 102)
        const y = groundTop(x) + 4 + Math.floor(rp() * 30)
        if (y >= H - 1 || Math.abs(x - CAIRN.x) < 6) continue
        const w = 2 + Math.floor(rp() * 2)
        for (let i = 0; i < w; i++) {
          ground.set(x + i, y, P.stone[5 + (i === 0 ? 1 : 0)])
          ground.set(x + i, y + 1, P.stone[2])
        }
      }
    }
    // Small flowers in clusters on the knoll (and a few loose ones), each a head over a dark stem.
    if (P.flowers) {
      const rc = rng(59)
      for (let k = 0; k < 9; k++) {
        const cx = 210 + Math.floor(rc() * 106)
        const cy = groundTop(cx) + 3 + Math.floor(rc() * 28)
        const c = P.flowers[Math.floor(rc() * P.flowers.length)]
        for (let j = 0; j < 5; j++) {
          const x = cx + Math.floor(rc() * 6) - 3
          const y = cy + Math.floor(rc() * 3) - 1
          if (y >= H - 1 || y < groundTop(x) + 2) continue
          ground.set(x, y, c)
          ground.set(x, y + 1, P.grass[2])
        }
      }
      const rf = rng(53)
      for (let k = 0; k < 70; k++) {
        const x = 2 + Math.floor(rf() * (W - 4))
        const e = 2 + Math.floor(rf() ** 1.6 * 34)
        const y = groundTop(x) + e
        const c = P.flowers[Math.floor(rf() * P.flowers.length)]
        if (y >= H - 1 || (x > 150 && x < 205)) continue
        ground.set(x, y, c)
        ground.set(x, y + 1, P.grass[2])
        if (rf() < 0.3) ground.set(x + 1, y, c)
      }
    }
  }
  const rocks = new Layer('rocks')
  for (const [rx0, sink, rx, ry] of ROCKS) {
    const cy = groundTop(rx0) + sink
    const sd = side(rx0)
    for (let y = Math.floor(cy - ry); y < H; y++) {
      for (let x = Math.floor(rx0 - rx); x <= rx0 + rx; x++) {
        const nx = (x + 0.5 - rx0) / rx
        const ny = (y + 0.5 - cy) / ry
        if (nx * nx + ny * ny >= 1 || y > groundTop(x) + 4) continue
        let v = 0.45 + 0.28 * nx * sd - 0.3 * ny + (hash(x, y, 77) > 0.85 ? -0.12 : 0)
        let c = tone(P.stone, v, x, y, 0.12)
        const nyUp = ((y - 0.5 - cy) / ry) ** 2 + nx * nx
        if (nyUp >= 1) c = P.stone[P.stone.length - 1 - (nx * sd < -0.3 ? 1 : 0)]
        rocks.set(x, y, c)
      }
    }
  }

  // The cairn: rounded stones of uneven size stacked a little off true, each lit along its
  // top and on the light side, dark where it sits on the one below.
  const cairn = new Layer('cairn')
  {
    const sd = side(CAIRN.x)
    let y = groundTop(CAIRN.x) + 2
    CAIRN.stones.forEach(([dx, w, h], i) => {
      const cx = CAIRN.x + dx + 0.5
      const cy = y - h / 2
      const rx = w / 2
      const ry = h / 2 + 0.3
      const tilt = (hash(i, 3, 9) - 0.5) * 0.5
      for (let yy = Math.floor(cy - ry - 1); yy <= cy + ry; yy++) {
        for (let xx = Math.floor(cx - rx - 1); xx <= cx + rx; xx++) {
          const nx = (xx + 0.5 - cx) / rx
          const ny = (yy + 0.5 - cy) / ry - tilt * nx
          if (nx * nx + ny * ny * ny * ny >= 1) continue
          let v = 0.46 + 0.3 * nx * sd - 0.32 * ny + (hash(i, 7, 9) - 0.5) * 0.2
          if (hash(xx, yy, 13) > 0.9) v -= 0.12
          let c = tone(P.stone, v, xx, yy, 0.1)
          const above = (nx * nx + ((yy - 0.5 - cy) / ry - tilt * nx) ** 4) >= 1
          const below = (nx * nx + ((yy + 1.5 - cy) / ry - tilt * nx) ** 4) >= 1
          if (above) c = P.stone[sd * nx > -0.2 ? P.stone.length - 1 : P.stone.length - 2]
          else if (below) c = P.stone[0]
          cairn.set(xx, yy, c)
        }
      }
      y -= h
    })
  }

  // Grass blades: dark below, glowing toward the tip; the upper part goes to a layer that sways.
  const blade = (still, tips, bx, by, h, lean, k) => {
    const steps = Math.ceil(h * 1.5)
    let last = null
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const x = Math.round(bx + lean * t * t)
      const y = Math.round(by - h * t)
      const key = x + ',' + y
      if (key === last) continue
      last = key
      const n = P.grass.length
      const c = t > 0.8 ? P.grass[n - 1 - (k % 2)] : t > 0.55 ? P.grass[n - 3] : t > 0.3 ? P.grass[n - 5 + (k % 2)] : P.grass[n - 7 + (k % 2)]
      ;(t > 0.55 ? tips : still).set(x, y, c)
      if (k % 5 === 0 && t > 0.8) (t > 0.55 ? tips : still).set(x + (lean > 0 ? -1 : 1), y, P.grass[n - 2])
    }
  }
  const grass = new Layer('grass')
  const tipsL = []
  {
    const r = rng(33)
    // Clumps along the edge, taller toward us at the bottom, shorter up on the knoll; each
    // clump fans out from one root.
    for (let ci = 0; ci < 12; ci++) {
      const tips = new Layer('tips' + ci)
      for (let c = 0; c < 3; c++) {
        const rx0 = ci * 27 + 4 + Math.round(r() * 22)
        const near = smooth((groundTop(rx0) - 150) / 40)
        for (let i = 0; i < 5; i++) {
          const bx = rx0 + i - 2 + Math.round((r() - 0.5) * 2)
          const by = groundTop(bx) + 1
          const h = (2.5 + near * 6.5) * (0.45 + 0.6 * r()) * (i === 2 ? 1.25 : 1)
          blade(grass, tips, bx, by, h, (-(0.25 + r() * 0.4) + (i - 2) * 0.12) * h * 0.6, i + ci)
        }
      }
      const d = 4 + Math.floor(r() * 3)
      tips.anim = anim('gs', '--d:' + d + 's;--l:' + -Math.round((ci / 12) * d * 10) / 10 + 's')
      tips.coats = Number(process.env.GSCOATS ?? 2)
      tipsL.push(tips)
    }
  }

  // ------------------------------------------------ the tree
  const trunk = new Layer('trunk')
  const crown = new Layer('crown')
  const crownTips = []
  {
    const sd = side(TREE.x0)
    const y0 = groundTop(TREE.x0) + 1
    const bez = t => [
      (1 - t) * (1 - t) * TREE.x0 + 2 * (1 - t) * t * TREE.x1 + t * t * TREE.x2,
      (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * TREE.y1 + t * t * TREE.y2,
    ]
    const steps = 120
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const [x, y] = bez(t)
      const w = lerp(7, 2.4, Math.pow(t, 0.7)) + (t < 0.06 ? (0.06 - t) * 70 : 0)
      const n = Math.max(1, Math.round(w))
      for (let k = 0; k < n; k++) {
        const cx = Math.floor(x - n / 2 + k + 0.5)
        const q = n === 1 ? 0.5 : k / (n - 1)
        const lit = sd > 0 ? q : 1 - q
        let c = tone(P.bark, 0.1 + 0.55 * lit + (hash(cx, Math.round(y), 3) > 0.8 ? -0.1 : 0), cx, y, 0.2)
        if (lit > 0.99 && n > 1) c = P.bark[4]
        trunk.set(cx, y, c)
      }
    }
    // Branches out to the pads.
    for (const p of PADS) {
      if (p.from >= 1) continue
      const [bx, by] = bez(p.from)
      const ex = p.x + p.rx * 0.3
      const ey = p.y + 1
      for (const [x, y] of line(bx, by, ex, ey)) {
        trunk.set(x, y, P.bark[2])
        trunk.set(x, y + 1, P.bark[0])
      }
    }
    // The pads: clumps of small leaf puffs in a flat spray, lit from above, creased where one
    // clump rolls over another, dark beneath; their downwind ends sway.
    const Lv = norm3([0.35 * sd, -0.85, 0.45])
    for (const p of PADS) {
      const r = rng(90 + p.seed)
      const puffs = []
      const n = Math.max(2, Math.round(p.rx / 3.2))
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1)
        const rad = p.ry * (0.85 + 0.35 * r()) * (1 - 0.25 * Math.abs(u - 0.6))
        puffs.push({ x: p.x - p.rx + rad * 0.8 + u * (2 * p.rx - rad * 1.6), y: p.y + (r() - 0.5) * 1.6, r: rad, z: r() })
        if (rad > 3) puffs.push({ x: p.x - p.rx + u * 2 * p.rx + (r() - 0.5) * 3, y: p.y - rad * 0.55, r: rad * 0.6, z: rad * 0.4 + r() })
      }
      const tips = new Layer('ct' + p.seed)
      for (let y = Math.floor(p.y - p.ry * 2 - 2); y <= p.y + p.ry + 2; y++) {
        for (let x = Math.floor(p.x - p.rx - 4); x <= p.x + p.rx + 4; x++) {
          let best = null
          let bz = -Infinity
          let z2 = -Infinity
          for (const q of puffs) {
            const dx = x + 0.5 - q.x
            const dy = (y + 0.5 - q.y) * 1.25
            const d2 = dx * dx + dy * dy
            const rr = q.r * (1 + (noise(x * 0.6, y * 0.6, 70 + p.seed) - 0.5) * 0.35)
            if (d2 >= rr * rr) continue
            const nz = Math.sqrt(rr * rr - d2)
            const z = nz + q.z
            if (z > bz) {
              z2 = bz
              bz = z
              best = { q, dx, dy, nz, rr }
            } else if (z > z2) z2 = z
          }
          if (!best) continue
          const { dx, dy, nz, rr } = best
          let v = (P.leafBright ?? 0.42) + 0.55 * ((dx / rr) * Lv[0] + (dy / rr) * Lv[1] + (nz / rr) * Lv[2])
          if (bz - z2 < 1.2 && dy > -rr * 0.2) v -= 0.2
          v -= 0.25 * smooth((y + 0.5 - p.y) / (p.ry + 1))
          if (hash(x, y, 88) > 0.93) v += 0.1
          const c = tone(P.leaf, v, x, y, 0.1)
          crown.set(x, y, c)
          if (x < p.x - p.rx * 0.55) tips.set(x, y, c)
        }
      }
      tips.anim = anim('ts', '--d:' + (6 + p.seed) + 's;--l:' + -Math.round(p.seed * 13) / 10 + 's')
      tips.coats = Number(process.env.CTCOATS ?? 2)
      crownTips.push(tips)
    }
    // The pads' rim: cells open above on the lit side.
    for (const [k] of [...crown.m]) {
      const [x, y] = cellXY(k)
      if (!crown.has(x, y - 1) && (sd > 0 ? !crown.has(x + 2, y - 1) : !crown.has(x - 2, y - 1))) crown.set(x, y, P.leaf[P.leaf.length - 1])
    }
    for (const t of crownTips) for (const [k] of t.m) t.m.set(k, crown.m.get(k))
    // Encoding: when the leaf tips lean a cell left, the cell they leave shows the pad's own copy,
    // the colour of the tip's right-hand cell, while the pad cell beneath that tip cell is the
    // one to its left: it showed between the two as a line. That pad cell is under a tip at
    // either place the tips hold, so it never shows: it takes the colour of the cell to its right.
    if (!process.env.NOHIDDEN) {
      const ends = new Set()
      for (const t of crownTips) for (const k of t.m.keys()) if (!t.m.has(k + 1) && crown.m.has(k + 1)) ends.add(k)
      for (const t of crownTips) {
        for (const k of t.m.keys()) {
          if (!ends.has(k) || !t.m.has(k - 1) || ends.has(k - 1)) continue
          crown.m.set(k - 1, crown.m.get(k))
        }
      }
    }
  }

  // Size: colours of the ground, the tree, the rocks and the spires within MERGE levels (largest
  // channel step) of a commoner one take its colour (night's darkest tones lie 2-4 levels apart).
  // Only where the size needs it: day fits without, sunset and night need 4 levels.
  const merge = MERGE ?? MERGE_BY[name]
  if (merge) mergeNear([ground, rocks, cairn, grass, trunk, crown, ...crownTips, ...tipsL, ...spireLs], merge)

  // Where a swaying tip touches a still cell of its own colour (a grass tip on its blade or the
  // turf's lit edge; a leaf tip on the pad it left), the tip is a separate shape, so whatever
  // lies beneath its edge shows between the two by up to a quarter. For each place the tips
  // hold (grass: 0, 1 and 2 cells left; leaf tips: 1 cell left, as at 0 they lie on their own
  // copies), a still copy of the cells on both sides of each such joint lies under the tips,
  // shown only while those tips hold there (as Tide Line's): the tip's edge then lies over its
  // own colour. The copy is hidden under the tip and under the still cell, so nothing else
  // changes.
  const stillAt = new Map()
  for (const L of [ground, rocks, cairn, grass, trunk, crown]) for (const [k, c] of L.m) stillAt.set(k, c)
  const ctAt = new Set()
  for (const t of crownTips) for (const k of t.m.keys()) for (const d of [-1, 0, 1]) ctAt.add(k + d)
  const joints = (tips, offsets, cls, skip) => {
    const layers = []
    for (const d of offsets) {
      const J = new Layer(tips.name + 'j' + d)
      for (const [k, c] of tips.m) {
        const kd = k - d
        for (const n of [kd - 1, kd + 1, kd - ROW, kd + ROW]) {
          const sc = stillAt.get(n)
          if (sc === undefined || tips.m.has(n + d) || skip?.has(n) || apart(sc, c) > JOINT_T) continue
          J.m.set(kd, c)
          J.m.set(n, sc)
        }
      }
      J.anim = anim(cls + d, '', d ? " opacity='0'" : '')
      if (J.size) layers.push(J)
    }
    return { wrap: "<g style='" + tips.anim.style + "'>", end: '</g>', layers }
  }
  const nonEmpty = g => g.layers.length
  const jointsL = process.env.NOJOINTS ? [] : tipsL.map(t => joints(t, [0, 1, 2], 'j', ctAt)).filter(nonEmpty)

  items.push(ground, rocks, cairn, grass, trunk, crown, ...crownTips, ...jointsL, ...tipsL)

  if (process.env.PROBE) probe(items, PROBED)
  return E.encode(items, kf, P)
}

// Debug: PROBE='x,y;x,y' prints, for each probed cell and its 4 neighbours, the colour every
// layer paints there (planes at T=0), back to front.
const PROBED = []
function probe(items, extra) {
  const all = []
  const walk = list => {
    for (const it of list) {
      if (it instanceof Layer) all.push([it.name + (it.anim ? '*' : ''), it, 0])
      else if (it.under) all.push([it.layer.name, it.layer, 0])
      else if (it.layers) walk(it.layers)
      else if (it.planeK !== undefined) for (const [n, L, tw, , step] of extra.filter(e => e[3] === it.planeK)) all.push([n, L, tw, Math.floor(Number(process.env.T ?? 0) / step + 1e-9)])
    }
  }
  walk(items)
  for (const p of process.env.PROBE.split(';')) {
    const [px, py] = p.split(',').map(Number)
    console.log('-- probe', px, py)
    for (const [dx, dy, tag] of [[0, 0, 'c'], [-1, 0, 'L'], [1, 0, 'R'], [0, -1, 'U'], [0, 1, 'D']]) {
      const x = px + dx
      const y = py + dy
      const got = []
      for (const [n, L, tw, sh = 0] of all) {
        const xx = tw ? (((x + sh) % tw) + tw) % tw : x
        const c = L.m.get((y + 1000) * ROW + xx + 1000)
        if (c) got.push(n + '=' + c)
      }
      console.log('  ' + tag + ' ' + x + ',' + y + ': ' + got.join(' '))
    }
  }
}

// ---------------------------------------------------------------- motion helpers

// A drift of `a` whole cells as eased keyframes (the class runs it there and back).
function swingKf(name, a, n = 20) {
  let k = ''
  let last = null
  for (let i = 0; i <= n; i++) {
    const v = Math.round((a * (1 - Math.cos((Math.PI * i) / n))) / 2)
    const p = Math.round((i / n) * 1e4) / 100
    if (v !== last || i === n) k += p + '%{transform:' + (v ? 'translateX(' + v + 'px)' : 'none') + '}'
    last = v
  }
  return '@keyframes ' + name + '{' + k + '}'
}
function swingAxis(name, axis, a, b, n) {
  let k = ''
  let last = null
  for (let i = 0; i <= n; i++) {
    const v = Math.round(a + ((b - a) * (1 - Math.cos((Math.PI * i) / n))) / 2)
    const p = Math.round((i / n) * 1e4) / 100
    if (v !== last || i === n) k += p + '%{transform:translate' + axis + '(' + v + 'px)}'
    last = v
  }
  return '@keyframes ' + name + '{' + k + '}'
}

// ---------------------------------------------------------------- encoding

const PATTERN_MIN = 55
const runsOf = s => (s.match(/[hv]-?\d/g) ?? []).length
const BAND_T = Number(process.env.BAND_T ?? 20)
const JOINT_T = Number(process.env.JOINT_T ?? 8)
const MERGE = process.env.MERGE ? Number(process.env.MERGE) : null
const MERGE_BY = { day: 0, sunset: 4, night: 4 }
const SKIRT_T = Number(process.env.SKIRT_T ?? 20)
const SKIRT_SAME = Number(process.env.SKIRT_SAME ?? 32)
// The opacities the light on the cloud tops (class lt) takes.
const LT_OPS = [...new Set(Array.from({ length: 21 }, (_, i) => Math.round((0.62 + 0.38 * (0.5 + 0.5 * Math.cos((Math.PI * 2 * i) / 20))) * 100) / 100))]
// Colours of the layers within `lv` levels (in every channel) of a commoner one take its colour:
// the picture changes by at most that step, and the layers write shorter. One map for all the
// layers, so copies (the tree's swaying tips) stay equal to what they copy.
function mergeNear(layers, lv) {
  const count = new Map()
  for (const L of layers) for (const c of L.m.values()) count.set(c, (count.get(c) ?? 0) + 1)
  const cols = [...count.keys()].sort((a, b) => count.get(b) - count.get(a))
  const near = (a, b) => {
    const x = rgbOf(a)
    const y = rgbOf(b)
    return Math.max(Math.abs(x[0] - y[0]), Math.abs(x[1] - y[1]), Math.abs(x[2] - y[2])) <= lv
  }
  const to = new Map()
  const kept = new Set()
  for (const c of cols) {
    if (to.has(c)) continue
    kept.add(c)
    for (const d of cols) if (d !== c && !to.has(d) && !kept.has(d) && near(c, d)) to.set(d, c)
  }
  for (const L of layers) for (const [k, c] of L.m) if (to.has(c)) L.m.set(k, to.get(c))
  if (process.env.SHOWMERGE) console.log("merges", [...to].map(([a, b]) => a + ">" + b + "(" + count.get(a) + ")").join(" "))
  return to.size
}
const rgbOf = h => {
  const s = h.slice(1).length === 3 ? h.slice(1).replace(/./g, c => c + c) : h.slice(1)
  const n = parseInt(s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
// How far apart two colours look, as the mean of the channel differences (0..255).
const apart = (a, b) => {
  const x = rgbOf(a)
  const y = rgbOf(b)
  return (Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2])) / 3
}

function encoder() {
  const defs = []
  let ids = 0
  const nextId = () => {
    let n = ids++
    let s = ''
    do {
      s = String.fromCharCode(97 + (n % 26)) + s
      n = Math.floor(n / 26) - 1
    } while (n >= 0)
    return s
  }
  const stats = { patterns: 0, runs: 0, bands: 0, byLayer: new Map(), solo: new Map(), chars: new Map() }
  const count = (name, runs, chars = 0) => {
    stats.runs += runs
    stats.byLayer.set(name, (stats.byLayer.get(name) ?? 0) + runs)
    stats.chars.set(name, (stats.chars.get(name) ?? 0) + chars)
  }

  // A layer's cells, written by the seam-proof encoder (encode-local.mjs): wherever two colours
  // meet, the later one's edge lies over a solid run of the earlier one (or of the layer's
  // backing), so nothing from behind the layer shows through as a hairline at any window size.
  function cellsOf(L, ox = 0, oy = 0) {
    if (process.env.OLDENC) {
      // Debug: the encoder before the seam fix, for size comparisons.
      const plain = emitCells(L, ox, oy)
      const n = new Map()
      for (const c of L.m.values()) n.set(c, (n.get(c) ?? 0) + 1)
      if (n.size < 2) return plain
      let top = null
      for (const [c, k] of n) if (!top || k > top[1]) top = [c, k]
      const back = new Layer('back')
      const rest = new Layer('rest')
      for (const [k, c] of L.m) {
        back.m.set(k, top[0])
        if (c !== top[0]) rest.m.set(k, c)
      }
      const backed = emitCells(back, ox, oy) + emitCells(rest, ox, oy)
      return runsOf(backed) <= runsOf(plain) * 1.08 + 6 ? backed : plain
    }
    // Experiments: ENCMAP='[["regex", {opts}], ...]' (first match on the layer name wins).
    const hit = process.env.ENCMAP && JSON.parse(process.env.ENCMAP).find(([rx]) => new RegExp(rx).test(L.name))
    return emitSafe(L, { ox, oy, edge: true, edgeNear: 8, wide: 120, ...(L.enc ?? {}), ...(hit ? hit[1] : {}) })
  }

  function draw(L) {
    const plain = cellsOf(L)
    const runs = runsOf(plain)
    count(L.name, runs, plain.length)
    if (runs < PATTERN_MIN) return plain
    stats.patterns++
    // The tile spans whole cells with a clear cell all round: at its edges the raster would
    // otherwise pick up the far side.
    const b = bounds(L)
    const x = b.x0 - 1
    const y = b.y0 - 1.5
    const id = nextId()
    defs.push('<pattern id="' + id + '" width="1" height="1">' + cellsOf(L, x, y) + '</pattern>')
    return '<rect x="' + x + '" y="' + y + '" width="' + (b.x1 - b.x0 + 2) + '" height="' + (b.y1 - b.y0 + 2) + '" fill="url(#' + id + ')"/>'
  }

  // A band repeating every TW cells across, rows ya..yb, with a clear row above and below; the
  // rect is TW wider than the grid so it can roll left by TW.
  function tiled(L, TW, ya, yb) {
    if (!L.size) return ''
    const y = ya - 1.5
    const th = yb - ya + 3
    const id = nextId()
    const body = cellsOf(L, 0, y)
    count(L.name, runsOf(body), body.length)
    stats.patterns++
    defs.push('<pattern id="' + id + '" patternUnits="userSpaceOnUse" y="' + y + '" width="' + TW + '" height="' + th + '">' + body + '</pattern>')
    return '<rect y="' + y + '" width="' + (W + TW) + '" height="' + th + '" fill="url(#' + id + ')"/>'
  }

  // A big still layer over full rows: each row's commonest colour goes into a band stroke under
  // the cells (each band a row deeper than its rows, under the next, so no seam shows), and
  // only the cells that differ from it stay cells.
  function underlay(L) {
    const rows = new Map()
    for (const [k, c] of L.m) {
      const [x, y] = cellXY(k)
      if (x < 0 || x >= W) continue
      let r = rows.get(y)
      if (!r) rows.set(y, (r = { n: 0, count: new Map() }))
      r.n++
      r.count.set(c, (r.count.get(c) ?? 0) + 1)
    }
    const ys = [...rows.keys()].sort((a, b) => a - b)
    const colourOf = new Map()
    for (const y of ys) {
      const r = rows.get(y)
      if (r.n < W) continue
      let best = null
      for (const [c, n] of r.count) if (!best || n > best[1]) best = [c, n]
      colourOf.set(y, best[0])
    }
    const full = new Map(L.m)
    for (const [k, c] of [...L.m]) if (colourOf.get(cellXY(k)[1]) === c) L.m.delete(k)
    // A cell left over a band shows that band through its upper and lower edges (each band runs
    // a row deeper, under the next). Where the band is far from the cell and from the band
    // colour above or below it, that is a hairline: keep that neighbour as a cell too, so the
    // edge lies between two cells the encoder joins over one another (as Tide Line's).
    for (const [k, c] of [...L.m]) {
      const y = cellXY(k)[1]
      const under = colourOf.get(y)
      if (!under || apart(under, c) <= BAND_T) continue
      for (const n of [k - ROW, k + ROW]) {
        const nc = full.get(n)
        if (nc === undefined || L.m.has(n)) continue
        if (apart(under, nc) > BAND_T) L.m.set(n, nc)
      }
    }
    // What lies beneath each edge between the cells left: the band of its row, or across rows
    // the two bands that meet there (a row with no band of its own lies over the band above
    // it, which runs a row deeper; below that, nothing is known).
    const bandAt = y => colourOf.get(y) ?? colourOf.get(y - 1)
    L.enc = {
      ...(L.enc ?? {}),
      T: BAND_T,
      under: (k, n) => {
        const yk = cellXY(k)[1]
        const yn = cellXY(n)[1]
        return yk === yn ? bandAt(yk) : [bandAt(Math.min(yk, yn)), bandAt(Math.max(yk, yn))]
      },
    }
    let out = ''
    let i = 0
    while (i < ys.length) {
      const c = colourOf.get(ys[i])
      if (!c) {
        i++
        continue
      }
      let j = i
      while (j + 1 < ys.length && ys[j + 1] === ys[j] + 1 && colourOf.get(ys[j + 1]) === c) j++
      const h = j - i + 1
      out += '<path stroke="' + c + '" stroke-width="' + (h + 1) + '" d="M0 ' + f2(ys[i] + h / 2) + 'h' + W + '"/>'
      stats.bands++
      i = j + 1
    }
    return out
  }

  // Cells of a still layer that still layers in front always cover are dropped. A covered cell
  // next to one of the layer's cells that still shows is kept (as Moon Keep's): the edge of the
  // layer in front then lies over it, not over whatever is further down.
  function cull(items) {
    const covered = new Set()
    const walk = list => {
      for (let i = list.length - 1; i >= 0; i--) {
        const L = list[i]
        if (!(L instanceof Layer) || L.anim) continue
        const gone = [...L.m.keys()].filter(k => covered.has(k))
        const keep = new Set(gone.filter(k => [k - 1, k + 1, k - ROW, k + ROW].some(n => L.m.has(n) && !covered.has(n))))
        for (const k of gone) if (!keep.has(k)) L.m.delete(k)
        if (!L.noCover) for (const k of L.m.keys()) if (!keep.has(k)) covered.add(k)
      }
    }
    walk(items)
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
      if (L.under) {
        flush()
        out += underlay(L.layer) + draw(L.layer)
        continue
      }
      if (L.wrap) {
        flush()
        out += L.wrap + renderLayers(L.layers) + L.end
        continue
      }
      if (!L.size) continue
      if (!L.anim) {
        // Still cells outside the grid never show: the viewport is sliced.
        still ??= new Layer('')
        still.name += (still.name ? '+' : '') + L.name
        still.enc ??= L.enc
        if (process.env.STATS) stats.solo.set(L.name, runsOf(emitCells(L)))
        for (const [k, c] of L.m) {
          const [x, y] = cellXY(k)
          if (x >= 0 && x < W && y >= -1 && y <= H) still.m.set(k, c)
        }
        continue
      }
      flush()
      let inner = draw(L)
      // A moving layer drawn in `coats` coats (as Tide Line's): inside a cell nothing changes,
      // and at an edge that falls inside a pixel, what lies beneath shows through less (a
      // quarter at most with one coat, about a seventh with two).
      if ((L.coats ?? 1) > 1) {
        if (/^<rect [^>]*\/>$/.test(inner)) inner = inner.repeat(L.coats)
        else {
          const id = nextId()
          inner = '<g id="' + id + '">' + inner + '</g>' + ('<use href="#' + id + '"/>').repeat(L.coats - 1)
        }
      }
      out += '<g class="' + L.anim.cls + '"' + (L.anim.style ? ' style="' + L.anim.style + '"' : '') + L.anim.extra + '>' + inner + '</g>'
    }
    flush()
    return out
  }

  function encode(items, kf, P) {
    cull(items)
    const body = '<svg viewBox="0 -.5 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMax slice">' + renderLayers(items) + '</svg>'
    const from = l => 'calc(' + l + ' + var(--m))'
    const lt = []
    for (let i = 0; i <= 20; i++) lt.push(i * 5 + '%{opacity:' + f2(0.62 + 0.38 * (0.5 + 0.5 * Math.cos((Math.PI * 2 * i) / 20))) + '}')
    const RULES = [
      // The cloud planes roll left a cell at a time, each at its own speed.
      '.rl{animation:rl var(--d) steps(var(--n)) var(--m) infinite}@keyframes rl{to{transform:translateX(var(--w))}}',
      // The light on the cloud tops swells and ebbs.
      '.lt{animation:lt var(--d) steps(1) ' + from('var(--l)') + ' infinite}@keyframes lt{' + lt.join('') + '}',
      // High clouds drift a cell at a time, there and back.
      '.cd{animation:var(--d) steps(1) ' + from('var(--l)') + ' infinite alternate}',
      ...[...kf.entries()].map(([k, t]) => '.' + k + '{animation-name:' + k + '}' + t),
      // Grass tips and the downwind ends of the tree's pads lean with the gusts.
      '.gs{animation:gs var(--d) steps(1) ' + from('var(--l)') + ' infinite}',
      '@keyframes gs{0%{transform:none}25%{transform:translateX(-1px)}55%{transform:translateX(-2px)}70%{transform:translateX(-1px)}85%,100%{transform:none}}',
      // Under the tips, the copies of their joints, each shown while the tips hold its place.
      '.j0,.j1,.j2{animation:j0 var(--d) steps(1) ' + from('var(--l)') + ' infinite}.j1{animation-name:j1}.j2{animation-name:j2}',
      '@keyframes j0{0%{opacity:1}25%{opacity:0}85%,100%{opacity:1}}',
      '@keyframes j1{0%{opacity:0}25%{opacity:1}55%{opacity:0}70%{opacity:1}85%,100%{opacity:0}}',
      '@keyframes j2{0%{opacity:0}55%{opacity:1}70%,100%{opacity:0}}',
      '.ts{animation:ts var(--d) steps(1) ' + from('var(--l)') + ' infinite}',
      '@keyframes ts{0%{transform:none}30%{transform:translateX(-1px)}65%,100%{transform:none}}',
      // Wisps rise a cell every 0.4 s, drift downwind a cell a second, and fade in and out.
      '.wy{animation:wy var(--d) steps(1) ' + from('var(--l)') + ' infinite}',
      '@keyframes wy{0%{transform:none;animation-timing-function:steps(30)}75%,100%{transform:translateY(-30px)}}',
      '.wx{animation:wx var(--d) steps(1) ' + from('var(--l)') + ' infinite}',
      '@keyframes wx{0%{transform:none;animation-timing-function:steps(12)}75%,100%{transform:translateX(-12px)}}',
      '.wo{animation:wo var(--d) steps(1) ' + from('var(--l)') + ' infinite}',
      '@keyframes wo{0%{opacity:0}5%{opacity:.3}10%{opacity:.6}15%,50%{opacity:1}57.5%{opacity:.7}65%{opacity:.4}72.5%,100%{opacity:0}}',
    ]
    if (P.bird) {
      // Birds circle: a slow swing across and a swing up and down a quarter turn behind it.
      RULES.push(
        '.cx{animation:cx 16s steps(1) ' + from('var(--l)') + ' infinite alternate}' + swingAxis('cx', 'X', -24, 24, 40),
        '.cy{animation:cy 16s steps(1) ' + from('calc(var(--l) - 8s)') + ' infinite alternate}' + swingAxis('cy', 'Y', -6, 6, 20),
        '.fa{animation:fa var(--f) steps(1) ' + from('var(--l)') + ' infinite}@keyframes fa{0%{opacity:1}50%,100%{opacity:0}}',
        '.fb{animation:fb var(--f) steps(1) ' + from('var(--l)') + ' infinite}@keyframes fb{0%{opacity:0}50%,100%{opacity:1}}',
      )
    }
    if (P.rays) {
      RULES.push(
        '.ry{animation:ry 24s steps(1) ' + from('-6s') + ' infinite}',
        '@keyframes ry{0%{opacity:1}' + [[30, 0.85], [35, 0.7], [40, 0.55], [45, 0.45], [70, 0.55], [75, 0.7], [80, 0.85], [85, 1]].map(([p, o]) => p + '%{opacity:' + f2(o) + '}').join('') + '100%{opacity:1}}',
      )
    }
    if (P.stars) RULES.push('.tk{animation:tk var(--d) steps(1) ' + from('var(--l)') + ' infinite}', '@keyframes tk{0%,84%{opacity:1}88%{opacity:.8}92%{opacity:.62}96%{opacity:.8}100%{opacity:1}}')
    RULES.push('@media (prefers-reduced-motion:reduce){:root *{animation:none!important}}')
    const CSS = RULES.join('')
    let svg =
      '<svg xmlns="http://www.w3.org/2000/svg" fill="none" font-family="a" color="a" style="--m:0s">' +
      '<style>' + CSS + '</style><defs>' + defs.join('') + '</defs>' + body + '</svg>'
    svg = svg.replaceAll('"', "'")
    return { svg, stats, css: CSS.length }
  }

  return { defs, stats, draw, tiled, encode }
}

// ---------------------------------------------------------------- write

const LIMIT = 131072
fs.mkdirSync(path.join(HERE, 'out'), { recursive: true })
const only = process.argv.slice(2)
for (const name of only.length ? only : Object.keys(MOMENTS)) {
  const { svg, stats, css } = scene(name)
  // What the app's scrub leaves: no @keyframes, and every <x/> written out as <x></x>.
  const kfLen = [...svg.matchAll(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g)].reduce((n, m) => n + m[0].length, 0)
  const scrubbed = svg.length - kfLen + [...svg.matchAll(/<(\w+)[^>]*\/>/g)].reduce((n, m) => n + 2 + m[1].length, 0)
  if (scrubbed > LIMIT || svg.length > LIMIT) console.log('TOO BIG')
  fs.writeFileSync(path.join(HERE, 'out', 'cloud-sea-' + name + '.svg'), svg)
  console.log(name.padEnd(7), svg.length, 'chars (scrubbed ~' + scrubbed + '), css', css, '| patterns', stats.patterns, '| runs', stats.runs, '| bands', stats.bands)
  if (process.env.STATS) {
    const top = [...stats.byLayer].sort((a, b) => b[1] - a[1]).slice(0, 30)
    console.log('  ' + top.map(([n, r]) => n.slice(0, 40) + ':' + r).join('  '))
    const groupSum = rx => [...stats.chars].filter(([n]) => rx.test(n)).reduce((a, [, v]) => a + v, 0)
    console.log('  sums: joints ' + groupSum(/j\d$/) + ' tips ' + groupSum(/^tips\d+$/) + ' ct ' + groupSum(/^ct/) + ' wisps ' + groupSum(/^wisp/) + ' hi ' + groupSum(/^hi/) + ' rims ' + groupSum(/^rim/) + ' stars ' + groupSum(/^star/) + ' birds ' + groupSum(/^b[ab]/))
    console.log('  chars: ' + [...stats.chars].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([n, r]) => n.slice(0, 30) + ':' + r).join('  '))
    console.log('  solo: ' + [...stats.solo].sort((a, b) => b[1] - a[1]).map(([n, r]) => n + ':' + r).join('  '))
  }
}
