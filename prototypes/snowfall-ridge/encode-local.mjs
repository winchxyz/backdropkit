// Snowfall Ridge's local variant of BackdropKit's seam-proof encoder (engine/encode.mjs).
//
// Same idea as emitSafe: colours drawn darkest first, each covering the neighbouring cells of
// colours drawn after it, so every edge inside a layer lies over a solid colour that is between
// its two sides in brightness; the paths of one colour overlap where they join; a backing by the
// commonest colour when that writes shorter.
//
// What it changes: nothing drawn under a cell may reach that cell's OUTER edge (an edge with no
// cell of the layer beyond it) unless its colour is within T of the cell's. In emitSafe the
// backing covers every cell, and a dilation covers the whole neighbouring cell. At a layer's
// outline both then share the outline cell's outer edge, and where that edge falls inside a
// screen pixel the pixel takes in part of the colour beneath (c*a + d*a*(1-a) + below*(1-a)^2).
// A dark needle under the light snow on a spruce's outline, or a dark backing under a pale
// snowdrift, so outlined the whole edge of every still group in this scene.
// Here such an outline cell is covered from its inner neighbour only DELTA of a cell deep:
//  - from above or below, by a strip of runs DELTA off the row line (stroke width 1, so the
//    strip reaches DELTA into the outline cell and the rest lies inside the neighbour);
//  - from the side, by a short column run DELTA past the cell edge.
// DELTA is more than one screen pixel at every size from 3.4 px a cell up, so the pixel on the
// shared edge always has solid colour beneath, and the outline cell's far edges have nothing.
// A strip's end stops DELTA short where the outline cell's side is itself an outer edge.
// At whole-pixel sizes the picture is unchanged: everything added lies under later colours.
//
// Also added here, for size:
//  - hidden cells (opts.hidden): cells of no colour in the layer that an opaque still layer
//    above always covers (the cull's holes). An edge toward one is not an outer edge.
//  - bridges: a row of a colour runs on across a gap where every gap cell is hidden, or is a
//    later colour that the colour may lie under by the dilation rule. One run writes shorter
//    than two, and the gap's own colours are painted over it.
//  - the BACKS commonest colours are each tried as the backing, and the shortest kept.
//  - JOIN_T: the joins of a colour's paths overlap unless the backing is within JOIN_T of it.
//  - two cell orders (all rows, or tall thin parts as columns) and blocks (parts side by side,
//    GAP or more columns apart, walked one at a time); the shortest is kept.
// And one more cut, for crispness: no path's box is over BOX cells on both sides (see BOX).

const OFF = 1000
const ROW = 4096
const kx = k => (k % ROW) - OFF
const ky = k => Math.floor(k / ROW) - OFF
const MAX_RUNS = 64
const JOIN_T = 12
const DELTA = 0.3
const BACKS = 5
// Chromium's GPU raster draws a path whose screen box is over about 256 px on BOTH sides with a
// softer antialiasing: even on whole pixels its cells' edge pixels let about 18% of what lies
// beneath show (measured at 9 px a cell: a 31 x 31 cell path soft, 27 x 27 crisp, 80 x 11 crisp).
// So no path's box is over BOX cells on both sides: 21 cells is 189 px at 9 px a cell.
const BOX = 21
const R = 1, L = 2, D = 4, U = 8

const lum = h => {
  const n = parseInt(h.slice(1).length === 3 ? h.slice(1).replace(/./g, c => c + c) : h.slice(1), 16)
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
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

function shortHex(h) {
  if (h.length === 7 && h[1] === h[2] && h[3] === h[4] && h[5] === h[6]) return '#' + h[1] + h[3] + h[5]
  return h
}
const fix = v => Math.round(v * 1000) / 1000
function num(v) {
  const s = String(fix(v))
  return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? '-' + s.slice(2) : s
}
function pair(a, b) {
  const sa = num(a)
  const sb = num(b)
  const glued = sb[0] === '-' || (sb[0] === '.' && sa.includes('.'))
  return sa + (glued ? '' : ' ') + sb
}

// ------------------------------------------------------------------ geometry
// A "line" is one stroke line: horizontal (at a y, spans along x) or vertical (at an x, spans
// along y), with sorted [a, b] intervals. Cells are horizontal lines at the row y, x..x+1;
// tall cells may go as vertical lines at x + .5, y - .5..y + .5.

// Intervals from sorted starts of unit cells, merged where they touch.
function cellRuns(xs) {
  const runs = []
  for (const v of xs) {
    const last = runs[runs.length - 1]
    if (last && last[1] === v) last[1] = v + 1
    else runs.push([v, v + 1])
  }
  return runs
}
function mergeIntervals(list) {
  list.sort((p, q) => p[0] - q[0])
  const out = []
  for (const [a, b] of list) {
    const last = out[out.length - 1]
    if (last && a <= last[1] + 1e-9) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

// The lines for one set of cells (keys) plus the half covers of `ext` (key -> flags) owned by
// cells of that set. exposed(n, m) says whether cell n's side toward cell m has nothing solid
// beneath it; a half cover's end stops DELTA short of such a side.
function linesFor(keys, ext, exposed, columns, blocks) {
  const rows = new Map() // y -> [[a, b], ...]
  const cols = new Map() // x -> [[a, b], ...]
  const put = (m, f, iv) => {
    const fk = fix(f)
    let l = m.get(fk)
    if (!l) m.set(fk, (l = []))
    l.push(iv)
  }
  // Cells: rows, or columns for tall thin parts when `columns` is on.
  const set = new Set(keys)
  const tall = new Set()
  if (columns) {
    const run = (k, d) => {
      let n = 0
      while (set.has(k + d * (n + 1))) n++
      return n
    }
    for (const k of keys) {
      const h = 1 + run(k, 1) + run(k, -1)
      const v = 1 + run(k, ROW) + run(k, -ROW)
      if (v >= 3 && v > h) tall.add(k)
    }
  }
  const byRow = new Map()
  const byCol = new Map()
  for (const k of keys) {
    const m = tall.has(k) ? byCol : byRow
    const f = tall.has(k) ? kx(k) : ky(k)
    let l = m.get(f)
    if (!l) m.set(f, (l = []))
    l.push(tall.has(k) ? ky(k) : kx(k))
  }
  for (const [y, xs] of byRow) for (const iv of cellRuns(xs.sort((a, b) => a - b))) put(rows, y, iv)
  for (const [x, ys] of byCol) for (const [a, b] of cellRuns(ys.sort((a, b) => a - b))) put(cols, x + 0.5, [a - 0.5, b - 0.5])
  // Half covers.
  for (const k of keys) {
    const f = ext.get(k)
    if (!f) continue
    const x = kx(k)
    const y = ky(k)
    if (f & D || f & U) {
      for (const [bit, dy] of [[D, 1], [U, -1]]) {
        if (!(f & bit)) continue
        const n = k + dy * ROW
        const a = exposed(n, n - 1) ? x + DELTA : x
        const b = exposed(n, n + 1) ? x + 1 - DELTA : x + 1
        put(rows, y + dy * DELTA, [a, b])
      }
    }
    for (const [bit, dx] of [[R, 1], [L, -1]]) {
      if (!(f & bit)) continue
      const n = k + dx
      const a = exposed(n, n - ROW) ? y - 0.5 + DELTA : y - 0.5
      const b = exposed(n, n + ROW) ? y + 0.5 - DELTA : y + 0.5
      put(cols, x + 0.5 + dx * DELTA, [a, b])
    }
  }
  const out = []
  for (const [y, l] of rows) out.push([y, true, mergeIntervals(l)])
  for (const [x, l] of cols) out.push([x, false, mergeIntervals(l)])
  const order = (p, q) => (p[1] === q[1] ? p[0] - q[0] : p[1] ? -1 : 1)
  if (!blocks) return out.sort(order)
  // Blocks: the cells fall into parts side by side (two stands of trees), separated by at
  // least GAP empty columns. Each block is walked top to bottom on its own, so a path does
  // not jump across the gap on every row.
  const spans = []
  for (const [f, h, ivs] of out) for (const [a, b] of ivs) spans.push(h ? [a, b] : [f - 0.5, f + 0.5])
  const edges = mergeIntervals(spans.map(([a, b]) => [a, b + GAP])).map(([a, b]) => [a, b - GAP])
  if (edges.length < 2) return out.sort(order)
  const blockOf = v => edges.findIndex(([a, b]) => v >= a - 1e-9 && v <= b + 1e-9)
  const per = edges.map(() => [])
  for (const [f, h, ivs] of out) {
    if (!h) {
      per[blockOf(f)].push([f, h, ivs])
      continue
    }
    const by = new Map()
    for (const iv of ivs) {
      const i = blockOf(iv[0])
      if (!by.has(i)) by.set(i, [])
      by.get(i).push(iv)
    }
    for (const [i, l] of by) per[i].push([f, h, l])
  }
  return per.flatMap(l => l.sort(order))
}
const GAP = 12

// Segments for lines, each walked in whichever direction keeps the moves short.
function walk(ls) {
  const seg = (fixed, horizontal, a, b, back) => {
    const len = fix(b - a)
    if (horizontal) return back ? { sx: b, sy: fixed, cmd: 'h-' + num(len), ex: a, ey: fixed } : { sx: a, sy: fixed, cmd: 'h' + num(len), ex: b, ey: fixed }
    return back ? { sx: fixed, sy: b, cmd: 'v-' + num(len), ex: fixed, ey: a } : { sx: fixed, sy: a, cmd: 'v' + num(len), ex: fixed, ey: b }
  }
  const lineSegs = (fixed, horizontal, ivs, back) => (back ? [...ivs].reverse() : ivs).map(([a, b]) => seg(fixed, horizontal, a, b, back))
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
  for (const [fixed, horizontal, ivs] of ls) {
    const next = [null, null]
    for (const back of [0, 1]) {
      const segs = lineSegs(fixed, horizontal, ivs, back)
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

// One set of cells (and their half covers) as segments: rows only, or rows plus columns for
// tall thin parts, whichever writes shorter.
function segments(keys, ext, exposed) {
  const len = segs => data(segs, 0, 0).length
  let best = null
  let bl = Infinity
  for (const columns of [false, true]) {
    for (const blocks of [false, true]) {
      const s = walk(linesFor(keys, ext, exposed, columns, blocks))
      const l = len(s)
      if (l < bl) {
        bl = l
        best = s
      }
    }
  }
  return best
}

// Cuts one colour's cells into chunks of whole rows, each written as one path of at most
// maxRuns runs. Each chunk also covers the cells of earlier chunks that touch it, so the join
// between two chunks lies over the same colour. A row too busy for one path is cut across.
// A cell's half covers go with the chunk that owns the cell.
function chunks(cellKeys, ext, exposed, maxRuns, overlap = true) {
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
  // Half covers only for the chunk's own cells, not the cells it borrows for the overlap.
  const segsOf = ks => {
    const own = new Set(ks)
    const e = new Map()
    for (const k of own) if (ext.has(k)) e.set(k, ext.get(k))
    return segments(withOverlap(ks), e, exposed)
  }
  let cur = []
  const close = () => {
    if (!cur.length) return
    out.push(segsOf(cur))
    for (const k of cur) done.add(k)
    cur = []
  }
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(y).sort((a, b) => a - b)
    // A path that already spans BOX rows takes another row only while its box stays at most BOX
    // cells wide (see BOX).
    if (cur.length && y - ky(cur[0]) + 1 > BOX) {
      let x0 = Infinity
      let x1 = -Infinity
      for (const k of cur.concat(row)) {
        x0 = Math.min(x0, kx(k))
        x1 = Math.max(x1, kx(k))
      }
      if (x1 - x0 + 1 > BOX) close()
    }
    const tryCur = cur.concat(row)
    if (segsOf(tryCur).length <= maxRuns) {
      cur = tryCur
      continue
    }
    close()
    if (segsOf(row).length <= maxRuns) {
      cur = row
      continue
    }
    let piece = []
    for (const k of row) {
      const t = piece.concat([k])
      if (piece.length && segsOf(t).length > maxRuns) {
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

// ------------------------------------------------------------------ the encodings
const N4 = [[1, R], [-1, L], [ROW, D], [-ROW, U]]

// One encoding of a layer. `back` is the colour laid under the layer first, or null.
function encodeWith(layer, byColor, back, o) {
  const { ox, oy, q, maxRuns, T } = o
  const has = k => layer.m.has(k)
  // A cell outside the layer that an opaque still layer above always covers: an edge toward
  // it lies under solid paint, so nothing beneath it can show.
  const hid = o.hidden ?? new Set()
  // Cells whose outer edge lies over paint of the same colours (a band's first row, over the
  // band before it): there even a step within T would read as a line, so nothing but the
  // cell's own colour may reach it.
  const strict = o.strict ?? new Set()
  const inside = k => has(k) || hid.has(k)
  const outline = k => !inside(k + 1) || !inside(k - 1) || !inside(k + ROW) || !inside(k - ROW)
  const colours = [...byColor.keys()].filter(c => c !== back)
  colours.sort((a, b) => lum(a) - lum(b))
  const rank = new Map(colours.map((c, i) => [c, i]))
  const shows = c => (back ? apart(back, c) > T : true)
  const flag = (ext, k, bit) => ext.set(k, (ext.get(k) ?? 0) | bit)
  const plans = []
  if (back) {
    // The backing covers every cell but the outline cells far from it; those it reaches from
    // inside by a half cover, where no colour of their own covers the shared edge.
    const cover = []
    const ext = new Map()
    for (const [k, c] of layer.m) if (c === back || !outline(k) || (apart(back, c) <= T && !strict.has(k))) cover.push(k)
    const covered = new Set(cover)
    for (const k of cover) {
      const kc = layer.m.get(k)
      if (kc !== back && shows(kc)) continue
      for (const [d, bit] of N4) if (has(k + d) && !covered.has(k + d)) flag(ext, k, bit)
    }
    // Its rows run on across hidden cells only.
    const s = new Set(cover)
    bridge(s, () => null, null)
    plans.push([back, [...s], ext, o.join, (n, m) => !inside(m)])
  }
  // What lies beneath the side of cell n toward cell m, once a colour c lies under n:
  //  'ok'    something solid that covers across the side, or a colour between the two sides
  //          in brightness (the side between two colours, or c's own cells);
  //  'force' (over a backing) two colours near the backing that neither covers across; the
  //          darker one, near the backing itself, can cover the other cell, which makes it 'ok';
  //  'open'  nothing: the outline, or the backing alone. There an edge of c would show.
  const forced = new Map() // colour -> cells it covers to close a 'force' side
  const status = (c, n, m) => {
    const mc = layer.m.get(m)
    if (mc === undefined) return hid.has(m) ? 'ok' : 'open'
    const nc = layer.m.get(n)
    if (mc === nc || mc === c || !back) return 'ok'
    if (shows(nc) && shows(mc)) return 'ok'
    if (mc === back || nc === back) return 'open'
    const [e, x, xc] = rank.get(nc) < rank.get(mc) ? [nc, m, mc] : [mc, n, nc]
    if (shows(e)) return 'open'
    // The cell e covers must not put e under an outer edge of its own.
    if (outline(x) && apart(e, xc) > T) return 'open'
    return 'force'
  }
  const force = (c, n, m) => {
    const nc = layer.m.get(n)
    const mc = layer.m.get(m)
    const [e, x] = rank.get(nc) < rank.get(mc) ? [nc, m] : [mc, n]
    if (!forced.has(e)) forced.set(e, new Set())
    forced.get(e).add(x)
  }
  // Bridges: a gap in a row of a colour's cover is covered too where every cell of the gap is
  // hidden (under an opaque still layer above), or a cell of a later colour the colour may lie
  // under, as for a dilation. One run then writes shorter than two, and the cells it crosses
  // are painted over by their own colours. later(g) gives null (no) or the cells across the
  // 'force' sides of g, which the darker colour of the side then covers.
  function bridge(s, later, onForce) {
    const rows = new Map()
    for (const k of s) {
      const y = ky(k)
      let l = rows.get(y)
      if (!l) rows.set(y, (l = []))
      l.push(k)
    }
    for (const l of rows.values()) {
      l.sort((a, b) => a - b)
      for (let i = 1; i < l.length; i++) {
        const a = l[i - 1]
        const b = l[i]
        if (b - a < 2) continue
        const pend = []
        let good = true
        for (let g = a + 1; g < b && good; g++) {
          if (hid.has(g) && !has(g)) continue
          const f = later(g)
          if (f === null) good = false
          else for (const m of f) pend.push([g, m])
        }
        if (!good) continue
        for (let g = a + 1; g < b; g++) s.add(g)
        for (const [g, m] of pend) onForce(g, m)
      }
    }
  }
  const covers = []
  for (const c of colours) {
    const own = byColor.get(c)
    const r = rank.get(c)
    const s = new Set(own)
    const ext = new Map()
    const exposed = (n, m) => status(c, n, m) === 'open'
    if (shows(c)) {
      for (const k of own) {
        for (const [d, bit] of N4) {
          const n = k + d
          const nc = layer.m.get(n)
          if (nc === undefined || nc === back || rank.get(nc) <= r || !shows(nc)) continue
          if (apart(c, nc) <= T && !strict.has(n)) {
            s.add(n)
            continue
          }
          // The sides of n other than the one toward k: across from k, and the two ends.
          const sides = N4.filter(([e]) => e !== -d).map(([e]) => [e, status(c, n, n + e)])
          if (!sides.some(([, st]) => st === 'open')) {
            s.add(n)
            for (const [e, st] of sides) if (st === 'force') force(c, n, n + e)
          } else {
            flag(ext, k, bit)
            // The half cover reaches the two end sides only.
            for (const [e, st] of sides) if (e !== d && st === 'force') force(c, n, n + e)
          }
        }
      }
    }
    bridge(s, g => {
      const gc = layer.m.get(g)
      if (gc === undefined || gc === back || rank.get(gc) <= r || !shows(gc)) return null
      if (apart(c, gc) <= T && !strict.has(g)) return []
      const sides = N4.map(([e]) => [e, status(c, g, g + e)])
      return sides.some(([, st]) => st === 'open') ? null : sides.filter(([, st]) => st === 'force').map(([e]) => g + e)
    }, (g, m) => force(c, g, m))
    // The joins between paths of one colour overlap unless the backing beneath is so close to
    // it (JOIN_T) that a join cannot show; T itself is too wide for a straight line of seam.
    covers.push([c, s, ext, o.join && (!back || apart(back, c) > JOIN_T), exposed])
  }
  for (const [c, s, ext, join, exposed] of covers) {
    for (const x of forced.get(c) ?? []) s.add(x)
    plans.push([c, [...s], ext, join, exposed])
  }
  let out = ''
  for (const [c, cells, ext, join, exposed] of plans) {
    const ds = chunks(cells, ext, exposed, maxRuns, join).map(segs => data(segs, ox, oy))
    const col = shortHex(c)
    if (ds.length === 1) out += '<path stroke=' + q + col + q + ' d=' + q + ds[0] + q + '/>'
    else out += '<g stroke=' + q + col + q + '>' + ds.map(p => '<path d=' + q + p + q + '/>').join('') + '</g>'
  }
  return out
}

// The layer as SVG, the shortest of: not backed, or backed by one of its commonest colours. opts:
//   ox, oy: written relative to this corner (a pattern tile's corner);
//   T: the largest step (mean channel difference) a hairline may show (default 28);
//   hidden: a Set of cell keys outside the layer that a still layer above always covers;
//   strict: a Set of cell keys whose outer edges get no colour but their own, even within T;
//   backs: how many of the commonest colours to try as the backing (default BACKS);
//   back: 'auto' (default), 'none', or 'always';
//   q: the quote character (default ").
export function emitSafe(layer, opts = {}) {
  const o = { ox: 0, oy: 0, q: '"', maxRuns: MAX_RUNS, T: 28, back: 'auto', join: true, ...opts }
  const byColor = new Map()
  for (const [k, c] of layer.m) {
    let list = byColor.get(c)
    if (!list) byColor.set(c, (list = []))
    list.push(k)
  }
  if (!byColor.size) return ''
  const tops = [...byColor.keys()].sort((a, b) => byColor.get(b).length - byColor.get(a).length).slice(0, o.backs ?? BACKS)
  const tries = []
  if (o.back !== 'always') tries.push(encodeWith(layer, byColor, null, o))
  if (o.back !== 'none' && byColor.size > 1) for (const top of tops) tries.push(encodeWith(layer, byColor, top, o))
  if (!tries.length) tries.push(encodeWith(layer, byColor, null, o))
  return tries.reduce((a, b) => (b.length < a.length ? b : a))
}

// Runs (subpaths) in a piece of SVG, the count the player's rule is about.
export const runsIn = svg => (svg.match(/[Mm][-.\d]/g) ?? []).length
