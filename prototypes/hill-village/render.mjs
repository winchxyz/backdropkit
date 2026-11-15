// node render.mjs [moment ...] : draws out/hill-village-<moment>.svg the way the desktop app's
// player draws it (an <img> of the source, GPU raster), with every animation held at its start,
// into out/hill-village-<moment>.png.
// Env: SIZE=WxH (CSS px, default 1536x864), DPR (default 1), T=seconds into the motion (the
// root's --m clock), CROP=x,y,w,h (CSS px of the picture) with ZOOM=n for a close-up, OUT=dir
// to write elsewhere (named <moment>[-t<T>][-<SIZE>@<DPR>][-crop].png); BG=#rrggbb paints a colour
// behind the picture (the default leaves it see-through, so any gap shows).
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
const T = process.env.T === undefined ? null : Number(process.env.T)
const moments = process.argv.slice(2).length ? process.argv.slice(2) : ['sunrise', 'day', 'night']

const browser = await chromium.launch({
  executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 })
for (const m of moments) {
  let source = fs.readFileSync(path.join(HERE, 'out', 'hill-village-' + m + '.svg'), 'utf8')
  // Held: paused with each animation's own delay; at T, moved on by T through the --m clock.
  source = source.replace('</style>', '*{animation-play-state:paused!important}</style>')
  if (T !== null) source = source.replace("style='--m:0s'", "style='--m:" + -T + "s'")
  const png = await page.evaluate(
    async ([source, W, H, dpr, crop, bg]) => {
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
      const g = full.getContext('2d')
      if (bg) {
        g.fillStyle = bg
        g.fillRect(0, 0, W * dpr, H * dpr)
      }
      g.drawImage(img, 0, 0, W * dpr, H * dpr)
      if (!crop) return full.toDataURL('image/png')
      const [x, y, w, h] = crop
      const c = document.createElement('canvas')
      c.width = w * dpr
      c.height = h * dpr
      c.getContext('2d').drawImage(full, x * dpr, y * dpr, w * dpr, h * dpr, 0, 0, w * dpr, h * dpr)
      return c.toDataURL('image/png')
    },
    [source, VW, VH, DPR, crop ?? null, process.env.BG ?? null],
  )
  const plain = T === null && !crop && VW === 1536 && VH === 864 && DPR === 1 && !process.env.OUT
  const outDir = plain ? path.join(HERE, 'out') : (process.env.OUT ?? path.join(HERE, 'out', 'frames'))
  const name = plain
    ? 'hill-village-' + m + '.png'
    : m + (T !== null ? '-t' + T : '') + (VW !== 1536 || VH !== 864 || DPR !== 1 ? '-' + VW + 'x' + VH + '@' + DPR : '') + (crop ? '-crop' : '') + '.png'
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, name), Buffer.from(png.split(',')[1], 'base64'))
  console.log('->', path.join(outDir, name))
}
await browser.close()
