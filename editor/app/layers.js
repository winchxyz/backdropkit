// The left sidebar, drawn like the app's sessions list: the tools, the layers (top first,
// drag to reorder, double-click to rename) and the art you brought in.
import { S, on, emit, select, setView, layer as getLayer } from './state.js'
import * as A from './actions.js'
import { KIND_LABEL, isGen, isImage, paintable, shownAt } from './project.js'
import { drawThumb } from './render.js'
import { ART_LINE, addImageLayer, assetUsers, removeAsset, replaceAsset } from './assets.js'
import { drawAsset, setTab } from './inspector.js'
import { menu, ask, toast } from './ui.js'
import { $, $$, debounce, h, icon, isMac } from './util.js'

export const TOOLS = [
  { id: 'move', label: 'Move', key: 'V', icon: 'move', help: 'Moves the selected layer. On your art: drag it, pull a corner to size it, or hold Alt and scroll.' },
  { id: 'pencil', label: 'Pencil', key: 'B', icon: 'pencil', help: 'Paints cells in the chosen colour. 1, 2 and 3 set its size.' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: 'eraser', help: 'Clears cells, so what is below shows.' },
  { id: 'fill', label: 'Fill', key: 'G', icon: 'fill', help: 'Fills an area of one colour.' },
  { id: 'line', label: 'Line', key: 'L', icon: 'line', help: 'A straight line. Shift keeps it level or at 45°.' },
  { id: 'rect', label: 'Rectangle', key: 'R', icon: 'rect', help: 'A rectangle. Shift fills it.' },
  { id: 'picker', label: 'Pick colour', key: 'I', icon: 'picker', help: 'Picks a colour from the scene. Alt does it with any tool.' },
]
export const ADD_KINDS = [
  { kind: 'art', label: 'Your art…', icon: 'upload', help: 'A picture, sprite or GIF of your own.' },
  { kind: 'paint', label: 'Paint', icon: 'pencil' },
  'sep',
  { kind: 'sky', label: 'Sky', icon: 'sun' },
  { kind: 'sun', label: 'Sun and moon', icon: 'sun' },
  { kind: 'stars', label: 'Stars', icon: 'sparkle' },
  { kind: 'clouds', label: 'Clouds', icon: 'wave' },
  { kind: 'ridge', label: 'Ridges and hills', icon: 'image' },
  { kind: 'trees', label: 'Trees', icon: 'image' },
  { kind: 'water', label: 'Water', icon: 'wave' },
]

let root = null
let toolsEl = null
let listEl = null
let artEl = null

export function initLayers() {
  root = $('#left')
  toolsEl = h('div.tools', { role: 'toolbar', 'aria-label': 'Tools' })
  listEl = h('ol.layers', { 'aria-label': 'Layers, top first' })
  artEl = h('div.art')
  const addBtn = h('button.ib', { type: 'button', 'data-hint': 'Add a layer', 'aria-label': 'Add a layer', on: { click: e => addMenu(e.currentTarget) } }, icon('plus'))
  const artBtn = h('button.ib', { type: 'button', 'data-hint': 'Bring in pictures, sprites or GIFs', 'aria-label': 'Add art', on: { click: () => emit({ openArt: true }) } }, icon('upload'))
  root.replaceChildren(
    toolsEl,
    h('div.lhead', null, h('h2', null, 'Layers'), addBtn),
    h('div.lscroll', null, listEl, h('div.lhead.art-head', null, h('h2', null, 'Your art'), artBtn), artEl),
  )
  on(what => {
    if (what.hover || what.luma || what.zoom || (what.time && !what.moment)) return
    if (what.tool || what.slot || what.view) drawTools()
    if (what.doc || what.sel || what.moment || what.loaded || what.view || what.slot) drawList()
    if (what.doc || what.loaded) drawArt()
  })
  on(what => what.addMenu && addMenu(what.addMenu))
  drawTools()
  drawList()
  drawArt()
}

export function addMenu(anchor) {
  menu(anchor, ADD_KINDS.map(k => (k === 'sep' ? 'sep' : {
    label: k.label,
    icon: k.icon,
    run: () => {
      if (k.kind === 'art') return emit({ openArt: true })
      if (k.kind === 'stars') return A.addStarLayer()
      if (k.kind === 'water') return A.addWater()
      A.addLayer(k.kind)
      if (k.kind === 'paint') setView({ tool: 'pencil' })
    },
  })), { place: anchor.closest('.side-l') ? 'right' : 'below' })
}

/* ---------- Tools ---------- */

function drawTools() {
  const l = getLayer()
  const sizes = S.tool === 'pencil' || S.tool === 'eraser'
  const colour = S.slot ? S.doc.palette[S.slot - 1] : null
  const hex = colour ? colour.colors[S.mid] || Object.values(colour.colors)[0] : null
  toolsEl.replaceChildren(
    h('div.trow', null,
      TOOLS.map(t => h('button.tool', { type: 'button', 'aria-pressed': String(S.tool === t.id), 'aria-label': t.label, 'data-hint': t.label + '. ' + t.help, 'data-key': t.key, on: { click: () => setView({ tool: t.id }) } }, icon(t.icon))),
    ),
    h('div.trow.sub', null,
      h('button.cur', { type: 'button', 'aria-label': 'Colour', 'data-hint': hex ? 'Painting with colour ' + S.slot + ' (' + hex + '). Pick another in Colour.' : 'No colour chosen. Pick one in Colour, or Alt-click the scene.', on: { click: () => setTab('colour') } }, h('i', { style: { background: hex || 'transparent' }, class: hex ? '' : 'none' })),
      sizes
        ? h('div.sizes', { role: 'group', 'aria-label': 'Brush size' }, [1, 2, 3].map(n => h('button.sz', { type: 'button', 'aria-pressed': String(S.size === n), 'data-hint': n + ' cell' + (n > 1 ? 's' : '') + ' wide', 'data-key': String(n), on: { click: () => setView({ size: n }) } }, h('i', { style: { width: 2 + n * 3 + 'px', height: 2 + n * 3 + 'px' } }))))
        : h('span.tnote', null, toolNote(l)),
    ),
  )
}
function toolNote(l) {
  if (S.tool === 'move') return l && isImage(l) ? 'Drag the art, pull a corner' : l && paintable(l) ? 'Drag to move the paint' : 'Select art or paint to move'
  if (S.tool === 'fill') return 'Fills one colour\'s area'
  if (S.tool === 'line') return 'Shift: level or 45°'
  if (S.tool === 'rect') return 'Shift: filled'
  if (S.tool === 'picker') return 'Click a colour in the scene'
  return ''
}

/* ---------- Layers ---------- */

const thumbsLater = debounce(() => {
  for (const c of $$('canvas.lt', listEl)) {
    const l = S.doc.layers.find(x => x.id === c.dataset.id)
    if (l) drawThumb(c, S.doc, l, S.mid)
  }
}, 60)

function drawList() {
  const doc = S.doc
  const rows = []
  for (let k = doc.layers.length - 1; k >= 0; k--) {
    const l = doc.layers[k]
    const hiddenNow = l.visible && !shownAt(l, S.mid)
    const row = h(
      'li.lrow',
      {
        'aria-selected': String(S.sel === l.id),
        'data-id': l.id,
        class: (l.visible ? '' : 'off ') + (hiddenNow ? 'away' : ''),
        draggable: 'true',
        on: {
          click: e => {
            if (e.target.closest('.eye, .more')) return
            select(l.id)
            if (isImage(l) && !['move', 'picker'].includes(S.tool)) setView({ tool: 'move' })
          },
          dblclick: e => !e.target.closest('.eye, .more') && rename(l, row),
          contextmenu: e => {
            e.preventDefault()
            select(l.id)
            rowMenu({ x: e.clientX, y: e.clientY }, l, row)
          },
        },
      },
      h('canvas.lt', { width: 64, height: 40, 'data-id': l.id }),
      h('div.lmeta', null, h('span.lname', null, l.name), h('span.lkind', null, subLine(l, hiddenNow))),
      h('button.eye', { type: 'button', 'aria-label': l.visible ? 'Hide ' + l.name : 'Show ' + l.name, 'data-hint': l.visible ? 'Hide this layer' : 'Show this layer', on: { click: () => A.toggleVisible(l.id) } }, icon(l.visible ? 'eye' : 'eyeOff')),
      h('button.more', { type: 'button', 'aria-label': 'More for ' + l.name, 'data-hint': 'Duplicate, rename, delete', on: { click: e => (select(l.id), rowMenu(e.currentTarget, l, row)) } }, icon('dots')),
    )
    dragRow(row, l)
    rows.push(row)
  }
  if (!rows.length) rows.push(h('li.lempty', null, h('p', null, 'No layers yet.'), h('p.dim', null, 'Add a sky, ridges or paint with +, or drop your own art anywhere.')))
  listEl.replaceChildren(...rows)
  thumbsLater()
}
function subLine(l, hiddenNow) {
  const bits = [isImage(l) ? KIND_LABEL.image : KIND_LABEL[l.kind]]
  if (l.motion && l.motion.type !== 'none') bits.push(l.motion.type)
  if (l.live?.length) bits.push(l.live.map(e => e.type).join(', '))
  if (l.frames?.length > 1) bits.push(l.frames.length + ' frames')
  if (hiddenNow) bits.push('not at this moment')
  return bits.join(' · ')
}
function rowMenu(anchor, l, row) {
  menu(anchor, [
    { label: 'Rename', run: () => rename(l, row) },
    { label: 'Duplicate', key: (isMac ? '⌘' : 'Ctrl+') + 'D', run: () => A.duplicateLayer(l.id) },
    isGen(l) || isImage(l) ? { label: 'Convert to paint layer', run: () => A.convertToPaint(l.id) } : null,
    'sep',
    { label: 'Move up', run: () => A.moveLayer(l.id, S.doc.layers.indexOf(l) + 1), disabled: S.doc.layers.at(-1) === l },
    { label: 'Move down', run: () => A.moveLayer(l.id, S.doc.layers.indexOf(l) - 1), disabled: S.doc.layers[0] === l },
    'sep',
    { label: 'Delete', key: 'Del', run: () => A.deleteLayer(l.id) },
  ], { place: anchor instanceof Element ? 'right' : 'below' })
}
export async function rename(l, row) {
  const anchor = row || $('.lrow[aria-selected="true"]', listEl) || listEl
  const r = await ask(anchor, { title: 'Rename layer', fields: [{ key: 'name', label: 'Name', value: l.name, max: 60, validate: v => (v ? '' : 'A layer needs a name.') }], ok: 'Rename', place: 'right' })
  if (r) A.renameLayer(l.id, r.name)
}

// Drag a row up or down the list; the line shows where it lands.
let dragId = null
function dragRow(row, l) {
  row.addEventListener('dragstart', e => {
    dragId = l.id
    row.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/x-layer', l.id)
  })
  row.addEventListener('dragend', () => {
    dragId = null
    row.classList.remove('dragging')
    for (const r of $$('.lrow', listEl)) r.classList.remove('above', 'below')
  })
  row.addEventListener('dragover', e => {
    if (!dragId || dragId === l.id) return
    e.preventDefault()
    const r = row.getBoundingClientRect()
    const above = e.clientY < r.top + r.height / 2
    row.classList.toggle('above', above)
    row.classList.toggle('below', !above)
  })
  row.addEventListener('dragleave', () => row.classList.remove('above', 'below'))
  row.addEventListener('drop', e => {
    if (!dragId) return
    e.preventDefault()
    e.stopPropagation()
    const r = row.getBoundingClientRect()
    const above = e.clientY < r.top + r.height / 2
    const list = S.doc.layers
    const from = list.findIndex(x => x.id === dragId)
    let to = list.indexOf(l) + (above ? 1 : 0)
    if (from < to) to--
    row.classList.remove('above', 'below')
    A.moveLayer(dragId, to)
  })
}

/* ---------- Your art ---------- */

function drawArt() {
  const assets = Object.entries(S.doc.assets || {})
  if (!assets.length) {
    artEl.replaceChildren(
      h('button.artdrop', { type: 'button', 'data-hint': 'Open pictures, sprites or GIFs. You can also drop them anywhere, or paste.', on: { click: () => emit({ openArt: true }) } },
        icon('upload'), h('span', null, 'Drop pictures, sprites or GIFs anywhere, or open them'),
      ),
      h('p.artline', null, ART_LINE),
    )
    return
  }
  const sel = getLayer()
  artEl.replaceChildren(
    h('div.assets', null, assets.map(([id, a]) => {
      const c = h('canvas', { width: 72, height: 54 })
      drawAsset(c, id)
      const used = assetUsers(id).length
      return h('button.asset', {
        type: 'button',
        'aria-label': a.name,
        'data-hint': a.name + (a.frames.length > 1 ? ', ' + a.frames.length + ' frames' : '') + '. Click to add it as a layer.',
        on: {
          click: () => addImageLayer(id).then(() => setTab('look')),
          contextmenu: e => {
            e.preventDefault()
            assetMenu({ x: e.clientX, y: e.clientY }, id, a, sel)
          },
        },
      }, c, used ? h('i.used', { 'aria-hidden': 'true' }) : null, a.frames.length > 1 ? h('b.frames', null, a.frames.length) : null)
    })),
    h('p.artline', null, 'Click to add as a layer. Right-click for more.'),
  )
}
function assetMenu(at, id, a, sel) {
  menu(at, [
    { head: a.name },
    { label: 'Add as a new layer', run: () => addImageLayer(id).then(() => setTab('look')) },
    sel && isImage(sel) && sel.asset !== id ? { label: 'Put in place of ' + sel.name, run: () => replaceAsset(sel.id, id) } : null,
    'sep',
    { label: 'Remove from the project', disabled: assetUsers(id).length > 0, run: () => (removeAsset(id) ? toast(a.name + ' removed.') : null) },
  ])
}
