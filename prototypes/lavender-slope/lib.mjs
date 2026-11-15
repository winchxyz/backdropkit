// Helpers for Lavender Slope: the grid, noise, colour, polygons, haze and keyframe writers.
import { clamp, hex, lerp, rgb, smooth, tone } from '../../../sunfield/tools/pixel.mjs'

export const W = 320
export const H = 200
export const TICK = 0.05
const ROW = 4096
export const KEY = (x, y) => (Math.floor(y) + 1000) * ROW + (Math.floor(x) + 1000)
export const cellXY = k => [(k % ROW) - 1000, Math.floor(k / ROW) - 1000]
export const f2 = v => String(Math.round(v * 100) / 100).replace(/^0\./, '.').replace(/^-0\./, '-.')
export const sec = v => f2(Math.round(v / TICK) * TICK) // seconds, on the clock

// ---------------------------------------------------------------- noise

export function hash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
// Smooth value noise in 0..1.
export function noise(x, y, s) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const u = smooth(x - xi)
  const v = smooth(y - yi)
  return lerp(lerp(hash(xi, yi, s), hash(xi + 1, yi, s), u), lerp(hash(xi, yi + 1, s), hash(xi + 1, yi + 1, s), u), v)
}

// ---------------------------------------------------------------- colour

export const mix = (a, b, t) => {
  const A = rgb(a)
  const B = rgb(b)
  return hex([lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)])
}
export function ramp(stops, t) {
  if (t <= stops[0][0]) return stops[0][1]
  for (let i = 0; i < stops.length - 1; i++) {
    const [ta, ca] = stops[i]
    const [tb, cb] = stops[i + 1]
    if (t <= tb) return mix(ca, cb, (t - ta) / (tb - ta))
  }
  return stops[stops.length - 1][1]
}
export const lumOf = c => {
  const [r, g, b] = rgb(c)
  return (0.3 * r + 0.55 * g + 0.15 * b) / 255
}

// A palette sunk into a haze colour, cached: every distinct colour costs a path.
const fogCache = new Map()
export function fogged(pal, haze, q) {
  if (!q) return pal
  const k = pal.join() + haze + q
  let p = fogCache.get(k)
  if (!p) fogCache.set(k, (p = pal.map(c => mix(c, haze, q))))
  return p
}
// Haze in a few flat steps whose edges wander with low noise (no ordered dither: at this scale a
// checker reads as a screen and costs a run a cell). Returns the step, 0..n.
export function fogStep(f, x, y, n = 3, seed = 5, wob = 0.35, fx = 0.06) {
  return clamp(Math.round(f * n + (noise(x * fx, y * 0.35, seed) - 0.5) * wob * n), 0, n)
}
// A tone of `pal` at brightness v (no dither), sunk into `haze` by step q of n, up to fmax.
export function hz(pal, v, q, n, haze, fmax = 0.85) {
  return tone(fogged(pal, haze, (q / n) * fmax), v, 0, 0, 0)
}
export const pick = (pal, v) => pal[clamp(Math.floor(v * pal.length), 0, pal.length - 1)]

// ---------------------------------------------------------------- shapes

// Piecewise-linear y of a polyline [[x, y], ...] at x.
export function polyY(pts, x) {
  if (x <= pts[0][0]) return pts[0][1]
  for (let i = 0; i < pts.length - 1; i++) {
    const [xa, ya] = pts[i]
    const [xb, yb] = pts[i + 1]
    if (x <= xb) return lerp(ya, yb, (x - xa) / (xb - xa))
  }
  return pts[pts.length - 1][1]
}
export function inPoly(pts, x, y) {
  let c = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

// ---------------------------------------------------------------- keyframes

// Keyframes for an animation of T seconds from [time, css] holds (steps(1) between them); the
// loop closes on the first.
export function keyframes(name, T, holds) {
  const pct = t => String(Math.round((t / T) * 1e6) / 1e4)
  let k = ''
  for (const [t, c] of holds) k += (t === 0 ? '0' : pct(t)) + '%{' + c + '}'
  k += '100%{' + holds[0][1] + '}'
  return '@keyframes ' + name + '{' + k + '}'
}
// A drift of `a` whole cells as eased keyframes (the class runs it there and back).
export function swingKf(name, a) {
  let k = ''
  let last = null
  for (let i = 0; i <= 20; i++) {
    const v = Math.round((a * (1 - Math.cos((Math.PI * i) / 20))) / 2)
    if (v !== last || i === 20) k += i * 5 + '%{transform:' + (v ? 'translateX(' + v + 'px)' : 'none') + '}'
    last = v
  }
  return '@keyframes ' + name + '{' + k + '}'
}
export function swingY(name, a, b) {
  let k = ''
  for (let i = 0; i <= 10; i++) {
    const v = Math.round(a + ((b - a) * (1 - Math.cos((Math.PI * i) / 10))) / 2)
    k += i * 10 + '%{transform:translateY(' + v + 'px)}'
  }
  return '@keyframes ' + name + '{' + k + '}'
}
export const tx = v => (v ? 'transform:translateX(' + v + 'px)' : 'transform:none')
