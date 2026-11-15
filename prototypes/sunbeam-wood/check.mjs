// Quick rule check for the built SVGs: size, elements, banned words, media queries, urls, runs
// per path, filters, the 0.05 s clock and the reduced-motion stop.
// Usage: node check.mjs [moment ...]
import { readFileSync } from 'node:fs'

const ELEMENTS = new Set(
  ('animate animateMotion animateTransform set circle clipPath defs desc ellipse filter g line linearGradient marker mask mpath ' +
    'path pattern polygon polyline radialGradient rect stop style svg symbol text textPath title tspan use')
    .split(' ')
    .concat('feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence'.split(' ')),
)
const moments = process.argv.slice(2).length ? process.argv.slice(2) : ['morning', 'day', 'night']
for (const m of moments) {
  const svg = readFileSync(new URL('./out/sunbeam-wood-' + m + '.svg', import.meta.url), 'utf8')
  const issues = []
  if (svg.length > 131072) issues.push('over 131072 chars')
  for (const [, el] of svg.matchAll(/<([A-Za-z][\w-]*)/g)) if (!ELEMENTS.has(el)) issues.push('element ' + el)
  for (const [, h] of svg.matchAll(/<use [^>]*href='([^']*)'/g)) if (!/^#[\w-]+$/.test(h)) issues.push('use href ' + h)
  if (/shape-rendering|vector-effect/i.test(svg)) issues.push('banned property')
  if (/(?:\d|\.)(?:[dsl]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max))(?![a-z0-9_-])/i.test(svg)) issues.push('viewport unit')
  if (svg.includes('"')) issues.push('double quote')
  for (const [, q] of svg.matchAll(/@media([^{]*)\{/g)) if (q.trim() !== '(prefers-reduced-motion:reduce)') issues.push('media ' + q)
  for (const u of svg.matchAll(/url\(([^)]*)\)/g)) if (!/^#[A-Za-z_][\w.:-]*$/.test(u[1])) issues.push('url ' + u[1])
  const filtered = (svg.match(/filter='url\(/g) || []).length
  if (filtered > 2) issues.push(filtered + ' filtered groups')
  let maxRuns = 0
  for (const [, d] of svg.matchAll(/ d='([^']*)'/g)) maxRuns = Math.max(maxRuns, (d.match(/[Mm]/g) || []).length)
  if (maxRuns > 64) issues.push('path with ' + maxRuns + ' runs')
  // Every time in the CSS sits on the 0.05 s clock.
  const css = (svg.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1] + [...svg.matchAll(/ style='([^']*)'/g)].map(s => s[1]).join(';')
  for (const [t] of css.matchAll(/-?\d*\.?\d+s\b/g)) {
    const v = parseFloat(t) * 20
    if (Math.abs(v - Math.round(v)) > 1e-6) issues.push('off-clock ' + t)
  }
  if (!/prefers-reduced-motion:reduce\)\{:root \*\{animation:none!important\}\}/.test(svg)) issues.push('no reduced-motion stop')
  console.log(m.padEnd(8), svg.length, 'chars, max runs/path', maxRuns, ', filtered groups', filtered, issues.length ? 'ISSUES: ' + [...new Set(issues)].join('; ') : 'ok')
}
