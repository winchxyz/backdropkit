// The editor's one door to the exporter (editor/lib/export.js and editor/lib/browser.js).
// Everything else in the editor talks to these functions; when the exporter changes shape,
// only this file follows. The heavy encode runs in a worker (checks-worker.js).
import { toJSON, N, W, H } from './project.js'

let ex = null
let br = null
let tried = 0
// Load the exporter modules; null parts when they are not there yet.
export async function lib() {
  if (ex && br) return { ex, br }
  const now = Date.now()
  if (now - tried < 4000 && tried) return { ex, br }
  tried = now
  try {
    ex ||= await import('./lib/export.js')
  } catch {
    ex = null
  }
  try {
    br ||= await import('./lib/browser.js')
  } catch {
    br = null
  }
  return { ex, br }
}
export const ready = async () => {
  const l = await lib()
  return !!(l.ex && l.br)
}

/* ---------- Workers ---------- */

// Three lanes, each with a worker of its own: the checks after edits, the scene Play shows,
// and the export. A newer job replaces one still running in its lane (that worker stops and
// a fresh one starts; the old promise rejects with `superseded`), so a very heavy edit never
// holds up the next check, Play, or an export.
const lanes = {}
let seq = 0
function ask(lane, msg) {
  const L = (lanes[lane] ||= { worker: null, job: null })
  if (L.job) {
    L.worker?.terminate()
    L.worker = null
    L.job.reject(Object.assign(new Error('A newer job took its place.'), { superseded: true }))
    L.job = null
  }
  if (!L.worker) {
    try {
      const w = new Worker(new URL('./checks-worker.js', import.meta.url), { type: 'module' })
      w.onmessage = e => {
        if (!L.job || L.job.id !== e.data.id) return
        const job = L.job
        L.job = null
        e.data.ok ? job.resolve(e.data.result) : job.reject(Object.assign(new Error(e.data.error), { missing: e.data.missing }))
      }
      w.onerror = e => {
        L.job?.reject(new Error(e.message || 'The exporter stopped.'))
        L.job = null
        L.worker = null
      }
      L.worker = w
    } catch {
      return null
    }
  }
  return new Promise((resolve, reject) => {
    const id = ++seq
    L.job = { id, resolve, reject }
    L.worker.postMessage({ ...msg, id })
  })
}

// Every moment encoded: { scenes: [{ id, chars, svg? }], ok, problems }.
export async function checkAll(doc, { svgs = false, lane = 'checks' } = {}) {
  const project = toJSON(doc)
  const viaWorker = ask(lane, { type: 'all', project, svgs })
  if (viaWorker) {
    try {
      return await viaWorker
    } catch (err) {
      if (!err.missing) throw err
    }
  }
  const { ex: X } = await lib()
  if (!X) throw Object.assign(new Error('The exporter is not here yet.'), { missing: true })
  const r = X.exportAll(project)
  return { scenes: r.scenes.map(s => ({ id: s.id, chars: s.chars, ms: s.ms, merged: s.merged, costs: s.costs || [], svg: svgs ? s.svg : undefined })), ok: r.ok, problems: r.problems || [] }
}
// One moment's scene, as the app plays it: { svg, chars, problems }.
export async function sceneFor(doc, mid) {
  const project = toJSON(doc)
  const viaWorker = ask('play', { type: 'scene', project, mid })
  if (viaWorker) {
    try {
      return await viaWorker
    } catch (err) {
      if (!err.missing) throw err
    }
  }
  const { ex: X } = await lib()
  if (!X) throw Object.assign(new Error('The exporter is not here yet.'), { missing: true })
  return X.exportScene(project, mid)
}

/* ---------- Pictures: the site's themes and the visitor's own ---------- */

// A picture as the editor uses it: { colors: ['#rrggbb', ...], cells: Uint16Array(N) } where
// a cell n > 0 is colors[n - 1].
function normPicture(p) {
  if (!p) throw new Error('No picture came back.')
  let colors = p.colors || p.palette || p.hex
  if (colors && colors.length && typeof colors[0] === 'object') colors = colors.map(c => c.hex || c.color || Object.values(c.colors || {})[0])
  let cells = p.cells
  if (typeof cells === 'string') {
    const s = atob(cells)
    const out = new Uint16Array(N)
    for (let i = 0; i < N; i++) out[i] = s.charCodeAt(i * 2) | (s.charCodeAt(i * 2 + 1) << 8)
    cells = out
  } else if (cells && !(cells instanceof Uint16Array)) cells = Uint16Array.from(cells)
  if (!colors || !cells || cells.length !== N) throw new Error('The picture came back in a shape this editor does not know.')
  return { colors: colors.map(c => String(c).toLowerCase()), cells }
}

// An SVG scene, held still, at exactly one pixel per cell.
export async function pictureFromSvg(svgText, opts = {}) {
  const { br: B } = await lib()
  if (B?.pictureFromSvg) return normPicture(await B.pictureFromSvg(svgText, opts))
  return normPicture(await fallbackSvg(svgText, opts.maxColors || 1024))
}
// The visitor's image: cropped to fill, in `colors` colours, dithered or not.
export async function pictureFromImage(source, opts = {}) {
  const { br: B } = await lib()
  if (B?.pictureFromImage) return normPicture(await B.pictureFromImage(source, opts))
  return normPicture(await fallbackImage(source, opts))
}

/* ---------- Export ---------- */

const MOD_FILES = ['board.d.ts', 'board.js', 'colors.d.ts', 'colors.js', 'hooks.json', 'make-colors.d.ts', 'make-colors.js', 'register.test.tsx', 'register.tsx', 'theme.d.ts']
async function modFiles(X) {
  const names = X.MOD_FILES || MOD_FILES
  const out = {}
  await Promise.all(
    names.map(async n => {
      const r = await fetch(new URL('./mod/hooks/' + n, import.meta.url))
      if (!r.ok) throw new Error('The theme template file ' + n + ' is missing from the site.')
      out[n] = await r.text()
    }),
  )
  return out
}

// The theme archive: { bytes: Uint8Array, prompt, scenes }.
export async function buildZip(doc, onStep = () => {}) {
  const { ex: X, br: B } = await lib()
  if (!X || !B) throw Object.assign(new Error('The exporter is not here yet.'), { missing: true })
  const project = toJSON(doc)
  onStep('Encoding every moment')
  const all = await checkAll(doc, { svgs: true, lane: 'export' })
  const scenes = all.scenes
  onStep('Measuring the light of each moment')
  const looks = {}
  for (const s of scenes) looks[s.id] = await B.measureLook(s.svg)
  onStep('Taking the preview')
  const preview = await B.previewPng(project, scenes, looks)
  onStep('Packing the archive')
  const files = await modFiles(X)
  const bytes = X.buildArchive(project, { scenes, looks, preview, modFiles: files })
  return { bytes, prompt: X.promptFor(project), scenes }
}
export async function promptFor(doc) {
  const { ex: X } = await lib()
  return X?.promptFor ? X.promptFor(toJSON(doc)) : ''
}
export async function measureLook(svg) {
  const { br: B } = await lib()
  return B?.measureLook ? B.measureLook(svg) : null
}

/* ---------- Fallbacks, used only while the exporter's browser.js is missing ---------- */

function stillOf(svg) {
  const pause = '*{animation-play-state:paused!important}'
  return svg.includes('</style>') ? svg.replace('</style>', pause + '</style>') : svg
}
async function fallbackSvg(svgText, maxColors) {
  const root = new DOMParser().parseFromString(stillOf(svgText), 'image/svg+xml').documentElement
  root.setAttribute('width', String(W))
  root.setAttribute('height', String(H))
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const c = new OffscreenCanvas(W, H)
    const x = c.getContext('2d', { willReadFrequently: true })
    x.fillStyle = '#000'
    x.fillRect(0, 0, W, H)
    x.drawImage(img, 0, 0, W, H)
    return quantize(x.getImageData(0, 0, W, H).data, maxColors, 0)
  } finally {
    URL.revokeObjectURL(url)
  }
}
async function fallbackImage(source, { colors = 24, dither = 0 } = {}) {
  const bmp = await createImageBitmap(source)
  const c = new OffscreenCanvas(W, H)
  const x = c.getContext('2d', { willReadFrequently: true })
  const s = Math.max(W / bmp.width, H / bmp.height)
  const dw = bmp.width * s
  const dh = bmp.height * s
  x.imageSmoothingQuality = 'high'
  x.drawImage(bmp, (W - dw) / 2, H - dh, dw, dh)
  return quantize(x.getImageData(0, 0, W, H).data, colors, dither)
}
// Exact colours when there are few enough; else a median cut and nearest colour, with an
// ordered dither of the given strength (0 to 1).
function quantize(d, max, dither) {
  const map = new Map()
  const cells = new Uint16Array(N)
  for (let i = 0; i < N; i++) {
    const k = (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2]
    let n = map.get(k)
    if (n === undefined) {
      n = map.size + 1
      map.set(k, n)
    }
    cells[i] = n
  }
  const hex = k => '#' + k.toString(16).padStart(6, '0')
  if (map.size <= max && !dither) return { colors: [...map.keys()].map(hex), cells }
  // Median cut.
  let boxes = [[]]
  for (let i = 0; i < N; i++) boxes[0].push(i)
  const ch = (i, c) => d[i * 4 + c]
  while (boxes.length < max) {
    let bi = -1
    let best = -1
    let bc = 0
    boxes.forEach((b, j) => {
      if (b.length < 2) return
      for (let c = 0; c < 3; c++) {
        let lo = 255
        let hi = 0
        for (let k = 0; k < b.length; k += Math.ceil(b.length / 600)) {
          const v = ch(b[k], c)
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
        const r = (hi - lo) * Math.sqrt(b.length)
        if (r > best) {
          best = r
          bi = j
          bc = c
        }
      }
    })
    if (bi < 0 || best <= 0) break
    const b = boxes[bi].sort((a, z) => ch(a, bc) - ch(z, bc))
    const mid = b.length >> 1
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid))
  }
  const pal = boxes.filter(b => b.length).map(b => {
    let r = 0
    let g = 0
    let bl = 0
    for (const i of b) {
      r += d[i * 4]
      g += d[i * 4 + 1]
      bl += d[i * 4 + 2]
    }
    return [r / b.length, g / b.length, bl / b.length].map(Math.round)
  })
  const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
  for (let i = 0; i < N; i++) {
    const x = i % W
    const y = (i / W) | 0
    const t = dither ? ((B4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * 48 * dither : 0
    const r = d[i * 4] + t
    const g = d[i * 4 + 1] + t
    const b = d[i * 4 + 2] + t
    let bi = 0
    let bd = 1e9
    for (let k = 0; k < pal.length; k++) {
      const p = pal[k]
      const dd = (p[0] - r) ** 2 * 0.3 + (p[1] - g) ** 2 * 0.59 + (p[2] - b) ** 2 * 0.11
      if (dd < bd) {
        bd = dd
        bi = k
      }
    }
    cells[i] = bi + 1
  }
  return { colors: pal.map(p => '#' + p.map(v => v.toString(16).padStart(2, '0')).join('')), cells }
}
