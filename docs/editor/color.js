// Colour: sRGB and OKLab, the light of each time of day, and relighting a colour from one
// moment to another. Relighting is not a flat tint: lightness and chroma follow the light, and
// the hue shifts by value, lights toward the key light's colour and shadows toward the sky's
// ambient colour (warm lights and violet shadows at sunset, pale blue and deep navy at night).
import { clamp } from './util.js'

export const hexToRgb = hex => {
  let s = String(hex || '#000').replace('#', '')
  if (s.length === 3) s = [...s].map(c => c + c).join('')
  const n = parseInt(s.slice(0, 6), 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export const rgbToHex = ([r, g, b]) =>
  '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')
export const isHex = s => /^#[0-9a-f]{6}$/i.test(String(s))
export const normHex = s => {
  let t = String(s || '').trim().toLowerCase()
  if (!t.startsWith('#')) t = '#' + t
  if (/^#[0-9a-f]{3}$/.test(t)) t = '#' + [...t.slice(1)].map(c => c + c).join('')
  return isHex(t) ? t : null
}

const toLin = v => {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const toSrgb = v => {
  const c = clamp(v, 0, 1)
  return (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255
}

export function hexToLab(hex) {
  const [R, G, B] = hexToRgb(hex).map(toLin)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}
function labToLin([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}
// Back to hex, pulling chroma in until the colour fits sRGB (keeps lightness and hue).
export function labToHex([L, a, b]) {
  L = clamp(L, 0, 1)
  let k = 1
  let rgb = labToLin([L, a, b])
  for (let i = 0; i < 24 && rgb.some(v => v < -0.0005 || v > 1.0005); i++) {
    k *= 0.88
    rgb = labToLin([L, a * k, b * k])
  }
  return rgbToHex(rgb.map(toSrgb))
}

export const mixHex = (x, y, t) => {
  const A = hexToLab(x)
  const B = hexToLab(y)
  return labToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t])
}
export const lighten = (hex, dL, dC = 1, hueTurn = 0) => {
  const [L, a, b] = hexToLab(hex)
  const c = Math.cos(hueTurn)
  const s = Math.sin(hueTurn)
  return labToHex([L + dL, (a * c - b * s) * dC, (a * s + b * c) * dC])
}
// Turn the hue toward a target hue (degrees in OKLab: 30 red, 85 orange-yellow, 145 green,
// 265 blue, 320 violet) by t of the way, with a lightness step and a chroma factor.
export function hueToward(hex, deg, t, dL = 0, cMul = 1) {
  const [L, a, b] = hexToLab(hex)
  const C = Math.hypot(a, b)
  const h = Math.atan2(b, a)
  const g = (deg * Math.PI) / 180
  let d = g - h
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  const h2 = h + d * t
  return labToHex([L + dL, C * cMul * Math.cos(h2), C * cMul * Math.sin(h2)])
}
export const luma = hex => {
  const [r, g, b] = hexToRgb(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}
export const labDist = (x, y) => {
  const A = hexToLab(x)
  const B = hexToLab(y)
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2])
}

/* ---------- The light of each time of day ---------- */

// Every moment has a kind of light. The usual ids say it; any other id goes by its start hour.
export const KINDS = ['dawn', 'morning', 'day', 'golden', 'sunset', 'dusk', 'night']
export const KIND_NAMES = {
  dawn: 'Dawn pink',
  morning: 'Morning',
  day: 'Day',
  golden: 'Golden hour',
  sunset: 'Sunset warm',
  dusk: 'Dusk',
  night: 'Night blue',
}
const ID_KIND = {
  predawn: 'dawn', dawn: 'dawn', sunrise: 'dawn', morning: 'morning', a: 'night', b: 'morning',
  day: 'day', noon: 'day', midday: 'day', afternoon: 'day', golden: 'golden', 'golden-hour': 'golden',
  sunset: 'sunset', evening: 'sunset', dusk: 'dusk', twilight: 'dusk', night: 'night', midnight: 'night',
  'all-day': 'day',
}
export function kindOf(moment) {
  if (!moment) return 'day'
  if (moment.light && KINDS.includes(moment.light)) return moment.light
  if (ID_KIND[moment.id]) return ID_KIND[moment.id]
  const name = String(moment.name || '').toLowerCase().replace(/\s+/g, '-')
  if (ID_KIND[name]) return ID_KIND[name]
  const h = Number(moment.start) || 0
  if (h >= 4.5 && h < 7) return 'dawn'
  if (h >= 7 && h < 10) return 'morning'
  if (h >= 10 && h < 16) return 'day'
  if (h >= 16 && h < 18) return 'golden'
  if (h >= 18 && h < 20) return 'sunset'
  if (h >= 20 && h < 21.5) return 'dusk'
  return 'night'
}

// Relight presets, in OKLab. L' = o + k L; chroma times c; then a tint added to (a, b) that
// moves from the shadow tint (dark values) to the light tint (light values).
const RELIGHT = {
  day: { o: 0, k: 1, c: 1, lit: [0, 0], shade: [0, 0] },
  morning: { o: 0.015, k: 0.965, c: 0.96, lit: [0.008, 0.024], shade: [0.0, -0.022] },
  dawn: { o: 0.05, k: 0.82, c: 0.78, lit: [0.05, 0.032], shade: [0.03, -0.05] },
  golden: { o: 0.02, k: 0.93, c: 0.95, lit: [0.022, 0.068], shade: [0.012, -0.036] },
  sunset: { o: 0.05, k: 0.74, c: 0.8, lit: [0.048, 0.078], shade: [0.048, -0.06] },
  dusk: { o: 0.06, k: 0.56, c: 0.66, lit: [0.04, -0.012], shade: [0.022, -0.068] },
  night: { o: 0.085, k: 0.4, c: 0.42, lit: [-0.012, -0.055], shade: [0.004, -0.068] },
}
const tintAt = (P, L) => {
  const t = clamp((L - 0.18) / 0.62, 0, 1)
  return [P.shade[0] + (P.lit[0] - P.shade[0]) * t, P.shade[1] + (P.lit[1] - P.shade[1]) * t]
}
// From day light to a kind.
function lightLab([L, a, b], kind) {
  const P = RELIGHT[kind] || RELIGHT.day
  const L2 = P.o + P.k * L
  const [ta, tb] = tintAt(P, L2)
  return [L2, a * P.c + ta, b * P.c + tb]
}
// From a kind back to day light (the inverse of lightLab).
function unlightLab([L2, a2, b2], kind) {
  const P = RELIGHT[kind] || RELIGHT.day
  const L = (L2 - P.o) / P.k
  const [ta, tb] = tintAt(P, L2)
  return [L, (a2 - ta) / P.c, (b2 - tb) / P.c]
}
export function relight(hex, fromKind, toKind) {
  if (fromKind === toKind) return hex
  const day = fromKind === 'day' ? hexToLab(hex) : unlightLab(hexToLab(hex), fromKind)
  return labToHex(toKind === 'day' ? day : lightLab(day, toKind))
}

/* ---------- Skies, suns and the ambient colour of each kind ---------- */

// Sky colours from the top of the frame to the horizon.
const SKY = {
  dawn: ['#262c5c', '#4b4683', '#94669a', '#dc8e98', '#f6c2a4'],
  morning: ['#3a63b4', '#5a8bd3', '#88b5e5', '#bfdbef', '#f1e6d4'],
  day: ['#2d60c6', '#4884de', '#71a8ec', '#a3cdf5', '#d6eefa'],
  golden: ['#3a5aa6', '#6487c4', '#a3b2cb', '#e6c597', '#f8dd9c'],
  sunset: ['#1d2257', '#463377', '#9c4c7c', '#e2735e', '#f8b766'],
  dusk: ['#11163a', '#262759', '#523d76', '#93587c', '#d08679'],
  night: ['#04071a', '#081029', '#0f1a3d', '#182752', '#263868'],
}
const STOPS = [0, 0.32, 0.62, 0.84, 1]

export function skyStops(kind, style = 'clear') {
  let list = SKY[kind] || SKY.day
  if (style === 'warm') list = list.map(c => lighten(c, 0.0, 1.08, 0.22))
  else if (style === 'pale') list = list.map(c => lighten(c, kind === 'night' ? 0.02 : 0.06, 0.62, 0))
  else if (style === 'storm') list = list.map((c, i) => mixHex(lighten(c, -0.06, 0.35, -0.2), '#5d6670', kind === 'night' ? 0.1 : 0.22 + i * 0.03))
  return list
}
// The sky's colour at t (0 the top of the frame, 1 the horizon).
export function skyAt(kind, t, style) {
  const list = skyStops(kind, style)
  t = clamp(t, 0, 1)
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i]) return mixHex(list[i - 1], list[i], (t - STOPS[i - 1]) / (STOPS[i] - STOPS[i - 1]))
  }
  return list[list.length - 1]
}
export const horizonOf = (kind, style) => skyStops(kind, style)[4]

// The disc and its glow, for each kind. At night it is the moon.
export const SUN = {
  dawn: { disc: '#fff1d8', core: '#fffaf0', glow: '#ffc4a4', glow2: '#e99a9a' },
  morning: { disc: '#fffbea', core: '#ffffff', glow: '#ffeab8', glow2: '#d8e6f2' },
  day: { disc: '#fffbea', core: '#ffffff', glow: '#fff1c0', glow2: '#cfe6f8' },
  golden: { disc: '#fff1bf', core: '#fffbe6', glow: '#ffd27c', glow2: '#efc590' },
  sunset: { disc: '#ffe5a4', core: '#fff6d6', glow: '#ff9d58', glow2: '#ec7c62' },
  dusk: { disc: '#ffb57e', core: '#ffd9a8', glow: '#e46f69', glow2: '#a85c7c' },
  night: { disc: '#e8edfb', core: '#f7f9ff', glow: '#4d5e98', glow2: '#2a3a6c', shade: '#b4bfe2', crater: '#c8d1ef' },
}

// Where the light comes from at each kind of moment, when no sun layer says otherwise:
// as a fraction of the width and rows above the horizon.
export const LIGHT_DEFAULT = {
  dawn: { fx: 0.16, up: 10 },
  morning: { fx: 0.26, up: 62 },
  day: { fx: 0.3, up: 100 },
  golden: { fx: 0.7, up: 42 },
  sunset: { fx: 0.8, up: 14 },
  dusk: { fx: 0.88, up: -6 },
  night: { fx: 0.76, up: 96 },
}
