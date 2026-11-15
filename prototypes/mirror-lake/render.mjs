// node render.mjs [moment ...] : draws out/mirror-lake-<moment>.svg the way the desktop app's
// player draws it (an <img> of the source, GPU raster) at 1536 x 864 with every animation held at
// its start, into out/mirror-lake-<moment>.png.
// Env:
//   T=seconds    hold the motion that far in instead (written to out/frames/<moment>-<t>.png);
//                T=3,6,9 writes several.
//   VW, VH, DPR  another window size or pixel ratio (written to out/frames/<moment>-<w>x<h>@<dpr>.png).
//   CROP=x,y,w,h a part of the picture in CSS px, scaled up ZOOM times (default 3), into out/frames.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().pop()

const VW = Number(process.env.VW ?? 1536)
const VH = Number(process.env.VH ?? 864)
const DPR = Number(process.env.DPR ?? 1)
const moments = process.argv.slice(2).length ? process.argv.slice(2) : ['day', 'sunset', 'night']
const times = (process.env.T ?? '').split(',').filter(Boolean).map(Number)
const crop = process.env.CROP?.split(',').map(Number) ?? null
const zoom = Number(process.env.ZOOM ?? 3)
const custom = VW !== 1536 || VH !== 864 || DPR !== 1

const browser = await chromium.launch({
  executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 })
for (const m of moments) {
  const src = fs.readFileSync(path.join(HERE, 'out', 'mirror-lake-' + m + '.svg'), 'utf8')
  for (const t of times.length ? times : [null]) {
    // Held: every animation paused, moved on by T seconds through the shared --m clock.
    const held = (t === null ? src : src.replace("style='--m:0s'", "style='--m:" + -t + "s'")).replace('</style>', '*{animation-play-state:paused!important}</style>')
    const png = await page.evaluate(
      async ([source, W, H, dpr, crop, zoom]) => {
        const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
        root.setAttribute('width', String(W))
        root.setAttribute('height', String(H))
        const img = new Image()
        img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
        await img.decode()
        await new Promise(r => setTimeout(r, 150))
        const full = document.createElement('canvas')
        full.width = Math.round(W * dpr)
        full.height = Math.round(H * dpr)
        full.getContext('2d').drawImage(img, 0, 0, full.width, full.height)
        if (!crop) return full.toDataURL('image/png')
        const [x, y, w, h] = crop
        const c = document.createElement('canvas')
        c.width = w * zoom
        c.height = h * zoom
        const g = c.getContext('2d')
        g.imageSmoothingEnabled = false
        g.drawImage(full, x * dpr, y * dpr, w * dpr, h * dpr, 0, 0, c.width, c.height)
        return c.toDataURL('image/png')
      },
      [held, VW, VH, DPR, crop, zoom],
    )
    let out = path.join(HERE, 'out', 'mirror-lake-' + m + '.png')
    if (t !== null || crop || custom) {
      fs.mkdirSync(path.join(HERE, 'out', 'frames'), { recursive: true })
      out = path.join(HERE, 'out', 'frames', m + (t !== null ? '-' + t : '') + (custom ? '-' + VW + 'x' + VH + '@' + DPR : '') + (crop ? '-crop' : '') + '.png')
    }
    fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'))
    console.log(out)
  }
}
await browser.close()
