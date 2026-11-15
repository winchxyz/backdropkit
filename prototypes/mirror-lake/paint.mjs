// Mirror Lake's painters: cumulus, snow-streaked mountains, conifer ridges and the far shore,
// all on the 320 x 200 cell grid (x right, y down). Every tone list runs dark to light.
import { Layer, bayer, clamp, lerp, smooth, tone } from '../../../sunfield/tools/pixel.mjs'
import { fbm, hash, mix, noise } from './lib.mjs'

const norm = v => {
  const l = Math.hypot(...v)
  return v.map(c => c / l)
}

// y of a polyline [[x, y], ...] at x, flat beyond its ends.
export function polyY(pts, x) {
  if (x <= pts[0][0]) return pts[0][1]
  for (let i = 0; i < pts.length - 1; i++) {
    const [xa, ya] = pts[i]
    const [xb, yb] = pts[i + 1]
    if (x <= xb) return lerp(ya, yb, (x - xa) / (xb - xa))
  }
  return pts[pts.length - 1][1]
}

// Distance from (x, y) to a polyline, and how far along it (0..1 of its length) the nearest point lies.
function polyDist(pts, x, y) {
  let best = Infinity
  let at = 0
  let run = 0
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[i + 1]
    const dx = bx - ax
    const dy = by - ay
    const l2 = dx * dx + dy * dy
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1)
    const d = Math.hypot(x - ax - t * dx, y - ay - t * dy)
    const len = Math.sqrt(l2)
    if (d < best) {
      best = d
      at = (run + t * len) / total
    }
    run += len
  }
  return [best, at]
}

// A palette pushed into the air: f = 0 none, 1 all haze.
export const hazed = (pal, colour, f) => pal.map(c => mix(c, colour, f))

// ---------------------------------------------------------------- clouds

// A cumulus: a union of spheres lit by `light`, with a shaded flat base (Sunfield's cloud, with a
// lit rim on the side that faces the light).
export function cumulus(L, puffs, o) {
  const tones = o.tones
  const lv = norm(o.light)
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const p of puffs) {
    x0 = Math.min(x0, p.x - p.r)
    x1 = Math.max(x1, p.x + p.r)
    y0 = Math.min(y0, p.y - p.r / (p.sy ?? 1))
    y1 = Math.max(y1, p.y + p.r / (p.sy ?? 1))
  }
  const base = o.base ?? y1
  const top = y0
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
      const px = x + 0.5
      const py = y + 0.5
      if (py > base + Math.sin(x * 0.7 + (o.seed ?? 0)) * 0.7 + Math.sin(x * 0.23) * 1.1) continue
      let best = null
      let bz = -Infinity
      let z2 = -Infinity
      for (const p of puffs) {
        const sy = p.sy ?? 1
        const dx = px - p.x
        const dy = (py - p.y) * sy
        const d2 = dx * dx + dy * dy
        const r2 = p.r * p.r
        if (d2 >= r2) continue
        const nz = Math.sqrt(r2 - d2)
        const z = nz + (p.z ?? 0)
        if (z > bz) {
          z2 = bz
          bz = z
          best = { p, dx, dy, nz }
        } else if (z > z2) z2 = z
      }
      if (!best) continue
      const { p, dx, dy, nz } = best
      const n = [dx / p.r, dy / p.r, nz / p.r]
      const facing = n[0] * lv[0] + n[1] * lv[1] + n[2] * lv[2]
      let v = (o.bright ?? 0.6) + 0.5 * facing
      v -= 0.2 * Math.pow(1 - n[2], 2)
      if (bz - z2 < 1.6 && dy > -p.r * 0.2) v -= o.crease ?? 0.18
      const shadeH = o.shadeH ?? 8
      v -= (o.baseShade ?? 0.4) * smooth((py - (base - shadeH)) / shadeH)
      v += (o.topLift ?? 0.06) * (1 - smooth((py - top) / ((base - top) * 0.5 + 1)))
      // The rim that faces the light, where the sphere turns away from us.
      if (o.rim && n[2] < 0.45 && facing > 0.15) v += o.rim
      L.set(x, y, tone(tones, v, x, y, o.dither ?? 0.3))
    }
  }
  return L
}

// Billows on the upper rim of each main puff.
export function billow(puffs, rand, o = {}) {
  const out = [...puffs]
  for (const p of puffs) {
    const n = o.count ?? Math.max(2, Math.round(p.r / 3))
    for (let i = 0; i < n; i++) {
      const a = -Math.PI * (0.15 + 0.7 * rand()) - (o.lean ?? 0.15)
      const rr = p.r * (0.28 + 0.22 * rand())
      const dist = p.r - rr * (0.35 + 0.3 * rand())
      out.push({ x: p.x + Math.cos(a) * dist, y: p.y + (Math.sin(a) * dist) / (p.sy ?? 1), r: rr, z: p.r * 0.35, sy: p.sy })
    }
  }
  return out
}

// ---------------------------------------------------------------- mountains

// A mountain mass. Its outline follows `ridge` (with a jagged edge); its face is a height field:
// the face leans toward us below the crest and to the side its crest falls to, spurs stand out
// along `spurs` (lit on the side toward the light), and ribs and gullies radiate from the
// summits. Snow lies above the snowline except on the ribs, and in the gullies below it.
// m: { ridge, peaks: [[x, y]], spurs: [{ pts, w, h }], x0, x1, bottom, snow, snowDrop, seed, jag }
// o: { light, rock: [], snow: [], rim, rimSnow, glow: (x, y) => 0..1 lit share (alpenglow),
//      lit: { rock: [], snow: [] } (the glow's palettes), haze: (y) => 0..1 }
export function mountain(L, m, o) {
  const lv = norm(o.light)
  const seed = m.seed
  const jag = m.jag ?? 1.6
  const topS = x => polyY(m.ridge, x)
  const top = x => Math.round(topS(x) + jag * fbm(x * 0.32, 0.5, seed) * 2 + 0.6 * (hash(x, 1, seed) - 0.5))
  const slope = x => (topS(x + 3) - topS(x - 3)) / 6
  // Ribs and gullies radiating from the summits, blended between them so no seam shows.
  const ribF = m.ribs ?? 6
  const radial = (x, y) => {
    let sum = 0
    let wsum = 0
    for (const [i, p] of m.peaks.entries()) {
      const r = Math.hypot(x - p[0], y - p[1]) + 1
      const w = Math.exp(-Math.abs(x - p[0]) / 14 - Math.max(0, p[1] - y) / 6)
      const th = Math.atan2(x - p[0], (y - p[1]) * 1.1 + 4)
      const n1 = noise(th * ribF + 10 + i * 31, r * 0.045, seed + 3)
      const n2 = noise(th * ribF * 2.3 + 3 + i * 17, r * 0.08, seed + 4)
      // Narrow gullies (the sharp valleys of ridged noise) between broad ribs.
      const g = Math.pow(Math.abs(2 * n1 - 1), 0.6) * 0.75 + Math.pow(Math.abs(2 * n2 - 1), 0.6) * 0.25
      sum += g * w
      wsum += w
    }
    return wsum ? sum / wsum : 0.5
  }
  const spurAt = (x, y) => {
    let v = 0
    for (const s of m.spurs) {
      const [d, at] = polyDist(s.pts, x, y)
      const w = s.w * (0.7 + 0.6 * at)
      if (d < w) v = Math.max(v, s.h * (1 - d / w))
    }
    return v
  }
  const relief = (x, y) => spurAt(x, y) + (m.ribH ?? 3) * radial(x, y) * smooth((y - topS(x)) / 6)
  // The face below the crest leans toward us and to the side its crest falls to.
  const z = (x, y) => (y - topS(x)) * 0.5 + relief(x, y)
  for (let x = m.x0; x < m.x1; x++) {
    const t = top(x)
    for (let y = t; y < m.bottom; y++) {
      const cx = x + 0.5
      const cy = y + 0.5
      const gx = z(cx + 0.5, cy) - z(cx - 0.5, cy) - slope(x) * (m.turn ?? 0.6)
      const gy = z(cx, cy + 0.5) - z(cx, cy - 0.5)
      const n = norm([-gx, -gy, m.flat ?? 0.8])
      const facing = n[0] * lv[0] + n[1] * lv[1] + n[2] * lv[2]
      const depth = y - t
      const rad = radial(cx, cy)
      const sp = spurAt(cx, cy)
      // How much of a ridge (1) or a gully (0) the cell lies on.
      const ridge = clamp(rad * 0.7 + (sp / 4) * 0.5, 0, 1)
      const line0 = m.snow + 7 * fbm(x * 0.06, 0, seed + 11)
      // Snow: its line runs lower down the gullies and higher on the ribs, ragged; thin streaks
      // run on down the narrowest gullies.
      const line = line0 + (m.snowDrop ?? 22) * (1 - ridge) * (1 - ridge) - 9 * ridge + 3 * fbm(x * 0.4, y * 0.3, seed + 13)
      let snow = y < line
      if (!snow && rad < 0.16 && y < line0 + (m.streak ?? 30) * (0.5 + noise(x * 0.3, 2, seed + 17))) snow = true
      // Steep ribs high up stay bare in streaks.
      if (snow && ridge > 0.82 && depth > 2 && hash(x >> 1, y >> 2, seed) < 0.5) snow = false
      if (o.noSnowBelow && y > o.noSnowBelow) snow = false
      const lit = o.glow ? o.glow(x, y) > 0.5 : false
      const pal = snow ? (lit ? o.lit.snow : o.snow) : lit ? o.lit.rock : o.rock
      let v
      if (snow) v = 0.05 + 1.0 * facing - 0.08 * (1 - ridge)
      else {
        v = 0.08 + 0.88 * facing
        v -= 0.12 * (1 - ridge) * smooth(depth / 8)
        // Gullies cut dark lines into the rock; spur crests catch the light.
        if (rad < 0.1 && depth > 3) v -= 0.2
        if (sp > 0 && spurAt(cx - 1, cy) < sp && facing > 0.55) v += 0.08
        // Bands of strata across the faces.
        if (noise(x * 0.12, y * 0.9 + x * 0.25, seed + 21) > 0.75) v -= 0.1
      }
      v += 0.04 * fbm(x * 0.35, y * 0.2, seed + 5)
      let c = tone(pal, v, x, y, 0.16)
      if (depth === 0 && slope(x) * -lv[0] > -0.1) c = snow ? (lit ? o.lit.rimSnow : o.rimSnow) : lit ? o.lit.rim : o.rim
      // Haze at the foot of the mass, in three steps, dithered in rows like drifting mist.
      const hz = o.haze ? o.haze(y) : 0
      if (hz > 0) {
        const k = clamp(Math.floor(hz * 3 + 0.9 * fbm(x * 0.07, y * 0.12, seed + 23) + 0.5), 0, 3)
        if (k) c = mix(c, o.hazeColour, k * 0.2)
      }
      L.set(x, y, c)
    }
  }
  return top
}

// ---------------------------------------------------------------- conifer slopes

// A ridge clad in conifers: tiers of tree tips down from the crest, each tree lit on the side
// toward the light, the upper tiers paler in the haze. m: { ridge, x0, x1, bottom, seed,
// spacing, tier, height }; pals: an array of tone lists, from the hazy back to the near front.
export function forest(L, m, o) {
  const rand = (i, k) => hash(i, k, m.seed)
  const topS = x => polyY(m.ridge, x)
  const tierGap = m.tier ?? 5
  const hMax = m.height ?? 8
  const spacing = m.spacing ?? hMax * 0.55
  const tiers = Math.ceil((m.bottom - Math.min(...m.ridge.map(p => p[1]))) / tierGap) + 1
  const sign = o.lightLeft === false ? 1 : -1
  const under = new Map()
  for (let k = 0; k < tiers; k++) {
    const pal = o.pals[Math.min(o.pals.length - 1, Math.floor((k / Math.max(1, tiers - 1)) * o.pals.length))]
    let x = m.x0 - 6 + rand(k, 0) * spacing
    let i = 0
    while (x < m.x1 + 6) {
      const base = topS(x) + k * tierGap + 2 + (rand(i, k + 50) - 0.5) * 2
      const h = hMax * (k === 0 ? 0.7 + 0.3 * rand(i, k + 99) : 0.6 + 0.35 * rand(i, k + 99))
      const w = h * (0.3 + 0.06 * rand(i, k + 7)) + 0.5
      const y0 = Math.floor(base - h)
      for (let y = y0; y < Math.min(m.bottom, base + tierGap); y++) {
        const q = (y + 0.5 - (base - h)) / h
        // Boughs in layers: every other row reaches a little further.
        const hw = Math.min(q, 1.1) * w + ((y - y0) % 2 === 1 && q > 0.25 ? 0.6 : 0)
        for (let cx = Math.floor(x - hw); cx <= Math.floor(x + hw); cx++) {
          if (cx < m.x0 || cx >= m.x1) continue
          const s = (cx + 0.5 - x) / Math.max(hw, 0.5)
          if (Math.abs(s) > 1.05) continue
          let v = 0.45 + 0.34 * s * sign - 0.18 * smooth((q - 0.5) / 0.6)
          if (q < 0.3) v += 0.1
          if (s * sign < -0.7) v -= 0.12 // the shaded edge, darkest where it meets the next tree
          L.set(cx, y, tone(pal, v, cx, y, 0.12))
        }
      }
      x += spacing * (0.75 + 0.5 * rand(i, k + 3))
      i++
    }
    under.set(k, pal[0])
  }
  // Anything left between the trees, down to the bottom, is deep shade.
  const deep = o.pals[o.pals.length - 1][0]
  for (let x = m.x0; x < m.x1; x++) for (let y = Math.ceil(topS(x) + 2); y < m.bottom; y++) if (!L.has(x, y)) L.set(x, y, deep)
  return L
}

// ---------------------------------------------------------------- a near spruce

// A tall spruce: tiers of drooping boughs round a trunk, lit on the left, a bright rim on the
// edge toward the light, dark under each tier. o: { x, top, base, w, tones, rim, trunk, seed }
export function spruce(L, o) {
  const H = o.base - o.top
  const tiers = Math.max(4, Math.round(H / (o.tierH ?? 7)))
  for (let y = o.top; y < o.base; y++) {
    const q = (y - o.top) / H
    const k = Math.min(tiers - 1, Math.floor(q * tiers))
    const tq = q * tiers - k // 0 at a tier's top, 1 at its foot
    const env = o.w * (0.12 + 0.88 * Math.pow(q, 0.9))
    const hw = env * (0.55 + 0.45 * Math.pow(tq, 0.7)) + (hash(y, 3, o.seed) - 0.5) * 1.2
    for (let x = Math.floor(o.x - hw); x <= Math.ceil(o.x + hw); x++) {
      const s = (x + 0.5 - o.x) / Math.max(hw, 0.6)
      if (Math.abs(s) > 1) continue
      // Bough tips droop: the outer cells of a tier sit lower.
      if (Math.abs(s) > 0.75 && tq < 0.35 * Math.abs(s)) continue
      // Lit, middle and shaded thirds across; the upper part of each tier brighter, its foot dark.
      const sz = s < -0.4 ? -0.7 : s < 0.3 ? 0 : 0.7
      let v = 0.5 - 0.32 * sz + (tq < 0.45 ? 0.08 : -0.04) - 0.1 * q
      if (tq > 0.82) v -= 0.25
      let c = tone(o.tones, v, x, y, 0)
      if (s < -0.82 && tq < 0.85) c = o.rim
      L.set(x, y, c)
    }
  }
  if (o.trunk) for (let y = o.base - 3; y < o.base + (o.foot ?? 4); y++) for (let k = -1; k <= 0; k++) L.set(Math.floor(o.x) + k, y, o.trunk[k + 1])
  return L
}
