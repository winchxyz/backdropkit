// The three moments of Side Street: light, sky and palette. Directions point toward the light;
// screen positions are cells of the 320 x 200 grid.
const nrm = v => {
  const l = Math.hypot(...v)
  return v.map(c => c / l)
}
const c = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]
const k = (h, s) => c(h).map(v => v * s)

// The evening sun sits low over the sea between the near pole and the crossing's pole.
const SUN = { x: 140, y: 60 }
const MOON = { x: 100, y: 21 }
const toward = (p, x, y) => {
  const dx = p.x - x
  const dy = p.y - y
  return Math.abs(dx) > Math.abs(dy) * 1.4 ? [Math.sign(dx), 0] : [0, Math.sign(dy)]
}

export const MOMENTS = {
  // Late morning: the sun high on the left and behind us, so the poles throw their shadows
  // across the lane and down it; a clear blue sky with cumulus over the headland.
  // The key light's direction is set in build.mjs (KEY.day): 50 degrees up, upper left, as far
  // behind us as to the left. Warm sun against a cobalt sky: lit faces peach, cream and sand; everything the sun
  // misses takes the sky's blue (the shadow colour, ambUp), never grey.
  day: {
    sun: { d: nrm([-0.53, -0.77, -0.37]), c: k('#ffc282', 1.24), soft: 0.02 },
    ambUp: k('#5c85b8', 1.0),
    ambDown: k('#384050', 0.75),
    contact: [0.6, 0.68, 0.84],
    lineShadows: true,
    haze: { c: c('#bfe2f6'), d: 1900, k: 0.55 },
    sea: { near: '#1670a8', far: '#5cc0de' },
    grade: { sat: 1.15, lift: [0.0, 0.01, 0.03], gain: [1.0, 1.0, 1.0] },
    rim: { dir: () => [-1, 0], c: k('#fff0d6', 0.12) },
    litP: 0,
    room: ['#ffd590'],
    glassSky: k('#86bff0', 0.78),
    vend: k('#ffffff', 0.35),
    vendBtn: k('#ff5040', 0.3),
    lampOn: false,
    sky: [
      [-20, '#0a4cae'],
      [12, '#1a64c8'],
      [36, '#2e84de'],
      [56, '#55a8ee'],
      [70, '#86c9f5'],
      [80, '#b4e2f8'],
    ],
    glow: { x: 0, y: 10, rx: 170, ry: 90, lift: 4 },
    clouds: { tones: ['#8299d6', '#a2b4e6', '#c3cff2', '#dfe6f9', '#f2f5fd', '#ffffff'], light: [-0.6, -0.7, 0.4] },
    // Little glints all over the bay, more toward the left where the sun is.
    glitter: { tones: ['#f4fbff', '#cfe6f6'], weight: (x, y) => (y > 80 ? 0.035 + (x < 120 ? 0.03 : 0) : 0), hot: 0.4 },
  },

  // Evening: the sun low over the sea, straight down the view past the headland; the light
  // comes at us, every edge facing it rimmed in orange, the poles' shadows long down the lane,
  // the asphalt glaring; lamps just on, a few windows lit, the vending machines bright.
  evening: {
    sun: { d: nrm([(SUN.x - 176) / 230, (SUN.y - 78) / 230, 1]), c: k('#ffb36e', 1.25), soft: 0.012 },
    ambUp: k('#8f86c2', 0.42),
    contact: [0.66, 0.66, 0.78],
    ambDown: k('#c4876a', 0.3),
    haze: { c: c('#f2b48a'), d: 420, k: 0.86 },
    sea: { near: '#3d4668', far: '#f6c08e' },
    grade: { sat: 1.15, lift: [0.035, 0.0, 0.05], gain: [1.05, 0.98, 0.93] },
    rim: { dir: (x, y) => toward(SUN, x, y), c: k('#ffb066', 0.5) },
    spec: { p: 26, k: 0.55 },
    litP: 0.22,
    room: ['#ffcf80', '#ffe2a8', '#f6b86a'],
    glassSky: k('#f2a77a', 0.75),
    vend: k('#ffffff', 0.62),
    vendBtn: k('#ff5040', 0.55),
    vendLight: k('#eaf0ff', 0.45),
    lampOn: true,
    lampC: k('#ffcf8a', 1.1),
    bloom: 0.08,
    signLit: 0.25,
    lampGlowC: '#8a3a26',
    trainSign: '#f0a040',
    sky: [
      [-20, '#3b4a8a'],
      [15, '#5f5d9e'],
      [38, '#b47896'],
      [56, '#ee9a78'],
      [70, '#ffc27e'],
      [79, '#ffe0a4'],
    ],
    glow: { x: SUN.x, y: SUN.y, rx: 80, ry: 34, lift: 9 },
    sunDisc: { x: SUN.x, y: SUN.y, r: 6, tones: ['#ffd27a', '#ffe9b0', '#fff8e4'], halo: '#ffca7e' },
    clouds: {
      tones: ['#5d5486', '#8a6290', '#c97a86', '#f0a07a', '#ffc98e', '#fff0c4'],
      light: [-0.05, 0.75, 0.35],
      bright: 0.5,
      baseShade: -0.1,
      topLift: -0.12,
    },
    // The sun's path on the water: a column of sparks widening toward us.
    glitter: { tones: ['#fff6d2', '#ffc77a'], weight: (x, y) => (Math.abs(x + 0.5 - SUN.x) < 1.5 + (y - 78) * 0.45 ? 0.5 - Math.abs(x + 0.5 - SUN.x) * 0.03 : 0), hot: 0.5, wide: 0.4 },
    rays: { x: SUN.x, y: SUN.y, c: '#ffe2a8', n: 9, spread: 0.11 },
  },

  // Night: a high moon over the bay, stars, the street lamps pooling warm light on the lane,
  // the vending machines glowing, windows lit all down the hill.
  night: {
    sun: { d: nrm([(MOON.x - 176) / 230, (MOON.y - 78) / 230 - 0.2, 1]), c: k('#9fb8ee', 0.34), soft: 0.02 },
    ambUp: k('#3c4c7c', 0.34),
    contact: [0.7, 0.7, 0.8],
    windowLight: k('#ffa850', 1.1),
    ambDown: k('#2c2c3e', 0.22),
    haze: { c: c('#26335a'), d: 520, k: 0.78 },
    sea: { near: '#0d1a2e', far: '#33466e' },
    grade: { sat: 1.12, lift: [0.0, 0.01, 0.04], gain: [1.0, 1.0, 1.04] },
    rim: { dir: (x, y) => toward(MOON, x, y), c: k('#8fa8e0', 0.12) },
    litP: 0.55,
    // The lamp pools grade the asphalt in steps rather than speckle.
    dither: { road: 0.3 },
    room: ['#ffc870', '#ffd994', '#f4b060', '#ffe6b0'],
    glassSky: k('#30406a', 0.55),
    vend: k('#ffffff', 1.0),
    vendBtn: k('#ff5040', 0.8),
    vendLight: k('#fff0dc', 1.4),
    lampOn: true,
    lampC: k('#ffc888', 2.3),
    bloom: 0.16,
    signLit: 0.7,
    lampGlowC: '#5a2420',
    trainLit: k('#eef2e0', 0.82),
    trainSign: '#ffb050',
    catEye: [0.45, 0.55, 0.15],
    sky: [
      [-20, '#060a1a'],
      [25, '#0d1634'],
      [55, '#17264e'],
      [72, '#28396a'],
      [80, '#3a4d80'],
    ],
    glow: { x: MOON.x, y: MOON.y, rx: 50, ry: 40, lift: 4 },
    moon: { x: MOON.x, y: MOON.y, r: 5, tones: ['#aeb8cc', '#d6dce6', '#eef1f6'], halo: '#3c5088' },
    stars: ['#ffffff', '#c9d4f0', '#7f90c0'],
    clouds: {
      tones: ['#121a32', '#1b2646', '#283758', '#38496e', '#56688e', '#8496bc'],
      light: [-0.3, -0.8, 0.5],
      bright: 0.42,
      // Thin night clouds: a long low bank on the headland, a small one by the moon.
      list: [
        { id: 'na', puffs: [{ x: 10, y: 60, r: 7 }, { x: 26, y: 57, r: 8 }, { x: 44, y: 59, r: 7 }, { x: 60, y: 61, r: 6 }], base: 64, sy: 1.6, drift: 10, dur: 80 },
        { id: 'nb', puffs: [{ x: 168, y: 36, r: 6 }, { x: 180, y: 33, r: 7 }, { x: 193, y: 36, r: 5 }], base: 39, sy: 1.4, drift: 12, dur: 90 },
        { id: 'nc', puffs: [{ x: 128, y: 14, r: 4 }, { x: 136, y: 12, r: 5 }, { x: 144, y: 15, r: 3.5 }], base: 17, sy: 1.3, drift: 8, dur: 70 },
      ],
    },
    glitter: { tones: ['#e6ecff', '#8fa2d0'], weight: (x, y) => (Math.abs(x + 0.5 - MOON.x) < 1 + (y - 78) * 0.3 ? 0.4 : 0), hot: 0.4 },
  },
}
