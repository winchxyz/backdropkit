// The three moments of Gas Station: light, sky, palette and the board's colours. Directions
// point toward the light; screen positions are cells of the 320 x 200 grid. The key lights'
// directions are set in build.mjs (KEY) from the numbers in notes.md.
const c = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]
const k = (h, s) => c(h).map(v => v * s)

export const SUN = { x: 196, y: 117 }
export const MOON = { x: 58, y: 34 }
const toward = (p, x, y) => {
  const dx = p.x - x
  const dy = p.y - y
  return Math.abs(dx) > Math.abs(dy) * 1.4 ? [Math.sign(dx), 0] : [0, Math.sign(dy)]
}

export const MOMENTS = {
  // Early afternoon: the sun high behind us on the right. Fronts and right-hand faces warm,
  // shadows cobalt from the sky, falling back and to the left; a deep blue desert sky with
  // drifting cumulus; the mesas lit on their faces toward us.
  day: {
    sun: { c: k('#fff1da', 1.04), soft: 0.01 },
    ambUp: k('#6d90c4', 0.68),
    ambDown: k('#c2b4a0', 0.72),
    contact: [0.62, 0.66, 0.8],
    haze: { c: c('#c6dcee'), d: 2600, k: 0.62 },
    grade: { sat: 1.08, lift: [0.0, 0.01, 0.03], gain: [1.0, 1.0, 1.0] },
    rim: null,
    glassSky: k('#8fc0ee', 0.8),
    underShade: { c: '#141a2c', k: 0.62 },
    room: ['#ffe2a8', '#c89c64', '#e8c48a'],
    shopLit: false,
    canopyOn: false,
    lampOn: false,
    signLit: false,
    sky: [
      [-20, '#14509e'],
      [20, '#2268bc'],
      [55, '#3d86d2'],
      [85, '#66a6e2'],
      [108, '#97c6ee'],
      [122, '#c4def2'],
      [128, '#dbe9f1'],
    ],
    glow: { x: 280, y: 0, rx: 200, ry: 70, lift: 3 },
    clouds: { tones: ['#7f97cc', '#a0b6e2', '#c2d2f0', '#dfe8f8', '#f3f6fc', '#ffffff'], light: [0.5, -0.75, 0.45] },
    board: {
      panel: '#141012',
      ink: '#ffb52e',
      halo: '#3a1c10',
      strip: '#efe4cc',
      stripInk: '#163c40',
    },
  },

  // Sunset: the sun just over the flat horizon between the canopy and the pylon. Everything
  // facing us is in shadow and violet, edges toward the sun rimmed orange, shadows very long
  // and fanning out toward us. The canopy's lights and the signs have just come on.
  sunset: {
    sun: { c: k('#ffad62', 1.3), soft: 0.012 },
    ambUp: k('#8f7ec0', 0.46),
    ambDown: k('#c98468', 0.32),
    contact: [0.68, 0.66, 0.78],
    haze: { c: c('#f4ae80'), d: 520, k: 0.84 },
    grade: { sat: 1.12, lift: [0.035, 0.0, 0.05], gain: [1.04, 0.98, 0.94] },
    rim: { dir: (x, y) => toward(SUN, x, y), c: k('#ffb066', 0.5) },
    spec: { p: 24, k: 0.5 },
    glassSky: k('#f2a77a', 0.75),
    room: ['#ffd590', '#c8935a', '#f0bd78'],
    shopLit: true,
    windowLight: k('#ffb860', 0.7),
    canopyOn: true,
    canopyLamp: '#fff3dc',
    canopyC: k('#ffe9c8', 0.9),
    soffitGlow: [0.32, 0.42],
    lampOn: true,
    lampGlowC: '#ffd08a',
    lampHalo: { c: '#ffd08a', k: 0.22, r: 6 },
    truckSheen: k('#ff9a58', 0.32),
    lampC: k('#ffb860', 0.9),
    signLit: true,
    bandGlow: '#2aa6a6',
    pumpGlow: '#fff0d0',
    screenGlow: '#7ad0c0',
    shopSign: '#ffe8c0',
    pylonGlow: k('#ffb060', 0.5),
    bloom: 0.08,
    sky: [
      [-20, '#2b2f6c'],
      [18, '#463f8a'],
      [52, '#8a5294'],
      [80, '#d0707a'],
      [100, '#f49a64'],
      [114, '#ffc274'],
      [124, '#ffe0a0'],
      [128, '#fff0c4'],
    ],
    glow: { x: SUN.x, y: SUN.y, rx: 90, ry: 36, lift: 10 },
    sunDisc: { x: SUN.x, y: SUN.y, r: 6, tones: ['#ffd27a', '#ffe9b0', '#fff8e4'], halo: '#ffca7e' },
    clouds: {
      tones: ['#5d4f86', '#88608e', '#c27486', '#ec9a7a', '#ffc68e', '#fff0c4'],
      light: [-0.1, 0.8, 0.35],
      bright: 0.5,
      baseShade: -0.1,
      topLift: -0.12,
    },
    headlights: true,
    truckShadow: true,
    underShade: { c: '#1e1028', k: 0.55 },
    board: {
      panel: '#120d0e',
      ink: '#ffc23e',
      halo: '#6a2a0e',
      strip: '#f6e6c4',
      stripInk: '#173c40',
      neonDim: '#c43c52',
      neonGlow: '#7a4652',
      neon: '#ff6a7c',
    },
  },

  // Night: a high moon at the upper left, stars; the canopy's downlights pooling warm white on
  // the lot, the shop window warm, the pylon glowing, a sodium lamp over the road.
  night: {
    sun: { c: k('#9fb8ee', 0.3), soft: 0.02 },
    ambUp: k('#394a7a', 0.3),
    ambDown: k('#2a2a3c', 0.2),
    contact: [0.7, 0.7, 0.8],
    haze: { c: c('#1d2a4e'), d: 900, k: 0.72 },
    grade: { sat: 1.1, lift: [0.0, 0.01, 0.04], gain: [1.0, 1.0, 1.04] },
    rim: { dir: (x, y) => toward(MOON, x, y), c: k('#8fa8e0', 0.1) },
    glassSky: k('#30406a', 0.55),
    room: ['#ffd690', '#b8844e', '#e6b070'],
    shopLit: true,
    windowLight: k('#ffb860', 1.1),
    canopyOn: true,
    canopyLamp: '#fff6e4',
    canopyC: k('#fff0d8', 1.45),
    soffitGlow: [0.22, 0.4],
    lampOn: true,
    lampGlowC: '#ffd690',
    lampHalo: { c: '#ffb860', k: 0.42, r: 8 },
    truckSheen: k('#8296c8', 0.16),
    truckFill: k('#ffb070', 0.45),
    underShade: { c: '#08080e', k: 0.6 },
    lampC: k('#ffa850', 2.8),
    signLit: true,
    bandGlow: '#2fb4b2',
    pumpGlow: '#fff2d6',
    screenGlow: '#86e0cc',
    shopSign: '#fff0d0',
    pylonGlow: k('#ffb060', 0.8),
    bloom: 0.16,
    dither: { lot: 0.3, road: 0.3 },
    headlights: true,
    beam: { c: '#ffe2a6', k: 0.34 },
    moths: '#c8b898',
    sky: [
      [-20, '#050817'],
      [30, '#0a1330'],
      [75, '#132350'],
      [105, '#1e3462'],
      [122, '#2c4474'],
      [128, '#36507e'],
    ],
    glow: { x: MOON.x, y: MOON.y, rx: 50, ry: 40, lift: 4 },
    moon: { x: MOON.x, y: MOON.y, r: 5, tones: ['#aeb8cc', '#d6dce6', '#eef1f6'], halo: '#3c5088' },
    stars: ['#ffffff', '#c9d4f0', '#7f90c0'],
    clouds: {
      tones: ['#121a32', '#1b2646', '#283758', '#38496e', '#56688e', '#8496bc'],
      light: [-0.3, -0.8, 0.5],
      bright: 0.42,
      list: [
        { id: 'na', puffs: [{ x: 150, y: 44, r: 6 }, { x: 164, y: 41, r: 7 }, { x: 178, y: 44, r: 5 }], base: 47, sy: 1.5, drift: 10, dur: 80 },
        { id: 'nb', puffs: [{ x: 214, y: 70, r: 5 }, { x: 226, y: 68, r: 6 }, { x: 238, y: 71, r: 4 }], base: 73, sy: 1.5, drift: 8, dur: 90 },
      ],
    },
    board: {
      panel: '#0e0a0c',
      ink: '#ffc44a',
      halo: '#7a2e0a',
      strip: '#f0dcb0',
      stripInk: '#173a3e',
      neonDim: '#d8405a',
      neonGlow: '#5a2a3c',
      neon: '#ff7088',
    },
  },
}
