// Moon Keep's copy of the BackdropKit engine's encoder (../../engine/encode.mjs, copied
// 2026-11-15). The engine is shared by every scene, so the changes live here. emitSafe takes
// these extra options (build.mjs turns them all on):
// - bridge: a colour may also fill the gaps in a row between two of its runs where only later
//   colours lie, which cover it there; the two runs become one, which writes shorter. Only where
//   no new edge can show (see bridge()).
// - joinAll: a colour's chunks always overlap where they meet, also where the colour is within
//   T of the backing (with T raised, those joins showed as lines).
// - order 'both': tries darkest first and largest first, and keeps the shorter.
// - edge (after Low Orbit): a cell on the layer's outer edge far from the backing is not backed,
//   so the backing never shows as a line along that edge; it stays backed when a cell of the
//   backing's own colour touches it.
// - corners (after Low Orbit): where four colours meet, the earliest covers the whole 2 x 2
//   block, so what lies beneath does not show as a dot at the corner.
// - maxRows: soft corners. Chromium's GPU raster draws a path whose screen box is square-ish and
//   middling with a softer antialiasing that rounds every cell corner, even at whole-pixel
//   sizes (the moon and the trees at the owner's 6 px a cell). A path is closed before its box
//   becomes one: short side at least maxRows cells, long side at most MAX_SIDE, ratio under 1.7.
//
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
const MAX_SIDE = Number(process.env.MAXSIDE ?? 60) // Moon Keep: see chunks

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
function chunks(cellKeys, maxRuns, overlap = true, maxRows = Infinity) {
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
    // Moon Keep, after Low Orbit: soft corners. Chromium's GPU raster draws a path whose screen
    // box is square-ish and middling (both sides about 200-324 px) with a softer antialiasing
    // that rounds every cell corner, even where cells sit on whole pixels: at 6 px a cell a box
    // of about 33 to 54 cells a side, at 8 px 25 to 40. A path is closed before its box would
    // have a short side of maxRows cells or more, a long side of MAX_SIDE or less, and a ratio
    // under 1.7. Moon Keep uses maxRows 24 (6 and 8 px a cell clean, 9 px better than before;
    // lower costs more); maxRows = Infinity turns this off.
    if (cur.length && maxRows !== Infinity) {
      let x0 = Infinity
      let x1 = -Infinity
      for (const k of cur) {
        x0 = Math.min(x0, kx(k))
        x1 = Math.max(x1, kx(k))
      }
      x0 = Math.min(x0, kx(row[0]))
      x1 = Math.max(x1, kx(row[row.length - 1]))
      const w = x1 - x0 + 1
      const h = y - ky(cur[0]) + 1
      const lo = Math.min(w, h)
      const hi = Math.max(w, h)
      if (lo >= maxRows && hi <= MAX_SIDE && hi <= lo * 1.7) close()
    }
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

// Moon Keep's addition: bridging. A colour drawn early may also lie under cells of colours
// drawn after it, which cover it there completely. Where two of its runs in a row are parted
// only by such cells, the gap is filled and the two runs become one, which writes shorter. It
// is done only where no new hairline can come of it: every edge of a filled cell must lie over
// the colour on both sides (its neighbour is the colour's own or filled cell) or be covered by
// the later colours themselves (the same colour on both sides, or a pair the encoder already
// lays one under the other). Cells on the layer's outer edge are never filled.
function bridge(layer, s, own, r, rank, back, pair) {
  const ownSet = new Set(own)
  const later = k => {
    const c = layer.m.get(k)
    return c !== undefined && c !== back && rank.get(c) > r
  }
  const covered = (p, q) => layer.m.get(p) === layer.m.get(q) || pair(p, q)
  const rows = new Map()
  for (const k of s) {
    const y = ky(k)
    let l = rows.get(y)
    if (!l) rows.set(y, (l = []))
    l.push(kx(k))
  }
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) {
      const a = xs[i - 1]
      const b = xs[i]
      if (b - a < 2) continue
      const gap = []
      for (let x = a + 1; x < b; x++) gap.push(key(x, y))
      const inGap = new Set(gap)
      let ok = gap.every(later)
      for (const p of gap) {
        if (!ok) break
        for (const q of [p - 1, p + 1, p - ROW, p + ROW]) {
          if (ownSet.has(q)) continue
          if (s.has(q) || inGap.has(q)) {
            if (!covered(p, q)) ok = false
          } else if (!later(q) || !covered(p, q)) ok = false
          if (!ok) break
        }
      }
      if (ok) for (const p of gap) s.add(p)
    }
  }
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
  // Moon Keep, after Low Orbit: outer edge. Where the layer's outer edge falls inside a screen
  // pixel, the backing under an edge cell shows there by up to a quarter, a line along the edge.
  // So an edge cell far from the backing is not backed, unless a cell of the backing's own colour
  // touches it (the backing must lie under that edge, which nothing else covers).
  const has = k => layer.m.has(k)
  const outer = k => !has(k - 1) || !has(k + 1) || !has(k - ROW) || !has(k + ROW)
  const nextToBack = k => [k - 1, k + 1, k - ROW, k + ROW].some(n => layer.m.get(n) === back)
  const backed = k => !!back && !(o.edge && outer(k) && shows(layer.m.get(k)) && !nextToBack(k))
  // Whether the encoder lays the earlier of two touching colours under the later one: where both
  // are far from the backing, or where either cell has no backing beneath (then the layers below
  // would show between them).
  const pair = (p, q) => !backed(p) || !backed(q) || (shows(layer.m.get(p)) && shows(layer.m.get(q)))
  const paths = []
  if (back) paths.push([back, chunks([...layer.m.keys()].filter(backed), maxRuns, o.join, o.maxRows)])
  const sets = new Map()
  for (const c of colours) {
    const own = byColor.get(c)
    const r = rank.get(c)
    const s = new Set(own)
    for (const k of own) {
      for (const n of [k - 1, k + 1, k - ROW, k + ROW]) {
        const nc = layer.m.get(n)
        if (nc === undefined || nc === back || rank.get(nc) <= r) continue
        if (pair(k, n)) s.add(n)
      }
    }
    if (o.bridge) bridge(layer, s, own, r, rank, back, pair)
    sets.set(c, s)
  }
  // Moon Keep, after Low Orbit: corners. Where four cells meet and the earliest of their colours
  // holds only one of them, the 4-neighbour cover leaves the corner pixel with no one colour
  // under all of it, and what lies beneath shows there as a dot. The earliest colour also covers
  // the rest of that block, unless the block is backed throughout and the backing is within T of
  // one of its colours.
  if (o.corners) {
    const seen = new Set()
    for (const k0 of layer.m.keys()) {
      for (const tl of [k0, k0 - 1, k0 - ROW, k0 - ROW - 1]) {
        if (seen.has(tl)) continue
        seen.add(tl)
        const blk = [tl, tl + 1, tl + ROW, tl + ROW + 1]
        const cs = blk.map(k => layer.m.get(k))
        if (cs.includes(undefined)) continue
        if (blk.every(backed) && cs.some(c => !shows(c))) continue
        let m = null
        for (const c of cs) if (c !== back && (m === null || rank.get(c) < rank.get(m))) m = c
        if (m === null) continue
        const s = sets.get(m)
        blk.forEach((k, i) => {
          if (cs[i] !== back && rank.get(cs[i]) > rank.get(m)) s.add(k)
        })
      }
    }
  }
  for (const c of colours) {
    const s = sets.get(c)
    let bare = false // some of the cells this colour covers have no backing beneath
    for (const k of s) if (!backed(k)) bare = true
    paths.push([c, chunks([...s], maxRuns, o.join && (o.joinAll || shows(c) || bare), o.maxRows)])
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
  // Moon Keep: order 'both' tries darkest first and largest first, and keeps the shorter.
  for (const order of o.order === 'both' ? ['lum', 'area'] : [o.order]) {
    const oo = { ...o, order }
    if (o.back !== 'always') tries.push(encodeWith(layer, byColor, null, oo))
    if (o.back !== 'none' && byColor.size > 1) tries.push(encodeWith(layer, byColor, top, oo))
    if (!tries.length) tries.push(encodeWith(layer, byColor, null, oo))
  }
  return tries.reduce((a, b) => (b.length < a.length ? b : a))
}
