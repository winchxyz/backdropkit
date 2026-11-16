// Nothing cut: the overflow check (overflow.mjs) on every screen of the editor, at the sizes
// people use, with real scrollbars (headless Chromium hides them by default, which hid the
// width they take). Screens: the start, the theme list, own art in every inspector tab, a
// generator in every tab, the many-colour palette of a site theme, the menus, popovers,
// search, the keyboard map, the export form, the day-and-night start, the phone sheets, and
// the guide. Prints each cut text; exits 1 if there is any.
// From the backdropkit folder, with the editor built and served (see e2e.mjs):
//   node editor/app/test/fit.mjs [WIDTHxHEIGHT@SCALE,...]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { photo, sprite } from './art.mjs'
import { checkOverflow, ALLOW } from './overflow.mjs'

const URL = process.env.EDITOR_URL || 'http://localhost:8765/editor/'
const OUT = process.env.OUT || path.join(os.tmpdir(), 'backdropkit-editor-e2e')
const SHOTS = path.join(OUT, 'fit')
const ART = path.join(OUT, 'art')
fs.mkdirSync(SHOTS, { recursive: true })
fs.mkdirSync(ART, { recursive: true })
const F = { day: path.join(ART, 'fit-day.png'), night: path.join(ART, 'fit-night.png'), sprite: path.join(ART, 'fit-sprite.png') }
fs.writeFileSync(F.day, photo(480, 300, { tone: 'day' }))
fs.writeFileSync(F.night, photo(480, 300, { tone: 'night' }))
fs.writeFileSync(F.sprite, sprite())

const SIZES = (process.argv[2] || '1536x864@1.25,1366x768@1,1280x720@1,1440x900@1,1920x1080@1,390x844@2')
  .split(',')
  .map(s => {
    const [, w, h, k] = s.match(/^(\d+)x(\d+)(?:@([\d.]+))?$/)
    return { w: +w, h: +h, k: +(k || 1), phone: +w < 600 }
  })

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
  // Real scrollbars, as people have them.
  return chromium.launch({ ...(executablePath ? { executablePath } : {}), ignoreDefaultArgs: ['--hide-scrollbars'] })
}

const b = await launch()
let cuts = 0
const report = []
for (const size of SIZES) {
  const tag = size.w + 'x' + size.h + '@' + size.k
  const ctx = await b.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.k, isMobile: size.phone, hasTouch: size.phone })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(e.message))
  const settle = (ms = 350) => p.waitForTimeout(ms)
  const check = async (screen, shot) => {
    await settle(250)
    const found = await p.evaluate(checkOverflow, { allow: ALLOW })
    if (shot || found.length) await p.screenshot({ path: path.join(SHOTS, tag + '-' + screen.replace(/[^a-z0-9]+/gi, '-') + '.png') })
    for (const f of found) report.push(tag + '  ' + screen + '  "' + f.text + '"  ' + f.axis + ' +' + f.over + 'px  in ' + f.where + '  (clipped by ' + f.clip + ')')
    cuts += found.length
    console.log((found.length ? 'CUT ' : 'ok  ') + tag + '  ' + screen + (found.length ? '  ' + found.length : ''))
  }
  const sheet = async side => {
    if (!size.phone) return
    const open = await p.evaluate(s => document.body.classList.contains('sheet-' + s), side)
    if (!open) await p.click('#toggle-' + (side === 'l' ? 'left' : 'right'))
    await settle(400)
  }
  const tabs = async (name, list = ['layer', 'look', 'colour', 'motion', 'effects']) => {
    await sheet('r')
    for (const t of list) {
      await p.click('#right .rt[data-tab="' + t + '"]')
      await settle(t === 'look' ? 900 : 300)
      await check(name + ' ' + t + ' tab', t === 'look' && tag.startsWith('1536'))
      // The rest of the panel, scrolled to the end.
      const tall = await p.evaluate(() => {
        const s = document.querySelector('#right .iscroll')
        if (!s || s.scrollHeight <= s.clientHeight + 4) return false
        s.scrollTop = s.scrollHeight
        return true
      })
      if (tall) await check(name + ' ' + t + ' tab, scrolled')
    }
  }
  const closeAll = async () => {
    await p.keyboard.press('Escape')
    await settle(150)
  }
  const menus = async () => {
    if (size.phone) return
    const names = await p.$$eval('#menus .mb-item', e => e.map(x => x.textContent.trim()))
    for (let i = 0; i < names.length; i++) {
      await p.click('#menus .mb-item >> nth=' + i)
      await check('menu ' + names[i])
      await closeAll()
    }
  }

  await p.goto(URL)
  await p.waitForSelector('.answer')
  await settle(800)
  await check('start', true)
  await p.click('.answer:has-text("One of the 14 themes")')
  await p.waitForSelector('.tcard img')
  await settle(800)
  await check('theme list')

  // A site theme: the palette with many colours.
  const [fcTheme] = await Promise.all([p.waitForSelector('.tcard'), Promise.resolve()])
  void fcTheme
  await p.click('.tcard:has-text("Sunfield")')
  await p.waitForFunction(() => document.querySelector('.lrow'), null, { timeout: 30000 })
  await settle(1500)
  await check('Sunfield, scene')
  await tabs('Sunfield', ['layer', 'colour'])
  await menus()

  // Own art.
  await p.evaluate(async () => (await import('./chat.js')).showStart({ back: false }))
  await p.waitForSelector('.answer')
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.answer:has-text("My own art")')])
  await fc.setFiles([F.day])
  await p.waitForFunction(() => document.querySelector('.lrow'), null, { timeout: 30000 })
  await settle(1500)
  await check('own art, scene')
  await tabs('own art')
  if (size.phone) await closeAll()
  await sheet('l')
  await check('own art, left panel')

  // Popovers and search.
  if (!size.phone) {
    await p.click('.status')
    await p.waitForSelector('.checks')
    await check('checks popover')
    await closeAll()
    await p.click('.dname')
    await check('moment menu')
    await closeAll()
    await p.click('.lrow .more')
    await check('layer menu')
    await closeAll()
  }
  await p.keyboard.press('?')
  await check('keyboard map', true)
  await closeAll()
  await p.keyboard.press('/')
  await p.keyboard.type('colour')
  await check('search')
  await closeAll()

  // A sprite, and a generator layer.
  await p.evaluate(async () => {
    const A = await import('./actions.js')
    A.addLayer('clouds')
  })
  await settle(800)
  await tabs('clouds', ['layer', 'motion', 'effects'])

  // The export form (not sent).
  await p.keyboard.press('Control+e')
  await p.waitForSelector('form.cardbox')
  await settle(500)
  await check('export form', true)

  // A blank scene.
  await p.evaluate(async () => (await import('./chat.js')).showStart({ back: true }))
  await p.click('.answer:has-text("A blank scene")')
  await p.waitForSelector('.tcard canvas')
  await settle(500)
  await check('blank, pick a moment')
  await p.click('.tcard >> nth=0')
  await settle(1200)
  await sheet('l')
  await check('blank, layers')
  await tabs('blank sun', ['layer', 'colour'])

  // Day and night: two pictures at the start.
  await p.evaluate(async () => (await import('./chat.js')).showStart({ back: true }))
  const [fc2] = await Promise.all([p.waitForEvent('filechooser'), p.click('.answer:has-text("My own art")')])
  await fc2.setFiles([F.day, F.night])
  const twoAsked = await p.waitForSelector('.vers', { timeout: 15000 }).then(() => true, () => false)
  if (twoAsked) {
    await settle(500)
    await check('day and night, the question', true)
  }

  // The guide.
  const g = await ctx.newPage()
  await g.goto(new globalThis.URL('guide.html', URL).href)
  await g.waitForTimeout(600)
  const gfound = await g.evaluate(checkOverflow, { allow: ALLOW })
  for (const f of gfound) report.push(tag + '  guide  "' + f.text + '"  ' + f.axis + ' +' + f.over + 'px  in ' + f.where)
  cuts += gfound.length
  console.log((gfound.length ? 'CUT ' : 'ok  ') + tag + '  guide' + (gfound.length ? '  ' + gfound.length : ''))
  if (tag.startsWith('1536') || size.phone) await g.screenshot({ path: path.join(SHOTS, tag + '-guide.png') })
  if (errs.length) console.log('page errors: ' + errs.join(' | '))
  await ctx.close()
}
await b.close()
console.log('\n' + (report.length ? report.join('\n') : 'nothing cut') + '\n' + cuts + ' cut texts')
process.exit(cuts ? 1 : 0)
