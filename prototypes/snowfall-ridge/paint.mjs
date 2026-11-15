// The painters of Snowfall Ridge: a mountain ridge, spruce forest, a cabin and snow, on the
// 320 x 200 cell grid (x right, y down). Every painter takes the moment's palette P.
import { bayer, clamp, hex, lerp, rgb, rng, smooth, tone } from '../../../sunfield/tools/pixel.mjs'
import { Layer, W } from './lib.mjs'

export { bayer, clamp, lerp, rng, smooth, tone }

// ------------------------------------------------------------------ helpers
export function mix(a, b, t) {
  const x = rgb(a)
  const y = rgb(b)
  return hex([lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)])
}

// Value noise in 0..1.
export function noise1(seed) {
  const r = rng(seed)
  const t = Array.from({ length: 512 }, r)
  return x => {
    const i = Math.floor(x)
    const f = x - i
    const s = f * f * (3 - 2 * f)
    return t[i & 511] + (t[(i + 1) & 511] - t[i & 511]) * s
  }
}
export function noise2(seed) {
  const r = rng(seed)
  const t = Array.from({ length: 1024 }, r)
  const h = (i, j) => t[(((i * 374761393) ^ (j * 668265263)) >>> 0) % 1024]
  return (x, y) => {
    const i = Math.floor(x)
    const j = Math.floor(y)
    const fx = x - i
    const fy = y - j
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    const a = h(i, j) + (h(i + 1, j) - h(i, j)) * sx
    const b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * sx
    return a + (b - a) * sy
  }
}

export const at = k => [(k % 4096) - 1000, Math.floor(k / 4096) - 1000]

// Copies a layer's cells moved by (dx, dy) into another.
export function blit(dst, src, dx = 0, dy = 0) {
  for (const [k, c] of src.m) {
    const [x, y] = at(k)
    dst.set(x + dx, y + dy, c)
  }
}

// ------------------------------------------------------------------ sky
export function skyAt(stops, y) {
  for (let i = 0; i < stops.length - 1; i++) {
    const [ya, ca] = stops[i]
    const [yb, cb] = stops[i + 1]
    if (y <= yb) return mix(ca, cb, clamp((y - ya) / (yb - ya), 0, 1))
  }
  return stops[stops.length - 1][1]
}

// Bands four cells tall, each drawn a cell taller under the next (Sunfield's sky).
export function sky(P) {
  let out = '<g stroke-width="5">'
  let last = null
  let d = ''
  const flush = () => {
    if (last) out += '<path stroke="' + last + '" d="' + d + '"/>'
  }
  for (let y = -40; y < 240; y += 4) {
    const c = skyAt(P.sky, y + 2)
    if (c !== last) {
      flush()
      last = c
      d = ''
    }
    d += 'M-400 ' + (y + 2) + 'h1120'
  }
  flush()
  return out + '</g>'
}

// A glow: nested stepped ellipses, each a filled outline over the last.
export function glow(g) {
  let out = ''
  g.colors.forEach((c, i) => {
    const k = 1 - i / g.colors.length
    const rx = g.rx * k
    const ry = g.ry * k
    const rows = []
    for (let y = Math.floor(g.y - ry); y <= Math.ceil(g.y + ry); y++) {
      const t = (y + 0.5 - g.y) / ry
      if (Math.abs(t) >= 1) continue
      const hw = Math.round(rx * Math.sqrt(1 - t * t))
      if (hw > 0) rows.push([y, hw])
    }
    if (!rows.length) return
    const cx = Math.round(g.x)
    let d = 'M' + (cx - rows[0][1]) + ' ' + (rows[0][0] - 0.5) + 'h' + rows[0][1] * 2
    let prev = rows[0][1]
    // Rows of one width share one vertical step (v3, not v1v1v1): the same outline, shorter.
    let v = 0
    const step = () => {
      if (v) d += 'v' + v
      v = 0
    }
    for (const [, hw] of rows) {
      if (hw !== prev) {
        step()
        d += 'h' + (hw - prev)
      }
      v++
      prev = hw
    }
    step()
    d += 'h' + -prev * 2
    for (let i = rows.length - 1; i >= 0; i--) {
      const hw = rows[i][1]
      if (hw !== prev) {
        step()
        d += 'h' + (prev - hw)
      }
      v--
      prev = hw
    }
    step()
    const op = Array.isArray(g.opacity) ? g.opacity[i] : g.opacity
    out += '<path fill="' + c + '" d="' + d + 'z"' + (op ? ' fill-opacity="' + op + '"' : '') + '/>'
  })
  return out
}

// A flat cloud: a union of long lozenges, its underside lit (or its top, by `litTop`), the
// ends broken into single cells.
export function cloud(L, c, T) {
  const r = rng(c.seed)
  const puffs = c.puffs
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const p of puffs) {
    x0 = Math.min(x0, p.x - p.rx); x1 = Math.max(x1, p.x + p.rx)
    y0 = Math.min(y0, p.y - p.ry); y1 = Math.max(y1, p.y + p.ry)
  }
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
      let best = -1
      let low = -Infinity
      for (const p of puffs) {
        const dx = (x + 0.5 - p.x) / p.rx
        const dy = (y + 0.5 - p.y) / p.ry
        const d = dx * dx + dy * dy
        if (d < 1) {
          best = Math.max(best, 1 - d)
          low = Math.max(low, (y + 0.5 - p.y) / p.ry)
        }
      }
      if (best < 0) continue
      if (best < 0.12 && (x + y) % 2) continue
      const below = !puffs.some(p => ((x + 0.5 - p.x) / p.rx) ** 2 + ((y + 1.5 - p.y) / p.ry) ** 2 < 1)
      const above = !puffs.some(p => ((x + 0.5 - p.x) / p.rx) ** 2 + ((y - 0.5 - p.y) / p.ry) ** 2 < 1)
      let k = low > 0.2 ? 2 : low > -0.45 ? 1 : 0
      if (below) k = 3
      if (above) k = c.litTop ? 3 : 0
      L.set(x, y, T[Math.min(k, T.length - 1)])
    }
  }
}

// Cells inside angular wedges from a point, as [{ cells, opacity }] by distance, for rays.
export function rays(o) {
  const out = o.steps.map(s => ({ opacity: s[1], cells: [] }))
  for (let y = o.y0; y < o.y1; y++) {
    for (let x = -10; x < W + 10; x++) {
      if (o.keep && !o.keep(x, y)) continue
      const dx = x + 0.5 - o.x
      const dy = y + 0.5 - o.y
      const a = (Math.atan2(dy, dx) * 180) / Math.PI
      const d = Math.hypot(dx, dy)
      if (!o.wedges.some(([a0, a1]) => a >= a0 && a < a1)) continue
      const i = o.steps.findIndex(s => d < s[0])
      if (i >= 0) out[i].cells.push([x, y])
    }
  }
  return out
}

// ------------------------------------------------------------------ mountains
// A massif as a set of peaks, each a pyramid with jagged flanks; the nearest peak that covers
// a cell paints it. Straight spurs fan from each summit; the main spur splits the sunlit face
// (left) from the shaded one, and between spurs each facet has a side turned to the light and
// a side turned away, with rock in the gullies. A rim of light runs along every crest.
export function massif(L, peaks, o) {
  const T = o.tones
  const seed = o.seed ?? 5
  const jag = noise1(seed)
  const jag2 = noise1(seed + 1)
  const wob = noise1(seed + 2)
  const rockN = noise2(seed + 3)
  const edgeN = noise2(seed + 4)
  const base = o.base ?? 130
  peaks.forEach((p, i) => {
    const r = rng(seed * 31 + i * 7 + 1)
    const ribs = [{ u: p.spur, main: true }]
    for (let u = p.spur; u > -2.5; ) ribs.unshift({ u: (u -= (p.gap ?? 0.16) + r() * (p.gapR ?? 0.3)) })
    for (let u = p.spur; u < 2.5; ) ribs.push({ u: (u += (p.gap ?? 0.16) + r() * (p.gapR ?? 0.3)) })
    for (const rb of ribs) {
      rb.c = rb.main ? p.spurBend ?? 0.1 : (r() - 0.5) * 0.5
      rb.s = 0.3 + r() * 0.4
    }
    p._ribs = ribs
  })
  const top = (p, x) => {
    const dx = x + 0.5 - p.x
    const k = dx < 0 ? p.kl : p.kr
    const a = Math.abs(dx)
    let t = p.y + a * k * (1 - (p.ease ?? 0.3) * smooth(a / (p.w ?? 80)))
    t += ((jag(x * 0.29 + p.x) - 0.5) * 3 + (jag2(x * 0.9 + p.x) - 0.5) * 1.4) * (p.rough ?? 1) * smooth(a / 5)
    return t
  }
  const owner = new Map()
  for (let x = -12; x < W + 12; x++) {
    const tops = peaks.map(p => top(p, x))
    for (let y = Math.floor(Math.min(...tops)); y < base; y++) {
      let best = -1
      for (let i = 0; i < peaks.length; i++) if (y + 0.5 >= tops[i] && (best < 0 || peaks[i].z > peaks[best].z)) best = i
      if (best >= 0) owner.set(x + ',' + y, best)
    }
  }
  for (const [k, i] of owner) {
    const [x, y] = k.split(',').map(Number)
    const p = peaks[i]
    const dy = y + 0.5 - p.y
    const dx = x + 0.5 - p.x
    const ribAt = rb => rb.u + rb.c * (dy / 50)
    const u = dx / (dy + 4) + (edgeN(x * 0.25, y * 0.25) - 0.5) * 0.06
    const ribs = p._ribs
    let j = 0
    while (j < ribs.length - 2 && ribAt(ribs[j + 1]) <= u) j++
    const ua = ribAt(ribs[j])
    const ub = ribAt(ribs[j + 1])
    const f = clamp((u - ua) / (ub - ua), 0, 1)
    const west = f < ribs[j].s
    const main = ribs.find(rb => rb.main)
    const lit = u < ribAt(main)
    let v = lit ? (west ? 0.9 : 0.66) : west ? 0.42 : 0.18
    v += 0.06 * (1 - smooth(dy / 40))
    // The sun's line: below it the lit face falls into shadow (alpenglow on the tops only).
    if (lit && o.litLine !== undefined) {
      const ll = o.litLine + (wob(x * 0.06 + 90) - 0.5) * 14
      if (y > ll + (edgeN(x * 0.5, y * 0.5) - 0.5) * 6) v -= 0.42
    }
    const rocky = !west && dy > 5 && rockN(x * 0.22, y * 0.1) > (lit ? 0.64 : 0.5) - 0.1 * smooth((dy - 8) / 30)
    const above = owner.get(x + ',' + (y - 1))
    const crest = above === undefined || above !== i
    // The arête: a lit edge down the main spur, near the summit.
    const xs = p.x + ribAt(main) * (dy + 4)
    const arete = lit && dy < (p.areteLen ?? 26) && x + 0.5 > xs - 1.2
    let c
    const sunny = v >= 0.5
    if (rocky) c = tone(sunny ? T.rockLit : T.rockShade, (v % 0.5) * 2, x, y, 0)
    else c = tone(sunny ? T.lit : T.shade, sunny ? (v - 0.5) * 2 : v * 2, x, y, 0)
    if (crest && dy > 0.5) c = lit && sunny ? T.rim : T.rimShade
    else if (arete && sunny) c = T.rim
    const hz = (o.haze ?? 0) + (o.footHaze ?? 0) * smooth((y - (base - (o.footH ?? 22))) / (o.footH ?? 22))
    if (hz > 0.05) {
      const q = clamp(Math.round((hz + (edgeN(x * 0.3, y * 0.6) - 0.5) * 0.5) * 3) / 3, 0, 1)
      if (q > 0) c = mix(c, o.hazeColor, q * 0.8)
    }
    L.set(x, y, c)
  }
  return owner
}

// ------------------------------------------------------------------ spruce
// A snow-laden spruce: tiers of branches hanging from the trunk, each a wedge that slopes
// down and droops at the tip, the lower ones longer. Snow lies along each tier's upper face,
// lit on the left; the needles darken toward each tier's underside; the tips on the left
// catch a rim of light.
export function spruce(L, o, P) {
  const T = o.tones ?? P.tree
  const r = rng(o.seed)
  const bump = noise1(o.seed + 5)
  const h = o.h
  const top = o.base - h
  const cx = Math.round(o.x)
  const step = o.tier ?? clamp(h / 9, 3.6, 8)
  const n = Math.max(3, Math.round((h * 0.86) / step))
  const half = o.w ?? h * 0.34
  const slope = o.slope ?? 0.42
  const tiers = []
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / n
    tiers.push({
      a: top + 1 + (i / n) * h * 0.86 + (r() - 0.5) * 1.2,
      lenL: 1.5 + half * Math.pow(t, 0.85) * (0.78 + r() * 0.44) * (r() < 0.15 ? 0.72 : 1),
      lenR: 1.5 + half * Math.pow(t, 0.85) * (0.78 + r() * 0.44) * (r() < 0.15 ? 0.72 : 1),
      thick: 1 + step * (0.7 + 0.5 * t) * (o.thick ?? 1),
      droop: 0.8 + r() * 1.4 + step * 0.25,
    })
  }
  const cells = new Map()
  for (let i = n - 1; i >= 0; i--) {
    const tr = tiers[i]
    const lean = Math.round(((o.lean ?? 0) * (o.base - tr.a)) / h)
    for (const side of [-1, 1]) {
      const len = side < 0 ? tr.lenL : tr.lenR
      for (let d = 0; d < len; d++) {
        const q = (d + 0.5) / len
        // The branch rises steeply off the trunk, sags along its length, droops at the tip.
        const yTop = tr.a + len * slope * Math.pow(q, 0.75) + tr.droop * Math.pow(q, 4)
        const th = 0.8 + tr.thick * Math.pow(1 - q, 0.55) * (0.75 + 0.25 * Math.sin(Math.PI * q))
        const x = (side < 0 ? cx - 1 - d : cx + d) + lean
        const y0 = Math.round(yTop)
        const y1 = Math.round(yTop + th)
        // Snow: a pillow along the top, deeper in the middle of the branch, lumpy.
        const deep = q > 0.92 ? 0 : 1 + (q > 0.2 && q < 0.75 && bump(d * 0.6 + i * 3.1) > 0.45 ? 1 : 0) + (step > 5 && q > 0.3 && q < 0.6 && bump(d * 0.5 + i * 7) > 0.62 ? 1 : 0)
        for (let y = y0; y <= y1; y++) cells.set(x + ',' + y, { i, side, q, row: y - y0, rows: y1 - y0, deep: (o.snow ?? 1) > 0 ? deep : 0 })
      }
    }
  }
  // The spire.
  for (let y = top - 2; y < top + 2; y++) cells.set(cx + ',' + y, { i: 0, side: 1, q: 0, row: y - top + 2, rows: 4, deep: y === top - 2 ? 1 : 0 })
  // Trunk under the bottom tier.
  const tw = o.trunk ?? (h > 50 ? 2 : 1)
  for (let y = Math.round(tiers[n - 1].a); y < o.base + 3; y++) for (let k = 0; k < tw; k++) if (!cells.has(cx - (tw > 1 ? 1 : 0) + k + ',' + y)) L.set(cx - (tw > 1 ? 1 : 0) + k, y, P.trunk)
  for (const [k, c] of cells) {
    const [x, y] = k.split(',').map(Number)
    let col
    if (c.row < c.deep) {
      // Snow, lit on the left; the second row a step darker.
      const v = (c.side < 0 ? 0.85 : 0.5) - c.row * 0.3 - c.q * 0.12
      col = c.side < 0 && c.q > 0.15 ? tone(T.snowLit, v, x, y, 0) : tone(T.snow, v + 0.1, x, y, 0)
    } else {
      // Needles: lighter just under the snow, darkest at the underside.
      const under = (c.row - c.deep) / Math.max(1, c.rows - c.deep)
      let v = under < 0.34 ? 0.55 : under < 0.75 ? 0.32 : 0.1
      if (c.side > 0) v -= 0.18
      if (c.side < 0 && c.q > 0.78 && under < 0.6) v = 0.8
      col = tone(T.needle, v, x, y, 0)
    }
    L.set(x, y, col)
  }
  return cells
}

// ------------------------------------------------------------------ the forest at the foot
export function forestBand(L, o) {
  const r = rng(o.seed)
  const n = noise1(o.seed + 3)
  const T = o.tones
  const tops = new Array(W + 40).fill(Infinity)
  for (let x = -20; x < W + 20; ) {
    const h = o.h[0] + r() * (o.h[1] - o.h[0])
    const yb = o.y + (n(x * 0.04) - 0.5) * o.wave
    const w = h * (0.3 + r() * 0.08)
    for (let dx = -Math.ceil(w); dx <= Math.ceil(w); dx++) {
      const t = yb - h + (Math.abs(dx) / w) * h * 0.95
      const ix = Math.round(x + dx) + 20
      if (ix >= 0 && ix < tops.length) tops[ix] = Math.min(tops[ix], t)
    }
    x += o.gap[0] + r() * (o.gap[1] - o.gap[0])
  }
  for (let ix = 1; ix < tops.length; ix++) {
    const xx = ix - 20
    if (!isFinite(tops[ix])) continue
    const t0 = Math.round(tops[ix])
    const leftOpen = Math.round(tops[ix - 1]) > t0
    for (let y = t0; y < o.bottom; y++) {
      let c
      if (y === t0 && r() < o.snowTop) c = T.snow[leftOpen ? 1 : 0]
      else if (leftOpen && y < t0 + 3) c = T.tree[2]
      else c = T.tree[0]
      L.set(xx, y, c)
    }
  }
}

// ------------------------------------------------------------------ snow on the ground
// Flat bands of snow, darker toward the viewer, with drift lines: a lit crest and a shadow
// under it, wandering across.
export function snowfield(L, o) {
  const T = o.tones
  for (let y = o.top; y < o.bottom; y++) {
    const t = (y - o.top) / (o.bottom - o.top)
    for (let x = -12; x < W + 12; x++) {
      if (o.edge && y < o.edge(x)) continue
      let v = lerp(o.v0, o.v1, t)
      if (o.relief) {
        // Drifts: long low waves, wider as they come nearer, lit on their far faces.
        const period = (o.period?.[0] ?? 3.5) + (y - o.top) * (o.period?.[1] ?? 0.22)
        const ph = (y + o.wav(x)) / period
        v += o.relief * Math.sin(ph * Math.PI * 2)
      }
      L.set(x, y, tone(T, v, x, y, 0))
    }
  }
  for (const d of o.drifts ?? []) {
    for (let x = d.x0; x < d.x1; x++) {
      const y = Math.round(d.y + d.a * Math.sin(x * d.f + d.p) + d.b * Math.sin(x * d.f * 2.7 + d.p * 2))
      const fade = Math.min(x - d.x0, d.x1 - x)
      if (fade < 4 && (x + y) % 2) continue
      if (!L.has(x, y)) continue
      L.set(x, y, T[d.hi])
      if (d.lo !== undefined && L.has(x, y + 1)) L.set(x, y + 1, T[d.lo])
    }
  }
}

// ------------------------------------------------------------------ the creek
// Open water winding through the snow toward the viewer: it shows the sky above it, higher
// and darker as it comes nearer. The far bank's lip is lit, the near one in shadow.
export function creek(L, o, P) {
  const pts = o.path
  const r = rng(o.seed ?? 7)
  const xAt = y => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]
      const [x1, y1] = pts[i + 1]
      if (y <= y1) return lerp(x0, x1, smooth((y - y0) / (y1 - y0)))
    }
    return pts[pts.length - 1][0]
  }
  const Wt = P.water
  const glints = []
  for (let y = pts[0][1]; y < 201; y++) {
    const t = (y - pts[0][1]) / (200 - pts[0][1])
    const w = o.w0 + (o.w1 - o.w0) * t
    const cx = xAt(y)
    const x0 = Math.round(cx - w / 2)
    const x1 = Math.round(cx + w / 2)
    // Far off it mirrors the bright sky low down; near by, the darker sky overhead.
    const base = t < 0.25 ? Wt.water[2] : t < 0.55 ? Wt.water[1] : Wt.water[0]
    for (let x = x0; x <= x1; x++) L.set(x, y, base)
    // Streaks of the glow on the water, a few cells long.
    if (x1 - x0 >= 3 && r() < 0.5) {
      const gx = x0 + 1 + Math.floor(r() * (x1 - x0 - 2))
      const gl = 1 + Math.floor(r() * Math.min(4, x1 - gx))
      for (let k = 0; k < gl; k++) {
        L.set(gx + k, y, Wt.glint[k === 0 || k === gl - 1 ? 0 : 1])
        glints.push([gx + k, y])
      }
    }
    // Ice along both banks; the far bank's snow lip lit, the near one in shadow.
    L.set(x0, y, Wt.ice[1])
    L.set(x1, y, Wt.ice[0])
    if (t > 0.3 && r() < 0.35) L.set(x0 + 1, y, Wt.ice[1])
    L.set(x0 - 1, y, Wt.lipLit)
    L.set(x1 + 1, y, Wt.lipShade)
  }
  return glints
}

// Fills a cell set's colours from a quantized list: each value v in 0..1 to the nearest tone.
export function quant(list, c) {
  let best = list[0]
  let bd = Infinity
  const a = rgb(c)
  for (const t of list) {
    const b = rgb(t)
    const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
    if (d < bd) {
      bd = d
      best = t
    }
  }
  return best
}

// ------------------------------------------------------------------ sprites
export function sprite(L, x0, y0, rows, map) {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const c = map[row[i]]
      if (c) L.set(x0 + i, y0 + j, c)
    }
  })
}

export function line(x0, y0, x1, y1) {
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
