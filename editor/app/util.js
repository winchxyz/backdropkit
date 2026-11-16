// Small helpers shared by the editor's modules: DOM, numbers, seeded randomness, base64 cells.

export const $ = (sel, root = document) => root.querySelector(sel)
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
export const lerp = (a, b, t) => a + (b - a) * t
export const smooth = t => t * t * (3 - 2 * t)
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
export const MOD = isMac ? '⌘' : 'Ctrl+'

// h('div.cls#id', { attrs, on: { click } }, children...)
export function h(tag, props, ...kids) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag)
  const el = document.createElement(m[1] || 'div')
  for (const part of m[2].match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1))
    else el.id = part.slice(1)
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn)
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
      else if (k === 'class') el.classList.add(...String(v).split(/\s+/).filter(Boolean))
      else if (k === 'html') el.innerHTML = v
      else if (k === 'text') el.textContent = v
      else if (k in el && typeof v !== 'string') el[k] = v
      else el.setAttribute(k, v === true ? '' : v)
    }
  }
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue
    el.append(k instanceof Node ? k : document.createTextNode(String(k)))
  }
  return el
}

export function debounce(fn, ms) {
  let t = 0
  const d = (...a) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...a), ms)
  }
  d.cancel = () => clearTimeout(t)
  d.now = (...a) => {
    clearTimeout(t)
    fn(...a)
  }
  return d
}

// Seeded randomness: mulberry32.
export function rng(seed) {
  let a = (seed >>> 0) || 1
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  r.range = (lo, hi) => lo + (hi - lo) * r()
  r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r())
  r.pick = list => list[Math.floor(r() * list.length)]
  return r
}
export const hash2 = (x, y, s = 0) => {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
export const newSeed = () => (Math.random() * 1e9) | 0

// 4 x 4 ordered dither thresholds, 0..15 / 16 + 1/32.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
export const bayer = (x, y) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16

// Cells: Uint16Array(w * h), little-endian, as base64.
export function cellsToB64(arr) {
  const bytes = new Uint8Array(arr.length * 2)
  for (let i = 0; i < arr.length; i++) {
    bytes[i * 2] = arr[i] & 255
    bytes[i * 2 + 1] = arr[i] >> 8
  }
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
export function b64ToCells(b64, n) {
  const s = atob(b64)
  const out = new Uint16Array(n)
  const m = Math.min(n, s.length >> 1)
  for (let i = 0; i < m; i++) out[i] = s.charCodeAt(i * 2) | (s.charCodeAt(i * 2 + 1) << 8)
  return out
}

export const hhmm = min => {
  const t = ((Math.round(min) % 1440) + 1440) % 1440
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0')
}
export const fmt = n => Math.round(n).toLocaleString('en-US')
export const slugify = s =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40)
    .replace(/-+$/, '')

export function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type })
  const url = URL.createObjectURL(blob)
  const a = h('a', { href: url, download: name })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function pickFile(accept) {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept, style: 'position:fixed;left:-99px;opacity:0' })
    let done = false
    input.addEventListener('change', () => {
      done = true
      resolve(input.files[0] || null)
      input.remove()
    })
    // A cancelled dialog fires no change; focus comes back to the window instead.
    window.addEventListener(
      'focus',
      () =>
        setTimeout(() => {
          if (!done) {
            resolve(null)
            input.remove()
          }
        }, 800),
      { once: true },
    )
    document.body.append(input)
    input.click()
  })
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = h('textarea', { readonly: true, style: 'position:fixed;opacity:0' })
    ta.value = text
    document.body.append(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  }
}

// Icons: 16 x 16 strokes, as on the landing page.
const P = {
  chevD: '<path d="M4 6l4 4 4-4"/>',
  chevR: '<path d="M6 3.5l4.5 4.5L6 12.5"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  minus: '<path d="M3 8h10"/>',
  sidebar: '<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M6 3v10"/>',
  panel: '<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M10 3v10"/>',
  play: '<path d="M5 3.5v9l7.5-4.5z"/>',
  pause: '<path d="M5.5 3.5v9M10.5 3.5v9"/>',
  stop: '<rect x="4" y="4" width="8" height="8" rx="1.2"/>',
  chat: '<path d="M3 4.5A1.5 1.5 0 014.5 3h7A1.5 1.5 0 0113 4.5v5A1.5 1.5 0 0111.5 11H7l-3 2.5V11h0.5A1.5 1.5 0 013 9.5z"/>',
  eye: '<path d="M1.8 8s2.3-4.3 6.2-4.3S14.2 8 14.2 8s-2.3 4.3-6.2 4.3S1.8 8 1.8 8z"/><circle cx="8" cy="8" r="1.9"/>',
  eyeOff: '<path d="M2.5 2.5l11 11M6.4 4C6.9 3.8 7.4 3.7 8 3.7c3.9 0 6.2 4.3 6.2 4.3s-.6 1.2-1.8 2.4M4.2 5.3C2.7 6.4 1.8 8 1.8 8s2.3 4.3 6.2 4.3c.9 0 1.7-.2 2.4-.5"/>',
  dots: '<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>',
  grip: '<circle cx="6" cy="4" r=".8" fill="currentColor"/><circle cx="10" cy="4" r=".8" fill="currentColor"/><circle cx="6" cy="8" r=".8" fill="currentColor"/><circle cx="10" cy="8" r=".8" fill="currentColor"/><circle cx="6" cy="12" r=".8" fill="currentColor"/><circle cx="10" cy="12" r=".8" fill="currentColor"/>',
  pencil: '<path d="M10.5 2.8l2.7 2.7-7.6 7.6-3.4.7.7-3.4z"/><path d="M9 4.3l2.7 2.7"/>',
  eraser: '<path d="M6.2 13.2h7M2.8 9.6l6-6a1.4 1.4 0 012 0l2.4 2.4a1.4 1.4 0 010 2l-5 5H6.3z"/><path d="M5.8 6.6l4.4 4.4"/>',
  fill: '<path d="M7.5 2.5l5.5 5.5-4.5 4.5a1.4 1.4 0 01-2 0L3 9a1.4 1.4 0 010-2z"/><path d="M3 8h10"/><path d="M14 10.5s1 1.4 1 2.1a1 1 0 01-2 0c0-.7 1-2.1 1-2.1z"/>',
  line: '<path d="M3.5 12.5l9-9"/><circle cx="3.5" cy="12.5" r="1.2"/><circle cx="12.5" cy="3.5" r="1.2"/>',
  rect: '<rect x="3" y="4" width="10" height="8" rx=".5"/>',
  picker: '<path d="M9.5 3.5l3 3M13 2.9a1.5 1.5 0 010 2.2l-1.4 1.4-2.2-2.2L10.8 2.9a1.5 1.5 0 012.2 0zM10.5 6.5l-6 6H2.8v-1.7l6-6"/>',
  dice: '<rect x="2.5" y="2.5" width="11" height="11" rx="2.2"/><circle cx="5.6" cy="5.6" r=".9" fill="currentColor"/><circle cx="10.4" cy="10.4" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
  download: '<path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10"/>',
  upload: '<path d="M8 11V3M4.5 6.5L8 3l3.5 3.5M3 13.5h10"/>',
  image: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1.2"/><path d="M2.5 11.5l3.5-3 2.5 2 2-1.5 3 2.5"/>',
  layers: '<path d="M8 2.5l6 3-6 3-6-3z"/><path d="M2 8.2l6 3 6-3"/><path d="M2 10.8l6 3 6-3"/>',
  sun: '<circle cx="8" cy="8" r="2.6"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>',
  folder: '<path d="M2 4.5A1.5 1.5 0 013.5 3h2.8l1.5 1.6h4.7A1.5 1.5 0 0114 6.1v5.4a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5z"/>',
  blank: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 10l3.5-3 3 2.5 4.5-3.5"/>',
  grid: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M6.2 2.5v11M9.8 2.5v11M2.5 6.2h11M2.5 9.8h11"/>',
  zoomIn: '<circle cx="7" cy="7" r="4.5"/><path d="M10.4 10.4l3.1 3.1M5 7h4M7 5v4"/>',
  merge: '<path d="M4 3v3.5c0 1.4 1.1 2.5 2.5 2.5h3c1.4 0 2.5 1.1 2.5 2.5V13M12 3v3.5"/>',
  wand: '<path d="M3 13l7-7M11.5 2v2M11.5 7v2M9 4.5h-2M16 4.5h-2M13.3 2.7l-.9.9M10.6 6.3l-.9.9"/>',
  undo: '<path d="M5 6.5H10a3 3 0 010 6H6"/><path d="M7 4L4.5 6.5 7 9"/>',
  redo: '<path d="M11 6.5H6a3 3 0 000 6h4"/><path d="M9 4l2.5 2.5L9 9"/>',
  more: '<circle cx="8" cy="3.5" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="12.5" r=".9" fill="currentColor"/>',
  move: '<path d="M8 2v12M2 8h12M8 2L6.3 3.7M8 2l1.7 1.7M8 14l-1.7-1.7M8 14l1.7-1.7M2 8l1.7-1.7M2 8l1.7 1.7M14 8l-1.7-1.7M14 8l-1.7 1.7"/>',
  look: '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v11"/><path d="M8 4.2h3.6M8 6.4h5.2M8 8.6h5.4M8 10.8h4.6" stroke-width="1.2"/>',
  palette: '<path d="M8 2.5a5.5 5.5 0 100 11c.9 0 1.3-.6 1.3-1.2 0-.9-.8-1.1-.8-1.9 0-.6.5-1.1 1.2-1.1h1.6a2.2 2.2 0 002.2-2.2C13.5 4.6 11.1 2.5 8 2.5z"/><circle cx="5.3" cy="7.2" r=".8" fill="currentColor"/><circle cx="7.6" cy="5.1" r=".8" fill="currentColor"/><circle cx="10.4" cy="5.8" r=".8" fill="currentColor"/>',
  wave: '<path d="M1.8 9.5c1.4 0 1.4-3 2.8-3s1.4 3 2.8 3 1.4-3 2.8-3 1.4 3 2.8 3 .8-.6 1.2-1.1"/>',
  sparkle: '<path d="M8 2.2l1.3 3.6 3.6 1.3-3.6 1.3L8 12l-1.3-3.6L3.1 7.1l3.6-1.3z"/><path d="M12.6 10.6l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z"/>',
  sliders: '<path d="M3 4.5h6M12 4.5h1M3 11.5h1M7 11.5h6"/><circle cx="10.5" cy="4.5" r="1.5"/><circle cx="5.5" cy="11.5" r="1.5"/>',
  flip: '<path d="M8 2v12" stroke-dasharray="1.6 1.6"/><path d="M6 4L2.5 12H6zM10 4l3.5 8H10z"/>',
  search: '<circle cx="7" cy="7" r="4.3"/><path d="M10.2 10.2l3.3 3.3"/>',
  compare: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M8 3v10"/><path d="M8 3h4a1.5 1.5 0 011.5 1.5v7A1.5 1.5 0 0112 13H8z" fill="currentColor" stroke="none" opacity=".35"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2a1 1 0 001 .8h3.8a1 1 0 001-.8l.6-8.2"/>',
  copy: '<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M11 5V3.8A1.3 1.3 0 009.7 2.5H3.8A1.3 1.3 0 002.5 3.8v5.9A1.3 1.3 0 003.8 11H5"/>',
  replace: '<path d="M3 6.5a5 5 0 019.2-1.8M13 9.5a5 5 0 01-9.2 1.8"/><path d="M12.6 2.2v2.7H9.9M3.4 13.8v-2.7h2.7"/>',
}
export function icon(name, cls = '') {
  const span = document.createElement('span')
  span.innerHTML = '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 16 16" aria-hidden="true">' + (P[name] || '') + '</svg>'
  return span.firstChild
}
export const iconHtml = name => '<svg class="i" viewBox="0 0 16 16" aria-hidden="true">' + (P[name] || '') + '</svg>'

// winch-ai's mark: an 8 x 8 pixel sun cut by the horizon (the landing page's).
const MARK_ROWS = ['..####..', '.######.', '########', '########', '........', '########', '........', '.######.']
export const markHtml = (() => {
  let r = ''
  MARK_ROWS.forEach((row, y) => [...row].forEach((c, x) => c === '#' && (r += 'M' + x + ' ' + y + 'h1v1h-1z')))
  return '<svg class="mark" viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="' + r + '"/></svg>'
})()
