// Tide Line: a low view from the beach, waves rolling in and leaving foam on shining wet sand,
// as one animated pixel-art SVG in three moments (sunrise, sunset, night).
// node build.mjs [moment ...]  ->  out/tide-line-<moment>.svg
//
// Painted on a 320 x 200 cell grid (x right, y down) and encoded the way Sunfield's build does
// it (../../../sunfield/tools/build.mjs): cells as 1-cell stroke runs, at most 64 runs a path,
// big still layers in patterns, nested pinned viewports, CSS motion in steps on a 0.05 s clock.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Layer, bounds, clamp, hex, lerp, rgb, rng, smooth, tone } from '../../../sunfield/tools/pixel.mjs'
import { line } from '../../../sunfield/tools/painters.mjs'
// The engine's seam-proof encoder, in a local copy that also knows the band beneath an edge.
import { emitSafe } from './encode-local.mjs'
import { MOMENTS } from './moments.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const W = 320
const H = 200
const H0 = 104 // the first row of sea: the horizon
const SHORE = 147 // the resting water line
const SX = 228 // the column of the sun, the moon and their paths
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
// Foam lace: small near the edges between cells of a stretched Voronoi net.
function lace(x, y, seed, sx, sy) {
  const gx = Math.floor(x / sx)
  const gy = Math.floor(y / sy)
  let f1 = Infinity
  let f2_ = Infinity
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = (gx + i + 0.15 + 0.7 * hash(gx + i, gy + j, seed)) * sx
      const cy = (gy + j + 0.15 + 0.7 * hash(gx + i, gy + j, seed + 1)) * sy
      const d = Math.hypot((x + 0.5 - cx) / sx, (y + 0.5 - cy) / sy)
      if (d < f1) {
        f2_ = f1
        f1 = d
      } else if (d < f2_) f2_ = d
    }
  }
  return f2_ - f1
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
const bell = s => (Math.abs(s) < 1 ? 1 - s * s : 0)
const lumOf = c => {
  const [r, g, b] = rgb(c)
  return (0.3 * r + 0.55 * g + 0.15 * b) / 255
}

// ---------------------------------------------------------------- the scene

function scene(name) {
  const P = MOMENTS[name]
  const parts = [] // [pin, layers] in paint order
  const part = (pin, layers) => parts.push([pin, layers.filter(L => L && (L.wrap || L.under || L.size))])
  const css = []
  const anim = (cls, style = '', extra = '') => ({ cls, style, extra })
  const kfOnce = new Set()
  const addKf = (name, text) => {
    if (!kfOnce.has(name)) css.push(text)
    kfOnce.add(name)
  }

  // ------------------------------------------------ sky
  // Bands of the sky's ramp, three rows high in the upper sky and two near the horizon. Around
  // the sun (or moon) the bands bulge up: a cell there takes the colour of a lower row.
  const edges = []
  for (let t = -60; t < 58; t += 3) edges.push(t)
  for (let t = 58; t < 240; t += 2) edges.push(t)
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
  // The sky as painted, clouds and land included, for the mirror of the wet sand.
  const seen = new Map()
  const see = L => {
    for (const [k, c] of L.m) seen.set(k, c)
  }
  const seenAt = (x, y) => seen.get((y + 1000) * ROW + x + 1000)
  // A layer that stays put over a still one (shown and hidden, never moved) gets a skirt. Where
  // the colour beneath one of its edge cells differs a lot from that cell, and the cell just
  // outside matches it, the colour beneath shows along the edge as a line between two alike
  // colours. There the outside cell is added to the layer in the colour already there: it shows
  // exactly what lies under it, so nothing changes, and the edge now lies between two cells of
  // the layer, joined by the encoder. Cells in `blocked` may have something else over the still
  // layer and are left alone. A layer shown at partial opacity is matched as it shows: at each
  // opacity in `ops`, over the colour beneath.
  const skirt = (L, below, { blocked = null, ops = [1], T = 20, same = 32 } = {}) => {
    // The skirt lies on the layer's outer edge, so keep the layer's backing off it.
    L.enc = { ...(L.enc ?? {}), edge: true }
    for (const [k, c] of [...L.m]) {
      const bu = below.m.get(k)
      if (bu === undefined || apart(bu, c) <= T) continue
      for (const n of [k - 1, k + 1, k - ROW, k + ROW]) {
        if (L.m.has(n) || blocked?.has(n)) continue
        const bo = below.m.get(n)
        if (bo === undefined || apart(bu, bo) <= T) continue
        if (ops.some(op => apart(mix(bu, c, op), bo) <= same)) L.m.set(n, bo)
      }
    }
  }
  // Everything that stands on the horizon runs one row on under the sea (which covers it), so
  // the sea's top edge lies over the same colours as the row above it and no sky shows between.
  const underSea = L => {
    for (const [k, c] of [...L.m]) if (cellXY(k)[1] === H0 - 1) L.m.set(k + ROW, c)
  }

  const sky = new Layer('sky')
  for (let y = -1; y < H0; y++) for (let x = 0; x < W; x++) sky.set(x, y, skyAt(x, y))
  see(sky)
  underSea(sky)

  // Rays from the sun through the gaps in the clouds: wedges where the bands sit a little lower
  // (light) or higher (shade). They breathe slowly.
  const rays = new Layer('rays')
  if (P.rays) {
    const { x: rx, y: ry, list, reach } = P.rays
    for (let y = -1; y < H0; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x + 0.5 - rx
        const dy = ry - (y + 0.5)
        const d = Math.hypot(dx, dy)
        if (d < 16) continue
        const a = (Math.atan2(dy, dx) * 180) / Math.PI
        let s = 0
        for (const [deg, w, k] of list) {
          const q = 1 - Math.abs(a - deg) / w
          if (q > 0) s += k * Math.min(1, q * 1.6)
        }
        if (!s) continue
        const t = skyT(x, y) + s * smooth((d - 16) / 26) * Math.exp(-d / reach)
        const c = bandCols[band(t)]
        if (c !== sky.get(x, y)) rays.set(x, y, c)
      }
    }
    underSea(rays)
    rays.anim = anim('ry')
  }

  // Stars, a few of them dimming for a moment now and then.
  const starLayers = []
  if (P.stars) {
    const r = rng(211)
    const still = new Layer('stars')
    for (let i = 0; i < 110; i++) {
      const x = Math.floor(r() * W)
      const y = Math.floor(1 + Math.pow(r(), 1.4) * 92)
      const bright = i < 12
      if (Math.hypot(x - P.moon.x, y - P.moon.y) < 15) continue
      if (bright) {
        const L = new Layer('star' + i)
        L.set(x, y, P.stars[0])
        if (i < 6) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) L.set(x + dx, y + dy, P.stars[2])
        const d = 5 * (1 + Math.floor(r() * 4))
        L.anim = anim('tk', '--d:' + d + 's;--l:' + -Math.round(r() * d * 10) / 10 + 's')
        starLayers.push(L)
      } else still.set(x, y, P.stars[r() < 0.35 ? 1 : 2])
    }
    starLayers.unshift(still)
  }

  // The moon: a disc lit from the upper left, with a faint ring of halo.
  const moon = new Layer('moon')
  if (P.moon) {
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
  }

  // The sun: a pale disc with a warm rim, flattened a little near the horizon, its lower part
  // under the sea.
  const sun = new Layer('sun')
  if (P.sun) {
    const { x: cx, y: cy, r: R, sq, tones, halo } = P.sun
    for (let y = Math.floor(cy - R - 3); y < H0; y++) {
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
    underSea(sun)
  }

  // ------------------------------------------------ clouds
  // Solid streaks: a body in the cool shade of the sky, lit along the edge that faces the light
  // (the underside by a low sun, the top by the moon), brightest near the light.
  const C = P.clouds
  const cloudLayers = []
  for (const c of C.list) {
    const L = new Layer('cloud' + c.seed)
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
        if (c.base !== undefined && y > c.base + Math.round(Math.sin(x * 0.3 + c.seed) * 0.6)) continue
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
      let v = C.base + (c.lift ?? 0)
      v += C.rim * [1, 0.68, 0.42, 0.22, 0.1, 0][lit]
      if (edge && lit > 1) v += 0.06
      v += C.sun * Math.exp(-(((x - C.lx) / C.lw) ** 2) - ((y - C.ly) / 70) ** 2)
      v += (noise(x * 0.25, y * 0.6, c.seed + 9) - 0.5) * 0.08
      L.set(x, y, tone(C.tones, v, x, y, 0.18))
    }
    see(L)
    if (c.drift) {
      const [d, a, l] = c.drift
      addKf('d' + a, swingKf('d' + a, a))
      L.anim = anim('cd d' + a, '--d:' + d + 's;--l:' + -l + 's')
    }
    cloudLayers.push(L)
  }

  // ------------------------------------------------ land and boat on the horizon
  const headPts = [
    [-6, 30], [6, 32], [16, 34], [24, 35], [32, 33], [42, 28], [52, 24], [60, 21], [66, 18], [70, 13],
    [73, 8], [77, 6], [84, 5], [92, 3], [100, 2], [108, 1], [114, 0],
  ]
  const headTop = x => {
    for (let i = 0; i < headPts.length - 1; i++) {
      const [xa, ha] = headPts[i]
      const [xb, hb] = headPts[i + 1]
      if (x >= xa && x < xb) return H0 - Math.round(lerp(ha, hb, (x - xa) / (xb - xa)) + (noise(x * 0.4, 1, 77) - 0.5) * 2.2)
    }
    return H0
  }
  const stacks = [[86, 92, 7], [95, 98, 4], [101, 103, 2]]
  const land = new Set()
  for (let x = -6; x < 114; x++) for (let y = headTop(x); y < H0; y++) land.add(x + ',' + y)
  for (const [a, b, h] of stacks) {
    for (let x = a; x <= b; x++) {
      const s = (x - a) / (b - a) - 0.5
      const top = H0 - Math.round(h * (1 - s * s * 2.2))
      for (let y = top; y < H0; y++) land.add(x + ',' + y)
    }
  }
  const isLand = (x, y) => land.has(x + ',' + y)
  const head = new Layer('head')
  const HL = P.land
  for (const k of land) {
    const [x, y] = k.split(',').map(Number)
    const top = !isLand(x, y - 1)
    let v = HL.base + HL.haze * smooth((y - (H0 - 32)) / 32)
    v += (noise(x * 0.3, y * 0.2, 41) - 0.5) * 0.14
    // Ledges on the cliff face.
    if (x > 64 && x < 82 && (y + Math.round(x * 0.3)) % 5 === 0) v -= 0.12
    let c = tone(HL.tones, v, x, y, 0.15)
    const facing = !isLand(x + 1, y) || !isLand(x + 1, y - 1)
    if (top && facing) c = HL.rim[1]
    else if (top || (facing && !isLand(x + 1, y + 1))) c = HL.rim[0]
    head.set(x, y, c)
  }
  // The lighthouse on the crown of the headland, and its lamp, which turns: a slow glow.
  const LX = 25
  const lt = headTop(LX) - 1
  const T = HL.tower
  const tower = [
    [0, 0, 'w'], [1, 0, 's'], [0, -1, 'w'], [1, -1, 's'], [0, -2, 'b'], [1, -2, 'b'], [0, -3, 'w'], [1, -3, 's'],
    [0, -4, 'w'], [1, -4, 's'], [-1, -5, 'd'], [0, -5, 'd'], [1, -5, 'd'], [2, -5, 'd'], [0, -6, 'g'], [1, -6, 'g'],
    [0, -7, 'd'], [1, -7, 'd'], [-1, 1, 'd'], [2, 1, 'd'], [0, 1, 'd'], [1, 1, 'd'],
  ]
  for (const [dx, dy, k] of tower) head.set(LX + dx, lt + dy, T[k])
  const lamp = new Layer('lamp')
  if (P.lamp) {
    lamp.set(LX, lt - 6, P.lamp[0])
    lamp.set(LX + 1, lt - 6, P.lamp[0])
    for (const [dx, dy] of [[-1, -6], [2, -6], [0, -7], [1, -7], [0, -5], [1, -5]]) lamp.set(LX + dx, lt + dy, P.lamp[1])
    for (const [dx, dy] of [[-2, -6], [3, -6], [-3, -6], [4, -6], [-4, -6], [5, -6]]) lamp.set(LX + dx, lt + dy, P.lamp[2])
    lamp.anim = anim('lm')
  }
  if (P.windows) for (const [x, y] of [[44, H0 - 22], [48, H0 - 21], [55, H0 - 18], [38, H0 - 25], [61, H0 - 15]].slice(0, P.windows)) head.set(x, y, P.lamp[0])
  see(head)
  underSea(head)

  const island = new Layer('island')
  for (let x = 252; x < 330; x++) {
    const s = (x - 291) / 39
    const h = Math.round(5.5 * Math.pow(Math.max(0, 1 - s * s), 0.6) + (noise(x * 0.3, 5, 61) - 0.5) * 1.6 + (x > 270 && x < 280 ? 1.5 : 0))
    for (let y = H0 - h; y < H0; y++) island.set(x, y, y === H0 - h ? P.island[1] : P.island[0])
  }
  see(island)
  underSea(island)

  // A small sailing boat far out, drifting slowly along the horizon.
  const boat = new Layer('boat')
  {
    const bx = 150
    const sail = ['...x..', '...xx.', '..xxx.', '..xxxx', '.xxxxx', '...x..', 'xxxxxxx', '.xxxxx.']
    sail.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        if (row[i] !== 'x') continue
        const lit = j < 5 && (i === row.lastIndexOf('x'))
        boat.set(bx + i, H0 - 7 + j, lit ? P.boat[1] : P.boat[0])
      }
    })
    if (P.boatLight) boat.set(bx + 3, H0 - 9, P.boatLight)
    boat.anim = anim('bt')
  }

  // ------------------------------------------------ the sea
  // From the horizon to the water line: bands that run from bright far water, which mirrors the
  // sky by the horizon, to dark near water; swell lines and thin wavelets; the path of the sun
  // (or moon); and lines of spent foam in the surf.
  const SURF = 134
  const seaBot = x => SHORE - 1 + Math.round(Math.sin(x * 0.045 + 0.6) * 0.8 + (noise(x * 0.2, 3, 5) - 0.5) * 2)
  const S = P.sea
  const pathW = u => S.pathW[0] + S.pathW[1] * u
  const swellRows = [108, 112, 117, 123]
  const foamRows = [138, 143]
  const seaGlow = (x, y) => Math.exp(-(((x + 0.5 - SX) / pathW((y - H0) / (SHORE - H0))) ** 2))
  const seaV = (x, y) => {
    const u = (y - H0) / (SHORE - H0)
    return lerp(S.far, S.near, Math.pow(u, 0.6)) + S.path * seaGlow(x, y) * (1 - 0.35 * u)
  }
  const sea = new Layer('sea')
  for (let x = 0; x < W; x++) {
    const bot = seaBot(x)
    for (let y = H0; y <= bot; y++) {
      const u = (y - H0) / (SHORE - H0)
      const glow = seaGlow(x, y)
      let v = seaV(x, y)
      const my = 2 * H0 - 1 - y
      if (isLand(x, my) || island.has(x, my)) v -= 0.15 * (1 - u)
      // Swells: a lit crest line over a dark trough, broken here and there.
      for (const sy of swellRows) {
        const cy = sy + Math.round(Math.sin(x * 0.03 + sy) * 1.2)
        const n = noise(x * 0.08, sy, 19)
        if (y === cy && n > 0.3) v += S.wave * (1 + 2.5 * glow)
        if (y === cy + 1 && n > 0.25) v -= S.wave
      }
      // Wavelets: thin dashes, short and dense far off, long near.
      const n = noise(x * (0.5 / (1 + 6 * u)), y * 1.7, 13)
      const wide = Math.exp(-(((x + 0.5 - SX) / 70) ** 2))
      if (n > 0.84 - 0.06 * u - 0.08 * wide) v += S.wave * (1 + 2 * glow) * (1 - 0.4 * u)
      else if (n < 0.12 + 0.06 * wide) v -= S.wave * 0.6
      let c = tone(S.tones, v, x, y, 0.06)
      // Spent foam: lace lines riding the surf, with a shadow under them.
      if (y >= SURF) {
        for (const fy of foamRows) {
          const cy = fy + Math.round(Math.sin(x * 0.05 + fy) * 1.4 + (noise(x * 0.1, fy, 7) - 0.5) * 2)
          const n2 = noise(x * 0.22, fy, 27)
          if (y === cy && n2 > 0.42) c = tone(P.foam, S.foamBase + 0.25 * glow + (n2 - 0.5) * 0.3, x, y, 0.15)
          else if (y === cy - 1 && n2 > 0.72) c = tone(P.foam, S.foamBase - 0.12 + 0.2 * glow, x, y, 0.15)
          else if (y === cy + 1 && n2 > 0.42) c = tone(S.tones, v - 0.1, x, y, 0)
        }
      }
      sea.set(x, y, c)
    }
  }
  // The land mirrored in the water under it, shown in the land's own viewport.
  // Glitter on the path: three sets of sparks shown in turn.
  const glints = []
  for (let k = 0; k < 3; k++) {
    const r = rng(500 + k)
    const L = new Layer('glint' + k)
    for (let y = H0; y < SURF + 2; y++) {
      const u = (y - H0) / (SHORE - H0)
      const n = Math.round(3 + 5 * u)
      for (let i = 0; i < n; i++) {
        const g = (r() + r() + r() - 1.5) / 1.5
        const x = Math.round(SX + g * pathW(u) * 1.2)
        const len = 1 + Math.floor(r() * (1 + 4 * u))
        const near = Math.exp(-(((x - SX) / pathW(u)) ** 2))
        const c = P.glint[clamp(Math.floor(near * 2.6 + r() * 0.8), 0, P.glint.length - 1)]
        for (let j = 0; j < len; j++) L.set(x + j, y, c)
      }
    }
    L.anim = anim('gl', '--l:' + -k * 0.5 + 's', k ? " opacity='0'" : '')
    glints.push(L)
  }
  for (const L of glints) skirt(L, sea)

  // Haze: thin streaks of lit air over the water, see-through, drifting slowly.
  const haze = new Layer('haze')
  if (P.haze) {
    const { rows, colour, k } = P.haze
    for (const [y0, y1, dens] of rows) {
      for (let y = y0; y <= y1; y++) {
        for (let x = -8; x < W + 8; x++) {
          const n = noise(x * 0.035, y * 0.45, 88)
          const d = dens * (0.15 + 0.85 * Math.exp(-(((x + 0.5 - SX) / 80) ** 2)))
          if (n > 1 - d) haze.set(x, y, n > 1 - d * 0.45 ? colour[1] : colour[0])
        }
      }
    }
    addKf('d' + k, swingKf('d' + k, k))
    haze.anim = anim('cd d' + k, '--d:40s;--l:-9s', " opacity='" + f2(P.haze.o) + "'")
  }

  // ------------------------------------------------ the beach
  // Each wave runs up the sand in a lobe of its own and back: three lobes along the beach.
  const LOBES = P.lobes
  const lobeAt = (o, x) => {
    const s = Math.abs((x + 0.5 - o.cx) / o.hw)
    return s < 1 ? Math.pow(Math.cos((s * Math.PI) / 2), 0.7) : 0
  }
  // Small scallops along a front, a few cells deep, cusps pointing up the beach.
  const scallop = (o, x) => -Math.round(2.2 * Math.abs(Math.sin((x + o.seed * 7) * 0.2 + Math.sin(x * 0.05) * 1.5)) + (noise(x * 0.25, 5, o.seed) - 0.5) * 1.6)
  const reach = x => {
    let m = SHORE + 1
    for (const o of LOBES) m = Math.max(m, SHORE + Math.round(o.R * lobeAt(o, x)) + scallop(o, x) + 1)
    return m
  }
  const wetEnd = x => reach(x) + 3 + Math.round((noise(x * 0.15, 9, 3) - 0.5) * 2)

  // Wet sand is a mirror: it shows the sky as far above the horizon as the point is below it,
  // a little dulled, with a long streak under the sun. Past it, damp sand, then dry sand in low
  // light: grain, and ripples whose crests catch the light.
  const sand = new Layer('sand')
  const B = P.beach
  const RIPPLES = [171, 175, 180, 186, 193]
  for (let x = 0; x < W; x++) {
    const wet = wetEnd(x)
    for (let y = SHORE - 4; y < H; y++) {
      const dx = x + 0.5 - SX
      let c
      if (y < wet) {
        const my = 2 * H0 - y + 4
        let lum = 0
        for (let k = -3; k <= 3; k++) lum += lumOf(seenAt(x, my + k) ?? skyAt(x, my + k)) / 7
        let v = B.mirror[0] + B.mirror[1] * Math.pow(lum, 0.85)
        if (noise(x * 0.09, y * 0.7, 23) > 0.68) v -= 0.07
        const d = Math.max(0, (y - SHORE) / 26)
        const sw = B.streakW[0] + B.streakW[1] * d
        v += B.streak * Math.exp(-((dx / sw) ** 2)) * (1 - 0.4 * d)
        v -= 0.1 * smooth((y - (wet - 5)) / 5)
        if (hash(x, y, 17) > 0.985) v -= 0.1
        c = tone(B.wet, v, x, y, 0.1)
      } else {
        const e = y - wet
        let v = B.dry[0] + B.dry[1] * smooth((y - 168) / 32)
        if (e < 3) v -= 0.18 - e * 0.05
        // Ripples: thin lines, wider apart nearer, a lit crest over a shaded face.
        if (e > 3) {
          for (let k = 0; k < RIPPLES.length; k++) {
            const ry = Math.round(RIPPLES[k] + 1.6 * Math.sin(x * 0.05 + k * 1.7) + 2 * Math.sin(x * 0.013 + k))
            if (noise(x * 0.07, k * 3, 33) < 0.3) continue
            if (y === ry) v += B.crest
            else if (y === ry + 1) v -= B.trough
          }
        }
        const g = hash(x, y, 37)
        if (g > 0.965) v += 0.14
        else if (g < 0.03) v -= 0.12
        c = tone(B.sand, v, x, y, 0.08)
      }
      sand.set(x, y, c)
    }
  }
  // The wrack line: clumps of weed left by the last high tide, lit along the top.
  {
    const r = rng(81)
    for (let i = 0; i < 22; i++) {
      const x = Math.floor(r() * W)
      const y = 179 + Math.round(Math.sin(x * 0.02 + 1) * 2 + (r() - 0.5) * 3)
      const w = 2 + Math.floor(r() * 4)
      for (let k = 0; k < w; k++) {
        sand.set(x + k, y, B.weed[0])
        if (k > 0 && k < w - 1) sand.set(x + k, y - 1, B.weed[1])
      }
    }
  }
  // Shells and pebbles with a bright edge.
  {
    const r = rng(91)
    for (let i = 0; i < 16; i++) {
      const x = 70 + Math.floor(r() * 200)
      const y = Math.floor(lerp(182, 199, Math.sqrt(r())))
      sand.set(x, y, B.shell[1])
      sand.set(x + 1, y, B.shell[0])
      sand.set(x, y + 1, B.shell[2])
      sand.set(x + 1, y + 1, B.shell[2])
    }
  }
  // Sunset's sand has the most colours; to stay under the size limit with the seam fixes, its
  // colours within 4 levels of a commoner one are merged into it (invisible at that step).
  const sandMerge = Number(process.env.MERGE ?? ({ sunset: 4 }[name] ?? 0))
  if (sandMerge) mergeNear(sand, sandMerge)

  // ------------------------------------------------ waves
  // For each lobe: a swell far out, a nearer one, the lip as it breaks, spray, the white bore
  // that rolls in, foam lace left on the water, the thin sheet of the swash running up the sand
  // and back, and the foam at its front, which stays behind on the sand and sinks in.
  const waves = []
  const sheets = []
  const fronts = []
  const WV = P.wave
  // Cells over the sea where something may show under a wave part drawn later.
  const overSea = new Set()
  for (const L of glints) for (const k of L.m.keys()) overSea.add(k)
  for (const o of LOBES) {
    const r = rng(700 + o.seed)
    const xs = []
    for (let x = Math.floor(o.cx - o.hw); x <= o.cx + o.hw; x++) xs.push(x)
    const s = x => (x + 0.5 - o.cx) / o.hw
    const wob = (x, k) => Math.round((noise(x * 0.08, k, o.seed * 13) - 0.5) * 3)
    const lit = x => Math.exp(-(((x + 0.5 - SX) / 34) ** 2))
    const span = (x, k = 1.05) => bell(s(x) * k)

    const swA = new Layer('swA' + o.seed)
    const swB = new Layer('swB' + o.seed)
    const lip = new Layer('lip' + o.seed)
    const spray = new Layer('spray' + o.seed)
    const bore = new Layer('bore' + o.seed)
    const rem = new Layer('rem' + o.seed)
    for (const x of xs) {
      const b = span(x)
      if (b < 0.1) continue
      const n = noise(x * 0.2, 3, o.seed)
      // Far swell: a lit line of water over a dark trough.
      const ya = 117 + wob(x, 1)
      if (n > 0.3) swA.set(x, ya, tone(S.tones, seaV(x, ya) + 0.1 + 0.2 * seaGlow(x, ya), x, ya, 0.1))
      if (n > 0.2) swA.set(x, ya + 1, tone(S.tones, seaV(x, ya) - 0.1, x, ya, 0))
      // Nearer swell: the crest whitening, the face glowing where the sun shines through it.
      const yb = 123 + wob(x, 2)
      const hb = Math.max(1, Math.round(2.4 * Math.sqrt(b)))
      swB.set(x, yb, n > 0.45 ? tone(P.foam, 0.45 + 0.4 * lit(x), x, yb, 0.2) : tone(S.tones, seaV(x, yb) + 0.14 + 0.25 * seaGlow(x, yb), x, yb, 0.1))
      for (let j = 1; j <= hb; j++) swB.set(x, yb + j, tone(WV.face, 0.22 + 0.65 * lit(x) * (1 - j / (hb + 2)), x, yb + j, 0.2))
      swB.set(x, yb + hb + 1, tone(S.tones, seaV(x, yb) - 0.14, x, yb, 0))
      // The lip curling over.
      const yl = 127 + wob(x, 3)
      const hl = Math.max(2, Math.round(3.4 * Math.sqrt(b)))
      if (n > 0.55) lip.set(x, yl - 1, tone(P.foam, 0.7, x, yl, 0.2))
      lip.set(x, yl, tone(P.foam, 0.92 + 0.15 * lit(x), x, yl, 0.2))
      lip.set(x, yl + 1, tone(P.foam, 0.62, x, yl + 1, 0.2))
      for (let j = 2; j <= hl; j++) lip.set(x, yl + j, tone(WV.face, 0.45 + 0.5 * lit(x) - j * 0.06, x, yl + j, 0.2))
      lip.set(x, yl + hl + 1, tone(WV.face, 0.05, x, yl, 0))
      // The bore: a roll of white water, ragged on top, a shadow under it.
      const f = noise(x * 0.3, 7, o.seed)
      const g = noise(x * 0.12, 8, o.seed)
      const yo = 131 + wob(x, 4) - (f > 0.7 ? 1 : 0)
      const ho = Math.max(1, Math.round((1 + 2.6 * g) * Math.sqrt(b)))
      if (f > 0.42) bore.set(x, yo - 1, tone(P.foam, 0.62 + 0.2 * f, x, yo, 0.25))
      if (f > 0.82) bore.set(x, yo - 2, tone(P.foam, 0.55, x, yo, 0.25))
      if (hash(x, 3, o.seed) > 0.86) bore.set(x, yo - 3 - Math.floor(hash(x, 4, o.seed) * 2), tone(P.foam, 0.7, x, yo, 0.25))
      for (let j = 0; j < ho; j++) bore.set(x, yo + j, tone(P.foam, 0.98 - (j / ho) * 0.4 + 0.1 * lit(x) - (hash(x, j, 5) > 0.85 ? 0.25 : 0), x, yo + j, 0.25))
      bore.set(x, yo + ho, tone(P.foam, 0.3, x, yo + ho, 0.25))
      bore.set(x, yo + ho + 1, tone(WV.face, 0.05, x, yo, 0))
      // Lace left on the water behind it.
      for (let y = 132; y < SHORE - 1; y++) {
        if (lace(x + o.seed * 40, y, 90 + o.seed, 20, 2.2) < 0.1 * b && hash(x >> 2, y, o.seed) > 0.25) rem.set(x, y, tone(P.foam, 0.4 + 0.3 * lit(x), x, y, 0.2))
      }
    }
    for (let i = 0; i < o.hw * 0.4; i++) {
      const x = Math.round(o.cx + (r() * 2 - 1) * o.hw * 0.8)
      if (span(x) < 0.25) continue
      const y = 123 + wob(x, 3) + Math.floor(r() * 4)
      spray.set(x, y, P.foam[P.foam.length - 1 - Math.floor(r() * 3)])
    }

    // The swash sheet: thin glassy water over sand, a little brighter than the wet sand, netted
    // with foam lace. Painted at rest, its front at the water line in the middle of the lobe;
    // its upper part waits under the sea.
    const sheet = new Layer('sheet' + o.seed)
    const front = new Layer('front' + o.seed)
    for (const x of xs) {
      const b = lobeAt(o, x)
      const f0 = SHORE + Math.round(o.R * b) - o.R + scallop(o, x)
      for (let y = SHORE - o.R - 3; y <= f0; y++) {
        const dx = x + 0.5 - SX
        // Shown about halfway up the beach, so it mirrors the sky for there.
        const yy = y + Math.round(o.R * 0.6)
        const m = seenAt(x, 2 * H0 - yy + 4) ?? skyAt(x, 2 * H0 - yy + 4)
        const d = Math.max(0, (yy - SHORE) / 26)
        let v = B.mirror[0] + B.mirror[1] * lumOf(m) + WV.sheetLift
        v += B.streak * Math.exp(-((dx / (B.streakW[0] + B.streakW[1] * d)) ** 2)) * (1 - 0.4 * d)
        v += 0.05 * Math.min(f0 - y, 6) / 6
        v -= 0.08 * (1 - smooth(b / 0.5))
        let c = tone(B.wet, v, x, y, 0.1)
        if (f0 - y > 2 && b > 0.15 && lace(x, y, 40 + o.seed, 12, 2.8) < 0.08) c = tone(P.foam, WV.laceV + 0.25 * lit(x) - 0.15 * (1 - smooth(b / 0.5)), x, y, 0.2)
        sheet.set(x, y, c)
      }
      // Toward the ends of the lobe the front thins out and breaks up.
      const keep = smooth((b - 0.04) / 0.4)
      if (hash(x, 1, o.seed) > keep + 0.1) continue
      // The front: a bright scalloped edge with holes, bubbles behind it, a thin shade before it.
      const n = noise(x * 0.3, 2, o.seed * 3)
      front.set(x, f0 + 1, tone(B.wet, B.mirror[0] - 0.05, x, f0, 0))
      front.set(x, f0, tone(P.foam, 0.6 + 0.35 * keep + 0.1 * lit(x), x, f0, 0.2))
      if (n > 0.3 + 0.5 * (1 - keep)) front.set(x, f0 - 1, tone(P.foam, 0.72 + 0.1 * lit(x), x, f0 - 1, 0.2))
      if (n > 0.66 && keep > 0.6) front.set(x, f0 - 2, tone(P.foam, 0.55, x, f0 - 2, 0.2))
      if (hash(x, 9, o.seed) > 0.8) front.set(x, f0 - 3 - Math.floor(hash(x, 8, o.seed) * 3), tone(P.foam, 0.6, x, f0, 0.2))
    }

    // The moving parts' edges meet sea and sand colours like their own as they go: nothing of
    // theirs may lie under their edge cells (see encode-local.mjs, `edge`).
    for (const L of [swA, swB, spray, bore, sheet, front]) {
      L.enc = { ...(L.enc ?? {}), edge: true }
      // And the sea or sand under their edges changes as they go, so it cannot be matched
      // there: two coats let less of it through.
      L.coats = 2
    }
    // The choreography, in seconds on the 0.05 s clock.
    const tl = timeline(o.R)
    // The lace and the lip stay put while shown (the lace fading out by opacity), so they get
    // skirts over the sea, kept off cells where the glints or a wave part drawn before them
    // can show (any lobe, any of its positions).
    const opsOf = holds => [...new Set(holds.map(([, c]) => Number(/opacity:([\d.]+)/.exec(c)?.[1] ?? 1)))].filter(v => v > 0)
    skirt(rem, sea, { blocked: overSea, ops: opsOf(tl.M) })
    const mine = new Set(overSea)
    for (const [L, d0, d1] of [[rem, 0, 0], [swA, 0, 3], [swB, 0, 2]]) for (const k of L.m.keys()) for (let d = d0; d <= d1; d++) mine.add(k + d * ROW)
    skirt(lip, sea, { blocked: mine, ops: opsOf(tl.L) })
    for (const [L, d0, d1] of [[rem, 0, 0], [swA, 0, 3], [swB, 0, 2], [lip, 0, 0], [spray, -2, 0], [bore, 0, 13]]) for (const k of L.m.keys()) for (let d = d0; d <= d1; d++) overSea.add(k + d * ROW)
    const nm = k => k + o.seed
    for (const [k, holds] of Object.entries(tl)) css.push(keyframes(nm(k), o.T, holds))
    const style = '--l:' + -o.l + 's;--T:' + o.T + 's'
    const set = (L, k) => {
      L.anim = anim('w ' + nm(k), '', " opacity='0'")
      return L
    }
    waves.push({ wrap: "<g style='" + style + "'>", end: '</g>', layers: [set(rem, 'M'), set(swA, 'A'), set(swB, 'B'), set(lip, 'L'), set(spray, 'S'), set(bore, 'O')] })
    sheet.anim = anim('w ' + nm('H'))
    sheets.push({ wrap: "<g style='" + style + "'>", end: '</g>', layers: [sheet] })
    // At rest (still frame, reduced motion) the first lobe's foam lies on the sand at its reach.
    front.anim = anim('w ' + nm('F'), o.rest ? 'transform:translateY(' + o.R + 'px)' : '', o.rest ? '' : " opacity='0'")
    fronts.push({ wrap: "<g style='" + style + "'>", end: '</g>', layers: [front] })
  }

  // ------------------------------------------------ the foreground
  // A dune with marram grass in the bottom left corner, a driftwood log in the bottom right,
  // both edged by the light behind them; the grass tips sway in the breeze.
  const F = P.fore
  const dune = new Layer('dune')
  const duneTop = x => 172 + Math.round(Math.pow(Math.max(0, x / 70), 1.7) * 30 + (noise(x * 0.2, 3, 71) - 0.5) * 2)
  for (let x = 0; x < 78; x++) {
    for (let y = duneTop(x); y < H; y++) {
      const e = y - duneTop(x)
      let v = F.dune[0] - smooth((y - 172) / 28) * 0.12 + (hash(x, y, 72) > 0.95 ? 0.12 : 0)
      let c = tone(B.sand, v, x, y, 0.1)
      if (e === 0) c = F.duneRim[1]
      else if (e === 1) c = F.duneRim[0]
      dune.set(x, y, c)
    }
  }
  // A blade of grass: a curve from its root, dark below, glowing toward the tip where the light
  // comes through it. The upper part goes to `tips`, which sways.
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
      const target = t > 0.55 ? tips : still
      const c = t > 0.86 ? F.grass[5] : t > 0.62 ? F.grass[4] : t > 0.3 ? F.grass[2 + (k % 2)] : F.grass[k % 2]
      target.set(x, y, c)
      // A seed head on some blades.
      if (k % 4 === 0 && t > 0.8) target.set(x + (lean > 0 ? -1 : 1), y, F.grass[4])
    }
  }
  const grassL = new Layer('grassL')
  const tipsL = []
  {
    const r = rng(33)
    const clumps = [[2, 15, 30], [14, 13, 26], [26, 11, 22], [38, 9, 18], [50, 7, 14], [62, 5, 10]]
    clumps.forEach(([cx, n, hmax], ci) => {
      const tips = new Layer('tips' + ci)
      for (let i = 0; i < n; i++) {
        const bx = cx + Math.round((r() - 0.5) * 10)
        const by = duneTop(Math.max(0, bx)) + 1
        const h = hmax * (0.45 + 0.55 * r())
        blade(grassL, tips, bx, by, h, (r() - 0.3) * h * 0.55, i)
      }
      const d = 4 + Math.floor(r() * 3)
      tips.anim = anim('gs', '--d:' + d + 's;--l:' + -Math.round((1 - ci / 6) * d * 10) / 10 + 's')
      // A tip's dark foot lies on its blade: keep the pale tip colour's backing off its edge.
      tips.enc = { edge: true }
      tipsL.push(tips)
    })
  }
  // The log: a long trunk lying across the corner, its top edge lit, a snapped branch.
  const log = new Layer('log')
  // Its shadow fades into the sand at its edge, so its dark backing must stay off that edge.
  log.enc = { edge: true }
  {
    const a = [246, 191]
    const b = [336, 175]
    const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2
    const radAt = t => 5 + t * 1.6 + (noise(t * 9, 1, 71) - 0.5) * 1.2
    const knots = [[0.3, -0.2], [0.55, 0.35], [0.78, -0.1]]
    const L = Math.sqrt(len2)
    const EW = 2.4
    for (let x = a[0] - 8; x <= b[0] + 6; x++) {
      for (let y = 160; y < H + 6; y++) {
        const t = ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / len2
        const cy = a[1] + t * (b[1] - a[1])
        const rad = radAt(t)
        const d = (y + 0.5 - cy) / rad
        if (Math.abs(d) > 1 || t > 1) continue
        // The sawn end facing us: an oval of pale wood with rings, its upper lip lit.
        const r = Math.hypot((t * L) / EW, d)
        if (r <= 1) {
          let c = r > 0.8 ? F.wood[2] : r < 0.22 ? F.wood[4] : F.wood[Math.floor(r * 5) % 2 ? 5 : 6]
          if (r > 0.8 && d < -0.45) c = F.woodRim[0]
          if (r > 0.55 && r <= 0.8 && d > 0.35) c = F.wood[4]
          log.set(x, y, c)
          continue
        }
        if (t < 0) continue
        // Bark: furrows along the trunk, a few knots, the top edge catching the light.
        const furrow = Math.sin(d * 7 + Math.sin(x * 0.13) * 1.2) > 0.6
        let v = 0.62 - d * 0.42 - (furrow ? 0.14 : 0) + (noise(x * 0.25, y * 0.5, 5) - 0.5) * 0.14
        for (const [kt, kd] of knots) {
          const r = Math.hypot((t - kt) * 90 / 3.2, (d - kd) * rad / 1.6)
          if (r < 1) v += r < 0.5 ? 0.1 : -0.25
        }
        if (d > 0.75) v += 0.12
        let c = tone(F.wood.slice(0, 5), v, x, y, 0.15)
        if (d < -0.82) c = F.woodRim[1]
        else if (d < -0.62) c = F.woodRim[0]
        log.set(x, y, c)
      }
    }
    // A snapped branch stub, thick at the trunk, lit on its sunward side.
    for (const [x, y, w] of [...line(272, 184, 264, 170).map(([x, y]) => [x, y, 3]), ...line(264, 170, 261, 165).map(([x, y]) => [x, y, 2])]) {
      for (let k = 0; k < w; k++) log.set(x + k, y, k === 0 ? F.woodRim[0] : F.wood[k === w - 1 ? 1 : 2])
    }
    // Its shadow on the sand, toward us.
    for (let x = a[0] - 4; x < W; x++) {
      const t = (x - a[0]) / (b[0] - a[0])
      const yb = Math.round(a[1] + t * (b[1] - a[1]) + radAt(Math.max(0, t)))
      for (let k = 0; k <= 1; k++) if (!log.has(x, yb + k)) log.set(x, yb + k, B.sand[k ? 3 : 2])
    }
  }
  const grassR = new Layer('grassR')
  const tipsR = new Layer('tipsR')
  {
    const r = rng(44)
    for (let i = 0; i < 16; i++) {
      const bx = 290 + Math.round(r() * 32)
      const by = 180 - Math.round((bx - 290) * 0.15)
      const h = 8 + r() * 18
      blade(grassR, tipsR, bx, by, h, (r() - 0.45) * h * 0.5, i)
    }
    tipsR.anim = anim('gs', '--d:5s;--l:-1.5s')
    tipsR.enc = { edge: true }
  }
  // Where a swaying tip touches a still cell of its own colour (its blade, another blade, the
  // dune, the log), the tip is a separate shape, so whatever lies beneath its edge shows
  // between the two by up to a quarter. For each of the three places a clump's tips hold
  // (0, 1 and 2 cells over), a still copy of the cells on both sides of each such joint lies
  // under all the tips, shown only while the clump's tips hold there: then the tip's edge lies
  // over its own colour. The copy is hidden under the tip and under the still cell, so nothing
  // else changes.
  const joints = (still, tips) => {
    const st = new Map()
    for (const L of still) for (const [k, c] of L.m) st.set(k, c)
    const style = tips.anim.style
    const layers = [0, 1, 2].map(d => {
      const J = new Layer(tips.name + 'j' + d)
      for (const [k, c] of tips.m) {
        const kd = k + d
        for (const n of [kd - 1, kd + 1, kd - ROW, kd + ROW]) {
          const sc = st.get(n)
          if (sc === undefined || tips.m.has(n - d) || apart(sc, c) > 8) continue
          J.m.set(kd, c)
          J.m.set(n, sc)
        }
      }
      J.anim = anim('j' + d, '', d ? " opacity='0'" : '')
      return J
    })
    return { wrap: "<g style='" + style + "'>", end: '</g>', layers }
  }
  const jointsL = tipsL.map(t => joints([dune, grassL], t))
  const jointsR = joints([log, grassR], tipsR)

  // Gulls: three gliding across slowly, wings beating out of step.
  const gulls = []
  if (P.gull) {
    const A = ['.xx...xx.', 'x..x.x..x', '....x....']
    const Bf = ['.........', 'xxxx.xxxx', '....x....']
    const flock = [[0, 44, 0], [16, 50, 1], [8, 38, 2]]
    flock.forEach(([x, y, i]) => {
      const a = new Layer('ga' + i)
      const b = new Layer('gb' + i)
      A.forEach((row, j) => [...row].forEach((ch, k) => ch === 'x' && a.set(x + k, y + j, P.gull)))
      Bf.forEach((row, j) => [...row].forEach((ch, k) => ch === 'x' && b.set(x + k, y + j, P.gull)))
      const per = [1.2, 1.4, 1.0][i]
      a.anim = anim('fa', '--f:' + per + 's;--l:-' + i * 0.3 + 's')
      b.anim = anim('fb', '--f:' + per + 's;--l:-' + i * 0.3 + 's', " opacity='0'")
      gulls.push(a, b)
    })
  }

  // ------------------------------------------------ assemble
  // The sky, sun, clouds and the far land share the bottom-pinned viewport with the sea, so the
  // horizon lines up on any window; the headland, the dune and the log keep to their corners.
  part('pB', [{ under: true, layer: sky }, rays, ...starLayers, moon, sun])
  part('pB', [...cloudLayers, boat])
  part('pBR', [island])
  part('pBL', [head, lamp])
  part('pB', [{ under: true, layer: sand }])
  part('pB', sheets)
  part('pB', [{ under: true, layer: sea }, ...glints])
  part('pB', waves)
  part('pB', [haze])
  part('pB', fronts)
  part('pBL', [dune, grassL, ...jointsL, ...tipsL])
  part('pBR', [log, grassR, jointsR, tipsR])
  if (gulls.length) part('pB', [{ wrap: "<g class='fly'><g class='bob'>", end: '</g></g>', layers: gulls }])

  return encode(parts, css)
}

// ---------------------------------------------------------------- motion

// The waves' choreography for a run-up of R cells: for each part, [time, css] holds. A part
// keeps a look from its time to the next (the animation runs steps(1)); a hold may carry its
// own steps(n) timing to glide n cells to the next hold, a cell per step.
function timeline(R) {
  const tf = n => ';animation-timing-function:steps(' + n + ')'
  const at = (y, o, n) => 'transform:' + (y ? 'translateY(' + y + 'px)' : 'none') + (o === undefined ? '' : ';opacity:' + f2(o)) + (n ? tf(n) : '')
  // Glide from a to b in pieces [cells, seconds a cell]; returns the end time.
  const glide = (list, a, b, t, pieces, o) => {
    const dir = Math.sign(b - a)
    let y = a
    for (const [n, step] of pieces) {
      if (!n) continue
      list.push([t, at(y, o, n)])
      y += dir * n
      t += n * step
    }
    list.push([t, at(y, o)])
    return t
  }
  const split = (n, shares) => {
    const out = shares.map(s => Math.round(n * s))
    out[out.length - 1] = n - out.slice(0, -1).reduce((a, b) => a + b, 0)
    return out
  }
  const up = split(R, [0.52, 0.3, 0.18])
  const back = split(R, [0.15, 0.25, 0.45, 0.15])
  const A = [[0, at(0, 1)]]
  glide(A, 0, 3, 0, [[3, 0.5]], 1)
  A.push([1.6, at(0, 0)])
  const B = [[0, at(0, 0)]]
  glide(B, 0, 2, 1.6, [[2, 0.6]], 1)
  B.push([3.0, at(0, 0)])
  const L = [[0, 'opacity:0'], [3.0, 'opacity:1'], [3.6, 'opacity:0']]
  const S = [[0, at(0, 0)], [3.2, at(0, 1)], [3.45, at(-1, 0.8)], [3.7, at(-2, 0.5)], [3.95, at(-2, 0)]]
  const O = [[0, at(0, 0)]]
  const tb = glide(O, 0, 13, 3.6, [[7, 0.1], [4, 0.15], [2, 0.2]], 1)
  O.push([tb, at(13, 0.5)], [tb + 0.2, at(13, 0)])
  const M = [[0, 'opacity:0'], [4.3, 'opacity:1'], [6.2, 'opacity:.7'], [6.8, 'opacity:.45'], [7.4, 'opacity:.2'], [8, 'opacity:0']]
  const Hs = [[0, at(0)]]
  const t1 = glide(Hs, 0, R, tb - 0.2, [[up[0], 0.05], [up[1], 0.1], [up[2], 0.2]])
  glide(Hs, R, 0, t1 + 0.4, [[back[0], 0.25], [back[1], 0.15], [back[2], 0.1], [back[3], 0.2]])
  const Fr = [[0, at(0, 0)]]
  glide(Fr, 0, R, tb - 0.2, [[up[0], 0.05], [up[1], 0.1], [up[2], 0.2]], 1)
  for (const [dt, o] of [[0.6, 0.8], [1.2, 0.6], [1.8, 0.4], [2.4, 0.2], [3.0, 0]]) Fr.push([t1 + dt, at(R, o)])
  return { A, B, L, S, O, M, H: Hs, F: Fr }
}

// Keyframes for an animation of T seconds from [time, css] holds; the loop closes on the first.
function keyframes(name, T, holds) {
  const pct = t => String(Math.round((t / T) * 1e6) / 1e4)
  const m = new Map()
  for (const [t, c] of holds) m.set(Math.round(t / TICK), c)
  const list = [...m.entries()].sort((a, b) => a[0] - b[0])
  if (list[list.length - 1][0] * TICK > T) throw new Error(name + ' runs past its cycle')
  let k = ''
  for (const [n, c] of list) k += (n === 0 ? '0' : pct(n * TICK)) + '%{' + c + '}'
  k += '100%{' + list[0][1].replace(/;animation-timing-function:[^;]*/, '') + '}'
  return '@keyframes ' + name + '{' + k + '}'
}

// A drift of `a` whole cells as eased keyframes (the class runs it there and back).
function swingKf(name, a) {
  let k = ''
  let last = null
  for (let i = 0; i <= 20; i++) {
    const v = Math.round((a * (1 - Math.cos((Math.PI * i) / 20))) / 2)
    if (v !== last || i === 20) k += i * 5 + '%{transform:' + (v ? 'translateX(' + v + 'px)' : 'none') + '}'
    last = v
  }
  return '@keyframes ' + name + '{' + k + '}'
}
function swingY(name, a, b) {
  let k = ''
  for (let i = 0; i <= 10; i++) {
    const v = Math.round(a + ((b - a) * (1 - Math.cos((Math.PI * i) / 10))) / 2)
    k += i * 10 + '%{transform:translateY(' + v + 'px)}'
  }
  return '@keyframes ' + name + '{' + k + '}'
}

// ---------------------------------------------------------------- encoding

const PIN = { pB: 'xMidYMax', pBL: 'xMinYMax', pBR: 'xMaxYMax' }
const PATTERN_MIN = 55
const runsOf = s => (s.match(/[hv]-?\d/g) ?? []).length
// How far apart two colours look: the mean channel difference, as the engine's encoder counts it.
const apart = (a, b) => {
  const x = rgb(a)
  const y = rgb(b)
  return (Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2])) / 3
}
const BAND_T = Number(process.env.BAND_T ?? 20)
// Colours of a layer within `lv` levels (mean channel) of a commoner one take its colour: the
// picture changes by at most that step, and the layer writes shorter.
function mergeNear(L, lv) {
  const count = new Map()
  for (const c of L.m.values()) count.set(c, (count.get(c) ?? 0) + 1)
  const cols = [...count.keys()].sort((a, b) => count.get(b) - count.get(a))
  const to = new Map()
  for (const c of cols) {
    if (to.has(c)) continue
    for (const d of cols) if (d !== c && !to.has(d) && count.get(d) <= count.get(c) && apart(c, d) <= lv) to.set(d, c)
  }
  for (const [k, c] of L.m) if (to.has(c)) L.m.set(k, to.get(c))
  return to.size
}

function encode(parts, waveCss) {
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
  const stats = { patterns: 0, runs: 0, bands: 0, byLayer: new Map(), chars: new Map() }

  // A layer's cells, written by the engine's seam-proof encoder: wherever two colours meet, the
  // later one's edge lies over a solid run of the earlier one (or of the layer's backing), so
  // nothing from behind the layer shows through as a hairline at any window size.
  function cellsOf(L, ox = 0, oy = 0) {
    return emitSafe(L, { ox, oy, ...(L.enc ?? {}) })
  }

  function draw(L) {
    const plain = cellsOf(L)
    const runs = runsOf(plain)
    stats.runs += runs
    stats.byLayer.set(L.name, (stats.byLayer.get(L.name) ?? 0) + runs)
    stats.chars.set(L.name, (stats.chars.get(L.name) ?? 0) + plain.length)
    if (runs < PATTERN_MIN) return plain
    stats.patterns++
    // The tile spans whole cells with a clear cell all round: the tile repeats, and at its
    // edges the raster would otherwise pick up the far side. Its corner sits on a cell corner
    // (rows are centred on whole y, so cell edges lie on y + .5): the tile is rastered into its
    // own bitmap from that corner, and a corner off the cell grid lands on a half pixel at odd
    // whole-pixel cell sizes (9 px a cell at 1440x900@2), where the whole bitmap is resampled.
    const b = bounds(L)
    const x = b.x0 - 1
    const y = b.y0 - 1.5
    const id = nextId()
    defs.push('<pattern id="' + id + '" width="1" height="1">' + cellsOf(L, x, y) + '</pattern>')
    return '<rect x="' + x + '" y="' + f2(y) + '" width="' + (b.x1 - b.x0 + 2) + '" height="' + (b.y1 - b.y0 + 2) + '" fill="url(#' + id + ')"/>'
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
    // edge lies between two cells the encoder joins over one another.
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

  function renderLayers(layers) {
    let out = ''
    let still = null
    const flush = () => {
      if (still) out += draw(still)
      still = null
    }
    for (const L of layers) {
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
        still ??= new Layer('')
        still.name += (still.name ? '+' : '') + L.name
        still.enc ??= L.enc
        for (const [k, c] of L.m) still.m.set(k, c)
        continue
      }
      flush()
      let inner = draw(L)
      // A moving layer drawn in `coats` coats: inside a cell nothing changes, and at an edge
      // that falls inside a pixel, what lies beneath shows through less (a quarter at most
      // with one coat, about a seventh with two).
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

  const view = pin => '<svg viewBox="0 -.5 ' + W + ' ' + H + '" preserveAspectRatio="' + PIN[pin] + ' slice">'
  let body = ''
  let pin = null
  for (const [p, layers] of parts) {
    if (!layers.length) continue
    if (p !== pin) {
      if (pin) body += '</svg>'
      body += view(p)
      pin = p
    }
    body += renderLayers(layers)
  }
  body += '</svg>'

  const from = l => 'calc(' + l + ' + var(--m))'
  const RULES = [
    // The waves: each lobe's parts run steps(1) keyframes on the lobe's cycle --T.
    '.w{animation:var(--T) steps(1) ' + from('var(--l)') + ' infinite}',
    ...waveCss.map(k => {
      const n = /@keyframes (\w+)/.exec(k)[1]
      return '.' + n + '{animation-name:' + n + '}' + k
    }),
    // Glitter on the path: three sets of sparks in turn, half a second each.
    '.gl{animation:gl 1.5s steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes gl{0%{opacity:1}33.3333%,100%{opacity:0}}',
    // The rays breathe.
    '.ry{animation:ry 24s steps(1) ' + from('-6s') + ' infinite}',
    '@keyframes ry{0%{opacity:1}' + [[30, 0.85], [35, 0.7], [40, 0.55], [45, 0.45], [70, 0.55], [75, 0.7], [80, 0.85], [85, 1]].map(([p, o]) => p + '%{opacity:' + f2(o) + '}').join('') + '100%{opacity:1}}',
    // Clouds drift a cell at a time, there and back.
    '.cd{animation:var(--d) steps(1) ' + from('var(--l)') + ' infinite alternate}',
    // The boat drifts along the horizon, a cell every 2.5 s, there and back.
    '.bt{animation:bt 100s steps(40) ' + from('-30s') + ' infinite alternate}',
    '@keyframes bt{0%{transform:none}100%{transform:translateX(40px)}}',
    // The lighthouse lamp turns: a slow glow every 8 s.
    '.lm{animation:lm 8s steps(1) ' + from('-2s') + ' infinite}',
    '@keyframes lm{0%{opacity:.15}' + [[10, 0.4], [15, 0.7], [20, 1], [30, 0.7], [35, 0.4], [40, 0.15]].map(([p, o]) => p + '%{opacity:' + f2(o) + '}').join('') + '100%{opacity:.15}}',
    // Grass tips sway a cell or two.
    '.gs{animation:gs var(--d) steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes gs{0%{transform:none}25%{transform:translateX(1px)}55%{transform:translateX(2px)}70%{transform:translateX(1px)}85%,100%{transform:none}}',
    // Under the tips, the copies of their joints, each shown while the tips hold its place.
    '.j0,.j1,.j2{animation:j0 var(--d) steps(1) ' + from('var(--l)') + ' infinite}.j1{animation-name:j1}.j2{animation-name:j2}',
    '@keyframes j0{0%{opacity:1}25%{opacity:0}85%,100%{opacity:1}}',
    '@keyframes j1{0%{opacity:0}25%{opacity:1}55%{opacity:0}70%{opacity:1}85%,100%{opacity:0}}',
    '@keyframes j2{0%{opacity:0}55%{opacity:1}70%,100%{opacity:0}}',
    // Stars dim for a moment.
    '.tk{animation:tk var(--d) steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes tk{0%,90%{opacity:1}94%,100%{opacity:.4}}',
    // The gulls cross a cell every 0.2 s, bob, and beat their wings.
    '.fly{animation:fly 120s steps(1) ' + from('-52s') + ' infinite}',
    '@keyframes fly{0%{transform:translate(-40px,0);animation-timing-function:steps(400)}66.6667%,100%{transform:translate(360px,0)}}',
    '.bob{animation:bob 6s steps(1) var(--m) infinite alternate}',
    swingY('bob', -2, 2),
    '.fa{animation:fa var(--f) steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes fa{0%{opacity:1}50%,100%{opacity:0}}',
    '.fb{animation:fb var(--f) steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes fb{0%{opacity:0}50%,100%{opacity:1}}',
    // Reduced motion rests the scene on its finished frame.
    '@media (prefers-reduced-motion:reduce){:root *{animation:none!important}}',
  ]
  const CSS = RULES.join('')
  let svg =
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" font-family="a" color="a" style="--m:0s">' +
    '<style>' + CSS + '</style><defs>' + defs.join('') + '</defs>' + body + '</svg>'
  svg = svg.replaceAll('"', "'")
  return { svg, stats, css: CSS.length }
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
  fs.writeFileSync(path.join(HERE, 'out', 'tide-line-' + name + '.svg'), svg)
  console.log(name.padEnd(8), svg.length, 'chars (scrubbed ~' + scrubbed + '), css', css, '| patterns', stats.patterns, '| runs', stats.runs, '| bands', stats.bands)
  if (process.env.STATS) {
    const top = [...stats.chars].sort((a, b) => b[1] - a[1]).slice(0, 30)
    console.log('  ' + top.map(([n, c]) => n.slice(0, 40) + ':' + c + 'c/' + stats.byLayer.get(n) + 'r').join('  '))
  }
}
