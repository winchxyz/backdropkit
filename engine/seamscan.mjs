// node seamscan.mjs <scene.svg ...> [WxH@dpr ...] : hairline check for scenes.
//
// Each scene is drawn as an <img> with motion held at its first frame (the way the app's player
// and the gallery draw it), at every size, and two things are counted:
//  - holes: pixels that change between a black and a white page behind it (the page shows through);
//  - line pixels: a pixel that differs by more than DIFF from both neighbours while those two
//    agree within SAME, across or down: a 1-px line between shapes.
// A cell is at least 4 screen pixels at every default size, so no honest detail is 1 px wide.
//
// Default sizes: the owner's window, common laptop and desktop windows at 1x, 1.25x, 1.5x and
// 2x, the gallery stage, and an odd window. Pass sizes after the files to override.
// Fails (exit 1) when any size has a hole or more than LIMIT (default 60) line pixels.
// SAVE=dir writes, per size, a 4x crop around the worst 50x50 block, to look at with Read.
// T=seconds holds the motion at that time instead of 0 (sets --m).
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg'
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().pop()
const args = process.argv.slice(2)
const files = args.filter(a => !/^\d+x\d+@[\d.]+$/.test(a))
const sizeArgs = args.filter(a => /^\d+x\d+@[\d.]+$/.test(a))
export const DEFAULT_SIZES = [
  '1536x864@1.25', '1536x864@1', '1920x1080@1', '1366x768@1', '1440x900@1', '1280x720@1.5',
  '1680x1050@1', '2560x1440@1', '1440x900@2', '1278x719@1.25', '1200x780@1.25',
]
const SIZES = (sizeArgs.length ? sizeArgs : DEFAULT_SIZES).map(s => {
  const m = s.match(/^(\d+)x(\d+)@([\d.]+)$/)
  return [+m[1], +m[2], +m[3]]
})
const DIFF = Number(process.env.DIFF ?? 24)
const SAME = Number(process.env.SAME ?? 10)
const LIMIT = Number(process.env.LIMIT ?? 60)
const SAVE = process.env.SAVE
const T = process.env.T

const browser = await chromium.launch({
  executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
let failed = false
for (const file of files) {
  let src = fs.readFileSync(file, 'utf8').replace('</style>', '*{animation-play-state:paused!important}</style>')
  if (T !== undefined) src = src.replace(/--m:[-\d.]*s/, '--m:' + -Number(T) + 's')
  const vb = (src.match(/viewBox=['"]([^'"]+)['"]/) ?? [, '0 0 320 200'])[1].split(/[ ,]+/).map(Number)
  console.log('== ' + path.basename(file) + ' (' + src.length + ' chars)')
  for (const [W, H, dpr] of SIZES) {
    const res = await page.evaluate(async ([source, W, H, dpr, DIFF, SAME]) => {
      const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
      root.setAttribute('width', String(W))
      root.setAttribute('height', String(H))
      const img = new Image()
      img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
      await img.decode()
      const cw = Math.round(W * dpr), ch = Math.round(H * dpr)
      const grab = bg => {
        const c = document.createElement('canvas')
        c.width = cw; c.height = ch
        const g = c.getContext('2d')
        g.fillStyle = bg; g.fillRect(0, 0, cw, ch)
        g.drawImage(img, 0, 0, cw, ch)
        return g.getImageData(0, 0, cw, ch).data
      }
      const a = grab('#000'), b = grab('#fff')
      let holes = 0, lines = 0
      const bw = Math.ceil(cw / 50)
      const heat = new Uint32Array(bw * Math.ceil(ch / 50))
      const d3 = (i, j) => Math.abs(a[i] - a[j]) + Math.abs(a[i + 1] - a[j + 1]) + Math.abs(a[i + 2] - a[j + 2])
      for (let y = 1; y < ch - 1; y++) for (let x = 1; x < cw - 1; x++) {
        const i = (y * cw + x) * 4
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6) holes++
        const l = i - 4, r = i + 4, u = i - cw * 4, dn = i + cw * 4
        const hz = d3(l, r) <= SAME && d3(i, l) > DIFF && d3(i, r) > DIFF
        const vt = d3(u, dn) <= SAME && d3(i, u) > DIFF && d3(i, dn) > DIFF
        if (hz || vt) { lines++; heat[Math.floor(y / 50) * bw + Math.floor(x / 50)]++ }
      }
      let best = 0, bi = 0
      for (let k = 0; k < heat.length; k++) if (heat[k] > best) { best = heat[k]; bi = k }
      return { holes, lines, bx: (bi % bw) * 50, by: Math.floor(bi / bw) * 50 }
    }, [src, W, H, dpr, DIFF, SAME])
    const cell = (Math.max(W / vb[2], H / vb[3]) * dpr).toFixed(2)
    const bad = res.holes > 0 || res.lines > LIMIT
    if (bad) failed = true
    console.log(`  ${(W + 'x' + H + '@' + dpr).padEnd(14)} ${cell.padStart(5)} px/cell  holes ${String(res.holes).padStart(5)}  lines ${String(res.lines).padStart(5)}  ${bad ? 'FAIL near ' + res.bx + ',' + res.by + ' (device px)' : 'ok'}`)
    if (SAVE && res.lines) {
      fs.mkdirSync(SAVE, { recursive: true })
      const p = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: dpr })
      const sized = src.replace(/<svg /, `<svg width='${W}' height='${H}' `)
      await p.setContent(`<body style="margin:0;background:#000"><img src="data:image/svg+xml;base64,${Buffer.from(sized).toString('base64')}"></body>`)
      await p.waitForTimeout(300)
      const cx = Math.max(0, Math.min(W - 150, res.bx / dpr - 50)), cy = Math.max(0, Math.min(H - 100, res.by / dpr - 30))
      const raw = path.join(SAVE, path.basename(file, '.svg') + `-${W}x${H}@${dpr}.png`)
      await p.screenshot({ path: raw, clip: { x: cx, y: cy, width: 150, height: 100 } })
      await p.close()
      try {
        execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', raw, '-vf', 'scale=iw*4/' + dpr + ':ih*4/' + dpr + ':flags=neighbor', raw.replace('.png', '-4x.png')])
      } catch {}
    }
  }
}
await browser.close()
if (failed) process.exitCode = 1
