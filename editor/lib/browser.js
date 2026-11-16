// The exporter's helpers that need a browser (a DOM with <img> and <canvas>): the look of a
// moment, the archive's preview, and pictures (cells) from an SVG scene or from an image.
// Everything else is in export.js, which runs anywhere.
//
// All of them are async (an <img> has to load first) and return plain data.
import { STILL_SIZE, glassOf, statsOf, stillOf } from './look.js'
import { mergeMoments } from './export.js'
import { heroOf } from './archive.js'

export const W = 320
export const H = 200
export const N = W * H

// An SVG drawn into a fresh canvas of w x h, on `background` (null: transparent).
export async function canvasOf(svg, w, h, background = '#000') {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = doc.documentElement
  if (root.localName !== 'svg') throw new Error('This is not an SVG scene.')
  root.setAttribute('width', String(w))
  root.setAttribute('height', String(h))
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.decoding = 'sync'
    img.src = url
    await img.decode()
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const x = c.getContext('2d', { willReadFrequently: true })
    if (background) {
      x.fillStyle = background
      x.fillRect(0, 0, w, h)
    }
    x.drawImage(img, 0, 0, w, h)
    return c
  } finally {
    URL.revokeObjectURL(url)
  }
}

// The scene with every animation off: each part where it rests.
function restOf(svg) {
  const rest = '*{animation:none!important}'
  return svg.includes('</style>') ? svg.replace('</style>', rest + '</style>') : svg.replace(/<svg\b[^>]*>/, m => m + '<style>' + rest + '</style>')
}

// The tone of the app's panels and the frosted glass over a moment's scene: { tone, tint,
// opacity }, measured as engine/pack.mjs measures the site's themes (a 960 x 600 still with
// the motion held at its start, look.js).
export async function measureLook(svg) {
  const c = await canvasOf(stillOf(svg), STILL_SIZE.width, STILL_SIZE.height)
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  return glassOf(statsOf(d, c.width, c.height))
}

const pngOf = canvas =>
  new Promise((ok, fail) =>
    canvas.toBlob(async b => {
      if (!b) return fail(new Error('The preview could not be made.'))
      ok(new Uint8Array(await b.arrayBuffer()))
    }, 'image/png'),
  )

// The archive's preview.png (960 x 600, motion held at its start), as bytes. Either
// previewPng(svg), or previewPng(project, scenes, looks), which takes the theme's hero moment
// (day first, as the site's archives do).
export async function previewPng(a, scenes) {
  let svg = a
  if (typeof a !== 'string') {
    const moments = (a?.moments ?? []).map(m => ({ id: m.id, name: m.name }))
    const hero = heroOf(moments)
    svg = (scenes ?? []).find(s => s.id === hero?.id)?.svg ?? scenes?.[0]?.svg
    if (!svg) throw new Error('No scene to take the preview from.')
  }
  return pngOf(await canvasOf(stillOf(svg), STILL_SIZE.width, STILL_SIZE.height))
}

const hex2 = v => v.toString(16).padStart(2, '0')

// A scene as cells: drawn at exactly one pixel per cell (320 x 200), every animation off.
// -> { colors: ['#rrggbb', ...], cells: Uint16Array(64000) } where a cell n > 0 is
// colors[n - 1] and 0 is empty (nothing drawn there). Over `maxColors` (1024) distinct
// colours, the rarest are folded into their nearest kept colour (and `exact` is false).
export async function pictureFromSvg(svgText, opts = {}) {
  const max = Math.max(1, Math.min(1024, opts.maxColors ?? 1024))
  const c = await canvasOf(restOf(svgText), W, H, null)
  const d = c.getContext('2d').getImageData(0, 0, W, H).data
  const count = new Map()
  const keys = new Int32Array(N).fill(-1)
  for (let k = 0; k < N; k++) {
    if (d[4 * k + 3] < 128) continue
    const key = (d[4 * k] << 16) | (d[4 * k + 1] << 8) | d[4 * k + 2]
    keys[k] = key
    count.set(key, (count.get(key) ?? 0) + 1)
  }
  const order = [...count.keys()].sort((a, b) => count.get(b) - count.get(a) || a - b)
  const kept = order.slice(0, max)
  const slot = new Map(kept.map((key, i) => [key, i + 1]))
  for (const key of order.slice(max)) {
    let best = 1
    let bd = Infinity
    for (const [i, kk] of kept.entries()) {
      const dr = (key >> 16) - (kk >> 16)
      const dg = ((key >> 8) & 255) - ((kk >> 8) & 255)
      const db = (key & 255) - (kk & 255)
      const e = dr * dr + dg * dg + db * db
      if (e < bd) {
        bd = e
        best = i + 1
      }
    }
    slot.set(key, best)
  }
  const cells = new Uint16Array(N)
  for (let k = 0; k < N; k++) if (keys[k] >= 0) cells[k] = slot.get(keys[k])
  const colors = kept.map(key => '#' + hex2(key >> 16) + hex2((key >> 8) & 255) + hex2(key & 255))
  return { colors, cells, exact: order.length <= max }
}

// Several moments' scenes as one palette: { svgs: { momentId: svgText } } -> { palette:
// [{ id, colors: { momentId: hex } }], byMoment: { momentId: Uint16Array } }, a slot standing
// for the same place in every moment (export.js mergeMoments).
export async function pictureFromSvgs(svgs, opts = {}) {
  const pictures = {}
  for (const [id, svg] of Object.entries(svgs)) pictures[id] = await pictureFromSvg(svg, opts)
  return { ...mergeMoments(pictures), pictures }
}

/* ---------- The visitor's own image ---------- */

// Bayer 8 x 8 thresholds, 0..63.
const BAYER = (() => {
  const m = [[0]]
  let n = 1
  let a = m
  while (n < 8) {
    const b = []
    for (let y = 0; y < 2 * n; y++) {
      b.push([])
      for (let x = 0; x < 2 * n; x++) {
        const q = [0, 2, 3, 1][(y >= n) * 2 + (x >= n)]
        b[y].push(4 * a[y % n][x % n] + q)
      }
    }
    a = b
    n *= 2
  }
  return a
})()

// Median cut on [r, g, b] triples, then a few rounds of k-means.
function palette(px, k) {
  const n = px.length / 3
  let boxes = [Array.from({ length: n }, (_, i) => i)]
  const range = (box, ch) => {
    let lo = 255
    let hi = 0
    for (const i of box) {
      const v = px[3 * i + ch]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    return hi - lo
  }
  while (boxes.length < k) {
    let bi = -1
    let bch = 0
    let br = -1
    boxes.forEach((box, i) => {
      if (box.length < 2) return
      for (let ch = 0; ch < 3; ch++) {
        const r = range(box, ch) * Math.sqrt(box.length)
        if (r > br) {
          br = r
          bi = i
          bch = ch
        }
      }
    })
    if (bi < 0 || br <= 0) break
    const box = boxes[bi].sort((a, b) => px[3 * a + bch] - px[3 * b + bch])
    const mid = box.length >> 1
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid))
  }
  let cs = boxes.map(box => {
    const s = [0, 0, 0]
    for (const i of box) for (let ch = 0; ch < 3; ch++) s[ch] += px[3 * i + ch]
    return s.map(v => v / box.length)
  })
  for (let round = 0; round < 6; round++) {
    const sum = cs.map(() => [0, 0, 0, 0])
    for (let i = 0; i < n; i++) {
      const j = nearest(cs, px[3 * i], px[3 * i + 1], px[3 * i + 2])
      sum[j][0] += px[3 * i]
      sum[j][1] += px[3 * i + 1]
      sum[j][2] += px[3 * i + 2]
      sum[j][3]++
    }
    cs = cs.map((c, j) => (sum[j][3] ? [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]] : c))
  }
  return cs.map(c => c.map(v => Math.round(v)))
}
function nearest(cs, r, g, b) {
  let best = 0
  let bd = Infinity
  for (let j = 0; j < cs.length; j++) {
    const c = cs[j]
    const e = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2
    if (e < bd) {
      bd = e
      best = j
    }
  }
  return best
}

// An image (an ImageBitmap, <img>, <canvas>, Blob or File) as cells: cropped to fill 320 x 200,
// in `colors` colours (8 to 64, by median cut and k-means), with an ordered (Bayer 8 x 8)
// dither of strength `dither` (0 none, 1 full; true is 1). Transparent pixels are empty cells.
// -> { colors: ['#rrggbb', ...], cells: Uint16Array(64000) }.
export async function pictureFromImage(source, opts = {}) {
  const k = Math.max(2, Math.min(64, Math.round(opts.colors ?? 24)))
  const amount = opts.dither === true ? 1 : Math.max(0, Math.min(1, Number(opts.dither) || 0))
  const bmp = source instanceof Blob ? await createImageBitmap(source) : source
  const sw = bmp.naturalWidth ?? bmp.width
  const sh = bmp.naturalHeight ?? bmp.height
  if (!sw || !sh) throw new Error('The image is empty.')
  const scale = Math.max(W / sw, H / sh)
  const dw = sw * scale
  const dh = sh * scale
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const x = c.getContext('2d', { willReadFrequently: true })
  x.imageSmoothingQuality = 'high'
  x.drawImage(bmp, (W - dw) / 2, (H - dh) / 2, dw, dh)
  const d = x.getImageData(0, 0, W, H).data
  const solid = []
  for (let i = 0; i < N; i++) if (d[4 * i + 3] >= 128) solid.push(i)
  const px = new Float64Array(solid.length * 3)
  solid.forEach((i, j) => {
    px[3 * j] = d[4 * i]
    px[3 * j + 1] = d[4 * i + 1]
    px[3 * j + 2] = d[4 * i + 2]
  })
  const cs = solid.length ? palette(px, k) : [[0, 0, 0]]
  // The dither's reach: about the gap between neighbouring palette colours.
  const spread = (amount * 255) / Math.cbrt(cs.length)
  const cells = new Uint16Array(N)
  for (const i of solid) {
    const t = amount ? (BAYER[(i / W) % 8 | 0][i % 8] + 0.5) / 64 - 0.5 : 0
    const o = t * spread
    cells[i] = nearest(cs, d[4 * i] + o, d[4 * i + 1] + o, d[4 * i + 2] + o) + 1
  }
  // Only the colours used, commonest first.
  const used = new Map()
  for (const i of solid) used.set(cells[i], (used.get(cells[i]) ?? 0) + 1)
  const order = [...used.keys()].sort((a, b) => used.get(b) - used.get(a) || a - b)
  const re = new Map(order.map((s, j) => [s, j + 1]))
  for (const i of solid) cells[i] = re.get(cells[i])
  const colors = order.map(s => '#' + cs[s - 1].map(hex2).join(''))
  return { colors, cells }
}
