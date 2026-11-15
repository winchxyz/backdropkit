// node debug.mjs [moment ...] : the two lighting checks of ../_refs/lighting.md, from the PNGs that
// render.mjs wrote (run build.mjs and render.mjs first). For each moment, in out/debug/:
//   <moment>-value.png   the picture as luminance only, and under it the same in four value groups
//   <moment>-light.png   the picture with the key light marked (a yellow arrow from its direction)
//                        and, from the foot of each probe object, a cyan arrow where its cast
//                        shadow must fall (build.mjs writes the probes to out/debug/light.json)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().pop()
const moments = process.argv.slice(2).length ? process.argv.slice(2) : ['day', 'sunset', 'night']
const LIGHT = JSON.parse(fs.readFileSync(path.join(HERE, 'out', 'debug', 'light.json'), 'utf8'))

const browser = await chromium.launch({ executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe') })
const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
for (const m of moments) {
  const png = fs.readFileSync(path.join(HERE, 'out', 'lavender-slope-' + m + '.png')).toString('base64')
  const res = await page.evaluate(
    async ([png, light]) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + png
      await img.decode()
      const w = img.width
      const h = img.height
      // The scene is 320 x 200 cells shown 4.8 px a cell, its top 96 px cut off (slice, pinned
      // to the bottom).
      const S = w / 320
      const OY = h - 200 * S
      const P = (x, y) => [(x + 0.5) * S, (y + 0.5) * S + OY]

      const v = document.createElement('canvas')
      v.width = w
      v.height = h * 2
      const g = v.getContext('2d')
      g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, w, h)
      const q = g.createImageData(w, h)
      for (let i = 0; i < w * h; i++) {
        const L = 0.299 * d.data[i * 4] + 0.587 * d.data[i * 4 + 1] + 0.114 * d.data[i * 4 + 2]
        d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = L
        const k = Math.min(3, Math.floor(L / 64))
        q.data[i * 4] = q.data[i * 4 + 1] = q.data[i * 4 + 2] = [24, 92, 164, 240][k]
        q.data[i * 4 + 3] = 255
      }
      g.putImageData(d, 0, 0)
      g.putImageData(q, 0, h)

      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const k = c.getContext('2d')
      k.drawImage(img, 0, 0)
      const arrow = (x0, y0, x1, y1, col, lw) => {
        k.strokeStyle = col
        k.fillStyle = col
        k.lineWidth = lw
        k.beginPath()
        k.moveTo(x0, y0)
        k.lineTo(x1, y1)
        k.stroke()
        const a = Math.atan2(y1 - y0, x1 - x0)
        const s = lw * 4
        k.beginPath()
        k.moveTo(x1, y1)
        k.lineTo(x1 - s * Math.cos(a - 0.45), y1 - s * Math.sin(a - 0.45))
        k.lineTo(x1 - s * Math.cos(a + 0.45), y1 - s * Math.sin(a + 0.45))
        k.fill()
      }
      // The key light: from its place in the frame, or from the frame's edge along its
      // direction when it is off-frame.
      const [lx, ly] = P(...light.arrow[0])
      const [tx, ty] = P(...light.arrow[1])
      k.fillStyle = '#ffe000'
      k.beginPath()
      k.arc(lx, ly, 12, 0, 7)
      k.fill()
      arrow(lx, ly, tx, ty, '#ffe000', 6)
      k.font = 'bold 26px sans-serif'
      k.fillText(light.name, lx + 18, ly - 14)
      for (const p of light.probes) {
        const [x0, y0] = P(...p.base)
        const [x1, y1] = P(...p.tip)
        k.fillStyle = '#00f0ff'
        k.fillRect(x0 - 4, y0 - 4, 8, 8)
        arrow(x0, y0, x1, y1, '#00f0ff', 3)
      }
      return [v.toDataURL('image/png'), c.toDataURL('image/png')]
    },
    [png, LIGHT[m]],
  )
  for (const [i, tag] of ['value', 'light'].entries()) {
    const out = path.join(HERE, 'out', 'debug', m + '-' + tag + '.png')
    fs.writeFileSync(out, Buffer.from(res[i].split(',')[1], 'base64'))
    console.log(out)
  }
}
await browser.close()
