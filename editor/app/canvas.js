// The scene behind the window: drawn crisp at any zoom, filled to the window the way the app
// fills it (bottom-centred, cropped), with zoom (wheel, + and -), pan (space-drag, middle
// button, two fingers) and the paint tools: pencil, eraser, fill, line, rectangle, eyedropper.
import { S, change, commitDraft, draft, emit, layer as selLayer } from './state.js'
import { H, N, W, cellsAt, paintable, shownAt, isImage, KIND_LABEL } from './project.js'
import { composite, middleLuma } from './render.js'
import { toast } from './ui.js'
import { clamp } from './util.js'
import { boxOf, originalPx, previewPx, setPlace } from './assets.js'

const view = document.getElementById('view')
const ctx = view.getContext('2d')
const off = new OffscreenCanvas(W, H)
const offCtx = off.getContext('2d')
const px = new Uint32Array(N)
const img = new ImageData(new Uint8ClampedArray(px.buffer), W, H)

export const V = { zoom: 4, ox: 0, oy: 0, mode: 'fill', grid: true, motion: false, motionStart: 0 }
let live = null // a stroke in progress: { doc, layerId, arrays: [Uint16Array], before }
let preview = null // a line or rectangle being dragged: Map of cell -> slot
let hover = null // the cell under the pointer
let dpr = 1
let raf = 0
let lastKey = ''
let lumaNow = 0.5

/* ---------- Layout ---------- */

// The free area between the panels, the title row and the dock.
export function freeArea() {
  const cs = getComputedStyle(document.documentElement)
  const head = document.querySelector('.top').getBoundingClientRect().bottom
  const panels = !document.body.classList.contains('nopanels') && !document.body.classList.contains('playing') && innerWidth > 860
  const l = panels ? parseFloat(cs.getPropertyValue('--side-l')) || 0 : 0
  const r = panels ? parseFloat(cs.getPropertyValue('--side-r')) || 0 : 0
  const dock = document.querySelector('.dbox')
  const b = dock && dock.offsetParent ? innerHeight - dock.getBoundingClientRect().top + 8 : 0
  return { x: l, y: head, w: innerWidth - l - r, h: innerHeight - head - b }
}
export function fill() {
  V.mode = 'fill'
  V.zoom = Math.max(innerWidth / W, innerHeight / H)
  V.ox = (innerWidth - W * V.zoom) / 2
  V.oy = innerHeight - H * V.zoom
  draw()
  emit({ zoom: true })
}
export function fit() {
  V.mode = 'fit'
  const a = freeArea()
  V.zoom = Math.max(0.5, Math.min((a.w - 24) / W, (a.h - 24) / H))
  V.ox = a.x + (a.w - W * V.zoom) / 2
  V.oy = a.y + (a.h - H * V.zoom) / 2
  draw()
  emit({ zoom: true })
}
export function zoomBy(f, cx = innerWidth / 2, cy = innerHeight / 2) {
  const min = Math.min(Math.max(innerWidth / W, innerHeight / H), freeArea().w / W) * 0.5
  const z = clamp(V.zoom * f, min, 64)
  const k = z / V.zoom
  V.ox = cx - (cx - V.ox) * k
  V.oy = cy - (cy - V.oy) * k
  V.zoom = z
  V.mode = 'free'
  clampPan()
  draw()
  emit({ zoom: true })
}
function clampPan() {
  const sw = W * V.zoom
  const sh = H * V.zoom
  V.ox = clamp(V.ox, -sw + 60, innerWidth - 60)
  V.oy = clamp(V.oy, -sh + 60, innerHeight - 60)
}
function resize() {
  dpr = window.devicePixelRatio || 1
  view.width = Math.round(innerWidth * dpr)
  view.height = Math.round(innerHeight * dpr)
  if (V.mode === 'fill') fill()
  else if (V.mode === 'fit') fit()
  else draw()
}
addEventListener('resize', resize)

/* ---------- Drawing ---------- */

export function draw() {
  if (raf) return
  raf = requestAnimationFrame(paint)
}
function motionTime() {
  return V.motion ? (performance.now() - V.motionStart) / 1000 : 0
}
function paint() {
  raf = 0
  const doc = live ? live.doc : S.doc
  const t = motionTime()
  const key = S.rev + '|' + S.mid + '|' + (live ? live.n : '') + '|' + t + '|' + S.frame + '|' + overrideN
  if (key !== lastKey) {
    lastKey = key
    composite(doc, S.mid, px, { t, frame: S.frame, under: 0, override: shifted, overridePx: override })
    if (preview) {
      const pal = new Uint32Array(1)
      for (const [i, slot] of preview) {
        const c = slot ? doc.palette[slot - 1]?.colors : null
        if (!c) continue
        pal[0] = packed(c[S.mid] || Object.values(c)[0])
        px[i] = pal[0]
      }
    }
    offCtx.putImageData(img, 0, 0)
    const l = middleLuma(px)
    if (Math.abs(l - lumaNow) > 0.001) {
      lumaNow = l
      emit({ luma: l })
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ground') || '#1b2430'
  ctx.fillRect(0, 0, view.width, view.height)
  ctx.imageSmoothingEnabled = false
  const z = V.zoom * dpr
  const x0 = Math.round(V.ox * dpr)
  const y0 = Math.round(V.oy * dpr)
  ctx.drawImage(off, x0, y0, Math.round(W * z), Math.round(H * z))
  // Empty cells show the ground; a checker would fight the scene.
  if ((V.grid && V.zoom >= 8) || (placing && V.zoom >= 3)) drawGrid(z, x0, y0)
  drawBox(z, x0, y0)
  drawCursor(z, x0, y0)
  if (V.motion) draw()
}

/* ---------- Placing art: the box, its handles, previews ---------- */

let override = null // { id, px }: a layer drawn from packed pixels (look previews, compare)
let overrideN = 0
let shifted = null // { id, arr }: a layer's cells moved while dragging
let placing = null // { id, mode: 'move' | corner, start, place, box, now }
export function setOverride(o) {
  override = o
  overrideN++
  draw()
}
export const placeTarget = () => {
  const l = selLayer()
  return l && isImage(l) && l.place && S.doc.assets?.[l.asset] && S.tool === 'move' && shownAt(l, S.mid) ? l : null
}
function screenBox(l, place = l.place) {
  const a = S.doc.assets[l.asset]
  return { x: V.ox + place.x * V.zoom, y: V.oy + place.y * V.zoom, w: a.w * place.scale * V.zoom, h: a.h * place.scale * V.zoom }
}
function drawBox(z, x0, y0) {
  void z, x0, y0
  const l = placeTarget()
  if (!l || S.play || document.body.classList.contains('starting')) return
  const b = screenBox(l, placing?.now || l.place)
  const k = dpr
  ctx.save()
  ctx.lineWidth = 1
  ctx.setLineDash([4 * k, 3 * k])
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'
  ctx.strokeRect(Math.round(b.x * k) - 0.5, Math.round(b.y * k) - 0.5, Math.round(b.w * k) + 1, Math.round(b.h * k) + 1)
  ctx.strokeStyle = 'rgba(255,255,255,0.92)'
  ctx.lineDashOffset = 3.5 * k
  ctx.strokeRect(Math.round(b.x * k) + 0.5, Math.round(b.y * k) + 0.5, Math.round(b.w * k) - 1, Math.round(b.h * k) - 1)
  ctx.setLineDash([])
  for (const [hx, hy] of corners(b)) {
    const s = 8 * k
    ctx.fillStyle = 'rgba(255,255,255,0.96)'
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'
    ctx.beginPath()
    ctx.rect(Math.round(hx * k - s / 2) + 0.5, Math.round(hy * k - s / 2) + 0.5, s, s)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}
const corners = b => [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]
function cornerAt(l, e) {
  const b = screenBox(l)
  const list = corners(b)
  for (let k = 0; k < 4; k++) if (Math.abs(e.clientX - list[k][0]) <= 9 && Math.abs(e.clientY - list[k][1]) <= 9) return k
  return -1
}
function inBox(l, e) {
  const b = screenBox(l)
  return e.clientX >= b.x && e.clientX <= b.x + b.w && e.clientY >= b.y && e.clientY <= b.y + b.h
}
let previewRaf = 0
function previewPlace(l, place) {
  placing.now = place
  if (previewRaf) return
  previewRaf = requestAnimationFrame(() => {
    previewRaf = 0
    if (!placing) return
    const p = previewPx(l, { place: placing.now, frame: S.frame })
    if (p) setOverride({ id: l.id, px: p.px })
  })
}
function startPlace(l, e) {
  const k = cornerAt(l, e)
  placing = { id: l.id, mode: k >= 0 ? k : 'move', start: { x: e.clientX, y: e.clientY }, place: { ...l.place }, now: { ...l.place } }
  if (placing.mode === 'move') {
    shifted = { id: l.id, arr: cellsAt(l, S.mid, S.frame) }
    shiftedFrom = shifted.arr
  }
  cursorStyle()
  draw()
}
let shiftedFrom = null
function movePlace(l, e) {
  const p = placing.place
  const a = S.doc.assets[l.asset]
  if (placing.mode === 'move') {
    const dx = Math.round((e.clientX - placing.start.x) / V.zoom)
    const dy = Math.round((e.clientY - placing.start.y) / V.zoom)
    placing.now = { ...p, x: p.x + dx, y: p.y + dy }
    shifted = { id: l.id, arr: shift(shiftedFrom, dx, dy) }
    lastKey = ''
    draw()
    return
  }
  // A corner: scale about the opposite one, keeping the art's shape.
  const k = placing.mode
  const ax = k % 2 === 0 ? p.x + a.w * p.scale : p.x
  const ay = k < 2 ? p.y + a.h * p.scale : p.y
  const cx = (e.clientX - V.ox) / V.zoom
  const cy = (e.clientY - V.oy) / V.zoom
  const s = clamp(Math.max(Math.abs(cx - ax) / a.w, Math.abs(cy - ay) / a.h), 2 / Math.max(a.w, a.h), 8)
  const sc = Math.round(s * 1000) / 1000
  const nx = k % 2 === 0 ? ax - a.w * sc : ax
  const ny = k < 2 ? ay - a.h * sc : ay
  previewPlace(l, { ...p, x: Math.round(nx), y: Math.round(ny), scale: sc })
}
async function endPlace(l) {
  const now = placing.now
  const was = placing.place
  placing = null
  cursorStyle()
  if (now.x !== was.x || now.y !== was.y || now.scale !== was.scale) await setPlace(l.id, now)
  shifted = null
  shiftedFrom = null
  setOverride(null)
}
function shift(arr, dx, dy) {
  const out = new Uint16Array(N)
  for (let y = 0; y < H; y++) {
    const sy = y - dy
    if (sy < 0 || sy >= H) continue
    for (let x = 0; x < W; x++) {
      const sx = x - dx
      if (sx < 0 || sx >= W) continue
      out[y * W + x] = arr[sy * W + sx]
    }
  }
  return out
}
// Alt + wheel over the art scales it about the pointer; the look runs when the wheel rests.
let wheelPlace = null
function wheelScale(l, e) {
  const a = S.doc.assets[l.asset]
  const p = wheelPlace?.now || l.place
  const f = Math.exp(-e.deltaY * 0.0015)
  const s = clamp(p.scale * f, 2 / Math.max(a.w, a.h), 8)
  const cx = (e.clientX - V.ox) / V.zoom
  const cy = (e.clientY - V.oy) / V.zoom
  const now = { ...p, scale: Math.round(s * 1000) / 1000, x: Math.round(cx - ((cx - p.x) * s) / p.scale), y: Math.round(cy - ((cy - p.y) * s) / p.scale) }
  placing = placing || { id: l.id, mode: 'wheel', place: { ...l.place }, now }
  wheelPlace = placing
  previewPlace(l, now)
  clearTimeout(wheelScale.t)
  wheelScale.t = setTimeout(async () => {
    const pl = wheelPlace
    wheelPlace = null
    if (!placing) return
    placing = null
    await setPlace(l.id, pl.now)
    setOverride(null)
  }, 380)
}
// Hold to compare: the art itself instead of its look.
export function compare(on) {
  const l = selLayer()
  if (!on || !l || !isImage(l)) return setOverride(null)
  const px = originalPx(l, S.frame)
  if (px) setOverride({ id: l.id, px })
}
export const isPlacing = () => !!placing
const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1
function packed(hex) {
  const n = parseInt(String(hex).slice(1), 16) || 0
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return LE ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0
}
function drawGrid(z, x0, y0) {
  const ink = lumaNow < 0.5 ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.13)'
  ctx.strokeStyle = ink
  ctx.lineWidth = 1
  ctx.beginPath()
  const c0 = Math.max(0, Math.floor(-x0 / z))
  const c1 = Math.min(W, Math.ceil((view.width - x0) / z))
  const r0 = Math.max(0, Math.floor(-y0 / z))
  const r1 = Math.min(H, Math.ceil((view.height - y0) / z))
  for (let c = c0; c <= c1; c++) {
    const x = Math.round(x0 + c * z) + 0.5
    ctx.moveTo(x, y0 + r0 * z)
    ctx.lineTo(x, y0 + r1 * z)
  }
  for (let r = r0; r <= r1; r++) {
    const y = Math.round(y0 + r * z) + 0.5
    ctx.moveTo(x0 + c0 * z, y)
    ctx.lineTo(x0 + c1 * z, y)
  }
  ctx.stroke()
}
function drawCursor(z, x0, y0) {
  if (!hover || panning || S.play || document.body.classList.contains('starting')) return
  const tool = activeTool()
  if (!['pencil', 'eraser', 'line', 'rect'].includes(tool)) {
    outline(hover.x, hover.y, 1, z, x0, y0)
    return
  }
  const s = tool === 'pencil' || tool === 'eraser' ? S.size : 1
  const o = Math.floor((s - 1) / 2)
  outline(hover.x - o, hover.y - o, s, z, x0, y0)
}
function outline(cx, cy, s, z, x0, y0) {
  const x = Math.round(x0 + cx * z) + 0.5
  const y = Math.round(y0 + cy * z) + 0.5
  const w = Math.round(s * z) - 1
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'
  ctx.strokeRect(x - 1, y - 1, w + 2, w + 2)
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.strokeRect(x, y, w, w)
}

export function setMotionPreview(on) {
  V.motion = on
  V.motionStart = performance.now()
  lastKey = ''
  draw()
  emit({ motion: true })
}

/* ---------- Pointer input ---------- */

let spaceDown = false
let panning = null
let altDown = false
const pointers = new Map()
let pinch = null

const cellAt = e => ({ x: Math.floor((e.clientX - V.ox) / V.zoom), y: Math.floor((e.clientY - V.oy) / V.zoom) })
const inside = c => c.x >= 0 && c.y >= 0 && c.x < W && c.y < H
export const activeTool = () => (altDown && ['pencil', 'eraser', 'fill', 'line', 'rect'].includes(S.tool) ? 'picker' : S.tool)

function cursorStyle(e) {
  let c = panning ? 'grabbing' : spaceDown ? 'grab' : activeTool() === 'picker' ? 'copy' : activeTool() === 'move' ? 'default' : 'crosshair'
  const l = !panning && !spaceDown ? placeTarget() : null
  if (l) {
    const k = placing ? (typeof placing.mode === 'number' ? placing.mode : -1) : e ? cornerAt(l, e) : -1
    if (k >= 0) c = k === 0 || k === 3 ? 'nwse-resize' : 'nesw-resize'
    else if (placing?.mode === 'move' || (e && inBox(l, e))) c = placing ? 'grabbing' : 'move'
  } else if (activeTool() === 'move' && !panning && !spaceDown) c = movingPaint ? 'grabbing' : 'move'
  view.style.cursor = c
}

view.addEventListener('pointerdown', e => {
  if (S.play) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  view.setPointerCapture(e.pointerId)
  if (pointers.size === 2) {
    // Two fingers: drop any stroke and pan or pinch.
    cancelStroke()
    const [a, b] = [...pointers.values()]
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
    return
  }
  if (e.button === 1 || spaceDown) {
    panning = { x: e.clientX, y: e.clientY, ox: V.ox, oy: V.oy }
    cursorStyle()
    return
  }
  if (e.button !== 0) return
  const c = cellAt(e)
  if (activeTool() === 'move') {
    const l = placeTarget()
    if (l) return startPlace(l, e)
    const pl = selLayer()
    if (pl && paintable(pl) && shownAt(pl, S.mid)) {
      movingPaint = { id: pl.id, start: { x: e.clientX, y: e.clientY }, from: cellsAt(pl, S.mid, S.frame), dx: 0, dy: 0 }
      cursorStyle(e)
      return
    }
    const block = paintBlock()
    if (block) onBlocked(block)
    return
  }
  startTool(c, e)
})
let movingPaint = null
function movePaint(e) {
  const m = movingPaint
  m.dx = Math.round((e.clientX - m.start.x) / V.zoom)
  m.dy = Math.round((e.clientY - m.start.y) / V.zoom)
  shifted = { id: m.id, arr: shift(m.from, m.dx, m.dy) }
  lastKey = ''
  draw()
}
function endMovePaint() {
  const m = movingPaint
  movingPaint = null
  shifted = null
  cursorStyle()
  if (!m.dx && !m.dy) return draw()
  change('Move', d => {
    const dl = d.layers.find(x => x.id === m.id)
    // Every moment and frame of the layer moves together.
    dl.cells = shift(dl.cells, m.dx, m.dy)
    if (dl.byMoment) dl.byMoment = Object.fromEntries(Object.entries(dl.byMoment).map(([k, v]) => [k, shift(v, m.dx, m.dy)]))
    if (dl.frames) dl.frames = [dl.cells, ...dl.frames.slice(1).map(v => shift(v, m.dx, m.dy))]
  })
}
view.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId)
  if (p) {
    p.x = e.clientX
    p.y = e.clientY
  }
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    const d = Math.hypot(a.x - b.x, a.y - b.y)
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    V.ox += mx - pinch.mx
    V.oy += my - pinch.my
    zoomBy(d / pinch.d, mx, my)
    pinch = { d, mx, my }
    return
  }
  if (panning) {
    V.ox = panning.ox + e.clientX - panning.x
    V.oy = panning.oy + e.clientY - panning.y
    V.mode = 'free'
    clampPan()
    draw()
    return
  }
  if (placing && placing.mode !== 'wheel') {
    const l = selLayer()
    if (l) movePlace(l, e)
    return
  }
  if (movingPaint) return movePaint(e)
  if (activeTool() === 'move') cursorStyle(e)
  const c = cellAt(e)
  const changed = !hover || hover.x !== c.x || hover.y !== c.y
  hover = inside(c) ? c : null
  if (stroke) moveTool(c, e)
  if (changed) {
    draw()
    emit({ hover: hover })
  }
})
function endPointer(e) {
  pointers.delete(e.pointerId)
  if (pinch) {
    if (pointers.size < 2) pinch = null
    return
  }
  if (panning) {
    panning = null
    cursorStyle()
    return
  }
  if (placing && placing.mode !== 'wheel') {
    const l = S.doc.layers.find(x => x.id === placing.id)
    if (l) endPlace(l)
    else placing = null
    return
  }
  if (movingPaint) return endMovePaint()
  if (stroke) endTool(cellAt(e), e)
}
view.addEventListener('pointerup', endPointer)
view.addEventListener('pointercancel', e => {
  pointers.delete(e.pointerId)
  pinch = null
  panning = null
  cancelStroke()
})
view.addEventListener('pointerleave', () => {
  hover = null
  draw()
  emit({ hover: null })
})
view.addEventListener(
  'wheel',
  e => {
    e.preventDefault()
    if (S.play) return
    const pl = e.altKey ? placeTarget() : null
    if (pl) return wheelScale(pl, e)
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX, e.clientY)
    else {
      V.ox -= e.deltaX
      V.mode = 'free'
      clampPan()
      draw()
    }
  },
  { passive: false },
)
addEventListener('keydown', e => {
  if (e.key === 'Alt') {
    altDown = true
    cursorStyle()
  }
  if (e.code === 'Space' && !isTyping(e)) {
    e.preventDefault()
    if (!spaceDown) {
      spaceDown = true
      cursorStyle()
    }
  }
})
addEventListener('keyup', e => {
  if (e.key === 'Alt') {
    altDown = false
    cursorStyle()
  }
  if (e.code === 'Space') {
    spaceDown = false
    cursorStyle()
  }
})
addEventListener('blur', () => {
  altDown = false
  spaceDown = false
  cursorStyle()
})
export const isTyping = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) && !['range', 'checkbox', 'radio', 'color', 'button'].includes(e.target.type)

/* ---------- Tools ---------- */

let stroke = null // { tool, start, last }

// Can the selected layer take paint now? Says why not.
export function paintBlock() {
  const l = selLayer()
  if (!l) return { text: 'Add a layer to paint on first.', action: null }
  if (isImage(l)) return { text: l.name + ' is your art, drawn by its look. Convert it to a paint layer to paint on it (the look stops there).', action: 'convert' }
  if (!paintable(l)) return { text: l.name + ' is drawn by its ' + KIND_LABEL[l.kind].toLowerCase() + ' generator. Convert it to a paint layer to paint on it.', action: 'convert' }
  if (!l.visible) return { text: l.name + ' is hidden. Show it to paint on it.', action: 'show' }
  if (!shownAt(l, S.mid)) return { text: l.name + ' does not show at ' + momentName() + '. Turn it on for this moment to paint on it.', action: 'moment' }
  return null
}
const momentName = () => S.doc.moments.find(m => m.id === S.mid)?.name || 'this moment'
export let onBlocked = () => {}
export const setOnBlocked = fn => (onBlocked = fn)

function startTool(c, e) {
  const tool = activeTool()
  if (tool === 'picker') {
    if (inside(c)) pick(c)
    return
  }
  const block = paintBlock()
  if (block) {
    onBlocked(block)
    return
  }
  if (tool !== 'eraser' && !S.slot) {
    toast(S.doc.palette.length ? 'Pick a colour in the palette first, or hold Alt and click the scene to pick one.' : 'Add a colour to the palette first (the + under Palette).')
    return
  }
  const l = selLayer()
  const d = draft()
  const dl = d.layers.find(x => x.id === l.id)
  const arrays = []
  const all = S.allMoments && dl.byMoment
  if (dl.frames && dl.frames.length > 1) {
    // An animated layer: paint the frame on show.
    const f = S.frame % dl.frames.length
    const copy = dl.frames[f].slice()
    dl.frames = dl.frames.slice()
    dl.frames[f] = copy
    if (f === 0) dl.cells = copy
    arrays.push(copy)
  } else if (dl.byMoment) {
    const ids = all ? Object.keys(dl.byMoment) : [dl.byMoment[S.mid] ? S.mid : null]
    for (const id of ids) {
      if (id) {
        const copy = dl.byMoment[id].slice()
        dl.byMoment = { ...dl.byMoment, [id]: copy }
        arrays.push(copy)
      }
    }
    if (!dl.byMoment[S.mid] || all) {
      dl.cells = (dl.cells || new Uint16Array(N)).slice()
      arrays.push(dl.cells)
    }
  } else {
    dl.cells = (dl.cells || new Uint16Array(N)).slice()
    arrays.push(dl.cells)
  }
  // ref: this moment's cells before the stroke (fill reads its region from them).
  live = { doc: d, arrays, n: 0, ref: cellsAt(l, S.mid, S.frame) || new Uint16Array(N) }
  stroke = { tool, start: c, last: c, shift: e.shiftKey }
  const v = tool === 'eraser' ? 0 : S.slot
  if (tool === 'pencil' || tool === 'eraser') dab(c.x, c.y, v)
  else if (tool === 'fill') {
    if (inside(c)) floodFill(c.x, c.y, v)
    endTool(c, e)
    return
  } else if (tool === 'line' || tool === 'rect') shapePreview(c, e)
  live.n++
  draw()
}
function moveTool(c, e) {
  const v = stroke.tool === 'eraser' ? 0 : S.slot
  if (stroke.tool === 'pencil' || stroke.tool === 'eraser') {
    lineCells(stroke.last.x, stroke.last.y, c.x, c.y, (x, y) => dab(x, y, v))
    stroke.last = c
    live.n++
    draw()
  } else if (stroke.tool === 'line' || stroke.tool === 'rect') {
    shapePreview(c, e)
    live.n++
    draw()
  }
}
function endTool(c, e) {
  if (!stroke) return
  const tool = stroke.tool
  if (tool === 'line' || tool === 'rect') {
    shapePreview(c, e)
    for (const [i, slot] of preview) for (const a of live.arrays) a[i] = slot
    preview = null
  }
  const d = live.doc
  const changed = live.arrays.some(a => {
    for (let i = 0; i < N; i++) if (a[i] !== live.ref[i]) return true
    return false
  }) || live.arrays.length > 1
  live = null
  stroke = null
  if (changed) commitDraft({ pencil: 'Paint', eraser: 'Erase', fill: 'Fill', line: 'Line', rect: 'Rectangle' }[tool] || 'Paint', d)
  else draw()
}
function cancelStroke() {
  live = null
  stroke = null
  preview = null
  lastKey = ''
  draw()
}
function dab(cx, cy, v) {
  const s = S.size
  const o = Math.floor((s - 1) / 2)
  for (let y = cy - o; y < cy - o + s; y++) {
    if (y < 0 || y >= H) continue
    for (let x = cx - o; x < cx - o + s; x++) {
      if (x < 0 || x >= W) continue
      for (const a of live.arrays) a[y * W + x] = v
    }
  }
}
function lineCells(x0, y0, x1, y1, fn) {
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (let guard = 0; guard < 4000; guard++) {
    fn(x0, y0)
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
}
function shapePreview(c, e) {
  const a = stroke.start
  const v = S.slot
  preview = new Map()
  const set = (x, y) => {
    if (x >= 0 && y >= 0 && x < W && y < H) preview.set(y * W + x, v)
  }
  if (stroke.tool === 'line') {
    let b = c
    if (e.shiftKey) {
      // Shift keeps the line straight or at 45 degrees.
      const dx = c.x - a.x
      const dy = c.y - a.y
      if (Math.abs(dx) > 2 * Math.abs(dy)) b = { x: c.x, y: a.y }
      else if (Math.abs(dy) > 2 * Math.abs(dx)) b = { x: a.x, y: c.y }
      else {
        const m = Math.max(Math.abs(dx), Math.abs(dy))
        b = { x: a.x + Math.sign(dx) * m, y: a.y + Math.sign(dy) * m }
      }
    }
    const s = S.size
    const o = Math.floor((s - 1) / 2)
    lineCells(a.x, a.y, b.x, b.y, (x, y) => {
      for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) set(x - o + xx, y - o + yy)
    })
  } else {
    const x0 = Math.min(a.x, c.x)
    const x1 = Math.max(a.x, c.x)
    const y0 = Math.min(a.y, c.y)
    const y1 = Math.max(a.y, c.y)
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (e.shiftKey || y === y0 || y === y1 || x === x0 || x === x1) set(x, y)
      }
    }
  }
}
function floodFill(x, y, v) {
  const ref = live.ref
  const target = ref[y * W + x]
  if (target === v && live.arrays.length === 1) return
  const seen = new Uint8Array(N)
  const stack = [y * W + x]
  while (stack.length) {
    const i = stack.pop()
    if (seen[i] || ref[i] !== target) continue
    seen[i] = 1
    for (const a of live.arrays) a[i] = v
    const cx = i % W
    if (cx > 0) stack.push(i - 1)
    if (cx < W - 1) stack.push(i + 1)
    if (i >= W) stack.push(i - W)
    if (i < N - W) stack.push(i + W)
  }
}
// The eyedropper: the top layer showing a colour at that cell, at this moment.
export function pick(c) {
  const doc = S.doc
  for (let k = doc.layers.length - 1; k >= 0; k--) {
    const l = doc.layers[k]
    if (!shownAt(l, S.mid)) continue
    const s = cellsAt(l, S.mid, S.frame)?.[c.y * W + c.x]
    if (s) {
      S.slot = s
      emit({ slot: true })
      return s
    }
  }
  toast('Nothing is painted there at ' + momentName() + '.')
  return 0
}

export const viewTone = () => lumaNow
export function redrawAll() {
  lastKey = ''
  draw()
}
resize()
void change
