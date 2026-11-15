// node pixeldiff.mjs <before.svg> <after.svg> : did a re-encode change the picture?
// Draws both at whole-pixel cell sizes (1920x1080 and 1536x864@1.25, 6 px per cell, where no
// hairline can form), motion held at the first frame, and counts pixels that differ by more
// than TOL (default 6, summed over R, G and B). Prints the count and the box they lie in.
// DIFF=out.png writes the after picture with changed pixels in magenta.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().pop()
const [fa, fb] = process.argv.slice(2)
const TOL = Number(process.env.TOL ?? 6)
const browser = await chromium.launch({
  executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
const hold = s => fs.readFileSync(s, 'utf8').replace('</style>', '*{animation-play-state:paused!important}</style>')
for (const [W, H, dpr] of [[1920, 1080, 1], [1536, 864, 1.25]]) {
  const res = await page.evaluate(async ([a, b, W, H, dpr, TOL, wantPng]) => {
    const draw = async source => {
      const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
      root.setAttribute('width', String(W))
      root.setAttribute('height', String(H))
      const img = new Image()
      img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
      await img.decode()
      const c = document.createElement('canvas')
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr)
      const g = c.getContext('2d')
      g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height)
      g.drawImage(img, 0, 0, c.width, c.height)
      return [c, g]
    }
    const [ca, ga] = await draw(a)
    const [cb, gb] = await draw(b)
    const A = ga.getImageData(0, 0, ca.width, ca.height)
    const B = gb.getImageData(0, 0, cb.width, cb.height)
    let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
    for (let i = 0; i < A.data.length; i += 4) {
      const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2])
      if (d > TOL) {
        n++
        const p = i / 4, x = p % ca.width, y = Math.floor(p / ca.width)
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
        B.data[i] = 255; B.data[i + 1] = 0; B.data[i + 2] = 255
      }
    }
    let png = null
    if (wantPng) { gb.putImageData(B, 0, 0); png = cb.toDataURL('image/png') }
    return { n, box: n ? [x0, y0, x1, y1] : null, png }
  }, [hold(fa), hold(fb), W, H, dpr, TOL, !!process.env.DIFF])
  console.log(`${W}x${H}@${dpr}: ${res.n} pixels differ${res.box ? ' in ' + res.box.join(',') : ''}`)
  if (process.env.DIFF && res.png) fs.writeFileSync(process.env.DIFF.replace('.png', `-${W}.png`), Buffer.from(res.png.split(',')[1], 'base64'))
}
await browser.close()
