// node check.mjs [moment ...] : rule check for the built SVGs. Size, elements and attributes
// against a short whitelist, banned properties, viewport units, quotes, @media, url(),
// runs per path, filtered groups, and the 0.05 s clock (durations, delays, and every
// keyframe stop of a steps() animation times the duration it runs at).
import { readFileSync } from 'node:fs'

// `use` (second coats of moving parts) is kept by the app's scrub when its href points inside
// the file (#id); see sunfield/tools/app-check.mjs. Any other href is an issue below.
const ELEMENTS = new Set(['svg', 'g', 'defs', 'style', 'pattern', 'rect', 'path', 'linearGradient', 'stop', 'clipPath', 'use'])
const ATTRS = new Set([
  'xmlns', 'fill', 'font-family', 'color', 'style', 'viewBox', 'preserveAspectRatio', 'class', 'd', 'stroke', 'stroke-width',
  'opacity', 'id', 'patternUnits', 'x', 'y', 'width', 'height', 'offset', 'stop-color', 'stop-opacity', 'x1', 'x2', 'y1', 'y2',
  'gradientUnits', 'clip-path', 'href',
])
const moments = process.argv.slice(2).length ? process.argv.slice(2) : ['day', 'sunset', 'night']
const onClock = s => Math.abs(s * 20 - Math.round(s * 20)) < 1e-6

for (const m of moments) {
  const svg = readFileSync(new URL('./out/cloud-sea-' + m + '.svg', import.meta.url), 'utf8')
  const issues = []
  if (svg.length > 131072) issues.push('over 131072 chars')
  if (/shape-rendering|vector-effect/i.test(svg)) issues.push('banned property')
  if (/(?:\d|\.)(?:[dsl]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max))(?![a-z0-9_-])/i.test(svg)) issues.push('viewport unit')
  if (svg.includes('"')) issues.push('double quote')
  if (!svg.startsWith("<svg xmlns='http://www.w3.org/2000/svg' fill='none' font-family='a' color='a' style='--m:0s'>")) issues.push('root differs')
  for (const [, el] of svg.matchAll(/<([a-zA-Z]+)/g)) if (!ELEMENTS.has(el)) issues.push('element ' + el)
  for (const [, at] of svg.matchAll(/ ([a-zA-Z:-]+)='/g)) if (!ATTRS.has(at)) issues.push('attribute ' + at)
  for (const [, h] of svg.matchAll(/ href='([^']*)'/g)) if (!/^#[A-Za-z_][\w.:-]*$/.test(h)) issues.push('href ' + h)
  const filtered = (svg.match(/filter=/g) || []).length
  if (filtered > 2) issues.push(filtered + ' filtered groups')
  for (const [, q] of svg.matchAll(/@media([^{]*)\{/g)) if (q.trim() !== '(prefers-reduced-motion:reduce)') issues.push('media ' + q)
  for (const u of svg.matchAll(/url\(([^)]*)\)/g)) if (!/^#[A-Za-z_][\w.:-]*$/.test(u[1])) issues.push('url ' + u[1])
  let maxRuns = 0
  for (const [, d] of svg.matchAll(/ d='([^']*)'/g)) maxRuns = Math.max(maxRuns, (d.match(/[Mm]/g) || []).length)
  if (maxRuns > 64) issues.push('path with ' + maxRuns + ' runs')

  // Times written anywhere in the CSS or in inline styles.
  const css = (svg.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1]
  const inline = [...svg.matchAll(/ style='([^']*)'/g)].map(s => s[1])
  for (const [t] of (css + ';' + inline.join(';')).matchAll(/-?\d*\.?\d+s\b/g)) if (!onClock(parseFloat(t))) issues.push('off-clock ' + t)

  // Keyframe stops times each duration a class runs at: a class with a literal duration in its
  // rule, or var(--d) / var(--f) set inline on elements of that class.
  const frames = {}
  for (const [, name, body] of css.matchAll(/@keyframes ([\w-]+)\{((?:[^{}]*\{[^}]*\})*)\}/g)) {
    frames[name] = [...body.matchAll(/([\d.%,]+)\{/g)].flatMap(([, p]) => p.split(',').map(x => parseFloat(x) / 100))
  }
  // Steps inside a keyframe segment (animation-timing-function:steps(n)) split it further.
  const segSteps = {}
  for (const [, name, body] of css.matchAll(/@keyframes ([\w-]+)\{((?:[^{}]*\{[^}]*\})*)\}/g)) {
    const stops = [...body.matchAll(/([\d.%,]+)\{([^}]*)\}/g)]
    stops.forEach(([, p, decl], i) => {
      const n = /steps\((\d+)\)/.exec(decl)
      if (!n || !stops[i + 1]) return
      const a = parseFloat(p.split(',').pop()) / 100
      const b = parseFloat(stops[i + 1][1].split(',')[0]) / 100
      for (let k = 1; k < +n[1]; k++) (segSteps[name] ??= []).push(a + ((b - a) * k) / +n[1])
    })
  }
  const durs = {}
  for (const [, cls, name, dur] of css.matchAll(/\.([\w-]+)\{animation:([\w-]+) ([^ ]+) /g)) durs[cls] = { name, dur }
  const used = {}
  for (const [, cls, st] of svg.matchAll(/class='([\w-]+)' style='([^']*)'/g)) {
    for (const [, k, v] of st.matchAll(/--(\w+):(-?[\d.]+)s/g)) (used[cls] ??= {})[k] = [...((used[cls] ?? {})[k] ?? []), parseFloat(v)]
  }
  let checked = 0
  for (const [cls, { name, dur }] of Object.entries(durs)) {
    const ds = /^[\d.]+s$/.test(dur) ? [parseFloat(dur)] : /var\(--(\w+)\)/.test(dur) ? used[cls]?.[/var\(--(\w+)\)/.exec(dur)[1]] ?? [] : []
    for (const d of new Set(ds)) {
      for (const p of [...(frames[name] ?? []), ...(segSteps[name] ?? [])]) {
        checked++
        if (!onClock(p * d)) issues.push('keyframe ' + name + ' ' + (p * 100).toFixed(2) + '% of ' + d + 's')
      }
    }
  }
  if (!/@media \(prefers-reduced-motion:reduce\)\{:root \*\{animation:none!important\}\}/.test(svg) && !/@media\(prefers-reduced-motion:reduce\)\{:root \*\{animation:none!important\}\}/.test(svg)) issues.push('no reduced-motion stop')
  console.log(m.padEnd(7), svg.length, 'chars | max runs/path', maxRuns, '| filtered groups', filtered, '| keyframe stops checked', checked, '|', issues.length ? 'ISSUES: ' + [...new Set(issues)].slice(0, 12).join('; ') : 'ok')
}
