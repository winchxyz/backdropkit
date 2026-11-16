// A small GIF89a writer for the tests, ported from Nightgrain's GifWriter (js/gif.js; MIT, same
// author), returning bytes instead of a Blob. Frames are palette indices; a frame may be a
// sub-rectangle, interlaced, with its own disposal and transparent index.

class Bytes {
  constructor() {
    this.buf = new Uint8Array(1 << 16)
    this.len = 0
  }
  need(n) {
    if (this.len + n <= this.buf.length) return
    let cap = this.buf.length * 2
    while (cap < this.len + n) cap *= 2
    const next = new Uint8Array(cap)
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
  }
  u8(v) {
    this.need(1)
    this.buf[this.len++] = v
  }
  u16(v) {
    this.u8(v & 255)
    this.u8((v >> 8) & 255)
  }
  str(s) {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i))
  }
  set(arr, n = arr.length) {
    this.need(n)
    this.buf.set(arr.subarray(0, n), this.len)
    this.len += n
  }
}

// Plain LZW with a Map dictionary (speed does not matter here).
function lzw(minCode, px, out) {
  const clear = 1 << minCode
  const eoi = clear + 1
  let size = minCode + 1
  let next = eoi + 1
  let cur = 0
  let bits = 0
  const block = new Uint8Array(255)
  let bl = 0
  const flush = () => {
    if (bl) {
      out.u8(bl)
      out.set(block, bl)
      bl = 0
    }
  }
  const emit = code => {
    cur |= code << bits
    bits += size
    while (bits >= 8) {
      block[bl++] = cur & 255
      cur >>>= 8
      bits -= 8
      if (bl === 255) flush()
    }
  }
  let dict = new Map()
  out.u8(minCode)
  emit(clear)
  let prefix = px[0]
  for (let i = 1; i < px.length; i++) {
    const k = px[i]
    const key = prefix * 256 + k
    const hit = dict.get(key)
    if (hit !== undefined) {
      prefix = hit
      continue
    }
    emit(prefix)
    if (next === 4096) {
      emit(clear)
      dict = new Map()
      next = eoi + 1
      size = minCode + 1
    } else {
      if (next >= 1 << size) size++
      dict.set(key, next++)
    }
    prefix = k
  }
  emit(prefix)
  emit(eoi)
  if (bits > 0) {
    block[bl++] = cur & 255
    if (bl === 255) flush()
  }
  flush()
  out.u8(0)
}

const interlaceRows = h => {
  const rows = []
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) rows.push(y)
  return rows
}

export class GifWriter {
  // palette: [[r, g, b], ...] (2..256 colours).
  constructor(width, height, palette) {
    this.w = width
    this.h = height
    let bitsN = 1
    while (1 << bitsN < palette.length) bitsN++
    this.minCode = Math.max(2, bitsN)
    const o = (this.out = new Bytes())
    o.str('GIF89a')
    o.u16(width)
    o.u16(height)
    o.u8(0x80 | ((bitsN - 1) << 4) | (bitsN - 1))
    o.u8(0)
    o.u8(0)
    const table = new Uint8Array(3 << bitsN)
    palette.forEach((c, i) => table.set(c, i * 3))
    o.set(table)
    o.u8(0x21)
    o.u8(0xff)
    o.u8(11)
    o.str('NETSCAPE2.0')
    o.u8(3)
    o.u8(1)
    o.u16(0)
    o.u8(0)
  }

  // indices: Uint8Array(fw * fh) for the rectangle (x, y, fw, fh); delay in ms.
  addFrame(indices, delay, { x = 0, y = 0, fw = this.w, fh = this.h, transparent = -1, dispose = 1, interlace = false } = {}) {
    const o = this.out
    o.u8(0x21)
    o.u8(0xf9)
    o.u8(4)
    o.u8((dispose << 2) | (transparent >= 0 ? 1 : 0))
    o.u16(Math.max(2, Math.round(delay / 10)))
    o.u8(transparent >= 0 ? transparent : 0)
    o.u8(0)
    o.u8(0x2c)
    o.u16(x)
    o.u16(y)
    o.u16(fw)
    o.u16(fh)
    o.u8(interlace ? 0x40 : 0)
    let px = indices
    if (interlace) {
      px = new Uint8Array(indices.length)
      interlaceRows(fh).forEach((src, i) => px.set(indices.subarray(src * fw, src * fw + fw), i * fw))
    }
    lzw(this.minCode, px, o)
  }

  finish() {
    this.out.u8(0x3b)
    return this.out.buf.slice(0, this.out.len)
  }
}
