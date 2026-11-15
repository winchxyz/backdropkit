// Writes a painted scene as one SVG, the way Sunfield's build does it
// (../../../sunfield/tools/build.mjs), so that no hairline shows at any window size (see
// ../../engine/README.md and notes.md, "Encoding and hairlines"):
// - every cell layer is written by emitSafe (./encode-local.mjs, Tide Line's copy of the
//   engine encoder): colours joined under one another, split paths overlapping, tall paths cut;
// - a pattern tile has its corner on a cell corner and a clear cell all round (the tile
//   repeats, and where its edge falls inside a screen pixel the far side would bleed in);
// - rows of a big layer that are all one colour are drawn as band strokes, each a row deeper
//   than its rows, under its cells;
// - a still cell covered by a still layer above is dropped only when that layer covers all four
//   of its neighbours too, so a cell of the layer below lies under every edge of the one above;
// - a moving layer is drawn in two coats (the second a <use> of the first, inside the same
//   animated group), so its edges over what moves under it hold, and lays nothing under its
//   outer cells (emitSafe's `edge`); a still layer takes the milder `edge: 'near'`;
// - a layer that only fades in place (FIXED classes) drops the cells a still layer above covers.
import { Layer, bounds } from '../../../sunfield/tools/pixel.mjs'
import { emitSafe } from './encode-local.mjs'

export const W = 320
export const H = 200
const ROW = 4096

const cellKey = (x, y) => (y + 1000) * ROW + (x + 1000)
export const cellXY = k => [(k % ROW) - 1000, Math.floor(k / ROW) - 1000]
const PATTERN_MIN = 55
export const runsOf = s => (s.match(/[hv]-?\d/g) ?? []).length
const f2 = v => String(Math.round(v * 100) / 100).replace(/^0\./, '.').replace(/^-0\./, '-.')

// Each viewport is the whole grid scaled to cover the window, aligned to a corner.
const PIN = { '': 'xMidYMid', pB: 'xMidYMax', pBL: 'xMinYMax', pBR: 'xMaxYMax', pTR: 'xMaxYMin', pTL: 'xMinYMin', pT: 'xMidYMin' }

// parts: [[pin, entries]] in paint order. An entry is a Layer (still, or moving when it has
// .anim = { cls, style, extra }), { under: Layer } (a big still layer whose full rows become
// bands), { wrap, end, layers } (moving groups around layers), or { raw } (markup as it is).
// extraDefs: gradients and clip paths the raw markup refers to (their ids upper-case).
// A still layer with .clear = true is see-through: it hides nothing under it.
// SAFE: emitSafe's options for every layer (env SAFE_T overrides T).
export function encode(parts, rules, rootStyle = '--m:0s', extraDefs = [], SAFE = {}) {
  const defs = []
  let ids = 0
  // Pattern ids are lower-case letters; every other id in the scene is upper-case.
  const nextId = () => {
    let n = ids++
    let s = ''
    do {
      s = String.fromCharCode(97 + (n % 26)) + s
      n = Math.floor(n / 26) - 1
    } while (n >= 0)
    return s
  }
  const stats = { patterns: 0, runs: 0, bands: 0, byLayer: new Map(), chars: new Map(), merged: 0 }
  // Debug: CELLS='x,y x,y' prints, per layer, its colour at those cells (in paint order).
  if (process.env.CELLS) {
    const at = process.env.CELLS.split(' ').map(p => p.split(',').map(Number))
    for (const [pin, es] of parts) {
      const visit = (list, deep) => {
        for (const e of list) {
          if (!e) continue
          const L = e instanceof Layer ? e : e.under ?? null
          if (L) {
            const hit = at.map(([x, y]) => L.m.get(cellKey(x, y)) ?? '-')
            if (hit.some(h => h !== '-')) console.log(pin, (e.under ? 'under:' : '') + L.name + (L.anim ? '(anim)' : ''), hit.join(' '))
          } else if (e.layers) visit(e.layers, deep + 1)
        }
      }
      visit(es, 0)
    }
  }

  // Colours closer than MERGE (summed over R, G, B) cannot be told apart on screen, but where
  // two of them meet inside a screen pixel what lies below bleeds in between them as a hairline
  // (the shading makes many such pairs). Each one becomes the commoner of the two.
  const MERGE = Number(process.env.MERGE ?? 12)
  if (MERGE > 0) {
    const all = []
    const visit = es => {
      for (const e of es) {
        if (!e) continue
        if (e instanceof Layer) all.push(e)
        else if (e.under) all.push(e.under)
        else if (e.layers) visit(e.layers)
      }
    }
    for (const [, es] of parts) visit(es)
    const count = new Map()
    for (const L of all) for (const c of L.m.values()) count.set(c, (count.get(c) ?? 0) + 1)
    const kept = []
    const map = new Map()
    for (const [c] of [...count].sort((a, b) => b[1] - a[1])) {
      const n = parseInt(c.slice(1), 16)
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      const to = kept.find(k => Math.abs(k[1] - r) + Math.abs(k[2] - g) + Math.abs(k[3] - b) <= MERGE)
      if (to) map.set(c, to[0])
      else kept.push([c, r, g, b])
    }
    stats.merged = map.size
    for (const L of all) for (const [k, c] of L.m) if (map.has(c)) L.m.set(k, map.get(c))
  }

  // Still cells a still layer above always covers are dropped, per viewport (cells of two
  // viewports line up only at one window shape). A cell along the edge of what covers it stays
  // (ERODE=0: dropped too), so where that edge falls inside a screen pixel the layer below is
  // still under it. Cells off the grid never show: every viewport is sliced.
  // Where a still cell meets a cell of the same colour drawn by a layer above (another path),
  // what lies below would show between them as a hairline: the lower layer then carries its
  // colour one cell on under the upper one, so it alone covers that screen pixel (TUCK=0: off).
  const ERODE = process.env.ERODE !== '0'
  const TUCK = process.env.TUCK !== '0'
  const RING = process.env.RING ?? '0'
  // Classes whose motion is only opacity, in place (see build.mjs's CSS).
  const FIXED = new RegExp('^(' + (process.env.FIXED ?? 'gl|lb|tk|ta|tb') + ')$')
  const covered = new Map()
  const stillOf = e => (!e ? null : e instanceof Layer && !e.anim ? e : e.under ? e.under : null)
  const inside = (cov, k) => cov.has(k) && (!ERODE || (cov.has(k - 1) && cov.has(k + 1) && cov.has(k - ROW) && cov.has(k + ROW)))
  for (let i = parts.length - 1; i >= 0; i--) {
    const [pin, entries] = parts[i]
    let cov = covered.get(pin)
    if (!cov) covered.set(pin, (cov = new Map()))
    for (let j = entries.length - 1; j >= 0; j--) {
      // A layer that only fades in and out in place (a glint, a twinkle) never shows where a
      // still layer above covers it, and there its edge would trace that layer's cell edges as
      // a light outline: such cells are dropped.
      const e = entries[j]
      if (e instanceof Layer && e.anim && FIXED.test(e.anim.cls.split(' ')[0])) {
        for (const k of [...e.m.keys()]) if (cov.has(k)) e.m.delete(k)
        continue
      }
      const L = stillOf(entries[j])
      if (!L) continue
      const keep = []
      for (const k of [...L.m.keys()]) {
        const [x, y] = cellXY(k)
        if (x < 0 || x >= W || y < 0 || y >= H || inside(cov, k)) L.m.delete(k)
        else keep.push(k)
      }
      if (TUCK) {
        // RING (default 'strict'): every colour, not only the same one, carries a cell on under
        // the layer above, a hidden 1-cell ring, so where the two layers abut what lies below
        // both never shows between them. 'strict' lays a ring cell only where each of its
        // neighbours is covered from above or is the layer's own, so no ring edge is open.
        const tuck = new Map()
        for (const k of keep) {
          const c = L.m.get(k)
          for (const d of [1, -1, ROW, -ROW]) {
            const n = k + d
            if (!cov.has(n) || L.m.has(n) || tuck.has(n)) continue
            if (cov.get(n) === c || RING === '1') tuck.set(n, c)
            else if (RING === 'strict' && [n - 1, n + 1, n - ROW, n + ROW].every(m => cov.has(m) || L.m.has(m))) tuck.set(n, c)
          }
        }
        for (const [k, c] of tuck) L.m.set(k, c)
      }
      if (!L.clear) for (const k of keep) cov.set(k, L.m.get(k))
    }
  }

  // A layer's cells, by emitSafe.
  const safe = { ...SAFE, ...(process.env.SAFE_T ? { T: Number(process.env.SAFE_T) } : {}) }
  // A moving layer (EDGE=all: every layer) lays no colour under its outer cells: what lies
  // outside often matches them (a cloud's rim against the sky), and anything under would show.
  const EDGE = process.env.EDGE ?? 'near'
  // A still layer keeps only its backing off its outer cells (EDGE=anim: not even that).
  const edgeOf = L => (EDGE === 'all' || L.anim ? true : EDGE === 'back' || EDGE === 'near' ? EDGE : false)
  const cellsOf = (L, ox = 0, oy = 0) => emitSafe(L, { ox, oy, ...safe, edge: edgeOf(L), ...(L.safe ?? {}) })

  function draw(L) {
    const plain = cellsOf(L)
    const runs = runsOf(plain)
    stats.runs += runs
    stats.byLayer.set(L.name, (stats.byLayer.get(L.name) ?? 0) + runs)
    if (runs < PATTERN_MIN) return plain
    stats.patterns++
    const b = bounds(L)
    const x = b.x0 - 1
    const y = b.y0 - 1.5
    const id = nextId()
    if (process.env.PATS) console.log('pattern', id, L.name, L.anim ? 'anim' : 'still', x, y, b.x1 - b.x0 + 2, b.y1 - b.y0 + 2)
    defs.push('<pattern id="' + id + '" width="1" height="1">' + cellsOf(L, x, y) + '</pattern>')
    stats.chars.set(L.name, (stats.chars.get(L.name) ?? 0) + defs[defs.length - 1].length)
    return '<rect x="' + x + '" y="' + y + '" width="' + (b.x1 - b.x0 + 2) + '" height="' + (b.y1 - b.y0 + 2) + '" fill="url(#' + id + ')"/>'
  }

  // Full rows of one colour become band strokes, each a row deeper than its rows and under the
  // next, so no seam shows between them; only the cells that differ stay cells.
  function underlay(L) {
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
    for (const y of ys) {
      const r = rows.get(y)
      if (r.n < W) continue
      let best = null
      for (const [c, n] of r.count) if (!best || n > best[1]) best = [c, n]
      colourOf.set(y, best[0])
    }
    for (const [k, c] of [...L.m]) if (colourOf.get(cellXY(k)[1]) === c) L.m.delete(k)
    let out = ''
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
      out += '<path stroke="' + c + '" stroke-width="' + (h + 1) + '" d="M0 ' + f2(ys[i] + h / 2) + 'h' + W + '"/>'
      stats.bands++
      i = j + 1
    }
    return out
  }

  const open = L => '<g class="' + L.anim.cls + '"' + (L.anim.style ? ' style="' + L.anim.style + '"' : '') + (L.anim.extra ?? '') + '>'
  // A moving layer in two coats: the second a copy of the first, in the same animated group.
  // Ids of coats are upper-case, like every id but the patterns'.
  let coats = 0
  const twoCoats = html => {
    if (process.env.COATS === '1') return html
    if (html.length < 40) return html + html
    const id = 'C' + (coats++).toString(36).toUpperCase()
    return '<g id="' + id + '">' + html + '</g><use href="#' + id + '"/>'
  }
  const drawStill = L => draw(L)
  function renderLayers(layers) {
    let out = ''
    let still = null
    const flush = () => {
      if (still) out += drawStill(still)
      still = null
    }
    for (const L of layers) {
      if (!L) continue
      if (L.raw !== undefined) {
        flush()
        out += L.raw
        continue
      }
      if (L.under) {
        flush()
        out += underlay(L.under) + (L.under.size ? drawStill(L.under) : '')
        continue
      }
      if (L.wrap) {
        flush()
        out += L.wrap + renderLayers(L.layers) + L.end
        continue
      }
      if (!L.size) continue
      if (!L.anim) {
        if (L.clear || L.attrs) {
          flush()
          out += L.attrs ? '<g' + L.attrs + '>' + drawStill(L) + '</g>' : drawStill(L)
          continue
        }
        still ??= new Layer('')
        still.name += (still.name ? '+' : '') + L.name
        for (const [k, c] of L.m) still.m.set(k, c)
        continue
      }
      flush()
      out += open(L) + twoCoats(draw(L)) + '</g>'
    }
    flush()
    return out
  }

  const view = pin => '<svg viewBox="0 -.5 ' + W + ' ' + H + '" preserveAspectRatio="' + PIN[pin] + ' slice">'
  // Neighbouring parts in one viewport are drawn as one list, so still layers on either side
  // of a part boundary are written together (a colour shared across them is joined too).
  const runsOfParts = []
  for (const [p, entries] of parts) {
    const last = runsOfParts[runsOfParts.length - 1]
    if (last && last[0] === p && process.env.COALESCE !== '0') last[1] = last[1].concat(entries)
    else runsOfParts.push([p, entries])
  }
  let body = ''
  let pin = null
  for (const [p, entries] of runsOfParts) {
    const html = renderLayers(entries)
    if (!html) continue
    if (p !== pin) {
      if (pin !== null) body += '</svg>'
      body += view(p)
      pin = p
    }
    body += html
  }
  if (pin !== null) body += '</svg>'

  const CSS = rules.join('')
  let svg =
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" font-family="a" color="a" style="' + rootStyle + '">' +
    '<style>' + CSS + '</style><defs>' + defs.join('') + extraDefs.join('') + '</defs>' + body + '</svg>'
  // Single quotes: the scene travels to the app inside JSON, where a double quote costs a backslash.
  svg = svg.replaceAll('"', "'")
  return { svg, stats, css: CSS.length, defs }
}

// What the app's scrub leaves: no @keyframes, and every <x/> written out as <x></x>.
export function scrubbedLength(svg) {
  const kf = [...svg.matchAll(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g)].reduce((n, m) => n + m[0].length, 0)
  return svg.length - kf + [...svg.matchAll(/<(\w+)[^>]*\/>/g)].reduce((n, m) => n + 2 + m[1].length, 0)
}
