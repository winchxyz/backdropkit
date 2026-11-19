// What moves in Gas Station, as sprites for build.mjs. A sprite is { name, depth, layers, back,
// noShadow, ownCasters, noSlice, band, wrap, css, merge }, and each of its layers is painted
// with the renderer ({ paint, lamps, shift }), or given as fragments at cells of its own
// ({ cells }), or comes ready coloured ({ layer }); each with its { anim } and whether it is
// hidden in the first frame (hidden0). `back` sprites lie between the sky and the scene (the
// clouds); the others are drawn over the scene (after the board's marker) in depth order, with
// the scene's nearer cells copied over them where they move.
//
// Nothing here crosses a price window: the pickup and its light stay below row 128 (the lowest
// window ends on row 116), the moths circle the canopy, the neon is the GAS sign over the
// windows. Every time is on the 0.05 s clock and every delay adds the shared --m.
import { Layer, rng } from '../../../sunfield/tools/pixel.mjs'
import { billow, paintCloud } from '../../../sunfield/tools/painters.mjs'
import * as core from './core.mjs'
import { C, E, F, H, HX, HY, W, box, mat, poly, proj, shadowed } from './core.mjs'
import { NEON } from './pylon.mjs'
import { CAN, LANE_FAR, LIGHTS, groundCell } from './scene.mjs'

const t5 = s => Math.round(s * 20) / 20
const num = v => String(v).replace(/^0\./, '.').replace(/^-0\./, '-.')
const sec = s => num(t5(s)) + 's'
const pct = (t, T) => num(Math.round((t5(t) / T) * 1e6) / 1e4) + '%'
// Keyframes from [[seconds, css], ...] over a cycle of T seconds.
const kf = (name, T, list) => '@keyframes ' + name + '{' + list.map(([t, css]) => pct(t, T) + '{' + css + '}').join('') + '}'
const anim = (cls, T, delay = 0, extra = '') => '.' + cls + '{animation:' + cls + ' ' + sec(T) + ' steps(1) calc(' + sec(delay) + ' + var(--m)) infinite' + extra + '}'
const G = E
const glow = (h, k = 1) => C(h).map(v => v * k)

// ---------------------------------------------------------------- clouds
// Cumulus by day, long lit streaks at sunset, thin dark wisps at night, drifting a few cells
// there and back by whole cells.
const CLOUDS = {
  day: [
    // A big one over the canopy on the left.
    { id: 'ca', puffs: [{ x: 22, y: 44, r: 8 }, { x: 36, y: 38, r: 11 }, { x: 52, y: 41, r: 10 }, { x: 68, y: 37, r: 12 }, { x: 84, y: 43, r: 8 }], base: 50, drift: 10, dur: 80 },
    // A small high one in the middle.
    { id: 'cb', puffs: [{ x: 150, y: 30, r: 6 }, { x: 160, y: 26, r: 8 }, { x: 171, y: 29, r: 6 }], base: 33, drift: 12, dur: 90 },
    // A low flat bank far off over the mesas.
    { id: 'cc', puffs: [{ x: 196, y: 92, r: 6 }, { x: 208, y: 89, r: 7 }, { x: 222, y: 91, r: 6 }, { x: 236, y: 93, r: 5 }], base: 95, sy: 1.5, drift: 8, dur: 70 },
  ],
  sunset: [
    // Long thin streaks lit from below: a wide one over the canopy, a lower one toward the sun,
    // a short high one by the lamp.
    { id: 'sa', puffs: [6, 15, 24, 33, 42, 51, 60, 69, 78, 87, 96].map((x, i) => ({ x, y: 46 + (i % 3) - (i > 6 ? 2 : 0), r: 7 + (i % 2) })), base: 50, sy: 2.5, drift: 10, dur: 80 },
    { id: 'sb', puffs: [118, 127, 136, 145, 154, 163, 172].map((x, i) => ({ x, y: 72 + (i % 2), r: 6 + (i % 3 === 1 ? 1 : 0) })), base: 76, sy: 2.6, drift: 8, dur: 90 },
    { id: 'sc', puffs: [170, 179, 188, 197, 206].map((x, i) => ({ x, y: 30 + (i % 2), r: 5 + (i % 2) })), base: 34, sy: 2.4, drift: 12, dur: 70 },
  ],
}
function clouds(M, name) {
  const CL = M.clouds
  if (!CL) return []
  const r = rng(CL.seed ?? 5)
  const list = CL.list ?? CLOUDS[name] ?? []
  const out = []
  for (const c of list) {
    const L = new Layer('cloud-' + c.id)
    const puffs = billow(c.puffs.map(p => ({ ...p, sy: c.sy ?? 1.15 })), r, { count: 3, lean: 0.2 })
    paintCloud(L, puffs, { tones: CL.tones, light: CL.light, base: c.base, baseWobble: true, bright: CL.bright ?? 0.62, dither: 0.3, baseShade: CL.baseShade ?? 0.42, topLift: CL.topLift ?? 0.08 })
    const n = c.drift
    const cls = 'k' + c.id
    out.push({
      name: 'cloud-' + c.id,
      depth: 1e9,
      back: true,
      layers: [{ layer: L, anim: { cls } }],
      css: ['.' + cls + '{animation:' + cls + ' ' + sec(c.dur) + ' steps(' + n + ') calc(' + sec(-Math.round(r() * c.dur)) + ' + var(--m)) infinite alternate}@keyframes ' + cls + '{to{transform:translateX(' + n + 'px)}}'],
    })
  }
  return out
}

// ---------------------------------------------------------------- sun rays (sunset)
// Beams fanning out from the low sun over the sky and the far land, a pale colour laid on thin
// and breathing slowly. Never over anything near (the pylon, the canopy).
function rays(M) {
  const R = M.rays
  if (!R) return []
  const gf = core.gf
  const gz = core.gz
  const L = new Layer('rays')
  const N = R.n * 2
  for (let y = 0; y < 126; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (gf[i] && gz[i] < 300) continue
      const dx = x + 0.5 - R.x
      const dy = y + 0.5 - R.y
      const d = Math.hypot(dx, dy)
      if (d < 10) continue
      const a = (Math.atan2(dy, dx) / (Math.PI * 2) + 0.5) * N
      const idx = Math.floor(a)
      if (core.hash(idx, 5, 3) < 0.45) continue
      const edge = Math.min(a - idx, idx + 1 - a) * 2
      const reach = 50 + 90 * core.hash(idx, 7, 3)
      const I = Math.min(1, edge * 2.2) * (1 - d / reach)
      if (I > 0.3) L.set(x, y, R.c)
    }
  }
  const T = 24
  return [{
    name: 'rays',
    depth: 1e8,
    noSlice: true,
    layers: [{ layer: L, anim: { cls: 'ry', extra: " opacity='.2'" } }],
    css: [anim('ry', T) + kf('ry', T, [[0, 'opacity:.2'], [4, 'opacity:.23'], [8, 'opacity:.26'], [12, 'opacity:.28'], [16, 'opacity:.26'], [20, 'opacity:.23']])],
  }]
}

// ---------------------------------------------------------------- the neon (sunset, night)
// The GAS letters and the tube round the sign, in full neon over the dim tube the still scene
// holds, breathing between 45% and 100% over 8 s in small steps: never a blink.
function neon(M) {
  const B = M.board
  if (!M.signLit || !B.neon) return []
  const L = new Layer('neon')
  for (const [x, y] of NEON) L.set(x, y, B.neon)
  const T = 8
  const steps = [0.45, 0.52, 0.6, 0.68, 0.76, 0.84, 0.92, 1, 1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.45]
  return [{
    name: 'neon',
    depth: 1,
    noSlice: true,
    layers: [{ layer: L, anim: { cls: 'ne', extra: " opacity='.45'" } }],
    css: [anim('ne', T) + kf('ne', T, steps.map((o, i) => [(i * T) / steps.length, 'opacity:' + num(o)]))],
  }]
}

// ---------------------------------------------------------------- moths (night)
// Four moths round the canopy's front lights, each a speck on its own small loop.
function moths(M) {
  if (!M.moths) return []
  const out = []
  const r = rng(77)
  const front = LIGHTS.filter(([x, z]) => z < 20 && proj([x, CAN.under, z])[0] > 6)
  front.forEach(([lx, lz], j) => {
    const [cx, cy] = proj([lx, CAN.under + 0.15, lz])
    const L = new Layer('moth' + j)
    L.set(Math.round(cx), Math.round(cy) + 2, M.moths)
    const n = 12
    const rx = 3 + Math.round(r() * 2)
    const ry = 2
    const T = [3, 3.5, 4, 4.5][j % 4]
    const cls = 'mo' + j
    const frames = []
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      // A loop with a wobble, in whole cells.
      const dx = Math.round(Math.cos(a) * rx + (i % 3 === 1 ? 1 : 0))
      const dy = Math.round(Math.sin(a * (j % 2 ? 2 : 1)) * ry)
      frames.push([(i * T) / n, 'transform:translate(' + dx + 'px,' + dy + 'px)'])
    }
    out.push({
      name: 'moth' + j,
      depth: lz - 0.5,
      noSlice: true,
      layers: [{ layer: L, anim: { cls } }],
      css: [anim(cls, T, -Math.round(r() * T * 10) / 10) + kf(cls, T, frames)],
    })
  })
  return out
}

// ---------------------------------------------------------------- the pickup
// An old two-tone pickup passing right to left in the far lane once a cycle. It is rendered
// with the scene's renderer under the sun's point on the horizon (so its sunset shadow falls
// straight toward us), shifted off the right edge, and slid left in whole cells.
const CYCLE = 50
const SPEED = 46 // cells a second
const DRIVE = 16 // when it sets off
const ZN = LANE_FAR - 0.9 // the near side of the pickup
const ZF = LANE_FAR + 0.9
const XC = ((196 - HX) * ZN) / F // under the sun's foot at sunset
const LEN = 4.7
const XF = XC - LEN / 2 // the front (it drives toward -X)
const WHEELS = [0.85, 3.75]
// One hole's step of a wheel's turn: the distance it rolls (a fifth of 2 pi WR metres), in cells
// at its depth, over SPEED. A whole number of 0.05 s ticks; SPIN frames share it.
const WHEEL_T = 0.2

// The pickup's lines, in metres: u from the front back, v up from the road.
const BELT = 1.04 // the hood's back edge and the door tops
const RAIL = 1.08 // the bed's top rail
const TOP = 1.64 // the cab roof (row 129: below the lowest price window)
const CAB0 = 1.58 // the windshield's foot
const CAB1 = 2.86 // the cab's back
const BED0 = 2.94 // the bed's front
const WR = 0.37 // tyre radius
const ARCH = 0.5 // wheel arch radius
const rake = v => CAB0 + (v - BELT) * 0.55 // the windshield's line: u at height v
const UP = [0, -0.72, -0.69] // a face tilted up toward the sky (Y is down, -Z toward us)
const DOWN = [0, 0.5, -0.87] // a face tilted down toward the road
const RED = '#b5473a'
const CREAM = '#efe6d4'

// What the pickup's near side shows at (u, v): a part name, or null where it is open.
function sideAt(u, v, cs) {
  // Bumpers, a little proud of the body, front and back.
  if (v >= 0.33 && v <= 0.53 && ((u >= -0.05 && u < 0.26) || (u > LEN - 0.22 && u <= LEN + 0.05))) return v > 0.48 ? 'chromeHi' : v < 0.38 ? 'chromeLo' : 'chrome'
  // The mirror on its arm, beside the windshield's foot.
  if (u > rake(1.12) - 0.16 && u < rake(1.12) - 0.02 && v > 1.12 && v < 1.24) return 'mirror'
  if (u > rake(1.1) - 0.04 && u < rake(1.1) + 0.02 && v > 1.06 && v < 1.13) return 'seal'
  for (const w of WHEELS) {
    const d = Math.hypot(u - w, v - WR)
    if (d < ARCH) return null // the opening: the well and the tyre behind show through
    if (d < ARCH + cs * 1.4 && v > 0.42) return 'lip'
  }
  if (u < 0.02 || u > LEN - 0.02) return null
  // Between the cab and the bed: a dark gap.
  if (u >= CAB1 && u < BED0) return v > 0.46 && v < RAIL - 0.02 ? 'gap' : null
  // The lower body: a rounded nose, the hood line rising to the cowl, the bed side.
  const top = u < 0.24 ? BELT - 0.1 + 0.1 * Math.sqrt(u / 0.24) : u < CAB1 ? BELT - 0.03 + 0.03 * Math.min(1, (u - 0.24) / (CAB0 - 0.24)) : RAIL
  const bottom = u < 0.3 || u > LEN - 0.3 ? 0.44 : 0.4
  if (v >= bottom && v <= top) {
    if (u < 0.1 && v > 0.74 && v < 0.9) return 'headlamp'
    if (u > 0.1 && u < 0.22 && v > 0.6 && v < 0.67) return 'amber'
    if (u > LEN - 0.12 && v > 0.64 && v < 0.98) return 'taillamp'
    if (u > LEN - 0.36 && u < LEN - 0.26 && v > 0.6 && v < 0.67) return 'redMarker'
    const line = a => Math.abs(u - a) < cs * 0.55
    if ((line(CAB0 + 0.02) || line(2.6)) && v > 0.46) return 'seam' // the door's front and back
    if (u > CAB0 && u < 2.6 && Math.abs(v - 0.47) < cs * 0.55) return 'seam' // the door's foot
    if (line(LEN - 0.15) && v > 0.46) return 'seam' // the tailgate
    if (u > 3.18 && u < 3.38 && v > 0.82 && v < 1.0) return u < 3.18 + cs || u > 3.38 - cs || v < 0.82 + cs || v > 1.0 - cs ? 'seam' : 'paint' // the fuel door
    if (u > 2.38 && u < 2.52 && v > 0.93 && v < 0.98) return 'chrome' // the door handle
    if (v > 0.7 && v < 0.79) return 'stripe'
    if (v > top - cs * 1.2) return 'shoulder'
    if (v < bottom + cs * 1.4) return 'rocker'
    if (v < 0.58) return 'low'
    return 'paint'
  }
  // The cab: a raked A-pillar, a side window with a vent pane, a cream roof with rounded corners.
  if (v > top && v <= TOP && u >= rake(v) && u < CAB1) {
    const r = 0.1
    const fx = rake(TOP - r) + r
    if (v > TOP - r && u < fx && Math.hypot(u - fx, v - (TOP - r)) > r) return null
    if (v > TOP - r && u > CAB1 - r && Math.hypot(u - (CAB1 - r), v - (TOP - r)) > r) return null
    if (v > TOP - 0.09) return 'roof'
    if (v > TOP - 0.09 - cs) return 'seal' // the drip rail
    if (v < BELT + 0.045) return 'chrome' // the belt moulding under the window
    const w0 = rake(v) + 0.1
    if (u < w0) return 'pillar'
    if (u > 2.56 || v < BELT + 0.07 || v > TOP - 0.14) return u > 2.56 ? 'paint' : 'seal'
    if (u < w0 + cs || u > 2.56 - cs) return 'seal'
    if (Math.abs(u - (rake(v) + 0.46)) < cs * 0.55) return 'seal' // the vent pane's post
    if (u > 2.18 && u < 2.44 && v > 1.13 && v < 1.38 && Math.hypot((u - 2.31) / 0.13, (v - 1.36) / 0.12) < 1.6) return 'seat'
    const t = (v - BELT) / (TOP - BELT)
    return Math.abs(u - 1.9 - t * 0.5) < 0.07 || Math.abs(u - 2.15 - t * 0.5) < 0.03 ? 'glassHi' : 'glass'
  }
  return null
}

function truckBoxes(M, faces) {
  if (!faces) {
    // For its shadow only: the body, the cab, and the wheels and chassis down to the road, since
    // a sun this low passes under the body.
    box(XF, XF + LEN, G - RAIL, G - 0.4, ZN, ZF, {})
    box(XF + CAB0, XF + CAB1, G - TOP, G - RAIL, ZN + 0.03, ZF - 0.03, {})
    box(XF + 0.5, XF + LEN - 0.5, G - 0.4, G, ZN + 0.15, ZF - 0.15, {})
    return
  }
  const lights = !!M.headlights
  const sheen = M.truckSheen ?? null
  const paint = (n, k = 'truck', e) => ({ ...mat(RED, k), n, ...(e ? { e } : {}) })
  const lamp = (on, off, hexOn) => (lights ? { a: [1, 1, 1], k: 'truckLamp', e: glow(hexOn), flat: true } : mat(off, 'truckLamp'))
  const t = (M.glassSky ?? [0.4, 0.5, 0.6])
  const glass = k => ({ a: [0.07, 0.08, 0.09], k: 'cabGlass', e: t.map(c => c * k), glass: true })
  const parts = {
    paint: () => paint([0, 0, -1]),
    pillar: () => paint([0, 0, -1]),
    shoulder: () => paint(UP, 'truck', sheen),
    lip: () => paint(UP, 'truck', sheen && sheen.map(v => v * 0.6)),
    low: () => paint(DOWN),
    rocker: () => ({ ...mat('#6a2a24', 'truckLow'), n: DOWN }),
    stripe: () => mat(CREAM, 'truckStripe'),
    roof: () => ({ ...mat(CREAM, 'truckRoof'), n: UP, ...(sheen ? { e: sheen } : {}) }),
    seam: () => mat('#4c1d19', 'truckSeam'),
    seal: () => mat('#2a2a2e', 'truckSeam'),
    gap: () => mat('#1a191b', 'chassis'),
    chrome: () => mat('#c4c3bd', 'chrome'),
    chromeHi: () => ({ ...mat('#eeeeea', 'chrome'), n: UP }),
    chromeLo: () => ({ ...mat('#7d7c78', 'chrome'), n: DOWN }),
    mirror: () => mat('#3a3a3e', 'truckSeam'),
    headlamp: () => lamp(lights, '#ecebe2', '#fff4d8'),
    amber: () => lamp(lights, '#e89a3a', '#ffb050'),
    taillamp: () => lamp(lights, '#c42a22', '#ff3a2a'),
    redMarker: () => lamp(lights, '#b8302a', '#e0402e'),
    glass: () => (lights ? mat('#1e2430', 'cabGlass') : glass(0.85)),
    glassHi: () => (lights ? mat('#2a3242', 'cabGlass') : glass(1.15)),
    seat: () => (lights ? mat('#14161c', 'cabGlass') : glass(0.35)),
  }
  // The near side, on one plane.
  poly([[XF - 0.1, G - 1.7, ZN], [XF + LEN + 0.1, G - 1.7, ZN], [XF + LEN + 0.1, G, ZN], [XF - 0.1, G, ZN]], P => {
    const part = sideAt(P[0] - XF, G - P[1], P[2] / F)
    return part ? parts[part]() : null
  })
  // What shows from above, at our eye 0.2 m over the roof: the hood, the roof, into the bed.
  box(XF + 0.12, XF + CAB0, G - BELT + 0.02, G - 0.5, ZN + 0.02, ZF - 0.02, { top: () => paint([0, -1, 0], 'truck', sheen) }, { cast: false })
  box(XF + rake(TOP) + 0.08, XF + CAB1 - 0.08, G - TOP, G - BELT, ZN + 0.05, ZF - 0.05, { top: () => ({ ...mat(CREAM, 'truckRoof'), ...(sheen ? { e: sheen } : {}) }) }, { cast: false })
  box(XF + BED0, XF + LEN - 0.02, G - RAIL, G - 0.5, ZN + 0.01, ZF - 0.01, {
    top: P => (P[2] < ZN + 0.09 || P[2] > ZF - 0.09 || P[0] < XF + BED0 + 0.08 || P[0] > XF + LEN - 0.1 ? paint([0, -1, 0], 'truck', sheen) : mat('#3a2422', 'bed')),
  }, { cast: false })
  // Behind the openings: the dark wheel wells, then the tyres on steel wheels with chrome caps.
  for (const w of WHEELS) {
    const ring = (r, Z, from, to) => wheelRing(w, r, Z, from, to)
    // Only inside the arch, above the body's bottom line: below it the road shows under the body.
    poly(ring(ARCH + 0.02, ZN + 0.32, -0.25, Math.PI + 0.25), P => (G - P[1] < 0.42 ? null : mat('#141416', 'well')))
    poly(ring(WR, ZN + 0.08), (P, x, y) => {
      const du = P[0] - XF - w
      const dv = G - WR - P[1]
      const d = Math.hypot(du, dv)
      // A chrome cap, a cream steel wheel with a darker ring, a black tyre with a grey sidewall.
      if (d < 0.075) return { ...mat('#e8e8e2', 'hub'), n: dv > 0 ? UP : [0, 0, -1] }
      if (d < 0.105) return mat('#8e8c86', 'hub')
      if (d < 0.235) return rimAt(du, dv, d, -1)
      if (d < 0.285) return { ...mat('#4a4a50', 'tyre'), n: dv > 0.1 ? UP : [0, 0, -1] }
      return { ...mat('#2c2c30', 'tyre'), n: dv > 0.18 ? UP : [0, 0, -1] }
    })
  }
  // The frame between the wheels, under the body; its ends sit behind the tyres, so no square
  // dark block shows under the overhangs.
  box(XF + WHEELS[0], XF + WHEELS[1], G - 0.42, G - 0.2, ZN + 0.4, ZF - 0.4, { front: () => mat('#1d1c1e', 'chassis') }, { cast: false })
  // The road under it is left alone here: its shade is a see-through layer of its own (truck()),
  // so it darkens whatever road it passes over, the sodium pool included.
}

// A ring of points round wheel w (u along the pickup), radius r, at depth Z.
function wheelRing(w, r, Z, from = 0, to = Math.PI * 2) {
  const pts = []
  for (let i = 0; i <= 28; i++) {
    const a = from + ((to - from) * i) / 28
    pts.push([XF + w + Math.cos(a) * r, G - WR - Math.sin(a) * r, Z])
  }
  return pts
}

// The steel wheel inside the tyre at (du, dv) from its centre, d from it: a chrome cap, a darker
// ring, the cream wheel and its rim edge. With a frame (0 to SPIN - 1) it has HOLES round holes,
// turned a step further each frame; the light on it stays where it is.
const SPIN = 4
const HOLES = 5
function rimAt(du, dv, d, frame) {
  if (d < 0.075) return { ...mat('#e8e8e2', 'hub'), n: dv > 0 ? UP : [0, 0, -1] }
  if (d < 0.105) return mat('#8e8c86', 'hub')
  if (d < 0.2) {
    if (frame >= 0) {
      // It rolls to the left, so it turns anticlockwise as we see it.
      const step = (2 * Math.PI) / HOLES
      const a = Math.atan2(dv, du) - 0.3 - (frame * step) / SPIN
      const da = a - step * Math.round(a / step)
      if (Math.hypot(d - 0.15, da * 0.15) < 0.036) return mat('#3a3630', 'rimHole')
    }
    return { ...mat('#e6dfcc', 'rim'), n: dv > 0.05 ? UP : dv < -0.05 ? DOWN : [0, 0, -1] }
  }
  return mat('#9c968a', 'rim')
}

// The wheels' faces alone, turned to a frame: drawn over the pickup in turn while it drives.
function wheelFaces(frame) {
  for (const w of WHEELS) {
    poly(wheelRing(w, 0.236, ZN + 0.079), P => {
      const du = P[0] - XF - w
      const dv = G - WR - P[1]
      const d = Math.hypot(du, dv)
      return d < 0.235 ? rimAt(du, dv, d, frame) : null
    })
  }
}

// Cells of the road (rows y0..y1 of the 320 x 200 grid, at the pickup's render position) that
// fn(X, Z) gives a level to: 2 strong, 1 soft, 0 none. Returns two layers, shifted by dx.
function roadOverlay(name, y0, y1, dx, colour, fn) {
  const strong = new Layer(name + 'A')
  const soft = new Layer(name + 'B')
  for (let y = Math.max(Math.ceil(HY) + 1, y0); y <= Math.min(H - 1, y1); y++) {
    const Z = (F * G) / (y + 0.5 - HY)
    for (let x = 0; x < W; x++) {
      const X = ((x + 0.5 - HX) * Z) / F
      const level = fn(X, Z)
      if (level === 2) strong.set(x + dx, y, colour)
      else if (level === 1) soft.set(x + dx, y, colour)
    }
  }
  return [soft, strong]
}

function truck(M) {
  // Where its cells will be at the render: the front (or the beam's tip) leftmost; the rear (or
  // the shadow's far corner) rightmost. Shifted so the leftmost starts a cell off the right edge.
  const beamLen = M.beam ? 6.5 : 0
  const left = Math.floor(proj([XF - beamLen, G, ZN - 0.9])[0])
  // A shadow edge runs from the sun's foot on the horizon (196, HY) through a wheel's foot to
  // the bottom row.
  const atBottom = X => {
    const [px, py] = proj([X, G, ZN])
    return 196 + ((px - 196) * (H - HY)) / (py - HY)
  }
  const minX = Math.min(left, M.truckShadow ? Math.floor(atBottom(XF)) - 1 : Infinity)
  const shift = W + 1 - minX
  const right = Math.ceil(Math.max(proj([XF + LEN, G, ZN])[0], M.truckShadow ? atBottom(XF + LEN) : 0)) + 1
  const dist = right + shift + 1
  const T = CYCLE
  const go = [DRIVE, t5(DRIVE + dist / SPEED)]
  const moveCss = cls =>
    '.' + cls + '{animation:' + cls + ' ' + sec(T) + ' linear calc(0s + var(--m)) infinite}' +
    kf(cls, T, [[0, 'transform:none;opacity:0'], [go[0], 'transform:none;opacity:1;animation-timing-function:steps(' + dist + ')'], [go[1], 'transform:translateX(-' + dist + 'px);opacity:1'], [go[1] + 0.05, 'transform:translateX(-' + dist + 'px);opacity:0'], [T, 'transform:translateX(-' + dist + 'px);opacity:0']])
  const out = []
  const headlamp = { p: [XF - 0.15, G - 0.78, ZN + 0.25], dir: [-1, 0.08, 0], c: glow('#ffe6b8', 1.6), r: 5, reach: 14, cone: [0.86, 0.97] }
  const yTop = Math.floor(proj([0, G - 1.62, ZN])[1]) - 1
  const yGround = Math.ceil(proj([0, G, ZN])[1])
  const truckLamps = M.truckFill ? [{ p: [XF + LEN / 2, G - 2.5, ZN - 5], c: M.truckFill, r: 9, reach: 40 }] : []
  out.push({
    name: 'truck',
    depth: ZN,
    noShadow: true,
    band: { x0: 0, x1: W - 1, y0: yTop, y1: yGround },
    wrap: ["<g class='tk1' opacity='0'>", '</g>'],
    // After dark a soft warm fill from the station's lights and the street lamp, from in front and
    // above, so its side reads instead of passing as a black shape.
    // Over it, its wheels' faces in SPIN frames, one shown at a time, so the wheels turn as it
    // rolls: it moves SPEED cells a second, so a wheel turns about once a second, a hole's step
    // (1 / HOLES of a turn) in WHEEL_T seconds.
    layers: [
      { paint: () => truckBoxes(M, true), lamps: truckLamps, shift, hidden0: true },
      ...Array.from({ length: SPIN }, (_, i) => ({ paint: () => wheelFaces(i), lamps: truckLamps, shift, hidden0: true, anim: { cls: 'wf' + i } })),
    ],
    css: [
      moveCss('tk1'),
      ...Array.from({ length: SPIN }, (_, i) => {
        const f = WHEEL_T / SPIN
        const list = i === 0 ? [[0, 'opacity:1'], [f, 'opacity:0'], [WHEEL_T, 'opacity:0']] : [[0, 'opacity:0'], [i * f, 'opacity:1'], [(i + 1) * f, i === SPIN - 1 ? 'opacity:1' : 'opacity:0'], [WHEEL_T, i === SPIN - 1 ? 'opacity:1' : 'opacity:0']]
        return anim('wf' + i, WHEEL_T) + kf('wf' + i, WHEEL_T, list)
      }),
    ],
  })
  // The road in its shade under it: a dark see-through layer, strong under the middle, soft at
  // its edges, so it darkens the road it is over wherever that is, and never shows a light gap.
  {
    // It reaches past the far side, as far as we can see under the bumpers (to the curb), and its
    // ends are set in the pickup's own columns (X taken back along the line of sight to its near
    // side), so the road seen under the overhangs is in shade too and no light strip shows there.
    const ZB = ZF + 2.2
    const y0 = Math.floor(proj([0, G, ZB + 0.1])[1])
    const y1 = Math.ceil(proj([0, G, ZN])[1])
    // Its footprint is a rounded oblong (a superellipse), so its ends come to a soft round tip
    // under the bumpers instead of a square block.
    const [soft, strong] = roadOverlay('under', y0, y1, shift, M.underShade.c, (X, Z) => {
      const cu = ((X * ZN) / Z - XF - LEN / 2) / (LEN / 2 + 0.02)
      const cz = (Z - (ZN + ZB) / 2) / ((ZB - ZN) / 2 + 0.06)
      const r = (Math.abs(cu) ** 3 + Math.abs(cz) ** 3) ** (1 / 3)
      return r < 0.86 ? 2 : r < 1 ? 1 : 0
    })
    out.push({
      name: 'under',
      depth: ZF,
      noShadow: true,
      noSlice: true,
      band: { x0: 0, x1: W - 1, y0, y1 },
      wrap: ["<g class='tk4' opacity='0'>", '</g>'],
      layers: [
        { layer: soft, anim: { cls: 'us', extra: " opacity='" + num(M.underShade.k / 2) + "'" }, hidden0: true },
        { layer: strong, anim: { cls: 'ut', extra: " opacity='" + num(M.underShade.k) + "'" }, hidden0: true },
      ],
      css: [moveCss('tk4')],
    })
  }
  if (M.beam) {
    // The headlights on the road ahead of it: a pale warm see-through layer, so the beam only
    // ever adds light to the road, the sodium pool included.
    const y0 = Math.floor(proj([0, G, ZF + 0.6])[1])
    const y1 = Math.ceil(proj([0, G, ZN - 0.9])[1])
    const [soft, strong] = roadOverlay('beam', y0, y1, shift, M.beam.c, (X, Z) => {
      if (X > XF || X < XF - beamLen || Z < ZN - 0.9 || Z > ZF + 0.6) return 0
      const d = core.sub(headlamp.p, [X, G, Z])
      const dist = Math.hypot(d[0], d[1], d[2])
      const cs = -core.dot(core.mul(d, 1 / dist), headlamp.dir)
      if (cs < 0.88) return 0
      const t = Math.min(1, (cs - 0.86) / 0.11)
      const I = (t * t * (3 - 2 * t)) / (1 + (dist / headlamp.r) ** 2)
      return I > 0.32 ? 2 : I > 0.12 ? 1 : 0
    })
    out.push({
      name: 'beam',
      depth: ZN - 0.85,
      noShadow: true,
      noSlice: true,
      band: { x0: 0, x1: W - 1, y0, y1 },
      wrap: ["<g class='tk2' opacity='0'>", '</g>'],
      layers: [
        { layer: soft, anim: { cls: 'bs', extra: " opacity='" + num(M.beam.k / 2) + "'" }, hidden0: true },
        { layer: strong, anim: { cls: 'bt', extra: " opacity='" + num(M.beam.k) + "'" }, hidden0: true },
      ],
      css: [moveCss('tk2')],
    })
  }
  if (M.truckShadow) {
    // At sunset its shadow runs from its wheels toward us across the road and the shoulder.
    out.push({
      name: 'truckShadow',
      depth: 1,
      ownCasters: true,
      noSlice: true,
      merge: 20,
      band: { x0: 0, x1: W - 1, y0: yGround - 1, y1: H - 1 },
      wrap: ["<g class='tk3' opacity='0'>", '</g>'],
      layers: [{
        paint: () => {
          truckBoxes(M, false)
          poly([[-80, G, 4.5], [80, G, 4.5], [80, G, ZN + 0.05], [-80, G, ZN + 0.05]], P => (shadowed(P, M.sun.d) ? groundCell(P) : null))
        },
        lamps: [],
        shift,
        hidden0: true,
        noContact: true,
      }],
      css: [moveCss('tk3')],
    })
  }
  return out
}

export function paintSprites(M, scene, name) {
  const ry = rays(M)
  return [...clouds(M, name), ...ry, ...neon(M), ...moths(M), ...truck(M)]
}
