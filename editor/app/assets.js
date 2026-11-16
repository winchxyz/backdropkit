// Your own art: files in (decoded once, kept as PNG frames in the project), placed on the
// 320 x 200 grid, turned into cells by a look, and its colours given slots in the shared
// palette (an exact colour already there is reused; new ones are relit for the other moments).
import { S, change, layer as getLayer } from './state.js'
import { H, N, W, KIND_LABEL, MAX_FRAMES, MAX_SLOTS, addSlot, colorOf, newId, newLayer, removeSlots, setSlotColors, slotUsage } from './project.js'
import { applyLook, applyLookFrames, canFit, decodeAsset, defaultLook, estimateCost, fitLook, fullLook } from './fxa.js'
import { kindOf, relight } from './color.js'
import { clamp } from './util.js'

export const ART_LINE = 'The app plays pixel scenes only, so your art becomes cells on the 320 x 200 grid; the look decides how.'
// The line is said once a visit, when art first comes in; it stays in the panels after that.
let artLineSaid = false
export const firstArt = () => !artLineSaid && (artLineSaid = true)
export const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
export const isArtFile = f => /^image\/(png|jpe?g|webp|gif)$/i.test(f?.type || '') || /\.(png|jpe?g|webp|gif)$/i.test(f?.name || '')

/* ---------- Bitmaps of the assets' frames ---------- */

const bitmaps = new Map() // 'a1' -> Promise<ImageBitmap[]>
export function framesOf(assetId, doc = S.doc) {
  const a = doc.assets?.[assetId]
  if (!a) return Promise.resolve([])
  const key = assetId + ':' + a.frames.length + ':' + a.frames[0].png.length
  let p = bitmaps.get(key)
  if (!p) {
    p = Promise.all(
      a.frames.map(async f => {
        const bin = atob(f.png)
        const u8 = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
        return createImageBitmap(new Blob([u8], { type: 'image/png' }))
      }),
    )
    bitmaps.set(key, p)
  }
  return p
}
const ready = new Map() // key -> ImageBitmap[] once loaded
async function loaded(assetId, doc = S.doc) {
  const list = await framesOf(assetId, doc)
  ready.set(assetId, list)
  return list
}
export const bitmapsNow = id => ready.get(id) || null

/* ---------- Placing ---------- */

// Where art goes when it comes in: a picture as big as the scene covers it (bottom-centred,
// as the app fills the window); a cut-out sprite stands in the lower middle at a fair size.
export function defaultPlace(asset, bmp) {
  const w = asset.w
  const h = asset.h
  let sprite = false
  if (bmp) {
    const c = new OffscreenCanvas(Math.min(w, 96), Math.min(h, 96))
    const x = c.getContext('2d', { willReadFrequently: true })
    x.drawImage(bmp, 0, 0, c.width, c.height)
    const d = x.getImageData(0, 0, c.width, c.height).data
    let clear = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] < 128) clear++
    sprite = clear > d.length / 4 / 20
  }
  if (!sprite) {
    const s = Math.max(W / w, H / h)
    return { x: Math.round((W - w * s) / 2), y: Math.round(H - h * s), scale: round3(s), flipX: false }
  }
  const s = Math.min(1, (H * 0.45) / h, (W * 0.4) / w) || 1
  return { x: Math.round((W - w * s) / 2), y: Math.round(H - h * s - H * 0.08), scale: round3(s), flipX: false }
}
const round3 = v => Math.round(v * 1000) / 1000
export const boxOf = (layer, doc = S.doc, mid = S.mid) => {
  const id = assetAt(layer, mid, doc)
  const a = doc.assets?.[id]
  const p = placeOf(layer, id, doc)
  if (!a || !p) return null
  return { x: p.x, y: p.y, w: a.w * p.scale, h: a.h * p.scale }
}

/* ---------- Versions: one picture per time of day ---------- */

// An image layer may hold other pictures of the same scene for some moments
// (`versions: { momentId: assetId }`, editor-only). The picture shown at a moment is its
// version there, else the layer's own (`asset`). All of them share the look and the place.
export const assetAt = (l, mid = S.mid, doc = S.doc) => {
  const v = l?.versions?.[mid]
  return v && doc.assets?.[v] ? v : l?.asset
}
// Every picture the layer shows, its own first.
export const assetsOf = (l, doc = S.doc) => [...new Set([l.asset, ...doc.moments.map(m => assetAt(l, m.id, doc))])].filter(id => id && doc.assets?.[id])
export const hasVersions = (l, doc = S.doc) => !!l?.versions && assetsOf(l, doc).length > 1
// The moments a picture of the layer shows at.
export const momentsOf = (l, assetId, doc = S.doc) => doc.moments.filter(m => assetAt(l, m.id, doc) === assetId).map(m => m.id)
// Where a version sits: as wide as the layer's own picture, standing on the same foot.
export function placeOf(l, assetId = l.asset, doc = S.doc, place = l.place) {
  if (!place || assetId === l.asset) return place
  const base = doc.assets?.[l.asset]
  const a = doc.assets?.[assetId]
  if (!base || !a) return place
  const s = round3((place.scale * base.w) / a.w)
  return { ...place, scale: s, y: Math.round(place.y + base.h * place.scale - a.h * s) }
}

const scratch = new OffscreenCanvas(W, H)
const sctx = scratch.getContext('2d', { willReadFrequently: true })
// One frame of the asset placed on the grid: { w: 320, h: 200, data }.
export function placed(bmp, place) {
  sctx.setTransform(1, 0, 0, 1, 0, 0)
  sctx.clearRect(0, 0, W, H)
  const s = place.scale
  // Smaller than its pixels: smooth; larger: each pixel stays a block of cells.
  sctx.imageSmoothingEnabled = s < 1
  sctx.imageSmoothingQuality = 'high'
  if (place.flipX) {
    sctx.translate(place.x + bmp.width * s, place.y)
    sctx.scale(-1, 1)
    sctx.drawImage(bmp, 0, 0, bmp.width * s, bmp.height * s)
  } else sctx.drawImage(bmp, place.x, place.y, bmp.width * s, bmp.height * s)
  return { w: W, h: H, data: sctx.getImageData(0, 0, W, H).data }
}

/* ---------- Baking: look -> cells -> slots ---------- */

const projectColors = (doc, mid) => {
  const out = []
  for (let s = 1; s <= doc.palette.length; s++) out.push(colorOf(doc, s, mid))
  return out
}

// Runs the look on every frame of an image layer in a draft and gives it cells and slots.
// The bitmaps must be loaded (await loaded()) before.
export function bake(d, l, mid = S.mid) {
  if (hasVersions(l, d)) return bakeVersions(d, l)
  const bmps = bitmapsNow(l.asset)
  if (!bmps || !bmps.length) return false
  const look = fullLook(l.look)
  const pal = projectColors(d, mid)
  // One palette for every frame, so animated art does not flicker.
  const r = applyLookFrames(bmps.map(b => placed(b, l.place)), look, { palette: pal })
  writeResults(d, l, r.frames.map(cells => ({ cells, colors: r.colors })))
  return true
}

// A layer with versions: each picture through the same look, its cells written for the
// moments it shows at (byMoment). Slot k takes, at each moment, the k-th colour (darkest
// first) of the picture shown then, so the palette swaps with the picture. Versions are
// stills: an animated picture gives its first frame.
function bakeVersions(d, l) {
  const look = fullLook(l.look)
  const res = new Map()
  for (const id of assetsOf(l, d)) {
    const bmp = bitmapsNow(id)?.[0]
    if (!bmp) return false
    const first = momentsOf(l, id, d)[0] || d.moments[0].id
    res.set(id, applyLook(placed(bmp, placeOf(l, id, d)), look, { palette: projectColors(d, first) }))
  }
  const n = Math.max(0, ...[...res.values()].map(r => r.colors.length))
  const wants = []
  for (let k = 0; k < n; k++) {
    const colors = {}
    for (const m of d.moments) {
      const c = res.get(assetAt(l, m.id, d)).colors
      colors[m.id] = c[Math.min(k, c.length - 1)] || '#000000'
    }
    wants.push(colors)
  }
  assignSlots(d, l, wants, slots => {
    const byMoment = {}
    for (const m of d.moments) {
      const r = res.get(assetAt(l, m.id, d))
      byMoment[m.id] = mapCells(r.cells, slots.slice(0, r.colors.length))
    }
    l.byMoment = byMoment
    const own = momentsOf(l, l.asset, d)[0] || d.moments[0].id
    l.cells = byMoment[own].slice()
    delete l.frames
    delete l.anim
  })
  return true
}

// The colours a slot of this art takes at each moment. Art keeps its own colours all day;
// with `lit` on, it is taken as drawn by day and takes each moment's light.
export function artColors(d, l, hex) {
  const colors = {}
  for (const m of d.moments) colors[m.id] = l.lit ? relight(hex, 'day', kindOf(m)) : hex
  return colors
}
const sameColors = (a, b, mids) => mids.every(id => (a[id] || '').toLowerCase() === (b[id] || '').toLowerCase())

// Gives colours slots and writes the cells (frames when there are several).
function writeResults(d, l, results) {
  const want = [...new Set(results.flatMap(r => r.colors))]
  assignSlots(d, l, want.map(hex => artColors(d, l, hex)), slots => {
    const slotOf = new Map(want.map((hex, k) => [hex, slots[k]]))
    const frames = results.map(r => mapCells(r.cells, r.colors.map(c => slotOf.get(c))))
    l.cells = frames[0]
    l.byMoment = null
    if (frames.length > 1) {
      l.frames = frames
      l.anim = l.anim || { fps: fpsOf(d.assets[l.asset]) }
    } else {
      delete l.frames
      delete l.anim
    }
  })
}

// Gives each wanted set of colours ({ momentId: hex }) a slot, then write(slots) writes the
// cells (a slot is 0 when the palette is full). A slot already in the palette (not the
// layer's own) with the very colours at every moment is shared; the layer's own slots are
// reused; own slots no longer needed (and used by nothing else) go once the cells are in.
function assignSlots(d, l, wants, write) {
  const mids = d.moments.map(m => m.id)
  const own = new Set(l.own || [])
  const others = slotUsage(d, l.id)
  const byKey = new Map()
  for (let s = 1; s <= d.palette.length; s++) {
    if (own.has(s)) continue
    const key = mids.map(id => colorOf(d, s, id)).join()
    if (!byKey.has(key)) byKey.set(key, s)
  }
  // Own slots another layer also uses now (after a merge, say) are not recoloured.
  const free = [...own].filter(s => !others[s])
  const keep = new Set()
  const slots = wants.map(colors => {
    let s = byKey.get(mids.map(id => colors[id]).join())
    if (!s) {
      // An own slot that already has these colours keeps them; otherwise a free one is reused.
      const exact = free.findIndex(x => sameColors(d.palette[x - 1]?.colors || {}, colors, mids))
      s = exact >= 0 ? free.splice(exact, 1)[0] : free.shift()
      if (s) setSlotColors(d, s, colors)
      else if (d.palette.length < MAX_SLOTS) s = addSlot(d, colors)
      if (s) keep.add(s)
    }
    return s || 0
  })
  write(slots)
  l.own = [...keep]
  const drop = new Set([...own].filter(s => !keep.has(s) && !others[s]))
  if (drop.size) removeSlots(d, drop)
}
// Cells numbered 1..n by a look into palette slots (slots[k] for colour k + 1).
function mapCells(cells, slots) {
  const m = new Uint16Array(slots.length + 1)
  slots.forEach((s, k) => (m[k + 1] = s || 0))
  const out = new Uint16Array(N)
  for (let i = 0; i < N; i++) out[i] = m[cells[i]] || 0
  return out
}
// The asset's own pace, from its frame delays.
export function fpsOf(a) {
  if (!a || a.frames.length < 2) return 10
  const ms = a.frames.reduce((t, f) => t + (f.delay || 100), 0) / a.frames.length
  return clamp(Math.round(1000 / ms), 1, 20)
}

/* ---------- Actions ---------- */

// Files in: each becomes an asset. Returns the new asset ids.
export async function importFiles(files, { onStep } = {}) {
  const list = [...files].filter(isArtFile)
  const decoded = []
  const failed = []
  for (const f of list) {
    onStep?.('Reading ' + f.name)
    try {
      const a = await decodeAsset(f)
      if (!a?.frames?.length) throw new Error('empty')
      a.frames = a.frames.slice(0, MAX_FRAMES)
      decoded.push(a)
    } catch {
      failed.push(f.name)
    }
  }
  const ids = []
  if (decoded.length) {
    change(decoded.length > 1 ? 'Add ' + decoded.length + ' pieces of art' : 'Add ' + decoded[0].name, d => {
      d.assets = { ...(d.assets || {}) }
      for (const a of decoded) {
        const id = newId(Object.keys(d.assets).map(id => ({ id })), 'a')
        d.assets[id] = { name: String(a.name).slice(0, 80), w: a.w, h: a.h, frames: a.frames.map(f => ({ png: f.png, delay: f.delay || 100 })) }
        ids.push(id)
      }
    })
  }
  return { ids, failed }
}

// A new image layer from an asset, above the selected layer (or on top). `versions`
// ({ momentId: assetId }) gives it other pictures of the same scene for some moments.
export async function addImageLayer(assetId, { name, place, look, at, versions } = {}) {
  const a = S.doc.assets?.[assetId]
  if (!a) return null
  const bmps = await loaded(assetId)
  if (versions) await Promise.all(Object.values(versions).map(v => loaded(v)))
  let id = null
  change('Add ' + (name || a.name), d => {
    const l = newLayer(d, 'image', name || cleanName(a.name))
    l.asset = assetId
    if (versions && Object.keys(versions).length) l.versions = { ...versions }
    l.place = place || defaultPlace(a, bmps[0])
    l.look = look ? fullLook(look) : defaultLook()
    l.live = []
    const i = at ?? (S.sel ? d.layers.findIndex(x => x.id === S.sel) + 1 : d.layers.length)
    d.layers.splice(i <= 0 ? d.layers.length : i, 0, l)
    bake(d, l)
    id = l.id
  })
  if (id) {
    S.sel = id
    S.tool = 'move'
  }
  return id
}
export const cleanName = n => String(n || KIND_LABEL.image).replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').slice(0, 40) || KIND_LABEL.image

export async function rebake(id, label, patch, key) {
  const l = getLayer(id)
  if (!l || !l.asset) return false
  await Promise.all(assetsOf({ ...l, ...patch }).map(a => loaded(a)))
  return change(label, d => {
    const dl = d.layers.find(x => x.id === id)
    Object.assign(dl, patch)
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete dl[k]
    if (!bake(d, dl)) return false
  }, key)
}
export const setLook = (id, look, key) => rebake(id, 'Change the look', { look: fullLook(look) }, key)
// The look taken down step by step until the art costs at most `budget` characters (all its
// frames together; with versions, the costliest picture, as one shows at a time). Returns
// { steps, fits, cost }, steps naming what changed, or null.
export async function fitArt(id, budget) {
  const l = getLayer(id)
  if (!l?.asset || !canFit()) return null
  let r = null
  if (hasVersions(l)) {
    for (const a of assetsOf(l)) {
      const bmp = (await loaded(a))[0]
      const one = fitLook([placed(bmp, placeOf(l, a))], l.look, { budget, palette: projectColors(S.doc, momentsOf(l, a)[0] || S.mid) })
      if (one && (!r || one.steps.length > r.steps.length || (!one.fits && one.cost > r.cost))) r = one
    }
  } else {
    const bmps = await loaded(l.asset)
    r = fitLook(bmps.map(b => placed(b, l.place)), l.look, { budget, palette: projectColors(S.doc, S.mid) })
  }
  if (!r) return null
  if (r.steps.length) await rebake(id, 'Make the art fit', { look: r.look })
  return { steps: r.steps, fits: r.fits, cost: r.cost }
}

/* ---------- Versions ---------- */

// Shows `assetId` at moment `mid` (the layer's own picture when assetId is its asset or null).
// If the layer's own picture is left with no moment, the first version takes its place.
export async function setVersionAt(id, mid, assetId, label = 'Change a time-of-day version') {
  const l = getLayer(id)
  if (!l?.asset) return false
  const versions = { ...(l.versions || {}) }
  if (!assetId || assetId === l.asset) delete versions[mid]
  else versions[mid] = assetId
  return rebake(id, label, tidyVersions(l, versions))
}
// A new picture for one moment of the layer: file in, shown at `mid` only.
export async function addVersion(id, file, mid) {
  const { ids, failed } = await importFiles([file])
  if (!ids.length) return { failed }
  await setVersionAt(id, mid, ids[0], 'Add a version for ' + (S.doc.moments.find(m => m.id === mid)?.name || mid))
  return { ids, failed }
}
// The layer stops using a version; its moments go back to the layer's own picture.
export function removeVersion(id, assetId) {
  const l = getLayer(id)
  if (!l?.versions) return false
  const versions = Object.fromEntries(Object.entries(l.versions).filter(([, a]) => a !== assetId))
  return rebake(id, 'Remove a version', tidyVersions(l, versions))
}
// The patch for a layer's versions: none left drops the field; when the layer's own picture
// shows at no moment, the picture of the first moment becomes its own (placed the same).
export function tidyVersions(l, versions, doc = S.doc) {
  const mids = doc.moments.map(m => m.id)
  for (const k of Object.keys(versions)) if (!mids.includes(k) || !doc.assets?.[versions[k]] || versions[k] === l.asset) delete versions[k]
  let asset = l.asset
  let place = l.place
  if (mids.every(m => versions[m])) {
    asset = versions[mids[0]]
    place = placeOf(l, asset, doc)
    for (const k of Object.keys(versions)) if (versions[k] === asset) delete versions[k]
  }
  return { asset, place, versions: Object.keys(versions).length ? versions : undefined }
}
// Each picture becomes an image layer of its own, shown at its moments only, so each can
// have its own look. The layer keeps its own picture.
export async function splitVersions(id) {
  const l = getLayer(id)
  if (!hasVersions(l)) return false
  await Promise.all(assetsOf(l).map(a => loaded(a)))
  return change('Split into layers', d => {
    const i = d.layers.findIndex(x => x.id === id)
    const src = d.layers[i]
    const mids = d.moments.map(m => m.id)
    const add = []
    for (const a of assetsOf(src, d)) {
      if (a === src.asset) continue
      const at = momentsOf(src, a, d)
      const nl = { ...newLayer(d, 'image', cleanName(d.assets[a].name)), asset: a, place: placeOf(src, a, d), look: fullLook(src.look), live: (src.live || []).map(e => ({ ...e })), motion: { ...src.motion } }
      nl.id = newId([...d.layers, ...add], 'l')
      nl.show = Object.fromEntries(mids.filter(m => !at.includes(m) || src.show?.[m] === false).map(m => [m, false]))
      add.push(nl)
    }
    const own = momentsOf(src, src.asset, d)
    src.show = Object.fromEntries(mids.filter(m => !own.includes(m) || src.show?.[m] === false).map(m => [m, false]))
    delete src.versions
    d.layers.splice(i + 1, 0, ...add)
    for (const x of [src, ...add]) bake(d, x)
  })
}
export const setLit = (id, on) => rebake(id, on ? 'Light the art by the time of day' : 'Keep the art\'s own colours', { lit: !!on })
export const setPlace = (id, place, key) => rebake(id, 'Move the art', { place: { ...getLayer(id).place, ...place } }, key)
export async function replaceAsset(id, assetId) {
  const a = S.doc.assets?.[assetId]
  const l = getLayer(id)
  if (!a || !l) return false
  const bmps = await loaded(assetId)
  // The layer's own picture is replaced (its versions stay).
  const was = S.doc.assets?.[l.asset]
  const keepBox = was && l.place ? { x: l.place.x, y: l.place.y, w: was.w * l.place.scale, h: was.h * l.place.scale } : null
  let place = defaultPlace(a, bmps[0])
  if (keepBox) {
    // Same height and foot as the art it replaces.
    const s = keepBox.h / a.h
    place = { x: Math.round(keepBox.x + (keepBox.w - a.w * s) / 2), y: Math.round(keepBox.y), scale: round3(s), flipX: l.place?.flipX || false }
  }
  const patch = { asset: assetId, place, anim: undefined }
  return rebake(id, 'Replace the art', l.versions ? { ...patch, ...tidyVersions({ ...l, ...patch }, { ...l.versions }) } : patch)
}
export function setFps(id, fps, key) {
  return change('Change the speed', d => {
    const dl = d.layers.find(x => x.id === id)
    if (!dl.frames) return false
    dl.anim = { fps: clamp(Math.round(fps), 1, 20) }
  }, key)
}
export const assetUsers = assetId => S.doc.layers.filter(l => l.asset === assetId || Object.values(l.versions || {}).includes(assetId))
export function removeAsset(assetId) {
  if (assetUsers(assetId).length) return false
  return change('Remove art', d => {
    d.assets = { ...d.assets }
    delete d.assets[assetId]
  })
}

// How bright a picture is on average (0 dark .. 1 light), over its opaque pixels.
export async function assetLuma(assetId) {
  const bmp = (await loaded(assetId))[0]
  if (!bmp) return 0.5
  const c = new OffscreenCanvas(48, 30)
  const x = c.getContext('2d', { willReadFrequently: true })
  x.drawImage(bmp, 0, 0, c.width, c.height)
  const d = x.getImageData(0, 0, c.width, c.height).data
  let t = 0
  let n = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue
    t += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
    n++
  }
  return n ? t / n : 0.5
}

// Loads every asset's bitmaps (after opening a project), quietly.
export async function warmAll(doc = S.doc) {
  await Promise.all(Object.keys(doc.assets || {}).map(id => loaded(id, doc).catch(() => null)))
}

/* ---------- Previews (no slots: the look's own colours) ---------- */

const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1
const pack = (r, g, b) => (LE ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0)
const packHex = hex => {
  const n = parseInt(hex.slice(1), 16)
  return pack((n >> 16) & 255, (n >> 8) & 255, n & 255)
}

// The layer as a look would draw it, in packed pixels (0 = clear), for live previews.
export function previewPx(l, { look = l.look, place = l.place, frame = 0 } = {}, mid = S.mid) {
  const id = assetAt(l, mid)
  const bmps = bitmapsNow(id)
  if (!bmps?.length) return null
  // A version is a still; it sits where the layer's place puts it.
  const rgba = placed(id === l.asset ? bmps[frame % bmps.length] : bmps[0], placeOf(l, id, S.doc, place))
  const r = applyLook(rgba, fullLook(look), { palette: projectColors(S.doc, mid) })
  const cols = r.colors.map(packHex)
  const px = new Uint32Array(N)
  for (let i = 0; i < N; i++) if (r.cells[i]) px[i] = cols[r.cells[i] - 1]
  return { px, colors: r.colors.length, list: r.colors, cells: r.cells }
}
// The art itself, placed, before any look: "hold to compare".
export function originalPx(l, frame = 0) {
  const id = assetAt(l)
  const bmps = bitmapsNow(id)
  if (!bmps?.length) return null
  const d = placed(id === l.asset ? bmps[frame % bmps.length] : bmps[0], placeOf(l, id)).data
  const px = new Uint32Array(N)
  for (let i = 0; i < N; i++) if (d[i * 4 + 3] >= 128) px[i] = pack(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])
  return px
}
// A thumbnail of a look on the visitor's own art, cropped to the art's box.
export function lookThumb(canvas, l, look) {
  const p = previewPx(l, { look })
  const x = canvas.getContext('2d')
  x.clearRect(0, 0, canvas.width, canvas.height)
  if (!p) return
  const box = boxOf(l) || { x: 0, y: 0, w: W, h: H }
  const bx = clamp(Math.floor(box.x), 0, W - 1)
  const by = clamp(Math.floor(box.y), 0, H - 1)
  const bw = clamp(Math.ceil(box.x + box.w), bx + 1, W) - bx
  const bh = clamp(Math.ceil(box.y + box.h), by + 1, H) - by
  const img = new ImageData(new Uint8ClampedArray(p.px.buffer), W, H)
  const off = new OffscreenCanvas(W, H)
  off.getContext('2d').putImageData(img, 0, 0)
  // Fit the box into the thumbnail, crisp.
  const k = Math.min(canvas.width / bw, canvas.height / bh)
  x.imageSmoothingEnabled = false
  const dw = bw * k
  const dh = bh * k
  x.drawImage(off, bx, by, bw, bh, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh)
}
// About how many characters a layer's cells take in a scene, as fx's estimate counts them.
export function costOf(cells, mid = S.mid, doc = S.doc) {
  if (!cells) return 0
  return estimateCost(cells, projectColors(doc, mid))
}
