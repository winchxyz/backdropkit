// Harbor: a fishing harbour seen from a pier, one drawing at three moments (day, sunset, night),
// each written as one animated pixel-art SVG the Claude desktop app's backdrop player can run.
// Same pipeline as Sunfield: a 320 x 200 cell grid (x right, y down), cells written as stroke
// runs (sunfield/tools/pixel.mjs), big still layers in <pattern> tiles, motion in CSS steps on
// the shared 0.05 s clock.
// node build.mjs  ->  out/harbor-day.svg, out/harbor-sunset.svg, out/harbor-night.svg
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Layer, bayer, bounds, clamp, hex, lerp, rgb, rng, smooth, tone } from '../../../sunfield/tools/pixel.mjs'
import { billow, line, paintCloud } from '../../../sunfield/tools/painters.mjs'
import { emitSafe } from './encode-local.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const W = 320
const H = 200
const HY = 112 // the sea horizon: the first row of water
const TICK = 0.05
const ticks = s => Math.round(s / TICK)
const f2 = v => Math.round(v * 100) / 100
const cellOf = k => [(k % 4096) - 1000, Math.floor(k / 4096) - 1000]

// ---------------------------------------------------------------- colour

const mix = (a, b, t) => {
  const A = rgb(a)
  const B = rgb(b)
  return hex([0, 1, 2].map(i => lerp(A[i], B[i], t)))
}
// A colour grade: saturation, then a multiply and an add per channel (sRGB, 0..255).
function grade(c, g) {
  const [r, gg, b] = rgb(c)
  const l = 0.3 * r + 0.59 * gg + 0.11 * b
  return hex([r, gg, b].map((v, i) => (l + (v - l) * g.sat) * g.mul[i] + g.add[i]))
}
function grad(stops, y) {
  if (y <= stops[0][0]) return stops[0][1]
  for (let i = 0; i < stops.length - 1; i++) {
    const [ya, ca] = stops[i]
    const [yb, cb] = stops[i + 1]
    if (y <= yb) return mix(ca, cb, (y - ya) / (yb - ya))
  }
  return stops[stops.length - 1][1]
}
const short = h => (h.length === 7 && h[1] === h[2] && h[3] === h[4] && h[5] === h[6] ? '#' + h[1] + h[3] + h[5] : h)
// Snaps a colour to a coarse grid, so near-equal reflection colours share one path.
const snap = (c, q = 12) => hex(rgb(c).map(v => Math.round(v / q) * q))

// Smooth value noise.
function noise2(seed) {
  const r = rng(seed)
  const N = 64
  const g = Array.from({ length: N * N }, () => r())
  const at = (i, j) => g[(((j % N) + N) % N) * N + (((i % N) + N) % N)]
  return (x, y) => {
    const i = Math.floor(x)
    const j = Math.floor(y)
    const sx = smooth(x - i)
    const sy = smooth(y - j)
    return lerp(lerp(at(i, j), at(i + 1, j), sx), lerp(at(i, j + 1), at(i + 1, j + 1), sx), sy)
  }
}
const N1 = noise2(7)
const N2 = noise2(19)
const N3 = noise2(41)

// ---------------------------------------------------------------- materials and moments

// Every surface is painted as a material and a brightness; each moment maps the material to
// its own ramp (dark to light). The day ramps are the materials' own colours; sunset and night
// grade them and override the ones that carry the moment.
const BASE = {
  mtn: ['#6d88bd', '#7b95c6', '#8aa3cf', '#9bb2d8', '#aec1e1'],
  mtn2: ['#55739f', '#6282ad', '#7192bb', '#83a3c7'],
  hill: ['#2c5236', '#386440', '#47784a', '#5a8c52', '#73a05e', '#90b46c'],
  tree: ['#1a3a28', '#244a30', '#2f5c38', '#3e7044'],
  rock: ['#4a4652', '#5f5966', '#77707a', '#918782', '#ab9f90', '#c6b8a0'],
  grass: ['#3c6a32', '#4f8038', '#679a44', '#86b452'],
  quay: ['#5f5c66', '#7a7680', '#958f92', '#b1a9a6', '#c9c0b6'],
  wW: ['#959eb2', '#c3c7d1', '#e4e2dc', '#faf7ef'],
  wY: ['#a3772f', '#c99940', '#e3b85c', '#f4d283'],
  wP: ['#a05a5a', '#c67870', '#df9886', '#f2b6a0'],
  wB: ['#4c779f', '#6893bd', '#89b0d4', '#aac8e4'],
  wT: ['#843a32', '#a8523e', '#c46e4c', '#da8a62'],
  wG: ['#5a7860', '#77967a', '#95b392', '#b2caa9'],
  wO: ['#aa5c36', '#cc7842', '#e49656', '#f2b270'],
  roof: ['#5e2a20', '#83392a', '#a64d36', '#c46644', '#dc8458'],
  slate: ['#2b3242', '#3e485a', '#556176', '#6f7b94'],
  glass: ['#1b2234', '#28334a', '#3e5070', '#7b97be'],
  shut: ['#2a523e', '#386a4c', '#4c8460'],
  door: ['#35261e', '#4c3628', '#664a34'],
  lhW: ['#8792a6', '#b2bacb', '#dadee6', '#f3f3f1', '#ffffff'],
  lhR: ['#661c20', '#8e2828', '#b43830', '#d2503e'],
  iron: ['#15181e', '#242831', '#383e4a', '#535b6b', '#768092'],
  beacon: ['#1d4a30', '#2a6440', '#3b8052', '#58a068'],
  wood: ['#4c2e1c', '#673f27', '#835432', '#9e6a40', '#b68350', '#cb9c64', '#dcb47c'],
  crate: ['#173f78', '#1f5496', '#2c6cb4', '#4888cc', '#6ea6de'],
  crateR: ['#7a2018', '#a42c1e', '#c8442a', '#e2643c'],
  woodD: ['#261810', '#362417', '#4a3220', '#60432c', '#78573a'],
  rope: ['#6a5030', '#8e6c44', '#b28e5a', '#cfad76'],
  hullT: ['#0f3646', '#164a5c', '#1e6072', '#2a788a', '#4692a2'],
  hullR: ['#641a1c', '#882424', '#ac322e', '#ca4838', '#e26448'],
  hullW: ['#8b95a6', '#b3bbc6', '#d7dbe2', '#f0f0ee'],
  hullY: ['#86601a', '#ae8022', '#d2a02e', '#ecc044'],
  hullG: ['#1c4436', '#285e4a', '#38785c', '#4e9070'],
  hullB: ['#1a3058', '#264478', '#355c98', '#4c74b2'],
  orange: ['#a44616', '#cc5e1e', '#ec7e2c', '#ffa244'],
  net: ['#24402e', '#345a42', '#4a7656'],
  fish: ['#5e6e80', '#8e9eb0', '#c6d2de', '#eef4f8'],
  gull: ['#727e92', '#9ea9ba', '#d2d9e2', '#f4f6f8'],
  ink: ['#181b23', '#262a34'],
  beak: ['#d88a24', '#f0aa3a'],
  lamp: ['#a8c4d4', '#cfe2ec', '#eef6fa'],
  mud: ['#3a3430', '#4c4440'],
}

// Cloud tones per moment, dark to light.
const CLOUDS = {
  day: ['#7fb2e6', '#9cc6ef', '#bcdaf6', '#d8eafb', '#eef6fe', '#ffffff'],
  sunset: ['#4a3272', '#6c3c80', '#9a4c80', '#cc6474', '#f08868', '#ffb27a', '#ffd89a'],
  night: ['#121a3c', '#18224a', '#202c5a', '#2a386a', '#38487c', '#4c5e92'],
}

const MOMENTS = {
  day: {
    sky: [[0, '#2556be'], [22, '#2c67cf'], [44, '#3b7fdd'], [66, '#5698e8'], [84, '#7ab2ef'], [98, '#a3ccf5'], [107, '#c8e2fa'], [112, '#def0fc']],
    water: [[112, '#b2daf1'], [116, '#8cc4e9'], [124, '#69acdb'], [138, '#4e95cd'], [158, '#3a7fbf'], [180, '#2d6bac'], [200, '#245a99']],
    waveHi: ['#d2ecfa', '#9fd0f0', '#6ea8da'],
    waveLo: ['#78b2df', '#3e83c3', '#1f5593'],
    glint: ['#ffffff', '#e2f4ff'],
    column: ['#cfe8fa', '#a8d4f2'],
    haze: ['#ffffff', 0.16],
    grade: null,
    flat: 1,
    rim: null,
    sunX: 206,
    light: 1, // day light comes from the upper right
  },
  sunset: {
    sky: [[0, '#221e5a'], [18, '#2f2468'], [36, '#4a2e7c'], [52, '#6e3a86'], [66, '#9c4a82'], [78, '#cc5e76'], [90, '#ee7c62'], [100, '#fea25a'], [107, '#ffbe68'], [112, '#ffd27e']],
    water: [[112, '#f8b36c'], [115, '#e89464'], [122, '#c8705e'], [134, '#a0565e'], [150, '#7c445e'], [172, '#5c3658'], [200, '#3e284a']],
    waveHi: ['#ffd090', '#e8906a', '#a86070'],
    waveLo: ['#c06a5c', '#6a3a58', '#3c2446'],
    glint: ['#fff2c4', '#ffc878'],
    column: ['#ffb46a', '#e98a5a'],
    haze: ['#ffb070', 0.18],
    grade: { sat: 0.65, mul: [0.5, 0.35, 0.5], add: [20, 8, 36] },
    flat: 0.55,
    rim: '#ffab62',
    rim2: '#e8785a',
    sunX: 186,
    light: 0,
  },
  night: {
    sky: [[0, '#060a20'], [24, '#0a1030'], [52, '#101a42'], [80, '#18244f'], [100, '#21305e'], [112, '#2b3c6a']],
    water: [[112, '#23325f'], [118, '#1c2a55'], [132, '#16224a'], [160, '#111a3e'], [200, '#0a1130']],
    waveHi: ['#34467e', '#26366a', '#1c2958'],
    waveLo: ['#161f4a', '#0e1638', '#080d26'],
    glint: ['#e4eaff', '#a8b6e6'],
    column: ['#33447c', '#2a3a6e'],
    haze: ['#5a6aa8', 0.12],
    grade: { sat: 0.45, mul: [0.2, 0.24, 0.38], add: [9, 13, 33] },
    flat: 0.5,
    rim: '#3b4b84',
    sunX: 150,
    light: 0,
  },
}

let NAME = 'day'
let M = MOMENTS.day
let P = {}
function useMoment(name) {
  NAME = name
  M = MOMENTS[name]
  P = {}
  for (const [k, ramp] of Object.entries(BASE)) P[k] = M.grade ? ramp.map(c => grade(c, M.grade)) : ramp
  // Light that shows at every hour: lit glass and lamps.
  P.lit = ['#d07a2c', '#f2a23c', '#ffcc64', '#ffe9a6', '#fff8dc']
  P.green = ['#2a8a4a', '#4ec070', '#a8f0b8']
  P.red = ['#a0282a', '#e04a3a', '#ff9a7a']
  if (name === 'sunset') {
    P.mtn = ['#4c3a7a', '#5a4286', '#6a4c92', '#7c589c', '#90649e']
    P.mtn2 = ['#3c2e66', '#463470', '#523c7a', '#5e4482']
    P.glass = ['#2a1e3a', '#3a2848', '#6a4058', '#e2905e']
    P.lamp = ['#c87850', '#f0a868', '#ffd090']
    P.hullW = BASE.hullW.map(c => grade(c, { sat: 0.6, mul: [0.42, 0.3, 0.44], add: [22, 10, 38] }))
  }
  if (name === 'night') {
    P.mtn = ['#121a3c', '#161f44', '#1a244c', '#1f2a54', '#243060']
    P.mtn2 = ['#0e1534', '#11193a', '#141d40', '#182246']
    P.glass = ['#0a0e1c', '#101626', '#182034', '#2a3650']
    P.lamp = ['#ffd27a', '#ffe9a6', '#fff8dc']
  }
}
// A material's colour for brightness v at a cell, ordered-dithered by d of a step.
function sh(mat, v, x, y, d = 0.3) {
  const vv = 0.5 + (v - 0.5) * M.flat
  return tone(P[mat], vv, x, y, d)
}

// ---------------------------------------------------------------- drawing helpers

function fill(L, x0, y0, x1, y1, c) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) L.set(x, y, typeof c === 'function' ? c(x, y) : c)
}
function cells(L, list, c) {
  for (const [x, y] of list) L.set(x, y, typeof c === 'function' ? c(x, y) : c)
}
// Piecewise-linear profile through [[x, y], ...].
function profile(pts, x) {
  if (x <= pts[0][0]) return pts[0][1]
  for (let i = 0; i < pts.length - 1; i++) {
    const [xa, ya] = pts[i]
    const [xb, yb] = pts[i + 1]
    if (x <= xb) return lerp(ya, yb, (x - xa) / (xb - xa))
  }
  return pts[pts.length - 1][1]
}
function sprite(L, x0, y0, rows, map) {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i]
      if (ch !== '.' && map[ch]) L.set(x0 + i, y0 + j, typeof map[ch] === 'function' ? map[ch](x0 + i, y0 + j) : map[ch])
    }
  })
}

// Edge light: at sunset the low sun behind the harbour lights the top of every silhouette and
// the side that faces it; at night the moon lights the tops a little.
function rimLight(L, o = {}) {
  if (!M.rim) return L
  const side = NAME === 'sunset'
  const set = []
  // A lit edge needs body behind it: a line one cell thin stays as it is.
  for (const [k] of L.m) {
    const [x, y] = cellOf(k)
    const up = !L.has(x, y - 1) && L.has(x, y + 1)
    let s = false
    if (side && !o.topOnly) {
      if (x < M.sunX - 2) s = !L.has(x + 1, y) && L.has(x - 1, y)
      else if (x > M.sunX + 2) s = !L.has(x - 1, y) && L.has(x + 1, y)
    }
    if (up || s) set.push(k)
  }
  const c = o.soft && M.rim2 ? M.rim2 : M.rim
  for (const k of set) L.m.set(k, c)
  return L
}

// ---------------------------------------------------------------- the layer list

// A layer either stays still (and merges with the still layers next to it) or carries its own
// group attributes: a class with its motion, a style with its timing, an opacity.
function moving(L, cls, style = '', extra = '') {
  L.attrs = (cls ? ' class="' + cls + '"' : '') + (style ? ' style="' + style + '"' : '') + extra
  return L
}
const group = (attrs, layers) => ({ wrap: '<g' + attrs + '>', end: '</g>', layers })
const raw = html => ({ raw: html })

// ---------------------------------------------------------------- sky

// Bands two cells tall, each drawn a cell taller under the next so no seam shows between them.
function bands(stops, y0, y1) {
  let out = '<g stroke-width="3">'
  let last = null
  let d = ''
  const flush = () => {
    if (last) out += '<path stroke="' + short(last) + '" d="' + d + '"/>'
  }
  for (let y = y0; y < y1; y += 2) {
    const c = grad(stops, y + 0.5)
    if (c !== last) {
      flush()
      last = c
      d = ''
    }
    d += 'M0 ' + (y + 1) + 'h320'
  }
  flush()
  return out + '</g>'
}

// A soft disc of light: solid inside, its edge dithered over `soft` cells.
function glowDisc(L, cx, cy, R, c, soft = 2, clip = null) {
  const e = Math.ceil(R + soft)
  for (let y = Math.floor(cy - e); y <= cy + e; y++) {
    for (let x = Math.floor(cx - e); x <= cx + e; x++) {
      if (clip && !clip(x, y)) continue
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      if (d < R + bayer(x, y) * soft * 2) L.set(x, y, c)
    }
  }
  return L
}

// The sun by day, high over the gap between the town and the headland.
function daySun(out) {
  const [cx, cy] = [206, 36]
  for (const [R, op] of [[30, 0.07], [19, 0.1], [12, 0.16]]) out.push(moving(glowDisc(new Layer('halo' + R), cx, cy, R, '#ffffff', 2.5), '', '', ' opacity="' + op + '"'))
  const L = new Layer('sun')
  for (let y = -10; y < 10; y++) {
    for (let x = -10; x < 10; x++) {
      const d = Math.hypot(x + 0.5, y + 0.5)
      if (d < 5.5) L.set(cx + x, cy + y, '#fffef6')
      else if (d < 7) L.set(cx + x, cy + y, '#fff6d2')
      else if (d < 8 + bayer(x, y) * 1.2) L.set(cx + x, cy + y, '#ffeaa8')
    }
  }
  out.push(L)
  // Faint shafts falling from it toward the sea.
  const rays = new Layer('rays')
  for (const [a, w, len] of [[1.95, 0.05, 92], [1.62, 0.035, 80], [2.3, 0.04, 70], [1.3, 0.03, 60]]) {
    for (let y = cy; y < HY; y++) {
      for (let x = 100; x < 320; x++) {
        const dx = x + 0.5 - cx
        const dy = y + 0.5 - cy
        const r = Math.hypot(dx, dy)
        if (r < 14 || r > len) continue
        const ang = Math.atan2(dy, dx)
        if (Math.abs(ang - a) < w * (1 + r / 60)) rays.set(x, y, '#ffffff')
      }
    }
  }
  out.push(group(' opacity=".05"', [moving(rays, 'ry', '--d:16s;--l:-4s')]))
}

// The sun at sunset, half down behind the sea in the gap, with its bloom and its rays.
function setSun(out) {
  const [cx, cy] = [186, 108]
  const sky = (x, y) => y < HY
  for (const [R, op, c] of [[78, 0.08, '#ffb070'], [48, 0.1, '#ffc078'], [28, 0.14, '#ffd890'], [16, 0.2, '#ffe8b0']])
    out.push(moving(glowDisc(new Layer('bloom' + R), cx, cy, R, c, 3, sky), '', '', ' opacity="' + op + '"'))
  // Rays fanning up from behind the horizon.
  const near = new Layer('raysN')
  const far = new Layer('raysF')
  const RAYS = [[-2.62, 0.05], [-2.28, 0.035], [-1.98, 0.05], [-1.7, 0.03], [-1.42, 0.045], [-1.12, 0.035], [-0.82, 0.05], [-0.5, 0.03]]
  for (let y = 0; y < HY - 2; y++) {
    for (let x = 0; x < 320; x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const r = Math.hypot(dx, dy)
      if (r < 18) continue
      const ang = Math.atan2(dy, dx)
      for (const [a, w] of RAYS) {
        if (Math.abs(ang - a) < w) {
          ;(r < 70 ? near : far).set(x, y, '#ffe0a8')
          break
        }
      }
    }
  }
  out.push(group(' opacity=".06"', [moving(far, 'ry', '--d:20s;--l:-9s')]), group(' opacity=".11"', [moving(near, 'ry', '--d:20s;--l:-9s')]))
  const L = new Layer('sun')
  for (let y = -12; y < 12; y++) {
    for (let x = -12; x < 12; x++) {
      if (cy + y >= HY) continue
      const d = Math.hypot(x + 0.5, y + 0.5)
      if (d < 7) L.set(cx + x, cy + y, '#fff6d6')
      else if (d < 9) L.set(cx + x, cy + y, '#ffe0a0')
      else if (d < 10 + bayer(x, y) * 1.2) L.set(cx + x, cy + y, '#ffbe6a')
    }
  }
  out.push(L)
}

// Stars and the moon at night.
function nightSky(out) {
  const r = rng(211)
  const still = new Layer('stars')
  for (let i = 0; i < 110; i++) {
    const x = Math.floor(r() * W)
    const y = Math.floor(Math.pow(r(), 1.25) * 100)
    const bright = i < 10
    if (bright) {
      const L = new Layer('star' + i)
      L.set(x, y, '#ffffff')
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) L.set(x + dx, y + dy, '#8a98cc')
      const d = 5 * (1 + Math.floor(r() * 4))
      out.push(moving(L, 'tk', '--d:' + d + 's;--l:' + f2(-Math.round(r() * d * 20) / 20) + 's'))
    } else still.set(x, y, r() < 0.4 ? '#c8d2f4' : r() < 0.6 ? '#8a96c8' : '#5e6aa4')
  }
  out.splice(out.length - 10, 0, still)
  const [cx, cy] = [150, 40]
  for (const [R, op] of [[26, 0.05], [15, 0.08], [9, 0.12]]) out.push(moving(glowDisc(new Layer('mhalo' + R), cx, cy, R, '#b4c4ff', 2), '', '', ' opacity="' + op + '"'))
  const moon = new Layer('moon')
  const MOON = ['#a8a690', '#cfccb0', '#e8e4ca', '#fbf8e8']
  const craters = new Set(['-2,-1', '-1,-1', '1,2', '2,1', '-2,3', '2,-3', '3,-2'])
  for (let y = -7; y < 7; y++) {
    for (let x = -7; x < 7; x++) {
      const dx = x + 0.5
      const dy = y + 0.5
      const d = Math.hypot(dx, dy)
      if (d >= 5.6) continue
      const nz = Math.sqrt(5.6 * 5.6 - d * d) / 5.6
      let v = 0.55 + 0.45 * ((dx / 5.6) * 0.4 + (-dy / 5.6) * 0.5 + nz * 0.5)
      if (craters.has(x + ',' + y)) v -= 0.28
      moon.set(cx + x, cy + y, tone(MOON, v, x, y, 0.5))
    }
  }
  out.push(moon)
}

// ---------------------------------------------------------------- clouds

// A long streak of cloud: puffs a little apart along a row, flattened by sy.
function streak(x0, x1, y, rmin, rmax, sy, seed) {
  const r = rng(seed * 97)
  const out = []
  for (let x = x0; x <= x1; ) {
    const t = (x - x0) / (x1 - x0)
    const rr = Math.round(lerp(rmin, rmax, Math.sin(t * Math.PI) * 0.7 + r() * 0.3))
    out.push([x, y + Math.round((r() - 0.5) * 3 - Math.sin(t * Math.PI) * 1.5), rr, sy])
    x += Math.max(2, Math.round(rr * (0.7 + r() * 0.4)))
  }
  return out
}

// A long flat band of cloud, the kind a low sun lights from below: tapered ends, a wavy
// underside, a few holes. lit: 1 lights the underside (sunset), -1 the top (moonlight).
function band(L, x0, x1, yc, thick, seed, lit, tones) {
  const n = noise2(seed * 13)
  for (let x = x0; x <= x1; x++) {
    const t = (x - x0) / (x1 - x0)
    const th = thick * Math.pow(Math.sin(t * Math.PI), 0.55) * (0.55 + 0.6 * n(x / 9, 1))
    if (th < 1) continue
    const c = yc + 1.6 * Math.sin(x * 0.045 + seed) + (n(x / 14, 5) - 0.5) * 3
    const top = Math.round(c - th * 0.45)
    const bot = Math.round(c + th * 0.55 + (n(x / 3, 9) - 0.5) * 1.6)
    // The light falls off away from the sun.
    const near = NAME === 'sunset' ? 1 - 0.45 * clamp(Math.abs(x - M.sunX) / 190, 0, 1) : 1
    for (let y = top; y <= bot; y++) {
      if (n(x / 5, y / 2 + 20) > 0.74 && y !== bot) continue
      const u = bot === top ? 1 : (y - top) / (bot - top)
      let v = lit > 0 ? 0.18 + 0.55 * Math.pow(u, 1.6) * near : 0.62 - 0.45 * u
      if (lit > 0 && y === bot) v = 0.55 + 0.42 * near
      if (lit < 0 && y === top) v = 0.85
      L.set(x, y, tone(tones, v, x, y, 0.3))
    }
  }
}

// Cumulus by day, long streaks lit from below at sunset, dim banks at night. Each drifts a few
// cells to and fro.
function clouds(out) {
  const r = rng(37)
  const tones = CLOUDS[NAME]
  const sets = {
    day: [
      { puffs: [[4, 66, 9], [20, 58, 12], [38, 61, 10], [55, 66, 8], [70, 70, 6]], base: 74, a: 3, d: 48 },
      { puffs: [[108, 32, 5], [115, 28, 6], [123, 31, 5], [130, 33, 3]], base: 35, a: 5, d: 56, far: true },
      { puffs: [[258, 22, 4], [264, 19, 5], [271, 22, 4]], base: 24, a: 4, d: 64, far: true },
      { puffs: [[56, 40, 3], [61, 38, 4], [66, 40, 3]], base: 42, a: 4, d: 40, far: true },
      { puffs: [[160, 104, 3, 2.4], [170, 103, 4, 2.4], [181, 104, 3, 2.4], [228, 103, 3, 2.6], [236, 102, 4, 2.6]], base: 106, a: 2, d: 72, far: true },
      { puffs: streak(244, 322, 30, 2, 3, 3.2, 11), base: 32, a: 6, d: 80, far: true, thin: true },
      { puffs: streak(-4, 46, 98, 2, 3, 3, 12), base: 100, a: 3, d: 64, far: true, thin: true },
    ],
    sunset: [
      { band: [-6, 128, 60, 8, 1], a: 3, d: 52 },
      { band: [186, 330, 43, 9, 2], a: 4, d: 60 },
      { band: [236, 330, 67, 4, 3], a: 3, d: 48 },
      { band: [116, 172, 84, 4, 4], a: 3, d: 44 },
      { band: [198, 250, 97, 3, 5], a: 2, d: 36 },
      { band: [40, 160, 27, 4, 6], a: 5, d: 68 },
      { band: [0, 60, 95, 3, 14], a: 2, d: 40 },
    ],
    night: [
      { band: [2, 118, 58, 5, 7], a: 3, d: 60 },
      { band: [192, 290, 27, 5, 8], a: 4, d: 72 },
      { band: [134, 186, 98, 3, 9], a: 2, d: 52 },
      { band: [220, 254, 100, 2, 10], a: 2, d: 44 },
    ],
  }[NAME]
  sets.forEach((s, i) => {
    const L = new Layer('cloud' + i)
    if (s.band) {
      const [x0, x1, yc, th, seed] = s.band
      band(L, x0, x1, yc, th, seed, NAME === 'sunset' ? 1 : -1, tones)
      out.push(moving(L, 'cd', '--a:' + s.a + 'px;--d:' + s.d + 's;--l:' + -Math.round(r() * s.d) + 's'))
      return
    }
    const ps = s.puffs.map(([x, y, rr, sy]) => ({ x, y, r: rr, sy: sy ?? 1.25 }))
    if (NAME === 'day') {
      paintCloud(L, billow(ps, r, { count: s.far ? 2 : undefined }), {
        base: s.base,
        shadeH: s.far ? 3 : 10,
        baseShade: s.far ? 0.25 : 0.42,
        bright: s.far ? 0.72 : 0.66,
        tones: s.thin ? ['#6aa4e6', '#86b6ec', '#a4c8f2'] : s.far ? ['#a8d0f4', '#c0ddf8', '#d8eafc', '#eef6fe'] : tones,
      })
    } else if (NAME === 'sunset') {
      // Lit from below and from the side of the sun.
      const cx = ps.reduce((n, p) => n + p.x, 0) / ps.length
      const lx = cx < M.sunX ? 0.55 : -0.55
      paintCloud(L, billow(ps, r, { count: 2 }), { light: [lx, 0.8, 0.35], bright: 0.42, baseShade: -0.25, shadeH: 3, topLift: -0.15, tones, dither: 0.4 })
    } else {
      paintCloud(L, billow(ps, r, { count: 2 }), { light: [0.2, -0.9, 0.4], bright: 0.42, baseShade: 0.2, shadeH: 3, tones, dither: 0.35 })
    }
    out.push(moving(L, 'cd', '--a:' + s.a + 'px;--d:' + s.d + 's;--l:' + -Math.round(r() * s.d) + 's'))
  })
}

// ---------------------------------------------------------------- far shore

// A far range of mountains behind the town, hazy blue by day.
function mountains(out) {
  const L = new Layer('mtn')
  const pk = [[0, 71], [16, 65], [34, 72], [52, 63], [70, 70], [88, 67], [106, 77], [124, 85], [142, 95], [158, 104], [172, 110], [180, 113]]
  const top = x => profile(pk, x) + 1.1 * Math.sin(x * 0.31) + 0.6 * Math.sin(x * 0.77 + 2)
  for (let x = 0; x < 182; x++) {
    const t = Math.round(top(x))
    for (let y = t; y < HY + 4; y++) {
      const depth = y - t
      // Facets: the slopes that fall to the right catch the light, gullies run down them.
      const s = top(x + 3 - depth * 0.15) - top(x - 3 - depth * 0.15)
      let v = s > 0.5 ? 0.62 : s < -0.5 ? 0.3 : 0.45
      if (!M.light) v = 0.42 + (s > 0.5 ? 0.06 : 0)
      if (N2(x / 2.5 + depth * 0.2, depth / 6) > 0.72) v -= 0.14
      v += 0.32 * smooth(depth / 36) // haze toward the foot
      if (depth < 1) v += 0.1
      L.set(x, y, sh('mtn', v, x, y, 0.25))
    }
  }
  // A lower, nearer ridge on the far right, behind the headland.
  const pk2 = [[212, 104], [222, 100], [236, 96], [252, 92], [272, 88], [296, 86], [320, 88]]
  for (let x = 210; x < 320; x++) {
    const t = Math.round(profile(pk2, x) + 1.2 * Math.sin(x * 0.5))
    for (let y = t; y < HY + 4; y++) L.set(x, y, sh('mtn2', 0.45 + 0.3 * smooth((y - t) / 20), x, y, 0.25))
  }
  out.push(L)
  // Haze lying on the water at the foot of the far shore: a few rows, each a little denser.
  for (const [y0, y1, op] of [[HY - 7, HY + 2, 0.5], [HY - 4, HY + 2, 0.6], [HY - 2, HY + 1, 0.7]]) {
    const hz = new Layer('haze' + y0)
    fill(hz, 0, y0, W, y1, M.haze[0])
    out.push(moving(hz, '', '', ' opacity="' + f2(M.haze[1] * op) + '"'))
  }
}

// The town on the left: houses climbing a green hill above a stone quay, a church tower.
const QUAY = 118 // top of the quay wall
const TOWN_WL = 122 // first water row in front of the quay
const lights = [] // lit points that throw a streak on the water at night: [x, y, colour, length]

function town(out) {
  const r = rng(301)
  const L = new Layer('town')
  // The hill.
  const hillTop = x => 82 + 28 * Math.pow(clamp(x / 174, 0, 1), 1.3) + 2.2 * Math.sin(x * 0.11) + 1.4 * Math.sin(x * 0.29 + 1)
  for (let x = 0; x < 178; x++) {
    const t = Math.round(hillTop(x))
    for (let y = t; y < TOWN_WL; y++) {
      const bush = N3(x / 2.6, y / 2.2)
      let v = 0.32 + 0.5 * (bush - 0.5) * 1.6 + (M.light ? 0.1 : 0)
      if (y - t < 1) v += 0.25
      if (bush > 0.62 && N3(x / 2.6, (y - 1) / 2.2) <= 0.62) v += 0.2 // lit top of a shrub
      v -= 0.15 * smooth((y - t) / 30)
      L.set(x, y, sh('hill', v, x, y, 0.35))
    }
  }
  // Round trees on the crest and cypresses between the houses.
  const crown = (cx, cy, rr) => {
    for (let y = -rr; y <= rr; y++)
      for (let x = -rr - 1; x <= rr + 1; x++) {
        const d = Math.hypot((x + 0.5) / 1.15, y + 0.5)
        if (d < rr + (N1(cx + x, cy + y) - 0.5) * 1.4) L.set(cx + x, cy + y, sh('tree', 0.5 + (x * 0.12 - y * 0.18) * (M.light ? 1 : 0.4) + (N2(x, y) - 0.5) * 0.5, cx + x, cy + y, 0.4))
      }
  }
  for (const [cx, cy, rr] of [[6, 83, 4], [16, 82, 3], [28, 84, 4], [92, 98, 3], [120, 104, 3], [142, 108, 3], [160, 111, 2]]) crown(cx, cy, rr)
  const cypress = (cx, base, h) => {
    for (let y = 0; y < h; y++) {
      const t = y / h
      const hw = t < 0.15 ? 0 : t < 0.5 ? 1 : 1.5
      for (let x = Math.floor(cx - hw); x <= Math.floor(cx + hw); x++) L.set(x, base - h + y, sh('tree', 0.35 + (x - cx) * 0.18 * (M.light ? 1 : 0.4) + (N2(x, y) - 0.5) * 0.3, x, base - h + y, 0.4))
    }
  }
  // Houses, back rows first.
  const WALLS = ['wW', 'wY', 'wP', 'wB', 'wW', 'wT', 'wG', 'wO', 'wW', 'wY']
  const ROWS = [
    { base: x => 90 + x * 0.06, x0: -2, x1: 62, h: [6, 8] },
    { base: x => 99 + x * 0.05, x0: -3, x1: 96, h: [7, 9] },
    { base: x => 108 + x * 0.03, x0: -1, x1: 128, h: [8, 10] },
    { base: () => QUAY, x0: -2, x1: 152, h: [9, 13] },
  ]
  const windows = []
  ROWS.forEach((row, ri) => {
    let x = row.x0 + Math.floor(r() * 3)
    while (x < row.x1) {
      const w = 7 + Math.floor(r() * 6)
      const base = Math.round(row.base(x + w / 2))
      const h = row.h[0] + Math.floor(r() * (row.h[1] - row.h[0] + 1))
      // The church sits in the second row.
      if (ri === 1 && x > 44 && x < 60) {
        church(L, 52, base)
        x = 74
        continue
      }
      if (ri === 2 && (x > 84 && x < 92)) cypress(x + 1, base - 2, 11)
      house(L, r, x, w, base, h, WALLS[Math.floor(r() * WALLS.length)], ri, windows)
      x += w + (r() < 0.25 ? 1 : 0)
    }
  })
  cypress(40, 92, 12)
  cypress(112, 103, 10)
  // The quay wall with its lamps.
  for (let x = -1; x < 160; x++) {
    for (let y = QUAY; y < TOWN_WL; y++) {
      const k = y - QUAY
      let v = k === 0 ? 0.85 : 0.45 - k * 0.06
      const jx = (x + (k % 2) * 3) % 6
      if (k > 0 && (jx === 0 || k === 2)) v -= 0.2
      if (k === 3) v -= 0.1
      L.set(x, y, sh('quay', v + (N1(x, y * 3) - 0.5) * 0.2, x, y, 0.2))
    }
  }
  // Where the hill comes down to the water past the quay: rocks.
  for (let x = 156; x < 180; x++) {
    const t = Math.round(hillTop(x))
    for (let y = Math.max(t, QUAY - 2); y < TOWN_WL; y++) L.set(x, y, sh('rock', 0.35 + (N2(x / 2, y / 2) - 0.5) * 0.8 + (y < QUAY ? 0.15 : 0), x, y, 0.4))
  }
  for (const qx of [11, 37, 60, 91, 114, 147]) {
    L.set(qx, QUAY - 1, sh('iron', 0.3, qx, QUAY - 1))
    L.set(qx, QUAY - 2, sh('iron', 0.3, qx, QUAY - 2))
    L.set(qx, QUAY - 3, sh('iron', 0.4, qx, QUAY - 3))
    const lit = NAME !== 'day'
    L.set(qx, QUAY - 4, lit ? P.lit[NAME === 'night' ? 4 : 3] : sh('lamp', 0.5, qx, QUAY - 4))
    if (NAME === 'night') lights.push([qx, QUAY - 4, 'lit', 24, 1])
  }
  rimLight(L)
  // Windows go on after the rim: they are holes in the walls, not edges.
  for (const [wx, wy, lit] of windows) {
    const on = (NAME === 'night' && lit < 0.6) || (NAME === 'sunset' && lit < 0.2)
    if (on) {
      L.set(wx, wy, P.lit[NAME === 'night' ? 3 : 2])
      L.set(wx, wy + 1, P.lit[NAME === 'night' ? 2 : 1])
      if (wy >= QUAY - 12 && NAME === 'night' && lit < 0.25) lights.push([wx, wy + 1, 'lit', 8, 0])
    } else {
      L.set(wx, wy, sh('glass', 0.25, wx, wy, 0))
      L.set(wx, wy + 1, sh('glass', NAME === 'day' ? 0.85 : 0.45, wx, wy + 1, 0))
    }
  }
  out.push(L)
  // Small boats tied up along the quay.
  const B = new Layer('quayboats')
  for (const [bx, len, mat] of [[8, 8, 'hullB'], [52, 7, 'hullR'], [78, 6, 'hullY'], [124, 8, 'hullW'], [138, 6, 'hullG']]) {
    for (let i = 0; i < len; i++) {
      const end = i === 0 || i === len - 1
      B.set(bx + i, TOWN_WL - 1, sh('hullW', 0.8, bx + i, TOWN_WL - 1))
      if (!end) B.set(bx + i, TOWN_WL, sh(mat, 0.45, bx + i, TOWN_WL))
      if (i > 1 && i < len - 2) B.set(bx + i, TOWN_WL + 1, sh(mat, 0.3, bx + i, TOWN_WL + 1))
    }
  }
  rimLight(B, { topOnly: true })
  out.push(B)
  return [L, B]
}

function house(L, r, x, w, base, h, wall, row, windows) {
  const top = base - h
  for (let y = top; y < base; y++) {
    for (let i = 0; i < w; i++) {
      let v = 0.62 + (N1((x + i) / 2, y / 2) - 0.5) * 0.12
      if (i === 0) v = 0.36 // shadow where it meets the house to its left
      if (i === w - 1 && M.light) v = 0.78
      if (y === top) v = 0.3 // under the eaves
      L.set(x + i, y, sh(wall, v, x + i, y, 0.15))
    }
  }
  // Roof.
  const kind = r() < 0.5 ? 'side' : r() < 0.6 ? 'gable' : 'flat'
  const mat = r() < 0.82 ? 'roof' : 'slate'
  if (kind === 'side') {
    for (let k = 1; k <= 3; k++) {
      const y = top - k
      for (let i = -1 + (k === 3 ? 1 : 0); i <= w - (k === 3 ? 1 : 0); i++) {
        let v = 0.42 + k * 0.12
        if ((x + i + k * 2) % 3 === 0 && k < 3) v -= 0.18
        L.set(x + i, y, sh(mat, v, x + i, y, 0.2))
      }
    }
  } else if (kind === 'gable') {
    const half = Math.ceil(w / 2)
    for (let k = 1; k <= half; k++) {
      const y = top - Math.ceil(k * 0.6)
      for (let i = k - 1; i <= w - k; i++) {
        const edge = i === k - 1 || i === w - k
        L.set(x + i, y, edge ? sh(mat, i === k - 1 ? 0.55 : 0.8, x + i, y, 0) : sh(wall, 0.55, x + i, y, 0.15))
      }
    }
  } else {
    for (let i = 0; i < w; i++) L.set(x + i, top - 1, sh(wall, 0.85, x + i, top - 1, 0))
    if (r() < 0.6) fill(L, x + 1, top - 3, x + 4, top - 1, (xx, yy) => sh(wall, 0.5, xx, yy, 0.2))
  }
  // Windows: floors every four rows, one cell wide and two tall, some with shutters.
  const shutters = (wall === 'wW' || wall === 'wY' || wall === 'wP' || wall === 'wO') && r() < 0.7
  const unit = shutters ? 4 : 3
  const n = Math.max(1, Math.floor((w - 1) / unit))
  const x0 = x + Math.floor((w - (n * unit - 1)) / 2) + (shutters ? 1 : 0)
  for (let fy = top + 2; fy + 2 <= base - (row === 3 ? 4 : 1); fy += 4) {
    for (let j = 0; j < n; j++) {
      const wx = x0 + j * unit
      if (wx >= x + w - 1) continue
      windows.push([wx, fy, r()])
      if (shutters) {
        L.set(wx - 1, fy, sh('shut', 0.5, wx - 1, fy, 0))
        L.set(wx - 1, fy + 1, sh('shut', 0.35, wx - 1, fy + 1, 0))
        L.set(wx + 1, fy, sh('shut', 0.5, wx + 1, fy, 0))
        L.set(wx + 1, fy + 1, sh('shut', 0.35, wx + 1, fy + 1, 0))
      }
    }
  }
  // A door, and now and then an awning, on the quay.
  if (row === 3) {
    const dx = x + 1 + Math.floor(r() * Math.max(1, w - 3))
    fill(L, dx, base - 3, dx + 2, base, (xx, yy) => sh('door', 0.45, xx, yy, 0.2))
    if (r() < 0.35) {
      const c = r() < 0.5 ? 'hullR' : 'hullB'
      for (let i = 0; i < w; i++) L.set(x + i, base - 5, sh(i % 2 ? 'wW' : c, 0.75, x + i, base - 5, 0))
      for (let i = 0; i < w; i++) L.set(x + i, base - 4, sh(i % 2 ? 'wW' : c, 0.45, x + i, base - 4, 0))
    }
  }
}

function church(L, x, base) {
  // Nave with a gable roof, behind the tower.
  const nx = x + 6
  const nw = 16
  const nTop = base - 9
  for (let y = nTop; y < base; y++) for (let i = 0; i < nw; i++) L.set(nx + i, y, sh('wY', i === 0 ? 0.35 : y === nTop ? 0.3 : 0.6, nx + i, y, 0.15))
  for (let k = 1; k <= 4; k++) for (let i = -1; i <= nw; i++) L.set(nx + i, nTop - k, sh('roof', 0.45 + k * 0.1 - ((nx + i + k) % 3 === 0 ? 0.15 : 0), nx + i, nTop - k, 0.2))
  for (const wx of [nx + 4, nx + 8, nx + 12]) {
    fill(L, wx, nTop + 2, wx + 1, nTop + 6, '#1b2234')
    L.set(wx, nTop + 2, sh('glass', 0.3, wx, nTop + 2, 0))
  }
  // The bell tower.
  const tTop = base - 32
  for (let y = tTop; y < base; y++) {
    for (let i = 0; i < 7; i++) {
      let v = 0.62
      if (i === 0) v = 0.4
      if (i === 6 && M.light) v = 0.8
      if (y === tTop + 9 || y === tTop) v = 0.85 // cornices
      L.set(x + i, y, sh('wW', v, x + i, y, 0.15))
    }
  }
  // Belfry openings and a clock.
  for (const bx of [x + 1, x + 4]) fill(L, bx, tTop + 3, bx + 2, tTop + 7, (xx, yy) => sh('door', yy === tTop + 3 ? 0.2 : 0.1, xx, yy, 0))
  L.set(x + 3, tTop + 13, sh('iron', 0.2, x + 3, tTop + 13))
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) L.set(x + 3 + dx, tTop + 13 + dy, sh('hullW', 0.9, x + 3 + dx, tTop + 13 + dy, 0))
  // Pyramid roof and a cross.
  for (let k = 1; k <= 5; k++) {
    const half = Math.max(0, 4 - Math.ceil(k * 0.8))
    for (let i = 3 - half; i <= 3 + half; i++) L.set(x + i, tTop - k, sh('roof', i <= 3 ? 0.45 : 0.7, x + i, tTop - k, 0))
  }
  for (let k = 6; k <= 9; k++) L.set(x + 3, tTop - k, sh('iron', 0.4, x + 3, tTop - k))
  L.set(x + 2, tTop - 8, sh('iron', 0.4, x + 2, tTop - 8))
  L.set(x + 4, tTop - 8, sh('iron', 0.4, x + 4, tTop - 8))
}

// The headland on the right: cliffs, a grassy top, the lighthouse and its cottage; the
// breakwater running out from its foot with a small beacon at the end.
const HEAD_WL = 120
const LH = { x: 292, top: 53, base: 80, lampY: 46 }

function headland(out) {
  const L = new Layer('head')
  const prof = [[226, 121], [229, 117], [232, 112], [235, 106], [239, 100], [244, 94], [250, 89], [257, 85], [265, 82], [276, 80.5], [300, 80], [320, 79]]
  const top = x => profile(prof, x) + 0.9 * Math.sin(x * 0.6) + (N1(x / 2, 7) - 0.5) * 1.6
  for (let x = 226; x < 322; x++) {
    const t = Math.round(top(x))
    const slope = top(x + 1) - top(x - 1)
    for (let y = t; y < HEAD_WL; y++) {
      const depth = y - t
      const grassDepth = 2 + Math.round(N2(x / 2, 3) * 2) - (slope > 1.2 ? 2 : 0)
      if (depth < grassDepth) {
        let v = 0.55 + (depth === 0 ? 0.25 : 0) + (N1(x, y) - 0.5) * 0.4
        L.set(x, y, sh('grass', v, x, y, 0.4))
        continue
      }
      // Rock: strata, cracks, a lit face and a shaded one, wet and dark near the water.
      const strata = Math.sin(y * 0.7 + Math.sin(x * 0.17) * 2.2)
      const crack = N3(x / 1.2, y / 10) > 0.76
      if (depth > 3 && y < 108 && N3(x / 3.5, y / 2.5) > 0.72) {
        if (M.light) L.set(x, y, sh('grass', 0.3 + (N3(x / 3.5, (y - 1) / 2.5) > 0.72 ? 0 : 0.35), x, y, 0.3))
        else L.set(x, y, sh('rock', 0.36, x, y, 0.2))
        continue
      }
      let v = 0.52 + (N2(x / 6, y / 4) - 0.5) * 0.45
      if (strata > 0.82) v -= 0.22
      else if (strata < -0.7) v += 0.1
      if (crack) v -= 0.25
      if (M.light) v += clamp(-slope, -2, 2) * -0.08 // the left face turns away from the light
      else v += x < 250 ? 0.05 : 0
      v -= 0.3 * smooth((y - (HEAD_WL - 8)) / 8)
      L.set(x, y, sh('rock', v, x, y, 0.22))
    }
  }
  // Boulders at the foot of the cliff.
  for (const [bx, by, br] of [[229, 119, 2.5], [234, 120, 3], [241, 119, 2.2], [262, 120, 3.2], [278, 119, 2.6], [300, 120, 3], [316, 119, 2.4]]) {
    for (let y = -4; y <= 0; y++)
      for (let x = -4; x <= 4; x++) {
        const d = Math.hypot(x / br, (y + 0.5) / (br * 0.8))
        if (d < 1) L.set(bx + x, by + y, sh('rock', 0.55 - y * -0.12 - x * 0.06 - d * 0.3, bx + x, by + y, 0.3))
      }
  }
  // The breakwater.
  for (let x = 203; x < 236; x++) {
    for (let y = 115; y < HEAD_WL + 1; y++) {
      const k = y - 115
      let v = k === 0 ? 0.85 : k === 1 ? 0.7 : 0.42 - (k - 2) * 0.05
      if (k >= 2 && ((x + (k % 2) * 2) % 5 === 0 || k === 4)) v -= 0.18
      L.set(x, y, sh('quay', v, x, y, 0.2))
    }
  }
  // The beacon at its end: a short green and white tower.
  for (let y = 104; y < 115; y++) {
    for (let x = 204; x < 208; x++) {
      const band = Math.floor((y - 104) / 3) % 2 === 0 ? 'beacon' : 'hullW'
      L.set(x, y, sh(band, x === 204 ? 0.35 : x === 207 && M.light ? 0.8 : 0.6, x, y, 0))
    }
  }
  L.set(205, 102, sh('iron', 0.3, 205, 102))
  L.set(206, 102, sh('iron', 0.3, 206, 102))
  L.set(205, 101, sh('iron', 0.5, 205, 101))
  L.set(206, 101, sh('iron', 0.5, 206, 101))
  // The keeper's cottage.
  const cx = 268
  const cb = 81
  for (let y = cb - 6; y < cb; y++) for (let i = 0; i < 13; i++) L.set(cx + i, y, sh('wW', i === 0 ? 0.4 : y === cb - 6 ? 0.35 : i > 10 && M.light ? 0.8 : 0.62, cx + i, y, 0.15))
  for (let k = 1; k <= 4; k++) for (let i = k - 2; i <= 14 - k; i++) L.set(cx + i, cb - 6 - k, sh('roof', 0.4 + k * 0.1 + (i > 6 ? 0.15 : 0), cx + i, cb - 6 - k, 0.2))
  fill(L, cx + 9, cb - 13, cx + 11, cb - 9, (x, y) => sh('quay', 0.5, x, y, 0.2)) // chimney
  fill(L, cx + 5, cb - 3, cx + 7, cb, (x, y) => sh('door', 0.4, x, y))
  // The lighthouse.
  const T = new Layer('lighthouse')
  for (let y = LH.top; y < LH.base + 1; y++) {
    const t = (y - LH.top) / (LH.base - LH.top)
    const hw = 3 + Math.round(t * 1.4)
    const band = Math.floor((y - LH.top) / 7) % 2 === 0 ? 'lhR' : 'lhW'
    for (let x = LH.x - hw; x <= LH.x + hw; x++) {
      const u = (x + 0.5 - (LH.x + 0.5)) / (hw + 0.5)
      let v = M.light ? 0.5 + 0.38 * u + 0.25 * Math.sqrt(Math.max(0, 1 - u * u)) - 0.1 : 0.45 + 0.2 * Math.sqrt(Math.max(0, 1 - u * u))
      T.set(x, y, sh(band, v, x, y, 0.25))
    }
  }
  // Door and a little window.
  fill(T, LH.x - 1, LH.base - 3, LH.x + 1, LH.base + 1, (x, y) => sh('door', 0.35, x, y))
  T.set(LH.x, LH.top + 10, sh('glass', 0.3, LH.x, LH.top + 10, 0))
  T.set(LH.x, LH.top + 11, sh('glass', 0.6, LH.x, LH.top + 11, 0))
  // Gallery, lantern, dome.
  for (let x = LH.x - 5; x <= LH.x + 5; x++) {
    T.set(x, LH.top - 1, sh('iron', 0.35 + (x - LH.x) * 0.03, x, LH.top - 1, 0))
    T.set(x, LH.top - 2, sh('iron', 0.55, x, LH.top - 2, 0))
    if ((x - LH.x) % 2 === 0) T.set(x, LH.top - 3, sh('iron', 0.4, x, LH.top - 3, 0))
  }
  for (let x = LH.x - 5; x <= LH.x + 5; x++) T.set(x, LH.top - 4, sh('iron', 0.5, x, LH.top - 4, 0))
  for (let y = LH.top - 9; y < LH.top - 4; y++) {
    for (let x = LH.x - 2; x <= LH.x + 2; x++) {
      const mull = x === LH.x - 2 || x === LH.x + 2
      if (NAME === 'night') T.set(x, y, mull ? sh('iron', 0.5, x, y, 0) : P.lit[x === LH.x ? 4 : 3])
      else if (NAME === 'sunset') T.set(x, y, mull ? sh('iron', 0.4, x, y, 0) : P.lit[x === LH.x ? 3 : 2])
      else T.set(x, y, mull ? sh('iron', 0.4, x, y, 0) : sh('lamp', 0.4 + (x - LH.x) * 0.2 + (y - LH.top + 9) * 0.05, x, y, 0.2))
    }
  }
  for (let k = 0; k < 3; k++) for (let x = LH.x - 3 + k; x <= LH.x + 3 - k; x++) T.set(x, LH.top - 10 - k, sh('lhR', 0.45 + (x - LH.x) * 0.1 + (M.light ? 0 : -0.1), x, LH.top - 10 - k, 0))
  T.set(LH.x, LH.top - 13, sh('iron', 0.5, LH.x, LH.top - 13))
  T.set(LH.x, LH.top - 14, sh('iron', 0.7, LH.x, LH.top - 14))
  rimLight(L)
  rimLight(T)
  out.push(L, T)
  if (NAME !== 'day') lights.push([206, 101, 'green', NAME === 'night' ? 22 : 10, 1])
  return [L, T]
}

// A tiny sail on the horizon that crosses the gap in whole cells, slowly.
function sail(out) {
  if (NAME === 'night') return
  const L = new Layer('sail')
  const x = 150
  const y = HY - 1
  for (let i = 0; i < 5; i++) L.set(x + i, y, sh('hullW', 0.5, x + i, y, 0))
  for (let k = 1; k <= 5; k++) for (let i = 0; i < Math.ceil((6 - k) * 0.6); i++) L.set(x + 2 + i, y - k, NAME === 'day' ? '#f6f4ee' : '#5a3e66')
  L.set(x + 2, y - 6, sh('iron', 0.4, x + 2, y - 6))
  out.push(moving(L, 'sl'))
}

// ---------------------------------------------------------------- water

// The water: wave lines, denser and finer toward the horizon; some of them come and go, so
// the surface never stands still.
function waterTexture(out, mask, gone = () => false) {
  const r = rng(503)
  const waves = []
  for (let y = HY; y < H; y++) {
    const d = (y - HY) / (H - HY)
    const zone = d < 0.22 ? 0 : d < 0.55 ? 1 : 2
    // Near rows carry fewer, longer lines.
    if (r() < 0.2 + d * 0.45) continue
    let x = Math.floor(r() * 9)
    while (x < W) {
      const len = 1 + Math.floor(r() * (2 + d * 8))
      const hi = r() < 0.5
      const c = hi ? M.waveHi[zone] : M.waveLo[zone]
      // Group 0 stays; groups 1 to 4 fade in and out in turn.
      const g = r() < 0.5 ? 0 : 1 + Math.floor(r() * 4)
      let clear = true
      for (let i = -1; i <= len; i++) if (mask(x + i, y)) clear = false
      const cells = Array.from({ length: len }, (_, i) => [x + i, y, c]).filter(([cx, cy]) => !gone(cx, cy))
      if (clear && cells.length) waves.push({ g, cells })
      x += len + 2 + Math.floor(r() * (6 + d * 30))
    }
  }
  // Opacity at time 0: the still lines, then wv at 0, 25, 50 and 75% of its cycle.
  const [still, ...groups] = twinkleGroups(waves, 5, [1, 0, 0.6, 0.9, 0.6], grad(M.water, 150), 'wv')
  out.push(still)
  groups.forEach((g, i) => {
    g.reps = repsFor('wv')
    out.push(moving(g, 'wv', '--d:8s;--l:' + -i * 2 + 's', ' opacity=".6"'))
  })
  return [still, ...groups]
}

// A boat's reflection rises a cell while the boat dips (rr). A water cell it covers in only one
// of those two states lies exactly under a reflection cell then, and at fractional cell sizes
// its edges show round that cell as a fringe. Such cells go into a group that shows only in
// the state where they are seen (rh: at rest, rs: risen), with the same timing as the boat,
// and that group also lies over their near-coloured neighbours, so it joins them seamlessly.
// Returns the layers to draw after L (inside L's own group, if it has one).
function syncWithBoats(L) {
  const extra = []
  for (const { R, d, l } of boatRefl) {
    for (const [cls, test] of [
      ['rh', (x, y) => R.has(x, y + 1) && !R.has(x, y)],
      ['rs', (x, y) => R.has(x, y) && !R.has(x, y + 1)],
    ]) {
      const S = new Layer(L.name + cls)
      for (const [k, c] of [...L.m]) {
        const [x, y] = cellOf(k)
        if (!test(x, y)) continue
        S.m.set(k, c)
        L.m.delete(k)
      }
      if (!S.size) continue
      for (const k of [...S.m.keys()]) {
        for (const q of [k - 1, k + 1, k - 4096, k + 4096]) {
          const c = L.m.get(q)
          if (c && !S.m.has(q) && near(c, S.m.get(k), 28)) S.m.set(q, c)
        }
      }
      S.reps = L.reps
      extra.push(moving(S, cls, '--d:' + d + 's;--l:' + l + 's'))
    }
  }
  return extra
}

// The bright column under the sun or the moon: a broad sheen broken into ripples, glints on it
// that twinkle, and lines of glints that run across the water.
function sunPath(out, mask, gone = () => false) {
  const r = rng(601)
  const sx = NAME === 'day' ? 206 : NAME === 'sunset' ? 186 : 150
  const width = y => (NAME === 'sunset' ? 3 : 2) + (y - HY) * (NAME === 'sunset' ? 0.42 : NAME === 'day' ? 0.34 : 0.26)
  const sheen = new Layer('sheen')
  for (let y = HY; y < H; y++) {
    const hw = width(y)
    const rowBreak = N1(3, y * 0.7)
    for (let x = Math.floor(sx - hw * 1.3); x <= sx + hw * 1.3; x++) {
      if (mask(x, y) || gone(x, y)) continue
      const u = Math.abs(x + 0.5 - sx) / hw
      const n = N2(x / (2 + (y - HY) * 0.08), y * 0.9)
      if (u < 0.55 && n > 0.32 + rowBreak * 0.2) sheen.set(x, y, M.column[0])
      else if (u < 1 + bayer(x, y) * 0.4 && n > 0.45) sheen.set(x, y, M.column[1])
    }
  }
  out.push(NAME === 'night' ? moving(sheen, '', '', ' opacity=".7"') : sheen)
  // Twinkling glints in four groups.
  const glints = []
  for (let y = HY + 1; y < H; y++) {
    const hw = width(y)
    const n = Math.round(hw * (NAME === 'night' ? 0.18 : 0.3))
    for (let i = 0; i < n; i++) {
      const x = Math.round(sx + (r() + r() - 1) * hw)
      if (mask(x, y)) continue
      const len = 1 + Math.floor(r() * (1 + (y - HY) * 0.05))
      const g = Math.floor(r() * 4)
      const cells = []
      for (let k = 0; k < len; k++) cells.push([x + k, y, M.glint[k === 0 || r() < 0.5 ? 0 : 1]])
      const seen = cells.filter(([cx, cy]) => !gone(cx, cy))
      if (seen.length) glints.push({ g, cells: seen })
    }
  }
  const tw = twinkleGroups(glints, 4, [0.15, 1, 1, 0.15], M.column[0], 'gl')
  tw.forEach((g, i) => {
    g.reps = repsFor('gl')
    out.push(moving(g, 'gt', '--d:4s;--l:' + -i + 's', ' opacity=".7"'))
  })
  // A run glint flashing beside a lit twinkling glint would show a line between them. With the
  // glints regrouped (the default), the run's flash takes in the near-coloured glint cells it
  // touches; otherwise such a run is drawn twice too (see repeat()).
  let flashTook = 0
  const takeIn = g => {
    for (const [k, c] of [...g.m]) {
      for (const q of [k - 1, k + 1, k - 4096, k + 4096]) {
        if (g.m.has(q)) continue
        const t = tw.find(L => L.m.has(q))
        if (!t) continue
        if (!regroups('gl')) {
          g.reps = repsFor('gl')
          flashTook++
        } else if (near(c, t.m.get(q), 12)) {
          g.m.set(q, t.m.get(q))
          flashTook++
        }
      }
    }
    return g
  }
  // Lines of glints that run along a ripple, one after another.
  const RUNS = {
    day: [[124, 176, 236, 4], [138, 150, 232, 5], [151, 172, 250, 6], [166, 180, 260, 7], [131, 60, 112, 4], [146, 80, 128, 5]],
    sunset: [[118, 168, 206, 4], [127, 154, 220, 5], [139, 140, 230, 6], [152, 132, 240, 6], [165, 124, 196, 7], [133, 60, 108, 5]],
    night: [[121, 136, 166, 4], [131, 124, 176, 5], [143, 116, 186, 6], [157, 120, 190, 7], [136, 210, 250, 5]],
  }[NAME]
  RUNS.forEach(([y, x0, x1, step], j) => {
    const period = 10 + (j % 3) * 2 // seconds
    const pos = []
    for (let x = x0; x <= x1; x += step) pos.push(x)
    const dt = Math.round((period * 0.6 * 20) / pos.length) / 20 // seconds between neighbours
    pos.forEach((x, i) => {
      if (mask(x, y) || mask(x + 2, y)) return
      const g = new Layer('run' + j + '_' + i)
      const len = 2 + ((i + j) % 2)
      for (let k = 0; k < len; k++) if (!gone(x + k, y)) g.set(x + k, y, M.glint[k === 1 ? 0 : 1])
      out.push(moving(takeIn(g), 'gr', '--d:' + period + 's;--l:' + f2(-period + i * dt + j * 1.35) + 's', ' opacity="0"'))
    })
  })
  twinkleLog.push(regroups('gl') ? 'runs took in ' + flashTook + ' glint cells' : 'run edges against glints: ' + flashTook)
  return [sheen, tw]
}

// Carries wave cells a cell under the sheen where the two meet in near colours (see scene()).
function tuckWaves(waveLayers, sheen) {
  let n = 0
  for (const L of waveLayers) {
    for (const [k, c] of [...L.m]) {
      for (const q of [k - 1, k + 1, k - 4096, k + 4096]) {
        const s = sheen.m.get(q)
        if (s && !L.m.has(q) && near(c, s, 28)) {
          L.m.set(q, c)
          n++
        }
      }
    }
  }
  twinkleLog.push('waves tucked ' + n + ' cells under the sheen')
}

// A mirror image of a layer in the water below `wl`: rows broken by the ripples, shifted a
// little sideways, darker and tinted by the water, fading with distance.
function reflect(src, wl, o = {}) {
  const R = new Layer(src.name + 'R')
  const kmax = o.kmax ?? 30
  const seed = o.seed ?? 1
  const tint = o.tint ?? grad(M.water, wl + 10)
  const pair = o.pair ?? 2
  for (const [k, c0] of src.m) {
    const [x, y] = cellOf(k)
    const dist = wl - y // 1 for the row just above the water
    if (dist < 1 || dist > kmax) continue
    const ry = wl + dist - 1
    if (ry >= H) continue
    const off = Math.round(Math.sin(dist * 1.3 + seed) * (0.3 + dist * 0.05))
    const keep = N1((x + off) / (2.6 + dist * 0.2), ry * 1.7 + seed) < 0.9 - (dist / kmax) * 0.6
    if (!keep) continue
    if (o.skip && o.skip(x + off, ry)) continue
    // Ripples smear the image sideways: cells take the colour of their pair's first cell.
    const c = src.get(x - (((x % pair) + pair) % pair), y) ?? c0
    const f = (o.mix ?? 0.38) + (dist / kmax) * 0.3
    R.set(x + off, ry, snap(mix(c, tint, f), o.q ?? 16))
  }
  return R
}

// A boat's reflection meets its hull at the waterline: two layers whose edges coincide, so at
// fractional cell sizes the water beneath shows between them as a line. The reflection is
// carried a row up under the hull, where the hull covers that cell both at rest and when the
// boat has dropped a cell and the reflection risen one (rk / rr), so the extra row never shows.
const boatRefl = []
function tuckUnder(refl, body, wl) {
  for (const [k, c] of [...refl.m]) {
    const [x, y] = cellOf(k)
    if (y !== wl) continue
    if (body.has(x, wl - 1) && body.has(x, wl - 3) && !refl.has(x, wl - 1)) refl.set(x, wl - 1, c)
  }
  return refl
}

// Things that twinkle in turn (glints, wave lines) are dealt into n groups with their own
// opacity animation. Where a thing in one group touches a thing in another, the shared edge
// falls inside a screen pixel at fractional cell sizes, and with both lit the water beneath
// shows through it as a line; no underlap can hide it, since either group may be dim. So
// things that touch across groups are dealt into one group, the one that keeps the still frame
// (t0: each group's opacity at time 0) as it was, or failing that the one most of them were in.
// items: [{ g, cells: [[x, y, c], ...] }] in drawing order. Returns the n layers.
// That regrouping changes when some cells twinkle, so it is used only where nothing else
// worked: the glints ('gl'; TW_REGROUP lists the kinds, '1' means all). Wave lines keep their
// groups and each group is drawn twice instead (TW_REPS, see repeat()), which leaves
// their motion as it was; for the glints that left 66 line pixels at sunset (1680x1050).
const REGROUP = new Set((process.env.TW_REGROUP ?? 'gl').split(','))
const regroups = name => REGROUP.has(name) || REGROUP.has('1')
const repsFor = name => (regroups(name) ? 1 : Number(process.env.TW_REPS ?? 2))
const twinkleLog = []
const near = (a, b, tol) => {
  const p = rgb(a)
  const q = rgb(b)
  return (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])) / 3 <= tol
}
function twinkleGroups(items, n, t0, bg, name, tol = Number(process.env.TW_TOL ?? 12)) {
  if (!regroups(name)) return items.reduce((Ls, it) => {
    for (const [x, y, c] of it.cells) Ls[it.g].set(x, y, c)
    return Ls
  }, Array.from({ length: n }, (_, i) => new Layer(name + i)))
  const layersOf = () => {
    const Ls = Array.from({ length: n }, (_, i) => new Layer(name + i))
    const owner = Array.from({ length: n }, () => new Map())
    items.forEach((it, idx) => {
      for (const [x, y, c] of it.cells) {
        Ls[it.g].set(x, y, c)
        owner[it.g].set((y + 1000) * 4096 + (x + 1000), idx)
      }
    })
    return [Ls, owner]
  }
  const look = Ls => {
    const at = new Map()
    for (let g = 0; g < n; g++) {
      for (const [k, c] of Ls[g].m) {
        const P = at.get(k) ?? rgb(bg)
        const C = rgb(c)
        at.set(k, P.map((v, i) => v * (1 - t0[g]) + C[i] * t0[g]))
      }
    }
    return at
  }
  const before = look(layersOf()[0])
  const moved = new Set()
  for (let pass = 0; pass < 6; pass++) {
    const [Ls, owner] = layersOf()
    const parent = items.map((_, i) => i)
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])))
    let seams = 0
    for (let i = 0; i < n; i++) {
      for (const k of Ls[i].m.keys()) {
        for (const q of [k + 1, k + 4096]) {
          for (let j = 0; j < n; j++) {
            if (j === i) continue
            // A seam: one group holds this cell and not the next, the other the reverse. Only
            // near colours read as one shape with a line through it; between far colours the
            // dip is part of an ordinary edge.
            if (Ls[j].m.has(q) && !Ls[j].m.has(k) && !Ls[i].m.has(q) && near(Ls[i].m.get(k), Ls[j].m.get(q), tol)) {
              seams++
              const a = find(owner[i].get(k))
              const b = find(owner[j].get(q))
              if (a !== b) parent[a] = b
            }
          }
        }
      }
    }
    if (!seams) break
    const comps = new Map()
    items.forEach((it, idx) => {
      const r0 = find(idx)
      if (!comps.has(r0)) comps.set(r0, [])
      comps.get(r0).push(idx)
    })
    for (const members of comps.values()) {
      const gs = new Set(members.map(m => items[m].g))
      if (gs.size < 2) continue
      // Try each group: the cells whose look at time 0 would change, then fewest moved.
      let best = null
      for (let t = 0; t < n; t++) {
        const changed = members.reduce((s, m) => s + (t0[items[m].g] !== t0[t] ? items[m].cells.length : 0), 0)
        const shift = members.reduce((s, m) => s + (items[m].g !== t ? items[m].cells.length : 0), 0)
        if (!best || changed < best.changed || (changed === best.changed && shift < best.shift)) best = { t, changed, shift }
      }
      for (const m of members) {
        if (items[m].g !== best.t) moved.add(m)
        items[m].g = best.t
      }
    }
  }
  const [Ls] = layersOf()
  const after = look(Ls)
  let changed = 0
  for (const [k, P] of after) {
    const Q = before.get(k)
    if (!Q || Math.max(...P.map((v, i) => Math.abs(v - Q[i]))) > 6) changed++
  }
  twinkleLog.push(name + ': ' + moved.size + ' of ' + items.length + ' moved to another group, ' + changed + ' cells look different at time 0')
  return Ls
}

// Long broken streaks under each light on the water at sunset and night, in two frames that
// take turns so the streaks shimmer: short dashes, wobbling, thinning out toward the viewer.
function lightStreaks(out) {
  if (NAME === 'day') return
  const A = new Layer('streakA')
  const B = new Layer('streakB')
  for (const [lx, ly, kind, len, wide] of lights) {
    const wl = lx < 200 ? TOWN_WL : lx < 240 ? HEAD_WL + 1 : HEAD_WL
    const ramp = kind === 'green' ? P.green : P.lit
    const n = ramp.length
    const start = (kind === 'boat' ? ly + 2 : wl + Math.round((wl - ly) * 0.5))
    for (const [L, ph] of [[A, 0], [B, 1]]) {
      for (let k = 0; k < len; k++) {
        if ((k + ph * 2) % 3 === 2) continue
        const t = k / len
        if (N1(lx * 0.7 + k * 0.45, ph * 5 + 1) < t * 0.75) continue
        const y = start + k
        if (y >= H) break
        const jit = t < 0.35 ? 0 : Math.round(Math.sin(k * 0.7 + lx + ph * 1.9) * t * 1.2)
        const w = wide && k > 2 && N2(lx + k * 0.8, ph * 4) > 0.5 ? 2 : 1
        const c = t < 0.35 ? ramp[n - 1] : t < 0.7 ? ramp[n - 2] : ramp[n - 3]
        for (let i = 0; i < w; i++) L.set(lx + jit + i - Math.floor(w / 2), y, c)
      }
    }
  }
  out.push(moving(A, 'sa', '--f:1.6s'), moving(B, 'sb', '--f:1.6s', ' opacity="0"'))
}

// ---------------------------------------------------------------- boats

// A hull side-on: from x0, len cells long, sitting at the waterline wl, bow left (dir -1) or
// right (dir 1).
function hull(L, o) {
  const { x0, len, wl, hh, dir } = o
  for (let i = 0; i < len; i++) {
    const t = i / (len - 1)
    const tb = dir < 0 ? t : 1 - t // 0 at the bow
    const rise = (o.bowRise ?? 3) * Math.pow(1 - tb, 2.4) + (o.sternRise ?? 1) * Math.pow(tb, 4)
    const top = Math.round(wl - hh - rise)
    for (let y = top; y < wl; y++) {
      const depth = (y - top) / (wl - top)
      if (tb * len < (o.rake ?? 4) * depth) continue
      if ((1 - tb) * len < (o.sternRake ?? 1) * depth * depth) continue
      const k = y - top
      let mat = o.mat
      let v = 0.62 - 0.3 * depth
      if (k === 0) {
        mat = o.rail ?? 'hullW'
        v = 0.8
      } else if (o.stripe && k <= o.stripe[1]) {
        mat = o.stripe[0]
        v = 0.62
      } else if (o.boot && wl - y <= o.boot[1]) {
        mat = o.boot[0]
        v = 0.45
      }
      if (M.light && i === (dir < 0 ? len - 1 : 0)) v -= 0.1
      L.set(x0 + i, y, sh(mat, v, x0 + i, y, 0.2))
    }
  }
}
// The four cells round a light: the small cross a lamp makes in pixel art.
function plus(L, x, y, c) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) L.set(x + dx, y + dy, c)
  return L
}
function lineIn(L, x0, y0, x1, y1, c) {
  for (const [x, y] of line(x0, y0, x1, y1)) L.set(x, y, typeof c === 'function' ? c(x, y) : c)
}

// Moored boats in the middle of the harbour: each rocks a cell up and down, its mast leans,
// its reflection moves the other way.
function midBoats(out) {
  const BOATS = [
    { x0: 88, len: 34, wl: 147, hh: 4, dir: -1, mat: 'hullR', stripe: ['hullW', 1], boot: ['ink', 1], cab: [106, 7, 6], mast: 98, mastTop: 116, d: 6, l: -1.5 },
    { x0: 165, len: 22, wl: 134, hh: 3, dir: 1, mat: 'hullW', stripe: ['hullB', 1], boot: ['hullR', 1], cab: [170, 6, 4], mast: 180, mastTop: 114, d: 5, l: -3.2 },
    { x0: 132, len: 15, wl: 160, hh: 3, dir: -1, mat: 'hullG', stripe: null, boot: null, bowRise: 2, rake: 3, row: true, d: 4, l: -0.7 },
  ]
  BOATS.forEach((b, n) => {
    const body = new Layer('boat' + n)
    hull(body, { ...b, bowRise: b.bowRise ?? 3, rake: b.rake ?? 4 })
    const top = new Layer('boatTop' + n)
    if (b.cab) {
      const [cx, cw, ch] = b.cab
      const cTop = b.wl - b.hh - ch
      for (let y = cTop; y < b.wl - b.hh; y++) for (let i = 0; i < cw; i++) body.set(cx + i, y, sh('hullW', i === 0 && M.light ? 0.45 : 0.7, cx + i, y, 0.15))
      for (let i = -1; i <= cw; i++) body.set(cx + i, cTop - 1, sh('slate', 0.5, cx + i, cTop - 1, 0))
      for (let i = 1; i < cw - 1; i += 2) {
        const lit = NAME === 'night' || (NAME === 'sunset' && n === 0)
        body.set(cx + i, cTop + 1, lit ? P.lit[3] : sh('glass', 0.3, cx + i, cTop + 1, 0))
        if (lit && NAME === 'night' && i === 1) lights.push([cx + 2, b.wl, 'boat', 12, 1])
      }
      // Mast: the lower part goes with the hull, the top sways.
      for (let y = b.mastTop; y < b.wl - b.hh; y++) (y < b.mastTop + 10 ? top : body).set(b.mast, y, sh('woodD', 0.55, b.mast, y, 0))
      for (let i = -3; i <= 3; i++) top.set(b.mast + i, b.mastTop + 4, sh('woodD', 0.5, b.mast + i, b.mastTop + 4, 0))
      const bow = b.dir < 0 ? b.x0 : b.x0 + b.len - 1
      const stern = b.dir < 0 ? b.x0 + b.len - 1 : b.x0
      lineIn(body, b.mast, b.mastTop + 10, bow + (b.dir < 0 ? 2 : -2), b.wl - b.hh - 3, (x, y) => sh('iron', 0.55, x, y, 0))
      lineIn(top, b.mast, b.mastTop, b.mast + (bow - b.mast) * 0.35, b.mastTop + 10, (x, y) => sh('iron', 0.55, x, y, 0))
      lineIn(body, b.mast, b.mastTop + 12, stern, b.wl - b.hh - 1, (x, y) => sh('iron', 0.5, x, y, 0))
      if (NAME === 'night') top.set(b.mast, b.mastTop - 1, '#fff8dc')
      else top.set(b.mast, b.mastTop - 1, sh('hullR', 0.6, b.mast, b.mastTop - 1))
    }
    if (b.row) {
      // A rowboat seen a little from above: the inside of the hull, two thwarts, an oar.
      const top0 = b.wl - b.hh - 1
      for (let x = b.x0 + 2; x < b.x0 + b.len - 2; x++) {
        body.set(x, top0, sh('hullW', 0.85, x, top0, 0))
        body.set(x, top0 + 1, sh('wood', (x - b.x0) % 5 === 2 ? 0.25 : 0.65, x, top0 + 1, 0))
      }
      lineIn(body, b.x0 + 4, top0 - 1, b.x0 + 13, top0 + 1, (x, y) => sh('wood', 0.85, x, y, 0))
    }
    rimLight(body)
    rimLight(top)
    const refl = tuckUnder(reflect(body, b.wl, { kmax: 14, seed: n * 3 + 1, mix: 0.3 }), body, b.wl)
    boatRefl.push({ R: refl, d: b.d, l: b.l })
    const both = new Layer('bt' + n)
    for (const [k, c] of top.m) both.m.set(k, c)
    for (const [k, c] of body.m) both.m.set(k, c)
    out.push(moving(refl, 'rr', '--d:' + b.d + 's;--l:' + b.l + 's'))
    const sway = [top]
    if (NAME === 'night' && b.cab) sway.push(moving(plus(new Layer('mh' + n), b.mast, b.mastTop - 1, '#ffe2a0'), '', '', ' opacity=".45"'))
    out.push(group(' class="rk" style="--d:' + b.d + 's;--l:' + b.l + 's"', [body, group(' class="ms" style="--x:' + (b.dir < 0 ? -1 : 1) + 'px"', sway)]))
  })
}

// The big trawler moored in the foreground on the right, cut by the frame.
const BIG_WL = 186
function bigBoat(out) {
  const body = new Layer('big')
  const top = new Layer('bigTop')
  const x0 = 197
  // Hull: teal, with a white sheer strake and a red boot-top.
  for (let x = x0; x < 322; x++) {
    const t = (x - x0) / 40
    const sheer = Math.round(167 - 7 * Math.pow(clamp(1 - t, 0, 1), 2) + (x > 290 ? (x - 290) * 0.08 : 0))
    for (let y = sheer; y < BIG_WL; y++) {
      const depth = (y - sheer) / (BIG_WL - sheer)
      if (x - x0 < 15 * depth * depth + 1 * depth) continue
      const k = y - sheer
      let mat = 'hullT'
      let v = 0.7 - 0.45 * depth
      if (k === 0) {
        mat = 'hullW'
        v = 0.88
      } else if (k <= 2) {
        mat = 'hullW'
        v = 0.66
      } else if (k === 3) {
        mat = 'ink'
        v = 0.5
      } else if (BIG_WL - y <= 2) {
        mat = 'hullR'
        v = 0.5
      }
      // Plate seams, and rust running down from the scuppers.
      if (mat === 'hullT' && (x - x0) % 15 === 0 && x - x0 > 20) v -= 0.1
      if (mat === 'hullT' && (x === 236 || x === 268 || x === 300) && k < 9 && N1(x, y) > 0.35) v -= 0.25
      body.set(x, y, sh(mat, v, x, y, 0.22))
    }
  }
  // A name in small light letters on the bow.
  for (const [dx, dy] of [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0], [2, 1], [2, 2], [4, 0], [4, 1], [4, 2], [5, 2], [7, 0], [7, 1], [7, 2], [8, 1], [9, 0], [9, 1], [9, 2]])
    body.set(214 + dx, 172 + dy, sh('hullW', 0.6, 214 + dx, 172 + dy, 0))
  // Tyres hung over the side as fenders, on short ropes.
  for (const fx of [232, 262, 294]) {
    for (let y = 164; y < 169; y++) body.set(fx + 1, y, sh('rope', 0.5, fx + 1, y, 0))
    sprite(body, fx - 1, 169, ['.kkk.', 'kk.kk', 'kk.kk', '.kkk.'], { k: (x, y) => sh('ink', y === 169 ? 1 : 0, x, y, 0) })
  }
  // An orange buoy.
  sprite(body, 248, 168, ['.oo.', 'oooo', 'oooo', '.oo.'], { o: (x, y) => sh('orange', 0.85 - (y - 168) * 0.18 - (x - 248) * 0.06, x, y, 0) })
  // Wheelhouse.
  const wx = 252
  const wTop = 141
  for (let y = wTop; y < 167; y++) {
    for (let x = wx; x < wx + 36; x++) {
      let v = 0.66
      if (x === wx) v = 0.4
      else if (x > wx + 32 && M.light) v = 0.86
      if (y === wTop) v = 0.32 // shadow under the roof
      else if (y === wTop + 11) v = 0.46 // a panel line under the windows
      else if (y > wTop + 21) v = 0.5 // grime at its foot
      body.set(x, y, sh('hullW', v, x, y, 0))
    }
  }
  // A lifebuoy on the wall.
  for (let y = -3; y < 3; y++)
    for (let x = -3; x < 3; x++) {
      const d = Math.hypot(x + 0.5, y + 0.5)
      if (d < 1.4 || d > 2.9) continue
      const q = Math.floor(((Math.atan2(y + 0.5, x + 0.5) + Math.PI) / (Math.PI / 2)) + 0.5) % 2
      body.set(wx + 24 + x, wTop + 16 + y, q ? sh('hullW', 0.95, 0, 0, 0) : sh('orange', 0.8 - (y + 3) * 0.06, 0, 0, 0))
    }
  for (let x = wx - 2; x < wx + 39; x++) {
    body.set(x, wTop - 1, sh('slate', 0.55, x, wTop - 1, 0))
    body.set(x, wTop - 2, sh('slate', 0.75, x, wTop - 2, 0))
  }
  // Windows: three panes, a door, portholes.
  for (const px of [wx + 3, wx + 12, wx + 21]) {
    for (let y = wTop + 4; y < wTop + 9; y++) {
      for (let x = px; x < px + 7; x++) {
        const frame = y === wTop + 4 || y === wTop + 8 || x === px || x === px + 6
        if (frame) body.set(x, y, sh('slate', 0.35, x, y, 0))
        else if (NAME === 'night') body.set(x, y, P.lit[y === wTop + 5 ? 3 : 2])
        else {
          const glare = x - px - (y - wTop - 5) === 2 || x - px - (y - wTop - 5) === 3
          body.set(x, y, glare ? sh('glass', 0.95, x, y, 0) : sh('glass', 0.35 + (y - wTop) * 0.04, x, y, 0))
        }
      }
    }
  }
  fill(body, wx + 30, wTop + 4, wx + 34, wTop + 22, (x, y) => sh('slate', x === wx + 30 ? 0.3 : 0.45, x, y, 0.1))
  body.set(wx + 33, wTop + 13, sh('quay', 0.9, wx + 33, wTop + 13, 0))
  // On the roof: a radar bar, a horn, a mast for the lights.
  fill(body, wx + 8, wTop - 5, wx + 10, wTop - 2, (x, y) => sh('iron', 0.5, x, y, 0))
  for (let x = wx + 3; x < wx + 16; x++) body.set(x, wTop - 6, sh('hullW', 0.75, x, wTop - 6, 0))
  for (let y = wTop - 26; y < wTop - 2; y++) top.set(wx + 26, y, sh('iron', 0.45, wx + 26, y, 0))
  for (let x = wx + 23; x <= wx + 29; x++) top.set(x, wTop - 20, sh('iron', 0.45, x, wTop - 20, 0))
  // The foremast with its spreader, stays and a boom, and the net drum on deck.
  const mx = 228
  for (let y = 92; y < 167; y++) {
    const L = y < 128 ? top : body
    L.set(mx, y, sh('wood', 0.75, mx, y, 0))
    L.set(mx + 1, y, sh('wood', 0.45, mx + 1, y, 0))
  }
  for (let x = mx - 7; x <= mx + 8; x++) top.set(x, 106, sh('woodD', 0.6, x, 106, 0))
  lineIn(top, mx, 93, mx - 13, 128, (x, y) => sh('iron', 0.5, x, y, 0))
  lineIn(body, mx - 13, 128, 203, 160, (x, y) => sh('iron', 0.5, x, y, 0))
  lineIn(top, mx + 1, 93, mx + 20, 118, (x, y) => sh('iron', 0.5, x, y, 0))
  lineIn(body, mx + 20, 118, wx + 4, wTop - 3, (x, y) => sh('iron', 0.5, x, y, 0))
  lineIn(top, mx - 7, 106, mx - 9, 128, (x, y) => sh('iron', 0.45, x, y, 0))
  lineIn(body, mx - 9, 128, mx - 14, 166, (x, y) => sh('iron', 0.45, x, y, 0))
  lineIn(body, mx + 1, 150, wx - 2, 136, (x, y) => sh('woodD', 0.6, x, y, 0))
  // The net drum: two flanges on a frame, the net wound between them in bands.
  for (let y = 159; y < 167; y++) {
    body.set(206, y, sh('iron', 0.35, 206, y, 0))
    body.set(221, y, sh('iron', 0.35, 221, y, 0))
  }
  for (let y = 151; y < 165; y++) {
    const u = (y - 151) / 13
    const round = y === 151 || y === 164
    for (const fx of [207, 220]) body.set(fx, y, sh('iron', round ? 0.3 : 0.62 - u * 0.4, fx, y, 0))
    if (round) continue
    for (let x = 208; x < 220; x++) {
      let v = 0.35 + 0.5 * Math.sin(Math.PI * (u * 0.9 + 0.12)) - u * 0.15
      if ((y - 151) % 3 === 0) v -= 0.22
      if ((x + y) % 4 === 0) v -= 0.12
      body.set(x, y, sh('net', v, x, y, 0))
    }
  }
  for (let x = 209; x < 220; x += 4) body.set(x, 156, sh('orange', 0.85, x, 156, 0))
  // Stanchions and a rail along the deck.
  for (let x = 202; x < 322; x++) {
    if (x > 205 && x < 223) continue
    if (x >= wx - 1 && x < wx + 37) continue
    const t = (x - x0) / 40
    const sheer = Math.round(167 - 7 * Math.pow(clamp(1 - t, 0, 1), 2) + (x > 290 ? (x - 290) * 0.08 : 0))
    body.set(x, sheer - 4, sh('iron', 0.62, x, sheer - 4, 0))
    if ((x - x0) % 6 === 0) for (let y = sheer - 3; y < sheer; y++) body.set(x, y, sh('iron', 0.45, x, y, 0))
  }
  // The masthead light and a flag on the light mast.
  top.set(mx, 91, NAME === 'night' ? '#fff8dc' : sh('iron', 0.5, mx, 91))
  rimLight(body)
  rimLight(top)
  const flagA = new Layer('flagA')
  const flagB = new Layer('flagB')
  const fx = wx + 27
  const fy = wTop - 26
  sprite(flagA, fx, fy, ['rrrrr.', 'wwwww.', 'bbbb..'], { r: sh('hullR', 0.7, 0, 0, 0), w: sh('hullW', 0.9, 0, 0, 0), b: sh('hullB', 0.7, 0, 0, 0) })
  sprite(flagB, fx, fy, ['rrrr..', 'wwwwww', '.bbbb.'], { r: sh('hullR', 0.6, 0, 0, 0), w: sh('hullW', 0.8, 0, 0, 0), b: sh('hullB', 0.6, 0, 0, 0) })
  const refl = tuckUnder(reflect(body, BIG_WL, { kmax: 16, seed: 9, mix: 0.3, tint: mix(grad(M.water, 192), '#020818', 0.4) }), body, BIG_WL)
  boatRefl.push({ R: refl, d: 7, l: -2 })
  out.push(moving(refl, 'rr', '--d:7s;--l:-2s'))
  out.push(
    group(' class="rk" style="--d:7s;--l:-2s"', [
      body,
      group(' class="ms" style="--x:-1px"', [
        top,
        moving(flagA, 'fa', '--f:1.2s;--l:0s'),
        moving(flagB, 'fb', '--f:1.2s;--l:0s', ' opacity="0"'),
        ...(NAME === 'night' ? [moving(plus(new Layer('bigLight'), mx, 91, '#ffe2a0'), '', '', ' opacity=".45"')] : []),
      ]),
    ]),
  )
  if (NAME === 'night') lights.push([wx + 13, BIG_WL - 2, 'boat', 12, 1])
  return body
}

// ---------------------------------------------------------------- the pier

const edgeY = x => 170 + (x / 150) * 7
const PIER_END = 152
function pier(out) {
  const r = rng(809)
  const D = new Layer('deck')
  // Planks run along the pier; nearer rows are wider.
  const seams = [0, 3]
  for (let s = 3, w = 3; s < 40; s += w, w = Math.min(6, w + 0.6)) seams.push(Math.round(s + w))
  const plankOf = d => {
    for (let i = seams.length - 1; i >= 0; i--) if (d >= seams[i]) return i
    return 0
  }
  const joints = new Map()
  for (let y = 165; y < H; y++) {
    for (let x = 0; x < PIER_END; x++) {
      const e = edgeY(x)
      if (y < Math.round(e)) continue
      const d = y - e
      const p = plankOf(d)
      const gap = seams.includes(Math.round(d)) && d > 1
      let mat = p === 0 ? 'woodD' : 'wood'
      let v = 0.5 + (((p * 37) % 7) / 7) * 0.2 - 0.06
      if (p === 0) v = d < 1 ? 0.9 : 0.55 // the worn edge beam
      if (gap) v = 0.08 // the gap between planks
      // Plank ends, staggered, with a pair of nails.
      if (!joints.has(p)) joints.set(p, Math.floor(r() * 30))
      const j = (x + joints.get(p)) % 33
      if (p > 0 && !gap && j === 0) v = 0.15
      else if (p > 0 && !gap && j === 1 && (Math.round(d) + 1) % 2 === 0) v = 0.85
      // Long streaks of grain.
      else if (!gap && p > 0 && N2(x / 11, y * 1.2) > 0.66) v -= 0.16
      else if (!gap && p > 0 && N3(x / 9, y * 1.1) > 0.7) v += 0.12
      let c = sh(mat, v, x, y, 0.15)
      if (NAME === 'night') {
        // The lamp lights the planks round its foot.
        const d = Math.hypot((x + 0.5 - 123) / 38, (y + 0.5 - 186) / 12)
        const f = d < 0.5 ? 0.6 : d < 0.8 ? 0.38 : d < 1.1 ? 0.18 : 0
        if (f) c = snap(mix(c, mix(tone(BASE[mat], v - 0.12, x, y, 0.15), '#ffb060', 0.3), f), 8)
      }
      D.set(x, y, c)
    }
  }
  // The end of the pier: its end face, and piles going down into the water under it.
  for (let y = Math.round(edgeY(PIER_END)); y < H; y++) {
    for (let i = 0; i < 3; i++) D.set(PIER_END + i, y, sh('woodD', i === 0 ? 0.6 : 0.3 - i * 0.06, PIER_END + i, y, 0))
  }
  for (const [px, py0, py1] of [[PIER_END + 3, 180, 193], [PIER_END + 3, 194, 200]]) {
    for (let y = py0; y < py1; y++) for (let i = 0; i < 4; i++) D.set(px + i, y, sh('woodD', 0.2 + i * 0.1 - (y - py0) * 0.01, px + i, y, 0.2))
  }
  rimLight(D, { topOnly: true, soft: true })
  out.push(D)
  // Mooring piles standing up along the edge, one with a rope wound round it.
  const piles = new Layer('piles')
  const PILES = [[8, 17], [54, 15], [100, 14], [146, 13]]
  for (const [px, h] of PILES) {
    const base = Math.round(edgeY(px)) + 1
    for (let y = base - h; y < base; y++) {
      for (let i = 0; i < 6; i++) {
        let v = M.light ? 0.3 + i * 0.1 : 0.4 + (i > 0 && i < 5 ? 0.06 : 0)
        if (y === base - h) v = 0.9
        if (y === base - h + 1) v = 0.25
        v += (N1(px + i, y / 3) - 0.5) * 0.2
        piles.set(px + i, y, sh('woodD', v, px + i, y, 0.2))
      }
    }
    if (px === 54) for (let y = base - 10; y < base - 4; y++) for (let i = 0; i < 6; i++) if ((i + y) % 3 !== 0) piles.set(px + i, y, sh('rope', 0.45 + i * 0.08, px + i, y, 0))
  }
  rimLight(piles)
  out.push(piles)
  // A cast-iron bollard with a rope looped on it.
  const things = new Layer('things')
  sprite(things, 74, 171, ['.kkkkk.', 'kkkkkkk', '..kkk..', '..kkk..', '.kkkkk.'], { k: (x, y) => sh('iron', y === 171 ? 0.9 : 0.35 + (x - 74) * 0.06, x, y, 0) })
  lineIn(things, 81, 173, 92, 179, (x, y) => sh('rope', 0.65, x, y, 0))
  // A coil of rope on the planks.
  for (let y = 0; y < 6; y++)
    for (let x = 0; x < 13; x++) {
      const d = Math.hypot((x - 6) / 6.5, (y - 2.6) / 2.9)
      if (d < 1 && d > 0.22) things.set(86 + x, 183 + y, d > 0.86 ? sh('woodD', 0.2, 86 + x, 183 + y, 0) : sh('rope', 0.35 + (Math.round(d * 5) % 2 ? 0.45 : 0) - y * 0.03, 86 + x, 183 + y, 0))
    }
  // Fish crates, stacked, the top one full.
  // Plastic fish crates: a lip on top, a handle hole, ribs down the side.
  const crate = (cx, cy, w, h, mat) => {
    for (let y = cy; y < cy + h; y++)
      for (let x = cx; x < cx + w; x++) {
        const k = y - cy
        let v = 0.55 - k * 0.03
        if (k === 0) v = 0.95
        else if (k === 1) v = 0.3
        else if ((x - cx) % 4 === 1) v -= 0.18
        if (k === 2 && x > cx + w / 2 - 3 && x < cx + w / 2 + 2) v = 0.05
        if (x === cx) v -= 0.12
        things.set(x, y, sh(mat, v, x, y, 0.15))
      }
  }
  crate(12, 188, 17, 9, 'crate')
  crate(14, 181, 15, 7, 'crate')
  crate(32, 189, 14, 8, 'crateR')
  for (let x = 16; x < 28; x++) {
    things.set(x, 180, sh('fish', ((x * 7) % 4) / 3, x, 180, 0))
    if (x % 3 !== 1) things.set(x, 179, sh('fish', x % 2 ? 0.95 : 0.6, x, 179, 0))
  }
  // A pair of floats tied together.
  for (const [fx, fy] of [[50, 191], [54, 189]]) sprite(things, fx, fy, ['.oo.', 'oooo', 'oooo', '.oo.'], { o: (x, y) => sh('orange', 0.95 - (y - fy) * 0.2 - (x - fx) * 0.05, x, y, 0) })
  lineIn(things, 52, 195, 60, 197, (x, y) => sh('rope', 0.6, x, y, 0))
  rimLight(things, { topOnly: true, soft: true })
  out.push(things)
  // The harbour lamp on its iron post.
  const lamp = new Layer('lamp')
  const lx = 122
  const lb = Math.round(edgeY(lx)) + 7
  for (let y = 124; y < lb; y++) {
    lamp.set(lx, y, sh('iron', 0.55, lx, y, 0))
    lamp.set(lx + 1, y, sh('iron', 0.3, lx + 1, y, 0))
  }
  for (const y of [150, 151]) for (let x = lx - 1; x <= lx + 2; x++) lamp.set(x, y, sh('iron', y === 150 ? 0.7 : 0.35, x, y, 0))
  for (let x = lx - 2; x <= lx + 3; x++) lamp.set(x, lb - 1, sh('iron', 0.4, x, lb - 1, 0))
  for (let x = lx - 1; x <= lx + 2; x++) lamp.set(x, lb - 2, sh('iron', 0.55, x, lb - 2, 0))
  // The lantern: cap, four panes, a tray.
  sprite(lamp, lx - 3, 112, ['...kk...', '..kkkk..', '.kkkkkk.', 'kkkkkkkk'], { k: (x, y) => sh('iron', y === 112 ? 0.7 : 0.45 + (x - lx) * 0.04, x, y, 0) })
  for (let y = 116; y < 122; y++)
    for (let x = lx - 2; x <= lx + 3; x++) {
      const frame = x === lx - 2 || x === lx + 3 || (x === lx || x === lx + 1 ? false : false)
      const mull = x === lx || x === lx + 1 ? y === 118 : false
      if (frame || mull) lamp.set(x, y, sh('iron', 0.35, x, y, 0))
      else if (NAME === 'night') lamp.set(x, y, P.lit[y < 119 ? 4 : 3])
      else if (NAME === 'sunset') lamp.set(x, y, P.lit[y < 119 ? 3 : 2])
      else lamp.set(x, y, sh('lamp', 0.3 + (x - lx) * 0.18, x, y, 0.2))
    }
  for (let x = lx - 2; x <= lx + 3; x++) lamp.set(x, 122, sh('iron', 0.5, x, 122, 0))
  lamp.set(lx, 123, sh('iron', 0.4, lx, 123, 0))
  lamp.set(lx + 1, 123, sh('iron', 0.3, lx + 1, 123, 0))
  rimLight(lamp)
  out.push(lamp)
  if (NAME !== 'day') {
    // Its glow, and a pool of light on the planks round its foot.
    const big = NAME === 'night'
    for (const [R, op] of big ? [[26, 0.06], [14, 0.1], [7, 0.16]] : [[10, 0.08], [5, 0.12]]) out.push(moving(glowDisc(new Layer('lg' + R), lx + 1, 118.5, R, '#ffcf7a', 2), '', '', ' opacity="' + op + '"'))
    if (big) {
      // (The pool of light on the planks is painted into the deck.)
    }
  }
  return D
}

// ---------------------------------------------------------------- gulls

const GULL = {
  // Wings up, and gliding.
  bigA: ['k.......k', '.gg...gg.', '...gwwg..', '....ow...'],
  bigB: ['.........', 'kgg...ggk', '..ggwwgg.', '....ow...'],
  midA: ['k.....k', '.g...g.', '..gwg..', '...o...'],
  midB: ['.......', 'kg...gk', '.ggwgg.', '...o...'],
  smallA: ['k...k', '.gwg.'],
  smallB: ['.....', 'kgwgk'],
  perchA: ['..ww..', '.oww..', '..www.', '..wggg', '..wggk', '...y.y'],
  perchB: ['..ww..', '..wwo.', '..www.', '..wggg', '..wggk', '...y.y'],
}
function gullMap() {
  return { k: sh('ink', 0.3, 0, 0, 0), g: sh('gull', 0.45, 0, 0, 0), w: sh('gull', 0.95, 0, 0, 0), o: sh('beak', 0.5, 0, 0, 0), y: sh('beak', 0.3, 0, 0, 0) }
}
// path: [[x, y], ...] keyframe positions (cells, relative to where the gull is drawn), evenly
// spaced over the cycle d.
function gull(out, name, kind, x, y, pathPts, d, l) {
  const map = gullMap()
  const A = new Layer(name + 'A')
  const B = new Layer(name + 'B')
  sprite(A, x, y, GULL[kind + 'A'], map)
  sprite(B, x, y, GULL[kind + 'B'], map)
  rimLight(A, { topOnly: true })
  rimLight(B, { topOnly: true })
  const seg = d / pathPts.length
  let k = ''
  pathPts.forEach(([px, py], i) => {
    k += f2((i / pathPts.length) * 100) + '%{transform:translate(' + px + 'px,' + py + 'px);animation-timing-function:steps(' + ticks(seg) + ')}'
  })
  k += '100%{transform:translate(' + pathPts[0][0] + 'px,' + pathPts[0][1] + 'px)}'
  KEYFRAMES.push('@keyframes ' + name + '{' + k + '}')
  RULES[name] = '.' + name + '{animation:' + name + ' ' + d + 's steps(1) ' + from(l + 's') + ' infinite}'
  out.push(group(' class="' + name + '"', [moving(A, 'ga', '--f:4s;--l:' + f2(-((l * 7) % 4 + 4) % 4) + 's'), moving(B, 'gb', '--f:4s;--l:' + f2(-((l * 7) % 4 + 4) % 4) + 's', ' opacity="0"')]))
}
function ellipsePath(cx, cy, rx, ry, n, phase = 0) {
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2
    pts.push([Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry)])
  }
  return pts
}

// ---------------------------------------------------------------- night: the beam

// The lighthouse beam, turning: a long pale wedge drawn pointing left, squeezed and flipped
// about the lamp as it comes round, brightest when it faces the viewer. Two beams, back to back.
function beam(out) {
  const near = new Layer('beamNear')
  const mid = new Layer('beamMid')
  const far = new Layer('beamFar')
  const core = new Layer('beamCore')
  const ox = LH.x + 0.5
  const oy = LH.lampY + 0.5
  for (let x = 0; x < ox; x++) {
    const d = ox - x
    const cy = oy + d * 0.05
    const hw = 0.7 + d * 0.03
    for (let y = Math.floor(cy - hw - 1); y <= cy + hw + 1; y++) {
      const u = Math.abs(y + 0.5 - cy) / hw
      if (u > 1) continue
      // Thinner and fainter toward its end, the last stretch only every other cell.
      if (d > 200 && (u > 0.75 || bayer(x, y) + 0.5 < (d - 200) / 100)) continue
      ;(d < 90 ? near : d < 170 ? mid : far).set(x, y, '#fff2cc')
      if (u < 0.34 && d < 150) core.set(x, y, '#fffaea')
    }
  }
  const origin = 'transform-origin:' + f2(ox) + 'px ' + f2(oy) + 'px'
  // At rest (the still frame, reduced motion) one beam points left and the other right.
  for (const [name, rest] of [['bm', 0.7], ['bn', -0.7]]) {
    out.push(
      group(' class="' + name + '" style="' + origin + ';transform:scaleX(' + rest + ')"', [
        moving(clone(far, name + 'f'), '', '', ' opacity=".06"'),
        moving(clone(mid, name + 'm'), '', '', ' opacity=".1"'),
        moving(clone(near, name + 'n'), '', '', ' opacity=".14"'),
        moving(clone(core, name + 'c'), '', '', ' opacity=".12"'),
      ]),
    )
  }
  // The lamp flares when a beam faces the viewer.
  const flare = glowDisc(new Layer('flare'), ox, oy, 7, '#ffe6a8', 0.6)
  out.push(group(' opacity=".22"', [moving(flare, 'fl')]))
  const halo = glowDisc(new Layer('lhHalo'), ox, oy, 3.6, '#fff6d8', 0.5)
  out.push(moving(halo, '', '', ' opacity=".3"'))
}
function clone(L, name) {
  const C = new Layer(name)
  for (const [k, c] of L.m) C.m.set(k, c)
  return C
}

// ---------------------------------------------------------------- CSS

const from = l => 'calc(' + l + ' + var(--m))'
let RULES = {}
let KEYFRAMES = []
// An ease-in-out swing from -a to a as ten keyframes, a tenth of the cycle apart.
function swingKeys(name, prop) {
  let k = ''
  for (let i = 0; i <= 10; i++) {
    const v = Math.round(-Math.cos((Math.PI * i) / 10) * 100) / 100
    k += i * 10 + '%{transform:' + prop + '(calc(var(--a)*' + v + '))}'
  }
  return '@keyframes ' + name + '{' + k + '}'
}
function baseRules() {
  RULES = {
    // Boats: down a cell for half the cycle; reflections up; mast tops lean.
    rk: '.rk{animation:rk var(--d) steps(1) ' + from('var(--l)') + ' infinite}@keyframes rk{0%,40%{transform:none}50%,90%{transform:translateY(1px)}100%{transform:none}}',
    rr: '.rr{animation:rr var(--d) steps(1) ' + from('var(--l)') + ' infinite}@keyframes rr{0%,40%{transform:none}50%,90%{transform:translateY(-1px)}100%{transform:none}}',
    // Water that a boat's reflection covers while risen (rh) or at rest (rs): seen only in
    // the other state, on the boat's timing.
    rh: '.rh{animation:rh var(--d) steps(1) ' + from('var(--l)') + ' infinite}@keyframes rh{0%,40%{opacity:1}50%,90%{opacity:0}100%{opacity:1}}',
    rs: '.rs{animation:rs var(--d) steps(1) ' + from('var(--l)') + ' infinite}@keyframes rs{0%,40%{opacity:0}50%,90%{opacity:1}100%{opacity:0}}',
    ms: '.ms{animation:ms var(--d) steps(1) ' + from('var(--l)') + ' infinite}@keyframes ms{0%,40%{transform:none}50%,90%{transform:translateX(var(--x))}100%{transform:none}}',
    // Wave lines come and go.
    wv: '.wv{animation:wv var(--d) steps(1) ' + from('var(--l)') + ' infinite}@keyframes wv{0%{opacity:0}10%{opacity:.3}20%{opacity:.6}30%,60%{opacity:.9}70%{opacity:.6}80%{opacity:.3}90%,100%{opacity:0}}',
    // Glints in the sun's column twinkle; runs of glints light up one after another.
    gt: '.gt{animation:gt var(--d) steps(1) ' + from('var(--l)') + ' infinite}@keyframes gt{0%{opacity:.15}12.5%{opacity:.5}25%,50%{opacity:1}62.5%{opacity:.5}75%,100%{opacity:.15}}',
    gr: '.gr{animation:gr var(--d) steps(1) ' + from('var(--l)') + ' infinite}@keyframes gr{0%{opacity:0}2.5%{opacity:.5}5%,7.5%{opacity:1}10%{opacity:.5}12.5%,100%{opacity:0}}',
    // Clouds drift to and fro.
    cd: '.cd{animation:cd var(--d) steps(8) ' + from('var(--l)') + ' infinite alternate}' + swingKeys('cd', 'translateX'),
    // Rays breathe.
    ry: '.ry{animation:ry var(--d) steps(1) ' + from('var(--l)') + ' infinite}@keyframes ry{0%,100%{opacity:1}25%{opacity:.85}50%{opacity:.6}75%{opacity:.85}}',
    // Two frames taking turns: flags, light streaks.
    fa: '.fa,.sa{animation:fa var(--f) steps(1) ' + from('var(--l,0s)') + ' infinite}@keyframes fa{0%{opacity:1}50%,100%{opacity:0}}',
    fb: '.fb,.sb{animation:fb var(--f) steps(1) ' + from('var(--l,0s)') + ' infinite}@keyframes fb{0%{opacity:0}50%,100%{opacity:1}}',
    // Gulls: a few wing beats, then a long glide.
    ga: '.ga{animation:ga var(--f) steps(1) ' + from('var(--l)') + ' infinite}@keyframes ga{0%,20%{opacity:1}10%,30%,100%{opacity:0}}',
    gb: '.gb{animation:gb var(--f) steps(1) ' + from('var(--l)') + ' infinite}@keyframes gb{0%,20%{opacity:0}10%,30%,100%{opacity:1}}',
    // The perched gull looks about now and then.
    hd: '.hd{animation:hd 15s steps(1) ' + from('-3s') + ' infinite}@keyframes hd{0%,60%{opacity:1}61%,100%{opacity:0}}.he{animation:he 15s steps(1) ' + from('-3s') + ' infinite}@keyframes he{0%,60%{opacity:0}61%,100%{opacity:1}}',
    // The sail crosses the gap a cell every two seconds.
    sl: '.sl{animation:sl 150s steps(75) ' + from('-60s') + ' infinite}@keyframes sl{from{transform:none}to{transform:translateX(75px)}}',
    // Smoke from the cottage chimney rises and thins.
    sk: '.sk{animation:sk 6s steps(12) ' + from('var(--l)') + ' infinite}@keyframes sk{0%{transform:none;opacity:.7}100%{transform:translate(3px,-9px);opacity:0}}',
    // Stars dim for a moment now and then.
    tk: '.tk{animation:tk var(--d) steps(1) ' + from('var(--l)') + ' infinite}@keyframes tk{0%,90%{opacity:1}94%,100%{opacity:.4}}',
    // A window goes dark for a while, then lights again.
    wn: '.wn{animation:wn var(--d) steps(1) ' + from('var(--l)') + ' infinite}@keyframes wn{0%,55%{opacity:1}56%,100%{opacity:0}}',
  }
  KEYFRAMES = []
}
// The beam: twenty keyframes round the turn, a step every tick between them.
function beamRules() {
  const T = 16
  const n = 20
  const seg = ticks(T / n)
  for (const [name, off] of [['bm', 0], ['bn', Math.PI]]) {
    let k = ''
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2 + off
      const sx = Math.round(Math.cos(a) * 100) / 100
      const facing = Math.sin(a) // 1 when the beam points at the viewer
      const op = Math.round((0.55 + 0.45 * facing) * 100) / 100
      k += f2((i / n) * 100) + '%{transform:scaleX(' + (Math.abs(sx) < 0.03 ? (sx < 0 ? -0.03 : 0.03) : sx) + ');opacity:' + op + (i < n ? ';animation-timing-function:steps(' + seg + ')' : '') + '}'
    }
    RULES[name] = '.' + name + '{animation:' + name + ' ' + T + 's steps(1) ' + from('-2s') + ' infinite}@keyframes ' + name + '{' + k + '}'
  }
  let k = ''
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    const f = Math.pow(Math.abs(Math.sin(a)), 6)
    k += f2((i / n) * 100) + '%{opacity:' + f2(0.1 + 0.9 * f) + (i < n ? ';animation-timing-function:steps(' + seg + ')' : '') + '}'
  }
  RULES.fl = '.fl{animation:fl ' + T + 's steps(1) ' + from('-2s') + ' infinite}@keyframes fl{' + k + '}'
}

// ---------------------------------------------------------------- writing it out

const PATTERN_MIN = 55
let defs = []
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
const stats = { patterns: 0, patternRuns: 0, plainRuns: 0 }
const SIZES = []

// Cells are written by the seam-proof encoder (emitSafe, harbor's local copy in encode-local.mjs):
// each colour also lies under the neighbouring cells of colours drawn after it, and split paths
// overlap, so no edge between two cells ever shows what is beneath them at fractional cell sizes.
// A path spans at most 19 rows unless it is at most 21 or at least 120 cells across
// (encode-local.mjs, changes 3 and 4): every cell corner stays square at 4 to 9 px a cell, for
// about 2.5k a moment less than capping every path. Change 1 (outer-edge backing) is off: it
// cost 1.7k to 3k a moment and scanned no better here.
const SAFE = { T: Number(process.env.SAFE_T ?? 28), maxRows: 19, narrow: 21, wide: 120, edge: false }
// Layers (by name) whose colours may also be tried largest first, keeping whichever order
// writes shorter (after Moon Keep). Only day's town, which saves about 4k there and keeps day
// under 128,000: tried on every layer it also added line pixels (sunset 1200x780: 27 to 63).
const AREA_OK = { day: ['town'] }
function draw(L) {
  // A busy texture may tolerate a larger step before its edges are covered (L.T).
  const base = { ...SAFE, ...(L.T ? { T: L.T } : {}) }
  const orders = (AREA_OK[NAME] ?? []).some(p => L.name.startsWith(p)) ? ['lum', 'area'] : ['lum']
  const tries = orders.map(order => [order, emitSafe(L, { ...base, order })])
  const [order, plain] = tries.reduce((a, b) => (b[1].length < a[1].length ? b : a))
  const opts = { ...base, order }
  if (process.env.SIZES) SIZES.push([L.name, plain.length])
  const runs = (plain.match(/[hv]-?\d/g) ?? []).length
  if (runs < PATTERN_MIN) {
    stats.plainRuns += runs
    return plain
  }
  stats.patterns++
  stats.patternRuns += runs
  // The tile is the rect's box. It keeps a clear cell on every side, so no drawn cell touches
  // the edge of the tile's bitmap (that edge row blends with nothing and shows as a line). Its
  // corner sits on a cell corner (cells span y - .5 to y + .5), so the tile's bitmap grid lines
  // up with the cells; half a cell off, every row edge in the tile is resampled across two
  // screen pixels and blurs.
  const b = bounds(L)
  const x = b.x0 - 1
  const y = b.y0 - 1.5
  const id = nextId()
  defs.push('<pattern id="' + id + '" width="1" height="1">' + emitSafe(L, { ...opts, ox: x, oy: y }) + '</pattern>')
  return '<rect x="' + x + '" y="' + y + '" width="' + (b.x1 - b.x0 + 2) + '" height="' + (b.y1 - b.y0 + 2) + '" fill="url(#' + id + ')"/>'
}

// Drops cells of still layers that a still layer above them always covers. A covered cell next
// to one of the layer's own cells that shows is kept: it carries the lower layer a cell under
// the upper one, so their meeting edge lies over solid colour (no hairline between them).
function cull(list) {
  const covered = new Set()
  const walk = items => {
    for (let i = items.length - 1; i >= 0; i--) {
      const L = items[i]
      if (L.raw || L.wrap || L.attrs !== undefined) continue
      const keys = [...L.m.keys()]
      const shows = k => L.m.has(k) && !covered.has(k)
      const drop = keys.filter(k => covered.has(k) && ![k - 1, k + 1, k - 4096, k + 4096].some(shows))
      for (const k of drop) L.m.delete(k)
      for (const k of keys) covered.add(k)
    }
  }
  walk(list)
}

function renderLayers(layers) {
  let out = ''
  let still = null
  const flush = () => {
    if (still && still.size) out += draw(still)
    still = null
  }
  for (const L of layers) {
    if (L.raw) {
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
    if (L.attrs === undefined && !L.reps) {
      still ??= new Layer('')
      still.name += (still.name ? '+' : '') + L.name
      if (L.T) still.T = Math.max(still.T ?? 0, L.T)
      for (const [k, c] of L.m) still.m.set(k, c)
      continue
    }
    flush()
    out += L.attrs === undefined ? repeat(draw(L), L.reps) : '<g' + L.attrs + '>' + repeat(draw(L), L.reps) + '</g>'
  }
  flush()
  return out
}

// Draws a layer n times over itself (the copies are <use> references, a few characters each).
// Layers that twinkle or flash in turn touch one another, and either may be dim, so no underlap
// can join them: where both are lit, their shared edge falls inside a screen pixel at fractional
// cell sizes and the water beneath shows through by up to a quarter. Drawn twice each, an edge
// pixel's coverage goes from a to 1 - (1 - a)^2, and what shows between two such layers falls
// from a(1 - a) to a^2(1 - a)^2: at most a sixteenth. Whole cells are unchanged. (Three draws
// scanned the same and cost twice the frame time in player-check.)
function repeat(svg, n = 1) {
  if (n < 2) return svg
  const id = nextId()
  return '<g id="' + id + '">' + svg + '</g>' + '<use href="#' + id + '"/>'.repeat(n - 1)
}

// What of the CSS survives the app's scrub (see sunfield/tools/build.mjs): every rule but
// @keyframes, with its animation declarations gone.
function keptLength(css) {
  let n = 0
  for (const m of css.matchAll(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}|@media[^{]*\{[^{}]*\{[^{}]*\}\}|([^{}]+)\{([^{}]*)\}/g)) {
    if (m[0].startsWith('@keyframes')) continue
    if (m[0].startsWith('@media')) {
      n += m[0].length + 12
      continue
    }
    const decls = m[2]
      .split(';')
      .filter(d => d && !/^animation/.test(d))
      .map(d => {
        const [p, ...v] = d.split(':')
        return p + ': ' + v.join(':').replace(/,/g, ', ') + ';'
      })
    n += m[1].length + 3 + (decls.length ? decls.join(' ').length + 1 : 0) + 1
  }
  return n
}

// ---------------------------------------------------------------- the scene

function scene(name) {
  useMoment(name)
  baseRules()
  if (name === 'night') beamRules()
  defs = []
  ids = 0
  lights.length = 0
  for (const k of Object.keys(stats)) stats[k] = 0

  const items = []
  items.push(raw(bands(M.sky, 0, HY) + bands(M.water, HY, H)))
  // The sky.
  const skyItems = []
  if (name === 'day') daySun(skyItems)
  if (name === 'sunset') setSun(skyItems)
  if (name === 'night') nightSky(skyItems)
  clouds(skyItems)
  sail(skyItems)
  items.push(...skyItems)
  // The far shore.
  mountains(items)
  const [townL, quayBoats] = town(items)
  const [headL, lhL] = headland(items)
  // Chimney smoke from the cottage, by day and at sunset.
  if (name !== 'night') {
    for (let i = 0; i < 3; i++) {
      const s = new Layer('smoke' + i)
      fill(s, 277, 66, 279, 68, name === 'day' ? '#e8eef6' : '#9a7a96')
      items.push(moving(s, 'sk', '--l:' + -i * 2 + 's', ' opacity=".5"'))
    }
  }
  // What the foreground hides from the water.
  const fg = new Layer('fg')
  // Water: reflections first, then the texture over them, then the sun's column.
  const water = []
  const tint = grad(M.water, 126)
  // The pier and the big boat are painted later; their cells mask the water under them.
  const boatItems = []
  const bigItems = []
  const pierItems = []
  boatRefl.length = 0
  const bigBody = bigBoat(bigItems)
  const deck = pier(pierItems)
  // The mid boats are painted now (they draw later); their reflections hide what lies under
  // them on the water.
  midBoats(boatItems)
  const hidden = (x, y) => deck.has(x, y) || (bigBody.has(x, y - 2) && bigBody.has(x, y + 2) && bigBody.has(x - 2, y) && bigBody.has(x + 2, y))
  const townR = reflect(townL, TOWN_WL, { kmax: 26, seed: 2, tint, mix: name === 'night' ? 0.55 : 0.48, skip: hidden })
  const headAll = new Layer('headAll')
  for (const [k, c] of headL.m) headAll.m.set(k, c)
  for (const [k, c] of lhL.m) headAll.m.set(k, c)
  const headR = reflect(headAll, HEAD_WL, { kmax: 34, seed: 5, tint, mix: name === 'night' ? 0.55 : 0.48, skip: hidden })
  water.push(moving(townR, 'rf', '--d:9s;--l:-3s'))
  water.push(reflect(quayBoats, TOWN_WL + 2, { kmax: 4, seed: 4, tint, mix: 0.35 }))
  water.push(moving(headR, 'rf', '--d:11s;--l:-7s'))
  const mask = (x, y) => hidden(x, y) || townR.has(x, y) || headR.has(x, y)
  // Water cells that a boat's reflection covers both at rest and risen a cell (rr) never show;
  // they are left out, since their edges, lying exactly under the reflection's, would show as
  // a fringe at fractional cell sizes.
  const gone = (x, y) => boatRefl.some(({ R }) => R.has(x, y) && R.has(x, y + 1))
  const waveLayers = waterTexture(water, mask, gone)
  const [sheen, glintLayers] = sunPath(water, mask, gone)
  // Where a wave line meets the sun's sheen in a near colour, the wave is carried a cell under
  // the sheen (still and opaque by day and at sunset, so the extra cell never shows).
  if (NAME !== 'night') tuckWaves(waveLayers, sheen)
  // Water cells a boat's reflection covers in only one of its two states show only in the other.
  ;[...waveLayers, sheen, ...glintLayers].forEach(L => {
    const extra = syncWithBoats(L)
    if (!extra.length) return
    const at = water.indexOf(L)
    if (L.attrs === undefined) water.splice(at + 1, 0, ...extra)
    else {
      const attrs = L.attrs
      delete L.attrs
      water[at] = group(attrs, [L, ...extra])
    }
  })
  items.push(...water)
  // Mid-harbour boats, then streaks of light under every lamp.
  items.push(...boatItems)
  lightStreaks(items)
  if (name === 'night') beam(items)
  // Gulls over the water.
  gull(items, 'g1', 'mid', 150, 70, ellipsePath(0, 0, 40, 9, 12), 36, -5)
  gull(items, 'g2', 'small', 60, 46, ellipsePath(0, 0, 26, 5, 10, 1.4), 30, -17)
  gull(items, 'g3', 'big', 252, 84, ellipsePath(0, 0, 18, 6, 10, 3), 26, -9)
  // The big boat, then the pier in front.
  items.push(...bigItems)
  items.push(...pierItems)
  // A gull perched on a pile, looking about.
  const pA = new Layer('perchA')
  const pB = new Layer('perchB')
  const px = 100
  const py = Math.round(edgeY(px)) + 1 - 14 - 6
  sprite(pA, px, py, GULL.perchA, gullMap())
  sprite(pB, px, py, GULL.perchB, gullMap())
  rimLight(pA, { topOnly: true })
  rimLight(pB, { topOnly: true })
  items.push(moving(pA, 'hd'), moving(pB, 'he', '', ' opacity="0"'))

  cull(items)
  const body = renderLayers(items)
  const used = new Set([...body.matchAll(/class="(\w+)"/g)].map(m => m[1]))
  if (used.has('sa')) used.add('fa')
  if (used.has('sb')) used.add('fb')
  if (used.has('he')) used.add('hd')
  let css = Object.entries(RULES)
    .filter(([k]) => used.has(k))
    .map(([, v]) => v)
    .join('')
  css += KEYFRAMES.filter(k => used.has(/@keyframes (\w+)/.exec(k)[1])).join('')
  // Reflections sway a cell sideways.
  if (used.has('rf')) css += '.rf{animation:rf var(--d) steps(1) ' + from('var(--l)') + ' infinite}@keyframes rf{0%,45%{transform:none}50%,95%{transform:translateX(1px)}100%{transform:none}}'
  css += '@media (prefers-reduced-motion:reduce){:root *{animation:none!important}}'

  let svg =
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" font-family="a" color="a" style="--m:0s">' +
    '<style>' + css + '</style><defs>' + defs.join('') + '</defs>' +
    '<svg viewBox="0 -.5 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMax slice">' + body + '</svg></svg>'
  svg = svg.replaceAll('"', "'")
  const scrubbed = svg.length - css.length + keptLength(css) + [...svg.matchAll(/<(\w+)[^>]*\/>/g)].reduce((n, m) => n + 2 + m[1].length, 0)
  return { svg, scrubbed, css: css.length, stats: { ...stats } }
}

const LIMIT = 131072
// Leaves room under the limit for the app's own changes (see the seam fix brief).
const AIM = 128000
const only = process.argv[2]?.split(',')
fs.mkdirSync(path.join(HERE, 'out'), { recursive: true })
let bad = false
for (const name of Object.keys(MOMENTS)) {
  if (only && !only.includes(name)) continue
  SIZES.length = 0
  const { svg, scrubbed, css, stats: st } = scene(name)
  if (process.env.SIZES) {
    const rows = [...SIZES].sort((a, b) => b[1] - a[1]).slice(0, 25)
    console.log(rows.map(r => r.join(':')).join('  '))
  }
  if (twinkleLog.length) console.log('  ' + twinkleLog.splice(0).join('; '))
  const file = path.join(HERE, 'out', 'harbor-' + name + '.svg')
  fs.writeFileSync(file, svg)
  const ok = svg.length <= LIMIT && scrubbed <= LIMIT
  const aim = svg.length <= AIM && scrubbed <= AIM
  if (!ok) bad = true
  console.log(name.padEnd(7), svg.length, 'chars,', scrubbed, 'after the scrub', ok ? (aim ? 'OK' : 'OVER THE 128,000 AIM') : 'TOO BIG', '| css', css, '| patterns', st.patterns, 'with', st.patternRuns, 'runs; plain runs', st.plainRuns)
}
if (bad) process.exit(1)
