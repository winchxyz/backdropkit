// Rainy Studio: a desk by a rainy window over a soft city, as one animated pixel-art SVG in
// three moments. Painted on a 320 x 200 cell grid (x right, y down) and encoded the way
// sunfield/tools/build.mjs does it: runs of stroke-width-1 paths, big still layers in
// patterns, nested viewports pinned to the edges, CSS motion on a shared 0.05 s clock.
// node build.mjs  ->  out/rainy-studio-day.svg, out/rainy-studio-evening.svg, out/rainy-studio-night.svg
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Layer, bounds, clamp, emitCells, hex, lerp, rgb, rng, smooth, tone } from './pixel.mjs'
import { apart, clear, emitSafe, parse, runsIn } from './encode.mjs'
import { MOMENTS } from './palettes.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const W = 320
const H = 200
const TICK = 0.05
const ticks = s => Math.round(s / TICK)
const sec = s => +(Math.round(s / TICK) * TICK).toFixed(2) + 's'

// ---------------------------------------------------------------- colour and noise

const mix = (a, b, t) => {
  const x = rgb(a)
  const y = rgb(b)
  return hex(x.map((v, i) => lerp(v, y[i], t)))
}
// A colour with alpha, quantized to sixteenths so cells of one colour share a path.
const al = (c, a) => c.slice(0, 7) + (Math.round(clamp(a, 0, 1) * 15) * 17).toString(16).padStart(2, '0')

function grad(stops, y) {
  if (y <= stops[0][0]) return stops[0][1]
  for (let i = 0; i < stops.length - 1; i++) {
    const [ya, ca] = stops[i]
    const [yb, cb] = stops[i + 1]
    if (y <= yb) return mix(ca, cb, (y - ya) / (yb - ya))
  }
  return stops[stops.length - 1][1]
}

function hash(ix, iy, s) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
function vnoise(x, y, s) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const u = fx * fx * (3 - 2 * fx)
  const v = fy * fy * (3 - 2 * fy)
  return lerp(lerp(hash(ix, iy, s), hash(ix + 1, iy, s), u), lerp(hash(ix, iy + 1, s), hash(ix + 1, iy + 1, s), u), v)
}
function fbm(x, y, s, oct = 3) {
  let t = 0
  let amp = 0.5
  let f = 1
  let n = 0
  for (let i = 0; i < oct; i++) {
    t += amp * vnoise(x * f, y * f, s + i * 17)
    n += amp
    amp *= 0.5
    f *= 2
  }
  return t / n
}

// Cells of a straight line (Bresenham).
function line(x0, y0, x1, y1) {
  const out = []
  let x = Math.round(x0)
  let y = Math.round(y0)
  const xe = Math.round(x1)
  const ye = Math.round(y1)
  const dx = Math.abs(xe - x)
  const dy = -Math.abs(ye - y)
  const sx = x < xe ? 1 : -1
  const sy = y < ye ? 1 : -1
  let err = dx + dy
  for (;;) {
    out.push([x, y])
    if (x === xe && y === ye) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x += sx
    }
    if (e2 <= dx) {
      err += dx
      y += sy
    }
  }
  return out
}

// ---------------------------------------------------------------- the room's geometry

// The glass of the window, its frame, the bars between the panes, the sill and the desk.
const GX0 = 28
const GX1 = 292
const GY0 = 8
const GY1 = 142
const FX0 = 24
const FX1 = 296
const FY0 = 4
const FY1 = 146
const MULL = [[114, 117], [203, 206]]
const TRANSOM = [40, 42]
const DESK = 149 // back edge of the desk top, against the sill
const FRONT = 177 // front edge of the desk top
const inGlass = (x, y) => x >= GX0 && x < GX1 && y >= GY0 && y < GY1

// The lamp: an anglepoise on the right. Its head joint, the axis the shade points along, and
// the middle of the shade's opening, where the light comes from.
const JOINT = [272, 88]
const AX = (() => {
  const l = Math.hypot(-0.3, 0.95)
  return [-0.3 / l, 0.95 / l]
})()
const SHADE = 19
const OPEN = [JOINT[0] + AX[0] * SHADE, JOINT[1] + AX[1] * SHADE]
const ELBOW = [309, 117]
const FOOT = [300, 149] // the lamp stands on a stack of books
// The pool of light on the desk, where the beam meets it.
const POOL = { x: 247, y: 168, rx: 36, ry: 8 }

// How much lamp light reaches a cell of a wall, frame or curtain: inside the cone most, a
// little spill around it, falling off with distance.
function lampAt(x, y) {
  const dx = x + 0.5 - OPEN[0]
  const dy = y + 0.5 - OPEN[1]
  const t = dx * AX[0] + dy * AX[1]
  const s = Math.abs(dx * AX[1] - dy * AX[0])
  const d = Math.hypot(dx, dy)
  const fall = 1 / (1 + (d / 52) ** 2)
  const cone = t > 0 ? smooth((8.5 + t * 0.4 - s) / 8) : 0
  return fall * (0.3 + 0.7 * cone)
}

// The moment's light on the room, baked in: every solid cell of an inside layer is multiplied
// by the room's ambient light or, nearer the lamp, by its warmth, in four hard steps.
const mul = (a, b) => {
  const x = rgb(a)
  const y = rgb(b)
  return hex(x.map((v, i) => (v * y[i]) / 255))
}
function relight(L) {
  const M = C.M
  const steps = [0, 1, 2, 3].map(k => mix(M.amb, M.lampTint, k / 3))
  for (const [k, c] of L.m) {
    if (c.length !== 7) continue
    const x = (k % 4096) - 1000
    const y = Math.floor(k / 4096) - 1000
    L.m.set(k, mul(c, steps[clamp(Math.floor(lampAt(x, y) * M.lampGain * 4), 0, 3)]))
  }
  return L
}
const lit = L => {
  L.lit = true
  return L
}

// ---------------------------------------------------------------- scene parts

let C // the scene being built: { M, parts, defs, ids, css, stats }
const part = (pin, layers) => C.parts.push({ pin, layers })
const anim = (cls, style = '', extra = '') => ({ cls, style, extra })
const css = (key, text) => C.css.set(key, text)
const from = l => 'calc(' + l + ' + var(--m))'

// An ease-in-out swing from a to b (in cells) as eleven keyframes, a tenth of the cycle apart.
// An eased swing from a to b cells over `dur` seconds, in whole cells: each keyframe holds one
// position (the animation runs step-end) and the jump to it lands on the 0.05 s clock, at the
// moment the eased curve passes halfway to it.
function swing(name, fn, a, b, dur) {
  let k = '0%{transform:' + fn + '(' + a + 'px)}'
  const dir = Math.sign(b - a)
  for (let p = a + dir; p !== b + dir; p += dir) {
    const s = Math.acos(1 - (2 * (p - dir / 2 - a)) / (b - a)) / Math.PI
    const at = (Math.round((s * dur) / 0.05) * 0.05 * 100) / dur
    k += +at.toFixed(4) + '%{transform:' + fn + '(' + p + 'px)}'
  }
  return '@keyframes ' + name + '{' + k + '100%{transform:' + fn + '(' + b + 'px)}}'
}

// ---------------------------------------------------------------- outside: sky and clouds

function sky() {
  const M = C.M
  let out = '<g stroke-width="4">'
  let last = null
  let d = ''
  const flush = () => {
    if (last) out += '<path stroke="' + last + '" d="' + d + '"/>'
  }
  for (let y = 0; y < 150; y += 3) {
    const c = grad(M.sky, y + 1.5)
    if (c !== last) {
      flush()
      last = c
      d = ''
    }
    d += 'M20 ' + (y + 1.5) + 'h280'
  }
  flush()
  return out + '</g>'
}

// Low rain cloud over the top of the window: thick at the top, torn into ragged scud below.
function clouds() {
  const M = C.M
  const L = new Layer('clouds')
  for (let y = GY0; y < 78; y++) {
    for (let x = GX0; x < GX1; x++) {
      const n = fbm(x / 38, y / 9, 3, 4)
      const top = smooth((70 - y) / 58)
      const d = n * 0.95 + top * 0.62 - 0.66
      if (d <= 0) continue
      // Lighter where the cloud is thin, darker in its body; at dusk and at night its underside
      // catches the glow from below.
      const v = clamp(0.8 - d * 1.7 + (y < 20 ? 0.08 : 0) + M.cloudLift * smooth((y - 30) / 40), 0, 0.99)
      L.set(x, y, tone(M.cloud, v, x, y, 0.18))
    }
  }
  return L
}

// Mist that drifts across in front of the far towers.
function mist() {
  const M = C.M
  const L = new Layer('mist')
  for (let y = 54; y < 92; y++) {
    for (let x = GX0 - 8; x < GX1 + 8; x++) {
      const n = fbm(x / 26 + 7, y / 5, 11, 3)
      const band = 1 - Math.abs(y - 72) / 20
      const d = n * 0.9 + band * 0.45 - 0.68
      if (d <= 0) continue
      L.set(x, y, al(M.mist, d > 0.12 ? M.mistA * 1.6 : M.mistA))
    }
  }
  L.anim = anim('mi')
  css('mi', '.mi{animation:mi 48s steps(1) ' + from('-14s') + ' infinite alternate}' + swing('mi', 'translateX', -6, 6, 48))
  return L
}

// ---------------------------------------------------------------- outside: the city

// Far towers, pale in the haze: flat blocks with faint window columns, three landmarks.
const LANDMARKS = [
  { x0: 58, x1: 70, top: 36, kind: 'spire' },
  { x0: 146, x1: 162, top: 46, kind: 'crown' },
  { x0: 252, x1: 260, top: 40, kind: 'mast' },
]
function farCity(lights) {
  const M = C.M
  const L = new Layer('far')
  const r = rng(7)
  const bs = []
  for (let x = GX0 - 6; x < GX1 + 6; ) {
    const w = 5 + Math.floor(r() * 9)
    bs.push({ x0: x, x1: x + w, top: 70 + Math.floor(r() * 22) })
    x += w
  }
  bs.push(...LANDMARKS)
  for (const b of bs) {
    for (let y = b.top; y < GY1; y++) {
      for (let x = b.x0; x < b.x1; x++) {
        const row = y - b.top
        let c = row === 0 ? M.far[2] : (x - b.x0) % 2 === 1 && row > 1 && x < b.x1 - 1 ? M.far[0] : M.far[1]
        if (x === b.x1 - 1 && row > 0) c = M.far[0]
        L.set(x, y, c)
      }
    }
    if (b.kind === 'spire') {
      for (let y = b.top - 10; y < b.top; y++) {
        const h = Math.floor(((y - (b.top - 10)) / 10) * 4)
        for (let x = 64 - h; x < 64 + h; x++) L.set(x, y, x < 64 ? M.copper[1] : M.copper[0])
      }
      // A copper crown, gone green.
      for (let y = b.top; y < b.top + 3; y++) for (let x = b.x0; x < b.x1; x++) L.set(x, y, y === b.top ? M.copper[1] : M.copper[0])
      for (let y = b.top - 16; y < b.top - 8; y++) L.set(63, y, M.far[1])
    }
    if (b.kind === 'crown') {
      for (const [x0, x1, n] of [[148, 160, 3], [151, 157, 6], [153, 155, 10]]) for (let y = b.top - n; y < b.top; y++) for (let x = x0; x < x1; x++) L.set(x, y, M.far[1])
    }
    if (b.kind === 'mast') {
      for (let y = b.top - 14; y < b.top; y++) L.set(256, y, M.far[1])
      for (let y = b.top - 4; y < b.top; y++) for (let x = 254; x < 258; x++) L.set(x, y, M.far[1])
    }
    // Lit windows, faint dots in the haze.
    if (M.farLitP) {
      for (let y = b.top + 2; y < GY1; y += 3) {
        for (let x = b.x0 + 1; x < b.x1 - 1; x += 2) if (r() < M.farLitP) L.set(x, y, M.farLit[Math.floor(r() * M.farLit.length)])
      }
    }
  }
  return L
}

// The aviation light on the far mast, dimming slowly.
function mastLight() {
  const M = C.M
  if (!M.mastLight) return []
  const L = new Layer('mastlight')
  L.set(256, LANDMARKS[2].top - 15, M.mastLight)
  L.anim = anim('bl')
  css('bl', '.bl{animation:bl 4s steps(1) var(--m) infinite}@keyframes bl{0%{opacity:1}25%,100%{opacity:.25}}')
  return [L]
}

// Mid towers: office blocks with ribbon windows or piers, lit by the moment. Some lights
// switch on and off on their own slow cycles.
function midCity() {
  const M = C.M
  const L = new Layer('mid')
  const r = rng(31)
  const lr = rng(32)
  const bs = []
  for (let x = GX0 - 6; x < GX1 + 6; ) {
    const w = 12 + Math.floor(r() * 14)
    bs.push({ x0: x, x1: x + w, top: 84 + Math.floor(r() * 22), ribbon: r() < 0.5, t: Math.floor(r() * 3) })
    x += w + (r() < 0.4 ? 2 + Math.floor(r() * 5) : 0)
  }
  const toggles = []
  for (const b of bs) {
    // A box on the roof of the taller ones.
    if (b.top < 96) for (let y = b.top - 3; y < b.top; y++) for (let x = b.x0 + 3; x < b.x0 + 8; x++) L.set(x, y, M.mid.side)
    for (let y = b.top; y < GY1; y++) {
      for (let x = b.x0; x < b.x1; x++) {
        const row = y - b.top
        const col = x - b.x0
        let c
        if (row === 0) c = M.mid.ledge
        else if (x >= b.x1 - 2) c = M.mid.side
        else if (b.ribbon) c = row % 3 !== 0 && row > 1 && col > 0 ? M.mid.glass : M.mid.face[b.t]
        else c = col % 3 !== 0 && row > 1 ? M.mid.glass : M.mid.face[b.t]
        L.set(x, y, c)
      }
    }
    // Windows: lit ones in warm or cool light, a pale sky reflection on a few by day.
    if (b.ribbon) {
      for (let y = b.top + 1; y < GY1; y += 3) {
        for (let x = b.x0 + 1; x < b.x1 - 2; ) {
          const n = 2 + Math.floor(lr() * 4)
          const roll = lr()
          const c = roll < M.mid.litP ? M.mid.lit[Math.floor(lr() * M.mid.lit.length)] : roll > 1 - M.mid.hiP ? M.mid.glassHi : null
          const e = Math.min(x + n, b.x1 - 2)
          if (c) {
            const target = c !== M.mid.glassHi && lr() < M.toggleP ? new Layer('tg' + x + y) : L
            for (let xx = x; xx < e; xx++) {
              target.set(xx, y + 1, c)
              if (c !== M.mid.glassHi) target.set(xx, y + 2, c)
            }
            if (target !== L) toggles.push(target)
          }
          x = e + 1
        }
      }
    } else {
      // Glass in tall strips between piers: a lit floor is a few rows of a strip.
      for (let x = b.x0 + 1; x < b.x1 - 2; x += 3) {
        for (let y = b.top + 2; y < GY1; ) {
          const n = 2 + Math.floor(lr() * 4)
          const roll = lr()
          const c = roll < M.mid.litP ? M.mid.lit[Math.floor(lr() * M.mid.lit.length)] : roll > 1 - M.mid.hiP ? M.mid.glassHi : null
          const e = Math.min(y + n, GY1)
          if (c) {
            const target = c !== M.mid.glassHi && lr() < M.toggleP ? new Layer('tg' + x + y) : L
            for (let yy = y; yy < e; yy++) for (let xx = x; xx < x + 2; xx++) if (c !== M.mid.glassHi || xx === x) target.set(xx, yy, c)
            if (target !== L) toggles.push(target)
          }
          y = e + 1
        }
      }
    }
  }
  toggles.forEach((T, i) => {
    const d = [23, 31, 37, 29, 41, 27, 33, 43][i % 8]
    T.anim = anim('tg', '--d:' + d + 's;--l:' + sec(-((i * 7.3) % d)))
  })
  if (toggles.length) css('tg', '.tg{animation:tg var(--d) steps(1) ' + from('var(--l)') + ' infinite}@keyframes tg{0%{opacity:0}20%,100%{opacity:1}}')
  return [L, ...toggles]
}

// The elevated railway between the towers and the near roofs, and a train on it.
const TRACK = 117
function railway() {
  const M = C.M
  const L = new Layer('track')
  for (let x = GX0 - 4; x < GX1 + 4; x++) {
    L.set(x, TRACK, M.rail[1])
    L.set(x, TRACK + 1, M.rail[0])
    if ((x - 10) % 34 < 2) for (let y = TRACK + 2; y < GY1; y++) L.set(x, y, M.rail[0])
  }
  const T = new Layer('train')
  const cars = [0, 19, 38]
  for (const c0 of cars) {
    for (let x = c0; x < c0 + 17; x++) {
      for (let y = TRACK - 6; y < TRACK; y++) {
        const row = y - (TRACK - 6)
        let c = row === 0 ? M.train[2] : row === 5 ? M.train[0] : M.train[1]
        if ((row === 2 || row === 3) && (x - c0) % 3 !== 0 && x - c0 > 1 && x - c0 < 16) c = M.train[3]
        T.set(x + 120, y, c)
      }
    }
  }
  // The front lamp of the leading car.
  T.set(120 + 55, TRACK - 3, M.train[4])
  // It crosses in 1 cell steps every 0.1 s, then the line is empty for the rest of the minute.
  const a = -(120 + 56 - GX0 + 6)
  const b = GX1 - 120 + 6
  const n = b - a
  const crossing = n * 0.1
  const pct = +((crossing / 60) * 100).toFixed(3)
  T.anim = anim('tn', '--a:' + a + 'px;--b:' + b + 'px')
  css('tn', '.tn{animation:tn 60s steps(1) ' + from('-24s') + ' infinite}@keyframes tn{0%{transform:translateX(var(--a));animation-timing-function:steps(' + n + ')}' + pct + '%,100%{transform:translateX(var(--b))}}')
  return [L, T]
}

// Near roofs at the bottom of the window: old brick blocks, a water tower, an air vent,
// and a sign that glows in the evening.
const NEAR = [
  { x0: 18, x1: 62, top: 126, t: 0 },
  { x0: 62, x1: 106, top: 120, t: 1, tank: 84 },
  { x0: 106, x1: 148, top: 129, t: 2 },
  { x0: 148, x1: 188, top: 123, t: 0 },
  { x0: 188, x1: 232, top: 131, t: 1 },
  { x0: 232, x1: 270, top: 121, t: 2 },
  { x0: 270, x1: 302, top: 127, t: 0 },
]
function nearCity() {
  const M = C.M
  const L = new Layer('near')
  const r = rng(53)
  for (const b of NEAR) {
    for (let y = b.top; y < GY1; y++) {
      for (let x = b.x0; x < b.x1; x++) {
        const row = y - b.top
        let c = row === 0 ? M.near.ledge : row === 1 ? M.near.side : M.near.face[b.t]
        if (x >= b.x1 - 3 && row > 0) c = M.near.side
        L.set(x, y, c)
      }
    }
    // Windows three cells wide and four tall.
    for (let y = b.top + 4; y < GY1; y += 7) {
      for (let x = b.x0 + 3; x + 3 < b.x1 - 3; x += 6) {
        const lit = r() < M.near.litP
        const warm = M.near.lit[Math.floor(r() * M.near.lit.length)]
        for (let yy = y; yy < y + 4; yy++) {
          for (let xx = x; xx < x + 3; xx++) {
            let c = lit ? warm : M.near.glass
            if (!lit && yy === y && xx < x + 2) c = M.near.glassHi
            if (lit && yy === y + 3) c = mix(warm, M.near.glass, 0.45)
            L.set(xx, yy, c)
          }
        }
      }
    }
    if (b.tank) tank(L, b.tank, b.top)
  }
  // Vents and boxes on the roofs.
  for (const [x0, x1, y0] of [[30, 38, 123], [156, 166, 119], [244, 250, 117], [279, 285, 124], [196, 200, 128]]) {
    for (let y = y0; y < y0 + 3; y++) for (let x = x0; x < x1; x++) L.set(x, y, y === y0 ? M.near.ledge : M.near.side)
  }
  return L
}

// A wooden water tower on legs: a barrel of staves under a cone roof.
function tank(L, cx, top) {
  const M = C.M
  const T = M.tank
  for (let y = top - 18; y < top - 4; y++) {
    for (let x = cx - 6; x < cx + 6; x++) {
      const u = (x + 0.5 - cx) / 6
      let v = 0.55 - 0.35 * u
      if ((x - cx) % 3 === 0) v -= 0.18
      if ((y - (top - 18)) % 5 === 2) v -= 0.25 // hoops
      L.set(x, y, tone(T, v, x, y, 0.2))
    }
  }
  for (let y = top - 25; y < top - 18; y++) {
    const h = Math.round(((y - (top - 25)) / 7) * 7)
    for (let x = cx - h; x < cx + h; x++) L.set(x, y, x < cx ? T[3] : T[1])
  }
  L.set(cx - 1, top - 26, T[2])
  for (let y = top - 4; y < top; y++) {
    for (const x of [cx - 5, cx - 1, cx + 3]) L.set(x, y, T[0])
    if (y === top - 2) for (let x = cx - 5; x < cx + 4; x++) L.set(x, y, T[0])
  }
}

// A blade sign on the near block, glowing in the evening, dark by day.
function sign() {
  const M = C.M
  const L = new Layer('sign')
  const x0 = 98
  const y0 = 122
  for (let y = y0; y < y0 + 18; y++) {
    for (let x = x0; x < x0 + 5; x++) {
      const edge = x === x0 || x === x0 + 4 || y === y0 || y === y0 + 17
      const bar = !edge && (y - y0) % 4 !== 0 && x > x0 && x < x0 + 4
      L.set(x, y, edge ? M.sign[0] : bar ? M.sign[1] : M.sign[2])
    }
  }
  const out = [L]
  if (M.signGlow) {
    // Its glow on the wet air: soft rings around it.
    const G = new Layer('signglow')
    for (let y = y0 - 5; y < y0 + 23; y++) {
      for (let x = x0 - 6; x < x0 + 11; x++) {
        if (L.has(x, y)) continue
        const dx = Math.max(0, Math.abs(x + 0.5 - (x0 + 2.5)) - 2.5)
        const dy = Math.max(0, Math.abs(y + 0.5 - (y0 + 9)) - 9)
        const d = Math.hypot(dx, dy)
        if (d < 5) G.set(x, y, al(M.signGlow, d < 2.2 ? 0.3 : 0.14))
      }
    }
    out.push(G)
  }
  return out
}

// Out-of-focus lights in the evening: soft discs of street and window light low in the window.
function bokeh() {
  const M = C.M
  if (!M.bokeh) return []
  const L = new Layer('bokeh')
  const r = rng(77)
  for (let i = 0; i < M.bokehN; i++) {
    const cx = GX0 + 4 + r() * (GX1 - GX0 - 8)
    const cy = 112 + r() * 26
    const R = 2 + r() * 2.4
    const c = M.bokeh[Math.floor(r() * M.bokeh.length)]
    for (let y = Math.floor(cy - R); y <= cy + R; y++) {
      for (let x = Math.floor(cx - R); x <= cx + R; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        if (d < R) L.set(x, y, al(c, d > R - 0.9 ? M.bokehA * 0.55 : M.bokehA))
      }
    }
  }
  return [L]
}

// ---------------------------------------------------------------- the rain and the glass

// Rain beyond the glass: streaks in a field that repeats every `p` rows, drawn a period
// taller than the window and moved down one period per cycle, a step every tick.
function rain(name, seed, p, count, len, colour, cellsPerTick) {
  const L = new Layer(name)
  const r = rng(seed)
  const streaks = []
  for (let i = 0; i < count; i++) streaks.push([GX0 + Math.floor(r() * (GX1 - GX0)), Math.floor(r() * p), len[0] + Math.floor(r() * (len[1] - len[0] + 1))])
  // Each streak one colour, so it is one run: most faint, some brighter.
  for (const [x, y0, n] of streaks) {
    const c = r() < 0.3 ? colour[1] : colour[0]
    for (let k = -2; k * p < GY1 + p; k++) {
      for (let j = 0; j < n; j++) {
        const y = y0 + k * p + j
        if (y >= GY0 - p - 1 && y < GY1 + 1) L.set(x, y, c)
      }
    }
  }
  const steps = p / cellsPerTick
  L.anim = anim('rn', '--d:' + sec(steps * TICK) + ';--n:' + steps + ';--p:' + p + 'px')
  css('rn', '.rn{animation:rn var(--d) steps(var(--n)) var(--m) infinite}@keyframes rn{to{transform:translateY(var(--p))}}')
  return L
}

// Beads of water on the glass: a lit edge where the light comes through, a dark rim below.
// Thicker toward the bottom, where the glass is fogged.
function glass() {
  const M = C.M
  const L = new Layer('glass')
  const r = rng(91)
  // Mist on the lower glass, in bands, with clear tracks where drops have run down.
  const tracks = new Set([47, 84, 133, 186, 236, 285])
  for (let y = GY1 - 18; y < GY1; y++) {
    const k = y - (GY1 - 18)
    const a = k < 5 ? M.fogA[0] : k < 11 ? M.fogA[1] : M.fogA[2]
    for (let x = GX0; x < GX1; x++) {
      if (tracks.has(x) && k < 15) continue
      if (k < 5 && (x + y) % 2 === 0 && k < 2) continue
      L.set(x, y, al(M.glassFog, a))
    }
  }
  // A faint diagonal sheen across each pane.
  for (const [x0, x1, y0, y1] of [[GX0, 114, GY0, GY1], [117, 203, GY0, GY1], [206, GX1, GY0, GY1]]) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const u = x - x0 + (y - y0) * 0.7
        if ((u > 30 && u < 36) || (u > 40 && u < 42)) {
          if (!L.has(x, y)) L.set(x, y, al(M.sheen, M.sheenA))
        }
      }
    }
  }
  // Drops: beads with a bright top where the light comes through and a dark foot; small ones
  // a cell over a cell, a few bigger ones two cells wide with a glint.
  for (let i = 0; i < M.drops; i++) {
    const x = GX0 + 1 + Math.floor(r() * (GX1 - GX0 - 3))
    const y = Math.floor(GY0 + 2 + Math.pow(r(), 0.6) * (GY1 - GY0 - 5))
    if (MULL.some(([a, b]) => x >= a - 2 && x <= b) || (y >= TRANSOM[0] - 2 && y <= TRANSOM[1])) continue
    const s = r()
    if (s < 0.25) L.set(x, y, al(M.dropLit, 0.3))
    else if (s < 0.82) {
      L.set(x, y, al(M.dropLit, 0.42))
      L.set(x, y + 1, al(M.dropDark, 0.3))
    } else {
      L.set(x, y, al(M.dropLit, 0.75))
      L.set(x + 1, y, al(M.dropLit, 0.25))
      L.set(x, y + 1, al(M.dropLit, 0.2))
      L.set(x + 1, y + 1, al(M.dropLit, 0.2))
      L.set(x, y + 2, al(M.dropDark, 0.35))
      L.set(x + 1, y + 2, al(M.dropDark, 0.35))
    }
  }
  return L
}

// Drops that run down the glass: they hold, slip, hold again, run on and fade at the mist.
// Each carries a short wet trail. [x, start row, drop of each slip in rows]
// Each stays on its own pane: the upper one stops above the transom.
const RUNNERS = [
  [47, 48, [8, 14, 20, 26]],
  [133, 52, [6, 16, 24]],
  [186, 46, [10, 12, 22, 26]],
  [236, 56, [8, 20, 28]],
  [285, 44, [10, 14, 18, 30]],
  [84, 60, [7, 12, 20]],
  [160, 12, [6, 9, 8]],
]
function runners() {
  const M = C.M
  return RUNNERS.map(([x, y0, slips], i) => {
    const L = new Layer('run' + i)
    for (let k = 1; k <= 5; k++) L.set(x, y0 - k, al(M.dropLit, 0.32 - k * 0.05))
    L.set(x, y0, al(M.dropLit, 0.9))
    L.set(x + 1, y0, al(M.dropLit, 0.4))
    L.set(x, y0 + 1, al(M.dropLit, 0.45))
    L.set(x + 1, y0 + 1, al(M.dropDark, 0.4))
    L.set(x, y0 + 2, al(M.dropDark, 0.55))
    // Keyframes: a hold of 2.5 to 5 s, then a slip of a row every two ticks, then the next hold.
    const r = rng(300 + i)
    const frames = []
    let t = 0
    let y = 0
    frames.push([t, y, 1])
    for (const s of slips) {
      t += 2.5 + Math.floor(r() * 6) * 0.5
      frames.push([t, y, s])
      t += s * TICK * 2
      y += s
      frames.push([t, y, 1])
    }
    // Fade into the mist, then wait out the cycle hidden.
    t += 1
    const D = Math.ceil((t + 3) / 5) * 5
    let k = ''
    for (const [ft, fy, n] of frames) {
      k += +((ft / D) * 100).toFixed(3) + '%{transform:translateY(' + fy + 'px);opacity:1' + (n > 1 ? ';animation-timing-function:steps(' + n + ')' : '') + '}'
    }
    k += +((t / D) * 100).toFixed(3) + '%,100%{transform:translateY(' + y + 'px);opacity:0}'
    css('dr' + i, '.dr' + i + '{animation:dr' + i + ' ' + D + 's steps(1) ' + from(sec(-r() * D)) + ' infinite}@keyframes dr' + i + '{' + k + '}')
    L.anim = anim('dr' + i)
    return L
  })
}

// ---------------------------------------------------------------- the room

// The steel window: frame, two bars and a transom, each bar with a lit edge and a shadowed
// one; the edges facing the lamp pick up its warmth.
function frame(L) {
  const M = C.M
  const F = M.frame
  const set = (x, y, v, face) => {
    const lamp = lampAt(x, y)
    let c = tone(F, v + lamp * M.frameLamp, x, y, 0)
    if (face === 'warm' && lamp > 0.22) c = lamp > 0.4 ? M.frameWarm[1] : M.frameWarm[0]
    L.set(x, y, c)
  }
  for (let y = FY0; y < FY1; y++) {
    for (let x = FX0; x < FX1; x++) {
      if (inGlass(x, y) && !MULL.some(([a, b]) => x >= a && x < b) && !(y >= TRANSOM[0] && y < TRANSOM[1])) continue
      // Which bar this cell is on, and where across it.
      let v = 0.4
      let face = ''
      const mull = MULL.find(([a, b]) => x >= a && x < b)
      if (mull && y >= GY0 && y < GY1) {
        const k = x - mull[0]
        v = k === 0 ? 0.62 : k === 1 ? 0.42 : 0.2
        if (k === 2) face = 'warm'
      } else if (y >= TRANSOM[0] && y < TRANSOM[1] && x >= GX0 && x < GX1) {
        v = y === TRANSOM[0] ? 0.6 : 0.25
        if (y === TRANSOM[1] - 1) face = 'warm'
      } else if (y < GY0) {
        v = y === FY0 ? 0.55 : y === GY0 - 1 ? 0.15 : 0.38
      } else if (y >= GY1) {
        v = y === GY1 ? 0.7 : y === FY1 - 1 ? 0.2 : 0.45
        if (y === GY1) face = 'warm'
      } else if (x < GX0) {
        v = x === FX0 ? 0.5 : x === GX0 - 1 ? 0.62 : 0.35
      } else {
        v = x === GX1 ? 0.18 : x === FX1 - 1 ? 0.5 : 0.36
        if (x === GX1) face = 'warm'
      }
      set(x, y, v, face)
    }
  }
}

// Heavy curtains either side of the window: straight folds, lit on the side toward the light.
function curtain(L, x0, x1, side) {
  const M = C.M
  const P = M.curtain
  for (let y = 0; y < FRONT; y++) {
    // The inner edge sways a little where the curtain is gathered.
    const sway = Math.round(Math.sin(y * 0.07) * 1.2 + Math.sin(y * 0.021) * 1.5)
    const a = side === 'L' ? x0 : x0 + sway
    const b = side === 'L' ? x1 + sway : x1
    for (let x = a; x < b; x++) {
      const u = (x - x0) / 6.2
      const fold = Math.sin(u * Math.PI * 2 + (side === 'L' ? 0.4 : 1.7))
      // The side of each fold that faces the window (left curtain) or the lamp (right).
      const facing = side === 'L' ? Math.cos(u * Math.PI * 2 + 0.4) : -Math.cos(u * Math.PI * 2 + 1.7)
      let v = 0.36 + 0.2 * fold + M.curtainWin * (side === 'L' ? 1 - (x1 - x) / 26 : (x1 - x) / 26) * 0.3
      v += lampAt(x, y) * M.curtainLamp * (0.4 + 0.6 * Math.max(0, facing))
      v -= 0.15 * smooth((y - 120) / 40)
      if (x === b - 1) v += side === 'L' ? 0.18 : -0.1
      if (x === a && side === 'R') v += 0.2 * lampAt(x, y) * M.curtainLamp + 0.08
      L.set(x, y, tone(P, v, x, y, 0.1))
    }
  }
  // Rings on the rod.
  for (let x = x0 + 2; x < x1; x += 5) {
    L.set(x, 3, M.rod[2])
    L.set(x + 1, 3, M.rod[1])
  }
}

function room() {
  const M = C.M
  const L = new Layer('room')
  // The wall above and below the window.
  for (let y = 0; y < DESK; y++) {
    for (let x = 0; x < W; x++) {
      if (x >= FX0 && x < FX1 && y >= FY0 && y < FY1) continue
      L.set(x, y, tone(M.wall, 0.35 + lampAt(x, y) * M.wallLamp, x, y, 0.4))
    }
  }
  frame(L)
  // The sill: a wooden ledge with a lit top edge.
  for (let y = FY1; y < DESK; y++) {
    for (let x = FX0 - 4; x < FX1 + 4; x++) {
      const v = (y === FY1 ? 0.75 : y === FY1 + 1 ? 0.55 : 0.3) + lampAt(x, y) * 0.5
      L.set(x, y, tone(M.wood, v, x, y, 0.3))
    }
  }
  const curtains = new Layer('curtains')
  curtain(curtains, -2, 27, 'L')
  curtain(curtains, 293, W + 2, 'R')
  // The rod across the top.
  for (let x = 0; x < W; x++) {
    curtains.set(x, 1, M.rod[2])
    curtains.set(x, 2, M.rod[0])
  }
  // The desk top: walnut boards with long grain; the bright panes shine in its gloss at the
  // back, broken by the bars; then the lit front edge and the dark front of the desk.
  const D = new Layer('desk')
  for (let y = DESK; y < H + 2; y++) {
    const board = Math.floor((y - DESK) / 7)
    for (let x = 0; x < W; x++) {
      let v
      if (y < FRONT) {
        v = M.deskV + [0, 0.04, -0.03, 0.05][board % 4]
        const g = vnoise(x / 15 + board * 9.3, (y - DESK) * 1.7, 9)
        if (g > 0.7) v -= 0.13
        else if (g < 0.22) v += 0.07
        if ((y - DESK) % 7 === 6) v -= 0.14 // the joint between two boards
        // The window in the gloss: strong at the back, thinning out toward the front.
        const k = y - DESK
        if (k < 11 && x >= GX0 - 1 && x < GX1 + 1) {
          const bar = MULL.some(([a, b]) => x >= a && x < b)
          const fade = 1 - k / 11
          const show = k < 6 || (x + y) % 2 === 0 || k < 8
          if (bar) v -= 0.05
          else if (show) v += M.deskGloss * fade
        }
      } else if (y < FRONT + 2) v = y === FRONT ? 0.8 : 0.5
      else v = y > 190 ? 0 : 0.14
      D.set(x, y, tone(M.wood, v, x, y, 0))
    }
  }
  book(D)
  // At dusk and at night the gloss carries the city's lights: short warm and cool smears.
  const R = new Layer('deskglints')
  if (M.deskLights) {
    const r = rng(17)
    for (let x = GX0; x < GX1; x += 3 + Math.floor(r() * 5)) {
      if (MULL.some(([a, b]) => x >= a - 1 && x < b + 1) || r() > M.deskLights) continue
      const c = M.mid.lit[Math.floor(r() * M.mid.lit.length)]
      const n = 1 + Math.floor(r() * r() * 8)
      const top = DESK + 1 + Math.floor(r() * 2)
      const wide = r() < 0.3
      for (let k = 0; k < n; k++) {
        const a = (k === 0 ? 0.42 : k < 3 ? 0.26 : 0.14) * (top > DESK + 1 ? 0.7 : 1)
        R.set(x, top + k, al(c, a))
        if (wide && k < n - 1) R.set(x + 1, top + k, al(c, a * 0.5))
      }
    }
  }
  part('', [lit(L), lit(curtains), lit(D), R])
}

// An open book and a pencil in the middle of the desk: two pages bowed up at the spine, lines
// of text, a soft shadow under it.
function book(D) {
  const M = C.M
  const cx = 160
  const y0 = 159
  const y1 = 172
  for (let y = y0 - 2; y < y1 + 1; y++) {
    const k = (y - y0) / (y1 - y0) // 0 at the far edge, 1 at the near
    const half = 22 + k * 4 // a little wider toward us
    for (let x = Math.floor(cx - half); x < Math.ceil(cx + half); x++) {
      const u = (x + 0.5 - cx) / half // -1..1
      // The top edge bows up toward the spine.
      const top = y0 - Math.round(2.2 * (1 - Math.abs(u)) ** 2)
      if (y < top) continue
      if (y === y1) {
        if (Math.abs(u) < 0.98) D.set(x, y, M.paper[0])
        continue
      }
      let c = M.paper[1]
      if (Math.abs(u) < 0.06) c = M.paper[0]
      else if (u > 0 && u < 0.2) c = M.paper[0] // the shade by the spine on the right page
      else if (y === top) c = M.paper[2]
      else if ((y - y0) % 2 === 1 && Math.abs(u) > 0.14 && Math.abs(u) < 0.88 && y < y1 - 1 && hash(x >> 2, y, 4) > 0.15) c = M.paper[0]
      D.set(x, y, c)
    }
  }
  for (const [x, y] of line(188, 174, 206, 167)) {
    D.set(x, y, M.pencil[1])
    D.set(x, y + 1, M.pencil[0])
  }
  D.set(188, 174, M.pencil[2])
  D.set(189, 174, M.pencil[2])
}

// ---------------------------------------------------------------- the desk, left: plant and mug

// A leaf: an ovate blade along an angle, drooping, with a midrib and a lit rim
// (sunfield/tools/painters.mjs).
function paintLeaf(L, o) {
  const tones = o.tones
  const ca = Math.cos(o.a)
  const sa = Math.sin(o.a)
  const nx = -sa
  const ny = ca
  const ext = o.len + o.w + 2
  const droop = o.droop ?? 0.25
  const upSign = ny < 0 ? 1 : -1
  const stalk = o.stalk ?? 0.12
  const mask = new Map()
  for (let y = Math.floor(o.y - ext); y <= Math.ceil(o.y + ext); y++) {
    for (let x = Math.floor(o.x - ext); x <= Math.ceil(o.x + ext); x++) {
      const rx = x + 0.5 - o.x
      const ry = y + 0.5 - o.y
      const t = rx * ca + ry * sa
      if (t < 0 || t > o.len) continue
      const p = t / o.len
      const bend = droop * p * p * o.len
      const s = rx * nx + ry * ny - bend * Math.sign(ny || 1)
      if (p < stalk) {
        if (Math.abs(s) < 0.6) mask.set(x + ',' + y, { stalk: true })
        continue
      }
      const q = (p - stalk) / (1 - stalk)
      let hw = q < 0.36 ? Math.pow(Math.sin((q / 0.36) * Math.PI * 0.5), 0.55) : Math.pow((1 - q) / 0.64, 1.1)
      hw *= o.w * (1 + 0.06 * Math.sin(t * 1.5))
      const lim = Math.max(hw, 0.55)
      if (Math.abs(s) >= lim) continue
      mask.set(x + ',' + y, { q, t, s, side: s / lim })
    }
  }
  const inLeaf = (x, y) => mask.has(x + ',' + y)
  for (const [k, m] of mask) {
    const [x, y] = k.split(',').map(Number)
    let b
    if (m.stalk) b = o.shade - 0.05
    else {
      b = o.shade + 0.26 * m.side * upSign
      if (Math.abs(m.s) < 0.6 && m.q < 0.9) b += 0.16
      // Edges: dark where the blade turns away below, a lit rim along the top.
      const below = !inLeaf(x, y + 1) || !inLeaf(x + 1, y)
      const above = !inLeaf(x, y - 1) || !inLeaf(x - 1, y)
      if (below) b = Math.min(b - 0.16, 0.22)
      else if (above) b += o.rim ?? 0.14
    }
    L.set(x, y, tone(tones, b, x, y, 0.16))
  }
}

function plant() {
  const M = C.M
  const L = new Layer('plant')
  const cx = 33
  // Stems, then leaves fanning up and out from the pot.
  const leaves = [
    { a: -1.95, len: 30, w: 8.5, droop: 0.12, from: [32, 150], at: 0.35 },
    { a: -1.45, len: 34, w: 9.5, droop: 0.08, from: [34, 150], at: 0.42 },
    { a: -1.05, len: 27, w: 8, droop: 0.22, from: [36, 150], at: 0.38 },
    { a: -2.45, len: 24, w: 7.5, droop: 0.3, from: [30, 150], at: 0.3 },
    { a: -0.62, len: 22, w: 7, droop: 0.38, from: [38, 151], at: 0.3 },
    { a: -2.85, len: 19, w: 6, droop: 0.45, from: [28, 151], at: 0.25 },
    { a: -1.7, len: 22, w: 7, droop: 0.15, from: [33, 150], at: 0.5 },
    { a: -0.25, len: 17, w: 5.5, droop: 0.6, from: [42, 151], at: 0.2 },
  ]
  const stems = new Layer('stems')
  for (const lf of leaves) {
    const sx = lf.from[0] + Math.cos(lf.a) * lf.len * lf.at * 1.4
    const sy = lf.from[1] + Math.sin(lf.a) * lf.len * lf.at * 1.4
    for (const [x, y] of line(lf.from[0], lf.from[1], sx, sy)) stems.set(x, y, M.stem)
    lf.x = sx
    lf.y = sy
  }
  for (const [i, lf] of leaves.entries()) {
    paintLeaf(L, { ...lf, tones: M.leaf, shade: 0.5 + (i % 3) * 0.04, rim: M.leafRim })
  }
  // The pot: terracotta, round, with a rolled rim; the window behind lights its left edge.
  const P = new Layer('pot')
  for (let y = 150; y < 172; y++) {
    const rim = y < 154
    const half = rim ? 13 : 11.5 - ((y - 154) / 18) * 2.5
    for (let x = Math.floor(cx - half); x < Math.ceil(cx + half); x++) {
      const u = (x + 0.5 - cx) / half
      let v = 0.5 + 0.25 * u - 0.25 * u * u
      if (u < -0.82) v += M.potRim
      if (rim) v += y === 150 ? 0.25 : y === 153 ? -0.25 : 0.08
      if (y === 171) v -= 0.25
      P.set(x, y, tone(M.pot, v, x, y, 0.3))
    }
  }
  for (let x = cx - 11; x < cx + 11; x++) P.set(x, 150, M.soil)
  return [lit(stems), lit(L), lit(P)]
}

// A small succulent in a glazed pot, on the books by the plant: a rosette of fat pointed
// leaves, their tips flushed.
function succulent() {
  const M = C.M
  const L = new Layer('succulent')
  const cx = 82
  const top = 149
  for (let y = top; y < 157; y++) {
    const half = y === top ? 7 : 6 - (y - top) * 0.2
    for (let x = Math.floor(cx - half); x < Math.ceil(cx + half); x++) {
      const u = (x + 0.5 - cx) / half
      let v = 0.55 + 0.3 * u - 0.25 * u * u + (y === top ? 0.25 : 0) - (y === 156 ? 0.2 : 0)
      if (u < -0.75) v += M.potRim * 0.6
      L.set(x, y, tone(M.glaze, v, x, y, 0.15))
    }
  }
  const leaves = [-1.57, -2.1, -1.05, -2.6, -0.55, -1.85, -1.3]
  leaves.forEach((a, i) => {
    paintLeaf(L, { x: cx + Math.cos(a) * 1.5, y: top - 1, a, len: i < 5 ? 9 - Math.abs(a + 1.57) * 1.6 : 6, w: 2.8, droop: 0.05, stalk: 0, tones: M.sage, shade: 0.5, rim: M.leafRim })
  })
  // Flushed tips.
  for (const a of leaves.slice(0, 5)) {
    const len = 9 - Math.abs(a + 1.57) * 1.6
    L.set(cx + Math.cos(a) * (len + 1), top - 1 + Math.sin(a) * (len + 1), M.blush)
  }
  return lit(L)
}

// A mustard mug of coffee standing in the lamp's pool: the lamp lights its right side and puts
// a glint on it, the window behind rims its left.
const MUG = { x: 247, top: 152, bottom: 172, r: 8 }
function mug() {
  const M = C.M
  const L = new Layer('mug')
  const { x: cx, top, bottom, r } = MUG
  // Its shadow on the desk: thrown left by the lamp, and a contact shadow at its foot.
  const S = new Layer('mugshadow')
  for (let y = bottom - 2; y < bottom + 3; y++) {
    for (let x = cx - 22; x < cx + 9; x++) {
      const u = (x - (cx - 22)) / 31
      const contact = y >= bottom - 1 && y <= bottom && x > cx - r - 1
      if (!contact && (y < bottom - 1 || (u < 0.25 && (x + y) % 2))) continue
      S.set(x, y, al('#000000', contact ? 0.42 : 0.24))
    }
  }
  // The handle: a thick ring, lit on its outer right side by the lamp.
  for (let y = top + 3; y < top + 16; y++) {
    for (let x = cx + 6; x < cx + 14; x++) {
      const d = Math.hypot((x + 0.5 - (cx + 8)) / 5, (y + 0.5 - (top + 9.5)) / 5.6)
      if (d >= 1 || d <= 0.5) continue
      const out = (x + 0.5 - (cx + 8)) / 5
      L.set(x, y, tone(M.mug, 0.42 + out * 0.32 + (d > 0.82 ? -0.1 : 0.06), x, y, 0.15))
    }
  }
  for (let y = top; y < bottom; y++) {
    const narrow = y >= bottom - 1 ? 1 : 0
    for (let x = Math.floor(cx - r) + narrow; x < Math.ceil(cx + r) - narrow; x++) {
      const u = (x + 0.5 - cx) / r
      // A glazed cylinder: the lamp lights the right, a sharp glint, a cool rim on the left from
      // the window behind, darker toward the foot.
      let v = 0.5 + 0.28 * u - 0.32 * u * u
      if (u > 0.36 && u < 0.56 && y > top + 3 && y < bottom - 3) v += 0.3
      if (u < -0.8) v += M.mugRim
      v -= 0.12 * smooth((y - (bottom - 7)) / 7)
      if (y === bottom - 1) v -= 0.12
      L.set(x, y, tone(M.mug, v, x, y, 0.2))
    }
  }
  // The rim seen from above: the back lip, the coffee inside, the front lip.
  for (let x = cx - r + 1; x < cx + r - 1; x++) L.set(x, top - 1, M.mug[5])
  for (let x = cx - r + 1; x < cx + r - 1; x++) {
    const u = (x + 0.5 - cx) / r
    L.set(x, top, Math.abs(u) > 0.8 ? M.mug[5] : u > 0.25 && u < 0.5 ? M.coffee[2] : u < -0.4 ? M.coffee[0] : M.coffee[1])
  }
  for (let x = cx - r; x < cx + r; x++) L.set(x, top + 1, M.mug[Math.abs(x + 0.5 - cx) / r > 0.75 ? 4 : 6])
  return [S, lit(L)]
}

// Steam off the coffee: three soft ribbons that rise and fade, a step every quarter second.
function steam() {
  const M = C.M
  const out = []
  for (let i = 0; i < 3; i++) {
    const L = new Layer('steam' + i)
    const base = MUG.top - 3 - i * 8 // where it sits in the still frame
    const ph = i * 2.1
    // A soft ribbon: thin where it leaves the cup, widest in the middle, thinning as it fades.
    for (let k = 0; k < 16; k++) {
      const c = MUG.x - 0.5 + 1.4 * Math.sin(k * 0.42 + ph) + (i - 1) * 1.5
      const half = k < 2 ? 0.6 : k < 5 ? 1.1 : k < 12 ? 1.7 : 1.2
      const a = (k < 2 ? 0.6 : k < 11 ? 1 : 0.55) * M.steamA
      for (let x = Math.floor(c - half); x <= c + half; x++) {
        const d = Math.abs(x + 0.5 - c) / half
        if (d > 1) continue
        L.set(x, base - k, al(M.steam, d < 0.5 ? a : a * 0.5))
      }
    }
    // It starts at the mug: its offset from there.
    const s = i * 8
    L.anim = anim('sr', '--s:' + s + 'px;--l:' + sec(-i * 2))
    out.push(L)
  }
  css('sr', '.sr{animation:sr 6s steps(24) ' + from('var(--l)') + ' infinite,so 6s steps(1) ' + from('var(--l)') + ' infinite}' +
    '@keyframes sr{from{transform:translateY(var(--s))}to{transform:translateY(calc(var(--s) - 24px))}}' +
    '@keyframes so{0%{opacity:.6}10%,55%{opacity:1}70%{opacity:.6}85%{opacity:.3}95%,100%{opacity:0}}')
  return out
}

// ---------------------------------------------------------------- the desk, right: lamp and books

// A stack of books lying flat: spines toward us, a band on each, page edges at the end.
function books(name, stack) {
  const M = C.M
  const L = new Layer(name)
  for (const b of stack) {
    b.c = M.book[b.k]
    for (let y = b.y0; y < b.y1; y++) {
      for (let x = b.x0; x < b.x1; x++) {
        let v = 0.5 + lampAt(x, y) * 0.6
        if (y === b.y0) v += 0.25
        if (y === b.y1 - 1) v -= 0.25
        if (x === b.x0) v += 0.15
        // A band on the spine.
        if (x >= b.x0 + 4 && x < b.x0 + 6 && y > b.y0 && y < b.y1 - 1) v += 0.35
        L.set(x, y, tone(b.c, v, x, y, 0.25))
      }
    }
    // Page edges at the left end.
    for (let y = b.y0 + 1; y < b.y1 - 1; y++) L.set(b.x0 - 1, y, M.paper[y % 2])
  }
  return lit(L)
}

// The pool of lamp light on the desk, in bands.
function pool() {
  const M = C.M
  const L = new Layer('pool')
  for (let y = DESK + 6; y < FRONT + 2; y++) {
    for (let x = POOL.x - POOL.rx - 2; x < POOL.x + POOL.rx + 2; x++) {
      const d = Math.hypot((x + 0.5 - POOL.x) / POOL.rx, (y + 0.5 - POOL.y) / POOL.ry)
      const v = 1 - d + (((x + y) & 1) ? 0.04 : -0.04)
      if (v <= 0) continue
      L.set(x, y, al(M.light, v > 0.55 ? M.poolA[2] : v > 0.25 ? M.poolA[1] : M.poolA[0]))
    }
  }
  return L
}

function lamp() {
  const M = C.M
  const P = M.lampPaint
  const L = new Layer('lamp')
  // Base: a heavy enamel disc on the desk, its top lit, its front in shadow.
  const [fx, fy] = FOOT
  for (let y = fy - 3; y < fy + 4; y++) {
    for (let x = fx - 13; x < fx + 13; x++) {
      const d = Math.hypot((x + 0.5 - fx) / 12, (y + 0.5 - (fy + 0.5)) / 3.3)
      if (d >= 1) continue
      const u = (x + 0.5 - fx) / 12
      let v = y < fy ? 0.6 - 0.25 * u : y < fy + 2 ? 0.34 - 0.1 * u : 0.16
      if (y === fy - 3 || (y < fy && d > 0.86)) v += 0.18
      L.set(x, y, tone(P, v, x, y, 0.15))
    }
  }
  // Contact shadow under it.
  const S0 = new Layer('lampshadow')
  for (let x = fx - 16; x < fx + 12; x++) S0.set(x, fy + 4, al('#000000', 0.35))
  // The post on the base.
  for (let y = fy - 7; y < fy - 2; y++) for (let x = fx - 1; x < fx + 2; x++) L.set(x, y, P[x === fx - 1 ? 4 : x === fx ? 2 : 1])
  // Arms: each a pair of rods with a gap between, as on an anglepoise; springs by the lower.
  const rod = (a, b, off) => {
    for (const [x, y] of line(a[0], a[1], b[0], b[1])) {
      L.set(x, y, P[3])
      L.set(x + off[0], y + off[1], P[1])
    }
  }
  rod([fx, fy - 7], ELBOW, [0, 0])
  rod([fx + 3, fy - 7], [ELBOW[0] + 2, ELBOW[1] + 2], [1, 0])
  rod(ELBOW, JOINT, [0, 0])
  rod([ELBOW[0], ELBOW[1] + 3], [JOINT[0] + 1, JOINT[1] + 3], [0, 1])
  for (const [x, y] of line(fx + 6, fy - 12, ELBOW[0] + 5, ELBOW[1] + 9)) {
    if ((x + y) % 2 === 0) L.set(x, y, M.brass[1])
    else L.set(x, y, M.brass[0])
  }
  // Brass joints with a glint.
  for (const [jx, jy, R] of [[ELBOW[0] + 1, ELBOW[1] + 1.5, 2.6], [JOINT[0] + 0.5, JOINT[1] + 1.5, 2.6], [fx + 1.5, fy - 6.5, 2]]) {
    for (let y = Math.floor(jy - R); y <= jy + R; y++) {
      for (let x = Math.floor(jx - R); x <= jx + R; x++) {
        const dx = x + 0.5 - jx
        const dy = y + 0.5 - jy
        const d = Math.hypot(dx, dy)
        if (d < R) L.set(x, y, M.brass[d < R * 0.4 ? 1 : dx + dy < -0.6 ? 2 : dx + dy > 0.8 ? 0 : 1])
      }
    }
  }
  // The shade: a flared cone along the axis, dark enamel lit along its back edge by the window
  // and with a hard glint; its mouth shows the bright inside and the bulb.
  const S = new Layer('shade')
  const Mo = new Layer('mouth')
  for (let y = JOINT[1] - 8; y < JOINT[1] + 26; y++) {
    for (let x = JOINT[0] - 20; x < JOINT[0] + 14; x++) {
      const dx = x + 0.5 - JOINT[0]
      const dy = y + 0.5 - JOINT[1]
      const t = dx * AX[0] + dy * AX[1]
      const s = dx * AX[1] - dy * AX[0]
      if (t < -2 || t > SHADE + 0.6) continue
      const q = clamp(t / SHADE, 0, 1)
      const rad = t < 0 ? 2.4 * Math.sqrt(1 - (t / 2) ** 2) : 2.8 + 6.8 * Math.pow(q, 1.6)
      if (Math.abs(s) > rad) continue
      const side = s / rad // -1 on the left edge, +1 on the right
      let c
      if (t > SHADE - 1.6) {
        // The mouth, seen at a slant: the bright inside of the shade, the bulb in the middle.
        c = Math.abs(s) > rad - 1 ? M.brass[1] : Math.abs(s) < 2.6 ? M.bulb[2] : M.bulb[1]
      } else {
        let v = 0.36 + 0.26 * side
        if (side > 0.25 && side < 0.5 && t > 2) v += 0.3 // the glint
        if (side < -0.78) v += M.shadeRim
        if (t < 2) v += 0.12
        c = tone(P, v, x, y, 0.12)
      }
      ;(t > SHADE - 1.6 ? Mo : S).set(x, y, c)
    }
  }
  return [S0, lit(L), lit(S), Mo]
}

// The beam under the shade: a cone of warm light down to the desk, brightest near the bulb,
// with a few rays in it; and a halo round the bulb.
function beam() {
  const M = C.M
  const L = new Layer('beam')
  const rays = [-0.55, -0.1, 0.42]
  for (let y = Math.floor(OPEN[1]) + 1; y < POOL.y + 2; y++) {
    for (let x = 180; x < 290; x++) {
      const dx = x + 0.5 - OPEN[0]
      const dy = y + 0.5 - OPEN[1]
      const t = dx * AX[0] + dy * AX[1]
      const s = dx * AX[1] - dy * AX[0]
      const half = 8.5 + t * 0.4
      if (t <= 0 || Math.abs(s) > half) continue
      const q = Math.abs(s) / half
      let v = (1 - t / 75) * (1 - q * q * 0.7)
      if (rays.some(k => Math.abs(s / half - k) < 0.045)) v += 0.18
      if (q > 0.86 && (x + y) % 2 === 0) continue // a dithered edge
      L.set(x, y, al(M.light, v > 0.75 ? M.beamA[2] : v > 0.45 ? M.beamA[1] : M.beamA[0]))
    }
  }
  const G = new Layer('halo')
  for (let y = Math.floor(OPEN[1] - 12); y < OPEN[1] + 12; y++) {
    for (let x = Math.floor(OPEN[0] - 15); x < OPEN[0] + 15; x++) {
      const d = Math.hypot(x + 0.5 - OPEN[0], (y + 0.5 - OPEN[1]) * 1.2)
      if (d < 14 && !(d > 10 && (x + y) % 2)) G.set(x, y, al(M.light, d < 6 ? M.haloA[1] : M.haloA[0]))
    }
  }
  return [L, G]
}

// Dust in the beam, drifting a cell at a time.
function motes() {
  const M = C.M
  const spots = [[250, 128], [242, 140], [258, 136], [236, 152], [248, 156], [262, 148], [230, 134]]
  css('mo', '.mo{animation:mo var(--d) steps(1) ' + from('var(--l)') + ' infinite}@keyframes mo{0%{transform:none}20%{transform:translate(1px,-1px)}40%{transform:translate(1px,-2px)}60%{transform:translate(0,-3px)}80%{transform:translate(-1px,-2px)}}')
  return spots.map(([x, y], i) => {
    const L = new Layer('mote' + i)
    L.set(x, y, al(M.mote, 0.85))
    const d = [10, 12, 9, 11, 13, 10, 12][i]
    L.anim = anim('mo', '--d:' + d + 's;--l:' + sec(-i * 1.7))
    return L
  })
}

// ---------------------------------------------------------------- encoding (as sunfield's build)

const PIN = { '': 'xMidYMid', pL: 'xMinYMid', pR: 'xMaxYMid' }
const PATTERN_MIN = 55

// Drops the cells of still layers that solid cells of still layers above hide, except a border
// one cell wide under the upper layer's edges: where an upper edge falls inside a screen pixel,
// the layer beneath it is still there, so nothing from further back shows through. Where a
// layer only meets an upper one (the window mist ends on the row above the room's sill), it
// gets that border too: a ring of hidden cells under the upper edge. Without it the backdrop
// showed through the joint as a line wherever a tile was drawn at a part-pixel offset.
// A border or ring cell shows a little on both sides of the upper edge: through its own
// antialiasing with the visible cells beside it, and where the upper tile's bitmap is resampled
// at a part-pixel offset. So it takes, of its own colour and its visible neighbours' (no new
// colour), the one nearest the colour over it.
const RING = [-1, 1, -4096, 4096, -4097, -4095, 4095, 4097]
function cull(layers) {
  // Cell -> the colour of the topmost solid cell over it so far.
  const covered = new Map()
  for (let i = layers.length - 1; i >= 0; i--) {
    const L = layers[i]
    if (L.wrap || L.anim || L.keep) continue
    const add = []
    const recolour = []
    const nearest = (k, own) => {
      const over = covered.get(k)
      let best = own
      for (const d of RING) {
        const n = L.m.get(k + d)
        if (covered.has(k + d) || n === undefined || n.length === 9) continue
        if (best === null || apart(n, over) < apart(best, over)) best = n
      }
      return best
    }
    const ring = new Set()
    for (const [k, c] of [...L.m]) {
      if (covered.has(k)) {
        if (RING.every(d => covered.has(k + d))) L.m.delete(k)
        else {
          const best = nearest(k, c.length !== 9 ? c : null)
          if (best !== null && best !== c) recolour.push([k, best])
        }
      } else if (c.length !== 9) {
        add.push(k) // a see-through cell hides nothing
        for (const d of RING) if (covered.has(k + d) && !L.m.has(k + d)) ring.add(k + d)
      }
    }
    for (const k of ring) recolour.push([k, nearest(k, null)])
    for (const [k, c] of recolour) L.m.set(k, c)
    for (const k of add) covered.set(k, L.m.get(k))
  }
}

function nextId() {
  let n = C.ids++
  let s = ''
  do {
    s = String.fromCharCode(97 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

// A pattern's tile is drawn into its own bitmap, and Chromium draws a tile bigger than 2048 x
// 2048 device pixels at a lower scale and stretches it, which blurs every edge in it. So a
// pattern's tile stays under MAXA cells (2048 x 2048 at 12 device px per cell) and a bigger
// layer is cut into several patterns.
const MAXA = Number(process.env.MAXA ?? 28000)
// The tile's corner sits on a cell corner (the scene's cells are centred on whole rows, so a
// corner row is at a half), with one clear cell on every side. A tile at a whole row put its
// corner half a cell off the cells, and at an odd number of device px per cell (9 at 1440x900@2)
// its bitmap was drawn half a pixel off and resampled: a line at every row of the moving train.
const ALIGN = Number(process.env.ALIGN ?? 1)
const tileOf = b => {
  const x = Math.floor((b.x0 - 1) / ALIGN) * ALIGN
  const r = Math.floor((b.y0 - 1) / ALIGN) * ALIGN
  return { x, y: r - 0.5, w: Math.ceil((b.x1 + 1) / ALIGN) * ALIGN - x, h: Math.ceil((b.y1 + 1) / ALIGN) * ALIGN - r }
}
const areaOf = b => (b ? tileOf(b).w * tileOf(b).h : 0)

// Cuts a layer whose tile would be too big in two along a row or a column, then each part again
// as needed. The first part also takes the solid cells of the second part's first row or column,
// so the second part's edge along the cut lies over them, not over what is beneath; in the
// second part those cells are edge cells (see encode.mjs), with nothing of it under them. The
// cut that leaves the smaller of the larger part wins, and of those the one fewest runs cross.
function pieces(L, edge = new Set()) {
  const b = bounds(L)
  if (areaOf(b) <= MAXA) return [{ L, edge }]
  const cells = [...L.m].map(([k, c]) => [k, (k % 4096) - 1000, Math.floor(k / 4096) - 1000, c])
  let best = null
  for (const ax of [0, 1]) {
    const lo = ax ? b.y0 : b.x0
    const hi = ax ? b.y1 : b.x1
    for (let cut = lo + 2; cut < hi - 1; cut++) {
      const A = new Layer(L.name + 'a')
      const B = new Layer(L.name + 'b')
      let cross = 0
      for (const [, x, y, c] of cells) {
        const v = ax ? y : x
        if (v < cut) A.set(x, y, c)
        else {
          B.set(x, y, c)
          if (v === cut && !clear(c)) A.set(x, y, c)
        }
        if (v === cut && L.has(ax ? x : x - 1, ax ? y - 1 : y)) cross++
      }
      const score = [Math.ceil(Math.max(areaOf(bounds(A)), areaOf(bounds(B))) / 2000), cross]
      if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) best = { score, A, B, ax, cut }
    }
  }
  const { A, B, ax, cut } = best
  const EA = new Set([...A.m.keys()].filter(k => edge.has(k)))
  const EB = new Set([...B.m.keys()].filter(k => edge.has(k) || (ax ? Math.floor(k / 4096) - 1000 : (k % 4096) - 1000) === cut))
  return [...pieces(A, EA), ...pieces(B, EB)]
}

// Solid colours of a set within MERGE levels on every channel of a commoner one take its colour
// (the relit layers carry many colours one to three levels apart). Each colour moves to the
// commonest colour near it, so no cell moves more than MERGE levels.
const MERGE = Number(process.env.MERGE ?? 0)
function merged(L) {
  if (!MERGE) return L
  const count = new Map()
  for (const c of L.m.values()) if (!clear(c)) count.set(c, (count.get(c) ?? 0) + 1)
  const reps = []
  const to = new Map()
  for (const [c] of [...count].sort((a, b) => b[1] - a[1])) {
    const p = parse(c)
    const r = reps.find(q => Math.max(...[0, 1, 2].map(i => Math.abs(q.p[i] - p[i]))) <= MERGE)
    if (r) to.set(c, r.c)
    else reps.push({ c, p })
  }
  if (!to.size) return L
  const M = new Layer(L.name)
  for (const [k, c] of L.m) M.m.set(k, to.get(c) ?? c)
  return M
}

function draw(L, still = false) {
  L = merged(L)
  const behind = still && C.pin === '' ? behindAt : null
  const plain = emitSafe(L, { behind })
  const runs = runsIn(plain)
  if (process.env.DUMP) {
    C.dumps = (C.dumps ?? 0) + 1
    fs.writeFileSync(path.join(process.env.DUMP, C.M === MOMENTS.day ? 'day' : C.M === MOMENTS.evening ? 'evening' : 'night') + '-' + C.dumps + '-' + L.name + '.json', JSON.stringify([...L.m]))
  }
  if (process.env.SIZES) {
    const cols = new Set(L.m.values())
    const v = o => String(emitSafe(L, o).length).padStart(6)
    console.log('   ', L.name.padEnd(10), 'cells', String(L.size).padStart(6), 'colours', String(cols.size).padStart(4), 'clear', String([...cols].filter(clear).length).padStart(3), 'old', String(emitCells(L).length).padStart(6), 'new', String(plain.length).padStart(6),
      'none', v({ back: 'none' }), 'back28', v({ back: 'always' }), 'back40', v({ back: 'always', T: 40 }), 'area', v({ order: 'area' }), JSON.stringify(bounds(L)), L.parts ?? '')
  }
  if (runs < PATTERN_MIN) {
    C.stats.plainRuns += runs
    return plain
  }
  let out = ''
  for (const { L: P, edge } of pieces(L)) {
    // The tile keeps a clear cell on every side, so no edge of the tile's bitmap falls on a
    // drawn cell. Its viewBox starts half a row up, so the paths inside keep whole rows.
    const t = tileOf(bounds(P))
    const id = nextId()
    const body = emitSafe(P, { ox: t.x, oy: t.y + 0.5, edge, behind })
    C.stats.patterns++
    C.stats.patternRuns += runsIn(body)
    C.defs.push('<pattern id="' + id + '" width="1" height="1" viewBox="0 -.5 ' + t.w + ' ' + t.h + '">' + body + '</pattern>')
    out += '<rect x="' + t.x + '" y="' + t.y + '" width="' + t.w + '" height="' + t.h + '" fill="url(#' + id + ')"/>'
  }
  return out
}

// Still layers in a row merge into one set of cells, the upper one's cells winning. See-through
// cells must not merge over cells of the same place, so a still layer with see-through cells
// over the set starts a new set.
const COMP = Number(process.env.COMP ?? 64)
// Colour a drawn over colour b (Porter-Duff over), as #rrggbb or #rrggbbaa.
function over(a, b) {
  const [r1, g1, b1, a1] = parse(a)
  const [r2, g2, b2, a2] = parse(b)
  const x = a1 / 255
  const y = (a2 / 255) * (1 - x)
  const t = x + y
  const ch = v => Math.round(v).toString(16).padStart(2, '0')
  const mix = (p, q) => ch((p * x + q * y) / t)
  return '#' + mix(r1, r2) + mix(g1, g2) + mix(b1, b2) + (Math.round(t * 255) >= 255 ? '' : ch(t * 255))
}

// What the main viewport shows so far at each cell, for the soft outlines in encode.mjs: a
// solid colour, or null where it is unknown (something moves or is see-through over an unknown
// there). Cells not yet drawn show the under-layer: the sky bands, or the dark rect around them.
function backdropAt(k) {
  const x = (k % 4096) - 1000
  const y = Math.floor(k / 4096) - 1000
  if (x < 20 || x >= 300 || y < 0 || y > 150) return C.M.under
  return grad(C.M.sky, Math.min(Math.floor(y / 3) * 3, 147) + 1.5)
}
function behindAt(k) {
  if (C.pin !== '') return null
  const v = C.seen.get(k)
  return v !== undefined ? v : backdropAt(k)
}
function shown(L) {
  if (C.pin !== '') return
  for (const [k, c] of L.m) {
    if (!clear(c)) C.seen.set(k, c)
    else {
      const b = behindAt(k)
      C.seen.set(k, b ? over(c, b) : null)
    }
  }
}
function unknown(x0, y0, x1, y1) {
  if (C.pin !== '') return
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) C.seen.set(x + 1000 + (y + 1000) * 4096, null)
}
// The cells a moving layer can reach: the mist swings 6 cells, the train crosses the whole
// width, the runners slip down their panes; the rest only blink in place.
const SWEEP = { mi: [6, 0], tn: [400, 0], tg: [0, 0], bl: [0, 0] }
function moved(L) {
  if (C.pin !== '') return
  const [dx, dy] = SWEEP[L.anim.cls] ?? (/^dr/.test(L.anim.cls) ? [0, 100] : [1, 1])
  for (const k of L.m.keys()) {
    for (let j = -Math.min(dy, 1); j <= dy; j++) for (let i = -dx; i <= dx; i++) C.seen.set(k + i + j * 4096, null)
  }
}

function renderLayers(layers) {
  let out = ''
  let still = null
  const flush = () => {
    if (still) {
      out += draw(still, true)
      shown(still)
    }
    still = null
  }
  for (const L of layers) {
    if (L.wrap) {
      flush()
      out += L.wrap + renderLayers(L.layers) + L.end
      unknown(GX0 - 1, GY0 - 1, GX1 + 1, GY1 + 1)
      continue
    }
    if (!L.size) continue
    if (!L.anim) {
      // A see-through cell over a cell of the set is composited into it (exactly what the
      // browser would draw, to the level). Drawn as its own pattern instead, its edge and the
      // edges under it were resampled apart: a light line under the pot's shadow on the desk.
      // A big see-through layer (mist, glow) composited would add too many colours; it starts
      // a new set instead.
      const lap = still ? [...L.m].filter(([k, c]) => clear(c) && still.m.has(k)).length : 0
      if (lap > COMP) flush()
      still ??= new Layer('still')
      if (process.env.SIZES) still.parts = (still.parts ?? '') + ' ' + L.name
      for (const [k, c] of L.m) {
        const u = still.m.get(k)
        still.m.set(k, clear(c) && u !== undefined ? over(c, u) : c)
      }
      if (process.env.LAPS && lap) console.log('   ', L.name, 'see-through over the set', lap, lap > COMP ? 'new set' : 'composited')
      continue
    }
    flush()
    out += '<g class="' + L.anim.cls + '"' + (L.anim.style ? ' style="' + L.anim.style + '"' : '') + L.anim.extra + '>' + draw(L) + '</g>'
    moved(L)
  }
  flush()
  return out
}

function keptLength(cssText) {
  let n = 0
  for (const m of cssText.matchAll(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}|@media[^{]*\{[^{}]*\{[^{}]*\}\}|([^{}]+)\{([^{}]*)\}/g)) {
    if (m[0].startsWith('@keyframes')) continue
    if (m[0].startsWith('@media')) {
      n += m[0].length + 12
      continue
    }
    const decls = m[2].split(';').filter(d => d && !/^animation/.test(d))
    n += m[1].length + 3 + (decls.length ? decls.join(' ').length + 8 : 0) + 1
  }
  return n
}

function build(name) {
  C = { M: MOMENTS[name], parts: [], defs: [], ids: 0, css: new Map(), stats: { patterns: 0, patternRuns: 0, plainRuns: 0 }, seen: new Map(), pin: '' }
  const M = C.M
  // Outside, back to front, all in the room's own viewport.
  part('', [clouds(), farCity(), mist(), ...mastLight(), ...midCity(), ...railway(), nearCity(), ...sign(), ...bokeh()])
  part('', [{ wrap: '<g clip-path="url(#G)">', end: '</g>', layers: [rain('rainfar', 5, 48, 95, [4, 7], M.rain[0], 1), rain('rainnear', 6, 64, 26, [8, 12], M.rain[1], 2)] }])
  part('', [glass(), ...runners()])
  room()
  // The desk, left: the plant, and two books with a succulent on them, in the window's light.
  part('pL', [...plant(), books('lbooks', [{ x0: 66, x1: 100, y0: 163, y1: 171, k: 1 }, { x0: 69, x1: 97, y0: 157, y1: 163, k: 0 }]), succulent()])
  // The desk, right: the lamp on a stack of books, its beam, and the mug steaming in its pool.
  const rbooks = books('rbooks', [
    { x0: 288, x1: 322, y0: 163, y1: 171, k: 0 },
    { x0: 285, x1: 318, y0: 158, y1: 163, k: 1 },
    { x0: 289, x1: 321, y0: 153, y1: 158, k: 2 },
  ])
  part('pR', [pool(), rbooks, ...lamp(), ...beam(), ...mug(), ...steam(), ...motes()])

  C.defs.push('<clipPath id="G"><path d="M' + GX0 + ' ' + GY0 + 'H' + GX1 + 'V' + GY1 + 'H' + GX0 + 'z"/></clipPath>')
  const pieces = []
  const walkAll = ls => ls.flatMap(L => (L.wrap ? walkAll(L.layers) : [L]))
  for (const p of C.parts) for (const L of walkAll(p.layers)) if (L.lit) relight(L)
  // Parts in a row in one viewport are culled together (the room hides the city behind its
  // walls, and the mist meets the sill).
  for (let i = 0; i < C.parts.length; ) {
    let j = i
    while (j < C.parts.length && C.parts[j].pin === C.parts[i].pin) j++
    cull(C.parts.slice(i, j).flatMap(p => p.layers))
    i = j
  }
  for (const p of C.parts) {
    if (process.env.DIAG) {
      const walk = ls => ls.flatMap(L => (L.wrap ? walk(L.layers) : [L]))
      for (const L of walk(p.layers)) {
        const e = emitSafe(L)
        console.log('  ', (p.pin || 'room').padEnd(5), L.name.padEnd(12), 'cells', String(L.size).padStart(6), 'runs', String(runsIn(e)).padStart(5), 'chars', e.length)
      }
    }
    C.pin = p.pin
    pieces.push([p.pin, renderLayers(p.layers)])
  }
  const view = pin => '<svg viewBox="0 -.5 ' + W + ' ' + H + '" preserveAspectRatio="' + PIN[pin] + ' slice">'
  let body = ''
  let pin = null
  for (const [p, html] of pieces) {
    if (p !== pin) {
      if (pin !== null) body += '</svg>'
      body += view(p)
      pin = p
    }
    body += html
  }
  body += '</svg>'
  const CSS = [...C.css.values()].join('') + '@media (prefers-reduced-motion:reduce){:root *{animation:none!important}}'
  // Under everything, the room's darkest colour, so where two cells share a screen pixel no
  // light from behind shows through between them.
  const under = '<svg viewBox="0 -.5 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice"><rect x="-80" y="-40" width="480" height="280" fill="' + M.under + '"/>' + sky() + '</svg>'
  let svg =
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" font-family="a" color="a" style="--m:0s">' +
    // The defs go last, so the first viewBox in the file is the scene's (the patterns have one).
    '<style>' + CSS + '</style>' + under + body + '<defs>' + C.defs.join('') + '</defs></svg>'
  svg = svg.replaceAll('"', "'")
  const scrubbed = svg.length - CSS.length + keptLength(CSS) + [...svg.matchAll(/<(\w+)[^>]*\/>/g)].reduce((n, m) => n + 2 + m[1].length, 0)
  const runsOver = [...svg.matchAll(/d='([^']*)'/g)].map(m => (m[1].match(/[hv]-?[\d.]/g) ?? []).length).filter(n => n > 64).length
  fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true })
  const file = path.join(ROOT, 'out', 'rainy-studio-' + name + '.svg')
  fs.writeFileSync(file, svg)
  console.log(
    name.padEnd(8),
    svg.length,
    'chars,',
    scrubbed,
    'after the scrub;',
    'patterns',
    C.stats.patterns,
    'holding',
    C.stats.patternRuns,
    'runs, plain runs',
    C.stats.plainRuns,
    runsOver ? '| PATHS OVER 64 RUNS: ' + runsOver : '',
  )
  if (svg.length > 131072 || scrubbed > 131072) throw new Error(name + ' is past 131072 characters')
}

const which = process.argv.slice(2)
for (const name of which.length ? which : Object.keys(MOMENTS)) build(name)
