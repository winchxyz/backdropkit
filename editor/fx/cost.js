// A fast estimate of what a layer of cells costs as SVG, for the live readout while sliders move.
//
// It follows how the exporter's encoder (editor/lib/encode.js, emitSafe) writes a layer: one
// path per colour, darkest first, made of horizontal runs; each colour also covers its 4-
// neighbours of later (lighter) colours, so it lies under their edges (under-dilation), and the
// darkest colour of every full 2 x 2 block covers the whole block (corners); the layer is also
// tried "backed" by its commonest colour laid under everything, where a colour covers a lighter
// neighbour only when both stand far from the backing. A colour's runs are cut into paths of at
// most 64 runs (19 rows when 21 to 120 cells wide), each later path also covering the row above
// it. The estimate counts the runs and paths of both encodings and takes the cheaper, as the
// encoder does, then prices them with numbers fitted to the encoder (COST_FIT; the test
// editor/fx/test/calibrate.mjs refits them and editor/fx/NOTES.md has the accuracy).

import { hexToRgb, lum709 } from './color.js'

// chars = runs * (perRun + perLog * log2(cells covered per run)) + perPath * paths
//         + perColour * colours: longer runs take longer numbers to write.
export const COST_FIT = { perRun: 5.65, perLog: 0.27, perPath: 24, perColour: 20 }
const MAX_RUNS = 64
const T = 28

/**
 * estimateCost(cells, colors?, { w = 320, h }) -> { chars, runs, paths, cover, colors, ms }
 *   cells: Uint16Array (0 empty, n = colour n), colors: the hex list cells index into. Without
 *   colours, slot order stands for brightness order (applyLook returns colours darkest first)
 *   and only the unbacked encoding is counted.
 *   chars: the estimated SVG characters of this layer (paths only, not the scene's wrapper).
 *   runs, paths: what the encoder would write; cover: the cells its runs cover in all.
 */
export function estimateCost(cells, colors = null, opts = {}) {
  const t0 = now()
  const w = opts.w ?? 320
  const h = opts.h ?? Math.floor(cells.length / w)
  let maxSlot = 0
  for (let i = 0; i < cells.length; i++) if (cells[i] > maxSlot) maxSlot = cells[i]
  const nc = maxSlot + 1
  // rank[slot]: drawing order (darker first).
  const rank = new Int32Array(nc)
  const rgb = []
  if (colors && colors.length >= maxSlot) {
    const order = []
    for (let s = 1; s < nc; s++) {
      rgb[s] = hexToRgb(colors[s - 1])
      order.push(s)
    }
    const lumOf = s => lum709(...rgb[s])
    order.sort((a, b) => lumOf(a) - lumOf(b) || a - b)
    order.forEach((s, i) => (rank[s] = i + 1))
  } else for (let s = 1; s < nc; s++) rank[s] = s
  const count = new Int32Array(nc)
  for (let i = 0; i < cells.length; i++) count[cells[i]]++
  let used = 0
  let back = 0
  for (let s = 1; s < nc; s++) {
    if (!count[s]) continue
    used++
    if (!back || count[s] > count[back]) back = s
  }
  if (!used) return { chars: 0, runs: 0, paths: 0, cover: 0, colors: 0, ms: 0 }

  const scratch = {
    corner: new Uint16Array((w - 1) * (h - 1)),
    perRow: new Int32Array(nc * h),
    lo: new Int16Array(nc * h),
    hi: new Int16Array(nc * h),
  }
  let best = price(countRuns(cells, w, h, nc, rank, null, scratch), used)
  if (rgb.length && used > 1) {
    const shows = new Uint8Array(nc)
    const br = rgb[back]
    for (let s = 1; s < nc; s++) {
      if (!rgb[s]) continue
      const c = rgb[s]
      shows[s] = (Math.abs(c[0] - br[0]) + Math.abs(c[1] - br[1]) + Math.abs(c[2] - br[2])) / 3 > T ? 1 : 0
    }
    const b = price(countRuns(cells, w, h, nc, rank, { back, shows }, scratch), used)
    if (b.chars < best.chars) best = b
  }
  return { chars: Math.round(best.chars), runs: best.runs, paths: best.paths, cover: best.cover, colors: used, ms: +(now() - t0).toFixed(2) }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function price(c, used) {
  const F = COST_FIT
  const len = c.runs ? Math.log2(Math.max(1, c.cover / c.runs)) : 0
  return { chars: F.perColour * used + c.runs * (F.perRun + F.perLog * len) + F.perPath * c.paths, runs: c.runs, paths: c.paths, cover: c.cover }
}

// Runs and paths of the sets the encoder draws. A cell belongs to its own colour's set, to the
// set of every darker colour among its 4-neighbours (under-dilation), and to the set of the
// darkest colour of any full 2 x 2 block it is in (corners). With backing, the backing colour
// covers every cell, its own cells belong to no other set, a darker neighbour covers a cell
// only when both colours stand far from the backing, and a block holding the backing's colour
// (or one close to it) takes no corner.
function countRuns(cells, w, h, nc, rank, backing, scratch) {
  const { corner, perRow, lo, hi } = scratch
  perRow.fill(0)
  const prev = new Int32Array(16)
  const cur = new Int32Array(16)
  const back = backing ? backing.back : 0
  const shows = backing ? backing.shows : null
  // The corner colour of each full 2 x 2 block (0 for none), block (x, y) at y * (w - 1) + x.
  const cw = w - 1
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < cw; x++) {
      const i = y * w + x
      const a = cells[i]
      const b = cells[i + 1]
      const c = cells[i + w]
      const d = cells[i + w + 1]
      let m = 0
      if (a && b && c && d && !(a === b && a === c && a === d)) {
        if (!(backing && (a === back || b === back || c === back || d === back || !shows[a] || !shows[b] || !shows[c] || !shows[d]))) {
          m = a
          if (rank[b] < rank[m]) m = b
          if (rank[c] < rank[m]) m = c
          if (rank[d] < rank[m]) m = d
        }
      }
      corner[y * cw + x] = m
    }
  }
  let cover = 0
  const add = (n, s) => {
    for (let k = 0; k < n; k++) if (cur[k] === s) return n
    cur[n] = s
    return n + 1
  }
  for (let y = 0; y < h; y++) {
    let np = 0
    let inMask = false
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const c = cells[i]
      let n = 0
      if (c) {
        if (backing) {
          const k = back * h + y
          if (!inMask) {
            if (!perRow[k]) lo[k] = x
            perRow[k]++
          }
          hi[k] = x
          cover++
          inMask = true
        }
        if (!(backing && c === back)) {
          n = add(n, c)
          const rc = rank[c]
          const sc = backing ? shows[c] : 1
          for (let t = 0; t < 4; t++) {
            const d = t === 0 ? (x > 0 ? cells[i - 1] : 0) : t === 1 ? (x < w - 1 ? cells[i + 1] : 0) : t === 2 ? (y > 0 ? cells[i - w] : 0) : y < h - 1 ? cells[i + w] : 0
            if (!d || d === c || rank[d] >= rc) continue
            if (backing && (d === back || !(shows[d] && sc))) continue
            n = add(n, d)
          }
          // Corners of the four blocks this cell is in.
          for (let t = 0; t < 4; t++) {
            const bx = x - (t & 1)
            const by = y - (t >> 1)
            if (bx < 0 || by < 0 || bx >= cw || by >= h - 1) continue
            const m = corner[by * cw + bx]
            if (m && m !== c && rank[m] < rc) n = add(n, m)
          }
        }
      } else inMask = false
      for (let k = 0; k < n; k++) {
        const s = cur[k]
        const r = s * h + y
        hi[r] = x
        let had = false
        for (let j = 0; j < np; j++) if (prev[j] === s) had = true
        if (!had) {
          if (!perRow[r]) lo[r] = x
          perRow[r]++
        }
      }
      cover += n
      for (let k = 0; k < n; k++) prev[k] = cur[k]
      np = n
    }
  }
  // Which colours the encoder joins across paths: all unbacked; backed, the backing and the
  // colours that stand far from it.
  const join = new Uint8Array(nc).fill(1)
  if (backing) for (let s = 1; s < nc; s++) if (s !== back && !shows[s]) join[s] = 0
  const r = chunkRuns(perRow, lo, hi, nc, h, join)
  r.runs -= tallSavings(cells, w, h, rank, backing)
  r.cover = cover
  return r
}

// Thin upright strokes: the encoder writes a part of a colour's set that is one cell wide and
// three or more tall as one column run instead of a run per row. A cell is such a part when
// neither side neighbour is in its colour's set (each is empty, darker, or one the colour does
// not dilate into); a column of n of them saves n - 1 runs.
function tallSavings(cells, w, h, rank, backing) {
  const back = backing ? backing.back : 0
  const shows = backing ? backing.shows : null
  const outside = (c, d) => !d || (d !== c && (rank[d] < rank[c] || (backing && (d === back || !(shows[d] && shows[c])))))
  let saved = 0
  for (let x = 0; x < w; x++) {
    let run = 0
    let rc = 0
    for (let y = 0; y <= h; y++) {
      let c = 0
      if (y < h) {
        const i = y * w + x
        c = cells[i]
        if (c && !(backing && c === back) && outside(c, x > 0 ? cells[i - 1] : 0) && outside(c, x < w - 1 ? cells[i + 1] : 0)) {
          if (c === rc) {
            run++
            continue
          }
        } else c = 0
      }
      if (run >= 3) saved += run - 1
      rc = c
      run = c ? 1 : 0
    }
  }
  return saved
}

// The encoder's chunks, from each colour's runs per row: a path takes whole rows while it holds
// at most 64 runs, and spans at most 19 rows when it is 21 to 120 cells wide; every path after
// a colour's first also covers the cells of the row above that touch its first row (counted as
// the smaller of the two rows' runs), when the colour is joined.
function chunkRuns(perRow, lo, hi, nc, h, join) {
  let runs = 0
  let paths = 0
  for (let s = 1; s < nc; s++) {
    let cr = 0
    let first = 0
    let x0 = 0
    let x1 = 0
    let had = false
    for (let y = 0; y < h; y++) {
      const k = s * h + y
      const r = perRow[k]
      if (!r) continue
      if (cr) {
        const a = Math.min(x0, lo[k])
        const b = Math.max(x1, hi[k])
        const wide = b - a + 1
        if (cr + r <= MAX_RUNS && !(y - first + 1 > 19 && wide > 21 && wide < 120)) {
          cr += r
          x0 = a
          x1 = b
          continue
        }
        runs += cr
        paths++
      }
      // A new path from row y.
      const above = join[s] && had && y > 0 ? perRow[k - 1] : 0
      cr = r + Math.min(above, r)
      first = y
      x0 = lo[k]
      x1 = hi[k]
      had = true
      while (cr > MAX_RUNS) {
        runs += MAX_RUNS
        paths++
        cr -= MAX_RUNS
      }
    }
    if (cr) {
      runs += cr
      paths++
    }
  }
  return { runs, paths }
}
