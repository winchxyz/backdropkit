// Dithering for the looks, ported from Nightgrain (js/dither.js, the owner's MIT app): the same
// 18 pattern ids, threshold maps and error-diffusion kernels. Two changes for cells that end up
// as SVG runs:
// - Ordered patterns mix the pixel's two best palette colours (its nearest, and the partner
//   whose blend comes closest), as pixel artists dither, instead of Nightgrain's 64-pick mix.
//   Fewer colours meet in a patch, so the runs stay longer.
// - `amount` narrows the band where mixing happens: at 1 the pattern spans the whole step
//   between two colours, at 0.5 only the middle half of it, at 0 the picture is flat. Narrow
//   bands keep flat areas flat, which is what keeps a picture affordable.

import { mulberry32, clamp, luma } from './color.js'

export const ALGOS = [
  { id: 'none', name: 'None', group: 'Flat', cost: 'low', hint: 'No dithering: each cell takes its nearest colour. The cheapest.' },
  { id: 'linesh', name: 'Lines', group: 'Ordered', cost: 'low', hint: 'Horizontal engraving lines. Cheap: rows become long runs.' },
  { id: 'bayer8', name: 'Bayer 8', group: 'Ordered', cost: 'mid', hint: 'The classic fine crosshatch grid.' },
  { id: 'bayer4', name: 'Bayer 4', group: 'Ordered', cost: 'mid', hint: 'A coarser, more visible grid pattern.' },
  { id: 'bayer2', name: 'Bayer 2', group: 'Ordered', cost: 'high', hint: 'Chunky checkerboard mixing, very retro. Costly over large areas.' },
  { id: 'bayer16', name: 'Bayer 16', group: 'Ordered', cost: 'mid', hint: 'The smoothest ordered grid, with the most tone steps.' },
  { id: 'cluster', name: 'Halftone', group: 'Ordered', cost: 'mid', hint: 'Round print dots that grow with brightness.' },
  { id: 'cross', name: 'Crosshatch', group: 'Ordered', cost: 'mid', hint: 'Woven horizontal and vertical lines.' },
  { id: 'linesd', name: 'Diagonal', group: 'Ordered', cost: 'high', hint: 'Diagonal engraving lines.' },
  { id: 'blue', name: 'Blue noise', group: 'Ordered', cost: 'high', hint: 'Evenly scattered grain with no visible pattern.' },
  { id: 'white', name: 'Static', group: 'Ordered', cost: 'high', hint: 'Rough random grain, like TV static.' },
  { id: 'floyd', name: 'Floyd-Steinberg', group: 'Diffusion', cost: 'high', hint: 'Organic, detailed grain. The standard error diffusion.' },
  { id: 'atkinson', name: 'Atkinson', group: 'Diffusion', cost: 'high', hint: 'Crisp and contrasty, the early Macintosh look.' },
  { id: 'stucki', name: 'Stucki', group: 'Diffusion', cost: 'high', hint: 'Smooth, clean diffusion with fine detail.' },
  { id: 'jjn', name: 'Jarvis', group: 'Diffusion', cost: 'high', hint: 'Soft diffusion with a wide spread.' },
  { id: 'burkes', name: 'Burkes', group: 'Diffusion', cost: 'high', hint: 'Fast, slightly streaky diffusion.' },
  { id: 'sierra', name: 'Sierra', group: 'Diffusion', cost: 'high', hint: 'Balanced diffusion between Floyd and Jarvis.' },
  { id: 'sierralite', name: 'Sierra Lite', group: 'Diffusion', cost: 'high', hint: 'Light diffusion with a tight, wormy texture.' },
]
export const ALGO_IDS = new Set(ALGOS.map(a => a.id))

const KERNELS = {
  floyd: { d: 16, k: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
  atkinson: { d: 8, k: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
  jjn: { d: 48, k: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]] },
  stucki: { d: 42, k: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]] },
  burkes: { d: 32, k: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]] },
  sierra: { d: 32, k: [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2], [-1, 2, 2], [0, 2, 3], [1, 2, 2]] },
  sierralite: { d: 4, k: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]] },
}
for (const id in KERNELS) {
  const k = KERNELS[id]
  k.dx = Int8Array.from(k.k, t => t[0])
  k.dy = Int8Array.from(k.k, t => t[1])
  k.wt = Float32Array.from(k.k, t => t[2] / k.d)
}

export const isDiffusion = algo => algo in KERNELS

/* ---------- Threshold maps (all sizes are powers of two), as in Nightgrain ---------- */

function bayer(size) {
  let m = [0]
  let n = 1
  while (n < size) {
    const next = new Array(n * n * 4)
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = m[y * n + x] * 4
        next[y * (n * 2) + x] = v
        next[y * (n * 2) + x + n] = v + 2
        next[(y + n) * (n * 2) + x] = v + 3
        next[(y + n) * (n * 2) + x + n] = v + 1
      }
    }
    m = next
    n *= 2
  }
  const out = new Float32Array(size * size)
  for (let i = 0; i < out.length; i++) out[i] = (m[i] + 0.5) / out.length
  return out
}

// Any score field as evenly spread thresholds, by rank.
function ranked(size, score) {
  const n = size * size
  const order = Array.from({ length: n }, (_, i) => i)
  order.sort((a, b) => score[a] - score[b])
  const out = new Float32Array(n)
  for (let r = 0; r < n; r++) out[order[r]] = (r + 0.5) / n
  return out
}

// Progressive void filling: each new point goes to the emptiest spot.
function blueNoise(size) {
  const n = size * size
  const energy = new Float32Array(n)
  const rnd = mulberry32(1337)
  for (let i = 0; i < n; i++) energy[i] = rnd() * 1e-4
  const used = new Uint8Array(n)
  const out = new Float32Array(n)
  const R = 6
  const sigma2 = 2 * 1.9 * 1.9
  const kern = new Float32Array((2 * R + 1) * (2 * R + 1))
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) kern[(dy + R) * (2 * R + 1) + dx + R] = Math.exp(-(dx * dx + dy * dy) / sigma2)
  const mask = size - 1
  for (let k = 0; k < n; k++) {
    let best = 0
    let bv = Infinity
    for (let i = 0; i < n; i++) {
      if (!used[i] && energy[i] < bv) {
        bv = energy[i]
        best = i
      }
    }
    used[best] = 1
    out[best] = (k + 0.5) / n
    const bx = best & mask
    const by = (best / size) | 0
    for (let dy = -R; dy <= R; dy++) {
      const yy = ((by + dy) & mask) * size
      for (let dx = -R; dx <= R; dx++) energy[yy + ((bx + dx) & mask)] += kern[(dy + R) * (2 * R + 1) + dx + R]
    }
  }
  return out
}

const maps = {}
export function thresholdMap(algo) {
  if (maps[algo]) return maps[algo]
  let size = 8
  let data
  const b8 = () => thresholdMap('bayer8').data
  if (algo === 'bayer2') {
    size = 2
    data = bayer(2)
  } else if (algo === 'bayer4') {
    size = 4
    data = bayer(4)
  } else if (algo === 'bayer16') {
    size = 16
    data = bayer(16)
  } else if (algo === 'blue') {
    size = 32
    data = blueNoise(32)
  } else if (algo === 'white') {
    size = 128
    data = new Float32Array(size * size)
    const rnd = mulberry32(99)
    for (let i = 0; i < data.length; i++) data[i] = rnd()
  } else if (algo === 'cluster') {
    const s = new Float32Array(64)
    const fine = b8()
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) s[y * 8 + x] = -(Math.cos(((x + 0.5) / 8) * Math.PI * 2) + Math.cos(((y + 0.5) / 8) * Math.PI * 2)) + fine[y * 8 + x] * 0.01
    data = ranked(8, s)
  } else if (algo === 'linesh') {
    // One threshold per row (Nightgrain's spreads it along the row too): a row switches colour
    // whole, so lines are single runs. Eight tone steps between two colours.
    const line = [0, 2, 1, 3]
    data = new Float32Array(64)
    for (let y = 0; y < 8; y++) data.fill((line[y & 3] * 2 + ((y >> 2) & 1) + 0.5) / 8, y * 8, y * 8 + 8)
  } else if (algo === 'linesd' || algo === 'cross') {
    const line = [0, 2, 1, 3]
    const s = new Float32Array(64)
    const fine = b8()
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const v = algo === 'linesd' ? line[(x + y) & 3] : Math.min(line[y & 3], line[x & 3]) * 2 + Math.max(line[y & 3], line[x & 3]) * 0.5
        s[y * 8 + x] = v + fine[y * 8 + x] * 0.9
      }
    }
    data = ranked(8, s)
  } else {
    size = 8
    data = bayer(8)
  }
  maps[algo] = { size, data }
  return maps[algo]
}

/* ---------- Mapping pixels to palette indices ---------- */

/**
 * o: { R, G, B: Float32Array sRGB 0..1 (may be modified), mask: Uint8Array (0 = empty),
 *      w, h, pal: a palette from quantize.makePalette, algo, amount 0..1, scale 1..4 (pattern
 *      cell size), ramp: null or { lo, hi } (map by brightness along the palette, darkest to
 *      lightest, with lo..hi stretched to the full ramp), where: null or Float32Array(w * h),
 *      a 0..1 factor on the amount per pixel (see smoothness) }
 * Returns Int16Array(w * h): palette index, -1 for empty.
 */
export function mapGrid(o) {
  const { R, G, B, mask, w, h, pal } = o
  const n = w * h
  const out = new Int16Array(n).fill(-1)
  const algo = ALGO_IDS.has(o.algo) ? o.algo : 'none'
  const amount = clamp(o.amount ?? 0.5)
  const where = o.where ?? null
  const ramp = o.ramp
  const N = pal.n
  if (!N) return out
  if (N === 1) {
    for (let i = 0; i < n; i++) if (mask[i]) out[i] = 0
    return out
  }
  const order = pal.order
  const lo = ramp ? ramp.lo : 0
  const span = ramp ? Math.max(0.02, ramp.hi - ramp.lo) : 1
  const level = i => clamp((luma(R[i], G[i], B[i]) - lo) / span) * (N - 1)

  if (algo === 'none' || amount <= 0) {
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue
      out[i] = ramp ? order[Math.round(level(i))] : pal.nearest(R[i], G[i], B[i])
    }
    return out
  }

  const kern = KERNELS[algo]
  if (kern) {
    const { dx: tdx, dy: tdy, wt: twt } = kern
    const nt = tdx.length
    if (ramp) {
      const V = new Float32Array(n)
      for (let i = 0; i < n; i++) V[i] = mask[i] ? level(i) : 0
      for (let y = 0; y < h; y++) {
        const ltr = (y & 1) === 0
        for (let xi = 0; xi < w; xi++) {
          const x = ltr ? xi : w - 1 - xi
          const i = y * w + x
          if (!mask[i]) continue
          const v = V[i]
          let q = Math.round(v)
          q = q < 0 ? 0 : q > N - 1 ? N - 1 : q
          out[i] = order[q]
          const e = (v - q) * amount * (where ? where[i] : 1)
          if (e === 0) continue
          for (let t = 0; t < nt; t++) {
            const xx = ltr ? x + tdx[t] : x - tdx[t]
            const yy = y + tdy[t]
            if (xx >= 0 && xx < w && yy < h) V[yy * w + xx] += e * twt[t]
          }
        }
      }
      return out
    }
    for (let y = 0; y < h; y++) {
      const ltr = (y & 1) === 0
      for (let xi = 0; xi < w; xi++) {
        const x = ltr ? xi : w - 1 - xi
        const i = y * w + x
        if (!mask[i]) continue
        const r = clamp(R[i], -0.4, 1.4)
        const g = clamp(G[i], -0.4, 1.4)
        const b = clamp(B[i], -0.4, 1.4)
        const j = pal.nearest(r, g, b)
        out[i] = j
        const a = where ? amount * where[i] : amount
        const er = (r - pal.rgb[3 * j]) * a
        const eg = (g - pal.rgb[3 * j + 1]) * a
        const eb = (b - pal.rgb[3 * j + 2]) * a
        if (er === 0 && eg === 0 && eb === 0) continue
        for (let t = 0; t < nt; t++) {
          const xx = ltr ? x + tdx[t] : x - tdx[t]
          const yy = y + tdy[t]
          if (xx >= 0 && xx < w && yy < h) {
            const ii = yy * w + xx
            const wt = twt[t]
            R[ii] += er * wt
            G[ii] += eg * wt
            B[ii] += eb * wt
          }
        }
      }
    }
    return out
  }

  // Ordered.
  const tm = thresholdMap(algo)
  const size = tm.size
  const msk = size - 1
  const T = tm.data
  const ps = Math.max(1, Math.round(o.scale ?? 1))
  const ox = o.ox | 0
  const oy = o.oy | 0
  const pr = [0, 0, 0]
  for (let y = 0; y < h; y++) {
    const row = ((((y + oy) / ps) | 0) & msk) * size
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!mask[i]) continue
      const t = 0.5 + (T[row + ((((x + ox) / ps) | 0) & msk)] - 0.5) * (where ? amount * where[i] : amount)
      if (ramp) {
        const v = level(i)
        const i0 = v | 0
        out[i] = order[v - i0 > t && i0 < N - 1 ? i0 + 1 : i0]
      } else {
        pal.pair(R[i], G[i], B[i], pr)
        out[i] = pr[2] > t ? pr[1] : pr[0]
      }
    }
  }
  return out
}

/**
 * How smooth the picture is around each pixel, as a 0..1 factor for the dither amount: 1 where
 * brightness changes gently (skies, gradients: where dithering reads as tone), falling to 0 where
 * the picture is already busy (foliage, sparkle, small detail: where a pattern only adds noise
 * and cost). Measured as the brightness spread in the 3 x 3 neighbourhood, softened over 3 x 3.
 */
export function smoothness(R, G, B, mask, w, h, lo = 0.025, hi = 0.07) {
  const n = w * h
  const Y = new Float32Array(n)
  for (let i = 0; i < n; i++) Y[i] = luma(R[i], G[i], B[i])
  const sd = new Float32Array(n)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!mask[i]) continue
      let s = 0
      let s2 = 0
      let k = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const j = yy * w + xx
          if (!mask[j]) continue
          s += Y[j]
          s2 += Y[j] * Y[j]
          k++
        }
      }
      const m = s / k
      sd[i] = Math.sqrt(Math.max(0, s2 / k - m * m))
    }
  }
  const out = new Float32Array(n)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!mask[i]) continue
      let s = 0
      let k = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const j = yy * w + xx
          if (!mask[j]) continue
          s += sd[j]
          k++
        }
      }
      out[i] = clamp(1 - (s / k - lo) / (hi - lo))
    }
  }
  return out
}
