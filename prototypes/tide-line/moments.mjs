// Tide Line's three moments: one drawing, its light and colours per moment.
// Every tone list runs dark to light.

const SX = 228

// The clouds, the same in every moment: long streaks of [x, y, rx, ry] puffs, and how each
// drifts there and back ([seconds, cells, seconds into its swing]).
const CLOUDS = [
  { seed: 7, puffs: [[30, 6, 36, 1.3], [74, 4, 24, 1.1]], drift: [60, 6, 14] },
  { seed: 6, puffs: [[250, 14, 30, 1.4], [292, 11, 26, 1.2]], drift: [56, 5, 30] },
  { seed: 1, puffs: [[16, 28, 34, 2.4], [52, 26, 30, 3], [86, 29, 26, 2.2], [114, 27, 18, 1.8]], drift: [64, 6, 40] },
  {
    seed: 2,
    puffs: [[172, 56, 14, 3], [190, 53, 18, 4.5], [214, 50, 20, 6], [240, 51, 18, 5.5], [264, 47, 22, 6.5], [290, 50, 20, 5.5], [316, 52, 18, 4.5], [336, 54, 14, 3.5]],
    base: 57,
    drift: [52, 4, 10],
  },
  { seed: 3, puffs: [[56, 62, 22, 2.6], [80, 64, 16, 2]], drift: [48, 4, 22] },
  { seed: 5, puffs: [[128, 87, 22, 1.6], [154, 89, 14, 1.3]], drift: [44, 3, 5] },
  { seed: 8, puffs: [[298, 91, 24, 1.5], [322, 93, 14, 1.2]], drift: [46, 3, 12] },
  { seed: 4, puffs: [[198, 99, 16, 1.1], [228, 98, 22, 1.2], [256, 100, 14, 1]], drift: [40, 3, 18], lift: 0.05 },
]

// The waves' lobes along the beach: centre, half width, run-up (cells), cycle and phase (s).
// The first one's foam lies on the sand at its reach in the still frame.
const LOBES = [
  { cx: 40, hw: 92, R: 19, T: 10, l: 6.6, seed: 1, rest: true },
  { cx: 168, hw: 78, R: 15, T: 12.5, l: 4.1, seed: 2 },
  { cx: 282, hw: 82, R: 18, T: 11, l: 1.2, seed: 3 },
]

export const MOMENTS = {
  sunset: {
    sky: [
      [-2, '#1c1840'], [14, '#251b4d'], [30, '#321f59'], [46, '#472664'], [60, '#622c6b'], [72, '#82336d'], [82, '#a43e6c'],
      [90, '#c74d66'], [96, '#e2625a'], [100, '#f27d4e'], [104, '#fd9a4c'], [110, '#ffb557'], [118, '#ffcd72'], [128, '#ffe39c'], [140, '#fff3cc'],
    ],
    glow: { x: SX, y: 106, rx: 100, ry: 40, lift: 16 },
    rays: { x: SX, y: 106, reach: 120, list: [[34, 4, 3], [52, 5, -3], [71, 4, 4], [93, 5, 3], [112, 4, -3], [131, 5, 4], [152, 4, 3]] },
    sun: { x: SX, y: 106, r: 12, sq: 0.88, halo: '#ffd98a', tones: ['#ff9a48', '#ffc468', '#ffe6a2', '#fff4d4', '#fffcf0'] },
    clouds: {
      list: CLOUDS, below: true, base: 0.22, rim: 0.55, sun: 0.3, lx: SX, ly: 100, lw: 90,
      tones: ['#2c1a44', '#3c204e', '#542a5c', '#703466', '#924068', '#b84e66', '#dc6460', '#f88a5c', '#ffb466', '#ffd88a'],
    },
    land: {
      tones: ['#2a1838', '#341c42', '#40224c', '#4e2a56', '#5e3260'], base: 0.2, haze: 0.5, rim: ['#9a4a64', '#f08a60'], rimSide: 1,
      tower: { w: '#c8a0a0', s: '#6a4258', b: '#8a3a48', d: '#2a1830', g: '#3a2838' },
    },
    lamp: ['#fff2c0', '#ffc870', '#c8705a'],
    windows: 2,
    island: ['#9a4664', '#b85662'],
    sea: {
      tones: ['#1a1330', '#221838', '#2c1c44', '#3a224e', '#4c2858', '#64305e', '#823a64', '#a44664', '#c85860', '#e8745a', '#ff9a5a', '#ffc070', '#ffe6a4'],
      far: 0.62, near: 0.2, path: 0.35, pathW: [6, 44], wave: 0.06, foamBase: 0.45, foamGlow: 0.25,
    },
    foam: ['#4a2e58', '#6e4268', '#9a5a76', '#c47a84', '#e8a090', '#ffc8a0', '#ffe6c4', '#fff6e6'],
    glint: ['#ff9a5a', '#ffc070', '#ffe6a4', '#fff8e0'],
    beach: {
      wet: ['#24182e', '#2e1c38', '#3a2242', '#4a284c', '#5c3056', '#723a5c', '#8c445e', '#aa5260', '#c86460', '#e47e5e', '#fca064', '#ffc880', '#ffe8b4'],
      mirror: [0.16, 0.8], streak: 0.55, streakW: [5, 14], dry: [0.5, -0.14], crest: 0.16, trough: 0.08,
      sand: ['#24162c', '#301c36', '#3e2440', '#4e2c48', '#603650', '#784258', '#90505c', '#a85e60', '#c27064', '#dc8a6a', '#f2aa76'],
      weed: ['#1c1424', '#3a2a2e'], print: ['#2a1a34', '#3a2440', '#a05a5e'], shell: ['#ffd0a0', '#ffe8c8', '#3a2440'],
    },
    wave: {
      crest: ['#a04864', '#d0605e', '#f08a5a', '#ffb868', '#ffdc96'],
      face: ['#1e1636', '#2a1c44', '#3c244e', '#5a2e58', '#8a3e5e', '#c45a5c', '#f08a5a'],
      sheet0: 0.36, sheetSun: 0.4, sheetLift: 0.08, laceV: 0.4,
      sheetTones: ['#2a1c40', '#36224c', '#442a58', '#563262', '#6c3c6a', '#86486e', '#a6566e', '#c86a6c', '#e8846a', '#ffa874', '#ffcf90'],
    },
    fore: {
      dune: [0.42, 0.35], duneRim: ['#b06a62', '#ff9e66'],
      grass: ['#140c1c', '#1e1226', '#2a182e', '#3a2038', '#e07a5a', '#ffb070'],
      wood: ['#1a0f1e', '#28162c', '#381e36', '#4c2840', '#62344a', '#a0605a', '#c47a64'],
      woodRim: ['#d0705a', '#ffa868'],
    },
    gull: '#2a1830',
    haze: { rows: [[118, 141, 0.32]], colour: ['#ffb07a', '#ffd8a0'], o: 0.22, k: 6 },
    boat: ['#2a1830', '#f0905c'],
    boatLight: null,
    lobes: LOBES,
  },

  sunrise: {
    sky: [
      [-2, '#25336c'], [16, '#2d3c78'], [32, '#384584'], [48, '#4a5090'], [62, '#615c98'], [74, '#7c669c'], [84, '#9a709e'],
      [92, '#ba7c9e'], [98, '#d88c9a'], [102, '#eda094'], [106, '#f9b690'], [114, '#ffcb98'], [124, '#ffe0b0'], [136, '#fff2d6'],
    ],
    glow: { x: SX, y: 98, rx: 90, ry: 40, lift: 14 },
    rays: { x: SX, y: 95, reach: 110, list: [[30, 4, 3], [50, 5, 3], [68, 4, -3], [88, 5, 4], [108, 4, 3], [128, 5, -3], [150, 4, 3]] },
    sun: { x: SX, y: 95, r: 10, sq: 0.94, halo: '#ffe6c0', tones: ['#ffbc84', '#ffdcaa', '#fff0d2', '#fffaf0', '#ffffff'] },
    clouds: {
      list: CLOUDS, below: true, base: 0.25, rim: 0.5, sun: 0.28, lx: SX, ly: 95, lw: 90,
      tones: ['#3a3c78', '#484684', '#5a508e', '#705a96', '#8a649a', '#a8709c', '#c8809e', '#e696a2', '#fab4aa', '#ffd6bc'],
    },
    land: {
      tones: ['#3a3a70', '#44427a', '#504a84', '#5e548c', '#6c5e94'], base: 0.25, haze: 0.55, rim: ['#a87a9e', '#f0b0a8'], rimSide: 1,
      tower: { w: '#e0c8d0', s: '#7a6890', b: '#9a5a78', d: '#3a3a6a', g: '#5a5a88' },
    },
    lamp: null,
    windows: 0,
    island: ['#8a72a0', '#a07ea6'],
    sea: {
      tones: ['#1a2252', '#202a5e', '#28326a', '#323c76', '#3e4682', '#4e528c', '#625e96', '#7a6a9e', '#9678a2', '#b688a4', '#d89ca4', '#f4b6a6', '#ffd2b2', '#fff0dc'],
      far: 0.66, near: 0.22, path: 0.32, pathW: [5, 40], wave: 0.06, foamBase: 0.5, foamGlow: 0.25,
    },
    foam: ['#4a4e86', '#666aa0', '#8a88b8', '#ada8cc', '#d0c6de', '#ecdeea', '#fff0ee', '#fffaf6'],
    glint: ['#ffc8a0', '#ffe0bc', '#fff2dc', '#ffffff'],
    beach: {
      wet: ['#1c2050', '#22285a', '#2a3064', '#343870', '#40427a', '#4e4c84', '#60588c', '#766494', '#90729a', '#ae849e', '#d09aa2', '#f0b8aa', '#ffdcc0'],
      mirror: [0.18, 0.8], streak: 0.5, streakW: [5, 14], dry: [0.45, -0.1], crest: 0.2, trough: 0.1,
      sand: ['#22224a', '#2c2c56', '#383662', '#46406c', '#564c78', '#685882', '#7e668c', '#967692', '#b08896', '#cc9c9c'],
      weed: ['#1a1a3a', '#3a3450'], print: ['#24244c', '#343462', '#b08a98'], shell: ['#ffe0d0', '#fff4ec', '#383662'],
    },
    wave: {
      crest: ['#8a7aa8', '#b08aa8', '#d8a0aa', '#f8c0b0', '#ffe2cc'],
      face: ['#1c2458', '#242e64', '#303a70', '#42487c', '#5e5a8a', '#8a6e96', '#c08aa0'],
      sheet0: 0.38, sheetSun: 0.35, sheetLift: 0.08, laceV: 0.45,
      sheetTones: ['#202a5e', '#28326a', '#323c76', '#3e4682', '#4c508c', '#5e5c96', '#76689e', '#9478a4', '#b48aa8', '#d6a0aa', '#f4bcb0'],
    },
    fore: {
      dune: [0.42, 0.3], duneRim: ['#b08aa0', '#ffc8b4'],
      grass: ['#14163a', '#1c1e46', '#262852', '#30305c', '#d098a8', '#ffc8b8'],
      wood: ['#14163a', '#1e2046', '#282a52', '#34345e', '#44426c', '#8a7a9a', '#a896ae'],
      woodRim: ['#d098a8', '#ffc4b0'],
    },
    gull: '#2a2c58',
    haze: { rows: [[94, 108, 0.5], [118, 140, 0.3]], colour: ['#f4c4c8', '#fff0e8'], o: 0.3, k: 8 },
    boat: ['#3a3a6c', '#ffc0a8'],
    boatLight: null,
    lobes: LOBES,
  },

  night: {
    sky: [[-2, '#03061a'], [20, '#060c24'], [44, '#0a1330'], [66, '#0f1a3c'], [84, '#152248'], [96, '#1b2a52'], [104, '#22335c'], [120, '#2c4068'], [140, '#3a5076']],
    glow: { x: SX, y: 40, rx: 34, ry: 26, lift: 14 },
    rays: null,
    moon: { x: SX, y: 40, r: 7, halo: '#26386a', tones: ['#7a86a8', '#a4b0cc', '#c8d2e6', '#e6ecf6', '#ffffff'] },
    stars: ['#ffffff', '#c8d4f0', '#7a88b0'],
    clouds: {
      list: CLOUDS, below: false, base: 0.18, rim: 0.45, sun: 0.25, lx: SX, ly: 40, lw: 70,
      tones: ['#060b1c', '#0a1226', '#0f1a32', '#16223e', '#1e2c4a', '#2a3a5a', '#3e5070', '#5a6c8c', '#8090b0', '#b0bed8'],
    },
    land: {
      tones: ['#03050c', '#050914', '#080e1c', '#0c1424', '#101a2c'], base: 0.2, haze: 0.5, rim: ['#1e2a48', '#3a4a70'], rimSide: 1,
      tower: { w: '#5a6480', s: '#2a3248', b: '#3a2a3a', d: '#0a0e18', g: '#3a3428' },
    },
    lamp: ['#fff4c8', '#ffd27a', '#a87a4a'],
    windows: 5,
    island: ['#0c1428', '#18223a'],
    sea: {
      tones: ['#02040c', '#040814', '#060c1c', '#091224', '#0d182e', '#122038', '#182a44', '#223652', '#2e4664', '#40597a', '#5a7494', '#8098b8', '#b4c4dc', '#e8eef8'],
      far: 0.42, near: 0.12, path: 0.32, pathW: [3, 22], wave: 0.07, foamBase: 0.3, foamGlow: 0.35,
    },
    foam: ['#0e1830', '#18264a', '#26365e', '#384a70', '#506488', '#6e82a6', '#94a6c6', '#bccbe2'],
    glint: ['#6a82a8', '#a8bcd8', '#dce6f6', '#ffffff'],
    beach: {
      wet: ['#020409', '#04070f', '#060b16', '#09101e', '#0d1626', '#121d30', '#18263c', '#22324a', '#30425e', '#46587a', '#6a7e9e', '#a0b2cc', '#dce6f4'],
      mirror: [0.05, 1.3], streak: 0.5, streakW: [3, 8], dry: [0.38, -0.1], crest: 0.18, trough: 0.1,
      sand: ['#04060c', '#070a14', '#0b101c', '#0f1524', '#141b2c', '#1a2236', '#212a40', '#2a344c', '#344058', '#404e68'],
      weed: ['#020308', '#10141e'], print: ['#05070e', '#0b101c', '#2a344c'], shell: ['#8090b0', '#b0c0dc', '#0b101c'],
    },
    wave: {
      crest: ['#2a3a5a', '#3e5274', '#5a7092', '#8098b8', '#b0c2dc'],
      face: ['#03060f', '#060c1a', '#0a1426', '#101e34', '#182a44', '#243a58', '#36507a'],
      sheet0: 0.3, sheetSun: 0.35, sheetLift: 0.06, laceV: 0.35,
      sheetTones: ['#050a16', '#08101e', '#0c1628', '#111e32', '#18283e', '#20324c', '#2c405c', '#3c5272', '#56708e', '#8098b8', '#b8c8e0'],
    },
    fore: {
      dune: [0.4, 0.3], duneRim: ['#2a344c', '#4a5a7c'],
      grass: ['#020308', '#04060e', '#070a16', '#0a0f1e', '#3a4a70', '#5a6c98'],
      wood: ['#020308', '#05080f', '#090e18', '#0e1522', '#141d2e', '#2a3650', '#3a4866'],
      woodRim: ['#3a4a6e', '#6a7ea6'],
    },
    gull: null,
    haze: { rows: [[120, 140, 0.25]], colour: ['#6a7ea6', '#a8b8d4'], o: 0.12, k: 5 },
    boat: ['#060a16', '#3a4a70'],
    boatLight: '#ffd890',
    lobes: LOBES,
  },
}
