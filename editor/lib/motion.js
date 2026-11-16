// Motion and live effects on the scenes' one shared clock: every time in the CSS is a whole
// number of 0.05 s ticks, every step moves whole cells, and every animation starts at
// calc(var(--l, 0s) + var(--m)) so the theme module can set the whole scene to the time of
// day with --m (engine/theme-mod/hooks/register.tsx, sceneAt).
//
// plan(motion) and planLive(effect) turn a layer's settings into what the scene writes: the
// period it really gets (snapped to the clock), the CSS rule (shared between layers that
// come out the same) and the attributes of the group that moves. The exporter (export.js)
// does the cells; this module does the time.

export const TICK = 0.05
export const ticksOf = s => Math.max(1, Math.round(s / TICK))

// Seconds as CSS writes them, from whole ticks: 320 -> '16s', 7 -> '.35s', -7 -> '-.35s'.
export function secs(n) {
  const s = String(n / 20)
  return (s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? '-' + s.slice(2) : s) + 's'
}
// A keyframe offset, from tick n of a period of `of` ticks.
function pct(n, of) {
  const v = Math.round((n / of) * 1e5) / 1e3
  return String(v) + '%'
}
// A number as CSS writes it, short: 0.7 -> '.7'.
function short(v) {
  const s = String(Math.round(v * 1000) / 1000)
  return s.startsWith('0.') ? s.slice(1) : s
}

export const RANGES = {
  drift: { period: [20, 600] },
  fall: { period: [4, 120] },
  sway: { period: [2, 20], amount: [1, 3] },
  bob: { period: [2, 20], amount: [1, 3] },
  twinkle: { period: [2, 20] },
  cycle: { period: [2, 60] },
  pulse: { period: [2, 20], low: [0.4, 0.95] },
  glint: { period: [4, 60] },
}
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo))

// The animation shorthand every rule uses.
const anim = (name, n, steps, tail = '') => 'animation:' + name + ' ' + secs(n) + ' steps(' + steps + ') calc(var(--l,0s) + var(--m)) infinite' + tail
const style = l => (l ? " style='--l:" + secs(-l) + "'" : '')

// A scroll that wraps round `span` cells (320 across for drift, 200 down for fall), one loop
// per period: the layer is drawn twice, the copy a span behind, and the pair moves m cells a
// step, every k ticks. The loop then takes span / m * k ticks, so the period is snapped to
// what those whole numbers allow: m is picked from the steps that divide the span, the
// smallest that brings the loop within a few per cent of the period asked for.
function scroll(period, span) {
  const want = period / TICK
  let best
  for (const m of [1, 2, 4, 5, 8, 10]) {
    if (span % m) continue
    const steps = span / m
    const k = Math.max(1, Math.round(want / steps))
    const n = steps * k
    const cost = Math.abs(n - want) / want + 0.1 * (m - 1)
    if (!best || cost < best.cost) best = { m, k, n, steps, cost }
  }
  return best
}

// An eased swing of `amount` cells either way, as keyframes at the ticks where the whole-cell
// offset changes (steps(1) holds each until the next).
function swing(n, amount, axis) {
  const at = t => Math.round(amount * Math.sin((2 * Math.PI * t) / n))
  const frames = []
  let last
  for (let t = 0; t < n; t++) {
    const v = at(t)
    if (v !== last) frames.push([t, v])
    last = v
  }
  const tf = v => (v === 0 ? 'none' : 'translate' + axis + '(' + v + 'px)')
  return frames.map(([t, v]) => pct(t, n) + '{transform:' + tf(v) + '}').join('') + '100%{transform:none}'
}

// The plan of a layer's motion: { type, n (period in ticks), period (s, as it plays), rule
// (name -> CSS), ... }. `id` names the rule; plans that come out the same share it.
export function plan(motion) {
  const type = motion?.type ?? 'none'
  if (type === 'none' || !RANGES[type]) return { type: 'none' }
  const r = RANGES[type]
  const period = clamp(Number(motion.period), r.period)
  if (type === 'drift' || type === 'fall') {
    const span = type === 'drift' ? 320 : 200
    const s = scroll(period, span)
    const dir = type === 'fall' ? 1 : motion.dir === -1 ? -1 : 1
    const axis = type === 'drift' ? 'X' : 'Y'
    const key = type + ':' + s.n + ':' + s.steps + ':' + dir
    const body = (name, cls) => '.' + cls + '{' + anim(name, s.n, s.steps) + '}@keyframes ' + name + '{to{transform:translate' + axis + '(' + dir * span + 'px)}}'
    return { type, n: s.n, period: s.n * TICK, step: s.m, every: s.k, dir, span, axis, key, body, copy: axis === 'X' ? " x='" + -dir * span + "'" : " y='" + -dir * span + "'" }
  }
  if (type === 'sway' || type === 'bob') {
    const n = ticksOf(period)
    const amount = Math.round(clamp(Number(motion.amount ?? 1), r.amount))
    const axis = type === 'sway' ? 'X' : 'Y'
    const key = type + ':' + n + ':' + amount
    const body = (name, cls) => '.' + cls + '{' + anim(name, n, 1) + '}@keyframes ' + name + '{' + swing(n, amount, axis) + '}'
    return { type, n, period: n * TICK, amount, axis, key, body }
  }
  // twinkle: four groups, each dims (1, .7, .4, .7, 1) in its own quarter of the period.
  const q = Math.max(4, Math.round(period / TICK / 4))
  const n = 4 * q
  const a = Math.round(q / 4)
  const b = Math.round(q / 2)
  const c = Math.round((3 * q) / 4)
  const key = 'twinkle:' + n
  const body = (name, cls) =>
    '.' + cls + '{' + anim(name, n, 1) + '}@keyframes ' + name + '{0%{opacity:1}' + pct(a, n) + '{opacity:.7}' + pct(b, n) + '{opacity:.4}' + pct(c, n) + '{opacity:.7}' + pct(q, n) + ',100%{opacity:1}}'
  return { type, n, period: n * TICK, quarter: q, key, body, delay: g => g * q }
}

// The plan of one live effect.
//   cycle: colours = how many the layer has. Each colour steps to the next every k ticks; one
//     rule holds the sequence and colour i runs i steps ahead (--l).
//   pulse: the layer's opacity, eased from 1 down to `low` and back, in steps of .05.
//   glint: a band `width` stripes wide crosses the layer in `stripes` ticks at the start of
//     each period; each stripe shows for one tick.
export function planLive(effect, info = {}) {
  const type = effect?.type
  const r = RANGES[type]
  if (!r || !['cycle', 'pulse', 'glint'].includes(type)) return null
  const period = clamp(Number(effect.period), r.period)
  if (type === 'cycle') {
    const m = Math.max(2, info.colours ?? 2)
    const k = Math.max(1, Math.round(period / TICK / m))
    const n = m * k
    return { type, n, period: n * TICK, k, m, delay: i => i * k }
  }
  if (type === 'pulse') {
    const n = ticksOf(period)
    const low = clamp(Number(effect.low ?? 0.6), r.low)
    const at = t => Math.round((low + ((1 - low) * (1 + Math.cos((2 * Math.PI * t) / n))) / 2) * 20) / 20
    const frames = []
    let last
    for (let t = 0; t < n; t++) {
      const v = at(t)
      if (v !== last) frames.push([t, v])
      last = v
    }
    const kf = frames.map(([t, v]) => pct(t, n) + '{opacity:' + short(v) + '}').join('') + '100%{opacity:1}'
    const key = 'pulse:' + n + ':' + low
    const body = (name, cls) => '.' + cls + '{' + anim(name, n, 1) + '}@keyframes ' + name + '{' + kf + '}'
    return { type, n, period: n * TICK, low, key, body }
  }
  // glint
  const n = ticksOf(period)
  const stripes = Math.max(1, Math.min(info.stripes ?? 1, n))
  const key = 'glint:' + n
  const body = (name, cls) => '.' + cls + '{' + anim(name, n, 1) + '}@keyframes ' + name + '{0%{opacity:.75}' + pct(1, n) + ',100%{opacity:0}}'
  return { type, n, period: n * TICK, stripes, key, body, delay: s => (n - s) % n }
}

// The cycle's rule: the layer's colours (hex, in slot order) for this moment.
export function cycleBody(name, cls, n, k, hexes) {
  const m = hexes.length
  const kf = hexes.map((h, i) => pct(i * k, n) + '{stroke:' + h + '}').join('') + '100%{stroke:' + hexes[0] + '}'
  return '.' + cls + '{' + anim(name, n, 1) + '}@keyframes ' + name + '{' + kf + '}'
}

// A flipbook of `count` frames, `k` ticks each: frame f shows in its own slot of the loop.
export function flipPlan(count, fps) {
  const k = Math.max(1, Math.round(1 / (Math.max(0.1, Number(fps) || 10) * TICK)))
  const n = count * k
  const key = 'frames:' + n + ':' + k
  const body = (name, cls) => '.' + cls + '{' + anim(name, n, 1) + '}@keyframes ' + name + '{0%{opacity:1}' + pct(k, n) + ',100%{opacity:0}}'
  return { n, k, count, period: n * TICK, fps: 1 / (k * TICK), key, body, delay: f => (n - f * k) % n }
}

export const REDUCED = '@media (prefers-reduced-motion:reduce){:root *{animation:none!important}}'

// The scene's rules: one class per distinct plan. css.use(plan) -> class name.
export function ruleBook() {
  const byKey = new Map()
  const rules = []
  let i = 0
  const name = () => {
    let n = i++
    let s = ''
    do {
      s = String.fromCharCode(97 + (n % 26)) + s
      n = Math.floor(n / 26) - 1
    } while (n >= 0)
    return s
  }
  return {
    use(p, body = p.body) {
      if (p.key && byKey.has(p.key)) return byKey.get(p.key)
      const cls = 'k' + name()
      rules.push(body(cls, cls))
      if (p.key) byKey.set(p.key, cls)
      return cls
    },
    get css() {
      return rules.length ? rules.join('') + REDUCED : ''
    },
    get count() {
      return rules.length
    },
  }
}

export { style as delayStyle }
