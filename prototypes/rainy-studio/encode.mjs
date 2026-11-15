// Rainy Studio's local copy of the BackdropKit engine's seam-proof encoder (engine/encode.mjs),
// extended for see-through colours (#rrggbbaa). The engine's emitSafe reads every colour as
// #rrggbb, and both of its fixes (drawing a colour under its neighbours, and overlapping split
// paths) would stack a see-through colour on itself and change the picture. This copy keeps the
// engine's behaviour for solid colours and adds, for see-through ones:
// - Levels instead of under-drawing. The cells of one base colour are drawn as nested levels:
//   level k covers every cell whose alpha is at least the k-th alpha, with the alpha that brings
//   the stack to exactly that value. A cell's picture is unchanged at whole-pixel sizes, and the
//   edge between two alphas of one colour always lies over the solid lower levels.
// - Drawn under the solid colours beside them. A see-through colour's paths also cover the
//   neighbouring solid cells of the layer, which are drawn later and hide them; so a solid edge
//   lies over the see-through neighbour, not over whatever is beneath the layer.
// - Split by runs, never inside one. A see-through colour with more than MAX_RUNS runs is cut
//   between whole runs (a rain streak stays one run), and the paths do not overlap.
//
// Cells use Sunfield's Layer (tools/pixel.mjs): key = (y + 1000) * 4096 + (x + 1000), and the
// caller shifts the picture down half a cell, so a run on row y is a stroke-width-1 line at y.

const OFF = 1000
const ROW = 4096
const RING8 = [-1, 1, -ROW, ROW, -ROW - 1, -ROW + 1, ROW - 1, ROW + 1]
const key = (x, y) => (y + OFF) * ROW + (x + OFF)
const kx = k => (k % ROW) - OFF
const ky = k => Math.floor(k / ROW) - OFF
const MAX_RUNS = 64

// [r, g, b, a] of #rgb, #rgba, #rrggbb or #rrggbbaa (a in 0..255).
export function parse(h) {
  let s = h.slice(1)
  if (s.length === 3 || s.length === 4) s = s.replace(/./g, c => c + c)
  const n = parseInt(s.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, s.length === 8 ? parseInt(s.slice(6), 16) : 255]
}
export const clear = h => parse(h)[3] < 255
const lum = h => {
  const [r, g, b] = parse(h)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
// How far apart two colours look, as the mean of the channel differences (0..255).
export const apart = (a, b) => {
  const x = parse(a)
  const y = parse(b)
  return (Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2])) / 3
}

function shortHex(h) {
  if (h.length === 9 && h.endsWith('ff')) h = h.slice(0, 7)
  if (h.length === 7 && h[1] === h[2] && h[3] === h[4] && h[5] === h[6]) return '#' + h[1] + h[3] + h[5]
  if (h.length === 9 && h[1] === h[2] && h[3] === h[4] && h[5] === h[6] && h[7] === h[8]) return '#' + h[1] + h[3] + h[5] + h[7]
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

// The cells a segment covers.
function cellsOf(s) {
  const out = []
  const n = +s.cmd.slice(s.cmd[1] === '-' ? 2 : 1)
  if (s.cmd[0] === 'h') {
    const x0 = Math.min(s.sx, s.ex)
    for (let i = 0; i < n; i++) out.push(key(x0 + i, s.sy))
  } else {
    const y0 = Math.min(s.sy, s.ey) + 0.5
    for (let i = 0; i < n; i++) out.push(key(s.sx - 0.5, y0 + i))
  }
  return out
}

// Cuts one solid colour's cells into paths of at most maxRuns runs. (The engine cuts by whole
// rows, which breaks every vertical run, the window stripes of the far towers, into one run per
// row; this cuts the colour's own list of runs instead, keeping each run whole.) Each later path
// also covers the cells of earlier paths that touch it, so the join between two paths lies over
// the same colour.
function chunks(cellKeys, maxRuns, overlap = true) {
  const all = segments(cellKeys.map(k => [kx(k), ky(k)]))
  if (fits(all, maxRuns)) return [all]
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
  let i = 0
  while (i < all.length) {
    // The longest stretch of runs from i that still fits one path with its joins.
    const at = n => {
      const ks = all.slice(i, i + n).flatMap(cellsOf)
      return { n, ks, segs: segsOf(withOverlap(ks)) }
    }
    let best = at(1)
    let lo = 2
    let hi = Math.min(maxRuns, all.length - i)
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const t = at(mid)
      if (fits(t.segs, maxRuns)) {
        best = t
        lo = mid + 1
      } else hi = mid - 1
    }
    out.push(best.segs)
    for (const k of best.ks) done.add(k)
    i += best.n
  }
  return out
}

// Chromium's GPU raster draws a path whose box on screen is square-ish and middling (both sides
// over about 200 px; found in low-orbit, and deep-reef found 21 cells enough) with softer
// antialiasing that rounds every cell corner, even on whole
// pixels (found in low-orbit). So a path holds at most maxRuns runs and its box is at most
// MAX_SPAN cells across in one of its two directions.
const MAX_SPAN = Number(process.env.SPAN ?? 21)
function fits(segs, maxRuns) {
  if (segs.length > maxRuns) return false
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const s of segs) {
    x0 = Math.min(x0, s.sx, s.ex)
    x1 = Math.max(x1, s.sx, s.ex)
    y0 = Math.min(y0, s.sy, s.ey)
    y1 = Math.max(y1, s.sy, s.ey)
  }
  return Math.min(x1 - x0, y1 - y0) <= MAX_SPAN
}

// A see-through colour's cells as paths of at most maxRuns whole runs each, no overlap.
function runChunks(cellKeys, maxRuns) {
  const segs = segments(cellKeys.map(k => [kx(k), ky(k)]))
  const out = []
  let cur = []
  for (const s of segs) {
    if (cur.length && !fits(cur.concat([s]), maxRuns)) {
      out.push(cur)
      cur = []
    }
    cur.push(s)
  }
  if (cur.length) out.push(cur)
  return out
}
// (A path's segments are written as one 'M' and then relative moves, so a slice of the list is
// a path of its own.)

function write(paths, ox, oy, q) {
  let out = ''
  for (const [c, segsList] of paths) {
    const ds = segsList.map(segs => data(segs, ox, oy)).filter(Boolean)
    if (!ds.length) continue
    const col = shortHex(c)
    if (ds.length === 1) out += '<path stroke=' + q + col + q + ' d=' + q + ds[0] + q + '/>'
    else out += '<g stroke=' + q + col + q + '>' + ds.map(p => '<path d=' + q + p + q + '/>').join('') + '</g>'
  }
  return out
}

const hex2 = v => Math.round(v).toString(16).padStart(2, '0')

// The see-through cells (see the top of the file). Where two see-through cells of alphas a and
// b meet with nothing solid under them, the edge pixel loses up to a * b / 4 of the colour's
// step from what lies beneath; levels and under-drawing are used only where that, or a / 4 for
// a see-through cell beside a solid one, could pass T / 4 (T is in channel levels of 255).
function encodeClear(layer, byColor, o) {
  const f = o.T / 255
  const baseOf = c => c.slice(0, 7)
  const alphaOf = c => parse(c)[3]
  const solidAt = k => {
    const c = layer.m.get(k)
    return c !== undefined && !clear(c)
  }
  // Groups of touching cells of one base colour; each group is drawn as its own levels.
  const paths = new Map() // colour -> keys
  const add = (c, ks) => paths.set(c, (paths.get(c) ?? []).concat(ks))
  const seen = new Set()
  for (const [k0, c0] of layer.m) {
    if (seen.has(k0) || !clear(c0)) continue
    const base = baseOf(c0)
    const group = []
    const stack = [k0]
    seen.add(k0)
    while (stack.length) {
      const k = stack.pop()
      group.push(k)
      for (const n of [k - 1, k + 1, k - ROW, k + ROW]) {
        const c = layer.m.get(n)
        if (c !== undefined && !seen.has(n) && clear(c) && baseOf(c) === base) {
          seen.add(n)
          stack.push(n)
        }
      }
    }
    const byA = new Map()
    for (const k of group) {
      const a = alphaOf(layer.m.get(k))
      byA.set(a, (byA.get(a) ?? []).concat([k]))
    }
    const alphas = [...byA.keys()].sort((a, b) => a - b)
    const top = alphas[alphas.length - 1] / 255
    let have = 0 // the stack's alpha so far, 0..1
    alphas.forEach((a, i) => {
      // A level stands on the one below only where the step between them could show.
      if (i > 0 && (alphas[i - 1] / 255) * top <= f) have = 0
      const nested = i + 1 < alphas.length && (a / 255) * top > f
      const want = a / 255
      // This level's alpha, so the stack reaches `want`; rounded to the byte that lands closest.
      const e = Math.min(255, Math.max(1, Math.round(((want - have) / (1 - have)) * 255)))
      have = have + (1 - have) * (e / 255)
      const s = new Set(byA.get(a))
      if (nested) for (const b of alphas.slice(i + 1)) for (const k of byA.get(b)) s.add(k)
      if (o.under !== false) {
        for (const k of [...s]) {
          if (alphaOf(layer.m.get(k)) / 255 <= f) continue
          for (const n of [k - 1, k + 1, k - ROW, k + ROW]) if (solidAt(n)) s.add(n)
        }
      }
      add(base + hex2(e), [...s])
      if (!nested) have = 0
    })
  }
  const out = []
  for (const c of [...paths.keys()].sort((a, b) => lum(a) - lum(b) || alphaOf(a) - alphaOf(b))) {
    out.push([c, runChunks([...new Set(paths.get(c))], o.maxRuns)])
  }
  return write(out, o.ox, o.oy, o.q)
}

// One encoding of the layer's solid cells. `back` is the colour laid under all of them first,
// or null. Each other colour also covers the neighbouring solid cells of colours drawn after
// it, but only where a hairline would show: where what lies beneath (the backing, or for no
// backing the unknown layers below, treated as far from everything) is more than T from both.
// Edge cells are the solid cells on the layer's outline, those with a side on a cell the layer
// does not paint solid, and opts.edge, cells along a cut (where this layer is one piece of a
// bigger one and is drawn over the piece before it, which holds a copy of them), these unless
// their colour is within T of the backing. In the engine's scheme a colour drawn under its later
// neighbours, and the backing, reach the outline too; paths whose edges coincide there are
// each antialiased on their own, so at an outline the colours drawn under an edge cell fringe
// it (a light ledge on light towers came out 97% opaque and darker). So nothing lies under an
// edge cell: it gets no backing and no colour is drawn under it, except an edge neighbour
// within T of it. Edge colours are drawn right after the backing, each also under its inner
// neighbours, so the edge between an edge cell and an inner one lies over the edge colour;
// inner cells of the backing colour that got one are redrawn.
function encodeWith(layer, byColor, back, o) {
  const { maxRuns, T, order } = o
  const solidAt = n => {
    const c = layer.m.get(n)
    return c !== undefined && !clear(c)
  }
  // A cut cell within T of the backing keeps the backing under it: what lies beside it is the
  // previous piece's copy of the same cells, so its fringe is at most T / 4. An outline cell
  // never does: there the fringe is a quarter of the backing against whatever is behind the
  // layer (a tower's edge over the pale far city came out 22 levels dark at 4.5 px a cell).
  const near = k => back && apart(layer.m.get(k), back) <= T
  const edge = new Set([...(o.edge ?? [])].filter(k => solidAt(k) && !near(k)))
  // opts.behind(k) gives the solid colour already on screen at a cell outside the layer, or
  // null where that is unknown (moving or see-through things, another viewport). An outline
  // cell whose outside neighbours are all known and within TB of the backing is soft: it keeps
  // the backing under it (its fringe is at most TB / 4), and any other colour may go under it
  // only when that colour is within TB of them too.
  const TB = o.TB ?? 20
  const soft = new Map()
  const outsideOf = k => {
    const vs = []
    for (const d of RING8) {
      const n = k + d
      if (solidAt(n)) continue
      if (layer.m.has(n)) return null
      const v = o.behind(n)
      if (!v) return null
      vs.push(v)
    }
    return vs
  }
  for (const [k, c] of layer.m) {
    if (o.outline === false || clear(c) || [k - 1, k + 1, k - ROW, k + ROW].every(solidAt)) continue
    if (back && o.behind && !edge.has(k)) {
      const vs = outsideOf(k)
      if (vs && vs.every(v => apart(back, v) <= TB)) {
        soft.set(k, vs)
        continue
      }
    }
    edge.add(k)
  }
  // May colour c be drawn under cell n?
  const underOK = (n, c) => !soft.has(n) || soft.get(n).every(v => apart(c, v) <= TB)
  const inner = new Map()
  const outer = new Map()
  for (const [c, ks] of byColor) {
    if (clear(c)) continue
    for (const k of ks) {
      const m = edge.has(k) ? outer : inner
      let l = m.get(c)
      if (!l) m.set(c, (l = []))
      l.push(k)
    }
  }
  const colours = [...inner.keys()].filter(c => c !== back)
  if (order === 'area') colours.sort((a, b) => inner.get(b).length - inner.get(a).length || lum(a) - lum(b))
  else colours.sort((a, b) => lum(a) - lum(b))
  const rank = new Map(colours.map((c, i) => [c, i]))
  const shows = c => (back ? apart(back, c) > T : true)
  const solidInner = n => {
    const nc = layer.m.get(n)
    return nc !== undefined && !clear(nc) && !edge.has(n)
  }
  const paths = []
  if (back) paths.push([back, chunks([...inner.values()].flat(), maxRuns, o.join)])
  const edgeColours = [...outer.keys()].sort((a, b) => lum(a) - lum(b))
  const edgeRank = new Map(edgeColours.map((c, i) => [c, i]))
  const redraw = []
  // Inner cells that got another colour drawn under them (by an edge colour, the redraw or a
  // dilation), so they differ underneath from the edge cells of their own colour.
  const under = new Set()
  // Bridges (Moon Keep's idea): a path also fills the gaps along a row or a column between its
  // cells where every gap cell is an inner cell that a later path paints anyway. It is then
  // written as fewer, longer runs. What it puts under those cells is what a dilation would.
  const bridge = (s, ok) => {
    if (!o.bridge) return s
    const dirs = o.bridge === 'rows' ? [[1, ky]] : o.bridge === 'cols' ? [[ROW, kx]] : [[1, ky], [ROW, kx]]
    for (const [step, line] of dirs) {
      const groups = new Map()
      for (const k of s) {
        const l = line(k)
        let g = groups.get(l)
        if (!g) groups.set(l, (g = []))
        g.push(k)
      }
      for (const g of groups.values()) {
        g.sort((a, b) => a - b)
        for (let i = 1; i < g.length; i++) {
          const n = (g[i] - g[i - 1]) / step - 1
          if (n < 1) continue
          let fine = true
          for (let j = 1; j <= n && fine; j++) fine = ok(g[i - 1] + j * step)
          if (fine) for (let j = 1; j <= n; j++) s.add(g[i - 1] + j * step)
        }
      }
    }
    return s
  }
  const laterInner = k => solidInner(k) && layer.m.get(k) !== back
  for (const c of edgeColours) {
    const s = new Set(outer.get(c))
    for (const k of outer.get(c)) {
      for (const n of [k - 1, k + 1, k - ROW, k + ROW]) {
        const nc = layer.m.get(n)
        if (solidInner(n) && underOK(n, c)) {
          s.add(n)
          if (nc === back) {
            if (c !== back) redraw.push(n)
          } else if (nc !== c) under.add(n)
        } else if (edge.has(n) && nc !== undefined && !clear(nc) && edgeRank.get(nc) > edgeRank.get(c) && apart(c, nc) <= T) s.add(n)
      }
    }
    bridge(s, k => laterInner(k) && underOK(k, c))
    for (const k of s) if (solidInner(k) && layer.m.get(k) !== back && layer.m.get(k) !== c) under.add(k)
    paths.push([c, chunks([...s], maxRuns, o.join)])
  }
  if (redraw.length) {
    // The redraw also covers the inner cells around the redrawn ones (8 neighbours): the
    // backing under them already, or a colour drawn later on top. Its edge then lies over the
    // backing, not over the edge colour under the redrawn cells, which leaked (a dark line
    // along the train's lower band, at the foot of every window pillar).
    const r = new Set(redraw)
    for (const k of redraw) {
      for (const d of RING8) if (solidInner(k + d)) r.add(k + d)
    }
    bridge(r, solidInner)
    paths.push([back, chunks([...r], maxRuns, o.join)])
    for (const k of r) if (layer.m.get(k) !== back) under.add(k)
  }
  for (const c of colours) {
    const own = inner.get(c)
    const r = rank.get(c)
    const s = new Set(own)
    if (shows(c)) {
      for (const k of own) {
        for (const n of [k - 1, k + 1, k - ROW, k + ROW]) {
          if (!solidInner(n)) continue
          const nc = layer.m.get(n)
          if (nc === back || !rank.has(nc) || rank.get(nc) <= r) continue
          if (shows(nc) && underOK(n, c)) s.add(n)
        }
      }
    }
    bridge(s, k => laterInner(k) && rank.get(layer.m.get(k)) > r && underOK(k, c))
    // An inner cell that got another colour drawn under it after the edge pass, next to an edge
    // cell of its own colour (drawn in the edge pass), would meet it across two paths of one
    // colour over different things: the colour under leaked as a line (dark rows inside the
    // lamp-lit rim of the plant). So this path also takes those edge cells.
    const oc = outer.get(c)
    if (oc) {
      const ownSet = new Set(own)
      for (const k of oc) {
        if (RING8.some(d => ownSet.has(k + d) && under.has(k + d))) s.add(k)
      }
    }
    for (const k of s) if (layer.m.get(k) !== c) under.add(k)
    paths.push([c, chunks([...s], maxRuns, o.join && shows(c))])
  }
  return write(paths, o.ox, o.oy, o.q)
}

// The layer as SVG: its see-through cells first (levels), then its solid cells, the shortest
// of backed by their commonest colour or not backed. opts:
//   ox, oy: written relative to this corner (a pattern tile's corner);
//   T: the largest step (mean channel difference) a hairline may show (default 28);
//   back: 'auto' (default), 'none', or 'always';
//   order: 'both' (default: darkest first and largest first, the shorter kept), 'lum' or 'area';
//   bridge: 'try' (default: along rows and not at all, the shorter kept), 'rows', 'cols',
//     true (both) or false: paths fill gaps that later paths paint (see encodeWith);
//   under: false stops see-through colours from being drawn under their solid neighbours;
//   edge: a Set of cell keys along cuts (see encodeWith);
//   q: the quote character (default ").
export function emitSafe(layer, opts = {}) {
  const o = { ox: 0, oy: 0, q: '"', maxRuns: MAX_RUNS, T: 28, order: 'both', back: 'auto', join: true, bridge: 'try', ...opts }
  if (o.order === 'both' || o.bridge === 'try') {
    let best = null
    for (const order of o.order === 'both' ? ['lum', 'area'] : [o.order]) {
      for (const bridge of o.bridge === 'try' ? ['rows', false] : [o.bridge]) {
        const s = emitSafe(layer, { ...o, order, bridge })
        if (best === null || s.length < best.length) best = s
      }
    }
    return best
  }
  const byColor = new Map()
  for (const [k, c] of layer.m) {
    let list = byColor.get(c)
    if (!list) byColor.set(c, (list = []))
    list.push(k)
  }
  if (!byColor.size) return ''
  const see = encodeClear(layer, byColor, o)
  const solids = [...byColor.keys()].filter(c => !clear(c))
  if (!solids.length) return see
  let top = null
  for (const c of solids) if (!top || byColor.get(c).length > byColor.get(top).length) top = c
  const tries = []
  if (o.back !== 'always') tries.push(encodeWith(layer, byColor, null, o))
  if (o.back !== 'none' && solids.length > 1) tries.push(encodeWith(layer, byColor, top, o))
  if (!tries.length) tries.push(encodeWith(layer, byColor, null, o))
  return see + tries.reduce((a, b) => (b.length < a.length ? b : a))
}

// Runs (subpaths) in a piece of SVG, the count the player's rule is about.
export const runsIn = svg => (svg.match(/[Mm][-.\d]/g) ?? []).length
