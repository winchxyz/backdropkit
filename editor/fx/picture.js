// Picture controls for the looks: Nightgrain's tone stage (engine.js render: exposure as a gain,
// warmth as a red/blue tilt, a luminance-preserving hue turn, saturation, contrast), plus two
// steps that make art read as pixel art: auto levels and an edge-keeping smooth that flattens
// texture into areas before the colours are picked (levels 1 and 2: one or two bilateral
// passes; level 3 adds a Kuwahara filter, for posters).

import { clamp, luma } from './color.js'

export const DEFAULT_PICTURE = { on: true, exposure: 0, contrast: 0, saturation: 1, hue: 0, warmth: 0, levels: false, smooth: 0 }

// Percentiles of brightness over the opaque pixels.
export function lumaPercentiles(R, G, B, mask, n, pLo, pHi) {
  const hist = new Uint32Array(256)
  let cnt = 0
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue
    hist[clamp((luma(R[i], G[i], B[i]) * 255) | 0, 0, 255)]++
    cnt++
  }
  if (cnt < 8) return { lo: 0, hi: 1 }
  let acc = 0
  let lo = 0
  for (; lo < 255; lo++) {
    acc += hist[lo]
    if (acc >= cnt * pLo) break
  }
  acc = 0
  let hi = 255
  for (; hi > 0; hi--) {
    acc += hist[hi]
    if (acc >= cnt * (1 - pHi)) break
  }
  return { lo: lo / 255, hi: Math.max(lo + 8, hi + 1) / 255 }
}

/**
 * Adjusts float sRGB planes in place. p: { exposure -2..2 (stops), contrast -1..1,
 * saturation 0..2, hue -180..180 (degrees), warmth -1..1, levels (stretch the 1st..99th
 * brightness percentile to the full range), smooth 0..3 (passes of the edge-keeping smooth) }.
 */
export function adjustPicture(R, G, B, mask, w, h, p) {
  const n = w * h
  if (!p || p.on === false) return
  if (p.levels) {
    const { lo, hi } = lumaPercentiles(R, G, B, mask, n, 0.01, 0.99)
    const k = 1 / Math.max(0.05, hi - lo)
    for (let i = 0; i < n; i++) {
      R[i] = (R[i] - lo) * k
      G[i] = (G[i] - lo) * k
      B[i] = (B[i] - lo) * k
    }
  }
  const exposure = clamp(+p.exposure || 0, -3, 3)
  const warmth = clamp(+p.warmth || 0, -1, 1)
  const hue = clamp(+p.hue || 0, -180, 180)
  const sat = clamp(p.saturation ?? 1, 0, 3)
  const ct = clamp(+p.contrast || 0, -1, 1)
  const gain = Math.pow(2, exposure)
  const gr = gain * (1 + warmth * 0.35)
  const gb = gain * (1 - warmth * 0.35)
  const hr = (hue * Math.PI) / 180
  const c = Math.cos(hr)
  const s = Math.sin(hr)
  const m00 = 0.213 + c * 0.787 - s * 0.213
  const m01 = 0.715 - c * 0.715 - s * 0.715
  const m02 = 0.072 - c * 0.072 + s * 0.928
  const m10 = 0.213 - c * 0.213 + s * 0.143
  const m11 = 0.715 + c * 0.285 + s * 0.14
  const m12 = 0.072 - c * 0.072 - s * 0.283
  const m20 = 0.213 - c * 0.213 - s * 0.787
  const m21 = 0.715 - c * 0.715 + s * 0.715
  const m22 = 0.072 + c * 0.928 + s * 0.072
  // Nightgrain's contrast is strong (1 + 2.5c); a gentler curve suits art that already has tone.
  const con = ct >= 0 ? 1 + ct * 1.5 : 1 + ct * 0.8
  const useHue = hue !== 0
  const plain = gain === 1 && warmth === 0 && !useHue && sat === 1 && con === 1
  if (!plain) {
    for (let i = 0; i < n; i++) {
      let r = R[i] * gr
      let g = G[i] * gain
      let b = B[i] * gb
      if (useHue) {
        const r2 = m00 * r + m01 * g + m02 * b
        const g2 = m10 * r + m11 * g + m12 * b
        b = m20 * r + m21 * g + m22 * b
        r = r2
        g = g2
      }
      if (sat !== 1) {
        const l = 0.299 * r + 0.587 * g + 0.114 * b
        r = l + (r - l) * sat
        g = l + (g - l) * sat
        b = l + (b - l) * sat
      }
      R[i] = clamp((r - 0.5) * con + 0.5)
      G[i] = clamp((g - 0.5) * con + 0.5)
      B[i] = clamp((b - 0.5) * con + 0.5)
    }
  } else {
    for (let i = 0; i < n; i++) {
      R[i] = clamp(R[i])
      G[i] = clamp(G[i])
      B[i] = clamp(B[i])
    }
  }
  smoothPicture(R, G, B, mask, w, h, Math.round(clamp(+p.smooth || 0, 0, 3)))
}

// The smooth levels: 1 flattens grain and soft texture and keeps every edge and thin line
// (a bilateral filter); 2 does so twice, a little stronger; 3 adds a Kuwahara pass on top,
// which turns texture into flat painted areas (posters, cartoons).
export function smoothPicture(R, G, B, mask, w, h, level) {
  if (level >= 1) bilateral(R, G, B, mask, w, h, 2, 1.4, 0.07)
  if (level >= 2) bilateral(R, G, B, mask, w, h, 2, 1.6, 0.1)
  if (level >= 3) kuwahara(R, G, B, mask, w, h, 2)
}

/**
 * Bilateral filter: each opaque pixel becomes the average of its (2r+1)^2 neighbours, weighted
 * by distance (sigma `ss` pixels) and by how alike their colours are (sigma `sr`, sRGB 0..1).
 * Noise and gentle texture flatten; edges and one-pixel lines of strong contrast stay.
 */
export function bilateral(R, G, B, mask, w, h, r = 2, ss = 1.4, sr = 0.07) {
  const n = w * h
  const oR = new Float32Array(n)
  const oG = new Float32Array(n)
  const oB = new Float32Array(n)
  const side = 2 * r + 1
  const sw = new Float32Array(side * side)
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) sw[(dy + r) * side + dx + r] = Math.exp(-(dx * dx + dy * dy) / (2 * ss * ss))
  const LUT = new Float32Array(1024)
  const k2 = 1 / (2 * sr * sr)
  // Range weights by squared colour distance (0..3), tabulated.
  for (let i = 0; i < 1024; i++) LUT[i] = Math.exp(-((i / 1023) * 3) * k2)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!mask[i]) {
        oR[i] = R[i]
        oG[i] = G[i]
        oB[i] = B[i]
        continue
      }
      const r0 = R[i]
      const g0 = G[i]
      const b0 = B[i]
      let ws = 0
      let ar = 0
      let ag = 0
      let ab = 0
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const j = yy * w + xx
          if (!mask[j]) continue
          const dr = R[j] - r0
          const dg = G[j] - g0
          const db = B[j] - b0
          const d = dr * dr + dg * dg + db * db
          const wt = sw[(dy + r) * side + dx + r] * LUT[Math.min(1023, ((d / 3) * 1023) | 0)]
          ws += wt
          ar += R[j] * wt
          ag += G[j] * wt
          ab += B[j] * wt
        }
      }
      oR[i] = ar / ws
      oG[i] = ag / ws
      oB[i] = ab / ws
    }
  }
  R.set(oR)
  G.set(oG)
  B.set(oB)
}

/**
 * Kuwahara filter, radius r: each opaque pixel takes the mean of whichever of its four
 * (r+1) x (r+1) corner windows varies least in brightness. Areas flatten, edges stay sharp.
 * Only opaque pixels count. Summed-area tables keep it O(n) per pass.
 */
export function kuwahara(R, G, B, mask, w, h, r = 2) {
  const W1 = w + 1
  const S = (h + 1) * W1
  const sm = new Float64Array(S)
  const sr = new Float64Array(S)
  const sg = new Float64Array(S)
  const sb = new Float64Array(S)
  const sl = new Float64Array(S)
  const sq = new Float64Array(S)
  for (let y = 0; y < h; y++) {
    let am = 0
    let ar = 0
    let ag = 0
    let ab = 0
    let al = 0
    let aq = 0
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (mask[i]) {
        const l = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i]
        am += 1
        ar += R[i]
        ag += G[i]
        ab += B[i]
        al += l
        aq += l * l
      }
      const o = (y + 1) * W1 + x + 1
      const u = y * W1 + x + 1
      sm[o] = sm[u] + am
      sr[o] = sr[u] + ar
      sg[o] = sg[u] + ag
      sb[o] = sb[u] + ab
      sl[o] = sl[u] + al
      sq[o] = sq[u] + aq
    }
  }
  const box = (T, x0, y0, x1, y1) => T[y1 * W1 + x1] - T[y0 * W1 + x1] - T[y1 * W1 + x0] + T[y0 * W1 + x0]
  const oR = new Float32Array(R)
  const oG = new Float32Array(G)
  const oB = new Float32Array(B)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!mask[i]) continue
      let best = Infinity
      let br = 0
      let bg = 0
      let bb = 0
      for (let q = 0; q < 4; q++) {
        const x0 = Math.max(0, q & 1 ? x : x - r)
        const x1 = Math.min(w, (q & 1 ? x + r : x) + 1)
        const y0 = Math.max(0, q & 2 ? y : y - r)
        const y1 = Math.min(h, (q & 2 ? y + r : y) + 1)
        const m = box(sm, x0, y0, x1, y1)
        if (m < 1) continue
        const ml = box(sl, x0, y0, x1, y1) / m
        const v = box(sq, x0, y0, x1, y1) / m - ml * ml
        if (v < best) {
          best = v
          br = box(sr, x0, y0, x1, y1) / m
          bg = box(sg, x0, y0, x1, y1) / m
          bb = box(sb, x0, y0, x1, y1) / m
        }
      }
      if (best < Infinity) {
        oR[i] = br
        oG[i] = bg
        oB[i] = bb
      }
    }
  }
  R.set(oR)
  G.set(oG)
  B.set(oB)
}
