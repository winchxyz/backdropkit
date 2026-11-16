// Every change to the project, each one undoable step. The interface calls these.
import { S, change, select, emit } from './state.js'
import {
  N, KIND_LABEL, GEN_KINDS, MAX_SLOTS, addSlot, arrays, cleanLive, cleanMotion, motionDefaults, newId, newLayer, removeSlots,
  setSlotColor, setSlotColors, slotUsage, sortMoments, suggestMoment, momentAt, validSlug,
} from './project.js'
import { GENS, genDefaults, lightContext, rerunAll, runGen, sunPos } from './gen.js'
import { kindOf, labDist, relight as relightHex } from './color.js'
import { slugify } from './util.js'

const L = (d, id) => d.layers.find(l => l.id === id)
const mname = (d, mid) => d.moments.find(m => m.id === mid)?.name || mid

/* ---------- Layers ---------- */

// A new layer above the selected one (or on top).
export function addLayer(kind, { name, gen, motion, show, select: sel = true } = {}) {
  let id = null
  change('Add ' + (name || KIND_LABEL[kind]).toLowerCase(), d => {
    const l = newLayer(d, kind, name)
    if (GENS[kind]) l.gen = { ...genDefaults(kind, d), ...(gen || {}) }
    if (motion) l.motion = motion
    if (show) l.show = { ...show }
    const at = S.sel ? d.layers.findIndex(x => x.id === S.sel) + 1 : d.layers.length
    // Skies go to the bottom, stars just above the sky.
    let pos = at || d.layers.length
    if (kind === 'sky') pos = 0
    d.layers = [...d.layers.slice(0, pos), l, ...d.layers.slice(pos)]
    if (l.gen) {
      runGen(d, d.layers.find(x => x.id === l.id), { force: true })
      if (kind === 'sky' || kind === 'sun') rerunAll(d, { except: l.id, lightOnly: kind === 'sun' })
    }
    id = l.id
  })
  if (sel && id) select(id)
  return id
}
export function addStarLayer() {
  const night = S.doc.moments.filter(m => !['night', 'dusk'].includes(kindOf(m))).map(m => m.id)
  return addLayer('stars', { motion: motionDefaults('twinkle'), show: Object.fromEntries(night.map(id => [id, false])) })
}
export function addWater() {
  const a = addLayer('water', { name: 'Water', select: false })
  const top = L(S.doc, a)?.gen?.top
  const b = addLayer('water', { name: 'Water glints', gen: { part: 'glints', top }, motion: { type: 'twinkle', period: 4 } })
  return b
}
export function addPictureLayer(pic, name) {
  let id = null
  change('Add picture', d => {
    const l = newLayer(d, 'picture', name || 'Picture')
    const slots = pic.colors.map(c => addSlot(d, Object.fromEntries(d.moments.map(m => [m.id, c]))))
    const cells = new Uint16Array(N)
    for (let i = 0; i < N; i++) cells[i] = pic.cells[i] ? slots[pic.cells[i] - 1] || 0 : 0
    l.cells = cells
    const at = S.sel ? d.layers.findIndex(x => x.id === S.sel) + 1 : d.layers.length
    d.layers = [...d.layers.slice(0, at), l, ...d.layers.slice(at)]
    id = l.id
  })
  if (id) select(id)
  return id
}
export function duplicateLayer(id = S.sel) {
  let nid = null
  change('Duplicate layer', d => {
    const i = d.layers.findIndex(l => l.id === id)
    if (i < 0) return false
    const src = d.layers[i]
    const copy = { ...src, id: newId(d.layers, 'l'), name: src.name + ' copy', show: { ...src.show }, motion: { ...src.motion }, byMoment: src.byMoment ? { ...src.byMoment } : null, live: (src.live || []).map(e => ({ ...e })) }
    // A copy of art shares its colours; its look gets slots of its own when it changes.
    if (copy.own) copy.own = []
    // A generator copy owns slots of its own once it runs again.
    if (copy.gen) copy.gen = { ...src.gen, slots: [], seed: (src.gen.seed || 1) + 101 }
    d.layers = [...d.layers.slice(0, i + 1), copy, ...d.layers.slice(i + 1)]
    if (copy.gen) runGen(d, d.layers[i + 1], { force: true })
    nid = copy.id
  })
  if (nid) select(nid)
}
export function deleteLayer(id = S.sel) {
  const l = L(S.doc, id)
  if (!l) return
  const i = S.doc.layers.indexOf(l)
  change('Delete ' + l.name, d => {
    const gone = d.layers.find(x => x.id === id)
    d.layers = d.layers.filter(x => x.id !== id)
    // Its generator's colours go with it when nobody else uses them.
    const owned = [...(gone.gen?.slots || []), ...(gone.own || [])]
    if (owned.length) {
      const u = slotUsage(d)
      removeSlots(d, new Set(owned.filter(s => s && !u[s])))
    }
    if (gone.kind === 'sun' || gone.kind === 'sky') rerunAll(d, { lightOnly: gone.kind === 'sun' })
  })
  const rest = S.doc.layers
  select(rest.length ? rest[Math.max(0, Math.min(i, rest.length - 1))].id : null)
}
// to: the index in the bottom-first list.
export function moveLayer(id, to) {
  change('Move layer', d => {
    const i = d.layers.findIndex(l => l.id === id)
    if (i < 0) return false
    to = Math.max(0, Math.min(d.layers.length - 1, to))
    if (to === i) return false
    const list = d.layers.slice()
    const [l] = list.splice(i, 1)
    list.splice(to, 0, l)
    d.layers = list
  })
}
export function renameLayer(id, name) {
  name = String(name || '').trim().slice(0, 60)
  if (!name) return
  change('Rename layer', d => {
    const l = L(d, id)
    if (!l || l.name === name) return false
    l.name = name
  })
}
export function toggleVisible(id) {
  change('Show or hide layer', d => {
    const l = L(d, id)
    l.visible = !l.visible
    if (l.kind === 'sun') rerunAll(d, { except: id, lightOnly: true })
  })
}
export function setShow(id, mid, on) {
  change('Moments of a layer', d => {
    const l = L(d, id)
    const show = { ...l.show }
    if (on) delete show[mid]
    else show[mid] = false
    l.show = show
  })
}
export function setMotion(id, motion, key) {
  change('Motion', d => {
    L(d, id).motion = cleanMotion(motion)
  }, key)
}
export function convertToPaint(id = S.sel) {
  change('Convert to paint layer', d => {
    const l = L(d, id)
    if (!l?.gen && l?.kind !== 'image') return false
    l.kind = 'paint'
    l.gen = null
    delete l.asset
    delete l.place
    delete l.look
    delete l.own
  })
}
export function setLive(id, live, key) {
  change('Live effects', d => {
    L(d, id).live = cleanLive(live)
  }, key)
}

// A generator setting. perMoment (the sun's place) applies to the moment shown now.
export function setGen(id, field, value) {
  const l0 = L(S.doc, id)
  if (!l0?.gen) return
  change(
    (GENS[l0.kind]?.label || 'Generator') + ' settings',
    d => {
      const l = L(d, id)
      if (field.perMoment) {
        const pos = { ...(l.gen.pos || {}) }
        const ctxPos = pos[S.mid] || currentSunPos(d, l)
        pos[S.mid] = { ...ctxPos, [field.key]: value }
        l.gen = { ...l.gen, pos }
      } else l.gen = { ...l.gen, [field.key]: value }
      runGen(d, l, { force: !!field.paint })
      if (l.kind === 'sun') rerunAll(d, { except: id, lightOnly: true })
      if (l.kind === 'sky' && (field.key === 'horizon' || field.key === 'style')) rerunAll(d, { except: id, force: field.key === 'style' })
    },
    'gen:' + id + ':' + field.key + ':' + (field.perMoment ? S.mid : ''),
  )
}
// Where the sun stands now at this moment (its own place, or the usual one for the light).
export function currentSunPos(d, l) {
  const m = d.moments.find(x => x.id === S.mid)
  const p = sunPos(l.gen, { id: m.id, kind: kindOf(m) }, lightContext(d).horizon)
  return { x: p.x, up: p.up }
}
export function reseed(id) {
  const l = L(S.doc, id)
  if (!l?.gen) return
  setGen(id, { key: 'seed' }, ((Math.random() * 1e6) | 0) + 1)
}

/* ---------- Palette ---------- */

export function setColor(slot, mid, hex, key) {
  change('Colour', d => setSlotColor(d, slot, mid, hex), key || 'color:' + slot + ':' + mid)
}
export function setColors(slot, colors) {
  change('Colours', d => setSlotColors(d, slot, colors))
}
// A new colour: this moment's as given, the others relit from it.
export function addColor(hex) {
  let s = 0
  change('Add colour', d => {
    if (d.palette.length >= MAX_SLOTS) return false
    const from = kindOf(d.moments.find(m => m.id === S.mid))
    const colors = {}
    for (const m of d.moments) colors[m.id] = m.id === S.mid ? hex : relightHex(hex, from, kindOf(m))
    s = addSlot(d, colors)
  })
  if (s) {
    S.slot = s
    emit({ slot: true })
  }
  return s
}
// Every cell of `from` takes `to`; `from` goes.
export function replaceSlot(from, to) {
  if (from === to) return
  change('Replace colour', d => {
    removeSlots(d, new Set([from]), new Map([[from, to]]))
  })
  S.slot = to > from ? to - 1 : to
  emit({ slot: true })
}
// Slots closer than `dist` (OKLab, at every moment) become one. Returns how many went.
// dist: in OKLab units (0 to about 1; the Tidy card's slider is in hundredths).
export function similarGroups(doc, dist) {
  const n = doc.palette.length
  const ids = doc.moments.map(m => m.id)
  const parent = new Int32Array(n + 1).map((_, i) => i)
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const col = (s, mid) => doc.palette[s - 1].colors[mid] || Object.values(doc.palette[s - 1].colors)[0]
  // Generator slots stay their generator's.
  const owned = new Set()
  for (const l of doc.layers) for (const s of l.gen?.slots || []) owned.add(s)
  for (let a = 1; a <= n; a++) {
    if (owned.has(a)) continue
    for (let b = a + 1; b <= n; b++) {
      if (owned.has(b)) continue
      if (ids.every(mid => labDist(col(a, mid), col(b, mid)) <= dist)) parent[find(b)] = find(a)
    }
  }
  const into = new Map()
  for (let s = 1; s <= n; s++) if (find(s) !== s) into.set(s, find(s))
  return into
}
export function mergeSimilar(dist) {
  if (S.doc.palette.length > 700) return -1
  const into = similarGroups(S.doc, dist)
  if (!into.size) return 0
  change('Merge similar colours', d => removeSlots(d, new Set(into.keys()), into))
  return into.size
}
export function removeUnused() {
  const u = slotUsage(S.doc)
  const drop = new Set()
  for (let s = 1; s < u.length; s++) if (!u[s]) drop.add(s)
  if (!drop.size) return 0
  change('Remove unused colours', d => removeSlots(d, drop))
  return drop.size
}
// Fill the other moments' colours from this moment's, each through its light (targets:
// { mid: kind }). slots: which to relight (default: all).
export function relightFrom(fromMid, targets, slots) {
  change('Relight', d => {
    const from = kindOf(d.moments.find(m => m.id === fromMid))
    const list = slots || d.palette.map((_, i) => i + 1)
    d.palette = d.palette.slice()
    for (const s of list) {
      const p = d.palette[s - 1]
      if (!p) continue
      const base = p.colors[fromMid] || Object.values(p.colors)[0]
      const colors = { ...p.colors }
      for (const [mid, kind] of Object.entries(targets)) if (mid !== fromMid) colors[mid] = relightHex(base, from, kind)
      d.palette[s - 1] = { ...p, colors }
    }
    // Art whose colours were relit keeps that light when its look changes later.
    const touched = new Set(list)
    for (const l of d.layers) if (l.kind === 'image' && !l.lit && (l.own || []).some(s => touched.has(s))) L(d, l.id).lit = true
  })
}

/* ---------- Moments ---------- */

export function addMoment(spec) {
  if (S.doc.moments.length >= 6) return null
  const m = spec || suggestMoment(S.doc)
  change('Add ' + m.name, d => {
    const refIdx = momentAt(d, m.start * 60)
    const ref = d.moments[refIdx]
    const rk = kindOf(ref)
    const nk = kindOf(m)
    d.moments = sortMoments([...d.moments, { id: m.id, name: m.name, start: m.start }])
    const owned = new Set()
    for (const l of d.layers) for (const s of l.gen?.slots || []) owned.add(s)
    d.palette = d.palette.map((p, i) => {
      if (owned.has(i + 1)) return p
      const base = p.colors[ref.id] || Object.values(p.colors)[0]
      return { ...p, colors: { ...p.colors, [m.id]: relightHex(base, rk, nk) } }
    })
    for (const l of d.layers) {
      if (l.byMoment && !l.gen) l.byMoment = { ...l.byMoment, [m.id]: (l.byMoment[ref.id] || l.cells).slice() }
      if (l.show[ref.id] === false) l.show = { ...l.show, [m.id]: false }
    }
    rerunAll(d)
  })
  return m.id
}
export function removeMoment(mid) {
  if (S.doc.moments.length <= 1) return
  change('Remove ' + mname(S.doc, mid), d => {
    d.moments = d.moments.filter(m => m.id !== mid)
    d.palette = d.palette.map(p => {
      const c = { ...p.colors }
      delete c[mid]
      if (!Object.keys(c).length) c[d.moments[0].id] = p.colors[mid]
      return { ...p, colors: c }
    })
    for (const l of d.layers) {
      if (l.byMoment) {
        const b = { ...l.byMoment }
        delete b[mid]
        l.byMoment = Object.keys(b).length ? b : null
        if (l.byMoment && !l.byMoment[d.moments[0].id] && l.cells === undefined) l.cells = Object.values(b)[0]
      }
      if (mid in l.show) {
        const s = { ...l.show }
        delete s[mid]
        l.show = s
      }
      if (l.gen?.pos?.[mid]) {
        const pos = { ...l.gen.pos }
        delete pos[mid]
        l.gen = { ...l.gen, pos }
      }
    }
    rerunAll(d)
  })
}
export function renameMoment(mid, name) {
  name = String(name || '').trim().slice(0, 40)
  if (!name) return
  change('Rename moment', d => {
    const m = d.moments.find(x => x.id === mid)
    if (!m || m.name === name) return false
    m.name = name
  })
}
// A moment's start, kept between its neighbours' (in quarter hours).
export function setStart(mid, hour, key) {
  change(
    'Moment start',
    d => {
      const order = sortMoments(d.moments)
      const k = order.findIndex(m => m.id === mid)
      if (k < 0) return false
      const prev = order[k - 1]
      const next = order[k + 1]
      let h = Math.round(hour * 4) / 4
      const lo = prev ? prev.start + 0.25 : 0
      const hi = next ? next.start - 0.25 : 23.75
      h = Math.max(lo, Math.min(hi, h))
      const m = d.moments.find(x => x.id === mid)
      if (m.start === h) return false
      m.start = h
      d.moments = sortMoments(d.moments)
    },
    key,
  )
}

/* ---------- The theme ---------- */

export function setMeta({ name, slug, line }) {
  change('Theme name', d => {
    let any = false
    if (name !== undefined && name.trim() && name.trim() !== d.name) {
      // The slug follows the name while it was the name's.
      if (d.slug === slugify(d.name) || !validSlug(d.slug)) d.slug = slugify(name) || d.slug
      d.name = name.trim().slice(0, 60)
      any = true
    }
    if (slug !== undefined && validSlug(slug) && slug !== d.slug) {
      d.slug = slug
      any = true
    }
    if (line !== undefined && line.trim() !== d.line) {
      d.line = line.trim().slice(0, 200)
      any = true
    }
    if (!any) return false
  })
}

export { GEN_KINDS, arrays }
