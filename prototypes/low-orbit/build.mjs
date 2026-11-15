// Low Orbit: the edge of the Earth seen from orbit, with the line between day and night where it
// stands at a given moment, the cities glowing on the night side, and a satellite passing.
// One drawing, painted on Sunfield's 320 x 200 cell grid (x right, y down), written as one SVG
// per moment.
//   node build.mjs  ->  out/low-orbit-a.svg, out/low-orbit-b.svg
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SUNFIELD = path.resolve(HERE, '../../../sunfield/tools')
const { Layer, bayer, bounds, clamp, lerp, rng, smooth, tone } = await import(pathToFileURL(path.join(SUNFIELD, 'pixel.mjs')).href)
// Cells are written by the seam-proof encoder (see engine/README.md): no hairlines at any window
// size, the same picture at whole-pixel sizes. encode-local.mjs is engine/encode.mjs with three
// local changes (backing kept off the outer edge, corners covered, paths at most 19 rows tall;
// see its header).
const { emitSafe, runsIn } = await import(pathToFileURL(path.join(HERE, 'encode-local.mjs')).href)

const W = 320
const H = 200
const f1 = v => Math.round(v * 10) / 10
const TICK = 0.05
const ticks = s => Math.round(s / TICK)

// ---------------------------------------------------------------- the moments
// The camera hangs over the meridian of the clock's time zone (UTC+2 here: 30 E) and looks north
// at the limb. Each moment is a real time; the sun stands where it really is then.
const ZONE_LON = 30
const MOMENTS = {
  a: { label: '2026-11-15 04:45 (UTC+2)', utc: Date.UTC(2026, 10, 15, 2, 45) },
  b: { label: '2026-11-15 07:40 (UTC+2)', utc: Date.UTC(2026, 10, 15, 5, 40) },
}

// ---------------------------------------------------------------- vectors
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = v => {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
const RAD = Math.PI / 180
const onSphere = (lat, lon) => [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
const latOf = P => Math.asin(clamp(P[2], -1, 1))
const lonOf = P => Math.atan2(P[1], P[0])

// The sun: declination and the longitude where it is noon, from the usual NOAA series.
function sunAt(ms) {
  const d = new Date(ms)
  const y0 = Date.UTC(d.getUTCFullYear(), 0, 1)
  const g = (2 * Math.PI * ((ms - y0) / 864e5)) / 365
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g)
  const utcMin = (ms - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) / 60e3
  const lon = ((720 - utcMin - eqt) / 4) * RAD
  return { decl, lon }
}

// ---------------------------------------------------------------- noise
function hash3(x, y, z, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683) ^ Math.imul(s | 0, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
function vnoise(x, y, z, s) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const fx = x - xi
  const fy = y - yi
  const fz = z - zi
  const u = fx * fx * (3 - 2 * fx)
  const v = fy * fy * (3 - 2 * fy)
  const w = fz * fz * (3 - 2 * fz)
  let out = 0
  for (let k = 0; k < 2; k++)
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) out += hash3(xi + i, yi + j, zi + k, s) * (i ? u : 1 - u) * (j ? v : 1 - v) * (k ? w : 1 - w)
  return out
}
function fbm(P, freq, oct, s, gain = 0.5) {
  let a = 1
  let sum = 0
  let n = 0
  let f = freq
  for (let o = 0; o < oct; o++) {
    sum += a * vnoise(P[0] * f + 31.7 * o, P[1] * f - 17.3 * o, P[2] * f + 5.1 * o, s + o)
    n += a
    a *= gain
    f *= 2.03
  }
  return sum / n
}

// ---------------------------------------------------------------- the camera
// From D Earth radii out, over latitude CAM_LAT on the zone's meridian, looking north with the
// limb arching across the upper middle of the frame.
const D = 1.3
const FOCAL = 236 // cells
const CAM_LAT = 14 * RAD
const CAM_LON = ZONE_LON * RAD
const LIMB_ROW = 92 // the top of the limb's arch
const CU = onSphere(CAM_LAT, CAM_LON)
const EAST = [-Math.sin(CAM_LON), Math.cos(CAM_LON), 0]
const NORTH = cross(CU, EAST)
const CAM = CU.map(v => v * D)
const PITCH = Math.PI / 2 - Math.asin(1 / D) - Math.atan((100 - LIMB_ROW) / FOCAL)
const FWD = norm(add(NORTH.map(v => v * Math.cos(PITCH)), CU, -Math.sin(PITCH)))
const RIGHT = norm(cross(FWD, CU))
const UP = cross(RIGHT, FWD)
const ray = (x, y) => norm(add(add(FWD, RIGHT, (x + 0.5 - 160) / FOCAL), UP, -(y + 0.5 - 100) / FOCAL))
function project(P) {
  const v = add(P, CAM, -1)
  const z = dot(v, FWD)
  if (z <= 0) return null
  return [160 + (dot(v, RIGHT) / z) * FOCAL - 0.5, 100 - (dot(v, UP) / z) * FOCAL - 0.5]
}
// Where a ray meets the Earth (unit sphere): the point, or for a miss the height of its lowest point.
function hit(dir) {
  const b = dot(CAM, dir)
  const disc = b * b - (D * D - 1)
  if (disc >= 0) {
    const t = -b - Math.sqrt(disc)
    if (t > 0) return { P: add(CAM, dir, t) }
  }
  const T = add(CAM, dir, -b)
  return { T, h: Math.hypot(T[0], T[1], T[2]) - 1 }
}

// The day's light, spread out: the frame holds about half the globe's longitudes (STRETCH times
// what the camera really sees), so the line between day and night is in view at most hours, and
// crosses the frame as the clock turns. Latitudes are as they are.
const STRETCH = 2.6
function sunlight(P, sun) {
  const lat = latOf(P)
  let dl = lonOf(P) - CAM_LON
  dl = Math.atan2(Math.sin(dl), Math.cos(dl))
  const lon = CAM_LON + dl * STRETCH
  // The sun's height there, as the cosine of its distance from the zenith.
  return Math.sin(lat) * Math.sin(sun.decl) + Math.cos(lat) * Math.cos(sun.decl) * Math.cos(lon - sun.lon)
}

// ---------------------------------------------------------------- palettes (dark to light)
const OCEAN = ['#030a1b', '#06132e', '#0a1e45', '#0f2c5e', '#153d77', '#1d5290', '#2a69a8', '#4384bf', '#7aaed6']
const LAND_G = ['#0b120e', '#141f15', '#1d2d1b', '#283c22', '#354c29', '#465e31', '#5b723d', '#76884d']
const LAND_D = ['#15120f', '#272019', '#3b3125', '#514434', '#685943', '#807055', '#988a6c', '#b3a888']
const CLOUD = ['#1e2638', '#303c55', '#4a5873', '#6a7b9b', '#909fbd', '#b6c3da', '#d9e2f0', '#f4f7fc']
const WARM = ['#221730', '#3a2038', '#5c2c40', '#8a3c47', '#bb544b', '#e2734e', '#f59c62', '#ffc98a', '#fff0c8']
const NIGHT = ['#020410', '#03061a', '#060b21', '#0a1029', '#0f1733', '#151f3f']
const LIGHTS = ['#4a2414', '#7a3a16', '#b4581c', '#e8892e', '#ffbb52', '#ffe08e', '#fff8dc']
const LIT_CLOUD = ['#1a1a30', '#2c2234', '#4a3034', '#6e4232']

// The sun as seen from a point of the ground: the light of the spread-out day (see sunlight) as a
// direction in that point's own east, north and up.
function sunVector(P, sun) {
  const lat = latOf(P)
  const lon = lonOf(P)
  let dl = lon - CAM_LON
  dl = Math.atan2(Math.sin(dl), Math.cos(dl))
  const vlon = CAM_LON + dl * STRETCH
  const S = onSphere(sun.decl, sun.lon)
  const frame = lo => [
    [-Math.sin(lo), Math.cos(lo), 0],
    [-Math.sin(lat) * Math.cos(lo), -Math.sin(lat) * Math.sin(lo), Math.cos(lat)],
    onSphere(lat, lo),
  ]
  const [ve, vn, vu] = frame(vlon)
  const [e, n, u] = frame(lon)
  const a = dot(S, ve)
  const b = dot(S, vn)
  const c = dot(S, vu)
  return [0, 1, 2].map(i => a * e[i] + b * n[i] + c * u[i])
}

// What covers each point: land or sea, the kind of land, the cloud, and where people live.
// The world is made up (no map data travels with the scene); GEO shifts it to a layout that
// suits the frame: land on the left for the night's cities, an inland sea in the middle.
const GEO = (process.env.GEO ?? '-1.2,0.4,0.8').split(',').map(Number)
const LAND_F = 5
const LAND_T = 0.5
const CLOUD_F = Number(process.env.CLOUD_F ?? 6)
const CLOUD_T = Number(process.env.CLOUD_T ?? 0.6)
function ground(P) {
  const lat = latOf(P) / RAD
  // Continents: a warped field, with coasts broken up by finer octaves.
  const G = add(P, GEO)
  const w = [fbm(G, 3, 3, 41) - 0.5, fbm(G, 3, 3, 42) - 0.5, fbm(G, 3, 3, 43) - 0.5]
  const Pw = add(G, w, 0.3)
  const land = fbm(Pw, LAND_F, 6, 7)
  const isLand = land > LAND_T
  const coast = Math.abs(land - LAND_T)
  const dry = fbm(G, 7, 3, 13) + (Math.abs(lat - 24) < 14 ? 0.1 : -0.1) > 0.55
  const snow = lat > 49 + 8 * (fbm(G, 12, 2, 17) - 0.5)
  const ridge = 1 - Math.abs(fbm(Pw, 16, 3, 19) * 2 - 1)
  const green = fbm(G, 20, 2, 18)
  // Clouds: weather systems at a large scale, and within them cumulus in clumps and streets.
  const s = [fbm(G, 4, 3, 21) - 0.5, fbm(G, 4, 3, 22) - 0.5, fbm(G, 4, 3, 23) - 0.5]
  const Q = add(G, s, 0.2)
  const systems = fbm(Q, CLOUD_F, 4, 31)
  const fronts = 1 - Math.abs(fbm(Q, CLOUD_F * 0.6, 3, 33) * 2 - 1)
  const cover = smooth((systems - 0.45) / 0.13) + 0.6 * smooth((fronts - 0.84) / 0.08)
  const puff = fbm(add(Q, [0, 0, lat * 0.002]), CLOUD_F * 16, 2, 39)
  const thick = fbm(Q, CLOUD_F * 5, 2, 37)
  const cloudH = cover * 0.62 + puff * 0.75 + 0.25 * (thick - 0.5)
  const cloud = clamp((cloudH - CLOUD_T) / 0.08 + 0.5, 0, 1)
  // People: cities along the coasts and in green lowlands, towns between, and one river valley
  // through the dry land strung with lights.
  let pop = 0
  if (isLand) {
    const fine = vnoise(G[0] * 150, G[1] * 150, G[2] * 150, 53)
    const metro = Math.pow(smooth((fbm(G, 48, 3, 51) - 0.63) / 0.09), 1.6)
    const shore = smooth((0.03 - coast) / 0.025) * (fine > 0.5 ? 0.75 : 0.15)
    const town = vnoise(G[0] * 260, G[1] * 260, G[2] * 260, 57) > (dry ? 0.9 : 0.79) ? 0.32 : 0
    const river = 1 - Math.abs(fbm(G, 4.5, 3, 55) * 2 - 1)
    pop = metro * (dry ? 0.5 : 1) + shore + town
    if (dry && river > 0.96 && fine > 0.35) pop = Math.max(pop, 0.3 + (river - 0.96) * 12)
    if (snow) pop *= 0.4
  }
  const tex = fbm(G, 70, 2, 61)
  const landH = ridge * 0.6 + tex * 0.4
  return { isLand, coast, dry, snow, ridge, green, tex, cloud, cloudH, landH, thick, pop }
}

// ---------------------------------------------------------------- the Earth
function paintEarth(sun) {
  const earth = new Layer('earth')
  const air = new Layer('air')
  const cells = new Map()
  const limb = [] // the first row of ground in each column
  for (let y = 30; y < H + 1; y++) {
    for (let x = -2; x < W + 2; x++) {
      const dir = ray(x, y)
      const r = hit(dir)
      if (!r.P) {
        // The air over the limb, a few cells thick, lit as the ground below it is.
        if (r.h > AIR_TOP) continue
        const mu = sunlight(norm(r.T), sun)
        paintAir(air, x, y, r.h / AIR_TOP, mu)
        continue
      }
      const P = r.P
      limb[x] ??= y
      const g = ground(P)
      const mu = sunlight(P, sun)
      const view = -dot(dir, P) // 1 looking straight down, 0 at the limb
      // Sunglint: the sun mirrored in the sea.
      const S = sunVector(P, sun)
      const refl = add(dir, P, -2 * dot(dir, P))
      const glint = Math.pow(Math.max(0, dot(refl, S)), 24)
      const isCloud = g.cloud + bayer(x, y) * 0.3 > 0.5
      cells.set(x + ',' + y, { x, y, P, mu, view, glint, isCloud, ...g })
    }
  }
  const at = (x, y) => cells.get(x + ',' + y)
  const cloudAt = (x, y) => at(x, y)?.isCloud ?? false
  // Relief: each cell lit by how its slope faces the sun, which stands off to the right and a
  // little toward the viewer.
  const bump = (c, key) => {
    const h = (dx, dy) => at(c.x + dx, c.y + dy)?.[key] ?? c[key]
    return -(h(1, 0) - h(-1, 0)) - 0.5 * (h(0, 1) - h(0, -1))
  }
  for (const c of cells.values()) {
    c.bump = c.isCloud ? bump(c, 'cloudH') : c.isLand ? bump(c, 'landH') : 0
    if (c.isCloud) {
      // Each clump lit on its sunward side (the right), shaded on the far side.
      c.edge = !cloudAt(c.x + 1, c.y) || !cloudAt(c.x, c.y - 1) ? 1 : !cloudAt(c.x - 1, c.y) || !cloudAt(c.x, c.y + 1) ? -1 : 0
      continue
    }
    // Cloud shadows fall away from the sun, to the left, longer as the sun gets low.
    if (c.mu <= 0) continue
    const len = clamp(Math.round(1 + 0.05 / (c.mu + 0.015)), 1, 6)
    for (let k = 1; k <= len; k++) if (cloudAt(c.x + k, c.y)) c.shadow = true
  }
  for (const c of cells.values()) earth.set(c.x, c.y, surface(c))
  return { earth, air, cells, limb }
}

const DZ = Number(process.env.DZ ?? 1) // how much the ground's tones are dithered into each other
// One cell of the ground, seen from above.
function surface(c) {
  const { x, y, mu, view, isCloud, isLand } = c
  const haze = Math.pow(1 - view, 3.2) // the air thickens toward the limb
  // Day: full light a little above the line, the last of it warm.
  if (mu > 0) {
    const day = Math.pow(clamp(mu / 0.35, 0, 1), 0.55)
    if (isCloud) {
      const lit = clamp(c.bump * 2.6, -0.3, 0.3)
      if (mu < 0.07) return tone(WARM, 0.5 + mu * 6 + 0.12 * (c.thick - 0.5) + 0.1 * c.edge + lit, x, y, 0.3 * DZ)
      const v = 0.36 + 0.46 * day + 0.25 * (c.thick - 0.5) + 0.1 * c.edge + 0.1 * haze + lit
      return tone(CLOUD, v, x, y, 0.3 * DZ)
    }
    let v
    let tones
    if (isLand) {
      tones = c.snow ? CLOUD : c.dry ? LAND_D : LAND_G
      v = (c.snow ? 0.3 + 0.4 * day : 0.12 + 0.48 * day) + 0.12 * (c.ridge - 0.5) + 0.12 * (c.green - 0.5) + 0.12 * (c.tex - 0.5) + 0.4 * haze + clamp(c.bump * 3, -0.25, 0.25) * day
    } else {
      // The sea: dark, paler toward the limb; by the line it mirrors the dawn.
      if (mu < 0.08 && !c.shadow) return tone(WARM, 0.12 + mu * 4 + 0.2 * haze, x, y, 0.5 * DZ)
      tones = OCEAN
      v = 0.1 + 0.38 * day + 0.6 * haze + 0.75 * c.glint
      if (c.coast < 0.01) v += 0.07 // shallows
    }
    if (c.shadow) v -= 0.2
    if (mu < 0.05) v -= (0.05 - mu) * 5
    return tone(tones, v, x, y, 0.3 * DZ)
  }
  // Twilight: the clouds catch the last light a little past the line.
  if (isCloud && mu > -0.045) return tone(WARM, 0.32 + mu * 7 + 0.08 * c.edge, x, y, 0.35 * DZ)
  // Night: the cities, dimmed and spread under cloud.
  const on = smooth(-mu / 0.06)
  const b = c.pop * on * (isCloud ? 0.5 : 1) + (bayer(x, y) + 0.5) * 0.08 - 0.04
  if (isCloud) {
    if (b > 0.18) return LIT_CLOUD[clamp(Math.floor(b * 6), 0, LIT_CLOUD.length - 1)]
    return tone(NIGHT, 0.6 + 0.25 * (c.thick - 0.5) + 0.1 * c.edge + 0.25 * haze, x, y, 0.3 * DZ)
  }
  if (b > 0.14) return LIGHTS[clamp(Math.floor((b - 0.14) * 9), 0, LIGHTS.length - 1)]
  return tone(NIGHT, (isLand ? 0.26 : 0.1) + 0.35 * haze + (mu > -0.04 ? 0.12 : 0), x, y, 0.5 * DZ)
}

// The air over the limb: blue by day, the sunset's bands where the line meets it, and by night a
// dark band with the thin green airglow.
const AIR_TOP = 0.05
const AIR_DAY = ['#0b1a44', '#12306c', '#1b4a9e', '#2c6ccc', '#4d93ea', '#86c2fb', '#c4e6ff', '#f0faff']
const AIR_DUSK = ['#1c0f30', '#46163a', '#86223a', '#cc3f2c', '#f57a2c', '#ffb64e', '#ffe29a', '#fff6dc']
function paintAir(air, x, y, q, mu) {
  const d = bayer(x, y) * 0.16
  // How far into the day: 0 night, 1 day, the sunset's bands between.
  const t = clamp((mu + 0.22) / 0.42 + d, 0, 1)
  if (t >= 0.66) {
    const v = (1.02 - q * 1.15) * (0.7 + 0.3 * t)
    if (v + d < 0.07) return
    air.set(x, y, tone(AIR_DAY, v, x, y, 0.4))
  } else if (t > 0.1) {
    // Red at the ground, gold and white above it, then a deep blue.
    const k = (t - 0.1) / 0.56
    if (q < 0.5) air.set(x, y, tone(AIR_DUSK, (1 - q * 1.5) * (0.45 + 0.55 * k), x, y, 0.4))
    else if (q < 0.85) {
      const v = (0.95 - q) * 1.4 * k
      if (v > 0.08) air.set(x, y, tone(AIR_DAY, v, x, y, 0.4))
    }
  } else {
    // Night: a dark band, and the airglow a little above the ground, broken here and there.
    if (q > 0.3 && q < 0.4) {
      if ((x * 7 + y * 3) % 5) air.set(x, y, x % 4 ? '#0c2a2c' : '#134034')
    } else if (q < 0.3) air.set(x, y, '#070d22')
  }
}

// ---------------------------------------------------------------- space
// Bands of the night, darkest at the top, a shade lighter down toward the limb.
const VOID = ['#020308', '#03040c', '#040610', '#050814', '#060a19', '#080c1e', '#0a0f24']
function paintSpace() {
  let out = '<g stroke-width="5">'
  let last = null
  let d = ''
  const flush = () => {
    if (last) out += '<path stroke="' + last + '" d="' + d + '"/>'
  }
  for (let y = -4; y < 204; y += 4) {
    const c = VOID[clamp(Math.floor((y / 160) * VOID.length), 0, VOID.length - 1)]
    if (c !== last) {
      flush()
      last = c
      d = ''
    }
    d += 'M-4 ' + (y + 2) + 'h328'
  }
  flush()
  return out + '</g>'
}

// The Milky Way, rising from behind the night side of the limb toward the top of the frame: dust
// in clumps, a dark rift along it, and a crowd of faint stars.
const DUST = ['#0c1024', '#131830', '#1c2140', '#2a2a4c', '#3b3352']
function paintMilkyWay(L) {
  const a = [-10, 128]
  const b = [250, -20]
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const ux = (b[0] - a[0]) / len
  const uy = (b[1] - a[1]) / len
  const r = rng(91)
  for (let y = 0; y < 150; y++) {
    for (let x = 0; x < W; x++) {
      const px = x - a[0]
      const py = y - a[1]
      const u = px * ux + py * uy
      const s = -px * uy + py * ux
      const wide = 14 + 5 * Math.sin(u * 0.02)
      const dens = Math.exp(-((s / wide) ** 2))
      if (dens < 0.08) continue
      const P = [u * 0.035, s * 0.06, 3.3]
      const clump = fbm(P, 1, 3, 71)
      const rift = Math.exp(-(((s - 2 - 5 * (fbm([u * 0.02, 0, 1], 1, 2, 73) - 0.5)) / 3.2) ** 2)) * smooth((fbm([u * 0.04, s * 0.1, 2], 1, 3, 75) - 0.35) / 0.2)
      const v = dens * (0.35 + clump * 0.9) - rift * 0.55 * dens
      const k = Math.floor((v - 0.36) * 5.5)
      if (k >= 0) L.set(x, y, DUST[clamp(k, 0, DUST.length - 1)])
      // Faint stars, thick where the band is.
      if (r() < 0.035 * dens * (1 - rift)) L.set(x, y, r() < 0.3 ? '#a9b4dc' : '#6a76a4')
    }
  }
}

// Stars: many faint, some bright, a few big ones that dim for a moment now and then.
const STAR = ['#3b4370', '#5d6894', '#8e9bc8', '#c9d3f5', '#ffffff', '#ffe6c4', '#c4dcff']
function paintStars(L, blinkers) {
  const r = rng(5)
  for (let i = 0; i < 150; i++) {
    const x = Math.floor(r() * W)
    const y = Math.floor(Math.pow(r(), 0.85) * 150)
    const b = r()
    L.set(x, y, b > 0.93 ? STAR[4] : b > 0.86 ? STAR[r() < 0.5 ? 5 : 6] : b > 0.6 ? STAR[2] : b > 0.3 ? STAR[1] : STAR[0])
  }
  const big = [
    [34, 22],
    [118, 14],
    [204, 38],
    [276, 16],
    [62, 76],
    [168, 64],
    [300, 60],
  ]
  big.forEach(([x, y], i) => {
    const S = new Layer('big' + i)
    const warm = i % 3 === 1
    S.set(x, y, '#ffffff')
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) S.set(x + dx, y + dy, warm ? '#e8c9a4' : '#9fb0e6')
    if (i % 2 === 0) for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) S.set(x + dx, y + dy, '#3e4777')
    const d = 5 * (2 + (i % 4))
    S.anim = anim('tk', '--d:' + d + 's;--l:' + f1(-((i * 3.7) % d)) + 's')
    blinkers.push(S)
  })
}

// The sun stands just past the right edge, above the limb. Its light is laid over the scene in
// screen mode (it only ever brightens): a glare in rings out of the corner, a streak along the
// horizon and a few rays.
const SUN_AT = [338, 116]
const SHINE = ['#120c10', '#1e1418', '#2e1d1c', '#432a22', '#5e3a28', '#7e4e30', '#a46a3c', '#cc8e52', '#eeb874', '#ffe0a8', '#fff6e2']
function paintGlare(L) {
  for (let y = 0; y < H; y++) {
    for (let x = 140; x < W; x++) {
      const d = Math.hypot((x + 0.5 - SUN_AT[0]) * 0.92, (y + 0.5 - SUN_AT[1]) * 1.2)
      const g = Math.pow(clamp(1 - d / 150, 0, 1), 2.4)
      const k = Math.floor(g * SHINE.length)
      if (k >= 1) L.set(x, y, SHINE[clamp(k, 0, SHINE.length - 1)])
    }
  }
}
// Rays: thin wedges out of the sun, fading as they reach.
function paintRays(L) {
  const rays = [
    [180.6, 330, 0.75, 0.35],
    [168, 230, 0.55, 0.9],
    [193.5, 160, 0.45, 0.8],
    [155, 190, 0.42, 1.1],
    [207, 110, 0.35, 1.1],
    [141, 150, 0.32, 1.3],
  ]
  for (const [deg, reach, power, spread] of rays) {
    const a = deg * RAD
    const cx = Math.cos(a)
    const cy = -Math.sin(a)
    for (let y = 0; y < H; y++) {
      for (let x = 100; x < W; x++) {
        const px = x + 0.5 - SUN_AT[0]
        const py = y + 0.5 - SUN_AT[1]
        const t = px * cx + py * cy
        if (t < 4 || t > reach) continue
        const s = Math.abs(-px * cy + py * cx)
        const half = 0.45 + t * 0.012 * spread
        if (s > half) continue
        const v = power * Math.pow(1 - t / reach, 1.4) * (1 - (s / half) * 0.5)
        const k = Math.floor(v * SHINE.length * 0.95 + bayer(x, y) * 0.6)
        if (k >= 1 && !(L.get(x, y) && SHINE.indexOf(L.get(x, y)) >= k)) L.set(x, y, SHINE[clamp(k, 0, SHINE.length - 1)])
      }
    }
  }
}


// The aurora: green curtains standing up from behind the night side of the limb, red at their
// tops. The curtain's glow stays; two sets of brighter rays in it take turns, so it seems to stir.
const AUR = ['#0a2626', '#0e3a32', '#145440', '#1b7150', '#249462', '#3ab97c', '#74e0a6', '#c4f8d8']
const AUR_TOP = ['#170f2a', '#241436', '#361a44']
function paintAurora(glow, sets, earth, sun) {
  for (let x = -2; x < W + 2; x++) {
    const limb = earth.limb[x]
    if (limb === undefined) continue
    const T = norm(hit(ray(x, limb - 1)).T ?? CU)
    const night = smooth((-sunlight(T, sun) - 0.16) / 0.12)
    if (night <= 0) continue
    const fold = fbm([x * 0.05, 0, 7], 1, 3, 81)
    const glowing = 0.7 + 0.45 * smooth((fbm([x * 0.11, 0, 9], 1, 2, 87) - 0.3) / 0.4)
    const hgt = (5 + 26 * Math.pow(fold, 1.6)) * night
    const top = limb - hgt
    for (let y = limb + 1; y > top - 4; y--) {
      const f = (limb + 1 - y) / (hgt + 1)
      if (f > 0.74) {
        // The red fringe above the green.
        const b = (1.2 - f) * night * (0.5 + 0.6 * fold) * glowing
        if (b > 0.16) glow.set(x, y, AUR_TOP[clamp(Math.floor(b * 5), 0, 2)])
        continue
      }
      const b = Math.pow(1 - f, 0.7) * night * (0.55 + 0.6 * fold) * glowing
      const k = Math.floor(b * 4.6)
      if (k >= 0 && b > 0.05) glow.set(x, y, AUR[clamp(k, 0, 4)])
      // Rays: bright threads up the curtain, a different set in each layer.
      sets.forEach((L, i) => {
        const ray = vnoise(x * 0.8 + i * 23.1, 0.5, 0.5, 85 + i)
        if (ray < 0.62 || f > 0.6 || b < 0.3) return
        L.set(x, y, AUR[clamp(Math.floor(b * 4.6) + (ray > 0.8 ? 2 : 1), 0, AUR.length - 1)])
      })
    }
  }
}


// ---------------------------------------------------------------- the satellite
// A small spacecraft passing between us and the Earth: a gold-foil body, two solar wings, a dish.
// The sun is off to the right and a little behind us, so the faces toward us are lit, the
// right-hand ones brightest, and every right and upper edge catches a rim of light.
const GOLD = ['#3a2208', '#5e3a10', '#8a5a18', '#b47f24', '#d9a436', '#f2c75a', '#ffe597', '#fff6d6']
const PANEL = ['#0f1a44', '#16265a', '#1f3672', '#2a488c', '#3a5ea6']
function paintSatellite(ox, oy) {
  const body = new Layer('sat')
  const glint = new Layer('satglint')
  const r = rng(77)
  const set = (x, y, c) => body.set(ox + x, oy + y, c)
  // A wing: cells of 3 by 2 between dark gaps, in a metal frame; brighter toward the sun.
  const wing = (x0, y0, w, h, skew, shine) => {
    for (let j = 0; j < h; j++) {
      const sh = Math.round((h - 1 - j) * skew)
      for (let i = 0; i < w; i++) {
        const x = x0 + i + sh
        const y = y0 + j
        let c
        if (j === 0 || i === w - 1) c = '#f4f6fa'
        else if (j === h - 1 || i === 0) c = '#69718a'
        else if (i % 4 === 0 || j % 3 === 0) c = '#070c22'
        else {
          const v = 0.25 + 0.5 * (i / w) + 0.25 * (1 - j / h)
          c = i % 4 === 1 && j % 3 === 1 ? PANEL[clamp(Math.floor(v * 5) + 1, 0, 4)] : tone(PANEL, v, x, y, 0.3)
        }
        set(x, y, c)
        // The sun's reflection, a band that sweeps across the panel as the craft passes.
        if (shine !== null && j > 0 && j < h - 1 && i > 0 && i < w - 1) {
          const s = Math.abs(i + j * 1.5 - shine)
          const gap = i % 4 === 0 || j % 3 === 0
          if (s < 1.3) glint.set(ox + x, oy + y, gap ? '#8fb2e8' : '#f6fbff')
          else if (s < 3) glint.set(ox + x, oy + y, gap ? '#3a5a9a' : '#a8c8f4')
        }
      }
    }
  }
  wing(0, 9, 18, 11, 0.36, null)
  wing(46, 5, 18, 11, 0.36, 11)
  // Booms out to the wings: a lit upper side, a dark lower one.
  for (let x = 20; x <= 24; x++) {
    set(x, 14, '#c8d0dc')
    set(x, 15, '#4e5668')
  }
  for (let x = 42; x <= 47; x++) {
    set(x, 11, '#eef2f8')
    set(x, 12, '#6a7284')
  }
  // The body, wrapped in crinkled gold foil: the front face, the sunlit side, the top.
  const foil = (x, y, v) => tone(GOLD, v + 0.32 * (vnoise(x * 0.9, y * 0.35, 1, 91) - 0.5) + 0.12 * (r() - 0.5), x, y, 0.4)
  for (let y = 9; y <= 23; y++)
    for (let x = 25; x <= 37; x++) {
      let c = foil(x, y, 0.48 + (x - 25) * 0.012 - (y - 9) * 0.008)
      if (x === 25) c = '#2a1806'
      else if (y === 23) c = '#1e1204'
      else if (y === 15) c = '#6a4412'
      // A radiator: dark, with silver louvres.
      if (y >= 17 && y <= 21 && x >= 27 && x <= 33) c = x % 2 ? '#1a1f2c' : y === 17 ? '#d4dae4' : '#8a92a4'
      set(x, y, c)
    }
  for (let j = 0; j < 4; j++) {
    const y = 8 - j
    for (let x = 26 + j; x <= 38 + j; x++) set(x, y, j === 3 ? '#fff1bc' : foil(x, y, 0.66 + j * 0.03))
  }
  for (let i = 0; i < 4; i++) {
    const x = 38 + i
    for (let y = 9 - i; y <= 23 - i; y++) set(x, y, i === 3 ? '#fffaf0' : y === 23 - i ? '#8a5a18' : foil(x, y, 0.78 + i * 0.04))
  }
  // A star tracker on top.
  set(31, 4, '#2a2f3c')
  set(32, 4, '#2a2f3c')
  set(31, 3, '#9aa3b4')
  set(32, 3, '#f0f4fa')
  // The dish below, on a short mast: a lit rim, the bowl darker on its far side, a feed.
  for (let y = 21; y <= 30; y++)
    for (let x = 18; x <= 38; x++) {
      const dx = (x + 0.5 - 27) / 7.5
      const dy = (y + 0.5 - 26) / 3.4
      const d = dx * dx + dy * dy
      if (d > 1) continue
      let c
      if (d > 0.7) c = dx > 0.2 ? '#ffffff' : dx > -0.5 ? '#c4cbd8' : '#8a92a4'
      else c = dx > 0.35 ? '#7a8294' : dx > -0.2 ? '#b0b8c6' : '#dfe4ec'
      if (d < 0.05) c = '#3a404e'
      set(x, y, c)
    }
  for (const [x, y] of [[27, 23], [26, 24], [28, 24]]) set(x, y, '#eef2f8')
  // A whip antenna on top, with a light at its tip.
  for (const [x, y] of [[36, 4], [36, 3], [37, 2], [37, 1], [38, 0], [38, -1]]) set(x, y, '#c8d0dc')
  const blink = new Layer('satblink')
  blink.set(ox + 38, oy - 2, '#ff6a50')
  return { body, glint, blink }
}


// A second craft, far off and small, crossing high up the other way.
const FAR_AT = [212, 30]
function paintFar(L) {
  const [x, y] = FAR_AT
  L.set(x, y, '#fff6e0')
  L.set(x - 1, y, '#8fa4d4')
  L.set(x + 1, y, '#8fa4d4')
  L.set(x, y - 1, '#4e5a88')
}

// ---------------------------------------------------------------- assemble
const defs = []
let ids = 0
const nextId = () => {
  let n = ids++
  let s = ''
  do {
    s = String.fromCharCode(97 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}
const PATTERN_MIN = 55
const stats = { patterns: 0, patternRuns: 0, plainRuns: 0 }
// A layer's cells, written plain or, when big, as a one-tile pattern on a rect. The tile keeps a
// clear cell on every side, so where the rect's edge falls inside a screen pixel only empty
// bitmap blends there. Its corner sits on a cell corner (rows are drawn half a cell low, so
// that is half a cell up from a whole number): the tile's bitmap then holds whole cells and
// lies on the screen's pixels wherever a cell is a whole number of them. Half a cell off, as
// before, the bitmap was resampled wherever half a cell is not whole pixels (9 px a cell: every
// row edge of the Earth and the sky came out as a soft 1-px band).
function draw(L, opts = {}) {
  const plain = emitSafe(L, opts)
  const runs = runsIn(plain)
  if (runs < PATTERN_MIN) {
    stats.plainRuns += runs
    return plain
  }
  stats.patterns++
  stats.patternRuns += runs
  const b = bounds(L)
  const id = nextId()
  const x0 = b.x0 - 1
  const y0 = b.y0 - 1.5
  defs.push('<pattern id="' + id + '" width="1" height="1">' + emitSafe(L, { ...opts, ox: x0, oy: y0 }) + '</pattern>')
  return '<rect x="' + x0 + '" y="' + y0 + '" width="' + (b.x1 - x0 + 1) + '" height="' + (b.y1 - b.y0 + 2) + '" fill="url(#' + id + ')"/>'
}
// Lower layers are cut away where the globe (the Earth and its air) covers them, all but a ring
// one cell deep under its edge: there the lower layer carries on beneath, so where the edge falls
// inside a screen pixel, that pixel blends the globe with what is beside it, not with space.
function tuckUnder(L, cover) {
  const ROW = 4096
  const out = new Map()
  for (const [k, c] of L.m) if (!cover.has(k)) out.set(k, c)
  for (const k of cover) {
    let c = null
    for (const n of [k - ROW, k - 1, k + 1, k + ROW]) {
      if (cover.has(n) || !out.has(n)) continue
      c = L.m.get(k) ?? out.get(n)
      break
    }
    if (c) out.set(k, c)
  }
  L.m = out
}
function anim(cls, style, extra = '') {
  return { cls, style, extra }
}
const group = (L, body) => '<g class="' + L.anim.cls + '"' + (L.anim.style ? ' style="' + L.anim.style + '"' : '') + L.anim.extra + '>' + body + '</g>'

// The motion, all of it on the shared clock: every step lands on a multiple of TICK seconds.
// Each delay counts from the root's --m (minus the seconds since a fixed moment), so a scene
// written later carries on where the one before it was.
const from = l => 'calc(' + l + ' + var(--m))'
const SAT_D = 150 // seconds per pass of the satellite
const SAT_FLY = 0.8 // the share of the pass it is crossing
const SAT_A = [-160, 58] // where it enters, low over the limb, relative to where it is drawn
const SAT_B = [300, -30] // where it leaves, high on the right
// It is drawn where it stands at the start, so the first frame and reduced motion show it there.
const SAT_HOME = -SAT_A[0] / (SAT_B[0] - SAT_A[0])
const SAT_L = -Math.round((SAT_HOME * SAT_FLY * SAT_D) / TICK) * TICK
const FAR_D = 100
const FAR_FLY = 0.6
const FAR_A = [125, -8]
const FAR_B = [-245, 40]
const FAR_L = -Math.round(((FAR_A[0] / (FAR_A[0] - FAR_B[0])) * FAR_FLY * FAR_D) / TICK) * TICK
const RULES = [
  // The satellite crosses a step every tick, about a fifth of a cell.
  '.sat{animation:sat ' + SAT_D + 's steps(1) ' + from(f1(SAT_L) + 's') + ' infinite}',
  '@keyframes sat{0%{transform:translate(' + SAT_A[0] + 'px,' + SAT_A[1] + 'px);animation-timing-function:steps(' + ticks(SAT_D * SAT_FLY) + ')}' +
    SAT_FLY * 100 + '%,100%{transform:translate(' + SAT_B[0] + 'px,' + SAT_B[1] + 'px)}}',
  // Its wing catches the sun on the way across: a few steps up, a few down.
  '.gl{animation:gl ' + SAT_D + 's steps(1) ' + from(f1(SAT_L) + 's') + ' infinite}',
  '@keyframes gl{0%,36%{opacity:0}37%{opacity:.35}38%{opacity:.7}39%,42%{opacity:1}43%{opacity:.7}44%{opacity:.35}45%,100%{opacity:0}}',
  // The light on its antenna.
  '.bl{animation:bl 3s steps(1) ' + from('-1s') + ' infinite}',
  '@keyframes bl{0%,80%{opacity:.3}85%,95%{opacity:1}}',
  // The far craft crosses high up from right to left, a step every tick.
  '.far{animation:far ' + FAR_D + 's steps(1) ' + from(f1(FAR_L) + 's') + ' infinite}',
  '@keyframes far{0%{transform:translate(' + FAR_A[0] + 'px,' + FAR_A[1] + 'px);animation-timing-function:steps(' + ticks(FAR_D * FAR_FLY) + ')}' +
    FAR_FLY * 100 + '%,100%{transform:translate(' + FAR_B[0] + 'px,' + FAR_B[1] + 'px)}}',
  // The aurora's two sets of rays take turns, in steps of a second.
  '.au{animation:au 9s steps(9) ' + from('var(--l)') + ' infinite alternate}',
  '@keyframes au{from{opacity:1}to{opacity:.25}}',
  // A big star dims for a moment near the end of its cycle.
  '.tk{animation:tk var(--d) steps(1) ' + from('var(--l)') + ' infinite}',
  '@keyframes tk{0%,90%{opacity:1}94%,100%{opacity:.35}}',
  // The sun's light only ever brightens what it falls on.
  '.G{mix-blend-mode:screen}',
  // Reduced motion rests the scene on its finished frame.
  '@media (prefers-reduced-motion:reduce){:root *{animation:none!important}}',
]
const CSS = RULES.join('')

// What of the CSS survives the app's scrub: every rule but @keyframes, written back by the CSSOM
// with its animation gone (Sunfield's estimate).
function keptLength(css) {
  let n = 0
  for (const m of css.matchAll(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}|@media[^{]*\{[^{}]*\{[^{}]*\}\}|([^{}]+)\{([^{}]*)\}/g)) {
    if (m[0].startsWith('@keyframes')) continue
    if (m[0].startsWith('@media')) {
      n += m[0].length + 12
      continue
    }
    const decls = m[2].split(';').filter(d => d && !/^animation/.test(d))
    n += m[1].length + 3 + (decls.length ? decls.join('; ').length + 2 : 0) + 1
  }
  return n
}

function build(key) {
  defs.length = 0
  ids = 0
  stats.patterns = stats.patternRuns = stats.plainRuns = 0
  const m = MOMENTS[key]
  const sun = sunAt(m.utc)
  const earth = paintEarth(sun)
  // The Earth and its air never overlap, and meet along the limb: one layer, so the encoder sees
  // that edge as any other between two colours.
  const globe = new Layer('globe')
  for (const [k, c] of earth.air.m) globe.m.set(k, c)
  for (const [k, c] of earth.earth.m) globe.m.set(k, c)
  const cover = new Set(globe.m.keys())
  // Far plane: the Milky Way and the stars, the glare of the sun, the aurora behind the limb.
  const far = new Layer('far')
  paintMilkyWay(far)
  const blinkers = []
  paintStars(far, blinkers)
  // The light of the sun, over everything but the satellite: a soft glare, and rays in cells.
  const shine = new Layer('shine')
  paintRays(shine)
  defs.push(
    '<radialGradient id="S"><stop stop-color="#fff6e0"/><stop offset=".06" stop-color="#ffdca8"/><stop offset=".2" stop-color="#b8744c" stop-opacity=".6"/>' +
      '<stop offset=".45" stop-color="#4a2a3a" stop-opacity=".35"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>',
  )
  // The aurora's glow joins the far plane (over the stars); its rays move.
  const auGlow = new Layer('auglow')
  const aurora = [new Layer('au1'), new Layer('au2')]
  paintAurora(auGlow, aurora, earth, sun)
  for (const [k, c] of auGlow.m) far.m.set(k, c)
  for (const L of [far, ...blinkers, ...aurora]) tuckUnder(L, cover)
  aurora.forEach((L, i) => (L.anim = anim('au', '--l:' + (i ? '-9s' : '0s'))))
  const farCraft = new Layer('farcraft')
  paintFar(farCraft)
  farCraft.anim = anim('far', '')
  const sat = paintSatellite(84, 38)
  sat.glint.anim = anim('gl', '', " opacity='0'")
  sat.blink.anim = anim('bl', '')

  const view = pin => '<svg viewBox="0 -.5 ' + W + ' ' + H + '" preserveAspectRatio="' + pin + ' slice">'
  // The globe is laid on itself three times. That began as a cover for hairlines, which the
  // encoder now prevents; it stays because the merge runs in linearRGB, which rounds the darkest
  // night tones as the owner has seen them (without it the night side shifts by a few levels).
  defs.push('<filter id="M"><feMerge><feMergeNode/><feMergeNode/><feMergeNode/></feMerge></filter>')
  // What each part writes, in characters of cells.
  const sizes = {}
  const sized = (name, L, opts) => {
    const before = defs.join('').length
    const out = draw(L, opts)
    sizes[name] = out.length + defs.join('').length - before
    return out
  }
  const parts = { far: sized('far', far), globe: sized('globe', globe), rays: sized('rays', shine), satellite: sized('satellite', sat.body) }
  const body =
    view('xMidYMax') +
    paintSpace() +
    parts.far +
    blinkers.map(L => group(L, draw(L))).join('') +
    aurora.map(L => group(L, draw(L))).join('') +
    group(farCraft, draw(farCraft)) +
    '<g filter="url(#M)">' + parts.globe + '</g>' +
    '<ellipse class="G" cx="' + SUN_AT[0] + '" cy="' + SUN_AT[1] + '" rx="150" ry="125" fill="url(#S)"/><g class="G">' + parts.rays + '</g>' +
    '</svg>' +
    view('xMidYMid') +
    '<g class="sat">' + parts.satellite + group(sat.glint, draw(sat.glint)) + group(sat.blink, draw(sat.blink)) + '</g>' +
    '</svg>'
  let svg =
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" font-family="a" color="a" style="--m:0s">' +
    '<style>' + CSS + '</style><defs>' + defs.join('') + '</defs>' + body + '</svg>'
  // Single quotes: the scene travels to the app inside JSON, where every double quote costs a backslash.
  svg = svg.replaceAll('"', "'")
  // The app refuses a source past 131072 characters, counted after its scrub writes the scene back
  // as HTML (every <x .../> becomes <x ...></x>) with the @keyframes gone. The kit keeps every
  // scene at 128,000 or less both ways, for headroom.
  const scrubbed = svg.length - CSS.length + keptLength(CSS) + [...svg.matchAll(/<(\w+)[^>]*\/>/g)].reduce((n, m) => n + 2 + m[1].length, 0)
  const LIMIT = 128000
  fs.mkdirSync(path.join(HERE, 'out'), { recursive: true })
  fs.writeFileSync(path.join(HERE, 'out', 'low-orbit-' + key + '.svg'), svg)
  console.log(key, m.label, '|', svg.length, 'chars,', scrubbed, 'after the scrub, limit', LIMIT, svg.length <= LIMIT && scrubbed <= LIMIT ? 'OK' : 'TOO BIG')
  console.log('  patterns', stats.patterns, 'holding', stats.patternRuns, 'runs; plain runs', stats.plainRuns, '|', Object.entries(sizes).map(e => e.join(' ')).join(', '))
  if (svg.length > LIMIT || scrubbed > LIMIT) process.exitCode = 1
}

// MAP=1 prints the ground in view as letters instead: # land, ~ sea, o cloud.
if (process.env.MAP) {
  let land = 0
  let cloud = 0
  let n = 0
  const pops = [0, 0, 0, 0, 0, 0]
  for (let y = 80; y < H; y += 4) {
    let row = ''
    for (let x = 0; x < W; x += 3) {
      const r = hit(ray(x, y))
      if (!r.P) {
        row += ' '
        continue
      }
      const g = ground(r.P)
      n++
      land += g.isLand
      cloud += g.cloud > 0.5
      if (g.isLand) pops[Math.min(5, Math.floor(g.pop * 5))]++
      row += g.cloud > 0.5 ? 'o' : g.isLand ? '#' : '~'
    }
    console.log(row)
  }
  console.log('land', (land / n).toFixed(2), 'cloud', (cloud / n).toFixed(2), 'people by fifths', pops.join(' '))
} else for (const k of Object.keys(MOMENTS)) build(k)

