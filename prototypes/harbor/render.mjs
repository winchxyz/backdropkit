// node render.mjs [day,sunset,night] : draws each moment the way the desktop app draws a
// backdrop (an <img> of the SVG, GPU raster) at 1536 x 864 with every motion held at its start,
// into out/harbor-<moment>.png.
// Env: T=seconds holds the motion that far in instead; SIZE=WxH; ZOOM=x0,y0,w,h (cells) with
// SCALE=px per cell draws only that crop; OUT=file writes there (one moment only).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(dir).filter(d => d.startsWith('chromium-')).sort().pop()

const names = (process.argv[2] ?? 'day,sunset,night').split(',')
const [VW, VH] = (process.env.SIZE ?? '1536x864').split('x').map(Number)
const T = Number(process.env.T ?? 0)
const zoom = process.env.ZOOM?.split(',').map(Number)
const scale = Number(process.env.SCALE ?? 8)

const browser = await chromium.launch({
  executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 })
for (const name of names) {
  let src = fs.readFileSync(path.join(HERE, 'out', 'harbor-' + name + '.svg'), 'utf8')
  // Hold every motion T seconds in: the scene counts its delays from --m.
  src = src.replace("--m:0s", '--m:' + -T + 's').replace('</style>', '*{animation-play-state:paused!important}</style>')
  // A crop renders the whole scene at SCALE px per cell (as wide as 320 cells) and cuts it.
  const W = zoom ? 320 * scale : VW
  const Hh = zoom ? 200 * scale : VH
  const png = await page.evaluate(
    async ([src, W, H, zoom, scale]) => {
      const root = new DOMParser().parseFromString(src, 'image/svg+xml').documentElement
      root.setAttribute('width', String(W))
      root.setAttribute('height', String(H))
      const img = new Image()
      img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
      await img.decode()
      await new Promise(r => setTimeout(r, 150))
      const c = document.createElement('canvas')
      if (zoom) {
        const [x0, y0, w, h] = zoom
        c.width = w * scale
        c.height = h * scale
        c.getContext('2d').drawImage(img, x0 * scale, y0 * scale, w * scale, h * scale, 0, 0, w * scale, h * scale)
      } else {
        c.width = W
        c.height = H
        c.getContext('2d').drawImage(img, 0, 0, W, H)
      }
      return c.toDataURL('image/png')
    },
    [src, W, Hh, zoom ?? null, scale],
  )
  const out = process.env.OUT ?? path.join(HERE, 'out', 'harbor-' + name + '.png')
  fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'))
  console.log(name, '->', out)
}
await browser.close()
