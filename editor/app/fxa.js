// The editor's one door to the looks (editor/fx/): applyLook, applyLookFrames, LOOK_PRESETS,
// DEFAULT_LOOK, normalizeLook, withPreset, estimateCost, removeBackground and decodeAsset
// (from fx/browser.js).
// When editor/fx/ is on the page its functions are used; without it, a small built-in version
// of each stands in, so uploads, looks and presets still work end to end.
//
// A look is fx's: { cut, picture, colors, dither, shapes, glyphs, outline, mirror } (see the
// top of editor/fx/index.js; lookSchema() below lists every field with its words). It runs on
// pixels already placed on the 320 x 200 grid and gives { cells: Uint16Array(w * h), colors }
// where a cell n > 0 is colors[n - 1], darkest first.
import { clamp } from './util.js'

/* ---------- Loading fx ---------- */

let fx = null
let tried = false
let schema = null
export async function loadFx() {
  if (tried) return fx
  tried = true
  const parts = {}
  try {
    Object.assign(parts, await import('./fx/index.js'))
  } catch {
    /* not on this page */
  }
  // The DOM half (decodeAsset: GIF and animated WebP or PNG as frames, at the contract's sizes).
  if (parts.applyLook) {
    try {
      const b = await import('./fx/browser.js')
      if (typeof b.decodeAsset === 'function') parts.decodeAsset = b.decodeAsset
    } catch {
      /* the built-in reader stands in */
    }
  }
  fx = Object.keys(parts).length ? parts : null
  schema = null
  return fx
}
export const fxReady = () => !!fx?.applyLook

/* ---------- Palettes (Nightgrain's, the owner's MIT code; fx brings the full list) ---------- */

const OWN_PALETTES = [
  { id: 'nightgrain', name: 'Night grain', colors: ['#05060d', '#141a3a', '#283f86', '#4f7fd0', '#9cc0f0', '#f6c26b', '#fff6e0'] },
  { id: 'moonsteel', name: 'Moonsteel', colors: ['#020308', '#1c2f6b', '#3f6fc4', '#8fb7ea', '#eef4ff'] },
  { id: 'forge', name: 'Forge', colors: ['#000000', '#5a0f14', '#c8321c', '#f58a1f', '#ffd86b', '#fff8e6'] },
  { id: 'verdigris', name: 'Verdigris', colors: ['#020605', '#0f4a45', '#1f9a7a', '#8ed6a4', '#f1f7d9'] },
  { id: 'sunset', name: 'Sunset', colors: ['#1a0a2b', '#43134f', '#7d1f5c', '#c2394f', '#ee6a45', '#fba65a', '#ffd88f', '#fff4d6'] },
  { id: 'pastel', name: 'Pastel', colors: ['#5b5a7a', '#8d93c4', '#b3cdea', '#f2b8c6', '#f8d7a6', '#cfe8c4', '#fbf4e6'] },
  { id: 'riso', name: 'Riso', colors: ['#f2ead8', '#1b1b1f', '#e8452c', '#2d5fa8', '#f2b632'] },
  { id: 'blueprint', name: 'Blueprint', colors: ['#0b2a6f', '#1d4fb8', '#7fb2ff', '#ffffff'] },
  { id: 'frost', name: 'Frost', colors: ['#01040a', '#0d3b66', '#2e8fc4', '#9ad8f0', '#ffffff'] },
  { id: 'phosphor', name: 'Phosphor', colors: ['#000300', '#0b4a1c', '#1faa3c', '#7dff8a'] },
  { id: 'gameboy', name: 'Pocket', colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'] },
  { id: 'onebit', name: 'One bit', colors: ['#000000', '#ffffff'] },
  { id: 'console16', name: 'Console 16', colors: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'] },
]
const OWN_ALGOS = [
  { id: 'none', name: 'None', group: 'Flat', cost: 'low', hint: 'No dithering: each cell takes its nearest colour. The cheapest.' },
  { id: 'bayer8', name: 'Bayer 8', group: 'Ordered', cost: 'mid', hint: 'The classic fine crosshatch grid.' },
  { id: 'bayer4', name: 'Bayer 4', group: 'Ordered', cost: 'mid', hint: 'A coarser, more visible grid pattern.' },
  { id: 'bayer2', name: 'Bayer 2', group: 'Ordered', cost: 'high', hint: 'Chunky checkerboard mixing, very retro. Costly over large areas.' },
  { id: 'blue', name: 'Blue noise', group: 'Ordered', cost: 'high', hint: 'Evenly scattered grain with no visible pattern.' },
  { id: 'floyd', name: 'Floyd-Steinberg', group: 'Diffusion', cost: 'high', hint: 'Organic, detailed grain. The standard error diffusion.' },
  { id: 'atkinson', name: 'Atkinson', group: 'Diffusion', cost: 'high', hint: 'Crisp and contrasty, the early Macintosh look.' },
]
const OWN_GLYPH_SETS = [{ id: 'signal', name: 'Signal', hint: 'Mixed symbols by brightness: dots, dashes, crosses, blocks.' }]

export const palettes = () => (Array.isArray(fx?.PALETTES) && fx.PALETTES.length ? fx.PALETTES : OWN_PALETTES)
const algos = () => (Array.isArray(fx?.ALGOS) && fx.ALGOS.length ? fx.ALGOS : OWN_ALGOS)
const glyphSets = () => (Array.isArray(fx?.GLYPH_SETS) && fx.GLYPH_SETS.length ? fx.GLYPH_SETS : OWN_GLYPH_SETS)

/* ---------- The look's fields, in the editor's words ---------- */

const pct = v => Math.round(v * 100) + '%'
const signedPct = v => (v > 0 ? '+' : '') + Math.round(v * 100) + '%'
const stops = v => (v > 0 ? '+' : '') + v.toFixed(2) + ' stops'
const PASSES = ['Off', 'Light', 'Medium', 'Strong']
const cutting = v => v.mode !== 'none'
const dithering = v => v.algo !== 'none'

// Each section: { id, name, help, toggle?, top?, fields }. A field is a slider (min, max, step,
// def, fmt or unit), a choice (choice: [[value, label]], select for a dropdown), a switch (bool),
// a colour (color) or a ground (ground: none, dark, light or a colour of its own). `when(value,
// look)` shows it only when it matters. `top` is a stage that is one value (mirror).
function buildSchema() {
  const A = algos()
  return [
    {
      id: 'cut', name: 'Background', help: 'Takes the background away, so the scene shows through around your art.',
      fields: [
        { key: 'mode', label: 'Take away', help: 'Keep the whole picture, or take its background away: found by itself, by a colour you pick, or everything dark or light.', choice: [['none', 'Keep'], ['auto', 'Auto'], ['color', 'Colour'], ['dark', 'Dark'], ['light', 'Light']], def: 'none' },
        { key: 'color', label: 'Colour', help: 'The background colour to take away.', color: true, def: '#ffffff', when: v => v.mode === 'color' },
        { key: 'tol', label: 'Tolerance', help: 'How far a colour may be from the background and still go.', min: 0.02, max: 0.6, step: 0.01, def: 0.16, fmt: pct, when: cutting },
        { key: 'soft', label: 'Soft edge', help: 'How gently the edge between art and background is judged.', min: 0, max: 1, step: 0.05, def: 0.5, fmt: pct, when: cutting },
        { key: 'grow', label: 'Grow or shrink', help: 'Moves the edge of what is kept out or in, in cells.', min: -6, max: 6, step: 1, def: 0, unit: ' cells', when: cutting },
        { key: 'specks', label: 'Clean specks', help: 'Drops loose bits smaller than this many cells.', min: 0, max: 300, step: 1, def: 0, unit: ' cells', when: cutting },
        { key: 'connected', label: 'Only from the edges', help: 'Takes away only background that reaches the edge of the picture, not the same colour inside the art.', bool: true, def: true, when: v => v.mode === 'color' || v.mode === 'dark' || v.mode === 'light' },
      ],
    },
    {
      id: 'picture', name: 'Picture', help: 'Light and colour of the art before it becomes cells.',
      fields: [
        { key: 'exposure', label: 'Exposure', help: 'Brighter or darker, as if the photo had more or less light.', min: -2, max: 2, step: 0.05, def: 0, fmt: stops },
        { key: 'contrast', label: 'Contrast', help: 'Pulls lights and darks apart, or together.', min: -1, max: 1, step: 0.01, def: 0, fmt: signedPct },
        { key: 'saturation', label: 'Saturation', help: 'Stronger or softer colour. All the way down is grey.', min: 0, max: 2, step: 0.01, def: 1, fmt: pct },
        { key: 'hue', label: 'Hue', help: 'Turns every colour around the colour wheel.', min: -180, max: 180, step: 1, def: 0, unit: '°' },
        { key: 'warmth', label: 'Warmth', help: 'Warmer (towards orange) or cooler (towards blue).', min: -1, max: 1, step: 0.01, def: 0, fmt: signedPct },
        { key: 'smooth', label: 'Smooth', help: 'Flattens noise into areas of one colour and keeps the edges. Smoother art costs less.', min: 0, max: 3, step: 1, def: 1, fmt: v => PASSES[v] || String(v) },
        { key: 'levels', label: 'Auto levels', help: 'Stretches the art so its darkest part is near black and its lightest near white.', bool: true, def: false },
      ],
    },
    {
      id: 'colors', name: 'Colours', help: 'How many colours the art keeps, and where they come from. Fewer colours, smaller scene.',
      fields: [
        { key: 'from', label: 'From', help: 'Pull the colours from your art, from the colours this theme already has, or from a ready palette.', choice: [['art', 'Your art'], ['project', 'This theme'], ...palettes().map(p => [p.id, p.name])], def: 'art', select: true },
        { key: 'count', label: 'Colours', help: 'How many colours the art keeps. Fewer colours make a smaller scene.', min: 2, max: 64, step: 1, def: 16, when: v => v.from === 'art' },
        { key: 'merge', label: 'Merge near colours', help: 'Colours that look almost alike become one. Cheaper, and calmer.', min: 0, max: 1, step: 0.01, def: 0.3, fmt: pct, when: v => v.from === 'art' },
        { key: 'map', label: 'Match by', help: 'Nearest takes the closest colour for each cell. Brightness lays the palette from dark to light over the art, like a gradient map.', choice: [['nearest', 'Nearest'], ['ramp', 'Brightness']], def: 'nearest', when: v => v.from !== 'art' },
        { key: 'clean', label: 'Tidy stray cells', help: 'Lone cells take the colour around them. Only without a dither.', min: 0, max: 3, step: 1, def: 1, fmt: v => PASSES[v] || String(v), when: (v, L) => !L.dither.on || L.dither.algo === 'none' },
      ],
    },
    {
      id: 'dither', name: 'Dither', help: 'Mixes neighbouring colours in patterns, so few colours read as many.',
      fields: [
        { key: 'algo', label: 'Pattern', help: 'Ordered patterns repeat and cost less; diffusion scatters cells and costs the most.', choice: A.map(a => [a.id, a.name + (a.id === 'none' ? '' : ' · ' + (a.cost === 'low' ? 'cheap' : a.cost === 'mid' ? 'medium' : 'costly'))]), def: 'none', select: true, hintOf: v => A.find(a => a.id === v)?.hint },
        { key: 'amount', label: 'Amount', help: 'How wide the band is where two colours mix.', min: 0, max: 1, step: 0.01, def: 0.5, fmt: pct, when: dithering },
        { key: 'scale', label: 'Pattern size', help: 'Each step of the pattern as 1 to 4 cells. Bigger is chunkier and cheaper.', min: 1, max: 4, step: 1, def: 1, unit: ' x', when: v => dithering(v) && A.find(a => a.id === v.algo)?.group !== 'Diffusion' },
        { key: 'where', label: 'Where', help: 'Only where the art changes gently (skies, gradients), or everywhere. Busy areas gain only noise and cost.', choice: [['smooth', 'Soft areas'], ['all', 'Everywhere']], def: 'smooth', when: dithering },
      ],
    },
    {
      id: 'shapes', name: 'Pixel shapes', toggle: true, help: 'Draws the art as a grid of small shapes, sized by brightness.',
      fields: [
        { key: 'shape', label: 'Shape', help: 'What each block draws.', choice: [['dot', 'Dot'], ['ring', 'Ring'], ['diamond', 'Diamond'], ['plus', 'Plus'], ['square', 'Square']], def: 'dot' },
        { key: 'k', label: 'Block', help: 'The size of each block, in cells.', min: 3, max: 8, step: 1, def: 5, unit: ' cells' },
        { key: 'bySize', label: 'Size by brightness', help: 'Shapes grow with brightness (with darkness on a light ground). Off, every shape is full size.', bool: true, def: true },
        { key: 'ground', label: 'Ground', help: 'What shows between the shapes: nothing (the scene), the darkest or lightest colour, or a colour of its own.', ground: true, def: 'dark' },
      ],
    },
    {
      id: 'glyphs', name: 'Glyphs', toggle: true, help: 'Draws the art as letters and signs, picked by brightness and by the direction of its edges.',
      fields: [
        { key: 'set', label: 'Glyphs', help: 'Which signs the art is drawn with.', choice: glyphSets().map(g => [g.id, g.name]), def: 'signal', select: true, hintOf: v => glyphSets().find(g => g.id === v)?.hint },
        { key: 'size', label: 'Size', help: 'Each glyph takes 5 x 7 or 7 x 9 cells.', choice: [['5x7', '5 x 7'], ['7x9', '7 x 9']], def: '5x7' },
        { key: 'edges', label: 'Follow edges', help: 'Along strong edges, a stroke in the edge\'s direction instead of a sign.', bool: true, def: true },
        { key: 'ground', label: 'Ground', help: 'What shows between the glyphs: nothing (the scene), the darkest or lightest colour, or a colour of its own.', ground: true, def: 'dark' },
      ],
    },
    {
      id: 'outline', name: 'Outline', toggle: true, help: 'A one-cell line around the art, so it stands out from the scene.',
      fields: [
        { key: 'color', label: 'Colour', help: 'The darkest or lightest colour of the art, or a colour of its own.', ground: true, noNone: true, def: 'dark' },
        { key: 'inner', label: 'Inner lines', help: 'Also inks the edges between areas that differ strongly inside the art.', min: 0, max: 1, step: 0.01, def: 0, fmt: v => (v ? pct(v) : 'Off') },
      ],
    },
    {
      id: 'mirror', name: 'Mirror', top: true, help: 'Repeats the art as its own reflection.',
      fields: [{ key: 'mode', label: 'Mirror', help: 'Left half onto the right, top onto bottom, the top-left quarter into all four, or a kaleidoscope round the centre.', choice: [['none', 'Off'], ['lr', 'Left-right'], ['tb', 'Top-bottom'], ['quad', 'Quarters'], ['kaleido', 'Kaleidoscope']], def: 'none', select: true }],
    },
  ]
}
export const lookSchema = () => (schema ||= buildSchema())

/* ---------- Looks: complete, presets ---------- */

const OWN_DEFAULT = {
  cut: { on: true, mode: 'none', color: '#ffffff', tol: 0.16, soft: 0.5, grow: 0, specks: 0, connected: true },
  picture: { on: true, exposure: 0, contrast: 0, saturation: 1, hue: 0, warmth: 0, levels: false, smooth: 1 },
  colors: { on: true, count: 16, from: 'art', map: 'nearest', merge: 0.3, clean: 1 },
  dither: { on: true, algo: 'none', amount: 0.5, scale: 1, where: 'smooth' },
  shapes: { on: false, k: 5, shape: 'dot', bySize: true, ground: 'dark' },
  glyphs: { on: false, size: '5x7', set: 'signal', edges: true, ground: 'dark' },
  outline: { on: false, color: 'dark', inner: 0 },
  mirror: 'none',
}

// Older drafts of the editor wrote a few fields under other names.
function migrate(look) {
  if (!look || typeof look !== 'object') return {}
  const L = JSON.parse(JSON.stringify(look))
  if (L.dither && L.dither.pattern && !L.dither.algo) {
    L.dither.algo = L.dither.pattern
    if (L.dither.amount > 1) L.dither.amount /= 100
  }
  if (L.cut && L.cut.tolerance !== undefined && L.cut.tol === undefined) L.cut.tol = L.cut.tolerance / 100
  if (L.shapes && L.shapes.size !== undefined && L.shapes.k === undefined) L.shapes.k = L.shapes.size
  if (L.glyphs && L.glyphs.cell && !L.glyphs.size) L.glyphs.size = L.glyphs.cell
  if (L.mirror && typeof L.mirror === 'object') L.mirror = L.mirror.mode || 'none'
  return L
}

// A look with every field filled in and in range.
export function fullLook(look) {
  const L = migrate(look)
  if (fx?.normalizeLook) return fx.normalizeLook(L)
  const out = JSON.parse(JSON.stringify(OWN_DEFAULT))
  for (const [k, v] of Object.entries(L)) {
    if (!(k in out)) continue
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = { ...out[k], ...v }
    else if (typeof v === 'string') out[k] = v
  }
  return out
}
export const defaultLook = () => fullLook({})

// A preset laid over a look: the stages it names start from the defaults; the cut stays.
export function withPreset(look, preset) {
  if (fx?.withPreset) return fx.withPreset(fullLook(look), preset)
  const out = fullLook(preset?.look ?? preset)
  out.cut = fullLook(look).cut
  return out
}
export const sameLook = (a, b) => JSON.stringify(fullLook(a)) === JSON.stringify(fullLook(b))

const P = (id, name, hint, look) => ({ id, name, hint, look })
const OWN_PRESETS = [
  P('clean', 'Clean pixels', 'Your art as tidy pixel art: 16 colours, no grain.', { colors: { count: 16 } }),
  P('soft-dither', 'Soft dither', 'Twelve colours with a fine grid where one colour turns into the next.', { colors: { count: 12 }, dither: { algo: 'bayer4', amount: 0.4 } }),
  P('night-grain', 'Night grain', 'Moonlit blues with warm highlights, mixed on an 8 x 8 grid.', { colors: { from: 'nightgrain', map: 'ramp' }, dither: { algo: 'bayer8', amount: 0.5 } }),
  P('poster', 'Poster', 'Seven bold flat colours, like a screen print.', { picture: { contrast: 0.2, saturation: 1.25 }, colors: { count: 7 } }),
  P('glyph-glow', 'Glyph glow', 'Signs in the art\'s own colours.', { colors: { count: 8 }, glyphs: { on: true } }),
  P('halftone', 'Halftone dots', 'Round dots, bigger where the art is lighter.', { colors: { count: 10 }, shapes: { on: true, k: 6, shape: 'dot' } }),
  P('ink-outline', 'Ink outline', 'Flat colours with dark ink round the shapes.', { colors: { count: 9 }, outline: { on: true, color: 'dark' } }),
  P('game-boy', 'Game Boy', 'Four greens of the old handheld, by brightness.', { colors: { from: 'gameboy', map: 'ramp' }, dither: { algo: 'bayer4', amount: 0.5 } }),
]
export const lookPresets = () => (Array.isArray(fx?.LOOK_PRESETS) && fx.LOOK_PRESETS.length ? fx.LOOK_PRESETS : OWN_PRESETS)

/* ---------- The calls ---------- */

const lower = colors => colors.map(c => String(c).toLowerCase())

export function applyLook(rgba, look, opts = {}) {
  if (fx?.applyLook) {
    const r = fx.applyLook(rgba, fullLook(look), opts)
    return { cells: r.cells instanceof Uint16Array ? r.cells : Uint16Array.from(r.cells), colors: lower(r.colors) }
  }
  return builtInLook(rgba, toBuiltIn(fullLook(look)), opts)
}
// Every frame of animated art with one palette: { frames: [Uint16Array], colors }.
export function applyLookFrames(list, look, opts = {}) {
  if (fx?.applyLookFrames) {
    const r = fx.applyLookFrames(list, fullLook(look), opts)
    return { frames: r.frames.map(f => (f instanceof Uint16Array ? f : Uint16Array.from(f))), colors: lower(r.colors) }
  }
  const first = applyLook(list[0], look, opts)
  const frames = [first.cells]
  for (let k = 1; k < list.length; k++) frames.push(builtInLook(list[k], toBuiltIn(fullLook(look)), { ...opts, colors: first.colors, keep: true }).cells)
  return { frames, colors: first.colors }
}
// fx's fitLook: the look simplified a step at a time until the frames' estimated cost is
// under `budget`. { look, frames, colors, cost, steps, fits }, or null without fx.
export const canFit = () => typeof fx?.fitLook === 'function'
export function fitLook(list, look, opts = {}) {
  if (!canFit()) return null
  const r = fx.fitLook(list, fullLook(look), opts)
  return { ...r, look: fullLook(r.look), steps: r.steps || [] }
}
// About how many characters cells take in a scene. `colors` are the hex values the cells
// index into (cell n is colors[n - 1]).
export function estimateCost(cells, colors) {
  if (!cells) return 0
  if (fx?.estimateCost) return fx.estimateCost(cells, colors || null).chars
  return roughCost(cells)
}
export function removeBackground(rgba, cutOpts) {
  if (fx?.removeBackground) return fx.removeBackground(rgba, fullLook({ cut: cutOpts }).cut)
  const out = { w: rgba.w, h: rgba.h, data: new Uint8ClampedArray(rgba.data) }
  cut(out, toBuiltIn(fullLook({ cut: cutOpts })).cut)
  return out
}
// A file into { name, w, h, frames: [{ png, delay }] } (png in base64), scaled down to the
// contract's sizes.
export async function decodeAsset(file) {
  if (fx?.decodeAsset) return fx.decodeAsset(file)
  return builtInDecode(file)
}

function roughCost(cells) {
  const W = 320
  const H = Math.floor(cells.length / W)
  let runs = 0
  const colours = new Set()
  for (let y = 0; y < H; y++) {
    let prev = 0
    for (let x = 0; x < W; x++) {
      const v = cells[y * W + x]
      if (v && v !== prev) {
        runs++
        colours.add(v)
      }
      prev = v
    }
  }
  return Math.round(runs * 8.6 + colours.size * 36 + Math.ceil(runs / 64) * 28)
}

// fx's look in the built-in engine's own terms.
function toBuiltIn(L) {
  const algo = L.dither.on ? L.dither.algo : 'none'
  const pattern = { none: 'none', bayer2: 'bayer2', bayer4: 'bayer4', bayer8: 'bayer8', bayer16: 'bayer8', cluster: 'bayer4', cross: 'bayer4', linesh: 'bayer4', linesd: 'bayer4', blue: 'blue', white: 'blue', atkinson: 'atkinson' }[algo] || 'floyd'
  const ink = c => (c === 'light' ? '#f4f1ea' : c === 'dark' || !c ? '#151820' : c)
  return {
    cut: L.cut.on ? { mode: L.cut.mode, color: L.cut.color, tolerance: L.cut.tol * 100, grow: L.cut.grow, specks: L.cut.specks } : { mode: 'none' },
    picture: L.picture.on ? { exposure: L.picture.exposure * 50, contrast: L.picture.contrast * 100, saturation: (L.picture.saturation - 1) * 100, hue: L.picture.hue, warmth: L.picture.warmth * 100 } : {},
    colors: L.colors.on ? { count: L.colors.count, from: L.colors.from } : { count: 64, from: 'art' },
    ramp: L.colors.map === 'ramp',
    dither: { pattern, amount: L.dither.amount * 100 },
    shapes: { on: L.shapes.on, size: L.shapes.k, shape: L.shapes.shape },
    glyphs: { on: L.glyphs.on, cell: L.glyphs.size },
    outline: { on: L.outline.on, color: ink(L.outline.color) },
    mirror: { mode: L.mirror === 'tb' || L.mirror === 'quad' ? 'kaleido' : L.mirror },
  }
}

/* ---------- Built-in looks ---------- */

const hexRgb = h => {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgbHex = (r, g, b) => '#' + ((1 << 24) | (clamp(Math.round(r), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(b), 0, 255)).toString(16).slice(1)
const lumOf = (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255

function builtInLook(rgba, L, opts) {
  const { w, h } = rgba
  const n = w * h
  const img = { w, h, data: new Uint8ClampedArray(rgba.data) }
  if (L.cut?.mode && L.cut.mode !== 'none') cut(img, L.cut)
  picture(img, L.picture || {})
  if (L.mirror?.mode && L.mirror.mode !== 'none') mirror(img, L.mirror.mode)
  const d = img.data
  let pal
  const from = L.colors?.from || 'art'
  const named = palettes().find(p => p.id === from)
  const own = c => (typeof c === 'string' ? c : Object.values(c?.colors || {})[0] || '#000000')
  if (opts.colors?.length) pal = opts.colors.map(hexRgb)
  else if (named) pal = named.colors.map(hexRgb)
  else if (from === 'project' && opts.palette?.length) pal = [...new Set(opts.palette.map(own))].slice(0, 256).map(hexRgb)
  else pal = medianCut(d, n, clamp(L.colors?.count || 16, 2, 64))
  if (!pal.length) pal = [[0, 0, 0]]
  const ramp = !!L.ramp && !opts.colors?.length
  let idx
  if (L.shapes?.on) idx = shapes(img, pal, L.shapes, ramp)
  else if (L.glyphs?.on) idx = glyphs(img, pal, L.glyphs, ramp)
  else idx = quantize(img, pal, L.dither || {}, ramp)
  // Outline: empty cells touching the art.
  let outIdx = 0
  if (L.outline?.on) {
    const oc = hexRgb(L.outline.color || '#151820')
    pal = [...pal, oc]
    outIdx = pal.length
    const add = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (idx[i]) continue
        if ((x > 0 && idx[i - 1] && idx[i - 1] !== outIdx) || (x < w - 1 && idx[i + 1] && idx[i + 1] !== outIdx) || (y > 0 && idx[i - w] && idx[i - w] !== outIdx) || (y < h - 1 && idx[i + w] && idx[i + w] !== outIdx)) add.push(i)
      }
    }
    for (const i of add) idx[i] = outIdx
  }
  // Compact: only colours in use, in palette order (or, for the later frames of animated art,
  // the first frame's list kept as it is).
  const used = new Uint8Array(pal.length + 1)
  for (let i = 0; i < n; i++) used[idx[i]] = 1
  const remap = new Uint16Array(pal.length + 1)
  const colors = opts.keep && opts.colors ? [...opts.colors] : []
  const seen = new Map(colors.map((c, k) => [c, k + 1]))
  for (let k = 1; k <= pal.length; k++) {
    if (!used[k]) continue
    const hex = rgbHex(...pal[k - 1])
    if (!seen.has(hex)) {
      colors.push(hex)
      seen.set(hex, colors.length)
    }
    remap[k] = seen.get(hex)
  }
  const cells = new Uint16Array(n)
  for (let i = 0; i < n; i++) cells[i] = remap[idx[i]]
  return { cells, colors }
}

// Background removal, in place: alpha 0 where the background is.
function cut(img, c) {
  const { w, h, data: d } = img
  const n = w * h
  const tol = (c.tolerance ?? 24) / 100
  let transparent = 0
  for (let i = 0; i < n; i++) if (d[i * 4 + 3] < 128) transparent++
  const kill = new Uint8Array(n)
  if (c.mode === 'auto') {
    if (transparent > n * 0.02 && transparent < n * 0.98) {
      // The file brings its own transparency: use it.
    } else {
      // The commonest border colour, flooded in from the edges.
      const counts = new Map()
      const border = []
      for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x)
      for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1)
      for (const i of border) {
        if (d[i * 4 + 3] < 128) continue
        const k = ((d[i * 4] >> 4) << 8) | ((d[i * 4 + 1] >> 4) << 4) | (d[i * 4 + 2] >> 4)
        counts.set(k, (counts.get(k) || 0) + 1)
      }
      let best = -1
      let bn = 0
      for (const [k, v] of counts) if (v > bn) (bn = v), (best = k)
      if (best >= 0) {
        let sr = 0, sg = 0, sb = 0, m = 0
        for (const i of border) {
          const k = ((d[i * 4] >> 4) << 8) | ((d[i * 4 + 1] >> 4) << 4) | (d[i * 4 + 2] >> 4)
          if (k !== best) continue
          sr += d[i * 4]
          sg += d[i * 4 + 1]
          sb += d[i * 4 + 2]
          m++
        }
        const bg = [sr / m, sg / m, sb / m]
        const lim = (tol * 0.6 + 0.04) * 441
        const near = i => Math.hypot(d[i * 4] - bg[0], d[i * 4 + 1] - bg[1], d[i * 4 + 2] - bg[2]) <= lim
        const stack = border.filter(near)
        while (stack.length) {
          const i = stack.pop()
          if (kill[i]) continue
          if (!near(i)) continue
          kill[i] = 1
          const x = i % w
          if (x > 0) stack.push(i - 1)
          if (x < w - 1) stack.push(i + 1)
          if (i >= w) stack.push(i - w)
          if (i < n - w) stack.push(i + w)
        }
      }
    }
  } else if (c.mode === 'color') {
    const bg = hexRgb(c.color || '#ffffff')
    const lim = (tol * 0.6 + 0.02) * 441
    for (let i = 0; i < n; i++) if (Math.hypot(d[i * 4] - bg[0], d[i * 4 + 1] - bg[1], d[i * 4 + 2] - bg[2]) <= lim) kill[i] = 1
  } else if (c.mode === 'dark' || c.mode === 'light') {
    const t = 0.04 + tol * 0.6
    for (let i = 0; i < n; i++) {
      const l = lumOf(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])
      if (c.mode === 'dark' ? l <= t : l >= 1 - t) kill[i] = 1
    }
  }
  for (let i = 0; i < n; i++) if (kill[i]) d[i * 4 + 3] = 0
  // Grow or shrink the kept part.
  const g = c.grow | 0
  for (let step = 0; step < Math.abs(g); step++) {
    const a = new Uint8Array(n)
    for (let i = 0; i < n; i++) a[i] = d[i * 4 + 3] >= 128 ? 1 : 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const nb = (x > 0 && a[i - 1]) + (x < w - 1 && a[i + 1]) + (y > 0 && a[i - w]) + (y < h - 1 && a[i + w])
        if (g > 0 && !a[i] && nb) {
          // Grow: take the colour of a kept neighbour.
          const j = x > 0 && a[i - 1] ? i - 1 : x < w - 1 && a[i + 1] ? i + 1 : y > 0 && a[i - w] ? i - w : i + w
          d[i * 4] = d[j * 4]
          d[i * 4 + 1] = d[j * 4 + 1]
          d[i * 4 + 2] = d[j * 4 + 2]
          d[i * 4 + 3] = 255
        } else if (g < 0 && a[i] && nb < 4) d[i * 4 + 3] = 0
      }
    }
  }
  // Specks: kept islands smaller than the limit go.
  const lim = c.specks | 0
  if (lim > 0) {
    const mark = new Int32Array(n).fill(-1)
    for (let s = 0; s < n; s++) {
      if (mark[s] >= 0 || d[s * 4 + 3] < 128) continue
      const part = []
      const stack = [s]
      mark[s] = s
      while (stack.length) {
        const i = stack.pop()
        part.push(i)
        const x = i % w
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
          if (j < 0 || j >= n || mark[j] >= 0 || d[j * 4 + 3] < 128) continue
          mark[j] = s
          stack.push(j)
        }
      }
      if (part.length < lim) for (const i of part) d[i * 4 + 3] = 0
    }
  }
}

function picture(img, p) {
  const ex = Math.pow(2, (p.exposure || 0) / 50)
  const ct = 1 + (p.contrast || 0) / 100
  const sat = 1 + (p.saturation || 0) / 100
  const warm = (p.warmth || 0) * 0.35
  const hue = ((p.hue || 0) * Math.PI) / 180
  if (ex === 1 && ct === 1 && sat === 1 && !warm && !hue) return
  const cosH = Math.cos(hue)
  const sinH = Math.sin(hue)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] * ex
    let g = d[i + 1] * ex
    let b = d[i + 2] * ex
    r = (r - 128) * ct + 128
    g = (g - 128) * ct + 128
    b = (b - 128) * ct + 128
    r += warm
    b -= warm
    if (hue) {
      // Rotate in YIQ.
      const y = 0.299 * r + 0.587 * g + 0.114 * b
      const ii = 0.596 * r - 0.274 * g - 0.322 * b
      const q = 0.211 * r - 0.523 * g + 0.312 * b
      const i2 = ii * cosH - q * sinH
      const q2 = ii * sinH + q * cosH
      r = y + 0.956 * i2 + 0.621 * q2
      g = y - 0.272 * i2 - 0.647 * q2
      b = y - 1.106 * i2 + 1.703 * q2
    }
    if (sat !== 1) {
      const y = 0.299 * r + 0.587 * g + 0.114 * b
      r = y + (r - y) * sat
      g = y + (g - y) * sat
      b = y + (b - y) * sat
    }
    d[i] = r
    d[i + 1] = g
    d[i + 2] = b
  }
}

function mirror(img, mode) {
  const { w, h, data: d } = img
  const copy = (sx, sy, x, y) => {
    const s = (sy * w + sx) * 4
    const t = (y * w + x) * 4
    d[t] = d[s]
    d[t + 1] = d[s + 1]
    d[t + 2] = d[s + 2]
    d[t + 3] = d[s + 3]
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mode === 'lr' && x >= w / 2) copy(w - 1 - x, y, x, y)
      if (mode === 'kaleido' && (x >= w / 2 || y >= h / 2)) copy(x >= w / 2 ? w - 1 - x : x, y >= h / 2 ? h - 1 - y : y, x, y)
    }
  }
}

// Median cut over the opaque pixels.
function medianCut(d, n, k) {
  const px = []
  for (let i = 0; i < n; i++) if (d[i * 4 + 3] >= 128) px.push(i)
  if (!px.length) return []
  const exact = new Map()
  for (const i of px) {
    const key = (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2]
    if (!exact.has(key)) exact.set(key, 1)
    if (exact.size > k) break
  }
  if (exact.size <= k) return [...exact.keys()].map(v => [(v >> 16) & 255, (v >> 8) & 255, v & 255])
  let boxes = [px]
  const ch = (i, c) => d[i * 4 + c]
  while (boxes.length < k) {
    let bi = -1
    let best = 0
    let bc = 0
    boxes.forEach((b, j) => {
      if (b.length < 2) return
      const step = Math.max(1, Math.floor(b.length / 500))
      for (let c = 0; c < 3; c++) {
        let lo = 255
        let hi = 0
        for (let q = 0; q < b.length; q += step) {
          const v = ch(b[q], c)
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
        const score = (hi - lo) * Math.sqrt(b.length) * (c === 1 ? 1.2 : 1)
        if (score > best) (best = score), (bi = j), (bc = c)
      }
    })
    if (bi < 0) break
    const b = boxes[bi].sort((a, z) => ch(a, bc) - ch(z, bc))
    const m = b.length >> 1
    boxes.splice(bi, 1, b.slice(0, m), b.slice(m))
  }
  return boxes
    .filter(b => b.length)
    .map(b => {
      let r = 0, g = 0, bl = 0
      for (const i of b) {
        r += d[i * 4]
        g += d[i * 4 + 1]
        bl += d[i * 4 + 2]
      }
      return [r / b.length, g / b.length, bl / b.length].map(Math.round)
    })
}

const B2 = [0, 2, 3, 1]
const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const B8 = (() => {
  const out = new Array(64)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) out[y * 8 + x] = 4 * B4[(y & 3) * 4 + (x & 3)] + B2[((y >> 2) & 1) * 2 + ((x >> 2) & 1)]
  return out
})()
// A threshold in -0.5..0.5 for an ordered pattern.
function threshold(pattern, x, y) {
  switch (pattern) {
    case 'bayer2': return (B2[(y & 1) * 2 + (x & 1)] + 0.5) / 4 - 0.5
    case 'bayer4': return (B4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5
    case 'bayer8': return (B8[(y & 7) * 8 + (x & 7)] + 0.5) / 64 - 0.5
    case 'blue': {
      // Interleaved gradient noise: even, without a visible grid.
      const v = (52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1)) % 1
      return v - 0.5
    }
  }
  return 0
}

function nearestOf(pal) {
  const cache = new Map()
  return (r, g, b) => {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2)
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    let best = 0
    let bd = Infinity
    for (let k = 0; k < pal.length; k++) {
      const p = pal[k]
      const dr = p[0] - r
      const dg = p[1] - g
      const db = p[2] - b
      const dd = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11
      if (dd < bd) (bd = dd), (best = k)
    }
    cache.set(key, best + 1)
    return best + 1
  }
}

function quantize(img, pal, dither, ramp) {
  const { w, h, data: d } = img
  const n = w * h
  const out = new Uint16Array(n)
  const pattern = dither.pattern || 'none'
  const amt = pattern === 'none' ? 0 : (dither.amount ?? 50) / 100
  if (ramp) {
    // Map brightness onto the palette's steps, darkest to lightest.
    const order = pal.map((p, k) => ({ k, l: lumOf(...p) })).sort((a, b) => a.l - b.l)
    const steps = order.length
    const err = pattern === 'floyd' || pattern === 'atkinson' ? new Float32Array(n) : null
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (d[i * 4 + 3] < 128) continue
        let v = lumOf(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) * (steps - 1)
        if (err) v += err[i]
        else if (amt) v += threshold(pattern, x, y) * amt * 1.6
        const s = clamp(Math.round(v), 0, steps - 1)
        out[i] = order[s].k + 1
        if (err) diffuse(err, null, w, h, x, y, (v - s) * amt, pattern, d)
      }
    }
    return out
  }
  const near = nearestOf(pal)
  if (pattern === 'floyd' || pattern === 'atkinson') {
    const e = new Float32Array(n * 3)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (d[i * 4 + 3] < 128) continue
        const r = d[i * 4] + e[i * 3]
        const g = d[i * 4 + 1] + e[i * 3 + 1]
        const b = d[i * 4 + 2] + e[i * 3 + 2]
        const k = near(clamp(r, 0, 255) | 0, clamp(g, 0, 255) | 0, clamp(b, 0, 255) | 0)
        out[i] = k
        const p = pal[k - 1]
        diffuse(e, [(r - p[0]) * amt, (g - p[1]) * amt, (b - p[2]) * amt], w, h, x, y, 0, pattern, d)
      }
    }
    return out
  }
  const spread = amt * 72
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (d[i * 4 + 3] < 128) continue
      const t = amt ? threshold(pattern, x, y) * spread : 0
      out[i] = near(clamp(d[i * 4] + t, 0, 255) | 0, clamp(d[i * 4 + 1] + t, 0, 255) | 0, clamp(d[i * 4 + 2] + t, 0, 255) | 0)
    }
  }
  return out
}
// Spreads an error to the pixels ahead (Floyd-Steinberg or Atkinson), skipping empty ones.
function diffuse(e, rgb, w, h, x, y, scalar, pattern, d) {
  const taps = pattern === 'atkinson'
    ? [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]]
    : [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]]
  for (const [dx, dy, f] of taps) {
    const xx = x + dx
    const yy = y + dy
    if (xx < 0 || xx >= w || yy >= h) continue
    const j = yy * w + xx
    if (d[j * 4 + 3] < 128) continue
    if (rgb) {
      e[j * 3] += rgb[0] * f
      e[j * 3 + 1] += rgb[1] * f
      e[j * 3 + 2] += rgb[2] * f
    } else e[j] += scalar * f
  }
}

// Blocks of k x k cells, each a shape in the block's colour sized by its brightness.
function shapes(img, pal, s, ramp) {
  const { w, h, data: d } = img
  const k = clamp(s.size | 0 || 4, 3, 8)
  const out = new Uint16Array(w * h)
  const near = nearestOf(pal)
  const order = ramp ? pal.map((p, q) => ({ q, l: lumOf(...p) })).sort((a, b) => a.l - b.l) : null
  for (let by = 0; by < h; by += k) {
    for (let bx = 0; bx < w; bx += k) {
      let r = 0, g = 0, b = 0, m = 0, total = 0
      for (let y = by; y < Math.min(h, by + k); y++) {
        for (let x = bx; x < Math.min(w, bx + k); x++) {
          total++
          const i = (y * w + x) * 4
          if (d[i + 3] < 128) continue
          r += d[i]
          g += d[i + 1]
          b += d[i + 2]
          m++
        }
      }
      if (m < total / 2) continue
      r /= m
      g /= m
      b /= m
      const l = lumOf(r, g, b)
      const slot = ramp ? order[clamp(Math.round(l * (order.length - 1)), 0, order.length - 1)].q + 1 : near(r | 0, g | 0, b | 0)
      const rad = (0.3 + 0.7 * Math.sqrt(l)) * (k / 2)
      const c = (k - 1) / 2
      for (let y = 0; y < k; y++) {
        for (let x = 0; x < k; x++) {
          const dx = x - c
          const dy = y - c
          let on
          switch (s.shape) {
            case 'ring': {
              const dist = Math.hypot(dx, dy)
              on = dist <= rad + 0.2 && dist >= rad - 1.1
              break
            }
            case 'diamond': on = Math.abs(dx) + Math.abs(dy) <= rad + 0.3; break
            case 'plus': on = (Math.abs(dx) < 0.6 || Math.abs(dy) < 0.6) && Math.max(Math.abs(dx), Math.abs(dy)) <= rad + 0.3; break
            case 'square': on = Math.max(Math.abs(dx), Math.abs(dy)) <= rad - 0.3; break
            default: on = Math.hypot(dx, dy) <= rad
          }
          const X = bx + x
          const Y = by + y
          if (on && X < w && Y < h) out[Y * w + X] = slot
        }
      }
    }
  }
  return out
}

// Glyphs at cell scale: each block a sign picked by brightness and edge direction.
const G57 = {
  dot: ['.....', '.....', '.....', '..#..', '.....', '.....', '.....'],
  colon: ['.....', '..#..', '.....', '.....', '.....', '..#..', '.....'],
  dash: ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  bar: ['..#..', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  slash: ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  back: ['#....', '.#...', '.#...', '..#..', '...#.', '...#.', '....#'],
  plus: ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  star: ['.....', '#.#.#', '.###.', '#####', '.###.', '#.#.#', '.....'],
  hash: ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  at: ['.###.', '#...#', '#.###', '#.#.#', '#.###', '#....', '.####'],
  full: ['#####', '##.##', '#####', '#.#.#', '#####', '##.##', '#####'],
}
function scaleGlyph(g, gw, gh) {
  const out = []
  for (let y = 0; y < gh; y++) {
    let row = ''
    for (let x = 0; x < gw; x++) row += g[Math.min(6, Math.floor((y * 7) / gh))][Math.min(4, Math.floor((x * 5) / gw))]
    out.push(row)
  }
  return out
}
function glyphs(img, pal, s, ramp) {
  const { w, h, data: d } = img
  const [gw, gh] = s.cell === '7x9' ? [7, 9] : [5, 7]
  const set = Object.fromEntries(Object.entries(G57).map(([k, g]) => [k, gw === 5 ? g : scaleGlyph(g, gw, gh)]))
  const out = new Uint16Array(w * h)
  const near = nearestOf(pal)
  const order = ramp ? pal.map((p, q) => ({ q, l: lumOf(...p) })).sort((a, b) => a.l - b.l) : null
  const L = (x, y) => {
    x = clamp(x, 0, w - 1)
    y = clamp(y, 0, h - 1)
    const i = (y * w + x) * 4
    return d[i + 3] < 128 ? 0 : lumOf(d[i], d[i + 1], d[i + 2])
  }
  for (let by = 0; by < h; by += gh) {
    for (let bx = 0; bx < w; bx += gw) {
      let r = 0, g = 0, b = 0, m = 0, gx = 0, gy = 0
      for (let y = by; y < Math.min(h, by + gh); y++) {
        for (let x = bx; x < Math.min(w, bx + gw); x++) {
          const i = (y * w + x) * 4
          gx += L(x + 1, y) - L(x - 1, y)
          gy += L(x, y + 1) - L(x, y - 1)
          if (d[i + 3] < 128) continue
          r += d[i]
          g += d[i + 1]
          b += d[i + 2]
          m++
        }
      }
      if (m < (gw * gh) / 3) continue
      r /= m
      g /= m
      b /= m
      const l = lumOf(r, g, b)
      const edge = Math.hypot(gx, gy) / (gw * gh)
      let name
      if (edge > 0.06) {
        const a = ((Math.atan2(gy, gx) * 180) / Math.PI + 180) % 180
        name = a < 22 || a >= 158 ? 'bar' : a < 68 ? 'back' : a < 112 ? 'dash' : 'slash'
      } else name = ['dot', 'colon', 'dash', 'plus', 'star', 'hash', 'at', 'full'][clamp(Math.floor(l * 8), 0, 7)]
      // Light marks on dark: glyphs take a lighter step of the colour.
      const lift = 1.25
      const slot = ramp ? order[clamp(Math.round(l * (order.length - 1)) + 1, 0, order.length - 1)].q + 1 : near(clamp(r * lift, 0, 255) | 0, clamp(g * lift, 0, 255) | 0, clamp(b * lift, 0, 255) | 0)
      const gl = set[name]
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (gl[y][x] === '#' && bx + x < w && by + y < h) out[(by + y) * w + bx + x] = slot
    }
  }
  return out
}

/* ---------- Built-in decoding ---------- */

const MAX_STILL = 960
const MAX_ANIM = 480
const MAX_FRAMES = 48

async function canvasPng(canvas) {
  const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/png' }) : await new Promise(r => canvas.toBlob(r, 'image/png'))
  const buf = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000))
  return btoa(s)
}
function scaled(w, h, max) {
  const k = Math.min(1, max / Math.max(w, h))
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))]
}
async function builtInDecode(file) {
  const name = file.name || 'art'
  const type = file.type || ''
  const animated = /gif|webp|apng|png/.test(type) && typeof ImageDecoder !== 'undefined'
  if (animated) {
    try {
      const dec = new ImageDecoder({ data: await file.arrayBuffer(), type })
      await dec.tracks.ready
      const track = dec.tracks.selectedTrack
      const count = track?.frameCount || 1
      if (count > 1) {
        const pick = []
        const step = count / Math.min(count, MAX_FRAMES)
        for (let k = 0; k < Math.min(count, MAX_FRAMES); k++) pick.push(Math.floor(k * step))
        const frames = []
        let w = 0
        let h = 0
        for (let k = 0; k < pick.length; k++) {
          const { image } = await dec.decode({ frameIndex: pick[k] })
          if (!w) [w, h] = scaled(image.displayWidth, image.displayHeight, MAX_ANIM)
          const c = new OffscreenCanvas(w, h)
          const x = c.getContext('2d')
          x.imageSmoothingQuality = 'high'
          x.drawImage(image, 0, 0, w, h)
          // Delays add up over the frames left out.
          const ms = Math.round(((image.duration || 100000) / 1000) * step)
          image.close()
          frames.push({ png: await canvasPng(c), delay: clamp(ms, 20, 5000) })
        }
        dec.close()
        return { name, w, h, frames }
      }
      dec.close()
    } catch {
      /* fall through to a still */
    }
  }
  const bmp = await createImageBitmap(file)
  const [w, h] = scaled(bmp.width, bmp.height, MAX_STILL)
  const c = new OffscreenCanvas(w, h)
  const x = c.getContext('2d')
  x.imageSmoothingQuality = 'high'
  x.drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  return { name, w, h, frames: [{ png: await canvasPng(c), delay: 100 }] }
}
