// node seams.mjs : draws the scene as the app does (an <img> of the SVG, GPU raster) at a few
// window sizes and scales, and looks for seams: lines one device pixel thick that are clearly
// darker or lighter than the pixels on both sides of them, running on for 8 pixels or more.
// Cells are 4 or more device pixels wide at every size here, so a line that thin is not paint.
// Env: CASES="1536x864@1,1536x864@1.25,1366x768@1"  T=seconds into the motion
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const svgPath = process.argv[2] ?? path.join(HERE, 'out', 'moon-keep.svg')
const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().pop()
const cases = (process.env.CASES ?? '1536x864@1,1536x864@1.25,1366x768@1').split(',').map(c => {
  const [wh, dpr] = c.split('@')
  const [w, h] = wh.split('x').map(Number)
  return { w, h, dpr: Number(dpr ?? 1) }
})
const T = Number(process.env.T ?? 0)
let source = fs.readFileSync(svgPath, 'utf8')
source = source.replace('</style>', '*{animation-play-state:paused!important}</style>').replace('--m:0s', '--m:' + -T + 's')

const browser = await chromium.launch({
  executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
let bad = 0
for (const { w, h, dpr } of cases) {
  const found = await page.evaluate(
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
      const { data } = g.getImageData(0, 0, c.width, c.height)
      const L = (x, y) => {
        const i = (y * c.width + x) * 4
        return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      }
      const out = []
      const MIN = 8
      const TH = 14
      // Horizontal lines: a row darker (or lighter) than the rows above and below it.
      for (let y = 1; y < c.height - 1; y++) {
        let run = 0
        let sign = 0
        for (let x = 0; x <= c.width; x++) {
          let s = 0
          if (x < c.width) {
            const a = L(x, y - 1), m = L(x, y), b = L(x, y + 1)
            if (m < a - TH && m < b - TH) s = -1
            else if (m > a + TH && m > b + TH) s = 1
          }
          if (s && s === sign) run++
          else {
            if (sign && run >= MIN) out.push(['row', y, x - run, run, sign < 0 ? 'dark' : 'light'])
            run = s ? 1 : 0
            sign = s
          }
        }
      }
      // Vertical lines.
      for (let x = 1; x < c.width - 1; x++) {
        let run = 0
        let sign = 0
        for (let y = 0; y <= c.height; y++) {
          let s = 0
          if (y < c.height) {
            const a = L(x - 1, y), m = L(x, y), b = L(x + 1, y)
            if (m < a - TH && m < b - TH) s = -1
            else if (m > a + TH && m > b + TH) s = 1
          }
          if (s && s === sign) run++
          else {
            if (sign && run >= MIN) out.push(['col', x, y - run, run, sign < 0 ? 'dark' : 'light'])
            run = s ? 1 : 0
            sign = s
          }
        }
      }
      return out
    },
    [source, w, h, dpr],
  )
  bad += found.length
  console.log(w + 'x' + h + ' @' + dpr + ':', found.length ? found.length + ' thin lines' : 'no thin lines')
  for (const f of found.slice(0, 12)) console.log('  ', f.join(' '))
}
await browser.close()
if (bad) process.exitCode = 1
