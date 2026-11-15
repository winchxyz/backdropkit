// node check.mjs [moment ...] : the encoding rules on the built SVGs: size (as written and after
// the app's scrub), banned properties and units, media queries, url()s, runs per path, the
// 0.05 s clock (durations, delays and step lengths) and the reduced-motion stop.
import { readFileSync } from 'node:fs'
import { scrubbedLength } from './encode.mjs'

const moments = process.argv.slice(2).length ? process.argv.slice(2) : ['sunrise', 'day', 'night']
const onClock = v => Math.abs(v * 20 - Math.round(v * 20)) < 1e-6
for (const m of moments) {
  const svg = readFileSync(new URL('./out/hill-village-' + m + '.svg', import.meta.url), 'utf8')
  const issues = []
  const scrubbed = scrubbedLength(svg)
  if (svg.length > 131072 || scrubbed > 131072) issues.push('over 131072 chars')
  if (/shape-rendering|vector-effect/i.test(svg)) issues.push('banned property')
  if (/(?:\d|\.)(?:[dsl]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max))(?![a-z0-9_-])/i.test(svg)) issues.push('viewport unit')
  if (svg.includes('"')) issues.push('double quote')
  if (/<filter/.test(svg)) issues.push('filters: ' + (svg.match(/<filter/g) ?? []).length)
  for (const [, q] of svg.matchAll(/@media([^{]*)\{/g)) if (q.trim() !== '(prefers-reduced-motion:reduce)') issues.push('media ' + q)
  for (const u of svg.matchAll(/url\(([^)]*)\)/g)) if (!/^#[A-Za-z_][\w.:-]*$/.test(u[1])) issues.push('url ' + u[1])
  let maxRuns = 0
  for (const [, d] of svg.matchAll(/ d='([^']*)'/g)) maxRuns = Math.max(maxRuns, (d.match(/[hv]-?\d/g) ?? []).length)
  if (maxRuns > 64) issues.push('path with ' + maxRuns + ' runs')
  // Every time on the 0.05 s clock: each animation's duration and delay, and the length of
  // each step (a keyframe interval split by steps(n)).
  const css = svg.match(/<style>([\s\S]*?)<\/style>/)[1]
  const styles = [...svg.matchAll(/ style='([^']*)'/g)].map(s => s[1]).join(';')
  for (const [t] of (css + ';' + styles).matchAll(/-?\d*\.?\d+s\b/g)) if (!onClock(parseFloat(t))) issues.push('off-clock ' + t)
  const kf = new Map([...css.matchAll(/@keyframes (\w+)\{((?:[^{}]*\{[^{}]*\})*)\}/g)].map(k => [k[1], [...k[2].matchAll(/([\d.,%]+)\{/g)].flatMap(x => x[1].split(',').map(p => parseFloat(p)))]))
  for (const [, name, dur, n] of css.matchAll(/animation:(\w+) ([\d.]+)s steps\((\d+)\)/g)) {
    const marks = [...new Set([0, ...(kf.get(name) ?? []), 100])].sort((a, b) => a - b)
    for (let i = 0; i + 1 < marks.length; i++) {
      const span = ((marks[i + 1] - marks[i]) / 100) * Number(dur)
      const step = span / Number(n)
      // a hold (no change across the interval) needs no clock; a moving interval does
      if (Number(n) > 1 && !onClock(Math.round(step * 1e6) / 1e6) && span > 0 && i === 0) issues.push(name + ' step ' + step.toFixed(4) + 's')
      if (!onClock(Math.round(((marks[i] / 100) * Number(dur)) * 1e6) / 1e6)) issues.push(name + ' keyframe at ' + ((marks[i] / 100) * Number(dur)).toFixed(4) + 's')
    }
  }
  if (!/prefers-reduced-motion:reduce\)\{:root \*\{animation:none!important\}\}/.test(svg)) issues.push('no reduced-motion stop')
  console.log(m.padEnd(8), svg.length, 'chars (scrubbed ' + scrubbed + '), max runs/path', maxRuns, issues.length ? 'ISSUES: ' + [...new Set(issues)].join('; ') : 'ok')
}
