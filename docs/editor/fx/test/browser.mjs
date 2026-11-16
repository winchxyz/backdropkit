// node editor/fx/test/browser.mjs : the browser helpers (browser.js) in headless Chromium.
// Serves editor/ on a local port and imports fx/browser.js in a page: stills are scaled to 960
// px, an animated GIF keeps 48 evenly spaced frames at 480 px with its timing, an animated PNG
// goes through ImageDecoder, transparency survives the PNG round trip, and previewLook draws.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import zlib from 'node:zlib'
import { getPage, closeBrowser, HERE } from './helpers.mjs'
import { GifWriter } from './gifwriter.mjs'

const EDITOR = path.resolve(HERE, '../..')
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><title>fx</title><body></body>')
    return
  }
  const file = path.join(EDITOR, url)
  if (!file.startsWith(EDITOR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port + '/'

// An animated GIF: n frames of w x h, frame i a solid colour from a 4-colour palette, with a
// transparent hole in the middle of every frame.
function gifBytes(n, w, h, delay) {
  const g = new GifWriter(w, h, [[0, 0, 0], [220, 40, 40], [40, 200, 60], [40, 80, 220]])
  for (let i = 0; i < n; i++) {
    const px = new Uint8Array(w * h).fill(1 + (i % 3))
    for (let y = (h / 2 - 4) | 0; y < h / 2 + 4; y++) for (let x = (w / 2 - 4) | 0; x < w / 2 + 4; x++) px[y * w + x] = 0
    g.addFrame(px, delay, { transparent: 0, dispose: 2 })
  }
  return g.finish()
}

// An animated PNG of three solid frames (red, green, blue), 100 ms each.
function apngBytes(w, h) {
  const table = new Int32Array(256).map((_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c
  })
  const crc = b => {
    let c = -1
    for (const v of b) c = table[(c ^ v) & 255] ^ (c >>> 8)
    return (c ^ -1) >>> 0
  }
  const chunk = (type, data) => {
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const u32 = (...v) => {
    const b = Buffer.alloc(4 * v.length)
    v.forEach((x, i) => b.writeUInt32BE(x, 4 * i))
    return b
  }
  const image = rgb => {
    const raw = Buffer.alloc((w * 4 + 1) * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([...rgb, 255], y * (w * 4 + 1) + 1 + x * 4)
    return zlib.deflateSync(raw)
  }
  const ihdr = Buffer.concat([u32(w, h), Buffer.from([8, 6, 0, 0, 0])])
  const fctl = seq => Buffer.concat([u32(seq, w, h, 0, 0), Buffer.from([0, 1, 0, 10, 0, 0])])
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('acTL', u32(3, 0))]
  let seq = 0
  ;[[255, 0, 0], [0, 255, 0], [0, 0, 255]].forEach((rgb, i) => {
    parts.push(chunk('fcTL', fctl(seq++)))
    if (i === 0) parts.push(chunk('IDAT', image(rgb)))
    else parts.push(chunk('fdAT', Buffer.concat([u32(seq++), image(rgb)])))
  })
  parts.push(chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(parts)
}

let failed = 0
const check = (name, fn) => {
  try {
    fn()
    console.log('ok   ', name)
  } catch (e) {
    failed++
    console.log('FAIL ', name, '\n      ', e.message.split('\n').join('\n       '))
  }
}

const page = await (await getPage()).context().browser().newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.goto(base)
const r = await page.evaluate(
  async ([gif, gifSmall, apng]) => {
    const fx = await import('/fx/browser.js')
    const core = await import('/fx/index.js')
    const bin = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    const canvasBlob = (w, h, type, draw) =>
      new Promise(res => {
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        draw(c.getContext('2d'), w, h)
        c.toBlob(res, type, 0.92)
      })
    const gradient = (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, h)
      gr.addColorStop(0, '#203060')
      gr.addColorStop(1, '#f0c080')
      g.fillStyle = gr
      g.fillRect(0, 0, w, h)
    }
    const out = {}
    // A big PNG still.
    const big = new File([await canvasBlob(2000, 1000, 'image/png', gradient)], 'big.png', { type: 'image/png' })
    const a = await fx.decodeAsset(big)
    out.big = { name: a.name, w: a.w, h: a.h, n: a.frames.length, delay: a.frames[0].delay, b64: /^[A-Za-z0-9+/]+=*$/.test(a.frames[0].png) }
    const rgba = await fx.rgbaFromFrame(a.frames[0])
    out.bigRgba = { w: rgba.w, h: rgba.h, len: rgba.data.length }
    // A small JPEG still keeps its size; a WebP still decodes.
    const jpg = await fx.decodeAsset(new File([await canvasBlob(300, 200, 'image/jpeg', gradient)], 'small.jpg', { type: 'image/jpeg' }))
    out.jpg = { w: jpg.w, h: jpg.h, n: jpg.frames.length }
    const webp = await fx.decodeAsset(new File([await canvasBlob(500, 1200, 'image/webp', gradient)], 'tall.webp', { type: 'image/webp' }))
    out.webp = { w: webp.w, h: webp.h, n: webp.frames.length }
    // A long animated GIF.
    const g = await fx.decodeAsset(new File([bin(gif)], 'walk.gif', { type: 'image/gif' }))
    out.gif = { w: g.w, h: g.h, n: g.frames.length, total: g.frames.reduce((s, f) => s + f.delay, 0), delays: g.frames.slice(0, 3).map(f => f.delay) }
    const f0 = await fx.rgbaFromFrame(g.frames[0])
    const at = (r, x, y) => Array.from(r.data.subarray((y * r.w + x) * 4, (y * r.w + x) * 4 + 4))
    out.gifPx = { corner: at(f0, 2, 2), hole: at(f0, f0.w >> 1, f0.h >> 1) }
    // A short GIF keeps every frame at its own size.
    const s = await fx.decodeAsset(new Blob([bin(gifSmall)]), { name: 'blink.gif' })
    out.gifSmall = { name: s.name, w: s.w, h: s.h, n: s.frames.length, delays: s.frames.map(f => f.delay) }
    // An animated PNG through ImageDecoder (or its first frame where there is none).
    out.hasDecoder = typeof ImageDecoder !== 'undefined'
    const p = await fx.decodeAsset(new File([bin(apng)], 'rgb.png', { type: 'image/png' }))
    const pf = await Promise.all(p.frames.map(fx.rgbaFromFrame))
    out.apng = { w: p.w, h: p.h, n: p.frames.length, delays: p.frames.map(f => f.delay), colours: pf.map(r => at(r, 1, 1)) }
    // previewLook on a placed asset.
    const placed = core.placeAsset(rgba, core.fitPlace(rgba.w, rgba.h, 320, 200, true))
    const c = fx.previewLook(placed, core.LOOK_PRESETS[0].look, 2)
    out.preview = { w: c.width, h: c.height, colours: c.look.colors.length, painted: at({ w: c.width, data: c.getContext('2d').getImageData(0, 0, c.width, c.height).data }, 10, 10)[3] }
    return out
  },
  [Buffer.from(gifBytes(100, 600, 300, 40)).toString('base64'), Buffer.from(gifBytes(5, 120, 80, 70)).toString('base64'), apngBytes(40, 30).toString('base64')],
)

check('a big PNG still is scaled to 960 px on its longer side, base64 PNG, one frame', () => {
  assert.deepEqual([r.big.name, r.big.w, r.big.h, r.big.n], ['big.png', 960, 480, 1])
  assert.ok(r.big.b64)
  assert.deepEqual(r.bigRgba, { w: 960, h: 480, len: 960 * 480 * 4 })
})
check('a small JPEG keeps its size; a WebP still decodes', () => {
  assert.deepEqual(r.jpg, { w: 300, h: 200, n: 1 })
  assert.deepEqual(r.webp, { w: 400, h: 960, n: 1 })
})
check('a 100-frame GIF keeps 48 frames at 480 px and its total time', () => {
  assert.equal(r.gif.n, 48)
  assert.deepEqual([r.gif.w, r.gif.h], [480, 240])
  assert.equal(r.gif.total, 4000)
  for (const d of r.gif.delays) assert.ok(d === 80 || d === 120, 'delay ' + d)
})
check('GIF colours and transparency survive the PNG round trip', () => {
  assert.deepEqual(r.gifPx.corner, [220, 40, 40, 255])
  assert.equal(r.gifPx.hole[3], 0)
})
check('a short GIF keeps every frame, its size and delays', () => {
  assert.deepEqual(r.gifSmall, { name: 'blink.gif', w: 120, h: 80, n: 5, delays: [70, 70, 70, 70, 70] })
})
check('an animated PNG gives its frames through ImageDecoder', () => {
  if (!r.hasDecoder) {
    console.log('       (no ImageDecoder here: first frame only)')
    assert.equal(r.apng.n, 1)
    return
  }
  assert.deepEqual([r.apng.w, r.apng.h, r.apng.n], [40, 30, 3])
  assert.deepEqual(r.apng.delays, [100, 100, 100])
  assert.deepEqual(r.apng.colours, [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]])
})
check('previewLook draws the look at its scale', () => {
  assert.deepEqual([r.preview.w, r.preview.h], [640, 400])
  assert.ok(r.preview.colours > 1)
  assert.equal(r.preview.painted, 255)
})
check('no page errors', () => assert.deepEqual(errors, []))

await page.close()
await closeBrowser()
server.close()
console.log(failed ? failed + ' failed' : 'all passed')
process.exit(failed ? 1 : 0)
