// Colour helpers for the looks: hex, sRGB and OKLab, plus the brightness the engine sorts by.
// Plain ES module with no dependencies (browser and Node).

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v)

// '#rgb' or '#rrggbb' -> [r, g, b] (0..255). Anything else is black.
export function hexToRgb(hex) {
  let h = String(hex ?? '').replace(/[!#]/g, '').trim()
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = parseInt(h, 16)
  if (!Number.isFinite(n) || h.length !== 6) return [0, 0, 0]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r, g, b) {
  const c = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')
  return '#' + c(r) + c(g) + c(b)
}

export const isHex = h => typeof h === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h.trim())

// Rec. 709 brightness on the encoded values (0..255), as the engine's encoder orders colours.
export const lum709 = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b
// Rec. 601 brightness, as Nightgrain and Afterglyph pick by it.
export const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b

// sRGB (0..255 integer) -> linear light.
export const LIN = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const s = i / 255
  LIN[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
// sRGB as a float 0..1 -> linear.
export function toLinear(s) {
  if (s <= 0) return 0
  if (s >= 1) return 1
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
export function toSrgb(v) {
  if (v <= 0) return 0
  if (v >= 1) return 1
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
}

// Linear RGB -> OKLab, into out[o..o+2].
export function linToLab(r, g, b, out, o = 0) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  out[o] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  out[o + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  out[o + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return out
}

// sRGB 0..255 -> OKLab [L, a, b].
export function rgbToLab(r, g, b, out = [0, 0, 0], o = 0) {
  return linToLab(LIN[clamp(Math.round(r), 0, 255)], LIN[clamp(Math.round(g), 0, 255)], LIN[clamp(Math.round(b), 0, 255)], out, o)
}

// sRGB floats 0..1 (may be out of range) -> OKLab.
export function srgbFloatToLab(r, g, b, out = [0, 0, 0], o = 0) {
  return linToLab(toLinear(r), toLinear(g), toLinear(b), out, o)
}

// OKLab -> sRGB 0..255 [r, g, b] (clamped).
export function labToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  return [Math.round(toSrgb(r) * 255), Math.round(toSrgb(g) * 255), Math.round(toSrgb(bb) * 255)]
}

export const hexToLab = hex => {
  const [r, g, b] = hexToRgb(hex)
  return rgbToLab(r, g, b)
}

export const labToHex = (L, a, b) => {
  const [r, g, bb] = labToRgb(L, a, b)
  return rgbToHex(r, g, bb)
}

// The mean channel difference the encoder uses to decide whether a hairline would show (0..255).
export function apartRgb(x, y) {
  return (Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2])) / 3
}

// Integer hash -> [0, 1), stable for (x, y, s). From Nightgrain (util.js).
export function hash(x, y, s) {
  let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  n ^= n >>> 16
  return (n >>> 0) / 4294967296
}

// Seeded random numbers. From Nightgrain (util.js).
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
