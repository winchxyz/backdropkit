// The BackdropKit editor: wiring. The scene fills the window behind a Claude Code window (a
// Mac menu bar, the title row, Layers at the left, the inspector at the right, the day in the
// composer at the bottom). This file starts it, keeps it saved, and holds the menus, the
// keyboard, drop and paste, and the "/" search.
import { S, on, emit, load, undo, redo, select, setView, layer as getLayer, goMoment, setMinute } from './state.js'
import * as A from './actions.js'
import { blankDoc, fromJSON, isImage, minuteIn, toJSON, validSlug } from './project.js'
import { V, fill, fit, zoomBy, draw, redrawAll, setMotionPreview, compare, setOnBlocked, viewTone, isTyping } from './canvas.js'
import { initLayers, addMenu, rename as renameLayerUI, TOOLS } from './layers.js'
import { initInspector, searchIndex, setTab } from './inspector.js'
import { initDay, playDayToggle } from './day.js'
import { showStart, endStart, openProject, pickFiles, runExport, saveProject, startWithArt, toggleChat } from './chat.js'
import { play, playStep } from './play.js'
import { ACCEPT, ART_LINE, addImageLayer, firstArt, importFiles, isArtFile, replaceAsset, setPlace, warmAll } from './assets.js'
import { loadFx } from './fxa.js'
import { lib } from './adapter.js'
import { loadLast, saveLast } from './store.js'
import { ask, busy, closePop, hideHint, menu, popOpen, popover, toast } from './ui.js'
import { $, $$, MOD, debounce, h, hhmm, icon, isMac, markHtml } from './util.js'

/* ---------- Start ---------- */

async function boot() {
  menubar()
  titlebar()
  initLayers()
  initInspector()
  initDay()
  setOnBlocked(block => toast(block.text, block.action ? { action: { convert: 'Convert', show: 'Show it', moment: 'Turn it on' }[block.action], run: () => unblock(block.action) } : {}))
  tick()
  setInterval(tick, 15000)
  loadFx()
  lib()
  const last = await loadLast()
  let doc = null
  if (last?.doc?.layers && last.doc.palette && last.doc.moments?.length) {
    try {
      // Through project.json and back: whatever an older editor kept comes in clean.
      doc = fromJSON(toJSON(last.doc))
    } catch {
      doc = null
    }
  }
  if (doc) {
    loadDoc(doc, { minute: last.view?.minute, sel: last.view?.sel })
    if (last.view?.tab) S.tab = last.view.tab
    document.body.classList.remove('starting')
    emit({ view: true })
  } else showStart()
  document.documentElement.classList.add('ready')
}

function loadDoc(doc, { minute, sel, mid } = {}) {
  setMotionPreview(false)
  const m = mid ? minuteIn(doc, mid) : minute ?? currentMinute()
  load(doc, { minute: m })
  if (sel && doc.layers.some(l => l.id === sel)) select(sel)
  warmAll(doc).then(() => redrawAll())
  requestAnimationFrame(() => (innerWidth > 860 ? fit() : fill()))
  saveSoon()
}
const currentMinute = () => {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}
function unblock(action) {
  const l = getLayer()
  if (!l) return
  if (action === 'convert') A.convertToPaint(l.id)
  if (action === 'show') A.toggleVisible(l.id)
  if (action === 'moment') A.setShow(l.id, S.mid, true)
}

on(what => {
  if (what.loadDoc) loadDoc(what.loadDoc, { mid: what.mid, minute: what.minute })
  if (what.setMeta) A.setMeta(what.setMeta)
  if (what.selectLayer) {
    select(what.selectLayer)
    setTab('layer')
  }
  if (what.openArt) openArt(what.replace)
  if (what.doc) saveSoon()
  if (what.doc || what.loaded) titleText()
  if (what.time || what.moment || what.loaded || what.doc) nowText()
  if (what.luma !== undefined && !document.body.classList.contains('starting')) tone(what.luma)
  if (what.view || what.tool) {
    $('#chat-btn').setAttribute('aria-pressed', String(!!S.chat))
    $('#play-btn').setAttribute('aria-pressed', String(!!S.play))
    draw()
  }
})
function tone(l) {
  document.documentElement.dataset.tone = l < 0.5 ? 'dark' : 'light'
}

/* ---------- Saving: quietly, in this browser ---------- */

const saveSoon = debounce(async () => {
  if (document.body.classList.contains('starting') && !S.doc.layers.length) return
  const ok = await saveLast(S.doc, { minute: S.minute, sel: S.sel, tab: S.tab })
  const el = $('#saved')
  el.textContent = ok ? 'Saved' : 'Not saved in this browser'
  el.classList.toggle('err', !ok)
  el.classList.add('show')
  clearTimeout(saveSoon.t)
  saveSoon.t = setTimeout(() => el.classList.remove('show'), 1800)
}, 900)

/* ---------- Menu bar and title row ---------- */

const MENUS = () => ({
  File: [
    { label: 'New…', run: () => showStart({ back: S.doc.layers.length > 0 }) },
    { label: 'Open project…', key: MOD + 'O', run: () => openProject() },
    { label: 'Add your art…', run: () => openArt() },
    'sep',
    { label: 'Save project', key: MOD + 'S', run: saveProject },
    { label: 'Export theme…', key: MOD + 'E', run: runExport },
  ],
  Edit: [
    { label: S.past.length ? 'Undo ' + S.past.at(-1).label.toLowerCase() : 'Undo', key: MOD + 'Z', disabled: !S.past.length, run: () => doUndo() },
    { label: S.future.length ? 'Redo ' + S.future.at(-1).label.toLowerCase() : 'Redo', key: (isMac ? '⇧⌘' : 'Ctrl+Shift+') + 'Z', disabled: !S.future.length, run: () => doRedo() },
    'sep',
    { label: 'Add layer…', run: () => addMenu($('#menus')) },
    { label: 'Duplicate layer', key: MOD + 'D', disabled: !S.sel, run: () => A.duplicateLayer() },
    { label: 'Rename layer…', disabled: !S.sel, run: () => getLayer() && renameLayerUI(getLayer()) },
    { label: 'Delete layer', key: 'Del', disabled: !S.sel, run: () => A.deleteLayer() },
    'sep',
    { label: 'Search settings', key: '/', run: openSearch },
  ],
  View: [
    { label: 'Fit in the window', key: 'F', run: fit },
    { label: 'Fill the window, as the app', key: '0', run: fill },
    { label: 'Zoom in', key: '+', run: () => zoomBy(1.25) },
    { label: 'Zoom out', key: '−', run: () => zoomBy(0.8) },
    { label: 'Cell grid when close', checked: V.grid, run: () => ((V.grid = !V.grid), draw()) },
    'sep',
    { label: 'Panels', key: 'Tab', checked: !document.body.classList.contains('nopanels'), run: togglePanels },
    { label: 'Show chat', key: 'C', checked: !!S.chat, run: () => toggleChat() },
    { label: 'Preview motion', key: 'M', checked: V.motion, run: () => setMotionPreview(!V.motion) },
    'sep',
    { label: 'Play the scene', key: 'P', run: () => play() },
    { label: 'Play the day', key: 'Shift+P', run: playDayToggle },
  ],
  Help: [
    { label: 'Keyboard shortcuts', key: '?', run: showKeys },
    { label: 'Why everything is cells', run: () => toast(ART_LINE + ' A scene may hold 131,072 characters.', { ms: 7000 }) },
    'sep',
    { label: 'BackdropKit themes', run: () => window.open('../', '_blank', 'noopener') },
  ],
})
function menubar() {
  const box = $('#menus')
  const app = h('button.mb-item.mb-app', { type: 'button', html: markHtml + '<span>BackdropKit</span>', on: { click: e => menu(e.currentTarget, [{ head: 'Theme editor, by winch-ai' }, { label: 'About the size limit', run: () => toast(ART_LINE + ' A scene may hold 131,072 characters.', { ms: 7000 }) }, { label: 'Keyboard shortcuts', key: '?', run: showKeys }]) } })
  const items = Object.keys(MENUS()).map(name => h('button.mb-item', { type: 'button', 'aria-haspopup': 'menu', on: {
    click: e => menu(e.currentTarget, MENUS()[name]),
    pointerenter: e => {
      // Moving along an open menu bar opens the next menu, as on a Mac.
      if (popOpen() && $$('.mb-item.open', box).length && !e.currentTarget.classList.contains('open')) menu(e.currentTarget, MENUS()[name])
    },
  } }, name))
  box.replaceChildren(app, ...items)
}
function tick() {
  const d = new Date()
  $('#clock').textContent = d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + hhmm(d.getHours() * 60 + d.getMinutes())
}
function nowText() {
  const m = S.doc.moments.find(x => x.id === S.mid)
  $('#now').textContent = m ? m.name + ' · ' + hhmm(S.minute) : ''
}
function titlebar() {
  $('#toggle-left').replaceChildren(icon('sidebar'))
  $('#toggle-right').replaceChildren(icon('panel'))
  $('#chat-btn').replaceChildren(icon('chat'), h('span', null, 'Show chat'))
  $('#play-btn').replaceChildren(icon('play'), h('span', null, 'Play'))
  $('#toggle-left').addEventListener('click', () => (innerWidth <= 860 ? sheet('l') : togglePanels()))
  $('#toggle-right').addEventListener('click', () => (innerWidth <= 860 ? sheet('r') : togglePanels()))
  $('#chat-btn').addEventListener('click', () => toggleChat())
  $('#play-btn').addEventListener('click', () => play())
  $('#title').append(icon('chevD'))
  $('#title').addEventListener('click', e => menu(e.currentTarget, [
    { label: 'Rename theme…', run: () => renameTheme() },
    { label: 'Save project', key: MOD + 'S', run: saveProject },
    { label: 'Export theme…', key: MOD + 'E', run: runExport },
    'sep',
    { label: 'New…', run: () => showStart({ back: S.doc.layers.length > 0 }) },
  ], { align: 'start' }))
}
function titleText() {
  $('#title-name').textContent = S.doc.name
  document.title = S.doc.name + ' · BackdropKit editor'
}
async function renameTheme() {
  const r = await ask($('#title'), {
    title: 'Theme',
    fields: [
      { key: 'name', label: 'Name', value: S.doc.name, max: 60, validate: v => (v ? '' : 'The theme needs a name.') },
      { key: 'slug', label: 'Folder name', value: S.doc.slug, max: 40, note: 'Small letters, numbers and dashes.', validate: v => (validSlug(v) ? '' : 'A letter first, then 2 to 40 small letters, numbers or dashes.') },
      { key: 'line', label: 'Line', value: S.doc.line, max: 200 },
    ],
    ok: 'Save',
  })
  if (r) A.setMeta(r)
}
function togglePanels() {
  document.body.classList.toggle('nopanels')
  requestAnimationFrame(() => (V.mode === 'fit' ? fit() : draw()))
}
function sheet(side) {
  const cls = 'sheet-' + side
  const was = document.body.classList.contains(cls)
  document.body.classList.remove('sheet-l', 'sheet-r')
  if (!was) document.body.classList.add(cls)
}

/* ---------- Your art in: open, drop, paste ---------- */

async function openArt(replaceId) {
  const files = await pickFiles(ACCEPT, !replaceId)
  if (files.length) artIn(files, { replaceId })
}
async function artIn(files, { replaceId } = {}) {
  const art = [...files].filter(isArtFile)
  const proj = [...files].find(f => /\.(json|zip)$/i.test(f.name))
  if (!art.length && proj) return openProject(proj)
  if (!art.length) return toast('That is not a picture this editor reads: PNG, JPEG, WebP or GIF.', { error: true })
  if (document.body.classList.contains('starting')) return startWithArt(art)
  const done = busy(art.length > 1 ? 'Reading ' + art.length + ' pictures' : 'Reading ' + art[0].name)
  try {
    const { ids, failed } = await importFiles(art)
    if (failed.length) toast(failed.join(', ') + ' could not be read.', { error: true })
    if (!ids.length) return
    if (replaceId) {
      await replaceAsset(replaceId, ids[0])
      return
    }
    if (ids.length === 1) {
      await addImageLayer(ids[0])
      setTab('look')
      if (firstArt()) toast(ART_LINE, { ms: 6500 })
    } else {
      document.body.classList.remove('nopanels')
      toast(ids.length + ' pieces of art are in Your art, at the left. Click one to add it as a layer.', { ms: 6500 })
    }
  } finally {
    done()
  }
}
let dragDepth = 0
const dropNote = h('div.dropnote', { hidden: true }, h('div', null, icon('upload'), h('b', null, 'Drop to add your art'), h('span', null, 'PNG, JPEG, WebP or GIF; a project.json or theme archive opens.')))
document.body.append(dropNote)
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files')
addEventListener('dragenter', e => {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth++
  dropNote.hidden = false
})
addEventListener('dragover', e => hasFiles(e) && e.preventDefault())
addEventListener('dragleave', e => {
  if (!hasFiles(e)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) dropNote.hidden = true
})
addEventListener('drop', e => {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth = 0
  dropNote.hidden = true
  artIn(e.dataTransfer.files)
})
addEventListener('paste', e => {
  if (isTyping(e)) return
  const files = [...(e.clipboardData?.files || [])]
  if (files.length) {
    e.preventDefault()
    artIn(files)
  }
})

/* ---------- Search: "/" finds every setting ---------- */

let searchEl = null
function openSearch() {
  closePop()
  if (searchEl) return searchEl.querySelector('input').focus()
  const input = h('input.sinput', { type: 'search', placeholder: 'Search every setting, layer and command', spellcheck: false, autocomplete: 'off', 'aria-label': 'Search' })
  const list = h('ul.sresults', { role: 'listbox' })
  let items = []
  let at = 0
  const all = () => [
    ...searchIndex(),
    ...S.doc.layers.slice().reverse().map(l => ({ label: l.name, where: 'Layer', run: () => (select(l.id), setTab('layer')) })),
    ...S.doc.moments.map(m => ({ label: m.name, where: 'Moment · from ' + hhmm(m.start * 60), run: () => goMoment(m.id) })),
    ...Object.entries(MENUS()).flatMap(([menuName, list]) => list.filter(x => x && x !== 'sep' && !x.head && !x.disabled).map(x => ({ label: x.label.replace(/…$/, ''), where: menuName, key: x.key, run: x.run }))),
    ...TOOLS.map(t => ({ label: t.label, where: 'Tool', key: t.key, help: t.help, run: () => setView({ tool: t.id }) })),
  ]
  const score = (it, q) => {
    const t = (it.label + ' ' + it.where).toLowerCase()
    if (!q) return 1
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    let s = 0
    for (const w of words) {
      const i = t.indexOf(w)
      if (i < 0) return 0
      s += i === 0 ? 3 : /\s/.test(t[i - 1]) ? 2 : 1
    }
    return s + (it.label.toLowerCase().startsWith(words[0]) ? 2 : 0)
  }
  const drawList = () => {
    const q = input.value.trim()
    items = all().map(it => ({ it, s: score(it, q) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 12).map(x => x.it)
    at = Math.min(at, Math.max(0, items.length - 1))
    list.replaceChildren(...(items.length ? items.map((it, i) => h('li.sr', { role: 'option', 'aria-selected': String(i === at), on: { pointerenter: () => ((at = i), mark()), click: () => pick(i) } }, h('span.sl', null, it.label), h('span.swh', null, it.where), it.key ? h('kbd', null, it.key) : null)) : [h('li.snone', null, 'Nothing by that name.')]))
  }
  const mark = () => $$('.sr', list).forEach((el, i) => el.setAttribute('aria-selected', String(i === at)))
  const pick = i => {
    const it = items[i]
    closeSearch()
    it?.run?.()
  }
  input.addEventListener('input', () => ((at = 0), drawList()))
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') (e.preventDefault(), (at = (at + 1) % Math.max(1, items.length)), mark())
    else if (e.key === 'ArrowUp') (e.preventDefault(), (at = (at - 1 + items.length) % Math.max(1, items.length)), mark())
    else if (e.key === 'Enter') (e.preventDefault(), pick(at))
    else if (e.key === 'Escape') (e.preventDefault(), closeSearch())
  })
  searchEl = h('div.search', { role: 'dialog', 'aria-label': 'Search' }, h('div.sbox', null, h('div.shead', null, icon('search'), input, h('kbd', null, 'Esc')), list))
  searchEl.addEventListener('pointerdown', e => e.target === searchEl && closeSearch())
  document.body.append(searchEl)
  drawList()
  input.focus()
}
function closeSearch() {
  searchEl?.remove()
  searchEl = null
}

/* ---------- Keyboard ---------- */

const KEYS = [
  ['Tools', [['V', 'Move: drag art or paint, pull a corner to size'], ['B', 'Pencil'], ['E', 'Eraser'], ['G', 'Fill'], ['L', 'Line'], ['R', 'Rectangle'], ['I', 'Pick colour (or hold Alt)'], ['1 2 3', 'Brush size']]],
  ['Edit', [[MOD + 'Z', 'Undo'], [(isMac ? '⇧⌘Z' : 'Ctrl+Y'), 'Redo'], [MOD + 'D', 'Duplicate layer'], ['Del', 'Delete layer'], ['Shift+H', 'Flip your art'], ['\\ (hold)', 'Compare with the original art'], ['/', 'Search every setting']]],
  ['View', [['F', 'Fit'], ['0', 'Fill, as the app'], ['+ −', 'Zoom'], ['Space (hold)', 'Pan'], ['Alt + scroll', 'Size your art'], ['Tab', 'Panels'], ['C', 'Show chat'], ['?', 'This map']]],
  ['Time', [['[ ]', 'Previous, next moment'], [', .', 'Previous, next frame'], ['M', 'Preview motion'], ['P', 'Play the scene'], ['Shift+P', 'Play the day']]],
  ['File', [[MOD + 'S', 'Save project'], [MOD + 'O', 'Open project'], [MOD + 'E', 'Export theme']]],
]
function showKeys() {
  const body = h('div.keys', null, h('h3', null, 'Keyboard'), h('div.kgrid', null, KEYS.map(([title, rows]) => h('section', null, h('h4', null, title), h('dl', null, rows.map(([k, t]) => [h('dt', null, h('kbd', null, k)), h('dd', null, t)]))))))
  popover({ x: innerWidth / 2, y: 84 }, body, { cls: 'pad keys-pop', align: 'center' })
}

const doUndo = () => {
  const l = undo()
  if (l) toast('Undid ' + l.toLowerCase() + '.', { ms: 1600 })
}
const doRedo = () => {
  const l = redo()
  if (l) toast('Redid ' + l.toLowerCase() + '.', { ms: 1600 })
}

let comparing = false
addEventListener('keydown', e => {
  const mod = isMac ? e.metaKey : e.ctrlKey
  const k = e.key
  if (k === 'Escape') {
    if (searchEl) return closeSearch()
    if (popOpen()) return closePop()
    if (S.play) return play(false)
    document.body.classList.remove('sheet-l', 'sheet-r')
    hideHint()
    return
  }
  if (isTyping(e)) return
  if (mod) {
    const lk = k.toLowerCase()
    if (lk === 'z') {
      e.preventDefault()
      return e.shiftKey ? doRedo() : doUndo()
    }
    if (lk === 'y') return (e.preventDefault(), doRedo())
    if (lk === 'd') return (e.preventDefault(), A.duplicateLayer())
    if (lk === 's') return (e.preventDefault(), saveProject())
    if (lk === 'o') return (e.preventDefault(), openProject())
    if (lk === 'e') return (e.preventDefault(), runExport())
    return
  }
  if (e.altKey) return
  if (document.body.classList.contains('starting')) return
  if (S.play) {
    if (k === 'ArrowLeft') playStep(-1)
    if (k === 'ArrowRight') playStep(1)
    if (k === 'p' || k === 'P') play(false)
    return
  }
  const tool = TOOLS.find(t => t.key.toLowerCase() === k.toLowerCase() && !e.shiftKey)
  if (tool) return setView({ tool: tool.id })
  switch (k) {
    case '1': case '2': case '3': return setView({ size: Number(k) })
    case 'f': case 'F': return fit()
    case '0': return fill()
    case '+': case '=': return zoomBy(1.25)
    case '-': case '_': return zoomBy(0.8)
    case 'm': case 'M': return setMotionPreview(!V.motion)
    case 'p': return play()
    case 'P': return playDayToggle()
    case 'c': case 'C': return toggleChat()
    case '/': return (e.preventDefault(), openSearch())
    case '?': return showKeys()
    case 'Tab': return (e.preventDefault(), togglePanels())
    case '[': return stepMoment(-1)
    case ']': return stepMoment(1)
    case ',': return stepFrame(-1)
    case '.': return stepFrame(1)
    case 'H': {
      const l = getLayer()
      if (l && isImage(l) && l.place) setPlace(l.id, { flipX: !l.place.flipX })
      return
    }
    case '\\':
      if (!comparing) {
        comparing = true
        compare(true)
      }
      return
    case 'Delete': case 'Backspace':
      if (S.sel) A.deleteLayer()
      return
  }
})
addEventListener('keyup', e => {
  if (e.key === '\\' && comparing) {
    comparing = false
    compare(false)
  }
})
function stepMoment(k) {
  const ms = S.doc.moments
  const i = ms.findIndex(m => m.id === S.mid)
  goMoment(ms[(i + k + ms.length) % ms.length].id)
}
function stepFrame(k) {
  const l = getLayer()
  const n = l?.frames?.length || 0
  if (n < 2) return toast('The selected layer has one frame.', { ms: 1600 })
  setView({ frame: (((S.frame + k) % n) + n) % n })
}

void blankDoc
void endStart
void setMinute
void viewTone
boot()
