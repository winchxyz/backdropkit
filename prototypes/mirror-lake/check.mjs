// Rule check for the built SVGs: size (raw and after the app's scrub), banned properties, viewport
// units, quotes, media queries, url() targets, stroke runs per path, filters, the 0.05 s clock
// (durations, delays and the time each keyframe or step lands on), and the reduced-motion stop.
// Usage: node check.mjs [moment ...]
import { readFileSync } from 'node:fs'
import { scrubbedLength } from './lib.mjs'

const moments = process.argv.slice(2).length ? process.argv.slice(2) : ['day', 'sunset', 'night']
const onClock = v => Math.abs(v * 20 - Math.round(v * 20)) < 1e-6
let bad = false
for (const m of moments) {
  const svg = readFileSync(new URL('./out/mirror-lake-' + m + '.svg', import.meta.url), 'utf8')
  const css = (svg.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1]
  const issues = []
  const scrubbed = scrubbedLength(svg, css)
  if (svg.length > 131072 || scrubbed > 131072) issues.push('over 131072 chars')
  if (/shape-rendering|vector-effect/i.test(svg)) issues.push('banned property')
  if (/(?:\d|\.)(?:[dsl]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max))(?![a-z0-9_-])/i.test(svg)) issues.push('viewport unit')
  if (svg.includes('"')) issues.push('double quote')
  if (!/^<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg' fill='none' font-family='a' color='a' style='--m:0s'>/.test(svg)) issues.push('root element')
  for (const [, q] of svg.matchAll(/@media([^{]*)\{/g)) if (q.trim() !== '(prefers-reduced-motion:reduce)') issues.push('media ' + q)
  for (const u of svg.matchAll(/url\(([^)]*)\)/g)) if (!/^#[A-Za-z_][\w.:-]*$/.test(u[1])) issues.push('url ' + u[1])
  const filters = (svg.match(/filter=/g) || []).length
  if (filters > 2) issues.push(filters + ' filtered groups')
  // Stroke runs: every path that is not a filled shape.
  let maxRuns = 0
  for (const [tag, d] of svg.matchAll(/<path(?![^>]*fill=)[^>]* d='([^']*)'/g)) {
    void tag
    maxRuns = Math.max(maxRuns, (d.match(/[Mm]/g) || []).length)
  }
  if (maxRuns > 64) issues.push('path with ' + maxRuns + ' runs')
  // The clock: every time in the CSS and the inline styles, and every keyframe's moment.
  const styles = [...svg.matchAll(/ style='([^']*)'/g)].map(s => s[1]).join(';')
  for (const [t] of (css + ';' + styles).matchAll(/-?\d*\.?\d+s\b/g)) if (!onClock(parseFloat(t))) issues.push('off-clock ' + t)
  // Keyframes name -> the durations it runs with: fixed in its rule, or each element's --d.
  const durations = new Map()
  const perClass = new Map()
  for (const [, cls, style] of svg.matchAll(/class='([^']*)' style='([^']*)'/g)) {
    const d = /--d:([\d.]+)s/.exec(style)
    if (d) for (const c of cls.split(' ')) perClass.set(c, [...(perClass.get(c) ?? []), parseFloat(d[1])])
  }
  for (const [, cls, body] of css.matchAll(/\.(\w+)\{animation:([^}]*)\}/g)) {
    const [name, dur] = body.split(' ')
    const list = durations.get(name) ?? []
    if (dur.startsWith('var(')) list.push(...(perClass.get(cls) ?? []))
    else list.push(parseFloat(dur))
    durations.set(name, list)
  }
  for (const [, name, frames] of css.matchAll(/@keyframes (\w+)\{((?:[^{}]*\{[^{}]*\})*)\}/g)) {
    for (const [, pcts] of frames.matchAll(/([\d.%,]+)\{/g)) {
      for (const p of pcts.split(',')) {
        const f = parseFloat(p) / 100
        for (const d of new Set(durations.get(name) ?? [])) if (!onClock(f * d)) issues.push('keyframe ' + name + ' ' + p + ' of ' + d + 's')
      }
    }
  }
  if (!/@media \(prefers-reduced-motion:reduce\)\{:root \*\{animation:none!important\}\}/.test(svg)) issues.push('no reduced-motion stop')
  if (issues.length) bad = true
  console.log(m.padEnd(7), svg.length, 'chars, scrubbed ~' + scrubbed + ', max runs/path', maxRuns, ', filters', filters, issues.length ? 'ISSUES: ' + [...new Set(issues)].join('; ') : 'ok')
}
process.exit(bad ? 1 : 0)
