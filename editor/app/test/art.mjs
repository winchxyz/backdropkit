// Test art for the editor: a PNG "photo", a PNG sprite with transparency, and an animated GIF.
// Tiny encoders (PNG via zlib, GIF with a 9-bit LZW that clears often), no dependencies.
import zlib from 'node:zlib'

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8)
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
// rgba: Uint8Array w*h*4
export function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1)
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const mix = (a, b, t) => a + (b - a) * t
// A landscape "photo": a dusk gradient sky, a sun, two ridges, a lake, with a little noise.
export function photo(w = 480, h = 300) {
  const d = new Uint8Array(w * h * 4)
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = y / h
      let r = mix(40, 250, t * 1.2)
      let g = mix(50, 150, t)
      let b = mix(120, 110, t)
      const sx = w * 0.62
      const sy = h * 0.42
      const ds = Math.hypot(x - sx, y - sy)
      if (ds < 34) (r = 255), (g = 225), (b = 160)
      else if (ds < 90) {
        const k = 1 - (ds - 34) / 56
        r = mix(r, 255, k * 0.5)
        g = mix(g, 200, k * 0.4)
      }
      const r1 = h * 0.55 + Math.sin(x / 37) * 18 + Math.sin(x / 11) * 5
      const r2 = h * 0.66 + Math.sin(x / 53 + 2) * 14 + Math.sin(x / 7) * 3
      if (y > r1) (r = 92), (g = 60), (b = 96)
      if (y > r2) (r = 46), (g = 34), (b = 58)
      if (y > h * 0.8) {
        const k = (y - h * 0.8) / (h * 0.2)
        r = mix(200, 60, k)
        g = mix(120, 50, k)
        b = mix(110, 90, k)
        if (Math.abs(x - sx) < 30 - k * 20 && (y & 3) < 2) (r = 255), (g = 210), (b = 150)
      }
      const n = (rnd() - 0.5) * 10
      const i = (y * w + x) * 4
      d[i] = Math.max(0, Math.min(255, r + n))
      d[i + 1] = Math.max(0, Math.min(255, g + n))
      d[i + 2] = Math.max(0, Math.min(255, b + n))
      d[i + 3] = 255
    }
  }
  return png(w, h, d)
}
// A sprite with its own transparency: a round lantern with a handle.
export function sprite(w = 96, h = 128) {
  const d = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const cx = w / 2
      const body = Math.hypot((x - cx) / 36, (y - 78) / 42) < 1
      const handle = Math.abs(Math.hypot(x - cx, y - 34) - 18) < 3 && y < 36
      const cap = Math.abs(x - cx) < 22 && y > 34 && y < 42
      if (body) {
        const glow = 1 - Math.hypot(x - cx, y - 80) / 44
        d[i] = 255
        d[i + 1] = 140 + glow * 100
        d[i + 2] = 40 + glow * 80
        d[i + 3] = 255
      } else if (handle || cap) {
        d[i] = 40
        d[i + 1] = 36
        d[i + 2] = 44
        d[i + 3] = 255
      }
    }
  }
  return png(w, h, d)
}

// An animated GIF: a ball bouncing, `n` frames.
export function gif(w = 64, h = 48, n = 4) {
  const pal = [[0, 0, 0], [255, 255, 255], [230, 80, 60], [60, 90, 200], [250, 200, 70]]
  const parts = []
  const u16 = v => [v & 255, (v >> 8) & 255]
  parts.push(Buffer.from('GIF89a', 'ascii'), Buffer.from([...u16(w), ...u16(h), 0xf7, 0, 0]))
  const gct = Buffer.alloc(256 * 3)
  pal.forEach((c, k) => gct.set(c, k * 3))
  parts.push(gct)
  parts.push(Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'ascii'), 0x03, 0x01, 0, 0, 0]))
  for (let f = 0; f < n; f++) {
    const idx = new Uint8Array(w * h)
    const bx = 10 + (f * (w - 20)) / Math.max(1, n - 1)
    const by = h - 12 - Math.abs(Math.sin((f / n) * Math.PI)) * 22
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let c = 0
        if (Math.hypot(x - bx, y - by) < 8) c = f % 2 ? 2 : 4
        else if (y > h - 4) c = 3
        idx[y * w + x] = c
      }
    }
    // Graphic control: 12/100 s, dispose to background, colour 0 transparent.
    parts.push(Buffer.from([0x21, 0xf9, 0x04, 0x09, ...u16(12), 0, 0]))
    parts.push(Buffer.from([0x2c, 0, 0, 0, 0, ...u16(w), ...u16(h), 0]))
    parts.push(Buffer.from([8]))
    parts.push(lzw(idx))
  }
  parts.push(Buffer.from([0x3b]))
  return Buffer.concat(parts)
}
function lzw(idx) {
  const codes = []
  const CLEAR = 256
  const END = 257
  codes.push(CLEAR)
  let since = 0
  for (const v of idx) {
    codes.push(v)
    if (++since === 100) {
      codes.push(CLEAR)
      since = 0
    }
  }
  codes.push(END)
  const bytes = []
  let acc = 0
  let bits = 0
  for (const c of codes) {
    acc |= c << bits
    bits += 9
    while (bits >= 8) {
      bytes.push(acc & 255)
      acc >>>= 8
      bits -= 8
    }
  }
  if (bits) bytes.push(acc & 255)
  const out = []
  for (let i = 0; i < bytes.length; i += 255) {
    const blk = bytes.slice(i, i + 255)
    out.push(blk.length, ...blk)
  }
  out.push(0)
  return Buffer.from(out)
}
