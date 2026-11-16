// Small helpers shared by the exporter: colours, cell grids in base64, and keys.
// Plain ES module with no dependencies: it runs in the browser and in Node.

/* ---------- Colours ---------- */

// '#rgb' or '#rrggbb' (any case) as '#rrggbb' in lower case, or null when it is not a colour.
export function normHex(h) {
  if (typeof h !== 'string') return null
  const s = h.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]
  return null
}

// '#rrggbb' -> [r, g, b].
export function rgbOf(h) {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// [r, g, b] -> '#rrggbb'.
export function hexOf(rgb) {
  return '#' + rgb.map(v => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

// The shortest way to write a colour: '#abc' for '#aabbcc'.
export function shortHex(h) {
  if (h.length === 7 && h[1] === h[2] && h[3] === h[4] && h[5] === h[6]) return '#' + h[1] + h[3] + h[5]
  return h
}

// Relative brightness, 0..255 (Rec. 709 weights on the encoded values, as the engine sorts).
export function lum(h) {
  const [r, g, b] = rgbOf(h)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// How far apart two colours look, as the mean of the channel differences (0..255): the
// engine's measure for when a hairline would show.
export function apart(a, b) {
  const x = rgbOf(a)
  const y = rgbOf(b)
  return (Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2])) / 3
}

// The largest channel difference: the "levels" a colour merge moves a colour by.
export function levels(a, b) {
  const x = rgbOf(a)
  const y = rgbOf(b)
  return Math.max(Math.abs(x[0] - y[0]), Math.abs(x[1] - y[1]), Math.abs(x[2] - y[2]))
}

/* ---------- Cells in base64 ---------- */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INDEX = new Int16Array(128).fill(-1)
for (let i = 0; i < 64; i++) B64_INDEX[B64.charCodeAt(i)] = i

export function bytesToBase64(bytes) {
  let out = ''
  const n = bytes.length
  let i = 0
  const parts = []
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64[v >> 18] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63]
    if (out.length > 8192) {
      parts.push(out)
      out = ''
    }
  }
  if (i < n) {
    const v = (bytes[i] << 16) | ((i + 1 < n ? bytes[i + 1] : 0) << 8)
    out += B64[v >> 18] + B64[(v >> 12) & 63] + (i + 1 < n ? B64[(v >> 6) & 63] : '=') + '='
  }
  parts.push(out)
  return parts.join('')
}

export function base64ToBytes(s) {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '')
  const n = Math.floor((clean.length * 3) / 4)
  const out = new Uint8Array(n)
  let o = 0
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64_INDEX[clean.charCodeAt(i)]
    const b = B64_INDEX[clean.charCodeAt(i + 1)]
    const c = i + 2 < clean.length ? B64_INDEX[clean.charCodeAt(i + 2)] : -1
    const d = i + 3 < clean.length ? B64_INDEX[clean.charCodeAt(i + 3)] : -1
    const v = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d)
    if (o < n) out[o++] = (v >> 16) & 255
    if (c >= 0 && o < n) out[o++] = (v >> 8) & 255
    if (d >= 0 && o < n) out[o++] = v & 255
  }
  return out
}

// A layer's cells (Uint16Array, one slot number per cell, row by row) as the project stores
// them: little-endian bytes in base64.
export function encodeCells(cells) {
  const bytes = new Uint8Array(cells.length * 2)
  for (let i = 0; i < cells.length; i++) {
    bytes[2 * i] = cells[i] & 255
    bytes[2 * i + 1] = cells[i] >> 8
  }
  return bytesToBase64(bytes)
}

// The project's base64 back into a Uint16Array of `count` cells (0 = empty). Missing bytes read
// as empty cells; extra ones are ignored.
export function decodeCells(b64, count) {
  const bytes = typeof b64 === 'string' ? base64ToBytes(b64) : new Uint8Array(0)
  const out = new Uint16Array(count)
  const n = Math.min(count, bytes.length >> 1)
  for (let i = 0; i < n; i++) out[i] = bytes[2 * i] | (bytes[2 * i + 1] << 8)
  return out
}

/* ---------- Text ---------- */

// UTF-8 bytes of a string, without TextEncoder (works everywhere).
export function utf8(s) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s)
  const out = []
  for (const ch of s) {
    let c = ch.codePointAt(0)
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return new Uint8Array(out)
}
