// The scene encoder, after Tide Line's (../tide-line/build.mjs): layers to stroke runs written by
// the seam-proof encoder (./encode-local.mjs), big still layers in pattern tiles with a clear cell
// all round, nested pinned viewports, one <style>.
//
// Hairlines (see ../../engine/README.md): at a window size where a cell is not a whole number of
// screen pixels, the edge between two shapes falls inside a pixel, and whatever lies under both
// shows through as a thin line. What this encoder does about it:
// - Every cell layer goes through emitSafe: wherever two colours meet, the later one's edge lies
//   over a solid run of the earlier one (or of the backing), never over the layers below.
// - Runs are stroked exactly a cell high. (The round-3 encoder stroked them 1.1 cells high so that
//   rows overlapped; that tinted the last pixel row of the cell above at every size, the owner's
//   too, and is no longer needed.)
// - Pattern tiles start on a cell corner (rows are centred on whole y, so cell edges lie on
//   y + .5), with a clear cell on every side: a tile is rastered into its own bitmap from its
//   corner, and a filled edge row would blend with the far side of the tile.
// - Bands: the cells left over a band keep their vertical neighbour where the band is far from
//   both, and the encoder is told which band lies under each edge (`under`).
// - Moving layers can be drawn in `coats` coats: at an edge that falls inside a pixel, what lies
//   beneath shows through less (a quarter at most with one coat, about a seventh with two).
import { Layer, bounds } from '../../../sunfield/tools/pixel.mjs'
import { W, H, cellXY, f2 } from './lib.mjs'
import { apart, emitSafe } from './encode-local.mjs'

const PIN = { pB: 'xMidYMax', pBL: 'xMinYMax', pBR: 'xMaxYMax' }
const PATTERN_MIN = 55
const ROW = 4096
const runsOf = s => (s.match(/[hv]-?\d/g) ?? []).length
const BAND_T = 20

export function encode(parts, CSS, tiles = '', opts = {}) {
  // Tiles the caller's cells refer to (stroke='url(#..)'), ahead of the encoder's own patterns.
  const defs = [tiles]
  let ids = 0
  const nextId = () => {
    let n = ids++
    let s = ''
    do {
      s = String.fromCharCode(97 + (n % 26)) + s
      n = Math.floor(n / 26) - 1
    } while (n >= 0)
    return s
  }
  const stats = { patterns: 0, runs: 0, bands: 0, byLayer: new Map(), chars: new Map() }
  const cellsOf = (L, ox = 0, oy = 0) => emitSafe(L, { ox, oy, ...(L.enc ?? {}) })

  // Near colours merged, for size: within a layer, a colour within MERGE levels (every channel)
  // of a commoner one takes that colour. Tile paints are left alone.
  const MERGE = opts.merge ?? 0
  const merged = new Set()
  const mergeNear = L => {
    if (!MERGE || !L?.m || merged.has(L)) return
    merged.add(L)
    const count = new Map()
    for (const c of L.m.values()) count.set(c, (count.get(c) ?? 0) + 1)
    const rgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
    const kept = []
    const to = new Map()
    for (const c of [...count.keys()].sort((a, b) => count.get(b) - count.get(a))) {
      if (c[0] !== '#' || c.length !== 7) continue
      const v = rgb(c)
      let best = null
      let bd = Infinity
      for (const [kc, kv] of kept) {
        const d = Math.max(...v.map((x, i) => Math.abs(x - kv[i])))
        if (d <= MERGE && d < bd) {
          best = kc
          bd = d
        }
      }
      if (best) to.set(c, best)
      else kept.push([c, v])
    }
    if (to.size) for (const [k, c] of L.m) if (to.has(c)) L.m.set(k, to.get(c))
    stats.mergedColours = (stats.mergedColours ?? 0) + to.size
  }
  const walk = ls => {
    for (const L of ls) {
      if (L.wrap) walk(L.layers)
      else if (L.under) mergeNear(L.layer)
      else mergeNear(L)
    }
  }
  for (const [, ls] of parts) walk(ls)

  function draw(L) {
    const plain = cellsOf(L)
    const runs = runsOf(plain)
    stats.runs += runs
    stats.byLayer.set(L.name, (stats.byLayer.get(L.name) ?? 0) + runs)
    stats.chars.set(L.name, (stats.chars.get(L.name) ?? 0) + plain.length)
    if (runs < PATTERN_MIN || L.noTile) return plain
    stats.patterns++
    const b = bounds(L)
    const x = b.x0 - 1
    const y = b.y0 - 1.5
    const id = nextId()
    defs.push('<pattern id="' + id + '" width="1" height="1">' + cellsOf(L, x, y) + '</pattern>')
    return '<rect x="' + x + '" y="' + f2(y) + '" width="' + (b.x1 - b.x0 + 2) + '" height="' + (b.y1 - b.y0 + 2) + '" fill="url(#' + id + ')"/>'
  }

  // A big still layer over full rows: each row's commonest colour goes into a band stroke under
  // the cells (each band a row deeper than its rows, under the next, so no seam shows), and
  // only the cells that differ from it stay cells. Where two bands meet, a dashed row of each
  // colour reaches a row into the other: an ordered dither for the price of two paths.
  function underlay(L, ox = 0, oy = 0) {
    // The colour a paint shows in a cell (L.texel for tile paints: see build.mjs).
    const tex = (p, k) => (p === undefined || !L.texel ? p : L.texel(p, ...cellXY(k)))
    const rows = new Map()
    for (const [k, c] of L.m) {
      const [x, y] = cellXY(k)
      if (x < 0 || x >= W) continue
      let r = rows.get(y)
      if (!r) rows.set(y, (r = { n: 0, count: new Map() }))
      r.n++
      r.count.set(c, (r.count.get(c) ?? 0) + 1)
    }
    const ys = [...rows.keys()].sort((a, b) => a - b)
    const colourOf = new Map()
    const uniform = new Set()
    for (const y of ys) {
      const r = rows.get(y)
      if (r.n < W) continue
      let best = null
      for (const [c, n] of r.count) if (!best || n > best[1]) best = [c, n]
      colourOf.set(y, best[0])
      if (best[1] === W) uniform.add(y)
    }
    const full = new Map(L.m)
    for (const [k, c] of [...L.m]) if (colourOf.get(cellXY(k)[1]) === c) L.m.delete(k)
    // A cell left over a band shows that band through its upper and lower edges (each band runs
    // a row deeper, under the next). Where the band is far from the cell and from the band
    // colour above or below it, that is a hairline: keep that neighbour as a cell too, so the
    // edge lies between two cells the encoder joins over one another.
    const bt = L.encT ?? BAND_T
    // The texels of a tile paint that can show at the edge between k and n: theirs. (The texels
    // beside them along the edge were tried too: more joins, more lines.)
    const foot = (p, k, n) => {
      if (p === undefined || !L.texel || p[0] === '#') return [p]
      return [tex(p, k), tex(p, n)]
    }
    for (const [k, c] of [...L.m]) {
      const y = cellXY(k)[1]
      const under = colourOf.get(y)
      // A row with no band of its own (the field's top row) lies over the band above it, if any,
      // but its lower edge meets the band below edge to edge with nothing of the layer beneath:
      // where the two look alike, what lies behind the layer would show between them. Keep the
      // band's cell there as a cell, so the run reaches over the band.
      if (!under && colourOf.has(y + 1)) {
        const n = k + ROW
        const nc = full.get(n)
        if (nc !== undefined && !L.m.has(n) && apart(tex(c, k), tex(nc, n)) <= bt) L.m.set(n, nc)
      }
      if (!under) continue
      for (const n of [k - ROW, k + ROW]) {
        const nc = full.get(n)
        if (nc === undefined || L.m.has(n)) continue
        const vk = tex(c, k)
        const vn = tex(nc, n)
        const bands = [under, colourOf.get(cellXY(n)[1])]
        if (bands.some(b => foot(b, k, n, vk, vn).some(t => apart(t, vk) > bt && apart(t, vn) > bt))) L.m.set(n, nc)
      }
    }
    // What lies beneath each edge between the cells left: the band of its row, or across rows
    // the two bands that meet there (a row with no band of its own lies over the band above it,
    // which runs a row deeper; below that, nothing is known).
    const bandAt = y => colourOf.get(y) ?? colourOf.get(y - 1)
    L.enc = {
      ...(L.enc ?? {}),
      T: L.encT ?? BAND_T,
      under: (k, n) => {
        const yk = cellXY(k)[1]
        const yn = cellXY(n)[1]
        const bs = yk === yn ? [bandAt(yk)] : [bandAt(Math.min(yk, yn)), bandAt(Math.max(yk, yn))]
        if (!L.texel) return bs.length === 1 ? bs[0] : bs
        const vk = tex(L.m.get(k) ?? full.get(k), k)
        const vn = tex(L.m.get(n) ?? full.get(n), n)
        return bs.flatMap(b => foot(b, k, n, vk, vn))
      },
      ...(L.texel ? { vis: (k, c) => L.texel(c, ...cellXY(k)) } : {}),
      // What a band cell shows (encode-local L6): a colour laid under a cell beside it would show
      // along their edge.
      shown: m => (full.has(m) && !L.m.has(m) ? tex(full.get(m), m) : undefined),
    }
    let out = ''
    let dash = ''
    let i = 0
    while (i < ys.length) {
      const c = colourOf.get(ys[i])
      if (!c) {
        i++
        continue
      }
      let j = i
      while (j + 1 < ys.length && ys[j + 1] === ys[j] + 1 && colourOf.get(ys[j + 1]) === c) j++
      const h = j - i + 1
      out += '<path stroke="' + c + '" stroke-width="' + (h + 1) + '" d="M' + -ox + ' ' + f2(ys[i] + h / 2 - oy) + 'h' + W + '"/>'
      stats.bands++
      const y = ys[j]
      const c2 = colourOf.get(y + 1)
      if (c2 && c2 !== c && uniform.has(y) && uniform.has(y + 1) && h > 1) {
        // Each dash is two rows tall, over both rows: one row tall, its edge on the bands' meeting
        // line lay on the other band's edge there, and the band beneath both showed through.
        dash += '<path stroke="' + c2 + '" d="M' + -ox + ' ' + f2(y + 0.5 - oy) + 'h' + W + '"/><path stroke="' + c + '" d="M' + (2 - ox) + ' ' + f2(y + 0.5 - oy) + 'h' + W + '"/>'
      }
      i = j + 1
    }
    return out + (dash ? '<g stroke-dasharray="1 3" stroke-width="2">' + dash + '</g>' : '')
  }

  // A big still layer laid over bands of its own, bands and cells together in one pattern tile:
  // the field, whose cells and bands are painted with the hedge tiles (userSpaceOnUse, placed
  // from the tile's corner as in round 3). The tile is a cached bitmap: drawn as runs every
  // frame, the field took the player past its limit (11-12 ms a frame). Its corner is on a cell
  // corner, with a clear cell all round: the last band runs a row deeper, so the tile is a row
  // taller, or its wrap pulls that band onto the top row as a line. The tile is resampled at
  // fractional sizes; build.mjs (unbleed, coverTips) keeps what that blur shows alike.
  function drawWithBands(L) {
    // Cells outside the grid never show: every viewport is sliced (as for still layers below).
    for (const k of [...L.m.keys()]) {
      const [cx, cy] = cellXY(k)
      if (cx < -1 || cx > W || cy < -1 || cy > H) L.m.delete(k)
    }
    const b = bounds(L)
    const x = b.x0 - 1
    const y = b.y0 - 1.5
    const bands = underlay(L, x, y)
    const cells = cellsOf(L, x, y)
    const runs = runsOf(cells)
    stats.runs += runs
    stats.byLayer.set(L.name, (stats.byLayer.get(L.name) ?? 0) + runs)
    stats.chars.set(L.name, (stats.chars.get(L.name) ?? 0) + cells.length + bands.length)
    stats.patterns++
    const id = nextId()
    defs.push('<pattern id="' + id + '" width="1" height="1">' + bands + cells + '</pattern>')
    return '<rect x="' + x + '" y="' + f2(y) + '" width="' + (b.x1 - b.x0 + 2) + '" height="' + (b.y1 - b.y0 + 3) + '" fill="url(#' + id + ')"/>'
  }

  function renderLayers(layers) {
    let out = ''
    let still = null
    const flush = () => {
      if (still) out += draw(still)
      still = null
    }
    for (const L of layers) {
      if (L.raw) {
        flush()
        out += L.raw
        continue
      }
      if (L.under) {
        flush()
        out += L.layer.inTile ? drawWithBands(L.layer) : underlay(L.layer) + draw(L.layer)
        continue
      }
      if (L.wrap) {
        flush()
        out += L.wrap + renderLayers(L.layers) + L.end
        continue
      }
      if (!L.size) continue
      if (!L.anim) {
        still ??= new Layer('')
        still.name += (still.name ? '+' : '') + L.name
        still.enc ??= L.enc
        still.noTile ||= L.noTile
        // Still cells outside the grid never show: every viewport is sliced.
        for (const [k, c] of L.m) {
          const [x, y] = cellXY(k)
          if (x >= -1 && x <= W && y >= -1 && y <= H) still.m.set(k, c)
        }
        continue
      }
      flush()
      // Moving layers are drawn as plain runs, never a pattern tile: a pattern is rastered into a
      // cached bitmap, and on a moving group Chromium drew it a fraction of a pixel apart from one
      // frame to the next (seen along the tree crown's edge). Plain runs are also shorter here.
      L.noTile = true
      // With two coats or more, no colour is laid under a cell on the layer's outer edge (the
      // local encoder's edge rule): laid there, it showed along the outside of the edge, as a
      // line wherever what passes beneath matches the cell (a cloud's dark base over the dark
      // foot of the massif). The joins it covered show at most a sixteenth of what lies beneath.
      if ((L.coats ?? 1) > 1) L.enc = { edge: true, ...(L.enc ?? {}) }
      let inner = draw(L)
      if ((L.coats ?? 1) > 1) {
        if (/^<rect [^>]*\/>$/.test(inner)) inner = inner.repeat(L.coats)
        else {
          const id = nextId()
          inner = '<g id="' + id + '">' + inner + '</g>' + ('<use href="#' + id + '"/>').repeat(L.coats - 1)
        }
      }
      out += '<g class="' + L.anim.cls + '"' + (L.anim.style ? ' style="' + L.anim.style + '"' : '') + L.anim.extra + '>' + inner + '</g>'
    }
    flush()
    return out
  }

  const view = pin => '<svg viewBox="0 -.5 ' + W + ' ' + H + '" preserveAspectRatio="' + PIN[pin] + ' slice">'
  let body = ''
  let pin = null
  for (const [p, layers] of parts) {
    if (!layers.length) continue
    if (p !== pin) {
      if (pin) body += '</svg>'
      body += view(p)
      pin = p
    }
    body += renderLayers(layers)
  }
  body += '</svg>'

  let svg =
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" font-family="a" color="a" style="--m:0s">' +
    '<style>' + CSS + '</style><defs>' + defs.join('') + '</defs>' + body + '</svg>'
  // Single quotes: the scene travels to the app inside JSON, where every double quote costs a backslash.
  svg = svg.replaceAll('"', "'")
  return { svg, stats, css: CSS.length }
}
