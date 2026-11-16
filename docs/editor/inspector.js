// The inspector at the right: one panel with a rail of tabs (Layer, Look, Colour, Motion,
// Effects), the selected layer's settings in cards, and a help line at its foot that says
// what the control under the pointer does.
import { S, on, emit, layer as getLayer, setView } from './state.js'
import * as A from './actions.js'
import {
  H, W, KIND_LABEL, LIVE, MOTIONS, MOTION_FIELDS, MOTION_LABEL, SCENE_LIMIT, cellsAt, colorOf, frameCount, isGen, isImage,
  motionDefaults, paintable, shownAt, slotUsage, slotsAt,
} from './project.js'
import { GENS, genDefaults } from './gen.js'
import { KIND_NAMES, KINDS, kindOf } from './color.js'
import { ART_LINE, ACCEPT, assetAt, assetsOf, boxOf, costOf, defaultPlace, bitmapsNow, fitArt, hasVersions, lookThumb, momentsOf, previewPx, removeVersion, replaceAsset, setFps, setLit, setLook, setPlace, setVersionAt, splitVersions } from './assets.js'
import { canFit, estimateCost, fullLook, lookPresets, lookSchema, sameLook, withPreset } from './fxa.js'
import { V, compare, setMotionPreview, setOverride } from './canvas.js'
import { btn, buttons, colorField, fitSegs, note, section, seg, select, slider, textField, toggle } from './controls.js'
import { menu, toast } from './ui.js'
import { $, $$, debounce, fmt, h, icon, isMac } from './util.js'

export const TABS = [
  { id: 'layer', label: 'Layer', icon: 'sliders', help: 'The selected layer: its name, when it shows, where it sits and its own settings.' },
  { id: 'look', label: 'Look', icon: 'look', help: 'How your art becomes cells: ready looks, and every effect in the stack.' },
  { id: 'colour', label: 'Colour', icon: 'palette', help: 'The palette: every colour at every moment of the day, relight and tidy.' },
  { id: 'motion', label: 'Motion', icon: 'wave', help: 'How the layer moves in the app, and the speed of animated art.' },
  { id: 'effects', label: 'Effects', icon: 'sparkle', help: 'Live effects that play in the app: colour cycle, pulse and glint.' },
]
const DEFAULT_HELP = 'Point at any control to see what it does. Double-click a slider to reset it.'

let root = null
let rail = null
let scroll = null
let helpEl = null
let holding = false
let pending = false

export function initInspector() {
  root = $('#right')
  rail = h('nav.rail', { role: 'tablist', 'aria-label': 'Inspector' }, TABS.map(t =>
    h('button.rt', { type: 'button', role: 'tab', 'data-tab': t.id, 'data-help': t.help, on: { click: () => setTab(t.id) } }, icon(t.icon), h('span', null, t.label)),
  ))
  scroll = h('div.iscroll')
  helpEl = h('div.helpline', { 'aria-live': 'polite' }, DEFAULT_HELP)
  root.replaceChildren(h('div.insp', null, rail, h('div.ipane', null, scroll, helpEl)))
  // The panel's width changes with the window, the sheets and the scrollbar: choices re-fit.
  if (window.ResizeObserver) new ResizeObserver(() => $$('.segs', scroll).forEach(fitSegs)).observe(scroll)
  root.addEventListener('pointerover', e => {
    const el = e.target.closest('[data-help]')
    const t = el?.getAttribute('data-help')
    helpEl.textContent = t && t.trim() ? t : DEFAULT_HELP
  })
  root.addEventListener('pointerleave', () => (helpEl.textContent = DEFAULT_HELP))
  // No redraw while a slider is held: it would drop the drag.
  root.addEventListener('pointerdown', () => (holding = true))
  addEventListener('pointerup', () => {
    if (!holding) return
    holding = false
    if (pending) render()
  })
  on(what => {
    if (what.hover || what.luma || what.zoom || what.time && !what.moment) return
    schedule()
  })
  render()
}
const schedule = debounce(() => render(), 16)

export function setTab(id) {
  if (!TABS.some(t => t.id === id)) return
  S.tab = id
  if (innerWidth <= 860) document.body.classList.add('sheet-r')
  emit({ tab: true })
}

function render() {
  if (!root) return
  if (holding) {
    pending = true
    return
  }
  pending = false
  for (const b of $$('.rt', rail)) b.setAttribute('aria-selected', String(b.dataset.tab === S.tab))
  const top = scroll.scrollTop
  const l = getLayer()
  const body = { layer: layerTab, look: lookTab, colour: colourTab, motion: motionTab, effects: effectsTab }[S.tab](l)
  scroll.replaceChildren(...[body].flat().filter(Boolean))
  scroll.scrollTop = top
}

// A help-line flash for a control that "/" jumped to.
export function reveal(find) {
  render()
  const el = $$('[data-find]', scroll).find(e => e.getAttribute('data-find') === find)
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  el.classList.add('found')
  setTimeout(() => el.classList.remove('found'), 1400)
  const t = el.getAttribute('data-help')
  if (t) helpEl.textContent = t
  el.querySelector('input, button, select')?.focus({ preventScroll: true })
}

const moment = () => S.doc.moments.find(m => m.id === S.mid)
const empty = (title, text, ...actions) => h('div.empty', null, h('h3', null, title), h('p', null, text), actions.length ? buttons(...actions) : null)

/* ---------- Layer ---------- */

function layerTab(l) {
  if (!l) return empty('No layer yet', 'Layers stack bottom to top: a sky, ridges, your own art, paint. Add one from the Layers panel, or drop a picture anywhere.', btn('Add your art', { icon: 'upload', onClick: () => emit({ openArt: true }) }), btn('Add a layer', { icon: 'plus', onClick: e => emit({ addMenu: e.currentTarget }) }))
  const out = []
  const kind = isImage(l) ? KIND_LABEL.image : KIND_LABEL[l.kind]
  out.push(
    section(
      { title: 'Layer', help: 'The name in the Layers list, and what kind of layer it is.' },
      textField({ label: 'Name', value: l.name, help: 'The layer\'s name. Press Enter to keep it.', onChange: v => A.renameLayer(l.id, v) }),
      note(kindLine(l)),
      buttons(
        btn('Duplicate', { icon: 'copy', help: 'A copy just above it.', key: MODK + 'D', onClick: () => A.duplicateLayer(l.id) }),
        (isGen(l) || isImage(l)) && btn('To paint', { icon: 'pencil', help: 'Turns it into a paint layer you can draw on. Its ' + (isImage(l) ? 'look' : 'generator') + ' stops there.', onClick: () => A.convertToPaint(l.id) }),
        btn('Delete', { icon: 'trash', danger: true, help: 'Deletes the layer. Undo brings it back.', key: 'Del', onClick: () => A.deleteLayer(l.id) }),
      ),
    ),
  )
  out.push(momentsCard(l))
  if (isImage(l)) out.push(...(hasVersions(l) ? [versionsCard(l), artCard(l)] : [artCard(l), versionsCard(l)]))
  if (isGen(l) && l.gen) out.push(genCard(l))
  if (paintable(l)) out.push(paintCard(l))
  if (frameCount(l) > 1) out.push(framesCard(l))
  void kind
  return out
}
const MODK = isMac ? '⌘' : 'Ctrl+'
function kindLine(l) {
  if (isImage(l)) {
    const a = S.doc.assets?.[l.asset]
    return a ? 'Your art, from ' + a.name + (a.frames.length > 1 ? ', ' + a.frames.length + ' frames' : '') + '.' : 'Your art. Its original is gone, so its look can no longer change.'
  }
  if (isGen(l)) return KIND_LABEL[l.kind] + ', drawn by its generator for each moment.'
  if (l.kind === 'picture') return 'A picture held still, painted cell by cell.'
  return 'Paint, cell by cell.'
}
function momentsCard(l) {
  const list = S.doc.moments.map(m => {
    const onNow = l.show?.[m.id] !== false
    return h('button.chip', { type: 'button', 'aria-pressed': String(onNow), 'data-help': 'Show or hide ' + l.name + ' at ' + m.name + '.', on: { click: () => A.setShow(l.id, m.id, !onNow) } }, m.name)
  })
  return section({ title: 'Shows at', help: 'The moments of the day this layer shows at. A star field can show at night only.' }, h('div.chips', null, list), !l.visible ? note('The layer is hidden everywhere (the eye in the Layers list).', 'dim') : null)
}

function artCard(l) {
  const a = S.doc.assets?.[l.asset]
  if (!a || !l.place) return null
  const p = l.place
  const pct = Math.round(p.scale * 100)
  const commit = patch => setPlace(l.id, patch, 'place:' + l.id + ':' + Object.keys(patch).join())
  const live = patch => {
    const pr = previewPx(l, { place: { ...l.place, ...patch }, frame: S.frame })
    if (pr) setOverride({ id: l.id, px: pr.px })
  }
  const thumb = h('canvas.athumb', { width: 96, height: 60 })
  drawAsset(thumb, l.asset)
  return section(
    { title: 'Your art', help: ART_LINE },
    h('div.arow', null, thumb, h('div.ameta', null, h('div.aname', null, a.name), h('div.adim.mono', null, a.w + ' x ' + a.h + ' px' + (a.frames.length > 1 ? ' · ' + a.frames.length + ' frames' : '')))),
    note(ART_LINE, 'dim'),
    slider({ label: 'Across', help: 'Where the art\'s left edge sits, in cells from the left. Or drag the art with the Move tool (V).', min: -Math.round(a.w * p.scale), max: W, step: 1, value: p.x, def: defaultPlace(a, bitmapsNow(l.asset)?.[0]).x, unit: '', onInput: v => live({ x: v }), onChange: v => commit({ x: v }) }),
    slider({ label: 'Down', help: 'Where its top edge sits, in cells from the top.', min: -Math.round(a.h * p.scale), max: H, step: 1, value: p.y, def: defaultPlace(a, bitmapsNow(l.asset)?.[0]).y, onInput: v => live({ y: v }), onChange: v => commit({ y: v }) }),
    slider({ label: 'Size', help: 'How big the art is: 100% is one cell per pixel of the art. Or drag a corner, or hold Alt and scroll over it.', min: 2, max: 800, step: 1, value: pct, def: Math.round(defaultPlace(a, bitmapsNow(l.asset)?.[0]).scale * 100), unit: '%', onInput: v => live(scaleAbout(l, v / 100)), onChange: v => commit(scaleAbout(l, v / 100)) }),
    S.doc.moments.length > 1 && !hasVersions(l)
      ? toggle({ label: 'Light by the time of day', help: 'Off: your art keeps its own colours all day. On: it is lit as drawn by day, warmer at sunset, darker and bluer at night.', value: !!l.lit, find: 'Light by the time of day', onChange: v => setLit(l.id, v) })
      : null,
    buttons(
      btn('Flip', { icon: 'flip', help: 'Mirrors the art left to right.', key: 'Shift+H', onClick: () => commit({ flipX: !p.flipX }) }),
      btn('Cover', { help: 'As big as the scene, cropped the way the app fills a window.', onClick: () => commit(coverPlace(a)) }),
      btn('Fit', { help: 'The whole art inside the scene.', onClick: () => commit(fitPlace(a)) }),
      btn('Replace', { icon: 'replace', help: 'Puts other art in its place, at the same size and spot, with the same look.', onClick: e => replaceMenu(e.currentTarget, l) }),
    ),
  )
}
const r3 = v => Math.round(v * 1000) / 1000
function scaleAbout(l, s) {
  const a = S.doc.assets[l.asset]
  const p = l.place
  // About the art's foot, so it stays standing where it was.
  const cx = p.x + (a.w * p.scale) / 2
  const by = p.y + a.h * p.scale
  return { scale: r3(s), x: Math.round(cx - (a.w * s) / 2), y: Math.round(by - a.h * s) }
}
const coverPlace = a => {
  const s = Math.max(W / a.w, H / a.h)
  return { scale: r3(s), x: Math.round((W - a.w * s) / 2), y: Math.round(H - a.h * s) }
}
const fitPlace = a => {
  const s = Math.min(W / a.w, H / a.h)
  return { scale: r3(s), x: Math.round((W - a.w * s) / 2), y: Math.round(H - a.h * s) }
}
function replaceMenu(anchor, l) {
  const items = Object.entries(S.doc.assets || {}).filter(([id]) => id !== l.asset).map(([id, a]) => ({ label: a.name, run: () => replaceAsset(l.id, id) }))
  menu(anchor, [...items, items.length ? 'sep' : null, { label: 'Open a file…', icon: 'upload', run: () => emit({ openArt: true, replace: l.id }) }], { place: 'below', align: 'end' })
}
// Other pictures of the same scene for some moments (a night one, say), in the layer's place
// and look. The layer list says which shows when; the day line switches them.
function versionsCard(l) {
  if (!S.doc.assets?.[l.asset] || !l.place) return null
  const list = assetsOf(l)
  const many = list.length > 1
  return section(
    { title: 'Times of day', help: 'Other pictures of the same scene, each shown at its own moments: a day one and a night one, say. They share the look and the place.' },
    many ? h('div.vlist', null, list.map(id => versionRow(l, id))) : note('One picture at every moment. Another picture of the same scene can take over at one moment: a night one, say.', 'dim'),
    many ? note('One look and one place for all of them. Move along the day line to see them switch.', 'dim') : null,
    buttons(
      btn('Add a version for another time of day…', { icon: 'plus', help: 'Another picture of the same scene for one moment, in the same place with the same look. It shows only at that moment.', find: 'Add a version for another time of day', onClick: e => versionMenu(e.currentTarget, l) }),
      many && btn('Split into layers', { help: 'Each picture becomes a layer of its own, shown at its moments, so each can have its own look.', onClick: () => splitVersions(l.id) }),
    ),
  )
}
function versionRow(l, id) {
  const a = S.doc.assets[id]
  const at = momentsOf(l, id)
  const names = at.map(m => S.doc.moments.find(x => x.id === m)?.name).join(', ')
  const thumb = h('canvas.athumb', { width: 96, height: 60 })
  drawAsset(thumb, id)
  const own = id === l.asset
  const items = () => [
    { head: 'Shows at' },
    ...S.doc.moments.map(m => {
      const on = at.includes(m.id)
      // A moment leaves a version for the layer's own picture; the own one cannot give one up.
      return { label: m.name, checked: on, disabled: own && on, run: () => setVersionAt(l.id, m.id, on ? l.asset : id) }
    }),
    ...(own ? [] : ['sep', { label: 'Remove this version', icon: 'trash', run: () => removeVersion(l.id, id) }]),
  ]
  return h('div.arow.vrow' + (at.includes(S.mid) ? '.now' : ''), null,
    thumb,
    h('div.ameta', null, h('div.aname', null, a.name), h('div.adim', null, names ? 'Shows at ' + names : 'Shows at no moment')),
    h('button.ib', { type: 'button', 'aria-label': 'Moments of ' + a.name, 'data-hint': 'The moments it shows at', on: { click: e => menu(e.currentTarget, items(), { place: 'below', align: 'end' }) } }, icon('more')),
  )
}
export function versionMenu(anchor, l) {
  const open = mid => emit({ openArt: true, version: { id: l.id, mid } })
  const items = S.doc.moments.filter(m => assetAt(l, m.id) === l.asset).map(m => ({ label: 'For ' + m.name, run: () => open(m.id) }))
  if (S.doc.moments.length === 1) {
    const add = S.doc.moments[0].id === 'night' ? { id: 'day', name: 'Day', start: 6 } : { id: 'night', name: 'Night', start: 18 }
    items.push({ label: 'For ' + add.name + ' (adds a moment at ' + String(add.start).padStart(2, '0') + ':00)', run: () => { const mid = A.addMoment(add); if (mid) open(mid) } })
  }
  if (!items.length) items.push({ label: 'Every moment has its own picture', disabled: true })
  menu(anchor, [{ head: 'Which moment?' }, ...items], { place: 'below', align: 'start' })
}
export async function drawAsset(canvas, assetId) {
  const { framesOf } = await import('./assets.js')
  const bm = (await framesOf(assetId))[0]
  if (!bm) return
  const x = canvas.getContext('2d')
  const k = Math.min(canvas.width / bm.width, canvas.height / bm.height)
  x.clearRect(0, 0, canvas.width, canvas.height)
  x.imageSmoothingQuality = 'high'
  x.drawImage(bm, (canvas.width - bm.width * k) / 2, (canvas.height - bm.height * k) / 2, bm.width * k, bm.height * k)
}

function genCard(l) {
  const G = GENS[l.kind]
  const defs = genDefaults(l.kind, S.doc)
  const m = moment()
  const fields = G.fields.map(f => {
    const pos = f.perMoment ? l.gen.pos?.[S.mid] || A.currentSunPos(S.doc, l) : null
    const value = f.perMoment ? pos[f.key] : l.gen[f.key]
    const label = f.perMoment ? f.label + ' at ' + m.name : f.label
    const help = f.hint || G.label + ': ' + f.label.toLowerCase() + '.'
    if (f.type === 'range') {
      const def = f.perMoment ? defs.pos?.[S.mid]?.[f.key] : defs[f.key]
      return slider({ label, help, min: f.min, max: f.max, step: f.step, value, def, unit: f.unit ? ' ' + f.unit : '', find: G.label + ' ' + f.label, onInput: v => A.setGen(l.id, f, v) })
    }
    if (f.type === 'choice') return seg({ label, help, choices: f.options, value, find: G.label + ' ' + f.label, onChange: v => A.setGen(l.id, f, v) })
    if (f.type === 'color') return colorField({ label, help: (f.hint || 'Its colour by day; the other moments are lit from it.'), value, find: G.label + ' ' + f.label, onChange: v => A.setGen(l.id, f, v) })
    if (f.type === 'seed') return buttons(btn('New ' + f.label.toLowerCase(), { icon: 'dice', help: 'Draws it again from a new seed: same settings, different shapes.', onClick: () => A.reseed(l.id) }))
    return null
  })
  return section({ title: G.label, help: 'The generator\'s settings. It draws the layer for every moment, lit by the sun layer.' }, fields)
}

function paintCard(l) {
  const per = !!l.byMoment
  return section(
    { title: 'Painting', help: 'Paint with the tools at the left. Alt-click picks a colour from the scene.' },
    per
      ? toggle({ label: 'Paint every moment at once', help: 'This layer has its own cells at each moment. On: a stroke goes to all of them. Off: only to ' + moment().name + '.', value: S.allMoments, onChange: v => setView({ allMoments: v }) })
      : note('One picture for every moment; the palette gives each moment its colours.', 'dim'),
    note('Cost in the scene: about ' + fmt(costOf(cellsAt(l, S.mid, S.frame))) + ' characters.', 'dim mono'),
  )
}

function framesCard(l) {
  const n = frameCount(l)
  return section(
    { title: 'Frames', help: 'Animated art plays its frames in the app, on its 0.05 s clock.' },
    slider({ label: 'Frame on show', help: 'The frame shown while you edit. Painting goes to this frame.', min: 1, max: n, step: 1, value: (S.frame % n) + 1, def: 1, onInput: v => setView({ frame: v - 1 }) }),
    slider({ label: 'Speed', help: 'Frames per second. The app snaps each frame to its 0.05 s clock, so 20 is the fastest.', min: 1, max: 20, step: 1, value: l.anim?.fps || 10, def: 10, unit: ' fps', find: 'Frames per second', onChange: v => setFps(l.id, v, 'fps:' + l.id) }),
  )
}

/* ---------- Look ---------- */

const thumbs = new Map() // cache key -> canvas
let thumbJob = 0
function lookTab(l) {
  if (!l || !isImage(l)) {
    return empty('Looks are for your art', 'A look turns a picture into cells: how many colours, a dither, pixel shapes, glyphs, an outline. ' + ART_LINE, btn('Add your art', { icon: 'upload', primary: true, onClick: () => emit({ openArt: true }) }))
  }
  if (!S.doc.assets?.[l.asset]) return empty('The original is gone', 'This art\'s original picture is not in the project, so its look can no longer change. Its cells stay as they are.')
  const look = fullLook(l.look)
  const out = []
  // Ready-made looks, previewed on this very art.
  const job = ++thumbJob
  const grid = h('div.looks')
  const presets = lookPresets()
  const sig = assetAt(l) + '|' + JSON.stringify(l.place) + '|' + JSON.stringify(look.cut) + '|' + S.mid + '|' + S.doc.palette.length
  const queue = []
  for (const p of presets) {
    const key = sig + '|' + p.id
    let c = thumbs.get(key)
    const fresh = !c
    if (!c) {
      c = h('canvas.lthumb', { width: 120, height: 76 })
      thumbs.set(key, c)
      if (thumbs.size > 120) thumbs.delete(thumbs.keys().next().value)
    }
    const active = sameLook(look, withPreset(look, p))
    grid.append(h('button.lk', { type: 'button', 'aria-pressed': String(active), 'data-help': (p.hint ? p.hint + ' ' : '') + 'Your settings below change with it; the background stays.', 'data-find': 'Look ' + p.name, on: { click: () => setLook(l.id, withPreset(fullLook(getLayer(l.id)?.look), p)) } }, c, h('span', null, p.name)))
    if (fresh) queue.push([c, p])
  }
  // Draw the thumbnails a few at a time, so the panel opens at once.
  const step = () => {
    if (job !== thumbJob || !queue.length) return
    const [c, p] = queue.shift()
    lookThumb(c, l, withPreset(look, p))
    if (window.requestIdleCallback) requestIdleCallback(step, { timeout: 200 })
    else setTimeout(step, 0)
  }
  setTimeout(step, 30)
  const cmp = btn('Hold to compare', { icon: 'compare', key: '\\', help: 'Hold to see your art as it came in, before the look. Or hold the \\ key.' })
  cmp.addEventListener('pointerdown', () => compare(true))
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) cmp.addEventListener(ev, () => compare(false))
  const cost = costOf(cellsAt(l, S.mid, S.frame)) * frameCount(l)
  costEl = costRow(cost / frameCount(l), frameCount(l))
  // Over its share of a scene: fx simplifies the look until it fits, and says what it changed.
  const fit = canFit() && cost > SCENE_LIMIT * 0.6 ? fitButton(l) : null
  out.push(
    section(
      { title: 'Looks', help: 'Ready-made looks, drawn on your own art. Pick one, then change anything below.' },
      grid,
      costEl,
      buttons(cmp, fit),
    ),
  )
  // The stack, in order.
  for (const sec of lookSchema()) {
    const val = sec.top ? { mode: look[sec.id] } : look[sec.id] || {}
    const set = (patch, commit) => {
      const next = sec.top ? { ...look, [sec.id]: patch.mode } : { ...look, [sec.id]: { ...look[sec.id], ...patch } }
      if (commit) setLook(l.id, next, 'look:' + l.id + ':' + sec.id + ':' + Object.keys(patch).join())
      else livePreview(l, next)
    }
    const fields = sec.fields.filter(f => !f.when || f.when(val, look)).flatMap(f => lookField(sec, f, val, set))
    out.push(section({ title: sec.name, help: sec.help, on: sec.toggle ? !!val.on : undefined, onToggle: v => set({ on: v }, true), find: 'Look ' + sec.name }, fields))
  }
  return out
}
// The budget is the smaller of 60% of a scene and what the other layers leave (with room for
// the scene's own wrapper), so the art never crowds out the rest.
function fitButton(l) {
  const b = btn('Make it fit', { icon: 'wand', find: 'Look Make it fit', help: 'Simplifies the look step by step until the art takes at most 60% of a scene, or what the other layers leave. Undo brings it back.' })
  b.addEventListener('click', async () => {
    if (b.disabled) return
    b.disabled = true
    b.querySelector('span').textContent = 'Fitting…'
    await new Promise(r => setTimeout(r, 30))
    let others = 0
    for (const x of S.doc.layers) if (x.id !== l.id && shownAt(x, S.mid)) others += costOf(cellsAt(x, S.mid, 0)) * frameCount(x)
    const budget = Math.max(8000, Math.min(Math.round(SCENE_LIMIT * 0.6), SCENE_LIMIT - others - 4000))
    let r = null
    try {
      r = await fitArt(l.id, budget)
    } catch {
      r = null
    }
    if (b.isConnected) {
      b.disabled = false
      b.querySelector('span').textContent = 'Make it fit'
    }
    if (!r) return toast('The look could not be fitted here.', { ms: 2400 })
    const did = r.steps.length ? [...new Set(r.steps)].join(', ').toLowerCase() : ''
    if (!did) toast('This look is already as simple as it gets. Try a smaller size, or fewer colours by hand.', { ms: 3600 })
    else toast((r.fits ? 'Fits now: ' : 'Lighter, still over: ') + did + '.', { ms: 3600 })
  })
  return b
}
// The layer's share of a scene, live while a slider moves.
let costEl = null
function costRow(chars, frames = 1) {
  const total = chars * frames
  const el = h('div.costrow', { 'data-help': 'About how much of a scene this layer takes: a scene may hold ' + fmt(SCENE_LIMIT) + ' characters in all. Fewer colours, flat areas and ordered patterns cost less; diffusion costs the most.' },
    h('div.costbar', { class: total > SCENE_LIMIT * 0.6 ? 'warn' : '' }, h('i', { style: { width: Math.min(100, (total / SCENE_LIMIT) * 100) + '%' } })),
    h('span.mono', null, 'About ' + fmt(total) + ' of ' + fmt(SCENE_LIMIT) + (frames > 1 ? ' · ' + frames + ' frames' : '')),
  )
  return el
}
function lookField(sec, f, val, set) {
  const find = sec.name + ' ' + f.label
  const v = val[f.key] ?? f.def
  const help = f.hintOf ? [f.help, f.hintOf(v)].filter(Boolean).join(' ') : f.help
  if (f.bool) return toggle({ label: f.label, help, value: !!v, find, onChange: x => set({ [f.key]: x }, true) })
  if (f.color) return colorField({ label: f.label, help, value: v, find, onInput: c => set({ [f.key]: c }), onChange: c => set({ [f.key]: c }, true) })
  if (f.ground) {
    // None, the darkest or lightest colour of the art, or a colour of its own.
    const own = /^#[0-9a-f]{6}$/i.test(v)
    const choices = [...(f.noNone ? [] : [['none', 'None']]), ['dark', 'Dark'], ['light', 'Light'], ['own', 'Colour']]
    const out = [seg({ label: f.label, help, choices, value: own ? 'own' : v, find, onChange: c => set({ [f.key]: c === 'own' ? (own ? v : '#101420') : c }, true) })]
    if (own) out.push(colorField({ label: 'Its colour', help: 'The colour of its own.', value: v, find: find + ' colour', onInput: c => set({ [f.key]: c }), onChange: c => set({ [f.key]: c }, true) }))
    return out
  }
  if (f.choice) {
    if (f.select || f.choice.length > 5) return select({ label: f.label, help, choices: f.choice, value: v, find, onChange: c => set({ [f.key]: c }, true) })
    return seg({ label: f.label, help, choices: f.choice, value: v, find, onChange: c => set({ [f.key]: c }, true) })
  }
  return slider({ label: f.label, help, min: f.min, max: f.max, step: f.step || 1, value: v, def: f.def, unit: f.unit || '', fmt: f.fmt, find, onInput: x => set({ [f.key]: x }), onChange: x => set({ [f.key]: x }, true) })
}
let liveRaf = 0
let liveNext = null
function livePreview(l, look) {
  liveNext = { l, look }
  if (liveRaf) return
  liveRaf = requestAnimationFrame(() => {
    liveRaf = 0
    const { l: ll, look: lk } = liveNext
    const p = previewPx(ll, { look: lk, frame: S.frame })
    if (!p) return
    setOverride({ id: ll.id, px: p.px })
    // The cost follows the slider.
    if (costEl?.isConnected) {
      const next = costRow(estimateCost(p.cells, p.list), frameCount(ll))
      costEl.replaceWith(next)
      costEl = next
    }
  })
}
// After a commit, the real cells show again.
on(what => {
  if (what.doc) setOverride(null)
})

/* ---------- Colour ---------- */

let replacing = 0
function colourTab(l) {
  const d = S.doc
  const m = moment()
  const out = []
  if (!d.palette.length) {
    return empty('No colours yet', 'Colours come with every layer: generators, your art and pictures bring their own. Add one to paint with.', addColourBtn())
  }
  const now = slotsAt(d, S.mid)
  const usage = slotUsage(d)
  const mine = l ? new Set(layerSlots(l)) : null
  const sw = s => {
    const c = colorOf(d, s, S.mid)
    return h('button.sw', {
      type: 'button',
      style: { background: c },
      'aria-pressed': String(S.slot === s),
      'aria-label': 'Colour ' + s + ', ' + c,
      'data-help': (replacing ? 'Every cell of colour ' + replacing + ' takes this one.' : 'Colour ' + s + ' at ' + m.name + ': ' + c + '. Click to paint with it.') + (usage[s] ? '' : ' Nothing uses it.'),
      on: { click: () => {
        if (replacing) {
          const from = replacing
          replacing = 0
          if (from !== s) A.replaceSlot(from, s)
          else emit({ slot: true })
          return
        }
        S.slot = s
        emit({ slot: true })
      } },
    })
  }
  const onlyMine = !!(l && filterMine)
  const list = (onlyMine ? now.filter(s => mine.has(s)) : now)
  out.push(
    section(
      { title: 'Colours at ' + m.name, help: 'The colours that show at this moment. Each colour has its own shade at every moment of the day.' },
      l ? toggle({ label: 'Only ' + l.name, help: 'Show only the colours the selected layer uses.', value: onlyMine, onChange: v => ((filterMine = v), render()) }) : null,
      h('div.swatches', null, list.map(sw)),
      list.length ? null : note('No colours of this layer show at this moment.', 'dim'),
      replacing ? note('Pick the colour that takes the place of colour ' + replacing + '. Esc cancels.', 'state') : null,
    ),
  )
  if (S.slot && d.palette[S.slot - 1]) out.push(slotCard(S.slot))
  out.push(relightCard())
  out.push(tidyCard(usage))
  return out
}
let filterMine = false
function layerSlots(l) {
  const set = new Set()
  for (const arr of [l.cells, ...Object.values(l.byMoment || {}), ...(l.frames || [])]) if (arr) for (let i = 0; i < arr.length; i++) arr[i] && set.add(arr[i])
  return [...set]
}
function addColourBtn() {
  const input = h('input.cpick', { type: 'color', value: '#8899aa' })
  input.addEventListener('change', () => A.addColor(input.value))
  return h('label.btn', { 'data-help': 'A new colour at this moment; the other moments get it relit for their light.' }, icon('plus'), h('span', null, 'Add colour'), input)
}
function slotCard(s) {
  const d = S.doc
  const p = d.palette[s - 1]
  const rows = d.moments.map(m => {
    const c = p.colors[m.id] || colorOf(d, s, m.id)
    return colorField({ label: m.name, help: 'Colour ' + s + ' at ' + m.name + '.', value: c, find: 'Colour at ' + m.name, onInput: v => A.setColor(s, m.id, v), onChange: v => A.setColor(s, m.id, v) })
  })
  return section(
    { title: 'Colour ' + s, help: 'This colour at every moment. Painting with it paints all of these at once, each at its own time of day.' },
    rows,
    buttons(
      btn('Relight from ' + moment().name, { icon: 'sun', help: 'Fills its other moments from its ' + moment().name + ' shade, each through its own light.', onClick: () => A.relightFrom(S.mid, kindTargets(), [s]) }),
      btn('Replace', { icon: 'replace', help: 'Every cell of this colour takes another: pick it in the swatches above.', onClick: () => {
        replacing = s
        render()
      } }),
    ),
  )
}
const kindChoice = {} // mid -> kind chosen for relight
function kindTargets() {
  return Object.fromEntries(S.doc.moments.map(m => [m.id, kindChoice[m.id] || kindOf(m)]))
}
function relightCard() {
  const m = moment()
  const rows = S.doc.moments.filter(x => x.id !== S.mid).map(x =>
    select({ label: x.name, help: 'The light ' + x.name + ' gets when relit: dawn is pink, sunset warm and darker, night blue and much darker.', choices: KINDS.map(k => [k, KIND_NAMES[k]]), value: kindChoice[x.id] || kindOf(x), onChange: v => (kindChoice[x.id] = v) }),
  )
  return section(
    { title: 'Relight', help: 'Gives every colour its other moments from this one, each through its light. Generators keep their own.' },
    note('From ' + m.name + ' to:', 'dim'),
    rows.length ? rows : note('Add a moment in the day bar first.', 'dim'),
    rows.length ? buttons(btn('Relight every colour', { icon: 'sun', primary: true, help: 'Fills the other moments of every colour from ' + m.name + '.', onClick: () => A.relightFrom(S.mid, kindTargets()) })) : null,
  )
}
let mergeDist = 4
function tidyCard(usage) {
  let unused = 0
  for (let s = 1; s < usage.length; s++) if (!usage[s]) unused++
  return section(
    { title: 'Tidy', help: 'Fewer colours make a smaller scene.' },
    h('div.ctl.inline', null, h('span.cl', null, S.doc.palette.length + ' colours'), h('span.cv.mono', null, unused ? unused + ' unused' : 'all in use')),
    addColourBtn(),
    slider({ label: 'Merge closer than', help: 'Colours closer than this at every moment become one. 1 is a difference you can barely see; 12 joins clearly different shades.', min: 1, max: 12, step: 0.5, value: mergeDist, def: 4, onInput: v => (mergeDist = v) }),
    buttons(
      btn('Merge similar', { icon: 'merge', help: 'Joins colours that look alike at every moment. Generator colours stay.', onClick: () => {
        const n = A.mergeSimilar(mergeDist / 100)
        toast(n < 0 ? 'Too many colours to compare; remove unused ones first.' : n ? n + ' colours merged.' : 'No colours that close.')
      } }),
      btn('Remove unused', { icon: 'trash', help: 'Drops colours no layer uses.', onClick: () => {
        const n = A.removeUnused()
        toast(n ? n + ' unused colours removed.' : 'Every colour is in use.')
      } }),
    ),
  )
}

/* ---------- Motion ---------- */

function motionTab(l) {
  if (!l) return empty('Nothing to move yet', 'Select a layer to give it motion: clouds drift, snow falls, grass sways, stars twinkle.')
  const m = l.motion || { type: 'none' }
  const out = []
  const fields = (MOTION_FIELDS[m.type] || []).map(f =>
    f.choice
      ? seg({ label: f.label, help: 'Which way it drifts.', choices: f.choice, value: m[f.key], find: 'Motion ' + f.label, onChange: v => A.setMotion(l.id, { ...m, [f.key]: v }) })
      : slider({ label: f.label, help: motionHelp(m.type, f), min: f.min, max: f.max, step: f.step, value: m[f.key], def: f.def, unit: f.unit, find: 'Motion ' + f.label, onInput: v => A.setMotion(l.id, { ...m, [f.key]: v }, 'motion:' + l.id + ':' + f.key) }),
  )
  out.push(
    section(
      { title: 'Motion', help: 'How ' + l.name + ' moves in the app. Motion costs a little of the scene and of the frame budget.' },
      seg({ label: 'Moves by', help: 'Drift slides it across and around; Fall drops it and brings it back on top; Sway and Bob rock it; Twinkle fades parts of it in turn.', choices: MOTIONS.map(t => [t, MOTION_LABEL[t]]), value: m.type, find: 'Motion type', wide: true, onChange: v => A.setMotion(l.id, v === 'none' ? { type: 'none' } : { ...motionDefaults(v) }) }),
      fields,
      toggle({ label: 'Preview motion', help: 'Plays motion, frames and live effects here as you edit. Play (P) shows the real exported scene.', value: V.motion, find: 'Preview motion', onChange: v => setMotionPreview(v) }),
    ),
  )
  if (frameCount(l) > 1) out.push(framesCard(l))
  return out
}
function motionHelp(type, f) {
  if (f.key === 'period') return type === 'drift' || type === 'fall' ? 'Seconds for one whole loop. Slower is calmer.' : 'Seconds for one swing.'
  if (f.key === 'amount') return 'How far it moves, in cells.'
  return ''
}

/* ---------- Effects ---------- */

function effectsTab(l) {
  if (!l) return empty('No layer selected', 'Live effects play in the app: colours that cycle, a gentle pulse, a glint of light.')
  const live = l.live || []
  const out = []
  for (const [type, D] of Object.entries(LIVE)) {
    const e = live.find(x => x.type === type)
    const set = (patch, key) => {
      const next = live.filter(x => x.type !== type)
      if (patch) next.push({ ...(e || defaultsOf(type)), ...patch })
      A.setLive(l.id, next, key)
    }
    const fields = D.fields.map(f =>
      slider({ label: f.label, help: D.label + ': ' + f.label.toLowerCase() + '.', min: f.min, max: f.max, step: f.step, value: e?.[f.key] ?? f.def, def: f.def, unit: f.unit, find: D.label + ' ' + f.label, onInput: v => set({ [f.key]: v }, 'live:' + l.id + ':' + type + ':' + f.key) }),
    )
    if (type === 'glint') {
      const slots = layerSlots(l).slice(0, 48)
      fields.push(
        h('div.ctl', { 'data-help': 'The colour of the band: white light, or one of the layer\'s own colours.', 'data-find': 'Glint colour' },
          h('div.crow', null, h('label.cl', null, 'Colour')),
          h('div.swatches.small', null,
            h('button.sw.white', { type: 'button', 'aria-pressed': String(!(e?.slot)), 'aria-label': 'White light', on: { click: () => set({ slot: 0 }) } }),
            slots.map(s => h('button.sw', { type: 'button', style: { background: colorOf(S.doc, s, S.mid) }, 'aria-pressed': String(e?.slot === s), 'aria-label': 'Colour ' + s, on: { click: () => set({ slot: s }) } })),
          ),
        ),
      )
    }
    out.push(section({ title: D.label, help: D.help, on: !!e, onToggle: v => set(v ? {} : null), find: D.label }, fields))
  }
  out.push(h('div.cardnote', null, note('Live effects play in the app on the scene\'s clock, with the motion. See them here with Preview motion (M), or play the real scene (P).', 'dim')))
  return out
}
function defaultsOf(type) {
  const x = { type }
  for (const f of LIVE[type].fields) x[f.key] = f.def
  if (type === 'glint') x.slot = 0
  return x
}

/* ---------- Search index: every setting the inspector has ---------- */

export function searchIndex() {
  const out = []
  const l = getLayer()
  for (const t of TABS) out.push({ label: t.label, where: 'Inspector', run: () => setTab(t.id) })
  if (l && isImage(l)) {
    for (const p of lookPresets()) out.push({ label: p.name, where: 'Look · ready looks', help: p.hint, run: () => (setTab('look'), setLook(l.id, withPreset(fullLook(l.look), p))) })
    for (const sec of lookSchema()) {
      out.push({ label: sec.name, where: 'Look', run: () => goFind('look', 'Look ' + sec.name) })
      for (const f of sec.fields) out.push({ label: f.label, where: 'Look · ' + sec.name, help: f.help, run: () => goFind('look', sec.name + ' ' + f.label) })
    }
    for (const k of ['Across', 'Down', 'Size']) out.push({ label: k, where: 'Layer · Your art', run: () => goFind('layer', k) })
  }
  if (l && isGen(l)) for (const f of GENS[l.kind].fields) out.push({ label: f.label, where: 'Layer · ' + GENS[l.kind].label, help: f.hint, run: () => goFind('layer', GENS[l.kind].label + ' ' + f.label) })
  if (l) {
    out.push({ label: 'Motion', where: 'Motion', run: () => goFind('motion', 'Motion type') })
    for (const [t, fs] of Object.entries(MOTION_FIELDS)) for (const f of fs) out.push({ label: MOTION_LABEL[t] + ' ' + f.label.toLowerCase(), where: 'Motion', run: () => (A.setMotion(l.id, l.motion?.type === t ? l.motion : motionDefaults(t)), goFind('motion', 'Motion ' + f.label)) })
    for (const [t, D] of Object.entries(LIVE)) out.push({ label: D.label, where: 'Effects', help: D.help, run: () => goFind('effects', D.label) })
    out.push({ label: 'Shows at', where: 'Layer', run: () => goFind('layer', 'Shows at') })
    if (frameCount(l) > 1) out.push({ label: 'Frames per second', where: 'Layer · Frames', run: () => goFind('layer', 'Frames per second') })
  }
  out.push({ label: 'Relight', where: 'Colour', run: () => goFind('colour', 'Relight') })
  out.push({ label: 'Merge similar colours', where: 'Colour · Tidy', run: () => goFind('colour', 'Tidy') })
  out.push({ label: 'Preview motion', where: 'Motion', run: () => goFind('motion', 'Preview motion') })
  return out
}
function goFind(tab, find) {
  setTab(tab)
  requestAnimationFrame(() => reveal(find))
}

export { ACCEPT, boxOf }
