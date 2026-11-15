// node render.mjs [moment ...] : draws out/snowfall-ridge-<moment>.svg the way the app's player
// draws it (an <img> of the source, GPU raster), every animation held at its start, into
// out/snowfall-ridge-<moment>.png at 1536 x 864.
// Env: T=seconds holds the motion at that time instead of the start; CROP="x,y,w,h" (cells)
// also writes a 4x close-up of that part; VW, VH change the size; SUFFIX names the files.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(dir).filter(d => d.startsWith('chromium-')).sort().pop()

const VW = Number(process.env.VW ?? 1536)
const VH = Number(process.env.VH ?? 864)
const T = Number(process.env.T ?? 0)
const SUFFIX = process.env.SUFFIX ?? ''
const moments = process.argv.slice(2).length ? process.argv.slice(2) : ['morning', 'day', 'night']

const browser = await chromium.launch({
  executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 })
for (const m of moments) {
  const file = path.join(ROOT, 'out', 'snowfall-ridge-' + m + '.svg')
  if (!fs.existsSync(file)) continue
  let src = fs.readFileSync(file, 'utf8')
  // Hold every animation: at its start, or T seconds in (a negative delay moves it on).
  src = src.replace('--m:0s', '--m:' + -T + 's').replace('</style>', '*{animation-play-state:paused!important}</style>')
  const crop = process.env.CROP?.split(',').map(Number)
  const png = await page.evaluate(
    async ([src, W, H, crop]) => {
      const root = new DOMParser().parseFromString(src, 'image/svg+xml').documentElement
      root.setAttribute('width', String(W))
      root.setAttribute('height', String(H))
      const img = new Image()
      img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
      await img.decode()
      await new Promise(r => setTimeout(r, 150))
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0, W, H)
      const out = [c.toDataURL('image/png')]
      if (crop) {
        // The scene's bottom-pinned cells: scale W/320, rows from the bottom.
        const s = Math.max(W / 320, H / 200)
        const oy = H - 200 * s
        const z = document.createElement('canvas')
        z.width = crop[2] * s * 2
        z.height = crop[3] * s * 2
        const zg = z.getContext('2d')
        zg.imageSmoothingEnabled = false
        zg.drawImage(c, crop[0] * s, crop[1] * s + oy, crop[2] * s, crop[3] * s, 0, 0, z.width, z.height)
        out.push(z.toDataURL('image/png'))
      }
      return out
    },
    [src, VW, VH, crop],
  )
  const outPath = path.join(ROOT, 'out', 'snowfall-ridge-' + m + SUFFIX + '.png')
  fs.writeFileSync(outPath, Buffer.from(png[0].split(',')[1], 'base64'))
  if (png[1]) fs.writeFileSync(path.join(ROOT, 'out', 'zoom-' + m + SUFFIX + '.png'), Buffer.from(png[1].split(',')[1], 'base64'))
  console.log('->', outPath)
}
await browser.close()
