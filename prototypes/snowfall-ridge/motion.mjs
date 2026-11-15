// What moves in Snowfall Ridge, and its CSS. Every motion steps on one shared clock of TICK
// seconds: durations, delays and every keyframe land on a multiple of it, so the app's player
// redraws the picture at most twenty times a second. Delays count from the root's --m.
import { Layer } from './lib.mjs'
import { rng } from './paint.mjs'

export const TICK = 0.05
const tk = s => Math.round(s / TICK) * TICK
const f2 = v => String(Math.round(v * 100) / 100).replace(/^0\./, '.').replace(/^-0\./, '-.')
const from = l => 'calc(' + l + ' + var(--m))'
const pct = (t, d) => f2((t / d) * 100) + '%'

// ------------------------------------------------------------------ snow
// A layer of flakes over the whole frame and a copy of it a frame higher, falling a cell a step;
// after `fall` steps the copy stands where the flakes began, so the loop has no seam.
export const SNOW = [
  { name: 'far', n: 150, step: 0.25, size: 1, sway: 0, seed: 3 },
  { name: 'mid', n: 80, step: 0.15, size: 1, sway: 1, swayD: 6, seed: 5 },
  { name: 'near', n: 26, step: 0.1, size: 2, sway: 2, swayD: 8, seed: 7 },
]
export function snow(i, P) {
  const s = SNOW[i]
  const r = rng(s.seed)
  const L = new Layer('snow' + s.name)
  for (let k = 0; k < s.n; k++) {
    const x = Math.floor(r() * 320)
    const y = Math.floor(r() * 200)
    if (s.size === 1) L.set(x, y, P.flake[i])
    else {
      L.set(x, y, P.flake[2])
      L.set(x + 1, y, P.flake[3])
      L.set(x, y + 1, P.flake[3])
      L.set(x + 1, y + 1, P.flake[2])
    }
  }
  const d = tk(s.step * 200)
  const id = 'S' + s.name[0].toUpperCase()
  const lag = tk(-r() * d)
  // The flakes, their copy above, and the fall; around it the sway. The flakes are drawn three
  // times over in place (two <use> of the inner group): where a flake's edge falls inside a
  // screen pixel on the edge of a dark cell beneath, one pass lets that cell show through by
  // the uncovered part, three passes by its cube. Whole cells do not change.
  const fall = { wrap: '<g class="fl" style="--d:' + d + 's;--l:' + lag + 's"><g id="' + id + '"><g id="' + id + 'x">', end: '</g><use href="#' + id + 'x"/><use href="#' + id + 'x"/></g><use href="#' + id + '" y="-200"/></g>', items: [L] }
  if (!s.sway) return fall
  return { wrap: '<g class="sw' + s.sway + '" style="--d:' + s.swayD + 's;--l:' + tk(-r() * s.swayD) + 's">', end: '</g>', items: [fall] }
}

// ------------------------------------------------------------------ chimney smoke
// Puffs rise a cell a step, drift right with the wind, grow in three sizes and fade. While the
// motion runs the still smoke is hidden; at rest (reduced motion, the app's still frame) it
// stands in, drawn where the puffs are at the start.
export const SMOKE = { d: 12, rise: 40, drift: 14, puffs: 8 }
const PUFFS = [
  ['.##', '##.'],
  ['.###.', '#####', '.##..'],
  ['..###..', '.#####.', '#######', '.####..'],
]
function puffCells(stage, light, shade) {
  const L = []
  const rows = PUFFS[stage]
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      if (row[i] !== '#') continue
      const lit = j === 0 || i < row.length / 2 - (j === rows.length - 1 ? 1 : 0)
      L.push([i - Math.floor(row.length / 2), j - rows.length + 1, lit ? light : shade])
    }
  })
  return L
}
const driftAt = t => Math.round(SMOKE.drift * Math.pow(t, 1.6))
const stageAt = t => (t < 0.25 ? 0 : t < 0.6 ? 1 : 2)
export function smoke(x0, y0, P) {
  const items = []
  const still = new Layer('smokeStill')
  for (let k = 0; k < SMOKE.puffs; k++) {
    const phase = (k * SMOKE.d) / SMOKE.puffs // seconds into its cycle at the start
    const stages = [0, 1, 2].map(st => {
      const L = new Layer('puff' + k + st)
      for (const [dx, dy, c] of puffCells(st, P.smoke[1], P.smoke[0])) L.set(x0 + dx, y0 + dy, c)
      L.anim = { cls: 's' + (st + 1) }
      return L
    })
    items.push({
      wrap: '<g class="su" style="--l:' + tk(-phase) + 's"><g class="sx"><g class="so" opacity="0">',
      end: '</g></g></g>',
      items: stages,
    })
    // Where this puff is at the start, for the still frame.
    const t = phase / SMOKE.d
    if (t < 0.85) {
      const dy = -Math.floor((t * SMOKE.d) / (SMOKE.d / SMOKE.rise))
      for (const [dx, ddy, c] of puffCells(stageAt(t), P.smoke[1], P.smoke[0])) still.set(x0 + driftAt(t) + dx, y0 + dy + ddy, c)
    }
  }
  still.anim = { cls: 'ss' }
  return [still, ...items]
}
function smokeCss() {
  const { d, rise } = SMOKE
  // The drift: a keyframe each time the puff moves a cell right, on the clock.
  let k = ''
  let last = 0
  for (let i = 1; i <= Math.round(d / TICK); i++) {
    const t = (i * TICK) / d
    const x = driftAt(t)
    if (x !== last) {
      k += pct(i * TICK, d) + '{transform:translateX(' + x + 'px)}'
      last = x
    }
  }
  return [
    '.su{animation:su ' + d + 's steps(' + rise + ') ' + from('var(--l)') + ' infinite}',
    '@keyframes su{to{transform:translateY(-' + rise + 'px)}}',
    '.sx{animation:sx ' + d + 's steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes sx{0%{transform:none}' + k + '}',
    '.so{animation:so ' + d + 's steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes so{0%{opacity:0}5%{opacity:.9}50%{opacity:.9;animation-timing-function:steps(6)}100%{opacity:0}}',
    '.s1,.s2,.s3{animation:s1 ' + d + 's steps(1) ' + from('var(--l)') + ' infinite}.s2{animation-name:s2}.s3{animation-name:s3}',
    '@keyframes s1{0%{opacity:1}25%,100%{opacity:0}}',
    '@keyframes s2{0%{opacity:0}25%{opacity:1}60%,100%{opacity:0}}',
    '@keyframes s3{0%{opacity:0}60%,100%{opacity:1}}',
    '.ss{animation:ss 1s steps(1) infinite}@keyframes ss{0%,100%{opacity:0}}',
  ]
}

// ------------------------------------------------------------------ spindrift
// Snow blown off the summit to the right: wisps that slide off a cell a step and thin out.
export const DRIFT = { d: 8, run: 5, dist: 25 }
export function spindrift(list, P) {
  const r = rng(91)
  return list.map(([x, y], k) => {
    const L = new Layer('wisp' + k)
    const len = 7 + Math.floor(r() * 5)
    for (let i = 0; i < len; i++) {
      const q = i / len
      for (let j = -1; j <= 1; j++) {
        if (Math.abs(j) === 1 && (q > 0.6 || r() < 0.5)) continue
        if (r() < q * 0.7) continue
        L.set(x + i, y + j + Math.floor(q * 2), P.spin[q < 0.35 && j === 0 ? 1 : 0])
      }
    }
    L.anim = { cls: 'dw', style: '--l:' + tk(-((k * DRIFT.d) / list.length) - r() * 0.5) + 's', extra: ' opacity="0"' }
    return L
  })
}
function spinCss() {
  const { d, run, dist } = DRIFT
  return [
    '.dw{animation:dw ' + d + 's steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes dw{0%{transform:none;opacity:1;animation-timing-function:steps(' + dist + ')}' + pct(run, d) + '{transform:translateX(' + dist + 'px);opacity:.2}' + pct(run + TICK, d) + ',100%{opacity:0;transform:translateX(' + dist + 'px)}}',
  ]
}

// ------------------------------------------------------------------ the rest
// An integer sway: cells, a keyframe a quarter of the cycle.
function swayCss(n) {
  const v = n === 1 ? [0, 1, 1, 0] : [0, 1, 2, 1]
  return [
    '.sw' + n + '{animation:sw' + n + ' var(--d) steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes sw' + n + '{' + v.map((x, i) => i * 25 + '%{transform:translateX(' + x + 'px)}').join('') + '}',
  ]
}
// An eased swing back and forth in whole cells, a keyframe a tenth of the cycle.
function swingCss(name, d, a, l) {
  let k = ''
  for (let i = 0; i <= 10; i++) k += i * 10 + '%{transform:translateX(' + Math.round((a * (1 - Math.cos((Math.PI * i) / 10))) / 2) + 'px)}'
  return ['.' + name + '{animation:' + name + ' ' + d + 's steps(1) ' + from(l) + ' infinite alternate}', '@keyframes ' + name + '{' + k + '}']
}

export function css(o) {
  return [
    '.fl{animation:fl var(--d) steps(200) ' + from('var(--l)') + ' infinite}',
    '@keyframes fl{to{transform:translateY(200px)}}',
    ...swayCss(1),
    ...swayCss(2),
    ...smokeCss(),
    ...spinCss(),
    // A star or a glint on the water lights up for a moment near the end of its cycle.
    '.tk{animation:tk var(--d) steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes tk{0%,90%{opacity:1}94%,100%{opacity:.35}}',
    '.gl{animation:gl var(--d) steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes gl{0%,80%{opacity:0}82%,88%{opacity:1}90%,100%{opacity:0}}',
    // Clouds drift across, a cell a second.
    '.dr{animation:dr var(--d) steps(var(--n)) ' + from('var(--l)') + ' infinite}',
    '@keyframes dr{from{transform:translateX(var(--a))}to{transform:translateX(var(--b))}}',
    // The mist at the foot of the ridge breathes sideways.
    ...swingCss('mi', 50, 8, '-20s'),
    '@media (prefers-reduced-motion:reduce){:root *{animation:none!important}}',
  ].join('')
}
