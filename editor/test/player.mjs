// node editor/test/player.mjs <scene.svg> : says whether the Claude desktop app would play the
// scene's motion, and how close it runs to the app's limits.
//
// A port of sunfield/tools/player-check.mjs (same page, same measure, same output) that reads
// the app's player code through app-player.mjs, which knows both the shape it had until
// 2026-11-14 and the one since 2026-11-15 (player-check.mjs stops with "the app's scene list
// code has changed shape" on the new one).
//
// The app moves a backdrop that is not one of Anthropic's own in an <img>. It does that only
// when every element and attribute of the source passes a fixed list and the source has CSS
// animation or SMIL. While it plays, every frame it draws the image onto a 64 x 40 canvas and
// runs its flash detector on it: it stops the motion for good when that takes more than a set
// time on average over three seconds, or when the detector trips.
//
// Environment: SIZE=WxH (1536x864) and DPR=n (1.25) change the window; SECONDS (9) how long
// it plays; PLAYWRIGHT_CORE the playwright-core index.mjs (default: resolved from here).
// As a module: check(svgText, opts) -> the report.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { findPlayer } from './app-player.mjs'

const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')

let browser
async function launch() {
  if (browser) return browser
  const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
  const dir = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
  let executablePath
  if (fs.existsSync(dir)) {
    const build = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().pop()
    const exe = build && path.join(dir, build, 'chrome-win64', 'chrome.exe')
    if (exe && fs.existsSync(exe)) executablePath = exe
  }
  // The app draws with the GPU; headless Chromium falls back to a software one unless told.
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
  })
  return browser
}

export async function close() {
  if (browser) await browser.close()
  browser = undefined
}

let app
export async function check(source, opts = {}) {
  app ??= findPlayer()
  const [W, H] = (opts.size ?? process.env.SIZE ?? '1536x864').split('x').map(Number)
  const DPR = Number(opts.dpr ?? process.env.DPR ?? 1.25)
  const SECONDS = Number(opts.seconds ?? process.env.SECONDS ?? 9)
  const b = await launch()
  const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR })
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'none'
  })
  await page.setContent('<!doctype html><body style="margin:0"><img id="i" style="position:absolute;inset:0;width:100%;height:100%;background:#fff"></body>')
  await page.addScriptTag({
    content: '(()=>{' + app.rules + ';window.__app={parse:' + app.parser + ',element:' + app.element + ',attr:' + app.attr + ',css:' + app.css + '}})();window.__app.counter=' + app.flash + ';',
  })
  const report = await page.evaluate(
    async ([source, LIMIT_MS, WINDOW_MS, SECONDS]) => {
      const A = window.__app
      const parsed = A.parse(source)
      if (parsed === null) {
        // Name the first things the list refuses.
        const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
        const why = []
        for (const e of doc.querySelectorAll('*')) {
          if (A.element(e)) continue
          const bad = Array.from(e.attributes).filter(t => !A.attr(e, t)).map(t => t.name + '=' + t.value.slice(0, 60))
          if (e.localName === 'style' && !A.css(e.textContent ?? '')) bad.push('its CSS')
          why.push('<' + e.localName + '> ' + (bad.length ? bad.join(', ') : 'is not an allowed element'))
          if (why.length >= 8) break
        }
        return { plays: false, why }
      }
      if (!parsed.isMoving) return { plays: false, why: ['it has no CSS animation or SMIL, so there is nothing to play'] }
      const img = document.getElementById('i')
      const w = img.clientWidth
      const h = img.clientHeight
      const root = new DOMParser().parseFromString(parsed.markup, 'image/svg+xml').documentElement
      root.setAttribute('width', String(w))
      root.setAttribute('height', String(h))
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
      await new Promise((ok, fail) => {
        img.onload = ok
        img.onerror = fail
        img.src = url
      })
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 40
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      const count = A.counter()
      const windows = []
      let start = NaN
      let sum = 0
      let n = 0
      let max = 0
      let parts = [0, 0, 0]
      let flashedAt = null
      const t0 = performance.now()
      await new Promise(done => {
        function frame() {
          const now = performance.now()
          ctx.fillStyle = '#fff'
          ctx.fillRect(0, 0, 64, 40)
          ctx.drawImage(img, 0, 0, 64, 40)
          const t1 = performance.now()
          const data = ctx.getImageData(0, 0, 64, 40).data
          const t2 = performance.now()
          const flashed = count.count(data, now, w, h, [])
          const t3 = performance.now()
          const cost = t3 - now
          parts = [parts[0] + t1 - now, parts[1] + t2 - t1, parts[2] + t3 - t2]
          if (flashed && flashedAt === null) flashedAt = (now - t0) / 1000
          if (Number.isNaN(start)) start = now
          sum += cost
          n++
          max = Math.max(max, cost)
          if (now - start >= WINDOW_MS) {
            windows.push({ averageMs: +(sum / n).toFixed(2), maxMs: +max.toFixed(1), frames: n, split: parts.map(x => +(x / n).toFixed(2)) })
            start = NaN
            sum = 0
            n = 0
            max = 0
            parts = [0, 0, 0]
          }
          if (now - t0 < SECONDS * 1000) requestAnimationFrame(frame)
          else done()
        }
        requestAnimationFrame(frame)
      })
      const slow = windows.findIndex(x => x.averageMs > LIMIT_MS)
      const why = []
      if (flashedAt !== null) why.push('the flash detector trips at ' + flashedAt.toFixed(1) + ' s')
      if (slow >= 0) why.push('drawing a frame takes ' + windows[slow].averageMs + ' ms on average over window ' + (slow + 1) + ', past the limit')
      return { plays: why.length === 0, why, windows, size: w + 'x' + h }
    },
    [source, app.limitMs, app.windowMs, SECONDS],
  )
  await page.close()
  const worst = report.windows?.length ? Math.max(...report.windows.map(w => w.averageMs)) : null
  return { ...report, worstAverageMs: worst, limitMs: app.limitMs, windowMs: app.windowMs, gpu, size: W + 'x' + H + '@' + DPR, app: app.url.split('/').pop(), shape: app.shape, made: app.made }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: node editor/test/player.mjs <scene.svg>')
    process.exit(2)
  }
  const source = fs.readFileSync(file, 'utf8')
  const r = await check(source)
  await close()
  console.log('app code: ' + r.app + ' (' + r.shape + '), cached ' + new Date(r.made).toISOString())
  console.log(path.basename(file) + ' (' + source.length + ' chars) at ' + r.size + 'x, GPU: ' + r.gpu)
  if (r.windows) {
    console.log('limit ' + r.limitMs.toFixed(2) + ' ms a frame on average over ' + r.windowMs / 1000 + ' s')
    for (const [i, x] of r.windows.entries()) {
      const [draw, read, detect] = x.split
      console.log('  window ' + (i + 1) + ': ' + x.averageMs + ' ms average (draw ' + draw + ', read ' + read + ', detector ' + detect + '), ' + x.maxMs + ' ms worst, ' + x.frames + ' frames')
    }
  }
  console.log(r.plays ? 'PLAYS: the app would run its motion' : 'STILL, because:')
  for (const w of r.why) console.log('  ' + w)
  process.exit(r.plays ? 0 : 1)
}
