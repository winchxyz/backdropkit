// The BackdropKit exporter: a project (editor/PROJECT.md) in, the scenes the Claude desktop app
// plays and the installable theme archive out. Plain ES module with no dependencies and no
// DOM: it runs in the browser, in a worker and in Node. The DOM-only helpers (looks, the
// preview, pictures from SVG and images) are in browser.js.
//
// A scene, per moment:
// 1. The layers shown at that moment, bottom first, each as colour cells (frames for an
//    animated one). A layer with no motion, one frame and no live effect is still; still
//    layers next to one another are flattened into one picture.
// 2. Cells no still layer covers are filled from the nearest colour (under a moving layer,
//    from that layer at rest), so nothing behind the scene ever shows. Cells empty in every
//    layer are a warning.
// 3. Still cells a still layer above always covers are dropped, keeping a one-cell margin
//    under every edge (so the edge of the upper one lies over solid colour).
// 4. Every part is written by the engine's hairline-safe encoder (encode.js): still pictures
//    with 55 runs or more as pattern tiles on the cell grid with a clear cell all round, cut
//    into bands of at most 28,000 cells that overlap by two rows (see encodeStill); moving
//    layers as plain paths in two coats.
// 5. Motion and live effects are CSS steps on the shared 0.05 s clock (motion.js).
// 6. Over the app's 131,072 characters, near colours are merged, one level at a time up to
//    six; still over, it is an error that names the layers that cost most.
import { FN, FW, FX, at, emitSafe, costOf } from './encode.js'
import { decodeCells, encodeCells, levels, lum, normHex, rgbOf, utf8 } from './color.js'
import { TICK, cycleBody, flipPlan, plan, planLive, ruleBook, secs } from './motion.js'
import { archiveEntries, installPrompt, themeJs } from './archive.js'
import { zip } from './zip.js'

export { encodeCells, decodeCells }
export { plan as playMotion } from './motion.js'

export const W = 320
export const H = 200
export const N = W * H
// The app's player takes a scene of at most this many characters, counted after its
// still-frame scrub, and the raw scene must fit too with room for the theme module's --m
// stamp (register.tsx, sceneAt).
export const LIMIT = 131072
export const HEADROOM = 16
// The player stops the motion for good when its per-frame work averages more than this over
// three seconds (1000 / 60 / 3 ms in the app's code).
export const FRAME_LIMIT_MS = 1000 / 60 / 3
// The colour merges tried, in levels (the largest channel step a colour may move).
export const MERGE_LEVELS = [0, 1, 2, 3, 4, 5, 6]
// The site's own themes: a project with one of these slugs would install over it.
export const SITE_SLUGS = ['cloud-sea', 'deep-reef', 'gas-station', 'harbor', 'hill-village', 'lavender-slope', 'low-orbit', 'mirror-lake', 'moon-keep', 'rainy-studio', 'side-street', 'snowfall-ridge', 'sunbeam-wood', 'sunfield', 'tide-line']
// The theme template's files (engine/theme-mod/hooks/), which the browser fetches from
// docs/editor/mod/hooks/ and passes to buildArchive as modFiles.
export const MOD_FILES = ['board.d.ts', 'board.js', 'colors.d.ts', 'colors.js', 'hooks.json', 'make-colors.d.ts', 'make-colors.js', 'register.test.tsx', 'register.tsx', 'theme.d.ts']

// The encoder's settings for every part (as Harbor's): T 28, paths of more than 21 and less
// than 120 cells across span at most 19 rows, no outer-edge backing, three backings tried. The
// colour orders tried are darkest first and 'group' (encode.js: near colours that meet, up to
// 40 apart, drawn together), not largest first: on a whole picture (Harbor rasterized) largest
// first left up to 108 line pixels where two near colours meet, as the colour drawn between
// them shows through their edge (NOTES.md, Decisions).
const SAFE = { T: 28, maxRows: 19, narrow: 21, wide: 120, edge: false, order: ['lum', 'group'], near: 40, backs: 3 }
const PATTERN_MIN = 55
const TILE_CELLS = 28000
const TILE_WIDE = 1000

const MOTIONS = ['none', 'drift', 'fall', 'sway', 'bob', 'twinkle']
const LIVES = ['cycle', 'pulse', 'glint']
const MOMENT_ID = /^[a-z0-9-]+$/
const SLUG = /^[a-z][a-z0-9-]{1,39}$/

/* ---------- The project at one moment ---------- */

const momentIds = project => (project.moments ?? []).map(m => m.id)

// Each palette slot's colour at a moment ('#rrggbb'); a slot with none falls back to the
// first moment it has a colour for (the project's first moment first).
function slotColours(project, mid) {
  const ids = momentIds(project)
  return (project.palette ?? []).map(p => {
    const c = p?.colors ?? {}
    let h = normHex(c[mid])
    for (const id of ids) h ??= normHex(c[id])
    for (const v of Object.values(c)) h ??= normHex(v)
    return h ?? '#000000'
  })
}

const shown = (L, mid) => L && L.visible !== false && L.show?.[mid] !== false
const layerName = L => (L.name ? String(L.name) : L.id)

// The colour table of a scene: entries { hex, rgb, real } where `real` is the index of the
// plain colour (a cycling layer's colours get entries of their own, written as placeholders
// and swapped for an animated stroke afterwards).
function newTable() {
  const t = { hex: [], rgb: [], lum: [], real: [], cycle: [], index: new Map() }
  t.add = hex => {
    let i = t.index.get(hex)
    if (i === undefined) {
      i = t.hex.length
      t.index.set(hex, i)
      t.hex.push(hex)
      t.rgb.push(rgbOf(hex))
      t.lum.push(lum(hex))
      t.real.push(i)
      t.cycle.push(false)
    }
    return i
  }
  t.addCycle = hex => {
    const real = t.add(hex)
    const i = t.hex.length
    t.hex.push('Q' + i)
    t.rgb.push(rgbOf(hex))
    t.lum.push(lum(hex))
    t.real.push(real)
    t.cycle.push(true)
    return i
  }
  return t
}

// A part of the picture on the encoder's frame grid: col (colour index per frame cell, -1 for
// none) and its cells (sorted).
function blank() {
  return { col: new Int32Array(FN).fill(-1), cells: [] }
}
function finish(p) {
  p.cells = []
  for (let k = 0; k < FN; k++) if (p.col[k] >= 0) p.cells.push(k)
  return p
}

// The layers of a moment, read and checked: [{ i, L, name, frames: [Uint16Array], motion,
// lives, still }]. Problems go to `problems`.
function readLayers(project, mid, problems) {
  const slots = project.palette?.length ?? 0
  const out = []
  for (const [i, L] of (project.layers ?? []).entries()) {
    if (!shown(L, mid)) continue
    const name = layerName(L)
    const src = Array.isArray(L.frames) && L.frames.length ? L.frames : [L.byMoment?.[mid] ?? L.cells]
    const frames = src.map(b => decodeCells(b, N))
    let bad = 0
    for (const f of frames) for (let k = 0; k < N; k++) if (f[k] > slots) {
      f[k] = 0
      bad++
    }
    if (bad) problems.push({ level: 'error', text: `${name} uses ${bad} cells of palette slots that do not exist; they are left empty.`, layer: L.id })
    let motion = plan(L.motion)
    if (L.motion?.type && !MOTIONS.includes(L.motion.type)) problems.push({ level: 'warn', text: `${name}: unknown motion "${L.motion.type}", left still.`, layer: L.id })
    const lives = []
    for (const e of Array.isArray(L.live) ? L.live : []) {
      if (!LIVES.includes(e?.type)) {
        problems.push({ level: 'warn', text: `${name}: unknown live effect "${e?.type}", left out.`, layer: L.id })
        continue
      }
      if (lives.some(x => x.type === e.type)) {
        problems.push({ level: 'warn', text: `${name}: a second ${e.type} is left out (one of each per layer).`, layer: L.id })
        continue
      }
      lives.push(e)
    }
    const any = frames.some(f => f.some(v => v > 0))
    if (!any) continue
    const still = motion.type === 'none' && frames.length === 1 && !lives.length
    out.push({ i, L, id: L.id, name, frames, motion, lives, still, fps: L.anim?.fps })
  }
  return out
}

/* ---------- Building a moment's picture ---------- */

// The parts of a moment, before encoding: { units, table, problems, empty }. A unit is a still
// picture ({ kind: 'still', part, owner }) or a moving layer ({ kind: 'move', layer, ... }).
function prepare(project, mid) {
  const problems = []
  const hexes = slotColours(project, mid)
  const layers = readLayers(project, mid, problems)
  const table = newTable()
  const units = []
  for (const R of layers) {
    const cycle = R.lives.find(e => e.type === 'cycle')
    if (R.still) {
      let u = units[units.length - 1]
      if (!u || u.kind !== 'still') {
        u = { kind: 'still', part: blank(), owner: new Int16Array(FN).fill(-1), names: [] }
        units.push(u)
      }
      u.names.push(R)
      const f = R.frames[0]
      for (let k = 0; k < N; k++) {
        const s = f[k]
        if (!s) continue
        const fk = at(k % W, (k / W) | 0)
        u.part.col[fk] = table.add(hexes[s - 1])
        u.owner[fk] = R.i
      }
      continue
    }
    // A moving or animated layer: its frames as parts, with the colours it cycles through.
    let order = null
    if (cycle) {
      const used = new Set()
      for (const f of R.frames) for (let k = 0; k < N; k++) if (f[k]) used.add(f[k])
      order = [...used].sort((a, b) => a - b)
    }
    const cyc = new Map()
    if (order) for (const s of order) cyc.set(s, table.addCycle(hexes[s - 1]))
    const frames = R.frames.map(f => {
      const p = blank()
      for (let k = 0; k < N; k++) {
        const s = f[k]
        if (!s) continue
        p.col[at(k % W, (k / W) | 0)] = order ? cyc.get(s) : table.add(hexes[s - 1])
      }
      return p
    })
    units.push({ kind: 'move', layer: R, frames, cycle: order ? order.map(s => ({ slot: s, idx: cyc.get(s), hex: hexes[s - 1] })) : null, hexes })
  }
  if (!units.length) return { units, table, problems: [...problems, { level: 'error', text: `Nothing is shown at ${mid}: every layer is hidden or empty.` }], empty: N }

  // Fill: every cell no still unit covers, from the nearest colour shown at rest (the topmost
  // there; a moving layer's own colour where it lies at rest).
  const stillCov = new Uint8Array(FN)
  for (const u of units) if (u.kind === 'still') for (let k = 0; k < FN; k++) if (u.part.col[k] >= 0) stillCov[k] = 1
  const rest = new Int32Array(FN).fill(-1)
  for (const u of units) {
    const p = u.kind === 'still' ? u.part : u.frames[0]
    for (let k = 0; k < FN; k++) if (p.col[k] >= 0) rest[k] = table.real[p.col[k]]
  }
  const fill = new Int32Array(FN).fill(-1)
  const queue = new Int32Array(N)
  let head = 0
  let tail = 0
  let holes = 0
  let empty = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = at(x, y)
      if (stillCov[k]) continue
      holes++
      if (rest[k] >= 0) {
        fill[k] = rest[k]
        queue[tail++] = k
      } else empty++
    }
  }
  if (holes) {
    // Seeds: the covered cells next to a hole, then the holes under moving layers.
    const seen = new Uint8Array(FN)
    for (let q = 0; q < tail; q++) seen[queue[q]] = 1
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = at(x, y)
        if (!stillCov[k] || rest[k] < 0) continue
        if ((x > 0 && !stillCov[k - 1]) || (x < W - 1 && !stillCov[k + 1]) || (y > 0 && !stillCov[k - FW]) || (y < H - 1 && !stillCov[k + FW])) {
          seen[k] = 1
          fill[k] = rest[k]
          queue[tail++] = k
        }
      }
    }
    while (head < tail) {
      const k = queue[head++]
      const x = (k % FW) - FX
      const y = ((k / FW) | 0) - FX
      for (const [n, ok] of [[k - 1, x > 0], [k + 1, x < W - 1], [k - FW, y > 0], [k + FW, y < H - 1]]) {
        if (!ok || seen[n] || stillCov[n]) continue
        seen[n] = 1
        fill[n] = fill[k]
        queue[tail++] = n
      }
    }
    let bottom = units[0]
    if (bottom.kind !== 'still') {
      bottom = { kind: 'still', part: blank(), owner: new Int16Array(FN).fill(-1), names: [] }
      units.unshift(bottom)
    }
    let filled = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = at(x, y)
        if (stillCov[k] || fill[k] < 0) continue
        bottom.part.col[k] = fill[k]
        bottom.owner[k] = -2
        filled++
      }
    }
    if (empty) problems.push({ level: 'warn', text: `${empty} cells at ${mid} are empty in every layer; they are filled with the nearest colour.` })
    if (filled < holes) problems.push({ level: 'error', text: `${holes - filled} cells at ${mid} could not be filled.` })
  }

  // Cull: still cells under a still unit above, unless a neighbour of theirs (8 round) shows.
  const covered = new Uint8Array(FN)
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i]
    if (u.kind !== 'still') continue
    const col = u.part.col
    const mine = []
    for (let k = 0; k < FN; k++) if (col[k] >= 0) mine.push(k)
    const drop = []
    for (const k of mine) {
      if (!covered[k]) continue
      let keep = false
      for (const n of [k - 1, k + 1, k - FW, k + FW, k - FW - 1, k - FW + 1, k + FW - 1, k + FW + 1]) {
        if (col[n] >= 0 && !covered[n]) {
          keep = true
          break
        }
      }
      if (!keep) drop.push(k)
    }
    for (const k of drop) {
      col[k] = -1
      u.owner[k] = -1
    }
    for (const k of mine) covered[k] = 1
  }
  for (const u of units) if (u.kind === 'still') finish(u.part)
  for (const u of units) if (u.kind === 'move') for (const f of u.frames) finish(f)
  return { units, table, problems, empty }
}

/* ---------- Colour merges ---------- */

// The colour index each colour is written as at merge level `d`: colours are taken commonest
// first; each joins the nearest colour already kept that is within d levels on every channel
// (or is kept itself). Cycling colours are never merged.
function mergeMap(prep, d) {
  const t = prep.table
  const map = Int32Array.from(t.hex.keys())
  if (!d) return map
  const count = new Float64Array(t.hex.length)
  for (const u of prep.units) {
    const parts = u.kind === 'still' ? [u.part] : u.frames
    for (const p of parts) for (const k of p.cells) count[p.col[k]]++
  }
  const order = [...t.hex.keys()].filter(i => !t.cycle[i] && count[i] > 0).sort((a, b) => count[b] - count[a] || a - b)
  const kept = []
  for (const c of order) {
    const [r, g, b] = t.rgb[c]
    let best = -1
    let bestD = Infinity
    for (const a of kept) {
      const [ar, ag, ab] = t.rgb[a]
      const e = Math.max(Math.abs(r - ar), Math.abs(g - ag), Math.abs(b - ab))
      if (e <= d && e < bestD) {
        best = a
        bestD = e
      }
    }
    if (best >= 0) map[c] = best
    else kept.push(c)
  }
  return map
}

const remap = (p, map) => {
  const col = new Int32Array(FN).fill(-1)
  for (const k of p.cells) col[k] = map[p.col[k]]
  return { col, cells: p.cells }
}

/* ---------- Encoding ---------- */

// The scene's ids (patterns and coats): a, b, ..., z, aa, ...
function idMaker() {
  let i = 0
  return () => {
    let n = i++
    let s = ''
    do {
      s = String.fromCharCode(97 + (n % 26)) + s
      n = Math.floor(n / 26) - 1
    } while (n >= 0)
    return s
  }
}

function encoderColours(t) {
  const rgb = new Int16Array(3 * t.hex.length)
  t.rgb.forEach(([r, g, b], i) => {
    rgb[3 * i] = r
    rgb[3 * i + 1] = g
    rgb[3 * i + 2] = b
  })
  return { hex: t.hex, rgb, lum: t.lum }
}

// Row runs of a part, a quick count of what the encoder will write.
function quickRuns(p) {
  let n = 0
  for (const k of p.cells) if (p.col[k - 1] !== p.col[k]) n++
  return n
}

function boundsOf(cells) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const k of cells) {
    const x = (k % FW) - FX
    const y = ((k / FW) | 0) - FX
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

// A still picture: plain paths when small, else pattern tiles (bands when the tile would be
// over 28,000 cells or 1,000 wide). Each tile's box keeps a clear cell on every side and its
// corner on a cell corner. Bands overlap by two rows: a band carries the next band's first
// row, and the next band repeats this band's last row as strict cells (only their own colour
// covers them). With one row of overlap (Snowfall Ridge's split, without its `hidden` cells)
// the edge between the strict row and the row under it lay over the upper tile's own edge,
// and seamscan found holes and lines all along the join.
function encodeStill(p, C, ctx) {
  if (!p.cells.length) return { svg: '', paths: 0 }
  if (quickRuns(p) < PATTERN_MIN) {
    const e = emitSafe(p, { ...ctx.safe, colors: C })
    return { svg: e.svg, paths: e.paths }
  }
  const b = boundsOf(p.cells)
  const wide = b.x1 - b.x0 + 2
  const tall = b.y1 - b.y0
  const perBand = Math.max(1, Math.floor(TILE_CELLS / wide) - 4)
  const nb = wide > TILE_WIDE ? Infinity : Math.ceil(tall / perBand)
  if (!Number.isFinite(nb)) {
    const e = emitSafe(p, { ...ctx.safe, colors: C })
    return { svg: e.svg, paths: e.paths }
  }
  const hb = Math.ceil(tall / nb)
  let svg = ''
  let paths = 0
  for (let i = 0; i < nb; i++) {
    const top = b.y0 + i * hb
    if (top >= b.y1) break
    // The band also carries the next band's first row under it, so the edge between that
    // band's strict row and the row after it lies over solid paint of the same colours.
    const bot = Math.min(b.y1, top + hb + 1)
    const from = i > 0 ? top - 1 : top
    const part = { col: new Int32Array(FN).fill(-1), cells: [] }
    const strict = i > 0 ? new Uint8Array(FN) : undefined
    for (const k of p.cells) {
      const y = ((k / FW) | 0) - FX
      if (y < from || y >= bot) continue
      part.col[k] = p.col[k]
      part.cells.push(k)
      if (strict && y === from) strict[k] = 1
    }
    if (!part.cells.length) continue
    const bb = boundsOf(part.cells)
    const x = bb.x0 - 1
    const y = bb.y0 - 1.5
    const id = ctx.id()
    const e = emitSafe(part, { ...ctx.safe, colors: C, ox: x, oy: y, ...(strict ? { strict } : {}) })
    ctx.defs.push("<pattern id='" + id + "' width='1' height='1'>" + e.svg + '</pattern>')
    svg += "<rect x='" + x + "' y='" + y + "' width='" + (bb.x1 - bb.x0 + 2) + "' height='" + (bb.y1 - bb.y0 + 2) + "' fill='url(#" + id + ")'/>"
    paths += e.paths + 1
  }
  return { svg, paths }
}

// A part of a moving layer as plain paths. Cycling colours are written with T -1 (every edge
// covered whatever colours meet there) and no backing.
function encodeMovingPart(p, C, cycling, ctx) {
  if (!p.cells.length) return { svg: '', paths: 0 }
  const e = emitSafe(p, { ...ctx.safe, colors: C, ...(cycling ? { T: -1, back: 'none' } : {}) })
  return { svg: e.svg, paths: e.paths }
}

// The cells of a frame copied one wrapped column (drift) or row (fall) past each side, so the
// seam between the layer and its copy lies over the same colour.
function wrapped(p, axis) {
  const q = { col: p.col.slice(), cells: [] }
  if (axis === 'X') {
    for (let y = 0; y < H; y++) {
      const l = p.col[at(0, y)]
      const r = p.col[at(W - 1, y)]
      if (l >= 0) q.col[at(W, y)] = l
      if (r >= 0) q.col[at(-1, y)] = r
    }
  } else {
    for (let x = 0; x < W; x++) {
      const t = p.col[at(x, 0)]
      const b = p.col[at(x, H - 1)]
      if (t >= 0) q.col[at(x, H)] = t
      if (b >= 0) q.col[at(x, -1)] = b
    }
  }
  return finish(q)
}

// 8-connected pieces of a set of cells, numbered in reading order.
function pieces(cells, has) {
  const label = new Int32Array(FN).fill(-1)
  let n = 0
  const stack = []
  for (const k of cells) {
    if (label[k] >= 0) continue
    label[k] = n
    stack.push(k)
    while (stack.length) {
      const c = stack.pop()
      for (const d of [-1, 1, -FW, FW, -FW - 1, -FW + 1, FW - 1, FW + 1]) {
        const m = c + d
        if (has[m] && label[m] < 0) {
          label[m] = n
          stack.push(m)
        }
      }
    }
    n++
  }
  return { label, count: n }
}

const restrict = (p, keep) => {
  const q = { col: new Int32Array(FN).fill(-1), cells: [] }
  for (const k of p.cells) if (keep(k)) {
    q.col[k] = p.col[k]
    q.cells.push(k)
  }
  return q
}

// A moving or animated layer: { svg, paths, draws, animated, notes }.
//   draws: how many times the player draws its cells each frame (two coats, a wrap copy);
//   animated: how many elements carry an animation.
function encodeMove(u, map, C, ctx, problems, mid) {
  const R = u.layer
  const m = R.motion
  const cycling = !!u.cycle
  let frames = u.frames.map(f => (cycling ? f : remap(f, map)))
  if (m.type === 'drift' || m.type === 'fall') frames = frames.map(f => wrapped(f, m.axis))
  const flip = frames.length > 1 ? flipPlan(frames.length, R.fps) : null
  let animated = 0
  let paths = 0

  // The frames of a part, each shown in its slot of the flipbook.
  const flipbook = list => {
    let s = ''
    list.forEach((f, i) => {
      const e = encodeMovingPart(f, C, cycling, ctx)
      paths += e.paths
      if (!flip) {
        s += e.svg
        return
      }
      const cls = ctx.rules.use(flip)
      const l = flip.delay(i)
      s += "<g class='" + cls + "'" + (l ? " style='--l:" + secs(-l) + "'" : '') + (i ? " opacity='0'" : '') + '>' + e.svg + '</g>'
      animated++
    })
    return s
  }
  const coats = inner => {
    const id = ctx.id()
    return "<g id='" + id + "'>" + inner + "</g><use href='#" + id + "'/>"
  }

  let body = ''
  if (m.type === 'twinkle') {
    const has = new Uint8Array(FN)
    for (const f of frames) for (const k of f.cells) has[k] = 1
    const all = []
    for (let k = 0; k < FN; k++) if (has[k]) all.push(k)
    const { label } = pieces(all, has)
    const cls = ctx.rules.use(m)
    for (let g = 0; g < 4; g++) {
      const part = frames.map(f => restrict(f, k => label[k] % 4 === g))
      if (!part.some(f => f.cells.length)) continue
      const l = m.delay(g)
      body += "<g class='" + cls + "'" + (l ? " style='--l:" + secs(-l) + "'" : '') + '>' + coats(flipbook(part)) + '</g>'
      animated++
    }
  } else {
    body = coats(flipbook(frames))
  }

  // Glint: diagonal stripes of the layer's inner cells in the glint colour, each shown for one
  // tick at the start of the period, one after another.
  const glint = R.lives.find(e => e.type === 'glint')
  if (glint) {
    if (u.frames.length > 1) problems.push({ level: 'warn', text: `${R.name}: glint is not available on a layer with frames; left out.`, layer: R.id })
    else {
      const f0 = u.frames[0]
      const inner = f0.cells.filter(k => f0.col[k - 1] >= 0 && f0.col[k + 1] >= 0 && f0.col[k - FW] >= 0 && f0.col[k + FW] >= 0)
      if (!inner.length) problems.push({ level: 'warn', text: `${R.name}: glint needs a layer at least three cells thick; left out.`, layer: R.id })
      else {
        let d0 = Infinity
        let d1 = -Infinity
        for (const k of inner) {
          const d = (k % FW) + ((k / FW) | 0)
          if (d < d0) d0 = d
          if (d > d1) d1 = d
        }
        const span = d1 - d0 + 1
        const width = Math.max(3, Math.ceil(span / 32))
        const stripes = Math.ceil(span / width)
        const gp = planLive(glint, { stripes })
        const slot = Number(glint.slot)
        const hex = (slot >= 1 && u.hexes[slot - 1]) || '#ffffff'
        const gi = ctx.table.add(hex)
        const cls = ctx.rules.use(gp)
        const C2 = encoderColours(ctx.table)
        let wrapStripes = ''
        for (let s = 0; s < Math.min(stripes, gp.n); s++) {
          const q = { col: new Int32Array(FN).fill(-1), cells: [] }
          for (const k of inner) {
            const d = (k % FW) + ((k / FW) | 0) - d0
            if (Math.floor(d / width) !== s) continue
            q.col[k] = gi
            q.cells.push(k)
          }
          if (!q.cells.length) continue
          const e = emitSafe(q, { ...ctx.safe, colors: C2 })
          paths += e.paths
          const l = gp.delay(s)
          wrapStripes += "<g class='" + cls + "'" + (l ? " style='--l:" + secs(-l) + "'" : '') + " opacity='0'>" + e.svg + '</g>'
          animated++
        }
        body += wrapStripes
      }
    }
  }

  let draws = 2 // two coats
  if (m.type === 'drift' || m.type === 'fall') {
    const id = ctx.id()
    const cls = ctx.rules.use(m)
    body = "<g class='" + cls + "'><g id='" + id + "'>" + body + "</g><use href='#" + id + "'" + m.copy + '/></g>'
    draws *= 2
    animated++
  } else if (m.type === 'sway' || m.type === 'bob') {
    body = "<g class='" + ctx.rules.use(m) + "'>" + body + '</g>'
    animated++
  }

  const pulse = R.lives.find(e => e.type === 'pulse')
  if (pulse) {
    body = "<g class='" + ctx.rules.use(planLive(pulse)) + "'>" + body + '</g>'
    animated++
  }

  // Cycle: each colour's paths take an animated stroke, colour i running i steps ahead.
  if (cycling) {
    const cp = planLive(R.lives.find(e => e.type === 'cycle'), { colours: u.cycle.length })
    const seq = u.cycle.map(c => c.hex)
    const cls = ctx.rules.use({ key: 'cycle:' + R.id + ':' + cp.n + ':' + seq.join(',') }, (name, c) => cycleBody(name, c, cp.n, cp.k, seq))
    const pos = new Map(u.cycle.map((c, i) => [c.idx, i]))
    body = body.replace(/stroke='Q(\d+)'/g, (_, n) => {
      const i = pos.get(Number(n))
      const l = cp.delay(i)
      animated++
      return "class='" + cls + "'" + (l ? " style='--l:" + secs(-l) + "'" : '') + " stroke='" + shortHexOf(ctx.table.hex[ctx.table.real[Number(n)]]) + "'"
    })
  }
  return { svg: body, paths, draws, animated }
}

const shortHexOf = h => (h.length === 7 && h[1] === h[2] && h[3] === h[4] && h[5] === h[6] ? '#' + h[1] + h[3] + h[5] : h)

/* ---------- The scrub and the frame cost ---------- */

// What the app's still-frame scrub makes of one of these scenes, in characters: every CSS
// rule loses its animation (".a{animation:...}" becomes ".a { }"), keyframes go, the
// reduced-motion rule is written out in full, and every self-closing tag is written open and
// closed (<path .../> as <path ...></path>). Checked against sunfield/tools/app-check.mjs with
// STILL=1 (editor/test).
export function scrubbedLength(svg) {
  let n = svg.length
  for (const m of svg.matchAll(/<([a-zA-Z]+)\b[^<>]*\/>/g)) n += m[1].length + 2
  const s = /<style>([\s\S]*?)<\/style>/.exec(svg)
  if (s) n += keptCss(s[1]).length - s[1].length
  return n
}
function keptCss(css) {
  let out = ''
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    const head = css.slice(i, open).trim()
    let depth = 0
    let j = open
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++
      else if (css[j] === '}' && --depth === 0) break
    }
    const inner = css.slice(open + 1, j)
    i = j + 1
    if (head.startsWith('@keyframes')) continue
    if (head.startsWith('@media')) {
      const q = head.slice(6).trim().replace(/\(\s*([\w-]+)\s*:\s*([\w-]+)\s*\)/g, '($1: $2)')
      out += '@media ' + q + ' {' + keptCss(inner).replace(/^|(?<=\})(?=.)/g, '\n  ') + '\n}'
      continue
    }
    const decls = inner.split(';').filter(d => d.trim() && !/^\s*(?:-[a-z]+-)?(?:animation|transition)/i.test(d))
    const sel = head.split(',').map(x => x.trim().replace(/\s+/g, ' ')).join(', ')
    out += sel + ' {' + (decls.length ? ' ' + decls.map(d => d.trim().replace(/\s*:\s*/, ': ') + ';').join(' ') : '') + ' }'
  }
  return out
}

// An estimate of the player's work per frame, in ms (its own measure: draw the picture onto a
// 64 x 40 canvas, read it back, run the flash detector), almost all of it the read, which waits
// for the picture to be drawn again: a fixed part, plus the characters of still parts, plus
// moving * K^power for the K thousand characters of moving parts drawn each frame (each coat
// and copy counts; the scene's moving parts together, shared out by their K), plus each
// animated element. Fitted to editor/test/player.mjs runs on the test scenes and two heavier
// ones (NOTES.md): within about 0.3 ms from 0.5 to 6.4 ms. The still picture (100k to 130k
// characters in every scene measured) adds little the runs could tell apart.
export const FRAME_MODEL = { base: 0.3, perKStill: 0.002, moving: 0.08, power: 0.69, perAnimated: 0.002 }

/* ---------- One moment's scene ---------- */

function encodeScene(prep, level, mid, safe) {
  const map = mergeMap(prep, level)
  const rules = ruleBook()
  const ctx = { id: idMaker(), defs: [], rules, table: prep.table, safe: { ...SAFE, ...safe } }
  const problems = []
  let C = encoderColours(prep.table)
  let body = ''
  const shares = new Map()
  const share = (R, chars, ms, k = 0) => {
    const key = R ? R.id : '(fill)'
    const s = shares.get(key) ?? { layer: R ? R.id : null, name: R ? R.name : 'Filled empty cells', chars: 0, ms: 0, k: 0 }
    s.chars += chars
    s.ms += ms
    s.k += k
    shares.set(key, s)
  }
  for (const u of prep.units) {
    if (u.kind === 'still') {
      const defsBefore = ctx.defs.length
      const e = encodeStill(remap(u.part, map), C, ctx)
      body += e.svg
      const defsLen = ctx.defs.slice(defsBefore).reduce((n, d) => n + d.length, 0)
      const chars = e.svg.length + defsLen + 6 * e.paths
      // Shared out by the runs each layer starts in this picture (what the characters pay
      // for), not by its cells: a plain wall under a dithered painting costs little.
      const count = new Map()
      const col = u.part.col
      let total = 0
      for (const k of u.part.cells) {
        if (col[k - 1] === col[k] && u.owner[k - 1] === u.owner[k]) continue
        count.set(u.owner[k], (count.get(u.owner[k]) ?? 0) + 1)
        total++
      }
      total ||= 1
      const ms = (chars / 1000) * FRAME_MODEL.perKStill
      for (const [o, c] of count) {
        const R = o >= 0 ? u.names.find(r => r.i === o) : null
        share(R, (chars * c) / total, (ms * c) / total)
      }
    } else {
      const e = encodeMove(u, map, C, ctx, problems, mid)
      C = encoderColours(prep.table)
      body += e.svg
      const chars = e.svg.length + 6 * e.paths
      share(u.layer, chars, e.animated * FRAME_MODEL.perAnimated, (chars / 1000) * e.draws)
    }
  }
  // The moving parts' term, shared out by what each draws.
  const K = [...shares.values()].reduce((n, s) => n + s.k, 0)
  if (K > 0) {
    const moving = FRAME_MODEL.moving * K ** FRAME_MODEL.power
    for (const s of shares.values()) s.ms += (moving * s.k) / K
  }
  const css = rules.css
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' fill='none' font-family='a' color='a' style='--m:0s'>" +
    (css ? '<style>' + css + '</style>' : '') +
    (ctx.defs.length ? '<defs>' + ctx.defs.join('') + '</defs>' : '') +
    "<svg viewBox='0 -.5 320 200' preserveAspectRatio='xMidYMax slice'>" +
    body +
    '</svg></svg>'
  const chars = scrubbedLength(svg)
  const costs = [...shares.values()].map(({ k, ...s }) => ({ ...s, chars: Math.round(s.chars), ms: Math.round(s.ms * 1000) / 1000 }))
  const ms = FRAME_MODEL.base + costs.reduce((n, c) => n + c.ms, 0)
  return { svg, chars, raw: svg.length, problems, costs, ms: Math.round(ms * 100) / 100, level, css: css.length, motion: rules.count > 0 }
}

const fits = r => r.chars <= LIMIT && r.raw + HEADROOM <= LIMIT

// One moment's scene: { svg, chars, raw, problems, costs: [{ layer, name, chars, ms }], ms,
// merged }. `chars` is what the app counts (after its still-frame scrub); `raw` the file's
// own length; `ms` the estimated frame cost in the player; `merged` the colour merge level
// that was needed (0 for none).
export function exportScene(project, momentId, opts = {}) {
  const mid = momentId ?? project?.moments?.[0]?.id
  const own = checkProject(project)
  if (!project?.moments?.some(m => m.id === mid)) {
    return { svg: '', chars: 0, raw: 0, problems: [...own, { level: 'error', text: `There is no moment "${mid}".` }], costs: [], ms: 0, merged: 0 }
  }
  const prep = prepare(project, mid)
  if (!prep.units.length) return { svg: '', chars: 0, raw: 0, problems: [...own, ...prep.problems], costs: [], ms: 0, merged: 0 }
  const name = project.moments.find(m => m.id === mid)?.name ?? mid
  const size = x => Math.max(x.chars, x.raw + HEADROOM)
  let r
  let first
  let best
  for (const level of opts.levels ?? MERGE_LEVELS) {
    r = encodeScene(prep, level, mid, opts.encoder)
    first ??= r
    if (!best || size(r) < size(best)) best = r
    if (fits(r)) break
  }
  // None fits: report the smallest one tried (merges do not always make a scene shorter).
  if (!fits(r)) r = best
  const problems = [...own, ...prep.problems, ...r.problems]
  if (r.level > 0 && fits(r)) {
    problems.push({ level: 'warn', text: `${name}: near colours merged (up to ${r.level} levels on a channel) to fit the app's ${LIMIT.toLocaleString('en-US')} characters; it was ${first.chars.toLocaleString('en-US')}.` })
  }
  if (!fits(r)) {
    const over = size(r) - LIMIT
    const top = [...r.costs].sort((a, b) => b.chars - a.chars).slice(0, 3)
    let art = false
    const list = top
      .map(c => {
        const L = project.layers.find(l => l.id === c.layer)
        const isArt = L && (L.kind === 'image' || L.kind === 'picture')
        art ||= isArt
        let what = ''
        if (isArt) {
          const used = new Set()
          const f = decodeCells(L.byMoment?.[mid] ?? L.cells, N)
          for (let k = 0; k < N; k++) if (f[k]) used.add(f[k])
          what = `${L.kind}, ${used.size} colours, `
        }
        return `${c.name} (${what}${c.chars.toLocaleString('en-US')})`
      })
      .join(', ')
    const hint = art
      ? ' For art, what costs is detail from cell to cell: fewer colours, an ordered dither (Bayer or blue noise) or a weaker one instead of diffusion, a smaller area, or Cut its background.'
      : ' Fewer colours or less fine detail in those layers, or hide one at this moment.'
    problems.push({
      level: 'error',
      text: `${name} is ${size(r).toLocaleString('en-US')} characters, ${over.toLocaleString('en-US')} over the app's ${LIMIT.toLocaleString('en-US')}, even with near colours merged (up to 6 levels on a channel). Most of it: ${list}.${hint}`,
      layer: top[0]?.layer ?? undefined,
    })
  }
  // The model was fitted on one GPU; on a busy machine heavy scenes measured up to about 3x the
  // estimate (2026-11-16 re-run: 0.63 -> 2.26 ms, 0.9 -> 3.0 ms), so the warning comes early.
  if (r.ms > FRAME_LIMIT_MS * 0.5) {
    const top = [...r.costs].sort((a, b) => b.ms - a.ms)[0]
    const level = r.ms > FRAME_LIMIT_MS ? 'error' : 'warn'
    const tail = level === 'warn' ? ' It may stutter on slower computers.' : ''
    problems.push({ level, text: `${name} needs about ${r.ms} ms a frame in the app's player (limit ${FRAME_LIMIT_MS.toFixed(2)}); most of it: ${top?.name}.${tail}`, layer: top?.layer ?? undefined })
  }
  return { svg: r.svg, chars: r.chars, raw: r.raw, problems, costs: r.costs, ms: r.ms, merged: r.level }
}

// Every moment: { scenes: [{ id, svg, chars, raw, ms, costs, problems }], ok, problems }.
export function exportAll(project, opts = {}) {
  const problems = checkProject(project)
  const scenes = []
  for (const m of project?.moments ?? []) {
    const r = exportScene(project, m.id, opts)
    const own = r.problems.filter(p => !problems.some(q => q.text === p.text))
    scenes.push({ id: m.id, svg: r.svg, chars: r.chars, raw: r.raw, ms: r.ms, merged: r.merged, costs: r.costs, problems: own })
    problems.push(...own)
  }
  return { scenes, ok: !problems.some(p => p.level === 'error') && scenes.length > 0, problems }
}

/* ---------- Checks without encoding ---------- */

export function checkProject(project) {
  const out = []
  const err = (text, layer) => out.push({ level: 'error', text, ...(layer ? { layer } : {}) })
  const warn = (text, layer) => out.push({ level: 'warn', text, ...(layer ? { layer } : {}) })
  if (!project || typeof project !== 'object') return [{ level: 'error', text: 'There is no project.' }]
  if (project.format !== undefined && project.format !== 'backdropkit-project') err('This is not a BackdropKit project file.')
  if (project.version !== undefined && project.version !== 1) warn(`Project version ${project.version}: this exporter knows version 1.`)
  if ((project.w ?? W) !== W || (project.h ?? H) !== H) err(`A scene is ${W} x ${H} cells; this project is ${project.w} x ${project.h}.`)
  if (!String(project.name ?? '').trim()) err('The theme needs a name.')
  if (!SLUG.test(String(project.slug ?? ''))) err('The slug must be 2 to 40 characters of a-z, 0-9 and -, starting with a letter.')
  else if (SITE_SLUGS.includes(project.slug)) warn(`"${project.slug}" is the name of one of the site's own themes: installed, it would replace that theme. Pick another slug.`)
  if (!String(project.line ?? '').trim()) warn('The theme has no line about it (the README and the alt text use it).')
  const pal = project.palette ?? []
  if (!Array.isArray(pal) || !pal.length) err('The palette is empty.')
  if (pal.length > 1024) err(`The palette has ${pal.length} slots; at most 1024.`)
  const moments = project.moments ?? []
  if (!moments.length) err('The theme needs at least one moment.')
  if (moments.length > 6) err(`The theme has ${moments.length} moments; at most 6.`)
  const ids = new Set()
  const hours = new Set()
  let lastStart = -1
  for (const m of moments) {
    if (!MOMENT_ID.test(String(m.id ?? ''))) err(`The moment id "${m.id}" must be lower-case a-z, 0-9 and -.`)
    if (ids.has(m.id)) err(`Two moments are called "${m.id}".`)
    ids.add(m.id)
    if (!String(m.name ?? '').trim()) warn(`The moment ${m.id} has no name.`)
    const s = Number(m.start)
    if (moments.length > 1 && !(s >= 0 && s < 24)) err(`The moment ${m.id} needs a start hour from 0 to 24.`)
    if (moments.length > 1 && hours.has(s)) err(`Two moments start at ${s}:00.`)
    hours.add(s)
    if (moments.length > 1 && s < lastStart) warn(`The moments are not in the order of the day (${m.id} starts before the one above it); the theme plays them by their hours.`)
    lastStart = s
  }
  for (const [i, p] of pal.entries()) {
    const c = p?.colors ?? {}
    if (!Object.values(c).some(v => normHex(v))) err(`Palette slot ${i + 1} has no colour.`)
  }
  for (const L of project.layers ?? []) {
    const name = layerName(L)
    if (L.motion?.type && !MOTIONS.includes(L.motion.type)) warn(`${name}: unknown motion "${L.motion.type}".`, L.id)
    for (const e of Array.isArray(L.live) ? L.live : []) if (!LIVES.includes(e?.type)) warn(`${name}: unknown live effect "${e?.type}".`, L.id)
    if (Array.isArray(L.frames) && L.frames.length > 48) warn(`${name} has ${L.frames.length} frames; each costs characters, and the app's limit is per scene.`, L.id)
  }
  for (const m of moments) {
    const any = (project.layers ?? []).some(L => shown(L, m.id))
    if (!any) err(`Nothing is shown at ${m.name ?? m.id}.`)
  }
  return out
}

/* ---------- The theme module and the archive ---------- */

// theme.js, in engine/theme-mod's shape. `scenes` as exportAll gives them ([{ id, svg }]),
// `looks` per moment id ({ tone, tint, opacity }, from browser.js measureLook).
export function themeModule(project, scenes, looks) {
  return themeJs(themeOf(project), momentsOf(project, scenes, looks), { by: 'editor' })
}

function themeOf(project) {
  return { slug: project.slug, name: String(project.name ?? project.slug).trim(), line: String(project.line ?? '').trim() || String(project.name ?? project.slug) + '.' }
}

const WHEN = { day: 'by day', night: 'at night', sunrise: 'at sunrise', sunset: 'at sunset', morning: 'in the morning', evening: 'in the evening', 'golden hour': 'in the golden hour', dawn: 'at dawn', dusk: 'at dusk', twilight: 'at twilight', 'before dawn': 'before dawn' }

function momentsOf(project, scenes, looks) {
  const single = project.moments.length === 1
  const line = themeOf(project).line.replace(/\.\s*$/, '')
  const list = project.moments.map(m => {
    const sc = scenes.find(s => s.id === m.id)
    if (!sc?.svg) throw new Error(`No scene for the moment ${m.id}.`)
    const look = looks?.[m.id]
    if (!look) throw new Error(`No look (tone and glass) for the moment ${m.id}.`)
    const name = String(m.name ?? m.id)
    const when = WHEN[name.toLowerCase()] ?? 'at ' + name.toLowerCase()
    return {
      id: m.id,
      name,
      start: single ? 0 : Number(m.start),
      tone: look.tone === 'dark' ? 'dark' : 'light',
      tint: look.tint,
      opacity: look.opacity,
      alt: single ? line + '.' : line + ', ' + when + '.',
      text: sc.svg,
    }
  })
  return list.sort((a, b) => a.start - b.start)
}

// The theme archive, as the site's (engine/pack.mjs): { scenes, looks, preview (PNG bytes),
// modFiles ({ name: text or bytes } of engine/theme-mod/hooks) } -> Uint8Array.
export function buildArchive(project, { scenes, looks, preview, modFiles, deflate } = {}) {
  const problems = checkProject(project).filter(p => p.level === 'error')
  if (problems.length) throw new Error(problems.map(p => p.text).join(' '))
  if (!modFiles || !modFiles['register.tsx']) throw new Error('The theme template (mod/hooks) is missing.')
  for (const s of scenes ?? []) {
    const n = Math.max(s.svg.length, scrubbedLength(s.svg))
    if (n > LIMIT) throw new Error(`The ${s.id} scene is ${n} characters, over the app's ${LIMIT}.`)
  }
  const moments = momentsOf(project, scenes ?? [], looks)
  const entries = archiveEntries({
    theme: themeOf(project),
    moments,
    hookFiles: modFiles,
    preview,
    project: JSON.stringify(project) + '\n',
    by: 'editor',
  })
  return zip(entries, deflate ? { deflate } : {})
}

// The install prompt, as on the landing page.
export function promptFor(project) {
  return installPrompt(themeOf(project))
}

/* ---------- Pictures of several moments, one palette ---------- */

// Pictures of a theme's moments (from browser.js pictureFromSvg, each { colors, cells } with
// cell n > 0 meaning colors[n - 1]) as one palette and cells per moment: { palette: [{ id,
// colors: { momentId: hex } }], byMoment: { momentId: Uint16Array } }. A slot stands for the
// same place in every moment where it can: the combinations of colours that share cells are
// taken commonest first, and each one whose colours are all still free becomes a slot. Each
// moment's cells then point at the slot that holds their colour at that moment, so every
// moment stays exact: the colours left over fill further slots, a moment's leftovers side by
// side with the other moments' (slots = the most colours any one moment has, at most 1024).
export function mergeMoments(pictures) {
  const ids = Object.keys(pictures)
  const most = Math.max(...ids.map(id => pictures[id].colors.length))
  if (most > 1024) throw new Error(`A moment has ${most} colours; a project holds at most 1024 slots.`)
  const pairs = new Map()
  for (let k = 0; k < N; k++) {
    const key = ids.map(id => pictures[id].cells[k]).join(',')
    pairs.set(key, (pairs.get(key) ?? 0) + 1)
  }
  const sorted = [...pairs].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  // slotOf[i]: picture colour (1-based) -> slot, per moment.
  const slotOf = ids.map(() => new Map())
  const palette = []
  for (const [key] of sorted) {
    const parts = key.split(',').map(Number)
    if (parts.every(v => !v)) continue
    if (parts.some((v, i) => v && slotOf[i].has(v))) continue
    const colors = {}
    ids.forEach((id, i) => {
      if (parts[i]) colors[id] = pictures[id].colors[parts[i] - 1]
    })
    palette.push({ id: 'c' + (palette.length + 1), colors })
    parts.forEach((v, i) => v && slotOf[i].set(v, palette.length))
  }
  // Colours not yet in a slot: each moment's in turn, side by side (commonest first), into
  // the slots that have no colour for that moment yet, then into new ones.
  ids.forEach((id, i) => {
    const count = new Map()
    for (let k = 0; k < N; k++) {
      const v = pictures[id].cells[k]
      if (v && !slotOf[i].has(v)) count.set(v, (count.get(v) ?? 0) + 1)
    }
    const left = [...count.keys()].sort((a, b) => count.get(b) - count.get(a) || a - b)
    let s = 0
    for (const v of left) {
      while (s < palette.length && palette[s].colors[id]) s++
      if (s === palette.length) palette.push({ id: 'c' + (palette.length + 1), colors: {} })
      palette[s].colors[id] = pictures[id].colors[v - 1]
      slotOf[i].set(v, s + 1)
    }
  })
  const byMoment = {}
  ids.forEach((id, i) => {
    const cells = new Uint16Array(N)
    for (let k = 0; k < N; k++) {
      const v = pictures[id].cells[k]
      if (v) cells[k] = slotOf[i].get(v)
    }
    byMoment[id] = cells
  })
  return { palette, byMoment }
}

export { utf8, levels }
