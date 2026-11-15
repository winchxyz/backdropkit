// node seamwho.mjs <scene.svg> WxH@dpr : finds which elements cause the hairlines at one size.
// Counts line pixels (see seamscan.mjs), then hides each element that holds drawing (every
// child of a nested <svg>, a <g>, or the root, down to depth DEPTH) and reports the ones whose
// removal takes away the most line pixels.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = import.meta.resolve('playwright-core')
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().pop()
const [file, size] = process.argv.slice(2)
const [, W, H, dpr] = size.match(/^(\d+)x(\d+)@([\d.]+)$/).map(Number)
const DEPTH = Number(process.env.DEPTH ?? 3)
const browser = await chromium.launch({
  executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
let src = fs.readFileSync(file, 'utf8').replace('</style>', '*{animation-play-state:paused!important}</style>')
// T=37 holds the motion 37 s in, as seamscan.mjs does.
if (process.env.T !== undefined) src = src.replace(/--m:[-\d.]*s/, '--m:' + -Number(process.env.T) + 's')
const res = await page.evaluate(async ([source, W, H, dpr, DEPTH]) => {
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
  const root = doc.documentElement
  root.setAttribute('width', String(W))
  root.setAttribute('height', String(H))
  const cw = Math.round(W * dpr), ch = Math.round(H * dpr)
  const count = async () => {
    const img = new Image()
    img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
    await img.decode()
    const c = document.createElement('canvas')
    c.width = cw; c.height = ch
    const g = c.getContext('2d')
    g.fillStyle = '#000'; g.fillRect(0, 0, cw, ch)
    g.drawImage(img, 0, 0, cw, ch)
    const a = g.getImageData(0, 0, cw, ch).data
    const d3 = (i, j) => Math.abs(a[i] - a[j]) + Math.abs(a[i + 1] - a[j + 1]) + Math.abs(a[i + 2] - a[j + 2])
    let n = 0
    for (let y = 1; y < ch - 1; y++) for (let x = 1; x < cw - 1; x++) {
      const i = (y * cw + x) * 4
      const l = i - 4, r = i + 4, u = i - cw * 4, dn = i + cw * 4
      if ((d3(l, r) <= 10 && d3(i, l) > 24 && d3(i, r) > 24) || (d3(u, dn) <= 10 && d3(i, u) > 24 && d3(i, dn) > 24)) n++
    }
    return n
  }
  const base = await count()
  const units = []
  const visit = (el, depth, label) => {
    const kids = [...el.children].filter(k => !['style', 'defs', 'title'].includes(k.tagName))
    kids.forEach((k, i) => {
      const name = label + '/' + k.tagName + (k.getAttribute('class') ? '.' + k.getAttribute('class') : '') + '#' + i
      units.push([k, name])
      if (depth < DEPTH && (k.tagName === 'g' || k.tagName === 'svg')) visit(k, depth + 1, name)
    })
  }
  visit(root, 1, '')
  const out = []
  for (const [el, name] of units) {
    const prev = el.getAttribute('display')
    el.setAttribute('display', 'none')
    const n = await count()
    if (prev === null) el.removeAttribute('display'); else el.setAttribute('display', prev)
    out.push([name, base - n, (el.outerHTML.length / 1000).toFixed(1) + 'k', el.outerHTML.slice(0, 140)])
  }
  out.sort((a, b) => b[1] - a[1])
  return { base, top: out.slice(0, 15) }
}, [src, W, H, dpr, DEPTH])
console.log('line px', res.base)
for (const [n, d, sz, head] of res.top) console.log(String(d).padStart(6), sz.padStart(7), n, '\n         ', head)
await browser.close()
