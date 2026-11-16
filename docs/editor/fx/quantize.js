// Colour reduction for the looks: a weighted histogram, median cut and k-means in OKLab, merging
// of near colours, palettes snapped to a fixed set (the project's or a named one), and a fast
// nearest-colour mapper with a lazily filled lookup table.
//
// Pixels are float sRGB planes (0..1). Palettes inside the looks are "mapper" objects:
//   { n, hex: ['#rrggbb'], rgb: Float32Array(3n) 0..1, lab: Float32Array(3n), luma: Float32Array(n) }

import { hexToRgb, rgbToHex, srgbFloatToLab, labToRgb, luma as luma601, clamp } from './color.js'

/* ---------- Histogram ---------- */

// 15-bit bins (5 bits a channel) with the exact mean colour of each bin.
export function newHistogram() {
  return { count: new Float64Array(32768), r: new Float64Array(32768), g: new Float64Array(32768), b: new Float64Array(32768) }
}

// Adds the opaque pixels (mask[i] != 0) of float planes, each with weight `wt`.
export function addToHistogram(hist, R, G, B, mask, n, wt = 1) {
  const { count, r, g, b } = hist
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue
    const rr = clamp(R[i])
    const gg = clamp(G[i])
    const bb = clamp(B[i])
    const k = (((rr * 31.999) | 0) << 10) | (((gg * 31.999) | 0) << 5) | ((bb * 31.999) | 0)
    count[k] += wt
    r[k] += rr * wt
    g[k] += gg * wt
    b[k] += bb * wt
  }
  return hist
}

// The non-empty bins as { n, rgb: Float32Array(3n), lab: Float32Array(3n), w: Float32Array(n) }.
export function histogramBins(hist) {
  const keys = []
  for (let k = 0; k < 32768; k++) if (hist.count[k] > 0) keys.push(k)
  const n = keys.length
  const rgb = new Float32Array(3 * n)
  const lab = new Float32Array(3 * n)
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const k = keys[i]
    const c = hist.count[k]
    rgb[3 * i] = hist.r[k] / c
    rgb[3 * i + 1] = hist.g[k] / c
    rgb[3 * i + 2] = hist.b[k] / c
    srgbFloatToLab(rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2], lab, 3 * i)
    w[i] = c
  }
  return { n, rgb, lab, w }
}

const d2 = (a, i, b, j) => {
  const x = a[i] - b[j]
  const y = a[i + 1] - b[j + 1]
  const z = a[i + 2] - b[j + 2]
  return x * x + y * y + z * z
}

/* ---------- Median cut + k-means in OKLab ---------- */

// Up to `count` colours that represent the bins, as OKLab triples (Float32Array(3k)) with their
// weights. Median cut on the weighted bins (each box split at its weighted median along the axis
// of widest spread, bigger boxes favoured), then `iters` rounds of weighted k-means. Bin weights
// are damped (count ^ 0.6) so small vivid details still get colours of their own while a big
// sky does not take them all.
export function kmeansLab(bins, count, iters = 8, damp = 0.6) {
  const { n, lab } = bins
  const w = damp === 1 ? bins.w : bins.w.map(v => Math.pow(v, damp))
  if (!n) return { lab: new Float32Array(0), w: new Float32Array(0), k: 0 }
  const target = Math.max(1, Math.min(count, n))
  let boxes = [Array.from({ length: n }, (_, i) => i)]
  const scoreOf = box => {
    if (box.length < 2) return { score: 0, axis: 0 }
    let W = 0
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (const i of box) {
      W += w[i]
      for (let a = 0; a < 3; a++) {
        const v = lab[3 * i + a]
        if (v < lo[a]) lo[a] = v
        if (v > hi[a]) hi[a] = v
      }
    }
    let axis = 0
    let range = 0
    for (let a = 0; a < 3; a++) {
      const r = hi[a] - lo[a]
      if (r > range) {
        range = r
        axis = a
      }
    }
    return { score: range * Math.sqrt(W), axis }
  }
  const scores = boxes.map(scoreOf)
  while (boxes.length < target) {
    let bi = -1
    let best = 0
    for (let i = 0; i < boxes.length; i++) {
      if (scores[i].score > best) {
        best = scores[i].score
        bi = i
      }
    }
    if (bi < 0) break
    const box = boxes[bi]
    const axis = scores[bi].axis
    box.sort((p, q) => lab[3 * p + axis] - lab[3 * q + axis])
    let total = 0
    for (const i of box) total += w[i]
    let acc = 0
    let cut = 1
    for (let j = 0; j < box.length - 1; j++) {
      acc += w[box[j]]
      cut = j + 1
      if (acc >= total / 2) break
    }
    const a = box.slice(0, cut)
    const b = box.slice(cut)
    boxes.splice(bi, 1, a, b)
    scores.splice(bi, 1, scoreOf(a), scoreOf(b))
  }
  let k = boxes.length
  const C = new Float32Array(3 * k)
  const CW = new Float32Array(k)
  boxes.forEach((box, c) => {
    let W = 0
    let L = 0
    let A = 0
    let B = 0
    for (const i of box) {
      W += w[i]
      L += lab[3 * i] * w[i]
      A += lab[3 * i + 1] * w[i]
      B += lab[3 * i + 2] * w[i]
    }
    C[3 * c] = L / W
    C[3 * c + 1] = A / W
    C[3 * c + 2] = B / W
    CW[c] = W
  })
  // k-means.
  const assign = new Int32Array(n)
  const sum = new Float64Array(4 * k)
  for (let it = 0; it < iters; it++) {
    sum.fill(0)
    let worst = -1
    let worstD = 0
    for (let i = 0; i < n; i++) {
      let bj = 0
      let bd = Infinity
      for (let j = 0; j < k; j++) {
        const d = d2(lab, 3 * i, C, 3 * j)
        if (d < bd) {
          bd = d
          bj = j
        }
      }
      assign[i] = bj
      const wi = w[i]
      sum[4 * bj] += wi
      sum[4 * bj + 1] += lab[3 * i] * wi
      sum[4 * bj + 2] += lab[3 * i + 1] * wi
      sum[4 * bj + 3] += lab[3 * i + 2] * wi
      if (bd * wi > worstD) {
        worstD = bd * wi
        worst = i
      }
    }
    let moved = 0
    for (let j = 0; j < k; j++) {
      const W = sum[4 * j]
      if (W > 0) {
        const L = sum[4 * j + 1] / W
        const A = sum[4 * j + 2] / W
        const B = sum[4 * j + 3] / W
        moved += Math.abs(L - C[3 * j]) + Math.abs(A - C[3 * j + 1]) + Math.abs(B - C[3 * j + 2])
        C[3 * j] = L
        C[3 * j + 1] = A
        C[3 * j + 2] = B
        CW[j] = W
      } else if (worst >= 0) {
        // An empty cluster restarts on the worst-served bin.
        C[3 * j] = lab[3 * worst]
        C[3 * j + 1] = lab[3 * worst + 1]
        C[3 * j + 2] = lab[3 * worst + 2]
        CW[j] = 0
        moved += 1
      }
    }
    if (moved < 1e-4) break
  }
  return { lab: C, w: CW, k }
}

// Merges colours closer than `thr` (OKLab distance) into their weighted mean, closest pair first.
export function mergeNearLab(set, thr) {
  let { lab, w, k } = set
  if (thr <= 0 || k < 2) return set
  const L = Array.from({ length: k }, (_, i) => [lab[3 * i], lab[3 * i + 1], lab[3 * i + 2], w[i]])
  const t2 = thr * thr
  for (;;) {
    let bi = -1
    let bj = -1
    let bd = t2
    for (let i = 0; i < L.length; i++) {
      for (let j = i + 1; j < L.length; j++) {
        const x = L[i][0] - L[j][0]
        const y = L[i][1] - L[j][1]
        const z = L[i][2] - L[j][2]
        // Lightness steps matter more than hue steps for how a merge reads; weigh L up a little.
        const d = 1.4 * x * x + y * y + z * z
        if (d < bd) {
          bd = d
          bi = i
          bj = j
        }
      }
    }
    if (bi < 0 || L.length < 3) break
    const a = L[bi]
    const b = L[bj]
    const W = a[3] + b[3] || 1
    const m = [(a[0] * a[3] + b[0] * b[3]) / W, (a[1] * a[3] + b[1] * b[3]) / W, (a[2] * a[3] + b[2] * b[3]) / W, a[3] + b[3]]
    // A heavy colour keeps its own value: the merge should not wash the big areas out.
    if (a[3] > 3 * b[3]) m.splice(0, 3, a[0], a[1], a[2])
    else if (b[3] > 3 * a[3]) m.splice(0, 3, b[0], b[1], b[2])
    L.splice(bj, 1)
    L[bi] = m
  }
  k = L.length
  lab = new Float32Array(3 * k)
  w = new Float32Array(k)
  L.forEach((c, i) => {
    lab[3 * i] = c[0]
    lab[3 * i + 1] = c[1]
    lab[3 * i + 2] = c[2]
    w[i] = c[3]
  })
  return { lab, w, k }
}

/* ---------- Fixed palettes ---------- */

// Picks at most `count` colours of a fixed list (hex) that serve the bins best: k-means on the
// art, each centre snapped to its nearest list colour, twice; unused colours are dropped.
export function pickFromList(bins, list, count) {
  const P = makePalette(list)
  if (!bins.n) return list.slice(0, Math.max(1, count))
  const usage = new Float64Array(P.n)
  const tally = () => {
    usage.fill(0)
    for (let i = 0; i < bins.n; i++) usage[P.nearestLab(bins.lab, 3 * i)] += bins.w[i]
  }
  if (P.n <= count) {
    tally()
    const used = list.filter((_, i) => usage[i] > 0)
    return used.length ? used : list.slice(0, 1)
  }
  const km = kmeansLab(bins, count, 6)
  let chosen = new Set()
  for (let j = 0; j < km.k; j++) chosen.add(P.nearestLab(km.lab, 3 * j))
  // One refinement: the art's centres within each chosen colour's share, snapped again.
  for (let round = 0; round < 2; round++) {
    const ids = [...chosen]
    const sub = makePalette(ids.map(i => list[i]))
    const sum = new Float64Array(4 * ids.length)
    for (let i = 0; i < bins.n; i++) {
      const j = sub.nearestLab(bins.lab, 3 * i)
      const wi = bins.w[i]
      sum[4 * j] += wi
      sum[4 * j + 1] += bins.lab[3 * i] * wi
      sum[4 * j + 2] += bins.lab[3 * i + 1] * wi
      sum[4 * j + 3] += bins.lab[3 * i + 2] * wi
    }
    const next = new Set()
    const tmp = new Float32Array(3)
    ids.forEach((id, j) => {
      const W = sum[4 * j]
      if (!W) return
      tmp[0] = sum[4 * j + 1] / W
      tmp[1] = sum[4 * j + 2] / W
      tmp[2] = sum[4 * j + 3] / W
      next.add(P.nearestLab(tmp, 0))
    })
    if (!next.size) break
    chosen = next
  }
  return [...chosen].sort((a, b) => a - b).map(i => list[i])
}

/* ---------- The mapper ---------- */

// A palette with fast nearest-colour lookups (OKLab distance) and, for ordered dithering, the
// best partner colour of each pixel colour. Lookups key on 6 bits a channel, filled lazily.
export function makePalette(hexList) {
  const hex = hexList.map(h => rgbToHex(...hexToRgb(h)))
  const n = hex.length
  const rgb = new Float32Array(3 * n)
  const lab = new Float32Array(3 * n)
  const lum = new Float32Array(n)
  hex.forEach((h, i) => {
    const [r, g, b] = hexToRgb(h)
    rgb[3 * i] = r / 255
    rgb[3 * i + 1] = g / 255
    rgb[3 * i + 2] = b / 255
    srgbFloatToLab(r / 255, g / 255, b / 255, lab, 3 * i)
    lum[i] = luma601(r, g, b) / 255
  })
  const near = new Int16Array(262144).fill(-1)
  let pairA = null
  let pairB = null
  let pairF = null
  const tmp = new Float32Array(3)
  const nearestLab = (L, o) => {
    let best = 0
    let bd = Infinity
    for (let j = 0; j < n; j++) {
      const d = d2(L, o, lab, 3 * j)
      if (d < bd) {
        bd = d
        best = j
      }
    }
    return best
  }
  const keyOf = (r, g, b) => {
    const q = v => (v <= 0 ? 0 : v >= 1 ? 63 : (v * 63.999) | 0)
    return (q(r) << 12) | (q(g) << 6) | q(b)
  }
  const labOfKey = k => srgbFloatToLab((((k >> 12) & 63) + 0.5) / 64, (((k >> 6) & 63) + 0.5) / 64, ((k & 63) + 0.5) / 64, tmp, 0)
  const nearest = (r, g, b) => {
    const k = keyOf(r, g, b)
    let j = near[k]
    if (j < 0) {
      labOfKey(k)
      j = near[k] = nearestLab(tmp, 0)
    }
    return j
  }
  // The pair (A, B) whose segment passes closest to the colour, A its nearest colour, and how
  // far along from A towards B the colour lies (0..0.5 or so). Long pairs pay a little extra,
  // so a grey prefers two near greys to black and white.
  const fillPair = k => {
    labOfKey(k)
    const A = nearestLab(tmp, 0)
    let B = A
    let bf = 0
    let bs = Infinity
    const ax = lab[3 * A]
    const ay = lab[3 * A + 1]
    const az = lab[3 * A + 2]
    const cx = tmp[0] - ax
    const cy = tmp[1] - ay
    const cz = tmp[2] - az
    for (let j = 0; j < n; j++) {
      if (j === A) continue
      const ux = lab[3 * j] - ax
      const uy = lab[3 * j + 1] - ay
      const uz = lab[3 * j + 2] - az
      const uu = ux * ux + uy * uy + uz * uz
      if (uu < 1e-9) continue
      let f = (cx * ux + cy * uy + cz * uz) / uu
      if (f <= 0) continue
      if (f > 1) f = 1
      const ex = cx - f * ux
      const ey = cy - f * uy
      const ez = cz - f * uz
      const s = Math.sqrt(ex * ex + ey * ey + ez * ez) + 0.12 * Math.sqrt(uu)
      if (s < bs) {
        bs = s
        B = j
        bf = f
      }
    }
    pairA[k] = A
    pairB[k] = B
    pairF[k] = B === A ? 0 : bf
  }
  const pair = (r, g, b, out) => {
    if (!pairA) {
      pairA = new Int16Array(262144).fill(-1)
      pairB = new Int16Array(262144)
      pairF = new Float32Array(262144)
    }
    const k = keyOf(r, g, b)
    if (pairA[k] < 0) fillPair(k)
    out[0] = pairA[k]
    out[1] = pairB[k]
    out[2] = pairF[k]
    return out
  }
  // Palette order darkest to lightest (Rec. 601), for ramp mapping.
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => lum[a] - lum[b] || a - b)
  return { n, hex, rgb, lab, luma: lum, order, nearest, nearestLab, pair }
}

// OKLab triples (Float32Array(3k)) -> hex list.
export function labsToHex(L, k) {
  const out = []
  for (let i = 0; i < k; i++) out.push(rgbToHex(...labToRgb(L[3 * i], L[3 * i + 1], L[3 * i + 2])))
  return out
}
