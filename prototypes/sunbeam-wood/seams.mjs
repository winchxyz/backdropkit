// node seams.mjs [moment ...] : draws each SVG as the app does (an <img>, GPU raster, motion held
// at its start) at 1536 x 864 @1x and @1.25x and at 1366 x 768, and looks for hairlines: a
// one-pixel row (or column) that is lighter or darker than both its neighbours, where those two
// agree, along 12 or more pixels in a row. Prints the count and the longest few for each size.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().pop()
const moments = process.argv.slice(2).length ? process.argv.slice(2) : ['morning', 'day', 'night']
const SIZES = [[1536, 864, 1], [1536, 864, 1.25], [1366, 768, 1]]

const browser = await chromium.launch({
  executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
for (const m of moments) {
  const src = fs.readFileSync(path.join(HERE, 'out', 'sunbeam-wood-' + m + '.svg'), 'utf8').replace('</style>', '*{animation-play-state:paused!important}</style>')
  for (const [W, H, dpr] of SIZES) {
    const res = await page.evaluate(
      async ([source, W, H, dpr]) => {
        const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
        root.setAttribute('width', String(W))
        root.setAttribute('height', String(H))
        const img = new Image()
        img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
        await img.decode()
        await new Promise(r => setTimeout(r, 150))
        const c = document.createElement('canvas')
        c.width = Math.round(W * dpr)
        c.height = Math.round(H * dpr)
        const g = c.getContext('2d')
        g.drawImage(img, 0, 0, c.width, c.height)
        const d = g.getImageData(0, 0, c.width, c.height).data
        const w = c.width
        const h = c.height
        const lum = new Float32Array(w * h)
        for (let i = 0; i < w * h; i++) lum[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2]
        const lines = []
        const scan = (n, len, at) => {
          for (let a = 1; a < n - 1; a++) {
            let run = 0
            let sign = 0
            for (let b = 0; b <= len; b++) {
              let hit = 0
              if (b < len) {
                const p = at(a - 1, b)
                const q = at(a, b)
                const r = at(a + 1, b)
                if (Math.abs(p - r) < 6 && Math.abs(q - (p + r) / 2) > 14) hit = q > p ? 1 : -1
              }
              if (hit && (hit === sign || !run)) {
                run++
                sign = hit
              } else {
                if (run >= 12) lines.push([a, b - run, run, sign])
                run = hit ? 1 : 0
                sign = hit
              }
            }
          }
        }
        scan(h, w, (y, x) => lum[y * w + x])
        const rows = lines.length
        scan(w, h, (x, y) => lum[y * w + x])
        lines.sort((p, q) => q[2] - p[2])
        // Dashed seams: a row or column with many odd pixels, not necessarily in one run.
        const dashed = []
        const count = (n, len, at, kind) => {
          for (let a = 1; a < n - 1; a++) {
            let k = 0
            for (let b = 0; b < len; b++) {
              const p = at(a - 1, b)
              const r = at(a + 1, b)
              if (Math.abs(p - r) < 6 && Math.abs(at(a, b) - (p + r) / 2) > 8) k++
            }
            if (k >= 24) dashed.push(kind + a + ':' + k)
          }
        }
        count(h, w, (y, x) => lum[y * w + x], 'y')
        count(w, h, (x, y) => lum[y * w + x], 'x')
        return { rows, cols: lines.length - rows, top: lines.slice(0, 4), dashed }
      },
      [src, W, H, dpr],
    )
    console.log(m.padEnd(8), W + 'x' + H + '@' + dpr, 'row lines', res.rows, 'column lines', res.cols, res.top.length ? 'longest: ' + res.top.map(l => '[' + l.join(',') + ']').join(' ') : '', res.dashed.length ? 'dashed: ' + res.dashed.join(' ') : '')
  }
}
await browser.close()
