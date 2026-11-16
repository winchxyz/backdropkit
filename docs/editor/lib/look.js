// The look of a moment: whether the app's panels go light or dark over its scene, and the tint
// and opacity of the frosted glass. Shared by engine/pack.mjs (the site's 13 archives) and the
// editor (editor/lib/browser.js measureLook), so both measure a scene the same way.
//
// Measured on a still of the scene at 960 x 600 (the app's <img>, motion held at its start):
//   luma: the mean brightness (0 to 1, Rec. 601 on the encoded values) of the middle of the
//         picture, where the chat column sits: x from 25% to 75%, y from 12% (under the title
//         bar) to 84% (above the message box);
//   avg:  the average colour of the whole picture, in linear sRGB.

export const STILL_SIZE = { width: 960, height: 600 }

// The scene with every animation held at its start (as the stills are rendered).
export function stillOf(svg) {
  const pause = '*{animation-play-state:paused!important}'
  return svg.includes('</style>') ? svg.replace('</style>', pause + '</style>') : svg.replace(/<svg\b[^>]*>/, m => m + '<style>' + pause + '</style>')
}

const lin = v => {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

// { luma, avg } from RGBA pixels (a still's ImageData.data, w x h).
export function statsOf(d, w, h) {
  const x0 = Math.round(w * 0.25)
  const x1 = Math.round(w * 0.75)
  const y0 = Math.round(h * 0.12)
  const y1 = Math.round(h * 0.84)
  let r = 0
  let g = 0
  let b = 0
  let luma = 0
  let mid = 0
  for (let y = 0; y < h; y++) {
    for (let xx = 0; xx < w; xx++) {
      const i = (y * w + xx) * 4
      r += lin(d[i])
      g += lin(d[i + 1])
      b += lin(d[i + 2])
      if (xx >= x0 && xx < x1 && y >= y0 && y < y1) {
        luma += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255
        mid++
      }
    }
  }
  const n = w * h
  return { luma: luma / mid, avg: [r / n, g / n, b / n] }
}

// OKLab, from and to linear sRGB.
function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}
function linear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}
const encode = v => {
  const c = Math.min(1, Math.max(0, v))
  return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255)
}
const hex = rgb => '#' + rgb.map(v => encode(v).toString(16).padStart(2, '0')).join('')
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// The tone and the frosted glass of a moment, from its still. Like Sunfield's glass, the tint
// keeps the hue of the scene and stays smoky, never milky: over a light scene a pale tint
// (OKLab lightness about 0.91, the scene's colour cut to under half, at most 0.04), over a
// dark one a deep tint (lightness 0.18 to 0.3, darker for a darker scene, the scene's colour
// a little stronger, at most 0.06). Opacity is 0.5 over a light scene and 0.55 over a dark
// one, 0.6 where the middle of a dark scene is mid-toned (as Sunfield's sunrise glass is).
// Measured on Sunfield's own scenes, this lands within a few steps of its hand-picked glass.
export function glassOf({ luma, avg }) {
  const dark = luma < 0.5
  const [L, a, b] = oklab(avg)
  const chroma = Math.hypot(a, b)
  const hue = Math.atan2(b, a)
  const tL = dark ? clamp(0.17 + 0.2 * L, 0.18, 0.3) : clamp(0.87 + 0.06 * L, 0.88, 0.93)
  let tC = dark ? Math.min(0.06, 1.2 * chroma) : Math.min(0.04, 0.45 * chroma)
  let rgb = linear([tL, tC * Math.cos(hue), tC * Math.sin(hue)])
  while (tC > 1e-4 && rgb.some(v => v < 0 || v > 1)) {
    tC *= 0.9
    rgb = linear([tL, tC * Math.cos(hue), tC * Math.sin(hue)])
  }
  const opacity = dark ? (luma >= 0.38 ? 0.6 : 0.55) : 0.5
  return { tone: dark ? 'dark' : 'light', tint: hex(rgb), opacity }
}
