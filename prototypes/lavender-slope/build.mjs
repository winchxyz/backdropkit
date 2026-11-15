// Lavender Slope: a lavender field rolling down a slope into a valley under jagged snow peaks,
// as one animated pixel-art SVG in three moments (day, sunset, night).
// node build.mjs [moment ...]  ->  out/lavender-slope-<moment>.svg   (STATS=1: runs per layer)
//
// Painted on a 320 x 200 cell grid (x right, y down) and encoded the way Sunfield's build does
// it (../../../sunfield/tools/build.mjs): cells as 1-cell stroke runs, at most 64 runs a path,
// big still layers in patterns with a clear cell all round, nested pinned viewports, CSS motion
// in steps on a 0.05 s clock. The encoder (encode.mjs) follows Tide Line's.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Layer, clamp, lerp, rng, smooth, tone } from '../../../sunfield/tools/pixel.mjs'
import { line } from '../../../sunfield/tools/painters.mjs'
import { encode } from './encode.mjs'
import { apart, emitSafe, setTone } from './encode-local.mjs'
import { H, KEY, W, cellXY, f2, fogStep, fogged, hash, hz, inPoly, keyframes, lumOf, mix, noise, pick, polyY, ramp, sec, swingKf, swingY, tx } from './lib.mjs'
import { MOMENTS } from './moments.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------- geometry shared by all moments

// The field: rows of lavender run down the slope toward a vanishing point in the valley,
// sweeping a little to the left as they come near. d is rows below the vanishing point.
const VX = 150
const VY = 104
const PITCH = 40 // cells between rows at d = DD
const DD = 92
const bend = d => -0.0034 * d * d
const Xof = (x, d) => (x + 0.5 - VX - bend(d)) / ((PITCH * d) / DD) // across the rows, in rows
const xOf = (X, d) => VX + bend(d) + (X * PITCH * d) / DD
const fieldTop = x => 119 + Math.round(1.5 * Math.sin(x * 0.03 + 0.4) + (noise(x * 0.12, 3, 5) - 0.5) * 1.4)
const TRACK = 2 // the track runs between rows 1 and 2
const TRACK_W = 0.24 // its half width, in rows
const HOUSE = { x: 160, y: 120 } // the farmhouse's front left corner, on the ground
// Aerial perspective over the field: thick haze near the horizon, thinning out to the middle
// distance and gone by the near rows.
const fieldFog = d => Math.max(0.8 * (1 - smooth((d - 13) / 18)), 0.3 * (1 - smooth((d - 36) / 30)))

// ---------------------------------------------------------------- the light, fixed before painting
// One key light a moment, and every object obeys it (notes.md, "Light"). The light is always on
// the left: by day high and a little behind the scene, at sunset low and behind it (backlight),
// at night the moon behind it at the upper left.
//   key     what and where the light is (at: its cell in the frame, or a point off the frame)
//   L       unit vector toward the light: x right, y down the screen, z toward the viewer
//   foot    x of the point on the horizon under the light: cast shadows run straight away from it
//   len     a cast shadow's length on the ground, in heights of what casts it
//   sink    how far a cast shadow sinks the ground into the shadow colour, and drop how much
//           darker (in value, 0..1 of the surface's ramp) it makes it
//   colour  the light's colour; shadow: the ambient sky colour shadows sink into
//   amb     the ambient share of a lit surface's value (how soft the contrast is)
//   locals  local lights, each with a colour and a reach in cells
const norm = (x, y, z) => {
  const n = Math.hypot(x, y, z)
  return [x / n, y / n, z / n]
}
const LIGHT = {
  day: {
    key: 'the sun, off the frame at the upper left, 45 degrees up, a little behind the scene',
    at: [-150, -120], L: norm(-0.55, -0.75, -0.25), foot: -420, len: 1, sink: 0.45, drop: 0.34, amb: 0.4,
    colour: '#fff4dc', shadow: '#4f5fa8', locals: [],
  },
  sunset: {
    key: 'the setting sun in the frame at (40, 76), 4 degrees up, behind the scene: backlight',
    at: [40, 76], L: norm(-0.8, -0.12, -0.58), foot: 40, len: 4, sink: 0.6, drop: 0.2, amb: 0.22,
    colour: '#ffc890', shadow: '#43367a', locals: [{ what: 'the middle farmhouse window', colour: '#ffd27a', reach: 2 }],
  },
  night: {
    key: 'the moon in the frame at (54, 40), behind the scene at the upper left',
    at: [54, 40], L: norm(-0.55, -0.45, -0.7), foot: 54, len: 1.4, sink: 0.4, drop: 0.2, amb: 0.25,
    colour: '#a8b4e0', shadow: '#10153a', locals: [{ what: 'three farmhouse windows', colour: '#ffd480', reach: 14 }],
  },
}
// Ground depth: a cell row d below the horizon lies F/d units away (eye one unit up), so depth
// shows foreshortened by d/F against width and height.
const F = 420
// Where the shadow of a point h cells above the ground at (x, yb) falls on the ground.
function castTip(Lt, x, yb, h) {
  const d = Math.max(1, yb - VY)
  const Z = F / d
  const X = ((x + 0.5 - VX) * Z) / F
  const xs = (Lt.foot - VX) / F // the light's bearing, sideways per unit of depth
  const g = Math.hypot(xs, 1)
  const l = (Lt.len * h * Z) / F
  const X2 = X - (l * xs) / g
  const Z2 = Math.max(Z * 0.35, Z - l / g)
  return [VX + (F * X2) / Z2 - 0.5, VY + F / Z2]
}

// How a hedge takes the light, by the height h of a point up its mound (1 at the crest) and the
// side it faces. Over `top` it is the crest. Down the flank turned to the light it is 'lit' over
// `lit` and 'body' over `body`; down the flank turned away, 'body' over `away`; under those,
// and wherever the rows on the light's side shade it, 'deep'. Backlit (sunset, night), no flank
// is 'lit': the light grazes the crests and the faces the eye sees are the plants' shaded sides.
const LIGHT_ZONES = {
  day: { top: 0.9, lit: 0.42, body: 0.2, away: 0.8 },
  sunset: { top: 0.9, lit: 1, body: 0.6, away: 0.86 },
  night: { top: 0.92, lit: 1, body: 0.62, away: 0.9 },
}

// The hedge textures, one tile per distance band: its size in cells, a spike's stem length
// under its head and the gaps between spikes down a column, and the haze step it sits in.
const TILE_BANDS = {
  near: { w: 11, h: 14, body: [3, 6], gap: [1, 2], q: 0 },
  mid: { w: 9, h: 9, body: [2, 3], gap: [1, 2], q: 1 },
  far: { w: 7, h: 6, body: [1, 2], gap: [0, 1], q: 2 },
}
const short = c => (c[1] === c[2] && c[3] === c[4] && c[5] === c[6] ? '#' + c[1] + c[3] + c[5] : c)
// A tile: the part's base colour, and down every column spikes at random offsets, each a light
// head over a stroke of the streak colour. Aligned to the cells of the frame it fills
// (userSpaceOnUse). The tiles are used only inside the field's own pattern tile, whose corner
// lies on a cell corner (a cell left of the field's first column, a cell and a half above its
// first row): placed a cell up from that corner, their rows start on cell edges, with the same
// phase as in round 3.
// Bleed. A run stroked with a tile paint is shaded, in a pixel its edge crosses, with the
// texel at that pixel's centre, which may lie in the neighbouring cell: there the tile's
// texel is not the one shown. Where that hidden texel is far from both cells' own colours, the
// edge pixel takes a colour of neither (a 1-px line at fractional sizes). Such a cell is
// painted plain, in its own texel colour.
// The colour a paint (a hedge tile or a plain colour) shows in a cell of the field.
function texelsOf(L) {
  let x0 = Infinity
  let y0 = Infinity
  for (const k of L.m.keys()) {
    const [x, y] = cellXY(k)
    if (x < -1 || x > W || y < -1 || y > H) continue
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
  }
  // The field's tile places its hedge tiles a cell and a half above its corner (see makeTile).
  return (p, x, y) => {
    const t = TEXELS.get(p)
    if (!t) return p
    return t.grid[(((x - x0 + 1) % t.w) + t.w) % t.w][(((y - y0 + 2) % t.h) + t.h) % t.h]
  }
}

// Repaint. Many cells show the same colour under more than one paint: the hedge tiles of a
// distance band share base colours, so a deep-shade cell showing its base could as well be
// painted with the stem tile beside it. Such a cell takes the paint of its row's band (it then
// needs no run of its own) or of its left neighbour (its run joins the neighbour's), where that
// paint shows the same colour there. The picture does not change; there are fewer runs, and
// fewer edges between paints, where a tile's texel from across the edge can bleed (unbleed).
function repaint(L) {
  const at = texelsOf(L)
  let n = 0
  for (let pass = 0; pass < 2; pass++) {
    const rows = new Map()
    for (const [k, p] of L.m) {
      const [x, y] = cellXY(k)
      if (x < 0 || x >= W) continue
      let r = rows.get(y)
      if (!r) rows.set(y, (r = new Map()))
      r.set(p, (r.get(p) ?? 0) + 1)
    }
    const band = new Map()
    for (const [y, r] of rows) band.set(y, [...r].reduce((a, b) => (b[1] > a[1] ? b : a))[0])
    const ks = [...L.m.keys()].sort((a, b) => a - b)
    for (const k of ks) {
      const p = L.m.get(k)
      const [x, y] = cellXY(k)
      const v = at(p, x, y)
      const b = band.get(y)
      if (b && b !== p && at(b, x, y) === v) {
        L.m.set(k, b)
        n++
        continue
      }
      const l = L.m.get(k - 1)
      if (l && l !== p && l !== b && at(l, x, y) === v) {
        L.m.set(k, l)
        n++
      }
    }
  }
  if (process.env.STATS) console.log('  repaint: ' + n + ' cells')
}

function unbleed(L, tips, o) {
  const at = texelsOf(L)
  const plain = []
  for (const [k, p] of L.m) {
    if (!TEXELS.has(p) || tips.always.has(k)) continue
    const [x, y] = cellXY(k)
    const v = at(p, x, y)
    test: for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const n = KEY(x + dx, y + dy)
      const q = L.m.get(n)
      // The spike tips that can stand over the neighbour, at rest or leaning in the gust, hide
      // the field there: what shows is the tip. The field shows there too unless a tip always
      // covers it.
      const over = tips.any.get(n)
      if (q === undefined || (q === p && !over)) continue
      const hidden = at(p, x + dx, y + dy)
      const rest = tips.rest.get(n)
      // At rest the cell itself shows only when no tip stands over it.
      const up = !tips.rest.has(k)
      const seen = [...(over ?? [])].map(c => [c, up && c === rest])
      if (q !== p && !tips.always.has(n)) seen.push([at(q, x + dx, y + dy), up && rest === undefined])
      for (const [vn, still] of seen) {
        // A line needs the two sides alike: where they differ, the stray texel reads as part of
        // their edge.
        // Where the two sides differ a little more, only a texel much further off shows as a line.
        const d = apart(v, vn)
        if (d > o.same2) continue
        const off = Math.min(apart(hidden, v), apart(hidden, vn))
        if (d > o.same ? off >= FAR_T2 : off > (still ? o.bleed : o.lean)) {
          plain.push([k, v])
          break test
        }
      }
    }
  }
  for (const [k, v] of plain) L.m.set(k, v)
  if (process.env.STATS) console.log('  unbleed: ' + plain.length + ' cells plain of ' + L.m.size)
}
const FAR_T2 = 40

// The field is one pattern tile (a cached bitmap: drawn as runs, it took the player past its
// limit), and at fractional sizes the bitmap is resampled: a cell's colour blurs a pixel into
// its neighbours. Under a spike tip at rest that showed: a field cell far from the tip, beside a
// field cell alike to the tip, bled into that cell along the tip's edge as a line. The cell
// beside it is drawn again, in the colour it shows, in a plain layer over the tile (crisp at
// every size, and the same picture in every pose): the tip's edge then lies over a crisp edge.
function coverTips(L, tips, o) {
  const at = texelsOf(L)
  const shown = (p, x, y) => (TEXELS.has(p) ? at(p, x, y) : p)
  const cover = new Layer('cover')
  cover.noTile = true
  cover.enc = { edge: true }
  for (const [k, t] of tips.rest) {
    const p = L.m.get(k)
    if (p === undefined) continue
    const [x, y] = cellXY(k)
    const v = shown(p, x, y)
    if (apart(v, t) <= o.lift) continue
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const n = KEY(x + dx, y + dy)
      const q = L.m.get(n)
      if (q === undefined || tips.rest.has(n)) continue
      const vn = shown(q, x + dx, y + dy)
      if (apart(t, vn) <= o.same2 && apart(v, vn) > o.lift) cover.set(x + dx, y + dy, vn)
    }
  }
  if (process.env.STATS) console.log('  cover: ' + cover.m.size + ' cells')
  return cover
}
// Per moment (seam fix): unbleed's alike thresholds (same: any far texel; up to same2: only a
// texel FAR_T2 off), and how near (levels, every channel) two colours of a layer must be to
// merge. Sunset has the least room in the size limit.
const SEAM = {
  day: { same: 10, same2: 24, merge: 4, lean: 10, bleed: 10, lift: 30 },
  sunset: { same: 10, same2: 10, merge: 6, lean: Infinity, bleed: 10, lift: 40 },
  night: { same: 10, same2: 24, merge: 4, lean: 40, bleed: 10, lift: 40 },
}

// Each tile's texels, column by column: 'url(#id)' -> { w, h, grid }, for the bleed check.
const TEXELS = new Map()
function makeTile(id, o, [base, streak, head], seed) {
  const r = rng(seed)
  const spikes = new Layer(id)
  const all = []
  const grid = []
  for (let x = 0; x < o.w; x++) {
    const col = new Array(o.h).fill(null)
    let y = Math.floor(r() * o.h)
    const end = y + o.h
    for (;;) {
      const n = o.body[0] + Math.floor(r() * (o.body[1] - o.body[0] + 1))
      if (y + 1 + n + o.gap[0] > end) break
      col[y % o.h] = head
      for (let j = 1; j <= n; j++) col[(y + j) % o.h] = streak
      y += 1 + n + o.gap[0] + Math.floor(r() * (o.gap[1] - o.gap[0] + 1))
    }
    col.forEach((c, j) => {
      all.push(c ?? base)
      if (c) spikes.set(x, j, c)
    })
    grid.push(col.map(c => c ?? base))
  }
  TEXELS.set('url(#' + id + ')', { w: o.w, h: o.h, grid })
  // The plain colour that stands for the tile in the encoder: its mean.
  const sum = [0, 0, 0]
  for (const c of all) for (let i = 0; i < 3; i++) sum[i] += parseInt(c.slice(1 + i * 2, 3 + i * 2), 16)
  setTone('url(#' + id + ')', '#' + sum.map(v => Math.round(v / all.length).toString(16).padStart(2, '0')).join(''))
  let s = "<pattern id='" + id + "' patternUnits='userSpaceOnUse' width='" + o.w + "' height='" + o.h + "' y='-1'><rect width='" + o.w + "' height='" + o.h + "' fill='" + short(base) + "'/>"
  // The spikes over the base, written by the seam-proof encoder: where a head or stroke meets
  // another inside a screen pixel, the base must not show between them. Rows j of the tile lie
  // from j to j + 1.
  s += emitSafe(spikes, { oy: -0.5, back: 'none', q: "'", under: () => base, maxRows: Infinity })
  return s + '</pattern>'
}

// The peaks: pyramids with jagged flanks. The skyline falls kl rows a cell to the left of the
// apex and kr to the right, easing off with distance; facets fan out from the summit between
// spurs, and the main spur parts the face turned to the light (left) from the shaded one.
// Above `rock` rows under the summit the faces are rock with snow in the gullies; below, snow
// with ribs of rock.
const FAR_PEAKS = [
  { x: 16, y: 72, kl: 0.35, kr: 0.42, z: 1, spur: 0.1, rock: 6, seed: 37 },
  { x: 112, y: 66, kl: 0.5, kr: 0.62, z: 1, spur: 0.05, rock: 8, seed: 41 },
  { x: 84, y: 56, kl: 0.62, kr: 0.55, z: 2, spur: 0.04, rock: 12, seed: 31 },
]
const NEAR_PEAKS = [
  { x: 318, y: 64, kl: 0.6, kr: 0.5, z: 1, spur: 0.1, rock: 8, seed: 29 },
  { x: 134, y: 72, kl: 0.6, kr: 0.75, z: 2, spur: 0.05, rock: 8, seed: 27 },
  { x: 246, y: 43, kl: 1.0, kr: 0.8, z: 2, spur: 0.08, rock: 16, seed: 13 },
  { x: 166, y: 50, kl: 0.85, kr: 0.95, z: 3, spur: 0.06, rock: 16, seed: 11 },
  { x: 284, y: 47, kl: 0.85, kr: 0.62, z: 3, spur: 0.12, rock: 15, seed: 17, ease: 0.2 },
  { x: 212, y: 30, kl: 1.2, kr: 1.05, z: 5, spur: 0.02, rock: 30, seed: 19, ease: 0.5, w: 60, arete: 22 },
]

// ---------------------------------------------------------------- the scene

function scene(name) {
  const P = MOMENTS[name]
  const Lt = LIGHT[name]
  // Objects whose cast shadow the light check marks.
  const probes = []
  const probe = (x, yb, h) => probes.push({ base: [x, yb], tip: castTip(Lt, x, yb, h) })
  const parts = []
  const part = (pin, layers) => parts.push([pin, layers.filter(L => L && (L.wrap || L.under || L.raw || L.size))])
  const anim = (cls, style = '', extra = '') => ({ cls, style, extra })
  const kfs = new Map() // shared drift keyframes, by name
  const haze = P.haze
  // What has been painted so far, for the lake's mirror.
  const seen = new Map()
  const see = L => {
    for (const [k, c] of L.m) seen.set(k, c)
  }

  // ------------------------------------------------ sky
  // Bands of the sky's ramp, three rows high above and two lower down, dithered into each other
  // by the encoder. Around the sun (or the moon) the bands bulge up.
  const edges = []
  for (let t = -40; t < 64; t += 3) edges.push(t)
  for (let t = 64; t < 200; t += 2) edges.push(t)
  const bandCols = edges.map((e, i) => ramp(P.sky, (e + (edges[i + 1] ?? e + 2)) / 2 - 0.5))
  const band = t => {
    let i = 0
    while (i < edges.length - 1 && edges[i + 1] <= t) i++
    return i
  }
  const G = P.glow
  const lift = (x, y) => G.lift * Math.exp(-(((x + 0.5 - G.x) / G.rx) ** 2) - ((y + 0.5 - G.y) / G.ry) ** 2)
  const skyT = (x, y) => y + lift(x, y)
  const skyAt = (x, y) => bandCols[band(skyT(x, y))]
  const sky = new Layer('sky')
  for (let y = -1; y < 122; y++) for (let x = 0; x < W; x++) sky.set(x, y, skyAt(x, y))
  see(sky)

  // Rays from the setting sun fanning up through the sky: wedges of the sun's light laid thinly
  // over it (the group is mostly see-through), stronger near the sun.
  const rays = new Layer('rays')
  let rayGroup = null
  if (P.rays) {
    const { x: rx, y: ry, list, reach } = P.rays
    for (let y = -1; y < 100; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x + 0.5 - rx
        const dy = ry - (y + 0.5)
        const d = Math.hypot(dx, dy)
        if (d < 12 || dy < 0 || d > reach) continue
        const a = (Math.atan2(dy, dx) * 180) / Math.PI
        if (list.some(([deg, w]) => Math.abs(a - deg) < w * (1 - d / reach / 2.2))) rays.set(x, y, d < reach * 0.45 ? P.sun.halo : P.rays.far)
      }
    }
    rays.anim = anim('ry')
    rayGroup = { wrap: "<g opacity='.2'>", end: '</g>', layers: [rays] }
  }
  // Stars, a dozen of them dimming for a moment now and then.
  const starLayers = []
  if (P.stars) {
    const r = rng(211)
    const still = new Layer('stars')
    for (let i = 0; i < 120; i++) {
      const x = Math.floor(r() * W)
      const y = Math.floor(2 + Math.pow(r(), 1.3) * 86)
      if (P.moon && Math.hypot(x - P.moon.x, y - P.moon.y) < 14) continue
      if (i < 12) {
        const L = new Layer('star' + i)
        L.set(x, y, P.stars[0])
        if (i < 5) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) L.set(x + dx, y + dy, P.stars[2])
        const d = 5 * (1 + Math.floor(r() * 3))
        L.anim = anim('tk', '--d:' + d + 's;--l:' + sec(-r() * d) + 's')
        starLayers.push(L)
      } else still.set(x, y, P.stars[r() < 0.3 ? 1 : 2])
    }
    starLayers.unshift(still)
  }

  // The moon, lit from the upper left, with a faint dotted halo.
  const moon = new Layer('moon')
  if (P.moon) {
    const { x: cx, y: cy, r: R, tones, halo } = P.moon
    const craters = new Set(['-2,-2', '-1,-2', '-2,-1', '1,1', '2,1', '1,2', '-1,2', '2,-3'])
    for (let y = -R - 3; y <= R + 2; y++) {
      for (let x = -R - 3; x <= R + 2; x++) {
        const d = Math.hypot(x + 0.5, y + 0.5)
        if (d >= R) {
          if (d < R + 1.6 && (x + y) % 2 === 0) moon.set(cx + x, cy + y, halo)
          continue
        }
        const nz = Math.sqrt(R * R - d * d) / R
        let v = 0.5 + 0.5 * ((-(x + 0.5) / R) * 0.45 + (-(y + 0.5) / R) * 0.5 + nz * 0.55)
        if (craters.has(x + ',' + y)) v -= 0.22
        moon.set(cx + x, cy + y, tone(tones, v, x, y, 0.4))
      }
    }
  }

  // The setting sun, sitting in the low col on the left; its lower part goes behind the hills.
  const sun = new Layer('sun')
  if (P.sun) {
    const { x: cx, y: cy, r: R, tones, halo } = P.sun
    for (let y = cy - R - 3; y <= cy + R; y++) {
      for (let x = cx - R - 3; x <= cx + R + 3; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R
        if (d >= 1) {
          if (d < 1 + 1 / R) sun.set(x, y, halo)
          else if (d < 1 + 2.4 / R && (x + y) % 2 === 0) sun.set(x, y, halo)
          continue
        }
        sun.set(x, y, tone(tones, 1 - 0.9 * Math.pow(d, 4) - 0.15 * smooth((y - cy + R) / (2 * R)), x, y, 0.25))
      }
    }
  }

  // ------------------------------------------------ clouds
  // Streaks of cumulus. By day and night lit along the top; at sunset lit from below, warmest
  // toward the sun. Each drifts left and back a cell at a time.
  const C = P.cloud
  const CLOUDS = [
    { seed: 1, puffs: [[232, 22, 30, 5], [262, 18, 22, 5], [206, 25, 16, 3], [290, 23, 18, 3]], drift: [70, 14, 10] },
    { seed: 2, puffs: [[92, 28, 22, 4], [116, 25, 14, 3.5], [72, 31, 12, 3]], drift: [90, 12, 40] },
    { seed: 3, puffs: [[150, 40, 14, 2.5], [136, 42, 9, 2]], drift: [60, 10, 22] },
    { seed: 4, puffs: [[292, 74, 22, 3], [266, 77, 14, 2.5]], drift: [80, 8, 30] },
    { seed: 5, puffs: [[22, 48, 18, 3], [6, 50, 10, 2.5]], drift: [76, 10, 5] },
  ]
  const cloudLayer = c => {
    const L = new Layer('cloud' + c.seed)
    const cells = new Set()
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (const [px, py, rx, ry] of c.puffs) {
      x0 = Math.min(x0, px - rx - 2)
      x1 = Math.max(x1, px + rx + 2)
      y0 = Math.min(y0, py - ry - 3)
      y1 = Math.max(y1, py + ry + 2)
    }
    const base = Math.max(...c.puffs.map(p => p[1] + p[3] * 0.55))
    for (let y = Math.floor(y0); y <= y1; y++) {
      for (let x = Math.floor(x0); x <= x1; x++) {
        if (y > base + Math.round(Math.sin(x * 0.3 + c.seed) * 0.6)) continue
        let q = -Infinity
        for (const [px, py, rx, ry] of c.puffs) {
          // Billowed tops: the outline rises and falls along the streak.
          const top = 1 + 0.35 * Math.sin((x + c.seed * 9) * 0.45) * smooth((py - y) / ry)
          q = Math.max(q, top - (((x + 0.5 - px) / rx) ** 2 + ((y + 0.5 - py) / ry) ** 2))
        }
        if (q + (noise(x * 0.3, y * 0.8, c.seed) - 0.5) * 0.35 > 0) cells.add(x + ',' + y)
      }
    }
    const has = (x, y) => cells.has(x + ',' + y)
    for (const k of cells) {
      const [x, y] = k.split(',').map(Number)
      // Depth from the lit edge.
      let e = 0
      while (e < 5 && has(x, y + (C.below ? 1 : -1) * (e + 1))) e++
      let v = C.base + C.rim * [1, 0.7, 0.45, 0.25, 0.1, 0][e]
      if (!has(x - 1, y) && e > 0) v += 0.08
      v += C.sun * Math.exp(-(((x - C.lx) / C.lw) ** 2))
      v += (noise(x * 0.25, y * 0.6, c.seed + 9) - 0.5) * 0.06
      L.set(x, y, tone(C.tones, v, x, y, 0.1))
    }
    const [d, a, l] = c.drift
    kfs.set('d' + a, swingKf('d' + a, -a))
    L.anim = anim('cd d' + a, '--d:' + d + 's;--l:' + -l + 's')
    // Two coats (seam fix): where a cloud's edge falls inside a pixel, the mountain under the
    // cloud, not the one beside it, shows through the rest of that pixel; a second coat halves it.
    L.coats = 2
    return L
  }
  const clouds = CLOUDS.map(cloudLayer)
  const backClouds = clouds.filter((c, i) => i !== 3)
  const lowCloud = clouds[3]

  // ------------------------------------------------ mountains
  const farRange = range(P, FAR_PEAKS, { name: 'far', fog: 0.5, foot: 0.45, base: 102, footH: 30, snow: 86, flat: true })
  const massif = range(P, NEAR_PEAKS, { name: 'massif', fog: 0, foot: 0.9, base: 102, footH: 30, snow: 84 })
  see(farRange)
  see(massif)

  // Mist at the foot of the peaks: thin see-through wisps drifting slowly, each a lens that
  // thins to a row at its ends and frays into a dotted tail.
  const mist = new Layer('mist')
  {
    const r = rng(88)
    for (let i = 0; i < 13; i++) {
      const cx = -20 + r() * 360
      const cy = 89 + r() * 19
      const half = 18 + r() * 34
      const th = 0.8 + r() * 1.4
      const wave = r() * 6
      for (let x = Math.floor(cx - half - 6); x <= cx + half + 6; x++) {
        const t = (x + 0.5 - cx) / half
        const yc = cy + Math.sin(x * 0.045 + wave) * 1.3
        if (Math.abs(t) >= 1) {
          // The frayed tail: every other cell, then every third.
          const o = Math.abs(t) - 1
          if (o * half < 6 && (x + i) % (o * half < 3 ? 2 : 3) === 0) mist.set(x, Math.round(yc), P.mist[0])
          continue
        }
        const w = th * (1 - t * t)
        for (let y = Math.round(yc - w); y <= Math.round(yc + w); y++) mist.set(x, y, Math.abs(y + 0.5 - yc) < w * 0.45 && w > 0.9 ? P.mist[1] : P.mist[0])
      }
    }
  }
  kfs.set('d6', swingKf('d6', -6))
  mist.anim = anim('cd d6', '--d:50s;--l:-12s', " opacity='.55'")

  // ------------------------------------------------ the valley
  // The valley floor: a far meadow plane from the feet of the peaks to the field, in one
  // gradient from the mist it fades into at the top to the meadow's own colour by the field.
  // Every row is one colour across the frame, so the encoder lays the rows as bands and dithers
  // each band into the next. The peaks' feet and the foothills sink into the same mist above it.
  // A lake lies under the peaks as one calm shape that mirrors them.
  const valley = new Layer('valley')
  const V = P.valley
  const VTOP = 100
  const VEND = 124
  for (let y = VTOP; y < VEND; y++) {
    const c = V.floor[clamp(Math.floor(((y - VTOP) / (VEND - VTOP)) * V.floor.length), 0, V.floor.length - 1)]
    for (let x = 0; x < W; x++) valley.set(x, y, c)
  }
  const LAKE = { cx: 222, cy: 112.5, rx: 33, ry: 4.4 }
  const inLake = (x, y) => ((x + 0.5 - LAKE.cx) / LAKE.rx) ** 2 + ((y + 0.5 - LAKE.cy) / LAKE.ry) ** 2 < 1
  const lake = new Layer('lake')
  const shore = LAKE.cy - LAKE.ry
  for (let y = Math.floor(LAKE.cy - LAKE.ry - 1); y <= LAKE.cy + LAKE.ry + 1; y++) {
    for (let x = LAKE.cx - LAKE.rx - 1; x <= LAKE.cx + LAKE.rx + 1; x++) {
      if (!inLake(x, y)) continue
      // A low view across still water: each row mirrors a tall stretch of what stands behind
      // it, taken in broad blocks so the reflection lies in calm bands. The far shore is a dark
      // line.
      const sy = Math.round(shore - (y - shore) * 8 - 2)
      const bx = Math.floor(x / 8) * 8 + 4
      let lum = 0
      for (let k = -1; k <= 1; k++) for (const ox of [-3, 0, 3]) lum += lumOf(seen.get(KEY(bx + ox, sy + k)) ?? skyAt(bx + ox, sy + k)) / 9
      let v = 0.05 + 1.05 * lum - P.lake.dull
      if (!inLake(x, y - 1)) v = 0.15
      lake.set(x, y, pick(P.lake.tones, v))
    }
  }
  see(valley)
  see(lake)
  // Ripples on the lake (no glints: neither the sun nor the moon stands over it, so no path
  // of light crosses the water): short streaks where the reflection breaks a step lighter.
  const glints = []
  for (let k = 0; k < 3; k++) {
    const r = rng(500 + k)
    const L = new Layer('glint' + k)
    for (let i = 0; i < 12; i++) {
      const x = Math.round(LAKE.cx + (r() * 2 - 1) * LAKE.rx * 0.8)
      const y = Math.round(LAKE.cy - LAKE.ry + 1 + r() * (LAKE.ry * 2 - 2))
      const len = 1 + Math.floor(r() * 3)
      for (let j = 0; j < len; j++) if (inLake(x + j, y) && inLake(x + j, y - 1) && inLake(x + j, y + 1)) L.set(x + j, y, P.lake.tones[3])
    }
    L.anim = anim('gl', '--l:' + f2(-k * 1.2) + 's', k ? " opacity='0'" : '')
    glints.push(L)
  }

  // ------------------------------------------------ foothills
  // A wooded hill on the left that the far range rises behind, a lower one on the right: firs
  // along the crest, their crowns lit on the left, in the haze of the valley.
  const hills = new Layer('hills')
  const hill = (pts, x0, x1, fog, seed) => {
    const crest = x => polyY(pts, x + 0.5)
    const spike = new Map()
    const r = rng(seed)
    for (let x = x0; x < x1; x += 2 + Math.floor(r() * 3)) {
      const h = 2 + Math.floor(r() * 5)
      for (let i = -3; i <= 3; i++) {
        const t = h - Math.abs(i) * (1.6 + r() * 0.3)
        if (t > 0) spike.set(x + i, Math.max(spike.get(x + i) ?? 0, t))
      }
    }
    for (let x = x0; x < x1; x++) {
      const top = Math.round(crest(x) - (spike.get(x) ?? 0))
      const col = noise(x * 0.42, 0.5, seed)
      const litEdge = col > noise((x - 1) * 0.42, 0.5, seed) + 0.04
      for (let y = top; y < VTOP + 2; y++) {
        const e = y - top
        // The crowns' lit edges near the crest; lower down the wood is one dark mass.
        let v = e < 4 ? (litEdge ? 0.55 : 0.3) : 0.22
        if (e < 1) v += 0.25
        const q = fogStep(fog + 0.9 * smooth((y - 84) / 17), x, y, 3, seed, 0.15, 0.2)
        hills.set(x, y, hz(P.forest, v, q, 3, haze))
      }
    }
  }
  hill([[-12, 84], [6, 85], [26, 87], [46, 91], [66, 95], [86, 98], [106, 101], [126, 105], [146, 109], [162, 114], [172, 118]], -4, 168, 0.3, 61)
  hill([[236, 110], [248, 106], [262, 102], [278, 99], [296, 97], [314, 95], [332, 94]], 240, W + 4, 0.25, 67)
  see(hills)

  // ------------------------------------------------ the field
  // Every cell of the field has a still colour and may carry a tip over it: a flower head (or
  // part of one) that leans in the gusts. The tips live in band layers across the field, each
  // band leaning in its turn. A cell painted later (nearer) hides any tip under it.
  const NB = 8
  const lean2 = [] // the upper heads of near spikes: lean two cells
  const lean1 = [] // the rest of the heads and the tops of near stems: lean one cell
  for (let b = 0; b < NB; b++) {
    lean2.push(new Layer('w2-' + b))
    lean1.push(new Layer('w1-' + b))
  }
  const field = new Layer('field')
  const owner = new Map()
  const putBase = (x, y, c) => {
    if (x < -2 || x > W + 1 || y > H) return
    field.set(x, y, c)
    const k = KEY(x, y)
    const o = owner.get(k)
    if (o) {
      o.m.delete(k)
      owner.delete(k)
    }
  }
  const putTip = (L, x, y, c) => {
    if (x < -2 || x > W + 1 || y > H) return
    const k = KEY(x, y)
    const o = owner.get(k)
    if (o && o !== L) o.m.delete(k)
    L.set(x, y, c)
    owner.set(k, L)
  }
  // Which band a spot of the field belongs to: gusts come from the far right and run to the
  // near left.
  const bandOf = (X, d) => clamp(Math.floor(X * 0.42 + (DD / d) * 0.7 + 2.1), 0, NB - 1)
  const soil = P.soil
  const fol = P.foliage

  // The field: rows of lavender, each one continuous hedge of flower spikes on a low mound, run
  // down the slope toward the farmhouse with bare furrows between them. Far off the rows close
  // up into a fine striped texture sunk in haze.
  //
  // Painted as a height field: each column of the frame is swept from the horizon down, and
  // every strip of ground under a hedge raises a column of the hedge's height over itself, the
  // nearer over the farther. A cell shows the hedge (and the point across it) that rose there
  // last, or the bare ground. Across a hedge, s runs from -1 at its left foot to 1 at its right;
  // the mound faces up at the crest and sideways down its flanks, and each point takes the key
  // light on that facing unless the rows on the light's side shade it.
  //
  // The spikes themselves are textures: one pattern tile for each part of a hedge (crest,
  // flank in the light, flank in shade, the stems at its foot) in each distance band, stroked
  // into the runs of that part. Each tile is a dense comb of short vertical strokes with a light
  // head, so the hedges read as hundreds of spikes while a run still costs a run.
  const HW = 0.36 // a hedge's half width, in rows: the furrows take the rest
  const HR = 0.3 // its height, in rows
  const hgt = d => (HR * PITCH * d) / DD // in cells, at depth d
  const onTrack = (X, d) => Math.abs((X - TRACK) / TRACK_W) < 1 && d > 15
  const DFAR = 20 // nearer than this the rows show one by one
  const bandAt = (x, d) => {
    const e = d + (noise(x * 0.15, d * 0.2, 13) - 0.5) * 8
    return e < 30 ? 'far' : e < 55 ? 'mid' : 'near'
  }

  // The light on the mounds. Rows run straight away from the eye, so across a row only the key
  // light's sideways and upward parts count: the side it comes from, and how steeply it falls.
  const Lx = Lt.L[0]
  const Lup = -Lt.L[1]
  const away = Lx < 0 ? 1 : -1 // shadows fall to the right of the rows when the light is on the left
  const zOf = s => HR * Math.sqrt(Math.max(0, 1 - s * s))
  // A row's shadow across the furrows: the height of its edge over the ground u rows from the
  // row's centre, on the side away from the light. The light drops `slope` per row across.
  const slope = Lup / Math.max(0.05, Math.abs(Lx))
  const SH = []
  for (let i = 0; i <= 400; i++) {
    let m = -1
    for (let j = -32; j <= 32; j++) m = Math.max(m, zOf(j / 32) - (i / 100 - (j / 32) * HW) * slope)
    SH.push(m)
  }
  const shadeH = u => (u < 0 ? HR : u >= 4 ? -1 : SH[Math.round(u * 100)])
  // Shade from the rows on the light's side, at height z, p rows from the centre of the row
  // next on the light's side.
  const shadedAt = (p, z) => z < Math.max(shadeH(p), shadeH(p + 1), shadeH(p + 2))
  const pmod = v => v - Math.floor(v)
  // The parts of a hedge: the crest, the flank in the light, the flank half in shade and the one
  // in deep shade (the face toward the viewer), and the stems at its foot.
  const ZT = LIGHT_ZONES[name]
  const zoneOf = (s, band) => {
    const h = Math.sqrt(Math.max(0, 1 - s * s))
    if (Math.abs(s) > 0.9 && band === 'near') return 'stem'
    if (h > ZT.top) return 'top'
    if (shadedAt(s * HW * away + 1, zOf(s))) return 'deep'
    if (s * away < 0) return h > ZT.lit ? 'lit' : h > ZT.body ? 'body' : 'deep'
    return h > ZT.away ? 'body' : 'deep'
  }
  // At sunset a broad band of warm light lies across the field nearer the sun, left and middle,
  // cooling toward the right: there the crests and the flanks under them take warm tiles.
  const warmAt = (x, y) => (P.hedge.tips.length < 3 ? 0 : clamp(1.3 - (x - 40) / 200, 0, 1) * (0.25 + 0.75 * Math.exp(-(((y - 148 - (x - 40) * 0.07) / 22) ** 2))))
  const isWarm = (x, y) => warmAt(x, y) + (noise(x * 0.08, y * 0.16, 33) - 0.5) * 0.4 > 0.46

  // The tiles, made as they are first used.
  const tileDefs = []
  const tileIds = new Map()
  const hzc = (c, q) => (q ? mix(c, haze, (q / 3) * 0.85) : c)
  const tile = (band, zone) => {
    const key = band + zone
    let id = tileIds.get(key)
    if (!id) {
      id = 'T' + String.fromCharCode(97 + tileIds.size)
      tileIds.set(key, id)
      const o = TILE_BANDS[band]
      tileDefs.push(makeTile(id, o, P.hedge[zone].map(c => hzc(c, o.q)), 700 + tileIds.size * 13))
    }
    return 'url(#' + id + ')'
  }
  const tileBase = (band, zone) => hzc(P.hedge[zone][0], TILE_BANDS[band].q)

  // Bare ground (earth and the track) where shadows can fall: cell -> [palette, value, haze,
  // shaded].
  const ground = new Map()
  const putGround = (x, y, pal, v, q) => {
    putBase(x, y, hz(pal, v, q, 3, haze))
    ground.set(KEY(x, y), [pal, v, q])
  }
  // The same ground in shadow: darker and cooler, sunk into the ambient sky colour.
  const shadowPals = new Map()
  const inShadow = pal => {
    if (!shadowPals.has(pal)) shadowPals.set(pal, pal.map(c => mix(c, Lt.shadow, Lt.sink)))
    return shadowPals.get(pal)
  }
  const darken = (x, y, soft, deep) => {
    const k = KEY(x, y)
    const g = ground.get(k)
    if (!g || g[3]) return
    // The far end of a shadow is dithered: every other cell.
    if (soft && (x + y) % 2) return
    putBase(x, y, hz(inShadow(g[0]), g[1] - Lt.drop, Math.max(0, g[2] - (deep ? 1 : 0)), 3, haze))
    g[3] = true
  }
  // A cast shadow from columns standing on the ground: each [x, yb, h] throws a line of shade
  // from its foot to where its top's shadow falls; together they fill the shadow's shape. The
  // last third is dithered when `soft`. Shadows only fall on bare ground (earth and track).
  const castShadow = (cols, soft, deep) => {
    for (const [x, yb, h] of cols) {
      if (h < 0.5) continue
      const [tx, ty] = castTip(Lt, x, yb, h)
      const pts = line(Math.round(x), Math.round(yb), Math.round(tx), Math.round(ty))
      pts.forEach(([px, py], i) => darken(px, py, soft && i > pts.length * 0.66, deep))
    }
  }
  // A contact shadow: the ground row right under an object's foot, hard.
  const contact = (x, y) => {
    const g = ground.get(KEY(x, y))
    if (g) putBase(x, y, hz(inShadow(inShadow(g[0])), Math.max(0, g[1] - 0.2), g[2], 3, haze))
  }

  // What shows in each cell stands on the ground this far down (for what stands among the rows,
  // and for the spikes, which stop at anything nearer); and a plain colour for each tiled cell.
  const depth = new Map()
  const flat = new Map()
  const tops = [] // the top cell of a hedge in a column: [x, y, row, depth, band]
  const yEnd = H + Math.ceil(hgt(H + 24 - VY)) + 1
  for (let x = -2; x < W + 2; x++) {
    const top = fieldTop(x)
    const cov = []
    for (let yg = top; yg <= yEnd; yg++) {
      const d = yg - VY
      if (d < DFAR) continue
      const X = Xof(x, d)
      if (onTrack(X, d)) continue
      if (((x + 0.5 - 38) / 26) ** 2 + ((yg + 0.5 - 167) / 9) ** 2 < 1) continue // the rocks' clearing
      const k = Math.floor(X)
      const s = ((X - k - 0.5) / HW) * (1 + (hash(x, yg, k) - 0.5) * 0.1)
      if (Math.abs(s) >= 1) continue
      // Each column of spikes a little taller or shorter than its neighbours: a ragged top.
      const hc = hgt(d) * Math.sqrt(1 - s * s) * (0.88 + 0.24 * hash(x, k, 77))
      for (let y = Math.max(top, Math.round(yg - hc)); y <= Math.min(yg, H + 1); y++) cov[y - top] = { k, s, yg, d }
    }
    for (let y = top; y <= H + 1; y++) {
      const c = cov[y - top]
      const d = y - VY
      const kc = KEY(x, y)
      const q = fogStep(fieldFog(d), x, y, 3, 9, 0.3)
      if (!c && d < DFAR) {
        putBase(x, y, tile('far', 'far'))
        flat.set(kc, tileBase('far', 'far'))
        depth.set(kc, y)
        continue
      }
      if (!c) {
        const X = Xof(x, d)
        // Bare ground: in the shade of the rows on the light's side, or in the light.
        const inShade = shadedAt(pmod((X - 0.5) * away), 0)
        if (onTrack(X, d)) {
          // The track: pale dust, two ruts, grass on the crown nearer in.
          const u = (X - TRACK) / TRACK_W
          let v = 0.72
          if (Math.abs(Math.abs(u) - 0.5) < 0.12 && d > 30) v = 0.45
          if (u < -0.8 && d > 40) v = 0.5
          if (Math.abs(u) < 0.16 && d > 50 && noise(x * 0.5, y * 0.4, 4) > 0.45) putGround(x, y, fol, 0.6, 0)
          else putGround(x, y, soil, v, q)
        } else putGround(x, y, soil, d > 50 ? 0.45 : 0.3, q)
        if (inShade) darken(x, y, false, false)
        depth.set(kc, y)
        continue
      }
      const band = bandAt(x, c.d)
      let zone = 'far'
      if (band !== 'far') {
        zone = zoneOf(c.s, band)
        if (zone === 'top' && isWarm(x, y)) zone = 'topW'
        if (zone === 'body' && P.hedge.bodyW && isWarm(x, y)) zone = 'bodyW'
        if (band === 'mid' && zone === 'lit') zone = 'top'
        if (band === 'mid' && zone === 'stem') zone = 'deep'
      }
      putBase(x, y, tile(band, zone))
      flat.set(kc, tileBase(band, zone))
      ground.delete(kc)
      depth.set(kc, c.yg)
      const above = cov[y - 1 - top]
      if (y > top && (!above || above.k !== c.k)) tops.push([x, y, c, band])
    }
  }

  // The farmhouse sits at the far end of the track; it is painted into the field so the
  // nearest rows can stand in front of its foot. Its shadow falls first.
  const house = farmhouse(P, Lt, HOUSE.x, HOUSE.y)
  castShadow(house.cols, false, true)
  for (const [x, y, c] of house.cells) {
    putBase(x, y, c)
    flat.delete(KEY(x, y))
    depth.set(KEY(x, y), HOUSE.y)
  }
  for (const [x, y] of house.foot) contact(x, y)
  probe(HOUSE.x + 6, HOUSE.y, 11)
  // At night the lit windows throw a warm pool on the track and the rows before the house: on
  // the bare ground fading out in a dither over its reach, on the rows a scatter of heads that
  // catch it, thinning out away from the house, so the spikes still show through.
  if (P.moon && P.lamp) {
    const reach = Lt.locals[0].reach
    const glow = [P.lamp.cols[1], P.lamp.cols[0]]
    for (let y = HOUSE.y + 1; y < HOUSE.y + 12; y++) {
      for (let x = HOUSE.x - reach; x < HOUSE.x + 17 + reach; x++) {
        const r = Math.hypot((x + 0.5 - HOUSE.x - 8.5) / (reach + 4), (y + 0.5 - HOUSE.y) / 10)
        if (r > 1) continue
        const k = KEY(x, y)
        const g = ground.get(k)
        const base = g ? hz(g[3] ? inShadow(g[0]) : g[0], g[1], g[2], 3, haze) : flat.get(k)
        if (!base) continue
        if (!g && (r > 0.7 || hash(x, y, 61) > 0.75 - r)) continue
        if (r > 0.7 && (x + y) % 2) continue
        if (r > 0.85 && (x + 2 * y) % 4) continue
        putBase(x, y, mix(base, glow[r < 0.4 ? 1 : 0], r < 0.4 ? 0.5 : 0.32))
      }
    }
  }

  // The two rocks on the left stand among the rows, in front of the farther ones.
  {
    const tmp = new Layer('tmp')
    const R1 = [[22, 160], [27, 152], [36, 150], [43, 155], [45, 162], [23, 164]]
    const R2 = [[42, 162], [47, 157], [53, 159], [54, 164], [42, 165]]
    const cols = []
    for (const [pts, base] of [[R1, 164], [R2, 165]]) {
      for (let x = Math.min(...pts.map(p => p[0])); x <= Math.max(...pts.map(p => p[0])); x++) {
        let t = base
        while (t > 140 && inPoly(pts, x + 0.5, t - 0.5)) t--
        cols.push([x, base, base - t])
      }
    }
    castShadow(cols, true)
    boulder(P, Lt, tmp, R1, 3)
    boulder(P, Lt, tmp, R2, 5)
    for (const [k, c] of tmp.m) {
      if ((depth.get(k) ?? 0) > 165) continue
      const [x, y] = cellXY(k)
      putBase(x, y, c)
      ground.delete(k)
      flat.delete(k)
      depth.set(k, 165)
    }
    for (let x = 22; x <= 54; x++) contact(x, x < 43 ? 165 : 166)
    probe(34, 164, 14)
  }
  // Where the rows' shadows fall: two hedges left of the track, near.
  for (const X of [-3.5, 0.5]) probe(xOf(X, 72), VY + 72, hgt(72))

  // The spikes along each hedge's top: one cell wide, two to five tall near, one or two farther
  // off, their heads lit where the light reaches the crest (warm in the band of sunset light).
  // They stand over whatever lies behind and lean in the gusts.
  const tipCol = (x, y) => {
    const T = P.hedge.tips
    const w = warmAt(x, y) + (hash(x, y, 95) - 0.5) * 0.3
    return T[clamp(Math.floor(w * T.length), 0, T.length - 1)]
  }
  for (const [x, y, c, band] of tops) {
    if (band === 'far') continue
    const near = band === 'near'
    if (hash(x, c.k, 91) > (near ? 0.72 : 0.6)) continue
    const hs = near ? 2 + Math.floor(hash(x, c.k, 92) * 4) : 1 + Math.floor(hash(x, c.k, 92) * 2)
    const b = bandOf(c.k + 0.5, c.d)
    const stalk = P.hedge.stalk[isWarm(x, y) ? 1 : 0]
    for (let j = 1; j <= hs; j++) {
      const yy = y - j
      if ((depth.get(KEY(x, yy)) ?? -1) > c.yg) break
      const last = j === hs
      putTip(last && near && hs >= 3 ? lean2[b] : lean1[b], x, yy, last ? tipCol(x, yy) : stalk)
    }
  }
  see(field)
  // ------------------------------------------------ the tree on its outcrop (right corner)
  const knoll = new Layer('knoll')
  const crown = new Layer('crown')
  const tree = new Layer('tree')
  outcrop(P, Lt, knoll, tree, crown)
  knoll.back = tree.back = crown.back = true
  crown.anim = anim('ts')

  // ------------------------------------------------ small life
  const flyers = []
  if (P.flyer) {
    // White butterflies drifting right to left over the field, wings beating out of step.
    const A = ['x.x', '.x.']
    const B = ['...', 'xxx']
    // [x, y, i, cycle, delay]: the cycle is 380 steps of 0.25 or 0.3 s, a cell each.
    const list = [[300, 150, 0, 95, 0], [250, 172, 1, 114, 40], [330, 132, 2, 95, 70]]
    for (const [x, y, i, T, l] of list) {
      const a = new Layer('ba' + i)
      const bb = new Layer('bb' + i)
      A.forEach((row, j) => [...row].forEach((ch, k) => ch === 'x' && a.set(x + k, y + j, k === 1 ? P.flyer[2] : P.flyer[1])))
      B.forEach((row, j) => [...row].forEach((ch, k) => ch === 'x' && bb.set(x + k, y + j, k === 1 ? P.flyer[2] : P.flyer[0])))
      const per = [0.4, 0.5, 0.45][i]
      a.anim = anim('fa', '--f:' + per + 's;--l:-' + f2(i * 0.15) + 's')
      bb.anim = anim('fb', '--f:' + per + 's;--l:-' + f2(i * 0.15) + 's', " opacity='0'")
      flyers.push({ wrap: "<g class='bf' style='--T:" + T + 's;--l:-' + l + "s'><g class='bob' style='--b:" + (3 + i) + "s'>", end: '</g></g>', layers: [a, bb] })
    }
  }
  if (P.bee) {
    // Bees hovering over the near spikes: a body and a pale wing, moving in small hops.
    const list = [[92, 166, 0], [178, 176, 1], [128, 150, 2]]
    for (const [x, y, i] of list) {
      const L = new Layer('bee' + i)
      L.set(x, y, P.bee[1])
      L.set(x + 1, y, P.bee[0])
      L.set(x, y - 1, P.bee[2])
      L.anim = anim('be', '--l:-' + f2(i * 1.3) + 's')
      flyers.push(L)
    }
  }
  const petals = []
  if (P.petal) {
    // Loose florets blown off the spikes, carried left, fading in and out.
    const r = rng(41)
    for (let i = 0; i < 9; i++) {
      const x = 200 + Math.floor(r() * 130)
      const y = 120 + Math.floor(r() * 70)
      const L = new Layer('pt' + i)
      L.set(x, y, P.petal[i % 2])
      if (i % 3 === 0) L.set(x + 1, y, P.petal[0])
      // 216 cells: a cell every tick through the flight (see the pt keyframes).
      petals.push({ wrap: "<g class='pt' style='--l:" + sec(-r() * 18) + "s' opacity='0'><g class='pw' style='--w:" + (2 + (i % 2)) + "s'>", end: '</g></g>', layers: [L] })
    }
  }
  const flies = []
  if (P.fireflies) {
    // Fireflies over the field: each glows up slowly and fades, drifting a few cells.
    const r = rng(77)
    for (let i = 0; i < 16; i++) {
      const x = 10 + Math.floor(r() * 300)
      const y = 126 + Math.floor(Math.pow(r(), 0.8) * 66)
      const L = new Layer('ff' + i)
      L.set(x, y, P.fireflies[0])
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) L.set(x + dx, y + dy, P.fireflies[y > 160 ? 1 : 2])
      const T = 5 + Math.floor(r() * 4)
      L.anim = anim('gw', '--T:' + T + 's;--l:' + sec(-r() * T) + 's', " opacity='" + (i % 3 ? 0 : 1) + "'")
      flies.push({ wrap: "<g class='fd' style='--d:" + (9 + (i % 5)) + 's;--l:' + sec(-r() * 9) + "s'>", end: '</g>', layers: [L] })
    }
  }

  // ------------------------------------------------ assemble
  // Cells of a still layer that a still layer drawn later on the same pin covers never show:
  // drop them: they would cost runs. A ring is kept: under every edge of the covering layer, a
  // layer that carries on beyond it reaches a cell in, so where the edge falls inside a screen
  // pixel the two overlap instead of leaving the sky to show through. (Round 3 kept the ring
  // under top edges only; the far range and the hills, alike in colour, showed the sky between
  // them along their sides.)
  const stills = [farRange, massif, valley, hills, lake, field]
  for (let j = stills.length - 1; j > 0; j--) {
    for (const k of stills[j].m.keys()) {
      const out = [k - 4096, k + 4096, k - 1, k + 1].filter(n => !stills[j].m.has(n))
      // The valley stays whole: its rows are laid as bands across the frame.
      for (let i = 0; i < j; i++) if (stills[i] !== valley && !out.some(n => stills[i].m.has(n))) stills[i].m.delete(k)
    }
  }
  const bands = []
  for (let b = 0; b < NB; b++) {
    const style = '--l:' + sec(-WAVE + (NB - 1 - b) * 0.4) + 's'
    lean1[b].anim = anim('w1', style)
    // Two coats: where a spike's edge falls inside a pixel, the field under the spike (not the
    // cell beside it) shows through the rest of that pixel; a second coat halves what shows. (One
    // coat left 54-170 line px; three cost the player about 1 ms a frame for nothing more.)
    lean1[b].coats = lean2[b].coats = 2
    lean2[b].anim = anim('w2', style)
    bands.push(lean1[b], lean2[b])
  }
  part('pB', [{ under: true, layer: sky }, rayGroup, ...starLayers, moon, sun])
  part('pB', backClouds)
  part('pB', [farRange, massif])
  part('pB', [lowCloud])
  part('pB', [{ under: true, layer: valley }, hills, lake])
  part('pB', glints)
  part('pB', [mist])
  // The field over full rows: each row's commonest paint (mostly a hedge tile) goes into a band
  // under the rest, as the sky's and the valley's colours do.
  field.encT = 28
  field.inTile = true
  repaint(field)
  // The spike tips over the field: every cell a tip can stand over (the gust moves lean1 a cell
  // left, lean2 one and two), and the cells a tip covers in every pose.
  const tipsAt = { any: new Map(), always: new Set(), rest: new Map() }
  const pose = (lean, shifts) => {
    for (const T of lean) for (const [k, c] of T.m) {
      for (const s of shifts) {
        const n = k - s
        if (!tipsAt.any.has(n)) tipsAt.any.set(n, new Set())
        tipsAt.any.get(n).add(c)
      }
      if (shifts.every(s => T.m.has(k + s))) tipsAt.always.add(k)
    }
  }
  for (const T of [...lean1, ...lean2]) for (const [k, c] of T.m) tipsAt.rest.set(k, c)
  pose(lean1, [0, 1])
  pose(lean2, [0, 1, 2])
  unbleed(field, tipsAt, SEAM[name])
  const covers = coverTips(field, tipsAt, SEAM[name])
  field.texel = texelsOf(field)
  field.enc = { back: 'none' }
  part('pB', [{ under: true, layer: field }, covers])
  part('pB', bands)
  part('pBR', [knoll, tree])
  part('pBR', [crown])
  part('pB', [...petals, ...flyers, ...flies])

  return { ...encode(parts, css(kfs, P), tileDefs.join(''), { merge: SEAM[name].merge }), probes }
}

// ---------------------------------------------------------------- mountains

// A range of peaks on one layer: each cell goes to the nearest peak (highest z) that covers it.
function range(P, peaks, o) {
  const L = new Layer(o.name)
  const haze = P.haze
  peaks.forEach(p => {
    const r = rng(p.seed * 31 + 1)
    const ribs = [{ u: p.spur, main: true }]
    for (let u = p.spur; u > -3; ) ribs.unshift({ u: (u -= 0.22 + r() * 0.36) })
    for (let u = p.spur; u < 3; ) ribs.push({ u: (u += 0.22 + r() * 0.36) })
    for (const rb of ribs) {
      rb.c = rb.main ? 0.08 : (r() - 0.5) * 0.5
      rb.s = 0.3 + r() * 0.4
    }
    p.ribs = ribs
    p.main = ribs.find(rb => rb.main)
  })
  const top = (p, x) => {
    const dx = x + 0.5 - p.x
    const a = Math.abs(dx)
    const k = dx < 0 ? p.kl : p.kr
    let t = p.y + a * k * (1 - (p.ease ?? 0.3) * smooth(a / (p.w ?? 80)))
    t += ((noise(x * 0.29, 1, p.seed) - 0.5) * 4.4 + (noise(x * 0.9, 2, p.seed) - 0.5) * 2.6) * smooth(a / 5)
    return Math.round(t)
  }
  const owner = new Map()
  for (let x = -2; x < W + 2; x++) {
    const tops = peaks.map(p => top(p, x))
    for (let y = Math.min(...tops); y < o.base; y++) {
      let best = -1
      for (let i = 0; i < peaks.length; i++) if (y >= tops[i] && (best < 0 || peaks[i].z > peaks[best].z)) best = i
      if (best >= 0) owner.set(KEY(x, y), best)
    }
  }
  for (const [k, i] of owner) {
    const x = (k % 4096) - 1000
    const y = Math.floor(k / 4096) - 1000
    const p = peaks[i]
    const dy = y + 0.5 - p.y
    const dx = x + 0.5 - p.x
    const ribAt = rb => rb.u + rb.c * (dy / 50)
    const u = dx / (dy + 4) + (noise(x * 0.2, y * 0.12, p.seed + 4) - 0.5) * 0.05
    let j = 0
    while (j < p.ribs.length - 2 && ribAt(p.ribs[j + 1]) <= u) j++
    const ua = ribAt(p.ribs[j])
    const ub = ribAt(p.ribs[j + 1])
    const f = clamp((u - ua) / (ub - ua), 0, 1)
    const west = !o.flat && f < p.ribs[j].s
    let lit = u < ribAt(p.main)
    // At sunset the light only reaches the upper slopes.
    if (lit && P.litLine !== undefined && y > P.litLine + (noise(x * 0.05, 1, 90) - 0.5) * 14) lit = false
    // Rock above the snow line under the summit, with snow streaks down the gullies; snow
    // below, broken by bands of cliff and by buttresses of rock along the spurs; under the snow
    // line (lower in the gullies, higher on the spurs) bare rock, then dark wood at the foot.
    const rz = p.rock + (noise(x * 0.12, 3, p.seed) - 0.5) * 10
    const sl = o.snow + (noise(x * 0.07, 7, p.seed) - 0.5) * 10 + (f > 0.55 ? 5 : f < 0.22 ? -4 : 0)
    let rock
    let wood = false
    if (y > sl) {
      rock = true
      wood = y > sl + 3 + noise(x * 0.2, y * 0.15, p.seed + 9) * 5
    } else if (dy < rz) rock = !(!west && noise(x * 0.5, y * 0.1, p.seed + 6) > 0.6) && !(west && noise(x * 0.3, y * 0.3, p.seed + 7) > 0.8)
    else {
      const buttress = f < 0.13 + 0.12 * noise(x * 0.2, y * 0.1, p.seed + 12) && noise(x * 0.3, y * 0.06, p.seed + 8) > 0.36
      const band = f < 0.75 && noise(x * 0.07, y * 0.42, p.seed + 20) > 0.73 + 0.12 * smooth((dy - 10) / 60)
      rock = !o.flat && (buttress || band)
    }
    // The big peaks' lit faces: snowfields and rock planes in bands that follow the ridge above
    // them (the skyline on the light's side) instead of the fall line, two values of each.
    let face = west
    const planes = lit && !o.flat && p.z >= 3 && !wood && y <= sl
    if (planes) {
      const a = Math.abs(dx)
      const ridge = p.y + a * (dx < 0 ? p.kl : p.kr) * (1 - (p.ease ?? 0.3) * smooth(a / (p.w ?? 80)))
      const bw = (y + 0.5 - ridge) * 0.12 + (noise(x * 0.04, 3, p.seed + 40) - 0.5) * 1.0
      const n = noise(bw, x * 0.035, p.seed + 41)
      rock = dy < rz ? n > 0.45 : n > 0.56
      face = noise(bw * 1.5 + 5, x * 0.04, p.seed + 42) > 0.5
    }
    const crest = owner.get(KEY(x, y - 1)) !== i
    const xs = p.x + ribAt(p.main) * (dy + 4)
    const arete = lit && dy < (p.arete ?? 0) && x + 0.5 > xs - 1.2
    // Gullies down the big lit snowfields: broken grooves along the fall line, their walls
    // turned from the light.
    const gu = u * 4.5 + p.seed * 0.37 + (noise(y * 0.09, 2, p.seed + 30) - 0.5) * 0.5
    const gully = !planes && lit && !rock && p.z >= 3 && dy > 12 && y < sl - 3 && Math.abs((gu - Math.floor(gu)) - 0.5) < 2.2 / (dy + 4) && noise(Math.floor(gu) * 3.1, y * 0.07, p.seed + 31) > 0.45
    // The lit faces turn to the light in two values (the facets facing it squarely and the
    // rest); the shaded faces sit two steps lower and cooler, in two values of their own.
    let c
    if (wood) c = pick(P.forest, lit ? 0.6 : 0.15)
    else if (rock) c = lit ? pick(P.rockLit, face ? 0.9 : 0.45) : pick(P.rockShade, west ? 0.5 : 0.1)
    else c = lit ? pick(P.snowLit, gully ? 0.1 : face ? 0.7 : 0.35) : pick(P.snowShade, west ? 0.55 : 0.1)
    // A rim of light along the crests and the main arete facing the light; none on the far side.
    if (((crest && dy > 0.5) || arete) && lit) c = dy < 30 || arete ? P.rim : pick(rock ? P.rockLit : P.snowLit, 0.99)
    const fq = fogStep(o.fog + o.foot * smooth((y - (o.base - o.footH)) / o.footH), x, y, 3, p.seed + 11, 0.3)
    if (fq) c = mix(c, haze, (fq / 3) * 0.85)
    L.set(x, y, c)
  }
  return L
}

// ---------------------------------------------------------------- props

// The farmhouse: a stone mas with a terracotta roof, its gable end on the left facing the light,
// its front turned from it (two steps darker and cooler), shutters on the front, a lower barn on
// the right and two cypresses beside it. Returns its cells [x, y, colour], the columns its cast
// shadow falls from ([x, foot y, height]) and the cells of its contact shadow.
function farmhouse(P, Lt, x0, yb) {
  const out = new Map()
  const set = (x, y, c) => out.set(x + ',' + y, [x, y, c])
  const cols = []
  const foot = []
  const cool = c => mix(c, Lt.shadow, 0.18)
  const FW = 17 // front wall width
  const WH = 7 // wall height
  const SD = 5 // side wall depth (on screen)
  const RH = 4 // roof rows
  // Left side face, lit: a parallelogram going back and up to the left, the gable over it.
  for (let i = 0; i < SD; i++) {
    const x = x0 - 1 - i
    const lift = Math.round((i + 1) * 0.5)
    for (let y = yb - WH - lift; y <= yb - lift; y++) set(x, y, pick(P.stone, (y + i) % 3 === 0 ? 0.7 : 0.85))
    const g = Math.round(4 * (1 - Math.abs(i + 0.5 - SD / 2) / (SD / 2 + 0.5)))
    for (let y = yb - WH - lift - g; y < yb - WH - lift; y++) set(x, y, pick(P.stone, 0.95))
    cols.push([x, yb - lift, WH + g + 1])
    foot.push([x, yb - lift + 1])
  }
  // Front face, in shade: stone in courses, and under the eaves a band of deeper shade.
  for (let x = x0; x < x0 + FW; x++) {
    for (let y = yb - WH; y <= yb; y++) {
      const course = (y + (Math.floor(x / 3) % 2)) % 3 === 0 && hash(x, y, 2) > 0.5
      set(x, y, cool(pick(P.stone, y - (yb - WH) < (Lt.L[2] > -0.3 ? 2 : 1) ? 0.15 : course ? 0.3 : 0.5)))
    }
    cols.push([x, yb, WH + RH])
    foot.push([x, yb + 1])
  }
  // Roof: the front slope seen from above, tiles in rows, the ridge set back. It faces up and
  // toward the viewer: lit by a high sun, in shade under a low or backlighting one, when only
  // the ridge and the verge over the gable catch the light.
  const roofLit = Lt.L[2] > -0.3
  for (let j = 0; j < RH; j++) {
    const y = yb - WH - 1 - j
    const xa = x0 - 1 - Math.round(j * 0.6)
    const xb = x0 + FW - Math.round(j * 0.6)
    for (let x = xa; x <= xb; x++) {
      let v = j === 0 ? 0.1 : j === RH - 1 ? 0.95 : (roofLit ? 0.6 : 0.3) + (x % 3 === 0 ? -0.2 : 0)
      if (x === xa && j > 0) v = 0.95
      set(x, y, roofLit || j === RH - 1 || x === xa ? pick(P.roof, v) : cool(pick(P.roof, v)))
    }
  }
  // Chimney: a lit side and a shaded one.
  for (let y = yb - WH - RH - 3; y < yb - WH - 2; y++) {
    set(x0 + 12, y, pick(P.stone, 0.85))
    set(x0 + 13, y, cool(pick(P.stone, 0.3)))
  }
  // Windows with shutters, and a door; at night three are lit and pool light on the wall
  // under them, at sunset one.
  const lit = P.moon ? [0, 1, 2] : P.sun ? [1] : []
  ;[x0 + 2, x0 + 7, x0 + 12].forEach((wx, i) => {
    const wy = yb - 5
    const on = lit.includes(i) && P.lamp
    if (on && P.moon) {
      for (let y = wy + 2; y <= wy + 4; y++) {
        for (let x = wx - 1 - (y - wy - 2); x <= wx + 1 + (y - wy - 2); x++) {
          const k = x + ',' + y
          if (out.has(k) && (y < wy + 4 || (x + y) % 2 === 0)) set(x, y, mix(out.get(k)[2], P.lamp.cols[1], y === wy + 2 ? 0.45 : 0.3))
        }
      }
    }
    set(wx, wy, on ? P.lamp.cols[0] : P.win[0])
    set(wx, wy + 1, on ? P.lamp.cols[1] : P.win[1])
    for (const sx of [wx - 1, wx + 1]) {
      set(sx, wy, P.shutter[1])
      set(sx, wy + 1, P.shutter[0])
    }
  })
  for (const [x, y] of [[x0 + 4, yb - 1], [x0 + 4, yb], [x0 + 5, yb - 1], [x0 + 5, yb]]) set(x, y, P.win[1])
  // The barn: lower, to the right, its front in shade like the house's; the house's shadow
  // falls across the left of its roof.
  const BX = x0 + FW
  const BW = 9
  const [sx] = castTip(Lt, BX, yb, WH + RH - 8)
  for (let x = BX; x < BX + BW; x++) {
    for (let y = yb - 4; y <= yb; y++) set(x, y, cool(pick(P.stone, y === yb - 4 ? 0.15 : 0.35)))
    for (let j = 0; j < 3; j++) {
      const xx = x - Math.round(j * 0.6)
      const v = j === 2 ? 0.8 : roofLit ? 0.3 + j * 0.15 : 0.2
      set(xx, yb - 5 - j, xx < sx ? cool(pick(P.roof, Math.min(v, 0.3))) : pick(P.roof, v))
    }
    cols.push([x, yb, 8])
    foot.push([x, yb + 1])
  }
  for (let y = yb - 2; y <= yb; y++) for (let x = BX + 3; x < BX + 6; x++) set(x, y, pick(P.bark, 0.4))
  // Two cypresses to the left of the house, lit on the left.
  for (const [cx, h, w] of [[x0 - 9, 17, 2.4], [x0 - 13, 13, 2]]) {
    for (let y = yb - h; y <= yb; y++) {
      const t = (yb - y) / h
      const hw = w * Math.pow(Math.sin(Math.PI * Math.min(1, (1 - t) * 1.05)), 0.6) * (t < 0.08 ? 0.6 : 1)
      for (let x = Math.floor(cx - hw); x <= cx + hw; x++) {
        const q = (x + 0.5 - cx) / (hw + 0.01)
        if (Math.abs(q) > 1.05) continue
        set(x, y, pick(P.cypress, q < -0.3 ? 0.8 : q < 0.3 ? 0.45 : 0.15))
      }
    }
    for (let x = Math.floor(cx - 1); x <= cx + 1; x++) {
      cols.push([x, yb, h * (x === Math.floor(cx) ? 1 : 0.7)])
      foot.push([x, yb + 1])
    }
  }
  return { cells: [...out.values()], cols, foot }
}

// A boulder: a polygon of rock, its top and left faces toward the light. Lit by day; backlit,
// dark with a rim on those edges.
function boulder(P, Lt, L, pts, seed) {
  const backlit = Lt.L[2] < -0.3
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    y0 = Math.min(y0, y)
    y1 = Math.max(y1, y)
  }
  const cx = (x0 + x1) / 2
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inPoly(pts, x + 0.5, y + 0.5)) continue
      const up = !inPoly(pts, x + 0.5, y - 0.5)
      const lf = !inPoly(pts, x - 0.5, y + 0.5)
      let v = x + 0.5 < cx + (y - y0) * 0.3 ? (backlit ? 0.3 : 0.55) : backlit ? 0.1 : 0.3
      if (noise(x * 0.35, y * 0.15, seed) > 0.7) v -= 0.2
      if (up) v = 0.95
      else if (lf) v = backlit ? 0.95 : 0.75
      L.set(x, y, backlit && (up || lf) ? mix(pick(P.rock, v), Lt.colour, 0.35) : pick(P.rock, v))
    }
  }
}

// The outcrop in the right corner: a knoll of grass with boulders sunk in it, and on it a lone
// tree bent by the wind from the right, its crown streaming to the left. All of it in the
// moment's key light: by day lit on the top and left; backlit at sunset and at night, dark with
// a thin rim on the edges facing the light. The stones throw their shadows across the grass.
function outcrop(P, Lt, knoll, tree, crown) {
  const backlit = Lt.L[2] < -0.3
  // Screen direction toward the light from a point, for rims.
  const toLight = (x, y) => {
    const sx = Lt.at[0] - x
    const sy = Lt.at[1] - y
    const n = Math.hypot(sx, sy)
    return [sx / n, sy / n]
  }
  // The knoll: its crest row catches the light; under it the grass darkens.
  const crest = x => 151 + Math.round(30 * Math.pow(1 - smooth((x - 244) / 56), 1.5) + (noise(x * 0.2, 1, 31) - 0.5) * 2)
  const grass = new Map()
  for (let x = 240; x < W + 4; x++) {
    const top = crest(x)
    for (let y = top; y <= H; y++) {
      const e = y - top
      const v = e === 0 ? 0.9 : e < 3 ? (backlit ? 0.3 : 0.55) : 0.25
      knoll.set(x, y, pick(P.grass, v))
      grass.set(KEY(x, y), v)
    }
  }
  const shadeGrass = (x, y, soft) => {
    const k = KEY(x, y)
    const v = grass.get(k)
    if (v === undefined || (soft && (x + y) % 2)) return
    knoll.set(x, y, mix(pick(P.grass, v - 0.35), Lt.shadow, Lt.sink * 0.8))
    grass.delete(k)
  }
  const stones = [
    [303, 180, 23, 17, 61],
    [267, 188, 15, 11, 62],
    [244, 195, 9, 6.5, 63],
  ]
  // Their cast shadows first, on the grass only, away from the light; then the stones.
  for (const [cx, cy, rx, ry] of stones) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const dx = (x + 0.5 - cx) / rx
      const h = ry * 2 * Math.sqrt(Math.max(0, 1 - dx * dx))
      const yb = Math.round(cy + ry * Math.sqrt(Math.max(0, 1 - dx * dx)) * 0.9)
      const [tx, ty] = castTip(Lt, x, Math.min(yb, H - 1), h)
      const pts = line(x, yb, Math.round(tx), Math.round(ty))
      pts.forEach(([px, py], i) => shadeGrass(px, py, i > pts.length * 0.66))
    }
  }
  for (const [cx, cy, rx, ry, seed] of stones) {
    const R = a => 1 + (noise(a * 1.6 + 5, 0.5, seed) - 0.5) * 0.18
    for (let y = Math.floor(cy - ry - 2); y <= H; y++) {
      for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x++) {
        const dx = (x + 0.5 - cx) / rx
        const dy = (y + 0.5 - cy) / ry
        const r = Math.hypot(dx, dy) / R(Math.atan2(dy, dx))
        if (r >= 1) continue
        const nx = (dx / Math.max(1, r)) * 0.95
        const ny = (dy / Math.max(1, r)) * 0.95
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
        let v = 0.95 * (Lt.amb + (1 - Lt.amb) * Math.max(0, nx * Lt.L[0] + ny * Lt.L[1] + nz * Lt.L[2]))
        // A crack or two across the face.
        if (Math.abs(dy + 0.35 * dx - 0.15) < 0.06 && dx > -0.5 && dx < 0.4) v -= 0.3
        let c = tone(P.rock, clamp(v, 0, 0.99), x, y, backlit ? 0.08 : 0.22)
        // Moss on the tops, in patches.
        if (ny < -0.45 && noise(x * 0.35, y * 0.5, seed) > 0.58) c = pick(P.grass, v > 0.6 ? 0.9 : v > 0.35 ? 0.55 : 0.2)
        // The rim on the edge facing the light.
        if (r > 0.92) {
          const [sx, sy] = toLight(x, y)
          if (nx * sx + ny * sy > (backlit ? 0.45 : 0.55)) c = backlit ? mix(pick(P.rock, 0.99), Lt.colour, 0.35) : pick(P.rock, 0.99)
        }
        knoll.set(x, y, c)
        grass.delete(KEY(x, y))
      }
    }
    // Grass over the foot: blades leaning left with the wind, lit at the tips; a contact
    // shadow under the stone between them.
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const dx = (x + 0.5 - cx) / rx
      const foot = Math.round(cy + ry * Math.sqrt(Math.max(0, 1 - dx * dx)) * 0.9)
      if (foot > H + 1) continue
      if (foot + 1 <= H) knoll.set(x, foot + 1, mix(pick(P.grass, 0), Lt.shadow, 0.5))
      if (hash(x, seed, 3) > 0.7) continue
      const hgt = 2 + Math.floor(hash(x, seed, 4) * 4)
      for (let k = 0; k < hgt; k++) knoll.set(x - (k > 2 ? 1 : 0), foot - k, pick(P.grass, k === hgt - 1 ? 0.95 : k ? 0.55 : 0.25))
    }
  }
  // Grass tufts along the crest, lit at the tips, bent left by the wind.
  for (let x = 246; x < W; x += 3) {
    const top = crest(x)
    const h = 1 + Math.floor(hash(x, 1, 3) * 3)
    for (let k = 1; k <= h; k++) knoll.set(x - (k > 1 ? 1 : 0), top - k, pick(P.grass, k === h ? 0.95 : 0.6))
  }
  // The trunk: thick at the foot, leaning hard left, with its limbs; the edge toward the light
  // lit, the far edge dark; a contact shadow where it meets the knoll.
  const limb = (pts, w0, w1) => {
    const segs = []
    for (let i = 0; i < pts.length - 1; i++) {
      const s = line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
      segs.push(...(i ? s.slice(1) : s))
    }
    segs.forEach(([x, y], i) => {
      const w = Math.max(1, Math.round(lerp(w0, w1, i / segs.length)))
      for (let k = 0; k < w; k++) {
        const v = k === 0 ? 0.95 : k === w - 1 && w > 2 ? 0.05 : backlit ? 0.2 : 0.45
        tree.set(x + k - Math.floor(w / 2), y, pick(P.bark, v))
      }
    })
  }
  limb([[302, 153], [299, 142], [293, 131], [284, 121], [272, 113], [258, 108]], 6, 2)
  limb([[293, 131], [281, 128], [268, 125], [252, 121]], 3, 1)
  limb([[284, 121], [282, 110], [276, 101]], 3, 1)
  limb([[299, 142], [306, 135], [309, 128]], 2, 1)
  limb([[272, 113], [262, 116], [244, 115]], 2, 1)
  for (let x = 297; x <= 306; x++) knoll.set(x, crest(x), mix(pick(P.grass, 0), Lt.shadow, 0.5))
  // The crown: flat clumps sheared by the wind. Lit on top and on the left by day with a darker
  // core; backlit, dark with a rim along the edges facing the light. The underside is darkest.
  const clumps = [
    [252, 102, 14, 4], [270, 97, 14, 4.4], [286, 101, 9, 3.6], [238, 109, 12, 3.6], [258, 114, 12, 3.6], [278, 112, 8, 3], [226, 115, 8, 2.8], [244, 120, 9, 2.8], [306, 126, 4, 2],
  ]
  const inC = (x, y) => {
    for (const [cx, cy, rx, ry] of clumps) {
      const wob = (noise(x * 0.45, y * 0.7, 51) - 0.5) * 0.6
      if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 < 1 + wob) return true
    }
    return false
  }
  for (let y = 90; y < 130; y++) {
    for (let x = 210; x < 316; x++) {
      if (!inC(x, y)) continue
      let e = 0
      while (e < 4 && inC(x, y - e - 1)) e++
      let v = backlit ? [0.9, 0.36, 0.26, 0.2, 0.15][e] : [0.92, 0.7, 0.5, 0.36, 0.26][e]
      if (!inC(x - 1, y) && e > 0) v += backlit ? 0.35 : 0.2
      if (!inC(x, y + 1)) v = 0.05
      if (e > 1 && noise(x * 0.5, y * 0.8, 55) > 0.7) v -= 0.15
      crown.set(x, y, pick(P.leaf, v))
    }
  }
}

// ---------------------------------------------------------------- motion

const WAVE = 9 // seconds between gusts across the field

function css(kfs, P) {
  const from = l => 'calc(' + l + ' + var(--m))'
  // The gust: the upper heads lean a cell, then two, and back; the lower heads and the stems
  // follow a beat later, a cell. Each band of the field runs it in turn.
  const W2 = [[0, tx(0)], [0.05, tx(-1)], [0.35, tx(-2)], [1.25, tx(-1)], [1.85, tx(0)]]
  const W1 = [[0, tx(0)], [0.2, tx(-1)], [1.6, tx(0)]]
  return [
    '.w1{animation:w1 ' + WAVE + 's steps(1) ' + from('var(--l)') + ' infinite}',
    keyframes('w1', WAVE, W1),
    '.w2{animation:w2 ' + WAVE + 's steps(1) ' + from('var(--l)') + ' infinite}',
    keyframes('w2', WAVE, W2),
    // The tree's crown leans as the gust reaches it, before the field to its left.
    '.ts{animation:ts ' + WAVE + 's steps(1) ' + from('-8.8s') + ' infinite}',
    keyframes('ts', WAVE, [[0, tx(0)], [0.3, tx(-1)], [1.6, tx(0)]]),
    // Clouds and mist drift a cell at a time, there and back.
    '.cd{animation:var(--d) steps(1) ' + from('var(--l)') + ' infinite alternate}',
    ...[...kfs].map(([n, k]) => '.' + n + '{animation-name:' + n + '}' + k),
    // Ripples on the lake: three sets of streaks in turn, 1.2 s each.
    '.gl{animation:gl 3.6s steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes gl{0%{opacity:1}33.3333%,100%{opacity:0}}',
    // The rays breathe.
    ...(P.rays ? [
    '.ry{animation:ry 24s steps(1) ' + from('-6s') + ' infinite}',
    '@keyframes ry{0%{opacity:1}' + [[30, 0.85], [35, 0.7], [40, 0.55], [45, 0.45], [70, 0.55], [75, 0.7], [80, 0.85], [85, 1]].map(([p, o]) => p + '%{opacity:' + f2(o) + '}').join('') + '100%{opacity:1}}',
    ] : []),
    // Stars dim for a moment.
    ...(P.stars ? [
    '.tk{animation:tk var(--d) steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes tk{0%,88%{opacity:1}90%{opacity:.7}93%{opacity:.4}97%,100%{opacity:.7}}',
    ] : []),
    // Butterflies cross right to left a cell a step, bobbing, wings beating.
    ...(P.flyer ? [
    '.bf{animation:bf var(--T) steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes bf{0%{transform:translateX(40px);animation-timing-function:steps(380)}100%{transform:translateX(-340px)}}',
    '.bob{animation:bob var(--b) steps(1) var(--m) infinite alternate}',
    swingY('bob', -3, 3),
    '.fa{animation:fa var(--f) steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes fa{0%{opacity:1}50%,100%{opacity:0}}',
    '.fb{animation:fb var(--f) steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes fb{0%{opacity:0}50%,100%{opacity:1}}',
    ] : []),
    // Bees hop between spikes.
    ...(P.bee ? [
    '.be{animation:be 6s steps(1) ' + from('var(--l)') + ' infinite}',
    keyframes('be', 6, [[0, 'transform:none'], [0.4, 'transform:translate(-1px,-1px)'], [0.8, 'transform:translate(-2px,0)'], [1.2, 'transform:translate(-3px,-2px)'], [1.6, 'transform:translate(-4px,-1px)'], [2.4, 'transform:translate(-3px,1px)'], [3, 'transform:translate(-1px,0)'], [3.6, 'transform:translate(1px,-1px)'], [4.4, 'transform:translate(2px,0)'], [5.2, 'transform:translate(1px,1px)']]),
    ] : []),
    // Florets fly for 60% of their cycle, a cell every tick, fading in and out at the ends.
    ...(P.petal ? [
    '.pt{animation:pt 18s steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes pt{0%{transform:none;opacity:0;animation-timing-function:steps(18)}' +
      '5%{transform:translateX(-18px);opacity:1;animation-timing-function:steps(180)}' +
      '55%{transform:translateX(-198px);opacity:1;animation-timing-function:steps(18)}' +
      '60%,100%{transform:translateX(-216px);opacity:0}}',
    '.pw{animation:pw var(--w) steps(1) var(--m) infinite alternate}',
    swingY('pw', -3, 3),
    ] : []),
    // Fireflies glow up and fade over a few seconds, and drift.
    ...(P.fireflies ? [
    '.gw{animation:gw var(--T) steps(1) ' + from('var(--l)') + ' infinite}',
    '@keyframes gw{0%{opacity:0}' + [[10, 0.2], [14, 0.45], [18, 0.7], [22, 1], [34, 0.7], [40, 0.45], [46, 0.2], [52, 0]].map(([p, o]) => p + '%{opacity:' + f2(o) + '}').join('') + '100%{opacity:0}}',
    '.fd{animation:fd var(--d) steps(1) ' + from('var(--l)') + ' infinite alternate}',
    keyframes('fd', 1, [[0, 'transform:none'], [0.2, 'transform:translate(-1px,-1px)'], [0.4, 'transform:translate(-2px,-1px)'], [0.6, 'transform:translate(-3px,0)'], [0.8, 'transform:translate(-4px,-1px)']]),
    ] : []),
    // Reduced motion rests the scene on its finished frame.
    '@media (prefers-reduced-motion:reduce){:root *{animation:none!important}}',
  ].join('')
}

// ---------------------------------------------------------------- write

const LIMIT = 131072
fs.mkdirSync(path.join(HERE, 'out', 'debug'), { recursive: true })
// The light check's marks (debug.mjs draws them): an arrow along the key light, and where each
// probe object's cast shadow must fall.
const lightFile = path.join(HERE, 'out', 'debug', 'light.json')
const debugLight = fs.existsSync(lightFile) ? JSON.parse(fs.readFileSync(lightFile, 'utf8')) : {}
function lightCheck(name, probes) {
  const Lt = LIGHT[name]
  const a = [clamp(Lt.at[0], 4, W - 5), clamp(Lt.at[1], 23, H - 5)]
  const n = Math.hypot(Lt.L[0], Lt.L[1])
  return { name: name + ': ' + Lt.key, arrow: [a, [a[0] - (36 * Lt.L[0]) / n, a[1] - (36 * Lt.L[1]) / n]], probes }
}
const only = process.argv.slice(2)
for (const name of only.length ? only : Object.keys(MOMENTS)) {
  const { svg, stats, css: cssLen, probes } = scene(name)
  debugLight[name] = lightCheck(name, probes)
  // What the app's scrub leaves: no @keyframes, and every <x/> written out as <x></x>.
  const kfLen = [...svg.matchAll(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g)].reduce((n, m) => n + m[0].length, 0)
  const scrubbed = svg.length - kfLen + [...svg.matchAll(/<(\w+)[^>]*\/>/g)].reduce((n, m) => n + 2 + m[1].length, 0)
  if (scrubbed > LIMIT || svg.length > LIMIT) console.log('TOO BIG')
  fs.writeFileSync(path.join(HERE, 'out', 'lavender-slope-' + name + '.svg'), svg)
  console.log(name.padEnd(7), svg.length, 'chars (scrubbed ~' + scrubbed + '), css', cssLen, '| patterns', stats.patterns, '| runs', stats.runs, '| bands', stats.bands)
  if (process.env.STATS) {
    const top = [...stats.byLayer].sort((a, b) => b[1] - a[1]).slice(0, 30)
    console.log('  ' + top.map(([n, r]) => n.slice(0, 40) + ':' + r).join('  '))
    if (stats.chars) {
      const ch = [...stats.chars].sort((a, b) => b[1] - a[1]).slice(0, 16)
      console.log('  chars ' + ch.map(([n, r]) => n.slice(0, 40) + ':' + r).join('  '))
    }
  }
}
fs.writeFileSync(lightFile, JSON.stringify(debugLight))
