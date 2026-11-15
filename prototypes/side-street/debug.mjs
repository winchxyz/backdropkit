// node debug.mjs [moment ...] : the two checks of lighting.md (rule 7) for each moment, from
// out/side-street-<moment>.png and out/debug/keys.json (written by build.mjs):
//   out/debug/<moment>-value.png  the picture in luminance only, and beside it the same cut into
//                                 four value groups, to see that it reads in three or four values
//   out/debug/<moment>-light.png  the picture with the key light marked (or an arrow in from the
//                                 side it is on, when it is off the frame) and, for things that
//                                 stand on the ground, an arrow from the base along the way the
//                                 shadow must fall
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().pop()
const keys = JSON.parse(fs.readFileSync(path.join(HERE, 'out', 'debug', 'keys.json'), 'utf8'))
const moments = process.argv.slice(2).length ? process.argv.slice(2) : ['day', 'evening', 'night']

const browser = await chromium.launch({ executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe') })
const page = await browser.newPage()
for (const m of moments) {
  const src = 'data:image/png;base64,' + fs.readFileSync(path.join(HERE, 'out', 'side-street-' + m + '.png')).toString('base64')
  const [value, light] = await page.evaluate(
    async ([src, K]) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const W = img.width
      const H = img.height
      // The picture's cells: the 320 x 200 grid, centred and sliced to the frame.
      const s = Math.max(W / 320, H / 200)
      const ox = (W - 320 * s) / 2
      const oy = (H - 200 * s) / 2
      const P = (x, y) => [ox + x * s, oy + y * s]

      // Value map: luminance, and the same in four groups.
      const v = document.createElement('canvas')
      v.width = W * 2
      v.height = H
      const g = v.getContext('2d')
      g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, W, H)
      const q = g.createImageData(W, H)
      for (let i = 0; i < d.data.length; i += 4) {
        const l = 0.2126 * d.data[i] + 0.7152 * d.data[i + 1] + 0.0722 * d.data[i + 2]
        d.data[i] = d.data[i + 1] = d.data[i + 2] = l
        const b = [24, 92, 160, 228][Math.min(3, Math.floor(l / 64))]
        q.data[i] = q.data[i + 1] = q.data[i + 2] = b
        q.data[i + 3] = 255
      }
      g.putImageData(d, 0, 0)
      g.putImageData(q, W, 0)

      // Light check.
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const h = c.getContext('2d')
      h.drawImage(img, 0, 0)
      const arrow = (x0, y0, x1, y1, col, w) => {
        h.strokeStyle = col
        h.fillStyle = col
        h.lineWidth = w
        h.beginPath()
        h.moveTo(x0, y0)
        h.lineTo(x1, y1)
        h.stroke()
        const a = Math.atan2(y1 - y0, x1 - x0)
        const r = 6 + w * 2
        h.beginPath()
        h.moveTo(x1, y1)
        h.lineTo(x1 - r * Math.cos(a - 0.45), y1 - r * Math.sin(a - 0.45))
        h.lineTo(x1 - r * Math.cos(a + 0.45), y1 - r * Math.sin(a + 0.45))
        h.closePath()
        h.fill()
      }
      for (const [x0, y0, x1, y1] of K.arrows) {
        const [a, b] = [P(x0, y0), P(x1, y1)]
        h.fillStyle = '#ff00ff'
        h.beginPath()
        h.arc(a[0], a[1], 4, 0, Math.PI * 2)
        h.fill()
        arrow(a[0], a[1], b[0], b[1], '#ff00ff', 2)
      }
      let lx
      let ly
      if (K.light.off) {
        // In from the frame's corner on the light's side: a sun mark, and the path of its rays.
        const [dx, dy] = K.light.dir
        lx = W * 0.04
        ly = H * 0.06
        h.fillStyle = '#ffe600'
        h.beginPath()
        h.arc(lx, ly, 18, 0, Math.PI * 2)
        h.fill()
        arrow(lx + dx * 26, ly + dy * 26, lx + dx * 170, ly + dy * 170, '#ffe600', 6)
      } else {
        ;[lx, ly] = P(K.light.x, K.light.y)
        h.strokeStyle = '#ffe600'
        h.lineWidth = 4
        h.beginPath()
        h.arc(lx, ly, 34, 0, Math.PI * 2)
        h.stroke()
        // Toward us: the light comes out of the picture.
        arrow(lx, ly + 36, lx, ly + 110, '#ffe600', 5)
      }
      h.font = 'bold 22px sans-serif'
      h.fillStyle = '#000'
      h.fillText(K.label, 22, H - 18)
      h.fillStyle = '#ffe600'
      h.fillText(K.label, 20, H - 20)
      return [v.toDataURL('image/png'), c.toDataURL('image/png')]
    },
    [src, keys[m]],
  )
  for (const [n, u] of [['value', value], ['light', light]]) {
    const f = path.join(HERE, 'out', 'debug', m + '-' + n + '.png')
    fs.writeFileSync(f, Buffer.from(u.split(',')[1], 'base64'))
    console.log(f)
  }
}
await browser.close()
