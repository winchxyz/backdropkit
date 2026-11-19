// Gas Station: a lonely roadside filling station on a desert highway, with a price pylon whose
// three windows show live Claude figures. One animated pixel-art SVG in three moments.
// node build.mjs [moment ...]  ->  out/gas-station-<moment>.svg and out/board.json
//   PREVIEW=1  also writes out/debug/preview-<moment>.png straight from the cells (4x)
//   STATS=1    lists the heaviest layers
//   KEYS=1     counts run starts per material key (where the size goes)
//   PROBE="x,y;..."  prints a cell's material, position and lit colour
//   SIZES=1    lists the 25 longest drawn layers: encoded length, cells, colours
// Also writes out/debug/keys.json, the key light and shadow arrows debug.mjs draws.
//
// The method is Side Street's (../side-street/build.mjs): the scene is modelled in metres
// (scene.mjs) and drawn by a small renderer (core.mjs) onto the 320 x 200 cell grid; here each
// cell is lit by the moment's sun or moon, sky and lamps, shadowed (lamps too), hazed with
// distance and rim-lit against the light; each material's cells are cut down to a few colours;
// and the cells are encoded as 1-cell stroke runs, at most 64 a path, big still layers in
// patterns, CSS motion in steps on a 0.05 s clock, through ./encode-local.mjs so no hairline
// shows between cells at any window size.
//
// The board: the still scene paints the pylon's three windows (pylon.mjs); right after the
// still scene comes the empty marker <g id='bk-board'></g> at the top level of the nested Svg,
// and out/board.json tells the theme mod where to draw the digits (engine/board.mjs).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Layer, bayer, bounds, clamp, hex, rgb } from '../../../sunfield/tools/pixel.mjs'
import { MARKER, checkBoard } from '../../engine/board.mjs'
import * as core from './core.mjs'
import { emitSafe } from './encode-local.mjs'
import { C, H, HX, HY, F, N, W, E, add, begin, dot, lum, mixc, mul, norm, ramp, shadowed, sub } from './core.mjs'
import { MOMENTS } from './moments.mjs'
import { paintSprites } from './motion.mjs'
import { png } from './png.mjs'
import { ROWS } from './pylon.mjs'
import { CAN, ISL, LAMP, PYZ, paintScene, paintSky } from './scene.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROW = 4096
const cellXY = k => [(k % ROW) - 1000, Math.floor(k / ROW) - 1000]
const keyOf = (x, y) => (y + 1000) * ROW + x + 1000
const f2 = v => String(Math.round(v * 100) / 100).replace(/^0\./, '.').replace(/^-0\./, '-.')

// ---------------------------------------------------------------- key lights
// One key light per moment (prototypes/_refs/lighting.md, rule 1). Azimuth is the sun's bearing
// seen from above, in degrees from straight ahead (+Z), positive to the right, 180 behind the
// viewer; elevation in degrees over the horizon. Colours and shadow (sky) colours: moments.mjs.
const KEY = {
  // Early afternoon: high (55 degrees), behind us on the right. Fronts and right-hand faces lit,
  // shadows fall back and to the left.
  day: { azimuth: 150, elevation: 55 },
  // Sunset: the sun in the frame at cell (196, 117), about 2 degrees up, ahead of us a little
  // right: backlit, shadows long and fanning toward us.
  sunset: { cell: [196, 117], lift: 0 },
  // Night: the moon in the frame at cell (58, 34), high ahead on the left; faint and cool.
  night: { cell: [58, 34], lift: -0.2 },
}
function keyDir(K) {
  if (K.cell) return norm([(K.cell[0] - HX) / F, (K.cell[1] - HY) / F + K.lift, 1])
  const a = (K.azimuth * Math.PI) / 180
  const e = (K.elevation * Math.PI) / 180
  return [Math.sin(a) * Math.cos(e), -Math.sin(e), Math.cos(a) * Math.cos(e)]
}
for (const [name, K] of Object.entries(KEY)) if (MOMENTS[name]?.sun) MOMENTS[name].sun.d = keyDir(K)

// ---------------------------------------------------------------- lighting

// How much of the sun reaches P: four rays toward a sun widened to a small disc, so shadow
// edges are hard by the thing that throws them and soften (and dither) further off.
// On the ground (dz > 0) the four rays also start spread over the cell's depth, since one row
// of a far lot covers more than half a metre and a thin pole's shadow would otherwise break up.
function sunVisible(P, d, soft, dz = 0) {
  if (!soft) return shadowed(P, d) ? 0 : 1
  const a = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const e1 = norm([d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]])
  const e2 = [d[1] * e1[2] - d[2] * e1[1], d[2] * e1[0] - d[0] * e1[2], d[0] * e1[1] - d[1] * e1[0]]
  const at = k => (dz ? [P[0], P[1], P[2] + dz * k] : P)
  let n = shadowed(at(-0.125), d) ? 0 : 1
  const offs = [-0.375, 0.375, 0.125]
  ;[[0.87, 0.5], [-0.87, 0.5], [0, -1]].forEach(([u, v], i) => {
    if (!shadowed(at(offs[i]), norm(add(d, add(mul(e1, u * soft), mul(e2, v * soft)))))) n++
  })
  return n / 4
}

// The colour of one fragment under the moment's light, before haze.
function shadeFrag(f, M, o = {}) {
  const P = f.p
  const n = f.n
  const up = clamp(-n[1], -1, 1)
  let c = mixc(M.ambDown, M.ambUp, 0.5 + 0.5 * up)
  if (f.ao) c = mul(c, f.ao)
  let inSun = false
  if (M.sun) {
    const ndl = dot(n, M.sun.d)
    if (ndl > 0) {
      const dz = n[1] < -0.9 && P[1] > 0.3 ? (P[2] * P[2]) / (F * P[1]) : 0
      let vis = o.noShadow ? 1 : sunVisible(P, M.sun.d, M.sun.soft, Math.min(dz, 2))
      // Where one row is a deep strip of ground a part-shadow would only dither into dashes:
      // the cell is in shadow or not.
      if (dz > 0.3) vis = vis >= 0.5 ? 1 : 0
      if (vis > 0) {
        c = add(c, mul(M.sun.c, ndl * vis))
        inSun = vis > 0.5
      }
    }
  }
  for (const L of o.lamps ?? M.lamps ?? []) {
    const d = sub(L.p, P)
    const dist = Math.hypot(d[0], d[1], d[2])
    if (dist > L.reach) continue
    const dn = mul(d, 1 / dist)
    let ndl = dot(n, dn)
    if (L.up) ndl *= Math.max(0, -n[1]) // lights only what faces up (the ground)
    if (ndl <= 0) continue
    let fall = Math.max(0, 1 / (1 + (dist / L.r) ** 2) - 1 / (1 + (L.reach / L.r) ** 2))
    if (L.cone) {
      // A lamp's shade: light falls in a cone round its axis (straight down unless L.dir),
      // soft at its edge.
      const cs = L.dir ? -dot(dn, L.dir) : -dn[1]
      if (cs <= L.cone[0]) continue
      const t = Math.min(1, (cs - L.cone[0]) / (L.cone[1] - L.cone[0]))
      fall = (t * t * (3 - 2 * t)) / (1 + (dist / L.r) ** 2)
    }
    if (fall < 0.004) continue
    if (L.shadow && !o.noShadow && shadowed(P, dn, dist - 0.12)) continue
    c = add(c, mul(L.c, ndl * fall))
  }
  let col = [f.a[0] * c[0], f.a[1] * c[1], f.a[2] * c[2]]
  // A glare on the asphalt toward a low sun.
  if (f.spec && M.spec && inSun) {
    const v = norm(P)
    const rf = sub(v, mul(n, 2 * dot(v, n)))
    const s = Math.max(0, dot(rf, M.sun.d)) ** M.spec.p * M.spec.k * f.spec
    col = add(col, mul(M.sun.c, s))
  }
  if (f.e) col = add(col, f.e)
  return { col, inSun }
}

function haze(M, col, Z, y) {
  const h = (1 - Math.exp(-Z / M.haze.d)) * M.haze.k
  return mixc(col, M.haze.c, h)
}

// Lights every cell of the depth buffer; then contact shadows, the rim pass and bloom.
function lightBuffer(M, o = {}) {
  const gf = core.gf
  const gz = core.gz
  const out = new Array(N).fill(null)
  const sunLit = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    const f = gf[i]
    if (!f) continue
    const y = Math.floor(i / W)
    if (f.exact) {
      out[i] = [...f.e]
      continue
    }
    if (f.flat) {
      out[i] = haze(M, f.e ? [...f.e] : [...f.a], f.p[2], y)
      continue
    }
    const { col, inSun } = shadeFrag(f, M, o)
    sunLit[i] = inSun ? 1 : 0
    out[i] = col
  }
  // Contact shadows: a dark, cool seam where an upright thing meets the ground (rule 3), the
  // ground cell right under a wall, post, pump or kerb standing at the same depth.
  if (M.contact && !o.noContact) {
    for (let i = W; i < N; i++) {
      const f = gf[i]
      const g = gf[i - W]
      if (!f || !g || !out[i] || f.flat || g.flat || f.n[1] > -0.8 || Math.abs(g.n[1]) > 0.5) continue
      if (Math.abs(gz[i - W] - gz[i]) > gz[i] * 0.03 + 0.08) continue
      out[i] = out[i].map((v, k) => v * M.contact[k])
    }
  }
  if (M.rim) {
    for (let i = 0; i < N; i++) {
      const f = gf[i]
      if (!f || f.flat || f.rim === false || !out[i]) continue
      const x = i % W
      const y = Math.floor(i / W)
      const [dx, dy] = M.rim.dir(x, y)
      const xj = x + dx
      if (xj < 0 || xj >= W || y + dy < 0 || y + dy >= H) continue
      const j = (y + dy) * W + xj
      const far = !gf[j] || gz[j] > gz[i] * 1.6 + 1.5
      if (!far) continue
      if (M.sun && !sunLit[i] && shadowed(f.p, M.sun.d)) continue
      out[i] = add(out[i], mul(M.rim.c, f.rimK ?? 1))
    }
  }
  // A soft bloom round bright lamps, signs and windows close by.
  if (M.bloom && !o.noBloom) {
    const add2 = new Map()
    for (let i = 0; i < N; i++) {
      const f = gf[i]
      if (!f || !out[i] || !f.flat || f.exact || f.glass || f.p[2] > 60 || lum(out[i]) < 0.55) continue
      const x = i % W
      const y = Math.floor(i / W)
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const d = Math.hypot(dx, dy)
          if (d > 3.2 || d === 0) continue
          const j = (y + dy) * W + x + dx
          if (x + dx < 0 || x + dx >= W || y + dy < 0 || y + dy >= H || !gf[j] || gf[j].flat) continue
          const w = M.bloom * (1 - d / 3.4) ** 2
          const a = add2.get(j) ?? [0, 0, 0]
          add2.set(j, add(a, mul(out[i], w)))
        }
      }
    }
    for (const [j, a] of add2) out[j] = add(out[j], a.map(v => Math.min(v, 0.35)))
  }
  for (let i = 0; i < N; i++) if (out[i] && !gf[i].flat) out[i] = haze(M, out[i], gf[i].p[2], Math.floor(i / W))
  if (M.grade) for (let i = 0; i < N; i++) if (out[i] && !gf[i].exact) out[i] = grade(M.grade, out[i])
  return out
}

// One fragment, lit without shadows (sprites painted at cells of their own).
function lightOne(M, f, y) {
  if (f.exact) return [...f.e]
  if (f.flat) return grade(M.grade, haze(M, f.e ? [...f.e] : [...f.a], f.p[2], y))
  return grade(M.grade, haze(M, shadeFrag(f, M, { noShadow: true }).col, f.p[2], y))
}

// A colour grade: saturation, then a lift in the shadows and a gain in the lights.
function grade(G, c) {
  if (!G) return c
  const l = 0.3 * c[0] + 0.55 * c[1] + 0.15 * c[2]
  const s = c.map(v => l + (v - l) * G.sat)
  return s.map((v, i) => clamp(v * (G.gain?.[i] ?? 1) + (G.lift?.[i] ?? 0) * (1 - Math.min(1, l * 1.6)), 0, 1))
}

// ---------------------------------------------------------------- palettes
// The cells of one material key share a few colours: k-means over their lit colours, then each
// cell takes the nearer of its two closest colours, dithered where the key asks for it.
const KS = { road: 5, lot: 6, sand: 5, plain: 5, mesa: 6, talus: 4, range: 4, shrub: 5, scrubFar: 2, glass: 4, room: 3, stucco: 5, soffit: 5, fascia: 4, gravel: 4, grass: 3, joint: 3, pyBody: 4, apron: 4, truck: 6, rimHole: 1, sky: 1 }
const DITHER = { road: 0.3, lot: 0.3, sand: 0.4, plain: 0.45, mesa: 0.3, talus: 0.35, range: 0.35, soffit: 0.25, gravel: 0.25, apron: 0.25, stucco: 0.2, fascia: 0.15, shrub: 0.3 }
let ditherNow = DITHER
const zoneOf = Z => (Z < 12 ? 'a' : Z < 40 ? 'b' : Z < 400 ? 'c' : 'd')

function kmeans(cols, k) {
  const pts = cols.map(c => c.map(v => v * 255))
  const uniq = new Map()
  for (const p of pts) uniq.set(p.map(Math.round).join(','), p)
  const u = [...uniq.values()]
  if (u.length <= k) return u
  // Seeds spread by lightness.
  const sorted = [...pts].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]))
  let cent = []
  for (let i = 0; i < k; i++) cent.push([...sorted[Math.floor(((i + 0.5) / k) * sorted.length)]])
  for (let it = 0; it < 12; it++) {
    const sum = cent.map(() => [0, 0, 0, 0])
    for (const p of pts) {
      let b = 0
      let bd = Infinity
      for (let j = 0; j < cent.length; j++) {
        const d = (p[0] - cent[j][0]) ** 2 + (p[1] - cent[j][1]) ** 2 + (p[2] - cent[j][2]) ** 2
        if (d < bd) {
          bd = d
          b = j
        }
      }
      sum[b][0] += p[0]
      sum[b][1] += p[1]
      sum[b][2] += p[2]
      sum[b][3]++
    }
    cent = sum.filter(s => s[3]).map(s => [s[0] / s[3], s[1] / s[3], s[2] / s[3]])
  }
  return cent
}

function quantize(groups, fixed = new Map()) {
  // groups: Map key -> [{ i (cell key), col, x, y }]; returns Map cellKey -> hex
  const out = new Map()
  const palettes = new Map()
  for (const [key, cells] of groups) {
    const base = key.split('|')[0]
    let cent = fixed.get(key)
    if (!cent) {
      cent = kmeans(cells.map(c => c.col), KS[base] ?? 4)
      palettes.set(key, cent)
    }
    const amt = ditherNow[base] ?? 0
    for (const c of cells) {
      const p = c.col.map(v => v * 255)
      let a = 0
      let b = 0
      let da = Infinity
      let db = Infinity
      for (let j = 0; j < cent.length; j++) {
        const d = (p[0] - cent[j][0]) ** 2 + (p[1] - cent[j][1]) ** 2 + (p[2] - cent[j][2]) ** 2
        if (d < da) {
          db = da
          b = a
          da = d
          a = j
        } else if (d < db) {
          db = d
          b = j
        }
      }
      let pick = a
      if (amt && cent.length > 1 && db < Infinity) {
        // Where the colour sits between its two nearest, an ordered dither between them.
        const t = Math.sqrt(da) / (Math.sqrt(da) + Math.sqrt(db))
        if (t + bayer(c.x, c.y) * amt > 0.5) pick = b
      }
      out.set(c.i, hex(cent[pick]))
    }
  }
  return { out, palettes }
}

// ---------------------------------------------------------------- the light check
// For out/debug (debug.mjs draws it): where the key light is, and for things standing on the
// ground the way their shadows must fall, as screen arrows in cells from base to shadow tip.
const checks = {}
function lightCheck(name, M) {
  const K = KEY[name]
  const L = M.sun.d.map(v => -v)
  const out = { name, label: '', light: null, arrows: [] }
  const tipOf = (X, Z, h) => {
    const top = [X, E - h, Z]
    const t = h / L[1]
    let S = [top[0] + L[0] * t, E, top[2] + L[2] * t]
    let len = Math.hypot(S[0] - X, S[2] - Z)
    if (len > 9) S = [X + ((S[0] - X) * 9) / len, E, Z + ((S[2] - Z) * 9) / len]
    len = Math.hypot(S[0] - X, S[2] - Z)
    if (S[2] < 5) S = [X + ((S[0] - X) * (Z - 5)) / (Z - S[2]), E, 5]
    return [core.proj([X, E, Z]), core.proj(S)]
  }
  const things = [
    [7.4, PYZ + 0.3, 7.5],
    ...ISL.map(i => [i.col, 21.6, 4.8]),
    ...ISL.flatMap(i => i.pumps.map(p => [p, 21.6, 2.0])),
    [LAMP.X, LAMP.Z, LAMP.h],
  ]
  for (const [X, Z, h] of things) {
    const [a, b] = tipOf(X, Z, h)
    out.arrows.push([a[0], a[1], b[0], b[1]])
  }
  if (K.cell) {
    out.light = { x: K.cell[0], y: K.cell[1] }
    out.label = (name === 'night' ? 'moon' : 'sun') + ' at cell ' + K.cell.join(', ')
  } else {
    // Off the frame: an arrow in from the side the light comes from, along a ray of it across
    // the picture (through a point in the air over the lot).
    const g = [2, 0, 20]
    const a = core.proj(g)
    const b = core.proj([g[0] + L[0] * 2, g[1] + L[1] * 2, g[2] + L[2] * 2])
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    out.light = { off: true, dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] }
    out.label = 'sun ' + K.elevation + ' deg up, behind us on the right'
  }
  return out
}

// ---------------------------------------------------------------- the picture

function build(name) {
  const M = MOMENTS[name]
  ditherNow = { ...DITHER, ...(M.dither ?? {}) }
  begin()
  const scene = paintScene(M)
  checks[name] = lightCheck(name, M)
  scene.sprites = paintSprites(M, scene, name)
  const staticCasters = core.casters.slice()
  const lit = lightBuffer(M)
  if (process.env.PROBE) for (const xy of process.env.PROBE.split(';')) { const [x, y] = xy.split(',').map(Number); const f = core.gf[y * W + x]; console.log('probe', x, y, f && f.k, f && f.p.map(v => v.toFixed(2)).join(' '), lit[y * W + x]?.map(v => v.toFixed(3)).join(' ')) }
  const gz0 = core.gz.slice()
  const gf0 = core.gf.slice()

  // The static cells, by palette key.
  const groups = new Map()
  const exact = new Set()
  for (let i = 0; i < N; i++) {
    const f = gf0[i]
    if (!f) continue
    const x = i % W
    const y = Math.floor(i / W)
    const key = f.k + '|' + zoneOf(f.p[2])
    let g = groups.get(key)
    if (!g) groups.set(key, (g = []))
    g.push({ i: keyOf(x, y), col: lit[i], x, y })
    if (f.exact) exact.add(hex(lit[i].map(v => v * 255)))
  }
  const { out: staticHex, palettes } = quantize(groups)
  // Colours one or two steps apart become one: nobody sees the difference, and cells of one
  // colour share a path, so no hairline between. The board's panels keep their exact colour.
  {
    const count = new Map()
    for (const c of staticHex.values()) count.set(c, (count.get(c) ?? 0) + 1)
    const keep = [...exact].map(c => ({ c, p: rgb(c) }))
    const to = new Map()
    for (const [c] of [...count].sort((a, b) => b[1] - a[1])) {
      if (exact.has(c)) continue
      const p = rgb(c)
      const near = keep.find(q => Math.abs(q.p[0] - p[0]) + Math.abs(q.p[1] - p[1]) + Math.abs(q.p[2] - p[2]) <= 6)
      if (near) to.set(c, near.c)
      else keep.push({ c, p })
    }
    for (const [k, c] of staticHex) if (to.has(c)) staticHex.set(k, to.get(c))
  }
  if (process.env.KEYS) {
    const byKey = new Map()
    for (let i = 0; i < N; i++) {
      const f = gf0[i]
      if (!f) continue
      const x = i % W
      const y = Math.floor(i / W)
      const c = staticHex.get(keyOf(x, y))
      if (x > 0 && gf0[i - 1] && staticHex.get(keyOf(x - 1, y)) === c) continue
      byKey.set(f.k, (byKey.get(f.k) ?? 0) + 1)
    }
    console.log('  keys: ' + [...byKey].sort((a, b) => b[1] - a[1]).slice(0, 32).map(([k, n]) => k + ':' + n).join(' '))
  }

  // The sky behind everything: bands, the sun or moon and stars.
  const sky = paintSky(M)

  // Sprites. A part is painted alone into a clear buffer with the renderer (optionally shifted
  // sideways to where its motion starts) and lit, or comes as fragments at cells of its own, lit
  // here without shadows, or comes ready coloured.
  const sprites = []
  const group = (g, f, x, y, col) => {
    const key = f.k + '|' + zoneOf(f.p[2])
    let l = g.get(key)
    if (!l) g.set(key, (l = []))
    l.push({ i: keyOf(x, y), col, x, y })
  }
  for (const s of scene.sprites) {
    const layers = []
    for (const part of s.layers) {
      let L
      if (part.layer) {
        L = part.layer
        L.anim = part.anim ?? null
      } else {
        const g = new Map()
        if (part.cells) {
          for (const c of part.cells) group(g, c.f, c.x, c.y, lightOne(M, c.f, c.y))
        } else {
          begin()
          // A sprite throws and takes shadows among the scene's casters; noShadow takes none;
          // ownCasters takes only the ones its paint adds (a moving thing's own shadow).
          core.casters.push(...(s.noShadow || s.ownCasters ? [] : staticCasters))
          part.paint()
          const litS = lightBuffer(M, { noShadow: s.noShadow, lamps: part.lamps, noContact: part.noContact, noBloom: true })
          const dx = part.shift ?? 0
          for (let i = 0; i < N; i++) if (core.gf[i]) group(g, core.gf[i], (i % W) + dx, Math.floor(i / W), litS[i])
        }
        const { out } = quantize(g, palettes)
        L = new Layer(s.name + layers.length, part.anim ?? null)
        for (const [k, c] of out) L.m.set(k, c)
      }
      L.hidden0 = !!part.hidden0
      if (s.safe) L.safe = s.safe
      layers.push(L)
    }
    // Colours a sprite can't tell apart become one, so the cells share a path.
    {
      const count = new Map()
      for (const L of layers) for (const c of L.m.values()) count.set(c, (count.get(c) ?? 0) + 1)
      const keep = []
      const to = new Map()
      for (const [c] of [...count].sort((a, b) => b[1] - a[1])) {
        const p = rgb(c)
        const near = keep.find(q => Math.abs(q.p[0] - p[0]) + Math.abs(q.p[1] - p[1]) + Math.abs(q.p[2] - p[2]) <= (s.merge ?? 15))
        if (near) to.set(c, near.c)
        else keep.push({ c, p })
      }
      if (to.size) for (const L of layers) for (const [k, c] of L.m) if (to.has(c)) L.m.set(k, to.get(c))
    }
    sprites.push({ ...s, built: layers })
  }

  // Where each sprite can be: its cells widened by its sweep, or a band it moves along.
  const regionOf = s => {
    const set = new Set()
    if (s.band) {
      const { x0, x1, y0, y1 } = s.band
      for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) set.add(y * W + x)
      return set
    }
    for (const L of s.built) {
      for (const k of L.m.keys()) {
        const [x, y] = cellXY(k)
        if (x >= 0 && x < W && y >= 0 && y < H) set.add(y * W + x)
      }
    }
    return set
  }

  // The still picture; each moving sprite gets a slice: a copy of the static cells nearer than
  // it where it moves, drawn over it.
  const order = sprites.filter(s => !s.back).sort((a, b) => b.depth - a.depth)
  const regions = new Map(order.map(s => [s, regionOf(s)]))
  const base = new Layer('base')
  base.filtered = true
  // Drawn in the merge filter (renderLayers), which fills the pixels two cells share, the
  // joins between split paths of one colour included.
  base.safe = { filled: true, join: false }
  for (let i = 0; i < N; i++) {
    if (!gf0[i]) continue
    const k = keyOf(i % W, Math.floor(i / W))
    base.m.set(k, staticHex.get(k))
  }
  const slices = new Map(order.map(s => [s, new Layer('slice')]))
  for (let i = 0; i < N; i++) {
    if (!gf0[i]) continue
    let last = null
    for (const s of order) {
      if (s.noSlice || !(gz0[i] < s.depth) || !regions.get(s).has(i)) continue
      last = s
    }
    if (last) slices.get(last).m.set(keyOf(i % W, Math.floor(i / W)), staticHex.get(keyOf(i % W, Math.floor(i / W))))
  }
  // Each slice also takes the still cells round it that its sprite never covers, so where a
  // slice cell meets one of those inside a screen pixel, the slice alone covers the pixel.
  for (const s of order) {
    const sl = slices.get(s)
    if (!sl.size) continue
    const own = new Set()
    for (const L of s.built) for (const k of L.m.keys()) own.add(k)
    const reg = regions.get(s)
    const addK = []
    for (const k of sl.m.keys()) {
      const [x, y] = cellXY(k)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue
          const n = keyOf(xx, yy)
          const j = yy * W + xx
          if (!gf0[j] || own.has(n) || sl.m.has(n) || (reg.has(j) && !(gz0[j] < s.depth))) continue
          addK.push(n)
        }
    }
    for (const n of addK) sl.m.set(n, staticHex.get(n))
  }

  const layers = [{ under: true, layer: sky.layer }, ...sky.extra]
  for (const s of sprites.filter(s => s.back)) layers.push(s.built)
  layers.push(base)
  // The board's marker: at the top level of the nested Svg, right after the still scene that
  // holds the pylon's windows. Nothing drawn after it crosses a window (motion.mjs).
  layers.push({ raw: MARKER })
  const push = s => {
    layers.push(s.wrap ? { wrap: s.wrap[0], end: s.wrap[1], layers: s.built } : s.built)
    const sl = slices.get(s)
    if (sl?.size) layers.push(sl)
  }
  for (const s of order) push(s)
  const css = [...new Set([...(sky.css ?? []), ...sprites.flatMap(s => s.css ?? [])])]

  // The preview, straight from the cells, as the first frame shows them.
  const img = new Array(N)
  const flatAll = ls => ls.flatMap(L => (L?.wrap ? (L.hidden0 ? [] : flatAll(L.layers)) : [L]))
  for (const L of flatAll(layers.flat())) {
    const LL = L?.under ? L.layer : L
    if (!LL || !LL.m || LL.hidden0) continue
    for (const [k, c] of LL.m) {
      const [x, y] = cellXY(k)
      if (x >= 0 && x < W && y >= 0 && y < H) img[y * W + x] = c
    }
  }
  return { layers: layers.flat(), css, img }
}

// ---------------------------------------------------------------- encoding
// Every layer through emitSafe (./encode-local.mjs); patterns with a clear cell all round,
// their corner on a cell corner; the still scene in bands under the merge filter; moving
// layers in two coats; full rows under the sky bands; one viewport, bottom-anchored, sliced to
// the window.

const PATTERN_MIN = 55
const runsOf = s => (s.match(/[hv]-?\d/g) ?? []).length

function encode(layers, extraCss) {
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
  const stats = { patterns: 0, runs: 0, bands: 0, byLayer: new Map(), sizes: [] }

  const SAFE = { T: 28, maxRows: 19, narrow: 21, wide: 120, rim: true }
  const cellsOf = (L, ox = 0, oy = 0) => emitSafe(L, { ox, oy, ...SAFE, ...(L.safe ?? {}) })

  // A layer of 55 runs or more goes into a pattern: an object-bounding-box tile whose corner
  // sits on a cell corner, with a clear row and column on every side.
  function draw(L) {
    const plain = cellsOf(L)
    const runs = runsOf(plain)
    stats.runs += runs
    stats.byLayer.set(L.name, (stats.byLayer.get(L.name) ?? 0) + runs)
    if (process.env.SIZES) stats.sizes.push([L.name, plain.length, L.m.size, new Set(L.m.values()).size])
    if (runs < PATTERN_MIN) return plain
    stats.patterns++
    const b = bounds(L)
    const x = b.x0 - 1
    const y = b.y0 - 1.5
    const id = nextId()
    defs.push('<pattern id="' + id + '" width="1" height="1">' + cellsOf(L, x, y) + '</pattern>')
    return '<rect x="' + x + '" y="' + f2(y) + '" width="' + (b.x1 - b.x0 + 3) + '" height="' + (b.y1 - b.y0 + 3) + '" fill="url(#' + id + ')"/>'
  }

  // The still scene is cut into bands of at most BAND_ROWS rows, each its own tile, each
  // carrying the next band's first row under it.
  const BAND_ROWS = 100
  function drawBanded(L) {
    const b = bounds(L)
    if (b.y1 - b.y0 + 1 <= BAND_ROWS) return draw(L)
    let out = ''
    for (let y0 = b.y0; y0 <= b.y1; y0 += BAND_ROWS) {
      const P = Object.assign(new Layer(L.name), { safe: L.safe })
      for (const [k, c] of L.m) {
        const y = cellXY(k)[1]
        if (y >= y0 && y <= y0 + BAND_ROWS) P.m.set(k, c)
      }
      if (P.m.size) out += draw(P)
    }
    return out
  }

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
    for (const [k, c] of [...L.m]) if (colourOf.get(cellXY(k)[1]) === c) L.m.delete(k)
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

  // A moving layer is laid on itself twice: a cell edge that falls inside a screen pixel covers
  // it a(2 - a) instead of a; whole cells are unchanged.
  const COATS = 2
  function coats(s) {
    if (COATS < 2 || !s) return s
    if (/^<rect [^<]*\/>$/.test(s)) return s.repeat(COATS)
    const id = nextId()
    return '<g id="' + id + '">' + s + '</g>' + ('<use href="#' + id + '"/>').repeat(COATS - 1)
  }

  function renderLayers(layers) {
    let out = ''
    for (const L of layers) {
      if (!L) continue
      if (L.raw) {
        out += L.raw
        continue
      }
      if (L.under) {
        out += underlay(L.layer) + draw(L.layer)
        continue
      }
      if (L.wrap) {
        out += L.wrap + renderLayers(L.layers) + L.end
        continue
      }
      if (L.filtered) {
        // Over nothing, laid on itself three times: where two cells share a screen pixel it
        // comes out solid in their own colours (Sunfield's seam fix), merged in sRGB.
        if (!defs.some(d => d.startsWith('<filter id="Q"'))) defs.push('<filter id="Q"><feMerge color-interpolation-filters="sRGB"><feMergeNode/><feMergeNode/><feMergeNode/></feMerge></filter>')
        out += '<g filter="url(#Q)">' + drawBanded(L) + '</g>'
        continue
      }
      if (!L.size) continue
      if (!L.anim) {
        out += draw(L)
        continue
      }
      out += '<g class="' + L.anim.cls + '"' + (L.anim.style ? ' style="' + L.anim.style + '"' : '') + (L.anim.extra ?? '') + '>' + coats(draw(L)) + '</g>'
    }
    return out
  }

  // The marker keeps its single quotes; everything else is written with double quotes and
  // turned to single ones at the end.
  const body = '<svg viewBox="0 -.5 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMax slice">' + renderLayers(layers) + '</svg>'
  const RULES = [...extraCss, '@media (prefers-reduced-motion:reduce){:root *{animation:none!important}}']
  const CSS = RULES.join('')
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" font-family="a" color="a" style="--m:0s">' + '<style>' + CSS + '</style><defs>' + defs.join('') + '</defs>' + body + '</svg>'
  svg = svg.replaceAll('"', "'")
  return { svg, stats, css: CSS.length }
}

// ---------------------------------------------------------------- write

function preview(name, img) {
  const S = 4
  const buf = Buffer.alloc(W * S * H * S * 3)
  for (let y = 0; y < H * S; y++) {
    for (let x = 0; x < W * S; x++) {
      const c = img[Math.floor(y / S) * W + Math.floor(x / S)] ?? '#ff00ff'
      const v = rgb(c)
      const o = (y * W * S + x) * 3
      buf[o] = v[0]
      buf[o + 1] = v[1]
      buf[o + 2] = v[2]
    }
  }
  fs.writeFileSync(path.join(HERE, 'out', 'debug', 'preview-' + name + '.png'), png(W * S, H * S, buf))
}

const LIMIT = 126000
fs.mkdirSync(path.join(HERE, 'out', 'debug'), { recursive: true })
const only = process.argv.slice(2)
for (const name of only.length ? only : Object.keys(MOMENTS)) {
  const t0 = Date.now()
  const { layers, css, img } = build(name)
  const { svg, stats, css: cssLen } = encode(layers, css)
  const markers = svg.split(MARKER).length - 1
  fs.writeFileSync(path.join(HERE, 'out', 'gas-station-' + name + '.svg'), svg)
  if (process.env.PREVIEW) preview(name, img)
  const colours = new Set(svg.match(/#[0-9a-f]{3,6}\b/g)).size
  console.log(name.padEnd(8), svg.length, 'chars' + (svg.length > LIMIT ? ' TOO BIG' : ''), '| markers', markers, '| css', cssLen, '| patterns', stats.patterns, '| runs', stats.runs, '| bands', stats.bands, '| colours', colours, '|', Date.now() - t0, 'ms')
  if (process.env.SIZES) for (const [n, a, c, k] of stats.sizes.sort((p, q) => q[1] - p[1]).slice(0, 25)) console.log('  ' + n.padEnd(24), a, c + ' cells', k + ' colours')
  if (process.env.STATS) {
    const top = [...stats.byLayer].sort((a, b) => b[1] - a[1]).slice(0, 20)
    console.log('  ' + top.map(([n, r]) => n.slice(0, 30) + ':' + r).join('  '))
  }
}
// The board: where the theme mod draws the digits, and their colours at each moment.
{
  const board = { yo: 0, rows: ROWS, ink: {}, halo: {} }
  for (const [name, M] of Object.entries(MOMENTS)) {
    board.ink[name] = M.board.ink
    board.halo[name] = M.board.halo
  }
  const problems = checkBoard(board)
  if (problems.length) console.log('board problems:', problems.join('; '))
  fs.writeFileSync(path.join(HERE, 'out', 'board.json'), JSON.stringify(board, null, 2) + '\n')
}
// The light-check data for debug.mjs, merged with what earlier builds wrote.
{
  const file = path.join(HERE, 'out', 'debug', 'keys.json')
  const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  fs.writeFileSync(file, JSON.stringify({ ...all, ...checks }, null, 1))
}
