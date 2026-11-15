// Rule check for out/moon-keep.svg: size, banned words, viewport units, quotes, @media, url(),
// runs per path, and the clock. For the clock it walks every animated group with its custom
// properties resolved (inherited from the groups around it) and checks that the duration, the
// delay, every keyframe and every step land on the 0.05 s clock.
// Usage: node check.mjs [scene.svg]
import { readFileSync } from 'node:fs'

const file = process.argv[2] ?? new URL('./out/moon-keep.svg', import.meta.url)
const svg = readFileSync(file, 'utf8')
const issues = []
if (svg.length > 131072) issues.push('over 131072 chars')
if (/shape-rendering|vector-effect/i.test(svg)) issues.push('banned property')
if (/(?:\d|\.)(?:[dsl]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max))(?![a-z0-9_-])/i.test(svg)) issues.push('viewport unit')
if (svg.includes('"')) issues.push('double quote')
for (const [, q] of svg.matchAll(/@media([^{]*)\{/g)) if (q.trim() !== '(prefers-reduced-motion:reduce)') issues.push('media ' + q)
for (const u of svg.matchAll(/url\(([^)]*)\)/g)) if (!/^#[A-Za-z_][\w.:-]*$/.test(u[1])) issues.push('url ' + u[1])
if (/<filter/.test(svg)) issues.push((svg.match(/<filter/g) || []).length + ' filters')
let maxRuns = 0
for (const [, d] of svg.matchAll(/ d='([^']*)'/g)) maxRuns = Math.max(maxRuns, (d.match(/[Mm]/g) || []).length)
if (maxRuns > 64) issues.push('path with ' + maxRuns + ' runs')
if (!/prefers-reduced-motion:reduce\)\{:root \*\{animation:none!important\}\}/.test(svg)) issues.push('no reduced-motion stop')

// The CSS: class rules and keyframes.
const css = svg.match(/<style>([\s\S]*?)<\/style>/)[1]
const keyframes = new Map()
for (const m of css.matchAll(/@keyframes (\w+)\{((?:[^{}]*\{[^{}]*\})*)\}/g)) {
  const frames = []
  for (const f of m[2].matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const sel of f[1].split(',')) {
      const p = sel.trim() === 'from' ? 0 : sel.trim() === 'to' ? 100 : parseFloat(sel)
      const steps = /animation-timing-function:steps\((\d+)\)/.exec(f[2])
      frames.push({ p, steps: steps ? Number(steps[1]) : null, value: f[2].replace(/;?animation-timing-function:[^;]*/, '') })
    }
  }
  frames.sort((a, b) => a.p - b.p)
  keyframes.set(m[1], frames)
}
const rules = new Map()
for (const m of css.replace(/@keyframes \w+\{(?:[^{}]*\{[^{}]*\})*\}/g, '').matchAll(/\.([\w-]+)\{animation:([^};]*)\}/g)) rules.set(m[1], m[2])

const onClock = s => Math.abs(s * 20 - Math.round(s * 20)) < 1e-6
const vars = s => Object.fromEntries([...(s ?? '').matchAll(/(--[\w-]+):([^;]+)/g)].map(m => [m[1], m[2].trim()]))
const resolve = (v, env) => v.replace(/var\((--[\w-]+)\)/g, (_, k) => env[k] ?? '0s')
const secs = v => parseFloat(v)
let checked = 0
const stack = [{ '--m': '0s' }]
for (const m of svg.matchAll(/<(\/?)(g|svg)\b([^>]*?)(\/?)>/g)) {
  if (m[1]) {
    stack.pop()
    continue
  }
  const env = { ...stack[stack.length - 1], ...vars(/style='([^']*)'/.exec(m[3])?.[1]) }
  if (!m[4]) stack.push(env)
  const cls = /class='([^']*)'/.exec(m[3])?.[1]
  if (!cls || !rules.has(cls)) continue
  checked++
  // name duration [timing] delay infinite
  const parts = resolve(rules.get(cls), { ...env, '--m': '0s' }).match(/calc\([^)]*\)|steps\([^)]*\)|\S+/g)
  const [name, dur] = parts
  const timing = parts.find(p => p.startsWith('steps(') || p === 'linear' || p === 'ease')
  const delayExpr = parts.find(p => p.startsWith('calc(')) ?? parts.find((p, i) => i > 1 && /s$/.test(p) && p !== dur)
  const d = secs(dur)
  const where = cls + ' ' + (m[3].match(/style='([^']*)'/)?.[1] ?? '')
  if (!onClock(d)) issues.push('duration off the clock: ' + where)
  if (delayExpr) {
    const delay = delayExpr.startsWith('calc(') ? delayExpr.slice(5, -1).split('+').reduce((s, t) => s + secs(t.trim()), 0) : secs(delayExpr)
    if (!onClock(delay)) issues.push('delay off the clock: ' + where)
  }
  const frames = keyframes.get(name)
  if (!frames) {
    issues.push('no keyframes ' + name)
    continue
  }
  const all = frames[0].p === 0 ? frames : [{ p: 0, steps: null, value: 'base' }, ...frames]
  if (all[all.length - 1].p !== 100) all.push({ p: 100, steps: null, value: 'base' })
  const ruleSteps = timing?.startsWith('steps(') ? Number(timing.slice(6, -1)) : null
  for (let i = 0; i < all.length - 1; i++) {
    const a = all[i]
    const t0 = (a.p / 100) * d
    const len = ((all[i + 1].p - a.p) / 100) * d
    if (!onClock(t0)) issues.push('keyframe ' + a.p + '% of ' + name + ' off the clock: ' + where)
    const n = a.steps ?? ruleSteps
    if (n === null) {
      if (a.value !== all[i + 1].value && len > 0) issues.push('smooth segment in ' + name + ': ' + where)
      continue
    }
    if (!onClock(len / n)) issues.push('step of ' + name + ' at ' + a.p + '% is ' + (len / n).toFixed(4) + ' s: ' + where)
  }
}
console.log(svg.length, 'chars | max runs/path', maxRuns, '| animated groups checked', checked, '|', issues.length ? 'ISSUES:\n  ' + [...new Set(issues)].join('\n  ') : 'ok')
