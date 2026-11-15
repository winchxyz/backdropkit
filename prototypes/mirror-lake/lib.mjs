// Helpers for Mirror Lake: noise and colour, and the encoding of cell layers into the SVG the
// way Sunfield's build does it (../../../sunfield/tools/build.mjs): stroke runs of at most 64 a
// path, big layers kept in <pattern> tiles with a clear cell all round, nested viewports pinned
// to a side, and the app's scrub-length estimate. Since the seam fix (2026-11-15) the cells are
// written by the seam-proof encoder (encode-local.mjs), pattern layers in coats, and parts that
// abut moving parts drawn twice (Scene.double); notes.md, "Encoding and hairlines".
import { Layer, bounds, emitCells, hex, lerp, rgb, smooth } from '../../../sunfield/tools/pixel.mjs'
import { emitCoated, emitSafe } from './encode-local.mjs'

export { Layer }
export const W = 320
export const H = 200
const OFF = 1000
const ROW = 4096

// ---------------------------------------------------------------- numbers, noise, colour

export const f1 = v => Math.round(v * 10) / 10
export const f2 = v => String(Math.round(v * 100) / 100).replace(/^0\./, '.').replace(/^-0\./, '-.')
export const f3 = v => String(Math.round(v * 1000) / 1000).replace(/^0\./, '.').replace(/^-0\./, '-.')

export function hash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// Smooth value noise in 0..1.
export function noise(x, y, s = 0) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const u = smooth(x - xi)
  const v = smooth(y - yi)
  return lerp(lerp(hash(xi, yi, s), hash(xi + 1, yi, s), u), lerp(hash(xi, yi + 1, s), hash(xi + 1, yi + 1, s), u), v)
}

// Two octaves of noise, centred on 0, in about -0.5..0.5.
export const fbm = (x, y, s) => (noise(x, y, s) + 0.5 * noise(x * 2.1, y * 2.1, s + 7)) / 1.5 - 0.5

export const mix = (a, b, t) => {
  const A = rgb(a)
  const B = rgb(b)
  return hex([lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)])
}

// A colour along [[t, '#rrggbb'], ...] stops.
export function ramp(stops, t) {
  if (t <= stops[0][0]) return stops[0][1]
  for (let i = 0; i < stops.length - 1; i++) {
    const [ta, ca] = stops[i]
    const [tb, cb] = stops[i + 1]
    if (t <= tb) return mix(ca, cb, (t - ta) / (tb - ta))
  }
  return stops[stops.length - 1][1]
}

export const lum = c => {
  const [r, g, b] = rgb(c)
  return (0.3 * r + 0.55 * g + 0.15 * b) / 255
}

// The cells of a layer as [x, y, colour].
export function* cells(L) {
  for (const [k, c] of L.m) yield [(k % ROW) - OFF, Math.floor(k / ROW) - OFF, c]
}

export function merge(dst, src) {
  for (const [k, c] of src.m) dst.m.set(k, c)
  return dst
}

// ---------------------------------------------------------------- outlines

// A set of cells as one filled path: the boundary edges, clockwise round each cell, linked into
// loops (as snowfall-ridge's lib does it). Cell (x, y) spans x..x+1 across and y-.5..y+.5 down.
export function outline(list, ox = 0, oy = 0) {
  const has = new Set(list.map(([x, y]) => x + ',' + y))
  const out = new Map()
  const add = (sx, sy, ex, ey) => {
    const k = sx + ',' + sy
    let l = out.get(k)
    if (!l) out.set(k, (l = []))
    l.push([ex - sx, ey - sy, ex, ey])
  }
  for (const [x, y] of list) {
    if (!has.has(x + ',' + (y - 1))) add(x, y, x + 1, y)
    if (!has.has(x + 1 + ',' + y)) add(x + 1, y, x + 1, y + 1)
    if (!has.has(x + ',' + (y + 1))) add(x + 1, y + 1, x, y + 1)
    if (!has.has(x - 1 + ',' + y)) add(x, y + 1, x, y)
  }
  const num = v => {
    const s = String(v)
    return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? '-' + s.slice(2) : s
  }
  const pair = (a, b) => {
    const sa = num(a)
    const sb = num(b)
    return sa + (sb[0] === '-' || (sb[0] === '.' && sa.includes('.')) ? '' : ' ') + sb
  }
  let d = ''
  let pen = null
  for (const [start, l0] of out) {
    while (l0.length) {
      const [sx, sy] = start.split(',').map(Number)
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
      for (let i = 0; i < moves.length - 1; i++) {
        const [dx, dy] = moves[i]
        d += dx ? 'h' + dx : 'v' + dy
      }
      d += 'z'
    }
  }
  return d
}

const runsOf = s => (s.match(/[hv]-?\d/g) ?? []).length

// ---------------------------------------------------------------- the scene's encoder

export const PIN = { pB: 'xMidYMax', pBL: 'xMinYMax', pBR: 'xMaxYMax', pM: 'xMidYMid' }

export class Scene {
  constructor() {
    this.parts = [] // [pin, items]
    this.defs = []
    this.ids = 0
    this.stats = { patterns: 0, runs: 0, plain: 0, byLayer: new Map(), size: new Map() }
    this.patternMin = 55
    this.safe = { T: 28, fill: true, groups: true } // the seam-proof encoder's options
    this.coats = 3 // coats of a pattern layer's runs (see draw)
    this.qid = 0
  }

  // Pattern ids are lower-case letters; every other id in the scene is upper-case.
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
    this.parts.push([pin, items])
  }

  // A layer's cells: plain runs when small; a rect filled with a pattern of them when big (a
  // pattern keeps its raster between frames). The split is decided on the plain encoding's run
  // count, as before the seam fix. The cells are written by the seam-proof encoder
  // (encode-local.mjs), with the scene's options (this.safe) and the layer's own (L.safe). The
  // tile's corner sits on a cell corner, with a clear cell on every side.
  draw(L) {
    if (process.env.DUMP && L.name.includes(process.env.DUMP)) {
      // (debug) the layer's cells, for the scratch tools
      const f = process.env.DUMP_TO + '/mirror-dump-' + L.name.slice(0, 40).replace(/\W/g, '_') + '.json'
      import('node:fs').then(fs => fs.writeFileSync(f, JSON.stringify([...L.m])))
    }
    const total = runsOf(emitCells(L))
    this.stats.byLayer.set(L.name, (this.stats.byLayer.get(L.name) ?? 0) + total)
    const o = { ...this.safe, ...(L.safe ?? {}) }
    if (total < this.patternMin) {
      const body = emitSafe(L, o)
      this.stats.runs += runsOf(body)
      this.stats.plain += runsOf(body)
      this.stats.size.set(L.name, [body.length, emitCells(L).length])
      return body
    }
    this.stats.patterns++
    const b = bounds(L)
    const x = b.x0 - 1
    const y = b.y0 - 1.5
    const id = this.id()
    let body
    if (L.coats === false) body = emitSafe(L, { ...o, ox: x, oy: y })
    else {
      // Coats (seam fix): the layer's runs, written with no joins, drawn this.coats times
      // through <use>, over its backing when it has one (L.needBack forces one). Where two runs
      // meet inside a pixel, what shows through drops from f(1-f) to (f(1-f))³, 1/64 at most;
      // whole cells are unchanged. The pattern keeps its raster between frames, so the coats
      // cost nothing per frame. The backing stays out of the coats: inside the runs' group each
      // coat would reset what the coats under it built up (tried: far worse), and coated on its
      // own it gained nothing.
      const c = emitCoated(L, { ...o, ox: x, oy: y, back: L.needBack ? 'always' : 'auto' })
      const cid = 'Q' + this.qid++
      body = c.back + '<g id="' + cid + '">' + c.cells + '</g>' + ('<use href="#' + cid + '"/>').repeat(this.coats - 1)
    }
    this.stats.runs += runsOf(body)
    this.stats.size.set(L.name, [body.length, emitCells(L, x, y).length])
    this.defs.push('<pattern id="' + id + '" width="1" height="1">' + body + '</pattern>')
    return '<rect x="' + x + '" y="' + y + '" width="' + (b.x1 - b.x0 + 2) + '" height="' + (b.y1 - b.y0 + 2) + '" fill="url(#' + id + ')"/>'
  }

  // A layer repeated as a tile of tw x th cells whose top row is y0, filling the box [x, y, w, h]
  // in user units. The tile's cells lie in 0..tw-1 across and y0..y0+th-1 down.
  tile(L, tw, th, y0, box, attrs = '') {
    const id = this.id()
    const body = emitSafe(L, { ...this.safe, ...(L.safe ?? {}), ox: 0, oy: y0 - 0.5 })
    this.stats.size.set(L.name, [body.length, emitCells(L, 0, y0 - 0.5).length])
    this.defs.push(
      '<pattern id="' + id + '" patternUnits="userSpaceOnUse" y="' + f2(y0 - 0.5) + '" width="' + tw + '" height="' + th + '"' + attrs + '>' + body + '</pattern>',
    )
    return '<rect x="' + box[0] + '" y="' + f2(box[1]) + '" width="' + box[2] + '" height="' + box[3] + '" fill="url(#' + id + ')"/>'
  }

  // (Seam fix.) A part drawn twice over itself. Where two separately drawn parts abut (a moving
  // part beside another), the edge pixel lets through up to f(1-f) of what lies behind; with
  // both parts drawn twice that drops to f²(1-f)² (1/16 at most). Whole-cell sizes are unchanged.
  double(html) {
    if (/^<rect [^>]*\/>$/.test(html)) return html + html
    const id = 'Q' + this.qid++
    return '<g id="' + id + '">' + html + '</g><use href="#' + id + '"/>'
  }

  // Items: Layers (still, or with .anim = { cls, style, extra }), { html } strings and
  // { wrap, end, items, twice } groups. Runs of still layers are merged into one. A layer with
  // .twice (or any layer in a group with .twice) is drawn twice (see double).
  render(items, twice = false) {
    let out = ''
    let still = null
    const flush = () => {
      if (still) out += still.twice || twice ? this.double(this.draw(still)) : this.draw(still)
      still = null
    }
    for (const L of items) {
      if (!L) continue
      if (L.html !== undefined) {
        flush()
        out += L.html
        continue
      }
      if (L.wrap !== undefined) {
        flush()
        out += L.wrap + this.render(L.items, twice || L.twice) + L.end
        continue
      }
      if (!L.size) continue
      if (!L.anim) {
        if (process.env.STATS) (this.stats.each ??= []).push([L.name, runsOf(emitCells(L))])
        still ??= new Layer('')
        still.name += (still.name ? '+' : '') + L.name
        if (L.needBack) still.needBack = true
        if (L.coats === false) still.coats = false
        if (L.twice) still.twice = true
        for (const [x, y, c] of cells(L)) if (x >= -2 && x < W + 2 && y >= -42 && y < H + 2) still.set(x, y, c)
        continue
      }
      flush()
      const a = L.anim
      const body = L.twice || twice ? this.double(this.draw(L)) : this.draw(L)
      out += '<g class="' + a.cls + '"' + (a.style ? ' style="' + a.style + '"' : '') + (a.extra ?? '') + '>' + body + '</g>'
    }
    flush()
    return out
  }

  body() {
    const view = pin => '<svg viewBox="0 -.5 ' + W + ' ' + H + '" preserveAspectRatio="' + PIN[pin] + ' slice">'
    let out = ''
    let pin = null
    for (const [p, items] of this.parts) {
      const html = this.render(items)
      if (!html) continue
      if (p !== pin) {
        if (pin) out += '</svg>'
        out += view(p)
        pin = p
      }
      out += html
    }
    return pin ? out + '</svg>' : out
  }
}

// Drops cells of still layers that a still layer above them in the same list always covers,
// but keeps a hidden one-cell rim under the upper layer's edge (seam fix): a cell goes only when
// its four neighbours are covered too. Two pattern layers' edges do not add up like coats (each
// tile bitmap is resampled), so without the rim the back showed between them.
export function cull(items) {
  const covered = new Set()
  const N4 = k => [k - ROW, k - 1, k + 1, k + ROW]
  const deep = k => N4(k).every(n => covered.has(n))
  for (let i = items.length - 1; i >= 0; i--) {
    const L = items[i]
    if (!L || L.html !== undefined || L.wrap !== undefined || L.anim || L.keep) continue
    const drop = []
    const add = []
    const rim = []
    for (const k of L.m.keys()) {
      if (covered.has(k) && deep(k)) drop.push(k)
      else {
        add.push(k)
        if (covered.has(k)) rim.push(k)
      }
    }
    // A rim cell shows only inside the upper edge's pixels, beside the visible cell next to
    // it: it takes that cell's colour (above first), which is also cheaper to write.
    const recolour = []
    for (const k of rim) {
      const n = N4(k).find(n => !covered.has(n) && L.m.has(n))
      if (n !== undefined) recolour.push([k, L.m.get(n)])
    }
    for (const k of drop) L.m.delete(k)
    for (const [k, c] of recolour) L.m.set(k, c)
    for (const k of add) covered.add(k)
  }
}

// ---------------------------------------------------------------- the app's scrub length

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
