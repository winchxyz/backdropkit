// Play: the scene the app would play, full window. With the exporter on the page it is the
// real exported SVG of the moment on show (motion, frames and live effects as the player runs
// them); without it, the editor's own preview stands in and says so.
import { S, emit, goMoment, setView, on } from './state.js'
import { ready, sceneFor } from './adapter.js'
import { V, fill, fit, setMotionPreview } from './canvas.js'
import { toast } from './ui.js'
import { $, fmt, h, icon } from './util.js'
import { SCENE_LIMIT } from './project.js'

let url = null
let bar = null
let idle = 0
let before = null

export async function play(onOff = !S.play) {
  const img = $('#playing')
  if (!onOff) {
    setView({ play: false })
    document.body.classList.remove('playing', 'rest')
    img.hidden = true
    img.removeAttribute('src')
    if (url) URL.revokeObjectURL(url)
    url = null
    bar?.remove()
    bar = null
    if (before) {
      if (!before.motion) setMotionPreview(false)
      before.mode === 'fit' ? fit() : before.mode === 'fill' ? fill() : null
      before = null
    }
    return
  }
  before = { motion: V.motion, mode: V.mode }
  setView({ play: true })
  document.body.classList.add('playing')
  drawBar('Getting the scene')
  await show()
}

async function show() {
  const img = $('#playing')
  const m = S.doc.moments.find(x => x.id === S.mid)
  if (await ready()) {
    try {
      const r = await sceneFor(S.doc, S.mid)
      if (!S.play) return
      if (url) URL.revokeObjectURL(url)
      url = URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml' }))
      img.src = url
      img.hidden = false
      const over = r.chars > SCENE_LIMIT
      drawBar(m.name + ' · ' + fmt(r.chars) + ' characters' + (over ? ', too big for the app' : ''), over)
      return
    } catch (err) {
      if (err.superseded || !S.play) return
      toast('The scene could not be made: ' + err.message, { error: true })
    }
  }
  // The editor's preview, filling the window as the app does.
  img.hidden = true
  fill()
  if (!V.motion) setMotionPreview(true)
  drawBar(m.name + ' · the editor\'s preview (the exporter is not on this page yet)')
}

function drawBar(text, warn) {
  bar?.remove()
  const ms = S.doc.moments
  const i = ms.findIndex(x => x.id === S.mid)
  const go = k => {
    const next = ms[(i + k + ms.length) % ms.length]
    goMoment(next.id)
    drawBar('Getting the scene')
    show()
  }
  bar = h('div.playbar', { role: 'toolbar', 'aria-label': 'Playing' },
    ms.length > 1 ? h('button.ib', { type: 'button', 'aria-label': 'Previous moment', 'data-hint': 'Previous moment', 'data-key': '←', on: { click: () => go(-1) } }, icon('chevR', 'flipx')) : null,
    h('span.ptext', { class: warn ? 'warn' : '' }, text),
    ms.length > 1 ? h('button.ib', { type: 'button', 'aria-label': 'Next moment', 'data-hint': 'Next moment', 'data-key': '→', on: { click: () => go(1) } }, icon('chevR')) : null,
    h('button.btn', { type: 'button', 'data-hint': 'Back to editing', 'data-key': 'Esc', on: { click: () => play(false) } }, icon('stop'), h('span', null, 'Stop')),
  )
  bar.go = go
  document.body.append(bar)
  wake()
}
export const playStep = k => bar?.go?.(k)
// The bar rests out of sight while the pointer does.
function wake() {
  document.body.classList.remove('rest')
  clearTimeout(idle)
  idle = setTimeout(() => S.play && document.body.classList.add('rest'), 2200)
}
addEventListener('pointermove', () => S.play && wake())
on(what => {
  if (what.doc && S.play) show()
})
void emit
