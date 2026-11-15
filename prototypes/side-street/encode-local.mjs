// Side Street's local copy of the encoder: harbor/encode-local.mjs as it was on 2026-11-15
// (engine/ and harbor/ were not edited). Side Street uses it for every cell layer (build.mjs,
// encode()); see notes.md, "Encoding and hairlines", for the options it passes. Three options
// of Side Street's own (all off by default, so the rest is harbor's code unchanged):
// 6. `filled` (default false): the caller draws the layer inside a merge filter that lays it on
//    itself three times (build.mjs, the still scene), so a pixel two cells share comes out
//    nearly opaque in their own colours whatever lies beneath. Laying a colour under its
//    neighbours (and the corner cover) is then not needed and is skipped, and the layer is
//    never backed (without the joins a backing far from two neighbours would show between
//    them, and there the pixel is already opaque, so the filter cannot help). The chunks,
//    their overlap (option join) and the row cap stay. On the still scene the joins cost about
//    15k characters a moment, which the 128,000 limit does not allow.
// 7. `rim` (default false): no colour is laid under a cell on the layer's outer edge (the
//    second half of tide-line's `edge`). A colour laid under its neighbour reaches that
//    neighbour's far side; where that side is the layer's outer edge and falls inside a screen
//    pixel, the colour beneath shows there by up to a quarter: a fringe of the darker colour
//    one cell beyond it (the vending machine's red, a slice over the crossing lamps: 160 line
//    pixels a size). With rim, the outer-edge cells meet their inner neighbours as unjoined
//    cells do, over what lies below.
// 8. `slab` (default 0, off): a colour's cells are cut into columns of at most `slab` cells,
//    left to right, before they are cut into chunks; the overlap of split paths reaches across
//    the slabs. For a long, low layer whose colours hold many runs a row (the train, about 290
//    by 26 cells): without slabs each of their paths is a single row, and the overlap makes
//    every path cover the row above it too (11,855 characters by day; with slabs of 160, 6,930).
// Harbor's notes follow.
//
// Harbor's local copy of the encoder: low-orbit/encode-local.mjs as it was on 2026-11-15, plus two
// options of harbor's own (4, 5). engine/ is shared and was not edited. Harbor needs the copy for
// changes 2 and 3; it turns change 1 off (5).
// 4. Narrow and wide paths (in chunks). Change 3's row cap costs harbor about 3.5k a moment, too
//    much for the 128,000 aim on day. The soft corners need a box over about 200 px on both
//    sides and under about 100k px in area, so a chunk at most `narrow` cells across (option,
//    default 0) or at least `wide` cells across (default Infinity) is not cut; the defaults keep
//    change 3 as it was. Harbor passes 21 and 120 (21 after Deep Reef's fix): at most 189 px
//    across up to 9 px a cell, and over 100k px whenever over 200 px tall from 4.27 px a cell
//    (the smallest window scanned) up. Measured with a purity test (pixels that differ from
//    their cell's centre at a whole number of px a cell): the same as the plain cap at 4, 5, 6, 7,
//    8 and 9 px a cell in all three moments, while no cap leaves 25 to 420 soft cells on day at
//    5, 7, 8 and 9. Saves about 2.5k a moment against the plain cap.
// 5. Option `edge` (default true). false turns change 1 off: every cell is backed, as in the
//    engine. In harbor change 1 cost 1.7k (day) to 3k (sunset, night) and seamscan read the same
//    (max line pixels over the 11 sizes, on / off: day 23 / 21, sunset 51 / 47, night 28 / 36).
//    Deep Reef dropped it for the same reason. Harbor passes false.
// Low Orbit's notes follow.
//
// Low Orbit's local copy of engine/encode.mjs (copied 2026-11-15), with three changes.
// Changes 1 and 2 (in encodeWith) come from one case the shared encoder does not expect: a layer
// whose commonest colour, used as its backing, is far from a large part of it. In moment B the
// globe's commonest colour is the white of the day clouds (#f4f7fc), laid under the dark night
// side too, and it shone through there (seamscan: up to 210 line pixels a size).
//
// 1. Outer edge. The backing lay under every cell, the layer's outer edge included. Where that
//    edge falls inside a screen pixel, every path covering the edge cell shows through by up to
//    a quarter, the backing among them: a bright line along the night limb, the top of the
//    airglow and the gaps in it. Now an edge cell is backed only when its colour is within T of
//    the backing; other edge cells lie on their neighbours (under-dilation), as when unbacked.
// 2. Corners. The 4-neighbour under-dilation leaves a corner where the earliest of four
//    meeting colours holds only one cell with no single colour beneath the whole corner pixel;
//    the backing shows there by about a twentieth: a field of light dots in the dithered night.
//    Now the earliest colour of such a block covers all of it (see the code).
// With both, the layer stays backed (moment B's globe: about 88k characters; unbacked, 110k).
// 3. Soft corners (in chunks). Chromium's GPU raster draws a path whose screen box is square-ish
//    and middling (both sides over about 200-256 px, area under about 100k px) with a softer
//    antialiasing that rounds every cell corner and blurs the cell edges a little, even where
//    cells sit on whole pixels; smaller boxes and larger ones stay square. Measured in this
//    scene: the dithered colours of the day-night band, 2 paths of about 45 x 50 cells each,
//    came out round-cornered at 6 px a cell (the owner's window), others at 8 and 9. This is
//    what the run cap above was guarding against; it depends on the box, not on the run count.
//    Now a path also spans at most MAX_ROWS rows (one more with its overlap), so its box stays
//    under about 200 px tall up to 10 px a cell: 0 impure pixels at 6, 8 and 9 px a cell.
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
const MAX_ROWS = 19 // local change 3

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
function chunks(cellKeys, maxRuns, overlap = true, maxRows = Infinity, wide = Infinity, narrow = 0, slab = 0) {
  const done = new Set()
  const out = []
  // Side Street option `slab` (see the header): columns of at most `slab` cells, left to right,
  // each cut into chunks as below; the overlap reaches across slabs through `done`.
  if (slab > 0) {
    const by = new Map()
    for (const k of cellKeys) {
      const s = Math.floor(kx(k) / slab)
      let l = by.get(s)
      if (!l) by.set(s, (l = []))
      l.push(k)
    }
    for (const s of [...by.keys()].sort((a, b) => a - b)) chunksInto(by.get(s), maxRuns, overlap, maxRows, wide, narrow, done, out)
    return out
  }
  chunksInto(cellKeys, maxRuns, overlap, maxRows, wide, narrow, done, out)
  return out
}

function chunksInto(cellKeys, maxRuns, overlap, maxRows, wide, narrow, done, out) {
  const rows = new Map()
  for (const k of cellKeys) {
    const y = ky(k)
    let r = rows.get(y)
    if (!r) rows.set(y, (r = []))
    r.push(k)
  }
  const withOverlap = ks => {
    if (!overlap) return ks
    const s = new Set(ks)
    for (const k of ks) {
      for (const n of [k - 1, k + 1, k - ROW, k + ROW]) if (done.has(n)) s.add(n)
    }
    return [...s]
  }
  const segsOf = ks => segments(ks.map(k => [kx(k), ky(k)]))
  const spanX = (...lists) => {
    let a = Infinity
    let b = -Infinity
    for (const l of lists) for (const k of l) {
      const x = kx(k)
      if (x < a) a = x
      if (x > b) b = x
    }
    return b - a + 1
  }
  let cur = []
  const close = () => {
    if (!cur.length) return
    out.push(segsOf(withOverlap(cur)))
    for (const k of cur) done.add(k)
    cur = []
  }
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(y).sort((a, b) => a - b)
    // Local change 3: a path spans at most maxRows rows (see the header).
    // Harbor change 4: not for a chunk at most `narrow` or at least `wide` cells across.
    if (cur.length && y - ky(cur[0]) + 1 > maxRows && (w => w > narrow && w < wide)(spanX(cur, row))) close()
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
  // Local change 1: a cell on the layer's outer edge is backed only when its colour is within T
  // of the backing, so the backing never shows along that edge.
  const outer = k => !layer.m.has(k - 1) || !layer.m.has(k + 1) || !layer.m.has(k - ROW) || !layer.m.has(k + ROW)
  // Harbor change 5: o.edge false turns local change 1 off.
  const backed = k => !!back && !(o.edge !== false && outer(k) && shows(layer.m.get(k)))
  const paths = []
  if (back) paths.push([back, chunks([...layer.m.keys()].filter(backed), maxRuns, o.join, o.maxRows, o.wide, o.narrow, o.slab)])
  const sets = new Map()
  for (const c of colours) {
    const own = byColor.get(c)
    const r = rank.get(c)
    const s = new Set(own)
    // Side Street option `filled` (see the header): no joins.
    if (!o.filled) for (const k of own) {
      const kb = backed(k)
      for (const n of [k - 1, k + 1, k - ROW, k + ROW]) {
        const nc = layer.m.get(n)
        if (nc === undefined || nc === back || rank.get(nc) <= r) continue
        // Under the edge between the two lies the backing when both are backed (it shows
        // only when far from both), else the unknown layers below (it always shows).
        // Side Street option `rim` (see the header): never under an outer-edge cell.
        if (o.rim && outer(n)) continue
        if (!kb || !backed(n) || (shows(c) && shows(nc))) s.add(n)
      }
    }
    sets.set(c, s)
  }
  // Local change 2: corners. Where four cells meet and the earliest of their colours holds only
  // one of them, the 4-neighbour cover above leaves the corner pixel without any one colour
  // under all of it, and what lies beneath shows through there by about a twentieth: a dot at
  // every such corner (a white backing under the dithered night made a field of them). The
  // earliest colour also covers the rest of that block, unless the block is backed throughout
  // and the backing is within T of one of its colours.
  if (o.corners !== false && !o.filled) {
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
          if (cs[i] !== back && rank.get(cs[i]) > rank.get(m) && !(o.rim && outer(k))) s.add(k)
        })
      }
    }
  }
  for (const c of colours) {
    const s = sets.get(c)
    let bare = false // some of the cells this colour covers have no backing beneath
    for (const k of s) if (!backed(k)) bare = true
    paths.push([c, chunks([...s], maxRuns, o.join && (shows(c) || bare), o.maxRows, o.wide, o.narrow, o.slab)])
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
  const o = { ox: 0, oy: 0, q: '"', maxRuns: MAX_RUNS, maxRows: MAX_ROWS, T: 28, order: 'lum', back: 'auto', join: true, ...opts }
  if (o.filled) o.back = 'none' // Side Street option 6
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
