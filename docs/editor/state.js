// The editor's state: the project (with its undo history) and the view's own state.
// change(label, fn) runs fn on a draft of the project and makes it the current one. A draft
// is a shallow copy: layers, palette and moments are copied lists of copied objects, but cell
// arrays are shared, so fn must swap in new arrays (project.js writable/remapCells) rather
// than write into the old ones.
import { blankDoc, minuteIn, momentAt } from './project.js'

const LIMIT = 120
const listeners = new Set()
export const S = {
  doc: blankDoc(),
  past: [],
  future: [],
  last: null, // { key, at } of the last change, to merge slider drags into one step
  rev: 0, // goes up on every change of the project
  // view
  minute: 12 * 60,
  mid: 'day',
  sel: null,
  tool: 'pencil',
  size: 1,
  slot: 0,
  allMoments: false,
  frame: 0, // the frame of animated layers on show while still
  tab: 'layer', // the inspector's tab
  chat: false,
  play: false,
  started: false,
  panels: true,
}

export const on = fn => (listeners.add(fn), () => listeners.delete(fn))
export function emit(what = {}) {
  for (const fn of listeners) fn(what)
}

export function draft(doc = S.doc) {
  return {
    ...doc,
    palette: doc.palette.map(p => ({ ...p, colors: { ...p.colors } })),
    moments: doc.moments.map(m => ({ ...m })),
    layers: doc.layers.map(l => ({ ...l, show: { ...l.show }, byMoment: l.byMoment ? { ...l.byMoment } : null, motion: { ...l.motion }, gen: l.gen ? { ...l.gen } : null })),
  }
}

// key merges a run of changes (a slider drag) into one undo step.
export function change(label, fn, key) {
  const d = draft()
  const r = fn(d)
  if (r === false) return false
  const now = performance.now()
  if (key && S.last && S.last.key === key && now - S.last.at < 1200) {
    // Same step: keep the older state in the history, replace the current one.
  } else {
    S.past.push({ doc: S.doc, label })
    if (S.past.length > LIMIT) S.past.shift()
  }
  S.last = key ? { key, at: now } : null
  S.future = []
  S.doc = d
  S.rev++
  fixView()
  emit({ doc: true, label })
  return true
}
// Commit a draft already worked on (a paint stroke).
export function commitDraft(label, d) {
  S.past.push({ doc: S.doc, label })
  if (S.past.length > LIMIT) S.past.shift()
  S.last = null
  S.future = []
  S.doc = d
  S.rev++
  fixView()
  emit({ doc: true, label })
}

export function undo() {
  const e = S.past.pop()
  if (!e) return null
  S.future.push({ doc: S.doc, label: e.label })
  S.doc = e.doc
  S.last = null
  S.rev++
  fixView()
  emit({ doc: true, undo: true })
  return e.label
}
export function redo() {
  const e = S.future.pop()
  if (!e) return null
  S.past.push({ doc: S.doc, label: e.label })
  S.doc = e.doc
  S.last = null
  S.rev++
  fixView()
  emit({ doc: true, redo: true })
  return e.label
}

// A new project: no history.
export function load(doc, { minute } = {}) {
  S.doc = doc
  S.past = []
  S.future = []
  S.last = null
  S.rev++
  S.sel = doc.layers.length ? doc.layers[doc.layers.length - 1].id : null
  if (minute !== undefined) S.minute = minute
  fixView()
  if (!doc.moments.some(m => m.id === S.mid)) S.mid = doc.moments[momentAt(doc, S.minute)].id
  S.slot = 0
  emit({ doc: true, loaded: true })
}

// Keep the view pointing at things that exist.
export function fixView() {
  const doc = S.doc
  S.mid = doc.moments[momentAt(doc, S.minute)]?.id ?? doc.moments[0].id
  if (S.sel && !doc.layers.some(l => l.id === S.sel)) S.sel = doc.layers.length ? doc.layers[doc.layers.length - 1].id : null
  if (S.slot > doc.palette.length) S.slot = 0
}

export function setMinute(min) {
  S.minute = ((Math.round(min) % 1440) + 1440) % 1440
  const before = S.mid
  fixView()
  emit({ time: true, moment: before !== S.mid })
}
export function goMoment(mid) {
  setMinute(minuteIn(S.doc, mid))
}
export const layer = id => S.doc.layers.find(l => l.id === (id ?? S.sel)) || null
export function select(id) {
  S.sel = id
  emit({ sel: true })
}
export function setView(patch) {
  Object.assign(S, patch)
  emit({ view: true, ...Object.fromEntries(Object.keys(patch).map(k => [k, true])) })
}
