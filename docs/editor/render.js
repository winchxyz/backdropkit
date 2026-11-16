// Drawing the project: every layer that shows at a moment, bottom first, into 320 x 200
// pixels. Motion can be sampled at a time t (seconds) for the live preview; the real motion
// is the exported scene's, shown by Play.
import { H, N, W, cellsAt, shownAt } from './project.js'
import { hexToRgb } from './color.js'
import { hash2 } from './util.js'

const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1

// Packed colours of every slot at a moment: [0] is clear.
export function paletteAt(doc, mid) {
  const out = new Uint32Array(doc.palette.length + 1)
  const first = doc.moments[0]?.id
  for (let s = 1; s <= doc.palette.length; s++) {
    const c = doc.palette[s - 1].colors
    const hex = c[mid] || c[first] || Object.values(c)[0] || '#000000'
    const [r, g, b] = hexToRgb(hex)
    out[s] = LE ? (255 << 24) | (b << 16) | (g << 8) | r : (r << 24) | (g << 16) | (b << 8) | 255
  }
  return out
}

// Where a moving layer is at time t: { dx, dy, wrap, fade(i) }.
export function motionAt(m, t) {
  if (!m || m.type === 'none' || !t) return null
  switch (m.type) {
    case 'drift': {
      const k = Math.floor(((t / m.period) % 1) * W)
      return { dx: (m.dir === -1 ? -k : k), dy: 0, wrap: true }
    }
    case 'fall':
      return { dx: 0, dy: Math.floor(((t / m.period) % 1) * H), wrap: true }
    case 'sway':
    case 'bob': {
      const ph = (t / m.period) % 1
      const v = Math.round(Math.sin(ph * Math.PI * 2) * m.amount)
      return m.type === 'sway' ? { dx: v, dy: 0, wrap: false } : { dx: 0, dy: v, wrap: false }
    }
    case 'twinkle': {
      const ph = (t / m.period) % 1
      // Four groups take turns to fade down and back.
      const alpha = [0, 1, 2, 3].map(g => {
        const d = Math.abs(((ph * 4 - g + 4) % 4) - 0.5)
        return d < 0.5 ? 0.25 + d * 1.5 : 1
      })
      return { dx: 0, dy: 0, wrap: false, alpha }
    }
  }
  return null
}

// Which frame of an animated layer shows: by its fps at time t, else the still frame.
export function frameAt(l, opts = {}) {
  const n = l.frames && l.frames.length > 1 ? l.frames.length : 1
  if (n === 1) return 0
  if (opts.t) return Math.floor(opts.t * (l.anim?.fps || 10)) % n
  return (opts.frame || 0) % n
}

// Live effects at time t: a palette for the layer (cycle), its opacity (pulse) and a band
// of light (glint).
function liveAt(l, pal, arr, t) {
  let lp = pal
  let alpha = 1
  let glint = null
  for (const e of l.live || []) {
    if (e.type === 'cycle') {
      const used = new Uint8Array(pal.length)
      for (let i = 0; i < N; i++) used[arr[i]] = 1
      const list = []
      for (let s = 1; s < used.length; s++) if (used[s]) list.push(s)
      if (list.length > 1) {
        const k = list.length
        const step = Math.floor((t / e.period) * k) % k
        lp = Uint32Array.from(pal)
        list.forEach((s, j) => (lp[s] = pal[list[(j + step) % k]]))
      }
    } else if (e.type === 'pulse') {
      alpha = e.low + (1 - e.low) * (0.5 + 0.5 * Math.cos((2 * Math.PI * t) / e.period))
    } else if (e.type === 'glint') {
      // A band crosses in 1.2 s, once every period.
      const ph = (t % e.period) / 1.2
      if (ph < 1) glint = { at: -60 + ph * (W + 160), slot: e.slot }
    }
  }
  return { lp, alpha, glint }
}

// Composite into a Uint32Array of W * H (or the given one). opts: { t, frame, only, skip,
// under, override: { id, arr }, overridePx: { id, px } }.
export function composite(doc, mid, out = new Uint32Array(N), opts = {}) {
  out.fill(opts.under ?? 0)
  const base = paletteAt(doc, mid)
  for (const l of doc.layers) {
    if (opts.only && l.id !== opts.only) continue
    if (!opts.only && !shownAt(l, mid)) continue
    if (opts.skip && opts.skip(l)) continue
    if (opts.overridePx && opts.overridePx.id === l.id) {
      const px = opts.overridePx.px
      for (let i = 0; i < N; i++) if (px[i]) out[i] = px[i]
      continue
    }
    const arr = (opts.override && opts.override.id === l.id && opts.override.arr) || cellsAt(l, mid, frameAt(l, opts))
    if (!arr) continue
    const fx = opts.t && l.live?.length ? liveAt(l, base, arr, opts.t) : null
    const pal = fx ? fx.lp : base
    const mo = opts.t ? motionAt(l.motion, opts.t) : null
    if (!mo && !fx) {
      for (let i = 0; i < N; i++) {
        const s = arr[i]
        if (s) out[i] = pal[s]
      }
      continue
    }
    const dx = mo?.dx || 0
    const dy = mo?.dy || 0
    const wrap = !!mo?.wrap
    const tw = mo?.alpha || null
    const alpha = fx ? fx.alpha : 1
    const g = fx?.glint || null
    const gc = g && g.slot ? base[g.slot] : 0
    for (let y = 0; y < H; y++) {
      let sy = y - dy
      if (wrap) sy = ((sy % H) + H) % H
      else if (sy < 0 || sy >= H) continue
      for (let x = 0; x < W; x++) {
        let sx = x - dx
        if (wrap) sx = ((sx % W) + W) % W
        else if (sx < 0 || sx >= W) continue
        const s = arr[sy * W + sx]
        if (!s) continue
        const i = y * W + x
        let c = pal[s]
        if (g) {
          const d = sx + sy * 0.45 - g.at
          if (d >= 0 && d < 7) c = gc || blend(c, 0xffffffff, d < 2 || d > 4 ? 0.35 : 0.6)
        }
        let a = alpha
        if (tw) a *= tw[(hash2(sx, sy, 17) * 4) | 0]
        out[i] = a >= 1 ? c : blend(out[i], c, a)
      }
    }
  }
  return out
}
function blend(under, over, a) {
  if (!under) return 0
  const m = 255
  const ch = (v, s) => ((v >> s) & m)
  const mix = s => Math.round(ch(under, s) * (1 - a) + ch(over, s) * a) << s
  return ((255 << 24) | mix(16) | mix(8) | mix(0)) >>> 0
}

// The mean brightness of the middle of the picture, where the chat sits (as engine/pack.mjs
// measures it): x 25% to 75%, y 12% to 84%. Under 0.5 the panels go dark.
export function middleLuma(px) {
  let sum = 0
  let n = 0
  for (let y = Math.round(H * 0.12); y < Math.round(H * 0.84); y++) {
    for (let x = W / 4; x < (W * 3) / 4; x++) {
      const v = px[y * W + x]
      const r = LE ? v & 255 : (v >>> 24) & 255
      const g = LE ? (v >> 8) & 255 : (v >> 16) & 255
      const b = LE ? (v >> 16) & 255 : (v >> 8) & 255
      sum += (0.299 * r + 0.587 * g + 0.114 * b) / 255
      n++
    }
  }
  return sum / n
}

// A small picture of one layer at a moment, for the layers list.
const thumbBuf = new Uint32Array(N)
const thumbCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : null
export function drawThumb(canvas, doc, layer, mid) {
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!thumbCanvas) return
  composite(doc, mid, thumbBuf, { only: layer.id })
  const img = new ImageData(new Uint8ClampedArray(thumbBuf.buffer.slice(0)), W, H)
  thumbCanvas.getContext('2d').putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(thumbCanvas, 0, 0, canvas.width, canvas.height)
}

// The whole picture at a moment as a canvas (for previews and stills).
export function pictureCanvas(doc, mid, scale = 1) {
  const px = composite(doc, mid, new Uint32Array(N), { under: LE ? 0xff000000 : 0x000000ff })
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer), W, H), 0, 0)
  if (scale === 1) return c
  const big = document.createElement('canvas')
  big.width = W * scale
  big.height = H * scale
  const x = big.getContext('2d')
  x.imageSmoothingEnabled = false
  x.drawImage(c, 0, 0, big.width, big.height)
  return big
}
