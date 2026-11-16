// Browser helpers for the looks: reading an uploaded file into an asset, getting an asset
// frame's pixels back, and quick canvas previews of a look. They need the DOM (canvas,
// createImageBitmap, and ImageDecoder where the browser has it); the core in index.js does not.
//
// decodeAsset(file | Blob, { name }) -> Promise<{ name, w, h, frames: [{ png, delay }] }>
//   The asset as project.json keeps it (editor/PROJECT.md, "Assets"): `png` is a base64 PNG
//   (no data: prefix), `delay` in ms. A still keeps one frame, its longer side at most 960 px.
//   An animated GIF (read by gif.js, Nightgrain's decoder) or an animated WebP or PNG (read by
//   ImageDecoder where the browser has one; otherwise only its first frame) keeps at most 48
//   frames at most 480 px: longer animations keep evenly spaced frames, each one's delay the
//   sum of the delays it stands for, so the timing holds.
// rgbaFromFrame(frame) -> Promise<{ w, h, data: Uint8ClampedArray }>
//   An asset frame's pixels, for placeAsset and applyLook.
// previewLook(rgba, look, scale = 1, { canvas, palette, colors, bg }) -> canvas
//   The look applied and drawn, each cell scale x scale; the canvas also carries the result as
//   canvas.look = { cells, colors, w, h }. Draw it with image-rendering: pixelated.

import { decodeGif, gifFrameCount } from './gif.js'
import { applyLook, renderCells } from './index.js'

export const MAX_STILL = 960
export const MAX_ANIMATED = 480
export const MAX_FRAMES = 48

const STILL_DELAY = 100

export async function decodeAsset(file, opts = {}) {
  const name = opts.name ?? file.name ?? 'asset'
  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = sniff(bytes)
  if (kind === 'gif') {
    const n = gifFrameCount(bytes)
    if (n > 1) return { name, ...gifFrames(bytes, n) }
  }
  if ((kind === 'webp' || kind === 'png') && typeof ImageDecoder !== 'undefined') {
    try {
      const anim = await decoderFrames(bytes, 'image/' + kind)
      if (anim) return { name, ...anim }
    } catch {
      // Fall back to the first frame below.
    }
  }
  const type = file.type || (kind ? 'image/' + kind : '')
  const bmp = await createImageBitmap(type && !file.type ? new Blob([bytes], { type }) : file)
  try {
    const { w, h } = fitSize(bmp.width, bmp.height, MAX_STILL)
    const c = canvasOf(w, h)
    drawScaled(c, bmp)
    return { name, w, h, frames: [{ png: pngOf(c), delay: STILL_DELAY }] }
  } finally {
    bmp.close?.()
  }
}

export async function rgbaFromFrame(frame) {
  const bin = atob(frame.png)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  try {
    const c = canvasOf(bmp.width, bmp.height)
    const g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(bmp, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height)
    return { w: d.width, h: d.height, data: d.data }
  } finally {
    bmp.close?.()
  }
}

export function previewLook(rgba, look, scale = 1, opts = {}) {
  const r = applyLook(rgba, look, opts)
  const img = renderCells(r.cells, r.colors, r.w, r.h, scale, opts.bg ?? null)
  const c = opts.canvas ?? document.createElement('canvas')
  c.width = img.w
  c.height = img.h
  c.getContext('2d').putImageData(new ImageData(img.data, img.w, img.h), 0, 0)
  c.look = r
  return c
}

/* ---------- Inside ---------- */

function sniff(b) {
  const s = (i, n) => String.fromCharCode(...b.subarray(i, i + n))
  if (b.length >= 6 && s(0, 4) === 'GIF8') return 'gif'
  if (b.length >= 12 && s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'webp'
  if (b.length >= 8 && b[0] === 0x89 && s(1, 3) === 'PNG') return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  return null
}

const fitSize = (w, h, max) => {
  const s = Math.min(1, max / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}

function canvasOf(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function drawScaled(c, src) {
  const g = c.getContext('2d')
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.clearRect(0, 0, c.width, c.height)
  g.drawImage(src, 0, 0, c.width, c.height)
}

const pngOf = c => c.toDataURL('image/png').slice('data:image/png;base64,'.length)

// Which of n frames to keep, and the group of frames each kept one stands for: frame i belongs
// to group floor(i * kept / n), and each group keeps its first frame.
function groups(n, max = MAX_FRAMES) {
  const k = Math.min(n, max)
  const of = new Int32Array(n)
  for (let i = 0; i < n; i++) of[i] = Math.floor((i * k) / n)
  return { k, of }
}

function gifFrames(bytes, n) {
  const { of } = groups(n)
  const out = []
  let size = null
  let src = null
  decodeGif(bytes, {
    onFrame(screen, delay, i) {
      if (!size) {
        size = fitSize(screen.w, screen.h, MAX_ANIMATED)
        src = canvasOf(screen.w, screen.h)
      }
      const gi = of[i]
      if (out.length === gi) {
        src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(screen.data), screen.w, screen.h), 0, 0)
        const c = canvasOf(size.w, size.h)
        drawScaled(c, src)
        out.push({ png: pngOf(c), delay: 0 })
      }
      out[gi].delay += delay
    },
  })
  return { w: size.w, h: size.h, frames: out }
}

// Animated WebP or PNG through ImageDecoder; null when the image has one frame.
async function decoderFrames(bytes, type) {
  const dec = new ImageDecoder({ data: bytes, type })
  try {
    await dec.tracks.ready
    const track = dec.tracks.selectedTrack
    const n = track?.frameCount ?? 1
    if (!track || !track.animated || n < 2) return null
    const { of } = groups(n)
    const out = []
    let size = null
    for (let i = 0; i < n; i++) {
      const { image } = await dec.decode({ frameIndex: i })
      try {
        const delay = image.duration ? image.duration / 1000 : 100
        const gi = of[i]
        if (out.length === gi) {
          size ??= fitSize(image.displayWidth, image.displayHeight, MAX_ANIMATED)
          const c = canvasOf(size.w, size.h)
          drawScaled(c, image)
          out.push({ png: pngOf(c), delay: 0 })
        }
        out[gi].delay += delay
      } finally {
        image.close()
      }
    }
    for (const f of out) f.delay = Math.round(f.delay)
    return { w: size.w, h: size.h, frames: out }
  } finally {
    dec.close()
  }
}
