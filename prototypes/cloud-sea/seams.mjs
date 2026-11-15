// node seams.mjs [moment ...] : looks for hairlines. Each SVG is drawn as an <img> (as the app's
// player draws it, animations held at T, default 0) at 1536x864 @1x, @1.25x and 1366x768 @1x,
// once over black and once over white. A pixel that differs between the two is see-through:
// a seam where the window behind would show. Also counts 1-px rows or columns darker than both
// neighbours by more than DARK (default 40) inside the cloud sea, the usual look of a seam
// between two layers. Writes out/frames/seam-<moment>-<size>.png marking see-through pixels red.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().pop()
const moments = process.argv.slice(2).length ? process.argv.slice(2) : ['day', 'sunset', 'night']
const T = Number(process.env.T ?? 0)
const DARK = Number(process.env.DARK ?? 40)
const SIZES = [[1536, 864, 1], [1536, 864, 1.25], [1366, 768, 1]]

const browser = await chromium.launch({
  executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 })
fs.mkdirSync(path.join(HERE, 'out', 'frames'), { recursive: true })
for (const m of moments) {
  const src = fs.readFileSync(path.join(HERE, 'out', 'cloud-sea-' + m + '.svg'), 'utf8')
  const source = src.replace('</style>', '*{animation-play-state:paused!important}</style>').replace('--m:0s', '--m:' + -T + 's')
  for (const [w, h, dpr] of SIZES) {
    const res = await page.evaluate(
      async ([source, W, H, dpr, DK]) => {
        const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
        root.setAttribute('width', String(W))
        root.setAttribute('height', String(H))
        const img = new Image()
        img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
        await img.decode()
        await new Promise(r => setTimeout(r, 150))
        const cw = Math.round(W * dpr)
        const ch = Math.round(H * dpr)
        const grab = bg => {
          const c = document.createElement('canvas')
          c.width = cw
          c.height = ch
          const g = c.getContext('2d')
          g.fillStyle = bg
          g.fillRect(0, 0, cw, ch)
          g.drawImage(img, 0, 0, cw, ch)
          return [c, g.getImageData(0, 0, cw, ch).data]
        }
        const [ca, a] = grab('#000')
        const [, b] = grab('#fff')
        let holes = 0
        const rows = new Map()
        const g = ca.getContext('2d')
        const mark = g.getImageData(0, 0, cw, ch)
        for (let i = 0; i < a.length; i += 4) {
          const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
          if (d > 6) {
            holes++
            const y = Math.floor(i / 4 / cw)
            rows.set(y, (rows.get(y) ?? 0) + 1)
            mark.data[i] = 255
            mark.data[i + 1] = 0
            mark.data[i + 2] = 0
          }
        }
        g.putImageData(mark, 0, 0)
        // Dark hairlines: a pixel darker than the pixels above and below (or left and right)
        // by DARK, in runs of 12 or more along the line.
        const lum = i => a[i] * 0.3 + a[i + 1] * 0.55 + a[i + 2] * 0.15
        let hRuns = 0
        let vRuns = 0
        const where = []
        for (let y = 1; y < ch - 1; y++) {
          let run = 0
          for (let x = 0; x < cw; x++) {
            const i = (y * cw + x) * 4
            const l = lum(i)
            if (l < lum(i - cw * 4) - DK && l < lum(i + cw * 4) - DK) run++
            else {
              if (run >= 12) {
                hRuns++
                if (where.length < 8) where.push('h@' + (x - run) + ',' + y + 'x' + run)
              }
              run = 0
            }
          }
        }
        for (let x = 1; x < cw - 1; x++) {
          let run = 0
          for (let y = 0; y < ch; y++) {
            const i = (y * cw + x) * 4
            const l = lum(i)
            if (l < lum(i - 4) - DK && l < lum(i + 4) - DK) run++
            else {
              if (run >= 12) {
                vRuns++
                if (where.length < 8) where.push('v@' + x + ',' + (y - run) + 'x' + run)
              }
              run = 0
            }
          }
        }
        const top = [...rows].sort((p, q) => q[1] - p[1]).slice(0, 6)
        return { holes, top, hRuns, vRuns, where, png: ca.toDataURL('image/png') }
      },
      [source, w, h, dpr, DARK],
    )
    const tag = m + '-' + w + 'x' + h + '@' + dpr
    fs.writeFileSync(path.join(HERE, 'out', 'frames', 'seam-' + tag + '.png'), Buffer.from(res.png.split(',')[1], 'base64'))
    console.log(tag.padEnd(24), 'see-through px', res.holes, res.top.length ? 'rows ' + res.top.map(([y, n]) => y + ':' + n).join(' ') : '', '| dark lines h', res.hRuns, 'v', res.vRuns, res.where.join(' '))
  }
}
await browser.close()
