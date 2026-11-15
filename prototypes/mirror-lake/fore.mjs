// Mirror Lake's foreground painters: boulders, the jetty, the rowboat, reeds, wildflowers and
// grass, and the still reflections of what stands in the water. Cells on the 320 x 200 grid;
// every tone list runs dark to light; the light comes from the left.
import { Layer, clamp, lerp, smooth, tone } from '../../../sunfield/tools/pixel.mjs'
import { line } from '../../../sunfield/tools/painters.mjs'
import { cells, fbm, hash, mix, noise } from './lib.mjs'

const norm = v => {
  const l = Math.hypot(...v)
  return v.map(c => c / l)
}

// ---------------------------------------------------------------- boulders

// Rounded stones: a union of spheres lit from the upper left, warped by noise so they read as rock,
// moss on their tops. Returns each column's top cell, for what grows on them.
export function boulders(L, blobs, o) {
  const lv = norm(o.light ?? [-0.6, -0.7, 0.45])
  const seed = o.seed ?? 0
  const warp = o.warp ?? 2
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const b of blobs) {
    x0 = Math.min(x0, b.x - b.r - warp)
    x1 = Math.max(x1, b.x + b.r + warp)
    y0 = Math.min(y0, b.y - b.r / (b.sy ?? 1) - warp)
    y1 = Math.max(y1, b.y + b.r / (b.sy ?? 1) + warp)
  }
  const floor = o.floor ?? Infinity
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
      if (y + 0.5 > (typeof floor === 'function' ? floor(x) : floor)) continue
      const px = x + 0.5 + warp * (noise(x * 0.15, y * 0.15, seed) - 0.5)
      const py = y + 0.5 + warp * (noise(x * 0.15, y * 0.15, seed + 9) - 0.5)
      let best = null
      let bz = -Infinity
      let z2 = -Infinity
      for (const b of blobs) {
        const sy = b.sy ?? 1
        const dx = px - b.x
        const dy = (py - b.y) * sy
        const d2 = dx * dx + dy * dy
        if (d2 >= b.r * b.r) continue
        const nz = Math.sqrt(b.r * b.r - d2)
        const z = nz + (b.z ?? 0)
        if (z > bz) {
          z2 = bz
          bz = z
          best = { b, dx, dy, nz }
        } else if (z > z2) z2 = z
      }
      if (!best) continue
      const { b, dx, dy, nz } = best
      const n = [dx / b.r, dy / b.r, nz / b.r]
      const f = n[0] * lv[0] + n[1] * lv[1] + n[2] * lv[2]
      let v = 0.36 + 0.6 * f - 0.15 * Math.pow(1 - n[2], 2)
      if (bz - z2 < 1.2 && dy > -b.r * 0.2) v -= 0.2 // the crease where one stone sits on another
      // Facets and grain.
      v += 0.1 * (noise(x * 0.45, y * 0.45, seed + 3) - 0.5) + (hash(x >> 1, y, seed) > 0.94 ? -0.08 : 0)
      let c = tone(o.tones, v, x, y, 0.06)
      // Moss and lichen where the top faces up and the light.
      if (o.moss && n[1] < -0.45 && noise(x * 0.3, y * 0.3, seed + 5) > 0.45) c = tone(o.moss, v - 0.05, x, y, 0.06)
      L.set(x, y, c)
    }
  }
}

// ---------------------------------------------------------------- the jetty

// A plank jetty running from the near bank on the right out into the lake on the left, seen in
// perspective: it narrows and rises as it recedes. o: { far: [x, deckTop], near: [x, deckTop],
// tones (wood), dark, water (the shade under it), lamp } . Returns the posts' feet, for ripples
// and reflections: [[x, waterRow, width]].
export function jetty(L, o) {
  const [xf, yf] = o.far
  const [xn, yn] = o.near
  const t = x => clamp((x - xf) / (xn - xf), 0, 1)
  const at = (x, a, b) => lerp(a, b, t(x))
  const deckTop = x => Math.round(at(x, yf, yn))
  const deckH = x => Math.round(at(x, 2, 7))
  const beamH = x => Math.round(at(x, 1, 3))
  const postL = x => Math.round(at(x, 5, 15))
  // Distance along the jetty, as walked: a cell near us covers less of it than one far off.
  const scale = x => at(x, 0.35, 1)
  const uAt = []
  let u = 0
  for (let x = xf; x <= xn + 2; x++) {
    uAt[x - xf] = u
    u += 1 / scale(x)
  }
  const U = x => uAt[Math.round(x) - xf] ?? 0
  const feet = []
  // Posts: two rows, the far one darker and shorter, peeking between the near ones.
  for (const far of [true, false]) {
    let next = far ? 7 : 0
    for (let x = xf; x <= xn; x++) {
      if (U(x) < next) continue
      next += 15
      const w = Math.max(1, Math.round(at(x, 1, 3)))
      const top = deckTop(x) + deckH(x) + beamH(x) - (far ? 1 : 0)
      const len = postL(x) - (far ? Math.round(at(x, 1, 3)) : 0)
      for (let k = 0; k < w; k++) {
        for (let y = top; y < top + len; y++) {
          const v = far ? 0.12 : k === 0 ? 0.55 : k === w - 1 ? 0.22 : 0.38
          L.set(x + k, y, tone(o.tones, v - (y - top) * 0.012, x + k, y, 0.1))
        }
      }
      if (!far) feet.push([x, top + len, w])
    }
  }
  // The deck: planks across it, their seams slanting with the perspective; the beam under its
  // near edge in shade; the near end of each plank catches the light.
  for (let x = xf; x <= xn; x++) {
    const top = deckTop(x)
    const d = deckH(x)
    const plank = Math.floor(U(x) / 3.2)
    for (let y = top; y < top + d; y++) {
      const across = (y - top) / Math.max(1, d - 1)
      // The seam: the plank boundary shifts a little left as it comes toward us.
      const seamU = U(x + Math.round(across * at(x, 0.5, 1.5)))
      const p = Math.floor(seamU / 4.4)
      const seam = Math.floor(U(x - 1 + Math.round(across * at(x, 0.5, 1.5))) / 4.4) !== p
      let v = 0.62 + 0.05 * (hash(p, 1, 7) - 0.5) * 2 - 0.12 * across
      if (seam) v -= 0.2
      if (y === top) v += 0.14
      v += 0.06 * (noise(x * 0.5, y, 3) - 0.5)
      L.set(x, y, tone(o.tones, v, x, y, 0.08))
    }
    void plank
    for (let y = top + d; y < top + d + beamH(x); y++) L.set(x, y, tone(o.tones, 0.18 + (y === top + d ? 0.08 : 0), x, y, 0.1))
  }
  // A lamp post at the far end.
  if (o.lamp) {
    const x = xf + 1
    const top = deckTop(x)
    for (let y = top - 9; y < top; y++) L.set(x, y, tone(o.tones, 0.3, x, y, 0))
    for (const [dx, dy, k] of [[-1, -10, 0], [0, -10, 0], [1, -10, 0], [-1, -11, 1], [0, -11, 2], [1, -11, 1], [-1, -12, 0], [0, -12, 0], [1, -12, 0], [0, -13, 0]]) {
      L.set(x + dx, top + dy, o.lamp[k])
    }
  }
  return { feet, deckTop, deckH, beamH, postL }
}

// ---------------------------------------------------------------- the rowboat

// A wooden rowboat seen from above the bank: the gunwale an eye-shaped ring, its inside with two
// thwarts and a pair of oars, a painted hull below the near gunwale down to the water. The bow
// points left. Cells go to bow, mid and stern layers so the boat can rock in steps.
// o: { x, y (waterline at the middle), a (half length), b (half width), depth, hull, stripe,
//      inner, rim, oar }. Returns the hull's waterline cells [[x, y]].
export function rowboat(parts, o) {
  const { x: cx, y: wy, a, b } = o
  const rowsOf = u => {
    const q = u / a // -1 bow .. 1 stern
    // The opening seen from above: widest a little aft of the middle, closing to a point at the
    // bow, still a little open at the transom.
    const half = q < 0 ? Math.pow(Math.max(0, 1 - Math.pow(-q, 1.6)), 0.6) : 0.3 + 0.7 * Math.pow(Math.max(0, 1 - Math.pow(q, 2.6)), 0.5)
    // The sheer: the near gunwale sweeps up toward the bow, less toward the stern.
    const sheer = wy - o.depth - (q < 0 ? 3.6 * q * q : 1.3 * q * q)
    // The keel runs flat under the middle and curves up to meet the stem at the bow, a little
    // toward the transom.
    const keel = q < 0 ? Math.pow(Math.max(0, (-q - 0.3) / 0.7), 1.5) * (wy - sheer) : 1.6 * Math.pow(Math.max(0, (q - 0.55) / 0.45), 2)
    return { half, near: sheer, far: sheer - b * half, water: wy - keel }
  }
  const layerAt = u => (u < -a / 3 ? parts.bow : u > a / 3 ? parts.stern : parts.mid)
  const water = []
  for (let x = Math.floor(cx - a); x <= Math.ceil(cx + a); x++) {
    const u = x + 0.5 - cx
    if (Math.abs(u) > a) continue
    const r = rowsOf(u)
    const q = u / a
    const L = layerAt(u)
    const near = Math.round(r.near)
    const far = Math.round(r.far)
    const bottom = Math.max(near, Math.round(r.water))
    const lit = 0.12 * -q // the bow, toward the light, a little brighter
    // The inside, between the far gunwale and the near one: shaded under the far side, two
    // thwarts across it.
    if (far < near) {
      L.set(x, far, tone(o.rim, 0.45 + lit, x, far, 0))
      for (let y = far + 1; y < near; y++) {
        const across = (y - far) / Math.max(1, near - far)
        let v = 0.25 + 0.4 * across + lit
        if (Math.abs(u - a * 0.32) < 1.6 || Math.abs(u + a * 0.18) < 1.6) v = 0.75 - 0.2 * across
        L.set(x, y, tone(o.inner, v, x, y, 0))
      }
    }
    // The near gunwale catches the light along its whole curve.
    L.set(x, near, o.rim[q < 0.35 ? 3 : 2])
    // The hull: a dark line under the rubbing strake, the paint lit high and darker toward the
    // water, a thin cream stripe that follows the sheer.
    for (let y = near + 1; y <= bottom; y++) {
      const k = y - near
      const t = k / Math.max(1, bottom - near)
      let c
      if (k === 1) c = o.hull[1]
      else if (k === 2 && Math.abs(q) < 0.85 && bottom - near >= 4) c = o.stripe[q < 0.4 ? 1 : 0]
      else c = tone(o.hull, 0.78 - 0.6 * t + lit - (q > 0.92 ? 0.2 : 0), x, y, 0)
      L.set(x, y, c)
    }
    if (bottom >= wy - 1) water.push([x, bottom + 1])
  }
  // The stem at the bow: a bright edge where the planks meet.
  {
    const x = Math.floor(cx - a + 0.5)
    const r = rowsOf(x + 0.5 - cx)
    layerAt(-a).set(x, Math.round(r.near) - 1, o.rim[3])
  }
  // The stern's transom: a flat end in shade.
  // Oars: shafts across the inside, blades out over the far side.
  for (const [u0, u1, dy0, dy1] of [[-a * 0.45, a * 0.75, 0.2, -1.6], [-a * 0.35, a * 0.55, 0.65, 1.8]]) {
    const r0 = rowsOf(u0)
    const r1 = rowsOf(u1)
    const pts = line(cx + u0, lerp(r0.far, r0.near, dy0 > 0 ? dy0 : 0.3), cx + u1, (r1.far + r1.near) / 2 + dy1)
    pts.forEach(([x, y], i) => {
      const L = layerAt(x + 0.5 - cx)
      const blade = i > pts.length - 5
      L.set(x, y, tone(o.oar, blade ? 0.85 : 0.55, x, y, 0))
      if (blade) L.set(x, y + 1, tone(o.oar, 0.4, x, y, 0))
    })
  }
  return water
}

// ---------------------------------------------------------------- reeds, flowers, grass

// A blade along a curve from its root: leaning, its tip bending over. Upper cells go to `tips`.
export function blade(still, tips, o) {
  const steps = Math.ceil(o.h * 1.6)
  let last = null
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = Math.round(o.x + o.lean * t * t + (o.bend ?? 0) * Math.pow(t, 4))
    const y = Math.round(o.y - o.h * t + (o.droop ?? 0) * Math.pow(t, 3))
    const key = x + ',' + y
    if (key === last) continue
    last = key
    const target = t > (o.split ?? 0.5) && tips ? tips : still
    let v = 0.25 + 0.5 * t + (o.shade ?? 0)
    target.set(x, y, tone(o.tones, v, x, y, 0.15))
    if (o.w > 1 && t < 0.45) target.set(x + 1, y, tone(o.tones, v - 0.25, x + 1, y, 0.15))
  }
}

// A cattail: a stem with a brown head and a thin spike above it.
export function cattail(still, tips, o) {
  blade(still, tips, { ...o, w: 1 })
  const hx = Math.round(o.x + o.lean * 0.72 * 0.72)
  const hy = Math.round(o.y - o.h * 0.72)
  for (let k = 0; k < 5; k++) {
    tips.set(hx, hy + k, tone(o.head, 0.65 - k * 0.08, hx, hy + k, 0))
    tips.set(hx + 1, hy + k, tone(o.head, 0.3 - k * 0.04, hx + 1, hy + k, 0))
  }
}

// A lupine: a spike of florets on a stem, lit on the left, palmate leaves at its foot.
export function lupine(still, head, o) {
  const { x, y, h } = o
  for (let k = 0; k < h; k++) still.set(x, y - k, tone(o.stem, 0.45, x, y - k, 0))
  const spike = Math.round(h * 0.55)
  for (let k = 0; k < spike; k++) {
    const yy = y - h + k
    const w = k < 2 ? 1 : k < spike - 1 ? 2 : 1
    for (let i = 0; i < w; i++) {
      const v = 0.75 - i * 0.35 - (k / spike) * 0.25 + ((k + i) % 2 ? -0.1 : 0.05)
      head.set(x - (w > 1 ? 0 : 0) + i - (w > 1 ? 1 : 0), yy, tone(o.tones, v, x + i, yy, 0))
    }
  }
  for (const dx of [-2, -1, 1, 2]) still.set(x + dx, y - 1 + (Math.abs(dx) > 1 ? 0 : -1), tone(o.stem, Math.abs(dx) > 1 ? 0.6 : 0.4, x + dx, y, 0))
}

// A small round flower on a stem: buttercup or daisy.
export function bloom(still, head, o) {
  for (let k = 1; k < o.h; k++) still.set(o.x, o.y - k, tone(o.stem, 0.4, o.x, o.y - k, 0))
  const hy = o.y - o.h
  if (o.kind === 'daisy') {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) head.set(o.x + dx, hy + dy, o.tones[dx < 0 || dy < 0 ? 1 : 0])
    head.set(o.x, hy, o.eye)
  } else {
    head.set(o.x, hy, o.tones[1])
    head.set(o.x + 1, hy, o.tones[0])
  }
}

// ---------------------------------------------------------------- reflections

// Mirrors a layer's cells about the water row of each column, into `dst`: darker, the water's
// colour mixed in, every few rows shifted or dropped by the ripples. waterAt(x) is the first row of
// water under column x.
export function reflect(src, dst, waterAt, o) {
  for (const [x, y, c] of cells(src)) {
    const w = waterAt(x)
    if (w === null || y >= w) continue
    const ry = 2 * w - 1 - y
    const d = ry - w
    if (d > (o.reach ?? 40)) continue
    // Ripples: some rows slide a cell, a few break up.
    const band = Math.floor(Math.pow(d + 1, 0.7))
    const shift = hash(band, 1, o.seed ?? 0) < 0.4 ? (band % 2 ? 1 : -1) : 0
    if (hash(x >> 1, ry, (o.seed ?? 0) + 3) < (o.gaps ?? 0.12) * smooth(d / 6)) continue
    // The water's colour mixed in, in three steps with distance (few colours, long runs).
    const f = (o.fade ?? [0.35, 0.5, 0.65])[Math.min(2, Math.floor(d / (o.stepRows ?? 6)))]
    dst.set(x + shift, ry, mix(c, o.tint, f))
  }
}
