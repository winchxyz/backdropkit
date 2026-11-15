// node render.mjs [moment ...] : draws out/cloud-sea-<moment>.svg the way the desktop app's player
// does (an <img> of the source, GPU raster) with every animation held at its start, into
// out/cloud-sea-<moment>.png at 1536 x 864.
// Env: T=seconds into the motion (the root's --m clock; comma list allowed), SIZE=WxH (CSS px),
// DPR (device pixel ratio), CROP=x,y,w,h (CSS px of the picture) with ZOOM=n. Anything but the
// plain 1536 x 864 start frame goes to out/frames/.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().pop()

const moments = process.argv.slice(2).length ? process.argv.slice(2) : ['day', 'sunset', 'night']
const [VW, VH] = (process.env.SIZE ?? '1536x864').split('x').map(Number)
const crop = process.env.CROP?.split(',').map(Number)
const ZOOM = Number(process.env.ZOOM ?? (crop ? 3 : 1))
const DPR = Number(process.env.DPR ?? ZOOM)
const times = (process.env.T ?? '').split(',').filter(Boolean).map(Number)
const plain = !crop && !process.env.SIZE && !process.env.DPR && !times.length

const browser = await chromium.launch({
  executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 })
for (const m of moments) {
  const src = fs.readFileSync(path.join(HERE, 'out', 'cloud-sea-' + m + '.svg'), 'utf8')
  for (const t of times.length ? times : [0]) {
    const source = src.replace('</style>', '*{animation-play-state:paused!important}</style>').replace("--m:0s", '--m:' + -t + 's')
    const png = await page.evaluate(
      async ([source, W, H, dpr, crop]) => {
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
        const g = full.getContext('2d')
        g.fillStyle = '#ff00ff'
        g.fillRect(0, 0, full.width, full.height)
        g.drawImage(img, 0, 0, full.width, full.height)
        if (!crop) return full.toDataURL('image/png')
        const [x, y, w, h] = crop
        const c = document.createElement('canvas')
        c.width = w * dpr
        c.height = h * dpr
        c.getContext('2d').drawImage(full, x * dpr, y * dpr, w * dpr, h * dpr, 0, 0, w * dpr, h * dpr)
        return c.toDataURL('image/png')
      },
      [source, VW, VH, DPR, crop ?? null],
    )
    let out = path.join(HERE, 'out', 'cloud-sea-' + m + '.png')
    if (!plain) {
      fs.mkdirSync(path.join(HERE, 'out', 'frames'), { recursive: true })
      const tag = [m, t ? 't' + t : '', process.env.SIZE ? VW + 'x' + VH : '', DPR !== 1 && !crop ? 'dpr' + DPR : '', crop ? 'crop' + crop.join('-') : ''].filter(Boolean).join('-')
      out = path.join(HERE, 'out', 'frames', tag + '.png')
    }
    fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'))
    console.log(out)
  }
}
await browser.close()
