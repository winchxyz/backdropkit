// node seams.mjs [moment ...] : looks for hairlines, the 1-pixel lines a cell grid drawn at a
// fractional scale can show where two shapes meet inside a screen pixel. Every real feature of
// the picture is at least a cell (4 px or more) wide, so a line 1 px thin whose neighbours on
// both sides agree with each other is a seam. Draws the scene as the app does (an <img> of the
// SVG, animations held at their start) at SIZE=WxH and DPR=n, scans rows and columns, and
// prints the longest lines found; MARK=1 also writes out/frames/<moment>-seams.png with them
// marked in green.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().pop()
const [VW, VH] = (process.env.SIZE ?? '1536x864').split('x').map(Number)
const DPR = Number(process.env.DPR ?? 1)
const MIN = Number(process.env.MIN ?? 6) // the shortest line reported, in device px
const DIFF = Number(process.env.DIFF ?? 18) // how far (sum of RGB) the line stands off its sides
const moments = process.argv.slice(2).length ? process.argv.slice(2) : ['sunrise', 'day', 'night']

const browser = await chromium.launch({
  executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 })
for (const m of moments) {
  let source = fs.readFileSync(path.join(HERE, 'out', 'hill-village-' + m + '.svg'), 'utf8')
  source = source.replace('</style>', '*{animation-play-state:paused!important}</style>')
  const res = await page.evaluate(
    async ([source, W, H, dpr, MIN, DIFF, mark]) => {
      const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
      root.setAttribute('width', String(W))
      root.setAttribute('height', String(H))
      const img = new Image()
      img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
      await img.decode()
      await new Promise(r => setTimeout(r, 150))
      const c = document.createElement('canvas')
      const w = (c.width = Math.round(W * dpr))
      const h = (c.height = Math.round(H * dpr))
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      const d = ctx.getImageData(0, 0, w, h).data
      const px = (x, y) => (y * w + x) * 4
      const diff = (a, b) => Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2])
      // a pixel is on a line across (dir 0) when it stands off the pixels above and below,
      // which agree; on a line down (dir 1) the same with left and right
      const on = (x, y, dir) => {
        const p = px(x, y)
        const a = dir ? px(x - 1, y) : px(x, y - 1)
        const b = dir ? px(x + 1, y) : px(x, y + 1)
        return diff(a, b) < DIFF * 0.6 && diff(p, a) > DIFF && diff(p, b) > DIFF
      }
      const lines = []
      for (const dir of [0, 1]) {
        const outer = dir ? w : h
        const inner = dir ? h : w
        for (let i = 1; i < outer - 1; i++) {
          let run = 0
          for (let j = 0; j <= inner; j++) {
            const hit = j < inner && (dir ? on(i, j, 1) : on(j, i, 0))
            if (hit) run++
            else {
              if (run >= MIN) lines.push({ dir: dir ? 'down' : 'across', at: i, from: j - run, len: run })
              run = 0
            }
          }
        }
      }
      let png = null
      if (mark) {
        for (const l of lines) {
          for (let k = 0; k < l.len; k++) {
            const x = l.dir === 'down' ? l.at : l.from + k
            const y = l.dir === 'down' ? l.from + k : l.at
            ctx.fillStyle = '#00ff40'
            ctx.fillRect(x, y, 1, 1)
          }
        }
        png = c.toDataURL('image/png')
      }
      lines.sort((a, b) => b.len - a.len)
      return { lines: lines.slice(0, 400), count: lines.length, png, w, h }
    },
    [source, VW, VH, DPR, MIN, DIFF, !!process.env.MARK],
  )
  // grid cell under a device pixel, for the bottom-pinned viewport (the one most of the scene sits in)
  const s = Math.max((VW * DPR) / 320, (VH * DPR) / 200)
  const ox = (VW * DPR - 320 * s) / 2
  const oy = VH * DPR - 200 * s
  const cell = (x, y) => Math.floor((x - ox) / s) + ',' + Math.floor((y - oy) / s - 0.5)
  console.log(m, VW + 'x' + VH + '@' + DPR + ':', res.count, 'lines of ' + MIN + '+ px')
  for (const l of res.lines.slice(0, 16)) {
    const [x, y] = l.dir === 'down' ? [l.at, l.from] : [l.from, l.at]
    console.log('  ' + l.dir.padEnd(6), 'at px', x + ',' + y, 'len', l.len, ' cell', cell(x, y))
  }
  if (res.png) {
    fs.mkdirSync(path.join(HERE, 'out', 'frames'), { recursive: true })
    const f = path.join(HERE, 'out', 'frames', m + '-seams-' + VW + 'x' + VH + '@' + DPR + '.png')
    fs.writeFileSync(f, Buffer.from(res.png.split(',')[1], 'base64'))
    console.log('  ->', f)
  }
}
await browser.close()
