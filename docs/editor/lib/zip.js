// A zip writer with no dependencies, for the browser and Node: the same format as
// app/tools/zip.mjs (which engine/pack.mjs used before it moved here).
//
// zip([{ name: 'dir/file.txt', data: Uint8Array | string }], { deflate }) -> Uint8Array
//   Names use forward slashes and are marked UTF-8. Every entry gets the same fixed time
//   (2026-01-01 00:00), so the same files give the same bytes.
//   `deflate` (optional) is a synchronous raw-deflate function, bytes -> bytes (Node:
//   b => zlib.deflateRawSync(b, { level: 9 })). An entry is stored when there is none, or when
//   deflate does not make it smaller. The browser has no synchronous deflate, so its archives
//   are stored: about the size of their files.
// unzip(bytes, { inflate }) -> [{ name, data }]: reads one back (stored entries, and deflated
//   ones when `inflate` is given), checking every CRC.
import { utf8 } from './color.js'

const TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  TABLE[n] = c >>> 0
}

export function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// 2026-01-01 00:00 in MS-DOS date and time.
const DOS_TIME = 0
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1

const bytesOf = d => (typeof d === 'string' ? utf8(d) : d instanceof Uint8Array ? d : new Uint8Array(d))

export function zip(entries, opts = {}) {
  const parts = []
  const centrals = []
  let offset = 0
  for (const { name, data } of entries) {
    const raw = bytesOf(data)
    const nameBuf = utf8(name)
    const crc = crc32(raw)
    let body = raw
    let method = 0
    if (opts.deflate) {
      const deflated = bytesOf(opts.deflate(raw))
      // Store when deflate does not help (PNGs mostly).
      if (deflated.length < raw.length) {
        body = deflated
        method = 8
      }
    }
    const local = new Uint8Array(30)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(6, 0x0800, true) // UTF-8 names
    lv.setUint16(8, method, true)
    lv.setUint16(10, DOS_TIME, true)
    lv.setUint16(12, DOS_DATE, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, body.length, true)
    lv.setUint32(22, raw.length, true)
    lv.setUint16(26, nameBuf.length, true)
    lv.setUint16(28, 0, true)
    parts.push(local, nameBuf, body)

    const central = new Uint8Array(46)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true) // version needed
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, method, true)
    cv.setUint16(12, DOS_TIME, true)
    cv.setUint16(14, DOS_DATE, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, body.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, nameBuf.length, true)
    // extra, comment, disk, internal and external attributes stay 0
    cv.setUint32(42, offset, true)
    centrals.push(central, nameBuf)
    offset += local.length + nameBuf.length + body.length
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  const all = [...parts, ...centrals, end]
  const out = new Uint8Array(all.reduce((n, b) => n + b.length, 0))
  let p = 0
  for (const b of all) {
    out.set(b, p)
    p += b.length
  }
  return out
}

export function unzip(buf, opts = {}) {
  const bytes = bytesOf(buf)
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let endAt = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      endAt = i
      break
    }
  }
  if (endAt < 0) throw new Error('not a zip: no end record')
  const count = v.getUint16(endAt + 10, true)
  let p = v.getUint32(endAt + 16, true)
  const dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null
  const out = []
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('not a zip: bad central record')
    const method = v.getUint16(p + 10, true)
    const crc = v.getUint32(p + 16, true)
    const size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    const at = v.getUint32(p + 42, true)
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen)
    const name = dec ? dec.decode(nameBytes) : String.fromCharCode(...nameBytes)
    const start = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true)
    const body = bytes.subarray(start, start + size)
    let data
    if (method === 0) data = body.slice()
    else if (method === 8 && opts.inflate) data = bytesOf(opts.inflate(body))
    else throw new Error('unzip: ' + name + ' uses method ' + method)
    if (crc32(data) !== crc) throw new Error('crc mismatch in ' + name)
    out.push({ name, data })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}
