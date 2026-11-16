// The project as the editor holds it, and its project.json form (editor/PROJECT.md).
// In memory a layer's cells are Uint16Arrays (cells, byMoment[id]); in project.json they are
// base64. Arrays are never changed in place once committed: an edit makes a new one, so the
// undo history can keep the old.
import { b64ToCells, cellsToB64, clamp, slugify } from './util.js'
import { kindOf } from './color.js'

export const W = 320
export const H = 200
export const N = W * H
export const SCENE_LIMIT = 131072
export const MAX_SLOTS = 1024
export const KINDS = ['paint', 'picture', 'image', 'sky', 'sun', 'stars', 'clouds', 'ridge', 'trees', 'water']
export const GEN_KINDS = ['sky', 'sun', 'stars', 'clouds', 'ridge', 'trees', 'water']
export const KIND_LABEL = {
  paint: 'Paint', picture: 'Picture', image: 'Your art', sky: 'Sky', sun: 'Sun and moon', stars: 'Stars',
  clouds: 'Clouds', ridge: 'Ridges and hills', trees: 'Trees', water: 'Water',
}
export const MAX_FRAMES = 48

// Live effects: they play in the app, on the scenes' clock (editor/PROJECT.md).
export const LIVE = {
  cycle: { label: 'Colour cycle', help: 'The layer\'s colours step through each other in order. Water, neon, fire.', fields: [{ key: 'period', label: 'One cycle', min: 2, max: 60, step: 1, unit: 's', def: 8 }] },
  pulse: { label: 'Pulse', help: 'The layer breathes: its opacity eases down and back. Lights, glow.', fields: [{ key: 'period', label: 'One breath', min: 2, max: 20, step: 0.5, unit: 's', def: 5 }, { key: 'low', label: 'Down to', min: 0.4, max: 0.95, step: 0.05, unit: '', def: 0.7 }] },
  glint: { label: 'Glint', help: 'A narrow band of light sweeps across the layer now and then.', fields: [{ key: 'period', label: 'Every', min: 4, max: 60, step: 1, unit: 's', def: 14 }] },
}
export function cleanLive(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const e of list) {
    const D = LIVE[e?.type]
    if (!D || out.some(x => x.type === e.type)) continue
    const x = { type: e.type }
    for (const f of D.fields) x[f.key] = clamp(Number(e[f.key]) || f.def, f.min, f.max)
    if (e.type === 'glint') x.slot = Math.max(0, Number(e.slot) | 0)
    out.push(x)
  }
  return out
}
export const MOTIONS = ['none', 'drift', 'fall', 'sway', 'bob', 'twinkle']
export const MOTION_LABEL = { none: 'None', drift: 'Drift', fall: 'Fall', sway: 'Sway', bob: 'Bob', twinkle: 'Twinkle' }
export const MOTION_FIELDS = {
  none: [],
  drift: [{ key: 'period', label: 'One loop', min: 20, max: 600, step: 5, unit: 's', def: 180 }, { key: 'dir', label: 'Direction', choice: [[1, 'Right'], [-1, 'Left']], def: 1 }],
  fall: [{ key: 'period', label: 'One loop', min: 4, max: 120, step: 1, unit: 's', def: 24 }],
  sway: [{ key: 'period', label: 'Period', min: 2, max: 20, step: 0.5, unit: 's', def: 6 }, { key: 'amount', label: 'Amount', min: 1, max: 3, step: 1, unit: ' cells', def: 1 }],
  bob: [{ key: 'period', label: 'Period', min: 2, max: 20, step: 0.5, unit: 's', def: 4 }, { key: 'amount', label: 'Amount', min: 1, max: 3, step: 1, unit: ' cells', def: 1 }],
  twinkle: [{ key: 'period', label: 'Period', min: 2, max: 20, step: 0.5, unit: 's', def: 6 }],
}
export function motionDefaults(type) {
  const m = { type }
  for (const f of MOTION_FIELDS[type] || []) m[f.key] = f.def
  return m
}
export function cleanMotion(m) {
  const type = MOTIONS.includes(m?.type) ? m.type : 'none'
  const out = { type }
  for (const f of MOTION_FIELDS[type]) {
    let v = m?.[f.key] ?? f.def
    if (f.choice) v = f.choice.some(c => c[0] === v) ? v : f.def
    else v = clamp(Number(v) || f.def, f.min, f.max)
    out[f.key] = v
  }
  return out
}

// Usual moments, in the order of the day, with a start hour and a name.
export const USUAL_MOMENTS = [
  { id: 'dawn', name: 'Dawn', start: 5 },
  { id: 'sunrise', name: 'Sunrise', start: 5.5 },
  { id: 'morning', name: 'Morning', start: 7 },
  { id: 'day', name: 'Day', start: 9 },
  { id: 'golden', name: 'Golden hour', start: 16 },
  { id: 'sunset', name: 'Sunset', start: 17.5 },
  { id: 'dusk', name: 'Dusk', start: 19.5 },
  { id: 'evening', name: 'Evening', start: 19 },
  { id: 'twilight', name: 'Twilight', start: 20 },
  { id: 'night', name: 'Night', start: 21 },
]

export const newId = (list, prefix) => {
  let n = list.length + 1
  const ids = new Set(list.map(x => x.id))
  while (ids.has(prefix + n)) n++
  return prefix + n
}

export function blankDoc() {
  return {
    format: 'backdropkit-project',
    version: 1,
    name: 'My theme',
    slug: 'my-theme',
    line: '',
    w: W,
    h: H,
    palette: [],
    moments: [
      { id: 'day', name: 'Day', start: 6 },
      { id: 'sunset', name: 'Sunset', start: 17 },
      { id: 'night', name: 'Night', start: 21 },
    ],
    assets: {},
    layers: [],
  }
}

export function newLayer(doc, kind, name) {
  return {
    id: newId(doc.layers, 'l'),
    name: name || KIND_LABEL[kind] || 'Layer',
    kind,
    visible: true,
    show: {},
    cells: new Uint16Array(N),
    byMoment: null,
    gen: null,
    motion: { type: 'none' },
    live: [],
  }
}

/* ---------- project.json ---------- */

export function toJSON(doc) {
  return {
    format: 'backdropkit-project',
    version: 1,
    name: doc.name,
    slug: doc.slug,
    line: doc.line,
    w: W,
    h: H,
    palette: doc.palette.map(p => ({ id: p.id, colors: { ...p.colors } })),
    moments: doc.moments.map(m => ({ id: m.id, name: m.name, start: m.start })),
    assets: Object.fromEntries(
      Object.entries(doc.assets || {}).map(([id, a]) => [id, { name: a.name, w: a.w, h: a.h, frames: a.frames.map(f => ({ png: f.png, delay: f.delay })) }]),
    ),
    layers: doc.layers.map(l => {
      const out = {
        id: l.id,
        name: l.name,
        kind: l.kind,
        visible: l.visible,
        show: { ...l.show },
        cells: cellsToB64(l.cells || new Uint16Array(N)),
        motion: cleanMotion(l.motion),
      }
      if (l.byMoment && Object.keys(l.byMoment).length) {
        out.byMoment = {}
        for (const [k, v] of Object.entries(l.byMoment)) if (v) out.byMoment[k] = cellsToB64(v)
      } else out.byMoment = {}
      out.gen = l.gen ? JSON.parse(JSON.stringify(l.gen)) : null
      if (l.asset) out.asset = l.asset
      if (l.place) out.place = { ...l.place }
      if (l.look) out.look = JSON.parse(JSON.stringify(l.look))
      if (l.own) out.own = l.own.slice()
      if (l.lit) out.lit = true
      if (l.versions && Object.keys(l.versions).length) out.versions = { ...l.versions }
      if (l.frames && l.frames.length > 1) {
        out.frames = l.frames.map(cellsToB64)
        out.anim = { fps: l.anim?.fps || 10 }
      }
      if (l.live && l.live.length) out.live = cleanLive(l.live)
      return out
    }),
  }
}

// A project.json (parsed) into the editor's form. Throws an Error in plain words.
export function fromJSON(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('That file holds no project.')
  if (obj.format !== 'backdropkit-project') throw new Error('That file is not a BackdropKit project.')
  if (Number(obj.version) > 1) throw new Error('That project was made by a newer editor.')
  const w = Number(obj.w) || W
  const h = Number(obj.h) || H
  if (w !== W || h !== H) throw new Error('That project is ' + w + ' x ' + h + ' cells; this editor makes 320 x 200.')
  const moments = (Array.isArray(obj.moments) ? obj.moments : []).slice(0, 6).map((m, i) => ({
    id: String(m.id || 'm' + (i + 1)).toLowerCase().replace(/[^a-z0-9-]/g, '') || 'm' + (i + 1),
    name: String(m.name || m.id || 'Moment ' + (i + 1)).slice(0, 40),
    start: clamp(Number(m.start) || 0, 0, 23.99),
  }))
  if (!moments.length) moments.push({ id: 'day', name: 'Day', start: 0 })
  const ids = moments.map(m => m.id)
  const palette = (Array.isArray(obj.palette) ? obj.palette : []).slice(0, MAX_SLOTS).map((p, i) => {
    const colors = {}
    for (const [k, v] of Object.entries(p?.colors || {})) if (/^#[0-9a-f]{6}$/i.test(v)) colors[k] = v.toLowerCase()
    return { id: String(p?.id || 'c' + (i + 1)), colors }
  })
  const layers = (Array.isArray(obj.layers) ? obj.layers : []).map((l, i) => {
    const kind = KINDS.includes(l.kind) ? l.kind : 'paint'
    const dec = v => (typeof v === 'string' && v ? b64ToCells(v, N) : null)
    let byMoment = null
    if (l.byMoment && typeof l.byMoment === 'object') {
      for (const [k, v] of Object.entries(l.byMoment)) {
        if (!ids.includes(k)) continue
        const arr = dec(v)
        if (arr) (byMoment ||= {})[k] = arr
      }
    }
    const show = {}
    for (const [k, v] of Object.entries(l.show || {})) if (ids.includes(k) && v === false) show[k] = false
    const frames = Array.isArray(l.frames) ? l.frames.slice(0, MAX_FRAMES).map(dec).filter(Boolean) : null
    const out = {
      id: String(l.id || 'l' + (i + 1)),
      name: String(l.name || KIND_LABEL[kind]).slice(0, 60),
      kind,
      visible: l.visible !== false,
      show,
      cells: dec(l.cells) || new Uint16Array(N),
      byMoment,
      gen: l.gen && typeof l.gen === 'object' ? l.gen : null,
      motion: cleanMotion(l.motion),
      live: cleanLive(l.live),
    }
    if (frames && frames.length > 1) {
      out.frames = [out.cells, ...frames.slice(1)]
      out.anim = { fps: clamp(Number(l.anim?.fps) || 10, 1, 20) }
    }
    if (typeof l.asset === 'string') out.asset = l.asset
    if (l.place && typeof l.place === 'object') out.place = { x: Number(l.place.x) || 0, y: Number(l.place.y) || 0, scale: Number(l.place.scale) || 1, flipX: !!l.place.flipX }
    if (l.look && typeof l.look === 'object') out.look = l.look
    if (Array.isArray(l.own)) out.own = l.own.map(n => n | 0)
    if (l.lit === true) out.lit = true
    if (l.versions && typeof l.versions === 'object') {
      const v = {}
      for (const [k, a] of Object.entries(l.versions)) if (ids.includes(k) && typeof a === 'string') v[k] = a
      if (Object.keys(v).length) out.versions = v
    }
    return out
  })
  const assets = {}
  for (const [id, a] of Object.entries(obj.assets && typeof obj.assets === 'object' ? obj.assets : {})) {
    if (!a || !Array.isArray(a.frames) || !a.frames.length) continue
    assets[id] = {
      name: String(a.name || id).slice(0, 80),
      w: Number(a.w) || 0,
      h: Number(a.h) || 0,
      frames: a.frames.slice(0, MAX_FRAMES).filter(f => typeof f?.png === 'string').map(f => ({ png: f.png, delay: Number(f.delay) || 100 })),
    }
  }
  // An image layer whose art is missing keeps its cells but can no longer re-run its look.
  for (const l of layers) if (l.asset && !assets[l.asset]) delete l.asset
  // A version whose picture is missing goes; the layer's cells for that moment stay.
  for (const l of layers) {
    if (!l.versions) continue
    for (const k of Object.keys(l.versions)) if (!assets[l.versions[k]] || !l.asset) delete l.versions[k]
    if (!Object.keys(l.versions).length) delete l.versions
  }
  // Cells past the palette would draw nothing: clamp them to empty.
  const max = palette.length
  for (const l of layers) for (const arr of arrays(l)) for (let i = 0; i < N; i++) if (arr[i] > max) arr[i] = 0
  const name = String(obj.name || 'My theme').slice(0, 60)
  return {
    format: 'backdropkit-project',
    version: 1,
    name,
    slug: validSlug(obj.slug) ? obj.slug : slugify(name) || 'my-theme',
    line: String(obj.line || '').slice(0, 200),
    w: W,
    h: H,
    palette,
    moments: sortMoments(moments),
    assets,
    layers,
  }
}

export const validSlug = s => typeof s === 'string' && /^[a-z][a-z0-9-]{1,39}$/.test(s)
export const sortMoments = list => list.slice().sort((a, b) => a.start - b.start)

/* ---------- Reading ---------- */

// Frame 0 of an animated layer is its `cells`; frames do not vary by moment.
export const cellsAt = (layer, mid, frame = 0) =>
  (frame && layer.frames && layer.frames.length > 1 && layer.frames[frame % layer.frames.length]) || (layer.byMoment && layer.byMoment[mid]) || layer.cells
export const frameCount = layer => (layer.frames && layer.frames.length > 1 ? layer.frames.length : 1)
export const shownAt = (layer, mid) => layer.visible && layer.show?.[mid] !== false
export const isGen = layer => GEN_KINDS.includes(layer.kind)
export const isImage = layer => layer.kind === 'image'
export const paintable = layer => layer.kind === 'paint' || layer.kind === 'picture'

export function colorOf(doc, slot, mid) {
  const p = doc.palette[slot - 1]
  if (!p) return null
  return p.colors[mid] || p.colors[doc.moments[0]?.id] || Object.values(p.colors)[0] || '#000000'
}

// The moment that plays at a minute of the day: the one whose start is the latest before it,
// or the last of the day when the minute is before the first start.
export function momentAt(doc, min) {
  const ms = doc.moments
  if (ms.length === 1) return 0
  let best = -1
  ms.forEach((m, i) => {
    if (m.start * 60 <= min && (best < 0 || m.start > ms[best].start)) best = i
  })
  if (best >= 0) return best
  let last = 0
  ms.forEach((m, i) => {
    if (m.start > ms[last].start) last = i
  })
  return last
}
// The stretches of the day, for drawing: [{ i, from, to }] in minutes.
export function stretches(doc) {
  const ms = doc.moments
  if (ms.length === 1) return [{ i: 0, from: 0, to: 1440 }]
  const order = ms.map((m, i) => ({ i, at: Math.round(m.start * 60) })).sort((a, b) => a.at - b.at)
  const out = []
  if (order[0].at > 0) out.push({ i: order.at(-1).i, from: 0, to: order[0].at })
  order.forEach((o, k) => out.push({ i: o.i, from: o.at, to: k + 1 < order.length ? order[k + 1].at : 1440 }))
  return out.filter(s => s.to > s.from)
}
// A minute inside a moment, to show it: a quarter of the way into its longest stretch.
export function minuteIn(doc, mid) {
  const i = doc.moments.findIndex(m => m.id === mid)
  const list = stretches(doc).filter(s => s.i === i)
  if (!list.length) return 0
  const s = list.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a))
  return Math.round(s.from + Math.min(60, (s.to - s.from) / 3))
}

export const momentKinds = doc => Object.fromEntries(doc.moments.map(m => [m.id, kindOf(m)]))

// How many cells use each slot, over every layer and moment (index 0 is empty cells).
export function slotUsage(doc, exceptLayer) {
  const n = new Uint32Array(doc.palette.length + 1)
  for (const l of doc.layers) {
    if (l.id === exceptLayer) continue
    for (const arr of arrays(l)) for (let i = 0; i < N; i++) n[arr[i]]++
  }
  return n
}
export const arrays = l => [l.cells, ...Object.values(l.byMoment || {}), ...(l.frames || []).slice(1)].filter(Boolean)

// Slots drawn at a moment by layers that show then, in palette order.
export function slotsAt(doc, mid) {
  const seen = new Uint8Array(doc.palette.length + 1)
  for (const l of doc.layers) {
    if (!shownAt(l, mid)) continue
    const arr = cellsAt(l, mid)
    if (!arr) continue
    for (let i = 0; i < N; i++) seen[arr[i]] = 1
  }
  const out = []
  for (let s = 1; s < seen.length; s++) if (seen[s]) out.push(s)
  return out
}

/* ---------- Changing (on a draft from history.js) ---------- */

// A fresh copy of a layer's cells to write into: the moment's, or the shared ones.
export function writable(layer, mid, frame = 0) {
  if (layer.frames && layer.frames.length > 1) {
    const f = frame % layer.frames.length
    const copy = layer.frames[f].slice()
    layer.frames = layer.frames.slice()
    layer.frames[f] = copy
    if (f === 0) layer.cells = copy
    return copy
  }
  if (mid && layer.byMoment && layer.byMoment[mid]) {
    const copy = layer.byMoment[mid].slice()
    layer.byMoment = { ...layer.byMoment, [mid]: copy }
    return copy
  }
  layer.cells = (layer.cells || new Uint16Array(N)).slice()
  return layer.cells
}

export function addSlot(doc, colors) {
  if (doc.palette.length >= MAX_SLOTS) return 0
  doc.palette = [...doc.palette, { id: newId(doc.palette, 'c'), colors: { ...colors } }]
  return doc.palette.length
}
export function setSlotColor(doc, slot, mid, hex) {
  const p = doc.palette[slot - 1]
  if (!p) return
  doc.palette = doc.palette.slice()
  doc.palette[slot - 1] = { ...p, colors: { ...p.colors, [mid]: hex } }
}
export function setSlotColors(doc, slot, colors) {
  const p = doc.palette[slot - 1]
  if (!p) return
  doc.palette = doc.palette.slice()
  doc.palette[slot - 1] = { ...p, colors: { ...p.colors, ...colors } }
}

// Apply map (old slot -> new slot, Uint16Array over the palette) to every layer. The layers
// are a draft's own copies, so they are updated in place (with new arrays).
export function remapCells(doc, map) {
  const r = arr => {
    const out = new Uint16Array(N)
    for (let i = 0; i < N; i++) out[i] = map[arr[i]]
    return out
  }
  for (const l of doc.layers) {
    l.cells = r(l.cells || new Uint16Array(N))
    if (l.byMoment) l.byMoment = Object.fromEntries(Object.entries(l.byMoment).map(([k, v]) => [k, r(v)]))
    if (l.frames) l.frames = [l.cells, ...l.frames.slice(1).map(r)]
    if (l.gen?.slots) l.gen = { ...l.gen, slots: l.gen.slots.map(s => map[s] || 0) }
    if (l.own) l.own = l.own.map(s => map[s] || 0).filter(Boolean)
    if (l.live?.length) l.live = l.live.map(e => (e.type === 'glint' && e.slot ? { ...e, slot: map[e.slot] || 0 } : e))
  }
}
// Drop slots (a Set of slot numbers); cells using them become `into` (default empty).
export function removeSlots(doc, drop, into = new Map()) {
  if (!drop.size) return
  const map = new Uint16Array(doc.palette.length + 1)
  const keep = []
  let n = 0
  for (let s = 1; s <= doc.palette.length; s++) {
    if (drop.has(s)) continue
    keep.push(doc.palette[s - 1])
    map[s] = ++n
  }
  for (const s of drop) map[s] = into.has(s) ? map[into.get(s)] : 0
  remapCells(doc, map)
  doc.palette = keep
}

// Moments: what a new one is called and when it starts, given the ones there are.
export function suggestMoment(doc) {
  const have = new Set(doc.moments.map(m => m.id))
  const free = USUAL_MOMENTS.filter(m => !have.has(m.id))
  const order = sortMoments(doc.moments)
  // The longest stretch of the day gets the new moment in its middle.
  let best = null
  order.forEach((m, k) => {
    const next = order[(k + 1) % order.length]
    const len = ((next.start - m.start + 24) % 24) || 24
    if (!best || len > best.len) best = { from: m, len }
  })
  const at = Math.round(((best.from.start + best.len / 2) % 24) * 4) / 4
  // The usual moment nearest that hour, else a numbered one.
  let pick = null
  for (const m of free) {
    const d = Math.min(Math.abs(m.start - at), 24 - Math.abs(m.start - at))
    if (!pick || d < pick.d) pick = { m, d }
  }
  if (pick && pick.d <= 3) return { id: pick.m.id, name: pick.m.name, start: at }
  let k = 1
  while (have.has('moment-' + k)) k++
  return { id: 'moment-' + k, name: 'Moment ' + k, start: at }
}
