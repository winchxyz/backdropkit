// node render.mjs [scene.svg] [out.png] : draws the scene the way the desktop app's player draws
// it (an <img> of the source, GPU raster), with every animation held, into a PNG.
// Env:
//   SIZE=WxH  CSS px, default 1536x864
//   DPR       device pixel ratio, default 1
//   T         seconds into the motion (the root's --m clock), default 0: held at the start
//   CROP=x,y,w,h  a part of the picture in cells of the bottom-pinned view, with ZOOM=n
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const svgPath = process.argv[2] ?? path.join(HERE, 'out', 'moon-keep.svg')
const outPath = process.argv[3] ?? path.join(HERE, 'out', 'moon-keep.png')
const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().pop()

const [VW, VH] = (process.env.SIZE ?? '1536x864').split('x').map(Number)
const crop = process.env.CROP?.split(',').map(Number)
const ZOOM = Number(process.env.ZOOM ?? 1)
const DPR = Number(process.env.DPR ?? 1)
const T = Number(process.env.T ?? 0)

let source = fs.readFileSync(svgPath, 'utf8')
source = source.replace('</style>', '*{animation-play-state:paused!important}</style>').replace("--m:0s", '--m:' + -T + 's')

const browser = await chromium.launch({
  executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 })
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
    full.width = W * dpr
    full.height = H * dpr
    full.getContext('2d').drawImage(img, 0, 0, W * dpr, H * dpr)
    if (!crop) return full.toDataURL('image/png')
    // Cells to device pixels for the bottom-pinned view (xMidYMax slice of 320 x 200).
    const s = Math.max(W / 320, H / 200) * dpr
    const ox = (W * dpr - 320 * s) / 2
    const oy = H * dpr - 200 * s
    const [cx, cy, cw, ch] = crop
    const c = document.createElement('canvas')
    c.width = Math.round(cw * s * zoom)
    c.height = Math.round(ch * s * zoom)
    const g = c.getContext('2d')
    g.imageSmoothingEnabled = false
    g.drawImage(full, ox + cx * s, oy + cy * s, cw * s, ch * s, 0, 0, c.width, c.height)
    return c.toDataURL('image/png')
  },
  [source, VW, VH, DPR, crop ?? null, ZOOM],
)
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, Buffer.from(png.split(',')[1], 'base64'))
console.log('->', outPath)
await browser.close()
