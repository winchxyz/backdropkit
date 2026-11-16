// The editor's copy of the BackdropKit engine encoder (engine/encode.mjs): a layer of colour
// cells written as SVG stroke runs that show no hairlines at any window size. It is the
// engine's algorithm with the local changes the 13 scenes found (see engine/README.md, "What
// the 13 scenes taught"), taken from prototypes/harbor/encode-local.mjs (itself Low Orbit's
// copy) and prototypes/tide-line/encode-local.mjs, and written on dense typed arrays so a whole
// 320 x 200 picture encodes in well under a second, in the browser too.
//
// What it does, without changing a single cell at whole-pixel sizes:
// - Under-dilation. Colours are drawn darkest first (or largest first, or by groups of near
//   colours, largest group first: the editor's 'group' order). Each colour's path also
//   covers every neighbouring cell (4-neighbourhood) of a colour drawn after it, so wherever two
//   colours meet, the later one's edge lies over a solid run of the earlier one, never over the
//   layers below.
// - Backing. The layer is also tried backed by its commonest colour, laid under every cell
//   first; then a colour is laid under its later neighbour only where the backing is more than
//   T (mean channel step) from both. The shorter encoding wins.
// - Overlapping splits. A path holds at most MAX_RUNS runs; when a colour needs several paths,
//   each later path also covers the cells of earlier ones that touch it.
// - Corners (Low Orbit's change 2). Where four cells meet and the earliest of their colours
//   holds only one of them, that colour also covers the rest of the 2 x 2 block, so no dot of
//   what lies beneath shows at the corner.
// - Soft corners (Low Orbit's change 3, Harbor's change 4). Chromium's GPU raster rounds every
//   cell corner of a path whose screen box is square-ish and middling, so a path more than
//   `narrow` (21) and less than `wide` (120) cells across spans at most `maxRows` (19) rows.
// - Outer edge (Low Orbit's change 1, off by default as in Harbor): with `edge`, a cell on the
//   layer's outer edge is backed only when its colour is within T of the backing.
// - Strict cells (after Snowfall Ridge): cells that lie exactly over paint of their own colour
//   (the repeated first row of a lower pattern band). Nothing but the cell's own colour may
//   cover them, neither the backing nor a neighbour's under-dilation, so their outer edge shows
//   only the paint beneath.
// - `under(k, n)` (Tide Line's option): the colour known to lie beneath the edge between cells
//   k and n of an unbacked layer; the two are joined only where it is far from both.
// One change of its own: a chunk takes another row while either of its two encodings (rows
// only, or rows plus columns for tall thin parts) fits in maxRuns, and the shorter one that
// fits is written. The engine required the shorter one to fit; this is never longer.
//
// Cells live on one frame grid shared by the whole scene: x from -FX to FW - FX - 1, y from -FX
// to FH - FX - 1, index (y + FX) * FW + (x + FX). A run on row y is a stroke-width-1 line at y
// (the caller's viewBox starts at y = -.5, which shifts the picture down half a cell).

export const FX = 4
export const FW = 320 + 2 * FX
export const FH = 200 + 2 * FX
export const FN = FW * FH
export const at = (x, y) => (y + FX) * FW + (x + FX)
export const xOf = k => (k % FW) - FX
export const yOf = k => Math.floor(k / FW) - FX

export const MAX_RUNS = 64

/* ---------- Numbers and path data, as short as SVG allows ---------- */

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

// Segments for runs ([[fixed, [[start, len], ...]], ...] sorted), each line walked in
// whichever direction keeps the moves short.
function walk(ls, horizontal) {
  const seg = (fixed, start, len, back) => {
    if (horizontal) {
      return back ? { sx: start + len, sy: fixed, cmd: 'h-' + len, ex: start, ey: fixed } : { sx: start, sy: fixed, cmd: 'h' + len, ex: start + len, ey: fixed }
    }
    const x = fixed + 0.5
    return back ? { sx: x, sy: start + len - 0.5, cmd: 'v-' + len, ex: x, ey: start - 0.5 } : { sx: x, sy: start - 0.5, cmd: 'v' + len, ex: x, ey: start + len - 0.5 }
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
  // Two states per line, walked forward or back; the cheaper history is kept for each, as a
  // linked list joined into one array at the end.
  let best = [{ cost: 0, last: null, prev: null, segs: null }, null]
  for (const [fixed, runs] of ls) {
    const next = [null, null]
    for (const back of [0, 1]) {
      const segs = lineSegs(fixed, runs, back)
      for (const prev of best) {
        if (!prev) continue
        const c = prev.cost + cost(prev.last, segs)
        if (!next[back] || c < next[back].cost) next[back] = { cost: c, last: segs[segs.length - 1], prev, segs }
      }
    }
    best = next
  }
  const ends = best.filter(Boolean)
  if (!ends.length) return []
  let node = ends.reduce((a, b) => (a.cost <= b.cost ? a : b))
  const parts = []
  while (node && node.segs) {
    parts.push(node.segs)
    node = node.prev
  }
  return parts.reverse().flat()
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

/* ---------- Scratch arrays, reused ---------- */

let gen = 1
const stamp = new Int32Array(FN) // dedupe of a colour's cells
const doneMark = new Int32Array(FN) // cells of closed chunks
const uMark = new Int32Array(FN) // the current chunk with its overlap
const tallMark = new Int32Array(FN)
const backedMark = new Int32Array(FN)
const runL = new Int32Array(FN)
const runU = new Int32Array(FN)
const hLen = new Int32Array(FN)
const vLen = new Int32Array(FN)
const nextGen = () => {
  if (++gen > 2e9) {
    for (const a of [stamp, doneMark, uMark, tallMark, backedMark]) a.fill(0)
    gen = 1
  }
  return gen
}

// Horizontal runs of sorted cells as lines.
function rowLines(cells) {
  const out = []
  let fixed = null
  let runs = null
  let last = -2
  for (const k of cells) {
    const y = yOf(k)
    if (y !== fixed) {
      fixed = y
      runs = [[xOf(k), 1]]
      out.push([y, runs])
    } else if (k === last + 1) runs[runs.length - 1][1]++
    else runs.push([xOf(k), 1])
    last = k
  }
  return out
}

// Vertical runs of cells as lines, column by column.
function colLines(cells) {
  const sorted = [...cells].sort((a, b) => xOf(a) - xOf(b) || a - b)
  const out = []
  let fixed = null
  let runs = null
  let last = -2
  for (const k of sorted) {
    const x = xOf(k)
    if (x !== fixed) {
      fixed = x
      runs = [[yOf(k), 1]]
      out.push([x, runs])
    } else if (k === last + FW) runs[runs.length - 1][1]++
    else runs.push([yOf(k), 1])
    last = k
  }
  return out
}

// Marks the tall cells of a set (sorted, marked in uMark with u): a cell whose vertical run in
// the set is at least 3 and longer than its row run. Returns the mark's generation.
function markTall(cells, u) {
  for (const k of cells) {
    runL[k] = uMark[k - 1] === u ? runL[k - 1] + 1 : 1
    runU[k] = uMark[k - FW] === u ? runU[k - FW] + 1 : 1
  }
  for (let i = cells.length - 1; i >= 0; i--) {
    const k = cells[i]
    hLen[k] = uMark[k + 1] === u ? hLen[k + 1] : runL[k]
    vLen[k] = uMark[k + FW] === u ? vLen[k + FW] : runU[k]
  }
  const tg = nextGen()
  for (const k of cells) if (vLen[k] >= 3 && vLen[k] > hLen[k]) tallMark[k] = tg
  return tg
}

// The runs the rows-plus-columns encoding of a set takes.
function mixedRuns(cells, u) {
  const tg = markTall(cells, u)
  let n = 0
  for (const k of cells) {
    if (tallMark[k] === tg) {
      if (!(uMark[k - FW] === u && tallMark[k - FW] === tg)) n++
    } else if (!(uMark[k - 1] === u && tallMark[k - 1] !== tg)) n++
  }
  return n
}

const dataLen = segs => data(segs, 0, 0).length

// One path's cells (sorted, marked in uMark with u) as segments: rows, or rows plus columns
// for tall thin parts, whichever writes shorter within maxRuns runs.
function segments(cells, u, maxRuns) {
  const rows = walk(rowLines(cells), true)
  const tg = markTall(cells, u)
  const tall = []
  const rest = []
  for (const k of cells) (tallMark[k] === tg ? tall : rest).push(k)
  if (!tall.length) return rows
  const mixed = walk(rowLines(rest), true).concat(walk(colLines(tall), false))
  if (rows.length > maxRuns) return mixed
  if (mixed.length > maxRuns) return rows
  return dataLen(mixed) < dataLen(rows) ? mixed : rows
}

// Cuts one colour's cells (sorted) into chunks of whole rows, each one path of at most maxRuns
// runs. With `overlap`, each chunk also covers the cells of earlier chunks that touch it, so
// the join between two chunks lies over the same colour. A row too busy for one path is cut
// across. A chunk more than `narrow` and less than `wide` cells across spans at most maxRows
// rows. Returns a list of segment lists.
function chunks(cells, o, overlap) {
  const { maxRuns, maxRows, narrow, wide } = o
  const out = []
  if (!cells.length) return out
  const dg = nextGen()
  let u = nextGen()
  let cur = [] // the chunk's own cells
  let extra = [] // cells of earlier chunks it covers too
  let runs = 0 // row runs of cur + extra
  let firstRow = 0
  let minX = Infinity
  let maxX = -Infinity
  const inU = k => uMark[k] === u
  const addU = k => {
    runs += (inU(k - 1) ? 0 : 1) - (inU(k + 1) ? 1 : 0)
    uMark[k] = u
  }
  const removeU = k => {
    uMark[k] = 0
    runs -= (inU(k - 1) ? 0 : 1) - (inU(k + 1) ? 1 : 0)
  }
  const close = () => {
    if (!cur.length) return
    const all = cur.concat(extra).sort((a, b) => a - b)
    out.push(segments(all, u, maxRuns))
    for (const k of cur) doneMark[k] = dg
    cur = []
    extra = []
    runs = 0
    minX = Infinity
    maxX = -Infinity
    u = nextGen()
  }
  // Takes `list` into the chunk (with its overlap) when the chunk still fits.
  const tryAdd = (list, y) => {
    const own = []
    const ext = []
    for (const k of list) {
      addU(k)
      own.push(k)
      if (!overlap) continue
      for (const n of [k - 1, k + 1, k - FW, k + FW]) {
        if (doneMark[n] === dg && !inU(n)) {
          addU(n)
          ext.push(n)
        }
      }
    }
    let ok = runs <= maxRuns
    if (!ok) ok = mixedRuns(cur.concat(extra, own, ext).sort((a, b) => a - b), u) <= maxRuns
    if (!ok) {
      const added = own.concat(ext)
      for (let i = added.length - 1; i >= 0; i--) removeU(added[i])
      return false
    }
    if (!cur.length) firstRow = y
    for (const k of own) {
      cur.push(k)
      const x = xOf(k)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
    }
    for (const k of ext) extra.push(k)
    return true
  }
  let i = 0
  while (i < cells.length) {
    const y = yOf(cells[i])
    let j = i
    while (j < cells.length && yOf(cells[j]) === y) j++
    const row = cells.slice(i, j)
    i = j
    if (cur.length && y - firstRow + 1 > maxRows) {
      const w = Math.max(maxX, xOf(row[row.length - 1])) - Math.min(minX, xOf(row[0])) + 1
      if (w > narrow && w < wide) close()
    }
    if (tryAdd(row, y)) continue
    close()
    if (tryAdd(row, y)) continue
    // A row with too many runs for one path: cut it into pieces of whole runs.
    for (const k of row) {
      if (tryAdd([k], y)) continue
      close()
      tryAdd([k], y)
    }
  }
  close()
  return out
}

/* ---------- One encoding of a layer ---------- */

function apartIdx(C, a, b) {
  const x = C.rgb
  return (Math.abs(x[3 * a] - x[3 * b]) + Math.abs(x[3 * a + 1] - x[3 * b + 1]) + Math.abs(x[3 * a + 2] - x[3 * b + 2])) / 3
}

// The 'group' order: colours that meet somewhere in the layer (side by side or one above the
// other) and lie within `near` (sum of channel steps) of each other, chained, form a group;
// groups are drawn largest first and the colours of a group darkest first. Wherever two near
// colours meet, only colours of their own group can be drawn between them, so what shows
// through their shared edge is a near colour too, as in the darkest-first order, while the big
// groups still go first and cover the specks of later ones, as in the largest-first one.
function groupOrder(colours, byColor, C, near, L) {
  const parent = new Map(colours.map(c => [c, c]))
  const find = c => {
    while (parent.get(c) !== c) {
      parent.set(c, parent.get(parent.get(c)))
      c = parent.get(c)
    }
    return c
  }
  const x = C.rgb
  const { col } = L
  const seen = new Set()
  for (const k of L.cells) {
    const a = col[k]
    if (!parent.has(a)) continue
    for (const n of [k + 1, k + FW]) {
      const b = col[n]
      if (b === a || b < 0 || !parent.has(b)) continue
      const key = a < b ? a * 65536 + b : b * 65536 + a
      if (seen.has(key)) continue
      seen.add(key)
      if (Math.abs(x[3 * a] - x[3 * b]) + Math.abs(x[3 * a + 1] - x[3 * b + 1]) + Math.abs(x[3 * a + 2] - x[3 * b + 2]) > near) continue
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) parent.set(ra, rb)
    }
  }
  const area = new Map()
  for (const c of colours) area.set(find(c), (area.get(find(c)) ?? 0) + byColor.get(c).length)
  return colours.sort((a, b) => {
    const ga = find(a)
    const gb = find(b)
    return area.get(gb) - area.get(ga) || ga - gb || C.lum[a] - C.lum[b] || a - b
  })
}

function shortHex(h) {
  if (h.length === 7 && h[1] === h[2] && h[3] === h[4] && h[5] === h[6]) return '#' + h[1] + h[3] + h[5]
  return h
}

// One encoding: `back` is the colour laid under the whole layer first, or -1 for none.
function encodeWith(L, byColor, back, o, order) {
  const { col } = L
  const C = o.colors
  const { T, q } = o
  const colours = [...byColor.keys()].filter(c => c !== back)
  if (order === 'area') colours.sort((a, b) => byColor.get(b).length - byColor.get(a).length || C.lum[a] - C.lum[b] || a - b)
  else if (order === 'group') groupOrder(colours, byColor, C, o.near ?? 40, L)
  else colours.sort((a, b) => C.lum[a] - C.lum[b] || a - b)
  const rank = new Map(colours.map((c, i) => [c, i]))
  const shows = new Map()
  for (const c of colours) shows.set(c, back >= 0 ? apartIdx(C, back, c) > T : true)
  const strict = o.strict
  const isStrict = k => !!strict && strict[k] === 1
  const bg = nextGen()
  const backed = k => backedMark[k] === bg
  if (back >= 0) {
    for (const k of L.cells) {
      if (isStrict(k)) continue
      if (o.edge) {
        const outer = col[k - 1] < 0 || col[k + 1] < 0 || col[k - FW] < 0 || col[k + FW] < 0
        if (outer && col[k] !== back && shows.get(col[k])) continue
      }
      backedMark[k] = bg
    }
  }
  const sets = new Map()
  // Under-dilation: each colour also covers its later neighbours wherever something different
  // from both would show between them.
  for (const c of colours) {
    const add = []
    sets.set(c, add)
    const r = rank.get(c)
    const sc = shows.get(c)
    for (const k of byColor.get(c)) {
      add.push(k)
      const kb = backed(k)
      for (const n of [k - 1, k + 1, k - FW, k + FW]) {
        const nc = col[n]
        if (nc < 0 || nc === back || rank.get(nc) <= r || isStrict(n)) continue
        if (kb && backed(n) && !(sc && shows.get(nc))) continue
        if (back < 0 && o.under) {
          const un = o.under(k, n)
          if (un !== undefined) {
            let far = false
            for (const b of Array.isArray(un) ? un : [un]) if (b === undefined || (apartIdx(C, b, c) > T && apartIdx(C, b, nc) > T)) far = true
            if (!far) continue
          }
        }
        add.push(n)
      }
    }
  }
  // Corners: the earliest colour of a 2 x 2 block covers the rest of it, unless the block is
  // backed throughout and the backing is within T of one of its colours.
  if (o.corners !== false) {
    for (const tl of L.cells) {
      const blk = [tl, tl + 1, tl + FW, tl + FW + 1]
      const cs = blk.map(k => col[k])
      if (cs[1] < 0 || cs[2] < 0 || cs[3] < 0) continue
      if (back >= 0 && blk.every(backed) && cs.some(c => c === back || !shows.get(c))) continue
      let m = -1
      for (const c of cs) if (c !== back && (m < 0 || rank.get(c) < rank.get(m))) m = c
      if (m < 0) continue
      const s = sets.get(m)
      for (let i = 0; i < 4; i++) if (cs[i] !== back && rank.get(cs[i]) > rank.get(m) && !isStrict(blk[i])) s.push(blk[i])
    }
  }
  const paths = []
  if (back >= 0) paths.push([back, chunks(L.cells.filter(backed), o, o.join)])
  for (const c of colours) {
    const g = nextGen()
    const uniq = []
    let bare = false
    for (const k of sets.get(c)) {
      if (stamp[k] === g) continue
      stamp[k] = g
      uniq.push(k)
      if (!backed(k)) bare = true
    }
    uniq.sort((a, b) => a - b)
    paths.push([c, chunks(uniq, o, o.join && (shows.get(c) || bare))])
  }
  let svg = ''
  let runs = 0
  let nPaths = 0
  for (const [c, segsList] of paths) {
    if (!segsList.length) continue
    const ds = segsList.map(segs => data(segs, o.ox, o.oy))
    for (const s of segsList) runs += s.length
    nPaths += ds.length
    const hex = shortHex(C.hex[c])
    if (ds.length === 1) svg += '<path stroke=' + q + hex + q + ' d=' + q + ds[0] + q + '/>'
    else svg += '<g stroke=' + q + hex + q + '>' + ds.map(p => '<path d=' + q + p + q + '/>').join('') + '</g>'
  }
  return { svg, runs, paths: nPaths }
}

// What a piece of encoded SVG costs as the app counts it: after its still-frame scrub every
// <path .../> is written <path ...></path>, six characters more.
export const costOf = t => t.svg.length + 6 * t.paths

// A layer as SVG: the shortest of the encodings tried (unbacked, and backed by its commonest
// colours; darkest first, and with order 'both' largest first too). Every cell stays exactly as
// painted at whole-pixel sizes and no hairline above T is left. Returns { svg, runs, paths }.
//   L: { col: Int32Array(FN), the colour index of every frame cell (-1 for none),
//        cells: the layer's frame indices, sorted }
//   opts: colors (the scene's colour table: { hex: [], rgb: Int16Array(3n), lum: [] }),
//     ox, oy (written relative to this corner, a pattern tile's), T (28),
//     back ('auto' | 'none' | 'always'), backs (how many of the commonest colours to try as
//     the backing, 1), order ('lum' | 'area' | 'group' | 'both', which is lum and area, or a
//     list of them to try), near (the 'group' order's step, 40), maxRuns (64), maxRows (19),
//     narrow (21), wide (120), edge (false), corners (true), strict (Uint8Array(FN), 1 for a
//     strict cell), under ((k, n) => colour index, a list of them, or undefined), q ("'"),
//     join (true).
export function emitSafe(L, opts = {}) {
  const o = { ox: 0, oy: 0, q: "'", maxRuns: MAX_RUNS, maxRows: 19, narrow: 21, wide: 120, T: 28, order: 'lum', back: 'auto', backs: 1, join: true, edge: false, ...opts }
  const byColor = new Map()
  for (const k of L.cells) {
    const c = L.col[k]
    let list = byColor.get(c)
    if (!list) byColor.set(c, (list = []))
    list.push(k)
  }
  if (!byColor.size) return { svg: '', runs: 0, paths: 0 }
  const common = [...byColor.keys()].sort((a, b) => byColor.get(b).length - byColor.get(a).length || a - b)
  const tries = []
  for (const order of o.order === 'both' ? ['lum', 'area'] : Array.isArray(o.order) ? o.order : [o.order]) {
    if (o.back !== 'always' || byColor.size === 1) tries.push(encodeWith(L, byColor, -1, o, order))
    if (o.back !== 'none' && byColor.size > 1) for (const b of common.slice(0, Math.max(1, o.backs))) tries.push(encodeWith(L, byColor, b, o, order))
  }
  return tries.reduce((a, b) => (costOf(b) < costOf(a) ? b : a))
}

// Runs (subpaths) in a piece of SVG, the count the player's rule is about.
export const runsIn = svg => (svg.match(/[Mm][-.\d]/g) ?? []).length
