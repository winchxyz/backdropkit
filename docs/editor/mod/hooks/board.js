// A price board drawn into a theme's scene at play time: live figures as pixel digits. Plain ES
// module with no dependencies; the theme mod (register.tsx), the packer, the site and the
// scene checks all use this one file (engine/board.mjs re-exports it).
//
// A scene with a board (Gas Station, so far) leaves an empty marker group in its Svg,
// <g id='bk-board'></g>, and its build writes board.json beside the scenes; the packer puts
// that into theme.js as THEME.board:
//
//   {
//     "yo": 0,                      // y of the run line for cell row r is r + yo (the scene's
//                                   // own convention where the marker sits)
//     "rows": [                     // top to bottom; each a window on the board, in cells
//       { "id": "tokens",  "x": 20, "y": 80, "w": 24, "align": "right" },
//       { "id": "context", "x": 20, "y": 92, "w": 24, "align": "right" },
//       { "id": "weekly",  "x": 20, "y": 104, "w": 24, "align": "right" }
//     ],
//     "ink":  { "<moment id>": "#rrggbb", ... },   // digit colour at each moment
//     "halo": { "<moment id>": "#rrggbb", ... }    // optional: a 1-cell glow at that moment
//   }
//
// Every window is 7 cells tall (the digits' height) and at least 24 wide (five glyphs); with a
// halo, keep a clear cell round each window's digits (the halo reaches one cell out).
// The theme mod fills the marker with the live figures; the site and the checks fill it with
// SAMPLE.
//
// The figures: tokens this chat has sent and received (cache reads included, as the API counts
// them), how full the context window is, and how much of the weekly limit is used.

export const GLYPH_H = 7
export const MIN_W = 24
export const MARKER = "<g id='bk-board'></g>"
export const SAMPLE = { tokens: 1240000, context: 62, weekly: 34 }
const MAX_RUNS = 64

// 7-row pixel glyphs, '#' lit. Digits and letters are 4 wide, '.' 1, '%' and 'M' 5.
const FONT = {
  0: ['.##.', '#..#', '#..#', '#..#', '#..#', '#..#', '.##.'],
  1: ['..#.', '.##.', '..#.', '..#.', '..#.', '..#.', '.###'],
  2: ['.##.', '#..#', '...#', '..#.', '.#..', '#...', '####'],
  3: ['.##.', '#..#', '...#', '.##.', '...#', '#..#', '.##.'],
  4: ['..#.', '.##.', '#.#.', '#.#.', '####', '..#.', '..#.'],
  5: ['####', '#...', '###.', '...#', '...#', '#..#', '.##.'],
  6: ['.##.', '#...', '#...', '###.', '#..#', '#..#', '.##.'],
  7: ['####', '...#', '..#.', '..#.', '.#..', '.#..', '.#..'],
  8: ['.##.', '#..#', '#..#', '.##.', '#..#', '#..#', '.##.'],
  9: ['.##.', '#..#', '#..#', '.###', '...#', '...#', '.##.'],
  K: ['#..#', '#..#', '#.#.', '##..', '#.#.', '#..#', '#..#'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  B: ['###.', '#..#', '#..#', '###.', '#..#', '#..#', '###.'],
  '%': ['##..#', '##..#', '...#.', '..#..', '.#...', '#..##', '#..##'],
  '-': ['....', '....', '....', '####', '....', '....', '....'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  ' ': ['..', '..', '..', '..', '..', '..', '..'],
}

// Three significant figures with a unit: 999, 1.24K, 12.4K, 124K, 1.24M ... 1.24B.
export function tokensText(n) {
  if (!Number.isFinite(n) || n < 0) return '--'
  if (n < 1000) return String(Math.round(n))
  for (const [unit, v] of [['K', 1e3], ['M', 1e6], ['B', 1e9]]) {
    const x = n / v
    if (x < 999.5 || unit === 'B') {
      const s = x < 9.995 ? x.toFixed(2) : x < 99.95 ? x.toFixed(1) : Math.round(x).toFixed(0)
      return s + unit
    }
  }
  return '--'
}
export const percentText = p => (Number.isFinite(p) ? Math.max(0, Math.min(999, Math.round(p))) + '%' : '--%')
export function textsOf(values) {
  return { tokens: tokensText(values.tokens), context: percentText(values.context), weekly: percentText(values.weekly) }
}

const widthOf = text => [...text].reduce((w, c, i) => w + (FONT[c] ?? FONT[' '])[0].length + (i ? 1 : 0), 0)

// The lit cells of `text` with its top-left at (x, y), as [x, y] pairs.
function cellsOf(text, x, y) {
  const out = []
  let cx = x
  for (const c of text) {
    const g = FONT[c] ?? FONT[' ']
    g.forEach((row, r) => [...row].forEach((ch, i) => ch === '#' && out.push([cx + i, y + r])))
    cx += g[0].length + 1
  }
  return out
}

// Cells as stroke-width-1 runs, one row at a time, at most MAX_RUNS runs a path.
function paths(cells, color, yo) {
  const rows = new Map()
  for (const [x, y] of cells) rows.set(y, [...(rows.get(y) ?? []), x])
  const runs = []
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    const xs = [...new Set(rows.get(y))].sort((a, b) => a - b)
    let s = xs[0]
    let p = xs[0]
    for (const x of xs.slice(1).concat([Infinity])) {
      if (x === p + 1) {
        p = x
        continue
      }
      runs.push(`M${s} ${y + yo}h${p - s + 1}`)
      s = p = x
    }
  }
  const out = []
  for (let i = 0; i < runs.length; i += MAX_RUNS) out.push(`<path stroke='${color}' d='${runs.slice(i, i + MAX_RUNS).join('')}'/>`)
  return out.join('')
}

// The marker's contents for `moment`, with `values` ({ tokens, context, weekly }; a missing
// figure shows as dashes).
//
// Each window gets its own paths, so no path's box is over 9 rows high (Chromium rounds the
// corners of big paths). The halo is the digits grown by a cell, drawn first and also under
// the digits themselves, so a digit's edge falls on halo and never shows the window between.
export function boardMarkup(board, moment, values) {
  const texts = textsOf(values)
  const ink = board.ink[moment] ?? Object.values(board.ink)[0]
  const haloColor = board.halo?.[moment]
  const yo = board.yo ?? 0
  let out = ''
  for (const row of board.rows) {
    const text = texts[row.id] ?? '--'
    const w = widthOf(text)
    const x = row.align === 'left' ? row.x : row.align === 'center' ? row.x + Math.floor((row.w - w) / 2) : row.x + row.w - w
    const lit = cellsOf(text, Math.max(row.x, x), row.y)
    if (haloColor) {
      const grown = new Map()
      for (const [cx, cy] of lit)
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) grown.set(cx + dx + ',' + (cy + dy), [cx + dx, cy + dy])
      out += paths([...grown.values()], haloColor, yo)
    }
    out += paths(lit, ink, yo)
  }
  return out
}

// The scene with its board filled; a scene without the marker comes back as it is.
export function fillBoard(svg, board, moment, values) {
  const at = svg.indexOf(MARKER)
  if (at < 0 || !board) return svg
  return svg.slice(0, at) + "<g id='bk-board'>" + boardMarkup(board, moment, values) + '</g>' + svg.slice(at + MARKER.length)
}

// The board's own checks: windows tall and wide enough for the widest figures.
export function checkBoard(board) {
  const problems = []
  for (const row of board.rows ?? []) {
    if (row.w < MIN_W) problems.push(`${row.id}: ${row.w} cells wide, needs ${MIN_W}`)
    const widest = Math.max(widthOf('1.24M'), widthOf('100%'), widthOf('--%'))
    if (row.w < widest) problems.push(`${row.id}: ${row.w} cells wide, the widest figure takes ${widest}`)
  }
  if (!board.rows?.length) problems.push('no rows')
  if (!board.ink || !Object.keys(board.ink).length) problems.push('no ink colours')
  return problems
}
