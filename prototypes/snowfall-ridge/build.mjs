// Builds Snowfall Ridge: a mountain ridge, a spruce forest and a cabin under falling snow,
// as one pixel-art SVG per moment (morning, day, night) for the Claude desktop app's player.
// node build.mjs  ->  out/snowfall-ridge-<moment>.svg      (ONLY=morning,night for some)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { emitSafe } from './encode-local.mjs'
import { Layer, Scene, W, H, cull, fillCells, scrubbedLength } from './lib.mjs'
import { PALETTES } from './palettes.mjs'
import { css, smoke, snow, spindrift } from './motion.mjs'
import { at, blit, cloud, creek, forestBand, glow, lerp, massif, noise1, noise2, rays, rng, sky, snowfield, spruce, tone } from './paint.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const ONLY = process.env.ONLY?.split(',')

// ------------------------------------------------------------------ the ridge
const RIDGE = [
  { x: 204, y: 34, kl: 1.0, kr: 0.8, z: 9, spur: 0.22, w: 90, areteLen: 40 }, // the summit
  { x: 150, y: 62, kl: 0.95, kr: 0.72, z: 6, spur: 0.12, w: 60 },
  { x: 96, y: 56, kl: 0.88, kr: 0.92, z: 8, spur: 0.2, w: 70, areteLen: 30 },
  { x: 38, y: 76, kl: 0.8, kr: 0.8, z: 5, spur: 0.1, w: 60 },
  { x: 270, y: 54, kl: 0.82, kr: 0.75, z: 7, spur: 0.16, w: 70, areteLen: 24 },
  { x: 324, y: 72, kl: 0.8, kr: 0.8, z: 4, spur: 0.1, w: 60 },
]
const FAR = [
  { x: 6, y: 86, kl: 0.6, kr: 0.6, z: 1, spur: 0.1, rough: 0.5, gap: 0.3 },
  { x: 128, y: 84, kl: 0.55, kr: 0.6, z: 2, spur: 0.1, rough: 0.5, gap: 0.3 },
  { x: 178, y: 80, kl: 0.6, kr: 0.55, z: 1, spur: 0.1, rough: 0.5, gap: 0.3 },
  { x: 238, y: 84, kl: 0.6, kr: 0.6, z: 2, spur: 0.1, rough: 0.5, gap: 0.3 },
  { x: 300, y: 88, kl: 0.6, kr: 0.6, z: 1, spur: 0.1, rough: 0.5, gap: 0.3 },
]

// ------------------------------------------------------------------ the cabin
// Drawn around x 188..252 and moved into place: a log cabin seen from the front left, its
// gable toward the viewer, a deep roof of snow, a stone chimney, two windows and a door.
const CABIN_DX = 46
function cabin(L, P) {
  const C = P.cabin
  const R = P.roof
  const r = rng(77)
  const G = 170
  const ridgeY = x => lerp(141, 138, (x - 208) / 36)
  const eaveY = x => lerp(155, 152, (x - 220) / 30)
  // Side wall, in shade: logs two rows tall with a dark seam.
  for (let x = 218; x <= 247; x++) {
    for (let y = Math.round(eaveY(x)) + 1; y < G; y++) {
      const seam = (y - 156) % 2 === 1
      L.set(x, y, seam ? C.logShade[0] : C.logShade[(x * 5 + y) % 7 === 0 ? 1 : 2])
    }
  }
  // Front gable wall, lit: logs, their round ends at the corners.
  for (let x = 198; x <= 217; x++) {
    for (let y = 156; y < G; y++) {
      const seam = (y - 156) % 2 === 1
      L.set(x, y, seam ? C.log[0] : C.log[(x * 3 + y * 5) % 9 === 0 ? 1 : x < 201 ? 3 : 2])
    }
  }
  for (let y = 156; y < G; y += 2) {
    L.set(197, y, C.log[3])
    L.set(218, y, C.log[2])
  }
  // The gable: boards under the rake, and a round window.
  for (let y = 142; y < 156; y++) {
    const hw = ((y - 141) / 14) * 10.5
    for (let x = Math.ceil(207.5 - hw); x <= Math.floor(207.5 + hw); x++) L.set(x, y, x % 3 === 0 ? C.log[0] : C.log[x < 204 ? 2 : 1])
  }
  for (const [x, y, c] of [[207, 147, 'f'], [208, 147, 'f'], [206, 148, 'f'], [209, 148, 'f'], [206, 149, 'f'], [209, 149, 'f'], [207, 150, 'f'], [208, 150, 'f'], [207, 148, 2], [208, 148, 1], [207, 149, 1], [208, 149, 0]])
    L.set(x, y, c === 'f' ? C.frame : C.glass[c])
  // Windows: a frame, glass, a cross of bars, a sill of snow.
  const win = (x0, y0, w, h) => {
    for (let y = y0 - 1; y <= y0 + h; y++) for (let x = x0 - 1; x <= x0 + w; x++) L.set(x, y, C.frame)
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) L.set(x, y, C.glass[y < y0 + 2 ? 2 : y < y0 + h - 1 ? 1 : 0])
    for (let y = y0; y < y0 + h; y++) L.set(x0 + Math.floor(w / 2), y, C.bar)
    for (let x = x0; x < x0 + w; x++) L.set(x, y0 + Math.floor(h / 2), C.bar)
    for (let x = x0 - 2; x <= x0 + w + 1; x++) L.set(x, y0 + h + 1, R[x < x0 + w / 2 ? 4 : 3])
  }
  win(203, 159, 8, 6)
  win(225, 160, 7, 5)
  // The door.
  for (let y = 159; y < G; y++) for (let x = 237; x <= 243; x++) L.set(x, y, x === 237 || x === 243 || y === 159 ? C.frame : C.door[x === 238 || x === 241 ? 1 : 0])
  L.set(242, 165, C.glass[2])
  // The side roof under its snow: bright along the ridge, shaded toward the eave.
  for (let x = 208; x <= 251; x++) {
    const a = Math.round(ridgeY(x))
    const b = Math.round(eaveY(Math.max(x, 220)))
    for (let y = a; y <= b; y++) {
      if (x < 221 && y > 141 + ((x - 207.5) / 12.5) * 14 - 1) continue
      const q = (y - a) / Math.max(1, b - a)
      L.set(x, y, R[q < 0.2 ? 4 : q < 0.55 ? 3 : q < 0.85 ? 2 : 1])
    }
  }
  // The rake: thick snow along the front of the roof, lit on the left slope.
  for (let y = 139; y <= 156; y++) {
    const hw = ((y - 140) / 15) * 13
    for (const side of [-1, 1]) {
      const xe = 207.5 + side * hw
      for (let k = 0; k < 4; k++) {
        const x = Math.round(xe - side * k)
        L.set(x, y, k === 3 ? C.frame : side < 0 ? R[k === 2 ? 3 : 4] : R[k === 0 ? 2 : 3])
      }
    }
  }
  for (let x = 205; x <= 210; x++) L.set(x, 139, R[4])
  for (let x = 206; x <= 209; x++) L.set(x, 138, R[4])
  // The eave: an overhang with icicles.
  for (let x = 220; x <= 252; x++) {
    const y = Math.round(eaveY(x))
    L.set(x, y + 1, R[0])
    L.set(x, y + 2, C.frame)
    if (x % 3 === 0 || r() < 0.2) {
      const len = 1 + Math.floor(r() * 3)
      for (let k = 3; k < 3 + len; k++) L.set(x, y + k, k === 2 + len ? C.ice[0] : C.ice[1])
    }
  }
  // The chimney: stones, a cap of snow.
  for (let y = 131; y < 147; y++) {
    for (let x = 233; x <= 238; x++) {
      if (y > ridgeY(x) + 1 && x > 236) continue
      const mortar = y % 3 === 0 || (x + (Math.floor(y / 3) % 2) * 2) % 4 === 0
      L.set(x, y, mortar ? C.stone[0] : C.stone[x === 233 ? 3 : x < 236 ? 2 : 1])
    }
  }
  for (let x = 232; x <= 239; x++) L.set(x, 130, R[x < 236 ? 4 : 3])
  for (let x = 233; x <= 238; x++) L.set(x, 129, R[x < 236 ? 4 : 2])
  // A woodpile under the gable's eave.
  for (let y = 163; y < G; y++) for (let x = 189; x <= 195; x++) L.set(x, y, (x + y) % 3 === 0 ? C.log[0] : C.wood[(x * 7 + y * 3) % 2])
  for (let x = 188; x <= 196; x++) L.set(x, 162, R[4])
  // Snow drifted against the walls.
  for (let x = 186; x <= 254; x++) {
    const h = 1 + Math.round((Math.sin(x * 0.4) + 1) * 1.1 + r() * 0.8)
    for (let k = 0; k < h; k++) L.set(x, G - k, P.ground[k === h - 1 ? 5 : 4])
  }
}

// Footprints from the door toward the viewer.
function tracks(L, P) {
  const pts = []
  for (let t = 0; t <= 1; t += 0.035) pts.push([lerp(240 + CABIN_DX, 214 + CABIN_DX, t * t) + Math.sin(t * 9) * 2, lerp(172, 200, t)])
  pts.forEach(([x, y], i) => {
    const s = i % 2 ? 1 : -1
    L.set(Math.round(x + s), Math.round(y), P.ground[1])
    L.set(Math.round(x + s + 1), Math.round(y), P.ground[2])
  })
}

// ------------------------------------------------------------------ the scene for one moment
const SUN = { x: 54, y: 85 }

function compose(P) {
  const S = new Scene()
  const layers = []
  const add = L => {
    layers.push(L)
    return L
  }
  const html = h => layers.push({ html: h })

  // The light in the sky: a glow, rays fanning from the low sun, the sun itself; at night
  // stars (a few of them dimming now and then) and the moon.
  if (P.glow) html(glow(P.glow))
  if (P.skyRays) for (const g of rays({ ...P.skyRays, y0: -10, y1: 120 })) html(fillCells(g.cells, P.skyRays.color, g.opacity))
  if (P.sun) {
    const sun = new Layer('sun')
    for (let y = -9; y <= 9; y++) {
      for (let x = -9; x <= 9; x++) {
        const d = Math.hypot(x + 0.5, y + 0.5)
        const c = d < 5 ? P.sun.disc[2] : d < 7 ? P.sun.disc[1] : d < 8 ? P.sun.disc[0] : null
        if (c) sun.set(P.sun.x + x, P.sun.y + y, c)
      }
    }
    add(sun)
  }
  if (P.stars) {
    const r = rng(211)
    const T = P.stars.tones
    const still = add(new Layer('stars'))
    for (let i = 0; i < 120; i++) {
      const x = Math.floor(r() * W)
      const y = Math.floor(18 + Math.pow(r(), 1.2) * 100)
      if (i < 12) {
        const L = new Layer('star' + i)
        L.set(x, y, T[0])
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) L.set(x + dx, y + dy, T[2])
        const d = 5 * (1 + Math.floor(r() * 4))
        L.anim = { cls: 'tk', style: '--d:' + d + 's;--l:' + -Math.round(r() * d * 10) / 10 + 's' }
        layers.push(L)
      } else still.set(x, y, T[r() < 0.3 ? 1 : r() < 0.6 ? 2 : 3])
    }
  }
  if (P.moon) {
    const M = P.moon
    const moon = add(new Layer('moon'))
    const craters = new Set(['-3,-1', '-2,-1', '1,2', '2,2', '-1,3', '2,-3', '3,-2'])
    for (let y = -9; y < 9; y++) {
      for (let x = -9; x < 9; x++) {
        const dx = x + 0.5
        const dy = y + 0.5
        const d = Math.hypot(dx, dy)
        const R = 6.5
        if (d < R) {
          const nz = Math.sqrt(R * R - d * d) / R
          let v = 0.55 + 0.45 * ((-dx / R) * 0.5 + (-dy / R) * 0.6 + nz * 0.6)
          if (craters.has(x + ',' + y)) v -= 0.3
          moon.set(M.x + x, M.y + y, tone(M.tones, v, x, y, 0.5))
        } else if (d < R + 1.6 && (x + y) % 2 === 0) moon.set(M.x + x, M.y + y, M.halo)
      }
    }
  }

  // High clouds, drifting right a cell a second.
  const cr = rng(61)
  ;[
    { seed: 1, puffs: [{ x: 30, y: 46, rx: 30, ry: 2.4 }, { x: 52, y: 43, rx: 20, ry: 3.6 }, { x: 70, y: 40, rx: 12, ry: 3 }, { x: 80, y: 46, rx: 22, ry: 2.2 }, { x: 104, y: 48, rx: 14, ry: 1.6 }] },
    { seed: 2, puffs: [{ x: 128, y: 30, rx: 16, ry: 1.8 }, { x: 140, y: 28, rx: 10, ry: 2.6 }, { x: 150, y: 31, rx: 12, ry: 1.6 }] },
    { seed: 3, puffs: [{ x: 244, y: 32, rx: 26, ry: 2.4 }, { x: 262, y: 28, rx: 16, ry: 4 }, { x: 278, y: 26, rx: 10, ry: 3.4 }, { x: 290, y: 31, rx: 20, ry: 2.4 }] },
    { seed: 4, puffs: [{ x: 300, y: 46, rx: 22, ry: 1.8 }, { x: 312, y: 44, rx: 10, ry: 2.2 }] },
  ].forEach((c, i) => {
    const L = new Layer('cloud' + i)
    cloud(L, c, P.cloud)
    const xs = c.puffs.flatMap(p => [p.x - p.rx, p.x + p.rx])
    const a = -Math.round(Math.max(...xs) + 40)
    const b = Math.round(W - Math.min(...xs) + 40)
    const d = b - a
    const home = Math.round(-a + 0)
    L.anim = { cls: 'dr', style: '--a:' + a + 'px;--b:' + b + 'px;--d:' + d + 's;--n:' + d + ';--l:-' + home + 's' }
    layers.push(L)
  })

  const far = add(new Layer('far'))
  massif(far, FAR, { seed: 31, base: 128, tones: P.far, haze: P.farHaze, hazeColor: P.haze })
  const ridge = add(new Layer('ridge'))
  massif(ridge, RIDGE, { seed: 5, base: 136, tones: P.ridge, footHaze: 0.7, footH: 28, hazeColor: P.haze, litLine: P.litLine })

  const band1 = add(new Layer('band1'))
  forestBand(band1, { seed: 3, y: 121, h: [5, 11], gap: [3, 6], wave: 6, bottom: 134, tones: P.bandFar, snowTop: 0.6 })
  const band2 = add(new Layer('band2'))
  forestBand(band2, { seed: 4, y: 129, h: [7, 14], gap: [4, 8], wave: 7, bottom: 138, tones: P.band, snowTop: 0.7 })

  // The valley floor in long drifts.
  const field = add(new Layer('field'))
  const wn = noise1(19)
  snowfield(field, { top: 134, bottom: 201, tones: P.ground, v0: 0.72, v1: 0.52, relief: 0.07, period: [6, 0.4], wav: x => wn(x * 0.012) * 26 + Math.sin(x * 0.04) * 3 })
  // Long shadows of the trees and the cabin, cast to the right.
  for (const [x, y, len, w] of [[100, 150, 24, 3], [86, 156, 30, 4], [69, 163, 40, 5], [50, 171, 50, 6], [112, 146, 18, 2], [168, 141, 14, 2], [176, 142, 10, 1], [226, 152, 20, 3], [240, 157, 26, 3], [298, 171, 40, 5]]) {
    for (let t = 0; t < len; t++) {
      const hw = Math.max(0.5, w * Math.pow(1 - t / len, 0.6))
      const yc = y + t * 0.1
      for (let yy = Math.round(yc - hw * 0.4); yy <= Math.round(yc + hw * 0.4); yy++) if (field.has(x + t, yy)) field.set(x + t, yy, P.ground[2])
    }
  }

  const water = add(new Layer('creek'))
  const glints = creek(water, { path: [[150, 134], [140, 140], [128, 148], [134, 158], [120, 170], [104, 186], [96, 200]], w0: 2, w1: 10 }, P)

  // Shafts of sunlight falling across the valley.
  if (P.shafts) for (const g of rays({ ...P.shafts, y0: 118, y1: 201 })) html(fillCells(g.cells, P.shafts.color, g.opacity))

  // Mist over the far forest, breathing sideways.
  const mist = [[], []]
  for (const [x0, y0, len, th] of [[-30, 117, 90, 3], [70, 121, 70, 2], [150, 113, 60, 2], [196, 124, 96, 3], [120, 127, 50, 2], [270, 116, 70, 2]]) {
    for (let j = -th; j <= th; j++) {
      const k = 1 - Math.abs(j) / (th + 1)
      const a = Math.round(x0 + len * (1 - k) * 0.5 + (j > 0 ? 3 : -2))
      const b = Math.round(x0 + len - len * (1 - k) * 0.45)
      for (let x = a; x < b; x++) mist[Math.abs(j) <= th / 2 && x > a + 3 && x < b - 3 ? 1 : 0].push([x, y0 + j])
    }
  }
  // Both parts have one colour and one opacity, so they are one path: two translucent paths
  // that abut show a seam where they meet.
  layers.push({ html: '<g class="mi">' + fillCells(mist[0].concat(mist[1]), P.mist[0], P.mist[1]) + '</g>' })
  // Glints on the water.
  const gr = rng(41)
  for (let k = 0; k < 9; k++) {
    const [x, y] = glints[Math.floor(gr() * glints.length)]
    const L = new Layer('glint' + k)
    L.set(x, y, P.water.spark)
    const d = 5 * (1 + Math.floor(gr() * 3))
    L.anim = { cls: 'gl', style: '--d:' + d + 's;--l:' + -Math.round(gr() * d * 10) / 10 + 's', extra: ' opacity="0"' }
    layers.push(L)
  }
  layers.push(...spindrift([[206, 36], [210, 39], [214, 42], [219, 46], [208, 38], [224, 50]], P))
  layers.push(snow(0, P))

  // A stand of spruce on the left, smaller ones out in the valley.
  const left = add(new Layer('left'))
  for (const t of [
    { x: 168, base: 141, h: 11, seed: 11 },
    { x: 176, base: 142, h: 8, seed: 12 },
    { x: 112, base: 146, h: 14, seed: 1 },
    { x: 100, base: 150, h: 20, seed: 3, lean: 1 },
    { x: 86, base: 156, h: 27, seed: 4 },
    { x: 69, base: 163, h: 42, seed: 5, lean: -1 },
    { x: 50, base: 171, h: 58, seed: 6 },
    { x: 24, base: 184, h: 86, seed: 7, w: 28 },
    { x: 0, base: 198, h: 124, seed: 8, w: 38, lean: 1 },
  ]) spruce(left, t, P)

  // Trees behind the cabin and to its right.
  const right = add(new Layer('right'))
  for (const t of [
    { x: 226, base: 152, h: 22, seed: 21 },
    { x: 240, base: 157, h: 34, seed: 22, lean: 1 },
    { x: 268, base: 150, h: 34, seed: 26 },
    { x: 286, base: 152, h: 40, seed: 27, lean: -1 },
    { x: 302, base: 162, h: 54, seed: 23 },
    { x: 318, base: 170, h: 76, seed: 24, w: 26 },
  ]) spruce(right, t, P)

  const house = add(new Layer('cabin'))
  const tmp = new Layer('tmp')
  cabin(tmp, P)
  blit(house, tmp, CABIN_DX, 0)

  // At night the windows glow, and their light lies on the snow in front.
  if (P.window) {
    const X = CABIN_DX
    html(glow({ x: 207 + X, y: 162, rx: 13, ry: 9, colors: [P.window.halo, P.window.halo, P.window.halo], opacity: [0.07, 0.09, 0.12] }))
    html(glow({ x: 228.5 + X, y: 162.5, rx: 11, ry: 8, colors: [P.window.halo, P.window.halo, P.window.halo], opacity: [0.07, 0.09, 0.12] }))
    // Each window's light lands on the snow as a skewed copy of the window, fading outward.
    const pools = [[], [], []]
    for (const [wx, ww, skew] of [[203 + X, 8, -0.9], [225 + X, 7, 0.6]]) {
      for (let j = 0; j < 9; j++) {
        const y = 172 + j
        const k = j < 3 ? 0 : j < 6 ? 1 : 2
        const x0 = Math.round(wx - 1 + skew * j - j * 0.3)
        const x1 = Math.round(wx + ww + skew * j + j * 0.3)
        for (let x = x0; x <= x1; x++) pools[Math.min(2, k + (x === x0 || x === x1 ? 1 : 0))].push([x, y])
      }
    }
    pools.forEach((c, i) => html(fillCells(c, P.window.color, [0.22, 0.14, 0.07][i])))
  }

  layers.push(...smoke(282, 126, P))
  layers.push(snow(1, P))

  // The foreground drift.
  const front = add(new Layer('front'))
  const edge = x => 186 + 5 * Math.sin(x * 0.03 + 1) + 2.5 * Math.sin(x * 0.11)
  snowfield(front, { top: 182, bottom: 201, tones: P.ground, v0: 0.62, v1: 0.5, relief: 0.06, period: [8, 0.5], wav: x => Math.sin(x * 0.04) * 3, edge })
  for (const k of [...front.m.keys()]) {
    const [x, y] = at(k)
    if (y === Math.ceil(edge(x))) front.m.set(k, P.ground[5])
  }
  tracks(front, P)
  // Sparkles in the snow.
  const sr = rng(57)
  for (let k = 0; k < (P.sparkles ?? 10); k++) {
    const x = Math.round(lerp(110, 236, sr()))
    const y = Math.round(lerp(150, 199, sr()))
    const L = new Layer('sparkle' + k)
    L.set(x, y, P.sparkle)
    const d = 5 * (1 + Math.floor(sr() * 3))
    L.anim = { cls: 'gl', style: '--d:' + d + 's;--l:' + -Math.round(sr() * d * 10) / 10 + 's', extra: ' opacity="0"' }
    layers.push(L)
  }
  layers.push(snow(2, P))

  if (process.env.COST) for (const L of layers) if (L.m) console.log(L.name.padEnd(8), emitSafe(L).length)
  cull(layers)
  S.add('', [{ html: sky(P) }])
  S.add('pB', layers)
  return S
}

// ------------------------------------------------------------------ assemble
const PIN = { '': 'xMidYMid', pB: 'xMidYMax' }
const view = pin => '<svg viewBox="0 -.5 ' + W + ' ' + H + '" preserveAspectRatio="' + PIN[pin] + ' slice">'

function assemble(S, css) {
  let body = ''
  let pin = null
  for (const p of S.parts) {
    const html = S.render(p.items)
    if (p.pin !== pin) {
      if (pin !== null) body += '</svg>'
      body += view(p.pin)
      pin = p.pin
    }
    body += html
  }
  if (pin !== null) body += '</svg>'
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" font-family="a" color="a" style="--m:0s">' +
    '<style>' + css + '</style><defs>' + S.defs.join('') + '</defs>' + body + '</svg>'
  return svg.replaceAll('"', "'")
}

const CSS = css()
const LIMIT = 131072 - 200
fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true })
for (const [name, P] of Object.entries(PALETTES)) {
  if (ONLY && !ONLY.includes(name)) continue
  const S = compose(P)
  const svg = assemble(S, CSS)
  const scrubbed = scrubbedLength(svg, CSS)
  fs.writeFileSync(path.join(ROOT, 'out', 'snowfall-ridge-' + name + '.svg'), svg)
  console.log(name, svg.length, 'chars,', scrubbed, 'after the scrub', scrubbed <= LIMIT ? 'OK' : 'TOO BIG', '| patterns', S.stats.patterns, 'runs', S.stats.patternRuns + S.stats.plainRuns)
}
