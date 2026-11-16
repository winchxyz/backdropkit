// The chat column, as in the app: the start ("What do you want to start from?"), a sample
// conversation laid over the scene (Show chat), and Export as a short exchange with winch-ai.
import { S, emit, on, setView } from './state.js'
import { H, N, W, blankDoc, fromJSON, newLayer, toJSON, validSlug } from './project.js'
import { THEMES, momentsOf, sceneUrl, thumbUrl } from './themes.js'
import { pictureFromSvg, buildZip, promptFor, ready } from './adapter.js'
import { starterDoc } from './starter.js'
import { pictureCanvas } from './render.js'
import { ACCEPT, ART_LINE, addImageLayer, firstArt, importFiles, isArtFile, warmAll } from './assets.js'
import { readZip } from './zipread.js'
import { busy, toast } from './ui.js'
import { $, copyText, download, h, icon, markHtml, slugify } from './util.js'

const col = () => $('#chatcol')
const chat = () => $('#chat')
const who = () => h('div.who', { html: markHtml + '<span>winch-ai</span>' })
const user = text => h('div.msg.user', null, h('div', null, text))
const bot = (...kids) => h('div.msg.bot', null, who(), kids)
const p = (text, cls) => h('p' + (cls ? '.' + cls : ''), null, text)
const FOOT = 'Community project, not affiliated with Anthropic.'

let mode = null // 'start' | 'sample' | 'export'

/* ---------- The start ---------- */

export function showStart({ back = false } = {}) {
  mode = 'start'
  document.body.classList.add('starting')
  col().hidden = false
  backdrop()
  const answers = h('div.answers', null,
    answer('image', 'One of the 14 themes', 'Its picture comes in still; you add motion with layers on top.', () => pickTheme()),
    answer('upload', 'My own art', 'A picture to build on, or a set of sprites and GIFs.', () => ownArt()),
    answer('blank', 'A blank scene', 'A sky, a sun and moon, ridges and clouds to shape.', () => pickBlank()),
    answer('folder', 'Open a project', 'A project.json, or a theme archive made here.', () => openProject()),
    back ? answer('chevR', 'Back to ' + S.doc.name, 'Carry on where you were.', () => endStart()) : null,
  )
  chat().replaceChildren(
    user('I want to make my own theme.'),
    bot(p('Good. A theme is a pixel scene that plays behind the app, one picture for each moment of the day, with motion on top.'), p('What do you want to start from?'), answers),
    h('p.fine', null, FOOT),
  )
  chat().scrollTop = 0
}
function answer(ic, title, text, run) {
  return h('button.answer', { type: 'button', on: { click: run } }, h('span.ai', null, icon(ic)), h('span.at', null, h('b', null, title), h('span.d', null, text)), h('span.go', null, icon('chevR')))
}
function say(...msgs) {
  for (const m of msgs) chat().append(m)
  const last = chat().lastElementChild
  last?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}
// A real theme plays behind the start.
function backdrop() {
  const img = $('#backdrop')
  const list = THEMES.filter(t => t.moments.length > 1)
  const t = list[Math.floor(Math.random() * list.length)]
  const hr = new Date().getHours() + new Date().getMinutes() / 60
  const m = [...t.moments].reverse().find(x => x.start <= hr) || t.moments.at(-1)
  img.onload = () => img.classList.add('on')
  img.src = sceneUrl(t, m.id)
}
export function endStart() {
  document.body.classList.remove('starting')
  if (mode === 'start') {
    mode = null
    col().hidden = !S.chat
    if (S.chat) sample()
  }
}

function pickTheme() {
  const grid = h('div.thumbs', null, THEMES.map(t =>
    h('button.tcard', { type: 'button', on: { click: () => fromTheme(t) } },
      h('span.pic', null, h('img', { src: thumbUrl(t), alt: '', loading: 'lazy' })),
      h('b', null, t.name),
      h('span.d', null, t.moments.length > 1 ? t.moments.length + ' moments' : 'All day'),
    ),
  ))
  say(user('One of the 14 themes.'), bot(p('Pick one. Its picture comes in still, as a layer for each moment; motion comes from the layers you add on top.'), grid))
}
async function fromTheme(t) {
  const done = busy('Bringing in ' + t.name)
  try {
    const moments = (await momentsOf(t)).map((m, i) => ({ id: m.id || (t.moments.length === 1 ? 'all-day' : 'm' + (i + 1)), name: m.name, start: m.start }))
    const doc = blankDoc()
    doc.name = t.name + ' remix'
    doc.slug = slugify(t.name + ' remix')
    doc.moments = moments
    const l = newLayer(doc, 'picture', t.name)
    l.byMoment = {}
    // Each moment's colours get slots of their own (at most 1024 in all).
    const per = Math.max(16, Math.floor(1024 / moments.length))
    for (const m of moments) {
      const r = await fetch(sceneUrl(t, t.moments.length === 1 ? '' : m.id))
      if (!r.ok) throw new Error('The ' + m.name.toLowerCase() + ' scene of ' + t.name + ' did not load.')
      const pic = await pictureFromSvg(await r.text(), { maxColors: per })
      const base = doc.palette.length
      for (const c of pic.colors) doc.palette.push({ id: 'c' + (doc.palette.length + 1), colors: Object.fromEntries(moments.map(x => [x.id, c])) })
      const cells = new Uint16Array(N)
      for (let i = 0; i < N; i++) cells[i] = pic.cells[i] ? base + pic.cells[i] : 0
      l.byMoment[m.id] = cells
    }
    l.cells = l.byMoment[moments[0].id]
    doc.layers.push(l)
    emit({ loadDoc: doc })
    endStart()
    toast(t.name + ' is in, held still. Add layers on top to bring it to life.', { ms: 6000 })
  } catch (err) {
    toast(err.message || 'That theme did not load.', { error: true })
  } finally {
    done()
  }
}

async function ownArt() {
  const files = await pickFiles(ACCEPT, true)
  if (!files.length) return
  say(user('My own art.'))
  await startWithArt(files)
}
// Art as the start: the largest picture becomes the scene, the rest stand on it.
export async function startWithArt(files) {
  const done = busy('Reading your art')
  try {
    const doc = blankDoc()
    doc.name = 'My theme'
    emit({ loadDoc: doc })
    const { ids, failed } = await importFiles(files)
    if (!ids.length) throw new Error(failed.length ? 'Those files could not be read as pictures.' : 'No pictures in that.')
    const assets = S.doc.assets
    const order = ids.slice().sort((a, b) => assets[b].w * assets[b].h - assets[a].w * assets[a].h)
    for (const id of order) await addImageLayer(id)
    endStart()
    setView({ tab: 'look', tool: 'move' })
    if (firstArt()) toast(ART_LINE, { ms: 7000 })
    if (failed.length) toast(failed.join(', ') + ' could not be read.', { error: true })
  } catch (err) {
    toast(err.message, { error: true })
  } finally {
    done()
  }
}

function pickBlank() {
  const doc = starterDoc()
  const cards = doc.moments.map(m => {
    const c = pictureCanvas(doc, m.id, 1)
    c.className = 'preview'
    return h('button.tcard', { type: 'button', on: { click: () => {
      emit({ loadDoc: doc, mid: m.id })
      endStart()
      toast('A blank scene: every layer is a generator. Change it in the inspector, or turn a layer into paint.', { ms: 6000 })
    } } }, h('span.pic', null, c), h('b', null, m.name), h('span.d', null, 'Start here'))
  })
  say(user('A blank scene.'), bot(p('Here is a quiet valley to shape: a sky, a sun and moon, far mountains, hills, pines and clouds, each one a layer you can change. Which moment do you want to start in?'), h('div.thumbs.three', null, cards)))
}

export async function openProject(file) {
  file = file || (await pickFiles('.json,.zip,application/json,application/zip', false))[0]
  if (!file) return
  const done = busy('Opening ' + file.name)
  try {
    let obj
    if (/\.zip$/i.test(file.name) || file.type.includes('zip')) {
      const files = await readZip(await file.arrayBuffer())
      const pj = Object.entries(files).find(([n]) => /(^|\/)project\.json$/.test(n))
      if (!pj) throw new Error('That archive has no project.json: it was not made by this editor.')
      obj = JSON.parse(new TextDecoder().decode(pj[1]))
    } else obj = JSON.parse(await file.text())
    const doc = fromJSON(obj)
    emit({ loadDoc: doc })
    endStart()
    toast(doc.name + ' is open.')
  } catch (err) {
    toast(err instanceof SyntaxError ? 'That file is not a project.' : err.message, { error: true })
  } finally {
    done()
  }
}
export function pickFiles(accept, multiple) {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept, multiple, style: 'position:fixed;left:-99px;opacity:0' })
    let settled = false
    input.addEventListener('change', () => {
      settled = true
      resolve([...input.files])
      input.remove()
    })
    addEventListener('focus', () => setTimeout(() => {
      if (!settled) {
        resolve([])
        input.remove()
      }
    }, 900), { once: true })
    document.body.append(input)
    input.click()
  })
}

/* ---------- Show chat: a conversation over the scene ---------- */

export function toggleChat(on = !S.chat) {
  setView({ chat: on })
  if (document.body.classList.contains('starting')) return
  if (mode === 'export' && !on) mode = null
  col().hidden = !on
  if (on && mode !== 'export') sample()
}
function sample() {
  mode = 'sample'
  chat().replaceChildren(
    user('The login page logs people out after a minute. Can you find out why?'),
    bot(
      p('The session cookie is set with a max age of 60 seconds in the auth middleware, and the refresh call never runs because its timer is cleared on the first render.'),
      h('div.tool', null, icon('chevR'), h('span', null, 'Read 3 files')),
      h('pre.code', null, 'res.cookie("session", token, {\n  httpOnly: true,\n  maxAge: 60 * 60 * 1000, // an hour, not a minute\n})'),
      p('With that fixed, the refresh keeps it alive while the tab is open. Want me to add a test for it?'),
    ),
    user('Yes, please.'),
    bot(h('ul.tasks', null, task('Write the session test', true), task('Run the auth tests', true), task('Tidy the middleware', false))),
  )
}
const task = (text, done) => h('li', null, h('span.dot', { class: done ? 'done' : 'todo' }, done ? icon('check') : null), h('span', null, text))

/* ---------- Export ---------- */

export async function runExport() {
  mode = 'export'
  setView({ chat: true })
  document.body.classList.remove('starting')
  col().hidden = false
  const d = S.doc
  const name = h('input.tinput', { value: d.name, maxlength: 60, spellcheck: false })
  const slug = h('input.tinput.mono', { value: d.slug, maxlength: 40, spellcheck: false })
  const line = h('input.tinput', { value: d.line || '', maxlength: 200, placeholder: 'One line about it, for the theme list', spellcheck: false })
  const err = h('div.err-text', { hidden: true })
  let slugTouched = d.slug !== slugify(d.name)
  name.addEventListener('input', () => !slugTouched && (slug.value = slugify(name.value)))
  slug.addEventListener('input', () => (slugTouched = true))
  const go = h('button.btn.primary', { type: 'submit' }, icon('download'), h('span', null, 'Export'))
  const form = h('form.cardbox', { on: { submit: e => (e.preventDefault(), start()) } },
    h('label.tlabel', null, 'Name', name),
    h('label.tlabel', null, 'Folder name', slug, h('span.note', null, 'Small letters, numbers and dashes. The theme installs under it.')),
    h('label.tlabel', null, 'Line', line),
    err,
    h('div.row.end', null, h('button.btn', { type: 'button', on: { click: () => toggleChat(false) } }, 'Not now'), go),
  )
  chat().replaceChildren(user('Export my theme.'), bot(p('Here is what it will be called. The archive holds every moment\'s scene, the theme mod and this project, so you can open it here again.'), form))
  name.focus()

  async function start() {
    const v = { name: name.value.trim(), slug: slug.value.trim(), line: line.value.trim() }
    if (!v.name) return fail('The theme needs a name.')
    if (!validSlug(v.slug)) return fail('The folder name starts with a letter, then 2 to 40 small letters, numbers or dashes.')
    err.hidden = true
    emit({ setMeta: v })
    form.querySelectorAll('input, button').forEach(x => (x.disabled = true))
    if (!(await ready())) {
      say(bot(p('The exporter is not on this page yet, so the archive cannot be made right now. Your project is kept in this browser, and you can save it as a file to export later.'), h('div.row', null, saveBtn())))
      return
    }
    const steps = ['Encoding every moment', 'Measuring the light of each moment', 'Taking the preview', 'Packing the archive']
    const list = h('ul.tasks', null, steps.map(s => task(s, false)))
    say(bot(list))
    const mark = upto => [...list.children].forEach((li, i) => {
      const dot = li.querySelector('.dot')
      const done = i < upto
      dot.className = 'dot ' + (done ? 'done' : 'todo')
      dot.replaceChildren(...(done ? [icon('check')] : []))
    })
    try {
      const r = await buildZip(S.doc, step => mark(steps.indexOf(step)))
      mark(steps.length)
      const file = S.doc.slug + '.zip'
      download(file, new Blob([r.bytes], { type: 'application/zip' }))
      const prompt = r.prompt || (await promptFor(S.doc))
      // Shown reflowed (wrapped lines rejoined, numbered steps with a hanging indent); Copy
      // gives the exporter's text unchanged.
      const pre = h('pre', null, prompt.replace(/\n[ \t]{2,}/g, ' ').split('\n').map(t => h('span' + (/^\d+\.\s/.test(t) ? '.hang' : ''), null, t || ' ')))
      const copy = h('button.btn', { type: 'button', on: { click: async () => {
        const ok = await copyText(prompt)
        copy.querySelector('span').textContent = ok ? 'Copied' : 'Select and copy'
        setTimeout(() => (copy.querySelector('span').textContent = 'Copy'), 1800)
      } } }, icon('copy'), h('span', null, 'Copy'))
      say(bot(
        p(file + ' is in your downloads. To install it, give this to Claude Code in the app, with the archive next to it:'),
        h('div.prompt', null, h('div.prompt-head', null, h('span', null, 'Install prompt'), copy), pre),
        h('div.row', null, saveBtn()),
      ))
    } catch (e) {
      say(bot(p(e.missing ? 'The exporter is not on this page yet.' : 'The export stopped: ' + e.message), h('div.row', null, saveBtn())))
    }
  }
  function fail(t) {
    err.textContent = t
    err.hidden = false
  }
}
export function saveProject() {
  const json = JSON.stringify(toJSON(S.doc))
  download((S.doc.slug || 'theme') + '.project.json', json, 'application/json')
  toast('Saved ' + (S.doc.slug || 'theme') + '.project.json to your downloads.')
}
const saveBtn = () => h('button.btn', { type: 'button', on: { click: saveProject } }, icon('download'), h('span', null, 'Save project'))

on(what => {
  if (what.export) runExport()
})
void W
void H
void isArtFile
void warmAll
