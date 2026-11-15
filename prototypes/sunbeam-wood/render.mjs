// node render.mjs [moment ...] : draws out/sunbeam-wood-<moment>.svg the way the desktop app's
// player draws it (an <img> of the source, GPU raster), with every animation held at its start,
// into out/sunbeam-wood-<moment>.png at 1536 x 864.
// Env: SIZE=WxH (CSS px), DPR (default 1), T=seconds into the motion (on the root's --m clock),
// CROP=x,y,w,h (CSS px of the picture) with ZOOM=n for a close-up, UPSCALE=n to blow the crop
// up in whole pixels (to look at seams at DPR 1). Anything but the defaults writes to
// out/frames/ instead.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().pop()

const [VW, VH] = (process.env.SIZE ?? '1536x864').split('x').map(Number)
const crop = process.env.CROP?.split(',').map(Number)
const ZOOM = Number(process.env.ZOOM ?? (crop ? 3 : 1))
const DPR = Number(process.env.DPR ?? ZOOM)
const times = (process.env.T ?? '').split(',').filter(Boolean).map(Number)
const moments = process.argv.slice(2).length ? process.argv.slice(2) : ['morning', 'day', 'night']
const plain = !process.env.SIZE && !process.env.DPR && !crop && !process.env.STILL

const browser = await chromium.launch({
  executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 })
for (const m of moments) {
  const src = fs.readFileSync(path.join(HERE, 'out', 'sunbeam-wood-' + m + '.svg'), 'utf8')
  for (const t of times.length ? times : [null]) {
    // Held at the start: paused with each animation's own delay. At T: moved on by T seconds
    // through the shared --m clock that every delay counts from.
    // STILL=1 draws the rest frame instead: no animation at all, as with reduced motion.
    let source = src.replace('</style>', process.env.STILL ? '*{animation:none!important}</style>' : '*{animation-play-state:paused!important}</style>')
    if (t !== null) source = source.replace("style='--m:0s'", "style='--m:" + -t + "s'")
    const png = await page.evaluate(
      async ([source, W, H, dpr, crop, up]) => {
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
        c.width = w * dpr * up
        c.height = h * dpr * up
        const g = c.getContext('2d')
        g.imageSmoothingEnabled = false
        g.drawImage(full, x * dpr, y * dpr, w * dpr, h * dpr, 0, 0, w * dpr * up, h * dpr * up)
        return c.toDataURL('image/png')
      },
      [source, VW, VH, DPR, crop ?? null, Number(process.env.UPSCALE ?? 1)],
    )
    let out = path.join(HERE, 'out', 'sunbeam-wood-' + m + '.png')
    if (!plain || t !== null) {
      fs.mkdirSync(path.join(HERE, 'out', 'frames'), { recursive: true })
      out = path.join(HERE, 'out', 'frames', m + (process.env.STILL ? '-still' : '') + (t !== null ? '-t' + t : '') + (process.env.SIZE ? '-' + VW + 'x' + VH : '') + (process.env.DPR ? '-dpr' + DPR : '') + (crop ? '-crop' + crop.join('_') : '') + '.png')
    }
    fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'))
    console.log(out)
  }
}
await browser.close()
