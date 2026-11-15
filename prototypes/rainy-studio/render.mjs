// node render.mjs [day evening night] : draws each moment the way the desktop app's player does
// (an <img> of the SVG source, real GPU), with every animation held at its start, into
// out/rainy-studio-<moment>.png at 1536 x 864.
// Env: T=seconds to hold the motion at that time instead of the start (moves the root's --m);
//      STILL=1 for the resting frame with no animation (the app's still frame, reduced motion);
//      CROP="x,y,w,h" (output pixels) and SCALE=n write an enlarged crop to OUT instead;
//      VW, VH change the picture size; OUT names the file to write.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().pop()

const VW = Number(process.env.VW ?? 1536)
const VH = Number(process.env.VH ?? 864)
const T = Number(process.env.T ?? 0)
const crop = process.env.CROP?.split(',').map(Number)
const scale = Number(process.env.SCALE ?? 1)
const moments = process.argv.slice(2).length ? process.argv.slice(2) : ['day', 'evening', 'night']

const browser = await chromium.launch({
  executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 })
for (const m of moments) {
  let src = fs.readFileSync(path.join(ROOT, 'out', 'rainy-studio-' + m + '.svg'), 'utf8')
  // STILL=1 draws the resting frame instead: what the app's still frame and reduced motion show.
  const hold = process.env.STILL ? '*{animation:none!important}' : '*{animation-play-state:paused!important}'
  src = src.replace('--m:0s', '--m:' + -T + 's').replace('</style>', hold + '</style>')
  const png = await page.evaluate(
    async ([src, W, H, crop, scale]) => {
      const root = new DOMParser().parseFromString(src, 'image/svg+xml').documentElement
      root.setAttribute('width', String(W))
      root.setAttribute('height', String(H))
      const img = new Image()
      img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
      await img.decode()
      await new Promise(r => setTimeout(r, 150))
      const full = document.createElement('canvas')
      full.width = W
      full.height = H
      full.getContext('2d').drawImage(img, 0, 0, W, H)
      if (!crop) return full.toDataURL('image/png')
      const [x, y, w, h] = crop
      const c = document.createElement('canvas')
      c.width = w * scale
      c.height = h * scale
      const g = c.getContext('2d')
      g.imageSmoothingEnabled = false
      g.drawImage(full, x, y, w, h, 0, 0, w * scale, h * scale)
      return c.toDataURL('image/png')
    },
    [src, VW, VH, crop ?? null, scale],
  )
  const out = process.env.OUT ? process.env.OUT.replace('%m', m) : path.join(ROOT, 'out', 'rainy-studio-' + m + '.png')
  fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'))
  console.log(m, '->', out)
}
await browser.close()
