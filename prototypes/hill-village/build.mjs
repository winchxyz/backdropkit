// Hill Village: a village spilling down a forested hillside into a valley, the sun coming up
// at the valley's far end, as one animated pixel-art SVG in three moments.
// node build.mjs [moment ...]  ->  out/hill-village-<moment>.svg   (STATS=1 lists the costliest layers)
//
// Painted on a 320 x 200 cell grid (x right, y down) and encoded the way Sunfield's build does
// it (../../../sunfield/tools/build.mjs): cells as 1-cell stroke runs, at most 64 runs a path,
// big still layers in patterns, nested pinned viewports, CSS motion in steps on a 0.05 s clock.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Layer, bayer, clamp, hex, lerp, rgb, rng, smooth, tone } from '../../../sunfield/tools/pixel.mjs'
import { H, W, cellXY, encode, scrubbedLength } from './encode.mjs'
import { MOMENTS } from './moments.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TICK = 0.05
const f1 = v => String(Math.round(v * 10) / 10).replace(/^0\./, '.').replace(/^-0\./, '-.')
const f2 = v => String(Math.round(v * 100) / 100).replace(/^0\./, '.').replace(/^-0\./, '-.')
const f3 = v => String(Math.round(v * 1000) / 1000).replace(/^0\./, '.')
const key = (x, y) => (y + 1000) * 4096 + (x + 1000)

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
const gauss = (x, c, w) => Math.exp(-(((x - c) / w) ** 2))
const mixA = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
const mixH = (a, b, t) => hex(mixA(rgb(a), rgb(b), t))
function ramp(stops, t) {
  if (t <= stops[0][0]) return stops[0][1]
  for (let i = 0; i < stops.length - 1; i++) {
    const [ta, ca] = stops[i]
    const [tb, cb] = stops[i + 1]
    if (t <= tb) return mixH(ca, cb, (t - ta) / (tb - ta))
  }
  return stops[stops.length - 1][1]
}
const norm3 = v => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

// Leaf clusters: the nearest of jittered points on a grid of g cells, as an offset from it in
// units of g, and the crease between it and the next nearest (small between two clusters).
function clusters(x, y, g, s) {
  const gx = Math.floor(x / g)
  const gy = Math.floor(y / g)
  let d1 = Infinity
  let d2 = Infinity
  let ox = 0
  let oy = 0
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = (gx + i + 0.2 + 0.6 * hash(gx + i, gy + j, s)) * g
      const cy = (gy + j + 0.2 + 0.6 * hash(gx + i, gy + j, s + 1)) * g
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const d = Math.hypot(dx, dy)
      if (d < d1) {
        d2 = d1
        d1 = d
        ox = dx / g
        oy = dy / g
      } else if (d < d2) d2 = d
    }
  }
  return { ox, oy, d1: d1 / g, crease: (d2 - d1) / g }
}

// Cells of a straight line (Bresenham).
function line(x0, y0, x1, y1) {
  const out = []
  let x = Math.round(x0)
  let y = Math.round(y0)
  const xe = Math.round(x1)
  const ye = Math.round(y1)
  const dx = Math.abs(xe - x)
  const dy = -Math.abs(ye - y)
  const sx = x < xe ? 1 : -1
  const sy = y < ye ? 1 : -1
  let err = dx + dy
  for (;;) {
    out.push([x, y])
    if (x === xe && y === ye) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x += sx
    }
    if (e2 <= dx) {
      err += dx
      y += sy
    }
  }
  return out
}

function inPoly(px, py, poly) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

// ---------------------------------------------------------------- materials (sRGB, 0..1)

const PLASTER = [0.94, 0.88, 0.77]
const OCHRE = [0.93, 0.78, 0.55]
const ROSE = [0.92, 0.74, 0.68]
const TIMBER = [0.32, 0.2, 0.15]
const STONE = [0.68, 0.62, 0.55]
const TILE = [0.74, 0.34, 0.22]
const TILE2 = [0.6, 0.27, 0.22]
const SLATE = [0.34, 0.36, 0.45]
const COPPER = [0.42, 0.74, 0.62]
const GRASS = [0.5, 0.5, 0.27]
const STUBBLE = [0.78, 0.64, 0.36]
const PLOUGH = [0.5, 0.34, 0.24]
const MEADOW = [0.46, 0.54, 0.28]
const CONIFER = [0.17, 0.28, 0.23]
const RUST = [0.8, 0.3, 0.12]
const ORANGE = [0.95, 0.52, 0.14]
const GOLD = [0.97, 0.75, 0.24]
const RED = [0.68, 0.17, 0.13]
const OLIVE = [0.56, 0.56, 0.2]
const BARK = [0.26, 0.18, 0.15]
const WOOD = [0.56, 0.38, 0.24]
const IRON = [0.16, 0.15, 0.18]
const FUR = [0.86, 0.5, 0.22]
const LEAVES = [RUST, ORANGE, GOLD, RED, RUST, ORANGE, OLIVE]

// ---------------------------------------------------------------- the land's shape

// The far ridges, back to front: the ground line under their trees.
const R1 = x => 80 - 8 * gauss(x, 40, 70) - 9 * gauss(x, 322, 44) + 8 * gauss(x, 232, 36) + 3 * (noise(x * 0.04, 1, 11) - 0.5)
const R2 = x => 100 - 9 * gauss(x, 292, 46) + 5 * gauss(x, 214, 40) - 5 * gauss(x, 150, 34) + 3 * (noise(x * 0.05, 2, 12) - 0.5)
const R3 = x => 118 - 7 * gauss(x, 300, 34) + 8 * gauss(x, 218, 26) - 3 * gauss(x, 170, 20) + 2 * (noise(x * 0.07, 3, 13) - 0.5)
// The village hill on the left, from its forested crest down to the valley floor.
const HILL = x => (x <= 100 ? 94 + 5 * (x / 100) + 1.5 * Math.sin(x * 0.09) : 99 + 52 * smooth((x - 100) / 112)) + 1.2 * (noise(x * 0.1, 4, 14) - 0.5)
// The slope across the valley on the right, wooded with autumn trees.
const SLOPE = x => 150 - 40 * smooth((x - 228) / 110) + 1.5 * (noise(x * 0.08, 5, 15) - 0.5)
const VP = [218, 128] // the valley's far end, where its lines meet
const ROAD_Y = 157 // the road over the bridge and along the far bank
// The stream from the far end of the valley to us: centre line and half width.
const STREAM = [[219, 127, 0.6], [224, 133, 1], [216, 141, 1.6], [214, 147, 2.2], [222, 154, 3.6], [219, 162, 7], [218, 171, 11], [212, 182, 14], [206, 192, 18], [204, 204, 22]]

function streamAt(y) {
  for (let i = 0; i < STREAM.length - 1; i++) {
    const [xa, ya, wa] = STREAM[i]
    const [xb, yb, wb] = STREAM[i + 1]
    if (y >= ya && y <= yb) {
      const t = smooth((y - ya) / (yb - ya))
      return [lerp(xa, xb, t), lerp(wa, wb, (y - ya) / (yb - ya))]
    }
  }
  return null
}

// ---------------------------------------------------------------- the light

// One key light a moment, fixed before anything is painted (see notes.md). `at` is where it
// sits on the grid (cell x, y), `dir` the direction toward it (x right, y up, z away from us),
// `colour` its colour and `shadow` the colour shadows take: the ambient sky light, all a shadow
// gets. Every object is lit from that side and throws its shadow away from it. `rim` is the
// way (on screen: x right, y down) the edges that catch its rim light face, `rimK` how strong
// that rim is; an edge turned more than 60 degrees from it gets none.
export const KEYLIGHT = {
  // the sun on the far ridge, low on the right and behind the village: a backlight. Fronts
  // are in shade, right walls and right roof planes lit, right and upper-right edges rimmed;
  // shadows run left and toward us (2.43 cells left and 0.48 down a cell of height), about
  // 2.5 times as long as things are tall, over the lawns and down the terrace walls.
  sunrise: { at: [238, 84], dir: [0.62, 0.42, 0.67], colour: '#ffc88a', shadow: '#5a3c7c', rim: [1, -0.5] },
  // the sun high at the upper right, behind: short shadows down and to the left that hug the
  // feet of things (0.75 cells left and 0.23 down a cell of height); top and right edges
  // rimmed, more faintly.
  day: { at: [200, 24], dir: [0.233, 0.778, 0.583], colour: '#fff4dc', shadow: '#7088b0', rim: [0.6, -0.8], rimK: 0.75 },
  // the moon at the upper left, over the big tree: a cool light on left-facing planes and
  // left edges, faint short shadows to the right.
  night: { at: [26, 52], dir: [-0.46, 0.82, 0.26], colour: '#a8b8e0', shadow: '#121a34', rim: [-1, -0.25] },
}
// Local lights at night: [colour, reach in cells]. Lit windows light the wall round them and
// the ground under them; lamps light their post's upper part and a pool of ground round it.
export const LOCAL = { window: ['#ffcf6e', 4], lamp: ['#ffd88a', 8], bridgeLamp: ['#ffe0a0', 15] }

// The oblique view the houses and the shadows are drawn in: a cell back into the scene shows
// KX across and KY up.
const KX = 0.6
const KY = 0.3

// ---------------------------------------------------------------- the scene

function scene(name) {
  const K0 = KEYLIGHT[name]
  const M = { ...MOMENTS[name], light: K0.dir, from: K0.at, rimDir: K0.rim, rimK: K0.rimK ?? 1 }
  const parts = [] // [pin, entries] in paint order
  const part = (pin, entries) => parts.push([pin, entries])
  const anim = (cls, style = '', extra = '') => ({ cls, style, extra })
  const fx = { smoke: [], leaves: [] }

  // ------------------------------------------------ light
  const Lv = norm3(M.light)
  const HZ = M.haze.map(rgb)
  const hazeAt = d => (d <= 0.5 ? mixA(HZ[0], HZ[1], d / 0.5) : mixA(HZ[1], HZ[2], (d - 0.5) / 0.5))
  // haze grows slowly over the village and quickly beyond it: the near planes keep their
  // contrast, the far ones fade
  const fogAt = d => lerp(M.fog[0], M.fog[1], d < 0.5 ? 0.5 * (d / 0.5) ** 1.5 : d)
  const toneCache = new Map()
  // n tones of a material at depth d (0 at our feet, 1 the farthest ridge), from facing away
  // from the light (the ambient alone) to facing it square on; `mist` adds haze on top.
  function tones(alb, d, n = 6, mist = 0) {
    const k = alb.join() + '|' + f2(d) + '|' + n + '|' + f2(mist)
    let t = toneCache.get(k)
    if (t) return t
    const hz = hazeAt(d)
    const f = clamp(fogAt(d) + mist, 0, 1)
    t = []
    for (let i = 0; i < n; i++) {
      const l = i / (n - 1)
      t.push(hex(mixA(alb.map((a, j) => 255 * a * (M.amb[j] + M.key[j] * l)), hz, f)))
    }
    toneCache.set(k, t)
    return t
  }
  // How many tones a shaded surface gets: fewer at night, when they are hard to tell apart.
  const nT = n => Math.max(3, Math.round(n * (M.toneK ?? 1)))
  const lit = n => clamp(dot3(norm3(n), Lv), 0, 1)
  const lightFront = lit([0, 0, -1])
  const lightSide = lit([1, 0, 0])
  const fogged =(c, d, k = 1) => mixH(c, hex(hazeAt(d)), fogAt(d) * k)

  // Only the edges that face the light catch a rim of it. How squarely an outline cell's edge
  // faces the light: its outward direction (toward the empty cells round it, the near ones
  // counting most) against the way the moment's lit edges face (KEYLIGHT rim); 0 off the
  // outline.
  function rimFacing(o, x, y) {
    if (o.has(x + 1, y) && o.has(x - 1, y) && o.has(x, y + 1) && o.has(x, y - 1)) return 0
    let nx = 0
    let ny = 0
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if ((!dx && !dy) || o.has(x + dx, y + dy)) continue
        const w = 1 / (dx * dx + dy * dy)
        nx += dx * w
        ny += dy * w
      }
    }
    const [tx, ty] = M.rimDir
    const l = Math.hypot(nx, ny) * Math.hypot(tx, ty)
    return l ? (nx * tx + ny * ty) / l : 0
  }
  const rimCache = new Map()
  function rimTone(s, d) {
    const T = M.rim.tones
    const i = clamp(Math.floor(s * T.length), 0, T.length - 1)
    const k = i + '|' + f2(d)
    if (!rimCache.has(k)) rimCache.set(k, fogged(T[i], d, 0.55))
    return rimCache.get(k)
  }

  // An object being painted: its cells, each [colour, how strongly its edge catches the rim
  // light]. Committed to a layer once whole, so the rims follow its own outline.
  class Obj {
    constructor(d) {
      this.d = d
      this.m = new Map()
    }
    set(x, y, c, k = 0.6) {
      this.m.set(key(Math.floor(x), Math.floor(y)), [c, k])
    }
    has(x, y) {
      return this.m.has(key(x, y))
    }
    del(x, y) {
      this.m.delete(key(x, y))
    }
  }
  // Night's local lights, set once the windows and lamps are known (see "local lights"): each
  // { x, y, reach, k (strength), ry (how flat its pool is), on (the objects, or their tags, it
  // falls on) }.
  let local = null
  const NIGHT = !!M.lamp?.glow
  const LIGHTS = []
  const addLight = (x, y, reach, k, on, ry = 1) => NIGHT && LIGHTS.push({ x, y, reach, k, on, ry })
  let curHouse = null
  function commit(o, L, rimK = 1) {
    for (const [k, [c, rk]] of o.m) {
      const [x, y] = cellXY(k)
      let out = c
      const s = rk * M.rim.k * rimK
      if (s >= 0.35) {
        // an edge turned more than about 60 degrees from the light gets none
        const f = rimFacing(o, x, y)
        if (f > 0.5) out = rimTone(s * M.rimK * (f > 0.85 ? 1 : 0.78), o.d)
      }
      L.set(x, y, local ? local(x, y, out, o) : out)
    }
    return L
  }

  // ------------------------------------------------ shadows
  // The scene as a world: gx to the right, gz away from us, v up. A point on the ground at
  // screen row Y lies gz = -Y / KY deep, and a point v above it shows v rows higher, so the
  // houses' oblique boxes are boxes in it. Whatever throws a shadow is a caster: its bounds in
  // the world and a test for the points inside it. A point is lit when the ray from it toward
  // the key light meets no caster; three rays a little apart give a soft edge that widens with
  // the distance from the caster.
  const LW = norm3(M.light)
  const AX = LW[0] / LW[1]
  const AZ = LW[2] / LW[1]
  const toW = (X, Yg, v = 0) => {
    const gz = -Yg / KY
    return [X - gz * KX, gz, v]
  }
  const toS = (gx, gz, v) => [gx + gz * KX, -gz * KY - v]
  const casters = []
  let grid = null
  const GB = 8
  function caster(id, b, inside, step = 0.5) {
    casters.push({ id, b, inside, step })
    grid = null
  }
  const boxC = (id, x0, x1, z0, z1, vmax, top, v0 = 0) => caster(id, [x0, x1, z0, z1, v0, vmax], (x, z, v) => x >= x0 && x <= x1 && z >= z0 && z <= z1 && v <= top(x, z))
  const ellC = (id, cx, cz, cv, rx, rz, rv) => caster(id, [cx - rx, cx + rx, cz - rz, cz + rz, cv - rv, cv + rv], (x, z, v) => ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 + ((v - cv) / rv) ** 2 <= 1)
  const coneC = (id, cx, cz, v0, h, r) => caster(id, [cx - r, cx + r, cz - r, cz + r, v0, v0 + h], (x, z, v) => v >= v0 && v <= v0 + h && Math.hypot(x - cx, z - cz) <= r * (1 - (v - v0) / h), 0.35)
  const postC = (id, cx, cz, h, r = 0.6, v0 = 0) => caster(id, [cx - r, cx + r, cz - r, cz + r, v0, v0 + h], () => true, 0.2)
  function buildGrid() {
    grid = new Map()
    for (const c of casters) {
      const [x0, x1, z0, z1, v0, v1] = c.b
      let sx0 = Infinity
      let sx1 = -Infinity
      let sy0 = Infinity
      let sy1 = -Infinity
      for (const x of [x0, x1]) {
        for (const z of [z0, z1]) {
          for (const v of [v0, v1]) {
            for (const [px, pz, pv] of [[x, z, v], [x - AX * v * 1.2, z - AZ * v * 1.2, 0]]) {
              const [sx, sy] = toS(px, pz, pv)
              sx0 = Math.min(sx0, sx)
              sx1 = Math.max(sx1, sx)
              sy0 = Math.min(sy0, sy)
              sy1 = Math.max(sy1, sy)
            }
          }
        }
      }
      for (let gy = Math.floor((sy0 - 3) / GB); gy <= Math.floor((sy1 + 3) / GB); gy++) {
        for (let gx = Math.floor((sx0 - 3) / GB); gx <= Math.floor((sx1 + 3) / GB); gx++) {
          const k = gx + ',' + gy
          if (!grid.has(k)) grid.set(k, [])
          grid.get(k).push(c)
        }
      }
    }
  }
  function blocked(px, pz, pv, ax, az, list, self) {
    const len = Math.hypot(ax, az, 1)
    for (const c of list) {
      if (self && c.id === self) continue
      const [x0, x1, z0, z1, v0, v1] = c.b
      let t0 = 0.6
      let t1 = Infinity
      for (const [p, d, a, b] of [[px, ax, x0, x1], [pz, az, z0, z1], [pv, 1, v0, v1]]) {
        if (Math.abs(d) < 1e-9) {
          if (p < a || p > b) t0 = Infinity
          continue
        }
        let ta = (a - p) / d
        let tb = (b - p) / d
        if (ta > tb) [ta, tb] = [tb, ta]
        t0 = Math.max(t0, ta)
        t1 = Math.min(t1, tb)
      }
      if (t0 > t1) continue
      const dt = c.step / len
      for (let t = t0; t <= t1 + 1e-9; t += dt) if (c.inside(px + ax * t, pz + az * t, pv + t)) return true
    }
    return false
  }
  const JIT = [0, 0.06, -0.06]
  const JD = JIT.map(j => [AX * Math.cos(j) - AZ * Math.sin(j), AX * Math.sin(j) + AZ * Math.cos(j)])
  // How much of the key light reaches a world point (0 in full shadow, 1 in full light).
  function vis(gx, gz, v, self) {
    if (!grid) buildGrid()
    const [sx, sy] = toS(gx, gz, v)
    const list = grid.get(Math.floor(sx / GB) + ',' + Math.floor(sy / GB))
    if (!list) return 1
    let n = 0
    for (const [ax, az] of JD) if (!blocked(gx, gz, v, ax, az, list, self)) n++
    return n / JD.length
  }
  // The same for a screen cell standing v rows above the ground at row Yg.
  const visS = (X, Yg, v = 0, self) => vis(...toW(X + 0.5, Yg + 0.5, v), self)

  // ------------------------------------------------ the plan
  // Everything that stands on the ground and throws a shadow, laid out before any painting so
  // every surface knows what shades it.
  const H1 = [
    { x: 8, y: 113, w: 10, ht: 6, d: 8, rh: 7, kind: 'gable', roof: TILE, wall: 'timber' },
    { x: 26, y: 116, w: 13, ht: 6, d: 8, rh: 6, kind: 'eave', roof: TILE2, wall: 'plaster', plaster: OCHRE },
    { x: 46, y: 114, w: 10, ht: 7, d: 8, rh: 7, kind: 'gable', roof: SLATE, wall: 'timber' },
    { x: 118, y: 119, w: 12, ht: 6, d: 8, rh: 6, kind: 'eave', roof: TILE, wall: 'timber' },
    { x: 140, y: 126, w: 10, ht: 6, d: 8, rh: 7, kind: 'gable', roof: TILE2, wall: 'plaster', plaster: ROSE },
  ]
  const H2 = [
    { x: -2, y: 136, w: 15, ht: 8, d: 10, rh: 8, kind: 'eave', roof: TILE, wall: 'timber' },
    { x: 20, y: 134, w: 13, ht: 9, d: 10, rh: 10, kind: 'gable', roof: TILE2, wall: 'timber', plaster: OCHRE },
    { x: 42, y: 139, w: 16, ht: 8, d: 10, rh: 8, kind: 'eave', roof: SLATE, wall: 'plaster', plaster: ROSE },
    { x: 104, y: 141, w: 13, ht: 9, d: 10, rh: 10, kind: 'gable', roof: TILE, wall: 'timber' },
    { x: 74, y: 146, w: 14, ht: 8, d: 10, rh: 8, kind: 'eave', roof: TILE, wall: 'timber', plaster: OCHRE },
    { x: 132, y: 143, w: 15, ht: 8, d: 10, rh: 8, kind: 'eave', roof: TILE2, wall: 'timber', plaster: OCHRE },
    { x: 162, y: 149, w: 12, ht: 8, d: 10, rh: 9, kind: 'gable', roof: TILE, wall: 'plaster' },
  ]
  const H3 = [
    { x: 0, y: 172, w: 18, ht: 11, d: 12, rh: 12, kind: 'gable', roof: TILE2, wall: 'timber', plaster: OCHRE },
    { x: 30, y: 166, w: 19, ht: 12, d: 12, rh: 13, kind: 'gable', roof: TILE, wall: 'timber', stoneBase: true, flowers: true, door: true },
    { x: 62, y: 170, w: 22, ht: 11, d: 12, rh: 10, kind: 'eave', roof: TILE2, wall: 'timber', plaster: OCHRE, door: true, shutters: [0.3, 0.45, 0.32] },
    { x: 104, y: 168, w: 18, ht: 12, d: 12, rh: 13, kind: 'gable', roof: SLATE, wall: 'timber', plaster: ROSE, flowers: true },
    { x: 134, y: 172, w: 20, ht: 11, d: 12, rh: 10, kind: 'eave', roof: TILE, wall: 'plaster', stoneBase: true, door: true, shutters: [0.2, 0.36, 0.5] },
    { x: 166, y: 182, w: 16, ht: 10, d: 11, rh: 12, kind: 'gable', roof: TILE2, wall: 'stone', chimSide: -0.3 },
  ]
  const H4 = [
    { x: 66, y: 210, w: 28, ht: 16, d: 14, rh: 18, kind: 'gable', roof: TILE2, wall: 'timber', stoneBase: true, flowers: true, chimSide: -0.3 },
    { x: 112, y: 214, w: 30, ht: 15, d: 14, rh: 13, kind: 'eave', roof: TILE, wall: 'timber', plaster: OCHRE, shutters: [0.26, 0.4, 0.3], chimAt: 0.3 },
  ]
  const TIERS = [
    {
      houses: H1,
      d: 0.4,
      trees: [
        { x: 4, y: 108, r: 4, alb: RUST },
        { x: 60, y: 110, r: 4.5, alb: GOLD },
        { x: 108, y: 113, r: 4, alb: ORANGE },
        { con: true, x: 135, y: 121, h: 13, w: 3 },
      ],
    },
    {
      houses: H2,
      d: 0.3,
      trees: [
        { x: 14, y: 125, r: 5, alb: ORANGE },
        { x: 66, y: 128, r: 6, alb: RED },
        { x: 92, y: 131, r: 5, alb: GOLD },
        { x: 126, y: 132, r: 5.5, alb: RUST },
        { x: 40, y: 128, r: 4, alb: OLIVE },
        { con: true, x: 156, y: 146, h: 16, w: 4 },
        { x: 180, y: 141, r: 5, alb: GOLD },
        { x: 192, y: 146, r: 4, alb: RUST },
      ],
      gardens: [[2, 141, 10, 4], [58, 146, 10, 3], [116, 147, 10, 4], [146, 150, 10, 4]],
    },
    {
      houses: H3,
      d: 0.18,
      trees: [
        { x: 24, y: 150, r: 7, alb: GOLD },
        { x: 56, y: 156, r: 5, alb: RED },
        { x: 96, y: 152, r: 7, alb: RUST },
        { x: 130, y: 156, r: 6, alb: ORANGE },
        { x: 160, y: 160, r: 5, alb: OLIVE },
        { x: 186, y: 166, r: 6.5, alb: RED, trunk: 4 },
      ],
      gardens: [[88, 174, 12, 5], [40, 172, 12, 4], [154, 174, 8, 4], [14, 185, 20, 6], [40, 192, 14, 5]],
    },
    { houses: H4, d: 0.08, trees: [{ x: 104, y: 186, r: 9, alb: ORANGE, trunk: 6 }, { x: 156, y: 192, r: 8, alb: GOLD, trunk: 6 }] },
  ]
  const NAVE = { x: 64, y: 118, w: 22, ht: 9, d: 12, rh: 9, kind: 'eave', roof: SLATE, wall: 'plaster' }
  const TOWER = { x: 84, y: 122, w: 10, ht: 34, d: 10 }
  // trees on the slope across the valley and along the hill's crest
  const SLOPE_TREES = []
  {
    const r = rng(81)
    for (let row = 0; row < 5; row++) {
      for (let x = 222 + row * 3; x < W + 10; x += 7 + r() * 6) {
        const y = SLOPE(x) + 3 + row * 6 + r() * 3
        if (y > ROAD_Y - 6) continue
        SLOPE_TREES.push({ x, y, r: 4 + r() * 3.5, con: r() < 0.22, alb: LEAVES[Math.floor(r() * LEAVES.length)], seed: Math.floor(r() * 1e6) })
      }
    }
    SLOPE_TREES.sort((a, b) => a.y - b.y)
  }
  const WOODS = []
  {
    const r = rng(91)
    for (let x = -8; x < 150; x += 4 + r() * 4) {
      const y = HILL(x) + 1 + r() * 3
      WOODS.push({ x, y, r: 3.6 + r() * 3, con: r() < 0.45, alb: LEAVES[Math.floor(r() * LEAVES.length)], seed: Math.floor(r() * 1e6) })
    }
    WOODS.sort((a, b) => a.y - b.y)
  }
  // haystacks on the near meadow: [x, y of the foot, radius]
  const STACKS = [[284, 175, 5], [302, 180, 6.5], [268, 169, 4], [318, 172, 4.5]]
  // lamps along the lane: [x, y of the foot, height, depth]
  const LAMPS = [[105, 128, 4, 0.3], [96, 145, 4, 0.28], [126, 154, 5, 0.22], [162, 157, 5, 0.2], [190, ROAD_Y - 1, 6, 0.24], [248, ROAD_Y - 1, 6, 0.24]]
  const ARCH = { cx: 218, cy: 171, rx: 12, ry: 10 }
  const BR = { x0: 186, x1: 252, top: ROAD_Y - 1, water: 171 }

  // ------------------------------------------------ the terraces
  const bankL = y => {
    const s = streamAt(y + 0.5)
    return s ? s[0] - s[1] - 1 : 240
  }
  // where each row of houses stands: a line through the feet of its houses
  const footLine = list => {
    const pts = list.map(h => [h.x + h.w / 2, h.y]).sort((a, b) => a[0] - b[0])
    return x => {
      if (x <= pts[0][0]) return pts[0][1]
      for (let i = 0; i < pts.length - 1; i++) if (x <= pts[i + 1][0]) return lerp(pts[i][1], pts[i + 1][1], (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0]))
      const [lx, ly] = pts[pts.length - 1]
      return ly + (x - lx) * 0.3
    }
  }
  // A terrace's front edge: the feet of its houses smoothed into a gentle curve that never
  // passes behind a foot, so every house stands on the top, then moved `lawn` rows forward to
  // leave a strip of open ground in front of them (where their shadows fall), as far as the
  // houses of the next row down leave room for the path and the wall (`stack` rows) in front.
  function edgeLine(list, lawn = 0, next = [], stack = 0) {
    const fl = footLine(list)
    const X0 = -12
    const need = []
    const R = []
    for (let x = X0; x <= 262; x++) {
      let f = -Infinity
      for (const h of list) if (x >= h.x - 2 && x <= h.x + h.w + 2) f = Math.max(f, h.y)
      need.push(f)
      R.push(Math.max(fl(x), f))
    }
    let S = R
    for (let it = 0; it < 4; it++) {
      S = S.map((_, i) => {
        let s = 0
        let n = 0
        for (let j = Math.max(0, i - 10); j <= Math.min(S.length - 1, i + 10); j++) {
          s += S[j]
          n++
        }
        return Math.max(s / n, need[i])
      })
    }
    const lim = S.map((_, i) => {
      let l = Infinity
      for (const h of next) if (i + X0 >= h.x - 3 && i + X0 <= h.x + h.w + 3) l = Math.min(l, h.y - stack - 2)
      return l
    })
    let L = S.map((v, i) => Math.max(v, Math.min(v + lawn, lim[i])))
    for (let it = 0; it < 2; it++) {
      L = L.map((_, i) => {
        let s = 0
        let n = 0
        for (let j = Math.max(0, i - 4); j <= Math.min(L.length - 1, i + 4); j++) {
          s += L[j]
          n++
        }
        return clamp(s / n, S[i], Math.max(S[i], lim[i]))
      })
    }
    return x => L[clamp(Math.round(x) - X0, 0, L.length - 1)]
  }
  // per terrace: the path's width less one and the wall's height (rows), and the open ground in
  // front of its houses (rows)
  const TER = [[1, 2], [1, 3], [1, 3]]
  const LAWN = [3, 4, 3]
  const EDGE = [0, 1, 2].map(k => edgeLine(k ? TIERS[k].houses : [...TIERS[0].houses, NAVE, TOWER], LAWN[k], TIERS[k + 1].houses, TER[k][0] + TER[k][1] + 2))
  // The terraces' heights: the near meadow, the stream and the bridge at 0; each wall lifts the
  // ground behind it by its height, so the top terrace, where the church stands, is 8 up. TH[k]
  // is the height of the terrace the houses of tier k stand on.
  const TH = [0, 0, 0, 0]
  for (let k = 2; k >= 0; k--) TH[k] = TH[k + 1] + TER[k][1]
  // What the hill is at screen cell (X, Y): the terrace whose front edge the row lies past (k,
  // -1 above the first), how far past (e), what it is ('top', 'path', 'cap', 'face', 'seam')
  // and its height.
  function groundAt(X, Y) {
    let k = -1
    for (let i = 0; i < 3; i++) if (Y > Math.round(EDGE[i](X))) k = i
    if (k < 0) return { k, e: 0, kind: 'top', h: TH[0] }
    const e = Y - Math.round(EDGE[k](X))
    const [pw, wh] = TER[k]
    if (e <= pw) return { k, e, kind: 'path', h: TH[k] }
    if (e === pw + 1) return { k, e, kind: 'cap', h: TH[k] }
    if (e <= pw + 1 + wh) return { k, e, kind: 'face', h: TH[k] - (e - pw - 1) + 0.5 }
    return { k, e, kind: e === pw + 2 + wh ? 'seam' : 'top', h: TH[k + 1] }
  }
  // The ground's height at a world point (gx, gz): by the walls it lies in front of. Off the
  // hill (the stream, its banks, the bridge and the meadow) it is 0.
  function terrainH(gx, gz) {
    const X = gx + gz * KX
    const Yg = -gz * KY
    if (X >= 238 || X < -4) return 0
    let j = 0
    for (let k = 0; k < 3; k++) if (Yg > Math.round(EDGE[k](X)) + TER[k][0] + 1.5 + TH[k]) j = k + 1
    const h = TH[j]
    if (Yg - h > 140 && X >= bankL(Yg - h)) return 0
    return h
  }
  // The key light reaching screen cell (X, Y) of the ground, standing h above the base.
  const visG = (X, Y, h, self) => vis(...toW(X + 0.5, Y + 0.5 + h, h), self)
  // The casters. Each stands on its terrace: `lift` is that terrace's height (LIFT by id, for
  // the painters that shade them).
  const LIFT = new Map()
  // A house: its walls and roof as a box with a roof on it.
  function houseCaster(id, h) {
    const b = h.lift ?? 0
    LIFT.set(id, b)
    const [gx0, gz0] = toW(h.x, h.y + b)
    const ov = h.ov ?? 1
    if (h.kind === 'gable') {
      boxC(id, gx0 - ov, gx0 + h.w + ov, gz0 - 0.4, gz0 + h.d, b + h.ht + h.rh, (x) => b + h.ht + h.rh * Math.max(0, 1 - Math.abs(x - gx0 - h.w / 2) / (h.w / 2 + ov)), b)
    } else {
      boxC(id, gx0 - ov, gx0 + h.w + ov, gz0 - 0.6, gz0 + h.d, b + h.ht + h.rh, (x, z) => b + h.ht + h.rh * Math.max(0, 1 - Math.abs(z - gz0 - h.d / 2) / (h.d / 2 + 0.6)), b)
    }
  }
  // A round crown on a trunk, at screen centre (x, y) with radius r, its foot on row yb.
  function crownCaster(id, x, y, r, yb, b = 0) {
    LIFT.set(id, b)
    const [gx, gz] = toW(x, yb + b)
    ellC(id, gx, gz, b + yb - y, r, r * 0.9, r)
    postC(id, gx, gz, yb - y, 0.7, b)
  }
  let hid = 0
  TIERS.forEach((t, ti) => {
    t.houses.forEach(h => {
      h.id = 'h' + hid++
      h.lift = TH[ti]
      houseCaster(h.id, h)
    })
    t.trees.forEach((tr, i) => {
      tr.id = 't' + ti + '.' + i
      if (tr.con) {
        LIFT.set(tr.id, TH[ti])
        const [gx, gz] = toW(tr.x, tr.y + TH[ti])
        coneC(tr.id, gx, gz, TH[ti], tr.h, tr.w)
      } else crownCaster(tr.id, tr.x, tr.y, tr.r, tr.y + tr.r + (tr.trunk ?? 2), TH[ti])
    })
  })
  NAVE.lift = TH[0]
  TOWER.lift = TH[0]
  houseCaster('nave', NAVE)
  {
    const b = TOWER.lift
    LIFT.set('tower', b)
    const [gx0, gz0] = toW(TOWER.x, TOWER.y + b)
    boxC('tower', gx0, gx0 + TOWER.w, gz0, gz0 + TOWER.d, b + TOWER.ht + 1, () => b + TOWER.ht + 1, b)
    const cx = gx0 + TOWER.w / 2
    const cz = gz0 + TOWER.d / 2
    ellC('tower', cx, cz, b + TOWER.ht + 6, TOWER.w / 2 + 1.4, TOWER.w / 2 + 1.4, 6)
    caster('tower', [cx - 1.2, cx + 1.2, cz - 1.2, cz + 1.2, b + TOWER.ht + 11, b + TOWER.ht + 26], () => true, 0.25)
  }
  SLOPE_TREES.forEach((t, i) => {
    t.id = 's' + i
    const [gx, gz] = toW(t.x, t.y + t.r)
    if (t.con) coneC(t.id, gx, gz, 0, t.r * 2.6, t.r * 0.62)
    else ellC(t.id, gx, gz, t.r, t.r, t.r * 0.9, t.r)
  })
  // the crest's woods, behind the top terrace
  WOODS.forEach((t, i) => {
    t.id = 'w' + i
    const b = TH[0]
    LIFT.set(t.id, b)
    const [gx, gz] = toW(t.x, (t.con ? t.y + 2 : t.y + t.r) + b)
    if (t.con) coneC(t.id, gx, gz, b, t.r * 3, t.r * 0.6)
    else ellC(t.id, gx, gz, b + t.r, t.r, t.r * 0.9, t.r)
  })
  // the hill itself: a ray that passes under the ground behind a terrace wall is blocked
  {
    const zA = toW(0, 92)[1]
    const zB = toW(0, 210)[1]
    caster('terrain', [-4 - zA * KX, 240 - zB * KX, zB, zA, 0, TH[0]], (x, z, v) => v < terrainH(x, z) - 0.01, 0.5)
  }
  STACKS.forEach(([hx, hy, hr], i) => {
    const [gx, gz] = toW(hx, hy)
    ellC('k' + i, gx, gz, 0, hr, hr, hr * 1.5)
  })
  LAMPS.forEach(([x, y, h], i) => {
    const b = x < 180 ? groundAt(x, y).h : 0
    const [gx, gz] = toW(x, y + b)
    postC('l' + i, gx, gz, h + 2, 0.6, b)
  })
  {
    // the bridge: a wall of stone over the water, with the arch through it
    const [gx0, gz0] = toW(BR.x0, BR.water)
    const hump = x => Math.round(-2.2 * gauss(x, ARCH.cx, 24))
    caster('bridge', [gx0, gx0 + BR.x1 - BR.x0, gz0, gz0 + 3, 0, BR.water - BR.top + 3], (x, z, v) => {
      const sx = x - gx0 + BR.x0
      if (v > BR.water - BR.top - hump(sx)) return false
      return ((sx - ARCH.cx) / ARCH.rx) ** 2 + (v / ARCH.ry) ** 2 >= 1
    })
    // the olive at the bridge's end
    crownCaster('olive', 181, 150, 7, ROAD_Y + 1)
  }

  // ------------------------------------------------ sky
  const skyBands = []
  for (let t = -40; t < 240; t += 2) skyBands.push(ramp(M.sky, t + 1))
  const G = M.glow
  const glowAt = (x, y) => (G ? Math.exp(-(((x + 0.5 - G.x) / G.rx) ** 2) - (((y + 0.5 - G.y) / G.ry) ** 2)) : 0)
  const skyT = (x, y) => y + (G ? G.lift * glowAt(x, y) : 0)
  const skyAt = (x, y) => skyBands[clamp(Math.floor((skyT(x, y) + 40) / 2), 0, skyBands.length - 1)]
  const sky = new Layer('sky')
  for (let y = 0; y < 132; y++) for (let x = 0; x < W; x++) sky.set(x, y, skyAt(x, y))

  // Stars and the moon.
  const starLayers = []
  if (M.stars) {
    const r = rng(211)
    const still = new Layer('stars')
    for (let i = 0; i < 120; i++) {
      const x = Math.floor(r() * W)
      const y = Math.floor(2 + Math.pow(r(), 1.3) * 96)
      if (M.moon && Math.hypot(x - M.moon.x, y - M.moon.y) < 13) continue
      if (i < 12) {
        const L = new Layer('star' + i)
        L.set(x, y, M.stars[0])
        if (i < 5) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) L.set(x + dx, y + dy, M.stars[2])
        const d = 5 * (1 + Math.floor(r() * 4))
        L.anim = anim('tk', '--d:' + d + 's;--l:' + f1(-r() * d) + 's')
        starLayers.push(L)
      } else still.set(x, y, M.stars[r() < 0.3 ? 1 : 2])
    }
    starLayers.unshift(still)
  }
  const orb = new Layer('orb')
  if (M.moon) {
    const { x: cx, y: cy, r: R, tones: T, halo } = M.moon
    const craters = new Set(['-2,-2', '-1,-2', '1,1', '2,1', '-1,2', '2,-3', '-3,0'])
    for (let y = -R - 3; y <= R + 2; y++) {
      for (let x = -R - 3; x <= R + 2; x++) {
        const d = Math.hypot(x + 0.5, y + 0.5)
        if (d >= R) {
          if (d < R + 1.6 && (x + y) % 2 === 0) orb.set(cx + x, cy + y, halo)
          continue
        }
        const nz = Math.sqrt(R * R - d * d) / R
        let v = 0.5 + 0.5 * ((-(x + 0.5) / R) * 0.4 + (-(y + 0.5) / R) * 0.5 + nz * 0.5)
        if (craters.has(x + ',' + y)) v -= 0.25
        orb.set(cx + x, cy + y, tone(T, v, x, y, 0.4))
      }
    }
  }
  if (M.sun) {
    const { x: cx, y: cy, r: R, tones: T, halo } = M.sun
    for (let y = Math.floor(cy - R - 4); y <= cy + R + 4; y++) {
      for (let x = Math.floor(cx - R - 4); x <= cx + R + 4; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R
        if (d >= 1) {
          if (d < 1 + 1.2 / R) orb.set(x, y, halo)
          else if (d < 1 + 3 / R && (x + y) % 2 === 0) orb.set(x, y, halo)
          continue
        }
        orb.set(x, y, tone(T, 1 - 0.85 * Math.pow(d, 4), x, y, 0.25))
      }
    }
  }

  // Clouds: streaks of soft-edged puffs, lit along the side that faces the light.
  const C = M.clouds
  const CLOUDS = [
    // a heavy bank high on the left, its underside lit
    { seed: 1, puffs: [[-6, 30, 26, 6], [26, 26, 24, 8], [58, 30, 22, 7], [88, 35, 20, 5], [116, 38, 16, 3], [36, 38, 30, 4]], base: 41, drift: [64, 5, 20] },
    // a long band over the sun
    { seed: 2, puffs: [[170, 56, 16, 2.4], [198, 53, 22, 4], [230, 50, 24, 5.5], [262, 47, 22, 6], [292, 49, 22, 5], [324, 52, 18, 3.5]], base: 56, drift: [58, 4, 6] },
    { seed: 3, puffs: [[40, 62, 22, 1.6], [70, 64, 18, 1.3]], drift: [50, 4, 30] },
    { seed: 4, puffs: [[290, 70, 18, 1.4], [314, 71, 12, 1]], drift: [46, 3, 12] },
    { seed: 5, puffs: [[214, 26, 22, 2], [248, 23, 24, 2.6], [282, 25, 16, 1.6]], drift: [70, 6, 44] },
    { seed: 6, puffs: [[132, 56, 14, 2], [152, 55, 12, 1.6]], drift: [54, 4, 18] },
    { seed: 7, puffs: [[150, 72, 20, 1.2], [176, 73, 12, 1]], drift: [44, 3, 8] },
  ]
  const cloudLayers = []
  for (const c of CLOUDS) {
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
    const dir = C.lit === 'below' ? 1 : -1
    for (const k of cells) {
      const [x, y] = k.split(',').map(Number)
      let n = 0
      while (n < 5 && has(x, y + dir * (n + 1))) n++
      let v = C.base + C.rim * [1, 0.66, 0.42, 0.24, 0.1, 0][n]
      v += C.sun * glowAt(x, y) * 2.2
      v += (noise(x * 0.25, y * 0.6, c.seed + 9) - 0.5) * 0.05
      L.set(x, y, tone(C.tones, v, x, y, 0.1))
    }
    const [d, a, l] = c.drift
    L.anim = anim('cd d' + a, '--d:' + d + 's;--l:' + -l + 's')
    cloudLayers.push(L)
  }

  // ------------------------------------------------ the far ridges
  // Conifers on a ground line, one silhouette in the haze of its depth. Its top catches the
  // light near the sun; its foot sinks into the valley mist.
  function ridge(nm, base, d, o) {
    const r = rng(o.seed)
    const top = new Map()
    for (let x = -3; x < W + 3; x++) top.set(x, base(x))
    const trees = []
    for (let x = -6; x < W + 6; x += o.gap * (0.55 + 0.9 * r())) {
      const h = lerp(o.h[0], o.h[1], r())
      const tx = Math.round(x)
      trees.push([tx, base(tx) - h, h])
    }
    // Each tree: a spire whose sides step out by tiers.
    const owner = new Map()
    for (const [tx, tip, h] of trees) {
      const half = Math.ceil(h * o.slope) + 1
      for (let x = tx - half; x <= tx + half; x++) {
        const dx = Math.abs(x - tx)
        const tier = Math.floor(dx / 2)
        const y = tip + dx / o.slope + (dx > 0 ? (tier % 2) * 0.6 : 0)
        if (y < top.get(x)) {
          top.set(x, y)
          owner.set(x, tx)
        }
      }
    }
    // Colours in bands, no dither: zones of glow across (near the sun) and of mist down from
    // the ground line, so the runs stay long.
    const body = tones(CONIFER, d, 2)[0]
    const mist = mixA(rgb(M.mist.tones[1]), hazeAt(Math.min(1, d + 0.15)), 0.4)
    const lv = o.levels ?? 4
    const cols = []
    for (let g = 0; g < 3; g++) {
      const bodyG = mixA(rgb(body), rgb(M.sunHaze), (g / 2) * (o.glow ?? 0.3))
      cols.push(Array.from({ length: lv }, (_, i) => hex(mixA(bodyG, mist, (i / (lv - 1)) * o.mist))))
    }
    const L = new Layer(nm)
    const sx = M.sun ? M.sun.x : M.from[0]
    const sy = M.sun ? M.sun.y : 0
    for (let x = 0; x < W; x++) {
      const t = Math.round(top.get(x))
      const b = base(x)
      for (let y = t; y < (o.bottom ?? H); y++) {
        const e = y - t
        // (the glow round the sun is a see-through bloom laid over all the ridges)
        const gi = o.gi ?? 0
        const mi = clamp(Math.floor(smooth((y - b + 2) / o.mistH) * lv), 0, lv - 1)
        let c = cols[gi][mi]
        if (M.sun && M.ridgeRim !== false && e === 0) {
          // the light caught along the treetops near the sun
          const near = gauss(x + 0.5, sx, o.glowW * 1.3)
          if (near > 0.12) c = fogged(M.rim.tones[clamp(Math.floor(near * 3.2), 0, 3)], d, 0.35)
        } else if (o.lit && y < b && owner.has(x)) {
          // the side of each spire that faces the light
          const tx = owner.get(x)
          if (x !== tx && Math.sign(M.from[0] - tx) === Math.sign(x - tx)) c = cols[Math.min(2, gi + 1)][Math.max(0, mi - 1)]
        }
        L.set(x, y, c)
      }
    }
    return L
  }
  const ridge1 = ridge('r1', R1, 1, { seed: 31, gap: 4.6, h: [2, 4], slope: 0.6, mist: 0.75, mistH: 16, glowW: 52, glow: 0.55 })
  const ridge2 = ridge('r2', R2, 0.82, { seed: 32, gap: 4, h: [3, 6], slope: 0.55, mist: 0.7, mistH: 18, glowW: 46, glow: 0.42 })
  const ridge3 = ridge('r3', R3, 0.64, { seed: 33, gap: 4.6, h: [4, 8], slope: 0.5, mist: 0.65, mistH: 20, glowW: 40, glow: 0.3, lit: true })

  // ------------------------------------------------ the valley floor
  // A patchwork of fields between the two hills, its lines meeting at the valley's far end,
  // hazier the farther it lies; hedgerows along some of the field edges.
  const floor = new Layer('floor')
  const depthAt = y => Math.round(clamp(0.6 - (y - 124) / 110, 0.14, 0.6) * 20) / 20
  {
    // Far off, fields seen low across: strips that widen toward us, split into plots, with
    // hedgerows on some edges and a few round trees.
    const r = rng(41)
    let y = 118
    let k = 0
    while (y < 162) {
      const h = 1 + Math.floor(k * 0.55)
      const d = depthAt(y)
      const cuts = []
      for (let x = 100; x < W; x += 10 + k * 5 + r() * 18) cuts.push(Math.round(x))
      for (let x = 100; x < W; x++) {
        const plot = cuts.filter(c => c <= x).length
        const kind = hash(plot, k, 41)
        const alb = kind < 0.35 ? STUBBLE : kind < 0.65 ? MEADOW : kind < 0.85 ? GRASS : PLOUGH
        for (let j = 0; j < h; j++) {
          if (y + j < R3(x) + 3) continue
          let v = 0.3 + 0.2 * hash(plot, k, 42)
          if (alb === PLOUGH && j % 2 === 1) v -= 0.12
          let c = tone(tones(alb, d, 5), v, x, y + j, 0)
          if (j === 0 && hash(plot, k, 43) > 0.6) c = tones(CONIFER, d, 4)[1]
          floor.set(x, y + j, c)
        }
      }
      y += h
      k++
    }
    // The near bank across the stream: a meadow mown in broad stripes.
    for (let y = 150; y < H; y++) {
      const s = streamAt(y + 0.5)
      const x0 = s ? Math.ceil(s[0] + s[1] + 1) : 200
      const d = depthAt(y)
      const T = tones(MEADOW, d, 5)
      for (let x = x0; x < W; x++) {
        // lit by the key light where the haystacks' shadows do not fall
        const stripe = Math.floor((x - 0.6 * y) / 14) % 2
        floor.set(x, y, tone(T, 0.1 + (0.4 + 0.2 * stripe) * visS(x, y), x, y, 0))
      }
    }
  }

  // The stream: it mirrors the sky above the valley's end, brighter the farther it lies;
  // dark banks with reeds; glints on the water.
  const water = new Layer('water')
  const banks = new Layer('banks')
  const glints = [0, 1, 2].map(i => new Layer('glint' + i))
  const WT = M.water
  for (let y = 128; y < H; y++) {
    const s = streamAt(y + 0.5)
    if (!s) continue
    const [cx, hw] = s
    const u = (y - 128) / 72
    for (let x = Math.floor(cx - hw - 2); x <= cx + hw + 1; x++) {
      const dx = (x + 0.5 - cx) / Math.max(hw, 0.6)
      if (Math.abs(dx) <= 1) {
        let v = 0.95 - 0.7 * u + 0.12 * (1 - Math.abs(dx))
        // ripples: thin darker lines across the water, longer near us
        if (noise(x * 0.25 / (1 + 3 * u), y * 1.3, 61) > 0.68) v -= 0.12
        else if (noise(x * 0.3 / (1 + 3 * u), y * 1.3, 62) > 0.78) v += 0.1
        // where the bridge shades it, no shadow but a darker reflection
        if (y > 168) v -= 0.3 * (1 - visS(x, y))
        water.set(x, y, tone(WT, v, x, y, 0.15))
        if (hash(x, y, 63) > 0.93 - 0.05 * (1 - u) && Math.abs(dx) < 0.85) glints[Math.floor(hash(x, y, 64) * 3)].set(x, y, M.glint[hash(x, y, 65) > 0.6 ? 1 : 0])
      } else if (Math.abs(dx) <= 1 + 1.6 / Math.max(hw, 1)) {
        const d = clamp(0.6 - (y - 124) / 120, 0.18, 0.6)
        banks.set(x, y, tone(tones(CONIFER, Math.round(d * 20) / 20, 4), 0.2 + 0.3 * hash(x, y, 66), x, y, 0))
      }
    }
  }
  glints.forEach((L, i) => (L.anim = anim('gl', '--l:' + -i + 's', i ? " opacity='0'" : '')))

  // ------------------------------------------------ painters: trees

  // Foliage: blobs [x, y, r] merged into one mass (a metaball field), shaded as one body and
  // broken into leaf clusters, its outline ragged where the clusters bulge.
  function foliage(o, blobs, alb, seed, q = {}) {
    const d = o.d
    const T = tones(alb, d, nT(q.n ?? 6))
    const g = q.g ?? Math.max(2.2, Math.max(...blobs.map(b => b[2])) / 2.6)
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (const [bx, by, br] of blobs) {
      x0 = Math.min(x0, bx - br * 1.3)
      x1 = Math.max(x1, bx + br * 1.3)
      y0 = Math.min(y0, by - br * 1.3)
      y1 = Math.max(y1, by + br * 1.3)
    }
    let ymin = Infinity
    let ymax = -Infinity
    for (const [, by, br] of blobs) {
      ymin = Math.min(ymin, by - br)
      ymax = Math.max(ymax, by + br)
    }
    for (let y = Math.floor(y0); y <= y1; y++) {
      for (let x = Math.floor(x0); x <= x1; x++) {
        const px = x + 0.5
        const py = y + 0.5
        let F = 0
        let gx = 0
        let gy = 0
        for (const [bx, by, br] of blobs) {
          const dx = px - bx
          const dy = py - by
          const d2 = Math.max(0.25, dx * dx + dy * dy)
          const f = (br * br) / d2
          F += f
          gx += (f * dx) / d2
          gy += (f * dy) / d2
        }
        const c = clusters(x, y, g, seed)
        if (F * (1 + (q.rag ?? 0.35) * (0.5 - c.d1)) < 1) continue
        const gl = Math.hypot(gx, gy) || 1
        const nz = Math.sqrt(clamp((F - 1) / 1.6, 0, 1))
        const s = Math.sqrt(1 - nz * nz)
        const nx = (gx / gl) * s
        const ny = (gy / gl) * s
        const cl = q.cl ?? 0.72
        // what reaches it of the key light: its own crown shades its far side, other things cast
        const sh = q.sh ? q.sh(x, y, nz) : 1
        let v = (q.base ?? 0.1) + sh * ((1.04 - cl) * lit([nx, -ny, -nz]) + cl * lit([nx + c.ox * 1.5, -ny - c.oy * 1.5, -0.5]))
        if (c.crease < 0.13) v -= 0.18
        v -= (q.under ?? 0.16) * smooth((py - lerp(ymin, ymax, 0.45)) / ((ymax - ymin) * 0.55))
        o.set(x, y, tone(T, v, x, y, q.dither ?? 0.2), (q.rim ?? 0.85) * sh)
      }
    }
  }
  // The key light reaching a tree's cell: its foot on row yb, the cell nz of its radius r
  // toward us; id is the tree itself, which shades itself by its form instead.
  const shOf = (id, yb, r) => (x, y, nz = 0.5) => {
    const b = LIFT.get(id) ?? 0
    const [gx, gz] = toW(x + 0.5, yb + b)
    return vis(gx, gz - nz * r, b + Math.max(0, yb - y - 0.5), id)
  }
  // A tree: a crown of two or three blobs and a short trunk under it.
  function crown(o, cx, cy, r, alb, seed, q = {}) {
    const rr = rng(seed)
    const blobs = [[cx, cy, r]]
    if (r > 3.5) {
      blobs.push([cx - r * (0.35 + 0.2 * rr()), cy + r * 0.25, r * 0.7])
      blobs.push([cx + r * (0.35 + 0.2 * rr()), cy + r * (0.1 + 0.2 * rr()), r * 0.68])
    }
    const yb = Math.round(cy + r + (q.trunk ?? 0))
    const sh = q.id ? shOf(q.id, yb, r) : null
    if (q.trunk) {
      // a trunk: the side toward the light lit, the other in shade, a dark seam at its foot
      const B = tones(BARK, o.d, 4)
      const side = LW[0] > 0 ? 1 : -1
      for (let y = Math.round(cy + r * 0.4); y <= yb; y++) {
        const s = sh ? sh(cx, y, 0) : 1
        o.set(cx - side, y, tone(B, 0.1, cx, y, 0), 0)
        o.set(cx, y, tone(B, 0.15 + 0.6 * lit([side, 0, 0]) * s, cx, y, 0), 0.4 * s)
      }
      o.set(cx - 1, yb + 1, tone(B, 0, cx, yb, 0), 0)
      o.set(cx, yb + 1, tone(B, 0, cx, yb, 0), 0)
      o.set(cx + 1, yb + 1, tone(B, 0, cx, yb, 0), 0)
    }
    foliage(o, blobs, alb, seed, { n: 6, ...q, sh })
  }
  // A conifer: a spire of tiers, lit on the side that faces the light.
  function conifer(o, tx, yb, h, w, seed, id) {
    const T = tones(CONIFER, o.d, 5)
    const sh = id ? shOf(id, yb, w) : null
    const tip = yb - h
    for (let y = Math.floor(tip); y <= yb; y++) {
      const t = (y + 0.5 - tip) / h
      const tier = ((t * h) / 3.2 + hash(seed, 0, 3)) % 1
      const hw = w * t * (0.62 + 0.38 * tier) + 0.2
      for (let x = Math.round(tx - hw); x <= Math.round(tx + hw); x++) {
        const s = (x + 0.5 - tx) / (hw + 0.5)
        const k = sh ? sh(x, y, Math.sqrt(Math.max(0, 1 - s * s))) : 1
        let v = 0.12 + 0.75 * k * lit([s, 0.35, -Math.sqrt(Math.max(0, 1 - s * s))]) - (tier > 0.78 ? 0.14 : 0)
        o.set(x, y, tone(T, v, x, y, 0.3), 0.75 * k)
      }
    }
    o.set(tx, yb + 1, tone(tones(BARK, o.d, 4), 0.2, tx, yb, 0), 0)
  }

  // ------------------------------------------------ the slope across the valley
  const slope = new Obj(0.42)
  {
    // grass, the shadows of its trees laid down it, softer at this distance
    const T = tones(GRASS, 0.42, 5)
    for (let x = 200; x < W + 2; x++) {
      for (let y = Math.round(SLOPE(x)); y < ROAD_Y - 3; y++) {
        const s = visS(x, y)
        slope.set(x, y, tone(T, 0.3 + 0.2 * s, x, y, 0), 0.3 * s)
      }
    }
    for (const t of SLOPE_TREES) {
      if (t.con) conifer(slope, t.x, t.y + t.r, t.r * 2.6, t.r * 0.62, t.seed, t.id)
      else crown(slope, t.x, t.y, t.r, t.alb, t.seed, { n: 4, dither: 0.05, cl: 0.45, id: t.id })
    }
  }

  // The near bank of the slope, with the road along it.
  const bank = new Layer('bank')
  {
    const d = 0.26
    const R = tones(STUBBLE, d, 5)
    for (let x = 246; x < W; x++) {
      bank.set(x, ROAD_Y - 1, tone(R, 0.55, x, 0, 0))
      bank.set(x, ROAD_Y, tone(R, 0.38 + (hash(x, 1, 8) > 0.8 ? 0.12 : 0), x, 0, 0))
      bank.set(x, ROAD_Y + 1, tone(R, 0.22, x, 0, 0))
    }
    // A rail fence along the far side of the road.
    const P = tones(WOOD, d, 4)
    for (let x = 256; x < W; x++) bank.set(x, ROAD_Y - 3, tone(P, x % 6 === 0 ? 0.75 : 0.35, x, 0, 0))
    for (let x = 256; x < W; x += 6) bank.set(x, ROAD_Y - 2, tone(P, 0.5, x, 0, 0))
  }

  // ------------------------------------------------ the bridge
  // A stone arch over the stream: the deck, the ring of voussoirs, coursed spandrels; through
  // the arch the stream goes on, and under it the water mirrors the arch.
  const bridge = new Obj(0.26)
  const bridgeFront = new Obj(0.26)
  {
    const d = bridge.d
    const S = tones(STONE, d, 6)
    const front = lit([0, 0, -1])
    const hump = x => Math.round(-2.2 * gauss(x, ARCH.cx, 24))
    for (let x = BR.x0; x <= BR.x1; x++) {
      const t0 = BR.top + hump(x)
      const end = x < BR.x0 + 4 || x > BR.x1 - 4
      for (let y = t0; y < BR.water; y++) {
        const ex = (x + 0.5 - ARCH.cx) / ARCH.rx
        const ey = (y + 0.5 - ARCH.cy) / ARCH.ry
        const q = ex * ex + ey * ey
        if (q < 1) continue
        let v = 0.15 + 0.7 * front
        // the parapet: two rows with a coping on top
        const e = y - t0
        if (e === 0) v = 0.55
        else if (e === 1) v = 0.4
        else if (e === 2) v = 0.08
        else if (q < 1.45) {
          // the voussoirs, joints running toward the arch's centre
          const a = Math.atan2(ey, ex)
          v = 0.42 + (Math.floor(a * 8) % 2 ? 0.06 : -0.02)
          if (Math.abs(((a * 8) % 1) - 0.5) > 0.42) v -= 0.18
        } else {
          const course = Math.floor((y - t0 - 3) / 2)
          const off = course % 2 ? 2 : 0
          v = 0.3 + 0.12 * hash(Math.floor((x + off) / 4), course, 3)
          if ((y - t0 - 3) % 2 === 1 || (x + off) % 4 === 0) v -= 0.12
        }
        if (end && e > 2) v -= 0.06
        const target = e <= 1 ? bridgeFront : bridge
        target.set(x, y, tone(S, v, x, y, 0.15), e === 0 ? 1 : 0.3)
      }
    }
    // The underside of the arch, in shade, seen through the opening's top.
    for (let x = ARCH.cx - ARCH.rx; x <= ARCH.cx + ARCH.rx; x++) {
      for (let y = ARCH.cy - ARCH.ry; y < BR.water; y++) {
        const ex = (x + 0.5 - ARCH.cx) / ARCH.rx
        const ey = (y + 0.5 - ARCH.cy) / ARCH.ry
        const q = ex * ex + ey * ey
        const ex2 = (x + 0.5 - ARCH.cx - 3) / (ARCH.rx - 0.5)
        const ey2 = (y + 0.5 - ARCH.cy + 1.6) / (ARCH.ry - 0.5)
        if (q < 1 && ex2 * ex2 + ey2 * ey2 >= 1) bridge.set(x, y, tone(S, 0.02, x, y, 0), 0)
      }
    }
  }
  // The arch mirrored in the water under it: a darker copy, broken by ripples.
  const mirror = new Layer('mirror')
  for (const [k, [c]] of bridge.m) {
    const [x, y] = cellXY(k)
    if (y < BR.top + 3) continue
    const my = 2 * BR.water - 1 - y
    const s = streamAt(my + 0.5)
    if (!s || Math.abs(x + 0.5 - s[0]) > s[1] - 0.5) continue
    if (my % 3 === 2 && hash(x, my, 3) > 0.4) continue
    const w = water.m.get(key(x, my))
    mirror.set(x + (my % 4 === 0 ? 1 : 0), my, w ? mixH(c, w, 0.45) : c)
  }

  // ------------------------------------------------ the village hill
  // Its ground, down to the stream's near bank, in terraces that give the hill its form. Each
  // row of houses stands on a terrace top: one calm plane of dry grass, lit or in the shadows
  // that fall on it, open for a few rows in front of the houses, with a path of packed earth
  // along its front edge. At that edge a retaining wall drops to the next terrace (see TH): its
  // face, turned from every light here, is in shade, and a dark seam runs where it meets the
  // ground below. A cell is either lit or in shadow; where a shadow's edge softens, away from
  // what casts it, the two are dithered.
  const hill = new Obj(0.36)
  const UP = [0, 1, 0]
  const FACE = [0, 0, -1]
  const PATH = [0.7, 0.58, 0.42]
  // lit or in shadow: full light, none, or (in a soft edge) a dither of the two
  const sunlit = (s, x, y) => s > 0.99 || (s > 0.01 && s > 0.5 + bayer(x, y) * 0.9)
  {
    const lUp = lit(UP)
    for (let x = -2; x < 240; x++) {
      const t = Math.round(HILL(x))
      const E = EDGE.map(f => Math.round(f(x)))
      for (let y = t; y < H; y++) {
        if (y > 140 && x >= bankL(y)) continue
        const d = clamp(0.36 - (y - 100) / 250, 0.08, 0.36)
        const dq = Math.round(d * 20) / 20
        // the terrace whose front edge this row lies past (-1: above the first)
        let k = -1
        for (let i = 0; i < E.length; i++) if (y > E[i]) k = i
        const e = k < 0 ? 0 : y - E[k]
        const [pw, wh] = k < 0 ? [0, 0] : TER[k]
        const g = groundAt(x, y)
        const on = sunlit(visG(x, y, g.h), x, y)
        let c
        let rim = 0
        if (k >= 0 && e <= pw + 1) {
          // the path along the front of the terrace, out to the wall's edge
          const T = tones(PATH, dq, nT(5))
          c = on ? tone(T, 0.15 + 1.5 * lUp, x, y, 0) : T[0]
        } else if (k >= 0 && e <= pw + 1 + wh) {
          // the wall's face, in shade, with a few dark joints
          const T = tones(STONE, dq, nT(5))
          const row = e - pw - 2
          c = (x + (row % 2) * 4) % 9 === 0 ? T[0] : tone(T, 0.24 + 0.8 * lit(FACE) * visG(x, y, g.h), x, y, 0)
        } else if (k >= 0 && e === pw + 2 + wh) {
          // where the wall meets the terrace below
          c = tones(PLOUGH, dq, 4)[0]
        } else {
          // a terrace top
          const T = tones(GRASS, dq, nT(5))
          c = on ? tone(T, 0.15 + 1.7 * lUp, x, y, 0) : T[0]
          if (y - t < 2) rim = 0.8
        }
        hill.set(x, y, c, rim)
      }
    }
  }
  // The crest's woods.
  const woods = new Obj(0.4)
  for (const t of WOODS) {
    if (t.con) conifer(woods, t.x, t.y + 2, t.r * 3, t.r * 0.6, t.seed, t.id)
    else crown(woods, t.x, t.y, t.r, t.alb, t.seed, { n: 4, dither: 0.05, cl: 0.45, id: t.id })
  }

  // The lane: from the church down through the village to the bridge, a clean ribbon of
  // cobbles, lit or in shadow like the ground round it.
  const LANE = [[86, 124], [104, 129], [116, 136], [98, 145], [92, 150], [124, 155], [160, 158], [188, ROAD_Y + 1]]
  const lane = new Obj(0.24)
  {
    for (let i = 0; i < LANE.length - 1; i++) {
      for (const [x, y] of line(...LANE[i], ...LANE[i + 1])) {
        const d = clamp(0.36 - (y - 100) / 160, 0.14, 0.36)
        const T = tones(STONE, Math.round(d * 20) / 20, 5)
        const w = y > 150 ? 2 : 1
        for (let k = -w; k <= w; k++) lane.set(x + k, y, sunlit(visG(x + k, y, groundAt(x + k, y).h), x + k, y) ? tone(T, 0.15 + 1.2 * lit(UP), x + k, y, 0) : T[0], 0)
      }
    }
  }

  // ------------------------------------------------ painters: houses

  // A house in an oblique view: its front faces us; its right side and its roof run back up to
  // the right, a cell up for every two across. h: { x, y (the foot of the front wall's left
  // corner), w, ht (wall height), d (depth), rh (roof height), kind ('gable': gable end to us,
  // 'eave': long side to us), roof, wall, dep, seed }.
  // A face: cells whose centres fall in the polygon, with their place on it as (a, b) along
  // the face's own axes A and B from O, handed to fn, which paints them.
  function face(poly, O, Av, Bv, fn) {
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (const [x, y] of poly) {
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
    const det = Av[0] * Bv[1] - Av[1] * Bv[0]
    for (let y = Math.floor(y0); y <= y1; y++) {
      for (let x = Math.floor(x0); x <= x1; x++) {
        if (!inPoly(x + 0.5, y + 0.5, poly)) continue
        const px = x + 0.5 - O[0]
        const py = y + 0.5 - O[1]
        fn((px * Bv[1] - py * Bv[0]) / det, (Av[0] * py - Av[1] * px) / det, x, y)
      }
    }
  }
  // The windows on a wall of width ww and height hh: [a0, b0, w, h], with a door if asked.
  function windows(ww, hh, r, door) {
    const out = []
    const fl = Math.round(hh * 0.5)
    const n = Math.max(1, Math.floor((ww - 2) / 5))
    const step = (ww - 1) / n
    const wh = hh >= 10 ? 3 : 2
    const wwd = hh >= 10 ? 2 : 1
    for (let i = 0; i < n; i++) {
      const a0 = Math.round(1 + step * (i + 0.5) - wwd / 2)
      out.push([a0, fl + Math.max(1, Math.round((hh - fl - wh) / 2)), wwd, wh, r() < M.litShare])
      if (!(door && i === Math.floor(n / 2))) out.push([a0, Math.max(1, Math.round((fl - wh) / 2)), wwd, wh, r() < M.litShare * 0.8])
    }
    return out
  }
  function glass(win, a, b, x, y) {
    const [a0, b0, w, h, on] = win
    if (on && curHouse) {
      const e = curHouse.wins.get(win) ?? [0, 0, 0, b0]
      curHouse.wins.set(win, [e[0] + x, e[1] + y, e[2] + 1, b0])
    }
    if (on) return a - a0 < 0.5 && b - b0 > h - 1 ? M.lit[1] : M.lit[0]
    return Math.floor(a - a0) === 0 && Math.floor(b - b0) === h - 1 ? M.glass[1] : M.glass[0]
  }
  // What a wall shows at (a, b), a across from its left edge and b up from the ground.
  function wallAt(spec, a, b, l, x, y, dep) {
    const { ww, hh, wins } = spec
    const ai = Math.floor(a)
    const bi = Math.floor(b)
    // the eaves shade the top of the wall: a band of one row, two on big houses
    if (b >= hh - (hh >= 10 ? 2 : 1)) l = 0
    for (const win of wins) {
      if (a >= win[0] && a < win[0] + win[2] && b >= win[1] && b < win[1] + win[3]) return [glass(win, a, b, x, y), 0]
    }
    const timber = tones(TIMBER, dep, 4)
    const fl = Math.round(hh * 0.5)
    if (spec.door) {
      const [da, dw, dh] = spec.door
      if (a >= da && a < da + dw && b < dh) return [tone(timber, ai === da || bi === dh - 1 ? 0.15 : 0.45, x, y, 0), 0]
      if (a >= da - 1 && a < da + dw + 1 && b < dh + 1) return [tone(timber, 0.7 * l + 0.2, x, y, 0), 0.2]
    }
    // the sill under each window, a shutter or a box of flowers on some
    for (const win of wins) {
      if (bi === win[1] - 1 && a >= win[0] - 1 && a < win[0] + win[2] + 1) {
        if (spec.flowers && win[1] < fl) return [hash(ai, bi, 9) > 0.5 ? fogged('#d8344a', dep) : fogged('#f06a7a', dep), 0.3]
        return [tone(timber, 0.3 + 0.5 * l, x, y, 0), 0.2]
      }
      if (spec.shutters && bi >= win[1] && bi < win[1] + win[3] && (ai === win[0] - 1 || ai === win[0] + win[2])) return [tone(tones(spec.shutters, dep, 4), 0.2 + 0.6 * l, x, y, 0), 0.2]
    }
    const stone = tones(STONE, dep, 5)
    if (spec.kind === 'stone' || (spec.stoneBase && b < fl)) {
      const course = Math.floor(b / 2)
      const off = course % 2 ? 2 : 0
      let v = 0.15 + 0.6 * l + 0.12 * (hash(Math.floor((a + off) / 4), course, 3) - 0.5)
      if (bi % 2 === 1 || Math.floor(a + off) % 4 === 0) v -= 0.12
      if (bi >= hh - 1) v -= 0.15
      return [tone(stone, v, x, y, 0.2), 0.15 + 0.7 * l]
    }
    if (spec.kind === 'timber') {
      const t = ai === 0 || ai === Math.floor(ww) - 1 || bi === fl || bi === hh - 1 || bi === 0 || spec.posts.includes(ai)
      let brace = false
      if (!t && b > fl && spec.braces) {
        for (const [p0, p1] of spec.braces) {
          if (a < p0 || a >= p1) continue
          const k = (b - fl) / (hh - 1 - fl)
          if (Math.abs(a - p0 - k * (p1 - p0)) < 0.55) brace = true
        }
      }
      if (t || brace) return [tone(timber, 0.15 + 0.6 * l, x, y, 0), 0.1 + 0.7 * l]
    }
    let v = 0.1 + 0.85 * l + 0.08 * (noise(x * 0.4, y * 0.4, 33) - 0.5)
    if (bi >= hh - 1) v -= 0.08
    return [tone(tones(spec.plaster, dep, nT(6)), v, x, y, 0.14), 0.15 + 0.7 * l]
  }
  function wallSpec(ww, hh, r, h, door) {
    const wins = windows(ww, hh, r, door)
    const posts = []
    for (const w of wins) posts.push(w[0] - 1, w[0] + w[2])
    const braces = []
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i]
      if (w[1] < Math.round(hh * 0.5)) continue
      const next = wins.find(v => v[0] > w[0] && v[1] === w[1])
      const p0 = w[0] + w[2]
      const p1 = next ? next[0] - 1 : ww - 1
      if (p1 - p0 >= 3) braces.push(r() < 0.5 ? [p0, p1] : [p1, p0])
    }
    let dr = null
    if (door) {
      const mid = Math.floor(Math.max(1, Math.floor((ww - 2) / 5)) / 2)
      const n = Math.max(1, Math.floor((ww - 2) / 5))
      const step = (ww - 1) / n
      dr = [Math.round(1 + step * (mid + 0.5) - 1), 2, Math.min(4, Math.round(hh * 0.45))]
    }
    return { ww, hh, wins, posts, braces: braces.map(([a, b]) => (a < b ? [a, b] : [b, a])), kind: h.wall, stoneBase: h.stoneBase, plaster: h.plaster ?? PLASTER, door: dr, flowers: h.flowers, shutters: h.shutters }
  }

  function house(o, h) {
    const r = rng(h.seed)
    const dep = h.dep
    const P = (u, v, z) => [h.x + u + z * KX, h.y - v - z * KY]
    curHouse = { wins: new Map() }
    // the key light reaching the point (u across, v up, z back) of this house
    const lift = h.lift ?? 0
    const [gx0, gz0] = toW(h.x, h.y + lift)
    const V = (u, v, z) => vis(gx0 + u, gz0 + z, v + lift, h.id)
    const sub = (p, q) => [p[0] - q[0], p[1] - q[1]]
    const ov = h.ov ?? 1
    const roofT = tones(h.roof, dep, nT(6))
    const timber = tones(TIMBER, dep, 4)
    const { w, ht, d, rh } = h
    const tile = (lv, b, x, y, ridge, sh = 1) => {
      lv *= sh
      let v = 0.1 + 0.85 * lv
      const k = ((b % 2.5) + 2.5) % 2.5
      if (k > 1.6) v -= 0.24
      else if (k < 0.7) v += 0.06
      if (hash(Math.floor(x / 2), Math.floor(b / 2), h.seed) > 0.85) v -= 0.08
      return [tone(roofT, v, x, y, 0.12), (ridge ? 1 : 0.85) * sh]
    }
    const zAxis = [KX, -KY]
    const up = [0, -1]
    const chim = []
    if (h.kind === 'gable') {
      const eL = P(-ov, ht - 0.6, -0.4)
      const eR = P(w + ov, ht - 0.6, -0.4)
      const apex = P(w / 2, ht + rh, -0.4)
      const back = [KX * (d + 0.4), -KY * (d + 0.4)]
      const add = p => [p[0] + back[0], p[1] + back[1]]
      const slopeL = Math.hypot(...sub(apex, eL))
      const nL = [-rh, w / 2 + ov, 0]
      const nR = [rh, w / 2 + ov, 0]
      // the left roof plane, then the right one, then the right wall, then the front with its gable
      const lvL = lit(nL)
      const lvR = lit(nR)
      const Al = sub(apex, eL).map(v => v / slopeL)
      const onSlope = (f, uE) => [lerp(uE, w / 2, f), lerp(ht - 0.6, ht + rh, f)]
      face([eL, apex, add(apex), add(eL)], eL, Al, zAxis, (a, b, x, y) => {
        const [u, v] = onSlope(a / slopeL, -ov)
        o.set(x, y, ...tile(lvL, a, x, y, a > slopeL - 1, V(u, v + 0.3, b - 0.4)))
      })
      const Ar = sub(apex, eR).map(v => v / slopeL)
      face([eR, apex, add(apex), add(eR)], eR, Ar, zAxis, (a, b, x, y) => {
        const [u, v] = onSlope(a / slopeL, w + ov)
        o.set(x, y, ...tile(lvR, a, x, y, a > slopeL - 1, V(u, v + 0.3, b - 0.4)))
      })
      const side = wallSpec(d, ht, r, { ...h, flowers: false }, false)
      side.wins = side.wins.filter(v => v[1] < ht * 0.5 || r() < 0.7)
      face([P(w, 0, 0), P(w, 0, d), P(w, ht, d), P(w, ht, 0)], P(w, 0, 0), zAxis, up, (a, b, x, y) => {
        if (b > ht - 0.2) return
        o.set(x, y, ...wallAt(side, a, b, lightSide * V(w + 0.3, b, a), x, y, dep))
      })
      const fr = wallSpec(w, ht + rh, r, h, h.door)
      fr.hh = ht
      fr.wins = windows(w, ht, r, h.door)
      if (rh > 6) fr.wins.push([Math.round(w / 2 - 1), ht + Math.round(rh * 0.3), 2, 2, r() < M.litShare])
      fr.posts = fr.wins.flatMap(v => [v[0] - 1, v[0] + v[2]])
      face([P(0, 0, 0), P(w, 0, 0), P(w, ht, 0), P(w / 2, ht + rh - 0.6, 0), P(0, ht, 0)], P(0, 0, 0), [1, 0], up, (a, b, x, y) => {
        // above the walls the gable is framed by a king post and a collar beam
        if (b >= ht) {
          const ai = Math.floor(a)
          const isGlass = fr.wins.some(v => v[1] >= ht && a >= v[0] && a < v[0] + v[2] && b >= v[1] && b < v[1] + v[3])
          if (isGlass) return o.set(x, y, glass(fr.wins[fr.wins.length - 1], a, b, x, y), 0)
          const timberHere = h.wall === 'timber' && (Math.floor(b) === ht || (ai === Math.floor(w / 2) - 2 || ai === Math.floor(w / 2) + 1) && b < ht + rh * 0.3)
          const lf = lightFront * V(a, b, -0.3)
          if (timberHere) return o.set(x, y, tone(timber, 0.15 + 0.6 * lf, x, y, 0), 0.4)
          const v = 0.1 + 0.85 * lf - 0.1 * smooth((b - ht) / rh)
          return o.set(x, y, tone(tones(h.plaster ?? PLASTER, dep, nT(6)), v, x, y, 0.25), 0.5)
        }
        o.set(x, y, ...wallAt(fr, a, b, lightFront * V(a, b, -0.3), x, y, dep))
      })
      // the barge boards along the gable's edge
      for (const [x, y] of [...line(...eL, ...apex), ...line(...apex, ...eR)]) o.set(x, y, tone(timber, 0.35, x, y, 0), 1)
      if (h.chim !== false) chim.push(P(w * 0.5 + (h.chimSide ?? 0.32) * w, ht + rh * 0.38, d * 0.62))
    } else {
      const zr = d / 2
      // the right gable wall, the front wall, then the roof over both
      const gab = wallSpec(d, ht, r, { ...h, flowers: false }, false)
      gab.wins = gab.wins.filter(v => v[1] < ht * 0.5)
      if (rh > 6) gab.wins.push([Math.round(d / 2 - 1), ht + Math.round(rh * 0.25), 1, 2, r() < M.litShare])
      face([P(w, 0, 0), P(w, 0, d), P(w, ht, d), P(w, ht + rh, zr), P(w, ht, 0)], P(w, 0, 0), zAxis, up, (a, b, x, y) => {
        const isGlass = gab.wins.find(v => a >= v[0] && a < v[0] + v[2] && b >= v[1] && b < v[1] + v[3])
        const ls = lightSide * V(w + 0.3, b, a)
        if (b >= ht) {
          if (isGlass) return o.set(x, y, glass(isGlass, a, b, x, y), 0)
          const v = 0.1 + 0.85 * ls - 0.12 * smooth((b - ht) / rh)
          const tb = h.wall === 'timber' && (Math.floor(b) === ht || Math.abs(a - zr) < 0.55)
          if (tb) return o.set(x, y, tone(timber, 0.15 + 0.6 * ls, x, y, 0), 0.4)
          return o.set(x, y, tone(tones(h.plaster ?? PLASTER, dep, nT(6)), v, x, y, 0.25), 0.5)
        }
        o.set(x, y, ...wallAt(gab, a, b, ls, x, y, dep))
      })
      const fr = wallSpec(w, ht, r, h, h.door)
      face([P(0, 0, 0), P(w, 0, 0), P(w, ht, 0), P(0, ht, 0)], P(0, 0, 0), [1, 0], up, (a, b, x, y) => o.set(x, y, ...wallAt(fr, a, b, lightFront * V(a, b, -0.3), x, y, dep)))
      const e0 = P(-ov, ht - 0.6, -0.6)
      const e1 = P(w + ov, ht - 0.6, -0.6)
      const r0 = P(-ov, ht + rh, zr)
      const r1 = P(w + ov, ht + rh, zr)
      const Bs = sub(r0, e0)
      const sl = Math.hypot(...Bs)
      const nr = [0, zr + 0.6, -rh]
      const lv = lit(nr)
      face([e0, e1, r1, r0], e0, [1, 0], Bs.map(v => v / sl), (a, b, x, y) => {
        const f = b / sl
        o.set(x, y, ...tile(lv, sl - b, x, y, b > sl - 1, V(a - ov, lerp(ht - 0.6, ht + rh, f) + 0.3, lerp(-0.6, zr, f))))
      })
      for (const [x, y] of line(...e1, ...r1)) o.set(x, y, tone(timber, 0.35, x, y, 0), 1)
      if (h.chim !== false) chim.push(P(w * (h.chimAt ?? 0.72), ht + rh * 0.62, zr * 0.62))
    }
    // the chimney: a short stack with a cap, lit on its right
    for (const [cx0, cy0] of chim) {
      const cx = Math.round(cx0)
      const cy = Math.round(cy0)
      const ch = Math.max(3, Math.round(rh * 0.32))
      const cw = dep < 0.3 ? 3 : 2
      const S = tones(STONE, dep, 5)
      for (let y = cy - ch; y <= cy; y++) {
        for (let k = 0; k < cw; k++) o.set(cx + k, y, tone(S, k === cw - 1 ? 0.2 + 0.7 * lightSide : 0.15 + 0.6 * lightFront, cx + k, y, 0), 0.8)
      }
      for (let k = -1; k <= cw; k++) o.set(cx + k, cy - ch - 1, tone(S, 0.5, cx + k, cy, 0), 1)
      fx.smoke.push([cx + cw / 2, cy - ch - 2, dep])
    }
    contact(o, h, dep)
    // its lit windows light the wall round them and the ground under them
    for (const [sx, sy, n, b0] of curHouse.wins.values()) {
      const wx = sx / n + 0.5
      const wy = sy / n + 0.5
      const foot = wx <= h.x + h.w ? h.y : h.y - ((wx - h.x - h.w) / KX) * KY
      addLight(wx, wy + 0.5, LOCAL.window[1] * (dep < 0.2 ? 1.2 : 1), 0.9, [o])
      if (b0 < h.ht * 0.5) addLight(wx, foot + 1.5, LOCAL.window[1] + 1, 0.8, ['ground', o], 0.45)
    }
    curHouse = null
  }
  // Where a house meets the ground, a dark seam along the foot of its front and side walls;
  // two rows, the second broken, on the near houses.
  function contact(o, h, dep) {
    const seam = tones(PLOUGH, dep, 4)[0]
    const rows = dep < 0.2 ? 2 : 1
    for (let x = Math.floor(h.x); x < h.x + h.w; x++) {
      for (let k = 0; k < rows; k++) if (!o.has(x, h.y + k) && (k === 0 || (x + h.y) % 2 === 0)) o.set(x, h.y + k, seam, 0)
    }
    for (let x = Math.floor(h.x + h.w); x <= h.x + h.w + h.d * KX; x++) {
      const ye = h.y - ((x + 0.5 - h.x - h.w) / KX) * KY
      const y = Math.floor(ye + 0.5)
      if (!o.has(x, y)) o.set(x, y, seam, 0)
    }
  }

  // The church: a long nave and a stone tower with an onion dome, a lantern and a spike.
  function church(o, t) {
    const dep = t.dep
    const P = (u, v, z) => [t.x + u + z * KX, t.y - v - z * KY]
    const S = tones(STONE, dep, 6)
    const { w, ht, d } = t
    const zAxis = [KX, -KY]
    const up = [0, -1]
    const stoneAt = (a, b, l, x, y) => {
      const course = Math.floor(b / 2)
      const off = course % 2 ? 2 : 0
      let v = 0.15 + 0.6 * l + 0.1 * (hash(Math.floor((a + off) / 4), course, 5) - 0.5)
      if (Math.floor(b) % 2 === 1) v -= 0.08
      // quoins: bigger, paler blocks on the corners
      return v
    }
    const [tgx, tgz] = toW(t.x, t.y + (t.lift ?? 0))
    const V = (u, v, z) => vis(tgx + u, tgz + z, v + (t.lift ?? 0), 'tower')
    const opening = (a, b, a0, b0, ww, hh) => a >= a0 && a < a0 + ww && b >= b0 && b < b0 + hh - (Math.floor(a) === a0 || Math.floor(a) === a0 + ww - 1 ? 1 : 0)
    // right wall
    face([P(w, 0, 0), P(w, 0, d), P(w, ht, d), P(w, ht, 0)], P(w, 0, 0), zAxis, up, (a, b, x, y) => {
      let v = stoneAt(a, b, lightSide * V(w + 0.3, b, a), x, y)
      if (opening(a, b, Math.round(d / 2) - 1, ht - 8, 3, 6)) v = Math.floor(b) % 2 ? 0 : 0.12
      if (a < 1 || a > d - 1) v += Math.floor(b / 2) % 2 ? 0.1 : 0.02
      o.set(x, y, tone(S, v, x, y, 0.2), 0.6)
    })
    // front wall: a door, a clock, the bell openings
    face([P(0, 0, 0), P(w, 0, 0), P(w, ht, 0), P(0, ht, 0)], P(0, 0, 0), [1, 0], up, (a, b, x, y) => {
      let v = stoneAt(a, b, lightFront * V(a, b, -0.3), x, y)
      const ai = Math.floor(a)
      if (ai <= 0 || ai >= w - 1) v += Math.floor(b / 2) % 2 ? 0.12 : 0.03
      const mid = w / 2
      if (opening(a, b, Math.round(mid - 2), 0, 4, 7)) v = ai === Math.round(mid - 2) || ai === Math.round(mid + 1) ? 0.3 : 0.05
      if (opening(a, b, Math.round(mid - 3), ht - 8, 2, 6) || opening(a, b, Math.round(mid + 1), ht - 8, 2, 6)) v = Math.floor(b) % 2 ? 0 : 0.12
      const cd = Math.hypot(a - mid, b - (ht - 13))
      if (cd < 2.2) {
        const lit2 = M.litShare > 0.5
        o.set(x, y, cd < 0.9 ? tone(S, 0, x, y, 0) : lit2 ? M.lit[0] : fogged('#f4ecd8', dep), 0)
        return
      }
      if (cd < 2.9) v = 0.6
      o.set(x, y, tone(S, v, x, y, 0.2), 0.6)
    })
    // the cornice
    for (const [x, y] of line(...P(-1, ht, 0), ...P(w + 1, ht, 0))) o.set(x, y, tone(S, 0.6, x, y, 0), 1)
    for (const [x, y] of line(...P(w + 1, ht, 0), ...P(w + 1, ht, d))) o.set(x, y, tone(S, 0.75, x, y, 0), 1)
    // the onion: a bulb of copper with ribs, lit by the moment's light
    const [cx, cb] = P(w / 2, ht + 1, d / 2)
    const R = w / 2 + 1.6
    const Hd = R * 2.1
    const prof = [[0, 0.72], [0.12, 0.98], [0.3, 1.06], [0.48, 0.9], [0.64, 0.56], [0.78, 0.28], [0.9, 0.12], [1, 0.04]]
    const rOf = t2 => {
      for (let i = 0; i < prof.length - 1; i++) if (t2 <= prof[i + 1][0]) return lerp(prof[i][1], prof[i + 1][1], (t2 - prof[i][0]) / (prof[i + 1][0] - prof[i][0]))
      return 0
    }
    const Cu = tones(COPPER, dep, 6)
    const bulb = (bx, by, RR, HH, tcut) => {
      for (let y = Math.floor(by - HH * tcut); y <= by; y++) {
        const t2 = (by - (y + 0.5)) / HH
        if (t2 < 0 || t2 > tcut) continue
        const hw = RR * rOf(t2)
        for (let x = Math.floor(bx - hw - 0.5); x <= bx + hw; x++) {
          const u = (x + 0.5 - bx) / Math.max(hw, 0.5)
          if (Math.abs(u) > 1) continue
          const dr = (rOf(t2 + 0.04) - rOf(t2 - 0.04)) / 0.08
          let v = 0.12 + 0.85 * lit([u, clamp(-dr * 0.5, -0.8, 1.5), -Math.sqrt(1 - u * u)])
          if (RR > 3 && [0.42, 0.88].some(ur => Math.abs(Math.abs(u) - ur) * hw < 0.5)) v -= 0.18
          o.set(x, y, tone(Cu, v, x, y, 0.25), 0.9)
        }
      }
    }
    bulb(cx, cb, R, Hd, 0.8)
    // the lantern on top: a little drum with openings, a small onion, a spike and a gilt ball
    const ly = Math.round(cb - Hd * 0.8)
    for (let y = ly - 4; y < ly; y++) {
      for (let x = Math.round(cx) - 2; x <= Math.round(cx) + 1; x++) {
        const side = x === Math.round(cx) - 2 || x === Math.round(cx) + 1
        o.set(x, y, side || y === ly - 4 ? tone(S, x === Math.round(cx) + 1 ? 0.2 + 0.7 * lightSide : 0.3, x, y, 0) : M.litShare > 0.5 ? M.lit[1] : tone(S, 0.02, x, y, 0), 0.8)
      }
    }
    bulb(cx, ly - 4, 2.6, 5, 0.9)
    const gold = tones(GOLD, dep, 4)
    for (let y = ly - 13; y <= ly - 9; y++) o.set(Math.round(cx) - 1 + (y < ly - 11 ? 0 : 0), y, tone(gold, 0.3, cx, y, 0), 1)
    o.set(Math.round(cx) - 1, ly - 14, tone(gold, 1, cx, 0, 0), 1)
  }

  // ------------------------------------------------ the village
  // Back to front, a tier at a time: the farthest houses near the crest, smaller and hazier.
  const village = new Obj(0.3)
  const vlayers = []
  const tierObj = d => {
    const o = new Obj(d)
    vlayers.push(o)
    return o
  }
  // A kitchen garden: a bed of dark soil with clumps of greens and a few pumpkins, behind a
  // picket fence.
  function garden(o, x0, y0, w, h) {
    // only on open ground: as many rows as the terrace top leaves it (none if under two)
    const fits = n => {
      for (let y = y0; y <= y0 + n; y++) {
        for (let x = x0 + Math.round((y - y0) * 0.5) - 1; x <= x0 + w + Math.round((y - y0) * 0.5); x++) if (groundAt(x, y).kind !== 'top') return false
      }
      return true
    }
    while (h >= 2 && !fits(h)) h--
    if (h < 2) return
    const d = o.d
    const soil = tones(PLOUGH, d, 4)
    const veg = tones(MEADOW, d, 5)
    const P = tones(WOOD, d, 4)
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0 + Math.round((y - y0) * 0.5); x < x0 + w + Math.round((y - y0) * 0.5); x++) {
        const on = sunlit(visG(x, y, groundAt(x, y).h + 0.5), x, y)
        // clumps two cells wide, a cell of soil between them, every other row
        const plant = (y - y0) % 2 === 0 && (x + y) % 3 !== 0
        let c = plant ? (on ? tone(veg, 0.2 + 0.9 * lit([0, 1, -0.3]), x, y, 0) : veg[0]) : soil[0]
        if (!plant && (y - y0) % 2 && hash(x, y, 8) > 0.8) c = on ? tone(tones(ORANGE, d, 4), 0.2 + 0.8 * lit([0.4, 1, -0.4]), x, y, 0) : tones(ORANGE, d, 4)[0]
        o.set(x, y, c, 0.2)
      }
    }
    const fy = y0 + h
    for (let x = x0 + Math.round(h * 0.5) - 1; x <= x0 + w + Math.round(h * 0.5); x++) {
      o.set(x, fy, tone(P, (x - x0) % 2 ? 0.25 : 0.7, x, fy, 0), 0.5)
      if ((x - x0) % 2 === 0) o.set(x, fy - 1, tone(P, 0.55, x, fy, 0), 0.6)
    }
  }
  let seed = 400
  const tier = (list, d, trees, gardens) => {
    const o = tierObj(d)
    for (const g of gardens ?? []) garden(o, ...g)
    for (const t of trees ?? []) {
      if (t.con) conifer(o, t.x, t.y, t.h, t.w, seed++, t.id)
      else crown(o, t.x, t.y, t.r, t.alb, seed++, { trunk: t.trunk ?? 2, dither: 0.04, n: 5, cl: 0.6, base: -0.04, id: t.id })
    }
    for (const h of list) house(o, { ...h, dep: d, seed: seed++ })
    return o
  }
  // the church first, at the crest behind the first tier
  const churchObj = tierObj(0.44)
  house(churchObj, { ...NAVE, dep: 0.44, seed: 7, chim: false, id: 'nave' })
  church(churchObj, { ...TOWER, dep: 0.44 })
  for (const t of TIERS) tier(t.houses, t.d, t.trees, t.gardens)

  // The near bank below the bridge: a willow turning gold, reeds along the water, haystacks
  // on the meadow.
  const near = new Obj(0.16)
  {
    const d = near.d
    const r = rng(61)
    // haystacks: broad domes of straw, soft-topped, catching the light along the top
    for (const [hx, hy, hr] of STACKS) {
      const dq = Math.round(depthAt(hy) * 20) / 20
      const T = tones(STUBBLE, dq, 6)
      const hh = hr * 1.5
      for (let y = Math.floor(hy - hh); y <= hy; y++) {
        const t = (y + 0.5 - (hy - hh)) / hh
        const hw = hr * (0.2 + 0.8 * Math.sqrt(t))
        for (let x = Math.floor(hx - hw); x <= hx + hw - 0.5; x++) {
          const u = (x + 0.5 - hx) / hw
          const nz = Math.sqrt(Math.max(0, 1 - u * u))
          let v = 0.08 + 0.12 * t + 0.95 * lit([u, 0.7 - 0.6 * t, -nz])
          if (hash(x, y, 9) > 0.86) v += 0.1
          if (y > hy - 1) v -= 0.12
          near.set(x, y, tone(T, v, x, y, 0.15), 0.95 * lit([u, 0.5, -nz]))
        }
      }
      // where it meets the ground, a dark seam
      for (let x = Math.floor(hx - hr); x <= hx + hr; x++) near.set(x, hy + 1, tone(tones(MEADOW, dq, 5), 0, x, 0, 0), 0)
    }
    // reeds along both banks
    for (let y = 172; y < H; y += 2) {
      const s = streamAt(y + 0.5)
      if (!s) continue
      for (const side of [-1, 1]) {
        if (r() < 0.35) continue
        const bx = Math.round(s[0] + side * (s[1] + 0.5))
        const h = 3 + Math.floor(r() * 4)
        const Rt = tones(OLIVE, Math.round(depthAt(y) * 20) / 20, 5)
        for (let k = 0; k < h; k++) near.set(bx + (k > h - 2 ? side : 0), y - k, tone(Rt, 0.1 + (k / h) * 0.6, bx, y - k, 0), 0.7)
      }
    }
  }

  // Lamps along the lane: an iron post and a lantern, lit at night with a ring of glow.
  const lamps = new Layer('lamps')
  const lampAt = (x, y, h, d) => {
    const I = tones(IRON, d, 3)
    for (let k = 0; k < h; k++) lamps.set(x, y - k, I[1])
    // its foot on the ground
    lamps.set(x, y + 1, I[0])
    lamps.set(x - (LW[0] > 0 ? 1 : -1), y + 1, I[0])
    lamps.set(x - 1, y - h, I[0])
    lamps.set(x + 1, y - h, I[0])
    lamps.set(x, y - h, M.lamp ? M.lamp.glass : fogged('#c8c4b8', d))
    lamps.set(x, y - h - 1, I[0])
  }
  for (const l of LAMPS) lampAt(...l)

  // ------------------------------------------------ the foreground
  // Bottom left: a big autumn tree in its own shade, its edges catching the sun.
  const fgTree = new Obj(0)
  {
    // the trunk and a limb, in shade, a lit edge on the side toward the light
    const B = tones(BARK, 0, 5)
    for (let y = 120; y < H; y++) {
      const t = (y - 120) / 80
      const cx = 6 - 4 * (1 - t) * (1 - t)
      const hw = 1.4 + 2.4 * t
      for (let x = Math.floor(cx - hw); x <= cx + hw; x++) {
        const s = (x + 0.5 - cx) / hw
        fgTree.set(x, y, tone(B, 0.02 + 0.65 * lit([s, 0, -Math.sqrt(Math.max(0, 1 - s * s))]) + (hash(x, Math.floor(y / 3), 4) > 0.75 ? -0.1 : 0), x, y, 0.2), 0.5)
      }
    }
    for (const [x, y] of line(5, 142, 24, 122)) for (let k = 0; k < 2; k++) fgTree.set(x, y + k, tone(B, 0.05 + k * 0.25, x, y, 0), 0.5)
    for (const [x, y] of line(8, 166, 22, 156)) fgTree.set(x, y, tone(B, 0.2, x, y, 0), 0.5)
    // the crown: one mass of rust leaves, ragged at the edge, with a few orange sprays
    foliage(fgTree, [[-12, 100, 13], [4, 92, 9], [18, 104, 8], [-6, 118, 11], [12, 118, 7], [-14, 138, 9]], RUST, 901, { g: 2.8, n: 5, dither: 0.1, base: -0.12, rag: 0.75, under: 0.2, cl: 1.05 })
    foliage(fgTree, [[26, 120, 4.5], [32, 126, 3], [20, 156, 4], [27, 160, 3], [14, 86, 4]], ORANGE, 902, { g: 2.4, n: 5, dither: 0.1, base: -0.06, rag: 0.8, cl: 1.05 })
  }
  // Top right: a branch reaching in with a few leaves, the light shining through them.
  const branch = new Obj(0)
  {
    const B = tones(BARK, 0, 4)
    const limb = [[330, 4], [304, 9], [282, 12], [262, 18], [248, 20]]
    for (let i = 0; i < limb.length - 1; i++) {
      for (const [x, y] of line(...limb[i], ...limb[i + 1])) {
        const th = i < 1 ? 3 : i < 3 ? 2 : 1
        for (let k = 0; k < th; k++) branch.set(x, y + k, tone(B, k === 0 ? 0.45 : 0.15, x, y, 0), 0.7)
      }
    }
    for (const tw of [[[300, 10], [292, 22]], [[284, 12], [272, 4]], [[268, 16], [262, 28]], [[312, 7], [318, 18]]]) {
      for (const [x, y] of line(...tw[0], ...tw[1])) branch.set(x, y, tone(B, 0.2, x, y, 0), 0.7)
    }
    const r = rng(17)
    const leafAt = [[292, 23], [272, 3], [262, 29], [318, 19], [254, 22], [278, 18], [298, 15], [306, 22], [266, 10], [286, 6], [246, 19], [324, 12], [258, 15]]
    for (const [lx, ly] of leafAt) {
      const alb = LEAVES[Math.floor(r() * 4)]
      const T = tones(alb, 0, 6)
      const a = r() * Math.PI * 2
      const s = 2.2 + r() * 1.3
      for (let y = -4; y <= 4; y++) {
        for (let x = -4; x <= 4; x++) {
          const u = (x * Math.cos(a) + y * Math.sin(a)) / s
          const v = (-x * Math.sin(a) + y * Math.cos(a)) / (s * 0.75)
          const lobes = 1 + 0.25 * Math.cos(Math.atan2(v, u) * 5)
          if (u * u + v * v > lobes * lobes) continue
          // translucent: the side toward the light glows
          let b = 0.35 + 0.35 * (M.sun ? 1 : 0) * (1 - Math.hypot(u, v) / 1.3) + 0.25 * lit([x / 4, -y / 4, -0.4])
          if (Math.abs(v) < 0.18 && u > -0.8) b -= 0.22
          branch.set(lx + x, ly + y, tone(T, b, x, y, 0.2), 0.9)
        }
      }
    }
  }
  // Bottom right: a garden wall, a lamp standing on it by the bridge, and a cat. The wall's
  // face stands on row 200; its cap is two rows seen from above, the back one and the front.
  const wall = new Obj(0.04)
  const WALL_TOP = 186
  const WZ = toW(0, 200)[1]
  const WX = x => toW(x + 0.5, 200)[0]
  const LX = 252
  // the lamp and the cat shade the cap and the face
  caster('lamp', [WX(LX) - 0.5, WX(LX + 1) + 0.5, WZ + 0.8, WZ + 2.2, 0, 62], () => true, 0.2)
  caster('lamp', [WX(LX) - 2.5, WX(LX + 1) + 2.5, WZ + 0.2, WZ + 2.8, 200 - 152, 200 - 140], () => true, 0.3)
  caster('cat', [WX(258), WX(262), WZ + 0.6, WZ + 2.4, 0, 200 - WALL_TOP + 8], () => true, 0.3)
  {
    const S = tones(STONE, 0.04, 6)
    for (let x = 238; x < W; x++) {
      const t = WALL_TOP + Math.round((x - 238) * -0.02)
      for (let y = t; y < H; y++) {
        const e = y - t
        let v
        if (e === 0) v = 0.15 + 1.1 * lit([0, 1, 0]) * vis(WX(x), WZ + 1.8, 200 - t) + 0.12 * hash(Math.floor(x / 3), 0, 2)
        else if (e === 1) v = 0.1 + 0.8 * lit([0, 0.7, -0.7]) * vis(WX(x), WZ + 0.6, 200 - t)
        else {
          const course = Math.floor((e - 2) / 3)
          const off = course % 2 ? 3 : 0
          v = 0.08 + 0.55 * lightFront * vis(WX(x), WZ - 0.2, 200 - y) + 0.14 * hash(Math.floor((x + off) / 5), course, 3)
          if ((e - 2) % 3 === 2 || (x + off) % 5 === 0) v -= 0.12
        }
        wall.set(x, y, tone(S, v, x, y, 0.15), e < 1 ? 1 : 0.3)
      }
    }
    // tufts of grass and asters along the wall's top
    const r = rng(23)
    for (let i = 0; i < 18; i++) {
      const x = 240 + Math.floor(r() * 80)
      if (Math.abs(x - LX - 0.5) < 5) continue
      const h = 2 + Math.floor(r() * 4)
      const g = tones(GRASS, 0.04, 4)
      for (let k = 1; k <= h; k++) wall.set(x + (k > 2 ? (i % 2 ? 1 : -1) : 0), WALL_TOP - k, tone(g, 0.2 + k * 0.12, x, k, 0), 0.8)
      if (i % 3 === 0) wall.set(x + (i % 2 ? 1 : -1), WALL_TOP - h - 1, fogged(i % 2 ? '#a070d8' : '#f0c040', 0.04), 0.6)
    }
  }
  // The lamp: a stepped plinth on the cap, a straight post of two columns with a collar, a
  // crossbar for the lamplighter's ladder, and a lantern: a drip, a framed box of four panes,
  // a pyramid roof wider than the box and a finial. Lit on the side toward the key light.
  const lampObj = new Obj(0.04)
  {
    const I = tones(IRON, 0.04, 5)
    const toLight = LW[0] > 0 ? 1 : -1
    const sk = lit([toLight, 0, 0])
    const cx = LX + 0.5
    // which side of the lamp's axis a cell is on: the lit side, the shaded side, or the middle
    const iron = (x, y, base = 0.12, k = 0.7) => {
      const s = Math.sign(x + 0.5 - cx - 0.5 * toLight + 0.5 * toLight)
      const lt = s === toLight ? sk : 0
      lampObj.set(x, y, tone(I, base + k * lt + (y === 138 || y === 139 ? 0.15 : 0), x, y, 0), lt ? 0.9 : 0)
    }
    const row = (y, x0, x1, base, k) => {
      for (let x = x0; x <= x1; x++) iron(x, y, base, k)
    }
    row(185, LX - 2, LX + 3, 0.1, 0.5)
    row(184, LX - 1, LX + 2, 0.14, 0.6)
    row(183, LX - 1, LX + 2, 0.14, 0.6)
    row(182, LX - 2, LX + 3, 0.22, 0.6)
    for (let y = 157; y <= 181; y++) row(y, LX, LX + 1, 0.12, 0.7)
    row(170, LX - 1, LX + 2, 0.22, 0.6)
    row(155, LX - 4, LX + 5, 0.18, 0.6)
    iron(LX - 4, 156, 0.18, 0.5)
    iron(LX + 5, 156, 0.18, 0.5)
    row(156, LX, LX + 1, 0.12, 0.7)
    row(153, LX, LX + 1, 0.12, 0.7)
    row(154, LX, LX + 1, 0.12, 0.7)
    row(152, LX - 1, LX + 2, 0.18, 0.6)
    row(151, LX - 2, LX + 3, 0.22, 0.6)
    row(144, LX - 2, LX + 3, 0.22, 0.6)
    row(143, LX - 3, LX + 4, 0.2, 0.7)
    row(142, LX - 2, LX + 3, 0.16, 0.7)
    row(141, LX - 1, LX + 2, 0.16, 0.7)
    row(140, LX, LX + 1, 0.16, 0.7)
    row(139, LX, LX + 1, 0.2, 0.6)
    iron(LX + (toLight > 0 ? 1 : 0), 138, 0.3, 0.6)
    // the panes: a frame post at each side, a bar across the middle
    for (let y = 145; y <= 150; y++) {
      iron(LX - 2, y, 0.18, 0.6)
      iron(LX + 3, y, 0.18, 0.6)
      for (let x = LX - 1; x <= LX + 2; x++) {
        let c
        if (y === 147) c = tone(I, 0.15, x, y, 0)
        else if (M.lamp?.glow) c = Math.abs(x + 0.5 - cx - 0.5) < 1.2 && y >= 146 && y <= 149 ? '#fff6d8' : M.lamp.glass
        else if (M.sun && (x - cx) * toLight > 0) c = mixH(M.rim.tones[2], '#ffffff', y < 147 ? 0.4 : 0)
        else c = mixH(fogged(M.sky[M.sky.length - 3][1], 0.3), '#ffffff', x === LX + 2 && y < 147 ? 0.5 : 0.1)
        lampObj.set(x, y, c, 0)
      }
    }
  }
  // Its halo at night: a round glow round the lantern, solid next to the glass and thinning
  // with the distance in an ordered dither, warm near and dim far. The outer rings breathe
  // slowly; the inner one holds.
  const lampGlow = new Layer('lampGlow')
  const lampHalo = new Layer('lampHalo', anim('lb', '--d:6s;--l:0s'))
  if (M.lamp?.glow) {
    const cx = LX + 1
    const cy = 148
    for (let y = cy - 10; y <= cy + 10; y++) {
      for (let x = cx - 10; x <= cx + 10; x++) {
        if (lampObj.has(x, y)) continue
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        // how much of the ring is lit: all of it next to the lantern, none past 8.5 cells
        const f = clamp((8.5 - d) / (8.5 - 3.6), 0, 1) ** 2
        if (f < 0.04 || f <= bayer(x, y)) continue
        const c = M.lamp.glow[d < 4.6 ? 2 : d < 6.2 ? 1 : 0]
        if (d < 4.6) lampGlow.set(x, y, c)
        else lampHalo.set(x, y, c)
      }
    }
  }

  // ------------------------------------------------ the air: bloom, rays, mist
  const extraDefs = []
  let gid = 0
  // A soft ellipse of light: a radial gradient over a rect.
  const glowRect = (cx, cy, rx, ry, col, a) => {
    const id = 'G' + gid++
    const st = [[0, 1], [0.2, 0.84], [0.4, 0.58], [0.6, 0.3], [0.8, 0.1], [1, 0]]
    extraDefs.push("<radialGradient id='" + id + "'>" + st.map(([o, k]) => "<stop offset='" + f2(o) + "' stop-color='" + col + "' stop-opacity='" + f3(a * k) + "'/>").join('') + '</radialGradient>')
    return "<rect x='" + Math.round(cx - rx) + "' y='" + Math.round(cy - ry) + "' width='" + Math.round(2 * rx) + "' height='" + Math.round(2 * ry) + "' fill='url(#" + id + ")'/>"
  }
  // A band of haze: clear above y0, thickest from y1 to y2, clear again by y3.
  const hazeRect = (y0, y1, y2, y3, col, a) => {
    const id = 'G' + gid++
    const h = y3 - y0
    const at = y => f2((y - y0) / h)
    extraDefs.push("<linearGradient id='" + id + "' x2='0' y2='1'><stop stop-color='" + col + "' stop-opacity='0'/><stop offset='" + at(y1) + "' stop-color='" + col + "' stop-opacity='" + f2(a) + "'/><stop offset='" + at(y2) + "' stop-color='" + col + "' stop-opacity='" + f2(a) + "'/><stop offset='1' stop-color='" + col + "' stop-opacity='0'/></linearGradient>")
    return "<rect x='0' y='" + y0 + "' width='" + W + "' height='" + h + "' fill='url(#" + id + ")'/>"
  }
  const BL = M.bloom
  const src = M.sun ?? M.moon
  const bloom = k => (BL && BL[k] ? { raw: glowRect(src.x, src.y + (BL[k][3] ?? 0), BL[k][0], BL[k][1], BL.col, BL[k][2]) } : null)

  // Rays: wedges of light fanning out from the sun, each a stepped outline filled by one radial
  // gradient that fades with the distance; each breathes slowly, out of step with the others.
  // Only the parts not hidden by what is drawn over them are outlined; their edges step every
  // two rows.
  function rays(list, r0, cover) {
    if (!M.rays || !list?.length) return null
    const { x: sx, y: sy } = M.sun
    const out = []
    list.forEach(([th, w, r1], i) => {
      const rows = new Map()
      const c = (th * Math.PI) / 180
      for (let y = Math.floor(sy - r1); y <= sy + r1; y++) {
        if (y < 0 || y >= H) continue
        for (let x = Math.floor(sx - r1); x <= sx + r1; x++) {
          if (x < -1 || x > W) continue
          const dx = x + 0.5 - sx
          const dy = y + 0.5 - sy
          const r = Math.hypot(dx, dy)
          if (r < r0 || r > r1) continue
          const a = Math.atan2(dy, dx)
          if (Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c))) > (w * Math.PI) / 180) continue
          if (cover?.has(key(x, y))) continue
          const e = rows.get(y)
          if (!e) rows.set(y, [x, x + 1])
          else {
            e[0] = Math.min(e[0], x)
            e[1] = Math.max(e[1], x + 1)
          }
        }
      }
      // pairs of rows share one extent
      for (const y of [...rows.keys()]) {
        const o = rows.get(y ^ 1)
        const e = rows.get(y)
        if (o) rows.set(y, [Math.min(e[0], o[0]), Math.max(e[1], o[1])])
        else rows.set(y ^ 1, [...e])
      }
      const ys = [...rows.keys()].filter(y => y >= 0 && y < H).sort((a, b) => a - b)
      if (!ys.length) return
      const d = 9 + ((i * 7) % 9)
      let paths = ''
      // runs of consecutive rows, one outline each
      for (let j = 0; j < ys.length; ) {
        let k = j
        while (k + 1 < ys.length && ys[k + 1] === ys[k] + 1) k++
        if (k - j >= 1) paths += stairs(ys[j], ys[k], y => rows.get(y)[0], y => rows.get(y)[1])
        j = k + 1
      }
      if (paths) out.push("<g class='ry' style='--d:" + d + 's;--l:' + -((i * 3.4) % d).toFixed(1) + "s'>" + paths + '</g>')
    })
    return out.join('')
  }
  const rayRaw = { up: null, down: null }
  if (M.rays) {
    const R = M.rays
    const st = [[0, 1], [0.12, 1], [0.3, 0.7], [0.55, 0.38], [0.8, 0.12], [1, 0]]
    extraDefs.push("<radialGradient id='RY' gradientUnits='userSpaceOnUse' cx='" + M.sun.x + "' cy='" + M.sun.y + "' r='" + R.reach + "'>" + st.map(([o, k]) => "<stop offset='" + f2(o) + "' stop-color='" + R.color + "' stop-opacity='" + f3(R.alpha * k) + "'/>").join('') + '</radialGradient>')
    const front = new Set()
    for (const o of [slope, hill, woods, lane, ...vlayers, bridge, bridgeFront, near]) for (const k of o.m.keys()) front.add(k)
    const up = rays(R.up, M.sun.r + 4)
    const down = rays(R.down, M.sun.r + 3, front)
    if (up) rayRaw.up = { raw: "<g fill='url(#RY)'>" + up + '</g>' }
    if (down) rayRaw.down = { raw: "<g fill='url(#RY)'>" + down + '</g>' }
  }

  // Mist: banks of soft-edged wisps in two tones, see-through, drifting along the valley.
  function mistLayer(nm, y0, y1, dens, seed, x0, x1, drift) {
    const L = new Layer(nm)
    const T = M.mist.tones
    for (let y = y0; y <= y1; y++) {
      const mid = (y - y0) / (y1 - y0)
      for (let x = x0; x < x1; x++) {
        const n = noise(x * 0.022, y * 0.45, seed) * 0.75 + noise(x * 0.08, y * 0.8, seed + 1) * 0.25
        const dd = dens * Math.sin(Math.PI * clamp(mid, 0, 1)) ** 0.6
        if (n > 1 - dd) L.set(x, y, n > 1 - dd * 0.45 ? T[2] : T[1])
      }
    }
    L.anim = anim('md', '--d:' + drift[0] + 's;--l:' + -drift[1] + 's', " opacity='" + f2(M.mist.o * drift[2]) + "'")
    return L
  }
  const mistA = mistLayer('mistA', 95, 104, 0.5, 71, 118, W + 10, [48, 14, 1])
  const mistB = mistLayer('mistB', 123, 133, 0.46, 72, 136, W + 10, [40, 31, 0.9])
  const mistC = mistLayer('mistC', 160, 166, 0.4, 73, 150, 262, [36, 5, 0.7])

  // ------------------------------------------------ life: smoke, leaves, birds, a cart, a cat
  // Smoke: from a few chimneys, puffs that rise, lean away on the breeze and thin out, three
  // to a chimney a third of the way apart.
  const smokeBy = new Map()
  {
    const picks = fx.smoke.filter(([, , dep], i) => dep > 0.1 && hash(i, 3, 77) > 0.4).slice(0, 4)
    picks.forEach(([x, y, dep], i) => {
      const S = M.smoke.map(c => fogged(c, dep, 0.45))
      const list = smokeBy.get(dep) ?? []
      const cx = Math.round(x)
      const cy = Math.round(y)
      for (let p = 0; p < 3; p++) {
        // a round puff, shaded on its far side, lit on the side toward the light
        const L = new Layer('smoke')
        const lr = M.from[0] > cx ? 1 : -1
        for (const [dx, dy, t] of [[0, -1, 1], [1, -1, 2], [-1, 0, 0], [0, 0, 1], [1, 0, 2], [0, 1, 0]]) L.set(cx + dx * lr, cy + dy, S[t])
        L.anim = anim('sm', '--l:' + f2(-(p * 3 + ((i * 0.9) % 3))) + 's', " opacity='0'")
        list.push(L)
      }
      smokeBy.set(dep, list)
    })
  }

  // Falling leaves: two frames each (flat, then turned edge-on), falling a cell at a time,
  // swaying and leaning on the breeze; hidden in the still picture.
  function fallingLeaf(kind, x, y, alb, l, f) {
    const T = tones(alb, 0.02, 6)
    // flat: a small lobed leaf, lit through; turned: its edge, a thin dark sliver
    const a = new Layer('leafA')
    for (const [dx, dy, t] of [[0, 0, 3], [1, 0, 4], [2, 0, 3], [1, -1, 5], [0, 1, 2], [1, 1, 3]]) a.set(x + dx, y + dy, T[t])
    const b = new Layer('leafB')
    for (const [dx, dy, t] of [[0, 0, 2], [1, 0, 3], [2, -1, 4], [0, 1, 1]]) b.set(x + dx, y + dy, T[t])
    a.anim = anim('fa')
    b.anim = anim('fb', '', " opacity='0'")
    return { wrap: "<g class='lf" + kind + "' style='--l:" + f2(l) + 's;--f:' + f + "s' opacity='0'><g class='ld" + kind + "'><g class='lw'>", end: '</g></g></g>', layers: [a, b] }
  }
  const leavesTR = [
    fallingLeaf('A', 292, 26, RUST, -3, 0.8),
    fallingLeaf('A', 262, 31, ORANGE, -16.5, 1),
    fallingLeaf('A', 306, 24, GOLD, -27, 0.9),
    fallingLeaf('A', 278, 21, RED, -35, 0.8),
  ]
  const leavesBL = [fallingLeaf('B', 22, 110, RUST, -6, 0.9), fallingLeaf('B', 30, 126, ORANGE, -24, 0.8), fallingLeaf('B', 8, 96, RUST, -15, 1)]

  // Birds: a loose flock crossing the sky now and then, wings beating out of step.
  const birds = []
  if (M.bird) {
    const r = rng(19)
    const flock = [[-6, 62, 1], [-12, 58, 1], [-15, 66, 0], [-21, 61, 0], [-26, 64, 0]]
    const ws = []
    for (const [bx, by, big] of flock) {
      const a = new Layer('birdA')
      const b = new Layer('birdB')
      const c = M.bird
      if (big) {
        for (const [dx, dy] of [[-2, -1], [2, -1], [-1, 0], [0, 0], [1, 0]]) a.set(bx + dx, by + dy, c)
        for (const [dx, dy] of [[-1, 0], [0, 0], [1, 0], [-2, 1], [2, 1]]) b.set(bx + dx, by + dy, c)
      } else {
        for (const [dx, dy] of [[-1, -1], [1, -1], [0, 0]]) a.set(bx + dx, by + dy, c)
        for (const [dx, dy] of [[-1, 0], [0, 0], [1, 0]]) b.set(bx + dx, by + dy, c)
      }
      a.anim = anim('fa')
      b.anim = anim('fb', '', " opacity='0'")
      ws.push({ wrap: "<g class='bb' style='--l:" + f2(-Math.round(r() * 60) * 0.05) + 's;--f:' + (r() < 0.5 ? '.6' : '.7') + "s'>", end: '</g>', layers: [a, b] })
    }
    birds.push({ wrap: "<g class='bf' style='--l:-" + (M.birdAt ?? 30) + "s'>", end: '</g>', layers: ws })
  }

  // A horse and cart with a load of pumpkins, coming along the far bank and over the bridge
  // at a walk, passing behind the trees at the bridge's end.
  const hump = x => Math.round(-2.2 * gauss(x, ARCH.cx, 24))
  const CART = { x: 324, y: ROAD_Y, travel: 166, step: 0.3, cycle: 96, mid: 11 }
  const cartBody = new Obj(0.24)
  const legsA = new Layer('legsA')
  const legsB = new Layer('legsB')
  {
    const d = cartBody.d
    const X = CART.x
    const Y = CART.y
    // drawn facing left, a row a string from 10 cells up to the ground
    const ART = [
      '...............k.......',
      '..m...........kkk......',
      '.HHm...........f.......',
      'HHhmm.........ccc..g.g.',
      'hh.hmm........ccc.PPPP.',
      '....hHHHHHHHt.cccPpPpPp',
      '....hhhhhhhhtvvWWWWWWWW',
      '.....dddddddt.vwwwwwwww',
      '...............vvrrrvvv',
      '.................rur...',
      '.................rrr...',
    ]
    const horse = tones(FUR.map(v => v * 0.45), d, 5)
    const wood = tones(WOOD, d, 5)
    const iron = tones(IRON, d, 3)
    const pump = tones(ORANGE, d, 5)
    const ink = {
      H: [horse, 0.62, 0.6], h: [horse, 0.32, 0.2], d: [horse, 0.12, 0.2], m: [horse, 0.02, 0.3], t: [horse, 0.06, 0.2],
      W: [wood, 0.65, 0.6], w: [wood, 0.32, 0.2], v: [wood, 0.1, 0.2], u: [wood, 0.7, 0],
      P: [pump, 0.75, 0.7], p: [pump, 0.4, 0.3], g: [tones(MEADOW, d, 4), 0.3, 0.3],
      k: [tones(TIMBER, d, 4), 0.15, 0.6], f: [tones(ROSE, d, 4), 0.55, 0.2], c: [tones(SLATE, d, 4), 0.3, 0.2],
      r: [iron, 0.25, 0.2],
    }
    ART.forEach((row, i) => {
      for (let x = 0; x < row.length; x++) {
        const k = ink[row[x]]
        if (k) cartBody.set(X + x, Y - 10 + i, tone(k[0], k[1], x, i, 0), k[2])
      }
    })
    if (M.lamp) {
      cartBody.set(X + 13, Y - 8, iron[0], 0)
      cartBody.set(X + 13, Y - 7, M.lamp.glass, 0)
    }
    // its shadow along the road, away from the key light: each cell's fall to the ground, kept
    // where it lands on the road's three rows
    const SH = tones(STUBBLE, 0.26, 5)[0]
    const sv = [-AX - AZ * KX, AZ * KY]
    const shade = new Set()
    ART.forEach((row, i) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === '.') continue
        const h = 10 - i
        for (let t = 0; t <= h; t += 0.5) {
          const sx = Math.round(X + x + sv[0] * t)
          const sy = Math.round(Y + sv[1] * t)
          if (sy >= Y - 1 && sy <= Y + 1) shade.add(sx + ',' + sy)
        }
      }
    })
    for (const k of shade) {
      const [x, y] = k.split(',').map(Number)
      if (!cartBody.has(x, y)) cartBody.set(x, y, SH, 0)
    }
    // legs in two frames: standing, then mid-stride
    const L = horse[1]
    for (const [dx, dy] of [[5, -2], [5, -1], [5, 0], [10, -2], [10, -1], [10, 0]]) legsA.set(X + dx, Y + dy, L)
    for (const [dx, dy] of [[5, -2], [4, -1], [4, 0], [6, -1], [6, 0], [10, -2], [9, -1], [9, 0], [11, -1], [11, 0]]) legsB.set(X + dx, Y + dy, L)
  }
  const cartLayer = commit(cartBody, new Layer('cart'))
  legsA.anim = anim('fa')
  legsB.anim = anim('fb', '', " opacity='0'")
  extraDefs.push("<clipPath id='K'><rect x='182' y='120' width='160' height='60'/></clipPath>")
  const cart = { wrap: "<g clip-path='url(#K)'><g class='cx' style='--l:-" + (M.cartAt ?? 20) + "s;--f:.6s'><g class='cy'>", end: '</g></g></g>', layers: [cartLayer, legsA, legsB] }
  // The trees at the bridge's end, which the cart passes behind.
  const bridgeEnd = new Obj(0.22)
  {
    const B = tones(BARK, 0.22, 4)
    for (let y = 150; y <= ROAD_Y + 1; y++) {
      bridgeEnd.set(180, y, tone(B, 0.1, 180, y, 0), 0)
      bridgeEnd.set(181, y, tone(B, 0.2 + 0.5 * lightSide, 181, y, 0), 0.5)
    }
    foliage(bridgeEnd, [[180, 146, 6], [175, 150, 4.5], [186, 149, 4.5], [185, 155, 3.2], [178, 155, 3]], OLIVE, 733, { n: 6 })
  }

  // The cat on the garden wall, its tail hanging down the stones and now and then flicking.
  const tailA = new Layer('tailA')
  const tailB = new Layer('tailB')
  {
    const X = 258
    const Y = WALL_TOP - 2
    const F = tones(FUR, 0.04, 6)
    const cells = [[0, -8, 0.2], [2, -8, 0.2], [0, -7, 0.25], [1, -7, 0.3], [2, -7, 0.25], [0, -6, 0.18], [1, -6, 0.22], [2, -6, 0.2], [1, -5, 0.15], [2, -5, 0.2]]
    for (let dx = 1; dx <= 4; dx++) for (let dy = -4; dy <= 0; dy++) cells.push([dx, dy, 0.1 + 0.1 * (dx === 4 ? 1 : 0) + (dy === -4 ? 0.08 : 0)])
    cells.push([0, 0, 0.3], [0, -1, 0.18])
    for (const [dx, dy, v] of cells) wall.set(X + dx, Y + dy, tone(F, v, dx, dy, 0), 0.9)
    wall.set(X, Y - 7, M.litShare > 0.5 ? '#c8e070' : tone(F, 0.1, 0, 0, 0), 0)
    const T = F[1]
    for (const [dx, dy] of [[5, 0], [5, 1], [5, 2], [5, 3], [6, 4]]) tailA.set(X + dx, Y + dy, T)
    for (const [dx, dy] of [[5, 0], [6, 1], [6, 2], [7, 2], [8, 1]]) tailB.set(X + dx, Y + dy, T)
    tailA.anim = anim('ta')
    tailB.anim = anim('tb', '', " opacity='0'")
  }

  // ------------------------------------------------ local lights
  // At night the lit windows and the lamps light what is round them: the wall round a window
  // and the ground under it, a pool of ground round a lamp's foot and the upper part of its
  // post. Their light falls off over their reach in two steps, dithered where they meet, and lights a cell's
  // own colour warm: where it and the moon both reach, the warm wins near the source.
  hill.tag = 'ground'
  lane.tag = 'ground'
  near.tag = 'ground'
  bridge.tag = 'bridge'
  wall.tag = 'wall'
  lampObj.tag = 'lamp'
  for (const o of vlayers) o.tag = 'tier'
  for (const [x, y, h] of LAMPS) {
    addLight(x + 0.5, y + 1, LOCAL.lamp[1], 1, ['ground', 'tier', 'bridge'], 0.5)
    addLight(x + 0.5, y - h, 4, 0.7, ['tier', 'bridge'])
  }
  addLight(LX + 1, WALL_TOP + 1, LOCAL.bridgeLamp[1], 1, ['wall'], 0.55)
  addLight(LX + 1, 147, 12, 1, ['lamp'], 1.8)
  addLight(LX + 1, 183, LOCAL.bridgeLamp[1] + 4, 0.85, ['floor', 'ground'], 0.45)
  if (LIGHTS.length) {
    const WARM = rgb(LOCAL.window[0]).map(v => v / 255)
    const cache = new Map()
    const warmed = (c, lvl) => {
      const k = c + lvl
      if (!cache.has(k)) {
        const ch = rgb(c).map((v, i) => Math.min(255, v * (1 + (lvl * 0.5 * WARM[i]) / M.amb[i]) + lvl * 22 * WARM[i]))
        cache.set(k, hex(ch.map(v => Math.round(v / 4) * 4)))
      }
      return cache.get(k)
    }
    local = (x, y, c, o) => {
      let f = 0
      for (const L of LIGHTS) {
        if (!L.on.includes(o) && !L.on.includes(o?.tag ?? o)) continue
        const d = Math.hypot(x + 0.5 - L.x, (y + 0.5 - L.y) / L.ry) / L.reach
        if (d < 1) f += L.k * (1 - d) ** 1.3
      }
      if (f < 0.04) return c
      const lvl = Math.floor(clamp(f, 0, 1) * 2 + 0.3 + bayer(x, y) * 0.5) / 2
      return lvl > 0 ? warmed(c, Math.min(1, lvl)) : c
    }
    for (const [k, c] of floor.m) {
      const [x, y] = cellXY(k)
      floor.m.set(k, local(x, y, c, 'floor'))
    }
  }

  // ------------------------------------------------ assemble
  // Everything but the corners sits in the bottom-pinned viewport, so the valley and its
  // horizon line up on any window; the tree, the wall and the branch keep to their corners.
  // An opaque base under everything: where two shapes meet inside a screen pixel, a little of
  // what lies under them shows, so let that be the sky, and lower down the ground.
  // The sky part of the base follows the sky's own ramp, so a leak at a cell edge is the colour
  // of that row and never shows as a line.
  const keys = [0, ...M.sky.map(s => s[0]).filter(t => t > 0 && t < 112), 112]
  extraDefs.push("<linearGradient id='S' gradientUnits='userSpaceOnUse' x2='0' y2='112'>" + keys.map(t => "<stop offset='" + f2(t / 112) + "' stop-color='" + ramp(M.sky, t + 1) + "'/>").join('') + '</linearGradient>')
  const base = "<rect x='-1' y='-1' width='322' height='202' fill='url(#S)'/><rect x='-1' y='112' width='322' height='89' fill='" + tones(GRASS, 0.24, 5)[1] + "'/>"
  part('pB', [{ raw: base }, { under: sky }, ...starLayers, bloom('sky'), orb, rayRaw.up])
  part('pB', cloudLayers)
  part('pB', birds)
  part('pB', [ridge1, bloom('ridge'), mistA, ridge2, ridge3, bloom('near'), floor, water, banks, ...glints, mirror])
  part('pB', [M.valleyHaze ? { raw: hazeRect(...M.valleyHaze) } : null, rayRaw.down, mistB])
  part('pB', [commit(slope, new Layer('slope'), 0.9), bank])
  part('pB', [commit(hill, new Layer('hill'), 0.8), commit(woods, new Layer('woods')), commit(lane, new Layer('lane'), 0)])
  for (const o of vlayers) part('pB', [commit(o, new Layer('tier' + o.d)), ...(smokeBy.get(o.d) ?? [])])
  part('pB', [commit(bridge, new Layer('bridge')), cart, commit(bridgeFront, new Layer('parapet'))])
  part('pB', [mistC, commit(bridgeEnd, new Layer('bridgeEnd')), commit(near, new Layer('near')), lamps])
  part('pBL', [commit(fgTree, new Layer('fgTree'), 1), ...leavesBL])
  part('pBR', [commit(wall, new Layer('wall')), tailA, tailB, commit(lampObj, new Layer('lamp')), lampGlow, lampHalo])
  part('pTR', [commit(branch, new Layer('branch')), ...leavesTR])

  const rules = motionRules(M, CART, cartKf(hump, CART))
  // How every cell layer is written (emitSafe's options; see encode.mjs and notes.md).
  const SAFE = { T: 28 }
  // For the light check: six buildings, far to near. Each one's base (the foot under its
  // highest point), where the shadow of that point lands on the ground, whether that runs away
  // from the light, and how much of the ground along the way (past the building) is in shadow.
  const marks = [
    ['tower', TOWER, TOWER.ht + 1],
    ['far right', H1[3]],
    ['middle left', H2[1]],
    ['middle centre', H2[3]],
    ['near left', H3[1]],
    ['near centre', H3[3]],
  ].map(([name, h, top]) => {
    const b = h.lift ?? 0
    const [gx0, gz0] = toW(h.x, h.y + b)
    const gx = gx0 + h.w / 2
    const gz = gz0 + h.d / 2
    const v = top ?? h.ht + h.rh
    const base = toS(gx, gz, b)
    // follow the ray from the highest point away from the light down to the ground, which
    // drops at each terrace wall it passes over
    let t = 0
    while (t < 200 && b + v - t > terrainH(gx - AX * t, gz - AZ * t)) t += 0.05
    const end = toS(gx - AX * t, gz - AZ * t, b + v - t)
    const away = (end[0] - base[0]) * (M.from[0] - base[0]) + (end[1] - base[1]) * (M.from[1] - base[1]) < 0
    let n = 0
    let dark = 0
    for (let f = 0.4; f <= 0.96; f += 0.04) {
      const q = t * f
      const s = vis(gx - AX * q, gz - AZ * q, terrainH(gx - AX * q, gz - AZ * q) + 0.05)
      n++
      if (s < 0.5) dark++
    }
    const r2 = p => p.map(q => Math.round(q * 10) / 10)
    return { name, base: r2(base), end: r2(end), height: v, away, shadowed: Math.round((dark / n) * 100) / 100 }
  })
  return { ...encode(parts, rules, '--m:0s', extraDefs, SAFE), light: { at: M.from, shadow: [-AX - AZ * KX, AZ * KY], marks } }
}

// A stepped outline of rows y0..y1, each row from xl(y) to xr(y), split so that no path has
// more than 64 runs.
function stair(y0, y1, xl, xr) {
  let d = 'M' + xl(y0) + ' ' + f1(y0 - 0.5) + 'h' + (xr(y0) - xl(y0))
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
      d += 'v-' + run
      run = 0
      if (nx === null) break
      d += 'h' + (nx - cur)
      cur = nx
    }
  }
  return d + 'z'
}
function stairs(y0, y1, xl, xr) {
  const d = stair(y0, y1, xl, xr)
  if (y0 === y1 || (d.match(/[hv]/g) ?? []).length <= 64) return "<path d='" + d + "'/>"
  const m = (y0 + y1) >> 1
  return stairs(y0, m, xl, xr) + stairs(m + 1, y1, xl, xr)
}

// ---------------------------------------------------------------- motion

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

// The cart's rise and fall over the bridge's hump, in step with its walk: a keyframe each time
// the deck under the cart's middle changes height.
function cartKf(hump, C) {
  let k = '0%{transform:none}'
  let last = 0
  for (let i = 1; i <= C.travel; i++) {
    const mid = C.x - i + C.mid
    const off = mid >= 186 && mid <= 252 ? hump(mid) : 0
    if (off === last) continue
    const pct = Math.round(((i * C.step) / C.cycle) * 1e6) / 1e4
    k += pct + '%{transform:' + (off ? 'translateY(' + off + 'px)' : 'none') + '}'
    last = off
  }
  return k
}

function motionRules(M, C, cartFrames) {
  const from = l => 'calc(' + l + ' + var(--m))'
  const at = 'calc(var(--l) + var(--m))'
  // smoke: twenty frames of a puff rising and leaning away, thinning as it goes
  let sm = ''
  for (let k = 0; k < 20; k++) {
    const y = -Math.round(k * 0.8)
    const x = -Math.round(Math.pow(k / 19, 1.6) * 6)
    const o = k === 0 ? 0.35 : k === 1 ? 0.7 : k < 7 ? 0.85 : k < 19 ? 0.85 - ((k - 6) / 12) * 0.75 : 0
    const t = x || y ? 'translate(' + x + 'px,' + y + 'px)' : 'none'
    sm += k * 5 + '%{transform:' + t + ';opacity:' + f2(o) + '}'
  }
  return [
    // Clouds drift a cell at a time, there and back.
    '.cd{animation:var(--d) steps(1) ' + from('var(--l)') + ' infinite alternate}',
    ...[3, 4, 5, 6].map(a => '.d' + a + '{animation-name:d' + a + '}' + swingKf('d' + a, a)),
    // Mist drifts eight cells along the valley and back.
    '.md{animation:md var(--d) steps(1) ' + at + ' infinite alternate}',
    swingKf('md', 8),
    // Rays breathe: their light swells and ebbs in twenty steps.
    M.rays ? '.ry{animation:ry var(--d) steps(1) ' + at + ' infinite}' : '',
    M.rays ? '@keyframes ry{' + Array.from({ length: 20 }, (_, i) => i * 5 + '%{opacity:' + f2(0.55 + 0.45 * (0.5 + 0.5 * Math.cos((Math.PI * 2 * i) / 20))) + '}').join('') + '}' : '',
    // Glints on the stream: three sets in turn, a second each, then a second of none.
    '.gl{animation:gl 4s steps(1) ' + at + ' infinite}',
    '@keyframes gl{0%{opacity:1}25%,100%{opacity:0}}',
    // The bridge lamp's halo breathes: its outer rings dim and brighten in twenty steps.
    M.lamp?.glow ? '.lb{animation:lb var(--d) steps(1) ' + at + ' infinite}@keyframes lb{' + Array.from({ length: 20 }, (_, i) => i * 5 + '%{opacity:' + f2(0.7 + 0.3 * (0.5 + 0.5 * Math.cos((Math.PI * 2 * i) / 20))) + '}').join('') + '}' : '',
    // Stars dim a little for a moment.
    M.stars ? '.tk{animation:tk var(--d) steps(1) ' + at + ' infinite}@keyframes tk{0%,85%{opacity:1}90%{opacity:.75}95%{opacity:.6}}' : '',
    // Smoke: a puff every three seconds from each chimney, nine seconds to fade.
    '.sm{animation:sm 9s steps(1) ' + at + ' infinite}',
    '@keyframes sm{' + sm + '}',
    // Two-frame sprites (leaves turning, wings, legs): --f is the time for both frames.
    '.fa{animation:fa var(--f) steps(1) ' + at + ' infinite}',
    '@keyframes fa{0%{opacity:1}50%{opacity:0}}',
    '.fb{animation:fb var(--f) steps(1) ' + at + ' infinite}',
    '@keyframes fb{0%{opacity:0}50%{opacity:1}}',
    // Leaves: a cell down every 0.1 s (A, from the branch) or 0.15 s (B, from the tree),
    // a cell along the breeze every 0.5 s or 1.5 s, swaying a cell or two; then a rest.
    '.lfA{animation:lfA 37s steps(185) ' + at + ' infinite}',
    '@keyframes lfA{0%{transform:none;opacity:1}50%,100%{transform:translateY(185px);opacity:1}}',
    '.ldA{animation:ldA 37s steps(37) ' + at + ' infinite}',
    '@keyframes ldA{0%{transform:none}50%,100%{transform:translateX(-37px)}}',
    '.lfB{animation:lfB 36s steps(120) ' + at + ' infinite}',
    '@keyframes lfB{0%{transform:none;opacity:1}50%,100%{transform:translateY(120px);opacity:1}}',
    '.ldB{animation:ldB 36s steps(12) ' + at + ' infinite}',
    '@keyframes ldB{0%{transform:none}50%,100%{transform:translateX(-12px)}}',
    '.lw{animation:lw 4s steps(1) ' + at + ' infinite}',
    '@keyframes lw{0%{transform:none}12.5%{transform:translateX(1px)}25%,37.5%{transform:translateX(2px)}50%{transform:translateX(1px)}62.5%{transform:none}75%,87.5%{transform:translateX(-1px)}}',
    // Birds: the flock crosses a cell every 0.15 s, then the sky rests; each bird bobs.
    M.bird ? '.bf{animation:bf 90s steps(360) ' + at + ' infinite}@keyframes bf{0%{transform:none}60%,100%{transform:translateX(360px)}}' : '',
    M.bird ? '.bb{animation:bb 3s steps(1) ' + at + ' infinite}@keyframes bb{0%{transform:none}50%{transform:translateY(1px)}}' : '',
    // The cart: a cell every 0.3 s along the road and over the bridge, then a long rest.
    '.cx{animation:cx ' + C.cycle + 's steps(' + C.travel + ') ' + at + ' infinite}',
    '@keyframes cx{0%{transform:none}' + Math.round(((C.travel * C.step) / C.cycle) * 1e6) / 1e4 + '%,100%{transform:translateX(-' + C.travel + 'px)}}',
    '.cy{animation:cy ' + C.cycle + 's steps(1) ' + at + ' infinite}',
    '@keyframes cy{' + cartFrames + '}',
    // The cat's tail flicks now and then.
    '.ta{animation:ta 7s steps(1) ' + at + ' infinite}',
    '@keyframes ta{0%{opacity:1}70%{opacity:0}85%{opacity:1}}',
    '.tb{animation:tb 7s steps(1) ' + at + ' infinite}',
    '@keyframes tb{0%{opacity:0}70%{opacity:1}85%{opacity:0}}',
    // Reduced motion rests the scene on its still picture.
    '@media (prefers-reduced-motion:reduce){:root *{animation:none!important}}',
  ]
}

// ---------------------------------------------------------------- write

const LIMIT = 131072
fs.mkdirSync(path.join(HERE, 'out'), { recursive: true })
const only = process.argv.slice(2)
for (const name of only.length ? only : Object.keys(MOMENTS)) {
  const { svg, stats, css, light } = scene(name)
  const scrubbed = scrubbedLength(svg)
  fs.writeFileSync(path.join(HERE, 'out', 'hill-village-' + name + '.svg'), svg)
  // for the light check (debug.py): where the key light sits, and which way a pole's shadow runs
  fs.mkdirSync(path.join(HERE, 'out', 'debug'), { recursive: true })
  fs.writeFileSync(path.join(HERE, 'out', 'debug', name + '-light.json'), JSON.stringify(light))
  console.log(name.padEnd(8), svg.length, 'chars (scrubbed ~' + scrubbed + '), css', css, '| patterns', stats.patterns, '| runs', stats.runs, '| bands', stats.bands, svg.length > LIMIT || scrubbed > LIMIT ? 'TOO BIG' : '')
  if (process.env.STATS) {
    const top = [...stats.byLayer].sort((a, b) => b[1] - a[1]).slice(0, 30)
    console.log('  ' + top.map(([n, r]) => n.slice(0, 40) + ':' + r).join('  '))
    console.log('  pattern chars: ' + [...stats.chars].sort((a, b) => b[1] - a[1]).map(([n, c]) => n.slice(0, 30) + ':' + c).join('  '))
  }
}
