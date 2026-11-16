// The test projects, built in Node the way the editor would save them (editor/PROJECT.md).
//   generated(): a generator-made scene: sky gradient, twinkling stars, drifting clouds, two
//     ridges, bobbing water and falling snow, in three moments (day, sunset, night) with each
//     palette colour set per moment.
//   harborStarter(pictures): the site theme Harbor opened as a starter (its three scenes as
//     cells, from browser.js) with a drifting cloud layer on top.
//   heavy(level): a detailed picture close to the app's limit, with near colours that the
//     exporter has to merge; heavy('over') is past what merging can save (the error path).
//   artwork(picture): uploaded art as an image layer (a dithered 24-colour picture), with an
//     animated 6-frame sprite that drifts, colour cycling and a pulse.
import { encodeCells } from '../lib/color.js'

const W = 320
const H = 200
const N = W * H

// A small seeded random source (mulberry32).
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const mix = (a, b, t) => {
  const p = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16))
  const q = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16))
  return '#' + p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

function base(name, slug, moments) {
  return { format: 'backdropkit-project', version: 1, name, slug, line: 'A test scene for the exporter.', w: W, h: H, palette: [], moments, layers: [] }
}
function slotAdder(p) {
  return colors => {
    p.palette.push({ id: 'c' + (p.palette.length + 1), colors })
    return p.palette.length
  }
}
function layer(p, name, kind, cells, extra = {}) {
  const L = { id: 'l' + (p.layers.length + 1), name, kind, visible: true, show: {}, cells: encodeCells(cells), byMoment: {}, gen: null, motion: { type: 'none' }, ...extra }
  p.layers.push(L)
  return L
}

const DSN = [
  { id: 'day', name: 'Day', start: 6 },
  { id: 'sunset', name: 'Sunset', start: 17 },
  { id: 'night', name: 'Night', start: 21 },
]

export function generated() {
  const p = base('Test Valley', 'test-valley', DSN)
  p.line = 'A valley under snow, with a lake.'
  const add = slotAdder(p)
  const r = rng(7)
  // Sky: 10 bands, top to bottom, dithered into each other (2-row Bayer steps).
  const top = { day: '#3f7fd0', sunset: '#3b3f86', night: '#0b1030' }
  const low = { day: '#bcdcf5', sunset: '#f0a070', night: '#29305a' }
  const bands = []
  for (let i = 0; i < 10; i++) bands.push(add(Object.fromEntries(Object.keys(top).map(m => [m, mix(top[m], low[m], i / 9)]))))
  const sky = new Uint16Array(N)
  const B4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
  for (let y = 0; y < H; y++) {
    const f = Math.min(9, (y / 140) * 9)
    for (let x = 0; x < W; x++) {
      const i = Math.floor(f)
      const t = f - i
      sky[y * W + x] = bands[t * 16 > B4[y % 4][x % 4] + 0.5 && i < 9 ? i + 1 : i]
    }
  }
  layer(p, 'Sky', 'sky', sky)
  // Stars: night only (and faint at sunset), single cells and a few crosses.
  const star = add({ day: '#ffffff', sunset: '#f6e7c8', night: '#fff8e0' })
  const star2 = add({ day: '#ffffff', sunset: '#c9c3e8', night: '#b8c4ff' })
  const stars = new Uint16Array(N)
  for (let i = 0; i < 170; i++) {
    const x = Math.floor(r() * W)
    const y = Math.floor(r() * 95)
    stars[y * W + x] = r() < 0.7 ? star : star2
    if (r() < 0.08 && x > 0 && x < W - 1 && y > 0) {
      stars[y * W + x - 1] = star2
      stars[y * W + x + 1] = star2
      stars[(y - 1) * W + x] = star2
      stars[(y + 1) * W + x] = star2
    }
  }
  layer(p, 'Stars', 'stars', stars, { show: { day: false }, motion: { type: 'twinkle', period: 6 } })
  // Clouds: soft blobs in three shades, two of them across the wrap.
  const cw = add({ day: '#ffffff', sunset: '#f7c9b0', night: '#3a4270' })
  const cm = add({ day: '#e4eef8', sunset: '#d99a8a', night: '#2f3762' })
  const cd = add({ day: '#c8d6e6', sunset: '#b07a80', night: '#262c52' })
  const clouds = new Uint16Array(N)
  const blobs = [[40, 30, 26, 7], [150, 48, 34, 8], [250, 22, 22, 6], [312, 60, 30, 7], [90, 70, 20, 5]]
  for (const [cx, cy, rx, ry] of blobs) {
    for (let y = cy - ry - 3; y <= cy + ry + 2; y++) {
      for (let dx = -rx - 3; dx <= rx + 3; dx++) {
        const x = (((cx + dx) % W) + W) % W
        const e = (dx / rx) ** 2 + ((y - cy) / ry) ** 2 + 0.25 * Math.sin(dx * 0.7) * Math.cos(y)
        if (e > 1 || y < 0 || y >= H) continue
        clouds[y * W + x] = y > cy + ry * 0.45 ? cd : y > cy - ry * 0.1 ? cm : cw
      }
    }
  }
  layer(p, 'Clouds', 'clouds', clouds, { motion: { type: 'drift', period: 120, dir: 1 } })
  // Two ridges, filled to the bottom so the water lies over them.
  const ridge = (y0, amp, seed, shades) => {
    const q = rng(seed)
    const a = [q() * 6, q() * 6, q() * 6]
    const cells = new Uint16Array(N)
    for (let x = 0; x < W; x++) {
      const h = y0 + amp * (0.5 * Math.sin(x / 41 + a[0]) + 0.3 * Math.sin(x / 17 + a[1]) + 0.2 * Math.sin(x / 7 + a[2]))
      for (let y = Math.max(0, Math.round(h)); y < H; y++) cells[y * W + x] = y < h + 2 ? shades[0] : y < h + 9 + 3 * Math.sin(x / 9) ? shades[1] : shades[2]
    }
    return cells
  }
  const far = [
    add({ day: '#e8eef6', sunset: '#f3c2a8', night: '#8b95c0' }),
    add({ day: '#8aa0c0', sunset: '#8a6a8c', night: '#303a66' }),
    add({ day: '#7088aa', sunset: '#6e5478', night: '#283058' }),
  ]
  layer(p, 'Far ridge', 'ridge', ridge(110, 18, 3, far))
  const near = [
    add({ day: '#f4f7fb', sunset: '#f7d2bc', night: '#a6b0d8' }),
    add({ day: '#4c6a58', sunset: '#4a3c52', night: '#1c2240' }),
    add({ day: '#3b5446', sunset: '#3a2e42', night: '#161b34' }),
  ]
  layer(p, 'Near ridge', 'ridge', ridge(138, 12, 9, near))
  // Water: rows 168 to 199, with a few lines of light.
  const w = [
    add({ day: '#3a6fa8', sunset: '#6a4a78', night: '#141c40' }),
    add({ day: '#4f86c0', sunset: '#a06a80', night: '#1d2852' }),
    add({ day: '#86b4e0', sunset: '#e0a088', night: '#36427a' }),
    add({ day: '#d8ecfa', sunset: '#f8d0a8', night: '#7080c0' }),
  ]
  const water = new Uint16Array(N)
  for (let y = 168; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = Math.sin(x / 9 + y * 1.3) + 0.6 * Math.sin(x / 3.7 - y * 0.8)
      water[y * W + x] = v > 1.2 ? w[3] : v > 0.6 ? w[2] : y < 176 || v > -0.2 ? w[1] : w[0]
    }
  }
  layer(p, 'Lake', 'water', water, { motion: { type: 'bob', period: 4, amount: 1 } })
  // Snow: flakes of one or two cells, falling.
  const flake = add({ day: '#ffffff', sunset: '#fff0e8', night: '#e6ecff' })
  const snow = new Uint16Array(N)
  for (let i = 0; i < 220; i++) {
    const x = Math.floor(r() * W)
    const y = Math.floor(r() * H)
    snow[y * W + x] = flake
    if (r() < 0.3 && x < W - 1) snow[y * W + x + 1] = flake
  }
  layer(p, 'Snow', 'paint', snow, { motion: { type: 'fall', period: 30 } })
  return p
}

// Harbor as a starter: `pictures` from browser.js pictureFromSvgs({ day, sunset, night }), and
// Harbor's schedule from packs.json.
export function harborStarter(merged, schedule) {
  const p = base('Harbor Clouds', 'harbor-clouds', schedule)
  p.line = 'A small harbour, with clouds going by.'
  p.palette = merged.palette.map((s, i) => ({ id: 'c' + (i + 1), colors: s.colors }))
  const L = layer(p, 'Harbor', 'picture', merged.byMoment[schedule[0].id])
  for (const m of schedule) L.byMoment[m.id] = encodeCells(merged.byMoment[m.id])
  const add = slotAdder(p)
  const a = add({ day: '#ffffff', sunset: '#ffd9c0', night: '#46507e' })
  const b = add({ day: '#e2ebf5', sunset: '#e8a890', night: '#363f6a' })
  const clouds = new Uint16Array(N)
  for (const [cx, cy, rx, ry] of [[60, 14, 18, 4], [200, 26, 24, 5], [300, 10, 14, 3]]) {
    for (let y = cy - ry; y <= cy + ry; y++) {
      for (let dx = -rx; dx <= rx; dx++) {
        if ((dx / rx) ** 2 + ((y - cy) / ry) ** 2 > 1 || y < 0) continue
        const x = (((cx + dx) % W) + W) % W
        clouds[y * W + x] = y > cy + 1 ? b : a
      }
    }
  }
  layer(p, 'Clouds', 'clouds', clouds, { motion: { type: 'drift', period: 90, dir: -1 } })
  return p
}

// A busy picture near the limit: a smooth field of many close colours (each step 2 levels
// apart, so the merge ladder has work) under a speckled texture. heavy('over') adds a fine
// dithered texture of distinct colours everywhere, past what merges can save.
export function heavy(variant = 'near') {
  const p = base(variant === 'over' ? 'Too Much' : 'Near The Limit', variant === 'over' ? 'too-much' : 'near-limit', [{ id: 'day', name: 'Day', start: 0 }])
  p.line = 'A field of close colours, to test the size limit.'
  const add = slotAdder(p)
  const r = rng(11)
  const RAMP = Number(process.env.HEAVY_RAMP ?? 64)
  const WAVE = Number(process.env.HEAVY_WAVE ?? 0)
  const ramp = []
  for (let i = 0; i < RAMP; i++) ramp.push(add({ day: mix('#203858', '#d8b080', i / (RAMP - 1)) }))
  const field = new Uint16Array(N)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = 0.5 + 0.25 * Math.sin(x / 23 + Math.sin(y / 17) * 2) + 0.17 * Math.sin(y / 11 - x / 37) + WAVE * Math.sin(x / 2.3 + y / 3.1)
      field[y * W + x] = ramp[Math.max(0, Math.min(RAMP - 1, Math.round(v * (RAMP - 1))))]
    }
  }
  layer(p, 'Field', 'paint', field)
  const dots = new Uint16Array(N)
  const dot = [add({ day: '#f0e8d0' }), add({ day: '#101820' }), add({ day: '#c04030' })]
  const many = variant === 'over' ? 9000 : 1500
  for (let i = 0; i < many; i++) dots[Math.floor(r() * N)] = dot[i % 3]
  layer(p, 'Speckle', 'paint', dots)
  // A few birds drifting across, so the scene has motion to play.
  const bird = add({ day: '#182028' })
  const birds = new Uint16Array(N)
  for (const [bx, by] of [[30, 20], [44, 26], [180, 14], [260, 30]]) for (const [dx, dy] of [[0, 0], [1, 1], [2, 1], [3, 0], [-1, 1], [-2, 1], [-3, 0]]) birds[(by + dy) * W + bx + dx] = bird
  layer(p, 'Birds', 'paint', birds, { motion: { type: 'drift', period: 200, dir: -1 } })
  if (variant === 'over') {
    const grain = new Uint16Array(N)
    const g = []
    for (let i = 0; i < 24; i++) g.push(add({ day: mix('#402010', '#f0f0ff', i / 23) }))
    for (let k = 0; k < N; k++) if ((k + Math.floor(k / W)) % 2 === 0) grain[k] = g[Math.floor(r() * 24)]
    layer(p, 'Grain', 'image', grain)
  }
  return p
}

// Uploaded art: `picture` ({ colors, cells }, from browser.js pictureFromImage, 24 colours,
// dithered) as an image layer cut to a framed region, with a 6-frame walking sprite that
// drifts, colour cycling on a sign and a pulsing lamp.
export function artwork(picture) {
  const p = base('Art Wall', 'art-wall', [
    { id: 'day', name: 'Day', start: 7 },
    { id: 'night', name: 'Night', start: 20 },
  ])
  p.line = 'A painting of a lake, with a lamp and a walking cat.'
  const add = slotAdder(p)
  // A wall and a frame, then the art in it: the middle 168 x 104 cells of the picture.
  const wall = add({ day: '#d8cfc0', night: '#2a2630' })
  const wallLo = add({ day: '#cfc5b4', night: '#24202a' })
  const frame = add({ day: '#6a4a2a', night: '#2a1e14' })
  const w = new Uint16Array(N)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) w[y * W + x] = (Math.floor(x / 40) + Math.floor(y / 20)) % 2 ? wallLo : wall
  for (let y = 22; y < 140; y++) for (let x = 70; x < 250; x++) w[y * W + x] = frame
  layer(p, 'Wall', 'paint', w)
  // The art's colours as slots; at night a darker, bluer version of each.
  const art = picture.colors.map(h => add({ day: h, night: mix(h, '#101830', 0.55) }))
  const cells = new Uint16Array(N)
  for (let y = 0; y < 104; y++) {
    for (let x = 0; x < 168; x++) {
      const v = picture.cells[(y + 48) * W + x + 76]
      if (v) cells[(y + 29) * W + x + 76] = art[v - 1]
    }
  }
  p.assets = { a1: { name: 'lake.png', w: 960, h: 600, frames: [{ png: '', delay: 0 }] } }
  layer(p, 'Painting', 'image', cells, { asset: 'a1', place: { x: 76, y: 29, scale: 1 / 3, flipX: false }, look: { preset: 'test' } })
  // A ground strip for the cat to walk on.
  const ground = add({ day: '#5a4636', night: '#241c18' })
  const groundHi = add({ day: '#7a6048', night: '#30261e' })
  const g = new Uint16Array(N)
  for (let y = 184; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = y === 184 ? groundHi : ground
  layer(p, 'Ground', 'paint', g)
  // The cat: 6 frames of a 12 x 8 sprite, legs moving, drifting right.
  const fur = add({ day: '#202020', night: '#0c0c10' })
  const eye = add({ day: '#e8d040', night: '#ffe860' })
  const frames = []
  for (let f = 0; f < 6; f++) {
    const c = new Uint16Array(N)
    const ox = 40
    const oy = 175
    const set = (x, y, s) => {
      c[(oy + y) * W + ox + x] = s
    }
    for (let x = 2; x < 10; x++) for (let y = 2; y < 6; y++) set(x, y, fur)
    for (let x = 9; x < 12; x++) for (let y = 0; y < 4; y++) set(x, y, fur)
    set(9, 0, 0)
    set(11, 1, eye)
    set(0, 1, fur)
    set(1, 2, fur)
    const legs = [[2, 4], [3, 5], [4, 6], [5, 7], [4, 6], [3, 5]][f]
    for (const lx of [legs[0], legs[1] + 3]) for (let y = 6; y < 9; y++) set(Math.min(11, lx), y, fur)
    frames.push(c)
  }
  layer(p, 'Cat', 'image', frames[0], { frames: frames.map(encodeCells), anim: { fps: 8 }, motion: { type: 'drift', period: 60, dir: 1 } })
  // A sign whose letters cycle through four colours, and a lamp that pulses.
  const neon = [add({ day: '#ff4060', night: '#ff3050' }), add({ day: '#ffb040', night: '#ffa030' }), add({ day: '#40d0ff', night: '#30c0ff' }), add({ day: '#a060ff', night: '#9050ff' })]
  const sign = new Uint16Array(N)
  const glyphs = ['111101111', '111010010', '101111101', '111100111']
  glyphs.forEach((gl, i) => {
    for (let j = 0; j < 9; j++) {
      if (gl[j] !== '1') continue
      const x = 250 + i * 5 + (j % 3)
      const y = 150 + Math.floor(j / 3)
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 1; dx++) sign[(y * 2 - 150 + dy) * W + x + dx] = neon[(i + j) % 4]
    }
  })
  layer(p, 'Sign', 'paint', sign, { live: [{ type: 'cycle', period: 2 }] })
  const glow = add({ day: '#fff0b0', night: '#ffe080' })
  const core = add({ day: '#ffffff', night: '#fffbe8' })
  const lamp = new Uint16Array(N)
  for (let y = 60; y < 72; y++) for (let x = 270; x < 282; x++) {
    const d = Math.hypot(x - 275.5, y - 65.5)
    if (d < 6) lamp[y * W + x] = d < 2.5 ? core : glow
  }
  layer(p, 'Lamp', 'paint', lamp, { live: [{ type: 'pulse', period: 4, low: 0.6 }, { type: 'glint', period: 8, slot: core }] })
  return p
}
