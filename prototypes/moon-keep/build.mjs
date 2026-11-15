// Builds Moon Keep: a gothic castle of spires on a crag under a huge full moon, in a cold blue
// night, as one animated pixel-art SVG the Claude desktop app can play as a backdrop.
// node build.mjs  ->  out/moon-keep.svg
//
// Same pipeline as Sunfield (../../../sunfield/tools/build.mjs) and Deep Reef: a 320 x 200 cell
// grid (x right, y down), cells written as stroke runs of at most 64 per path, big layers in
// <pattern>s with a clear cell round them, each part in a nested viewport pinned to its corner,
// all motion in CSS steps() on a shared 0.05 s clock, a reduced-motion rule that stops it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Layer, bayer, bounds, clamp, emitCells, hex, lerp, rgb, rng, smooth, tone } from '../../../sunfield/tools/pixel.mjs'
import { line } from '../../../sunfield/tools/painters.mjs'
import { emitSafe } from './encode.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const W = 320
const H = 200
const f1 = v => Math.round(v * 10) / 10
const f2 = v => Math.round(v * 100) / 100
// Times on the shared clock: multiples of 0.05 s.
const tk = v => Math.round(v * 20) / 20

// ---------------------------------------------------------------- the light (_refs/lighting.md)
// Key light: the full moon, in the frame left of centre at cell (112, 62), high and behind the
// scene, so everything is backlit from the upper left: planes turned toward the moon (left and
// up for the castle, the crag and the right half of the scene) take a cold rim, the far sides
// fall into deep blue shadow, and shadows fall away from the moon and toward the viewer, short
// and faint under a high moon.
const KEY = { x: 112, y: 62, colour: '#dce4f8', shadow: '#141a3a' }
// Shadows on the meadow fall this way per row toward the viewer: away from the moon in x.
const shadowRun = x => clamp((x - KEY.x) / 90, -0.9, 0.9)
// Local lights, warm: [x, y, reach in cells, strength]. Lamps light their posts and the ground
// round them; lit windows and the gate throw pools on the wall under them (see warmAt).
const LAMPS = [
  [33, 149, 12, 1], // the lamp post on the hill
  [104, 114, 9, 1], // the lantern in the bridgehead gate
  [133, 121, 11, 1], // the two lanterns on the bridge parapet
  [161, 121, 11, 1],
]
const WARM_POOL = '#e08a40'

// ---------------------------------------------------------------- helpers

const mix = (a, b, t) => {
  const A = rgb(a)
  const B = rgb(b)
  return hex([lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)])
}
const lum = c => {
  const [r, g, b] = rgb(c)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
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
const fbm = (x, y, s) => 0.55 * noise(x, y, s) + 0.3 * noise(x * 2.1, y * 2.1, s + 7) + 0.15 * noise(x * 4.3, y * 4.3, s + 13)

function ramp(stops, t) {
  for (let i = 0; i < stops.length - 1; i++) {
    const [ta, ca] = stops[i]
    const [tb, cb] = stops[i + 1]
    if (t <= tb) return mix(ca, cb, clamp((t - ta) / (tb - ta), 0, 1))
  }
  return stops[stops.length - 1][1]
}

// The cells of a layer as [x, y, colour].
function* cells(L) {
  for (const [k, c] of L.m) yield [(k % 4096) - 1000, Math.floor(k / 4096) - 1000, c]
}
function merge(dst, src) {
  for (const [k, c] of src.m) dst.m.set(k, c)
  return dst
}
const K = (x, y) => x + ',' + y

// Catmull-Rom through points [x, y, ...extra]; returns n samples per segment.
function spline(pts, n = 8) {
  const out = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    for (let j = 0; j < n; j++) {
      const t = j / n
      const t2 = t * t
      const t3 = t2 * t
      out.push(
        p1.map((_, k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)),
      )
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

// ---------------------------------------------------------------- the moon and its light

const MOON = { x: KEY.x, y: KEY.y, r: 26 }
const moonDist = (x, y) => Math.hypot(x + 0.5 - MOON.x, y + 0.5 - MOON.y)
function moonDir(x, y) {
  const dx = MOON.x - (x + 0.5)
  const dy = MOON.y - (y + 0.5)
  const l = Math.hypot(dx, dy) || 1
  return [dx / l, dy / l]
}
// How deep a cell sits from the edge that faces the moon: 1 on the edge, up to max, 0 inside.
function rimDepth(has, x, y, max = 2) {
  const [dx, dy] = moonDir(x, y)
  for (let k = 1; k <= max; k++) if (!has(Math.round(x + dx * k), Math.round(y + dy * k))) return k
  return 0
}

// ---------------------------------------------------------------- palettes

const SKY = [
  [-10, '#070a1c'],
  [10, '#0a1028'],
  [30, '#0e1733'],
  [50, '#13203f'],
  [70, '#19294b'],
  [90, '#203358'],
  [110, '#283e64'],
  [130, '#30496e'],
  [170, '#365276'],
  [210, '#3a587c'],
]
const HAZE = '#2c4268'
// Rings of moonlight in the sky, cells beyond the rim.
const HALO = [
  [1.6, '#c4d2e8'],
  [4, '#9eb2d4'],
  [8, '#7e96c2'],
  [13, '#6680b2'],
  [20, '#556ea2'],
  [30, '#486092'],
  [44, '#3d5484'],
  [62, '#354a76'],
  [84, '#2f4169'],
]
const MOONP = ['#8f8e9c', '#a7a5aa', '#bcb9b2', '#cfcbbc', '#dfdac6', '#ebe6d2', '#f5f1e2', '#fdfbf2']
const CLOUD = ['#111933', '#17213e', '#1e2a4b', '#263458', '#2f3f66', '#3a4c76', '#475a86', '#576c98', '#6c84ae', '#88a0c6', '#a8bedc', '#d0deef', '#f0f5fb']
const CST = ['#080b16', '#0c1020', '#10162a', '#151d34', '#1b2440', '#222d4c', '#2b385a', '#36456a', '#43547c', '#546890', '#6a80a8', '#889ec2', '#adc0dc']
const ROCK = ['#080a14', '#0c0f1c', '#111526', '#171c30', '#1e243b', '#262d47', '#303954', '#3c4664', '#4a5676', '#5c6a8a', '#7284a4']
const HILL = ['#0b0b18', '#110f20', '#17132a', '#1e1834', '#261d3e', '#2f2348', '#3a2a54', '#473262', '#563c70', '#6a4c82']
const WARM = ['#2a0e0a', '#4e1c0e', '#7c3012', '#ac4c16', '#d6721e', '#f09c34', '#ffc664', '#ffe6a8', '#fff8e0']
const GRASS = ['#100308', '#1e050d', '#320914', '#4a0e1b', '#681523', '#8a1d2a', '#ae2a31', '#cc3f3a', '#e6604b', '#f88c6c', '#ffbc9e']
const LEAF = ['#16040b', '#280712', '#3e0b19', '#5a1222', '#7a192b', '#9c2232', '#bc3038', '#d84840', '#ee6a52', '#fc9472']
const BARK_RIM = '#6c7096' // the moon's cold rim on bark
const BARK = ['#040509', '#07080f', '#0b0c16', '#10111e', '#161728', '#1e1e33', '#28273f', '#34314e', '#433e60', '#555074']
const STONE = ['#0a0c15', '#10131e', '#161a28', '#1e2333', '#272d40', '#31394f', '#3d4660', '#4b5672', '#5c6886', '#717e9c', '#8b98b4']
const PATH = ['#1c1a2c', '#25223a', '#302c48', '#3c3856', '#4a4566', '#5a5578', '#6e688c']
const fog = (pal, f, c = HAZE) => pal.map(p => mix(p, c, f))

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
const TERRACE = Number(process.env.TERRACE ?? 1.1)
const stats = { patterns: 0, patternRuns: 0, plainRuns: 0, byLayer: new Map(), enc: [] }
const runsOf = s => (s.match(/[hv]-?\d/g) ?? []).length

// ---- encoding: no hairlines at any window size (see ../../engine/README.md and notes.md)
// Every cell layer is written by emitSafe from Moon Keep's copy of the engine's encoder
// (./encode.mjs, its header says what the copy adds): each colour also lies under the
// neighbouring cells of colours drawn after it where a hairline would show (a step over T),
// backed by the commonest colour when that is shorter, and a colour too big for one path is cut
// into chunks that overlap where they meet. Layers marked plain (the wisps and the bank over the
// moon) take no backing, whose dark colours would show as a rim along their lit edges.
// ENC=old builds the encoding from before the hairline fix, to compare.
const ENC = process.env.ENC ?? 'safe'
const T_DEF = Number(process.env.SAFE_T ?? 28)
const OPT = {
  bridge: process.env.BRIDGE !== '0',
  joinAll: process.env.JOINALL !== '0',
  order: process.env.ORDER ?? 'both',
  edge: process.env.EDGE !== '0',
  corners: process.env.CORNERS !== '0',
  maxRows: Number(process.env.MAXROWS ?? 24),
}
function cellsOf(L, ox = 0, oy = 0) {
  if (ENC === 'old') return oldCellsOf(L, ox, oy)
  const T = L.T ?? T_DEF
  const o = { ...OPT, ox, oy, T }
  if (L.plain) return emitSafe(L, { ...o, back: 'none' })
  const a = emitSafe(L, o)
  if (process.env.STATS === 'cmp' && L.drawn) stats.enc.push([L.name, new Set(L.m.values()).size, emitCells(L, ox, oy).length, oldCellsOf(L, ox, oy).length, emitSafe(L, { ox, oy, T }).length, a.length])
  return a
}

// Colours within MERGE levels of each other (mean channel step) are one colour inside a layer:
// the step cannot be seen, and every edge between them is one a hairline could form along.
// The commonest colour of each group stands for it. Cells in KEEP boxes (the bridgehead gate,
// the lamps) keep their colours exactly.
const MERGE = Number(process.env.MERGE ?? 6)
const KEEP = [
  [96, 107, 112, 128], // the bridgehead gate, its lintel and the hanging lantern
  [31, 146, 35, 167], // the lamp post on the hill
  [131, 118, 135, 124], // the bridge lanterns
  [159, 118, 163, 124],
]
const kept = (x, y) => KEEP.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)
const step = (a, b) => {
  const A = rgb(a)
  const B = rgb(b)
  return (Math.abs(A[0] - B[0]) + Math.abs(A[1] - B[1]) + Math.abs(A[2] - B[2])) / 3
}
function mergeNear(L, lim = MERGE) {
  if (!lim) return L
  const count = new Map()
  for (const c of L.m.values()) count.set(c, (count.get(c) ?? 0) + 1)
  const reps = []
  const to = new Map()
  for (const [c] of [...count].sort((a, b) => b[1] - a[1])) {
    let best = null
    for (const r of reps) if (step(c, r) <= lim && (!best || step(c, r) < step(c, best))) best = r
    if (best) to.set(c, best)
    else reps.push(c)
  }
  if (!to.size) return L
  for (const [k, c] of L.m) {
    const n = to.get(c)
    if (n && !kept((k % 4096) - 1000, Math.floor(k / 4096) - 1000)) L.m.set(k, n)
  }
  return L
}

// The scene's encoder before the hairline fix, kept for comparison (ENC=old).
function oldCellsOf(L, ox = 0, oy = 0) {
  const plain = emitCells(L, ox, oy)
  if (L.plain) return plain
  const count = new Map()
  for (const c of L.m.values()) count.set(c, (count.get(c) ?? 0) + 1)
  if (count.size < 2) return plain
  let top = null
  for (const [c, n] of count) if (!top || n > top[1]) top = [c, n]
  const back = new Layer('back')
  const rest = new Layer('rest')
  for (const [k, c] of L.m) {
    back.m.set(k, top[0])
    if (c !== top[0]) rest.m.set(k, c)
  }
  const backed = emitCells(back, ox, oy) + emitCells(rest, ox, oy)

  // Terraces: each colour drawn over every cell at least as light, darkest first. Where two
  // colours meet inside a screen pixel, only colours between the two show in the line, so no
  // seam; used when it costs little more than the backing.
  const order = [...count.keys()].sort((a, b) => lum(a) - lum(b))
  const rank = new Map(order.map((c, i) => [c, i]))
  let terraces = ''
  for (let i = 0; i < order.length; i++) {
    const T = new Layer('t')
    for (const [k, c] of L.m) if (rank.get(c) >= i) T.m.set(k, order[i])
    terraces += emitCells(T, ox, oy)
  }
  const best = runsOf(backed) <= runsOf(plain) * 1.08 + 6 ? backed : plain
  return L.terrace || runsOf(terraces) <= runsOf(best) * TERRACE ? terraces : best
}

// A layer's cells: plain paths when small, a rect filled with a pattern of them when big (a
// pattern keeps its raster between frames, so the player redraws it for free). The tile has a
// clear cell on each side: where its edge falls inside a screen pixel the far edge would
// otherwise bleed in as a line.
// Lips: where a layer's cell meets, across its edge, a cell of a layer drawn before it of
// nearly its colour (within MERGE levels), the edge pixel would show whatever lies under the
// layer's own cell there: a 1-px line between two cells of one colour. Exact fixes need the
// cell below carried under the one above, which shows wherever the two parts do not line up:
// a moving part away from its rest place, or a corner-pinned tree in a window narrower than
// 16:10. So the cell above carries a lip instead: a quarter-cell strip of its own colour over
// the edge, a stroke half a cell wide on it, which covers the edge pixel. A lip is laid only
// where everything that can show under its far half is within MERGE of its colour: the top
// still cell there, and every cell a moving part drawn before it can bring there. Lower layers
// are taken as the app lays them out at 16:10 and wider, where all the pins line up.
// A moving layer (grass tips, leaf clumps) gets the lips that hold wherever it stands in its
// tile, and for each place it stands at, a group of the lips that hold only there, shown only
// while it stands there (an opacity animation on the layer's own clock, see lipRules).
const LIPS = process.env.LIPS !== '0'
const LIP_SEAM = 28
// Where a moving part can stand, as whole-cell offsets, and when: [percent, place] keyframes of
// its animation (see RULES).
const MOTION = {
  gs: { places: [[0, 0], [1, 0]], kf: [[0, 0], [20, 1], [60, 0]] },
  lv: { places: [[0, 0], [1, 0], [1, 1]], kf: [[0, 0], [25, 1], [45, 2], [65, 0]] },
  cb: { places: [0, -1, -2, -3, -4, -5, -6].map(x => [x, 0]) },
  cb2: { places: [0, 1, 2, 3, 4].map(x => [x, 0]) },
  zb: { places: [[0, 0]] },
}
const placesOf = L => (L.anim ? MOTION[L.anim.cls].places : [[0, 0]])
const lipClasses = new Set()
function lipsOf(L) {
  if (!drawnLayers.length || L.see) return null
  const places = placesOf(L)
  const kf = L.anim ? MOTION[L.anim.cls].kf : null
  if (L.anim && !kf && places.length > 1) return null
  // Whether a lip of colour u may lie over cell t: every colour that can show there is near u.
  const LOOSE = process.env.LOOSE ?? 'moving'
  const loose = LOOSE === 'all' || (LOOSE === 'moving' && !!L.anim)
  const fits = (t, u) => {
    for (let j = drawnLayers.length - 1; j >= 0; j--) {
      const M = drawnLayers[j]
      if (M.moving && loose) {
        const c = M.m.get(t)
        if (c !== undefined) return step(u, c) <= MERGE
      } else if (M.moving) {
        for (const [px, py] of M.places) {
          const c = M.m.get(t - px - py * 4096)
          if (c !== undefined && step(u, c) > MERGE) return false
        }
      } else if (M.m.has(t)) return step(u, M.m.get(t)) <= MERGE
    }
    return false
  }
  // The top cell at t with every part at rest, and whether a moving part can pass over t.
  const restAt = t => {
    for (let j = drawnLayers.length - 1; j >= 0; j--) if (drawnLayers[j].m.has(t)) return drawnLayers[j].m.get(t)
    return undefined
  }
  const swept = t => drawnLayers.some(M => M.moving && M.swept.has(t))
  const sets = places.map(() => ({ vert: new Map(), horz: new Map() })) // per place
  const always = { vert: new Map(), horz: new Map() }
  const add = (set, u, x, y, d) => {
    const m = d === 1 || d === -1 ? set.vert : set.horz
    if (!m.has(u)) m.set(u, [])
    m.get(u).push(d === 1 || d === -1 ? [x + (d > 0 ? 1 : 0), y] : [x, y + (d > 0 ? 0.5 : -0.5)])
  }
  for (const [k, u] of L.m) {
    for (const d of [-1, 1, -4096, 4096]) {
      const n = k + d
      if (L.m.has(n)) continue
      const ok = []
      let all = true
      let any = false
      for (const [px, py] of places) {
        const off = px + py * 4096
        const valid = fits(n + off, u)
        let seam = false
        if (valid) {
          const U = restAt(k + off)
          seam = U === undefined || step(U, restAt(n + off)) > LIP_SEAM || swept(k + off) || swept(n + off)
        }
        ok.push(valid && seam)
        if (!valid) all = false
        if (valid && seam) any = true
      }
      if (!any) continue
      const x = (k % 4096) - 1000
      const y = Math.floor(k / 4096) - 1000
      if (all) add(always, u, x, y, d)
      else ok.forEach((v, i) => v && add(sets[i], u, x, y, d))
    }
  }
  // Runs along each edge line: vertical lips stack down a column edge, horizontal ones along a row.
  const runsFor = (list, alongX) => {
    const by = new Map()
    for (const [a, b] of list) {
      const fixed = alongX ? b : a
      const v = alongX ? a : b
      if (!by.has(fixed)) by.set(fixed, [])
      by.get(fixed).push(v)
    }
    const out = []
    for (const fixed of [...by.keys()].sort((p, q) => p - q)) {
      const vs = by.get(fixed).sort((p, q) => p - q)
      let start = vs[0]
      let len = 1
      for (let i = 1; i <= vs.length; i++) {
        if (i < vs.length && vs[i] === start + len) len++
        else {
          out.push(alongX ? [start, fixed, 'h' + len, start + len, fixed] : [fixed, start - 0.5, 'v' + len, fixed, start - 0.5 + len])
          if (i < vs.length) {
            start = vs[i]
            len = 1
          }
        }
      }
    }
    return out
  }
  const count = set => [...set.vert.values(), ...set.horz.values()].reduce((n, a) => n + a.length, 0)
  stats.lips = (stats.lips ?? 0) + count(always) + sets.reduce((n, st) => n + count(st), 0)
  const emit = (set, ox, oy) => {
    let out = ''
    for (const c of new Set([...set.vert.keys(), ...set.horz.keys()])) {
      const segs = [...runsFor(set.vert.get(c) ?? [], false), ...runsFor(set.horz.get(c) ?? [], true)]
      for (let i = 0; i < segs.length; i += 64) {
        let d = ''
        let pen = null
        for (const [sx, sy, cmd, ex, ey] of segs.slice(i, i + 64)) {
          d += pen ? 'm' + pairNum(sx - pen[0], sy - pen[1]) : 'M' + pairNum(sx - ox, sy - oy)
          d += cmd
          pen = [ex, ey]
        }
        out += '<path stroke="' + shortHex(c) + '" d="' + d + '"/>'
      }
    }
    return out
  }
  const fixed = count(always) ? (ox, oy) => '<g stroke-width=".5">' + emit(always, ox, oy) + '</g>' : null
  // The groups for each place: plain paths in the layer's own coordinates.
  let placed = ''
  if (process.env.PLACED !== '1') return { fixed, placed }
  sets.forEach((set, i) => {
    if (!count(set)) return
    const cls = 'q' + L.anim.cls + i
    lipClasses.add(cls)
    placed += '<g class="' + cls + '"' + (i ? ' opacity="0"' : '') + ' stroke-width=".5">' + emit(set, 0, 0) + '</g>'
  })
  return { fixed, placed }
}
// The opacity animations of the lip groups: shown while their layer stands at their place.
function lipRules() {
  let css = ''
  for (const cls of lipClasses) {
    const m = cls.match(/^q([a-z]+)(\d)$/)
    const j = Number(m[2])
    let k = ''
    let last = null
    for (const [pc, p] of MOTION[m[1]].kf) {
      const o = p === j ? 1 : 0
      if (o !== last) k += pc + '%{opacity:' + o + '}'
      last = o
    }
    css += '.' + cls + '{animation:' + cls + ' var(--d) steps(1) ' + from('var(--l)') + ' infinite}@keyframes ' + cls + '{' + k + '}'
  }
  return css
}
const numS = v => {
  const t = String(Math.round(v * 1000) / 1000)
  return t.startsWith('0.') ? t.slice(1) : t.startsWith('-0.') ? '-' + t.slice(2) : t
}
const pairNum = (a, b) => {
  const sa = numS(a)
  const sb = numS(b)
  return sa + (sb[0] === '-' || (sb[0] === '.' && sa.includes('.')) ? '' : ' ') + sb
}
const shortHex = h => (h[1] === h[2] && h[3] === h[4] && h[5] === h[6] ? '#' + h[1] + h[3] + h[5] : h)

// The still cells of the main part as drawn (after mergeNear), by cell: a copy of them drawn
// over moving things (the spires the first bat passes behind) takes the same colours.
const stillAt = new Map()
const drawnLayers = []
let curPin = null
function draw(L) {
  if (ENC !== 'old') {
    if (L.follow) for (const [k] of L.m) L.m.set(k, stillAt.get(k) ?? L.m.get(k))
    else mergeNear(L)
  }
  const b = bounds(L)
  L.drawn = true
  const lip = (ENC !== 'old' && LIPS && lipsOf(L)) || { fixed: null, placed: '' }
  const fixed = lip.fixed ?? (() => '')
  const tile = cellsOf(L, b.x0 - 1, b.y0 - 1.5) + fixed(b.x0 - 1, b.y0 - 1.5)
  const runs = runsOf(tile)
  stats.byLayer.set(L.name, (stats.byLayer.get(L.name) ?? 0) + runs)
  // A moving layer is drawn DUP times over itself (after Deep Reef): where its edge falls inside
  // a screen pixel, what lies beneath shows there by (1 - f)^DUP instead of 1 - f, so the line
  // where it crosses an edge of the layers below is fainter. Whole cells do not change.
  const dup = el => {
    if (!L.anim || DUP < 2) return el
    const uid = nextId()
    const one = /^<(rect|path) /.test(el) && el.indexOf('<', 1) < 0
    return (one ? el.replace(/^<(\w+) /, '<$1 id="' + uid + '" ') : '<g id="' + uid + '">' + el + '</g>') + ('<use href="#' + uid + '"/>').repeat(DUP - 1)
  }
  if (runs < PATTERN_MIN) {
    stats.plainRuns += runs
    return dup(cellsOf(L) + fixed(0, 0)) + lip.placed
  }
  stats.patterns++
  stats.patternRuns += runs
  const id = nextId()
  defs.push('<pattern id="' + id + '" width="1" height="1">' + tile + '</pattern>')
  return dup('<rect x="' + (b.x0 - 1) + '" y="' + (b.y0 - 1.5) + '" width="' + (b.x1 - b.x0 + 2) + '" height="' + (b.y1 - b.y0 + 2) + '" fill="url(#' + id + ')"/>') + lip.placed
}
const DUP = Number(process.env.DUP ?? 3)

// A layer repeated across as a tile tw cells wide, filling x .. x + w (cells). The tile's cells
// must lie in columns 0..tw-1. The tile spans the layer's rows plus a clear row above and below:
// a pattern repeats down as well as across, and where the rect's top or bottom edge falls inside
// a screen pixel the filtered tile would bring in the row from its other edge, a line of mist
// along the whole strip.
function tiled(L, tw, x, w) {
  const id = nextId()
  const b = bounds(L)
  const y = b.y0 - 1.5
  const h = b.y1 - b.y0 + 2
  const body = cellsOf(L, 0, y)
  stats.byLayer.set(L.name, runsOf(body))
  stats.patternRuns += runsOf(body)
  defs.push('<pattern id="' + id + '" patternUnits="userSpaceOnUse" y="' + y + '" width="' + tw + '" height="' + h + '">' + body + '</pattern>')
  return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="url(#' + id + ')"/>'
}

const anim = (cls, style, extra = '') => ({ cls, style, extra })

// Cells that a still layer above them in the same part always covers are dropped.
// A covered cell next to one of the layer's cells that still shows is kept: the edge of the
// layer above then lies over it, not over whatever is further down (no hairline where two
// still parts meet, such as the hill's cliff against the gorge).
function cull(layers) {
  const covered = new Set()
  for (let i = layers.length - 1; i >= 0; i--) {
    const L = layers[i]
    if (L.wrap || L.anim || L.raw !== undefined || L.see) continue
    const keys = [...L.m.keys()]
    const shows = k => L.m.has(k) && !covered.has(k)
    const drop = keys.filter(k => covered.has(k) && !(ENC !== 'old' && [k - 1, k + 1, k - 4096, k + 4096].some(shows)))
    for (const k of keys) covered.add(k)
    for (const k of drop) L.m.delete(k)
  }
}

function renderLayers(layers) {
  let out = ''
  let still = null
  const flush = () => {
    if (still) {
      out += draw(still)
      drawnLayers.push({ pin: curPin, name: still.name, m: new Map(still.m), moving: false })
      if (curPin === 'pB') for (const [k, c] of still.m) stillAt.set(k, c)
    }
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
      if (process.env.STATS) stats.byLayer.set('  ' + L.name, runsOf(cellsOf(L)))
      // Still cells outside the grid never show in any window: every viewport is sliced.
      still ??= new Layer('still')
      still.name = still.name === 'still' ? L.name : still.name + '+' + L.name
      for (const [x, y, c] of cells(L)) if (x >= 0 && x < W && y >= 0 && y < H) still.set(x, y, c)
      continue
    }
    flush()
    out += '<g class="' + L.anim.cls + '"' + (L.anim.style ? ' style="' + L.anim.style + '"' : '') + L.anim.extra + '>' + draw(L) + '</g>'
    const places = placesOf(L)
    const swept = new Set()
    for (const [px, py] of places) for (const k of L.m.keys()) swept.add(k + px + py * 4096)
    drawnLayers.push({ pin: curPin, name: L.name, m: new Map(L.m), moving: true, places, swept })
  }
  flush()
  return out
}

const parts = [] // { pin, layers } in paint order
const part = (pin, layers) => parts.push({ pin, layers })

// ---------------------------------------------------------------- sky

const BAND = 3
const bandOf = y => Math.floor(y / BAND) * BAND
const bandColor = y => ramp(SKY, bandOf(y) + 1)

// A staircase outline of rows y0..y1, row y spanning xl(y)..xr(y) (xr exclusive), in
// relative steps (from Deep Reef).
function stair(y0, y1, xl, xr, oy = 0) {
  let d = 'M' + xl(y0) + ' ' + (y0 - 0.5 + oy) + 'h' + (xr(y0) - xl(y0))
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

// The sky in one pattern tile: bands of its ramp, three rows each, every one drawn a row taller
// under the next so that no seam shows where two meet inside a screen pixel; over them the
// moonlight, discs of pale light stepped in whole cells, each a little brighter toward the moon.
const HALO_RINGS = [
  [82, 0.07],
  [58, 0.07],
  [40, 0.08],
  [27, 0.09],
  [17, 0.11],
  [10, 0.13],
  [5, 0.16],
  [2, 0.22],
]
function sky() {
  let tile = '<g stroke-width="' + (BAND + 1) + '">'
  let last = null
  let d = ''
  const OY = 4 // the tile starts at row -4
  const flush = () => {
    if (last) tile += '<path stroke="' + last + '" d="' + d + '"/>'
  }
  for (let y = -3; y < H + 3; y += BAND) {
    const c = bandColor(y)
    if (c !== last) {
      flush()
      last = c
      d = ''
    }
    d += 'M0 ' + (y + OY + BAND / 2) + 'h' + W
  }
  flush()
  tile += '</g><g fill="#b4c8ea">'
  for (const [r, a] of HALO_RINGS) {
    const R = MOON.r + r
    const y0 = Math.max(-3, Math.ceil(MOON.y - R))
    const y1 = Math.min(H + 2, Math.floor(MOON.y + R - 1))
    const span = y => Math.sqrt(Math.max(0, R * R - (y + 0.5 - MOON.y) ** 2))
    const xl = y => clamp(Math.round(MOON.x - span(y)), -1, W + 1)
    const xr = y => clamp(Math.round(MOON.x + span(y)), -1, W + 1)
    tile += '<path fill-opacity="' + a + '" d="' + stair(y0, y1, xl, xr, OY + 0.5) + '"/>'
  }
  tile += '</g>'
  defs.push('<pattern id="Sk" width="1" height="1">' + tile + '</pattern>')
  return '<rect y="-' + (OY + 0.5) + '" width="' + W + '" height="' + (H + OY + 4) + '" fill="url(#Sk)"/>'
}

// A few faint stars far from the moon.
function stars() {
  const L = new Layer('stars')
  const r = rng(17)
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(r() * W)
    const y = Math.floor(1 + Math.pow(r(), 1.5) * 80)
    if (moonDist(x, y) - MOON.r < 60) continue
    const c = r() < 0.25 ? '#e8eeff' : r() < 0.5 ? '#a8b6dc' : '#7484b0'
    L.set(x, y, c)
    if (i < 8) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) L.set(x + dx, y + dy, '#5c6c9c')
  }
  return L
}

// ---------------------------------------------------------------- the moon

// The full moon: a pale disc, a little darker at the limb, with the dark seas roughly where
// they are on the real one, and Tycho's bright crater low on the disc.
const MARIA = [
  // u, v (-1..1 across and down the disc), rx, ry, depth
  [-0.3, -0.42, 0.3, 0.26, 1],
  [0.16, -0.36, 0.17, 0.16, 1],
  [0.34, -0.06, 0.2, 0.18, 1],
  [0.68, -0.24, 0.12, 0.11, 1.2],
  [0.5, 0.2, 0.14, 0.15, 0.8],
  [0.3, 0.32, 0.09, 0.08, 0.7],
  [-0.62, -0.02, 0.26, 0.44, 0.8],
  [-0.18, 0.36, 0.17, 0.14, 0.7],
  [-0.48, 0.4, 0.1, 0.09, 0.8],
  [0.0, -0.72, 0.42, 0.07, 0.6],
]
function moon() {
  const L = new Layer('moon')
  const { x: cx, y: cy, r: R } = MOON
  for (let y = -R - 1; y <= R; y++) {
    for (let x = -R - 1; x <= R; x++) {
      const dx = x + 0.5
      const dy = y + 0.5
      const d = Math.hypot(dx, dy)
      if (d >= R) continue
      const u = dx / R
      const v0 = dy / R
      const nz = Math.sqrt(Math.max(0, 1 - (d / R) ** 2))
      let v = 0.8 + 0.06 * (-u * 0.5 - v0 * 0.6) - 0.26 * Math.pow(1 - nz, 1.8)
      let sea = 0
      for (const [mu, mv, rx, ry, k] of MARIA) {
        const q = 1 - ((u - mu) / rx) ** 2 - ((v0 - mv) / ry) ** 2
        sea = Math.max(sea, k * smooth((q + (noise(x * 0.3, y * 0.3, 3) - 0.5) * 0.6) * 1.6))
      }
      v -= 0.2 * sea
      // Tycho, bright, low on the disc.
      const ty = Math.hypot(u + 0.08, v0 - 0.72)
      if (ty < 0.06) v += 0.14
      L.set(cx + x, cy + y, tone(MOONP, v, x, y, 0.12))
    }
  }
  return L
}

// ---------------------------------------------------------------- clouds

// A cloud: ellipses [x, y, rx, ry] with a ragged edge, in cool shade, lit along the edge that
// faces the moon and brighter the nearer it lies to it.
function cloud(name, puffs, o = {}) {
  const L = new Layer(name)
  const set = new Set()
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const [px, py, rx, ry] of puffs) {
    x0 = Math.min(x0, px - rx - 2)
    x1 = Math.max(x1, px + rx + 2)
    y0 = Math.min(y0, py - ry - 2)
    y1 = Math.max(y1, py + ry + 2)
  }
  const seed = o.seed ?? 1
  for (let y = Math.floor(y0); y <= y1; y++) {
    for (let x = Math.floor(x0); x <= x1; x++) {
      if (o.base !== undefined && y > o.base + Math.round((noise(x * 0.3, 3, seed) - 0.5) * 2)) continue
      let q = -Infinity
      for (const [px, py, rx, ry] of puffs) q = Math.max(q, 1 - ((x + 0.5 - px) / rx) ** 2 - ((y + 0.5 - py) / ry) ** 2)
      if (q + (noise(x * 0.22, y * 0.5, seed) - 0.5) * (o.rough ?? 0.6) > 0) set.add(K(x, y))
    }
  }
  const has = (x, y) => set.has(K(x, y))
  for (const k of set) {
    const [x, y] = k.split(',').map(Number)
    const [dx, dy] = moonDir(x, y)
    let lit = 0
    while (lit < 6 && has(Math.round(x + dx * (lit + 1)), Math.round(y + dy * (lit + 1)))) lit++
    const d = Math.max(0, moonDist(x, y) - MOON.r)
    const glow = Math.exp(-d / (o.glowR ?? 40))
    let v = (o.body ?? 0.24) + (o.rim ?? 0.42) * [1, 0.62, 0.38, 0.2, 0.1, 0.04, 0][lit] * (0.35 + 0.65 * glow) + (o.glow ?? 0.2) * glow
    if (!has(Math.round(x - dx), Math.round(y - dy))) v -= 0.05
    v += (noise(x * 0.3, y * 0.7, seed + 5) - 0.5) * 0.1
    L.set(x, y, tone(o.tones ?? CLOUD, v, x, y, o.dither ?? 0.12))
  }
  return L
}

// ---------------------------------------------------------------- far land

// A hazy silhouette with a top that follows its peaks [x, top, half width]; flat fill, lit rim.
function ridge(L, peaks, o) {
  const topAt = x => {
    let t = o.base
    for (const [px, py, w] of peaks) {
      const d = Math.abs(x + 0.5 - px) / w
      if (d < 1) t = Math.min(t, py + (o.base - py) * Math.pow(d, o.p ?? 1.8))
    }
    return Math.round(t + (o.rag ?? 2) * (noise(x * 0.25, 0, o.seed) - 0.5) + (o.rag ?? 2) * 0.5 * (noise(x * 0.7, 1, o.seed) - 0.5))
  }
  for (let x = 0; x < W; x++) {
    const top = topAt(x)
    for (let y = top; y < o.bottom; y++) L.set(x, y, y === top ? o.pal[2] : y === top + 1 && topAt(x + 1) > top ? o.pal[1] : o.pal[0])
  }
  return topAt
}

// A small pointed roof or needle on a far tower: rows from the tip widen to hw.
function farRoof(L, cx, tip, base, hw, pal) {
  for (let y = tip; y <= base; y++) {
    const w = 0.5 + (hw - 0.5) * ((y - tip) / Math.max(1, base - tip))
    for (let x = Math.floor(cx - w); x <= cx + w; x++) if (Math.abs(x + 0.5 - cx) <= w + 0.01) L.set(x, y, x + 0.5 < cx ? pal[1] : pal[0])
  }
}

function farLand() {
  const L = new Layer('far')
  const pal = ['#25385c', '#2f4670', '#3c5682']
  ridge(L, [[-10, 106, 40], [44, 112, 30], [96, 116, 28], [150, 110, 34], [206, 114, 30], [262, 106, 36], [322, 110, 30]], { base: 124, bottom: 150, pal, seed: 5, rag: 2.5 })
  // A ruin far off on the ridge: thin towers and a broken wall, barely darker than the air.
  const ruin = ['#2a3e62', '#3a5480']
  // A far keep on the ridge: towers with pointed roofs over a wall.
  for (const [x0, x1, top, roof] of [[28, 33, 101, 94], [35, 44, 106, 100], [46, 50, 97, 86], [52, 56, 103, 97], [164, 168, 106, 99]]) {
    for (let y = top; y < 118; y++) for (let x = x0; x < x1; x++) L.set(x, y, x === x0 ? ruin[1] : ruin[0])
    farRoof(L, (x0 + x1) / 2, roof, top - 1, (x1 - x0) / 2 + 0.6, ruin)
  }
  for (let x = 26; x < 60; x++) for (let y = 110 + (x % 4 < 2 ? 0 : 1); y < 118; y++) L.set(x, y, ruin[0])
  return L
}

// ---------------------------------------------------------------- the castle

// The keep, in three planes from the back: each is a mask of cells (stone, roof, window), lit
// at the end by the moon along the edges that face it and hazed by its distance.
const glowSpots = [] // lit windows and lamps: [x, y, w, h, strength]
// How much warm light reaches a cell: from the lamps in a circle, and from each lit window or
// gate as a pool on the wall under it and a little to its sides. Dithered at the edge of reach.
function warmAt(x, y, spots = glowSpots) {
  let w = 0
  for (const [lx, ly, reach, st] of LAMPS) w = Math.max(w, st * (1 - Math.hypot(x + 0.5 - lx - 0.5, (y + 0.5 - ly - 0.5) * 1.2) / reach))
  for (const [x0, y0, ww, hh, st] of spots) {
    if (ww <= 1 && hh <= 2) continue
    const cx = x0 + ww / 2
    const dx = Math.abs(x + 0.5 - cx) / (ww / 2 + 2.5)
    const dy = y >= y0 + hh ? (y - y0 - hh + 1) / 6 : y >= y0 - 1 ? 0.35 : 9
    w = Math.max(w, st * Math.max(0, 1 - dx) * Math.max(0, 1 - dy))
  }
  return w + (bayer(x, y) - 0.5) * 0.18
}
// A colour warmed by local light w (0..1), in two steps.
const warmed = (c, w) => (w > 0.5 ? mix(c, WARM_POOL, 0.38) : w > 0.22 ? mix(c, WARM_POOL, 0.18) : c)
function castle() {
  const planes = [0.5, 0.26, 0.06].map(haze => ({ haze, m: new Map() }))
  const [P0, P1, P2] = planes
  const put = (P, x, y, k, v) => P.m.set(K(x, y), { x, y, k, v })
  function box(P, x0, x1, y0, y1, o = {}) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const u = (x + 0.5 - x0) / (x1 - x0)
        let v = o.v ?? 0.2
        // Form: the side toward the moon (left) lit, the far side in deep shadow.
        if (o.round) v += 0.28 * (0.42 - u) - 0.06 * Math.abs(2 * u - 1) ** 3
        else if (x - x0 < Math.min(3, Math.max(1, Math.round((x1 - x0) * 0.2)))) v = 0.5
        else if (x1 - 1 - x < Math.max(1, Math.round((x1 - x0) * 0.2))) v = 0.1
        if (o.round && (y - y0) % 5 === 4) v -= 0.06
        put(P, x, y, 's', v)
      }
    }
  }
  // A pointed roof or spire from its tip down to its base, half width hw at the base.
  function spire(P, cx, yTip, yBase, hw1, o = {}) {
    for (let y = yTip; y <= yBase; y++) {
      const t = (y - yTip) / Math.max(1, yBase - yTip)
      const hw = 0.5 + (hw1 - 0.5) * Math.pow(t, o.pow ?? 1)
      const xs = []
      for (let x = Math.floor(cx - hw - 1); x <= Math.ceil(cx + hw + 1); x++) if (Math.abs(x + 0.5 - cx) <= hw + 0.01) xs.push(x)
      for (const x of xs) {
        // Two roof planes: the one toward the moon lit, the other in shadow.
        let v = x + 0.5 < cx ? 0.5 : 0.12
        if (o.slate && (y - yTip) % 4 === 3 && t > 0.15 && v > 0.2) v -= 0.08
        put(P, x, y, 'r', v)
      }
      if (o.crockets && xs.length && (y - yTip) % 4 === 2 && t > 0.1 && t < 0.9) {
        put(P, xs[0] - 1, y, 'r', 0.2)
        put(P, xs[xs.length - 1] + 1, y, 'r', 0.2)
      }
    }
    if (o.cross) {
      const x = Math.floor(cx - 0.01)
      for (let k = 1; k <= 3; k++) put(P, x, yTip - k, 'r', 0.2)
      put(P, x - 1, yTip - 2, 'r', 0.2)
      put(P, x + 1, yTip - 2, 'r', 0.2)
    }
  }
  function gable(P, x0, x1, yBase, yApex) {
    const cx = (x0 + x1) / 2
    for (let y = yApex; y < yBase; y++) {
      const hw = ((y - yApex + 1) / (yBase - yApex)) * (x1 - x0) / 2
      for (let x = x0; x < x1; x++) {
        const s = (x + 0.5 - cx) / hw
        if (Math.abs(s) > 1.001) continue
        put(P, x, y, 'r', (s < 0 ? 0.34 : 0.12) - ((y - yApex) % 4 === 3 && s < 0 ? 0.06 : 0))
      }
    }
  }
  function pinnacle(P, x, yTip, yBase) {
    for (let y = yTip; y <= yBase; y++) {
      put(P, x, y, 'r', 0.36)
      if (y - yTip > 2) put(P, x + 1, y, 'r', 0.1)
    }
    put(P, x, yTip - 1, 'r', 0.2)
  }
  function merlons(P, x0, x1, y) {
    for (let x = x0; x < x1; x++) if ((x - x0) % 4 < 2) for (let k = 1; k <= 2; k++) put(P, x, y - k, 's', 0.2)
  }
  // A lancet window w cells wide (1 to 3), pointed at the top; lit ones glow warm inside.
  function lancet(P, x0, y0, w, h, lit = 0) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (w === 3 && y === y0 && x !== x0 + 1) continue
        const mull = w === 3 && x === x0 + 1 && y > y0 + 1
        const side = 0
        put(P, x, y, lit ? 'l' : 'w', lit ? lit * (0.78 - 0.3 * ((y - y0) / h) - (mull ? 0.3 : 0) + side) : 0)
      }
    }
    if (lit) glowSpots.push([x0, y0, w, h, lit])
  }
  function rose(P, cx, cy, r, lit) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const dx = x + 0.5 - cx
        const dy = y + 0.5 - cy
        const d = Math.hypot(dx, dy)
        if (d > r) continue
        const a = Math.atan2(dy, dx)
        const spoke = Math.abs(Math.sin(a * 4)) < 0.28 && d > 1.4
        if (d > r - 1) put(P, x, y, 's', 0.32)
        else if (spoke || (d > r * 0.55 && d < r * 0.55 + 1)) put(P, x, y, 'w', 0)
        else put(P, x, y, 'l', lit * (0.85 - 0.45 * (d / r)))
      }
    }
    glowSpots.push([Math.floor(cx - r), Math.floor(cy - r), 2 * r, 2 * r, lit * 0.6])
  }
  // A flying buttress from a pier top (xa, ya) up to the wall (xb, yb): a sloping coping over
  // a half arch, thick at both ends.
  function flyer(P, xa, ya, xb, yb) {
    const n = Math.ceil(Math.abs(xb - xa))
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const x = Math.round(lerp(xa, xb, t))
      const y = Math.round(lerp(ya, yb, t))
      const th = 1 + Math.round(3.5 * (1 - Math.sin(Math.PI * t)) ** 1.5)
      for (let k = 0; k <= th; k++) put(P, x, y + k, 's', 0.2)
    }
  }

  // ---- the back plane: spires and roofs beyond the keep
  box(P0, 196, 202, 70, 128)
  spire(P0, 199, 50, 70, 3.5)
  box(P0, 221, 226, 62, 128)
  spire(P0, 223.5, 42, 62, 3)
  box(P0, 268, 275, 64, 128)
  spire(P0, 271.5, 40, 64, 4.5)
  box(P0, 286, 293, 82, 128)
  spire(P0, 289.5, 68, 82, 4.5)
  gable(P0, 200, 222, 100, 90)
  gable(P0, 246, 270, 98, 86)
  box(P0, 200, 296, 98, 128)

  // ---- the middle plane: the nave and the halls, the round donjon
  box(P1, 206, 264, 82, 126)
  gable(P1, 206, 264, 82, 62)
  box(P1, 190, 208, 100, 126)
  gable(P1, 190, 208, 100, 90)
  box(P1, 262, 290, 90, 126)
  gable(P1, 262, 290, 90, 78)
  box(P1, 280, 293, 50, 126, { round: true })
  spire(P1, 286.5, 30, 50, 8, { slate: true, cross: true })
  for (let x = 280; x < 293; x++) if (x % 2 === 0) put(P1, x, 49, 's', 0.2)
  lancet(P1, 285, 58, 2, 4, 1)
  lancet(P1, 285, 74, 2, 4, 0)
  lancet(P1, 285, 92, 2, 5, 0.8)
  for (const [x, lit] of [[266, 0.9], [272, 0], [278, 0.7]]) lancet(P1, x, 100, 2, 4, lit)
  for (const [x, lit] of [[194, 0], [200, 0.8]]) lancet(P1, x, 106, 2, 5, lit)

  // ---- the front plane: the west front with its three towers, the buttresses, the wall
  // Left tower.
  box(P2, 214, 225, 64, 126)
  spire(P2, 219.5, 38, 64, 6.5, { crockets: true, slate: true, cross: true })
  pinnacle(P2, 213, 56, 64)
  pinnacle(P2, 225, 56, 64)
  lancet(P2, 216, 68, 2, 8, 0)
  lancet(P2, 221, 68, 2, 8, 0)
  lancet(P2, 218, 86, 3, 10, 0.75)
  lancet(P2, 218, 104, 3, 8, 0)
  // Right tower.
  box(P2, 251, 262, 68, 126)
  spire(P2, 256.5, 44, 68, 6.5, { crockets: true, slate: true, cross: true })
  pinnacle(P2, 250, 60, 68)
  pinnacle(P2, 262, 60, 68)
  lancet(P2, 253, 72, 2, 8, 0)
  lancet(P2, 258, 72, 2, 8, 0)
  lancet(P2, 255, 90, 3, 10, 0)
  lancet(P2, 255, 106, 3, 8, 0.6)
  // The great central tower and spire.
  box(P2, 228, 248, 48, 126)
  spire(P2, 238, 25, 48, 9, { crockets: true, slate: true, cross: true })
  pinnacle(P2, 227, 38, 48)
  pinnacle(P2, 248, 38, 48)
  for (const x of [231, 235, 240, 244]) lancet(P2, x, 52, 2, 9, 0)
  rose(P2, 238, 76, 6.5, 0.75)
  lancet(P2, 231, 88, 2, 9, 0)
  lancet(P2, 243, 88, 2, 9, 0)
  for (let x = 228; x < 248; x++) if (x % 2 === 0) put(P2, x, 47, 's', 0.2)
  for (let x = 228; x < 248; x++) put(P2, x, 66, 's', 0.34)
  // Portal: a deep pointed arch, dimly lit.
  for (let y = 102; y < 126; y++) {
    for (let x = 233; x < 243; x++) {
      const hw = y < 108 ? 5 * Math.sqrt(Math.max(0, 1 - ((108 - y) / 7) ** 2)) : 5
      if (Math.abs(x + 0.5 - 238) < hw - 0.3) put(P2, x, y, Math.abs(x + 0.5 - 238) < hw - 1.6 && y > 104 ? 'l' : 's', Math.abs(x + 0.5 - 238) < hw - 1.6 ? 0.42 - 0.2 * ((y - 104) / 22) : 0.32)
    }
  }
  glowSpots.push([234, 106, 8, 20, 0.4])
  // Buttresses with their flyers.
  box(P2, 204, 208, 92, 126)
  pinnacle(P2, 205, 80, 92)
  flyer(P2, 207, 92, 214, 82)
  box(P2, 267, 271, 94, 126)
  pinnacle(P2, 268, 82, 94)
  flyer(P2, 267, 94, 262, 86)
  // The curtain wall and the gatehouse where the bridge comes in.
  box(P2, 176, 300, 118, 132)
  merlons(P2, 176, 300, 118)
  box(P2, 174, 182, 100, 132, { round: true })
  spire(P2, 178, 86, 100, 5, { slate: true })
  box(P2, 190, 198, 100, 132, { round: true })
  spire(P2, 194, 86, 100, 5, { slate: true })
  lancet(P2, 177, 106, 2, 3, 0)
  lancet(P2, 193, 106, 2, 3, 0.7)
  // Arrow slits along the wall.
  for (let x = 206; x < 300; x += 13) if (x < 228 || x > 248) lancet(P2, x, 122, 1, 4, 0)
  // The gate: a lit arch behind a portcullis.
  for (let y = 118; y < 132; y++) {
    for (let x = 182; x < 190; x++) {
      const hw = y < 122 ? 4 * Math.sqrt(Math.max(0, 1 - ((122 - y) / 5) ** 2)) : 4
      if (Math.abs(x + 0.5 - 186) >= hw - 0.6) continue
      const bar = x % 2 === 1 || y % 4 === 1
      put(P2, x, y, bar ? 'w' : 'l', 0.5 - 0.22 * ((y - 118) / 14))
    }
  }
  glowSpots.push([182, 118, 8, 14, 0.6])

  // ---- light and haze
  const L = new Layer('castle')
  // A plane behind lies in the shadow of the planes in front of it for 3 cells away from the
  // moon (to the right and a little down).
  const nearer = (i, x, y) => {
    for (let j = i + 1; j < planes.length; j++) for (let k = 1; k <= 3; k++) if (planes[j].m.has(K(x - k, y - Math.round(k * 0.3)))) return true
    return false
  }
  planes.forEach((P, i) => {
    const has = (x, y) => P.m.has(K(x, y))
    const pal = fog(CST, P.haze)
    const warm = fog(WARM, P.haze * 0.5)
    for (const c of P.m.values()) {
      if (c.k === 'w') {
        L.set(c.x, c.y, mix('#04050c', HAZE, P.haze))
        continue
      }
      if (c.k === 'l') {
        L.set(c.x, c.y, tone(warm, c.v, c.x, c.y, 0))
        continue
      }
      let v = c.v
      const r = rimDepth(has, c.x, c.y)
      if (r === 1) v = c.k === 'r' ? 0.8 : 0.72
      else if (r === 2) v = Math.max(v + 0.12, 0.34)
      else if (!has(c.x, c.y - 1)) v += 0.16
      if (!has(c.x + 1, c.y)) v -= 0.05
      if (r !== 1 && nearer(i, c.x, c.y)) v = Math.min(v, 0.1)
      L.set(c.x, c.y, warmed(tone(pal, v, c.x, c.y, 0), warmAt(c.x, c.y) * (1 - P.haze)))
    }
  })
  return L
}

// ---------------------------------------------------------------- the crag under the keep

// Rock with lit facets: the difference of a noise height toward the moon.
function rockV(x, y, s, base = 0.22) {
  const h = (a, b) => noise(a * 0.08, b * 0.09, s) + 0.2 * noise(a * 0.2, b * 0.18, s + 3)
  const [dx, dy] = moonDir(x, y)
  const e = 2.2 * (h(x + dx * 1.5, y + dy * 1.5) - h(x, y))
  return base + (e > 0.09 ? 0.15 : 0)
}

function crag() {
  const L = new Layer('crag')
  const set = new Set()
  const top = x => 129 + Math.round(2 * noise(x * 0.12, 1, 41))
  const left = y => 178 + Math.round(((y - 129) / 50) * -6 + 4 * (noise(y * 0.2, 2, 42) - 0.5) + 3 * Math.sin(y * 0.15))
  for (let y = 126; y < 200; y++) for (let x = left(y); x < W; x++) if (y >= top(x)) set.add(K(x, y))
  const has = (x, y) => set.has(K(x, y))
  const pal = fog(ROCK, 0.1)
  // Big buttresses of rock side by side, leaning a little: each has a face toward the moon lit
  // along its left edge, a dark crack where it meets the next, and a ledge or two catching the
  // light on top with shadow under it. Darker toward the foot, where the fog sits.
  const r0 = rng(44)
  const cols = []
  for (let x = 172; x < 330; ) {
    const w = 17 + Math.floor(r0() * 12)
    cols.push({ x, w, lean: (r0() - 0.5) * 0.6, lit: 3 + Math.floor(r0() * 4), body: [0.17, 0.24, 0.31][Math.floor(r0() * 3)], ledges: [[134 + Math.floor(r0() * 12), 0.3 + r0() * 0.3, 0.5 + r0() * 0.5], ...(r0() < 0.6 ? [[150 + Math.floor(r0() * 8), -0.3 + r0() * 0.2, 0.4 + r0() * 0.4]] : [])] })
    x += w
  }
  const colAt = (x, y) => {
    let c = null
    for (const cl of cols) if (x >= cl.x + Math.round(cl.lean * (y - 130) + 2 * (noise(y * 0.15, cl.x, 46) - 0.5))) c = cl
    return c
  }
  for (const k of set) {
    const [x, y] = k.split(',').map(Number)
    const cl = colAt(x, y)
    const u = x - (cl.x + Math.round(cl.lean * (y - 130) + 2 * (noise(y * 0.15, cl.x, 46) - 0.5)))
    // Two planes to each buttress: the one turned toward the moon lit, with a bright ridge on
    // its edge; the one turned away in deep blue shadow; a dark crack where the next begins.
    const lit = cl.lit + Math.round(1.4 * Math.sin(y * 0.33 + cl.x))
    const ridge = Math.round(cl.w * 0.55 + 2 * Math.sin(y * 0.21 + cl.x * 0.7))
    let v = u < ridge ? cl.body + 0.06 : 0.1
    if (u === 0) v = 0.04
    else if (u <= lit) v = u === 1 ? 0.6 : 0.46
    v -= 0.06 * (y > 147 ? 1 : 0) + 0.06 * (y > 156 ? 1 : 0)
    const rr = rimDepth(has, x, y)
    if (rr === 1) v = 0.7
    else if (rr === 2) v = Math.max(v, 0.46)
    L.set(x, y, tone(pal, v, x, y, 0))
  }
  // Red creeper hanging from the foot of the wall down the rock.
  const g = fog(LEAF, 0.35)
  const r = rng(43)
  for (const x0 of [192, 214, 262, 281, 294]) {
    const w = 3 + Math.floor(r() * 4)
    for (let i = 0; i < w; i++) {
      const h = 1 + Math.round(Math.sin((i / (w - 1 || 1)) * Math.PI) * (1 + r() * 2))
      for (let k = 0; k < h; k++) L.set(x0 + i, 131 + k, g[clamp(6 - k * 2 - (i % 2), 1, 8)])
    }
  }
  return L
}

// ---------------------------------------------------------------- the hill, the path, the ruins

const HILLTOP = [[-4, 122], [14, 125], [30, 131], [46, 136], [62, 135], [78, 130], [92, 127], [104, 126], [112, 127], [116, 129]]
function hillTop(x) {
  if (x >= 116) return 129 + Math.round((x - 116) * 5.5 + 3 * (noise(x * 0.4, 5, 31) - 0.5))
  for (let i = 0; i < HILLTOP.length - 1; i++) {
    const [xa, ya] = HILLTOP[i]
    const [xb, yb] = HILLTOP[i + 1]
    if (x < xb) return Math.round(lerp(ya, yb, smooth((x - xa) / (xb - xa))) + 1.5 * (noise(x * 0.3, 4, 31) - 0.5))
  }
  return 129
}
// The slope below the crest rolls over a few knolls [x, y, half width, half height, rise]: the
// grass is lit where it turns toward the moon and falls into shadow where it turns away.
const KNOLLS = [[16, 136, 16, 8, 7], [48, 146, 18, 8, 8], [86, 138, 14, 7, 6], [26, 162, 20, 9, 7], [70, 160, 18, 8, 7], [102, 152, 10, 7, 5]]
const knollH = (x, y) => KNOLLS.reduce((s, [cx, cy, sx, sy, a]) => s + a * Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2)), 0)
function knollLight(x, y) {
  const gx = (knollH(x + 1, y) - knollH(x - 1, y)) / 2
  const gy = (knollH(x, y + 1) - knollH(x, y - 1)) / 2
  const [lx, ly] = moonDir(x, y)
  return (-gx * lx - gy * ly) / Math.hypot(gx, gy, 1)
}
const HILLG = GRASS.map((c, i) => mix(c, i < 6 ? '#262a52' : '#8e9ad0', i < 6 ? 0.42 : 0.3 + 0.05 * (i - 6)))
const LAMP = [33, 150]

// The path up the hill to the bridge, [x, y, width].
const PATHPTS = [[96, 206, 9], [84, 192, 7], [62, 180, 5], [44, 170, 4], [40, 162, 3.2], [56, 154, 3], [80, 146, 2.6], [98, 136, 2.2], [108, 128, 2]]
function hill() {
  const L = new Layer('hill')
  const set = new Set()
  for (let x = 0; x < 132; x++) for (let y = hillTop(x); y < 200; y++) set.add(K(x, y))
  const has = (x, y) => set.has(K(x, y))
  const pal = fog(HILL, 0.14)
  const grass = fog(GRASS, 0.5, '#222648')
  for (const k of set) {
    const [x, y] = k.split(',').map(Number)
    const cliff = x > 110
    const below = y - hillTop(x)
    const r = rimDepth(has, x, y)
    if (cliff) {
      let v = cliff ? rockV(x, y, 33, 0.24) - 0.1 * (y > 150 ? 1 : 0) : 0.3 - 0.1 * (below > 18 ? 1 : 0)
      if (r === 1) v = 0.72
      else if (r === 2) v = Math.max(v, 0.48)
      L.set(x, y, tone(pal, v, x, y, 0))
      continue
    }
    // Red grass over the knolls: moonlit where they face the moon, falling into shadow down the
    // slope toward the mist, the light dithered between its bands.
    let v = 0.36 + 0.4 * knollLight(x, y) - 0.2 * smooth((below - 3) / 42) + 0.08 * smooth(1 - below / 6)
    if (r === 1) v = 0.84
    else if (r === 2) v = Math.max(v + 0.12, 0.6)
    L.set(x, y, warmed(tone(HILLG, v, x, y, 0.16), warmAt(x, y) * 0.8))
  }
  // Blades along the crest, against the sky.
  for (let x = 0; x < 112; x++) {
    const t = hillTop(x)
    if (hash(x, 1, 35) > 0.55) {
      const h = 1 + Math.floor(hash(x, 2, 35) * 3)
      for (let i = 1; i <= h; i++) L.set(x + (i > 2 ? 1 : 0), t - i, grass[clamp(5 + i, 0, 10)])
    }
  }
  const st0 = fog(STONE, 0.12)
  // The path: worn stone and earth, lit along its upper edge.
  const pts = spline(PATHPTS, 10)
  const pal2 = fog(PATH, 0.08)
  const pathSet = new Map()
  for (const [px, py, w] of pts) {
    for (let y = Math.floor(py - w); y <= py + w; y++) {
      for (let x = Math.floor(px - w * 1.6); x <= px + w * 1.6; x++) {
        const d = Math.hypot((x + 0.5 - px) / 1.6, y + 0.5 - py)
        if (d < w * 0.62 && y < 200 && y >= hillTop(x)) {
          const q = d / (w * 0.62)
          const prev = pathSet.get(K(x, y))
          if (prev === undefined || q < prev) pathSet.set(K(x, y), q)
        }
      }
    }
  }
  const onPath = (x, y) => pathSet.has(K(x, y))
  for (const [k, q] of pathSet) {
    const [x, y] = k.split(',').map(Number)
    let v = 0.62 - 0.2 * q
    if (!onPath(x, y - 1)) v += 0.16
    if (!onPath(x, y + 1)) v = 0.18
    if (hash(x, y, 36) > 0.88) v -= 0.16
    v -= 0.14 * smooth((y - 166) / 30)
    // The lamp's light on the stones near it, in two steps.
    const lamp = 1 - Math.hypot(x - LAMP[0], (y - LAMP[1]) * 1.4) / 18
    const c = tone(pal2, v, x, y, 0.15)
    L.set(x, y, lamp > 0.5 ? mix(c, '#e09450', 0.42) : lamp > 0.15 ? mix(c, '#c07840', 0.22) : c)
  }
  // Tufts and loose stones along the path's edges.
  {
    const r = rng(38)
    const edge = spline(PATHPTS.slice(2), 10)
    for (let i = 2; i < edge.length - 2; i += 3) {
      const [px, py, w] = edge[i]
      const side = r() < 0.5 ? -1 : 1
      const x = Math.round(px + side * (w * 1.05 + 1 + r() * 2))
      const y = Math.round(py + (r() - 0.3) * 2)
      if (y < hillTop(x) + 2 || onPath(x, y) || x > 108) continue
      const near = y > 150 ? 0 : 0.06
      if (r() < 0.3) {
        // A stone, lit on the side toward the moon.
        const big = r() < 0.5
        const cells = big ? [[0, 0], [1, 0], [2, 0], [0, -1], [1, -1]] : [[0, 0], [1, 0], [0, -1]]
        for (const [dx, dy] of cells) L.set(x + dx, y + dy, tone(st0, dy < 0 && dx > 0 ? 0.66 : dy < 0 ? 0.5 : 0.3, x, y, 0))
      } else {
        const v = 0.36 + 0.42 * knollLight(x, y) + near
        const c = tone(HILLG, v + 0.14, x, y, 0)
        const tip = tone(HILLG, v + 0.3, x, y, 0)
        for (const [dx, dy, cc] of [[0, 0, c], [-1, -1, c], [1, -1, tip], [0, -1, c], [-1, -2, tip], [2, -2, tip]]) L.set(x + dx, y + dy, cc)
      }
    }
  }
  // A lamp post where the path turns: a straight post on a stepped foot, the lantern on top.
  lantern(L, 33, 149, 165)
  for (let x = 32; x <= 34; x++) L.set(x, 166, x === 32 ? STONE[5] : STONE[2])
  L.set(32, 167, '#0a0610')
  L.set(33, 167, '#0a0610')
  L.set(34, 167, '#0a0610')
  // Broken walls on the crest and the old arch at the bridgehead.
  const st = fog(STONE, 0.16)
  const wall = new Set()
  for (const [x0, x1, h, seed] of [[18, 34, 7, 1], [38, 50, 5, 2], [64, 72, 4, 3]]) {
    for (let x = x0; x < x1; x++) {
      const ht = h - Math.round(hash(x, seed, 37) * 2 + (x - x0 > (x1 - x0) * 0.6 ? (x - x0 - (x1 - x0) * 0.6) * 0.8 : 0))
      const base = hillTop(x) + 2
      for (let y = base - ht; y < base; y++) wall.add(K(x, y))
      if ((x - x0) % 4 < 2 && ht === h) wall.add(K(x, base - ht - 1))
    }
  }
  // The bridgehead gate: two equal straight posts under a lintel with a cornice.
  const GATE = { x0: 97, x1: 111, w: 3, top: 109 }
  for (let x = GATE.x0 - 1; x <= GATE.x1 + 1; x++) wall.add(K(x, GATE.top - 1))
  for (let x = GATE.x0; x <= GATE.x1; x++) for (const y of [GATE.top, GATE.top + 1]) wall.add(K(x, y))
  for (const px of [GATE.x0, GATE.x1 - GATE.w + 1]) for (let x = px; x < px + GATE.w; x++) for (let y = GATE.top + 2; y < 129; y++) wall.add(K(x, y))
  const hasW = (x, y) => wall.has(K(x, y))
  for (const k of wall) {
    const [x, y] = k.split(',').map(Number)
    let v = 0.26 + ((y + (x % 3 === 0 ? 1 : 0)) % 3 === 0 ? -0.06 : 0)
    const r = rimDepth(hasW, x, y)
    if (r === 1) v = 0.74
    else if (r === 2) v = 0.48
    else if (!hasW(x + 1, y) || !hasW(x - 1, y)) v = Math.min(v, 0.14)
    L.set(x, y, warmed(tone(st, v, x, y, 0), warmAt(x, y)))
  }
  // A lantern hangs from the middle of the lintel on a short chain.
  L.set(104, 111, STONE[3])
  lanternHung(L, 104, 114)
  return L
}

// ---------------------------------------------------------------- the bridge and the gorge

const DECK = 128
function gorge() {
  const L = new Layer('gorge')
  // Far walls of the gorge, falling away into the dark, and its floor lost in mist.
  for (let x = 108; x < 190; x++) {
    for (let y = 120; y < 192; y++) {
      const depth = smooth((y - 124) / 56)
      const wallL = 116 + (y - 124) * 0.55 + 4 * noise(y * 0.2, 1, 51)
      const wallR = 182 - (y - 124) * 0.5 - 4 * noise(y * 0.2, 2, 51)
      let c
      if (x < wallL || x > wallR) {
        const v = 0.3 - 0.16 * depth + (noise(x * 0.25, y * 0.08, 52) > 0.6 ? 0.08 : 0)
        c = tone(fog(ROCK, 0.42), v, x, y, 0)
      } else {
        c = tone(fog(ROCK, 0.55), 0.3 - 0.12 * depth, x, y, 0)
      }
      L.set(x, y, c)
    }
  }
  return L
}

// A lantern hanging centred on x, glass at yGlass: a roof above, a drop below.
function lanternHung(L, x, yGlass) {
  const st = fog(STONE, 0.12)
  L.set(x, yGlass - 2, st[3])
  L.set(x - 1, yGlass - 1, st[7])
  L.set(x, yGlass - 1, st[5])
  L.set(x + 1, yGlass - 1, st[3])
  for (const dy of [0, 1]) {
    L.set(x - 1, yGlass + dy, st[5])
    L.set(x + 1, yGlass + dy, st[2])
  }
  L.set(x, yGlass, WARM[7])
  L.set(x, yGlass + 1, WARM[6])
  L.set(x, yGlass + 2, st[3])
  glowSpots.push([x, yGlass, 1, 2, 1])
}
// A lantern centred on x: finial, roof, two glass cells in a frame, standing on a straight post
// from under it down to yPost. Its glass is the light the lamp list (LAMPS) names.
function lantern(L, x, yGlass, yPost) {
  const st = fog(STONE, 0.12)
  L.set(x, yGlass - 2, st[6])
  L.set(x - 1, yGlass - 1, st[7])
  L.set(x, yGlass - 1, st[5])
  L.set(x + 1, yGlass - 1, st[3])
  for (const dy of [0, 1]) {
    L.set(x - 1, yGlass + dy, st[5])
    L.set(x + 1, yGlass + dy, st[2])
  }
  L.set(x, yGlass, WARM[7])
  L.set(x, yGlass + 1, WARM[6])
  for (let y = yGlass + 2; y <= yPost; y++) L.set(x, y, y === yGlass + 2 ? st[3] : st[2])
  glowSpots.push([x, yGlass, 1, 2, 1])
}

// The piers' shadows in the fog in front of them: darker shafts falling toward the viewer and
// away from the moon, dithered out as they go. Drawn see-through over the mist.
function pierShadows() {
  const L = new Layer('piershadow')
  for (const [a, b] of [[126, 131], [148, 153], [168, 173]]) {
    const sr = shadowRun((a + b) / 2)
    for (let y = 150; y < 182; y++) {
      const t = (y - 150) / 32
      const x0 = Math.round(a + (y - 150) * sr * 1.4)
      const x1 = Math.round(b + (y - 150) * (sr * 1.4 + 0.08))
      for (let x = x0; x < x1; x++) if (t < 0.5 || bayer(x, y) > t - 0.1) L.set(x, y, '#050818')
    }
  }
  return L
}

function bridge() {
  const L = new Layer('bridge')
  const set = new Map()
  const piers = [[126, 131], [148, 153], [168, 173]]
  const spans = [[112, 126], [131, 148], [153, 168], [173, 182]]
  for (let x = 108; x < 182; x++) {
    // Deck and parapet.
    for (let y = DECK - 2; y < DECK + 4; y++) set.set(K(x, y), 'd')
    if (x % 7 === 0) for (const y of [DECK - 3, DECK - 4]) set.set(K(x, y), 'd')
    // Arch rings over each span.
    for (const [a, b] of spans) {
      if (x < a || x >= b) continue
      const half = (b - a) / 2
      const u = (x + 0.5 - (a + half)) / half
      const rise = half * 1.25
      const soffit = DECK + 4 + rise * (1 - Math.sqrt(Math.max(0, 1 - u * u)) ** 0.8)
      for (let y = DECK + 4; y < soffit; y++) set.set(K(x, y), y > soffit - 2 ? 'v' : 's')
    }
  }
  for (const [a, b] of piers) for (let x = a; x < b; x++) for (let y = DECK + 4; y < 192; y++) set.set(K(x, y), 'p')
  const has = (x, y) => set.has(K(x, y))
  const pal = fog(STONE, 0.18)
  for (const [k, kind] of set) {
    const [x, y] = k.split(',').map(Number)
    let v = kind === 'v' ? 0.36 : 0.22
    if (kind === 'p') {
      // Piers: the face toward the moon lit, the far side in shadow, darker down into the fog.
      const [a, b] = piers.find(([a, b]) => x >= a && x < b)
      v = (x - a < 2 ? 0.4 : b - 1 - x < 2 ? 0.1 : 0.22) - 0.12 * smooth((y - 140) / 40)
    }
    if (kind === 'd' && y === DECK + 1) v -= 0.06
    if ((x * 3 + y * 5) % 11 === 0) v -= 0.05
    const r = rimDepth(has, x, y)
    if (r === 1) v = 0.76
    else if (r === 2) v = Math.max(v, 0.46)
    L.set(x, y, warmed(tone(pal, v, x, y, 0), warmAt(x, y)))
  }
  // Lanterns on two parapet posts: a straight post, a lantern centred on it with a roof and a
  // finial, its frame lit by the moon on the left.
  for (const x of [133, 161]) lantern(L, x, DECK - 7, DECK - 5)
  return L
}

// ---------------------------------------------------------------- mist

// A strip of mist w cells wide that repeats across: soft wisps in two densities.
// Long low banks: a thin veil and a denser core, each a tile tw cells wide whose noise
// repeats, so the strip joins itself where it repeats.
function mistTile(name, tw, y0, th, seed, o = {}) {
  const veil = new Layer(name + 'v')
  const core = new Layer(name + 'c')
  const f = o.f ?? 0.03
  const per = (x, y, fx, fy, s) => lerp(noise(x * fx, y * fy, s), noise((x - tw) * fx, y * fy, s), x / tw)
  // A row of rounded billows that repeats every tw cells: the top edge of a fog bank.
  const billows = (s, gap, rx0, rx1, base, spread, floor) => {
    const r = rng(s)
    const n = Math.round(tw / gap)
    const B = Array.from({ length: n }, (_, i) => [(i + r() * 0.5) * (tw / n), rx0 + r() * (rx1 - rx0), base + r() * spread])
    return x => {
      let t = floor
      for (const [bx, rx, by] of B) {
        for (const k of [-tw, 0, tw]) {
          const u = (x + 0.5 - bx - k) / rx
          if (Math.abs(u) < 1) t = Math.min(t, by - rx * 0.42 * Math.sqrt(1 - u * u))
        }
      }
      return Math.round(t)
    }
  }
  const vTop = o.bank && billows(seed, 11, 6, 12, th * 0.42, th * 0.22, th * 0.6)
  const cTop = o.bank && billows(seed + 5, 9, 4, 8, th * 0.62, th * 0.18, th * 0.8)
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const t = (y + 0.5) / th
      if (o.bank) {
        // Lying in a hollow: a ragged top, solid below it, the core settling lower down.
        if (y >= vTop(x)) veil.set(x, y0 + y, o.tones[0])
        if (y >= Math.max(cTop(x), vTop(x) + 2)) core.set(x, y0 + y, o.tones[1])
        continue
      }
      const shape = Math.sin(Math.PI * t) ** (o.pow ?? 0.7)
      const n = 0.7 * per(x, y, f, 0.42, seed) + 0.3 * per(x, y, f * 3, 0.9, seed + 1)
      const dens = (0.5 + (n - 0.5) * 2) * shape - (o.cut ?? 0.3)
      if (dens > 0.14) core.set(x, y0 + y, o.tones[1])
      if (dens > 0) veil.set(x, y0 + y, o.tones[0])
    }
  }
  return { veil, core }
}
// A mist strip sliding across: veil and core move together, each at its own opacity.
function mistStrip(M, tw, y0, th, op, d, dir) {
  return (
    '<g class="sl" style="--d:' + d + 's;--n:' + tw + ';--w:' + dir * tw + 'px">' +
    '<g opacity="' + op[0] + '">' + tiled(M.veil, tw, -tw, W + 3 * tw) + '</g>' +
    '<g opacity="' + op[1] + '">' + tiled(M.core, tw, -tw, W + 3 * tw) + '</g></g>'
  )
}

// ---------------------------------------------------------------- warm light

// A halo round each lit window (steady) and each lamp (breathing slowly), drawn see-through
// over the stone.
function glows() {
  const still = new Layer('halo')
  const lamps = []
  for (const [x0, y0, w, h, s] of glowSpots) {
    if (w > 1 || h > 2) continue
    const outer = new Layer('lampo' + x0 + '_' + y0)
    const inner = new Layer('lampi' + x0 + '_' + y0)
    for (let y = y0 - 4; y <= y0 + h + 3; y++) {
      for (let x = x0 - 4; x <= x0 + 4; x++) {
        if (x === x0 && y >= y0 && y < y0 + h) continue
        const d = Math.hypot(x - x0, Math.max(y0 - y, 0, y - (y0 + h - 1)))
        if (d <= 3.6) outer.set(x, y, WARM[3])
        if (d <= 1.9) inner.set(x, y, WARM[6])
      }
    }
    lamps.push([outer, inner])
  }
  return { still, lamps }
}

// ---------------------------------------------------------------- the meadow

const meadowTop = x => Math.round(172 + 2.5 * Math.sin(x * 0.035 + 0.6) + 1.5 * Math.sin(x * 0.11 + 2) - (x < 70 ? (70 - x) * 0.08 : 0))

function meadowGround() {
  const L = new Layer('ground')
  for (let x = 0; x < W; x++) {
    // A ragged edge of short blades against the mist behind.
    const t = meadowTop(x) - (x % 4 === 1 && hash(x, 1, 60) > 0.3 ? 1 + Math.floor(hash(x, 2, 60) * 2.5) : 0)
    for (let y = t; y < 200; y++) {
      let v = 0.3 - 0.07 * (y > 177 ? 1 : 0) - 0.06 * (y > 185 ? 1 : 0) - 0.05 * (y > 193 ? 1 : 0)
      if (y - t < 1) v += 0.14
      L.set(x, y, tone(GRASS, v, x, y, 0))
    }
  }
  // The path, wider as it comes near.
  const pts = spline(PATHPTS.slice(0, 4), 10)
  for (const [px, py, w] of pts) {
    for (let y = Math.floor(py - w); y <= py + w; y++) {
      for (let x = Math.floor(px - w * 1.7); x <= px + w * 1.7; x++) {
        const d = Math.hypot((x + 0.5 - px) / 1.7, y + 0.5 - py) / (w * 0.62)
        if (d < 1 && y >= meadowTop(x)) L.set(x, y, tone(PATH, 0.34 - 0.14 * (d > 0.7 ? 1 : 0) - 0.1 * (y > 186 ? 1 : 0), x, y, 0))
      }
    }
  }
  return L
}

// Old stones in the grass: a fallen column, its capital, a leaning gravestone, a broken pillar.
function stones() {
  const L = new Layer('stones')
  const set = new Map()
  // Column drum lying on its side, a little askew: flutes run along it.
  for (let x = 194; x < 228; x++) {
    const cy = 189 + (x - 194) * 0.06
    for (let y = Math.floor(cy - 5); y <= cy + 4; y++) {
      const u = (y + 0.5 - cy) / 4.6
      if (Math.abs(u) > 1) continue
      set.set(K(x, y), { v: 0.4 - 0.32 * u + (Math.round(u * 6) % 2 === 0 ? 0.06 : -0.04) - (x > 225 ? 0.12 : 0) })
    }
  }
  // Its broken end, rough.
  for (let y = 184; y < 194; y++) for (let x = 192; x < 196; x++) if (hash(x, y, 71) > 0.3 && Math.abs(y - 189) < 5 - (196 - x)) set.set(K(x, y), { v: 0.5 })
  // The capital: a block with a scroll.
  for (let y = 182; y < 194; y++) {
    for (let x = 230; x < 244; x++) {
      const top = y < 185
      if (top && (x < 231 || x > 242)) continue
      set.set(K(x, y), { v: top ? 0.5 : 0.28 - 0.1 * ((x - 230) / 14) })
    }
  }
  for (const [x, y] of [[232, 186], [233, 187], [232, 188], [240, 186], [241, 187], [240, 188]]) set.set(K(x, y), { v: 0.12 })
  // A gravestone leaning left, round-topped, with a cross cut into it.
  for (let y = 166; y < 192; y++) {
    for (let x = 136; x < 154; x++) {
      const lx = x + 0.5 - 145 + (y - 190) * 0.12
      const ly = y + 0.5 - 172
      const inside = Math.abs(lx) < 6 && (ly > 0 || Math.hypot(lx, ly) < 6)
      if (!inside) continue
      const cross = (Math.abs(lx) < 0.8 && ly > -3 && ly < 9) || (Math.abs(ly - 1) < 0.8 && Math.abs(lx) < 3.5)
      set.set(K(x, y), { v: cross ? 0.08 : 0.3 - 0.12 * (lx / 6) + (hash(x, y, 72) > 0.8 ? -0.06 : 0) })
    }
  }
  // A broken pillar stump on the right, its top jagged.
  for (let x = 266; x < 278; x++) {
    const top = 160 + Math.round(5 * hash(x, 1, 73) + (x - 266) * 0.5)
    for (let y = top; y < 196; y++) {
      const u = (x + 0.5 - 272) / 6
      set.set(K(x, y), { v: 0.36 - 0.3 * u + ((x - 266) % 3 === 2 ? -0.08 : 0) - ((y - 160) % 9 === 0 ? 0.06 : 0) })
    }
  }
  const has = (x, y) => set.has(K(x, y))
  for (const [k, s] of set) {
    const [x, y] = k.split(',').map(Number)
    let v = s.v
    const r = rimDepth(has, x, y)
    if (r === 1) v = Math.max(v, 0.82)
    else if (r === 2) v = Math.max(v, 0.6)
    v -= 0.15 * smooth((y - 186) / 12)
    L.set(x, y, tone(STONE, v, x, y, 0))
  }
  // Each stone's shadow on the grass: a dark seam where it meets the ground, then a short, faint
  // shadow falling toward the viewer and away from the moon, hard near the stone, dithered far.
  // [x from, x to, height]: the gravestone, the column, its capital, the pillar.
  const SH = [mix('#0c0410', KEY.shadow, 0.3), mix('#2a0a18', KEY.shadow, 0.7), mix('#3c0e1c', KEY.shadow, 0.6)]
  for (const [xa, xb, ht] of [[134, 156, 26], [190, 229, 10], [229, 245, 12], [265, 279, 36]]) {
    const base = new Map()
    for (const k of set.keys()) {
      const [x, y] = k.split(',').map(Number)
      if (x >= xa && x < xb && y > (base.get(x) ?? -1)) base.set(x, y)
    }
    const len = clamp(Math.round(ht * 0.2), 2, 7)
    for (const [x, by] of base) {
      const sr = shadowRun(x)
      for (let k = 1; k <= len; k++) {
        const sx = Math.round(x + k * sr)
        const sy = by + k
        if (set.has(K(sx, sy))) continue
        const far = k / len
        if (k === 1) L.set(sx, sy, SH[0])
        else if (far < 0.6) L.set(sx, sy, SH[1])
        else if (bayer(sx, sy) > far - 0.15) L.set(sx, sy, SH[2])
      }
    }
  }
  return L
}

// Red grass: tufts of blades from roots across the meadow, back to front, lit at the tips by
// the moon. Each blade's lower part stays still; its tip goes into one of the sway bands, so a
// gust runs across the field from left to right.
const SWAY_BANDS = 8
function grassField(seed, x0, x1, n, o = {}) {
  const r = rng(seed)
  const base = new Layer('grass' + seed)
  const tips = Array.from({ length: SWAY_BANDS }, (_, i) => new Layer('tips' + seed + '_' + i))
  const blades = []
  const keep = o.keep ?? []
  for (let i = 0; i < n; i++) {
    const x = x0 + r() * (x1 - x0)
    const top = o.top ? o.top(x) : meadowTop(Math.round(x))
    const depth = Math.pow(r(), 0.7)
    const root = Math.round(top + 3 + depth * (204 - top))
    let tall = (o.h ?? 4) + depth * (o.hk ?? 8) + r() * r() * 8
    // Stones stay in view: nothing grows from behind them, and little in front.
    const stone = keep.find(([a, b, c, d]) => x > a && x < b && root > c - 2)
    if (stone) {
      if (root < stone[3] + 1) continue
      tall = Math.min(tall, 4)
    }
    const k = 2 + Math.floor(r() * 3)
    for (let j = 0; j < k; j++) blades.push({ x: x + (j - k / 2) * 0.9, root, h: tall * (0.55 + r() * 0.5), lean: (j - (k - 1) / 2) * 0.55 + 0.3 + (r() - 0.5) * 0.4, depth, flower: j === 0 && tall > 7 && r() < (o.flowers ?? 0.08) ? (r() < 0.35 ? 'red' : 'pale') : null })
  }
  blades.sort((a, b) => a.root - b.root)
  for (const b of blades) {
    const band = clamp(Math.floor(((b.x + 20) / (W + 40)) * SWAY_BANDS), 0, SWAY_BANDS - 1)
    let last = null
    for (let s = 0; s < b.h; s++) {
      const q = s / b.h
      const x = Math.round(b.x + b.lean * q * q * b.h * 0.6)
      const y = b.root - s
      const [mdx] = moonDir(x, y)
      let v = 0.2 + 0.44 * q + 0.1 * (1 - b.depth) * (1 - q)
      if (q > 0.75 && (mdx > 0) === (b.lean > 0)) v += 0.12
      const c = tone(GRASS, v, x, y, 0)
      const L = q > 0.55 ? tips[band] : base
      L.set(x, y, c)
      last = [x, y]
    }
    if (b.flower && last) {
      const [fx, fy] = last
      const T = tips[band]
      if (b.flower === 'red') {
        for (const [dx, dy, c] of [[0, -1, '#e8443c'], [-1, 0, '#c42a30'], [1, 0, '#ff6a52'], [0, 0, '#3a0a12'], [0, 1, '#9a1c26'], [-1, -1, '#a4202a'], [1, -1, '#ff8a6a']]) T.set(fx + dx, fy + dy, c)
      } else {
        for (const [dx, dy, c] of [[0, -1, '#eef2fc'], [-1, 0, '#b4c4e2'], [1, 0, '#d8e2f4'], [0, 1, '#8090b8'], [0, 0, '#f0d878']]) T.set(fx + dx, fy + dy, c)
      }
    }
  }
  return { base, tips }
}

// ---------------------------------------------------------------- trees

// A gnarled tree: limbs as tapering polylines [x, y, width] bent by noise, bark lit on the side
// that faces the moon; clusters of crimson leaves as stamps.
function limb(L, set, pts, seed, wob = 1.2) {
  const sm = spline(pts, 6)
  for (let i = 0; i < sm.length - 1; i++) {
    const [xa, ya, wa] = sm[i]
    const [xb, yb, wb] = sm[i + 1]
    const n = Math.ceil(Math.hypot(xb - xa, yb - ya) * 2) + 1
    for (let j = 0; j <= n; j++) {
      const t = j / n
      const x = lerp(xa, xb, t) + wob * (noise(lerp(ya, yb, t) * 0.15, 0, seed) - 0.5)
      const y = lerp(ya, yb, t)
      const w = Math.max(0.6, lerp(wa, wb, t))
      for (let yy = Math.floor(y - w / 2); yy <= y + w / 2; yy++) {
        for (let xx = Math.floor(x - w / 2); xx <= x + w / 2; xx++) {
          if (Math.hypot(xx + 0.5 - x, yy + 0.5 - y) <= w / 2 + 0.25) set.add(K(xx, yy))
        }
      }
    }
  }
}
function barkPaint(L, set, seed) {
  const has = (x, y) => set.has(K(x, y))
  for (const k of set) {
    const [x, y] = k.split(',').map(Number)
    let v = 0.2
    if (noise(x * 0.5, y * 0.03, seed + 1) > 0.8) v -= 0.08 // furrows
    const r = rimDepth(has, x, y, 2)
    L.set(x, y, r === 1 ? BARK_RIM : tone(BARK, r === 2 ? 0.66 : v, x, y, 0))
  }
}
// A cluster of leaves round (cx, cy), rx by ry: a dark core and leaf stamps over it, lit on
// the side toward the moon.
const STAMPS = [
  [[0, 0], [1, 0], [0, 1]],
  [[0, 0], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [1, 1]],
  [[1, 0], [0, 1], [1, 1], [2, 1]],
  [[0, 0], [1, 0], [1, -1]],
]
function foliage(L, r, cx, cy, rx, ry, o = {}) {
  const [mx, my] = moonDir(cx, cy)
  const core = new Set()
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const q = ((x + 0.5 - cx) / (rx * 0.78)) ** 2 + ((y + 0.5 - cy) / (ry * 0.72)) ** 2
      if (q + (noise(x * 0.3, y * 0.3, o.seed ?? 1) - 0.5) * 0.8 < 1) core.add(K(x, y))
    }
  }
  for (const k of core) {
    const [x, y] = k.split(',').map(Number)
    L.set(x, y, LEAF[0])
  }
  const n = Math.round(rx * ry * (o.density ?? 0.7))
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2
    const d = Math.sqrt(r())
    const x = Math.round(cx + Math.cos(a) * d * rx)
    const y = Math.round(cy + Math.sin(a) * d * ry)
    const lit = Math.cos(a) * mx + Math.sin(a) * my
    const v = 0.24 + 0.34 * d * lit + 0.18 * (1 - Math.sin(a) > 1 ? 0.6 : 0) + (r() - 0.5) * 0.2 + (o.lift ?? 0)
    const st = STAMPS[Math.floor(r() * STAMPS.length)]
    st.forEach(([dx, dy], j) => L.set(x + dx, y + dy, tone(LEAF, v + (j === 0 ? 0.12 : -0.04), x + dx, y + dy, 0)))
  }
}

function leftTree() {
  const r = rng(81)
  const wood = new Layer('ltree')
  const set = new Set()
  limb(wood, set, [[2, 208, 22], [8, 188, 16], [4, 168, 13], [12, 148, 13], [8, 128, 11], [16, 108, 9], [22, 88, 7]], 1, 5)
  // A burl on the trunk and a broken stub.
  limb(wood, set, [[10, 150, 9], [17, 146, 6], [22, 147, 3]], 12)
  limb(wood, set, [[6, 172, 6], [-4, 160, 5]], 13)
  limb(wood, set, [[20, 92, 7], [36, 70, 5.5], [52, 52, 4.5], [68, 40, 3.5], [84, 32, 2.6], [98, 28, 1.8], [108, 24, 1]], 2)
  limb(wood, set, [[18, 96, 6], [16, 74, 5], [20, 54, 4], [14, 34, 3.2], [20, 14, 2.4], [16, -4, 2]], 3)
  limb(wood, set, [[11, 130, 6], [0, 116, 5], [-8, 100, 4]], 4)
  limb(wood, set, [[46, 58, 3], [48, 42, 2.2], [42, 26, 1.6], [46, 12, 1]], 5)
  limb(wood, set, [[30, 76, 3], [44, 74, 2], [54, 78, 1.2]], 8)
  limb(wood, set, [[16, 54, 2.6], [30, 40, 2], [36, 24, 1.4]], 9)
  // Roots spreading at the foot.
  limb(wood, set, [[8, 196, 5], [22, 200, 3], [32, 204, 2]], 10)
  barkPaint(wood, set, 11)
  // Leaves, back to front in clumps; each clump sways on its own.
  const clumps = [
    [22, 30, 18, 12],
    [48, 24, 18, 10],
    [6, 50, 12, 12],
    [64, 34, 14, 8],
    [86, 26, 12, 6],
    [36, 10, 20, 8],
    [100, 24, 7, 4],
  ].map(([x, y, rx, ry], i) => {
    const L = new Layer('lleaf' + i)
    foliage(L, r, x, y, rx, ry, { seed: 90 + i })
    return L
  })
  return { wood, clumps }
}

function rightTree() {
  const r = rng(82)
  const wood = new Layer('rtree')
  const set = new Set()
  limb(wood, set, [[318, 208, 18], [310, 184, 13], [314, 162, 11], [306, 138, 10], [311, 116, 8], [304, 92, 7], [308, 70, 5.5], [304, 48, 4]], 21, 4)
  limb(wood, set, [[306, 100, 5], [292, 84, 4], [280, 72, 3.2], [268, 66, 2.4], [256, 66, 1.6], [248, 70, 1]], 22)
  limb(wood, set, [[305, 60, 3.6], [296, 40, 3], [290, 22, 2.2], [294, 4, 1.6]], 23)
  limb(wood, set, [[308, 76, 3.4], [318, 58, 3], [326, 40, 2.4]], 24)
  limb(wood, set, [[280, 72, 2], [276, 82, 1.4], [272, 92, 0.9]], 25)
  limb(wood, set, [[296, 42, 2], [282, 34, 1.4], [272, 30, 1]], 26)
  limb(wood, set, [[310, 196, 5], [298, 202, 3]], 27)
  barkPaint(wood, set, 28)
  const clumps = [
    [306, 6, 18, 8],
    [300, 24, 18, 11],
    [318, 46, 12, 13],
    [276, 32, 13, 7],
    [260, 64, 9, 5],
    [288, 60, 10, 7],
  ].map(([x, y, rx, ry], i) => {
    const L = new Layer('rleaf' + i)
    foliage(L, r, x, y, rx, ry, { seed: 120 + i, density: 0.62 })
    return L
  })
  return { wood, clumps }
}

// ---------------------------------------------------------------- small life

// A bat, 5 x 2 cells: wings up, then down.
const BAT = { a: ['xx...xx', '..xxx..'], b: ['..xxx..', 'xx...xx'] }
function sprite(L, x, y, rows, color) {
  rows.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && L.set(x + i, y + j, color)))
  return L
}

// An orbit's keyframes for one axis: a cosine from -a to a and back in 16 equal pieces of
// `seg` seconds, each piece moving whole cells, one every step, every step on the clock.
function orbitKf(name, a, seg) {
  const ticks = Math.round(seg * 20)
  const ok = []
  for (let n = 1; n <= ticks; n++) if (ticks % n === 0) ok.push(n)
  const ideal = []
  for (let i = 0; i < 16; i++) ideal.push(Math.abs(-a * Math.cos((2 * Math.PI * (i + 1)) / 16) + a * Math.cos((2 * Math.PI * i) / 16)))
  // Round each half to allowed counts that still sum to 2a.
  const half = ideal.slice(0, 8)
  let pick = half.map(v => (v < 0.5 ? 0 : ok.reduce((b, n) => (Math.abs(n - v) < Math.abs(b - v) ? n : b), ok[0])))
  let sum = pick.reduce((s, v) => s + v, 0)
  let guard = 0
  while (sum !== 2 * a && guard++ < 200) {
    // nudge the piece whose error is largest in the needed direction
    let best = -1
    let bestErr = -Infinity
    for (let i = 0; i < 8; i++) {
      const cand = sum < 2 * a ? ok.find(n => n > pick[i]) : [...ok].reverse().find(n => n < pick[i]) ?? 0
      if (cand === undefined) continue
      const err = sum < 2 * a ? half[i] - pick[i] : pick[i] - half[i]
      if (err > bestErr) {
        bestErr = err
        best = i
      }
    }
    if (best < 0) break
    pick[best] = sum < 2 * a ? ok.find(n => n > pick[best]) : [...ok].reverse().find(n => n < pick[best]) ?? 0
    sum = pick.reduce((s, v) => s + v, 0)
  }
  // Pieces in a row at the same pace become one keyframe: n cells a piece over m pieces is
  // n * m steps, still one every n-th of a piece.
  const runs = []
  for (let i = 0; i < 16; i++) {
    const n = pick[i % 8]
    const last = runs[runs.length - 1]
    if (last && last.n === n && i !== 8) last.m++
    else runs.push({ i, n, m: 1, dir: i < 8 ? 1 : -1 })
  }
  let k = ''
  let pos = -a
  const ax = 'translate' + name.slice(-1).toUpperCase()
  for (const r of runs) {
    k += f2((r.i / 16) * 100) + '%{transform:' + ax + '(' + pos + 'px)' + (r.n ? ';animation-timing-function:steps(' + r.n * r.m + ')' : '') + '}'
    pos += r.dir * r.n * r.m
  }
  return '@keyframes ' + name + '{' + k + 'to{transform:' + ax + '(' + pos + 'px)}}'
}

// Orbits shared by the bats: [half width, half height, seconds a sixteenth]. A bat's x and y
// each run the orbit's keyframes; its y a quarter turn behind, or twice as fast for a loop.
const ORBITS = { A: [12, 4, 0.6], B: [7, 3, 0.5] }
const BAT_INK = '#04050b'
function bat(cx, cy, orb, dx, lx, dy, ly, flap) {
  const up = draw(sprite(new Layer('bat'), cx - 3, cy, BAT.a, BAT_INK))
  const down = draw(sprite(new Layer('bat'), cx - 3, cy, BAT.b, BAT_INK))
  return (
    '<g class="o' + orb + 'x" style="--d:' + dx + 's;--l:' + lx + 's"><g class="o' + orb + 'y" style="--d:' + dy + 's;--l:' + ly + 's;--f:' + flap + 's">' +
    '<g class="fa">' + up + '</g><g class="fb" opacity="0">' + down + '</g></g></g>'
  )
}
// A leaf that lets go of its clump and falls a cell every 0.3 s, drifting with the wind and
// turning over as it goes; it is gone below the grid before it starts again.
function leaf(x, y, D, Dx, l, turn) {
  const a = new Layer('leaf')
  a.set(x, y, '#c8323a')
  a.set(x + 1, y, '#c8323a')
  const b = new Layer('leaf')
  b.set(x + 1, y, '#e8584a')
  b.set(x, y + 1, '#e8584a')
  if (Math.round(D * 6) % Dx) throw new Error('leaf drift ' + Dx + ' off the clock')
  return (
    '<g class="lf" style="--d:' + tk(D * 0.3) + 's;--l:' + l + 's;--n:' + D + ';--y:' + D + 'px;--f:' + turn + 's"><g class="lx" style="--n:' + Dx + ';--w:' + Dx + 'px">' +
    '<g class="fa">' + draw(a) + '</g><g class="fb" opacity="0">' + draw(b) + '</g></g></g>'
  )
}

// ---------------------------------------------------------------- the scene, back to front

const SEAM = new Set() // names of layers drawn over others in their part
// The sky, the moon and its light.
part('pB', [{ raw: sky() }, stars(), moon()])
// Thin wisps that slide across the moon, one tile of 320 cells repeating.
{
  const L = new Layer('wisps')
  L.plain = true
  const add = (puffs, seed) => merge(L, cloud('w' + seed, puffs, { seed, body: 0.32, rim: 0.4, glow: 0.3, rough: 0.5, dither: 0.15 }))
  add([[44, 50, 22, 1.6], [62, 49, 14, 1.3]], 201)
  add([[136, 44, 16, 1.4], [150, 45, 10, 1.2]], 202)
  add([[224, 58, 24, 1.8], [244, 57, 12, 1.2]], 203)
  add([[290, 36, 14, 1.2]], 204)
  for (const [x, y] of [...cells(L)]) if (x < 1 || x > 318) L.m.delete((y + 1000) * 4096 + x + 1000)
  part('pB', [{ raw: '<g opacity=".72"><g class="sl" style="--d:256s;--n:320;--w:320px">' + tiled(L, 320, -320, 960) + '</g></g>' }])
}
// The bank of cloud that crosses the lower moon, and the high clouds over the keep.
{
  const bank = cloud('bank', [[54, 92, 16, 3.2], [76, 89, 18, 3.8], [100, 87, 20, 4.2], [124, 88, 18, 4], [148, 91, 16, 3.4], [170, 94, 14, 3], [192, 96, 12, 2.6]], { seed: 11, base: 95, glowR: 36, rim: 0.5, glow: 0.3, body: 0.26 })
  bank.plain = true
  const high = cloud('high', [[178, 46, 14, 5], [198, 40, 18, 6.5], [222, 46, 14, 5], [252, 34, 18, 7], [280, 42, 16, 6], [306, 34, 14, 5], [150, 30, 10, 3]], { seed: 12, glowR: 60, rim: 0.4, glow: 0.18, body: 0.22 })
  const far = cloud('farc', [[230, 92, 30, 4], [280, 96, 26, 3.4], [190, 100, 22, 3], [30, 102, 24, 3]], { seed: 14, glowR: 60, body: 0.26, rim: 0.3, glow: 0.12 })
  high.anim = anim('cb', '--d:90s;--l:-30s')
  part('pB', [far, high, bank])
  bank.anim = anim('cb2', '--d:70s;--l:-10s')
}
part('pB', [farLand()])
// Mist in the far valley, then in the gorge and the hollows: strips sliding opposite ways,
// each a cell at a time (1.2, 1.2 and 0.9 s a cell).
const MIST_FAR = mistTile('mfar', 160, 116, 16, 301, { tones: ['#6a82b0', '#8aa0c6'], f: 0.035, cut: 0.26 })
part('pB', [{ raw: mistStrip(MIST_FAR, 160, 116, 16, ['.35', '.45'], 192, 1) }])
const CASTLE = castle()
part('pB', [gorge(), CASTLE, crag(), bridge()])
part('pB', [hill()])
// Bats round the spires. The first circles the central spire in depth: on the far half of its
// orbit (the upper half on screen) a copy of the spires it crosses is shown over it, so it
// passes behind them; on the near half the copy is hidden and it passes in front.
{
  const spires = new Layer('spires')
  for (const [x, y, c] of cells(CASTLE)) if (x >= 224 && x <= 256 && y >= 28 && y <= 39) spires.set(x, y, c)
  spires.anim = anim('zb', '--d:9.6s;--l:-2.4s', ' opacity="0"')
  spires.follow = true
  part('pB', [{ raw: bat(240, 33, 'A', 9.6, 0, 9.6, -2.4, 0.4) }, spires, { raw: bat(226, 41, 'A', 9.6, -5.4, 4.8, -1.2, 0.3) + bat(253, 46, 'B', 8, -3, 8, 0, 0.5) + bat(211, 30, 'B', 8, -6.5, 4, -2, 0.4) }])
}
{
  const G = glows()
  let raw = ''
  G.lamps.forEach(([outer, inner], i) => {
    raw += '<g class="br" style="--d:' + (8 + (i % 3)) + 's;--l:' + tk(-i * 2.7) + 's"><g opacity=".22">' + draw(outer) + '</g><g opacity=".3">' + draw(inner) + '</g></g>'
  })
  part('pB', [{ raw }])
}
const MIST_A = mistTile('mista', 128, 140, 40, 302, { tones: ['#7a8eb8', '#9cb0d2'], f: 0.05, bank: true })
const MIST_B = mistTile('mistb', 96, 156, 24, 303, { tones: ['#8296bc', '#a8bad8'], f: 0.06, bank: true })
part('pB', [{ raw: mistStrip(MIST_A, 128, 140, 40, ['.2', '.22'], 153.6, 1) + mistStrip(MIST_B, 96, 156, 24, ['.18', '.22'], 86.4, -1) + '<g opacity=".32">' + draw(pierShadows()) + '</g>' }])
// The meadow, the stones, the grass.
{
  const g = grassField(401, -10, 330, 98, { flowers: 0.34, keep: [[134, 156, 164, 191], [190, 246, 181, 195], [264, 280, 158, 196]] })
  const layers = [meadowGround(), stones(), g.base]
  g.tips.forEach((T, i) => {
    T.anim = anim('gs', '--d:5s;--l:' + tk(-((i / SWAY_BANDS) * 5)) + 's')
    layers.push(T)
  })
  part('pB', layers)
}
// The trees, pinned to their corners, with grass at their feet.
for (const [pin, T, seed, x0, x1] of [['pBL', leftTree(), 501, -6, 60], ['pBR', rightTree(), 502, 270, 330]]) {
  const layers = [T.wood]
  T.clumps.forEach((C, i) => {
    C.anim = anim('lv', '--d:' + (7 + (i % 3)) + 's;--l:' + tk(-i * 1.35) + 's')
    layers.push(C)
  })
  const g = grassField(seed, x0, x1, 26, { h: 6, hk: 9, flowers: 0.15 })
  layers.push(g.base)
  g.tips.forEach((L, i) => {
    if (!L.size) return
    L.anim = anim('gs', '--d:5s;--l:' + tk(-((i / SWAY_BANDS) * 5)) + 's')
    layers.push(L)
  })
  layers.push({ raw: pin === 'pBL'
    ? leaf(60, 38, 170, 17, -2, 1.2) + leaf(88, 30, 175, 21, -20, 1) + leaf(30, 42, 166, 12, -36, 1.4) + leaf(100, 26, 176, 24, -40, 1.1)
    : leaf(276, 36, 170, 10, -14, 1.3) + leaf(296, 28, 176, 8, -44, 1.2) })
  part(pin, layers)
}

// ---------------------------------------------------------------- motion

// Sway by whole cells: up to A cells and back, eased, as keyframes a twentieth apart.
function sway(name, A, fn = 'translateX') {
  let k = ''
  let last = null
  for (let i = 0; i <= 20; i++) {
    const v = Math.round((A * (1 - Math.cos((Math.PI * 2 * i) / 20))) / 2)
    if (v !== last || i === 20) k += i * 5 + '%{transform:' + (v ? fn + '(' + v + 'px)' : 'none') + '}'
    last = v
  }
  return '@keyframes ' + name + '{' + k + '}'
}
const from = l => 'calc(' + l + ' + var(--m))'
// A lamp breathes: its halo swells and ebbs in twenty steps, a fortieth of its light at a time.
function breathe() {
  let k = ''
  for (let i = 0; i <= 20; i++) k += i * 5 + '%{opacity:' + f2(0.6 + 0.4 * (0.5 + 0.5 * Math.cos((Math.PI * 2 * i) / 20))) + '}'
  return '@keyframes br{' + k + '}'
}
const RULES = [
  '.br{animation:br var(--d) steps(1) ' + from('var(--l)') + ' infinite}' + breathe(),
  // Strips that slide across and repeat: wisps, mist.
  '.sl{animation:sl var(--d) steps(var(--n)) var(--m) infinite}@keyframes sl{to{transform:translateX(var(--w))}}',
  // The high clouds and the bank drift a few cells and back.
  '.cb{animation:cb var(--d) steps(1) ' + from('var(--l)') + ' infinite}' + sway('cb', -6),
  '.cb2{animation:cb2 var(--d) steps(1) ' + from('var(--l)') + ' infinite}' + sway('cb2', 4),
  // Grass tips and leaves sway a cell in the wind.
  '.gs{animation:gs var(--d) steps(1) ' + from('var(--l)') + ' infinite}@keyframes gs{0%{transform:none}20%{transform:translateX(1px)}60%,100%{transform:none}}',
  '.lv{animation:lv var(--d) steps(1) ' + from('var(--l)') + ' infinite}@keyframes lv{0%{transform:none}25%{transform:translateX(1px)}45%{transform:translate(1px,1px)}65%,100%{transform:none}}',
  // Bats: x and y each run an orbit's keyframes; wings and leaves swap two frames.
  ...Object.entries(ORBITS).map(([k, [a, b, seg]]) =>
    ['x', 'y'].map(ax => '.o' + k + ax + '{animation:o' + k + ax + ' var(--d) ' + from('var(--l)') + ' infinite}' + orbitKf('o' + k + ax, ax === 'x' ? a : b, seg)).join('')),
  '.fa{animation:fa var(--f) steps(1) var(--m) infinite}@keyframes fa{50%{opacity:0}}',
  '.zb{animation:zb var(--d) steps(1) ' + from('var(--l)') + ' infinite}@keyframes zb{0%{opacity:1}25%{opacity:0}75%,to{opacity:1}}',
  '.fb{animation:fb var(--f) steps(1) var(--m) infinite}@keyframes fb{0%{opacity:0}50%,to{opacity:1}}',
  // Falling leaves: down a cell a step, and across with the wind.
  '.lf{animation:lf var(--d) steps(var(--n)) ' + from('var(--l)') + ' infinite}@keyframes lf{to{transform:translateY(var(--y))}}',
  '.lx{animation:sl var(--d) steps(var(--n)) ' + from('var(--l)') + ' infinite}',
  '@media (prefers-reduced-motion:reduce){:root *{animation:none!important}}',
]
let CSS = RULES.join('')

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

const PIN = { pB: 'xMidYMax', pBL: 'xMinYMax', pBR: 'xMaxYMax' }
const view = pin => '<svg viewBox="0 -.5 ' + W + ' ' + H + '" preserveAspectRatio="' + PIN[pin] + ' slice">'
const sizes = []
const pieces = []
// Parts on one pin share a viewport, so a still layer in a later part covers the cells of an
// earlier one exactly; the strips between them are see-through or moving and cover nothing.
for (const pin of Object.keys(PIN)) cull(parts.filter(p => p.pin === pin).flatMap(p => p.layers))
for (const p of parts) {
  curPin = p.pin
  const body = renderLayers(p.layers)
  pieces.push([p.pin, body])
  sizes.push([p.pin, body.length])
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
CSS += lipRules()
let svg =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" font-family="a" color="a" style="--m:0s">' +
  '<style>' + CSS + '</style><defs>' + defs.join('') + '</defs>' + body + '</svg>'
svg = svg.replaceAll('"', "'")

const LIMIT = 131072 - 200
const scrubbed = svg.length - CSS.length + keptLength(CSS) + [...svg.matchAll(/<(\w+)[^>]*\/>/g)].reduce((n, m) => n + 2 + m[1].length, 0)
fs.mkdirSync(path.join(HERE, 'out'), { recursive: true })
fs.writeFileSync(path.join(HERE, 'out', 'moon-keep.svg'), svg)
console.log('scene', svg.length, 'chars,', scrubbed, 'after the app scrub, of', LIMIT, scrubbed <= LIMIT && svg.length <= LIMIT ? 'OK' : 'TOO BIG')
console.log('css', CSS.length, '| patterns', stats.patterns, 'holding', stats.patternRuns, 'runs; plain runs', stats.plainRuns, '| lips', stats.lips ?? 0)
if (process.env.STATS) {
  const top = [...stats.byLayer].filter(([n]) => process.env.STATS === "2" ? n.startsWith("  ") : !n.startsWith("  ")).sort((a, b) => b[1] - a[1]).slice(0, 60)
  console.log('  ' + top.map(([n, r]) => n.slice(0, 50) + ':' + r).join('\n  '))
}
if (process.env.STATS === 'cmp') { const tot = [0, 0, 0, 0]; for (const r of stats.enc) { if (r.length < 6) continue; r.slice(2).forEach((v, i) => (tot[i] += v)) }; console.log('  plain old engineSafe local'); console.log('  TOTAL', tot.join(' ')); for (const r of stats.enc.filter(r => r.length === 6).sort((p, q) => q[2] - p[2]).slice(0, Number(process.env.TOP ?? 40))) console.log('  ' + r[0].slice(0, 30).padEnd(30), r.slice(1).map(v => String(v).padStart(7)).join('')) }
if (process.env.STATS === 'enc') for (const [n, k, x, y] of stats.enc.sort((p, q) => Math.min(q[2], q[3]) - Math.min(p[2], p[3]))) console.log('  ' + n.slice(0, 40).padEnd(40), String(k).padStart(4), String(x).padStart(7), String(y).padStart(7), y < x ? 'terrace' : 'safe')
if (scrubbed > LIMIT || svg.length > LIMIT) process.exitCode = 1
