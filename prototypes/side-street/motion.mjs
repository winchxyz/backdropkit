// What moves in Side Street, as sprites for build.mjs. A sprite is { name, depth, layers, back,
// tier, noShadow, noSlice, diff, sweepX, sweepY, band, wrap, css }, and each of its layers is
// painted with the renderer ({ paint }), or given as fragments at cells of its own ({ cells }),
// or comes ready coloured ({ layer }); each with its { anim } and whether it is hidden in the
// first frame (hidden0). `back` sprites lie between the sky and the scene (clouds); the others
// are drawn over the scene in depth order, with the scene's nearer cells copied over them where
// they move. The `tier` sprite (the train) splits the scene into the cells behind it and the
// rest. `diff` frames keep their shared cells in a still layer.
//
// Every time is on the 0.05 s clock and every delay adds the shared --m.
import { Layer, rng } from '../../../sunfield/tools/pixel.mjs'
import { billow, paintCloud } from '../../../sunfield/tools/painters.mjs'
import * as core from './core.mjs'
import { C, F, H, HX, HY, W, YC, ZT, hash, mat, norm, poly, span, streetY, wire } from './core.mjs'

const t5 = s => Math.round(s * 20) / 20
const num = v => String(v).replace(/^0\./, '.').replace(/^-0\./, '-.')
const sec = s => num(t5(s)) + 's'
const pct = (t, T) => num(Math.round((t5(t) / T) * 1e6) / 1e4) + '%'
// Keyframes from [[seconds, css], ...] over a cycle of T seconds.
const kf = (name, T, list) => '@keyframes ' + name + '{' + list.map(([t, css]) => pct(t, T) + '{' + css + '}').join('') + '}'
const anim = (cls, T, delay = 0, extra = '') => '.' + cls + '{animation:' + cls + ' ' + sec(T) + ' steps(1) calc(' + sec(delay) + ' + var(--m)) infinite' + extra + '}'

const CYCLE = 90 // the crossing, the train and the cyclist share it
const cellAt = Z => Z / F

// ---------------------------------------------------------------- clouds
// Cumulus in the moment's tones, drifting a few cells there and back by whole cells.
function clouds(M) {
  const CL = M.clouds
  if (!CL) return []
  const r = rng(CL.seed ?? 5)
  const list = CL.list ?? [
    // A bank low behind the headland, half hidden by it.
    { id: 'ca', puffs: [{ x: 50, y: 50, r: 8 }, { x: 64, y: 45, r: 11 }, { x: 80, y: 48, r: 10 }, { x: 96, y: 45, r: 12 }, { x: 113, y: 51, r: 8 }], base: 58, drift: 10, dur: 70 },
    // A tall one in the open sky between the poles.
    { id: 'cb', puffs: [{ x: 148, y: 30, r: 8 }, { x: 160, y: 24, r: 10 }, { x: 173, y: 28, r: 8 }, { x: 184, y: 32, r: 6 }], base: 35, drift: 14, dur: 90 },
    // A small one up high on the left.
    { id: 'cc', puffs: [{ x: 22, y: 26, r: 5 }, { x: 31, y: 23, r: 6 }, { x: 40, y: 26, r: 4.5 }], base: 29, drift: 12, dur: 80 },
  ]
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
      css: ['.' + cls + '{animation:' + cls + ' ' + sec(c.dur) + ' steps(' + n + ') calc(' + sec(-r() * c.dur) + ' + var(--m)) infinite alternate}@keyframes ' + cls + '{to{transform:translateX(' + n + 'px)}}'],
    })
  }
  return out
}

// ---------------------------------------------------------------- small pixel drawings
// A grid of characters drawn by hand or with lines and rings, turned into fragments at cells
// of their own: each character names an albedo, a palette key and a normal.
function grid() {
  const m = new Map()
  const set = (x, y, ch) => m.set(Math.round(x) + ',' + Math.round(y), ch)
  return {
    m,
    set,
    line(x0, y0, x1, y1, ch) {
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))))
      for (let i = 0; i <= n; i++) set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, ch)
    },
    ring(cx, cy, r, ch, fill) {
      for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
        for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
          const d = Math.hypot(x - cx, y - cy)
          if (Math.abs(d - r) < 0.5) set(x, y, ch)
          else if (fill && d < r - 0.5) set(x, y, fill)
        }
      }
    },
    rows(list, ox = 0, oy = 0) {
      list.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && ch !== ' ' && set(ox + i, oy + j, ch)))
    },
  }
}
// Cells for a grid placed with its (0, 0) at screen cell (x0, y0), at depth Z.
function cellsOf(g, x0, y0, Z, pal) {
  const out = []
  for (const [k, ch] of g.m) {
    const p = pal[ch]
    if (!p) continue
    const [gx, gy] = k.split(',').map(Number)
    const x = x0 + gx
    const y = y0 + gy
    const P = [((x + 0.5 - HX) * Z) / F, ((y + 0.5 - HY) * Z) / F, Z]
    out.push({ x, y, f: { ...p, p: P, n: p.n ?? [0, 0, -1] } })
  }
  return out
}
const LITN = norm([-0.45, -0.6, -0.65]) // a face turned up and to the left
const SHDN = norm([0.45, 0.25, -0.85]) // turned away

// ---------------------------------------------------------------- the cat
// A calico sitting on the parapet's cap, looking out over the bay, its tail hanging down the
// lane side of the wall; now and then the tail's tip lifts and curls.
function cat(M) {
  const Z = 6.6
  const capY = streetY(Z) - 0.68
  const x0 = 67
  const y0 = Math.round(HY + (F * capY) / Z) - 12
  const pal = {
    W: { a: C('#f4efe4'), k: 'catW', n: LITN },
    w: { a: C('#cbc2b2'), k: 'catW', n: SHDN },
    O: { a: C('#e48a38'), k: 'catO', n: LITN },
    o: { a: C('#a85f26'), k: 'catO', n: SHDN },
    K: { a: C('#3a3330'), k: 'catK', n: LITN },
    k: { a: C('#221e1c'), k: 'catK', n: SHDN },
    E: { a: C('#c9c04a'), k: 'catE', e: M.catEye ?? [0, 0, 0], n: LITN },
    P: { a: C('#e29a92'), k: 'catP', n: LITN },
  }
  const body = grid()
  body.rows([
    '.K.K.........',
    '.KKK.........',
    'KKKKO........',
    'KEKOO........',
    'PWWWOO.......',
    '.WWWOOO......',
    '.WWWWOOO.....',
    '..WWWKOOO....',
    '..WWWWKKOo...',
    '..WWWWWOOoo..',
    '..WWWWWWOoo..',
    '.wWwwWWWWwoo.',
  ])
  const tailA = grid()
  tailA.rows(['KO', '.K', '.O', '.K', '.k'], 11, 10)
  const tailB = grid()
  tailB.rows(['..K', '.KO', 'KO.', 'O..'], 11, 8)
  const T = 9
  return {
    name: 'cat',
    depth: Z - 0.05,
    diff: false,
    layers: [
      { cells: cellsOf(body, x0, y0, Z, pal) },
      { cells: cellsOf(tailA, x0, y0, Z, pal), anim: { cls: 'ta' } },
      { cells: cellsOf(tailB, x0, y0, Z, pal), anim: { cls: 'tb', extra: " opacity='0'" }, hidden0: true },
    ],
    css: [
      anim('ta', T) + kf('ta', T, [[0, 'opacity:1'], [5.5, 'opacity:0'], [6.3, 'opacity:1'], [6.9, 'opacity:0'], [7.6, 'opacity:1']]),
      anim('tb', T) + kf('tb', T, [[0, 'opacity:0'], [5.5, 'opacity:1'], [6.3, 'opacity:0'], [6.9, 'opacity:1'], [7.6, 'opacity:0']]),
    ],
  }
}

// ---------------------------------------------------------------- laundry
// Towels, a shirt and a pinch hanger of socks on the shop's balcony, stirring in three frames.
function laundry(M, scene) {
  const yb = scene.yb
  const yp = yb - 1.75
  const Z = 11.45
  const items = [
    { x0: 3.42, x1: 3.95, len: 0.74, c: (u, v) => (v > 0.5 && v < 0.6) || (v > 0.64 && v < 0.68) ? '#3d6fb0' : '#f3f1ea', k: 'towel' },
    { x0: 4.22, x1: 4.98, len: 0.62, shirt: true, c: () => '#efd88a', k: 'shirt' },
    { x0: 5.18, x1: 5.56, len: 0.56, c: (u, v) => (v > 0.48 ? '#d97f8c' : '#f0a7b0'), k: 'towel2' },
    { x0: 5.86, x1: 6.06, len: 0.32, c: () => '#4b5563', k: 'sock' },
    { x0: 6.2, x1: 6.4, len: 0.28, c: () => '#f2f0ea', k: 'sock' },
    { x0: 6.52, x1: 6.72, len: 0.34, c: () => '#7d9fc4', k: 'sock' },
  ]
  // Bottom offsets in metres for each frame (a cell is 5 cm here).
  const sway = [
    [0, 0, 0, 0, 0, 0],
    [0.06, 0.05, 0.02, 0.06, 0.05, 0.06],
    [-0.05, -0.02, -0.05, -0.04, -0.05, -0.03],
  ]
  const frame = f => () => {
    items.forEach((it, i) => {
      const dx = sway[f][i]
      const top = it.k === 'sock' ? yp + 0.28 : yp
      const pts = [[it.x0, top, Z], [it.x1, top, Z], [it.x1 + dx, top + it.len, Z], [it.x0 + dx, top + it.len, Z]]
      if (it.shirt) {
        // A T-shirt on a hanger: wide at the shoulders, sleeves out, narrower below.
        pts.splice(0, 4, [it.x0 + 0.1, top + 0.05, Z], [it.x1 - 0.1, top + 0.05, Z], [it.x1 + 0.02, top + 0.2, Z], [it.x1 - 0.12 + dx * 0.4, top + 0.27, Z], [it.x1 - 0.12 + dx, top + it.len, Z], [it.x0 + 0.12 + dx, top + it.len, Z], [it.x0 + 0.12 + dx * 0.4, top + 0.27, Z], [it.x0 - 0.02, top + 0.2, Z])
      }
      poly(pts, P => {
        const v = P[1] - top
        const u = P[0] - it.x0 - dx * (v / it.len)
        const folds = it.k !== 'sock' && Math.floor(u / Math.max(0.1, cellAt(Z) * 2)) % 2 === 0 && v > 0.15
        return mat(it.c(u, v), it.k, { n: folds ? SHDN : [0, 0, -1], glow: true })
      })
    })
    // The pinch hanger's frame and its hook.
    const fm = () => mat('#9fa4a8', 'hanger')
    wire([[5.8, yp + 0.28, Z], [6.8, yp + 0.28, Z]], fm)
    wire([[6.3, yp, Z], [6.3, yp + 0.28, Z]], fm)
    wire([[4.6, yp - 0.06, Z], [4.6, yp + 0.05, Z]], fm)
  }
  return {
    name: 'laundry',
    depth: Z,
    diff: true,
    sweepX: [-1, 1],
    layers: [
      { paint: frame(0), anim: { cls: 'la' } },
      { paint: frame(1), anim: { cls: 'lb', extra: " opacity='0'" }, hidden0: true },
      { paint: frame(2), anim: { cls: 'lc', extra: " opacity='0'" }, hidden0: true },
    ],
    css: (() => {
      const T = 7.5
      const on = { la: [[0, 1], [3.0, 0], [4.0, 1], [6.0, 0], [6.75, 1]], lb: [[0, 0], [3.0, 1], [4.0, 0]], lc: [[0, 0], [6.0, 1], [6.75, 0]] }
      return Object.entries(on).map(([c, l]) => anim(c, T, -2) + kf(c, T, l.map(([t, o]) => [t, 'opacity:' + o])))
    })(),
  }
}

// ---------------------------------------------------------------- the crossing
// Times in the 90 s cycle.
const L_ON = 20
const ARM_DN = [22.5, 23.5]
const TRAIN = [21.95, 42.6]
const ARM_UP = [43.5, 44.5]
const L_OFF = 45
function crossing(M, scene) {
  const out = []
  for (const [j, d] of scene.devices.entries()) {
    const g = YC
    const zc = d.Z - 0.1
    const ly = g - 2.35
    const far = d.Z > ZT
    // The lamps, lit: a bright lens, a glow on the backplate round it.
    out.push({
      name: 'lamps' + j,
      depth: zc - 0.05,
      noShadow: true,
      layers: [{
        paint: () => {
          for (const sx of [-0.32, 0.32]) {
            const c = [d.X + sx, ly, zc - 0.04]
            const pts = []
            for (let i = 0; i < 16; i++) pts.push([c[0] + Math.cos((i / 16) * Math.PI * 2) * 0.2, c[1] + Math.sin((i / 16) * Math.PI * 2) * 0.2, c[2]])
            poly(pts, P => {
              const r = Math.hypot(P[0] - c[0], P[1] - c[1])
              if (r < 0.05) return mat('#000000', 'lampOn', { e: C('#ffd0b8'), flat: true })
              if (r < 0.12) return mat('#000000', 'lampOn', { e: C('#ff4630'), flat: true })
              if (P[1] < c[1] - 0.08) return null
              return mat('#000000', 'lampGlow', { e: C(M.lampGlowC ?? '#6a2a22'), flat: true })
            })
          }
        },
        anim: { cls: 'xl', extra: " opacity='0'" },
        hidden0: true,
      }],
    })
    // The arm in three frames: up, half way, down across the lane.
    const piv = [d.X + d.s * 0.2, g - 0.85, d.Z - 0.12]
    const len = 4.7
    const ends = [[d.s * 0.18, -len], [d.s * len * 0.7, -len * 0.7], [d.s * len, -0.05]]
    const arm = e => () => {
      const pts = []
      const n = 80
      for (let i = 0; i <= n; i++) pts.push([piv[0] + (e[0] * i) / n, piv[1] + (e[1] * i) / n, piv[2]])
      wire(pts, P => {
        const t = Math.hypot(P[0] - piv[0], P[1] - piv[1])
        return mat(Math.floor(t / 0.42) % 2 ? '#202020' : '#f2c522', 'xarm', { n: [0, -0.6, -0.8] })
      }, { bias: 0.02 })
    }
    const cls = ['xu', 'xm', 'xd']
    out.push({
      name: 'arm' + j,
      depth: piv[2] - 0.02,
      noShadow: true,
      layers: ends.map((e, f) => ({ paint: arm(e), anim: { cls: cls[f], extra: f ? " opacity='0'" : '' }, hidden0: f > 0 })),
    })
  }
  const T = CYCLE
  const o = v => 'opacity:' + v
  const css = [
    anim('xl', T) + kf('xl', T, [[0, o(0)], [L_ON, o(0.35)], [L_ON + 0.1, o(0.7)], [L_ON + 0.2, o(1)], [L_OFF, o(0.7)], [L_OFF + 0.1, o(0.35)], [L_OFF + 0.2, o(0)]]),
    anim('xu', T) + kf('xu', T, [[0, o(1)], [ARM_DN[0], o(0)], [ARM_UP[1], o(1)]]),
    anim('xm', T) + kf('xm', T, [[0, o(0)], [ARM_DN[0], o(1)], [ARM_DN[1], o(0)], [ARM_UP[0], o(1)], [ARM_UP[1], o(0)]]),
    anim('xd', T) + kf('xd', T, [[0, o(0)], [ARM_DN[1], o(1)], [ARM_UP[0], o(0)]]),
  ]
  out[0].css = css
  return out
}

// ---------------------------------------------------------------- the train
// Two stainless cars with a green band, at the near rail's side, drawn cell by cell at their
// own place off to the right and slid left across the crossing in whole cells.
function train(M) {
  const Zf = ZT - 1.45
  const s = F / Zf
  const railY = YC - 0.17
  const X0 = 340 // the front's column before it sets off
  const carL = 18
  const gap = 0.7
  const len = Math.ceil((carL * 2 + gap) * s)
  const yOf = Yrel => HY + (F * (railY - Yrel)) / Zf
  const yTop = Math.floor(HY + (F * (YC - 5.1)) / ZT) - 1
  const yBot = Math.ceil(yOf(0.12))
  const cells = []
  const side = [0, 0, -1]
  const roofN = norm([0, -0.95, -0.3])
  const glass = (y, m) => (M.trainLit ? { a: [0, 0, 0], k: 'twin', e: M.trainLit, flat: true } : { a: [0.06, 0.07, 0.09], k: 'twin', e: M.glassSky.map(c => c * (0.6 + 0.25 * ((m * 3.1) % 1 > 0.7 ? 1 : 0))) })
  const add = (x, y, f, n = side) => cells.push({ x, y, f: { ...f, n, p: [((x + 0.5 - HX) * Zf) / F, ((y + 0.5 - HY) * Zf) / F, Zf] } })
  for (let i = 0; i < len; i++) {
    const m = (i + 0.5) / s
    const car = m < carL ? 0 : m > carL + gap ? 1 : -1
    const mc = car === 0 ? m : m - carL - gap
    const x = X0 + i
    if (car < 0) {
      // The gangway between the cars.
      for (let y = Math.ceil(yOf(3.3)); y <= Math.floor(yOf(1.1)); y++) add(x, y, mat('#3b3d40', 'tdark'))
      continue
    }
    const endCab = (car === 0 && mc < 2.2) || (car === 1 && mc > carL - 2.2)
    for (let y = yTop; y <= yBot; y++) {
      const Yrel = railY - ((y + 0.5 - HY) * Zf) / F
      // The roof, seen a little from above, with air conditioners and, on the second car, the
      // pantograph reaching up to the wire.
      if (Yrel > 3.65) {
        const yRoofC = HY + (F * (railY - 3.92)) / ZT
        if (y + 0.5 >= yRoofC) {
          if (mc < 0.35 || mc > carL - 0.35) continue
          add(x, y, mat('#8f949a', 'troof'), roofN)
          continue
        }
        const ac = (mc > 4 && mc < 6.6) || (mc > 11.4 && mc < 14)
        if (ac && y + 0.5 >= yRoofC - 2) {
          add(x, y, mat(y + 0.5 >= yRoofC - 1 ? '#a9aeb3' : '#c4c8cc', 'tac'), roofN)
          continue
        }
        if (car === 1 && mc > 7.6 && mc < 10.2) {
          // Pantograph: a diamond of thin bars from the roof to the contact wire.
          const wireY = HY + (F * (YC - 5.1)) / ZT
          const h = yRoofC - wireY
          const q = (y + 0.5 - wireY) / h
          if (q >= 0 && q <= 1) {
            const half = (1 - Math.abs(q - 0.5) * 2) * 1.0 + 0.15
            if (Math.abs(Math.abs(mc - 8.9) - half) < 0.07 || (q < 0.08 && Math.abs(mc - 8.9) < 0.8)) add(x, y, mat('#4a4c50', 'tpanto'))
          }
        }
        continue
      }
      // Rounded corners at the car ends.
      if ((mc < 0.3 || mc > carL - 0.3) && (Yrel > 3.4 || Yrel < 0.2)) continue
      if (Yrel < 1.1) {
        // Under the floor: bogies with their wheels, equipment boxes between.
        const bog = [2.7, carL - 2.7].find(b => Math.abs(mc - b) < 1.35)
        if (bog !== undefined) {
          for (const ax of [bog - 0.55, bog + 0.55]) {
            const r = Math.hypot((mc - ax), Yrel - 0.43)
            if (r < 0.43) {
              add(x, y, mat(r > 0.34 ? '#6d6f72' : '#2a2a2c', 'twheel'))
              break
            }
          }
          if (cells.at(-1)?.x === x && cells.at(-1)?.y === y) continue
          if (Yrel > 0.45 && Yrel < 0.95) add(x, y, mat('#3a3c3f', 'tdark'))
          continue
        }
        if (Yrel > 0.95) add(x, y, mat('#6a6e73', 'tskirt'))
        else if (Yrel > 0.45 && mc > 4.6 && mc < carL - 4.6 && Math.floor(mc / 1.6) % 3 !== 0) add(x, y, mat('#45484c', 'tdark'))
        continue
      }
      if (Yrel > 3.55) {
        add(x, y, mat('#9aa0a6', 'tbody'))
        continue
      }
      // Doors: four a side.
      const door = [2.1, 6.6, 11.4, 15.9].find(dc => Math.abs(mc - dc) < 0.66)
      if (door !== undefined) {
        const du = mc - door
        if (Math.abs(du) > 0.6 || Math.abs(du) < 0.03 || Yrel > 3.3) {
          add(x, y, mat('#5c6167', 'tline'))
          continue
        }
        if (Yrel > 2.15 && Yrel < 3.05 && Math.abs(du) > 0.13 && Math.abs(du) < 0.5) {
          add(x, y, glass(y, mc))
          continue
        }
        add(x, y, mat(Yrel > 1.62 && Yrel < 1.84 ? '#2e8f7a' : '#c9ced3', Yrel > 1.62 && Yrel < 1.84 ? 'tband' : 'tbody'))
        continue
      }
      // The band along the side, amber line over it.
      if (Yrel > 1.62 && Yrel < 1.84) {
        add(x, y, mat('#2e8f7a', 'tband'))
        continue
      }
      if (Yrel >= 1.84 && Yrel < 1.92) {
        add(x, y, mat('#e3a33a', 'tline2'))
        continue
      }
      // Windows between the doors; at the cab ends, a small one and a sign box.
      if (endCab) {
        const cm = car === 0 ? mc : carL - mc
        if (cm > 0.45 && cm < 1.35 && Yrel > 3.1 && Yrel < 3.4) {
          add(x, y, mat('#000000', 'tsign', { e: C(M.trainSign ?? '#e8a040'), flat: true }))
          continue
        }
        if (cm > 0.5 && cm < 1.25 && Yrel > 2.1 && Yrel < 2.95) {
          add(x, y, glass(y, mc))
          continue
        }
      } else if (Yrel > 2.05 && Yrel < 3.0) {
        const bay = mc % 4.6
        if ((bay > 0.95 && bay < 2.15) || (bay > 2.45 && bay < 3.65)) {
          add(x, y, glass(y, mc))
          continue
        }
      }
      const seam = (mc % 1.05) < 1 / s
      add(x, y, mat(seam ? '#aeb4ba' : '#c9ced3', 'tbody'))
    }
  }
  const T = CYCLE
  const dist = X0 + len
  return {
    name: 'train',
    depth: Zf,
    tier: true,
    band: { x0: 0, x1: W - 1, y0: yTop, y1: yBot },
    layers: [{ cells, anim: { cls: 'tr' } }],
    css: [
      '.tr{animation:tr ' + sec(T) + ' linear calc(0s + var(--m)) infinite}' +
        kf('tr', T, [[0, 'transform:none'], [TRAIN[0], 'transform:none;animation-timing-function:steps(' + dist + ')'], [TRAIN[1], 'transform:translateX(-' + dist + 'px)'], [T, 'transform:translateX(-' + dist + 'px)']]),
    ],
  }
}

// ---------------------------------------------------------------- the cyclist
// Someone on a shopping bicycle along the path by the tracks, right to left, once a cycle.
function cyclist(M) {
  const Z = 33.75
  const gY = YC
  const yG = Math.round(HY + (F * gY) / Z) - 1
  const frames = [0, 1].map(f => {
    const g = grid()
    // Wheels, frame, basket, saddle (a cell is 15 cm here).
    g.ring(2, -2, 2, 't')
    g.ring(9, -2, 2, 't')
    g.set(2, -2, 's')
    g.set(9, -2, 's')
    g.line(9, -2, 6, -2, 'f')
    g.line(6, -2, 3.4, -5, 'f')
    g.line(6, -2, 7, -5.4, 'f')
    g.line(3.4, -5, 3, -6.6, 's')
    g.line(3, -6.6, 4.2, -6.8, 's')
    g.rows(['bb', 'bB'], 1, -6)
    g.line(6.6, -6, 7.6, -6, 'k')
    // The rider: dark trousers, a white shirt, black hair, an arm out to the bars.
    const knee = f ? [6.6, -4.6] : [5.8, -5.2]
    const foot = f ? [7, -1.4] : [5.2, -2.6]
    g.line(7.2, -6.6, knee[0], knee[1], 'p')
    g.line(knee[0], knee[1], foot[0], foot[1], 'p')
    g.line(7.2, -7, 6, -10, 'S')
    g.line(7.9, -7.2, 6.7, -10, 'S')
    g.line(6.2, -9.4, 4, -6.9, 'a')
    g.rows(['hh', 'hF'], 5, -12)
    return g
  })
  const pal = {
    t: { a: C('#232427'), k: 'cytyre' },
    s: { a: C('#b9bdc1'), k: 'cysteel', n: LITN },
    f: { a: C('#c94f3c'), k: 'cyframe', n: LITN },
    b: { a: C('#9ea3a8'), k: 'cybasket' },
    B: { a: C('#d9b36a'), k: 'cybag', n: LITN },
    k: { a: C('#2a2624'), k: 'cydark' },
    p: { a: C('#2f3a52'), k: 'cypants', n: LITN },
    S: { a: C('#f1efe8'), k: 'cyshirt', n: LITN },
    a: { a: C('#e8c2a0'), k: 'cyskin', n: LITN },
    F: { a: C('#e8c2a0'), k: 'cyskin', n: LITN },
    h: { a: C('#231d1a'), k: 'cydark' },
  }
  const x0 = 214 // the start: behind the shop's corner
  const ride = [59, 70]
  const dist = x0 + 14
  const T = CYCLE
  const o = v => 'opacity:' + v
  return {
    name: 'cyclist',
    depth: Z - 0.1,
    noShadow: true,
    band: { x0: 0, x1: x0 + 14, y0: yG - 13, y1: yG + 1 },
    wrap: ["<g class='cy' opacity='0'>", '</g>'],
    layers: [
      { cells: cellsOf(frames[0], x0, yG, Z, pal), anim: { cls: 'pa' }, hidden0: true },
      { cells: cellsOf(frames[1], x0, yG, Z, pal), anim: { cls: 'pb', extra: " opacity='0'" }, hidden0: true },
    ],
    css: [
      '.cy{animation:cy ' + sec(T) + ' linear calc(0s + var(--m)) infinite}' +
        kf('cy', T, [[0, 'transform:none;opacity:0'], [ride[0], 'transform:none;opacity:1;animation-timing-function:steps(' + dist + ')'], [ride[1], 'transform:translateX(-' + dist + 'px);opacity:1'], [ride[1] + 0.05, 'transform:translateX(-' + dist + 'px);opacity:0'], [T, 'transform:translateX(-' + dist + 'px);opacity:0']]),
      anim('pa', 1) + kf('pa', 1, [[0, o(1)], [0.5, o(0)]]),
      anim('pb', 1) + kf('pb', 1, [[0, o(0)], [0.5, o(1)]]),
    ],
  }
}

// ---------------------------------------------------------------- wires
// The long cables and the drop to the shop sway by a cell at their middles, each on its own beat.
function wires(M, scene) {
  const out = []
  const list = scene.spans.filter(s => s[4])
  const beats = [[7, 2.5, -1.5], [8.5, 3, -4], [6, 2, -2.5]]
  list.forEach(([a, b, sag, thick], j) => {
    const zm = (a[2] + b[2]) / 2
    const d = cellAt(zm) * 1.05
    const paint = extraSag => () => {
      const pts = span(a, b, sag + extraSag, 60)
      const wm = () => mat('#2c2c30', 'wire')
      wire(pts, wm)
      if (thick) wire(pts.map(p => [p[0], p[1] + cellAt(p[2]), p[2]]), wm)
    }
    const [T, hold, delay] = beats[j % beats.length]
    const ca = 'wa' + j
    const cb = 'wb' + j
    out.push({
      name: 'span' + j,
      depth: Math.min(a[2], b[2]) + 0.5,
      noShadow: true,
      diff: true,
      layers: [
        { paint: paint(0), anim: { cls: ca } },
        { paint: paint(d), anim: { cls: cb, extra: " opacity='0'" }, hidden0: true },
      ],
      css: [anim(ca, T, delay) + kf(ca, T, [[0, 'opacity:1'], [T - hold, 'opacity:0']]), anim(cb, T, delay) + kf(cb, T, [[0, 'opacity:0'], [T - hold, 'opacity:1']])],
    })
  })
  return out
}

// ---------------------------------------------------------------- sea glitter
// Sparks on the open water in three sets that take turns, half a second each.
function glitter(M) {
  const G = M.glitter
  if (!G) return []
  const gf = core.gf
  const gz = core.gz
  const r = rng(G.seed ?? 9)
  const sets = [0, 1, 2].map(i => new Layer('glit' + i))
  for (let y = HY; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const f = gf[i]
      if (!f || f.k !== 'sea') continue
      // Only where the water is open all round, so a spark never sits on an edge.
      if ([i - 1, i + 1, i - W, i + W].some(j => !gf[j] || gf[j].k !== 'sea')) continue
      const w = G.weight(x, y, gz[i])
      if (w <= 0 || r() > w) continue
      const set = sets[Math.floor(r() * 3)]
      set.set(x, y, G.tones[r() < (G.hot ?? 0.3) ? 0 : 1])
      if (G.wide && r() < G.wide) set.set(x + 1, y, G.tones[1])
    }
  }
  const T = 1.5
  return sets.map((L, i) => ({
    name: 'glitter' + i,
    depth: 1e8,
    noSlice: true,
    layers: [{ layer: L, anim: { cls: 'gl', style: '--l:' + sec(-i * 0.5), extra: i ? " opacity='0'" : '' }, hidden0: i > 0 }],
    css: ['.gl{animation:gl ' + sec(T) + ' steps(1) calc(var(--l) + var(--m)) infinite}' + kf('gl', T, [[0, 'opacity:1'], [0.5, 'opacity:0']])],
  }))
}

// ---------------------------------------------------------------- sun rays
// Beams fanning out from the low sun over the sky and the far bay, a pale colour dithered to
// fade with distance, laid on thin and breathing slowly.
function rays(M) {
  const R = M.rays
  if (!R) return []
  const gf = core.gf
  const gz = core.gz
  const L = new Layer('rays')
  const N = R.n * 2
  for (let y = 0; y < 150; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (gf[i] && gz[i] < 300) continue
      const dx = x + 0.5 - R.x
      const dy = y + 0.5 - R.y
      const d = Math.hypot(dx, dy)
      if (d < 10) continue
      const a = (Math.atan2(dy, dx) / (Math.PI * 2) + 0.5) * N
      const idx = Math.floor(a)
      if (hash(idx, 5, 3) < 0.45) continue
      const edge = Math.min(a - idx, idx + 1 - a) * 2 // 0 at a wedge's sides, 1 in its middle
      const reach = 50 + 90 * hash(idx, 7, 3)
      const I = Math.min(1, edge * 2.2) * (1 - d / reach)
      if (I <= 0) continue
      if (I > 0.3) L.set(x, y, R.c)
    }
  }
  const T = 24
  return [{
    name: 'rays',
    depth: 1e8,
    noSlice: true,
    layers: [{ layer: L, anim: { cls: 'ry', extra: " opacity='.2'" } }],
    css: [anim('ry', T) + kf('ry', T, [[0, 'opacity:.2'], [4, 'opacity:.24'], [8, 'opacity:.28'], [12, 'opacity:.3'], [16, 'opacity:.26'], [20, 'opacity:.22']])],
  }]
}

export function paintSprites(M, scene) {
  // The glitter reads the scene's own cells, so it goes first, before any sprite is painted.
  const g = glitter(M)
  const ry = rays(M)
  return [...clouds(M), ...ry, ...g, cat(M), laundry(M, scene), ...crossing(M, scene), train(M), cyclist(M), ...wires(M, scene)]
}
