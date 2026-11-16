// The dock at the bottom, shaped like the app's composer: the day as one 24-hour line split
// into its moments. Drag the line (or the knob) to any hour, drag a moment's start, add or
// rename moments, play the day. At the right: the checks, and Export.
import { S, on, emit, setMinute, goMoment } from './state.js'
import * as A from './actions.js'
import { SCENE_LIMIT, momentAt, shownAt, stretches, cellsAt } from './project.js'
import { checkAll, ready } from './adapter.js'
import { costOf } from './assets.js'
import { menu, popover, ask, toast } from './ui.js'
import { $, $$, debounce, fmt, h, hhmm, icon, clamp } from './util.js'
import { horizonOf, kindOf } from './color.js'

let root = null
let line = null
let status = null
export const CHECK = { state: 'idle', result: null, estimate: null, error: null, rev: -1 }

export function initDay() {
  root = $('#dock')
  draw()
  on(what => {
    if (what.hover || what.luma || what.zoom) return
    // A new document: the last check was of another one, so the status waits for its own.
    if (what.loaded) Object.assign(CHECK, { state: 'checking', result: null, estimate: null, error: null })
    if (what.doc || what.loaded) runChecks()
    if (what.time && !what.moment) return drawTime()
    if (holdDraw) return lightUpdate()
    if (what.checks || what.tab || what.slot || what.sel) return
    draw()
  })
}

function draw() {
  const m = S.doc.moments.find(x => x.id === S.mid)
  const playBtn = h('button.btn.dplay', { type: 'button', 'aria-pressed': String(!!playing), 'data-hint': playing ? 'Stop the day here' : 'Plays the whole day, an hour a second', 'data-key': 'Shift+P', on: { click: playDay } }, icon(playing ? 'pause' : 'play'), h('span', null, playing ? 'Stop' : 'Play the day'))
  status = h('button.status', { type: 'button', 'data-hint': 'What the app\'s player makes of this theme. Click for every moment.', on: { click: e => openChecks(e.currentTarget) } })
  drawStatus()
  line = h('div.dline', { 'aria-label': 'The day' })
  root.replaceChildren(
    h('div.dbox', null,
      h('div.dhead', null,
        h('span.dtime', { 'aria-live': 'off' }, hhmm(S.minute)),
        h('button.dname', { type: 'button', 'data-hint': 'This moment: rename or remove it', on: { click: e => momentMenu(e.currentTarget, m) } }, h('span', null, m?.name || ''), icon('chevD')),
        h('span.grow'),
        playBtn,
        status,
        h('button.btn.primary.dexport', { type: 'button', 'data-hint': 'Export the theme, ready to install', 'data-key': (navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+') + 'E', on: { click: () => emit({ export: true }) } }, icon('download'), h('span', null, 'Export')),
      ),
      line,
      h('div.dticks', null, ['00:00', '06:00', '12:00', '18:00', '24:00'].map(t => h('span', null, t)),
        S.doc.moments.length < 6 ? h('button.addm', { type: 'button', 'data-hint': 'Add a moment: the editor relights every colour for it', on: { click: () => {
          const id = A.addMoment()
          if (id) goMoment(id)
        } } }, '+ Moment') : null,
      ),
    ),
  )
  drawLine()
}

function drawLine() {
  const doc = S.doc
  const segs = h('div.dsegs')
  for (const s of stretches(doc)) {
    const m = doc.moments[s.i]
    const tint = horizonOf(kindOf(m), 'clear')
    segs.append(h('div.dseg', { class: m.id === S.mid ? 'on' : '', style: { left: (s.from / 1440) * 100 + '%', width: ((s.to - s.from) / 1440) * 100 + '%', '--tint': tint }, 'data-id': m.id }, h('span', null, m.name)))
  }
  const handles = doc.moments.length > 1
    ? doc.moments.map(m => {
      const el = h('button.dhandle', { type: 'button', style: { left: (m.start / 24) * 100 + '%' }, 'aria-label': m.name + ' starts at ' + hhmm(m.start * 60), 'data-hint': m.name + ' starts at ' + hhmm(m.start * 60) + '. Drag to move it.' })
      dragHandle(el, m)
      return el
    })
    : []
  const knob = h('div.dknob', { style: { left: (S.minute / 1440) * 100 + '%' } })
  line.replaceChildren(segs, ...handles, knob)
  // Drag anywhere on the line: the time follows.
  segs.addEventListener('pointerdown', e => {
    segs.setPointerCapture(e.pointerId)
    holdDraw = true
    const go = ev => setMinute(minuteAt(ev))
    go(e)
    const move = ev => go(ev)
    const up = () => {
      segs.removeEventListener('pointermove', move)
      segs.removeEventListener('pointerup', up)
      holdDraw = false
      draw()
    }
    segs.addEventListener('pointermove', move)
    segs.addEventListener('pointerup', up)
  })
  segs.addEventListener('dblclick', e => {
    const id = e.target.closest('.dseg')?.dataset.id
    const m = S.doc.moments.find(x => x.id === id)
    if (m) renameMoment(e.target.closest('.dseg'), m)
  })
}
const minuteAt = e => {
  const r = line.getBoundingClientRect()
  return Math.round(clamp((e.clientX - r.left) / r.width, 0, 0.9993) * 1440)
}
function dragHandle(el, m) {
  el.addEventListener('pointerdown', e => {
    e.stopPropagation()
    el.setPointerCapture(e.pointerId)
    el.classList.add('drag')
    const key = 'start:' + m.id + ':' + Date.now()
    holdDraw = true
    const move = ev => {
      const hour = minuteAt(ev) / 60
      A.setStart(m.id, hour, key)
      const now = S.doc.moments.find(x => x.id === m.id)
      if (now) {
        el.style.left = (now.start / 24) * 100 + '%'
        el.setAttribute('data-hint', now.name + ' starts at ' + hhmm(now.start * 60) + '. Drag to move it.')
        showStartTip(el, now)
      }
    }
    const up = () => {
      el.classList.remove('drag')
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      holdDraw = false
      tip?.remove()
      tip = null
      draw()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  })
}
let holdDraw = false
let tip = null
function lightUpdate() {
  drawTime()
  const m = S.doc.moments.find(x => x.id === S.mid)
  const n = $('.dname span', root)
  if (n && m) n.textContent = m.name
  for (const s of $$('.dseg', root)) s.classList.toggle('on', s.dataset.id === S.mid)
}
function showStartTip(el, m) {
  if (!tip) {
    tip = h('div.dtip')
    line.append(tip)
  }
  tip.textContent = m.name + ' ' + hhmm(m.start * 60)
  tip.style.left = el.style.left
}
function drawTime() {
  const t = $('.dtime', root)
  if (t) t.textContent = hhmm(S.minute)
  const k = $('.dknob', root)
  if (k) k.style.left = (S.minute / 1440) * 100 + '%'
}

function momentMenu(anchor, m) {
  if (!m) return
  menu(anchor, [
    { head: m.name + ' · from ' + hhmm(m.start * 60) },
    ...S.doc.moments.filter(x => x.id !== m.id).map(x => ({ label: 'Go to ' + x.name, run: () => goMoment(x.id) })),
    'sep',
    { label: 'Rename', run: () => renameMoment(anchor, m) },
    { label: 'Add a moment', disabled: S.doc.moments.length >= 6, run: () => {
      const id = A.addMoment()
      if (id) goMoment(id)
    } },
    { label: 'Remove ' + m.name, disabled: S.doc.moments.length <= 1, run: () => A.removeMoment(m.id) },
  ], { place: 'above' })
}
async function renameMoment(anchor, m) {
  const r = await ask(anchor, { title: 'Rename moment', fields: [{ key: 'name', label: 'Name', value: m.name, max: 40, validate: v => (v ? '' : 'A moment needs a name.') }], ok: 'Rename', place: 'above' })
  if (r) A.renameMoment(m.id, r.name)
}

/* ---------- Play the day ---------- */

let playing = 0
let last = 0
function playDay() {
  if (playing) {
    cancelAnimationFrame(playing)
    playing = 0
    draw()
    return
  }
  last = performance.now()
  const step = now => {
    const dt = (now - last) / 1000
    last = now
    setMinute(S.minute + dt * 60)
    playing = requestAnimationFrame(step)
  }
  playing = requestAnimationFrame(step)
  draw()
}
export const playDayToggle = playDay

/* ---------- Checks ---------- */

// After edits, the exporter encodes every moment (in a worker) and says what the app's player
// would make of it. While the exporter is not on the page, an estimate stands in.
const runChecks = debounce(async () => {
  // The start's empty document is not checked: its scene is made once the start is answered.
  if (document.body.classList.contains('starting')) return
  const rev = S.rev
  CHECK.rev = rev
  if (!(await ready())) {
    CHECK.estimate = estimate()
    CHECK.state = 'estimate'
    drawStatus()
    return
  }
  CHECK.state = 'checking'
  drawStatus()
  try {
    const r = await checkAll(S.doc)
    if (CHECK.rev !== rev) return
    CHECK.result = r
    CHECK.error = null
    CHECK.state = 'done'
  } catch (err) {
    if (CHECK.rev !== rev || err.superseded) return
    CHECK.state = err.missing ? 'estimate' : 'error'
    CHECK.error = err.message
  }
  drawStatus()
  emit({ checks: true })
}, 700)
export const checksNow = () => runChecks.now()

function estimate() {
  const doc = S.doc
  return doc.moments.map(m => {
    let chars = 900
    const layers = []
    for (const l of doc.layers) {
      if (!shownAt(l, m.id)) continue
      const c = costOf(cellsAt(l, m.id)) + (l.frames?.length > 1 ? costOf(l.frames[1]) * (l.frames.length - 1) : 0)
      chars += c + 60
      layers.push({ name: l.name, chars: c })
    }
    return { id: m.id, name: m.name, chars, layers }
  })
}
// Problems the export form settles (the line about the theme) stay out of the status.
const atExport = p => p.level !== 'error' && /no line about it/i.test(p.text || '')
function drawStatus() {
  if (!status) return
  const lim = fmt(SCENE_LIMIT)
  let text
  let cls = ''
  // While a new check runs, the last result stays on show, with the dots.
  if ((CHECK.state === 'done' || CHECK.state === 'checking') && CHECK.result) {
    const scenes = CHECK.result.scenes || []
    const max = Math.max(0, ...scenes.map(s => s.chars))
    const errs = (CHECK.result.problems || []).filter(p => p.level === 'error')
    const warns = (CHECK.result.problems || []).filter(p => p.level !== 'error' && !atExport(p))
    const over = max > SCENE_LIMIT
    cls = CHECK.state === 'checking' ? 'checking' : over || errs.length ? 'err' : warns.length ? 'warn' : 'ok'
    text = fmt(max) + ' of ' + lim + ' · ' + (over ? 'too big' : errs.length ? errs.length + ' to fix' : warns.length ? warns.length + ' to look at' : 'ok')
  } else if (CHECK.state === 'checking') {
    text = 'Checking'
    cls = 'checking'
  } else if (CHECK.state === 'error') {
    text = 'Check failed'
    cls = 'err'
  } else if (CHECK.estimate) {
    const max = Math.max(0, ...CHECK.estimate.map(s => s.chars))
    cls = max > SCENE_LIMIT ? 'warn' : 'est'
    text = 'About ' + fmt(max) + ' of ' + lim
  } else text = '—'
  status.className = 'status ' + cls
  status.replaceChildren(cls === 'checking' ? h('span.dots', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')) : h('i.sdot', { 'aria-hidden': 'true' }), h('span.mono', null, text))
}

function openChecks(anchor) {
  const doc = S.doc
  const body = h('div.checks')
  const lim = SCENE_LIMIT
  if (CHECK.state === 'checking' && !CHECK.result) {
    body.append(h('h3', null, 'Checking every moment'))
    body.append(h('p.note', null, 'The exporter is encoding each moment as the app\'s player will get it. This takes a moment.'))
  } else if ((CHECK.state === 'done' || CHECK.state === 'checking') && CHECK.result) {
    body.append(h('h3', null, 'What the app plays'))
    body.append(h('p.note', null, CHECK.state === 'checking' ? 'Checking your latest change. Below is the check before it.' : 'Each moment is one scene of at most ' + fmt(lim) + ' characters, the most the app\'s player accepts.'))
    for (const s of CHECK.result.scenes || []) {
      const m = doc.moments.find(x => x.id === s.id)
      body.append(meter(m?.name || s.id, s.chars, lim, () => goMoment(s.id)))
      // Where the characters go, as the exporter counted them.
      const top = (s.costs || []).filter(c => c.chars > 0).sort((a, b) => b.chars - a.chars).slice(0, 3)
      if (top.length) {
        body.append(h('p.layercost', null, top.map((c, i) => [
          i ? ' · ' : '',
          h('button.link', { type: 'button', 'data-hint': 'Select this layer', on: { click: () => emit({ selectLayer: c.layer }) } }, S.doc.layers.find(l => l.id === c.layer)?.name || c.name || 'Layer'),
          ' ' + fmt(c.chars),
        ])))
      }
    }
    const probs = (CHECK.result.problems || []).filter(p => !atExport(p))
    if (probs.length) {
      body.append(h('h4', null, 'To look at'))
      body.append(h('ul.probs', null, probs.map(p => h('li', { class: p.level === 'error' ? 'err' : 'warn' }, h('i.sdot'), h('span', null, p.text), p.layer ? h('button.link', { type: 'button', on: { click: () => emit({ selectLayer: p.layer }) } }, 'Show layer') : null))))
    } else body.append(h('p.okline', null, h('i.sdot'), 'Every moment plays as drawn.'))
    if ((CHECK.result.problems || []).some(atExport)) body.append(h('p.note', null, 'Export asks for a line about the theme.'))
  } else {
    body.append(h('h3', null, CHECK.state === 'error' ? 'The check stopped' : 'An estimate for now'))
    body.append(h('p.note', null, CHECK.state === 'error' ? CHECK.error || 'The exporter could not read this project.' : 'The exporter checks every moment against the app\'s player once it is on this page. Until then, this counts the cells roughly.'))
    for (const s of CHECK.estimate || estimate()) {
      body.append(meter(s.name, s.chars, lim, () => goMoment(s.id), true))
      const top = s.layers.slice().sort((a, b) => b.chars - a.chars).slice(0, 3)
      if (top.length) body.append(h('p.layercost', null, top.map(t => t.name + ' ' + fmt(t.chars)).join(' · ')))
    }
  }
  popover(anchor, body, { place: 'above', align: 'end', cls: 'pad wide' })
}
function meter(name, chars, lim, go, est) {
  const over = chars > lim
  return h('button.meter', { type: 'button', class: over ? 'err' : '', on: { click: go } },
    h('span.mname', null, name),
    h('span.mbar', null, h('i', { style: { width: Math.min(100, (chars / lim) * 100) + '%' } })),
    h('span.mono', null, (est ? '~' : '') + fmt(chars)),
  )
}
void momentAt
void toast
void $$
