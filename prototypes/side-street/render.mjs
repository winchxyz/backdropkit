// node render.mjs [moment ...] : draws out/side-street-<moment>.svg the way the desktop app does
// (an <img> of the source, GPU raster) with every animation held at its start, into
// out/side-street-<moment>.png at 1536 x 864.
// Env:
//   T=s[,s...]   hold the motion at these seconds instead of its start; writes out/frames/<m>-<t>.png
//   VW, VH       another picture size in device pixels (1920x1080 is 1536x864 at 1.25x)
//   CROP=x,y,w,h a crop in cells of the centred 320 x 200 viewport, ZOOM=n to enlarge it
//   TAG=name     a suffix for the file name (frames/<m>-<tag>.png)
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
const moments = process.argv.slice(2).length ? process.argv.slice(2) : ['day', 'evening', 'night']
const times = (process.env.T ?? '').split(',').filter(Boolean).map(Number)
const crop = process.env.CROP?.split(',').map(Number)
const zoom = Number(process.env.ZOOM ?? 1)
const tag = process.env.TAG ?? ''

const browser = await chromium.launch({
  executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 })
for (const m of moments) {
  const src = fs.readFileSync(path.join(HERE, 'out', 'side-street-' + m + '.svg'), 'utf8')
  for (const t of times.length ? times : [null]) {
    // Held at the start: paused with each animation's own delay. At T: every animation paused
    // and moved on by T seconds, through the shared --m clock that every delay adds.
    const held = t === null ? src : src.replace("style='--m:0s'", "style='--m:" + -t + "s'")
    const source = held.replace('</style>', '*{animation-play-state:paused!important}</style>')
    const png = await page.evaluate(
      async ([source, W, H, crop, zoom]) => {
        const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
        root.setAttribute('width', String(W))
        root.setAttribute('height', String(H))
        const img = new Image()
        img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
        await img.decode()
        await new Promise(r => setTimeout(r, 150))
        const c = document.createElement('canvas')
        if (crop) {
          // Cells to pixels for the centred viewport (xMidYMid slice of 320 x 200).
          const s = Math.max(W / 320, H / 200)
          const ox = (W - 320 * s) / 2
          const oy = (H - 200 * s) / 2
          const [cx, cy, cw, ch] = crop
          c.width = Math.round(cw * s * zoom)
          c.height = Math.round(ch * s * zoom)
          const g = c.getContext('2d')
          g.imageSmoothingEnabled = false
          const tmp = document.createElement('canvas')
          tmp.width = W
          tmp.height = H
          tmp.getContext('2d').drawImage(img, 0, 0, W, H)
          g.drawImage(tmp, ox + cx * s, oy + cy * s, cw * s, ch * s, 0, 0, c.width, c.height)
        } else {
          c.width = W
          c.height = H
          c.getContext('2d').drawImage(img, 0, 0, W, H)
        }
        return c.toDataURL('image/png')
      },
      [source, VW, VH, crop ?? null, zoom],
    )
    let out = path.join(HERE, 'out', 'side-street-' + m + '.png')
    if (t !== null || crop || tag || VW !== 1536 || VH !== 864) {
      fs.mkdirSync(path.join(HERE, 'out', 'frames'), { recursive: true })
      const bits = [m]
      if (t !== null) bits.push(String(t))
      if (crop) bits.push('crop')
      if (VW !== 1536 || VH !== 864) bits.push(VW + 'x' + VH)
      if (tag) bits.push(tag)
      out = path.join(HERE, 'out', 'frames', bits.join('-') + '.png')
    }
    fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'))
    console.log(out)
  }
}
await browser.close()
