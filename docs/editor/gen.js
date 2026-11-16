// Generators: seeded, deterministic pixel painters. Each writes tones (local colour numbers)
// into a 320 x 200 grid for every moment, and gives each tone a colour per moment. The light
// is shared: every moment has one key light (the sun layer's disc, or the usual place for that
// time of day), and every shaded thing takes its lit side, shadow side, rim and cast shadow
// from it (prototypes/_refs/lighting.md). Far things are hazed toward the horizon's colour.
import { H, N, W, writable, addSlot, setSlotColors, slotUsage, removeSlots } from './project.js'
import { LIGHT_DEFAULT, SUN, horizonOf, hueToward, kindOf, lighten, mixHex, relight, skyAt, skyStops } from './color.js'
import { bayer, clamp, hash2, rng, smooth } from './util.js'

/* ---------- Helpers ---------- */

function vnoise(x, seed) {
  const i = Math.floor(x)
  const f = x - i
  const a = hash2(i, 7, seed)
  const b = hash2(i + 1, 7, seed)
  return a + (b - a) * smooth(f)
}
function fbm(x, seed, oct = 3) {
  let s = 0
  let amp = 1
  let tot = 0
  let fr = 1
  for (let k = 0; k < oct; k++) {
    s += vnoise(x * fr, seed + k * 131) * amp
    tot += amp
    amp *= 0.5
    fr *= 2.03
  }
  return s / tot
}
// Is the cell (x, y) covered at coverage p? Three clean patterns, the ones pixel artists use:
// a staggered grid (25%), a checkerboard (50%) and the grid's complement (75%). No diagonals.
const dith = (x, y, p) => {
  if (p >= 0.99) return true
  if (p <= 0.01) return false
  if (p < 0.375) return ((x + ((y & 1) << 1)) & 3) === 0
  if (p < 0.625) return ((x + y) & 1) === 0
  return ((x + ((y & 1) << 1)) & 3) !== 0
}
const AMBIENT = '#4b5b98'
const shadowOf = (c, k = 1) => mixHex(lighten(c, -0.12 * k, 0.94), AMBIENT, 0.2 * k)
const deepOf = c => mixHex(lighten(c, -0.21, 0.86), '#38437c', 0.3)
const rimOf = c => hueToward(c, 85, 0.18, 0.085, 1.02)

function put(T, x, y, v) {
  if (y < 0 || y >= H) return
  x = ((x % W) + W) % W
  T[y * W + x] = v
}
function putClip(T, x, y, v) {
  if (x < 0 || x >= W || y < 0 || y >= H) return
  T[y * W + x] = v
}
const inDisc = (dx, dy, r) => dx * dx + dy * dy <= r * r + r * 0.55

/* ---------- The light and the sky of the project ---------- */

// What every generator knows: moments with their kinds, where the light is at each, the
// horizon row and the sky's colours (for haze and reflections).
export function lightContext(doc) {
  const sky = doc.layers.find(l => l.kind === 'sky' && l.gen)
  const sun = doc.layers.find(l => l.kind === 'sun' && l.gen && l.visible)
  const horizon = sky ? sky.gen.horizon : 150
  const style = sky ? sky.gen.style : 'clear'
  const moments = doc.moments.map(m => ({ id: m.id, kind: kindOf(m) }))
  const light = {}
  const horizonColor = {}
  const skyMid = {}
  const skyTop = {}
  for (const m of moments) {
    const pos = sun ? sunPos(sun.gen, m, horizon) : defaultPos(m.kind, horizon)
    light[m.id] = { ...pos, kind: m.kind }
    horizonColor[m.id] = horizonOf(m.kind, style)
    skyMid[m.id] = skyAt(m.kind, 0.55, style)
    skyTop[m.id] = skyAt(m.kind, 0.1, style)
  }
  return { moments, light, horizon, style, horizonColor, skyMid, skyTop }
}
function defaultPos(kind, horizon) {
  const d = LIGHT_DEFAULT[kind] || LIGHT_DEFAULT.day
  return { x: Math.round(d.fx * W), up: d.up, y: horizon - d.up, body: kind === 'night' ? 'moon' : 'sun' }
}
export function sunPos(g, m, horizon) {
  const d = defaultPos(m.kind, horizon)
  const p = g.pos?.[m.id]
  const x = p ? p.x : d.x
  const up = p ? p.up : d.up
  let body = g.body === 'auto' || !g.body ? (m.kind === 'night' ? 'moon' : 'sun') : g.body
  return { x, up, y: horizon - up, body }
}
// The light's direction seen from a point: a unit vector (screen x, screen y, toward viewer).
function lightDir(L, x, y) {
  let dx = L.x - x
  let dy = L.y - y
  const d = Math.hypot(dx, dy) || 1
  dx /= d
  dy /= d
  return [dx * 0.86, dy * 0.86, 0.5]
}
// How high the light stands, 0 (at the horizon) to 1 (high).
const elevation = L => clamp(L.up / 110, 0, 1)

// Material colours for each moment: the day colour relit for the moment's light, then hazed
// toward the horizon by distance.
function perMoment(ctx, day, haze = 0) {
  const out = {}
  for (const m of ctx.moments) {
    let c = relight(day, 'day', m.kind)
    if (haze > 0) c = mixHex(c, ctx.horizonColor[m.id], haze)
    out[m.id] = c
  }
  return out
}
const HAZE = [0, 0.26, 0.46, 0.64]

/* ---------- Sky ---------- */

const sky = {
  label: 'Sky',
  lightFree: true,
  fields: [
    { key: 'style', label: 'Colours', type: 'choice', options: [['clear', 'Clear'], ['warm', 'Warm'], ['pale', 'Pale'], ['storm', 'Stormy']], paint: true },
    { key: 'bands', label: 'Bands', type: 'range', min: 4, max: 14, step: 1, paint: true },
    { key: 'horizon', label: 'Horizon', type: 'range', min: 60, max: 200, step: 1, unit: 'row', hint: 'Where the sky meets the land. Hills and water use it too.' },
    { key: 'dither', label: 'Dither', type: 'choice', options: [[0, 'None'], [1, 'Soft'], [2, 'Wide']] },
  ],
  defaults: () => ({ style: 'clear', bands: 9, horizon: 150, dither: 1 }),
  ramp(p, ctx) {
    const out = []
    for (let b = 0; b < p.bands; b++) {
      const colors = {}
      for (const m of ctx.moments) colors[m.id] = skyAt(m.kind, b / (p.bands - 1), p.style)
      out.push(colors)
    }
    return out
  },
  draw(p) {
    const T = new Uint8Array(N)
    const nb = p.bands
    const hz = Math.max(20, p.horizon)
    // The band boundaries, in rows: thick bands high up, thin ones near the horizon.
    const edge = []
    for (let k = 1; k < nb; k++) edge.push(hz * ((k - 0.5) / (nb - 1)) ** (1 / 1.45))
    const pats = p.dither === 2 ? [0.25, 0.5, 0.75] : p.dither === 1 ? [0.5] : []
    for (let y = 0; y < H; y++) {
      let band = 0
      while (band < edge.length && y >= Math.round(edge[band])) band++
      for (let x = 0; x < W; x++) T[y * W + x] = band + 1
      // Dither rows just above each boundary blend in the band below.
      for (let k = 0; k < edge.length; k++) {
        const e = Math.round(edge[k])
        const o = e - y // rows above the boundary
        if (o >= 1 && o <= pats.length) {
          const cover = pats[pats.length - o]
          for (let x = 0; x < W; x++) if (dith(x, y, cover)) T[y * W + x] = k + 2
        }
      }
    }
    return T
  },
}

/* ---------- Sun and moon ---------- */

const sunGen = {
  label: 'Sun and moon',
  fields: [
    { key: 'body', label: 'Body', type: 'choice', options: [['auto', 'Sun, moon at night'], ['sun', 'Sun'], ['moon', 'Moon']], paint: true },
    { key: 'x', label: 'Across', type: 'range', min: 0, max: 319, step: 1, perMoment: true, hint: 'Where it stands at this moment. Hills, clouds and water take their light from it.' },
    { key: 'up', label: 'Height', type: 'range', min: -20, max: 190, step: 1, perMoment: true, unit: 'rows' },
    { key: 'size', label: 'Size', type: 'range', min: 3, max: 18, step: 1 },
    { key: 'glow', label: 'Glow', type: 'choice', options: [[0, 'None'], [1, 'Soft'], [2, 'Wide'], [3, 'Wider']] },
  ],
  defaults: () => ({ body: 'auto', size: 8, glow: 2, pos: {}, seed: 7 }),
  // 1 core, 2 disc, 3 rim or moon shade, 4 crater, 5 glow, 6 outer glow
  ramp(p, ctx) {
    const tones = [[], [], [], [], [], []]
    for (const m of ctx.moments) {
      const body = sunPos(p, m, ctx.horizon).body
      let c
      if (body === 'moon') {
        c = m.kind === 'night' ? SUN.night : m.kind === 'dusk' ? { ...SUN.night, glow: '#6a6a9e', glow2: '#4d4a80' } : { disc: '#f2f5fb', core: '#ffffff', shade: '#cdd5e6', crater: '#dce2ee', glow: mixHex('#f2f5fb', ctx.skyMid[m.id], 0.55), glow2: mixHex('#f2f5fb', ctx.skyMid[m.id], 0.78) }
      } else {
        c = SUN[m.kind === 'night' ? 'dusk' : m.kind] || SUN.day
        c = { ...c, shade: mixHex(c.disc, c.glow, 0.45), crater: c.disc }
      }
      const list = [c.core, c.disc, c.shade, c.crater, c.glow, c.glow2]
      list.forEach((v, i) => (tones[i][m.id] = v))
    }
    return tones.map(t => Object.fromEntries(Object.entries(t)))
  },
  draw(p, ctx, m) {
    const T = new Uint8Array(N)
    const L = sunPos(p, m, ctx.horizon)
    const r = p.size
    const cx = L.x
    const cy = L.y
    const g = p.glow | 0
    const g1 = g === 0 ? 0 : g === 3 ? 3 : 2
    const g2 = g <= 1 ? 0 : g === 2 ? 4 : 7
    const R = r + g1 + g2 + 1
    for (let y = Math.floor(cy - R); y <= cy + R; y++) {
      for (let x = Math.floor(cx - R); x <= cx + R; x++) {
        const dx = x - cx
        const dy = y - cy
        const d = Math.hypot(dx, dy)
        if (inDisc(dx, dy, r)) continue
        if (g1 && d <= r + g1 + 0.4 && dith(x, y, 0.5)) putClip(T, x, y, 5)
        else if (g2 && d <= r + g1 + g2 + 0.4 && d > r + g1 - 0.6 && dith(x, y, 0.25)) putClip(T, x, y, 6)
      }
    }
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const dx = x - cx
        const dy = y - cy
        if (!inDisc(dx, dy, r)) continue
        let v = 2
        if (L.body === 'moon') {
          // Lit from the upper right (the sun below the horizon): a shaded lower-left limb.
          const sx = dx / r + 0.42
          const sy = dy / r - 0.42
          if (sx * sx + sy * sy > 1.15) v = 3
          else if (dx * dx + dy * dy < (r * 0.3) ** 2 && dx > -1 && dy < 1) v = 1
        } else {
          if (!inDisc(dx, dy, r - 1)) v = 3
          else if (inDisc(dx + 1, dy + 1, Math.max(1, r * 0.55))) v = 1
        }
        putClip(T, x, y, v)
      }
    }
    if (L.body === 'moon' && r >= 4) {
      const R2 = rng(p.seed || 7)
      const n = r >= 8 ? 4 : 2
      for (let k = 0; k < n; k++) {
        const a = R2() * Math.PI * 2
        const rr = R2() * r * 0.6
        const kx = Math.round(cx + Math.cos(a) * rr)
        const ky = Math.round(cy + Math.sin(a) * rr)
        const s = r >= 8 && k === 0 ? 2 : 1
        for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) if (inDisc(kx + xx - cx, ky + yy - cy, r - 1.5) && T[(ky + yy) * W + kx + xx] === 2) putClip(T, kx + xx, ky + yy, 4)
      }
    }
    return T
  },
}

/* ---------- Stars ---------- */

const stars = {
  label: 'Stars',
  lightFree: true,
  fields: [
    { key: 'amount', label: 'Amount', type: 'range', min: 1, max: 10, step: 1 },
    { key: 'big', label: 'Bright stars', type: 'range', min: 0, max: 14, step: 1 },
    { key: 'bottom', label: 'Down to', type: 'range', min: 30, max: 200, step: 1, unit: 'row' },
    { key: 'seed', label: 'Pattern', type: 'seed' },
  ],
  defaults: ctx => ({ amount: 5, big: 6, bottom: Math.min(200, ctx.horizon - 10), seed: 4242 }),
  // 1 bright, 2 mid, 3 dim, 4 arm
  ramp(p, ctx) {
    const base = ['#ffffff', '#cdd6f6', '#7f8cc6', '#9aa7de']
    return base.map(c => Object.fromEntries(ctx.moments.map(m => [m.id, m.kind === 'night' ? c : mixHex(c, ctx.skyMid[m.id], m.kind === 'dusk' ? 0.25 : 0.5)])))
  },
  draw(p) {
    const T = new Uint8Array(N)
    const R = rng(p.seed)
    const bottom = clamp(p.bottom, 10, H)
    const count = Math.round(p.amount * 34 * (bottom / 150))
    const free = (x, y, s) => {
      for (let yy = y - s; yy <= y + s; yy++) for (let xx = x - s; xx <= x + s; xx++) if (yy >= 0 && yy < H && xx >= 0 && xx < W && T[yy * W + xx]) return false
      return true
    }
    for (let k = 0, tries = 0; k < count && tries < count * 8; tries++) {
      const x = Math.floor(R() * W)
      // More stars high up: thinner toward the horizon.
      const y = Math.floor(bottom * R() ** 1.35)
      if (!free(x, y, 1)) continue
      const r = R()
      putClip(T, x, y, r < 0.12 ? 1 : r < 0.42 ? 2 : 3)
      k++
    }
    for (let k = 0, tries = 0; k < p.big && tries < 300; tries++) {
      const x = 3 + Math.floor(R() * (W - 6))
      const y = 3 + Math.floor((bottom - 6) * R() ** 1.2)
      if (!free(x, y, 3)) continue
      const long = R() < 0.35
      putClip(T, x, y, 1)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        putClip(T, x + dx, y + dy, 4)
        if (long) putClip(T, x + dx * 2, y + dy * 2, 3)
      }
      k++
    }
    return T
  },
}

/* ---------- Clouds ---------- */

const CLOUD = {
  white: ['#ffffff', '#f5f9ff', '#e0e9f6', '#b6c6e1', '#8ea2c8'],
  grey: ['#eef1f6', '#d9dfe9', '#c0c8d7', '#97a2ba', '#717e9a'],
  storm: ['#c8cdd8', '#a6aebd', '#878fa3', '#626b82', '#454d65'],
}
// Each cloud is a heap of ellipses on a flat base: a wide low body and puffs piled on it,
// biggest in the middle, overlapping so they read as one mass.
function cloudShapes(p) {
  const R = rng(p.seed)
  const out = []
  const n = p.amount
  const top = Math.min(p.top, p.bottom - 6)
  const bot = Math.max(p.bottom, top + 6)
  for (let i = 0; i < n; i++) {
    const s = p.size * R.range(0.75, 1.25)
    const long = p.style === 'long'
    const wisp = p.style === 'wisp'
    const w = (long ? R.range(70, 120) : wisp ? R.range(50, 100) : R.range(32, 64)) * s
    const ht = wisp ? R.range(2.5, 4) * s : long ? w * R.range(0.09, 0.12) : w * R.range(0.28, 0.36)
    // Spread the clouds across the width, with some jitter.
    const cx = ((i + R.range(0.15, 0.85)) / n) * W
    const base = Math.round(R.range(top + ht, bot))
    const parts = []
    // The body: wide and low, cut flat by the base.
    parts.push({ x: cx, y: base - ht * (wisp ? 0.45 : 0.15), rx: w / 2, ry: ht * (wisp ? 0.6 : 0.4) })
    if (!wisp) {
      const np = long ? 5 + Math.floor(R() * 3) : 3 + Math.floor(R() * 3)
      for (let k = 0; k < np; k++) {
        const t = (k + R.range(0.3, 0.7)) / np
        const env = Math.sin(Math.PI * (0.1 + 0.8 * t))
        const r = (long ? 0.06 + 0.06 * env : 0.13 + 0.15 * env) * w * R.range(0.85, 1.15)
        const px = cx - w * 0.38 + t * w * 0.76
        const py = base - r * 0.55 - env * (ht - r) * 0.9
        parts.push({ x: px, y: py, rx: r * (long ? 1.6 : 1.05), ry: r })
      }
    }
    out.push({ cx, base, parts, w, ht })
  }
  return out
}
const clouds = {
  label: 'Clouds',
  fields: [
    { key: 'amount', label: 'Clouds', type: 'range', min: 1, max: 9, step: 1 },
    { key: 'size', label: 'Size', type: 'range', min: 0.5, max: 2, step: 0.05 },
    { key: 'style', label: 'Shape', type: 'choice', options: [['puffy', 'Puffy'], ['long', 'Long'], ['wisp', 'Wisps']] },
    { key: 'shade', label: 'Colour', type: 'choice', options: [['white', 'White'], ['grey', 'Grey'], ['storm', 'Storm']], paint: true },
    { key: 'top', label: 'Highest', type: 'range', min: 0, max: 190, step: 1, unit: 'row' },
    { key: 'bottom', label: 'Lowest', type: 'range', min: 10, max: 200, step: 1, unit: 'row' },
    { key: 'seed', label: 'Shapes', type: 'seed' },
  ],
  defaults: ctx => ({ amount: 3, size: 1, style: 'puffy', shade: 'white', top: 18, bottom: Math.round(ctx.horizon * 0.6), seed: 1234 }),
  // 1 rim, 2 lit, 3 body, 4 shadow, 5 deep
  ramp(p, ctx) {
    return (CLOUD[p.shade] || CLOUD.white).map(c => perMoment(ctx, c))
  },
  draw(p, ctx, m) {
    const T = new Uint8Array(N)
    const L = ctx.light[m.id]
    for (const c of cloudShapes(p)) {
      let minY = H
      let minX = 1e9
      let maxX = -1e9
      for (const q of c.parts) {
        minY = Math.min(minY, q.y - q.ry - 1)
        minX = Math.min(minX, q.x - q.rx - 1)
        maxX = Math.max(maxX, q.x + q.rx + 1)
      }
      const span = Math.max(3, c.base - minY)
      // Lit from beneath when the sun is under the cloud (sunset): the base glows.
      const below = L.y > c.base + 2
      // A smooth height field over the heap (a soft maximum of the parts), so the shading
      // flows from puff to puff with soft creases instead of folds.
      const x0 = Math.floor(minX) - 1
      const y0 = Math.floor(minY) - 1
      const bw = Math.ceil(maxX) - x0 + 2
      const bh = c.base - y0 + 2
      const Z = new Float32Array(bw * bh)
      const inside = new Uint8Array(bw * bh)
      const k = 1.6
      for (let yy = 0; yy < bh; yy++) {
        for (let xx = 0; xx < bw; xx++) {
          let sum = 0
          let any = false
          for (const q of c.parts) {
            const dx = (x0 + xx + 0.5 - q.x) / q.rx
            const dy = (y0 + yy + 0.5 - q.y) / q.ry
            const d2 = dx * dx + dy * dy
            if (d2 > 1) continue
            any = true
            sum += Math.exp((Math.sqrt(1 - d2) * q.ry) / k)
          }
          if (any && y0 + yy <= c.base) {
            inside[yy * bw + xx] = 1
            Z[yy * bw + xx] = Math.log(sum) * k
          }
        }
      }
      const z = (xx, yy) => (xx < 0 || yy < 0 || xx >= bw || yy >= bh ? 0 : Z[yy * bw + xx])
      for (let yy = 0; yy < bh; yy++) {
        const y = y0 + yy
        if (y < 0 || y >= H) continue
        for (let xx = 0; xx < bw; xx++) {
          if (!inside[yy * bw + xx]) continue
          const x = x0 + xx
          let nx = -(z(xx + 1, yy) - z(xx - 1, yy)) / 2
          let ny = -(z(xx, yy + 1) - z(xx, yy - 1)) / 2
          // The flat base faces down.
          if (y >= c.base - 1) ny = Math.max(ny, 0.8)
          const nl = Math.hypot(nx, ny, 1)
          const ld = lightDir(L, x, y)
          const diff = Math.max(0, (nx * ld[0] + ny * ld[1] + ld[2]) / nl)
          const up = clamp((c.base - y) / span, 0, 1) ** 0.75
          const vert = below ? 0.3 + 0.7 * (1 - up * 0.7) : up
          let s = 0.55 * diff + 0.45 * vert
          s += (bayer(x, y) - 0.5) * 0.08
          const v = s > 0.78 ? 1 : s > 0.6 ? 2 : s > 0.43 ? 3 : s > 0.27 ? 4 : 5
          put(T, x, y, v)
        }
      }
    }
    for (let y = 1; y < H - 1; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        if (T[i] !== 1) continue
        const l = T[y * W + ((x + W - 1) % W)]
        const r = T[y * W + ((x + 1) % W)]
        if (T[i - W] && l && r) T[i] = 2
      }
    }
    return T
  },
}

/* ---------- Ridges and hills ---------- */

function ridgeProfile(p) {
  const R = rng(p.seed)
  const hgt = new Float32Array(W)
  const rough = p.rough / 100
  if (p.style === 'mountains') {
    const n = 2 + Math.floor(R() * 2.4) + (rough > 0.6 ? 1 : 0)
    const peaks = []
    const main = Math.floor(R() * n)
    for (let k = 0; k < n; k++) {
      const px = ((k + R.range(0.2, 0.8)) / n) * W
      const ph = p.height * (k === main ? 1 : R.range(0.55, 0.9))
      peaks.push({ x: px, h: ph, sl: ph / R.range(34, 78), sr: ph / R.range(34, 78), id: k })
    }
    const own = new Int8Array(W)
    for (let x = 0; x < W; x++) {
      let best = -1e9
      let bk = 0
      for (const q of peaks) {
        const v = q.h - (x < q.x ? (q.x - x) * q.sl : (x - q.x) * q.sr)
        if (v > best) {
          best = v
          bk = q.id
        }
      }
      const floor = p.height * 0.2 + fbm(x / 40, p.seed + 5) * p.height * 0.12
      const jag = (fbm(x / 7, p.seed + 9, 3) - 0.5) * p.height * 0.16 * rough + (fbm(x / 2.5, p.seed + 13, 2) - 0.5) * 4 * rough
      hgt[x] = Math.max(floor, best) + jag
      own[x] = bk
    }
    return { hgt, peaks, own }
  }
  const f1 = (Math.PI * 2) / R.range(150, 260)
  const f2 = (Math.PI * 2) / R.range(60, 110)
  const p1 = R() * 6.28
  const p2 = R() * 6.28
  for (let x = 0; x < W; x++) {
    hgt[x] = p.height * (0.56 + 0.3 * Math.sin(x * f1 + p1) + 0.14 * Math.sin(x * f2 + p2)) + (fbm(x / 9, p.seed + 3) - 0.5) * 5 * rough
  }
  return { hgt, peaks: null, own: null }
}

const ridge = {
  label: 'Ridges and hills',
  fields: [
    { key: 'style', label: 'Shape', type: 'choice', options: [['mountains', 'Mountains'], ['hills', 'Hills']] },
    { key: 'base', label: 'Foot', type: 'range', min: 40, max: 200, step: 1, unit: 'row', hint: 'The row its foot stands on; it fills down to the bottom.' },
    { key: 'height', label: 'Height', type: 'range', min: 6, max: 160, step: 1, unit: 'rows' },
    { key: 'rough', label: 'Rough', type: 'range', min: 0, max: 100, step: 1 },
    { key: 'distance', label: 'Distance', type: 'choice', options: [[0, 'Near'], [1, 'Middle'], [2, 'Far'], [3, 'Farthest']], paint: true, hint: 'Far ridges are hazed toward the sky and lose contrast.' },
    { key: 'color', label: 'Colour by day', type: 'color', paint: true },
    { key: 'snow', label: 'Snow', type: 'choice', options: [[false, 'No'], [true, 'Snow caps']] },
    { key: 'seed', label: 'Shape', type: 'seed' },
  ],
  defaults(ctx, doc) {
    const n = doc.layers.filter(l => l.kind === 'ridge').length
    const hz = ctx.horizon
    if (n === 0) return { style: 'mountains', base: hz + 4, height: Math.round(hz * 0.5), rough: 55, distance: 2, color: '#7286a6', snow: true, seed: 311 }
    if (n === 1) return { style: 'hills', base: Math.min(196, hz + 22), height: 32, rough: 30, distance: 1, color: '#5f8a5a', snow: false, seed: 977 }
    return { style: 'hills', base: Math.min(200, hz + 44), height: 26, rough: 25, distance: 0, color: '#4f7f45', snow: false, seed: 1999 + n }
  },
  // 1 rim, 2 lit, 3 lit crease, 4 shadow, 5 deep, 6 snow lit, 7 snow shade, 8 haze lit, 9 haze shade, 10 fleck lit
  ramp(p, ctx) {
    const c = p.color
    const hz = HAZE[p.distance] || 0
    const lit = c
    const sh = shadowOf(c)
    const tones = [rimOf(c), lit, lighten(c, -0.055, 0.96), sh, deepOf(c), '#f2f6ff', '#a9b8dd', lit, sh, lighten(rimOf(c), 0.03)]
    return tones.map((t, i) => perMoment(ctx, t, i === 7 || i === 8 ? Math.min(0.85, hz + 0.16) : hz))
  },
  draw(p, ctx, m) {
    const T = new Uint8Array(N)
    const L = ctx.light[m.id]
    const { hgt, peaks, own } = ridgeProfile(p)
    const top = new Int16Array(W)
    for (let x = 0; x < W; x++) top[x] = Math.round(p.base - hgt[x])
    const hazeFrom = p.distance >= 1 ? Math.round(p.base - p.height * (p.style === 'hills' ? 0.2 : 0.16)) : 9999
    const snowLine = p.base - p.height * 0.56
    const R = rng(p.seed + 77)
    if (p.style === 'mountains') {
      // Ridge lines: from each summit down, a seeded walk splits the lit face from the shadow one.
      const lines = peaks.map(q => {
        const line = new Float32Array(H)
        let x = q.x
        const topY = Math.round(p.base - q.h)
        for (let y = 0; y < H; y++) {
          if (y > topY) {
            const r = R()
            x += r < 0.22 ? 1 : r < 0.44 ? -1 : 0
          }
          line[y] = x
        }
        return line
      })
      for (let x = 0; x < W; x++) {
        const k = own[x]
        const q = peaks[k]
        const litLeft = L.x < q.x
        const overhead = Math.abs(L.x - q.x) < 6 && L.up > 80
        const snowDepth = top[x] < snowLine ? (snowLine - top[x]) * 0.75 + (fbm(x / 3, p.seed + 31) - 0.4) * 6 : 0
        for (let y = Math.max(0, top[x]); y < H; y++) {
          const left = x < lines[k][y]
          const lit = overhead || left === litLeft
          let v = lit ? 2 : 4
          if (y === top[x] && lit) v = 1
          if (p.snow && y - top[x] < snowDepth) v = lit ? 6 : 7
          if (y >= hazeFrom) {
            const o = y - hazeFrom
            if (o >= 2 || dith(x, y, o === 0 ? 0.25 : 0.6)) v = lit ? 8 : 9
          }
          T[y * W + x] = v
        }
        // The crease along the ridge line, on its shadow side.
        for (let y = Math.max(0, top[x] + 1); y < Math.min(H, hazeFrom); y++) {
          if (Math.round(lines[k][y]) === x && T[y * W + x] !== 6) {
            const side = litLeft ? x + 1 : x - 1
            if (side >= 0 && side < W && T[y * W + side] === 4) T[y * W + side] = 5
          }
        }
      }
      // Gullies: short walks down each face, darker than the face they cut.
      const gullies = Math.round(4 + (p.rough / 100) * 10)
      for (let g = 0; g < gullies; g++) {
        let x = Math.floor(R() * W)
        let y = top[x] + 2 + Math.floor(R() * 4)
        const len = Math.round(p.height * R.range(0.15, 0.4))
        // Down the face, along its fall line: away from the summit.
        const dir = x < peaks[own[x]].x ? -1 : 1
        for (let s = 0; s < len && y < Math.min(H, hazeFrom); s++) {
          const i = y * W + x
          if (T[i] === 2) T[i] = 3
          else if (T[i] === 4) T[i] = 5
          y++
          if (R() < 0.5) x = clamp(x + dir, 0, W - 1)
        }
      }
    } else {
      // Hills: each column's slope against the light; the terminator curves with depth.
      for (let x = 0; x < W; x++) {
        const s = (hgt[Math.min(W - 1, x + 2)] - hgt[Math.max(0, x - 2)]) / 4
        const n = [-s, -1, 0.35]
        const nl = Math.hypot(...n)
        const ld = lightDir(L, x, top[x])
        const diff = (n[0] * ld[0] + n[1] * ld[1] + n[2] * ld[2]) / nl
        for (let y = Math.max(0, top[x]); y < H; y++) {
          const depth = y - top[x]
          const shade = diff - depth * 0.018 + (bayer(x, y) - 0.5) * 0.06
          let v = shade > 0.42 ? 2 : shade > 0.18 ? 3 : shade > -0.05 ? 4 : 5
          if (depth === 0 && shade > 0.2) v = 1
          if (y >= hazeFrom) {
            const o = y - hazeFrom
            if (o >= 2 || dith(x, y, o === 0 ? 0.25 : 0.6)) v = v <= 3 ? 8 : 9
          }
          T[y * W + x] = v
        }
      }
      // Bushes on nearer hills: little clumps with a lit top and a dark base.
      if (p.distance <= 1) {
        const n = p.distance === 0 ? 34 : 18
        for (let k = 0; k < n; k++) {
          const x = Math.floor(R() * W)
          const depth = 2 + Math.floor(R() ** 1.6 * Math.max(3, (H - top[x]) * 0.7))
          const y = top[x] + depth
          if (y >= Math.min(H - 1, hazeFrom)) continue
          const w = 2 + Math.floor(R() * 3)
          const litRight = L.x > x
          for (let i = 0; i < w; i++) {
            putClip(T, x + i, y, 5)
            if (i > 0 && i < w - 1 || w === 2) putClip(T, x + i, y - 1, (litRight ? i >= w / 2 : i < w / 2) ? 10 : 4)
          }
        }
      }
    }
    return T
  },
}

/* ---------- Trees ---------- */

function treeList(p) {
  const R = rng(p.seed)
  const spacing = 30 - (p.density - 1) * 2.7
  const list = []
  let x = R() * spacing
  while (x < W + 4) {
    const type = p.style === 'mixed' ? (R() < 0.5 ? 'pine' : 'round') : p.style === 'round' ? 'round' : 'pine'
    list.push({ x: Math.round(x), h: p.height * R.range(0.72, 1.22), type, s: Math.floor(R() * 1e6) })
    x += spacing * R.range(0.55, 1.35)
  }
  // Back to front: shorter (farther-looking) trees first.
  return list.sort((a, b) => a.h - b.h)
}
function groundAt(p, x) {
  return Math.round(p.base + 2.4 * Math.sin(x / 37 + p.seed) + 1.4 * Math.sin(x / 15.5 + p.seed * 0.7))
}
const trees = {
  label: 'Trees',
  fields: [
    { key: 'style', label: 'Trees', type: 'choice', options: [['pines', 'Pines'], ['round', 'Round'], ['mixed', 'Mixed']] },
    { key: 'base', label: 'Ground', type: 'range', min: 30, max: 200, step: 1, unit: 'row' },
    { key: 'height', label: 'Height', type: 'range', min: 6, max: 70, step: 1, unit: 'rows' },
    { key: 'density', label: 'Density', type: 'range', min: 1, max: 10, step: 1 },
    { key: 'distance', label: 'Distance', type: 'choice', options: [[0, 'Near'], [1, 'Middle'], [2, 'Far']], paint: true },
    { key: 'color', label: 'Leaves by day', type: 'color', paint: true },
    { key: 'ground', label: 'Ground', type: 'choice', options: [[true, 'Grass under them'], [false, 'None']] },
    { key: 'seed', label: 'Trees', type: 'seed' },
  ],
  defaults: ctx => ({ style: 'pines', base: Math.min(196, ctx.horizon + 36), height: 26, density: 6, distance: 0, color: '#3d6a3f', ground: true, seed: 5150 }),
  // 1 rim, 2 lit, 3 body, 4 shadow, 5 deep, 6 trunk lit, 7 trunk shade, 8 grass rim, 9 grass,
  // 10 grass dark, 11 cast shadow
  ramp(p, ctx) {
    const c = p.color
    const grass = hueToward(c, 110, 0.35, 0.07, 1.05)
    const tones = [rimOf(c), lighten(c, 0.05), c, shadowOf(c), deepOf(c), '#7a5a40', '#43302f', rimOf(grass), grass, lighten(shadowOf(grass, 0.7), -0.03), shadowOf(grass, 1.15)]
    const hz = [0, 0.24, 0.44][p.distance] || 0
    return tones.map(t => perMoment(ctx, t, hz))
  },
  draw(p, ctx, m) {
    const T = new Uint8Array(N)
    const L = ctx.light[m.id]
    const el = elevation(L)
    const night = m.kind === 'night'
    if (p.ground) {
      for (let x = 0; x < W; x++) {
        const g = groundAt(p, x)
        for (let y = Math.max(0, g); y < H; y++) {
          const d = y - g
          let v = d === 0 ? 8 : 9
          const far = Math.round((H - g) * 0.5)
          if (d > far || (d === far && dith(x, y, 0.5))) v = 10
          T[y * W + x] = v
        }
      }
    }
    const list = treeList(p)
    // Cast shadows first, so trunks and crowns stand over them.
    if (p.ground) {
      for (const t of list) {
        const g = groundAt(p, t.x)
        const away = L.x > t.x ? -1 : 1
        const len = Math.round(t.h * (night ? 0.45 : 0.35 + (1 - el) * 2.4))
        for (let k = 0; k <= len; k++) {
          const x = t.x + away * k
          const fade = k / Math.max(1, len)
          const rows = fade < 0.4 ? 2 : 1
          for (let r = 0; r < rows; r++) {
            const y = groundAt(p, x) + r
            if (y < 0 || y >= H || x < 0 || x >= W) continue
            if (fade > 0.66 && !dith(x, y, 0.5)) continue
            if (night && !dith(x, y, 0.75)) continue
            if (T[y * W + x] >= 8) T[y * W + x] = 11
          }
        }
        // Contact shadow at the foot.
        for (let dx = -2; dx <= 2; dx++) putClip(T, t.x + dx, g, 11)
      }
    }
    for (const t of list) {
      const g = p.ground ? groundAt(p, t.x) : p.base
      const R = rng(t.s)
      const litRight = L.x > t.x
      if (t.type === 'pine') {
        const th = Math.max(2, Math.round(t.h * 0.13))
        const crown = Math.round(t.h) - th
        const tw = t.h > 22 ? 2 : 1
        for (let y = g - th; y < g; y++) for (let i = 0; i < tw; i++) putClip(T, t.x + i - (tw > 1 ? 1 : 0), y, (tw === 1 ? litRight : i === (litRight ? 1 : 0)) ? 6 : 7)
        const tiers = crown > 24 ? 4 : crown > 14 ? 3 : 2
        const topY = g - th - crown
        for (let r = 0; r < crown; r++) {
          const y = topY + r
          const tt = r / crown
          const tier = Math.min(tiers - 1, Math.floor(tt * tiers))
          const tf = tt * tiers - tier
          const width = (0.1 + 0.9 * tt) * t.h * 0.3 * (0.42 + 0.58 * tf) + 0.6
          const jl = R() < 0.3 ? 1 : 0
          const jr = R() < 0.3 ? 1 : 0
          const x0 = Math.round(t.x - width) + jl
          const x1 = Math.round(t.x + width) - jr
          const under = tf > 0.82 && r > 2
          for (let x = x0; x <= x1; x++) {
            const sideLit = litRight ? x >= t.x : x <= t.x
            let v = sideLit ? 2 : 4
            if (under) v = sideLit ? 3 : 5
            if (!under && (litRight ? x === x1 : x === x0) && tf > 0.35) v = 1
            if (!sideLit && (litRight ? x === x0 : x === x1)) v = 5
            putClip(T, x, y, v)
          }
        }
        if (crown > 2) putClip(T, t.x, topY - 1, litRight ? 2 : 4)
      } else {
        const Rr = t.h * 0.36
        const cy = g - t.h + Rr
        const th = Math.round(t.h - Rr * 1.6)
        for (let y = g - Math.max(2, th); y < g; y++) {
          putClip(T, t.x - 1, y, litRight ? 7 : 6)
          putClip(T, t.x, y, litRight ? 6 : 7)
        }
        const puffs = []
        const np = 4 + Math.floor(R() * 3)
        for (let k = 0; k < np; k++) {
          const a = (k / np) * Math.PI * 2 + R() * 0.6
          const d = Rr * R.range(0.25, 0.55)
          puffs.push({ x: t.x + Math.cos(a) * d, y: cy + Math.sin(a) * d * 0.8, r: Rr * R.range(0.48, 0.66) })
        }
        puffs.push({ x: t.x, y: cy - Rr * 0.15, r: Rr * 0.62 })
        for (let y = Math.floor(cy - Rr * 1.4); y <= cy + Rr * 1.2; y++) {
          for (let x = Math.floor(t.x - Rr * 1.4); x <= t.x + Rr * 1.4; x++) {
            let best = null
            let bz = -1
            for (const q of puffs) {
              const dx = x + 0.5 - q.x
              const dy = y + 0.5 - q.y
              const d2 = dx * dx + dy * dy
              if (d2 > q.r * q.r) continue
              const z = Math.sqrt(q.r * q.r - d2)
              if (z > bz) {
                bz = z
                best = [dx / q.r, dy / q.r, z / q.r]
              }
            }
            if (!best) continue
            const ld = lightDir(L, x, y)
            const diff = Math.max(0, best[0] * ld[0] + best[1] * ld[1] + best[2] * ld[2])
            const low = clamp((y - cy) / Rr, -1, 1)
            let s = 0.75 * diff + 0.25 * (0.5 - low * 0.5) + (hash2(x >> 1, y, t.s) - 0.5) * 0.18
            const v = s > 0.8 ? 1 : s > 0.6 ? 2 : s > 0.42 ? 3 : s > 0.26 ? 4 : 5
            putClip(T, x, y, v)
          }
        }
      }
    }
    return T
  },
}

/* ---------- Water ---------- */

const water = {
  label: 'Water',
  fields: [
    { key: 'part', label: 'Part', type: 'choice', options: [['surface', 'Surface'], ['glints', 'Glints']], hint: 'Glints are the light on the water; give them Twinkle.' },
    { key: 'top', label: 'Shore line', type: 'range', min: 40, max: 199, step: 1, unit: 'row' },
    { key: 'color', label: 'Water by day', type: 'color', paint: true },
    { key: 'shimmer', label: 'Shimmer', type: 'range', min: 0, max: 10, step: 1 },
    { key: 'seed', label: 'Ripples', type: 'seed' },
  ],
  defaults: ctx => ({ part: 'surface', top: ctx.horizon, color: '#2f6e98', shimmer: 5, seed: 808 }),
  // surface: 1 horizon, 2 far, 3 mid, 4 deep, 5 deepest, 6 shimmer, 7 dark ripple
  // glints: 1 glint, 2 soft glint
  ramp(p, ctx) {
    if (p.part === 'glints') {
      const g = [{}, {}]
      for (const m of ctx.moments) {
        const L = ctx.light[m.id]
        const s = L.body === 'moon' ? SUN.night : SUN[m.kind] || SUN.day
        g[0][m.id] = L.body === 'moon' ? '#dfe6fb' : s.core
        g[1][m.id] = L.body === 'moon' ? '#8d9bd0' : s.glow
      }
      return g
    }
    const tones = [{}, {}, {}, {}, {}, {}, {}]
    for (const m of ctx.moments) {
      const w = relight(p.color, 'day', m.kind)
      const hz = ctx.horizonColor[m.id]
      tones[0][m.id] = mixHex(hz, w, 0.18)
      tones[1][m.id] = mixHex(ctx.skyMid[m.id], w, 0.42)
      tones[2][m.id] = mixHex(ctx.skyTop[m.id], w, 0.62)
      tones[3][m.id] = mixHex(lighten(w, -0.07), ctx.skyTop[m.id], 0.18)
      tones[4][m.id] = mixHex(lighten(w, -0.13, 0.95), '#1d2550', 0.12)
      tones[5][m.id] = mixHex(hz, '#ffffff', 0.18)
      tones[6][m.id] = lighten(w, -0.17, 0.9)
    }
    return tones
  },
  draw(p, ctx, m) {
    const T = new Uint8Array(N)
    const top = clamp(Math.round(p.top), 0, H - 1)
    const depth = H - top
    const R = rng(p.seed)
    if (p.part === 'glints') {
      const L = ctx.light[m.id]
      if (L.up < -2) return T
      const strength = L.body === 'moon' ? 0.5 : 0.8
      for (let y = top + 1; y < H; y++) {
        const t = (y - top) / depth
        const hw = 2 + t * (18 + depth * 0.25)
        for (let x = Math.floor(L.x - hw); x <= L.x + hw; x++) {
          const c = 1 - Math.abs(x - L.x) / hw
          if (c <= 0) continue
          const pr = c ** 1.6 * strength * (0.32 + 0.3 * (1 - t))
          if (hash2(x >> 1, y, p.seed) < pr) {
            const len = 1 + Math.floor(hash2(x, y, p.seed + 3) * (2 + t * 4))
            for (let k = 0; k < len; k++) putClip(T, x + k, y, c > 0.55 ? 1 : 2)
            x += len + 1
          }
        }
      }
      // A few sparkles away from the path.
      const n = 8 + p.shimmer * 3
      for (let k = 0; k < n; k++) {
        const y = top + 2 + Math.floor(R() ** 1.4 * (depth - 3))
        const x = Math.floor(R() * W)
        const len = 1 + Math.floor(R() * 3)
        for (let i = 0; i < len; i++) putClip(T, x + i, y, 2)
      }
      return T
    }
    // Bands: thin near the shore line, wide toward the viewer.
    const cuts = [0.06, 0.2, 0.42, 0.7].map(t => top + Math.round(depth * t))
    for (let y = top; y < H; y++) {
      let b = 0
      while (b < cuts.length && y >= cuts[b]) b++
      for (let x = 0; x < W; x++) {
        let v = b + 1
        const o = cuts[b] - y
        if (b < cuts.length && o === 1 && dith(x, y, 0.5)) v = b + 2
        T[y * W + x] = v
      }
    }
    // Shimmer: light dashes up high, dark ripples low, longer as they come near.
    const n = p.shimmer * 26
    for (let k = 0; k < n; k++) {
      const t = R() ** 1.15
      const y = top + 1 + Math.floor(t * (depth - 2))
      const x = Math.floor(R() * W)
      const len = 2 + Math.floor(R() * (2 + t * 9))
      const dark = t > 0.45 && R() < 0.6
      for (let i = 0; i < len; i++) put(T, x + i, y, dark ? 7 : t < 0.5 ? 6 : 1 + Math.min(1, Math.floor(R() * 2)))
    }
    return T
  },
}

export const GENS = { sky, sun: sunGen, stars, clouds, ridge, trees, water }

/* ---------- Running a generator into a layer ---------- */

export function genDefaults(kind, doc) {
  const ctx = lightContext(doc)
  const d = GENS[kind].defaults(ctx, doc)
  if (kind === 'sun') {
    d.pos = {}
    for (const m of ctx.moments) {
      const p = defaultPos(m.kind, ctx.horizon)
      d.pos[m.id] = { x: p.x, up: p.up }
    }
  }
  return d
}

// Draw a generator layer (on a draft project) for every moment and give its tones slots.
// force: set the slots' colours from the generator (its colours changed, or it is new);
// otherwise only colours a slot is missing are filled in, so palette edits survive.
export function runGen(doc, layer, { force = false } = {}) {
  const G = GENS[layer.kind]
  if (!G || !layer.gen) return
  const ctx = lightContext(doc)
  const ramp = G.ramp(layer.gen, ctx)
  const per = {}
  let first = null
  let same = true
  for (const m of ctx.moments) {
    const T = G.lightFree && first ? first : G.draw(layer.gen, ctx, m)
    if (first && T !== first) {
      for (let i = 0; i < N; i++) {
        if (T[i] !== first[i]) {
          same = false
          break
        }
      }
    }
    if (!first) first = T
    per[m.id] = T
  }
  // Slots: reuse this layer's own, copy one another layer also uses before recolouring it.
  const usage = slotUsage(doc, layer.id)
  const old = (layer.gen.slots || []).filter(s => s > 0 && s <= doc.palette.length)
  const slots = []
  for (let i = 0; i < ramp.length; i++) {
    let s = old[i]
    if (!s) s = addSlot(doc, ramp[i])
    else if (force) {
      if (usage[s] > 0) s = addSlot(doc, ramp[i])
      else setSlotColors(doc, s, ramp[i])
    } else {
      const have = doc.palette[s - 1].colors
      const missing = {}
      for (const [k, v] of Object.entries(ramp[i])) if (!have[k]) missing[k] = v
      if (Object.keys(missing).length) setSlotColors(doc, s, missing)
    }
    slots.push(s)
  }
  const toCells = T => {
    const out = new Uint16Array(N)
    for (let i = 0; i < N; i++) out[i] = T[i] ? slots[T[i] - 1] || 0 : 0
    return out
  }
  if (same) {
    layer.cells = toCells(first)
    layer.byMoment = null
  } else {
    layer.byMoment = {}
    for (const m of ctx.moments) layer.byMoment[m.id] = toCells(per[m.id])
    layer.cells = layer.byMoment[ctx.moments[0].id]
  }
  layer.gen = { ...layer.gen, slots }
  // Slots this generator no longer uses, and nobody else does, go.
  const drop = new Set(old.filter(s => !slots.includes(s)))
  if (drop.size) {
    const u = slotUsage(doc)
    for (const s of [...drop]) if (u[s] > 0) drop.delete(s)
    removeSlots(doc, drop)
  }
}

// After the light, the sky or the moments change, draw again every generator that uses them.
export function rerunAll(doc, { except, force = false, lightOnly = false } = {}) {
  for (const l of doc.layers) {
    if (!l.gen || !GENS[l.kind] || l.id === except) continue
    if (lightOnly && GENS[l.kind].lightFree) continue
    runGen(doc, l, { force })
  }
}

// A layer that keeps its pixels and loses its generator.
export function toPaint(layer) {
  layer.kind = 'paint'
  layer.gen = null
}

export { writable }
