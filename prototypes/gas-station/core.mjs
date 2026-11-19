// The renderer under Gas Station (Side Street's core.mjs with this scene's camera): a depth
// buffer of fragments on the 320 x 200 cell grid, and the shapes the scene is built from
// (polygons, boxes, cylinders, sphere clusters, wires, a height field), plus the shadow test.
// Lighting is done later, in build.mjs.
import { hex, lerp, rgb, smooth } from '../../../sunfield/tools/pixel.mjs'

export const W = 320
export const H = 200
export const N = W * H

// ---------------------------------------------------------------- camera and world
// Eye at the origin, X right, Y down, Z ahead, looking straight ahead (one-point perspective).
// The ground is flat at Y = E; the highway runs along X.
const HX = 160
const HY = 126
const F = 230
const E = 1.8 // eye height over the ground

const proj = P => [HX + (F * P[0]) / P[2], HY + (F * P[1]) / P[2]]
const ray = (x, y) => [(x + 0.5 - HX) / F, (y + 0.5 - HY) / F, 1]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = a => mul(a, 1 / Math.hypot(a[0], a[1], a[2]))
// World X at screen column x (a cell edge) for depth Z, and Y at row y: to place a face so its
// edges fall on cell edges.
const xAt = (x, Z) => ((x - HX) * Z) / F
const yAt = (y, Z) => ((y - HY) * Z) / F

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
const C = h => rgb(h).map(v => v / 255) // '#rrggbb' -> [0..1]
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
const mixHex = (a, b, t) => hex(mixc(rgb(a), rgb(b), t))
function ramp(stops, t) {
  if (t <= stops[0][0]) return C(stops[0][1])
  for (let i = 0; i < stops.length - 1; i++) {
    const [ta, ca] = stops[i]
    const [tb, cb] = stops[i + 1]
    if (t <= tb) return mixc(C(ca), C(cb), (t - ta) / (tb - ta))
  }
  return C(stops[stops.length - 1][1])
}
const lum = c => 0.3 * c[0] + 0.55 * c[1] + 0.15 * c[2]

// ---------------------------------------------------------------- the renderer
// A cell's fragment: a albedo, n normal, p world point, k material key (cells of one key share
// a small palette), e emitted light, o object id (for rim light), plus flags.
export let gz
export let gf
let objId = 0
const newId = () => ++objId

function put(x, y, z, f) {
  if (x < 0 || y < 0 || x >= W || y >= H) return false
  const i = y * W + x
  if (z >= gz[i]) return false
  gz[i] = z
  gf[i] = f
  return true
}

function inside(sp, px, py) {
  let c = false
  for (let i = 0, j = sp.length - 1; i < sp.length; j = i++) {
    const [xi, yi] = sp[i]
    const [xj, yj] = sp[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

// A flat polygon in the world (all its points ahead of the eye), each covered cell given by
// mat(P, x, y, n) -> fragment or null.
function poly(pts, mat, o = {}) {
  let n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])))
  if (dot(n, pts[0]) > 0) n = mul(n, -1)
  const d = dot(n, pts[0])
  if (d > -1e-6) return
  const sp = pts.map(proj)
  const x0 = Math.max(0, Math.floor(Math.min(...sp.map(p => p[0]))))
  const x1 = Math.min(W - 1, Math.ceil(Math.max(...sp.map(p => p[0]))))
  const y0 = Math.max(0, Math.floor(Math.min(...sp.map(p => p[1]))))
  const y1 = Math.min(H - 1, Math.ceil(Math.max(...sp.map(p => p[1]))))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(sp, x + 0.5, y + 0.5)) continue
      const r = ray(x, y)
      const t = d / dot(n, r)
      if (!(t > 0.05)) continue
      const P = mul(r, t)
      const f = mat(P, x, y, n)
      if (f) put(x, y, P[2] - (o.bias ?? 0), { n, ...f, p: P, o: f.o ?? o.id })
    }
  }
}

// An axis-aligned box from (x0, y0, z0) to (x1, y1, z1) (y0 is its top). mats: { px, nx, top,
// bottom, front, back } or { all }, each mat(P, x, y, n, face).
function box(x0, x1, y0, y1, z0, z1, mats, o = {}) {
  const id = o.id ?? newId()
  const m = f => mats[f] ?? mats.all
  const faces = []
  if (x0 > 0 && m('nx')) faces.push(['nx', [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]])
  if (x1 < 0 && m('px')) faces.push(['px', [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]]])
  if (y0 > 0 && m('top')) faces.push(['top', [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]])
  if (y1 < 0 && m('bottom')) faces.push(['bottom', [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]])
  if (z0 > 0 && m('front')) faces.push(['front', [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]]])
  for (const [f, pts] of faces) poly(pts, (P, x, y, n) => m(f)(P, x, y, n, f), { id, bias: o.bias })
  if (o.cast !== false) casters.push({ t: 'box', b: [x0, x1, y0, y1, z0, z1] })
  return id
}

// A vertical cylinder (a pole): centre (X, Z), radius r, from Y y0 (top) to y1.
function cylinder(X, Z, r, y0, y1, mat, o = {}) {
  const id = o.id ?? newId()
  const [cx] = proj([X, 0, Z])
  const hw = (F * r) / Z
  const top = proj([X, y0, Z])[1]
  const bot = proj([X, y1, Z])[1]
  const toEye = norm([-X, 0, -Z])
  const side = [toEye[2], 0, -toEye[0]]
  for (let y = Math.max(0, Math.floor(top)); y <= Math.min(H - 1, Math.ceil(bot) - 1); y++) {
    for (let x = Math.floor(cx - hw); x < Math.ceil(cx + hw); x++) {
      const u = (x + 0.5 - cx) / hw
      if (Math.abs(u) > 1) continue
      const s = Math.sqrt(1 - u * u)
      const n = norm(add(mul(side, -u), mul(toEye, s)))
      const Pz = Z - r * s * 0.9
      const P = [X + n[0] * r, ((y + 0.5 - HY) * Pz) / F, Z + n[2] * r]
      if (P[1] < y0 || P[1] > y1) continue
      const f = mat(P, x, y, n, u)
      if (f) put(x, y, Pz, { n, ...f, p: P, o: id })
    }
  }
  const cr = o.castR ?? r // a thin pole may throw a wider shadow so that it reads
  if (o.cast !== false) casters.push({ t: 'box', b: [X - cr, X + cr, y0, y1, Z - cr, Z + cr] })
  return id
}

// A cluster of spheres (shrubs, a mound): each blob lit as a sphere, its normal stirred by a
// leafy noise. mat(P, x, y, n, blob) -> fragment.
function blobs(list, mat, o = {}) {
  const id = o.id ?? newId()
  for (const b of list) {
    const [cx, cy] = proj(b.c)
    const rr = (F * b.r) / b.c[2]
    for (let y = Math.floor(cy - rr); y <= Math.ceil(cy + rr); y++) {
      for (let x = Math.floor(cx - rr); x <= Math.ceil(cx + rr); x++) {
        const dx = (x + 0.5 - cx) / rr
        const dy = (y + 0.5 - cy) / rr / (b.sy ?? 1)
        const d2 = dx * dx + dy * dy
        const edge = (o.rough ?? 0.25) * (noise(x * 0.5, y * 0.5, b.seed ?? 7) - 0.5)
        if (d2 > 1 + edge) continue
        if (o.flatBase && b.c[1] + dy * b.r * (b.sy ?? 1) > o.flatBase) continue
        const s = Math.sqrt(Math.max(0, 1 - d2))
        const n = norm([dx, dy, -s - 0.15])
        const P = [b.c[0] + dx * b.r, b.c[1] + dy * b.r, b.c[2] - s * b.r]
        const f = mat(P, x, y, n, b)
        if (f) put(x, y, P[2], { n, ...f, p: P, o: id })
      }
    }
    if (o.cast !== false) casters.push({ t: 'sph', c: b.c, r: b.r * (o.castR ?? 0.85), holes: o.holes ?? 0 })
  }
  return id
}

// A thin line in the world (a wire, a hose), one cell wide, from a sampled curve.
function wire(pts, mat, o = {}) {
  const id = o.id ?? newId()
  let last = null
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const pa = proj(a)
    const pb = proj(b)
    const steps = Math.max(1, Math.ceil(Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) * 2))
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const P = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
      const [px, py] = proj(P)
      const x = Math.floor(px)
      const y = Math.floor(py)
      const k = x + ',' + y
      if (k === last) continue
      last = k
      const f = mat(P, x, y)
      if (f) put(x, y, P[2] - (o.bias ?? 0.02), { n: o.n ?? [0, -0.7, -0.7], ...f, p: P, o: id })
    }
  }
  return id
}

// A sagging span between two points: a parabola, `sag` metres down at the middle.
function span(a, b, sag, n = 24) {
  const out = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t) + sag * 4 * t * (1 - t), lerp(a[2], b[2], t)])
  }
  return out
}

// A height field: fn(X, Z) gives the ground's Y (down) or NaN for none. Each cell's ray is
// marched from tmin out to whatever already stands nearer, then refined.
function terrain(fn, mat, o = {}) {
  const id = o.id ?? newId()
  const tmin = o.tmin ?? 3
  const tmax = o.tmax ?? 6000
  for (let y = o.y0 ?? 0; y < (o.y1 ?? H); y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const r = ray(x, y)
      const end = Math.min(tmax, gz[i])
      let t = tmin
      let hit = false
      let prev = t
      while (t < end) {
        const g = fn(r[0] * t, t)
        if (g === g && r[1] * t >= g) {
          hit = true
          break
        }
        prev = t
        t += Math.max(0.04, t * (o.step ?? 0.004))
      }
      if (!hit) continue
      let a = prev
      let b = t
      for (let k = 0; k < 12; k++) {
        const m = (a + b) / 2
        const g = fn(r[0] * m, m)
        if (g === g && r[1] * m >= g) b = m
        else a = m
      }
      const P = mul(r, b)
      const e = o.e ?? 0.05
      const gx = (fn(P[0] + e, P[2]) - fn(P[0] - e, P[2])) / (2 * e)
      const gzz = (fn(P[0], P[2] + e) - fn(P[0], P[2] - e)) / (2 * e)
      const n = norm([gx || 0, -1, gzz || 0])
      const f = mat(P, x, y, n)
      if (f) put(x, y, P[2] + (o.bias ?? 0), { n, ...f, p: P, o: f.o ?? id })
    }
  }
}

// ---------------------------------------------------------------- shadows
export let casters
function slab(o, d, b, maxT = 1e9) {
  let t0 = 1e-3
  let t1 = maxT
  for (let k = 0; k < 3; k++) {
    const lo = b[k * 2]
    const hi = b[k * 2 + 1]
    if (Math.abs(d[k]) < 1e-9) {
      if (o[k] < lo || o[k] > hi) return false
      continue
    }
    let a = (lo - o[k]) / d[k]
    let c = (hi - o[k]) / d[k]
    if (a > c) [a, c] = [c, a]
    if (a > t0) t0 = a
    if (c < t1) t1 = c
    if (t0 > t1) return false
  }
  return true
}
// A flat convex caster: its points in order round the edge.
function quadCaster(pts) {
  const n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])))
  return { t: 'quad', pts, n, d: dot(n, pts[0]) }
}
function hitQuad(c, o, dir, maxT = 1e9) {
  const nd = dot(c.n, dir)
  if (Math.abs(nd) < 1e-9) return false
  const t = (c.d - dot(c.n, o)) / nd
  if (!(t > 0.02) || t > maxT) return false
  const q = add(o, mul(dir, t))
  const p = c.pts
  let sign = 0
  for (let i = 0; i < p.length; i++) {
    const a = p[i]
    const b = p[(i + 1) % p.length]
    const s = dot(cross(sub(b, a), sub(q, a)), c.n)
    if (Math.abs(s) < 1e-12) continue
    if (sign === 0) sign = Math.sign(s)
    else if (Math.sign(s) !== sign) return false
  }
  return true
}
// Whether anything stands between P and the light along dir (to infinity, or within maxT for a
// lamp).
function shadowed(P, dir, maxT = 1e9) {
  const o = add(P, mul(dir, 0.04))
  for (const c of casters) {
    if (c.t === 'box') {
      if (slab(o, dir, c.b, maxT)) return true
    } else if (c.t === 'quad') {
      if (hitQuad(c, o, dir, maxT)) return true
    } else {
      const oc = sub(o, c.c)
      const bq = dot(oc, dir)
      const cq = dot(oc, oc) - c.r * c.r
      const disc = bq * bq - cq
      if (disc > 0 && -bq - Math.sqrt(disc) > 0.02 && -bq - Math.sqrt(disc) < maxT) {
        if (!c.holes) return true
        const t = -bq
        const q = add(o, mul(dir, t))
        if (noise(q[0] * 2.2, q[1] * 2.2 + q[2] * 1.3, 31) > c.holes) return true
      }
    }
  }
  return false
}

// ---------------------------------------------------------------- materials
// A fragment for a colour, with its palette key.
const mat = (hexc, k, extra) => ({ a: C(hexc), k, ...extra })
const solid = (hexc, k, extra) => () => mat(hexc, k, extra)

export function begin() {
  gz = new Float64Array(N).fill(Infinity)
  gf = new Array(N).fill(null)
  casters = []
  objId = 0
}

export { HX, HY, F, E, proj, ray, add, sub, mul, dot, cross, norm, xAt, yAt, hash, noise, C, mixc, mixHex, ramp, lum }
export { put, poly, box, cylinder, blobs, wire, span, newId, mat, solid, shadowed, inside, terrain, quadCaster }
