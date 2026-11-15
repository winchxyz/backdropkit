// node render.mjs [moment ...] : draws out/lavender-slope-<moment>.svg the way the desktop app's
// player does (an <img> of the source, GPU raster), with every animation held at its start, into
// out/lavender-slope-<moment>.png at 1536 x 864.
// Env:
//   SIZE=WxH (CSS px, default 1536x864), DPR (default 1)
//   T=seconds into the motion (the root's --m clock); written to out/frames/<moment>-<T>.png
//   CROP=x,y,w,h (CSS px of the picture) with ZOOM=n: a close-up, written to out/frames/
//   SEAMS=1: also scan the picture for hairlines (1-px rows or columns that differ from both
//   neighbours along a long stretch) and print what it finds.
//   OUT=path: write the PNG there instead.
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
const DPR = Number(process.env.DPR ?? (crop ? ZOOM : 1))
const T = process.env.T === undefined ? null : Number(process.env.T)
const moments = process.argv.slice(2).length ? process.argv.slice(2) : ['day', 'sunset', 'night']

const browser = await chromium.launch({
  executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 })
for (const m of moments) {
  let source = fs.readFileSync(path.join(HERE, 'out', 'lavender-slope-' + m + '.svg'), 'utf8')
  source = source.replace('</style>', '*{animation-play-state:paused!important}</style>')
  if (T !== null) source = source.replace("style='--m:0s'", "style='--m:" + -T + "s'")
  const res = await page.evaluate(
    async ([source, W, H, dpr, crop, seams, thr]) => {
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
      g.drawImage(img, 0, 0, full.width, full.height)
      let found = []
      if (seams) {
        // A hairline: a pixel row (or column) that is darker, or lighter, than both its
        // neighbours by a clear step while they agree, along 24 pixels or more.
        const { data, width: w, height: h } = g.getImageData(0, 0, full.width, full.height)
        const lum = new Float32Array(w * h)
        for (let i = 0; i < w * h; i++) lum[i] = 0.3 * data[i * 4] + 0.55 * data[i * 4 + 1] + 0.15 * data[i * 4 + 2]
        const scan = (n, len, at) => {
          for (let a = 1; a < n - 1; a++) {
            let run = 0
            for (let b = 0; b < len; b++) {
              const p = lum[at(a, b)]
              const u = lum[at(a - 1, b)]
              const d = lum[at(a + 1, b)]
              const hit = Math.abs(u - d) < 6 && ((p < u - thr && p < d - thr) || (p > u + thr && p > d + thr))
              run = hit ? run + 1 : 0
              if (run === 24) found.push((at === rowAt ? 'row ' : 'col ') + a + ' at ' + (b - 23))
            }
          }
        }
        const rowAt = (a, b) => a * w + b
        const colAt = (a, b) => b * w + a
        scan(h, w, rowAt)
        scan(w, h, colAt)
      }
      let c = full
      if (crop) {
        const [x, y, cw, ch] = crop
        c = document.createElement('canvas')
        c.width = cw * dpr
        c.height = ch * dpr
        const g2 = c.getContext('2d')
        g2.imageSmoothingEnabled = false
        g2.drawImage(full, x * dpr, y * dpr, cw * dpr, ch * dpr, 0, 0, cw * dpr, ch * dpr)
      }
      return { png: c.toDataURL('image/png'), found }
    },
    [source, VW, VH, DPR, crop ?? null, !!process.env.SEAMS, Number(process.env.SEAMTHR ?? 10)],
  )
  let out = process.env.OUT ?? path.join(HERE, 'out', 'lavender-slope-' + m + '.png')
  if (!process.env.OUT && (T !== null || crop || process.env.SIZE || process.env.DPR)) {
    fs.mkdirSync(path.join(HERE, 'out', 'frames'), { recursive: true })
    const tag = [m, T !== null ? 't' + T : '', crop ? 'crop' : '', process.env.SIZE ?? '', process.env.DPR ? 'x' + DPR : ''].filter(Boolean).join('-')
    out = path.join(HERE, 'out', 'frames', tag + '.png')
  }
  fs.writeFileSync(out, Buffer.from(res.png.split(',')[1], 'base64'))
  console.log(out)
  if (process.env.SEAMS) console.log('  seams:', res.found.length ? res.found.slice(0, 20).join('; ') + (res.found.length > 20 ? ' ... (' + res.found.length + ')' : '') : 'none')
}
await browser.close()
