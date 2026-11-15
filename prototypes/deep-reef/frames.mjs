// node frames.mjs [out.png] : the scene at several moments of its motion (the root's --m
// clock), drawn as the app's player draws it (an <img> of the source), in one sheet.
// Env: TIMES="0,3,10" seconds, SIZE=WxH of each picture (default 768x432), CROP=x,y,w,h of
// each picture (its own CSS px) with ZOOM=n.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const outPath = process.argv[2] ?? path.join(HERE, 'out', 'frames.png')
const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(dir).filter(d => d.startsWith('chromium-')).sort().pop()

const times = (process.env.TIMES ?? '0,2,6,15,30,60').split(',').map(Number)
const [VW, VH] = (process.env.SIZE ?? '768x432').split('x').map(Number)
const crop = process.env.CROP?.split(',').map(Number) ?? [0, 0, VW, VH]
const Z = Number(process.env.ZOOM ?? 1)
const base = fs.readFileSync(path.join(HERE, 'out', 'deep-reef.svg'), 'utf8').replace('</style>', '*{animation-play-state:paused!important}</style>')
const sources = times.map(t => base.replace('--m:0s', '--m:' + -t + 's'))

const browser = await chromium.launch({
  executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
const png = await page.evaluate(
  async ([sources, times, W, H, crop, Z]) => {
    const [cx, cy, cw, ch] = crop
    const pw = cw * Z
    const ph = ch * Z
    const cols = Math.min(3, sources.length)
    const rows = Math.ceil(sources.length / cols)
    const sheet = document.createElement('canvas')
    sheet.width = cols * pw + (cols + 1) * 6
    sheet.height = rows * (ph + 24) + 6
    const g = sheet.getContext('2d')
    g.fillStyle = '#20232a'
    g.fillRect(0, 0, sheet.width, sheet.height)
    for (let i = 0; i < sources.length; i++) {
      const root = new DOMParser().parseFromString(sources[i], 'image/svg+xml').documentElement
      root.setAttribute('width', String(W))
      root.setAttribute('height', String(H))
      const img = new Image()
      img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
      await img.decode()
      await new Promise(r => setTimeout(r, 120))
      const full = document.createElement('canvas')
      full.width = W * Z
      full.height = H * Z
      full.getContext('2d').drawImage(img, 0, 0, W * Z, H * Z)
      const x = 6 + (i % cols) * (pw + 6)
      const y = 6 + Math.floor(i / cols) * (ph + 24)
      g.drawImage(full, cx * Z, cy * Z, pw, ph, x, y + 18, pw, ph)
      g.fillStyle = '#e8eaf0'
      g.font = '14px sans-serif'
      g.fillText('t = ' + times[i] + ' s', x + 2, y + 13)
    }
    return sheet.toDataURL('image/png')
  },
  [sources, times, VW, VH, crop, Z],
)
fs.writeFileSync(outPath, Buffer.from(png.split(',')[1], 'base64'))
console.log('->', outPath)
await browser.close()
