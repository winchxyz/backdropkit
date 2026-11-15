// Sunbeam Wood: an old forest, huge mossy trunks framing a glade where shafts of light slant
// down through the canopy onto grass, a stream, a fallen log and ferns, as one animated
// pixel-art SVG in three moments (morning, day, night).
// node build.mjs [moment ...]  ->  out/sunbeam-wood-<moment>.svg   (STATS=1 lists the costliest layers)
//
// Painted on a 320 x 200 cell grid (x right, y down) and encoded the way Sunfield's build does
// it (../../../sunfield/tools/build.mjs): cells as 1-cell stroke runs, at most 64 runs a path,
// big still layers in patterns with a clear cell round each tile, nested pinned viewports, CSS
// motion in steps on a 0.05 s clock, and a reduced-motion rule that stops it.
//
// The air is not painted into the cells: each plane of trunks keeps a few flat colours of its
// own, and the glow of the light and the floor mist lie over the planes as stepped gradients.
// That keeps the colours few, the runs long, and the haze free of seams.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Layer, bounds, clamp, hex, lerp, rgb, rng, smooth, tone } from '../../../sunfield/tools/pixel.mjs'
import { emitSafe } from './encode-local.mjs'
import { MOMENTS } from './moments.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const W = 320
const H = 200
const TICK = 0.05
const ROW = 4096
const cellXY = k => [(k % ROW) - 1000, Math.floor(k / ROW) - 1000]
const f1 = v => Math.round(v * 10) / 10
const f2 = v => String(Math.round(v * 100) / 100).replace(/^0\./, '.').replace(/^-0\./, '-.')
const f3 = v => String(Math.round(v * 1000) / 1000).replace(/^0\./, '.')
const sec = v => Math.round(v / TICK) * TICK // a time on the clock
const ts = v => String(Math.round(v * 20) / 20) // the same, written exactly
const T = v => String(Math.round(v / TICK) * TICK * 100 / 100).replace(/(\.\d\d)\d+$/, '$1') + 's'

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
const fbm = (x, y, s) => noise(x, y, s) * 0.62 + noise(x * 2.3, y * 2.3, s + 7) * 0.28 + noise(x * 5.1, y * 5.1, s + 13) * 0.1
// The nearest of points scattered one to a g x g square: its distance, the second nearest's,
// and where it is.
function worley(x, y, g, s) {
  const gx = Math.floor(x / g)
  const gy = Math.floor(y / g)
  let a = Infinity
  let b = Infinity
  let px = 0
  let py = 0
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = (gx + i + 0.15 + 0.7 * hash(gx + i, gy + j, s)) * g
      const cy = (gy + j + 0.15 + 0.7 * hash(gx + i, gy + j, s + 1)) * g
      const d = Math.hypot(x - cx, y - cy)
      if (d < a) {
        b = a
        a = d
        px = cx
        py = cy
      } else if (d < b) b = d
    }
  }
  return { a, b, px, py }
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
function* cells(L) {
  for (const [k, c] of L.m) {
    const [x, y] = cellXY(k)
    yield [x, y, c]
  }
}
function sprite(L, x, y, rows, colors) {
  rows.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && colors[ch] && L.set(x + i, y + j, colors[ch])))
  return L
}
const bez = (pts, t) => {
  const [[x0, y0], [x1, y1], [x2, y2]] = pts
  return [(1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * x1 + t * t * x2, (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * y1 + t * t * y2]
}

// ---------------------------------------------------------------- the scene

function scene(name) {
  const P = MOMENTS[name]
  const parts = [] // [pin, layers] in paint order
  const part = (pin, layers) => {
    for (const L of layers) if (L && L.raw !== undefined) L.tints = tints.splice(0)
    parts.push([pin, layers.filter(L => L && (L.raw !== undefined || L.wrap || L.under || L.size))])
  }
  const defs = []
  const css = []
  const anim = (cls, style = '', extra = '') => ({ cls, style, extra })
  const fogged = (tones, f, y) => tones.map(c => mix(c, skyAt(y), f))

  // ------------------------------------------------ light
  const skyAt = y => ramp(P.sky, y)
  const G = P.glow
  // Where the light is strongest behind the canopy (0..1), for lit edges.
  const glowAt = (x, y) => Math.exp(-(((x + 0.5 - G.x) / G.rx) ** 2) - ((y + 0.5 - G.y) / G.ry) ** 2)

  const S = P.shafts
  const shaftCx = (s, y) => s.x + S.sx * (y - s.y)
  const shaftHw = (s, y) => s.w / 2 + 0.03 * (y - S.top)
  // How much shaft light reaches a cell (0..1): full in a core, falling off over its halo.
  const lightAt = (x, y) => {
    let v = 0
    for (const s of S.list) {
      if (y > s.y + 3) continue
      const d = Math.abs(x + 0.5 - shaftCx(s, y)) / (shaftHw(s, y) + 2.5)
      if (d < 1) v = Math.max(v, 1 - d * d)
    }
    return v
  }
  // The pools of light where the shafts land on the floor.
  const poolAt = (x, y) => {
    let v = 0
    for (const s of S.list) {
      const hw = shaftHw(s, s.y) + 3
      const dx = (x + 0.5 - s.x) / (hw * 1.3)
      const dy = (y + 0.5 - s.y) / (hw * 0.3 + 1.6)
      v = Math.max(v, Math.exp(-(dx * dx + dy * dy) * 1.1))
    }
    return v
  }

  // ------------------------------------------------ overlays: glow and mist
  let gid = 0
  // Each overlay also leaves a tint (x, y, colour beneath) => colour seen, for the encoder's map
  // of what lies beneath each layer (see beneath() below). part() picks them up.
  const tints = []
  const over = (col, op) => c => (op > 0 ? mix(c, col, op) : c)
  const lerpStops = (st, t) => {
    if (t <= st[0][0]) return st[0][1]
    for (let i = 0; i < st.length - 1; i++) if (t <= st[i + 1][0]) return st[i][1] + ((st[i + 1][1] - st[i][1]) * (t - st[i][0])) / (st[i + 1][0] - st[i][0] || 1)
    return st[st.length - 1][1]
  }
  // A soft ellipse of light: a radial gradient in stepped rings over a rect.
  const glowRect = (cx, cy, rx, ry, col, a) => {
    const id = 'G' + gid++
    const st = [[0, 1], [0.2, 0.86], [0.4, 0.6], [0.6, 0.32], [0.8, 0.12], [1, 0]]
    defs.push("<radialGradient id='" + id + "'>" + st.map(([o, k]) => "<stop offset='" + f2(o) + "' stop-color='" + col + "' stop-opacity='" + f3(a * k) + "'/>").join('') + '</radialGradient>')
    const [X, Y, Wd, Hd] = [Math.round(cx - rx), Math.round(cy - ry), Math.round(2 * rx), Math.round(2 * ry)]
    const ops = st.map(([o, k]) => [o, Number(f3(a * k))])
    tints.push((x, y, c) => {
      const u = (x + 0.5 - X) / Wd
      const v = (y - Y) / Hd
      if (u < 0 || u > 1 || v < 0 || v > 1) return c
      return over(col, lerpStops(ops, Math.hypot(u - 0.5, v - 0.5) * 2))(c)
    })
    return "<rect x='" + X + "' y='" + Y + "' width='" + Wd + "' height='" + Hd + "' fill='url(#" + id + ")'/>"
  }
  // A band of mist: clear above y0, thickest from y1 to y2, clear again by y3.
  const mistRect = (y0, y1, y2, y3, col, a) => {
    const id = 'G' + gid++
    const h = y3 - y0
    const at = y => f2((y - y0) / h)
    defs.push(
      "<linearGradient id='" + id + "' x2='0' y2='1'><stop stop-color='" + col + "' stop-opacity='0'/><stop offset='" + at(y1) + "' stop-color='" + col + "' stop-opacity='" + f2(a) + "'/><stop offset='" + at(y2) + "' stop-color='" + col + "' stop-opacity='" + f2(a) + "'/><stop offset='1' stop-color='" + col + "' stop-opacity='0'/></linearGradient>",
    )
    const ops = [[0, 0], [Number(at(y1)), Number(f2(a))], [Number(at(y2)), Number(f2(a))], [1, 0]]
    tints.push((x, y, c) => {
      const v = (y - y0) / h
      if (v < 0 || v > 1 || x < 0 || x >= W) return c
      return over(col, lerpStops(ops, v))(c)
    })
    return "<rect x='0' y='" + y0 + "' width='" + W + "' height='" + h + "' fill='url(#" + id + ")'/>"
  }

  // ------------------------------------------------ the haze behind everything: bands only
  const bg = new Layer('bg')
  for (let y = 0; y <= H; y++) {
    const c = skyAt(Math.floor(y / 4) * 4 + 2)
    for (let x = 0; x < W; x++) bg.set(x, y, c)
  }

  // ------------------------------------------------ trunks
  // Walks a trunk's cells: s runs -1 (left edge) to 1 (right edge) across it, `up` counts rows
  // above its foot.
  // A trunk's centre and half width on row y.
  function trunkSpan(t, y) {
    const up = t.base - y
    const cx = t.x + ((t.lean ?? 0) * up) / 100 + (t.wob ?? 0) * (noise(y * 0.035, t.x * 0.1, 3) - 0.5)
    const fh = t.flareH ?? t.flare * 2.6
    const fl = t.flare ? t.flare * Math.pow(Math.max(0, 1 - up / fh), 2.2) : 0
    return [cx, t.w / 2 + fl - (t.taper ?? 0) * (up / 200)]
  }
  // A plain fill a cell inside a trunk's outline, under its cells, so that where two of its
  // colours meet inside a screen pixel the bark shows through and not the haze behind it.
  function trunkBacking(list, col) {
    let d = ''
    for (const t of list) {
      // Each row from the middle of its outermost cell on the left to the middle of its
      // outermost cell on the right, as a stepped outline: down the right side, up the left.
      const rows = []
      for (let y = t.top ?? -2; y <= t.base; y++) {
        const [cx, hw] = trunkSpan(t, y)
        rows.push([y, Math.round(cx - hw) + 0.5, Math.round(cx + hw) - 0.5])
      }
      let s = 'M' + rows[0][2] + ' ' + (rows[0][0] - 0.5)
      let run = 0
      for (let i = 0; i < rows.length; i++) {
        run++
        if (i === rows.length - 1 || rows[i + 1][2] !== rows[i][2]) {
          s += 'v' + run + (i < rows.length - 1 ? 'h' + (rows[i + 1][2] - rows[i][2]) : '')
          run = 0
        }
      }
      s += 'H' + rows[rows.length - 1][1]
      for (let i = rows.length - 1; i >= 0; i--) {
        run++
        if (i === 0 || rows[i - 1][1] !== rows[i][1]) {
          s += 'v-' + run + (i > 0 ? 'h' + (rows[i - 1][1] - rows[i][1]) : '')
          run = 0
        }
      }
      d += s + 'z'
    }
    return "<path fill='" + col + "' d='" + d + "'/>"
  }
  // The cells that backing covers whole (all but the outermost cell of each row), for beneath().
  function backingCells(list, col) {
    const m = new Map()
    for (const t of list) {
      trunkCells(t, (x, y, s, up, cx, hw) => {
        if (x > Math.round(cx - hw) && x < Math.round(cx + hw) - 1) m.set((y + 1000) * ROW + x + 1000, col)
      })
    }
    return m
  }
  function trunkCells(t, fn) {
    for (let y = t.top ?? -2; y <= t.base; y++) {
      const up = t.base - y
      const [cx, hw] = trunkSpan(t, y)
      const x0 = Math.round(cx - hw)
      const x1 = Math.round(cx + hw)
      for (let x = x0; x < x1; x++) fn(x, y, clamp((x + 0.5 - cx) / hw, -1, 1), up, cx, hw)
    }
  }

  // A plane of trunks in the haze: flat bodies, a lit edge toward the light, a shaded one away.
  function plane(nm, list, tones) {
    const L = new Layer(nm)
    for (const t of list) {
      trunkCells(t, (x, y, s) => L.set(x, y, s < -0.4 ? tones[2] : s > 0.45 ? tones[0] : tones[1]))
      // A few stubs of dead branches.
      for (const [dy, dir, len] of t.stubs ?? []) {
        const y = t.base - dy
        const cx = t.x + ((t.lean ?? 0) * dy) / 100
        for (let i = 0; i < len; i++) L.set(Math.round(cx + dir * (t.w / 2 + i)), y - Math.floor(i / 2), tones[i ? 1 : 0])
      }
    }
    return L
  }
  const PL1 = fogged([P.bark[2], P.bark[4], P.rim[1]], P.fog[0], 100)
  const PL2 = fogged([P.bark[1], P.bark[3], P.rim[1]], P.fog[1], 110)
  const PLANE1 = [
    [3, 3, 142], [19, 2, 143], [37, 5, 142], [58, 3, 141], [77, 2, 142], [96, 6, 143], [121, 3, 142], [139, 2, 141],
    [162, 5, 142], [188, 3, 143], [207, 2, 142], [229, 6, 141], [251, 3, 142], [274, 2, 143], [293, 5, 142], [314, 3, 141],
  ].map(([x, w, base], i) => ({ x, w, base, lean: ((i * 37) % 7) - 3, flare: 1.5, flareH: 6, stubs: i % 3 === 0 ? [[60 + i * 3, i % 2 ? 1 : -1, 3]] : [] }))
  const PLANE2 = [
    [10, 8, 147, 2], [44, 4, 148, -3], [70, 3, 147, 4], [100, 7, 148, 1], [150, 4, 147, -3], [180, 3, 148, 2],
    [216, 8, 147, -1], [244, 4, 148, 3], [268, 6, 147, 0], [302, 4, 148, -2],
  ].map(([x, w, base, lean], i) => ({ x, w, base, lean, flare: 3, flareH: 9, taper: 1, stubs: i % 2 ? [[50 + i * 5, i % 4 ? 1 : -1, 4]] : [] }))

  // Foliage as puffs, the way Sunfield paints cumulus: a union of spheres lit from the upper
  // left, each lower puff in front of the ones above it, creases where one rolls over another,
  // and past the edge a fringe of small leaf lobes. o.v adds light by position.
  const LV = (() => {
    const v = [-0.5, -0.62, 0.6]
    const l = Math.hypot(...v)
    return v.map(c => c / l)
  })()
  function leafy(L, list, o) {
    const lobe = o.lobe ?? 2.4
    const fr = o.fringe ?? 1.6
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (const p of list) {
      x0 = Math.min(x0, p.x - p.r - fr - 1)
      x1 = Math.max(x1, p.x + p.r + fr + 1)
      y0 = Math.min(y0, p.y - p.r - fr - 1)
      y1 = Math.max(y1, p.y + p.r + fr + 1)
    }
    const out = new Set()
    for (let y = Math.floor(y0); y <= y1; y++) {
      for (let x = Math.floor(x0); x <= x1; x++) {
        const px = x + 0.5
        const py = y + 0.5
        let best = null
        let bz = -Infinity
        let z2 = -Infinity
        let qmax = -Infinity
        for (const p of list) {
          const dx = px - p.x
          const dy = py - p.y
          if (Math.abs(dx) > p.r + fr + 1 || Math.abs(dy) > p.r + fr + 1) continue
          const d2 = dx * dx + dy * dy
          const q = p.r - Math.sqrt(d2)
          if (q > qmax) qmax = q
          if (q > 0) {
            const nz = Math.sqrt(p.r * p.r - d2)
            const z = nz + (p.z ?? 0)
            if (z > bz) {
              z2 = bz
              bz = z
              best = { p, dx, dy, nz }
            } else if (z > z2) z2 = z
          }
        }
        let v
        const w = worley(px, py, lobe, o.seed)
        if (!best) {
          // The fringe: small lobes of leaves past the edge.
          if (qmax + fr * (1 - (w.a / lobe) * 1.5) <= 0) continue
          v = (o.base ?? 0.3) + (o.diff ?? 0.35) * 0.2 - 0.06
          out.add(x + ',' + y)
        } else {
          const { p, dx, dy, nz } = best
          const n = [dx / p.r, dy / p.r, nz / p.r]
          v = (o.base ?? 0.3) + (o.diff ?? 0.35) * (n[0] * LV[0] + n[1] * LV[1] + n[2] * LV[2])
          v -= (o.edgeDark ?? 0.12) * Math.pow(1 - n[2], 2)
          if (bz - z2 < (o.crease ?? 1.3) && dy > -p.r * 0.25) v -= o.creaseDark ?? 0.18
          // Leaves: a net of small lobes, each lit on its upper left, on the lit parts only.
          if (o.tex) {
            const lx = (px - w.px) / lobe
            const ly = (py - w.py) / lobe
            v += o.tex * smooth((v - 0.3) / 0.3) * (-(lx * 0.6 + ly * 0.8) - (w.b - w.a < 0.4 ? 0.6 : 0))
          }
        }
        if (o.v) v += o.v(x, y)
        L.set(x, y, tone(o.tones, v, x, y, o.dither ?? 0.12))
      }
    }
    // The light catches the outer edge toward it.
    if (o.rim) {
      for (const [x, y] of [...cells(L)]) {
        if (L.has(x - 1, y) && L.has(x, y - 1) && L.has(x - 1, y - 1)) continue
        const c = o.rim(x, y)
        if (c) L.set(x, y, c)
      }
    }
    return L
  }
  // Puffs scattered through a set of ellipses: big inside, small at the rim, lower ones in front.
  function scatter(rand, shapes, n, rIn, rOut) {
    const out = []
    for (let i = 0; i < n; i++) {
      const e = shapes[Math.floor(rand() * shapes.length)]
      const a = rand() * Math.PI * 2
      const d = Math.sqrt(rand())
      const x = e.x + Math.cos(a) * d * e.rx
      const y = e.y + Math.sin(a) * d * e.ry
      out.push({ x, y, r: lerp(rIn, rOut, d) * (0.8 + 0.4 * rand()), z: y * 0.35 })
    }
    return out
  }
  // A hanging chain of puffs from (x0, y0) down to (x1, y1), smaller toward its tip.
  function chain(rand, x0, y0, x1, y1, n, r0, r1) {
    return Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1)
      return { x: lerp(x0, x1, t) + (rand() - 0.5) * 2, y: lerp(y0, y1, t), r: lerp(r0, r1, t) * (0.85 + 0.3 * rand()), z: lerp(y0, y1, t) * 0.35 + 4 }
    })
  }

  // The far crowns behind the canopy gap, flat in the haze of the planes.
  const crown1 = new Layer('crown1')
  {
    const r = rng(41)
    leafy(crown1, scatter(r, [{ x: 150, y: -4, rx: 80, ry: 12 }, { x: 118, y: 6, rx: 22, ry: 8 }, { x: 196, y: 8, rx: 26, ry: 8 }], 26, 9, 4), {
      tones: fogged(P.leaf.slice(3, 7), P.fog[0] + 0.06, 40), seed: 41, lobe: 2.6, fringe: 2.6, base: 0.5, diff: 0.14, edgeDark: 0, crease: 0, tex: 0.15, dither: 0,
    })
  }
  const crown2 = new Layer('crown2')
  {
    const r = rng(42)
    leafy(crown2, [
      ...scatter(r, [{ x: 104, y: 10, rx: 20, ry: 10 }, { x: 92, y: 22, rx: 8, ry: 8 }], 14, 7, 3.5),
      ...scatter(r, [{ x: 206, y: 12, rx: 24, ry: 10 }, { x: 222, y: 24, rx: 8, ry: 8 }], 14, 7, 3.5),
      ...chain(r, 126, 16, 130, 30, 4, 3.5, 2),
      ...chain(r, 184, 18, 180, 32, 4, 3.5, 2),
    ], { tones: fogged(P.leaf.slice(2, 7), P.fog[1] + 0.04, 50), seed: 42, lobe: 2.4, fringe: 2.4, base: 0.45, diff: 0.22, edgeDark: 0.04, crease: 0.8, creaseDark: 0.08, tex: 0.2, dither: 0.02 })
  }

  // The floor mist in cells: rows of lit haze, see-through, drifting slowly.
  function mistLayer(nm, [y0, y1, dens], seed) {
    const L = new Layer(nm)
    for (let y = y0; y <= y1; y++) {
      const mid = (y - y0) / (y1 - y0)
      for (let x = -10; x < W + 10; x++) {
        const n = noise(x * 0.025, y * 0.35, seed) * 0.75 + noise(x * 0.09, y * 0.7, seed + 1) * 0.25
        const d = dens * Math.sin(Math.PI * clamp(mid, 0, 1)) ** 0.6
        if (n > 1 - d) L.set(x, y, n > 1 - d * 0.45 ? P.mist.col[1] : P.mist.col[0])
      }
    }
    return L
  }

  // ------------------------------------------------ the floor
  const groundTop = x => 143 + Math.round((noise(x * 0.07, 1, 21) - 0.5) * 2.4)
  // The stream comes out of the haze at the back, runs toward us under the log and bends away
  // to the bottom left.
  const STREAM = [[168, 144], [176, 147], [178, 151], [170, 156], [158, 160], [150, 165], [148, 170], [144, 175], [134, 181], [120, 187], [102, 194], [86, 201], [78, 206]]
  const streamX = y => {
    for (let i = 0; i < STREAM.length - 1; i++) {
      const [xa, ya] = STREAM[i]
      const [xb, yb] = STREAM[i + 1]
      if (y <= yb) {
        // A smooth curve through the points: cubic Hermite with central slopes.
        const t = clamp((y - ya) / (yb - ya), 0, 1)
        const p0 = STREAM[Math.max(0, i - 1)][0]
        const p3 = STREAM[Math.min(STREAM.length - 1, i + 2)][0]
        const m1 = (xb - p0) / 2
        const m2 = (p3 - xa) / 2
        const t2 = t * t
        const t3 = t2 * t
        return (2 * t3 - 3 * t2 + 1) * xa + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * xb + (t3 - t2) * m2
      }
    }
    return STREAM[STREAM.length - 1][0]
  }
  const streamHw = y => 1.6 + 13 * Math.pow(clamp((y - 144) / 58, 0, 1), 1.3) + (noise(y * 0.3, 2, 9) - 0.5) * 1.2
  const inStream = (x, y) => y >= 145 && Math.abs(x + 0.5 - streamX(y)) < streamHw(y)

  // Shadows the trunks cast on the floor, away from the light: a band from each foot toward us
  // and to the right, along the shafts' slant.
  const CASTERS = [[66, 157, 6], [110, 155, 8], [160, 152, 4], [214, 156, 7], [262, 196, 30], [44, 166, 6]]
  const shadowAt = (x, y) => {
    let v = 0
    for (const [bx, by, w] of CASTERS) {
      if (y < by) continue
      const cx = bx + S.sx * 1.3 * (y - by)
      const hw = w * (0.7 + (y - by) / 60)
      const d = Math.abs(x + 0.5 - cx) / hw
      if (d < 1) v = Math.max(v, (1 - d * d) * (1 - smooth((y - by) / 45)))
    }
    return v
  }

  // Ground value: lighter far off (the mist over it does the rest), pools where shafts land,
  // shadows of the trunks, big soft patches, darker toward us and along the water.
  const groundV = (x, y) => {
    const u = clamp((y - 143) / 57, 0, 1)
    let v = 0.4 - 0.06 * u - 0.16 * smooth((y - 184) / 16)
    v += Math.round((fbm(x * 0.04, y * 0.1, 31) - 0.5) * 3) * 0.07
    v += 0.55 * poolAt(x, y)
    v -= 0.16 * Math.round(shadowAt(x, y) * 2) / 2
    const ds = Math.abs(x + 0.5 - streamX(y)) - streamHw(y)
    if (ds < 3 && y > 146) v -= 0.1 * (1 - ds / 3)
    return v
  }
  const ground = new Layer('ground')
  for (let y = 140; y <= H; y++) for (let x = 0; x < W; x++) if (y >= groundTop(x)) ground.set(x, y, tone(P.grass, groundV(x, y), x, y, 0.05))
  // Grass blades and tufts, taller and denser toward us, their tips lit in the pools.
  const blades = new Layer('blades')
  const flowers = new Layer('flowers')
  {
    const r = rng(77)
    for (let i = 0; i < 340; i++) {
      const u = Math.pow(r(), 0.6)
      const y = Math.round(147 + u * 54)
      const x = Math.floor(r() * W)
      if (inStream(x, y)) continue
      const len = 1 + Math.floor(r() * (1 + u * 4))
      const pool = poolAt(x, y)
      const dark = r() < 0.4
      const v0 = groundV(x, y)
      for (let j = 0; j < len; j++) {
        const yy = y - j
        let v = v0 + (dark ? -0.16 : 0.1 + 0.06 * (j / len))
        if (j === len - 1 && !dark) v += 0.08 + 0.25 * pool
        blades.set(x, yy, tone(P.grass, v, x, yy, 0))
      }
    }
    // Small flowers, thickest in the sunlit glade.
    for (let i = 0; i < 300; i++) {
      const u = Math.pow(r(), 0.8)
      const y = Math.round(150 + u * 50)
      const x = Math.floor(r() * W)
      if (Math.abs(x + 0.5 - streamX(y)) < streamHw(y) + 1) continue
      const pool = poolAt(x, y)
      if (r() > 0.2 + pool * 1.6) continue
      const k = r() < 0.5 ? 0 : r() < 0.6 ? 1 : 2
      flowers.set(x, y, P.flowers[k])
      if (u > 0.5 && r() < 0.5) {
        flowers.set(x + 1, y, P.flowers[k])
        flowers.set(x, y + 1, tone(P.grass, 0.25 + 0.4 * pool, x, y, 0))
      }
    }
  }

  // The water: it mirrors the haze above, bright where a shaft lands on it, dark under the
  // banks, with lines of ripple; a mossy lip on its sunward bank.
  const water = new Layer('water')
  for (let y = 144; y <= H + 1; y++) {
    const cx = streamX(y)
    const hw = streamHw(y)
    const u = clamp((y - 144) / 57, 0, 1)
    for (let x = Math.floor(cx - hw - 1); x <= cx + hw + 1; x++) {
      const e = Math.min(x + 0.5 - (cx - hw), cx + hw - (x + 0.5))
      if (e < -0.6) continue
      if (e < 0.4) {
        // The banks: moss on the left, wet earth on the right.
        if (u > 0.08) water.set(x, y, x + 0.5 < cx ? tone(P.moss, 0.5 + 0.4 * poolAt(x, y), x, y, 0) : P.bark[2])
        continue
      }
      let v = 0.72 - 0.4 * u + 0.4 * poolAt(x, y)
      const n = noise(x * 0.2, y * 1.1, 61)
      if (n > 0.68) v += 0.16
      else if (n < 0.24) v -= 0.12
      if (e < 1.6 && u > 0.2) v -= 0.22
      water.set(x, y, tone(P.water, v, x, y, 0.05))
    }
  }
  // Glints on the water, three sets in turn.
  const glints = []
  for (let k = 0; k < 3; k++) {
    const r = rng(300 + k)
    const L = new Layer('glint' + k)
    for (let i = 0; i < 30; i++) {
      const y = Math.round(147 + Math.pow(r(), 0.8) * 53)
      const x = Math.round(streamX(y) + (r() - 0.5) * 1.5 * streamHw(y))
      if (!inStream(x, y) || !inStream(x + 1, y)) continue
      const len = 1 + Math.floor(r() * (1 + (y - 150) / 20))
      for (let j = 0; j < len; j++) if (inStream(x + j, y)) L.set(x + j, y, P.glint[j === 0 ? 0 : 1])
    }
    L.anim = anim('gl', '--l:' + f2(-k * 0.8) + 's', k ? " opacity='0'" : '')
    glints.push(L)
  }

  // ------------------------------------------------ the third plane: trunks at the glade's edge
  const B3 = fogged(P.bark, P.fog[2], 120)
  const M3 = fogged(P.moss, P.fog[2], 120)
  const R3 = fogged(P.rim, P.fog[2] * 0.5, 120)
  const PLANE3 = [
    { x: 66, w: 9, base: 157, lean: -3, flare: 4, seed: 1, taper: 2 },
    { x: 110, w: 13, base: 155, lean: 1, flare: 5, seed: 2, taper: 3 },
    { x: 160, w: 5, base: 152, lean: 3, flare: 3, seed: 3, taper: 1 },
    { x: 214, w: 10, base: 156, lean: -1, flare: 4, seed: 4, taper: 2 },
  ]
  const plane3 = new Layer('plane3')
  for (const t of PLANE3) {
    trunkCells(t, (x, y, s, up, cx, hw) => {
      const u = s * hw
      const fur = Math.sin((u + 3 * noise(y * 0.04, t.seed, 7)) * 1.5)
      const lit = lightAt(x, y)
      let v = 0.42 - 0.24 * s + 0.4 * lit
      if (fur > 0.72) v -= 0.18
      let c = tone(B3, v, x, y, 0)
      const m = noise(x * 0.16, y * 0.05, t.seed + 20) + 0.4 * (1 - smooth(up / 40)) - 0.25 * s
      if (m > 0.86) c = tone(M3, 0.4 + 0.3 * lit - 0.2 * s, x, y, 0)
      // The edge toward the light: bright where a shaft crosses it, a broken glint elsewhere.
      // Only the outermost cell of each row, so the edge stays one clean line.
      if (x === Math.round(cx - hw) && (lit > 0.25 || noise(y * 0.12, t.seed, 4) > 0.55)) c = R3[lit > 0.25 ? 2 : 0]
      plane3.set(x, y, c)
    })
  }
  // Undergrowth along the far edge of the glade: low mounds of fern and bush.
  const under3 = new Layer('under3')
  {
    const r = rng(43)
    const mounds = [[10, 153, 14, 5], [40, 155, 10, 4], [92, 156, 10, 3], [134, 155, 8, 3], [222, 155, 12, 4], [250, 152, 14, 5], [290, 151, 18, 6], [316, 152, 10, 5]]
    leafy(under3, mounds.flatMap(([x, y, rx, ry]) => scatter(r, [{ x, y, rx, ry }], Math.round(rx / 2.5), 4.5, 2.5)), {
      tones: fogged(P.leaf.slice(2), P.fog[2] + 0.08, 130), seed: 43, lobe: 2.2, fringe: 1.4, base: 0.4, diff: 0.4, dither: 0.08, v: (x, y) => 0.4 * lightAt(x, y),
    })
  }
  // Low bushes far back along the floor, in the mist, breaking the line where the floor ends.
  const under2 = new Layer('under2')
  {
    const r = rng(44)
    const list = []
    for (let x = -6; x < W + 8; x += 11 + Math.floor(r() * 14)) list.push(...scatter(r, [{ x, y: 143 - r() * 2, rx: 7, ry: 3.5 }], 3, 4.5, 2.5))
    leafy(under2, list, { tones: fogged(P.leaf.slice(3, 7), P.fog[1] + 0.08, 140), seed: 44, lobe: 2.2, fringe: 1.8, base: 0.45, diff: 0.3, edgeDark: 0.04, crease: 0.8, creaseDark: 0.08, dither: 0 })
  }
  for (const k of [...under3.m.keys()]) {
    const [x, y] = cellXY(k)
    if (y > 159 || Math.abs(x + 0.5 - streamX(y)) < streamHw(y) + 1) under3.m.delete(k)
  }

  // ------------------------------------------------ near trunks
  // Bark: vertical furrows that wander, the side to the light lifted, moss in patches thickest
  // near the foot and on the side the light comes from, a rim of light along the edge that
  // faces it, and the shafts' light where they strike.
  const isMoss = new Set(P.moss)
  function nearTrunk(L, t, o) {
    trunkCells(t, (x, y, s, up, cx, hw) => {
      const u = s * hw
      const fur = Math.sin((u + 4 * noise(y * 0.03, t.seed, 7) + 1.5 * noise(y * 0.15, t.seed, 8)) * (o.ridge ?? 1.2))
      const lit = o.light ? lightAt(x, y) : 0
      let v = (o.amb ?? 0.3) - (o.side ?? 0.18) * s
      v += (o.fill ?? 0) * Math.max(0, s - 0.4)
      if (fur > 0.66) v -= 0.18
      else if (fur < -0.8) v += 0.08
      v -= 0.12 * smooth((up - 150) / 60) // up into the shade of the canopy
      v += 0.5 * lit
      let c = tone(P.bark, v, x, y, 0.04)
      // Moss: ragged patches, thick near the foot and on the side toward the light, following
      // the ridges of the bark.
      const m =
        fbm(x * 0.1, y * 0.05, t.seed + 30) + 0.3 * (noise(x * 0.4, y * 0.3, t.seed + 31) - 0.5) - 0.08 * smooth((up - 30) / 60) +
        (o.mossFoot ?? 0.26) * (1 - smooth(up / (o.mossH ?? 70))) + (o.mossSide ?? -0.1) * s + (fur > 0.66 ? -0.06 : 0.03)
      if (m > 0.8) c = tone(P.moss, 0.32 + 0.8 * (m - 0.8) - 0.26 * s + 0.45 * lit, x, y, 0.1)
      // The edge toward the light: a thin rim, broken, bright where a shaft strikes.
      if (x === Math.round(cx - hw) && o.rimL !== undefined && (lit > 0.15 || noise(y * 0.1, t.seed, 2) > 0.5)) c = lit > 0.15 ? P.rim[2] : P.rim[o.rimL]
      if (s > 1 - 1.1 / hw && o.rimR !== undefined && noise(y * 0.1, t.seed, 3) > 0.45) c = P.rim[o.rimR]
      L.set(x, y, c)
    })
    // Moss catches the light on its upper edge and shades the bark under its lip.
    for (const [x, y, c] of [...cells(L)]) {
      const above = L.get(x, y - 1)
      if (!above) continue
      if (isMoss.has(c) && !isMoss.has(above)) L.set(x, y, P.moss[Math.min(P.moss.length - 1, P.moss.indexOf(c) + 2)])
      else if (!isMoss.has(c) && isMoss.has(above) && P.bark.includes(c)) L.set(x, y, P.bark[Math.max(0, P.bark.indexOf(c) - 2)])
    }
    return L
  }
  // Roots: ridges running out from the foot over the floor, mossy along the top.
  function root(L, pts, w, seed) {
    for (let i = 0; i <= 50; i++) {
      const t = i / 50
      const [x, y] = bez(pts, t)
      const hw = w * (1 - 0.7 * t)
      for (let k = Math.floor(-hw); k <= hw; k++) {
        const yy = Math.round(y + k)
        const xx = Math.round(x)
        const lit = lightAt(xx, yy) + 0.5 * poolAt(xx, yy)
        let c = tone(P.bark, 0.3 - 0.25 * (k / hw) + 0.4 * lit, xx, yy, 0.05)
        if (k < 0 && noise(xx * 0.18, yy * 0.3, seed) > 0.4) c = tone(P.moss, 0.45 + 0.4 * lit - 0.2 * (k / hw), xx, yy, 0.05)
        if (k === Math.floor(-hw)) c = lit > 0.2 ? P.rim[2] : tone(P.moss, 0.7, xx, yy, 0)
        L.set(xx, yy, c)
      }
    }
  }

  // The giant on the right: buttress roots spreading over the floor, a great limb reaching left
  // into the canopy, shelf fungus on its face.
  const giantR = new Layer('giantR')
  nearTrunk(giantR, { x: 288, w: 56, base: 201, lean: 4, wob: 4, flare: 22, flareH: 46, seed: 11 }, { light: true, rimL: 1, amb: 0.3, side: 0.2, mossH: 60, mossFoot: 0.2 })
  root(giantR, [[262, 188], [246, 193], [226, 200]], 3.5, 1)
  root(giantR, [[276, 192], [268, 197], [258, 203]], 3, 2)
  {
    const pts = [[268, 66], [238, 34], [194, -4]]
    for (let i = 0; i <= 120; i++) {
      const t = i / 120
      const [x, y] = bez(pts, t)
      const hw = 5.5 - 3 * t
      for (let k = Math.floor(-hw); k <= hw; k++) {
        const xx = Math.round(x + k * 0.55)
        const yy = Math.round(y + k * 0.8)
        let c = tone(P.bark, 0.26 - 0.2 * (k / hw), xx, yy, 0.05)
        if (k <= -hw + 2 && noise(xx * 0.12, yy * 0.12, 5) > 0.4) c = tone(P.moss, 0.5, xx, yy, 0)
        if (k === Math.floor(-hw)) c = glowAt(xx, yy) > 0.3 ? P.rim[1] : P.rim[0]
        giantR.set(xx, yy, c)
      }
    }
  }

  const giantL = new Layer('giantL')
  nearTrunk(giantL, { x: 14, w: 40, base: 201, lean: -3, wob: 3, flare: 14, flareH: 36, seed: 12 }, { rimR: 0, amb: 0.24, side: -0.04, fill: 0.2, mossH: 80, mossSide: 0.12, mossFoot: 0.3 })
  root(giantL, [[30, 191], [46, 196], [58, 203]], 3, 4)
  // A slimmer trunk behind it.
  const leftSlim = new Layer('leftSlim')
  {
    const B = fogged(P.bark, 0.22, 120)
    const M = fogged(P.moss, 0.22, 120)
    const t = { x: 50, w: 8, base: 166, lean: 3, flare: 4, seed: 13, taper: 2 }
    trunkCells(t, (x, y, s, up, cx, hw) => {
      let v = 0.32 - 0.22 * s
      if (Math.sin((s * hw + 2 * noise(y * 0.05, 9, 7)) * 1.6) > 0.75) v -= 0.15
      let c = tone(B, v, x, y, 0)
      if (noise(x * 0.2, y * 0.06, 33) + 0.3 * (1 - smooth(up / 30)) > 0.82) c = tone(M, 0.45 - 0.15 * s, x, y, 0)
      if (s < -1 + 1.5 / hw) c = mix(P.rim[0], B[3], 0.3)
      leftSlim.set(x, y, c)
    })
  }

  // ------------------------------------------------ the fallen log, the stone, mushrooms
  const log = new Layer('log')
  {
    const A = [110, 178]
    const B = [190, 166]
    const len = Math.hypot(B[0] - A[0], B[1] - A[1])
    const ux = (B[0] - A[0]) / len
    const uy = (B[1] - A[1]) / len
    const radAt = t => 5.2 - 1.6 * t + (noise(t * 8, 1, 71) - 0.5) * 0.8
    // Its shadow on the floor and water, under it.
    for (let x = A[0] - 3; x <= B[0] + 2; x++) {
      const t = clamp((x - A[0]) / (B[0] - A[0]), 0, 1)
      const yb = Math.round(A[1] + t * (B[1] - A[1]) + radAt(t))
      for (let k = 0; k < 2; k++) log.set(x, yb + k, inStream(x, yb + k) ? P.water[1] : P.grass[1])
    }
    for (let y = 150; y < 188; y++) {
      for (let x = A[0] - 6; x <= B[0] + 4; x++) {
        const px = x + 0.5 - A[0]
        const py = y + 0.5 - A[1]
        const t = (px * ux + py * uy) / len
        const d = -px * uy + py * ux // + below the axis
        const r = radAt(clamp(t, 0, 1))
        if (t > 1 || Math.abs(d) > r) continue
        // The sawn end toward us: an oval of pale wood with rings, its rim of bark.
        const e = Math.hypot((t * len) / 2.4, d / r)
        if (t < 0 && e > 1) continue
        if (e <= 1) {
          let c = e > 0.8 ? P.bark[2] : tone(P.stem, Math.floor(e * 4) % 2 ? 0.3 : 0.65, x, y, 0)
          if (e > 0.8 && d < -r * 0.3) c = P.rim[1]
          log.set(x, y, c)
          continue
        }
        const ny = d / r
        const lit = Math.max(poolAt(x, y + 3) * 0.7, lightAt(x, y) * 0.6)
        let v = 0.42 - 0.4 * ny + 0.4 * lit
        if (Math.sin(d * 2 + noise(t * 10, 3, 5) * 2.5) > 0.72) v -= 0.14
        let c = tone(P.bark, v, x, y, 0.06)
        // Moss over the top, bright where the light falls.
        if (ny < -0.1 && fbm(x * 0.13, y * 0.3, 77) + 0.3 * -ny > 0.6) c = tone(P.moss, 0.42 + 0.3 * -ny + 0.4 * lit, x, y, 0.08)
        if (ny < -0.8) c = lit > 0.15 ? P.rim[2] : tone(P.moss, 0.72, x, y, 0)
        log.set(x, y, c)
      }
    }
    // A branch stub rising from it.
    for (let i = 0; i < 9; i++) {
      log.set(170 + Math.round(i * 0.5), 167 - i, P.bark[i < 5 ? 3 : 4])
      log.set(169 + Math.round(i * 0.5), 167 - i, P.rim[1])
    }
  }

  // Mushrooms: little caps on stems, lit on top, gills in shade.
  function mushroom(L, x, y, w, h, o = {}) {
    for (let k = 0; k < h; k++) {
      L.set(x, y - k, P.stem[1])
      if (w > 4) L.set(x + 1, y - k, P.stem[0])
    }
    const top = y - h
    for (let j = 0; j < 3; j++) {
      const half = j === 0 ? w / 2 - 1 : j === 1 ? w / 2 : w / 2 - 0.5
      for (let i = Math.floor(-half + 0.5); i < half + 0.5; i++) {
        const xx = x + i + (w > 4 ? 1 : 0)
        let c = P.cap[j === 0 ? 3 : j === 1 ? 2 : 0]
        if (j === 0 && i < 0) c = P.cap[4]
        if (o.spots && j === 1 && hash(xx, top, 3) > 0.7) c = P.stem[2]
        L.set(xx, top - 2 + j, c)
      }
    }
  }
  const shrooms = new Layer('shrooms')
  mushroom(shrooms, 122, 172, 4, 2)
  mushroom(shrooms, 127, 171, 3, 1)
  mushroom(shrooms, 158, 169, 5, 2, { spots: true })
  mushroom(shrooms, 176, 167, 3, 1)
  mushroom(shrooms, 240, 193, 5, 3, { spots: true })
  mushroom(shrooms, 246, 195, 3, 2)
  mushroom(shrooms, 234, 196, 4, 2)
  for (const [x, y, w] of [[262, 146, 6], [264, 153, 5], [260, 160, 4]]) {
    for (let i = 0; i < w; i++) {
      shrooms.set(x + i - w, y, P.cap[i < 2 ? 4 : 3])
      shrooms.set(x + i - w + 1, y + 1, P.cap[1])
    }
  }

  const stone = new Layer('stone')
  {
    const cx = 136
    const cy = 191
    for (let y = cy - 7; y <= cy + 4; y++) {
      for (let x = cx - 11; x <= cx + 11; x++) {
        const dx = (x + 0.5 - cx) / 10
        const dy = (y + 0.5 - cy) / 6.5
        const d = dx * dx + dy * dy + (noise(x * 0.4, y * 0.4, 19) - 0.5) * 0.25
        if (d > 1 || y > cy + 3) continue
        const nz = Math.sqrt(Math.max(0, 1 - d))
        let v = 0.32 + 0.3 * (-dx * 0.5 - dy * 0.7) + 0.25 * nz + 0.3 * poolAt(x, y)
        let c = tone(P.stone, v, x, y, 0.1)
        if (dy < -0.1 && fbm(x * 0.2, y * 0.3, 18) - dy * 0.35 > 0.62) c = tone(P.moss, 0.48 + 0.3 * -dy, x, y, 0.08)
        if (d > 0.75 && dy < -0.45) c = P.rim[1]
        stone.set(x, y, c)
      }
    }
    for (let x = cx - 12; x <= cx + 12; x++) if (inStream(x, cy + 4) && !stone.has(x, cy + 4)) stone.set(x, cy + 4, P.water[6])
  }

  // ------------------------------------------------ ferns
  // A frond: a curving stalk with leaflets on both sides, longest a third of the way out, the
  // upper side of each leaflet lit. The outer part goes to `tips`, which stirs.
  function frond(still, tips, o) {
    let x = o.x
    let y = o.y
    const steps = Math.ceil(o.len * 2)
    let next = 1.5
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const a = o.a + (o.curl ?? 0.5) * t * t * Math.sign(Math.cos(o.a))
      x += Math.cos(a) * 0.5
      y += Math.sin(a) * 0.5
      const tgt = t > (o.tipFrom ?? 0.55) ? tips : still
      const lv = (o.lit ?? 0) * lightAt(x, y) + (o.vf ? o.vf(x, y) : 0)
      tgt.set(x, y, tone(o.tones, 0.25 + 0.2 * t + lv, Math.floor(x), Math.floor(y), 0))
      if (t * o.len >= next && t < 0.97) {
        next += o.gap ?? 1.7
        for (const sd of [1, -1]) {
          const ll = o.leaf * Math.pow(Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95)), 0.8) * (1 - 0.35 * t)
          const la = a + sd * (o.spread ?? 1.05)
          const lx = Math.cos(la)
          const ly = Math.sin(la)
          const up = ly < 0
          for (let s = 1; s <= ll; s += 0.75) {
            const px = x + lx * s + Math.cos(a) * s * 0.35
            const py = y + ly * s + Math.sin(a) * s * 0.35 + s * s * 0.03
            const q = s / ll
            let v = 0.42 + (up ? 0.18 : -0.12) + 0.12 * (1 - t) - 0.08 * q + lv
            tgt.set(px, py, tone(o.tones, v, Math.floor(px), Math.floor(py), 0.1))
          }
        }
      }
    }
  }
  function fernClump(nm, x, y, list, o = {}) {
    const still = new Layer(nm)
    const tips = new Layer(nm + 't')
    for (const [a, len, leaf] of list) frond(still, tips, { x, y, a, len, leaf, tones: o.tones ?? P.fern, curl: o.curl ?? 0.5, lit: o.lit ?? 0.35, gap: o.gap })
    return [still, tips]
  }

  // ------------------------------------------------ the canopy
  const canopy = new Layer('canopy')
  // The edge toward the light catches it only near the glow; elsewhere the leaves stay dark.
  const rimGold = mix(P.rim[2], P.leaf[7], 0.45)
  const rimLeaf = (x, y) => {
    const g = glowAt(x, y)
    if (noise(x * 0.35, y * 0.35, 7) < 0.42 || g < 0.32) return null
    return g > 0.55 ? rimGold : P.leaf[7]
  }
  {
    const r = rng(51)
    leafy(canopy, [
      // The left mass, low over the left giant, and a heavy bough hanging into the frame.
      ...scatter(r, [{ x: 10, y: 0, rx: 60, ry: 28 }, { x: 4, y: 40, rx: 24, ry: 26 }, { x: 72, y: 2, rx: 26, ry: 11 }], 64, 11, 5),
      // Thin across the top, over the gap.
      ...scatter(r, [{ x: 140, y: -8, rx: 42, ry: 9 }], 14, 8, 4),
      // The right mass, over the giant and its limb.
      ...scatter(r, [{ x: 302, y: 8, rx: 60, ry: 30 }, { x: 320, y: 50, rx: 22, ry: 24 }, { x: 228, y: -2, rx: 34, ry: 11 }], 64, 11, 5),
    ], { tones: P.leaf, seed: 51, lobe: 2.6, fringe: 2.8, base: 0.2, diff: 0.22, edgeDark: 0.08, crease: 1.4, creaseDark: 0.1, tex: 0.26, dither: 0, rim: rimLeaf, v: (x, y) => 0.34 * glowAt(x, y) - 0.04 })
  }
  // Leaves along the upper half of the right giant's great limb, so that it ends in a bough
  // wherever the frame cuts the canopy.
  const bough = new Layer('bough')
  {
    const r = rng(52)
    const pts = [[268, 66], [238, 34], [194, -4]]
    const list = []
    for (const t of [0.52, 0.64, 0.76, 0.88, 0.98]) {
      const [x, y] = bez(pts, t)
      list.push(...scatter(r, [{ x, y: y + 2, rx: 6, ry: 4 }], 3, 4.5, 3))
    }
    leafy(bough, list, { tones: P.leaf, seed: 52, lobe: 2.4, fringe: 2, base: 0.24, diff: 0.26, edgeDark: 0.08, crease: 1.2, creaseDark: 0.1, tex: 0.22, dither: 0, rim: rimLeaf, v: (x, y) => 0.3 * glowAt(x, y) - 0.03 })
  }
  // Hanging sprays at the corners, which sway.
  const sprayL = new Layer('sprayL')
  const sprayR = new Layer('sprayR')
  {
    const r = rng(61)
    // Leafy twigs hanging from a clump at the canopy's edge, curving down under their weight.
    const hang = (L, x, y, twigs, seed) => {
      for (const [a, len, leaf] of twigs) frond(L, L, { x, y, a, len, leaf, tones: P.leaf, curl: 0.9, gap: 1.5, spread: 0.85, vf: (xx, yy) => 0.32 * glowAt(xx, yy) - 0.04 })
      const C = new Layer('c')
      leafy(C, chain(r, x - 2, y - 4, x, y + 1, 3, 4.5, 3), { tones: P.leaf, seed, lobe: 2.2, fringe: 1.6, base: 0.26, diff: 0.3, edgeDark: 0.08, crease: 1.2, creaseDark: 0.1, tex: 0.2, dither: 0, rim: rimLeaf, v: (xx, yy) => 0.3 * glowAt(xx, yy) })
      for (const [cx, cy, c] of cells(C)) L.set(cx, cy, c)
    }
    hang(sprayL, 74, 16, [[0.5, 20, 4], [1.25, 14, 3.5]], 61)
    hang(sprayL, 50, 26, [[0.75, 18, 4], [2.3, 12, 3.5]], 62)
    hang(sprayL, 24, 46, [[0.9, 18, 4.5]], 63)
    hang(sprayL, 96, 6, [[0.45, 16, 3.5]], 64)
    hang(sprayR, 236, 16, [[2.6, 20, 4], [1.85, 13, 3.5]], 65)
    hang(sprayR, 264, 32, [[2.35, 18, 4]], 66)
    hang(sprayR, 302, 54, [[2.45, 20, 4.5], [1.7, 12, 3.5]], 67)
    hang(sprayR, 214, 6, [[2.7, 15, 3.5]], 68)
    sprayL.anim = anim('sw', '--d:7s;--l:-2s')
    sprayR.anim = anim('sw', '--d:8s;--l:-5s')
  }

  // ------------------------------------------------ light shafts
  // Each shaft is a stepped outline filled with the light's colour, fading in steps with depth;
  // a wider halo under a narrower core. They breathe slowly, out of step.
  let shaftsRaw
  const shaftCells = new Set() // every cell a shaft's halo reaches, for beneath()
  {
    const Y0 = S.top
    const Y1 = Math.max(...S.list.map(s => s.y)) + 2
    const levels = Array.from({ length: 16 }, (_, i) => {
      const q = i / 15
      return f3(S.a * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, q * 1.6 + 0.1))) * (1 - 0.4 * q))
    })
    let stops = ''
    levels.forEach((a, i) => {
      stops += "<stop offset='" + f2(i / 16) + "' stop-color='" + S.col + "' stop-opacity='" + a + "'/><stop offset='" + f2((i + 1) / 16) + "' stop-color='" + S.col + "' stop-opacity='" + a + "'/>"
    })
    defs.push("<linearGradient id='R' gradientUnits='userSpaceOnUse' x1='0' y1='" + (Y0 - 0.5) + "' x2='0' y2='" + (Y1 + 0.5) + "'>" + stops + '</linearGradient>')
    // Each shaft is a stack of vertical strokes down its stepped centre line, one cell further
    // over each time the slant gains a cell: drawn once, used twice, wide and faint for the
    // halo, narrow for the core. The lower half is a cell wider each side, as the light spreads.
    let out = "<g stroke='url(#R)'>"
    S.list.forEach((s, i) => {
      const ym = Math.round((Y0 + s.y) / 2)
      const w = Math.max(2, Math.round(shaftHw(s, (Y0 + ym) / 2) * 2))
      const secs = [[Y0, ym - 1, w], [ym, s.y - 1, w + 2]].map(([ya, yb, sw], k) => {
        const id = 'S' + i + k
        defs.push("<g id='" + id + "'>" + centreStrokes(ya, yb, y => Math.round(shaftCx(s, y) - sw / 2) + sw / 2) + '</g>')
        for (let y = ya; y <= yb; y++) {
          const x0 = Math.round(shaftCx(s, y) - sw / 2) - 2
          for (let x = x0; x < x0 + sw + 4; x++) shaftCells.add((y + 1000) * ROW + x + 1000)
        }
        return [id, sw]
      })
      let inner = "<g opacity='" + f2(S.halo) + "'>"
      for (const [id, sw] of secs) inner += "<use href='#" + id + "' stroke-width='" + (sw + 4) + "'/>"
      inner += '</g>'
      for (const [id, sw] of secs) inner += "<use href='#" + id + "' stroke-width='" + sw + "'/>"
      out += "<g class='ry' style='--d:" + s.d + 's;--l:' + f1(-((i * 3.7) % s.d)) + "s'>" + inner + '</g>'
    })
    shaftsRaw = out + '</g>'
  }

  // Dust motes in the shafts, each wandering a few cells on its own slow loop and catching the
  // light as it goes.
  const motes = []
  {
    const r = rng(91)
    for (const s of S.list) {
      const n = Math.round(3 + s.w * 0.6)
      for (let i = 0; i < n; i++) {
        const y = Math.round(lerp(S.top + 30, s.y - 10, r()))
        const x = Math.round(shaftCx(s, y) + (r() - 0.5) * 2 * shaftHw(s, y) * 0.8)
        const L = new Layer('mote')
        L.set(x, y, P.mote[r() < 0.5 ? 0 : 1])
        if (r() < 0.2) L.set(x + 1, y, P.mote[1])
        const d = sec(7 + r() * 7)
        L.anim = anim('mo m' + (i % 3), '--d:' + d + 's;--l:' + f1(-r() * d) + 's')
        motes.push(L)
      }
    }
  }

  // ------------------------------------------------ living things
  // A doe at the far edge of the glade, right of the stream, facing it: she grazes, head down,
  // then lifts her head and looks for a while. The haze of the third plane lies over her.
  const deer = []
  if (P.deerOn) {
    const D = fogged(P.deer, P.fog[2] + 0.06, 150)
    const col = { 0: D[0], 1: D[1], 2: D[2], 3: D[3], 4: D[4] }
    const X = 186
    const Y = 138
    const body = sprite(new Layer('deer'), X, Y, [
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '............41.',
      '...44333333333.',
      '...23333333332.',
      '....222222222..',
      '....1.1....1.1.',
      '....1.1....1.1.',
      '....1.1....1..1',
      '....0.0....0..0',
    ], col)
    const up = sprite(new Layer('deerUp'), X, Y, ['..4.4', '..343', '.3332', '43322', '.1222', '...322', '...3321'], col)
    const down = sprite(new Layer('deerDn'), X, Y + 8, ['..32', '.332', '433.', '.22.', '..1.'], col)
    up.anim = anim('du', '--l:-3s')
    down.anim = anim('dd', '--l:-3s', " opacity='0'")
    deer.push(body, up, down)
    css.push(
      '.du,.dd{animation:du 16s steps(1) calc(var(--l) + var(--m)) infinite}.dd{animation-name:dd}',
      '@keyframes du{0%{opacity:1}37.5%,100%{opacity:0}}@keyframes dd{0%{opacity:0}37.5%,100%{opacity:1}}',
    )
  }

  // Two-frame flutters: wings, tumbling leaves (--f the cycle, --g its offset).
  css.push(
    '.fa,.fb{animation:fa var(--f) steps(1) calc(var(--g) + var(--m)) infinite}.fb{animation-name:fb}',
    '@keyframes fa{0%{opacity:1}50%,100%{opacity:0}}@keyframes fb{0%{opacity:0}50%,100%{opacity:1}}',
  )

  // A butterfly over the log and the flowers, on a loop of straight hops, one cell at a time on
  // both axes, then a rest where it began.
  const fly = []
  if (P.flyOn) {
    const W0 = P.wing
    const col = { y: W0[0], w: W0[1], b: W0[2] }
    const X = 128
    const Y = 164
    const open = sprite(new Layer('flyA'), X, Y, ['ww.ww', 'wybyw', '.y.y.'], col)
    const shut = sprite(new Layer('flyB'), X, Y, ['..w..', '.wy..', '..b..'], col)
    open.anim = anim('fa')
    shut.anim = anim('fb', '', " opacity='0'")
    const SEGS = [[20, -10], [18, 6], [12, -12], [10, 10], [-24, 8], [-20, -10], [-16, 8]]
    const CELL = 0.15
    const TOTAL = 18
    let t = 0
    let cx = 0
    let cy = 0
    let kx = ''
    let ky = ''
    const pc = v => String(Math.round((v / TOTAL) * 1e6) / 1e4)
    for (const [dx, dy] of SEGS) {
      kx += pc(t) + '%{transform:' + (cx ? 'translateX(' + cx + 'px)' : 'none') + ';animation-timing-function:steps(' + Math.abs(dx) + ')}'
      ky += pc(t) + '%{transform:' + (cy ? 'translateY(' + cy + 'px)' : 'none') + ';animation-timing-function:steps(' + Math.abs(dy) + ')}'
      t += Math.abs(dx) * CELL
      cx += dx
      cy += dy
    }
    kx += pc(t) + '%,100%{transform:none}'
    ky += pc(t) + '%,100%{transform:none}'
    css.push(
      '.bx{animation:bx ' + TOTAL + 's steps(1) var(--m) infinite}.by{animation:by ' + TOTAL + 's steps(1) var(--m) infinite}',
      '@keyframes bx{' + kx + '}@keyframes by{' + ky + '}',
    )
    fly.push({ wrap: "<g class='bx' style='--f:.5s;--g:0s'><g class='by'>", end: '</g></g>', layers: [open, shut], sweep: [-1, 66, -17, 6] })
  }

  // Leaves come loose from the canopy now and then and drift down, swaying and turning over.
  const leaves = []
  {
    const r = rng(81)
    const FALL = 130
    // 40 s a leaf: 130 cells at 0.15 s each, a step dimmer, gone, and a wait.
    css.push(
      '.lf{animation:lf 40s steps(1) calc(var(--l) + var(--m)) infinite}',
      '@keyframes lf{0%{transform:none;opacity:1;animation-timing-function:steps(' + FALL + ')}46.25%{opacity:1}47.5%{opacity:.5}48.75%,100%{transform:translateY(' + FALL + 'px);opacity:0}}',
      '.lx{animation:lx var(--d) steps(1) calc(var(--l) + var(--m)) infinite alternate}',
      swingKf('lx', 4),
    )
    const starts = [[36, 40], [70, 24], [98, 10], [226, 18], [262, 40], [300, 56]]
    starts.forEach(([x, y], i) => {
      const A = new Layer('lfA')
      A.set(x, y, P.leafFall[1])
      A.set(x + 1, y, P.leafFall[2])
      const B = new Layer('lfB')
      B.set(x, y, P.leafFall[2])
      B.set(x, y + 1, P.leafFall[0])
      A.anim = anim('fa')
      B.anim = anim('fb', '', " opacity='0'")
      const l = ts(-(i * 6.65 + r() * 3) % 40)
      leaves.push({
        wrap: "<g class='lf' opacity='0' style='--l:" + l + "s'><g class='lx' style='--d:" + (3 + (i % 2)) + 's;--l:' + ts(-r() * 3) + "s;--f:1.2s;--g:" + ts(-r() * 1.2) + "s'>",
        end: '</g></g>',
        layers: [A, B],
      })
    })
  }

  // Fireflies at night: each wanders on its own slow loop and glows up, holds, and fades.
  const flies = []
  if (P.firefly) {
    const r = rng(71)
    const F = P.firefly
    css.push(
      '.fx{animation:fx var(--d) steps(1) calc(var(--l) + var(--m)) infinite}.fy{animation:fy var(--d) steps(1) calc(var(--l) + var(--m)) infinite}',
      '@keyframes fx{0%,100%{transform:none}10%{transform:translateX(1px)}20%{transform:translateX(2px)}30%{transform:translateX(3px)}40%{transform:translateX(4px)}55%{transform:translateX(3px)}65%{transform:translateX(2px)}75%{transform:translateX(1px)}85%{transform:none}90%{transform:translateX(-1px)}}',
      '@keyframes fy{0%,100%{transform:none}15%{transform:translateY(-1px)}30%{transform:translateY(-2px)}40%{transform:translateY(-3px)}60%{transform:translateY(-2px)}70%{transform:translateY(-1px)}80%{transform:none}90%{transform:translateY(1px)}}',
      '.ff{animation:ff var(--d) steps(1) calc(var(--l) + var(--m)) infinite}',
      '@keyframes ff{0%,60%,100%{opacity:0}10%,55%{opacity:.35}15%,50%{opacity:.7}20%,45%{opacity:1}}',
    )
    for (let i = 0; i < 15; i++) {
      const x = Math.round(lerp(24, 296, (i + r()) / 15))
      const y = Math.round(lerp(118, 188, Math.pow(r(), 0.8)))
      const L = new Layer('ff')
      L.set(x, y, F[0])
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) L.set(x + dx, y + dy, F[1])
      const d = 8 + Math.floor(r() * 7)
      L.anim = anim('ff', '--d:' + d + 's;--l:' + ts(-r() * d) + 's')
      flies.push({
        wrap: "<g class='fx' style='--d:" + (9 + Math.floor(r() * 7)) + 's;--l:' + ts(-r() * 9) + "s'><g class='fy' style='--d:" + (7 + Math.floor(r() * 6)) + 's;--l:' + ts(-r() * 7) + "s'>",
        end: '</g></g>',
        layers: [L],
      })
    }
  }

  // ------------------------------------------------ assemble, back to front
  const air = P.air
  part('pB', [{ under: true, layer: bg }])
  part('pB', [{ raw: glowRect(G.x, G.y, G.rx * 1.6, G.ry * 1.6, G.col, G.max) }])
  part('pT', [crown1])
  part('pB', [plane('p1', PLANE1, PL1)])
  part('pB', [{ raw: glowRect(G.x, G.y + 10, G.rx * 1.3, G.ry * 1.3, G.col, G.max * 0.55) + mistRect(84, 128, 146, 160, air.mist, air.m1) }])
  part('pT', [crown2])
  part('pB', [plane('p2', PLANE2, PL2)])
  part('pB', [under2])
  part('pB', [{ raw: glowRect(G.x + 10, G.y + 20, G.rx * 1.2, G.ry * 1.2, G.col, G.max * 0.3) + mistRect(100, 138, 150, 166, air.mist, air.m2) }])
  part('pB', [mistLayer('mist1', P.mist.rows[0], 11)].map(L => ((L.anim = anim('md', '--d:50s;--l:-12s', " opacity='" + f2(P.mist.o) + "'")), L)))
  part('pB', [{ under: true, layer: ground }])
  part('pB', [{ raw: mistRect(138, 146, 150, 178, air.mist, air.m3) }])
  part('pB', [{ raw: trunkBacking(PLANE3, B3[2]), cover: backingCells(PLANE3, B3[2]) }, blades, flowers, under3, plane3])
  part('pB', deer)
  part('pB', [water, ...glints])
  part('pB', [mistLayer('mist2', P.mist.rows[1], 12)].map(L => ((L.anim = anim('md', '--d:40s;--l:-30s', " opacity='" + f2(P.mist.o * 0.7) + "'")), L)))
  part('pB', [log, stone, shrooms])
  part('pB', [{ raw: shaftsRaw, unknown: shaftCells }])
  part('pB', motes)
  part('pB', fly)
  part('pB', flies)
  part('pBL', [leftSlim, giantL])
  part('pBR', [giantR])
  part('pBR', [bough])
  {
    const [a, at] = fernClump('fernL', 30, 201, [[-2.7, 22, 6], [-2.3, 26, 7], [-1.9, 24, 6.5], [-1.45, 20, 6], [-1.0, 25, 7], [-0.6, 22, 6], [-0.3, 16, 5]])
    at.anim = anim('gs', '--d:5s;--l:-1s')
    const [b, bt] = fernClump('fernR', 304, 201, [[-2.9, 20, 6], [-2.5, 24, 7], [-2.1, 26, 7], [-1.7, 22, 6], [-1.25, 24, 6.5], [-0.8, 18, 5.5]])
    bt.anim = anim('gs', '--d:6s;--l:-3s')
    const [c, ct] = fernClump('fernM', 222, 198, [[-2.6, 13, 4], [-2.1, 15, 4.5], [-1.6, 14, 4], [-1.1, 12, 4], [-0.6, 10, 3.5]], { lit: 0.5 })
    ct.anim = anim('gs', '--d:4s;--l:-2s')
    // The still fronds get two coats as well: where a tip meets its frond, the dark roots and
    // floor beneath their shared edge then show through by a sixteenth at most.
    for (const L of [a, b, c]) L.coats = 2
    part('pBL', [a, at])
    part('pBR', [b, bt])
    part('pB', [c, ct])
  }
  part('pT', leaves)
  part('pT', [canopy])
  part('pTL', [sprayL])
  part('pTR', [sprayR])

  beneath(parts)
  return encode(parts, defs, css)
}

// ---------------------------------------------------------------- what lies beneath
// For the encoder (encode-local.mjs, option `under`): where two colours of a layer meet inside a
// screen pixel, whatever lies beneath the layer shows through between them, by up to a quarter.
// Only where that is far from both colours is it a hairline, and only there must the encoder lay
// one colour under the other. This walks the bottom-centre part (pin pB, which holds the scene)
// in paint order and keeps, per cell, the colours that can show there: cell layers, the glow
// and mist gradients (sampled at the cell's centre), the backing inside the plane-3 trunks.
// What another pin draws (it lines up with pB only at some window shapes), what moves, and the
// light shafts (they breathe) make the cells they can reach unknown, and unknown always joins.
// Each run of still layers (drawn as one) gets the map as it stood before it; so do the glints
// and the doe's heads, which only show and hide.
function beneath(parts) {
  const seen = new Map() // key -> [colours] (null: unknown)
  const XY = k => [(k % ROW) - 1000, Math.floor(k / ROW) - 1000]
  const keyOf = (x, y) => (y + 1000) * ROW + x + 1000
  const MAXC = 8
  const put = (k, list) => {
    const u = [...new Set(list)]
    seen.set(k, u.length > MAXC ? null : u)
  }
  const unknown = (L, [dx0, dx1, dy0, dy1]) => {
    for (const k of L.m.keys()) {
      const [x, y] = XY(k)
      for (let dy = dy0; dy <= dy1; dy++) for (let dx = dx0; dx <= dx1; dx++) seen.set(keyOf(x + dx, y + dy), null)
    }
  }
  const underOf = L => {
    const snap = new Map()
    for (const k of L.m.keys()) for (const n of [k, k - 1, k + 1, k - ROW, k + ROW]) if (!snap.has(n)) snap.set(n, seen.get(n) ?? null)
    return (k, n) => {
      const a = snap.get(k)
      const b = snap.get(n)
      return a && b ? a.concat(b) : undefined
    }
  }
  // Another pin's part lines up with pB only at some window shapes: top-pinned parts sit up to
  // 21 rows higher, side-pinned ones up to 7 cells across (1200 x 780).
  const SWEEP = { pT: [0, 0, 0, 21], pTL: [-7, 7, 0, 21], pTR: [-7, 7, 0, 21], pBL: [-7, 7, 0, 0], pBR: [-7, 7, 0, 0] }
  for (const [pin, items] of parts) {
    if (pin !== 'pB') {
      for (const it of items) for (const L of it.wrap ? it.layers : it.under ? [it.layer] : it.m ? [it] : []) unknown(L, SWEEP[pin])
      continue
    }
    let group = []
    const flush = () => {
      if (!group.length) return
      const all = new Layer('')
      for (const L of group) for (const [k, c] of L.m) all.m.set(k, c)
      const under = underOf(all)
      for (const L of group) L.enc = { ...(L.enc ?? {}), under }
      for (const [k, c] of all.m) seen.set(k, [c])
      group = []
    }
    for (const it of items) {
      if (it.raw !== undefined) {
        flush()
        if (it.tints?.length) {
          for (const [k, cs] of seen) {
            if (!cs) continue
            const [x, y] = XY(k)
            put(k, cs.map(c => it.tints.reduce((v, t) => t(x, y, v), c)))
          }
        }
        if (it.cover) for (const [k, c] of it.cover) seen.set(k, [c])
        if (it.unknown) for (const k of it.unknown) seen.set(k, null)
        continue
      }
      if (it.under) {
        flush()
        it.layer.below = underOf(it.layer) // for the rows without a band (see underlay())
        for (const [k, c] of it.layer.m) seen.set(k, [c])
        continue
      }
      if (it.wrap) {
        flush()
        for (const L of it.layers) unknown(L, it.sweep ?? [-4, 4, -4, 4])
        continue
      }
      if (!it.anim) {
        group.push(it)
        continue
      }
      flush()
      const cls = it.anim.cls
      if (cls === 'gl' || cls === 'du' || cls === 'dd') {
        // Shown and hidden in place: beneath, then, is what was there or this layer.
        it.enc = { ...(it.enc ?? {}), under: underOf(it) }
        for (const [k, c] of it.m) {
          const cs = seen.get(k)
          if (cs) put(k, cs.concat(c))
        }
      } else if (cls === 'md') {
        // The floor mist: see-through, drifting 0 to 8 cells right.
        const op = Number((it.anim.extra.match(/opacity='([\d.]+)'/) ?? [, '1'])[1])
        const add = new Map()
        for (const [k, c] of it.m) {
          for (let dx = 0; dx <= 8; dx++) {
            const k2 = k + dx
            const cs = seen.get(k2)
            if (!cs) continue
            let a = add.get(k2)
            if (!a) add.set(k2, (a = []))
            for (const b of cs) a.push(mix(b, c, op))
          }
        }
        for (const [k, a] of add) put(k, seen.get(k).concat(a))
      } else unknown(it, it.sweep ?? [-4, 4, -4, 4])
    }
    flush()
  }
}

// ---------------------------------------------------------------- shaft strokes

// Rows ya..yb of a stepped centre line cx(y) as vertical strokes, one per step, at most 60 to a
// path. Stroked at width w they fill each row from cx - w/2 to cx + w/2.
function centreStrokes(ya, yb, cx) {
  const segs = []
  let c = cx(ya)
  let y0 = ya
  for (let y = ya + 1; y <= yb + 1; y++) {
    const n = y <= yb ? cx(y) : null
    if (n !== c) {
      segs.push([c, y0, y - y0])
      c = n
      y0 = y
    }
  }
  let out = ''
  for (let i = 0; i < segs.length; i += 60) {
    const part = segs.slice(i, i + 60)
    let d = 'M' + part[0][0] + ' ' + (part[0][1] - 0.5) + 'v' + part[0][2]
    for (let j = 1; j < part.length; j++) d += 'm' + (part[j][0] - part[j - 1][0]) + ' 0v' + part[j][2]
    out += "<path d='" + d + "'/>"
  }
  return out
}

// ---------------------------------------------------------------- motion

// A drift of `a` whole cells as eased keyframes (the class runs it there and back).
function swingKf(name, a, prop = 'translateX') {
  let k = ''
  let last = null
  for (let i = 0; i <= 20; i++) {
    const v = Math.round((a * (1 - Math.cos((Math.PI * i) / 20))) / 2)
    if (v !== last || i === 20) k += i * 5 + '%{transform:' + (v ? prop + '(' + v + 'px)' : 'none') + '}'
    last = v
  }
  return '@keyframes ' + name + '{' + k + '}'
}

// ---------------------------------------------------------------- encoding

const PIN = { pB: 'xMidYMax', pBL: 'xMinYMax', pBR: 'xMaxYMax', pT: 'xMidYMin', pTL: 'xMinYMin', pTR: 'xMaxYMin' }
const PATTERN_MIN = 55
const TILE_MAX = 28000 // cells in a pattern tile, clear cells included (see split())
const runsOf = s => (s.match(/[hv]-?\d/g) ?? []).length
// The largest step (mean channel difference) a band may show between two cells over it.
const BAND_T = 20
// How far apart two colours look, as the mean of the channel differences (0..255).
function apart(a, b) {
  const x = rgb(a)
  const y = rgb(b)
  return (Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2])) / 3
}

function encode(parts, extraDefs, extraCss) {
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
  const stats = { patterns: 0, runs: 0, bands: 0, colours: new Set(), byLayer: new Map() }

  // A layer's cells, written by the seam-proof encoder (./encode-local.mjs): wherever two colours
  // meet, the later one's edge lies over a solid run of the earlier one (or of the layer's
  // backing), so nothing from behind the layer shows through as a hairline at any window size.
  // L.enc holds a layer's own encoder options.
  function cellsOf(L, ox = 0, oy = 0) {
    for (const c of L.m.values()) stats.colours.add(c)
    return emitSafe(L, { ox, oy, ...(L.enc ?? {}) })
  }

  function draw(L) {
    const plain = cellsOf(L)
    const runs = runsOf(plain)
    const b = bounds(L)
    if (b && runs >= PATTERN_MIN && !L.band && (b.x1 - b.x0 + 2) * (b.y1 - b.y0 + 2) > TILE_MAX) return split(L, b)
    stats.runs += runs
    stats.byLayer.set(L.name, (stats.byLayer.get(L.name) ?? 0) + plain.length)
    if (runs < PATTERN_MIN) return plain
    stats.patterns++
    // The tile spans whole cells with a clear cell all round: the tile repeats, and at its
    // edges the raster would otherwise pick up the far side. Its corner sits on a cell corner
    // (rows are centred on whole y, so cell edges lie on y + .5): the tile is rastered into its
    // own bitmap from that corner, and a corner off the cell grid lands on a half pixel at odd
    // whole-pixel cell sizes (9 px a cell at 1440x900@2), where the whole bitmap is resampled.
    const x = b.x0 - 1
    const y = b.y0 - 1.5
    const id = nextId()
    defs.push('<pattern id="' + id + '" width="1" height="1">' + cellsOf(L, x, y) + '</pattern>')
    return '<rect x="' + x + '" y="' + f2(y) + '" width="' + (b.x1 - b.x0 + 2) + '" height="' + (b.y1 - b.y0 + 2) + '" fill="url(#' + id + ')"/>'
  }

  // A big still tile is cut into bands (after Side Street and Rainy Studio). Chromium draws a
  // tile over about 4.2 million device pixels (2048 x 2048) as a scaled bitmap, which blurs
  // every cell: the whole-picture tile of 323 x 204 cells at 8 and 9 px a cell, and at 10 and
  // 12 px a cell (4K screens) the tiles of 46,000-47,000 cells too. A band of at most TILE_MAX
  // cells, clear cells included, is still sharp at 12 px a cell. Each band also carries the
  // next one's first line, under it, so the cut leaves no seam, and the encoder treats the other
  // bands' cells as inside the layer (`around`), so the cut is not an outer edge. The bands run
  // in rows or in columns, whichever writes shorter; the cuts are chosen for the fewest bands,
  // colours per band and cells on the carried lines (the planes of thin trunks cut between
  // trunks, the blades' layer under the dense floor rows, where only the trunks cross).
  function split(L, b) {
    const all = new Set(L.m.keys())
    const plans = []
    for (const cols of [false, true]) {
      const at = k => cellXY(k)[cols ? 0 : 1]
      const across = k => cellXY(k)[cols ? 1 : 0]
      const [lo, hi] = cols ? [b.x0, b.x1] : [b.y0, b.y1]
      const lines = new Map()
      for (const [k, c] of L.m) {
        let e = lines.get(at(k))
        if (!e) lines.set(at(k), (e = { n: 0, a: Infinity, z: -Infinity, cs: new Set() }))
        e.n++
        e.a = Math.min(e.a, across(k))
        e.z = Math.max(e.z, across(k) + 1)
        e.cs.add(c)
      }
      // best[v]: the cheapest cover of lines lo..v-1 (estimated: a band's overhead, its colours'
      // paths, the cells of its carried line), the next band starting at v. Two weightings of
      // the colours are tried, and a plain plan (each band as large as it may be, then back to
      // the line with the fewest cells); each plan is written out to keep the shortest.
      const tries = []
      for (const perColour of [30, 4]) {
        const best = new Map([[lo, { cost: 0, cuts: [lo] }]])
        for (let s = lo; s < hi; s++) {
          const from = best.get(s)
          if (!from) continue
          let a = Infinity
          let z = -Infinity
          const cs = new Set()
          for (let e = s + 1; e <= hi; e++) {
            // own lines s..e-1, and the carried line e (none when e is the end)
            const l = lines.get(e - 1)
            if (l) {
              a = Math.min(a, l.a)
              z = Math.max(z, l.z)
              for (const c of l.cs) cs.add(c)
            }
            const carried = e < hi ? lines.get(e) : undefined
            const a2 = carried ? Math.min(a, carried.a) : a
            const z2 = carried ? Math.max(z, carried.z) : z
            if (z2 > a2 && (e - s + (e < hi ? 1 : 0) + 2) * (z2 - a2 + 2) > TILE_MAX) break
            const extra = carried ? [...carried.cs].filter(c => !cs.has(c)).length : 0
            const cost = from.cost + 120 + perColour * (cs.size + extra) + 8 * (carried?.n ?? 0)
            const prev = best.get(e)
            if (!prev || cost < prev.cost) best.set(e, { cost, cuts: [...from.cuts, e] })
          }
        }
        tries.push(best.get(hi).cuts)
      }
      {
        const max = Math.floor(TILE_MAX / ((cols ? b.y1 - b.y0 : b.x1 - b.x0) + 2)) - 3
        const cuts = [lo]
        while (hi - cuts.at(-1) > max + 1) {
          const s = cuts.at(-1)
          let v = s + max
          for (let u = s + max; u >= s + Math.ceil(max * 0.6); u--) if ((lines.get(u)?.n ?? 0) < (lines.get(v)?.n ?? 0)) v = u
          cuts.push(v)
        }
        cuts.push(hi)
        tries.push(cuts)
      }
      for (const cuts of new Set(tries.map(t => t.join()))) {
        const cutsAt = cuts.split(',').map(Number)
        const parts = []
        for (let i = 0; i + 1 < cutsAt.length; i++) {
          const last = i + 2 === cutsAt.length
          const part = new Layer(L.name + ' ' + (cols ? 'c' : 'r') + (i + 1) + '/' + (cutsAt.length - 1))
          for (const [k, c] of L.m) {
            const v = at(k)
            if (v >= cutsAt[i] && (v < cutsAt[i + 1] || (!last && v === cutsAt[i + 1]))) part.m.set(k, c)
          }
          part.enc = { ...(L.enc ?? {}), around: all }
          part.band = true
          if (part.m.size) parts.push(part)
        }
        plans.push({ parts, len: parts.reduce((n, p) => n + emitSafe(p, p.enc).length + 100, 0) })
      }
    }
    const { parts } = plans.reduce((p, q) => (q.len < p.len ? q : p))
    return parts.map(draw).join('')
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
    // (After Tide Line.) A cell left over a band meets the band-coloured cells above and below
    // it across an edge where something else shows through: above, its own row's band (which
    // starts at that edge); below, what lies under its row (its band, or the band above running
    // a row deeper, or with neither, whatever is behind the layer: the floor's far edge, where
    // the rows are not yet full). Where that is far from both colours, it is a hairline: keep
    // the neighbour as a cell too, so the edge lies between two cells the encoder joins.
    for (const [k, c] of [...L.m]) {
      const y = cellXY(k)[1]
      for (const n of [k - ROW, k + ROW]) {
        const nc = full.get(n)
        if (nc === undefined || L.m.has(n)) continue
        const leak = n < k ? colourOf.get(y) : colourOf.get(y) ?? colourOf.get(y - 1)
        if (n < k && leak === undefined) continue
        if (leak === undefined || (apart(leak, c) > BAND_T && apart(leak, nc) > BAND_T)) L.m.set(n, nc)
      }
    }
    // What lies beneath each edge between the cells left: the band of its row, or across rows
    // the two bands that meet there (a row with no band of its own lies over the band above
    // it, which runs a row deeper; below that, what beneath() saw behind the layer).
    const bandAt = y => colourOf.get(y) ?? colourOf.get(y - 1)
    L.enc = {
      ...(L.enc ?? {}),
      T: BAND_T,
      under: (k, n) => {
        const yk = cellXY(k)[1]
        const yn = cellXY(n)[1]
        const bands = yk === yn ? [bandAt(yk)] : [bandAt(Math.min(yk, yn)), bandAt(Math.max(yk, yn))]
        if (!bands.includes(undefined)) return bands
        const behind = L.below?.(k, n)
        return behind ? bands.filter(Boolean).concat(behind) : undefined
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
    stats.byLayer.set(L.name + '(bands)', out.length)
    return out
  }

  // Cells that a still layer above them in the same part always covers are dropped.
  function cull(layers) {
    const covered = new Set()
    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i]
      if (L.wrap || L.anim || L.under || L.raw !== undefined) continue
      for (const k of [...L.m.keys()]) {
        if (covered.has(k)) L.m.delete(k)
        else covered.add(k)
      }
    }
  }

  // (After Deep Reef and Tide Line.) A layer drawn in `coats` coats: inside a cell nothing
  // changes, and at an edge that falls inside a pixel, what lies beneath shows through less
  // (a quarter at most with one coat, about a seventh with two; a sixteenth where two layers
  // of two coats meet). The coats of a moving layer sit inside its group, so its opacity and
  // motion apply to them as one.
  function coat(inner, coats) {
    if (coats < 2) return inner
    const id = nextId()
    const again = ('<use href="#' + id + '"/>').repeat(coats - 1)
    if (/^<rect [^>]*\/>$/.test(inner)) return inner.replace('<rect ', '<rect id="' + id + '" ') + again
    return '<g id="' + id + '">' + inner + '</g>' + again
  }

  function renderLayers(layers) {
    let out = ''
    let still = null
    const flush = () => {
      if (still) out += coat(draw(still), still.coats ?? 1)
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
        // Still cells outside the grid never show: every viewport is sliced to it.
        still ??= new Layer('')
        still.name += (still.name ? '+' : '') + L.name
        if (L.enc) still.enc = { ...(still.enc ?? {}), ...L.enc }
        if (L.coats) still.coats = Math.max(still.coats ?? 1, L.coats)
        for (const [k, c] of L.m) {
          const [x, y] = cellXY(k)
          if (x >= -1 && x <= W && y >= -1 && y <= H) still.m.set(k, c)
        }
        continue
      }
      flush()
      // The fern tips (which meet their still fronds) and the hanging sprays (which hang over
      // the canopy) get two coats. The small sprites (motes, leaves, the butterfly, fireflies)
      // and the mist meet nothing that a coat would cover: their edges blend with what lies
      // beneath.
      const inner = coat(draw(L), L.coats ?? (/^(gs|sw)$/.test(L.anim.cls) ? 2 : 1))
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
    cull(layers)
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
    // Shafts breathe: their light swells and ebbs in twenty steps.
    '.ry{animation:ry var(--d) steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes ry{' + Array.from({ length: 21 }, (_, i) => i * 5 + '%{opacity:' + f2(0.62 + 0.38 * (0.5 + 0.5 * Math.cos((Math.PI * 2 * i) / 20))) + '}').join('') + '}',
    // Motes wander a few cells on a slow loop, brightening and dimming.
    '.mo{animation:var(--d) steps(1) ' + from('var(--l)') + ' infinite}',
    '.m0{animation-name:m0}@keyframes m0{0%{transform:none;opacity:.4}15%{transform:translate(1px,-1px);opacity:.7}30%{transform:translate(2px,-1px);opacity:1}45%{transform:translate(3px,0);opacity:1}60%{transform:translate(2px,1px);opacity:.7}75%{transform:translate(1px,1px);opacity:.4}90%,100%{transform:none;opacity:.4}}',
    '.m1{animation-name:m1}@keyframes m1{0%{transform:none;opacity:1}20%{transform:translateY(-1px);opacity:.7}40%{transform:translate(-1px,-2px);opacity:.4}60%{transform:translate(-1px,-1px);opacity:.4}80%{transform:translateX(-1px);opacity:.7}100%{transform:none;opacity:1}}',
    '.m2{animation-name:m2}@keyframes m2{0%{transform:none;opacity:.7}25%{transform:translate(1px,1px);opacity:1}50%{transform:translate(1px,2px);opacity:.7}75%{transform:translateY(1px);opacity:.4}100%{transform:none;opacity:.7}}',
    // Glints on the water: three sets in turn.
    '.gl{animation:gl 2.4s steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes gl{0%{opacity:1}33.3333%,100%{opacity:0}}',
    // Mist drifts a few cells there and back.
    '.md{animation:md var(--d) steps(1) ' + from('var(--l)') + ' infinite alternate}',
    swingKf('md', 8),
    // Sprays and fern tips sway a cell or two.
    '.sw{animation:sw var(--d) steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes sw{0%{transform:none}20%{transform:translateX(1px)}45%{transform:translate(2px,1px)}65%{transform:translateX(1px)}85%,100%{transform:none}}',
    '.gs{animation:gs var(--d) steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes gs{0%{transform:none}30%{transform:translateX(1px)}55%{transform:translate(1px,-1px)}75%{transform:translateX(1px)}90%,100%{transform:none}}',
    ...extraCss,
    // Reduced motion rests the scene on its finished frame.
    '@media (prefers-reduced-motion:reduce){:root *{animation:none!important}}',
  ]
  const CSS = RULES.join('')
  let svg =
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" font-family="a" color="a" style="--m:0s">' +
    '<style>' + CSS + '</style><defs>' + defs.join('') + extraDefs.join('') + '</defs>' + body + '</svg>'
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
  fs.writeFileSync(path.join(HERE, 'out', 'sunbeam-wood-' + name + '.svg'), svg)
  console.log(name.padEnd(8), svg.length, 'chars (scrubbed ~' + scrubbed + '), css', css, '| patterns', stats.patterns, '| runs', stats.runs, '| bands', stats.bands, '| colours', stats.colours.size)
  if (process.env.STATS) {
    const top = [...stats.byLayer].sort((a, b) => b[1] - a[1]).slice(0, 30)
    console.log('  chars: ' + top.map(([n, r]) => n.slice(0, 40) + ':' + r).join('  '))
  }
}
