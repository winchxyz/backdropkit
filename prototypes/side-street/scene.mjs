// What stands in Side Street, in metres (eye at the origin, X right, Y down, Z ahead). The lane
// runs straight down a hillside that falls away to the left: on the left a stone parapet over
// the roofs of the lower town and the bay; on the right an open lot and a corner shop with its
// gable to us; ahead the level crossing, a torii and the shrine knoll, the lower town running
// down to the harbour, a headland, a far range and an island.
import { Layer, clamp, hex, lerp, rgb, rng } from '../../../sunfield/tools/pixel.mjs'
import * as core from './core.mjs'
import {
  C, E, F, H, HX, HY, W, XR, YC, YSEA, ZC, ZT, ZX,
  blobs, box, cylinder, hash, mat, newId, noise, norm, poly, proj, solid, span, streetY, terrain, wire,
} from './core.mjs'

let M
const cellAt = Z => Z / F // metres per cell at depth Z
const hexOf = c => hex(c.map(v => v * 255))
function rampC(stops, t) {
  if (t <= stops[0][0]) return C(stops[0][1])
  for (let i = 0; i < stops.length - 1; i++) {
    const [ta, ca] = stops[i]
    const [tb, cb] = stops[i + 1]
    if (t <= tb) {
      const a = C(ca)
      const b = C(cb)
      const k = (t - ta) / (tb - ta)
      return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]
    }
  }
  return C(stops[stops.length - 1][1])
}
function shade(h, k) {
  const c = C(h).map(v => clamp(v * k, 0, 1))
  return '#' + c.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
}
const thin = (Z, m) => Math.max(m, cellAt(Z) * 0.9) // a line at least about a cell wide

// ---------------------------------------------------------------- materials

// A window of w x h metres: an aluminium frame, two sliding panes, glass that shows the sky by
// day and a warm room when lit. Returns a fragment for local (u, v) inside it.
function windowCell(u, v, w, h, P, seed, o = {}) {
  const th = thin(P[2], 0.05)
  const frame = o.frame ?? '#c9c7c0'
  if (u < th || u > w - th || v < th || v > h - th) return mat(frame, 'frame')
  if (!o.single && Math.abs(u - w / 2) < th * 0.5 + 0.01) return mat(frame, 'frame')
  if (o.bars && (u / 0.11) % 1 < Math.max(0.25, cellAt(P[2]) / 0.11)) return mat(o.barC ?? '#b9bcbc', 'frame')
  if (o.lit ?? isLit(seed)) {
    const c = M.room[Math.floor(hash(seed, 3, 5) * M.room.length)]
    // A curtain half drawn on some, its folds a shade darker.
    if (hash(seed, 4, 5) < 0.5 && u > w * 0.62 && Math.floor((u - w * 0.62) / Math.max(0.12, cellAt(P[2]))) % 2) return mat('#000000', 'glow', { e: C(c).map(v => v * 0.8), flat: true })
    return mat('#000000', 'glow', { e: C(c), flat: true })
  }
  if (o.frost) return { a: [0.1, 0.1, 0.1], k: 'glass', e: M.glassSky.map(c => c * 0.9 + 0.08), glass: true }
  // Unlit glass: the sky seen in it, brighter toward the top, a pale streak across, a curtain
  // inside on some.
  const t = v / h
  if (o.curtain && u < w * 0.3) return mat(o.curtain, 'curtain')
  const streak = Math.abs(u - t * w * 0.7 - w * 0.12) < Math.max(0.08, cellAt(P[2]) * 0.7)
  return { a: [0.08, 0.1, 0.13], k: 'glass', e: M.glassSky.map(c => c * (0.45 + 0.55 * t) * (streak ? 1.35 : 1)), glass: true }
}
function isLit(seed) {
  return M.litP > 0 && hash(seed, 11, 17) < M.litP
}

// Kawara: rows of round tiles running down the slope (s down from the ridge, u along it), a
// heavy ridge, a lighter eave line.
function tileCell(s, u, P, base, k, o = {}) {
  const cs = cellAt(P[2])
  const ridge = o.ridgeW ?? 0.22
  if (o.ridge !== false && s < Math.max(ridge, cs * 1.2)) return mat(o.ridgeC ?? shade(base, 0.7), k)
  if (o.eave && s > o.eave - Math.max(0.14, cs)) return mat(shade(base, 1.3), k)
  const pitch = o.pitch ?? 0.3
  if (cs < pitch * 0.6) {
    const q = (u / pitch) % 1
    if (q < Math.max(0.18, cs / pitch)) return mat(shade(base, o.rowDark ?? 0.68), k)
  }
  if (o.course && cs < o.course * 0.5 && (s % o.course) < cs) return mat(shade(base, 0.82), k)
  return mat(base, k)
}
// Corrugated tin, rusting at the eaves.
function tinCell(s, u, P, base, k, run) {
  const cs = cellAt(P[2])
  const q = (u / 0.2) % 1
  const rust = noise(u * 1.3, s * 2.2, 41) + (run ? (s / run) * 0.35 : 0)
  const c = rust > 0.85 ? '#8a4a2c' : rust > 0.72 ? shade(base, 0.85) : base
  if (cs < 0.12 && q < 0.35) return mat(shade(c, 0.78), k)
  return mat(c, k)
}

// ---------------------------------------------------------------- houses

// A house: walls from floor level yf up h metres over the footprint, sunk to `base`, with a
// gable roof (ridge along 'z' or 'x') or a flat one. o.wall(P, face, u, v) paints the walls,
// o.roof(P, s, u, n, side, run) the roof.
function house(o) {
  const { x0, x1, z0, z1, yf, h } = o
  const ye = yf - h
  const id = newId()
  const wallFace = face => P => {
    const u = face === 'front' ? P[0] - x0 : face === 'nx' ? P[2] - z0 : face === 'px' ? z1 - P[2] : P[0] - x0
    return o.wall(P, face, u, yf - P[1])
  }
  box(x0, x1, ye, o.base ?? yf + 0.4, z0, z1, { nx: wallFace('nx'), px: wallFace('px'), front: wallFace('front'), top: o.flat ? P => o.roof(P, 0, 0) : null }, { id, cast: o.cast })
  if (o.flat) return id
  const ov = o.ov ?? 0.45
  const roofC = o.roof
  if (o.ridge === 'z') {
    const xm = (x0 + x1) / 2
    const rise = o.rise ?? (x1 - x0) * 0.22
    const yr = ye - rise
    const k = rise / ((x1 - x0) / 2)
    const ya = ye + ov * k
    const runL = Math.hypot(xm - x0 + ov, rise + ov * k)
    const qL = [[x0 - ov, ya, z0 - ov], [xm, yr, z0 - ov], [xm, yr, z1 + ov], [x0 - ov, ya, z1 + ov]]
    const qR = [[xm, yr, z0 - ov], [x1 + ov, ya, z0 - ov], [x1 + ov, ya, z1 + ov], [xm, yr, z1 + ov]]
    poly(qL, (P, x, y, n) => roofC(P, ((xm - P[0]) / (xm - x0 + ov)) * runL, P[2] - z0, n, 'l', runL), { id })
    poly(qR, (P, x, y, n) => roofC(P, ((P[0] - xm) / (x1 - xm + ov)) * runL, P[2] - z0, n, 'r', runL), { id })
    if (z0 > 0) poly([[x0, ye, z0], [xm, yr, z0], [x1, ye, z0]], P => (o.gable ?? o.wall)(P, 'gable', P[0] - x0, yf - P[1]), { id })
    // The roof planes cast as they are, eaves and all, so the eaves shade the walls.
    if (o.cast !== false) core.casters.push(core.quadCaster(qL), core.quadCaster(qR))
  } else {
    const zm = (z0 + z1) / 2
    const rise = o.rise ?? (z1 - z0) * 0.22
    const yr = ye - rise
    const k = rise / ((z1 - z0) / 2)
    const ya = ye + ov * k
    const run = Math.hypot(zm - z0 + ov, rise + ov * k)
    const qF = [[x0 - ov, ya, z0 - ov], [x1 + ov, ya, z0 - ov], [x1 + ov, yr, zm], [x0 - ov, yr, zm]]
    const qB = [[x0 - ov, yr, zm], [x1 + ov, yr, zm], [x1 + ov, ya, z1 + ov], [x0 - ov, ya, z1 + ov]]
    poly(qF, (P, x, y, n) => roofC(P, ((zm - P[2]) / (zm - z0 + ov)) * run, P[0] - x0, n, 'f', run), { id })
    poly(qB, (P, x, y, n) => roofC(P, ((P[2] - zm) / (z1 - zm + ov)) * run, P[0] - x0, n, 'b', run), { id })
    if (x0 > 0) poly([[x0, ye, z0], [x0, yr, zm], [x0, ye, z1]], P => (o.gable ?? o.wall)(P, 'gable', P[2] - z0, yf - P[1]), { id })
    if (x1 < 0) poly([[x1, ye, z0], [x1, yr, zm], [x1, ye, z1]], P => (o.gable ?? o.wall)(P, 'gable', z1 - P[2], yf - P[1]), { id })
    if (o.cast !== false) core.casters.push(core.quadCaster(qF), core.quadCaster(qB))
  }
  return id
}

// ---------------------------------------------------------------- the ground

const DROP = 2.6 // the parapet holds the lane this far above the gardens below it
// Sun-bleached asphalt: a warm light grey that the day sun turns peach and the sky's light blue.
const ROAD_A = '#bca9a4'
const ROAD_B = '#b2a09b'
const ROAD_DARK = '#8c7c78'
// The hillside the town stands on: the lane's own level, falling away to the left of the
// parapet; beyond the crossing it keeps going down to the shore, with the shrine's knoll on the
// right; across the bay a headland, a far range behind it, and an island out on the sea.
export function groundY(X, Z) {
  const s = streetY(Math.max(Z, 2))
  let y = s
  if (X < -3.0) y = s + DROP + 0.3 * (-3.0 - X)
  else if (Z < ZX && X > 12) y = s - 0.25 * (X - 12)
  if (Z > ZX && X > -3) y -= 7 * Math.exp(-(((X - 15) / 12) ** 2) - (((Z - 60) / 14) ** 2))
  // Bumps scaled by each hill's own height, so the open sea stays flat.
  const bh = Math.exp(-(((X + 480) / 230) ** 2) - (((Z - 1100) / 320) ** 2))
  const hd = YSEA + 1 - bh * (160 + 30 * (noise(X * 0.012, Z * 0.012, 3) - 0.5))
  const bf = Math.exp(-(((X + 1500) / 900) ** 2) - (((Z - 2600) / 500) ** 2))
  const fr = YSEA + 1 - bf * (300 + 120 * (noise(X * 0.003, Z * 0.003, 5) - 0.5))
  const bi = Math.exp(-(((X + 40) / 130) ** 2) - (((Z - 2700) / 200) ** 2))
  const is = YSEA + 1 - bi * 95
  return Math.min(y, YSEA + 2, hd, fr, is)
}

// Thin things (wires, a bicycle) are too fine for the caster boxes: each point of one is carried
// along the light down onto the ground, and the points are joined cell to cell on screen. The
// lit ground under those cells loses k of its sun (build.mjs, shadeFrag).
function lineShadow(pts, k) {
  if (!M.lineShadows || !M.sun || M.sun.d[1] > -0.2) return
  const L = M.sun.d.map(v => -v)
  M.lineShade ??= new Map()
  const mark = (x, y, z) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const i = y * W + x
    const was = M.lineShade.get(i)
    if (!was || was.k < k) M.lineShade.set(i, { k, z })
  }
  let last = null
  for (const Q of pts) {
    let S = Q
    for (let it = 0; it < 8; it++) {
      const t = (groundY(S[0], S[2]) - Q[1]) / L[1]
      S = [Q[0] + L[0] * t, Q[1] + L[1] * t, Q[2] + L[2] * t]
    }
    if (S[2] < 1.5) {
      last = null
      continue
    }
    const [px, py] = proj(S)
    if (last) {
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(px - last[0]), Math.abs(py - last[1]))))
      for (let s = 1; s <= n; s++) {
        const t = s / n
        mark(Math.floor(lerp(last[0], px, t)), Math.floor(lerp(last[1], py, t)), lerp(last[2], S[2], t))
      }
    } else mark(Math.floor(px), Math.floor(py), S[2])
    last = [px, py, S[2]]
  }
}

// ---------------------------------------------------------------- the scene

export function paintScene(moment) {
  M = moment
  M.lineShade = null
  const Z0 = 3.4
  const sY = streetY

  // ------------------------------------------------ the lane
  const asphalt = P => {
    const X = P[0]
    const Z = P[2]
    const cs = cellAt(Z)
    // The green walkway strip down the left side, edged by a white line.
    if (X < -1.62 && X > -1.62 - thin(Z, 0.12)) return mat('#f4efe2', 'line')
    if (X < -1.62) return mat(noise(X * 3, Z * 1.5, 14) > 0.75 ? '#3f9c6c' : '#48aa78', 'walk')
    if (Math.abs(X - 2.12) < thin(Z, 0.07) * 0.6 && noise(Z * 2, 1, 9) > 0.15) return mat('#f4efe2', 'line')
    // The stop line before the crossing.
    if (Z > 25.9 && Z < 26.35 && X > -1.62 && X < 0.1) return mat('#f4efe2', 'line')
    // A manhole, its cast pattern of rings.
    const mh = Math.hypot((X - 0.75) / 0.34, (Z - 14.2) / 0.34)
    if (mh < 1) return mat(mh > 0.82 ? '#4a4440' : Math.floor(mh * 4) % 2 ? '#5f5852' : '#7a7068', 'iron')
    // Cracks sealed with tar: thin dark lines wandering across.
    if (cs < 0.045 && Math.abs(noise(X * 0.7, Z * 0.5, 23) - 0.5) < 0.004 + cs * 0.08) return mat(ROAD_DARK, 'road', { spec: 0.3 })
    // Patches where the asphalt was mended.
    for (const [a, b, c, d] of [[-1.2, 0.6, 7.2, 9.4], [0.3, 2.4, 17.5, 21.2], [-1.6, -0.2, 22, 23.4]]) if (X > a && X < b && Z > c && Z < d) return mat('#a89894', 'patch', { spec: 0.6 })
    return mat(noise(X * 4, Z * 4, 7) > 0.62 ? ROAD_B : ROAD_A, 'road', { spec: 1 })
  }
  poly([[-2.4, sY(Z0), Z0], [2.4, sY(Z0), Z0], [2.4, YC, ZC], [-2.4, YC, ZC]], asphalt)
  // Gutters: concrete covers either side, an iron grating every few.
  const gutter = P => {
    const j = P[2] / 0.5
    if (j % 1 < Math.max(0.08, cellAt(P[2]) / 0.5)) return mat('#968c7e', 'gutter')
    if (Math.floor(j) % 6 === 2) return mat(Math.floor(P[0] * 14) % 2 ? '#57504a' : '#7a7066', 'iron')
    return mat(noise(P[0] * 6, P[2] * 3, 4) > 0.7 ? '#ada290' : '#b6ab98', 'gutter')
  }
  for (const [a, b] of [[-2.75, -2.4], [2.4, 2.75]]) poly([[a, sY(Z0), Z0], [b, sY(Z0), Z0], [b, YC, ZC], [a, YC, ZC]], gutter)

  // ------------------------------------------------ the crossing and the tracks
  const railZ = [ZT - 0.535, ZT + 0.535]
  const BZ0 = 29.1
  const BZ1 = ZT + 1.9
  const bed = P => {
    const X = P[0]
    const Z = P[2]
    const cs = cellAt(Z)
    if (railZ.some(r => Math.abs(Z - r) < Math.max(0.05, cs * 0.5))) return mat('#eeeae2', 'rail', { spec: 1 })
    if (Math.abs(X) < 2.75) {
      if (Z > ZT - 1.5 && Z < ZT + 1.5) {
        // Crossing panels: concrete slabs with a dark rubber flange by each rail.
        if (railZ.some(r => Math.abs(Z - r) < Math.max(0.12, cs * 1.2))) return mat('#4a4441', 'flange')
        return mat(Math.floor((X + 2.75) / 1.1) % 2 ? '#bdb4a6' : '#c8bfb1', 'panel')
      }
      // Yellow and black edges where the lane meets the panels.
      if (Math.abs(Math.abs(X) - 2.55) < 0.17) return mat(Math.floor(Z * 3) % 2 ? '#f2c21e' : '#2d2c2b', 'stripe')
      return mat(ROAD_A, 'road', { spec: 1 })
    }
    if (Z < BZ0) {
      // The path along the tracks, behind its rail.
      return mat(noise(X * 2, Z * 2, 33) > 0.7 ? '#a99c88' : '#b6a995', 'path')
    }
    if (Z > ZT - 1.25 && Z < ZT + 1.25 && Math.floor(X / 0.6) % 2 === 0) return mat('#6e5640', 'sleeper')
    return mat(hash(Math.floor(X * 6), Math.floor(Z * 6), 4) > 0.5 ? '#9d917c' : '#b0a38c', 'ballast')
  }
  // The lane over the crossing, the path along the tracks, the track bed either side.
  poly([[-2.75, YC, ZC], [2.75, YC, ZC], [2.75, YC, ZX], [-2.75, YC, ZX]], bed)
  poly([[-400, YC, 27.2], [-2.75, YC, 27.2], [-2.75, YC, BZ1], [-400, YC, BZ1]], bed)
  poly([[2.75, YC, 27.3], [400, YC, 27.3], [400, YC, BZ1], [2.75, YC, BZ1]], bed)
  // A path along the far side of the tracks too, where the cyclist rides.
  const farPath = P => mat(noise(P[0] * 2, P[2] * 2, 34) > 0.7 ? '#a29684' : '#aea290', 'path')
  poly([[-400, YC, BZ1], [-2.75, YC, BZ1], [-2.75, YC, 34.6], [-400, YC, 34.6]], farPath)
  poly([[2.75, YC, BZ1], [400, YC, BZ1], [400, YC, 34.6], [2.75, YC, 34.6]], farPath)
  // On the downhill side the path and track run on a stone embankment.
  poly([[-400, YC, 27.2], [-3.0, YC, 27.2], [-3.0, YC + 40, 27.2], [-400, YC + 40, 27.2]], P => {
    const v = P[1] - YC
    const cs = cellAt(P[2])
    if (v < Math.max(0.16, cs)) return mat('#ddd5c3', 'kerb')
    const row = Math.floor(v / 0.45)
    const u = P[0] / 0.9 + (row % 2) * 0.5
    if ((v / 0.45) % 1 < Math.max(0.12, cs / 0.45) || u % 1 < Math.max(0.08, cs / 0.9)) return mat('#8c8370', 'embank')
    if (noise(P[0] * 0.5, v * 0.8, 61) > 0.72) return mat('#6c9a46', 'moss')
    return mat(hash(Math.floor(u), row, 6) > 0.5 ? '#b8ad97' : '#aca18b', 'embank')
  })
  // A pipe rail along the path's edge, and a low fence between the path and the ballast.
  {
    const railMat = () => mat('#f2f0ea', 'prail')
    for (const y of [0.55, 1.0]) wire([[-60, YC - y, 27.28], [-3.0, YC - y, 27.28]], railMat, { bias: 0.05 })
    for (let X = -3.1; X > -60; X -= 2) wire([[X, YC, 27.28], [X, YC - 1.0, 27.28]], railMat, { bias: 0.05 })
    const fence = () => mat('#6f9a8e', 'fence')
    for (const y of [0.35, 0.8]) wire([[-60, YC - y, 28.95], [-3.1, YC - y, 28.95]], fence)
    for (const y of [0.35, 0.8]) wire([[3.1, YC - y, 28.95], [40, YC - y, 28.95]], fence)
    for (let X = -3.4; X > -60; X -= 1.8) box(X - 0.06, X + 0.06, YC - 0.9, YC, 28.9, 29.0, { all: solid('#c3bdb0', 'fence') }, { cast: false })
  }
  // Catenary: masts with arms on the far side of the track, and the two wires along it.
  {
    const mastMat = () => mat('#8e9497', 'mast')
    for (const X of [-14, -38, 12]) {
      cylinder(X, ZT + 1.75, 0.12, YC - 6.4, YC, mastMat)
      box(X - 0.05, X + 0.05, YC - 6.1, YC - 6.0, ZT - 0.4, ZT + 1.75, { all: mastMat }, { cast: false })
    }
    const cw = () => mat('#33353a', 'wire')
    for (const [y, sag] of [[5.1, 0.04], [6.05, 0.35]]) {
      const pts = [[-90, YC - y, ZT], [-38, YC - y, ZT], [-14, YC - y, ZT], [12, YC - y, ZT], [60, YC - y, ZT]]
      for (let i = 0; i < pts.length - 1; i++) wire(span(pts[i], pts[i + 1], sag, 60), cw)
    }
  }
  // Below the crossing the lane goes on down into the lower town.
  poly([[-2.4, YC, ZX], [2.4, YC, ZX], [2.4, sY(110), 110], [-2.4, sY(110), 110]], P => {
    if (Math.abs(P[0] - 2.0) < thin(P[2], 0.06) * 0.6) return mat('#f0ebdf', 'line')
    return mat(ROAD_A, 'road', { spec: 1 })
  })

  // ------------------------------------------------ the left side: a stone parapet over the town
  const PH = 0.68
  const pz1 = 26.6
  const stone = P => {
    const Z = P[2]
    const cs = cellAt(Z)
    const v = sY(Z) - P[1]
    if (v > PH - Math.max(0.09, cs * 1.4)) return mat(v > PH - Math.max(0.04, cs * 0.6) ? '#f3ecdc' : '#ddd4c2', 'cap')
    // Rough-cut blocks in courses that follow the slope, each a little different.
    const row = Math.floor(v / 0.3)
    const u = Z / 0.62 + (row % 2) * 0.5 + hash(row, 3, 9) * 0.3
    const j = u - Math.floor(u)
    if ((v / 0.3) % 1 < Math.max(0.1, cs / 0.3) || j < Math.max(0.05, cs / 0.62)) return mat(noise(Z * 3, v * 4, 19) > 0.5 ? '#6f8a48' : '#968b77', 'joint')
    const h = hash(Math.floor(u), row, 13)
    if (noise(Z * 0.9, v * 3, 17) + (v < 0.22 ? 0.3 : 0) + (v > PH - 0.2 ? 0.12 : 0) > 0.8) return mat(h > 0.5 ? '#7aa64a' : '#679340', 'moss')
    return mat(h > 0.66 ? '#cfc5b0' : h > 0.33 ? '#c2b7a1' : '#d8cfbb', 'stone')
  }
  poly([[-2.75, sY(Z0) + 0.02, Z0], [-2.75, sY(Z0) - PH, Z0], [-2.75, sY(pz1) - PH, pz1], [-2.75, sY(pz1) + 0.02, pz1]], stone)
  poly([[-3.1, sY(Z0) - PH, Z0], [-2.75, sY(Z0) - PH, Z0], [-2.75, sY(pz1) - PH, pz1], [-3.1, sY(pz1) - PH, pz1]], P => mat(noise(P[2] * 2, 1, 51) > 0.8 ? '#e6dece' : '#f3ecdc', 'cap'))
  for (let z = Z0; z < pz1; z += 0.8) core.casters.push({ t: 'box', b: [-3.1, -2.75, sY(z + 0.8) - PH, sY(z) + 0.1, z, z + 0.8] })
  // Out of the frame, behind us on the left, a tall camphor and a house stand up from the
  // gardens below the parapet. Under the day sun they lay a wide shadow across the whole foot
  // of the lane.
  core.casters.push({ t: 'box', b: [-11, -3.2, sY(0) - 11, sY(0) + 6, -9, 0.4] })

  // ------------------------------------------------ below the parapet: the nearest roofs
  const kawara = (base, k, o = {}) => (P, s, u, n, side, run) => tileCell(s, u, P, base, k, { eave: run, ...o })
  const plaster = (wc, seed, o = {}) => (P, f, u, v) => {
    if (o.board && v < 2.4) return mat((u / 0.2) % 1 < Math.max(0.2, cellAt(P[2]) / 0.2) ? shade(o.board, 0.8) : o.board, 'board')
    if (f !== 'gable' && v > 1.0 && v < 2.0 && (u % 3.2) > 0.9 && (u % 3.2) < 2.3) return windowCell((u % 3.2) - 0.9, v - 1.0, 1.4, 1.0, P, seed + Math.floor(u / 3.2) + (f === 'front' ? 50 : 0))
    if (f !== 'gable' && v > 3.6 && v < 4.5 && (u % 3.2) > 1.1 && (u % 3.2) < 2.1) return windowCell((u % 3.2) - 1.1, v - 3.6, 1.0, 0.9, P, seed + 7 + Math.floor(u / 3.2))
    return mat(v < 0.4 ? '#a59c8c' : wc, 'lwall')
  }
  const gY = (X, Z) => groundY(X, Z)
  // A: a blue-glazed roof, the nearest.
  {
    const x0 = -12.5
    const x1 = -4.4
    const yf = gY(-8, 7)
    house({ x0, x1, z0: 3.2, z1: 9.6, yf, h: 4.2, ridge: 'z', rise: 1.5, ov: 0.5, wall: plaster('#f0e6d0', 300), roof: kawara('#3c68b0', 'roofA', { pitch: 0.36, course: 0.3, rowDark: 0.6 }) })
  }
  // B: a brown-glazed roof with a television aerial.
  {
    const yf = gY(-7.5, 13)
    house({ x0: -11, x1: -4.6, z0: 10.4, z1: 15.4, yf, h: 4.6, ridge: 'x', rise: 1.3, ov: 0.45, wall: plaster('#ecdcbc', 320), roof: kawara('#985838', 'roofB', { pitch: 0.36, course: 0.3 }) })
    const yr = yf - 4.6 - 1.3
    const al = () => mat('#d9dcdf', 'aerial')
    wire([[-7.2, yr, 12.9], [-7.2, yr - 2.2, 12.9]], al)
    for (const [y, w] of [[2.1, 0.7], [1.8, 0.55], [1.5, 0.45]]) wire([[-7.2 - w, yr - y, 12.9], [-7.2 + w, yr - y, 12.9]], al)
  }
  // C: corrugated tin, red-brown and rusting, a low lean-to beside it.
  {
    const yf = gY(-7, 18)
    house({ x0: -10.2, x1: -4.5, z0: 16.4, z1: 20.6, yf, h: 4.2, ridge: 'z', rise: 0.8, ov: 0.35, wall: plaster('#e2d2b0', 340, { board: '#9a6a44' }), roof: (P, s, u, n, side, run) => tinCell(s, u, P, '#b8503a', 'tin', run) })
  }
  // D: silver kawara, a bigger house, an air conditioner on its wall.
  {
    const yf = gY(-8, 24)
    house({ x0: -12, x1: -4.8, z0: 21.6, z1: 26.6, yf, h: 5.0, ridge: 'x', rise: 1.4, ov: 0.45, wall: plaster('#f2ebdc', 360), roof: kawara('#7c889a', 'roofD', { course: 0.3 }) })
  }
  // A persimmon tree between B and C, rising over the parapet: a dark trunk, sparse leaves,
  // orange fruit.
  {
    const X = -6.8
    const Z = 16.0
    const g = gY(X, Z)
    const bark = () => mat('#5a4434', 'bark')
    wire([[X, g, Z], [X + 0.2, g - 4.2, Z]], bark)
    wire([[X + 0.2, g - 3.6, Z], [X - 0.9, g - 5.4, Z - 0.2]], bark)
    wire([[X + 0.2, g - 4.0, Z], [X + 1.1, g - 5.6, Z + 0.1]], bark)
    const r = rng(17)
    const list = []
    for (let i = 0; i < 9; i++) list.push({ c: [X + 0.1 + (r() - 0.5) * 2.6, g - 5.4 - r() * 1.4, Z + (r() - 0.5) * 1.2], r: 0.7 + r() * 0.5, seed: 30 + i })
    blobs(list, (P, x, y, n, b) => {
      const q = noise(x * 0.7, y * 0.7, b.seed)
      if (q < 0.3) return null
      if (hash(x, y, 77) < 0.06) return mat('#f5801c', 'fruit')
      return mat(q > 0.62 ? '#79a838' : q > 0.45 ? '#5e902e' : '#477328', 'leaf')
    }, { rough: 0.5, castR: 0.7, holes: 0.55 })
  }

  // ------------------------------------------------ the right side: the lot and the shop
  const lot = P => {
    const X = P[0]
    const Z = P[2]
    const cs = cellAt(Z)
    if (Math.abs(Z - 7.6) < thin(Z, 0.06) * 0.6 && X > 3.6) return mat('#f2eee4', 'line')
    if (Math.abs(X - 3.4) < thin(Z, 0.06) * 0.6 && Z < 10.6) return mat('#f2eee4', 'line')
    // Slab joints, and weeds in them.
    const jx = ((X - 2.75) / 2.2) % 1
    const jz = (Z / 2.2) % 1
    if (jx < Math.max(0.012, cs / 2.2) || jz < Math.max(0.012, cs / 2.2)) return mat(hash(Math.floor(X * 9), Math.floor(Z * 9), 5) > 0.7 ? '#6fa03c' : '#9a8f80', 'lotj')
    return mat(noise(X * 1.2, Z * 1.2, 21) > 0.68 ? '#a49686' : '#ad9f90', 'lot')
  }
  poly([[XR, sY(Z0), Z0], [11, sY(Z0), Z0], [11, sY(12), 12], [XR, sY(12), 12]], lot)
  // The kerb along the lot's edge.
  poly([[2.75, sY(Z0) - 0.1, Z0], [2.75, sY(12) - 0.1, 12], [2.75, sY(12), 12], [2.75, sY(Z0), Z0]], () => mat('#e2dacb', 'kerbR'))

  // The corner shop: two storeys, its gable end to us across the lot.
  const shopY = sY(12)
  const shop = (P, f, u, v) => {
    const cs = cellAt(P[2])
    if (f === 'gable') {
      // Dark boards with battens, and a louvred vent under the apex.
      if (Math.abs(u - 3.875) < 0.42 && v > 6.45 && v < 7.0) return mat(Math.floor(((v - 6.45) / Math.max(0.09, cs))) % 2 ? '#4a3426' : '#c9c0b0', 'vent')
      return mat((v / 0.22) % 1 < Math.max(0.14, cs / 0.22) ? '#9a7556' : '#c09468', 'gableW')
    }
    if (f === 'front') {
      if (v > 2.85 && v < 3.1) return mat('#cdbfa6', 'trim')
      if (v < 2.85) {
        if (v < 0.3) return mat('#b4a993', 'base')
        // A frosted window with a grille under a little hood; an electric meter beside it.
        if (u > 2.95 && u < 4.35 && v > 1.05 && v < 2.0) return windowCell(u - 2.95, v - 1.05, 1.4, 0.95, P, 101, { frame: '#d6d5cf', bars: true, frost: true })
        if (u > 2.85 && u < 4.45 && v >= 2.0 && v < 2.16) return mat('#8a8c8f', 'trim')
        if (u > 2.45 && u < 2.75 && v > 1.45 && v < 1.85) return mat(Math.hypot(u - 2.6, v - 1.68) < 0.08 ? '#f2f0ea' : '#9aa0a5', 'meter')
        // Stucco, stained a little near the ground.
        return mat(v < 0.7 && noise(u * 3, v * 5, 71) > 0.6 ? '#e2cfa8' : '#f1e2c2', 'stucco')
      }
      // Upstairs: a sliding glass door onto the balcony and a small window, on ribbed siding.
      if (u > 0.75 && u < 3.3 && v > 3.15 && v < 5.25) return windowCell(u - 0.75, v - 3.15, 2.55, 2.1, P, 102, { curtain: '#e8a0a0', lit: M.litP > 0.15 })
      if (u > 3.85 && u < 4.6 && v > 4.35 && v < 5.05) return windowCell(u - 3.85, v - 4.35, 0.75, 0.7, P, 103, { single: true })
      if (v > 5.9) return mat('#f6f2e8', 'trim')
      return mat(((v - 3.1) / 0.24) % 1 < Math.max(0.16, cs / 0.24) ? '#dcc08e' : '#ead3a6', 'siding')
    }
    // The street side: the shop front under an awning, a shutter box above it.
    if (v < 0.4) return mat('#b4a993', 'base')
    if (v < 2.75 && u > 0.6 && u < 6.6) {
      if (v > 2.4) return mat(Math.floor(v / 0.07) % 2 ? '#a9a69e' : '#c8c5bd', 'shutter')
      return windowCell(u - 0.6, v - 0.4, 6.0, 2.0, P, 104, { frame: '#c2bfb7', lit: M.windowLight ? true : undefined })
    }
    if (v > 2.85 && v < 3.1) return mat('#cdbfa6', 'trim')
    if (v > 3.7 && v < 4.9 && u > 1.5 && u < 3.0) return windowCell(u - 1.5, v - 3.7, 1.5, 1.2, P, 105)
    if (v > 5.9) return mat('#f6f2e8', 'trim')
    return v > 3.0 ? mat(((v - 3.1) / 0.24) % 1 < Math.max(0.16, cs / 0.24) ? '#dcc08e' : '#ead3a6', 'siding') : mat('#f1e2c2', 'stucco')
  }
  house({ x0: XR, x1: 10.5, z0: 12, z1: 19.6, yf: shopY, h: 6.0, base: sY(19.6) + 0.3, ridge: 'z', rise: 1.6, ov: 0.5, wall: shop, roof: kawara('#5a6c8a', 'roofR') })
  // Drainpipes down the shop's corners, and the air-conditioner pipe in its cover.
  for (const X of [2.86, 10.4]) cylinder(X, 11.94, 0.055, shopY - 6.0, shopY, () => mat('#9c8a72', 'pipe'))
  box(6.95, 7.07, shopY - 2.9, shopY - 0.6, 11.88, 11.98, { all: solid('#f3eee2', 'duct') }, { cast: false })

  // The balcony: a slab and a railing of bars.
  const yb = shopY - 2.95
  box(3.0, 8.4, yb - 0.14, yb, 11.1, 12, { all: solid('#d2cbbc', 'trim') })
  poly([[3.0, yb - 1.05, 11.1], [8.4, yb - 1.05, 11.1], [8.4, yb - 0.14, 11.1], [3.0, yb - 0.14, 11.1]], P => {
    const cs = cellAt(P[2])
    const u = P[0] - 3.0
    const v = yb - 0.14 - P[1]
    if (v > 0.84 || v < 0.08) return mat('#eeece6', 'brail')
    if ((u / 0.2) % 1 < Math.max(0.22, cs / 0.2)) return mat('#e2e0d8', 'brail')
    return null
  })
  // The laundry pole across the balcony on its brackets, and a futon aired over the rail.
  {
    const yp = yb - 1.75
    wire([[3.2, yp, 11.45], [7.3, yp, 11.45]], () => mat('#dadddf', 'lpole'), { bias: 0.02 })
    for (const X of [3.25, 7.25]) wire([[X, yp, 11.45], [X, yp, 11.95]], () => mat('#b8bbbd', 'lpole'))
    const futQ = [[6.15, yb - 1.1, 11.04], [8.2, yb - 1.1, 11.04], [8.2, yb - 0.45, 11.04], [6.15, yb - 0.45, 11.04]]
    core.casters.push(core.quadCaster(futQ))
    poly(futQ, P => {
      const u = P[0] - 6.15
      const v = P[1] - (yb - 1.1)
      if (v < 0.07) return mat('#ece4d2', 'futon')
      if ((Math.floor(u / 0.24) + Math.floor(v / 0.24)) % 2 === 0 && v > 0.12) return mat('#e0604a', 'futon')
      return mat('#f1e7d2', 'futon')
    })
  }
  // The awning over the shop front: striped canvas sloping out over the walk.
  const awn = [[XR - 0.95, shopY - 2.35, 12.4], [XR, shopY - 2.75, 12.4], [XR, shopY - 2.75, 18.6], [XR - 0.95, shopY - 2.35, 18.6]]
  poly(awn, P => mat(Math.floor(P[2] / 0.45) % 2 ? '#f6f0e0' : '#1f9a76', 'awning'))
  core.casters.push(core.quadCaster(awn))
  poly([[XR - 0.95, shopY - 2.35, 12.4], [XR - 0.95, shopY - 2.15, 12.4], [XR - 0.95, shopY - 2.15, 18.6], [XR - 0.95, shopY - 2.35, 18.6]], P => mat(Math.floor(P[2] / 0.45) % 2 ? '#e8e0cc' : '#17805f', 'awning'))
  // A sign standing out from the corner: shapes and colours, no words.
  const signQ = [[XR - 0.85, shopY - 5.6, 12.25], [XR, shopY - 5.6, 12.25], [XR, shopY - 3.3, 12.25], [XR - 0.85, shopY - 3.3, 12.25]]
  core.casters.push(core.quadCaster(signQ))
  poly(signQ, P => {
    const u = (P[0] - (XR - 0.85)) / 0.85
    const v = (shopY - 3.3 - P[1]) / 2.3
    if (u < 0.1 || u > 0.9 || v < 0.05 || v > 0.95) return mat('#dc3a28', 'signR', { sign: true })
    if (v > 0.7 && v < 0.88) return mat('#1f5fc0', 'signB', { sign: true })
    if (Math.abs(u - 0.5) < 0.22 && v > 0.15 && v < 0.6 && Math.floor(v * 9) % 2) return mat('#dc3a28', 'signR', { sign: true })
    return mat('#f8f4ea', 'signW', { sign: true })
  })

  // Vending machines against the shop's gable end, facing us.
  for (const [vx, body, band] of [[3.1, '#f2f4f6', '#1f6fd0'], [4.2, '#de3c2a', '#f6f2e8']]) {
    box(vx, vx + 1.0, shopY - 1.83, shopY, 11.32, 11.98, {
      front: P => {
        const cs = cellAt(P[2])
        const u = P[0] - vx
        const v = shopY - P[1]
        if (v > 1.74) return mat(band, 'vend')
        // The display: rows of drinks behind glass, lit from inside.
        if (u > 0.08 && u < 0.92 && v > 1.0 && v < 1.7) {
          const row = Math.floor((v - 1.0) / 0.235)
          const rv = (v - 1.0) % 0.235
          if (rv < Math.max(0.05, cs)) return { a: [0.25, 0.25, 0.25], k: 'vshelf', e: M.vend.map(c => c * 0.8) }
          const col = Math.floor((u - 0.08) / 0.12)
          const drinks = ['#d23d2c', '#2d6fc0', '#e8c23a', '#3c9a5a', '#f2f0ea', '#8a4fb0', '#e07a2e', '#3a3a3a']
          const dc = drinks[(col * 3 + row * 5 + (vx > 4 ? 2 : 0)) % drinks.length]
          return { a: C(dc), k: 'drink', e: C(dc).map((c, i) => c * M.vend[i] * 0.6 + M.vend[i] * 0.12) }
        }
        // Buttons under the display, the coin panel, the slot at the bottom.
        if (u > 0.08 && u < 0.92 && v > 0.9 && v <= 1.0) return { a: [0.1, 0.1, 0.1], k: 'vbtn', e: M.vendBtn }
        if (u > 0.66 && u < 0.86 && v > 0.55 && v < 0.85) return mat('#5c5f63', 'vpanel')
        if (u > 0.12 && u < 0.6 && v > 0.12 && v < 0.36) return mat('#2a2a2c', 'vslot')
        return mat(body, 'vend')
      },
      nx: solid(shade(body, 0.92), 'vend'),
      top: solid('#9c9a94', 'vend'),
    })
  }
  // A recycling box for cans beside them.
  box(5.3, 5.75, shopY - 0.75, shopY, 11.45, 11.9, { front: P => mat(Math.abs(shopY - P[1] - 0.6) < 0.08 ? '#2a2a2c' : '#2a80d8', 'bin'), nx: solid('#2470c0', 'bin'), top: solid('#2a66b0', 'bin') })
  // The air conditioner's outdoor unit, a round fan grille on its front.
  box(5.95, 6.8, shopY - 0.62, shopY - 0.06, 11.62, 11.95, {
    front: P => {
      const u = P[0] - 5.95
      const v = shopY - 0.06 - P[1]
      const d = Math.hypot(u - 0.32, v - 0.28)
      if (d < 0.22) return mat(Math.floor(d / Math.max(0.045, cellAt(P[2]) * 1.6)) % 2 ? '#4a4c4e' : '#a0a3a4', 'grille')
      if (u > 0.62 && u < 0.78 && (v / 0.06) % 1 < 0.5) return mat('#cfccc4', 'acunit')
      return mat('#f2efe6', 'acunit')
    },
    nx: solid('#e6e3da', 'acunit'),
    top: solid('#dfdcd3', 'acunit'),
  })
  // Potted plants along the wall: clay and plastic pots, one big leafy one.
  {
    const r = rng(5)
    const pots = [[6.95, 0.17, '#c86a3a'], [7.35, 0.13, '#2a78c8'], [7.7, 0.2, '#b85c30']]
    for (const [X, pr, pc] of pots) {
      const Z = 11.55
      const ph = pr * 1.5
      cylinder(X, Z, pr, shopY - ph, shopY, (P, x, y, n, u) => mat(Math.abs(P[1] - (shopY - ph)) < 0.03 ? shade(pc, 1.2) : pc, 'pot'))
      const list = []
      const n = 3 + Math.floor(r() * 3)
      for (let i = 0; i < n; i++) list.push({ c: [X + (r() - 0.5) * pr * 2, shopY - ph - pr * (0.4 + r() * 1.6), Z - 0.05], r: pr * (0.6 + r() * 0.5), seed: 90 + i })
      blobs(list, (P, x, y, n2, b) => mat(noise(x * 0.8, y * 0.8, b.seed) > 0.55 ? '#62b040' : '#3f8c36', 'plant'), { rough: 0.6, cast: false })
    }
  }
  // A parked bicycle in the lot, side on: two wheels, a step-through frame, a front basket.
  {
    const Z = 9.7
    const g = sY(Z)
    const X0 = 3.35
    const rW = 0.33
    const wA = [X0 + rW, g - rW]
    const wB = [X0 + 1.45, g - rW]
    const tyre = () => mat('#222326', 'tyre')
    const steel = () => mat('#c3c6c9', 'steel')
    const paint = () => mat('#1fa0a8', 'bike')
    const bikeLines = []
    const ring = (c, r, m, n = 48) => {
      const pts = []
      for (let i = 0; i <= n; i++) pts.push([c[0] + Math.cos((i / n) * Math.PI * 2) * r, c[1] + Math.sin((i / n) * Math.PI * 2) * r, Z])
      wire(pts, m, { bias: 0.1 })
      if (m === tyre) bikeLines.push(pts)
    }
    for (const c of [wA, wB]) {
      ring(c, rW, tyre)
      ring(c, rW - 0.035, steel)
      for (let a = 0; a < 6; a++) wire([[c[0], c[1], Z], [c[0] + Math.cos(a) * (rW - 0.04), c[1] + Math.sin(a) * (rW - 0.04), Z]], () => mat('#9da1a5', 'spoke'), { bias: 0.05 })
    }
    const crank = [X0 + 0.82, g - 0.27]
    const seat = [X0 + 0.62, g - 0.9]
    const head = [X0 + 1.3, g - 0.82]
    const L = (a, b, m) => {
      wire([[a[0], a[1], Z], [b[0], b[1], Z]], m, { bias: 0.12 })
      bikeLines.push([[a[0], a[1], Z], [b[0], b[1], Z]])
    }
    L(wA, crank, paint)
    L(crank, [X0 + 0.66, g - 0.82], paint)
    L(crank, [head[0] - 0.08, head[1] + 0.3], paint)
    L([head[0] - 0.08, head[1] + 0.3], head, paint)
    L(head, wB, paint)
    L(wA, [X0 + 0.64, g - 0.8], paint)
    L([X0 + 0.48, g - 0.93], [X0 + 0.78, g - 0.93], () => mat('#2a2522', 'saddle'))
    L([X0 + 0.52, g - 0.96], [X0 + 0.74, g - 0.96], () => mat('#3a322c', 'saddle'))
    L(head, [head[0] - 0.12, head[1] - 0.2], steel)
    L([head[0] - 0.28, head[1] - 0.22], [head[0] + 0.02, head[1] - 0.2], steel)
    // Mudguards and the chain guard.
    const arc = (c, a0, a1, m) => {
      const pts = []
      for (let i = 0; i <= 16; i++) {
        const a = a0 + (a1 - a0) * (i / 16)
        pts.push([c[0] + Math.cos(a) * (rW + 0.05), c[1] + Math.sin(a) * (rW + 0.05), Z])
      }
      wire(pts, m, { bias: 0.11 })
    }
    arc(wA, Math.PI * 1.05, Math.PI * 1.75, steel)
    arc(wB, Math.PI * 1.25, Math.PI * 1.95, steel)
    box(crank[0] - 0.05, wA[0] + 0.05, crank[1] - 0.06, crank[1] + 0.06, Z - 0.04, Z + 0.02, { front: solid('#1fa0a8', 'bike') }, { cast: false })
    // The basket on the front.
    box(head[0] + 0.02, head[0] + 0.4, head[1] - 0.12, head[1] + 0.16, Z - 0.17, Z + 0.17, {
      front: (P, x) => mat(x % 2 ? '#3f4245' : '#b9bdc1', 'basket'),
      nx: (P, x) => mat(x % 2 ? '#3f4245' : '#aeb2b6', 'basket'),
      top: solid('#2c2e30', 'basket'),
    }, { cast: false })
    // Its shadow: the wheels and frame drawn on the ground by the day sun; a thin slab when the
    // sun is low and the lines would run out of the frame.
    if (M.lineShadows) for (const pts of bikeLines) lineShadow(pts, 0.85)
    else core.casters.push({ t: 'box', b: [X0, X0 + 1.8, g - 0.95, g, Z - 0.03, Z + 0.03] })
  }

  // The second house down on the right, set back behind a hedge and a small pine; a block
  // wall before the crossing.
  house({
    x0: 4.3, x1: 9.5, z0: 19.9, z1: 23.3, yf: sY(19.9), h: 5.2, base: sY(23.3) + 0.3, ridge: 'x', rise: 1.2, ov: 0.5,
    wall: (P, f, u, v) => {
      if (f === 'nx' && v > 1.0 && v < 2.2 && u > 0.6 && u < 2.6) return windowCell(u - 0.6, v - 1.0, 2.0, 1.2, P, 110, { bars: true })
      if (f === 'nx' && v > 3.4 && v < 4.6 && u > 0.9 && u < 2.5) return windowCell(u - 0.9, v - 3.4, 1.6, 1.2, P, 111)
      if (f === 'front' && v > 3.4 && v < 4.5 && u > 1.2 && u < 2.6) return windowCell(u - 1.2, v - 3.4, 1.4, 1.1, P, 112)
      return mat(v < 0.4 ? '#a59c8c' : '#f2e3c2', 'wallR2')
    },
    roof: kawara('#a0563a', 'roofR2', { course: 0.3 }),
  })
  {
    const hedge = []
    for (let Z = 19.9; Z < 23.4; Z += 0.55) hedge.push({ c: [3.35, sY(Z) - 0.75, Z], r: 0.55, seed: Math.floor(Z * 7) })
    blobs(hedge, (P, x, y, n, b) => mat(noise(x * 0.9, y * 0.9, b.seed) > 0.5 ? '#55a23e' : '#3c8236', 'hedge'), { rough: 0.5 })
    const g = sY(22)
    wire([[3.7, g, 22], [3.75, g - 3.2, 22]], () => mat('#6a4c36', 'bark'))
    const r = rng(23)
    const pine = []
    for (let i = 0; i < 6; i++) pine.push({ c: [3.75 + (r() - 0.5) * 1.6, g - 2.3 - i * 0.42, 22 + (r() - 0.5) * 0.6], r: 0.55 + r() * 0.25, sy: 0.55, seed: 60 + i })
    blobs(pine, (P, x, y, n, b) => mat(noise(x * 0.8, y * 0.8, b.seed) > 0.55 ? '#3f7e40' : '#2d6234', 'pine'), { rough: 0.5 })
  }
  box(XR, 7, sY(27.3) - 1.2, sY(27.3) + 0.3, 23.6, 27.3, {
    nx: P => {
      const v = sY(27.3) - P[1]
      const u = P[2] - 23.6
      if (v > 0.6 && v < 0.95 && (u % 0.4) > 0.1 && (u % 0.4) < 0.3) return mat('#8c8576', 'block')
      return mat((v / 0.2) % 1 < 0.2 ? '#aea696' : '#cbc3b2', 'block')
    },
    front: solid('#cbc3b2', 'block'),
    top: solid('#ddd6c8', 'block'),
  })
  // A traffic mirror on an orange post where the path meets the lane.
  {
    const X = 2.62
    const Z = 27.0
    const g = sY(Z)
    cylinder(X, Z, 0.05, g - 2.9, g, () => mat('#f07a26', 'mirrorP'))
    const c = [X - 0.1, g - 3.05, Z - 0.02]
    const pts = []
    for (let i = 0; i < 24; i++) pts.push([c[0] + Math.cos((i / 24) * Math.PI * 2) * 0.42, c[1] + Math.sin((i / 24) * Math.PI * 2) * 0.42, c[2]])
    poly(pts, P => {
      const d = Math.hypot(P[0] - c[0], P[1] - c[1])
      if (d > 0.34) return mat('#f07a26', 'mirrorP')
      return { a: [0.1, 0.1, 0.1], k: 'mirror', e: (P[1] < c[1] - 0.1 ? M.glassSky : M.glassSky.map(v => v * 0.6)), glass: true }
    })
  }

  // ------------------------------------------------ the crossing's warning posts
  // Each: a striped post, a crossbuck, a pair of lamps facing us (dark here; motion.mjs lights
  // them), a bell on top, the arm's drive box at the foot. The arms are in motion.mjs.
  const devices = [
    { X: -3.05, Z: 29.35, s: 1 },
    { X: 3.05, Z: 32.7, s: -1 },
  ]
  for (const d of devices) {
    const g = YC
    cylinder(d.X, d.Z, 0.075, g - 3.45, g, P => mat(Math.floor((g - P[1]) / 0.3) % 2 ? '#f2c21e' : '#262524', 'xpost'))
    // The post is thinner than a cell out here: its shadow is drawn as a line, not cast.
    lineShadow([[d.X, g, d.Z], [d.X, g - 3.45, d.Z]], 1)
    const zc = d.Z - 0.1
    // The crossbuck: two yellow boards edged in black.
    const cy = g - 3.05
    for (const a of [0.62, -0.62]) {
      const ux = Math.cos(a)
      const uy = Math.sin(a)
      const L = 0.55
      const w = 0.09
      poly([[d.X - ux * L - uy * w, cy - uy * L + ux * w, zc], [d.X + ux * L - uy * w, cy + uy * L + ux * w, zc], [d.X + ux * L + uy * w, cy + uy * L - ux * w, zc], [d.X - ux * L + uy * w, cy - uy * L - ux * w, zc]], P => {
        const q = Math.abs((P[0] - d.X) * -uy + (P[1] - cy) * ux)
        return mat(q > w * 0.55 ? '#1f1e1d' : '#f6c818', 'xbuck')
      }, { bias: a > 0 ? 0.01 : 0 })
    }
    // The lamp board: a black bar, two round backplates, dark lenses under hoods.
    const ly = g - 2.35
    poly([[d.X - 0.42, ly - 0.05, zc], [d.X + 0.42, ly - 0.05, zc], [d.X + 0.42, ly + 0.05, zc], [d.X - 0.42, ly + 0.05, zc]], () => mat('#1d1c1c', 'xboard'))
    for (const sx of [-0.32, 0.32]) {
      const c = [d.X + sx, ly, zc - 0.02]
      const pts = []
      for (let i = 0; i < 16; i++) pts.push([c[0] + Math.cos((i / 16) * Math.PI * 2) * 0.2, c[1] + Math.sin((i / 16) * Math.PI * 2) * 0.2, c[2]])
      poly(pts, P => {
        const r = Math.hypot(P[0] - c[0], P[1] - c[1])
        if (r < 0.11) return mat('#6a1e18', 'lens')
        return mat(P[1] < c[1] - 0.08 ? '#353433' : '#1d1c1c', 'xboard')
      })
    }
    box(d.X - 0.12, d.X + 0.12, g - 3.75, g - 3.45, d.Z - 0.12, d.Z + 0.12, { all: solid('#a4a8ab', 'xbell') }, { cast: false })
    // The drive box for the arm, on the lane side of the post.
    const bx = d.X + d.s * 0.28
    box(Math.min(bx - 0.18, bx + 0.18), Math.max(bx - 0.18, bx + 0.18), g - 1.0, g, d.Z - 0.15, d.Z + 0.15, { all: P => mat(P[1] < g - 0.85 ? '#2a2a2a' : '#e0b424', 'xdrive') })
  }

  // ------------------------------------------------ beyond the crossing: the torii and the knoll
  {
    const zt = 40
    const g = sY(zt) + 0.1
    const red = '#e2462a'
    const post = X => {
      cylinder(X, zt, 0.17, g - 4.0, g, () => mat(red, 'torii'))
      lineShadow([[X, g, zt], [X, g - 4.0, zt]], 1)
    }
    post(3.1)
    post(5.9)
    box(2.2, 6.8, g - 4.4, g - 4.05, zt - 0.2, zt + 0.2, { all: P => mat(P[1] < g - 4.28 ? '#2b2624' : red, 'torii') })
    box(2.65, 6.35, g - 3.6, g - 3.35, zt - 0.12, zt + 0.12, { all: solid(red, 'torii') })
    for (const X of [2.5, 6.6]) box(X - 0.22, X + 0.22, g - 1.5, g, zt + 2, zt + 2.45, { all: solid('#c4bdaf', 'stoneL') })
    // Steps up the knoll, pale stone.
    for (let i = 0; i < 6; i++) box(3.4, 5.6, g - 0.2 - i * 0.35, g, zt + 3 + i * 0.5, zt + 3.5 + i * 0.5, { front: solid('#cdc5b4', 'steps'), top: solid('#e2dccd', 'steps') }, { cast: false })
    // The grove: tall cedars and round camphors on the knoll.
    const r = rng(41)
    const list = []
    for (let i = 0; i < 40; i++) {
      const X = 4.5 + r() * 24
      const Z = 47 + r() * 28
      const gg = groundY(X, Z)
      const tall = r() < 0.55
      const rr = tall ? 2.0 + r() * 1.2 : 2.6 + r() * 1.6
      list.push({ c: [X, gg - (tall ? 6.5 : 3.8) - r() * 2, Z], r: rr, sy: tall ? 0.55 : 0.9, seed: 200 + i, tall })
    }
    blobs(list, (P, x, y, n, b) => {
      const q = noise(x * 0.6, y * 0.6, b.seed)
      if (b.tall) return mat(q > 0.6 ? '#3f7e48' : q > 0.35 ? '#2f683e' : '#245535', 'cedar')
      return mat(q > 0.6 ? '#72ae46' : q > 0.35 ? '#5a963c' : '#427a32', 'grove')
    }, { rough: 0.45, castR: 0.8 })
  }

  // ------------------------------------------------ the land, the headland and the far range
  terrain(groundY, (P, x, y, n) => {
    const X = P[0]
    const Z = P[2]
    if (P[1] > YSEA - 0.35 && Z < 450) return mat(noise(X * 0.3, Z * 0.3, 2) > 0.5 ? '#d2c6a6' : '#c2b593', 'shore')
    if (P[1] > YSEA - 1.5 && Z >= 450) return mat('#9a9280', 'rocks')
    // A village along the headland's shore: its windows lit after dark.
    if (M.litP > 0.3 && Z > 500 && Z < 1600 && P[1] > YSEA - 5 && hash(x, y, 91) < 0.07) return mat('#000000', 'glow', { e: C(M.room[Math.floor(hash(x, y, 92) * M.room.length)]).map(v => v * 0.9), flat: true })
    if (Z > 1500) return mat('#5c8ab2', 'range')
    if (Z > 380) {
      // Forest on the headland: crowns as bumps, lit and shaded.
      const b1 = noise(X * 0.05, Z * 0.05, 81)
      const b2 = noise(X * 0.05 + 7, Z * 0.05, 82)
      const nn = norm([n[0] + (b1 - 0.5) * 1.6, n[1], n[2] + (b2 - 0.5) * 1.6])
      const q = noise(X * 0.03, Z * 0.03, 83)
      if (P[1] > YSEA - 3 && q > 0.45) return mat('#b8ad92', 'cliff', { n: nn })
      return mat(q > 0.62 ? '#56a24a' : q > 0.4 ? '#468e42' : '#3a7a3c', 'forest', { n: nn })
    }
    if (Z > 2400) return mat('#5c8ab2', 'range')
    const steep = 1 + n[1]
    const leafy = noise(X * 0.35, Z * 0.35, 8)
    if (steep > 0.08 || leafy > 0.64) return mat(leafy > 0.78 ? '#5fa63e' : '#4a8e38', 'trees')
    return mat(leafy > 0.42 ? '#86a858' : '#9aaa70', 'garden')
  }, { tmin: 3.5, bias: 0.05 })

  // Houses down the hillside and through the lower town.
  const r = rng(77)
  const roofs = ['#5a6e8e', '#7a879c', '#ac5638', '#3e6eae', '#4c5670', '#a04a30', '#4f968a', '#9ca4b0', '#bc6a3c']
  const walls = ['#f3ebd8', '#ead8b6', '#f7f2e6', '#dccdb0', '#cfdcda', '#eedcc2', '#e0c497']
  const town = (x0, x1, z0, z1, near) => {
    const gc = groundY((x0 + x1) / 2, (z0 + z1) / 2)
    if (gc > YSEA - 1.0) return
    const h = near ? 3.0 + r() * 1.0 : 3.2 + r() * 3.4
    const pick = roofs[Math.floor(r() * roofs.length)]
    const rc = near && ['#4c5670', '#5a6e8e', '#3e6eae'].includes(pick) ? '#9ca4b0' : pick
    const wc = walls[Math.floor(r() * walls.length)]
    const seed = Math.floor(r() * 1e6)
    const ridge = r() < 0.6 ? 'z' : 'x'
    const tin = r() < 0.15
    house({
      x0, x1, z0, z1, yf: gc, h, base: gc + 6, ridge, rise: 1.0 + r() * 0.7, ov: 0.35, cast: z0 < 140,
      wall: (P, f, u, v) => {
        if (f !== 'gable' && v > 0.9 && v < 1.9 && (u % 2.6) > 0.9 && (u % 2.6) < 2.0) {
          if (isLit(seed + Math.floor(u / 2.6) + (f === 'front' ? 50 : 0))) return mat('#000000', 'glow', { e: C(M.room[0]), flat: true })
          return mat('#5a6c84', 'twin')
        }
        if (f !== 'gable' && h > 5 && v > 3.6 && v < 4.5 && (u % 2.6) > 1.0 && (u % 2.6) < 1.9) {
          if (isLit(seed + 9 + Math.floor(u / 2.6))) return mat('#000000', 'glow', { e: C(M.room[0]), flat: true })
          return mat('#5a6c84', 'twin')
        }
        return mat(wc, 'twall')
      },
      roof: tin ? (P, s, u, n, side, run) => tinCell(s, u, P, rc, 'troof', run) : (P, s, u) => tileCell(s, u, P, rc, 'troof', { ridgeW: 0.3 }),
    })
  }
  // The hillside below the parapet, past the hand-placed houses, out to the left.
  for (let Z = 3; Z < 240; Z += 6.5 + r() * 3) {
    const lim = (Z * (HX + 40)) / F + 10
    const startX = Z < 27 ? -13.5 - r() * 2 : -3.6 - r() * 1.5
    for (let X = startX; X > -lim; X -= 6.5 + r() * 4) {
      const w = 5 + r() * 3
      const d = 4.5 + r() * 3
      if (Z + d > 26.8 && Z < BZ1 + 1.5) continue
      town(X - w, X, Z, Z + d, Z < 40)
    }
  }
  // Right of the lane below the crossing, round the knoll.
  for (let Z = 44; Z < 240; Z += 6.5 + r() * 3) {
    for (let X = 3.4 + r() * 0.8; X < 60; X += 6.5 + r() * 4) {
      const w = 5 + r() * 3
      const d = 4.5 + r() * 3
      if (Math.exp(-(((X + w / 2 - 15) / 12) ** 2) - (((Z + d / 2 - 60) / 14) ** 2)) > 0.25) continue
      town(X, X + w, Z, Z + d, false)
    }
  }

  // The harbour's breakwater running out from the left, a red light at its end.
  {
    const y = YSEA - 2.6
    box(-170, -78, y, YSEA, 424, 432, { front: P => mat(noise(P[0] * 0.3, 1, 3) > 0.6 ? '#d6d1c4' : '#e6e1d4', 'pier'), top: solid('#f0ece2', 'pier') }, { cast: false })
    cylinder(-80, 428, 2.6, y - 13, y, (P, x, y2, n, u) => mat(P[1] < y - 11.5 ? '#f1ede3' : P[1] < y - 10.5 ? '#3a3a3a' : '#d8402e', 'beacon'), { cast: false })
  }
  // The sea.
  poly([[-6000, YSEA, 40], [6000, YSEA, 40], [6000, YSEA, 60000], [-6000, YSEA, 60000]], () => mat('#2a5d7e', 'sea', { sea: true }))

  // ------------------------------------------------ poles and wires
  const poles = [
    { X: -2.55, Z: 10.5, tf: true, lamp: true },
    { X: 2.55, Z: 19.6, lamp: true },
    { X: -2.55, Z: 33.2, lamp: true },
  ]
  for (const p of poles) {
    const g = sY(p.Z)
    p.top = g - 9.2
    // Concrete, darker toward the ground; a striped guard at the foot of the near one; small
    // plates at eye height.
    cylinder(p.X, p.Z, 0.17, p.top, g, P => {
      const v = g - P[1]
      if (p.tf && v < 1.25 && v > 0.1) return mat(Math.floor((v + P[0] * 0.6) / 0.25) % 2 ? '#f2c21e' : '#2b2a29', 'guard')
      if (v > 2.2 && v < 2.6) return mat('#f0eee8', 'plate')
      if (v > 2.7 && v < 3.0) return mat('#2a6fd0', 'plateB')
      return mat(v < 0.6 ? '#aea596' : '#cfc8ba', 'pole')
    })
    box(p.X - 0.95, p.X + 0.95, p.top + 0.5, p.top + 0.62, p.Z - 0.06, p.Z + 0.06, { all: solid('#7d7a74', 'arm') })
    for (const dx of [-0.8, 0, 0.8]) box(p.X + dx - 0.04, p.X + dx + 0.04, p.top + 0.36, p.top + 0.5, p.Z - 0.04, p.Z + 0.04, { all: solid('#e8e4dc', 'insul') }, { cast: false })
    if (p.tf) cylinder(p.X - 0.42, p.Z, 0.24, p.top + 2.0, p.top + 3.0, () => mat('#a8b4b8', 'transf'))
    if (p.lamp) {
      // A street lamp on an arm reaching over the lane.
      const s = Math.sign(-p.X)
      const ly = p.top + 4.4
      wire([[p.X, ly + 0.2, p.Z], [p.X + s * 0.9, ly - 0.05, p.Z]], () => mat('#7d7f80', 'larm'))
      box(Math.min(p.X + s * 0.7, p.X + s * 1.15), Math.max(p.X + s * 0.7, p.X + s * 1.15), ly - 0.1, ly + 0.02, p.Z - 0.1, p.Z + 0.1, {
        // Lit, the lower edge of the shade glows too, for the heads seen from the side.
        all: M.lampOn ? P => (P[1] > ly - 0.05 ? { a: [0.4, 0.4, 0.4], k: 'lampG', e: C('#ffe4b4'), flat: true } : mat('#a8aaa8', 'lamp')) : solid('#a8aaa8', 'lamp'),
        bottom: () => ({ a: [0.4, 0.4, 0.4], k: 'lampG', e: M.lampOn ? C('#fff1c8') : [0.12, 0.12, 0.12], flat: !!M.lampOn }),
      }, { cast: false })
      p.lampP = [p.X + s * 0.92, ly + 0.1, p.Z]
    }
  }
  // A crossing-warning sign: a red triangle, point down, on its own post by the stop line.
  {
    const X = -2.2
    const Z = 25.6
    const g = sY(Z)
    cylinder(X, Z, 0.04, g - 2.3, g, () => mat('#e6e4de', 'spost'))
    lineShadow([[X, g, Z], [X, g - 2.3, Z]], 1)
    const triQ = [[X - 0.36, g - 2.65, Z - 0.03], [X + 0.36, g - 2.65, Z - 0.03], [X, g - 2.03, Z - 0.03]]
    core.casters.push(core.quadCaster(triQ))
    poly(triQ, P => {
      const v = (P[1] - (g - 2.65)) / 0.62
      const u = Math.abs(P[0] - X) / 0.36
      return mat(u > 0.78 * (1 - v) || v < 0.12 ? '#f6f4ee' : '#e03a26', 'tri', { sign: true })
    })
  }
  // The wires: three high ones along the arms, a thick cable lower down, drops to the houses.
  const wireMat = () => mat('#2c2c30', 'wire')
  const chain = [{ X: -2.55, Z: -2, top: E - 9.2 }, ...poles]
  const spans = []
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i]
    const b = chain[i + 1]
    for (const dx of [-0.8, 0, 0.8]) spans.push([[a.X + dx, a.top + 0.45, Math.max(a.Z, 1.2)], [b.X + dx, b.top + 0.45, b.Z], 0.35])
    spans.push([[a.X, a.top + 3.2, Math.max(a.Z, 1.2)], [b.X, b.top + 3.2, b.Z], 0.6, true, i < 2])
  }
  spans.push([[2.55, poles[1].top + 3.4, 19.6], [2.95, sY(12) - 5.6, 12.6], 0.25, false, true])
  spans.push([[-2.55, poles[0].top + 3.4, 10.5], [-4.6, groundY(-7, 7) - 4.6, 8.0], 0.3])
  spans.push([[-2.55, poles[2].top + 0.45, 33.2], [2.55, sY(60) - 9, 60], 0.5])
  for (const [a, b, sag, thick, sway] of spans) {
    const pts = span(a, b, sag, 60)
    // A few thin lines of shadow on the lane under the thick cables (the day sun only); the fine
    // wires are too thin to throw one that reads.
    if (thick) lineShadow(pts, 0.7)
    if (sway) continue // drawn by motion.mjs, swaying
    wire(pts, wireMat)
    if (thick) wire(pts.map(p => [p[0], p[1] + cellAt(p[2]), p[2]]), wireMat)
  }

  if (M.lampOn) {
    // Each street lamp: its cone down onto the lane, and a little of its glow on its own arm
    // and the pole's upper part.
    M.lamps = poles.filter(p => p.lampP).map(p => ({ p: p.lampP, c: M.lampC, r: 4, reach: 12, cone: [0.62, 0.9] }))
    for (const p of poles.filter(p => p.lampP)) M.lamps.push({ p: [p.X + Math.sign(-p.X) * 0.5, p.lampP[1] + 0.25, p.Z - 0.3], c: M.lampC.map(v => v * 0.35), r: 0.9, reach: 3.2 })
    // The vending machines light the ground in front of them.
    M.lamps.push({ p: [4.2, sY(12) - 0.9, 10.2], c: M.vendLight, r: 2.6, reach: 7, up: true })
    // The lit shop window throws a warm pool across the walk and the lane's edge.
    if (M.windowLight) for (const z of [13.8, 16.6]) M.lamps.push({ p: [2.3, sY(z) - 1.0, z], c: M.windowLight, r: 1.7, reach: 4.5, up: true })
  }
  return { poles, spans, devices, yb }
}

// ---------------------------------------------------------------- the sky
// Bands of the moment's ramp, three rows tall up high and two by the horizon, bulging up around
// the sun or moon; the sun or moon itself; stars. One full layer, under everything.
export function paintSky(moment) {
  const Mo = moment
  const L = new Layer('sky')
  const edges = []
  for (let t = -80; t < 40; t += 3) edges.push(t)
  for (let t = 40; t < 260; t += 2) edges.push(t)
  const band = t => {
    let i = 0
    while (i < edges.length - 1 && edges[i + 1] <= t) i++
    return i
  }
  const cols = edges.map((e, i) => hexOf(rampC(Mo.sky, (e + (edges[i + 1] ?? e + 2)) / 2)))
  const G = Mo.glow
  const lift = (x, y) => (G ? G.lift * Math.exp(-(((x + 0.5 - G.x) / G.rx) ** 2) - (((y + 0.5 - G.y) / G.ry) ** 2)) : 0)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) L.set(x, y, cols[band(y + lift(x, y))])
  const extra = []
  const css = []
  if (Mo.sunDisc) {
    const { x: cx, y: cy, r: R, tones, halo } = Mo.sunDisc
    for (let y = Math.floor(cy - R - 3); y <= cy + R + 3; y++) {
      for (let x = Math.floor(cx - R - 3); x <= cx + R + 3; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R
        if (d >= 1) {
          if (d < 1 + 1.2 / R) L.set(x, y, halo)
          continue
        }
        L.set(x, y, d < 0.7 ? tones[2] : d < 0.9 ? tones[1] : tones[0])
      }
    }
  }
  if (Mo.moon) {
    const { x: cx, y: cy, r: R, tones, halo } = Mo.moon
    const craters = new Set(['-2,-1', '-1,-1', '1,1', '2,1', '0,2', '-2,1'])
    for (let y = -R - 2; y <= R + 1; y++) {
      for (let x = -R - 2; x <= R + 1; x++) {
        const d = Math.hypot(x + 0.5, y + 0.5)
        if (d >= R) {
          if (d < R + 1.5 && (x + y) % 2 === 0) L.set(cx + x, cy + y, halo)
          continue
        }
        const nz = Math.sqrt(R * R - d * d) / R
        let v = 0.5 + 0.5 * ((-(x + 0.5) / R) * 0.45 + (-(y + 0.5) / R) * 0.55 + nz * 0.55)
        if (craters.has(x + ',' + y)) v -= 0.25
        L.set(cx + x, cy + y, tones[clamp(Math.floor(v * tones.length), 0, tones.length - 1)])
      }
    }
  }
  if (Mo.stars) {
    const r = rng(211)
    const twinkle = []
    for (let i = 0; i < 120; i++) {
      const x = Math.floor(r() * W)
      const y = Math.floor(2 + Math.pow(r(), 1.5) * 76)
      if (Mo.moon && Math.hypot(x - Mo.moon.x, y - Mo.moon.y) < 12) continue
      if (i < 12) {
        const S = new Layer('star' + i)
        S.set(x, y, Mo.stars[0])
        if (i < 5) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) S.set(x + dx, y + dy, Mo.stars[2])
        const d = 5 * (1 + Math.floor(r() * 4))
        S.anim = { cls: 'tk', style: '--d:' + d + 's;--l:' + -Math.round(r() * d * 10) / 10 + 's' }
        twinkle.push(S)
      } else L.set(x, y, Mo.stars[r() < 0.35 ? 1 : 2])
    }
    extra.push(...twinkle)
    css.push('.tk{animation:tk var(--d) steps(1) calc(var(--l) + var(--m)) infinite}@keyframes tk{0%,90%{opacity:1}94%,100%{opacity:.4}}')
  }
  return { layer: L, extra, css }
}
