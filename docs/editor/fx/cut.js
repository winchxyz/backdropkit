// Background removal for the looks, after Afterglyph (glyph-bloom/index.html, the owner's MIT
// app): analyzeSource's auto choice (transparency, a plain border colour, or else the subject
// found by findSubject's flood through smoothly changing colour), the soft colour key with its
// tolerance ramp, morph (grow or shrink the edge) and dropSpecks. Here it works on the pixels
// directly, with no canvas, and adds `connected`: only background that touches the outside is
// removed, so a white eye inside a sprite on white stays.

import { hexToRgb, clamp } from './color.js'

export const CUT_MODES = ['none', 'auto', 'color', 'dark', 'light']

export const DEFAULT_CUT = { mode: 'none', color: '#ffffff', tol: 0.16, soft: 0.5, grow: 0, specks: 0, connected: true }

// The box around the opaque pixels (alpha >= 128), or null.
function opaqueBox(d, w, h) {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] < 128) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}

// The pixels of a box's border ring (indices).
function ringOf(box, w) {
  const out = []
  for (let x = box.x0; x <= box.x1; x++) out.push(box.y0 * w + x, box.y1 * w + x)
  for (let y = box.y0 + 1; y < box.y1; y++) out.push(y * w + box.x0, y * w + box.x1)
  return out
}

// What "auto" means for this picture (Afterglyph's analyzeSource, on the opaque box): its own
// transparency when it has some, a plain border colour when the border is one colour, or else
// the subject found by a flood from the border.
export function analyseCut(rgba, tol = 0.16) {
  const { w, h, data: d } = rgba
  const box = opaqueBox(d, w, h)
  if (!box) return { mode: 'alpha' }
  let clear = 0
  let total = 0
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      total++
      if (d[(y * w + x) * 4 + 3] < 245) clear++
    }
  }
  if (clear > total * 0.02) return { mode: 'alpha', box }
  const ring = ringOf(box, w)
  let sr = 0
  let sg = 0
  let sb = 0
  for (const i of ring) {
    sr += d[4 * i]
    sg += d[4 * i + 1]
    sb += d[4 * i + 2]
  }
  sr /= ring.length
  sg /= ring.length
  sb /= ring.length
  let dev = 0
  for (const i of ring) dev += Math.abs(d[4 * i] - sr) + Math.abs(d[4 * i + 1] - sg) + Math.abs(d[4 * i + 2] - sb)
  dev /= ring.length * 3
  if (dev < 14) return { mode: 'key', key: [sr, sg, sb], box }
  const subject = findSubject(rgba, box, tol)
  return subject ? { mode: 'mask', mask: subject, box } : { mode: 'none', box }
}

// Afterglyph's findSubject: everything reachable from the border through smoothly changing colour
// near the commonest border colour is background (so gradients count); what is left, without
// pieces under a tenth of the biggest, is the subject. Returns a Uint8Array mask or null when
// the result is implausible (under 3% or over 90% of the box).
function findSubject(rgba, box, tol) {
  const { w, data: d } = rgba
  const bw = box.x1 - box.x0 + 1
  const bh = box.y1 - box.y0 + 1
  const n = bw * bh
  const at = i => ((box.y0 + ((i / bw) | 0)) * w + box.x0 + (i % bw)) * 4
  const edge = []
  for (let x = 0; x < bw; x++) edge.push(x, (bh - 1) * bw + x)
  for (let y = 1; y < bh - 1; y++) edge.push(y * bw, y * bw + bw - 1)
  const bins = new Map()
  let top = null
  for (const i of edge) {
    const o = at(i)
    const k = ((d[o] >> 5) << 6) | ((d[o + 1] >> 5) << 3) | (d[o + 2] >> 5)
    let b = bins.get(k)
    if (!b) bins.set(k, (b = [0, 0, 0, 0]))
    b[0]++
    b[1] += d[o]
    b[2] += d[o + 1]
    b[3] += d[o + 2]
    if (!top || b[0] > top[0]) top = b
  }
  const K = [top[1] / top[0], top[2] / top[0], top[3] / top[0]]
  const far = i => {
    const o = at(i)
    return Math.hypot(d[o] - K[0], d[o + 1] - K[1], d[o + 2] - K[2]) / 441.7
  }
  const step = (i, j) => {
    const a = at(i)
    const b = at(j)
    return Math.hypot(d[a] - d[b], d[a + 1] - d[b + 1], d[a + 2] - d[b + 2]) / 441.7
  }
  const bg = new Uint8Array(n)
  const queue = new Int32Array(n)
  const sens = clamp(tol / 0.16, 0.4, 2.4)
  let qh = 0
  let qt = 0
  for (const i of edge) {
    if (!bg[i] && far(i) < 0.2 * sens) {
      bg[i] = 1
      queue[qt++] = i
    }
  }
  while (qh < qt) {
    const i = queue[qh++]
    const x = i % bw
    for (const j of [x > 0 ? i - 1 : -1, x < bw - 1 ? i + 1 : -1, i - bw, i + bw]) {
      if (j >= 0 && j < n && !bg[j] && step(i, j) < 0.05 * sens && far(j) < Math.min(0.9, 0.38 * sens)) {
        bg[j] = 1
        queue[qt++] = j
      }
    }
  }
  const lab = new Int32Array(n)
  const sizes = [0]
  let big = 0
  for (let s0 = 0; s0 < n; s0++) {
    if (bg[s0] || lab[s0]) continue
    const id = sizes.length
    let cnt = 0
    qh = qt = 0
    queue[qt++] = s0
    lab[s0] = id
    while (qh < qt) {
      const i = queue[qh++]
      const x = i % bw
      cnt++
      for (const j of [x > 0 ? i - 1 : -1, x < bw - 1 ? i + 1 : -1, i - bw, i + bw]) {
        if (j >= 0 && j < n && !bg[j] && !lab[j]) {
          lab[j] = id
          queue[qt++] = j
        }
      }
    }
    sizes.push(cnt)
    if (cnt > big) big = cnt
  }
  const mask = new Uint8Array(rgba.w * rgba.h)
  let area = 0
  for (let i = 0; i < n; i++) {
    if (lab[i] && sizes[lab[i]] >= big * 0.1) {
      mask[(box.y0 + ((i / bw) | 0)) * w + box.x0 + (i % bw)] = 1
      area++
    }
  }
  if (area < n * 0.03 || area > n * 0.9) return null
  return mask
}

// Max (grow) or min (shrink) filter of radius |r| on a float mask, separable (Afterglyph's morph).
function morph(m, w, h, r) {
  const up = r > 0
  const k = Math.abs(r)
  const t = new Float32Array(m.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = m[y * w + x]
      for (let j = Math.max(0, x - k); j <= Math.min(w - 1, x + k); j++) {
        const q = m[y * w + j]
        if (up ? q > v : q < v) v = q
      }
      t[y * w + x] = v
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = t[y * w + x]
      for (let j = Math.max(0, y - k); j <= Math.min(h - 1, y + k); j++) {
        const q = t[j * w + x]
        if (up ? q > v : q < v) v = q
      }
      m[y * w + x] = v
    }
  }
}

// Pieces (8-connected) of the kept part under `min` pixels are dropped (Afterglyph's
// dropSpecks); enclosed holes under `min` pixels are filled back where the picture was opaque.
function dropSpecks(m, w, h, min, alpha) {
  const n = w * h
  const lab = new Int32Array(n)
  const q = new Int32Array(n)
  let id = 0
  const flood = (s0, on) => {
    let qh = 0
    let qt = 0
    let touches = false
    q[qt++] = s0
    lab[s0] = ++id
    while (qh < qt) {
      const c = q[qh++]
      const cx = c % w
      const cy = (c / w) | 0
      if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) touches = true
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          if (!on && dx && dy) continue // holes are 4-connected
          const x = cx + dx
          const y = cy + dy
          if (x < 0 || y < 0 || x >= w || y >= h) continue
          const o = y * w + x
          if (lab[o] || (m[o] >= 0.5) !== on) continue
          lab[o] = id
          q[qt++] = o
        }
      }
    }
    return { qt, touches }
  }
  for (let s0 = 0; s0 < n; s0++) {
    if (lab[s0] || m[s0] < 0.5) continue
    const { qt } = flood(s0, true)
    if (qt < min) for (let i = 0; i < qt; i++) m[q[i]] = 0
  }
  for (let s0 = 0; s0 < n; s0++) {
    if (lab[s0] || m[s0] >= 0.5) continue
    const { qt, touches } = flood(s0, false)
    if (!touches && qt < min) for (let i = 0; i < qt; i++) if (alpha[q[i]] >= 128) m[q[i]] = 1
  }
}

/**
 * removeBackground(rgba, opts) -> a new rgba with the background made transparent.
 *   rgba: { w, h, data: Uint8ClampedArray }
 *   opts: { mode: 'none' | 'auto' | 'color' | 'dark' | 'light', color: '#rrggbb' (for 'color'),
 *           tol 0.02-0.6 (how far from the key colour still counts as background, 0.16),
 *           soft 0-1 (how wide the fade at the tolerance is, 0.5),
 *           grow -6..6 (pixels the subject's edge grows, or shrinks when negative, 0),
 *           specks 0-300 (pieces and enclosed holes smaller than this many pixels go, 0),
 *           connected (only background that touches the outside goes, true) }
 * The colour channels are kept; only alpha changes.
 */
export function removeBackground(rgba, opts = {}) {
  const o = { ...DEFAULT_CUT, ...opts }
  const { w, h, data } = rgba
  const n = w * h
  const out = new Uint8ClampedArray(data)
  const mode = CUT_MODES.includes(o.mode) ? o.mode : 'none'
  const grow = Math.round(clamp(+o.grow || 0, -6, 6))
  const specks = Math.round(clamp(+o.specks || 0, 0, 5000))
  if (mode === 'none' && !grow && !specks) return { w, h, data: out }
  const tol = clamp(+o.tol || 0.16, 0.01, 0.9)
  const soft = clamp(o.soft ?? 0.5)
  const alpha = new Uint8Array(n)
  for (let i = 0; i < n; i++) alpha[i] = data[4 * i + 3]
  // m: how much of each pixel stays (0..1).
  const m = new Float32Array(n)
  for (let i = 0; i < n; i++) m[i] = alpha[i] / 255
  let plan = { mode: 'alpha' }
  if (mode === 'auto') plan = analyseCut(rgba, tol)
  else if (mode === 'color') plan = { mode: 'key', key: hexToRgb(o.color) }
  else if (mode === 'dark') plan = { mode: 'key', key: [0, 0, 0] }
  else if (mode === 'light') plan = { mode: 'key', key: [255, 255, 255] }
  if (plan.mode === 'key') {
    const [kr, kg, kb] = plan.key
    const t0 = tol * (1 - 0.9 * soft)
    const t1 = tol * (1 + 0.9 * soft)
    const keyed = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const dr = data[4 * i] - kr
      const dg = data[4 * i + 1] - kg
      const db = data[4 * i + 2] - kb
      const dist = Math.sqrt(dr * dr + dg * dg + db * db) / 441.7
      keyed[i] = dist <= t0 ? 0 : dist >= t1 ? 1 : (dist - t0) / (t1 - t0)
    }
    if (o.connected !== false) {
      // Only keyed pixels reachable from the outside (the frame edge, or any transparent pixel)
      // through other keyed pixels go.
      const reach = new Uint8Array(n)
      const q = new Int32Array(n)
      let qh = 0
      let qt = 0
      const push = i => {
        if (reach[i] || keyed[i] >= 0.5) return
        reach[i] = 1
        q[qt++] = i
      }
      for (let i = 0; i < n; i++) {
        const x = i % w
        const y = (i / w) | 0
        const outside = x === 0 || y === 0 || x === w - 1 || y === h - 1
        if (alpha[i] < 128) {
          // Neighbours of transparent pixels count as touching the outside.
          if (x > 0) push(i - 1)
          if (x < w - 1) push(i + 1)
          if (y > 0) push(i - w)
          if (y < h - 1) push(i + w)
        } else if (outside) push(i)
      }
      while (qh < qt) {
        const i = q[qh++]
        const x = i % w
        if (x > 0) push(i - 1)
        if (x < w - 1) push(i + 1)
        if (i >= w) push(i - w)
        if (i < n - w) push(i + w)
      }
      for (let i = 0; i < n; i++) {
        // The soft fade at the edge of reached areas stays; unreached keyed pixels stay whole.
        if (reach[i]) m[i] *= keyed[i]
        else if (keyed[i] < 1) {
          const x = i % w
          const near = (x > 0 && reach[i - 1]) || (x < w - 1 && reach[i + 1]) || (i >= w && reach[i - w]) || (i < n - w && reach[i + w])
          if (near) m[i] *= Math.max(keyed[i], 0.5)
        }
      }
    } else for (let i = 0; i < n; i++) m[i] *= keyed[i]
    // 'auto' keyed a border colour that is the whole subject (a sprite of one plain colour):
    // nothing plausible was found, so the art stays as it is.
    if (mode === 'auto') {
      let before = 0
      let kept = 0
      for (let i = 0; i < n; i++) {
        if (alpha[i] < 128) continue
        before++
        if (m[i] >= 0.5) kept++
      }
      if (kept < before * 0.03) for (let i = 0; i < n; i++) m[i] = alpha[i] / 255
    }
  } else if (plan.mode === 'mask') {
    for (let i = 0; i < n; i++) if (!plan.mask[i]) m[i] = 0
  }
  if (grow) morph(m, w, h, grow)
  if (specks) dropSpecks(m, w, h, specks, alpha)
  for (let i = 0; i < n; i++) out[4 * i + 3] = Math.min(alpha[i], Math.round(m[i] * 255))
  // Growing may bring back pixels that were transparent in the source: they keep their colour
  // channels, so they come back as whatever colour they held (usually the background's).
  if (grow > 0) for (let i = 0; i < n; i++) out[4 * i + 3] = Math.round(clamp(m[i]) * 255)
  return { w, h, data: out }
}
