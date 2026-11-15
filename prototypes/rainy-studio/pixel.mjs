// Pixel canvas helpers: a sparse grid of colour cells, painted by the scene's painters
// and written out as SVG stroke runs (one path per colour, one 1-cell-tall run per span).
// Copied from sunfield/tools/pixel.mjs; the one change is that colours may carry alpha.

export function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), 1 | t)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const OFF = 1000
const ROW = 4096
const key = (x, y) => (y + OFF) * ROW + (x + OFF)
// Without shape-rendering (the app's moving-backdrop player refuses it), Chromium's GPU raster
// draws one path with more than about 80 runs with rounded cell corners at some window scales
// (seen at 6 device px per cell, not at 5, 7.5 or 9); paths of 64 runs stay square, so a colour
// is cut into paths of at most MAX_RUNS runs, grouped under one <g stroke>.
const MAX_RUNS = Number(process.env.MAX_RUNS ?? 64)

export class Layer {
  constructor(name, anim = null) {
    this.name = name
    this.anim = anim // { cls, style, attrs } or null for a still layer
    this.m = new Map()
  }

  set(x, y, c) {
    if (!c) return
    this.m.set(key(Math.floor(x), Math.floor(y)), c)
  }

  get(x, y) {
    return this.m.get(key(Math.floor(x), Math.floor(y)))
  }

  has(x, y) {
    return this.m.has(key(Math.floor(x), Math.floor(y)))
  }

  get size() {
    return this.m.size
  }
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16 - 0.5)

// Ordered-dither offset in [-0.47, 0.47] for a cell.
export function bayer(x, y) {
  const xi = ((Math.floor(x) % 4) + 4) % 4
  const yi = ((Math.floor(y) % 4) + 4) % 4
  return BAYER[yi * 4 + xi]
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
export const lerp = (a, b, t) => a + (b - a) * t
export const smooth = t => {
  const c = clamp(t, 0, 1)
  return c * c * (3 - 2 * c)
}

// Picks a tone from a dark-to-light list for a brightness v in 0..1, dithered by `amt` of a step.
export function tone(tones, v, x, y, amt = 0.6) {
  const n = tones.length
  const d = v * n + bayer(x, y) * amt
  return tones[clamp(Math.floor(d), 0, n - 1)]
}

export function hex(c) {
  return '#' + c.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')
}

export function rgb(h) {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Colours may carry alpha (#rrggbbaa) for glass, light and steam.
function shortHex(h) {
  if (h.length === 9) return h[1] === h[2] && h[3] === h[4] && h[5] === h[6] && h[7] === h[8] ? '#' + h[1] + h[3] + h[5] + h[7] : h
  if (h[1] === h[2] && h[3] === h[4] && h[5] === h[6]) return '#' + h[1] + h[3] + h[5]
  return h
}

// The cells' box: columns x0..x1 and rows y0..y1, ends excluded. null for no cells.
export function bounds(layer) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const k of layer.m.keys()) {
    const x = (k % ROW) - OFF
    const y = Math.floor(k / ROW) - OFF
    if (x < x0) x0 = x
    if (x >= x1) x1 = x + 1
    if (y < y0) y0 = y
    if (y >= y1) y1 = y + 1
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 }
}

// Path numbers as short as SVG allows: "0.5" as ".5", "-0.5" as "-.5".
function num(v) {
  const s = String(v)
  return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? '-' + s.slice(2) : s
}

// A pair of path numbers, with the separator dropped where the second one's sign or point
// already ends the first.
function pair(a, b) {
  const sa = num(a)
  const sb = num(b)
  const glued = sb[0] === '-' || (sb[0] === '.' && sa.includes('.'))
  return sa + (glued ? '' : ' ') + sb
}

// The runs of one colour as segments to draw: { sx, sy, cmd, ex, ey }, in user units, where a
// cell (x, y) spans x..x+1 across and y-0.5..y+0.5 down (the picture is shifted down half a
// cell). Rows go top to bottom and columns left to right; each row or column is walked in
// whichever direction makes the moves into it and out of it shortest.
function walk(lines, horizontal) {
  // lines: [[fixed, [[start, len], ...]], ...] sorted; returns segments.
  const seg = (fixed, start, len, back) => {
    if (horizontal) {
      return back
        ? { sx: start + len, sy: fixed, cmd: 'h-' + len, ex: start, ey: fixed }
        : { sx: start, sy: fixed, cmd: 'h' + len, ex: start + len, ey: fixed }
    }
    const x = fixed + 0.5
    return back
      ? { sx: x, sy: start + len - 0.5, cmd: 'v-' + len, ex: x, ey: start - 0.5 }
      : { sx: x, sy: start - 0.5, cmd: 'v' + len, ex: x, ey: start + len - 0.5 }
  }
  const lineSegs = (fixed, runs, back) => (back ? [...runs].reverse() : runs).map(([s, l]) => seg(fixed, s, l, back))
  const cost = (pen, segs) => {
    let n = 0
    let p = pen
    for (const s of segs) {
      n += p ? 1 + pair(s.sx - p.ex, s.sy - p.ey).length : 0
      n += s.cmd.length
      p = s
    }
    return n
  }
  // Two states per line: walked forward or back; keep the cheaper history for each.
  let best = [{ cost: 0, segs: [] }, null]
  for (const [fixed, runs] of lines) {
    const next = [null, null]
    for (const back of process.env.SERP === '0' ? [0] : [0, 1]) {
      const segs = lineSegs(fixed, runs, back)
      for (const prev of best) {
        if (!prev) continue
        const pen = prev.segs.length ? prev.segs[prev.segs.length - 1] : null
        const c = prev.cost + cost(pen, segs)
        if (!next[back] || c < next[back].cost) next[back] = { cost: c, segs: prev.segs.concat(segs) }
      }
    }
    best = next
  }
  const ends = best.filter(Boolean)
  return ends.length ? ends.reduce((a, b) => (a.cost <= b.cost ? a : b)).segs : []
}

// Segments as path data, cut into paths of at most MAX_RUNS runs.
function pathData(segs, ox, oy) {
  const paths = []
  let d = ''
  let runs = 0
  let pen = null
  for (const s of segs) {
    if (runs === MAX_RUNS) {
      paths.push(d)
      d = ''
      runs = 0
      pen = null
    }
    d += pen ? 'm' + pair(s.sx - pen.ex, s.sy - pen.ey) : 'M' + pair(s.sx - ox, s.sy - oy)
    d += s.cmd
    runs++
    pen = s
  }
  if (d) paths.push(d)
  return paths
}

// Runs of a set of cells along rows (horizontal) or columns.
function lines(cells, horizontal) {
  const by = new Map()
  for (const [x, y] of cells) {
    const f = horizontal ? y : x
    const v = horizontal ? x : y
    let l = by.get(f)
    if (!l) by.set(f, (l = []))
    l.push(v)
  }
  return [...by.keys()]
    .sort((a, b) => a - b)
    .map(f => {
      const vs = by.get(f).sort((a, b) => a - b)
      const runs = []
      for (const v of vs) {
        const last = runs[runs.length - 1]
        if (last && last[0] + last[1] === v) last[1]++
        else runs.push([v, 1])
      }
      return [f, runs]
    })
}

// One colour's cells as path data. Cells in tall, thin shapes (stems, poles) are drawn as
// vertical runs, the rest as rows; whichever of that and rows alone is shorter wins.
function colourPaths(cells, ox, oy) {
  const at = new Set(cells.map(([x, y]) => x + ',' + y))
  const run = (x, y, dx, dy) => {
    let n = 0
    while (at.has(x + dx * (n + 1) + ',' + (y + dy * (n + 1)))) n++
    return n
  }
  const tall = []
  const rest = []
  for (const [x, y] of cells) {
    const h = 1 + run(x, y, 1, 0) + run(x, y, -1, 0)
    const v = 1 + run(x, y, 0, 1) + run(x, y, 0, -1)
    ;(v >= 3 && v > h ? tall : rest).push([x, y])
  }
  const rowsOnly = pathData(walk(lines(cells, true), true), ox, oy)
  if (!tall.length || process.env.VRUNS === '0') return rowsOnly
  const mixed = pathData(walk(lines(rest, true), true).concat(walk(lines(tall, false), false)), ox, oy)
  const size = ps => ps.reduce((n, p) => n + p.length + 18, 0)
  return size(mixed) < size(rowsOnly) ? mixed : rowsOnly
}

// Writes a layer as paths of stroke-width 1 runs. The caller shifts the whole picture down
// half a cell, so a run on row y is drawn at y and covers y..y+1. The cells are written
// relative to (ox, oy), for a pattern tile whose corner is there.
export function emitCells(layer, ox = 0, oy = 0) {
  const byColor = new Map()
  for (const [k, c] of layer.m) {
    let list = byColor.get(c)
    if (!list) byColor.set(c, (list = []))
    list.push([(k % ROW) - OFF, Math.floor(k / ROW) - OFF])
  }
  let out = ''
  for (const [c, cells] of byColor) {
    const paths = colourPaths(cells, ox, oy)
    if (paths.length === 1) out += '<path stroke="' + shortHex(c) + '" d="' + paths[0] + '"/>'
    else out += '<g stroke="' + shortHex(c) + '">' + paths.map(p => '<path d="' + p + '"/>').join('') + '</g>'
  }
  return out
}
