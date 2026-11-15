// Rule check for the built SVGs: size, elements, banned words, media queries, url()s, runs per
// path, filtered groups, the 0.05 s clock and the reduced-motion stop.
// Usage: node check.mjs [moment ...]
import { readFileSync } from 'node:fs'

// `use`: the coats of the moving layers (engine/README.md lesson 6), each a copy of a group here.
const ELEMENTS = new Set(['svg', 'style', 'defs', 'pattern', 'rect', 'path', 'g', 'use'])
const moments = process.argv.slice(2).length ? process.argv.slice(2) : ['day', 'sunset', 'night']
for (const m of moments) {
  const svg = readFileSync(new URL('./out/lavender-slope-' + m + '.svg', import.meta.url), 'utf8')
  const issues = []
  if (svg.length > 131072) issues.push('over 131072 chars')
  const used = new Set([...svg.matchAll(/<([a-zA-Z]+)[\s>/]/g)].map(e => e[1]))
  for (const e of used) if (!ELEMENTS.has(e)) issues.push('element ' + e)
  if (/shape-rendering|vector-effect|data:/i.test(svg)) issues.push('banned property')
  if (/(?:\d|\.)(?:[dsl]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max))(?![a-z0-9_-])/i.test(svg)) issues.push('viewport unit')
  if (svg.includes('"')) issues.push('double quote')
  if (!svg.startsWith("<svg xmlns='http://www.w3.org/2000/svg' fill='none' font-family='a' color='a' style='--m:0s'>")) issues.push('root')
  for (const [, q] of svg.matchAll(/@media([^{]*)\{/g)) if (q.trim() !== '(prefers-reduced-motion:reduce)') issues.push('media ' + q)
  for (const u of svg.matchAll(/url\(([^)]*)\)/g)) if (!/^#[A-Za-z_][\w.:-]*$/.test(u[1])) issues.push('url ' + u[1])
  for (const u of svg.matchAll(/<use([^>]*)>/g)) {
    const h = u[1].match(/^ href='(#[A-Za-z_][\w.:-]*)'\/$/)
    if (!h || !svg.includes(" id='" + h[1].slice(1) + "'")) issues.push('use' + u[1])
  }
  const filters = (svg.match(/ filter=/g) || []).length
  if (filters > 2) issues.push(filters + ' filtered groups')
  let maxRuns = 0
  for (const [, d] of svg.matchAll(/ d='([^']*)'/g)) maxRuns = Math.max(maxRuns, (d.match(/h/g) || []).length)
  if (maxRuns > 64) issues.push('path with ' + maxRuns + ' runs')
  // Every time in the CSS sits on the 0.05 s clock.
  const css = (svg.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1] + [...svg.matchAll(/ style='([^']*)'/g)].map(s => s[1]).join(';')
  for (const [t] of css.matchAll(/-?\d*\.?\d+s\b/g)) {
    const v = parseFloat(t) * 20
    if (Math.abs(v - Math.round(v)) > 1e-6) issues.push('off-clock ' + t)
  }
  // Every animation runs on steps().
  for (const [a] of css.matchAll(/animation:[^;}]*/g)) if (!/steps\(|animation:none/.test(a)) issues.push('not stepped: ' + a)
  if (!/prefers-reduced-motion:reduce\)\{:root \*\{animation:none!important\}\}/.test(svg)) issues.push('no reduced-motion stop')
  console.log(
    m.padEnd(7),
    svg.length,
    'chars | max runs/path',
    maxRuns,
    '| filters',
    filters,
    '| elements',
    [...used].join(' '),
    issues.length ? '| ISSUES: ' + [...new Set(issues)].join('; ') : '| ok',
  )
}
