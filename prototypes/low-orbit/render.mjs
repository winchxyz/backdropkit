// node render.mjs [a|b ...] : draws out/low-orbit-<a|b>.svg the way the desktop app draws a
// moving backdrop (an <img> of the source, GPU on), at 1536 x 864, with every animation held at
// its start, into out/low-orbit-<a|b>.png.
// Env: VW, VH (CSS px), DPR, AT (seconds into the motion instead of the start), ZOOM="x,y,w,h"
// (cells) for an extra crop at 6 px per cell into out/zoom-<a|b>.png.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(dir).filter(d => d.startsWith('chromium-')).sort().pop()

const VW = Number(process.env.VW ?? 1536)
const VH = Number(process.env.VH ?? 864)
const DPR = Number(process.env.DPR ?? 1)
const AT = Number(process.env.AT ?? 0)
const which = process.argv.slice(2).length ? process.argv.slice(2) : ['a', 'b']

const browser = await chromium.launch({
  executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 })
for (const w of which) {
  const svgPath = path.join(HERE, 'out', 'low-orbit-' + w + '.svg')
  let src = fs.readFileSync(svgPath, 'utf8')
  // Held at the start, or AT seconds in: every delay moved back by AT, then paused.
  src = AT
    ? src.replace("--m:0s", '--m:-' + AT + 's').replace('</style>', '*{animation-play-state:paused!important}</style>')
    : src.replace('</style>', '*{animation-play-state:paused!important}</style>')
  const png = await page.evaluate(
    async ([source, W, H, dpr]) => {
      const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
      root.setAttribute('width', String(W))
      root.setAttribute('height', String(H))
      const img = new Image()
      img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
      await img.decode()
      await new Promise(r => setTimeout(r, 150))
      const c = document.createElement('canvas')
      c.width = W * dpr
      c.height = H * dpr
      c.getContext('2d').drawImage(img, 0, 0, W * dpr, H * dpr)
      return c.toDataURL('image/png')
    },
    [src, VW, VH, DPR],
  )
  const out = path.join(HERE, 'out', 'low-orbit-' + w + (AT ? '-t' + AT : '') + '.png')
  fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'))
  console.log('->', out)
  if (process.env.ZOOM) {
    // A crop of the cells at 6 px per cell, from a 1920 x 1200 drawing (exactly 6 px a cell).
    const [zx, zy, zw, zh] = process.env.ZOOM.split(',').map(Number)
    const zoom = await page.evaluate(
      async ([source, zx, zy, zw, zh]) => {
        const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
        root.setAttribute('width', '1920')
        root.setAttribute('height', '1200')
        const img = new Image()
        img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
        await img.decode()
        await new Promise(r => setTimeout(r, 150))
        const c = document.createElement('canvas')
        c.width = zw * 6
        c.height = zh * 6
        c.getContext('2d').drawImage(img, zx * 6, zy * 6, zw * 6, zh * 6, 0, 0, zw * 6, zh * 6)
        return c.toDataURL('image/png')
      },
      [src, zx, zy, zw, zh],
    )
    const zout = path.join(HERE, 'out', 'zoom-' + w + '.png')
    fs.writeFileSync(zout, Buffer.from(zoom.split(',')[1], 'base64'))
    console.log('->', zout)
  }
}
await browser.close()
