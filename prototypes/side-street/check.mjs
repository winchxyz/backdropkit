// Quick rule check for the built SVGs: size, banned words, media queries, runs per path, clock.
// Usage: node check.mjs [moments...]
import { readFileSync } from 'node:fs'

const moments = process.argv.slice(2).length ? process.argv.slice(2) : ["day", "evening", "night"]
for (const m of moments) {
  const svg = readFileSync(new URL('./out/side-street-' + m + '.svg', import.meta.url), 'utf8')
  const issues = []
  if (svg.length > 131072) issues.push('over 131072 chars')
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
  console.log(m.padEnd(8), svg.length, 'chars, max runs/path', maxRuns, issues.length ? 'ISSUES: ' + [...new Set(issues)].join('; ') : 'ok')
}
