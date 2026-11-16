// The editor end to end at 1440 x 900, then a phone at 390 x 844: every start, art in (PNG,
// sprite, GIF), looks and Make it fit, placing, effects, search, painting, generators, colours,
// moments, motion, Play, checks, export, save, reload, open. Prints one line per step and the
// console errors; screenshots and downloads go to $OUT (default: <tmp>/backdropkit-editor-e2e).
// Build the editor and serve docs/ first, from the backdropkit folder:
//   EDITOR_ONLY=1 node site/build.mjs && node site/serve.mjs
//   node editor/app/test/e2e.mjs [first word of the steps to run, comma separated]
// The steps build on each other (one project from start to export), so a subset needs the
// steps before it. EDITOR_URL changes where the editor is (default http://localhost:8765/editor/).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { unzip } from '../../lib/zip.js'
import { photo, sprite, gif } from './art.mjs'

const OUT = process.env.OUT || path.join(os.tmpdir(), 'backdropkit-editor-e2e')
const SHOTS = path.join(OUT, 'shots')
const ART = path.join(OUT, 'art')
fs.mkdirSync(SHOTS, { recursive: true })
fs.mkdirSync(ART, { recursive: true })
const shot = name => path.join(SHOTS, name + '.png')

async function launch() {
  const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
  const mod = await import(PW)
  const chromium = mod.chromium ?? mod.default.chromium
  const dir = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
  let executablePath
  if (process.env.LOCALAPPDATA && fs.existsSync(dir)) {
    const build = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().pop()
    const exe = build && path.join(dir, build, 'chrome-win64', 'chrome.exe')
    if (exe && fs.existsSync(exe)) executablePath = exe
  }
  return chromium.launch(executablePath ? { executablePath } : {})
}

const URL = process.env.EDITOR_URL || 'http://localhost:8765/editor/'
const F = {
  photo: path.join(ART, 'dusk-photo.png'),
  sprite: path.join(ART, 'lantern.png'),
  gif: path.join(ART, 'ball.gif'),
}
fs.writeFileSync(F.photo, photo())
fs.writeFileSync(F.sprite, sprite())
fs.writeFileSync(F.gif, gif())

const only = process.argv[2] ? new Set(process.argv[2].split(',')) : null
const results = []
async function step(name, fn) {
  if (only && !only.has(name.split(' ')[0])) return
  try {
    const r = await fn()
    results.push(['ok', name])
    console.log('ok   ' + name + (r !== undefined ? '  ' + JSON.stringify(r) : ''))
  } catch (e) {
    results.push(['FAIL', name])
    console.log('FAIL ' + name + '  ' + String(e.message).split('\n').filter(s => s.trim()).slice(0, 4).join(' | '))
  }
}
const assert = (c, msg) => {
  if (!c) throw new Error(msg)
}

const b = await launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const p = await ctx.newPage()
const errs = []
p.on('console', m => (m.type() === 'error' || m.type() === 'warning') && errs.push(m.type() + ': ' + m.text() + ' @ ' + (m.location()?.url || '')))
p.on('pageerror', e => errs.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')))
p.on('requestfailed', r => errs.push('requestfailed: ' + r.url()))
p.on('response', r => r.status() >= 400 && errs.push('http ' + r.status() + ': ' + r.url()))

const doc = () =>
  p.evaluate(async () => {
    const { S } = await import('./state.js')
    const nz = a => (a ? a.reduce((n, v) => n + (v ? 1 : 0), 0) : 0)
    return {
      layers: S.doc.layers.map(l => ({ id: l.id, name: l.name, kind: l.kind, frames: l.frames?.length || 1, place: l.place, look: l.look, live: l.live, motion: l.motion, cells: nz(l.cells) })),
      moments: S.doc.moments.map(m => ({ id: m.id, name: m.name, start: m.start })),
      palette: S.doc.palette.length,
      assets: Object.keys(S.doc.assets || {}),
      sel: S.sel,
      tool: S.tool,
      tab: S.tab,
      mid: S.mid,
      name: S.doc.name,
      slot: S.slot,
    }
  })
const sel = async () => {
  const d = await doc()
  return d.layers.find(l => l.id === d.sel)
}
const settle = (ms = 400) => p.waitForTimeout(ms)
async function waitChecks(ms = 20000) {
  await p.waitForFunction(() => {
    const s = document.querySelector('.status')
    return s && !s.classList.contains('checking') && !/Checking/i.test(s.textContent)
  }, null, { timeout: ms })
  return p.$eval('.status', e => e.textContent.trim())
}
async function menuBar(menu, item) {
  await p.click(`.mb-item:has-text("${menu}")`)
  await p.click(`.menu button:has-text("${item}")`)
}
async function choose(clickSel, file) {
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click(clickSel)])
  await fc.setFiles(file)
}
async function screenOf(cell) {
  return p.evaluate(async ([x, y]) => {
    const { V } = await import('./canvas.js')
    return { x: V.ox + x * V.zoom, y: V.oy + y * V.zoom, zoom: V.zoom }
  }, cell)
}
async function setRange(label, value) {
  const ok = await p.evaluate(
    ([label, value]) => {
      const el = [...document.querySelectorAll('#right .ctl.slider')].find(c => c.querySelector('label.cl')?.textContent === label)
      if (!el) return false
      const i = el.querySelector('input')
      i.value = value
      i.dispatchEvent(new Event('input', { bubbles: true }))
      i.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    },
    [label, value],
  )
  assert(ok, 'no slider ' + label)
}
async function tab(name) {
  await p.click(`.rt:has-text("${name}")`)
  await settle(250)
}

await p.goto(URL)
await p.waitForSelector('.answer', { timeout: 15000 })
await settle(1200)

await step('start shows four answers', async () => {
  const a = await p.$$eval('.answer b', els => els.map(e => e.textContent))
  assert(a.length === 4, 'answers: ' + a.join(' | '))
  await p.screenshot({ path: shot('01-start') })
  return a
})

await step('theme start', async () => {
  await p.click('.answer:has-text("One of the 14 themes")')
  await p.waitForSelector('.tcard')
  const n = await p.$$eval('.tcard', e => e.length)
  await settle(800)
  await p.screenshot({ path: shot('02-themes') })
  assert(n === 14, n + ' theme cards')
  await p.click('.tcard >> nth=2')
  await p.waitForSelector('.layers li', { timeout: 30000 })
  await settle(1500)
  const d = await doc()
  const status = await waitChecks()
  await p.screenshot({ path: shot('03-theme-editor') })
  return { name: d.name, layers: d.layers.length, moments: d.moments.length, palette: d.palette, status }
})

await step('new brings the start back', async () => {
  await menuBar('File', 'New')
  await p.waitForSelector('.answer')
  const a = await p.$$eval('.answer b', els => els.map(e => e.textContent))
  assert(a.length === 5 && /Back to/.test(a[4]), a.join(' | '))
  return a[4]
})

await step('own art start (PNG photo)', async () => {
  await choose('.answer:has-text("My own art")', F.photo)
  await p.waitForFunction(async () => {
    const { S } = await import('./state.js')
    return S.doc.layers.some(l => l.kind === 'image')
  }, null, { timeout: 20000 })
  await settle(2500)
  const d = await doc()
  const img = d.layers.find(l => l.kind === 'image')
  await p.screenshot({ path: shot('04-own-art-look') })
  assert(img.cells > 1000, 'image cells ' + img.cells)
  return { layers: d.layers.map(l => l.kind), tab: d.tab, assets: d.assets, cells: img.cells, status: await waitChecks() }
})

await step('look preset Night grain', async () => {
  if ((await doc()).tab !== 'look') await tab('Look')
  const names = await p.$$eval('.lk span', e => e.map(x => x.textContent))
  await p.click('.lk:has-text("Night grain")')
  await settle(900)
  const l = await sel()
  assert(l.look?.colors?.from === 'nightgrain', 'from ' + l.look?.colors?.from)
  const pressed = await p.$eval('.lk:has-text("Night grain")', e => e.getAttribute('aria-pressed'))
  await p.screenshot({ path: shot('05-preset-night-grain') })
  return { presets: names.length, pressed }
})

await step('undo and redo the preset', async () => {
  await p.keyboard.press('Control+z')
  await settle(500)
  const a = (await sel()).look?.colors?.from
  await p.keyboard.press('Control+y')
  await settle(500)
  const b2 = (await sel()).look?.colors?.from
  assert(a !== 'nightgrain' && b2 === 'nightgrain', a + ' -> ' + b2)
  return [a, b2]
})

await step('look sliders and selects', async () => {
  await setRange('Exposure', 0.5)
  await settle(600)
  const l = await sel()
  assert(Math.abs(l.look.picture.exposure - 0.5) < 1e-6, 'exposure ' + l.look.picture.exposure)
  const algos = await p.$$eval('#right .ctl:has(label.cl) select', s => s.map(x => x.options.length))
  const pat = p.locator('#right .ctl.inline', { has: p.locator('label.cl', { hasText: /^Pattern$/ }) }).locator('select')
  await pat.selectOption({ index: 5 })
  await settle(800)
  const l2 = await sel()
  const costText = await p.$eval('.costrow .mono', e => e.textContent)
  return { algo: l2.look.dither.algo, selects: algos, cost: costText }
})

await step('make it fit', async () => {
  const before = await sel()
  await p.evaluate(async id => {
    const { setLook } = await import('./assets.js')
    const { layer } = await import('./state.js')
    const L = layer(id).look
    await setLook(id, { ...L, colors: { ...L.colors, on: true, count: 64, from: 'art', clean: 0, merge: 0 }, dither: { ...L.dither, on: true, algo: 'floyd', amount: 1, where: 'all' }, picture: { ...L.picture, smooth: 0 } })
  }, before.id)
  await settle(1500)
  const heavy = await p.$eval('.costrow .mono', e => e.textContent)
  const fit = p.locator('#right button.btn', { hasText: 'Make it fit' })
  assert(await fit.count(), 'no Make it fit button at ' + heavy)
  await p.screenshot({ path: shot('05b-over') })
  await fit.click()
  const said = await (await p.waitForFunction(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).find(t => /Fits now|still over|as simple|could not/.test(t)), null, { timeout: 30000 })).jsonValue()
  await settle(800)
  const after = await p.$eval('.costrow .mono', e => e.textContent)
  await p.screenshot({ path: shot('05c-fitted') })
  const n = s => +s.replace(/[^\d]/g, ' ').trim().split(/\s+/)[0]
  assert(n(after) < n(heavy), heavy + ' -> ' + after)
  await p.keyboard.press('Control+z')
  await settle(1000)
  const undone = await p.$eval('.costrow .mono', e => e.textContent)
  // Back to the look before this step.
  await p.keyboard.press('Control+z')
  await settle(1000)
  return { heavy, after, undone, said }
})

await step('hold to compare', async () => {
  await p.mouse.move(700, 450)
  await p.keyboard.down('Backslash')
  await settle(300)
  await p.screenshot({ path: shot('06-compare') })
  await p.keyboard.up('Backslash')
})

await step('drop a sprite', async () => {
  const b64 = fs.readFileSync(F.sprite).toString('base64')
  await p.evaluate(b64 => {
    const bin = atob(b64)
    const u8 = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    const dt = new DataTransfer()
    dt.items.add(new File([u8], 'lantern.png', { type: 'image/png' }))
    for (const t of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, b64)
  await p.waitForFunction(async () => {
    const { S } = await import('./state.js')
    return S.doc.layers.filter(l => l.kind === 'image').length === 2
  }, null, { timeout: 15000 })
  await settle(1200)
  const d = await doc()
  const l = d.layers.find(x => x.id === d.sel)
  await p.screenshot({ path: shot('07-sprite-placed') })
  return { tool: d.tool, place: l.place, cells: l.cells, tab: d.tab }
})

await step('place: drag, Alt+wheel, flip', async () => {
  const l0 = await sel()
  const box = await p.evaluate(async () => {
    const { S } = await import('./state.js')
    const { boxOf } = await import('./assets.js')
    const { V } = await import('./canvas.js')
    const l = S.doc.layers.find(x => x.id === S.sel)
    const b = boxOf(l)
    return { x: V.ox + (b.x + b.w / 2) * V.zoom, y: V.oy + (b.y + b.h / 2) * V.zoom }
  })
  await p.mouse.move(box.x, box.y)
  await p.mouse.down()
  await p.mouse.move(box.x - 60, box.y - 30, { steps: 8 })
  await p.mouse.up()
  await settle(700)
  const l1 = await sel()
  assert(l1.place.x !== l0.place.x, 'x did not move ' + l0.place.x + ' ' + l1.place.x)
  await p.mouse.move(box.x - 60, box.y - 30)
  await p.keyboard.down('Alt')
  await p.mouse.wheel(0, -240)
  await p.keyboard.up('Alt')
  await settle(900)
  const l2 = await sel()
  assert(l2.place.scale !== l1.place.scale, 'scale ' + l1.place.scale + ' -> ' + l2.place.scale)
  await p.keyboard.press('Shift+H')
  await settle(700)
  const l3 = await sel()
  assert(!!l3.place.flipX !== !!l2.place.flipX, 'flip')
  await p.screenshot({ path: shot('08-placed-scaled-flipped') })
  return { from: l0.place, to: l3.place }
})

await step('GIF as frames', async () => {
  await choose('button[aria-label="Add art"]', F.gif)
  await p.waitForFunction(async () => {
    const { S } = await import('./state.js')
    return S.doc.layers.some(l => l.frames?.length > 1)
  }, null, { timeout: 20000 })
  await settle(1000)
  const d = await doc()
  const g = d.layers.find(l => l.frames > 1)
  await tab('Layer')
  const frameCard = await p.$('section.card:has(h3:text-is("Frames"))')
  await p.screenshot({ path: shot('09-gif-frames') })
  assert(frameCard, 'no frames card')
  return { frames: g.frames }
})

await step('light the art by the time of day', async () => {
  const photo = (await doc()).layers.find(l => l.name === 'dusk photo')
  await p.click(`.layers li:has(.lname:text-is("dusk photo"))`)
  await tab('Layer')
  const sw = p.locator('#right .ctl.inline', { has: p.locator('label.cl', { hasText: 'Light by the time of day' }) }).locator('.switch')
  await sw.click()
  await settle(1200)
  const r = await p.evaluate(async id => {
    const { S } = await import('./state.js')
    const l = S.doc.layers.find(x => x.id === id)
    const s = l.own[0]
    return { lit: !!l.lit, colors: S.doc.palette[s - 1].colors }
  }, photo.id)
  assert(r.lit && new Set(Object.values(r.colors)).size > 1, JSON.stringify(r))
  await sw.click()
  await settle(1200)
  const back = await p.evaluate(async id => {
    const { S } = await import('./state.js')
    const l = S.doc.layers.find(x => x.id === id)
    return new Set(Object.values(S.doc.palette[l.own[0] - 1].colors)).size
  }, photo.id)
  assert(back === 1, 'colours after off: ' + back)
  await p.click(`.layers li:has(.lname:text-is("ball"))`)
  return r.colors
})

await step('effects: pulse on', async () => {
  await tab('Effects')
  await p.click('section.card:has(h3:text-is("Pulse")) .switch')
  await settle(600)
  const l = await sel()
  assert((l.live || []).some(e => e.type === 'pulse'), JSON.stringify(l.live))
  await p.screenshot({ path: shot('10-effects') })
  return l.live
})

await step('search every setting', async () => {
  await p.mouse.click(720, 120)
  await p.keyboard.press('/')
  await p.waitForSelector('.sinput')
  await p.keyboard.type('dither')
  await settle(300)
  const rows = await p.$$eval('.sresults li', e => e.map(x => x.textContent.trim()).slice(0, 5))
  await p.screenshot({ path: shot('11-search') })
  await p.keyboard.press('Enter')
  await settle(600)
  const d = await doc()
  assert(d.tab === 'look', 'tab ' + d.tab)
  return rows
})

await step('paint: pencil, undo, redo', async () => {
  await p.click('button[aria-label="Add a layer"]')
  await p.click('.menu button:has-text("Paint")')
  await settle(500)
  const d0 = await doc()
  const pl = d0.layers.find(l => l.id === d0.sel)
  assert(pl.kind === 'paint', 'kind ' + pl.kind)
  if (!d0.slot) {
    await tab('Colour')
    await p.click('.swatches .sw >> nth=3')
  }
  await p.keyboard.press('b')
  const a = await screenOf([40, 40])
  const z = await screenOf([140, 60])
  await p.mouse.move(a.x, a.y)
  await p.mouse.down()
  await p.mouse.move(z.x, z.y, { steps: 20 })
  await p.mouse.up()
  await settle(300)
  const n1 = (await sel()).cells
  await p.keyboard.press('Control+z')
  await settle(300)
  const n0 = (await sel()).cells
  await p.keyboard.press('Control+y')
  await settle(300)
  const n2 = (await sel()).cells
  assert(n1 > 0 && n0 === 0 && n2 === n1, [n1, n0, n2].join(' '))
  return { painted: n1 }
})

await step('generators: all seven', async () => {
  const before = (await doc()).layers.length
  for (const label of ['Sky', 'Sun and moon', 'Stars', 'Clouds', 'Ridges and hills', 'Trees', 'Water']) {
    await p.click('button[aria-label="Add a layer"]')
    await p.click(`.menu button:has-text("${label}")`)
    await settle(500)
  }
  const d = await doc()
  await tab('Layer')
  await p.screenshot({ path: shot('12-generators') })
  assert(d.layers.length === before + 8, before + ' -> ' + d.layers.length)
  return d.layers.slice(0, 7).map(l => l.kind + ':' + l.cells)
})

await step('colour: merge similar, relight', async () => {
  await tab('Colour')
  const before = (await doc()).palette
  const merge = await p.$('button:has-text("Merge similar")')
  if (merge) await merge.click()
  await settle(800)
  const after = (await doc()).palette
  const photoSlots = await p.evaluate(async () => {
    const { S } = await import('./state.js')
    const l = S.doc.layers.find(x => x.name === 'dusk photo')
    return new Set(l.cells).size
  })
  assert(photoSlots > 4, 'the photo has ' + photoSlots + ' colours after the merge')
  await p.screenshot({ path: shot('13-colour') })
  return { before, after }
})

await step('moments: add, rename, drag, remove', async () => {
  const m0 = (await doc()).moments
  await p.click('.addm')
  await settle(600)
  const m1 = (await doc()).moments
  assert(m1.length === m0.length + 1, m0.length + ' -> ' + m1.length)
  await p.click('.dname', { timeout: 5000 })
  await p.click('.menu button:has-text("Rename")')
  await p.waitForSelector('.pop input.tinput')
  await p.fill('.pop input.tinput', 'Blue hour')
  await p.keyboard.press('Enter')
  await settle(400)
  const named = (await doc()).moments.some(m => m.name === 'Blue hour')
  const hs = await p.$$('.dhandle')
  const hb = await hs[1].boundingBox()
  await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await p.mouse.down()
  await p.mouse.move(hb.x + hb.width / 2 + 50, hb.y + hb.height / 2, { steps: 6 })
  await p.mouse.up()
  await settle(500)
  const m2 = (await doc()).moments
  await p.screenshot({ path: shot('14-moments') })
  await p.click('.dname')
  await p.click('.menu button:has-text("Remove")')
  await settle(600)
  const m3 = (await doc()).moments
  assert(named, 'rename')
  assert(m3.length === m1.length - 1, 'remove ' + m1.length + ' -> ' + m3.length)
  return { starts: m2.map(m => m.start), after: m3.map(m => m.name) }
})

await step('motion: drift on clouds, preview', async () => {
  const d = await doc()
  const c = d.layers.find(l => l.kind === 'clouds')
  await p.click(`.layers li:has(.lname:text-is("${c.name}"))`)
  await tab('Motion')
  await p.click('#right .sg:has-text("Drift")')
  await settle(400)
  await p.keyboard.press('m')
  await settle(1200)
  const l = await sel()
  await p.screenshot({ path: shot('15-motion') })
  await p.keyboard.press('m')
  assert(l.motion?.type === 'drift', JSON.stringify(l.motion))
  return l.motion
})

await step('play the exported scene', async () => {
  await p.click('#play-btn')
  await p.waitForFunction(() => {
    const i = document.querySelector('#playing')
    return i && !i.hidden && i.src && i.complete && i.naturalWidth > 0
  }, null, { timeout: 20000 })
  await settle(800)
  const bar = await p.$eval('.playbar .ptext', e => e.textContent)
  const colours = await p.evaluate(() => {
    const i = document.querySelector('#playing')
    const c = document.createElement('canvas')
    c.width = 320
    c.height = 200
    const x = c.getContext('2d')
    x.drawImage(i, 0, 0, 320, 200)
    const d = x.getImageData(0, 0, 320, 200).data
    const set = new Set()
    for (let k = 0; k < d.length; k += 4) set.add((d[k] << 16) | (d[k + 1] << 8) | d[k + 2])
    return set.size
  })
  assert(colours > 8, 'the played scene has ' + colours + ' colours')
  await p.screenshot({ path: shot('16-play') })
  await p.keyboard.press('Escape')
  await settle(300)
  const hidden = await p.$eval('#playing', e => e.hidden)
  assert(hidden, 'still playing')
  return bar
})

await step('checks popover', async () => {
  const status = await waitChecks(30000)
  await p.click('.status')
  await p.waitForSelector('.checks')
  const meters = await p.$$eval('.checks .meter', e => e.map(x => x.textContent))
  const layers = await p.$$eval('.checks .layercost', e => e.map(x => x.textContent))
  assert(await p.$$eval('.pop .checks', e => e.length), 'the popover closed')
  await settle(300)
  await p.screenshot({ path: shot('17-checks') })
  await p.keyboard.press('Escape')
  return { status, meters, layers: layers.slice(0, 2) }
})

let zipPath = null
let projPath = null
await step('export: zip and install prompt', async () => {
  await p.keyboard.press('Control+e')
  await p.waitForSelector('form.cardbox')
  const inputs = await p.$$('form.cardbox input.tinput')
  await inputs[0].fill('Lantern Dusk')
  await inputs[1].fill('lantern-dusk')
  await inputs[2].fill('A lantern over a dusk lake.')
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 90000 }), p.click('form.cardbox button[type=submit]')])
  zipPath = path.join(ART, dl.suggestedFilename())
  await dl.saveAs(zipPath)
  await p.waitForSelector('.prompt pre', { timeout: 20000 })
  await settle(500)
  const prompt = await p.$eval('.prompt pre', e => e.textContent)
  await p.screenshot({ path: shot('18-export-prompt') })
  const files = unzip(fs.readFileSync(zipPath), { inflate: b => zlib.inflateRawSync(b) }).map(e => e.name).filter(s => s.includes('/'))
  return { file: dl.suggestedFilename(), files, prompt: prompt.slice(0, 120) }
})

await step('save project', async () => {
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+s')])
  projPath = path.join(ART, dl.suggestedFilename())
  await dl.saveAs(projPath)
  const j = JSON.parse(fs.readFileSync(projPath, 'utf8'))
  return { file: dl.suggestedFilename(), layers: j.layers.length, assets: Object.keys(j.assets || {}).length, kb: Math.round(fs.statSync(projPath).size / 1024) }
})

await step('reload restores the project', async () => {
  const before = await doc()
  await p.reload()
  await p.waitForSelector('.layers li', { timeout: 20000 })
  await settle(1500)
  const after = await doc()
  assert(after.layers.length === before.layers.length, before.layers.length + ' -> ' + after.layers.length)
  assert(after.name === before.name, after.name)
  return { layers: after.layers.length, name: after.name }
})

await step('open a project file', async () => {
  await menuBar('File', 'New')
  await p.waitForSelector('.answer')
  await choose('.answer:has-text("Open a project")', projPath)
  await settle(2000)
  const d = await doc()
  return { layers: d.layers.length, name: d.name }
})

await step('open an exported zip', async () => {
  await menuBar('File', 'New')
  await p.waitForSelector('.answer')
  await choose('.answer:has-text("Open a project")', zipPath)
  await settle(2000)
  const d = await doc()
  return { layers: d.layers.length, name: d.name, assets: d.assets.length }
})

await step('blank start, night', async () => {
  await menuBar('File', 'New')
  await p.waitForSelector('.answer')
  await p.click('.answer:has-text("A blank scene")')
  await p.waitForSelector('.tcard')
  await settle(600)
  await p.screenshot({ path: shot('19-blank-pick') })
  const cards = await p.$$eval('.tcard', e => e.map(x => x.textContent.trim()))
  await p.click('.tcard >> nth=-1')
  await settle(1800)
  await p.screenshot({ path: shot('20-blank-night') })
  return cards
})

await step('keyboard map', async () => {
  await p.keyboard.press('?')
  await settle(400)
  await p.screenshot({ path: shot('21-keys') })
  await p.keyboard.press('Escape')
})

await step('wide 1920 x 1080', async () => {
  await p.setViewportSize({ width: 1920, height: 1080 })
  await settle(800)
  await p.screenshot({ path: shot('22-wide') })
})

const p2ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const m = await p2ctx.newPage()
m.on('pageerror', e => errs.push('phone pageerror: ' + e.message))
await step('phone: start and blank', async () => {
  await m.goto(URL)
  await m.waitForSelector('.answer')
  await m.waitForTimeout(800)
  await m.screenshot({ path: shot('23-phone-start') })
  await m.click('.answer:has-text("A blank scene")')
  await m.waitForSelector('.tcard')
  await m.click('.tcard >> nth=0')
  await m.waitForTimeout(1500)
  await m.screenshot({ path: shot('24-phone-editor') })
  const over = await m.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  assert(!over, 'page scrolls sideways')
})
await step('phone: sheets', async () => {
  await m.click('#toggle-left')
  await m.waitForTimeout(500)
  await m.screenshot({ path: shot('25-phone-layers') })
  await m.click('#toggle-right')
  await m.waitForTimeout(500)
  await m.screenshot({ path: shot('26-phone-inspector') })
})

console.log('\n' + results.filter(r => r[0] === 'ok').length + ' of ' + results.length + ' steps ok')
console.log(errs.length ? errs.join('\n') : 'no console errors')
await b.close()
