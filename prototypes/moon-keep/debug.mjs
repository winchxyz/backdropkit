// node debug.mjs : the two lighting checks from _refs/lighting.md, into out/debug/ (not part of
// the scene).
//   value.png  the picture as luminance only: it should read in 3-4 value groups, with a lit
//              and a shadow side on every solid.
//   light.png  the picture with the key light marked: a ray from the moon to each solid, and at
//              each solid a short arrow the way its shadow should fall (away from the moon,
//              toward the viewer). Every lit side should face the ray, every shadow the arrow.
// Drawn as the app draws it (an <img> of the SVG, GPU raster) at 1536 x 864, motion held at T.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const svgPath = process.argv[2] ?? path.join(HERE, 'out', 'moon-keep.svg')
const outDir = path.join(HERE, 'out', 'debug')
const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().pop()
const T = Number(process.env.T ?? 0)

// The key light and the solids to test against it, in cells.
const MOON = [112, 62]
const SOLIDS = [
  ['arch', 104, 118],
  ['hill lamp', 33, 160],
  ['bridge pier', 128, 150],
  ['bridge pier', 170, 150],
  ['gate tower', 178, 110],
  ['left tower', 220, 90],
  ['central tower', 238, 90],
  ['right tower', 257, 96],
  ['donjon', 286, 80],
  ['crag', 240, 145],
  ['gravestone', 145, 190],
  ['column', 210, 192],
  ['pillar', 272, 190],
  ['left trunk', 10, 190],
  ['right trunk', 314, 190],
]

let source = fs.readFileSync(svgPath, 'utf8')
source = source.replace('</style>', '*{animation-play-state:paused!important}</style>').replace('--m:0s', '--m:' + -T + 's')
const browser = await chromium.launch({
  executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
const [value, light] = await page.evaluate(
  async ([source, MOON, SOLIDS]) => {
    const W = 1536
    const H = 864
    const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
    root.setAttribute('width', String(W))
    root.setAttribute('height', String(H))
    const img = new Image()
    img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
    await img.decode()
    await new Promise(r => setTimeout(r, 150))
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    // Value map.
    const v = document.createElement('canvas')
    v.width = W
    v.height = H
    const vg = v.getContext('2d')
    const d = g.getImageData(0, 0, W, H)
    for (let i = 0; i < d.data.length; i += 4) {
      const l = 0.2126 * d.data[i] + 0.7152 * d.data[i + 1] + 0.0722 * d.data[i + 2]
      d.data[i] = d.data[i + 1] = d.data[i + 2] = l
    }
    vg.putImageData(d, 0, 0)
    // Light check: cells to pixels for the bottom-pinned view (16:9, so all pins agree).
    const s = Math.max(W / 320, H / 200)
    const P = (x, y) => [(W - 320 * s) / 2 + x * s, H - 200 * s + y * s]
    const arrow = (x0, y0, x1, y1, col, w) => {
      g.strokeStyle = col
      g.lineWidth = w
      g.beginPath()
      g.moveTo(x0, y0)
      g.lineTo(x1, y1)
      const a = Math.atan2(y1 - y0, x1 - x0)
      g.moveTo(x1, y1)
      g.lineTo(x1 - 10 * Math.cos(a - 0.45), y1 - 10 * Math.sin(a - 0.45))
      g.moveTo(x1, y1)
      g.lineTo(x1 - 10 * Math.cos(a + 0.45), y1 - 10 * Math.sin(a + 0.45))
      g.stroke()
    }
    const [mx, my] = P(...MOON)
    g.fillStyle = '#ffe14a'
    g.beginPath()
    g.arc(mx, my, 8, 0, Math.PI * 2)
    g.fill()
    g.font = '13px sans-serif'
    for (const [name, x, y] of SOLIDS) {
      const [px, py] = P(x, y)
      g.setLineDash([6, 6])
      arrow(mx, my, px, py, 'rgba(255,225,74,.55)', 1.5)
      g.setLineDash([])
      // The shadow falls away from the moon along the ground and toward the viewer.
      const dx = (x - MOON[0]) / Math.max(40, Math.abs(x - MOON[0]))
      const len = 40
      const n = Math.hypot(dx, 1)
      arrow(px, py, px + (dx / n) * len, py + (1 / n) * len * 0.6, '#ff3df0', 3)
      g.fillStyle = '#fff'
      g.fillText(name, px + 6, py - 6)
    }
    return [v.toDataURL('image/png'), c.toDataURL('image/png')]
  },
  [source, MOON, SOLIDS],
)
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'value.png'), Buffer.from(value.split(',')[1], 'base64'))
fs.writeFileSync(path.join(outDir, 'light.png'), Buffer.from(light.split(',')[1], 'base64'))
console.log('->', path.join(outDir, 'value.png'), path.join(outDir, 'light.png'))
await browser.close()
