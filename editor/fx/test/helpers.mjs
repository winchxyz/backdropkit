// Test helpers for editor/fx: a headless Chromium (playwright-core from the backdropkit folder)
// to decode JPEGs and to draw test pictures, a small PNG writer, and labelled contact sheets.
// Output goes to FX_OUT (default: <tmp>/fx-out).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, '../../..')
export const OUT = process.env.FX_OUT ?? path.join(os.tmpdir(), 'fx-out')
fs.mkdirSync(OUT, { recursive: true })

let browser = null
let page = null
export async function getPage() {
  if (page) return page
  const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
  const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
  const dir = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
  const build = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().pop()
  browser = await chromium.launch({ executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe') })
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  await page.setContent('<!doctype html><body style="margin:0"></body>')
  return page
}
export async function closeBrowser() {
  if (browser) await browser.close()
  browser = page = null
}

const fromB64 = (b64, w, h) => ({ w, h, data: new Uint8ClampedArray(Buffer.from(b64, 'base64')) })

// Any image file the browser can read -> { w, h, data } RGBA.
export async function decodeImage(file) {
  const pg = await getPage()
  const ext = path.extname(file).slice(1).toLowerCase()
  const mime = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext
  const b64 = fs.readFileSync(file).toString('base64')
  const r = await pg.evaluate(async ([b64, mime]) => {
    const img = new Image()
    img.src = 'data:' + mime + ';base64,' + b64
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    let s = ''
    for (let i = 0; i < d.length; i += 32768) s += String.fromCharCode.apply(null, d.subarray(i, i + 32768))
    return { w: c.width, h: c.height, b64: btoa(s) }
  }, [b64, mime])
  return fromB64(r.b64, r.w, r.h)
}

// Test pictures drawn with canvas: a photo-like landscape, a sprite on transparency, a sticker
// on white and a painterly abstract. Deterministic (seeded).
export async function drawPictures() {
  const pg = await getPage()
  const res = await pg.evaluate(() => {
    let seed = 7
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }
    const grab = c => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      let s = ''
      for (let i = 0; i < d.length; i += 32768) s += String.fromCharCode.apply(null, d.subarray(i, i + 32768))
      return { w: c.width, h: c.height, b64: btoa(s) }
    }
    const canvas = (w, h) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      return [c, c.getContext('2d')]
    }
    const grain = (c, amt) => {
      const g = c.getContext('2d')
      const im = g.getImageData(0, 0, c.width, c.height)
      const d = im.data
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue
        const n = (rnd() - 0.5) * amt
        d[i] += n
        d[i + 1] += n
        d[i + 2] += n
      }
      g.putImageData(im, 0, 0)
    }
    const ridge = (w, base, amp, rough) => {
      const pts = []
      let v = 0
      for (let x = 0; x <= w; x += 4) {
        v += (rnd() - 0.5) * rough
        v *= 0.97
        pts.push([x, base + Math.sin(x / 90) * amp + Math.sin(x / 37 + 1) * amp * 0.4 + v])
      }
      return pts
    }
    const out = {}

    // 1. Landscape at sunset, photo-like.
    {
      const W = 640
      const H = 400
      const [c, g] = canvas(W, H)
      let gr = g.createLinearGradient(0, 0, 0, 260)
      gr.addColorStop(0, '#1b2f63')
      gr.addColorStop(0.45, '#5a5f9a')
      gr.addColorStop(0.75, '#e9906a')
      gr.addColorStop(1, '#f8d18c')
      g.fillStyle = gr
      g.fillRect(0, 0, W, 260)
      gr = g.createRadialGradient(455, 205, 4, 455, 205, 150)
      gr.addColorStop(0, 'rgba(255,250,220,1)')
      gr.addColorStop(0.12, 'rgba(255,236,170,0.95)')
      gr.addColorStop(0.4, 'rgba(255,190,120,0.35)')
      gr.addColorStop(1, 'rgba(255,170,100,0)')
      g.fillStyle = gr
      g.fillRect(0, 0, W, 300)
      g.filter = 'blur(9px)'
      for (let i = 0; i < 9; i++) {
        g.fillStyle = 'rgba(' + (230 + rnd() * 25) + ',' + (170 + rnd() * 50) + ',' + (160 + rnd() * 40) + ',' + (0.35 + rnd() * 0.3) + ')'
        g.beginPath()
        g.ellipse(rnd() * W, 40 + rnd() * 120, 60 + rnd() * 90, 10 + rnd() * 14, 0, 0, 7)
        g.fill()
      }
      g.filter = 'none'
      const far = ridge(W, 215, 18, 10)
      gr = g.createLinearGradient(0, 160, 0, 270)
      gr.addColorStop(0, '#6c5b8f')
      gr.addColorStop(1, '#a9839c')
      g.fillStyle = gr
      g.beginPath()
      g.moveTo(0, 300)
      for (const [x, y] of far) g.lineTo(x, y)
      g.lineTo(W, 300)
      g.fill()
      const near = ridge(W, 255, 14, 14)
      gr = g.createLinearGradient(0, 220, 0, 290)
      gr.addColorStop(0, '#2f4a3a')
      gr.addColorStop(1, '#1d2e26')
      g.fillStyle = gr
      g.beginPath()
      g.moveTo(0, 300)
      for (const [x, y] of near) g.lineTo(x, y)
      g.lineTo(W, 300)
      g.fill()
      // Lake: the sky flipped, darker, with ripples.
      g.save()
      g.translate(0, 560)
      g.scale(1, -1)
      g.globalAlpha = 0.75
      g.drawImage(c, 0, 0, W, 270, 0, 0, W, 270)
      g.restore()
      g.fillStyle = 'rgba(20,30,60,0.35)'
      g.fillRect(0, 290, W, 110)
      for (let i = 0; i < 160; i++) {
        const y = 292 + rnd() * 108
        g.strokeStyle = rnd() < 0.5 ? 'rgba(255,220,170,' + (0.15 + rnd() * 0.3) + ')' : 'rgba(10,20,45,' + (0.2 + rnd() * 0.3) + ')'
        g.lineWidth = 1 + rnd() * 1.5
        g.beginPath()
        const x = rnd() * W
        g.moveTo(x, y)
        g.lineTo(x + 20 + rnd() * 80, y)
        g.stroke()
      }
      // Pines on the left shore.
      for (let i = 0; i < 14; i++) {
        const x = rnd() * 220 - 10
        const base = 300 + rnd() * 20
        const hgt = 70 + rnd() * 90
        g.fillStyle = 'rgb(' + (14 + rnd() * 12) + ',' + (32 + rnd() * 18) + ',' + (26 + rnd() * 10) + ')'
        for (let k = 0; k < 5; k++) {
          const t = k / 5
          const wd = (1 - t) * hgt * 0.32
          g.beginPath()
          g.moveTo(x, base - hgt)
          g.lineTo(x - wd, base - t * hgt * 0.8)
          g.lineTo(x + wd, base - t * hgt * 0.8)
          g.fill()
        }
        g.fillRect(x - 2, base - 10, 4, 12)
      }
      // A rock on the right.
      g.fillStyle = '#2a2730'
      g.beginPath()
      g.ellipse(560, 330, 70, 26, 0, Math.PI, 0)
      g.fill()
      grain(c, 16)
      out.landscape = grab(c)
    }

    // 2. A sprite on transparency: a round cat.
    {
      const [c, g] = canvas(360, 360)
      const body = g.createRadialGradient(160, 170, 20, 180, 210, 150)
      body.addColorStop(0, '#ffc773')
      body.addColorStop(0.7, '#f08a2a')
      body.addColorStop(1, '#b4561a')
      g.fillStyle = body
      g.beginPath()
      g.moveTo(85, 120)
      g.lineTo(110, 40)
      g.lineTo(150, 100)
      g.lineTo(210, 100)
      g.lineTo(250, 40)
      g.lineTo(275, 120)
      g.ellipse(180, 210, 120, 110, 0, -0.35, Math.PI + 0.35)
      g.closePath()
      g.fill()
      g.fillStyle = '#ffd9e0'
      g.beginPath()
      g.moveTo(112, 62)
      g.lineTo(135, 100)
      g.lineTo(104, 108)
      g.fill()
      g.beginPath()
      g.moveTo(248, 62)
      g.lineTo(225, 100)
      g.lineTo(256, 108)
      g.fill()
      g.fillStyle = '#fff3df'
      g.beginPath()
      g.ellipse(180, 250, 70, 55, 0, 0, 7)
      g.fill()
      for (const ex of [135, 225]) {
        g.fillStyle = '#ffffff'
        g.beginPath()
        g.ellipse(ex, 175, 24, 28, 0, 0, 7)
        g.fill()
        g.fillStyle = '#2b6f4f'
        g.beginPath()
        g.ellipse(ex + 3, 178, 15, 20, 0, 0, 7)
        g.fill()
        g.fillStyle = '#111'
        g.beginPath()
        g.ellipse(ex + 4, 180, 7, 13, 0, 0, 7)
        g.fill()
        g.fillStyle = '#fff'
        g.beginPath()
        g.arc(ex + 9, 170, 4, 0, 7)
        g.fill()
      }
      g.fillStyle = '#e8607a'
      g.beginPath()
      g.moveTo(170, 218)
      g.lineTo(190, 218)
      g.lineTo(180, 230)
      g.fill()
      g.strokeStyle = '#5a2c14'
      g.lineWidth = 3
      g.beginPath()
      g.moveTo(180, 230)
      g.quadraticCurveTo(170, 245, 158, 238)
      g.moveTo(180, 230)
      g.quadraticCurveTo(190, 245, 202, 238)
      g.stroke()
      g.strokeStyle = 'rgba(255,255,255,0.8)'
      g.lineWidth = 2
      for (const s of [-1, 1]) for (const k of [-1, 0, 1]) {
        g.beginPath()
        g.moveTo(180 + s * 40, 232 + k * 8)
        g.lineTo(180 + s * 95, 225 + k * 16)
        g.stroke()
      }
      // Stripes.
      g.strokeStyle = 'rgba(150,70,20,0.55)'
      g.lineWidth = 7
      for (const x of [150, 180, 210]) {
        g.beginPath()
        g.moveTo(x, 105)
        g.lineTo(x + (x - 180) * 0.3, 140)
        g.stroke()
      }
      out.sprite = grab(c)
    }

    // 3. A sticker on white (for cut 'auto').
    {
      const [c, g] = canvas(480, 360)
      g.fillStyle = '#ffffff'
      g.fillRect(0, 0, 480, 360)
      g.fillStyle = '#4c9a3a'
      for (let i = 0; i < 40; i++) {
        g.beginPath()
        const x = 150 + rnd() * 180
        g.moveTo(x, 300)
        g.lineTo(x + (rnd() - 0.5) * 30, 250 + rnd() * 25)
        g.lineTo(x + 6, 300)
        g.fill()
      }
      const stem = g.createLinearGradient(200, 0, 280, 0)
      stem.addColorStop(0, '#e8dcc0')
      stem.addColorStop(1, '#bfae8a')
      g.fillStyle = stem
      g.fillRect(205, 170, 70, 125)
      const cap = g.createRadialGradient(220, 120, 10, 240, 160, 150)
      cap.addColorStop(0, '#ff6b5a')
      cap.addColorStop(1, '#a3161c')
      g.fillStyle = cap
      g.beginPath()
      g.ellipse(240, 175, 140, 110, 0, Math.PI, 0)
      g.fill()
      g.fillStyle = '#fff6ec'
      for (const [x, y, r] of [[180, 120, 18], [250, 95, 14], [305, 135, 20], [140, 160, 12], [220, 150, 10], [340, 165, 9]]) {
        g.beginPath()
        g.arc(x, y, r, 0, 7)
        g.fill()
      }
      grain(c, 6)
      out.sticker = grab(c)
    }

    // 4. A painterly abstract: brush strokes over a gradient.
    {
      const [c, g] = canvas(640, 400)
      const gr = g.createLinearGradient(0, 0, 640, 400)
      gr.addColorStop(0, '#173a5c')
      gr.addColorStop(0.5, '#3f7a8c')
      gr.addColorStop(1, '#e3b26a')
      g.fillStyle = gr
      g.fillRect(0, 0, 640, 400)
      g.lineCap = 'round'
      const pal = ['#f4e3c1', '#e07a5f', '#3d405b', '#81b29a', '#f2cc8f', '#2a6f97', '#c44536', '#fefae0']
      for (let i = 0; i < 420; i++) {
        const x = rnd() * 640
        const y = rnd() * 400
        const a = rnd() * Math.PI * 2
        const len = 20 + rnd() * 70
        g.strokeStyle = pal[(rnd() * pal.length) | 0]
        g.globalAlpha = 0.35 + rnd() * 0.5
        g.lineWidth = 4 + rnd() * 16
        g.beginPath()
        g.moveTo(x, y)
        g.quadraticCurveTo(x + Math.cos(a + 0.6) * len * 0.6, y + Math.sin(a + 0.6) * len * 0.6, x + Math.cos(a) * len, y + Math.sin(a) * len)
        g.stroke()
      }
      g.globalAlpha = 1
      grain(c, 10)
      out.painting = grab(c)
    }
    return out
  })
  const pics = {}
  for (const k in res) pics[k] = fromB64(res[k].b64, res[k].w, res[k].h)
  return pics
}

/* ---------- PNG ---------- */

const CRC = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC[n] = c >>> 0
}
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
export function pngBytes(rgba) {
  const { w, h, data } = rgba
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    Buffer.from(data.buffer, data.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
export function writePng(file, rgba) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, pngBytes(rgba))
  return file
}

// A labelled contact sheet of PNG files: items [{ file, label }], `cols` across, each shown at
// `cellW` wide (pixelated). Saved as a PNG screenshot.
export async function sheet(items, file, { cols = 4, cellW = 480, bg = '#202024', title = '' } = {}) {
  const pg = await getPage()
  const imgs = items.map(it => ({ src: 'data:image/png;base64,' + fs.readFileSync(it.file).toString('base64'), label: it.label }))
  const html =
    '<!doctype html><html><body style="margin:0;background:' + bg + ';font:13px Inter,sans-serif;color:#ddd">' +
    (title ? '<div style="padding:10px 12px;font-size:15px;color:#fff">' + title + '</div>' : '') +
    '<div style="display:grid;grid-template-columns:repeat(' + cols + ',' + cellW + 'px);gap:10px;padding:10px">' +
    imgs.map(i => '<figure style="margin:0"><img src="' + i.src + '" style="width:' + cellW + 'px;image-rendering:pixelated;display:block;background:repeating-conic-gradient(#3a3a40 0 25%,#2c2c31 0 50%) 0 0/16px 16px"><figcaption style="padding:4px 2px">' + i.label + '</figcaption></figure>').join('') +
    '</div></body></html>'
  await pg.setViewportSize({ width: cols * (cellW + 10) + 10, height: 600 })
  await pg.setContent(html)
  await pg.evaluate(() => Promise.all([...document.images].map(i => i.decode())))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  await pg.screenshot({ path: file, fullPage: true })
  return file
}

// The test pictures placed on the 320 x 200 grid: every theme still in docs/thumbs (to cover)
// and the drawn ones (landscape and painting to cover, sprite and sticker small, on
// transparency). With FX_CACHE set to a folder, decoded pictures are kept there as raw RGBA so
// later runs need no browser. Returns { name: rgba }.
export async function loadPictures({ thumbs = true, drawn = true } = {}) {
  const { placeAsset, fitPlace } = await import('../index.js')
  const cache = process.env.FX_CACHE ?? null
  const out = {}
  const fromCache = name => {
    if (!cache) return null
    const f = path.join(cache, name + '.rgba')
    if (!fs.existsSync(f)) return null
    const { w, h } = JSON.parse(fs.readFileSync(path.join(cache, name + '.json'), 'utf8'))
    return { w, h, data: new Uint8ClampedArray(fs.readFileSync(f)) }
  }
  const toCache = (name, rgba) => {
    if (!cache) return
    fs.mkdirSync(cache, { recursive: true })
    fs.writeFileSync(path.join(cache, name + '.rgba'), Buffer.from(rgba.data.buffer, rgba.data.byteOffset, rgba.data.length))
    fs.writeFileSync(path.join(cache, name + '.json'), JSON.stringify({ w: rgba.w, h: rgba.h }))
  }
  const cover = img => placeAsset(img, fitPlace(img.w, img.h, 320, 200, true))
  if (thumbs) {
    const dir = path.join(ROOT, 'docs/thumbs')
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).sort()) {
      const name = f.slice(0, -4)
      let img = fromCache(name)
      if (!img) toCache(name, (img = cover(await decodeImage(path.join(dir, f)))))
      out[name] = img
    }
  }
  if (drawn) {
    const names = ['landscape', 'painting', 'sprite', 'sticker']
    let d = null
    for (const name of names) {
      let img = fromCache(name)
      if (!img) {
        d ??= await drawPictures()
        const src = d[name]
        img = name === 'sprite' ? placeAsset(src, { x: 70, y: 8, scale: 0.5 }) : name === 'sticker' ? placeAsset(src, { x: 60, y: 10, scale: 0.5 }) : cover(src)
        toCache(name, img)
      }
      out[name] = img
    }
  }
  return out
}

// Cells as the exporter's encoder takes them, and the encoder's own measure of the layer.
export async function encoderCost(cells, colors, w = 320, h = 200) {
  const enc = await import(pathToFileURL(path.join(ROOT, 'editor/lib/encode.js')).href)
  const { FN, at, emitSafe, costOf } = enc
  const col = new Int32Array(FN).fill(-1)
  const list = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = cells[y * w + x]
      if (!v) continue
      const k = at(x, y)
      col[k] = v - 1
      list.push(k)
    }
  }
  const rgb = new Int16Array(colors.length * 3)
  const lum = []
  colors.forEach((hx, i) => {
    const n = parseInt(hx.slice(1), 16)
    rgb[3 * i] = (n >> 16) & 255
    rgb[3 * i + 1] = (n >> 8) & 255
    rgb[3 * i + 2] = n & 255
    lum.push(0.2126 * rgb[3 * i] + 0.7152 * rgb[3 * i + 1] + 0.0722 * rgb[3 * i + 2])
  })
  const t = emitSafe({ col, cells: list }, { colors: { hex: colors, rgb, lum } })
  return { chars: costOf(t), runs: t.runs, paths: t.paths }
}
