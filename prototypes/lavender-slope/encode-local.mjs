// Lavender Slope's local copy of the encoder: tide-line/encode-local.mjs as it was on 2026-11-15
// (engine/encode.mjs plus under(k, n), edge and the row cap; see its notes below), with two
// changes of Lavender Slope's own. engine/ is shared and was not edited.
// L1. Tile colours. A cell may hold a pattern paint, 'url(#Ta)': a hedge texture tile. The
//     encoder orders colours by brightness and measures how far apart they are, so each such
//     paint is given a plain colour that stands for it (the tile's mean) with setTone(paint,
//     hex). An unknown paint counts as black.
// L2. Corners (option corners, default false), after low-orbit/harbor change 2: where four cells
//     meet and the earliest of their colours holds only one of them, the 4-neighbour cover leaves
//     the corner pixel without one colour under all of it; the earliest colour then also covers
//     the rest of that 2x2 block.
// L3. Joins (with `under`): two chunks (paths) of one colour overlap only where the colour known to
//     lie beneath their join is more than T from that colour. The field's hedge colours lie over
//     bands of the commonest tile of their row; overlapping every join cost about 11k
//     characters at sunset.
// L4. Texels (option vis(k, c): the colour paint c shows in cell k). For tile paints, what lies
//     beneath an edge (`under`, then the texels of the band there) and the two cells' own colours
//     are compared texel by texel, not by the tiles' means.
// L5. Pieces (in chunks): a colour's 4-connected pieces are packed into paths whole, with no join
//     between them; only a piece too busy for one path, or too big both ways for the row cap, is
//     cut into rows with joins.
// L6. Leaks (option shown(m): what shows at a cell outside the layer): a colour laid under a
//     cell is taken back out where it would show along the cell's other edges, between two
//     alike colours, more than the join it covers would (see encodeWith).
// Tide Line's notes follow.
//
// Tide Line's local copy of the BackdropKit engine encoder (../../engine/encode.mjs), with one
// option added: `under(k, n)`, the colour known to lie beneath the edge between cells k and n
// (undefined when unknown). The engine treats what lies beneath an unbacked layer as unknown, so
// it joins every pair of neighbouring colours. Tide Line's sky, sea and sand are bands with the
// odd cells over them, and the band under each edge is known: two cells only need joining where
// that band is far from both of them. Without this the sand alone cost 6,000 more characters.
// Two more local changes:
// - `edge`: nothing else lies under a cell on the layer's outer edge: not the backing (unless
//   near the cell's colour), not a neighbour's colour joined under it. Either would show along
//   the outside of the edge (the log's shadow fading into the sand; the skirted overlays; the
//   moving wave parts and grass tips, whose edges meet colours like their own).
// - Row cap (after low-orbit and deep-reef): a path whose box would be over MAX_ROWS cells
//   both wide and high is cut. Chromium's GPU raster softens and rounds every cell corner of a
//   path whose screen box is square-ish and middling (both sides over about 200-256 px); here
//   the moon and sun glitter on the sea, at 8 and 9 px a cell, which the original showed too.
// Everything else is the engine's code, unchanged.
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
const MAX_ROWS = 21 // local: see the header

// L1: plain colours standing for pattern paints.
const tones = new Map()
export const setTone = (paint, hex) => tones.set(paint, hex)
const hexOf = c => (c[0] === '#' ? c : tones.get(c) ?? '#000')

const lum = c => {
  const h = hexOf(c)
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
// L5: whole pieces first. A colour's cells fall into pieces (4-connected). Pieces that fit in a
// path are packed into paths whole, so no two paths of the colour touch along an edge and no
// join is needed between them; only a piece too big for one path is cut into rows (rowChunks),
// with its joins. A piece whose box is over maxRows both ways is cut into rows too, and packed
// paths keep to the cap: at most maxRows rows or at most maxRows across. (Chromium rounds the
// corners of a path box past that size: soft corners, lines at whole-pixel sizes.)
function chunks(cellKeys, maxRuns, overlap = true, maxRows = Infinity) {
  const all = new Set(cellKeys)
  const seen = new Set()
  const pieces = []
  for (const k0 of [...cellKeys].sort((a, b) => a - b)) {
    if (seen.has(k0)) continue
    const piece = [k0]
    seen.add(k0)
    for (let i = 0; i < piece.length; i++) {
      const k = piece[i]
      for (const n of [k - 1, k + 1, k - ROW, k + ROW]) if (all.has(n) && !seen.has(n)) {
        seen.add(n)
        piece.push(n)
      }
    }
    pieces.push(piece)
  }
  const segsOf = ks => segments(ks.map(k => [kx(k), ky(k)]))
  const done = new Set()
  const out = []
  let cur = []
  let box = null
  const close = () => {
    if (cur.length) out.push(segsOf(cur))
    cur = []
    box = null
  }
  for (const piece of pieces) {
    let b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }
    for (const k of piece) {
      b.x0 = Math.min(b.x0, kx(k))
      b.x1 = Math.max(b.x1, kx(k))
      b.y0 = Math.min(b.y0, ky(k))
      b.y1 = Math.max(b.y1, ky(k))
    }
    const tall = b.y1 - b.y0 + 1 > maxRows && b.x1 - b.x0 + 1 > maxRows
    if (tall || segsOf(piece).length > maxRuns) {
      out.push(...rowChunks(piece, maxRuns, overlap, maxRows, done))
      continue
    }
    if (cur.length) {
      const u = { x0: Math.min(box.x0, b.x0), x1: Math.max(box.x1, b.x1), y0: Math.min(box.y0, b.y0), y1: Math.max(box.y1, b.y1) }
      const w = u.x1 - u.x0 + 1
      const ok = (u.y1 - u.y0 + 1 <= maxRows || w <= maxRows) && segsOf(cur.concat(piece)).length <= maxRuns
      if (ok) {
        cur = cur.concat(piece)
        box = u
        continue
      }
      close()
    }
    cur = piece
    box = b
  }
  close()
  return out
}

function rowChunks(cellKeys, maxRuns, overlap = true, maxRows = Infinity, done = new Set()) {
  const rows = new Map()
  for (const k of cellKeys) {
    const y = ky(k)
    let r = rows.get(y)
    if (!r) rows.set(y, (r = []))
    r.push(k)
  }
  const out = []
  const withOverlap = ks => {
    if (!overlap) return ks
    const s = new Set(ks)
    for (const k of ks) {
      for (const n of [k - 1, k + 1, k - ROW, k + ROW]) if (done.has(n) && (overlap === true || overlap(k, n))) s.add(n)
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
    // Local: a path more than maxRows cells wide spans at most maxRows rows (see the header).
    if (cur.length && y - ky(cur[0]) + 1 > maxRows) {
      let x0 = Infinity
      let x1 = -Infinity
      for (const k of cur.concat(row)) {
        x0 = Math.min(x0, kx(k))
        x1 = Math.max(x1, kx(k))
      }
      if (x1 - x0 + 1 > maxRows) close()
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

const rgbOf = c => {
  const h = hexOf(c)
  const s = h.slice(1).length === 3 ? h.slice(1).replace(/./g, c => c + c) : h.slice(1)
  const n = parseInt(s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
// How far apart two colours look, as the mean of the channel differences (0..255).
export const apart = (a, b) => {
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
  // Local change (with opts.edge, as in low-orbit/encode-local.mjs): a cell on the layer's
  // outer edge is backed only when its colour is within T of the backing. A backing cell's
  // outer edge lies exactly on the edge of the cell drawn over it, so the backing would show
  // along the outside of the layer, as a line wherever what lies outside matches that cell (a
  // shadow fading into the sand under the log, a dark grass tip over a dark blade under a pale
  // tip colour). Such a cell is joined to its neighbours like an unbacked layer's instead.
  const nbrs = k => [k - 1, k + 1, k - ROW, k + ROW]
  let backed = null
  if (back) {
    backed = new Set()
    for (const [k, c] of layer.m) {
      if (!o.edge || apart(back, c) <= T || !nbrs(k).some(n => !layer.m.has(n))) backed.add(k)
    }
  }
  // Whether what lies beneath the edge between k (colour c) and n (colour nc) is far from both.
  // L4: the colour a cell shows (a tile paint's texel there), when opts.vis gives it.
  const vis = o.vis ?? ((k, c) => c)
  const far = (k, n, c, nc) => {
    if (back) {
      if (backed.has(k) && backed.has(n)) return apart(back, c) > T && apart(back, nc) > T
      return true
    }
    if (!o.under) return true
    const u = o.under(k, n)
    if (u === undefined) return true
    const vk = vis(k, c)
    const vn = vis(n, nc)
    for (const b of Array.isArray(u) ? u : [u]) if (b === undefined || (apart(b, vk) > T && apart(b, vn) > T)) return true
    return false
  }
  const paths = []
  if (back) paths.push([back, chunks([...backed], maxRuns, o.join, o.maxRows)])
  const sets = new Map()
  for (const c of colours) {
    const own = byColor.get(c)
    const r = rank.get(c)
    const s = new Set(own)
    for (const k of own) {
      for (const n of nbrs(k)) {
        const nc = layer.m.get(n)
        if (nc === undefined || nc === back || rank.get(nc) <= r) continue
        // Local change (with opts.edge): no colour is laid under a cell on the layer's outer
        // edge. It would show along the outside of that edge, as a line wherever what lies
        // outside matches the cell (a swell's lit crest against the lit sea row above it).
        // The join between the two cells then shows what lies beneath, but there the two
        // colours differ, so it reads as part of their edge.
        if (o.edge && nbrs(n).some(m => !layer.m.has(m))) continue
        if (far(k, n, c, nc)) s.add(n)
      }
    }
    sets.set(c, s)
  }
  // L6: a colour c laid under a cell n shows along n's other edges (n, m), where nothing drawn
  // after it covers that edge from both sides (m's colour laid under n, n's colour laid under m,
  // or the two the same; m may lie outside the layer: opts.shown(m) is what shows there). What
  // shows is c's texel at n, and, a tile being a bitmap that blurs at fractional sizes, some of
  // c's texel at m. Where m looks like n, that is a line when c's texels are far from both.
  // Taking c back out from under n shows instead what lies beneath the join c covered (c's own
  // cell beside n against n), a line only where those two look alike. The lesser is kept.
  if (o.shown && !back) {
    const w = (t, a, b) => Math.min(apart(t, a), apart(t, b))
    for (const c of colours) {
      const s = sets.get(c)
      const r = rank.get(c)
      for (const n of [...s]) {
        const nc = layer.m.get(n)
        if (nc === c) continue
        const vn = vis(n, nc)
        let keep = 0
        for (const m of nbrs(n)) {
          const cm = layer.m.get(m)
          if (cm === c || cm === nc || s.has(m)) continue
          let vm
          if (cm === undefined) {
            vm = o.shown(m)
            if (vm === undefined) continue
          } else {
            if ((rank.get(cm) > r && sets.get(cm).has(n)) || sets.get(nc).has(m)) continue
            vm = vis(m, cm)
          }
          if (apart(vm, vn) > ALIKE) continue
          keep = Math.max(keep, 0.25 * w(vis(n, c), vn, vm), 0.15 * w(vis(m, c), vn, vm))
        }
        if (keep <= LINE) continue
        let drop = 0
        for (const k of nbrs(n)) {
          if (layer.m.get(k) !== c) continue
          const vk = vis(k, c)
          if (apart(vk, vn) > ALIKE) continue
          const u = o.under ? o.under(k, n) : undefined
          if (u === undefined) drop = Infinity
          else for (const b of Array.isArray(u) ? u : [u]) drop = Math.max(drop, b === undefined ? Infinity : 0.25 * w(b, vk, vn))
        }
        if (drop < keep) s.delete(n)
      }
    }
  }
  // L2: corners (see the header). Skipped where the block's earliest colour is within T of all
  // four (nothing far shows), and where a block cell lies on the outer edge with opts.edge.
  if (o.corners) {
    const seen = new Set()
    for (const k0 of layer.m.keys()) {
      for (const tl of [k0, k0 - 1, k0 - ROW, k0 - ROW - 1]) {
        if (seen.has(tl)) continue
        seen.add(tl)
        const blk = [tl, tl + 1, tl + ROW, tl + ROW + 1]
        const cs = blk.map(k => layer.m.get(k))
        if (cs.includes(undefined) || cs.includes(back)) continue
        let m = null
        for (const c of cs) if (m === null || rank.get(c) < rank.get(m)) m = c
        if (cs.filter(c => c === m).length > 1) continue
        if (o.edge && blk.some(k => nbrs(k).some(n => !layer.m.has(n)))) continue
        const s = sets.get(m)
        blk.forEach((k, i) => {
          if (rank.get(cs[i]) > rank.get(m) && far(blk[0], k, m, cs[i])) s.add(k)
        })
      }
    }
  }
  // L3: two chunks of one colour need to overlap only where what lies beneath their join is far
  // from that colour; with `under`, that is known for each join.
  const joinOf = c => {
    if (!o.join || !shows(c)) return false
    if (back || !o.under) return true
    return (k, n) => {
      const u = o.under(k, n)
      if (u === undefined) return true
      const vk = vis(k, c)
      const vn = vis(n, c)
      for (const b of Array.isArray(u) ? u : [u]) if (b === undefined || (apart(b, vk) > T && apart(b, vn) > T)) return true
      return false
    }
  }
  for (const c of colours) paths.push([c, chunks([...sets.get(c)], maxRuns, joinOf(c), o.maxRows)])
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
//   order: 'lum' (darkest first), 'area' (largest first) or 'both' (local default: tries
//      both and keeps the shorter; after moon-keep);
//   q: the quote character (default ");
//   under (local): (k, n) => the colour (or [colours]) beneath the edge between cells k and n;
//   edge (local): keep the backing off outer-edge cells far from it (see encodeWith).
const ALIKE = 10
// A leak this far (mean of the channels, after its weight) reads as a line.
const LINE = 6
export function emitSafe(layer, opts = {}) {
  const o = { ox: 0, oy: 0, q: '"', maxRuns: MAX_RUNS, maxRows: MAX_ROWS, T: 28, order: 'both', back: 'auto', join: true, ...opts }
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
  for (const order of o.order === 'both' && !o.edge ? ['lum', 'area'] : [o.order === 'both' ? 'lum' : o.order]) {
    const oo = { ...o, order }
    if (o.back !== 'always') tries.push(encodeWith(layer, byColor, null, oo))
    if (o.back !== 'none' && byColor.size > 1) tries.push(encodeWith(layer, byColor, top, oo))
    if (o.back === 'always' && byColor.size === 1) tries.push(encodeWith(layer, byColor, null, oo))
  }
  return tries.reduce((a, b) => (b.length < a.length ? b : a))
}

// Runs (subpaths) in a piece of SVG, the count the player's rule is about.
export const runsIn = svg => (svg.match(/[Mm][-.\d]/g) ?? []).length
