// A GIF reader, ported from Nightgrain's (js/gif.js, decodeGif / unlzw / interlaceRows; MIT,
// same author). Works on plain bytes, so it runs in the browser and in Node.
//
// gifFrameCount(bytes) -> number of frames, without decoding any.
// decodeGif(bytes, { onFrame, maxFrames = 400 }) -> { w, h, count, frames }
//   Composites every frame onto the logical screen (disposal 0-3, transparency, interlace,
//   local colour tables). With onFrame(rgba, delayMs, index), each composited frame is handed
//   over as it is made (rgba: { w, h, data }, the live screen: copy what you keep) and `frames`
//   is empty; without it, `frames` holds a copy of each: [{ data, delay }].

const sigOf = d => String.fromCharCode(d[0], d[1], d[2], d[3], d[4], d[5])

function header(d) {
  if (d.length < 13) throw new Error('Not a GIF file')
  const sig = sigOf(d)
  if (sig !== 'GIF89a' && sig !== 'GIF87a') throw new Error('Not a GIF file')
  const W = d[6] | (d[7] << 8)
  const H = d[8] | (d[9] << 8)
  const flags = d[10]
  let p = 13
  let gct = null
  if (flags & 0x80) {
    const n = 3 << ((flags & 7) + 1)
    gct = d.subarray(p, p + n)
    p += n
  }
  return { W, H, gct, p }
}

const bytesOf = b => (b instanceof Uint8Array ? b : new Uint8Array(b))

export function gifFrameCount(bytes) {
  const d = bytesOf(bytes)
  let { p } = header(d)
  let n = 0
  const skipBlocks = () => {
    while (p < d.length) {
      const k = d[p++]
      if (!k) break
      p += k
    }
  }
  while (p < d.length) {
    const b = d[p++]
    if (b === 0x3b) break
    if (b === 0x21) {
      p++
      skipBlocks()
      continue
    }
    if (b !== 0x2c) break
    const lf = d[p + 8]
    p += 9
    if (lf & 0x80) p += 3 << ((lf & 7) + 1)
    p++ // LZW minimum code size
    skipBlocks()
    n++
  }
  return n
}

export function decodeGif(bytes, { onFrame = null, maxFrames = 400 } = {}) {
  const d = bytesOf(bytes)
  let { W, H, gct, p } = header(d)
  if (!W || !H) throw new Error('This GIF has no size')
  const u16 = () => {
    const v = d[p] | (d[p + 1] << 8)
    p += 2
    return v
  }
  const frames = []
  const screen = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4) }
  const canvas = screen.data
  let gce = { delay: 10, transparent: -1, dispose: 0 }
  let prev = null
  let count = 0
  const skipBlocks = () => {
    while (p < d.length) {
      const n = d[p++]
      if (!n) break
      p += n
    }
  }
  while (p < d.length && count < maxFrames) {
    const b = d[p++]
    if (b === 0x3b) break
    if (b === 0x21) {
      const label = d[p++]
      if (label === 0xf9) {
        p++
        const f = d[p++]
        const delay = u16()
        const tr = d[p++]
        p++
        gce = { delay: delay || 10, transparent: f & 1 ? tr : -1, dispose: (f >> 2) & 7 }
      } else skipBlocks()
      continue
    }
    if (b !== 0x2c) break
    const x0 = u16()
    const y0 = u16()
    const fw = u16()
    const fh = u16()
    const lf = d[p++]
    let ct = gct
    if (lf & 0x80) {
      const n = 3 << ((lf & 7) + 1)
      ct = d.subarray(p, p + n)
      p += n
    }
    const interlaced = !!(lf & 0x40)
    const minCode = d[p++]
    // The sub-blocks gathered into one stream.
    let total = 0
    let q = p
    while (q < d.length) {
      const n = d[q++]
      if (!n) break
      total += n
      q += n
    }
    const data = new Uint8Array(total)
    let o = 0
    while (p < d.length) {
      const n = d[p++]
      if (!n) break
      data.set(d.subarray(p, p + n), o)
      o += n
      p += n
    }
    const px = new Uint8Array(fw * fh)
    if (minCode >= 1 && minCode <= 11) unlzw(minCode, data, px)
    if (gce.dispose === 3) prev = canvas.slice()
    const rowOf = interlaced ? interlaceRows(fh) : null
    for (let y = 0; y < fh; y++) {
      const ty = y0 + (rowOf ? rowOf[y] : y)
      if (ty >= H) continue
      for (let x = 0; x < fw; x++) {
        const tx = x0 + x
        if (tx >= W) continue
        const k = px[y * fw + x]
        if (k === gce.transparent || !ct || k * 3 + 2 >= ct.length) continue
        const j = (ty * W + tx) * 4
        canvas[j] = ct[k * 3]
        canvas[j + 1] = ct[k * 3 + 1]
        canvas[j + 2] = ct[k * 3 + 2]
        canvas[j + 3] = 255
      }
    }
    const delay = gce.delay * 10
    if (onFrame) onFrame(screen, delay, count)
    else frames.push({ data: canvas.slice(), delay })
    count++
    if (gce.dispose === 2) {
      for (let y = y0; y < Math.min(H, y0 + fh); y++) canvas.fill(0, (y * W + x0) * 4, (y * W + Math.min(W, x0 + fw)) * 4)
    } else if (gce.dispose === 3 && prev) canvas.set(prev)
    gce = { delay: 10, transparent: -1, dispose: 0 }
  }
  return { w: W, h: H, count, frames }
}

function interlaceRows(h) {
  const rows = []
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) rows.push(y)
  return rows
}

function unlzw(minCode, data, out) {
  const clear = 1 << minCode
  const eoi = clear + 1
  const prefix = new Int32Array(4096)
  const suffix = new Uint8Array(4096)
  const stack = new Uint8Array(4097)
  let size = minCode + 1
  let next = eoi + 1
  let mask = (1 << size) - 1
  let cur = 0
  let bits = 0
  let p = 0
  let op = 0
  let prevCode = -1
  let first = 0
  for (let i = 0; i < clear; i++) suffix[i] = i
  while (op < out.length) {
    while (bits < size && p < data.length) {
      cur |= data[p++] << bits
      bits += 8
    }
    if (bits < size) break
    let code = cur & mask
    cur >>>= size
    bits -= size
    if (code === clear) {
      size = minCode + 1
      mask = (1 << size) - 1
      next = eoi + 1
      prevCode = -1
      continue
    }
    if (code === eoi) break
    if (prevCode < 0) {
      out[op++] = suffix[code]
      prevCode = code
      first = code
      continue
    }
    const inCode = code
    let sp = 0
    if (code >= next) {
      stack[sp++] = first
      code = prevCode
    }
    while (code >= clear) {
      stack[sp++] = suffix[code]
      code = prefix[code]
    }
    first = suffix[code]
    stack[sp++] = first
    while (sp > 0 && op < out.length) out[op++] = stack[--sp]
    if (next < 4096) {
      prefix[next] = prevCode
      suffix[next] = first
      next++
      if ((next & mask) === 0 && next < 4096) {
        size++
        mask = (1 << size) - 1
      }
    }
    prevCode = inCode
  }
}
