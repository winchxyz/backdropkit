// node engine/purity.mjs <a.svg> [b.svg ...] : at whole-pixel cell sizes (6, 8, 9 px), counts
// pixels that differ from their cell's centre pixel by more than TOL (sum of RGB): soft or
// rounded cell corners show up here. Motion held at 0. Prints per file and size, and with
// MAP=1 the 20 worst cells (pB grid) for each.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const PW = import.meta.resolve('playwright-core')
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().pop()
const TOL = Number(process.env.TOL ?? 30)
const SIZES = (process.env.SIZES ?? '1920x1080@1,2560x1440@1,1440x900@2').split(',').map(s => s.match(/^(\d+)x(\d+)@([\d.]+)$/).slice(1).map(Number))
const browser = await chromium.launch({ executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'), args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
for (const file of process.argv.slice(2)) {
  let src = fs.readFileSync(file, 'utf8').replace('</style>', '*{animation-play-state:paused!important}</style>')
  if (process.env.T !== undefined) src = src.replace(/--m:[-\d.]*s/, '--m:' + -Number(process.env.T) + 's')
  for (const [W, H, dpr] of SIZES) {
    const res = await page.evaluate(async ([source, W, H, dpr, TOL, HIDEGRAD]) => {
      const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
      // HIDEGRAD=1: hide what is painted with a gradient (glows, mist, light), which varies inside a cell.
      if (HIDEGRAD) {
        const grads = new Set([...root.querySelectorAll('linearGradient,radialGradient')].map(g => g.id))
        for (const el of root.querySelectorAll('*')) {
          const m = ((el.getAttribute('fill') ?? '') + (el.getAttribute('stroke') ?? '')).match(/url\(#(\w+)\)/)
          if (m && grads.has(m[1])) el.setAttribute('display', 'none')
        }
      }
      root.setAttribute('width', String(W))
      root.setAttribute('height', String(H))
      const img = new Image()
      img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
      await img.decode()
      const cw = Math.round(W * dpr), ch = Math.round(H * dpr)
      const c = document.createElement('canvas')
      c.width = cw; c.height = ch
      const g = c.getContext('2d')
      g.fillStyle = '#000'; g.fillRect(0, 0, cw, ch)
      g.drawImage(img, 0, 0, cw, ch)
      const a = g.getImageData(0, 0, cw, ch).data
      const s = Math.max(W / 320, H / 200) * dpr
      const ox = (cw - 320 * s) / 2
      const oy = ch - 200 * s
      let n = 0
      const by = new Map()
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const cx = Math.floor((x - ox) / s), cy = Math.floor((y - oy) / s)
        const px = Math.floor(ox + (cx + 0.5) * s), py = Math.floor(oy + (cy + 0.5) * s)
        if (px < 0 || py < 0 || px >= cw || py >= ch) continue
        const i = (y * cw + x) * 4, j = (py * cw + px) * 4
        if (Math.abs(a[i] - a[j]) + Math.abs(a[i + 1] - a[j + 1]) + Math.abs(a[i + 2] - a[j + 2]) > TOL) {
          n++
          const k = cx + ',' + cy
          by.set(k, (by.get(k) ?? 0) + 1)
        }
      }
      return { n, cells: by.size, top: [...by].sort((p, q) => q[1] - p[1]).slice(0, 20) }
    }, [src, W, H, dpr, TOL, !!process.env.HIDEGRAD])
    console.log(path.basename(file).padEnd(34), (W + 'x' + H + '@' + dpr).padEnd(13), 'impure px', String(res.n).padStart(6), 'cells', String(res.cells).padStart(5), process.env.MAP ? res.top.map(([k, v]) => k + ':' + v).join(' ') : '')
  }
}
await browser.close()
