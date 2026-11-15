// Assembly helpers for a Sunfield-style pixel scene: layers of cells written as stroke runs by
// this scene's copy of BackdropKit's seam-proof encoder (encode-local.mjs emitSafe), big still
// layers kept in <pattern> tiles, a cull that leaves a ring of each lower layer under the edges
// of the one above, nested viewports pinned to a side, and the app's scrub-length estimate.
import { Layer, bounds } from '../../../sunfield/tools/pixel.mjs'
import { emitSafe, runsIn } from './encode-local.mjs'

export { Layer }
export const W = 320
export const H = 200
// A layer that fills less than 1/SPARSE of its box is never a pattern tile (see Scene.draw).
const SPARSE = 20
// The most cells a pattern tile's box may hold: its bitmap at 9 px a cell stays under Skia's
// 4-Mpx picture-shader cap (4e6 / 81 is 49,383), with a margin.
const TILE_MAX = 46000

const OFF = 1000
const ROW = 4096
export const cellsOf = L => [...L.m.keys()].map(k => [(k % ROW) - OFF, Math.floor(k / ROW) - OFF])

// ------------------------------------------------------------------ outlines
// A set of cells as one filled path: the boundary edges, clockwise around each cell, linked
// into loops. One path covers its whole area with no seam between its rows.
// Cell (x, y) spans x..x+1 across and y-.5..y+.5 down (the scene's half-cell shift).
export function outline(cells, ox = 0, oy = 0) {
  const has = new Set(cells.map(([x, y]) => x + ',' + y))
  const out = new Map() // start "x,y" -> [[dx, dy, ex, ey], ...]
  const add = (sx, sy, ex, ey) => {
    const k = sx + ',' + sy
    let l = out.get(k)
    if (!l) out.set(k, (l = []))
    l.push([ex - sx, ey - sy, ex, ey])
  }
  for (const [x, y] of cells) {
    if (!has.has(x + ',' + (y - 1))) add(x, y, x + 1, y)
    if (!has.has(x + 1 + ',' + y)) add(x + 1, y, x + 1, y + 1)
    if (!has.has(x + ',' + (y + 1))) add(x + 1, y + 1, x, y + 1)
    if (!has.has(x - 1 + ',' + y)) add(x, y + 1, x, y)
  }
  let d = ''
  let pen = null
  const num = v => {
    const s = String(v)
    return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? '-' + s.slice(2) : s
  }
  const pair = (a, b) => {
    const sa = num(a)
    const sb = num(b)
    return sa + (sb[0] === '-' || (sb[0] === '.' && sa.includes('.')) ? '' : ' ') + sb
  }
  for (const [start, list] of out) {
    while (list.length) {
      const [sx, sy] = start.split(',').map(Number)
      // Walk one loop.
      const moves = []
      let cx = sx
      let cy = sy
      for (;;) {
        const l = out.get(cx + ',' + cy)
        if (!l || !l.length) break
        const [dx, dy, ex, ey] = l.pop()
        const last = moves[moves.length - 1]
        if (last && Math.sign(last[0]) === Math.sign(dx) && Math.sign(last[1]) === Math.sign(dy)) {
          last[0] += dx
          last[1] += dy
        } else moves.push([dx, dy])
        cx = ex
        cy = ey
        if (cx === sx && cy === sy) break
      }
      if (!moves.length) continue
      const px = sx - ox
      const py = sy - 0.5 - oy
      d += pen ? 'm' + pair(px - pen[0], py - pen[1]) : 'M' + pair(px, py)
      pen = [px, py]
      // The last move closes the loop: z does it.
      for (let i = 0; i < moves.length - 1; i++) {
        const [dx, dy] = moves[i]
        d += dx ? 'h' + dx : 'v' + dy
      }
      d += 'z'
    }
  }
  return d
}

export function commonest(L) {
  const n = new Map()
  for (const c of L.m.values()) n.set(c, (n.get(c) ?? 0) + 1)
  let best = null
  for (const [c, k] of n) if (!best || k > n.get(best)) best = c
  return best
}

// A set of cells as a filled path in one colour, at an opacity.
export function fillCells(cells, color, opacity) {
  if (!cells.length) return ''
  return '<path fill="' + color + '"' + (opacity !== undefined ? ' fill-opacity="' + opacity + '"' : '') + ' d="' + outline(cells) + '"/>'
}

// ------------------------------------------------------------------ the scene's parts
export class Scene {
  constructor() {
    this.parts = [] // { pin, items }
    this.defs = []
    this.ids = 0
    this.stats = { patterns: 0, patternRuns: 0, plainRuns: 0 }
    this.patternMin = 55
    // The largest colour step (mean channel) a hairline may show; see encode-local.mjs. Raised
    // from the engine's 28 for the busy textures here: it writes shorter, and scans as clean.
    this.T = 36
  }

  id() {
    let n = this.ids++
    let s = ''
    do {
      s = String.fromCharCode(97 + (n % 26)) + s
      n = Math.floor(n / 26) - 1
    } while (n >= 0)
    return s
  }

  add(pin, items) {
    this.parts.push({ pin, items })
  }

  // A layer's cells: plain runs when small; a pattern tile when big. Either way written by
  // emitSafe, so no hairline opens between its colours or between the paths of one colour.
  draw(L) {
    // A sparse layer (the falling snow: a few hundred cells spread over the whole frame) stays
    // plain runs. As a tile its bitmap would pass Skia's 4-Mpx picture-shader cap from 8 px a
    // cell up, be drawn smaller and scaled back, and every flake would get soft edges. Its few
    // colour edges are all protected (T 0): a near flake's two colours lie on the same white
    // snow, where even a small step under an outer edge reads as a line.
    const b = bounds(L)
    const sparse = L.size * SPARSE < (b.x1 - b.x0 + 2) * (b.y1 - b.y0 + 2)
    const T = L.seamT ?? (sparse ? 0 : this.T)
    const plain = emitSafe(L, { T, hidden: L.hidden, strict: L.strict })
    const runs = runsIn(plain)
    if (runs < this.patternMin || sparse) {
      this.stats.plainRuns += runs
      return plain
    }
    // A tile whose bitmap would pass Skia's 4-Mpx picture-shader cap at 9 px a cell (1440x900
    // at 2x) is drawn smaller and scaled back, so its edges go soft and slide off the cell grid
    // that the sharp moving parts on top keep: a flake beside a soft edge leaves a 1-px line.
    // Such a layer is cut into two bands, each its own tile. The lower band repeats the upper
    // band's last row, so the join lies over the upper band's paint, not over what is beneath;
    // for the upper band the lower band's cells count as hidden (drawn over it, opaque). The
    // lower band's first row is strict: over paint of the same colours, its top edge may carry
    // nothing but each cell's own colour (see encode-local.mjs).
    if ((b.x1 - b.x0 + 2) * (b.y1 - b.y0 + 2) > TILE_MAX) {
      const ym = splitRow(L, b)
      const A =Object.assign(new Layer(L.name + 'a', L.anim), { seamT: L.seamT, hidden: new Set(L.hidden ?? []), strict: L.strict })
      // A merged still group's hidden set also holds cells that the group paints itself (a lower
      // layer's cell culled under an upper layer of the same group). For the lower band the upper
      // band's cells are paint beneath it, not cover above it, so only cells outside L stay.
      const B = Object.assign(new Layer(L.name + 'b', L.anim), { seamT: L.seamT, hidden: new Set([...(L.hidden ?? [])].filter(k => !L.m.has(k))), strict: new Set() })
      for (const [k, c] of L.m) {
        const y = Math.floor(k / ROW) - OFF
        if (y < ym) A.m.set(k, c)
        else A.hidden.add(k)
        if (y >= ym - 1) B.m.set(k, c)
        if (y === ym - 1) B.strict.add(k)
      }
      return this.draw(A) + this.draw(B)
    }
    this.stats.patterns++
    this.stats.patternRuns += runs
    // The tile is the rect (an object-bounding-box tile) with a clear cell all round, so no
    // edge row or column of the tile's bitmap holds drawing: a tile wraps, and an edge that
    // falls inside a screen pixel would blend that row with nothing. Its corner sits on a cell
    // corner (cell rows span y-.5..y+.5), so at whole-pixel sizes the tile's bitmap lies on
    // the screen's pixel grid; half a cell off, every row edge would be resampled soft.
    const x = b.x0 - 1
    const y = b.y0 - 1.5
    const id = this.id()
    this.defs.push('<pattern id="' + id + '" width="1" height="1">' + emitSafe(L, { ox: x, oy: y, T, hidden: L.hidden, strict: L.strict }) + '</pattern>')
    return '<rect x="' + x + '" y="' + String(y).replace(/^(-?)0\./, '$1.') + '" width="' + (b.x1 - b.x0 + 2) + '" height="' + (b.y1 - b.y0 + 2) + '" fill="url(#' + id + ')"/>'
  }

  // Items: Layers (still or with .anim = { cls, style, extra }), raw { html } strings, and
  // { wrap, end, items } groups. Runs of still layers are culled and merged into one.
  render(items) {
    let out = ''
    let still = null
    const flush = () => {
      if (still) out += this.draw(still)
      still = null
    }
    for (const L of items) {
      if (L.html !== undefined) {
        flush()
        out += L.html
        continue
      }
      if (L.wrap !== undefined) {
        flush()
        out += L.wrap + this.render(L.items) + L.end
        continue
      }
      if (!L.size) continue
      if (!L.anim) {
        // Neighbouring still layers become one layer, so emitSafe sees every colour edge
        // between them as an edge inside one layer.
        still ??= Object.assign(new Layer("still"), { hidden: new Set() })
        for (const [k, c] of L.m) still.m.set(k, c)
        for (const k of L.culled ?? []) still.hidden.add(k)
        continue
      }
      flush()
      out += '<g class="' + L.anim.cls + '"' + (L.anim.style ? ' style="' + L.anim.style + '"' : '') + (L.anim.extra ?? '') + (L.anim.id ? ' id="' + L.anim.id + '"' : '') + '>' + this.draw(L) + '</g>'
    }
    flush()
    return out
  }
}

// Where to cut a layer into two bands (Scene.draw): the first row ym of the lower band's own
// rows, so the upper band has rows < ym and the lower band rows >= ym - 1. Of the cuts that
// leave both tiles under TILE_MAX, the one that writes least twice: the fewest runs in the
// repeated row ym - 1, and the fewest colours found in both bands (each costs a path head).
function splitRow(L, b) {
  const w = b.x1 - b.x0 + 2
  const rows = new Map() // y -> [x, colour] sorted by x
  for (const [k, c] of L.m) {
    const y = Math.floor(k / ROW) - OFF
    let r = rows.get(y)
    if (!r) rows.set(y, (r = []))
    r.push([(k % ROW) - OFF, c])
  }
  const runsOf = y => {
    const r = (rows.get(y) ?? []).sort((p, q) => p[0] - q[0])
    let n = 0
    for (let i = 0; i < r.length; i++) if (!i || r[i][0] !== r[i - 1][0] + 1 || r[i][1] !== r[i - 1][1]) n++
    return n
  }
  // Colours in rows < y (above[y]) and in rows >= y (below[y]).
  const above = new Map()
  const below = new Map()
  let acc = new Set()
  for (let y = b.y0; y <= b.y1; y++) {
    above.set(y, acc)
    acc = new Set([...acc, ...(rows.get(y) ?? []).map(p => p[1])])
  }
  acc = new Set()
  for (let y = b.y1; y >= b.y0; y--) {
    acc = new Set([...acc, ...(rows.get(y) ?? []).map(p => p[1])])
    below.set(y, acc)
  }
  let best = null
  let bestCost = Infinity
  for (let ym = b.y0 + 2; ym < b.y1; ym++) {
    if (w * (ym - b.y0 + 2) > TILE_MAX || w * (b.y1 - ym + 3) > TILE_MAX) continue
    let both = 0
    for (const c of above.get(ym)) if (below.get(ym - 1).has(c)) both++
    const cost = runsOf(ym - 1) + 4 * both
    if (cost < bestCost) {
      bestCost = cost
      best = ym
    }
  }
  return best ?? Math.floor((b.y0 + b.y1) / 2)
}

// Drops cells of still layers that a still layer above them always covers, except a ring of
// one cell (8-neighbourhood) under the edge of what covers them: where the upper layer's edge
// falls inside a screen pixel, that pixel then blends the upper colour with the lower one
// painted there, not with the sky behind both (BackdropKit README, cause 4).
export function cull(items) {
  const covered = new Set()
  const AROUND = [-1, 1, -ROW, ROW, -ROW - 1, -ROW + 1, ROW - 1, ROW + 1]
  for (let i = items.length - 1; i >= 0; i--) {
    const L = items[i]
    if (L.html !== undefined || L.wrap !== undefined || L.anim || L.keep) continue
    for (const k of [...L.m.keys()]) {
      if (covered.has(k) && AROUND.every(d => covered.has(k + d))) {
        L.m.delete(k)
        ;(L.culled ??= new Set()).add(k)
      }
    }
    // The ring cells left under the edge of the layer above take the colour of a visible cell
    // of their own layer beside them (across that edge). The edge pixel then blends the two
    // colours seen on either side of it, not a third colour that lies hidden under the upper
    // layer (a dark forest cell under the snow's edge drew a dark 1-px line). The ring is
    // covered at whole-pixel sizes, so the picture does not change.
    const recolour = []
    for (const [k, c] of L.m) {
      if (!covered.has(k)) continue
      let to
      for (const d of AROUND) {
        const n = k + d
        if (!covered.has(n) && L.m.has(n)) {
          to = L.m.get(n)
          break
        }
      }
      if (to !== undefined && to !== c) recolour.push([k, to])
    }
    for (const [k, to] of recolour) L.m.set(k, to)
    for (const k of L.m.keys()) covered.add(k)
  }
}

// ------------------------------------------------------------------ the app's scrub length
// What of the CSS survives the app's scrub: every rule but @keyframes, written back by the
// CSSOM with its animation gone (Sunfield's estimate).
export function keptLength(css) {
  let n = 0
  for (const m of css.matchAll(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}|@media[^{]*\{[^{}]*\{[^{}]*\}\}|([^{}]+)\{([^{}]*)\}/g)) {
    if (m[0].startsWith('@keyframes')) continue
    if (m[0].startsWith('@media')) {
      n += m[0].length + 12
      continue
    }
    const decls = m[2]
      .split(';')
      .filter(d => d && !/^animation/.test(d))
      .map(d => {
        const [p, v] = d.split(':')
        const value = (v ?? '')
          .replace(/#([0-9a-f]{6})/gi, (_, h) => 'rgb(' + [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ') + ')')
          .replace(/(^|[^\d])\.(\d)/g, '$10.$2')
          .replace(/,/g, ', ')
        return p + ': ' + value + ';'
      })
    n += m[1].length + 3 + (decls.length ? decls.join(' ').length + 1 : 0) + 1
  }
  return n
}

export function scrubbedLength(svg, css) {
  return svg.length - css.length + keptLength(css) + [...svg.matchAll(/<(\w+)[^>]*\/>/g)].reduce((n, m) => n + 2 + m[1].length, 0)
}
