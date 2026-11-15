// BackdropKit engine: a layer of colour cells written as SVG stroke runs that show no hairlines
// at any window size.
//
// Why hairlines happen: a scene is a grid of cells. When a cell is not a whole number of screen
// pixels wide, the edge between two cells falls inside a pixel. Each shape is antialiased on
// its own, so in that pixel the first shape covers part, the second covers the rest, and
// whatever lies under both shows through in between: a thin line along every edge.
//
// What this encoder does about it, without changing a single cell at whole-pixel sizes:
// - Under-dilation. Colours are drawn darkest first. Each colour's path also covers every
//   neighbouring cell (4-neighbourhood) of a colour drawn after it. So wherever two colours
//   meet, the later one's edge lies over a solid run of the earlier one, never over the layers
//   below. The edge pixel blends the two neighbours (plus, at most, colours between them in
//   brightness), which is plain antialiasing.
// - Overlapping splits. A path may hold at most MAX_RUNS runs (Chromium's GPU raster rounds
//   cell corners in bigger paths). When a colour needs several paths, each later path also
//   covers the cells of the earlier ones that touch it, so the joins lie over the same colour.
//
// Cells use Sunfield's Layer (tools/pixel.mjs): key = (y + 1000) * 4096 + (x + 1000), and the
// caller shifts the picture down half a cell, so a run on row y is a stroke-width-1 line at y.
// The output has the same shape as pixel.mjs emitCells: <path stroke=c d=...> per path, grouped
// under <g stroke=c> when a colour has several. Quotes follow QUOTE (default ").

const OFF = 1000
const ROW = 4096
const key = (x, y) => (y + OFF) * ROW + (x + OFF)
const kx = k => (k % ROW) - OFF
const ky = k => Math.floor(k / ROW) - OFF
const MAX_RUNS = 64

const lum = h => {
  const n = parseInt(h.slice(1).length === 3 ? h.slice(1).replace(/./g, c => c + c) : h.slice(1), 16)
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
}

function shortHex(h) {
  if (h.length === 7 && h[1] === h[2] && h[3] === h[4] && h[5] === h[6]) return '#' + h[1] + h[3] + h[5]
  return h
}

function num(v) {
  const s = String(v)
  return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? '-' + s.slice(2) : s
}

function pair(a, b) {
  const sa = num(a)
  const sb = num(b)
  const glued = sb[0] === '-' || (sb[0] === '.' && sa.includes('.'))
  return sa + (glued ? '' : ' ') + sb
}

// Runs along rows (horizontal) or columns: [[fixed, [[start, len], ...]], ...], sorted.
function lines(cells, horizontal) {
  const by = new Map()
  for (const [x, y] of cells) {
    const f = horizontal ? y : x
    let l = by.get(f)
    if (!l) by.set(f, (l = []))
    l.push(horizontal ? x : y)
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

// Segments for runs, each line walked in whichever direction keeps the moves short.
function walk(ls, horizontal) {
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
  let best = [{ cost: 0, segs: [] }, null]
  for (const [fixed, runs] of ls) {
    const next = [null, null]
    for (const back of [0, 1]) {
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

function data(segs, ox, oy) {
  let d = ''
  let pen = null
  for (const s of segs) {
    d += pen ? 'm' + pair(s.sx - pen.ex, s.sy - pen.ey) : 'M' + pair(s.sx - ox, s.sy - oy)
    d += s.cmd
    pen = s
  }
  return d
}

// One set of cells as segments: rows, or rows plus columns for tall thin shapes, whichever
// writes shorter.
function segments(cells) {
  const at = new Set(cells.map(([x, y]) => key(x, y)))
  const run = (x, y, dx, dy) => {
    let n = 0
    while (at.has(key(x + dx * (n + 1), y + dy * (n + 1)))) n++
    return n
  }
  const tall = []
  const rest = []
  for (const [x, y] of cells) {
    const h = 1 + run(x, y, 1, 0) + run(x, y, -1, 0)
    const v = 1 + run(x, y, 0, 1) + run(x, y, 0, -1)
    ;(v >= 3 && v > h ? tall : rest).push([x, y])
  }
  const rows = walk(lines(cells, true), true)
  if (!tall.length) return rows
  const mixed = walk(lines(rest, true), true).concat(walk(lines(tall, false), false))
  const len = segs => data(segs, 0, 0).length
  return len(mixed) < len(rows) ? mixed : rows
}

// Cuts one colour's cells into chunks of whole rows, each written as one path of at most
// maxRuns runs. Each chunk also covers the cells of earlier chunks that touch it, so the join
// between two chunks lies over the same colour. A row too busy for one path is cut across.
function chunks(cellKeys, maxRuns, overlap = true) {
  const rows = new Map()
  for (const k of cellKeys) {
    const y = ky(k)
    let r = rows.get(y)
    if (!r) rows.set(y, (r = []))
    r.push(k)
  }
  const done = new Set()
  const out = []
  const withOverlap = ks => {
    if (!overlap) return ks
    const s = new Set(ks)
    for (const k of ks) {
      for (const n of [k - 1, k + 1, k - ROW, k + ROW]) if (done.has(n)) s.add(n)
    }
    return [...s]
  }
  const segsOf = ks => segments(ks.map(k => [kx(k), ky(k)]))
  let cur = []
  const close = () => {
    if (!cur.length) return
    out.push(segsOf(withOverlap(cur)))
    for (const k of cur) done.add(k)
    cur = []
  }
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(y).sort((a, b) => a - b)
    const tryCur = cur.concat(row)
    if (segsOf(withOverlap(tryCur)).length <= maxRuns) {
      cur = tryCur
      continue
    }
    close()
    if (segsOf(withOverlap(row)).length <= maxRuns) {
      cur = row
      continue
    }
    // A row with too many runs for one path: cut it into pieces of whole runs.
    let piece = []
    for (const k of row) {
      const t = piece.concat([k])
      if (piece.length && segsOf(withOverlap(t)).length > maxRuns) {
        cur = piece
        close()
        piece = [k]
      } else piece = t
    }
    cur = piece
  }
  close()
  return out
}

const rgbOf = h => {
  const s = h.slice(1).length === 3 ? h.slice(1).replace(/./g, c => c + c) : h.slice(1)
  const n = parseInt(s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
// How far apart two colours look, as the mean of the channel differences (0..255).
const apart = (a, b) => {
  const x = rgbOf(a)
  const y = rgbOf(b)
  return (Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2])) / 3
}

// One encoding of a layer. `back` is the colour laid under the whole layer first, or null.
// Each other colour also covers the neighbouring cells of colours drawn after it, but only
// where a hairline would show: where what lies beneath (the backing, or for no backing the
// unknown layers below, treated as far from everything) is more than T from both colours.
function encodeWith(layer, byColor, back, o) {
  const { ox, oy, q, maxRuns, T, order } = o
  const colours = [...byColor.keys()].filter(c => c !== back)
  if (order === 'area') colours.sort((a, b) => byColor.get(b).length - byColor.get(a).length || lum(a) - lum(b))
  else colours.sort((a, b) => lum(a) - lum(b))
  const rank = new Map(colours.map((c, i) => [c, i]))
  const shows = c => (back ? apart(back, c) > T : true)
  const paths = []
  if (back) paths.push([back, chunks([...layer.m.keys()], maxRuns, o.join)])
  for (const c of colours) {
    const own = byColor.get(c)
    const r = rank.get(c)
    const s = new Set(own)
    if (shows(c)) {
      for (const k of own) {
        for (const n of [k - 1, k + 1, k - ROW, k + ROW]) {
          const nc = layer.m.get(n)
          if (nc === undefined || nc === back || rank.get(nc) <= r) continue
          if (shows(nc)) s.add(n)
        }
      }
    }
    paths.push([c, chunks([...s], maxRuns, o.join && shows(c))])
  }
  let out = ''
  for (const [c, segsList] of paths) {
    const ds = segsList.map(segs => data(segs, ox, oy))
    const col = shortHex(c)
    if (ds.length === 1) out += '<path stroke=' + q + col + q + ' d=' + q + ds[0] + q + '/>'
    else out += '<g stroke=' + q + col + q + '>' + ds.map(p => '<path d=' + q + p + q + '/>').join('') + '</g>'
  }
  return out
}

// The layer as SVG, the shortest of: backed by its commonest colour, or not backed. Both keep
// every cell exactly as painted at whole-pixel sizes and leave no hairline above T. opts:
//   ox, oy: written relative to this corner (a pattern tile's corner);
//   T: the largest step (mean channel difference) a hairline may show (default 28: at worst a
//      quarter of it, about 7 levels, reaches the screen);
//   back: 'auto' (default), 'none', or 'always';
//   order: 'lum' (default, darkest first) or 'area' (largest first);
//   q: the quote character (default ").
export function emitSafe(layer, opts = {}) {
  const o = { ox: 0, oy: 0, q: '"', maxRuns: MAX_RUNS, T: 28, order: 'lum', back: 'auto', join: true, ...opts }
  const byColor = new Map()
  for (const [k, c] of layer.m) {
    let list = byColor.get(c)
    if (!list) byColor.set(c, (list = []))
    list.push(k)
  }
  if (!byColor.size) return ''
  let top = null
  for (const [c, ks] of byColor) if (!top || ks.length > byColor.get(top).length) top = c
  const tries = []
  if (o.back !== 'always') tries.push(encodeWith(layer, byColor, null, o))
  if (o.back !== 'none' && byColor.size > 1) tries.push(encodeWith(layer, byColor, top, o))
  if (!tries.length) tries.push(encodeWith(layer, byColor, null, o))
  return tries.reduce((a, b) => (b.length < a.length ? b : a))
}

// Runs (subpaths) in a piece of SVG, the count the player's rule is about.
export const runsIn = svg => (svg.match(/[Mm][-.\d]/g) ?? []).length
