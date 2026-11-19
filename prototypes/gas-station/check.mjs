// Rule check for the built scenes: size, banned words, media queries, runs per path, clock, the
// board's marker and board.json; then the same rules again on copies with the board filled
// (SAMPLE and two edge cases), which it writes to out/filled/ for seamscan, purity and the player.
// Usage: node check.mjs [moments...]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MARKER, SAMPLE, checkBoard, fillBoard } from '../../engine/board.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LIMIT = 126000
const moments = process.argv.slice(2).length ? process.argv.slice(2) : ['day', 'sunset', 'night']
const CASES = [
  ['sample', SAMPLE],
  ['small', { tokens: 888, context: 5 }],
  ['full', { tokens: 99.9e3, context: 100, weekly: 100 }],
]

// The rules every scene keeps (from side-street's check).
function rules(svg) {
  const issues = []
  if (/shape-rendering|vector-effect/i.test(svg)) issues.push('banned property')
  if (/(?:\d|\.)(?:[dsl]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max))(?![a-z0-9_-])/i.test(svg)) issues.push('viewport unit')
  if (svg.includes('"')) issues.push('double quote')
  for (const [, q] of svg.matchAll(/@media([^{]*)\{/g)) if (q.trim() !== '(prefers-reduced-motion:reduce)') issues.push('media ' + q)
  for (const u of svg.matchAll(/url\(([^)]*)\)/g)) if (!/^#[A-Za-z_][\w.:-]*$/.test(u[1])) issues.push('url ' + u[1])
  let maxRuns = 0
  for (const [, d] of svg.matchAll(/ d='([^']*)'/g)) maxRuns = Math.max(maxRuns, (d.match(/[Mm]/g) || []).length)
  if (maxRuns > 64) issues.push('path with ' + maxRuns + ' runs')
  // Every time in the CSS should sit on the 0.05 s clock.
  const css = (svg.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1] + [...svg.matchAll(/ style='([^']*)'/g)].map(s => s[1]).join(';')
  for (const [t] of css.matchAll(/-?\d*\.?\d+s\b/g)) {
    const v = parseFloat(t) * 20
    if (Math.abs(v - Math.round(v)) > 1e-6) issues.push('off-clock ' + t)
  }
  if (!/prefers-reduced-motion:reduce\)\{:root \*\{animation:none!important\}\}/.test(svg)) issues.push('no reduced-motion stop')
  return { issues, maxRuns }
}

// The marker: once, a direct child of the nested 320 x 200 Svg, with no transform above it.
function markerPlace(svg) {
  const issues = []
  const count = svg.split(MARKER).length - 1
  if (count !== 1) issues.push('marker ' + count + ' times')
  const at = svg.indexOf(MARKER)
  if (at < 0) return issues
  const stack = []
  for (const m of svg.slice(0, at).matchAll(/<(\/?)([A-Za-z][\w:-]*)([^>]*?)(\/?)>/g)) {
    const [, close, name, attrs, self] = m
    if (close) stack.pop()
    else if (!self) stack.push({ name, attrs })
  }
  const names = stack.map(s => s.name).join('>')
  if (names !== 'svg>svg') issues.push('marker inside ' + names)
  else if (!/viewBox='0 -\.5 320 200'/.test(stack[1].attrs)) issues.push('marker not in the 320 x 200 Svg')
  if (stack.some(s => /transform/.test(s.attrs))) issues.push('transform above the marker')
  return issues
}

const board = JSON.parse(fs.readFileSync(path.join(HERE, 'out', 'board.json'), 'utf8'))
const bp = checkBoard(board)
console.log('board.json', bp.length ? 'PROBLEMS: ' + bp.join('; ') : 'ok')
let bad = bp.length > 0
fs.mkdirSync(path.join(HERE, 'out', 'filled'), { recursive: true })
for (const m of moments) {
  const svg = fs.readFileSync(path.join(HERE, 'out', 'gas-station-' + m + '.svg'), 'utf8')
  const { issues, maxRuns } = rules(svg)
  if (svg.length > LIMIT) issues.push('over ' + LIMIT + ' chars')
  issues.push(...markerPlace(svg))
  if (!board.ink[m]) issues.push('no ink for ' + m)
  console.log(m.padEnd(7), String(svg.length).padStart(6), 'chars, max runs/path', maxRuns, issues.length ? 'ISSUES: ' + [...new Set(issues)].join('; ') : 'ok')
  bad ||= issues.length > 0
  for (const [name, values] of CASES) {
    const filled = fillBoard(svg, board, m, values)
    const r = rules(filled)
    if (filled === svg) r.issues.push('board not filled')
    const f = path.join(HERE, 'out', 'filled', 'gas-station-' + m + '-' + name + '.svg')
    fs.writeFileSync(f, filled)
    console.log('  ' + name.padEnd(7), String(filled.length).padStart(6), 'chars, max runs/path', r.maxRuns, r.issues.length ? 'ISSUES: ' + [...new Set(r.issues)].join('; ') : 'ok')
    bad ||= r.issues.length > 0
  }
}
process.exitCode = bad ? 1 : 0
