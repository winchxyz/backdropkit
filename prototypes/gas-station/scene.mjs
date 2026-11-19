// What stands in Gas Station, in metres (eye at the origin, 1.8 m over flat ground, X right,
// Y down, Z ahead). From us outward: the near gravel shoulder, the two-lane highway along X,
// the station's concrete lot with the canopy over two pump islands, the shop behind it on the
// left, the price pylon at the lot's right corner by the road, a street lamp between them, and
// beyond the lot the desert plain running out to mesas and a far range on the horizon.
import { Layer, clamp, hex, lerp, rng } from '../../../sunfield/tools/pixel.mjs'
import * as core from './core.mjs'
import { C, E, F, H, HX, HY, W, blobs, box, cylinder, hash, mat, mixHex, noise, poly, proj, solid, terrain, wire, xAt, yAt } from './core.mjs'
import { PY, faceAt } from './pylon.mjs'

let M
const G = E // the ground's Y
const cellAt = Z => Z / F // metres per cell at depth Z
const hexOf = c => hex(c.map(v => v * 255))
const thin = (Z, m) => Math.max(m, cellAt(Z) * 0.9) // a line at least about a cell wide
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
const glow = (h, k = 1) => C(h).map(v => v * k)

// ---------------------------------------------------------------- the layout
export const ROAD = { z0: 7.2, z1: 14.2, mid: 10.7 }
export const LANE_FAR = 12.45 // the far lane's middle
const LOT = { x0: -70, x1: 14.5, z0: 14.7, z1: 47 }
export const PYZ = 15.3 // the pylon's front face
// The canopy's right end is straight over the eye (X 0), so it shows as a clean square end with
// no side face; its left end is off the picture.
export const CAN = { x0: -26, x1: 0, z0: 17, z1: 26, under: G - 4.8, top: G - 5.8 }
export const ISL = [{ x0: -13.6, x1: -8.4, col: -11.0, pumps: [-12.5, -9.5] }, { x0: -7.2, x1: -2.0, col: -4.6, pumps: [-6.1, -3.1] }]
const ISZ = [20.9, 22.3]
const PZ = [21.25, 21.95] // a pump's front and back
const PUMP_H = 1.85
export const SHOP = { x0: -24, x1: -6.5, z0: 31, z1: 41, h: 4.6 }
export const LAMP = { X: 4.0, Z: 14.8, h: 6.4, headZ: 12.7 }
export const LIGHTS = [] // the canopy's downlights, [X, Z]
for (const X of [-16.5, -13.5, -10.5, -7.5, -4.5, -1.5]) for (const Z of [19.2, 23.7]) LIGHTS.push([X, Z])

// ---------------------------------------------------------------- materials
// The station's colours: teal enamel, cream, an orange stripe, charcoal metal.
const TEAL = '#1f7d80'
const TEAL_D = '#17666a'
const CREAM = '#efe4cc'
const ORANGE = '#ea7630'
const CHAR = '#2c2c31'

// The lot: poured concrete in slabs, joints between, oil under the pumps, tyre marks.
function lotCell(X, Z) {
  const cs = cellAt(Z)
  const jx = (X + 70) / 4.5
  const jz = (Z - LOT.z0) / 4
  if ((jx % 1) * 4.5 < Math.max(0.05, cs * 0.6) || (jz % 1) * 4 < Math.max(0.04, cs * 0.5)) return mat('#948c7e', 'joint')
  // Oil stains where cars stand at the islands.
  for (const isl of ISL) for (const px of isl.pumps) {
    for (const sz of [19.6, 23.6]) {
      const d = Math.hypot((X - px) / 0.9, (Z - sz) / 0.7) + (noise(X * 3, Z * 3, 71) - 0.5) * 0.6
      if (d < 0.75) return mat(d < 0.4 ? '#78716a' : '#8c8478', 'stain')
    }
  }
  // Painted bays in front of the shop.
  if (Z > 28.2 && Z < 30.6 && X > SHOP.x0 && X < SHOP.x1 + 4 && ((X - SHOP.x0) % 3.2) < thin(Z, 0.1)) return mat('#f0ece0', 'paint')
  const n = noise(X * 0.9, Z * 0.9, 12)
  return mat(n > 0.68 ? '#b3aa9a' : n < 0.28 ? '#bdb4a4' : '#b8af9f', 'lot')
}
// The desert floor: pale sand, darker gravel streaks, small stones.
function sandCell(X, Z, far) {
  const n = noise(X * (far ? 0.02 : 0.25), Z * (far ? 0.03 : 0.25), 4)
  if (!far && hash(Math.floor(X * 3), Math.floor(Z * 3), 9) > 0.985) return mat('#9a8466', 'pebble')
  return mat(n > 0.66 ? '#c4a57c' : n < 0.3 ? '#d4b88e' : '#cdb085', far ? 'plain' : 'sand')
}
export function groundCell(P) {
  const X = P[0]
  const Z = P[2]
  const cs = cellAt(Z)
  if (Z < ROAD.z0) {
    // The near shoulder: gravel and dry grass, its edge crumbling into the asphalt.
    const edge = ROAD.z0 - 0.25 - 0.25 * noise(X * 2, 1, 5)
    if (Z > edge) return mat(noise(X * 6, Z * 6, 6) > 0.5 ? '#77706a' : '#86807a', 'crumb')
    // Dry grass in small tufts where a coarse patchiness allows, stones scattered through it.
    const g = noise(X * 5, Z * 7, 8) * 0.6 + noise(X * 0.9, Z * 1.3, 18) * 0.4
    if (g > 0.66) return mat(g > 0.74 ? '#9c9466' : '#8a8258', 'grass')
    const s = hash(Math.floor(X * 9), Math.floor(Z * 9), 3)
    if (s > 0.94) return mat('#7c6e5e', 'stone')
    return mat(s > 0.62 ? '#a29280' : noise(X * 2, Z * 3, 28) > 0.55 ? '#ad9d88' : '#b5a690', 'gravel')
  }
  if (Z < ROAD.z1) {
    // Asphalt: white edge lines, a dashed yellow centre line, patches.
    if (Math.abs(Z - 7.45) < thin(Z, 0.12) * 0.55 || Math.abs(Z - 13.95) < thin(Z, 0.12) * 0.55) return mat('#e4ded0', 'line', { spec: 1 })
    if (Math.abs(Z - ROAD.mid) < thin(Z, 0.12) * 0.55 && (X + 1000) % 9 < 3.2) return mat('#e3b23c', 'yline', { spec: 1 })
    const n = noise(X * 0.6, Z * 1.4, 21)
    if (n > 0.72) return mat('#5d5853', 'patch', { spec: 0.7 })
    return mat(noise(X * 3, Z * 3, 7) > 0.6 ? '#66615b' : '#6c6761', 'road', { spec: 1 })
  }
  if (X > LOT.x0 && X < LOT.x1 && Z > LOT.z0 && Z < LOT.z1) return lotCell(X, Z)
  // A kerb along the lot's front, the apron of gravel between it and the road.
  if (X > LOT.x0 && X < LOT.x1 && Z > LOT.z0 - 0.18) return mat('#cdc5b5', 'kerb')
  if (Z < LOT.z0) return mat(noise(X * 4, Z * 4, 13) > 0.55 ? '#a0927c' : '#ad9f88', 'apron')
  return sandCell(X, Z, false)
}

// The far land: the plain, two mesas and a butte on the right, a long far range behind.
function mesa(X, Z, m) {
  const dx = (X - m.x) / m.rx
  const dz = (Z - m.z) / m.rz
  const a = Math.atan2(dz, dx)
  const d = Math.hypot(dx, dz) * (1 + 0.09 * Math.sin(a * 3 + m.seed) + 0.05 * Math.sin(a * 7 + m.seed * 2))
  if (d < 0.8) return m.h
  if (d < 0.9) return m.h * lerp(1, 0.38, (d - 0.8) / 0.1)
  if (d < 1.3) return m.h * 0.38 * (1 - (d - 0.9) / 0.4) ** 1.5
  return 0
}
const MESAS = [
  { x: 770, z: 2600, rx: 250, rz: 190, h: 112, seed: 1 },
  { x: 1180, z: 3300, rx: 210, rz: 160, h: 125, seed: 4 },
  { x: 1090, z: 1750, rx: 46, rz: 40, h: 78, seed: 2 },
  { x: -700, z: 2400, rx: 230, rz: 170, h: 95, seed: 3 },
]
export function heightAt(X, Z) {
  let h = 0
  for (const m of MESAS) h = Math.max(h, mesa(X, Z, m))
  // The far range: long low ridges right along the horizon.
  // A wide saddle in it where the sun goes down (screen x 196).
  if (Z > 5200) {
    const sad = 1 - 0.88 * Math.exp(-(((X / Z - 0.157) / 0.075) ** 2))
    h = Math.max(h, sad * (170 + 120 * Math.sin(X * 0.00055 + 1.3) + 60 * Math.sin(X * 0.0017 + 0.4) + 30 * (noise(X * 0.004, 1, 17) - 0.5)))
  }
  return h
}

// ---------------------------------------------------------------- the scene

export function paintScene(moment) {
  M = moment
  M.lamps = []
  const lit = !!M.signLit // signs and lights on (sunset, night)

  // ------------------------------------------------ the ground near us: shoulder, road, lot
  poly([[-400, G, 4.6], [400, G, 4.6], [400, G, 60], [-400, G, 60]], P => groundCell(P))
  // The far land: the plain and the mesas, a height field out to the horizon.
  const far = P => {
    const h = G - P[1]
    const Z = P[2]
    if (h < 0.5) {
      // Scrub dots on the plain, thinning with distance.
      if (Z < 400 && hash(Math.floor(P[0] * 0.7), Math.floor(Z * 0.7), 23) > 0.93) return mat('#7f8462', 'scrubFar')
      return sandCell(P[0], Z, true)
    }
    // Rock in bands, a pale cap rock on the mesas' tops, talus at their feet.
    const band = Math.floor(h / 9 + noise(P[0] * 0.01, Z * 0.01, 5) * 1.2)
    if (Z > 5200) return mat('#b58a6c', 'range')
    if (h < 36) return mat(noise(P[0] * 0.05, Z * 0.05, 9) > 0.5 ? '#b67a52' : '#c08a60', 'talus')
    return mat(band % 3 === 0 ? '#c27a4c' : band % 3 === 1 ? '#b0683e' : '#a85f3a', 'mesa')
  }
  terrain((X, Z) => G - heightAt(X, Z), far, { tmin: 60, tmax: 9000, y0: 90, y1: 140, step: 0.003, e: 2 })

  // ------------------------------------------------ desert scrub round the lot
  const r = rng(7)
  const shrub = (X, Z, rad, tone) => {
    const list = []
    for (let i = 0; i < 4; i++) list.push({ c: [X + (r() - 0.5) * rad * 1.6, G - rad * (0.55 + r() * 0.3), Z + (r() - 0.5) * rad], r: rad * (0.5 + r() * 0.35), seed: Math.floor(r() * 99) })
    blobs(list, (P, x, y, n) => {
      const v = noise(x * 0.9, y * 0.9, 27)
      return mat(v > 0.7 ? tone[2] : v > 0.35 ? tone[1] : tone[0], 'shrub')
    }, { rough: 0.6, flatBase: G, castR: 0.75 })
  }
  const SAGE = ['#6c7350', '#858c62', '#9da474']
  for (const [X, Z, rad] of [[17, 19, 0.7], [22, 26, 0.9], [19.5, 34, 0.6], [28, 22, 0.8], [33, 41, 1.0], [-30, 44, 0.9], [-36, 40, 0.7], [-27, 30, 0.6], [12.5, 49, 0.8], [-12, 52, 0.9], [4, 56, 0.7]]) shrub(X, Z, rad, SAGE)

  // ------------------------------------------------ the canopy
  {
    const fascia = (P, x, y, n, face) => {
      const v = (P[1] - CAN.top) / (CAN.under - CAN.top) // 0 at the top edge, 1 at the bottom
      const cs = cellAt(P[2])
      if (v < Math.max(0.07, cs * 0.9)) return mat('#f7efdc', 'fasciaCap')
      if (v > 0.36 && v < 0.7) {
        // The teal band, lit from inside after dark.
        return lit ? { a: C(TEAL), k: 'band', e: glow(M.bandGlow), flat: true } : mat(TEAL, 'band')
      }
      if (v >= 0.7 && v < 0.8) return mat(ORANGE, 'stripe')
      if (v > 1 - Math.max(0.06, cs * 0.9)) return mat('#cfc3aa', 'fasciaEdge')
      return mat(CREAM, 'fascia')
    }
    const soffit = P => {
      const X = P[0]
      const Z = P[2]
      const cs = cellAt(Z)
      for (const [lx, lz] of LIGHTS) {
        if (Math.abs(X - lx) < 0.62 && Math.abs(Z - lz) < 0.34) {
          if (M.canopyOn) return { a: [1, 1, 1], k: 'canLight', e: glow(M.canopyLamp), flat: true }
          return mat('#f4f6f4', 'canLight')
        }
      }
      const seam = ((X + 30) % 1.6) < Math.max(0.04, cs * 0.6)
      if (!M.canopyOn) return seam ? mat('#b9b6ae', 'seam') : mat('#dedbd2', 'soffit')
      // After dark the soffit glows with the light thrown back up off the bright lot, strongest
      // round each fixture: a lit canopy, not lamps on a black ceiling.
      let near = 0
      for (const [lx, lz] of LIGHTS) near = Math.max(near, Math.exp(-(((X - lx) / 1.4) ** 2) - (((Z - lz) / 1.1) ** 2)))
      const a = C(seam ? '#b9b6ae' : '#dedbd2')
      const g = M.soffitGlow[0] + M.soffitGlow[1] * near
      return { a, k: seam ? 'seam' : 'soffit', e: a.map((v, i) => v * g * M.canopyC[i]), flat: true }
    }
    box(CAN.x0, CAN.x1, CAN.top, CAN.under, CAN.z0, CAN.z1, { front: fascia, px: fascia, bottom: soffit })
    // Columns through the islands, teal with a cream foot.
    for (const isl of ISL) {
      const c = isl.col
      box(c - 0.22, c + 0.22, CAN.under, G - 0.18, 21.4, 21.84, {
        all: P => (G - P[1] > 0.18 + 0.9 ? mat(TEAL, 'column') : mat(CREAM, 'colFoot')),
      })
    }
  }

  // ------------------------------------------------ the islands and pumps
  for (const isl of ISL) {
    box(isl.x0, isl.x1, G - 0.18, G, ISZ[0], ISZ[1], {
      all: P => {
        const u = Math.min(P[0] - isl.x0, isl.x1 - P[0])
        if (u < 0.35) return mat(Math.floor((P[0] + 30) / 0.18) % 2 ? '#e8bf3a' : '#2f2f33', 'bumper')
        return mat('#d4ccbc', 'island')
      },
    })
    for (const px of isl.pumps) pump(px)
    // A bin at the island's right end, a squeegee bucket at its left.
    box(isl.x1 - 0.55, isl.x1 - 0.12, G - 0.18 - 0.85, G - 0.18, 21.05, 21.5, { all: P => (G - 0.18 - P[1] > 0.72 ? mat('#3d3f44', 'binLid') : mat('#4f7f86', 'bin')) })
  }

  // ------------------------------------------------ the shop
  shop(lit)

  // ------------------------------------------------ the pylon
  pylon(lit)

  // ------------------------------------------------ the street lamp, between the canopy and the pylon
  {
    const { X, Z, h, headZ } = LAMP
    const top = G - h
    cylinder(X, Z, 0.13, top, G, () => mat('#8d9096', 'pole'), { castR: 0.3 })
    // The arm over the road and the lamp head at its end.
    box(X - 0.05, X + 0.05, top - 0.08, top + 0.04, headZ, Z, { all: () => mat('#8d9096', 'pole') })
    box(X - 0.22, X + 0.22, top - 0.06, top + 0.16, headZ - 0.3, headZ + 0.35, {
      all: () => mat('#9a9da2', 'lampHead'),
      bottom: () => (M.lampOn ? { a: [1, 1, 1], k: 'lampLit', e: glow(M.lampGlowC), flat: true } : mat('#c8c4b8', 'lampHead')),
    })
    box(X - 0.2, X + 0.2, G - 0.35, G, Z - 0.2, Z + 0.2, { all: () => mat('#b8b2a4', 'kerb') })
    if (M.lampOn) M.lamps.push({ p: [X, top + 0.3, headZ], c: M.lampC, r: 4.5, reach: 13, cone: [0.45, 0.85], shadow: true })
  }

  // ------------------------------------------------ the canopy's lights on the lot
  if (M.canopyOn) for (const [lx, lz] of LIGHTS) M.lamps.push({ p: [lx, CAN.under + 0.08, lz], c: M.canopyC, r: 3.4, reach: 11, cone: [0.25, 0.8], shadow: true })
  return {}
}

// A pump: cream cabinet, a teal head with a lit strip, a dark display, an orange nozzle in its
// holster on the right, a hose looping down.
function pump(X) {
  const x0 = X - 0.45
  const x1 = X + 0.45
  const top = G - 0.18 - PUMP_H
  const base = G - 0.18
  const lit = !!M.signLit
  const front = P => {
    const u = P[0] - x0
    const v = base - P[1] // height over the island
    const cs = cellAt(P[2])
    if (v > 1.52) {
      if (v > 1.6 && v < 1.78 && u > 0.14 && u < 0.76) return lit ? { a: [1, 1, 1], k: 'pumpLit', e: glow(M.pumpGlow), flat: true } : mat('#f4ead6', 'pumpLit')
      return mat(TEAL, 'pumpHead')
    }
    if (v > 1.0 && v < 1.32 && u > 0.18 && u < 0.72) {
      if (lit && v > 1.12 && v < 1.22 && u > 0.26 && u < 0.64) return { a: [1, 1, 1], k: 'pumpScreen', e: glow(M.screenGlow), flat: true }
      return mat('#2a2d30', 'display')
    }
    if (u > 0.7 && u < 0.86 && v > 0.62 && v < 0.92) return mat(ORANGE, 'nozzle')
    if (v > 0.42 && v < 0.42 + Math.max(0.06, cs)) return mat(ORANGE, 'stripe')
    if (v < 0.16) return mat('#55575c', 'pumpBase')
    return mat(CREAM, 'pump')
  }
  const side = P => {
    const v = base - P[1]
    if (v > 1.52) return mat(TEAL, 'pumpHead')
    if (v < 0.16) return mat('#55575c', 'pumpBase')
    return mat(CREAM, 'pump')
  }
  box(x0, x1, top, base, PZ[0], PZ[1], { front, nx: side, px: side })
  // The hose: from the holster down in a loop to the island and back up the side.
  const hose = []
  for (let i = 0; i <= 20; i++) {
    const t = i / 20
    hose.push([x1 + 0.04 + 0.12 * Math.sin(t * Math.PI), base - 0.85 + 0.62 * Math.sin(t * Math.PI), PZ[0] - 0.02 + t * 0.3])
  }
  wire(hose, () => mat('#34343a', 'hose'), { n: [0.4, -0.3, -0.85] })
}

// The shop: a stucco box with a teal sign band, big windows, a glass door, a side door.
function shop(lit) {
  const { x0, x1, z0, z1, h } = SHOP
  const top = G - h
  // The sign band's word, in screen cells (the front is parallel to the picture plane).
  const word = 'MARKET'
  const F5 = {
    M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
    A: ['.#.', '#.#', '###', '#.#', '#.#'],
    R: ['##.', '#.#', '##.', '#.#', '#.#'],
    K: ['#.#', '#.#', '##.', '#.#', '#.#'],
    E: ['###', '#..', '##.', '#..', '###'],
    T: ['###', '.#.', '.#.', '.#.', '.#.'],
  }
  const bandTop = proj([0, top, z0])[1]
  const bandBot = proj([0, G - 3.5, z0])[1]
  const letters = new Set()
  {
    const w = [...word].reduce((s, c, i) => s + F5[c][0].length + (i ? 1 : 0), 0)
    const xl = proj([x0, 0, z0])[0]
    const xr = proj([x1, 0, z0])[0]
    // Centred over the windows, not the whole front.
    const cx = Math.round((Math.max(0, xl) + xr) / 2) + 6
    let x = cx - Math.floor(w / 2)
    const y0 = Math.round((bandTop + bandBot) / 2 - 2.5)
    for (const c of word) {
      F5[c].forEach((row, j) => [...row].forEach((ch, i) => ch === '#' && letters.add(x + i + ',' + (y0 + j))))
      x += F5[c][0].length + 1
    }
  }
  const front = (P, x, y) => {
    const u = P[0] - x0
    const v = G - P[1]
    const cs = cellAt(P[2])
    if (v > 3.5) {
      if (v > 3.5 && v < 3.5 + Math.max(0.1, cs)) return mat(ORANGE, 'stripe')
      if (v > h - Math.max(0.12, cs)) return mat('#f2e9d6', 'shopCap')
      if (letters.has(x + ',' + y)) return lit ? { a: [1, 1, 1], k: 'shopInk', e: glow(M.shopSign), flat: true } : mat(CREAM, 'shopInk')
      return mat(TEAL, 'shopBand')
    }
    // The windows: two big panes each side of the door, mullions every 1.6 m.
    const win = (a, b) => u > a && u < b && v > 0.62 && v < 2.75
    const door = u > 9.6 && u < 10.9 && v < 2.4
    if (win(1.2, 9.2) || win(11.3, 15.6) || door) {
      const inFrame = (door ? Math.min(u - 9.6, 10.9 - u) : 9) < Math.max(0.07, cs) || v > (door ? 2.4 : 2.75) - Math.max(0.08, cs) || (!door && v < 0.62 + Math.max(0.08, cs))
      const mw = Math.max(0.06, cs * 0.8)
      const pane = (a, b) => u > a && u < b && ((u - a) % 1.6 < mw || u > b - cs || u < a + cs)
      const mull = !door && (pane(1.2, 9.2) || pane(11.3, 15.6))
      if (inFrame || mull) return mat('#b9bcc0', 'frame')
      if (M.shopLit) {
        // A lit room: shelves and a counter in silhouette against warm light.
        const shelf = !door && v < 1.8 && ((u > 2.0 && u < 4.4) || (u > 5.4 && u < 7.6) || (u > 12.0 && u < 14.8))
        if (shelf && Math.floor(v / 0.3) % 2 === 0) return { a: [0, 0, 0], k: 'room', e: glow(M.room[1]), flat: true }
        if (shelf) return { a: [0, 0, 0], k: 'room', e: glow(M.room[2]), flat: true }
        return { a: [0, 0, 0], k: 'room', e: glow(M.room[0]), flat: true }
      }
      // By day the glass shows the sky, lighter at the top, a pale streak across.
      const t = (v - 0.62) / 2.13
      const streak = Math.abs((u % 3.2) - t * 1.6 - 0.6) < Math.max(0.14, cs * 0.8)
      return { a: [0.06, 0.07, 0.08], k: 'glass', e: M.glassSky.map(c => c * (0.55 + 0.45 * t) * (streak ? 1.3 : 1)), glass: true }
    }
    if (v < 0.42) return mat('#a98d6c', 'plinth')
    // Stucco with a faint trowel texture.
    return mat(noise(u * 1.5, v * 2.2, 33) > 0.72 ? '#d3bc96' : '#dcc7a2', 'stucco')
  }
  const sideF = P => {
    const v = G - P[1]
    const w = z1 - P[2]
    if (v > 3.5) return mat(v < 3.5 + Math.max(0.1, cellAt(P[2])) ? ORANGE : TEAL, v < 3.62 ? 'stripe' : 'shopBand')
    if (w > 6.4 && w < 7.4 && v < 2.2) return mat('#6f7d82', 'sideDoor')
    if (v < 0.42) return mat('#a98d6c', 'plinth')
    return mat('#dcc7a2', 'stucco')
  }
  box(x0, x1, top, G, z0, z1, { front, px: sideF })
  // The roof's cap over the edge.
  box(x0 - 0.2, x1 + 0.2, top - 0.25, top, z0 - 0.2, z1 + 0.2, { all: () => mat('#f2e9d6', 'shopCap') })
  // An ice chest by the door and a bench under the right window.
  box(x0 + 16.0, x0 + 17.2, G - 0.95, G, z0 - 0.9, z0 - 0.15, { all: P => (G - P[1] > 0.82 ? mat('#d9dde0', 'chestLid') : mat('#eef0f0', 'chest')) })
  box(x0 + 11.6, x0 + 14.2, G - 0.48, G - 0.4, z0 - 0.7, z0 - 0.25, { all: () => mat('#8a6a4a', 'bench') })
  for (const bx of [x0 + 11.8, x0 + 13.9]) box(bx, bx + 0.1, G - 0.4, G, z0 - 0.6, z0 - 0.35, { all: () => mat('#4a4a4e', 'benchLeg') })
  if (M.shopLit) for (const wx of [x0 + 4, x0 + 8, x0 + 13.4]) M.lamps.push({ p: [wx, G - 1.3, z0 - 0.4], c: M.windowLight, r: 2.6, reach: 8, up: true })
}

// The pylon: a cabinet on two legs in a planter, its front parallel to the picture plane, the
// face painted from pylon.mjs cell by cell.
function pylon(lit) {
  const Z = PYZ
  const X0 = xAt(PY.x0, Z)
  const X1 = xAt(PY.x1 + 1, Z)
  const B = M.board
  const face = (P, x, y) => {
    const c = faceAt(x, y)
    switch (c) {
      case 'b':
        return mat(TEAL, 'pyBody')
      case 'm':
        return mat(TEAL_D, 'pyBody')
      case 't':
        return mat(CREAM, 'pyTrim')
      case 'o':
        return mat(ORANGE, 'pyOrange')
      case 's':
        return lit ? { a: [1, 1, 1], k: 'pyStrip', e: glow(B.strip), flat: true } : mat(CREAM, 'pyStrip')
      case 'i':
        return lit ? { a: [1, 1, 1], k: 'pyInk', e: glow(B.stripInk), flat: true } : mat('#163c40', 'pyInk')
      case 'f':
        return mat(CHAR, 'pyFrame')
      case 'l':
        return { a: [0, 0, 0], k: 'lcd', e: C(B.panel), flat: true, exact: true }
      case 'g':
        return mat(lit ? '#3c5458' : CREAM, 'pyFace')
      case 'h':
        return lit ? { a: [1, 1, 1], k: 'pyGlow', e: glow(B.neonGlow), flat: true } : mat(CREAM, 'pyFace')
      case 'n':
        return lit ? { a: [1, 1, 1], k: 'neon', e: glow(B.neonDim), flat: true } : mat(TEAL_D, 'pyLetter')
      case 'u':
        return lit ? { a: [1, 1, 1], k: 'neon', e: glow(B.neonDim), flat: true } : mat('#d6cfc2', 'pyTube')
      default:
        return mat(TEAL, 'pyBody')
    }
  }
  const sideC = P => mat(TEAL, 'pyBody')
  box(X0, X1, yAt(PY.y0, Z), yAt(PY.y1 + 1, Z), Z, Z + 0.6, { front: face, nx: sideC, top: sideC })
  // The cap: an orange crown over the sign.
  {
    const Zc = Z + 0.08
    box(xAt(PY.capX0, Zc), xAt(PY.capX1 + 1, Zc), yAt(PY.capY0, Zc), yAt(PY.y0, Zc), Zc, Zc + 0.44, { front: () => mat(ORANGE, 'pyCap'), nx: () => mat(ORANGE, 'pyCap'), top: () => mat(ORANGE, 'pyCap') })
  }
  // Two charcoal legs into a concrete planter with a few desert plants.
  const Zl = Z + 0.15
  for (const [a, b] of PY.legs) box(xAt(a, Zl), xAt(b + 1, Zl), yAt(PY.y1 + 1, Zl), G - 0.5, Zl, Zl + 0.3, { all: () => mat(CHAR, 'pyLeg') })
  const Zp = Z - 0.35
  box(xAt(PY.x0 + 1, Zp), xAt(PY.x1, Zp), G - 0.5, G, Zp, Zp + 1.2, {
    all: P => (G - P[1] > 0.42 ? mat('#e2dacb', 'planterCap') : mat('#bdb3a2', 'planter')),
  })
  const r = rng(31)
  const list = []
  for (let i = 0; i < 7; i++) list.push({ c: [lerp(X0 + 0.3, X1 - 0.3, i / 6) + (r() - 0.5) * 0.2, G - 0.62 - r() * 0.12, Zp + 0.35 + r() * 0.4], r: 0.17 + r() * 0.08, seed: i })
  blobs(list, (P, x, y) => mat(noise(x, y, 3) > 0.5 ? '#7d8a58' : '#647046', 'shrub'), { rough: 0.7, cast: false })
  // After dark the windows light the planter and the ground in front.
  if (lit) M.lamps.push({ p: [(X0 + X1) / 2, yAt(100, Z), Z - 0.5], c: M.pylonGlow, r: 2.4, reach: 7 })
}

// ---------------------------------------------------------------- the sky
// Bands of the moment's ramp, three rows tall up high and two by the horizon, bulging up round
// the sun or moon; the sun or moon itself; stars. One full layer, under everything.
export function paintSky(moment) {
  const Mo = moment
  const L = new Layer('sky')
  const edges = []
  for (let t = -80; t < 60; t += 3) edges.push(t)
  for (let t = 60; t < 260; t += 2) edges.push(t)
  const band = t => {
    let i = 0
    while (i < edges.length - 1 && edges[i + 1] <= t) i++
    return i
  }
  const cols = edges.map((e, i) => hexOf(rampC(Mo.sky, (e + (edges[i + 1] ?? e + 2)) / 2)))
  const Gl = Mo.glow
  const lift = (x, y) => (Gl ? Gl.lift * Math.exp(-(((x + 0.5 - Gl.x) / Gl.rx) ** 2) - (((y + 0.5 - Gl.y) / Gl.ry) ** 2)) : 0)
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
  // A soft glow in the air round the street lamp's head after dark: three rings over the sky.
  if (Mo.lampHalo) {
    const [hx, hy] = proj([LAMP.X, G - LAMP.h + 0.12, LAMP.headZ])
    const { c, k, r } = Mo.lampHalo
    for (let y = Math.floor(hy - r); y <= hy + r; y++) {
      for (let x = Math.floor(hx - r * 1.3); x <= hx + r * 1.3; x++) {
        const d = Math.hypot((x + 0.5 - hx) / 1.3, y + 0.5 - hy) / r
        if (d >= 1 || !L.has(x, y)) continue
        const ring = Math.ceil((1 - d) * 3) / 3
        L.set(x, y, mixHex(L.get(x, y), c, k * ring * ring))
      }
    }
  }
  if (Mo.stars) {
    const r = rng(211)
    const twinkle = []
    for (let i = 0; i < 150; i++) {
      const x = Math.floor(r() * W)
      const y = Math.floor(2 + Math.pow(r(), 1.4) * 104)
      if (Mo.moon && Math.hypot(x - Mo.moon.x, y - Mo.moon.y) < 12) continue
      if (i < 14) {
        const S = new Layer('star' + i)
        S.set(x, y, Mo.stars[0])
        if (i < 5) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) S.set(x + dx, y + dy, Mo.stars[2])
        const d = 5 * (1 + Math.floor(r() * 4))
        S.anim = { cls: 'tk', style: '--d:' + d + 's;--l:' + -Math.round(r() * d * 10) / 10 + 's' }
        twinkle.push(S)
      } else L.set(x, y, Mo.stars[r() < 0.35 ? 1 : 2])
    }
    extra.push(...twinkle)
    // A soft twinkle: down to 55% in two steps and back, never a blink.
    css.push('.tk{animation:tk var(--d) steps(1) calc(var(--l) + var(--m)) infinite}@keyframes tk{0%,86%{opacity:1}89%{opacity:.75}92%{opacity:.55}95%{opacity:.75}98%,100%{opacity:1}}')
  }
  return { layer: L, extra, css }
}
