// Mirror Lake: a still mountain lake in a wide valley, the water mirroring the whole upper scene,
// as one animated pixel-art SVG in three moments (day, sunset, night).
// node build.mjs [moment ...]  ->  out/mirror-lake-<moment>.svg   (STATS=1 lists the big layers)
//
// Painted on a 320 x 200 cell grid (x right, y down) and encoded the way Sunfield's build does it
// (../../../sunfield/tools/build.mjs): cells as 1-cell stroke runs, at most 64 runs a path, big
// still layers in patterns, nested pinned viewports, CSS motion in steps() on a 0.05 s clock.
// The upper scene sits in one group; the lake draws it again through <use>, flipped about the
// waterline, so the clouds' reflections drift with the clouds for free.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Layer, bayer, clamp, lerp, rng, smooth, tone } from '../../../sunfield/tools/pixel.mjs'
import { line } from '../../../sunfield/tools/painters.mjs'
import { bloom, blade, boulders, cattail, jetty, lupine, reflect, rowboat } from './fore.mjs'
import { H, Scene, W, cells, cull, f1, f2, f3, fbm, hash, merge, mix, noise, ramp, scrubbedLength } from './lib.mjs'
import { MOMENTS } from './moments.mjs'
import { billow, cumulus, forest, hazed, mountain, polyY, spruce } from './paint.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WL = 114 // the first row of water: the waterline
const MIRROR = 2 * WL - 1 // row y mirrors to MIRROR - y

// ---------------------------------------------------------------- the drawing

const HERO = {
  ridge: [
    [-10, 86], [10, 82], [28, 77], [46, 71], [62, 65], [78, 58], [90, 53], [98, 50], [106, 53], [114, 49], [122, 43], [128, 38],
    [133, 35], [138, 37], [145, 42], [153, 48], [162, 54], [170, 60], [178, 67], [188, 76], [198, 85], [210, 93], [224, 99], [240, 103],
  ],
  peaks: [[133, 35], [98, 50], [62, 66]],
  spurs: [
    { pts: [[133, 36], [129, 58], [122, 84], [118, 104]], w: 10, h: 6 },
    { pts: [[133, 36], [148, 56], [156, 80], [160, 104]], w: 9, h: 5.5 },
    { pts: [[98, 51], [94, 72], [88, 98]], w: 9, h: 5 },
    { pts: [[114, 49], [110, 70], [106, 92]], w: 7, h: 4 },
    { pts: [[62, 66], [58, 86], [54, 100]], w: 8, h: 4.5 },
    { pts: [[30, 77], [28, 96]], w: 7, h: 4 },
    { pts: [[170, 60], [178, 82], [182, 100]], w: 8, h: 4.5 },
  ],
  x0: -2, x1: 242, bottom: WL, snow: 68, snowDrop: 26, seed: 21,
}
const RIGHT = {
  ridge: [
    [184, 108], [196, 104], [208, 99], [220, 93], [232, 84], [244, 72], [254, 61], [261, 54], [267, 50], [273, 52], [282, 56],
    [294, 61], [308, 65], [322, 67],
  ],
  peaks: [[267, 50], [232, 84]],
  spurs: [
    { pts: [[267, 51], [262, 76], [256, 100]], w: 10, h: 6 },
    { pts: [[267, 51], [284, 72], [292, 96]], w: 9, h: 5.5 },
    { pts: [[244, 72], [240, 92]], w: 7, h: 4 },
    { pts: [[232, 85], [228, 104]], w: 7, h: 4 },
    { pts: [[300, 63], [304, 90]], w: 7, h: 4 },
  ],
  x0: 180, x1: 322, bottom: WL, snow: 74, snowDrop: 22, seed: 33,
}
const FAR = {
  ridge: [[150, 96], [170, 86], [186, 77], [198, 70], [206, 66], [214, 70], [222, 73], [230, 68], [240, 74], [252, 82], [270, 90], [290, 96]],
  peaks: [[206, 66], [230, 68]],
  spurs: [{ pts: [[206, 67], [204, 90]], w: 5, h: 2.5 }, { pts: [[230, 69], [233, 92]], w: 5, h: 2.5 }],
  x0: 148, x1: 292, bottom: 106, snow: 82, snowDrop: 14, seed: 45, jag: 1, ribs: 7,
}
const LEFT_WOODS = { ridge: [[-4, 90], [20, 92], [44, 95], [70, 100], [96, 106], [118, 110], [136, 114]], x0: -4, x1: 140, bottom: WL, seed: 61, tier: 5, height: 9 }
const RIGHT_WOODS = { ridge: [[186, 114], [204, 110], [222, 104], [240, 98], [258, 94], [278, 90], [300, 88], [324, 86]], x0: 184, x1: 322, bottom: WL, seed: 62, tier: 5, height: 9 }
const FAR_SHORE = { ridge: [[96, 106], [124, 103], [146, 101], [166, 102], [186, 100], [204, 102], [216, 104]], x0: 98, x1: 216, bottom: WL - 1, seed: 63, tier: 3, height: 5 }
const FALL_X = 40 // the waterfall's column, down the cliff in the left woods

function scene(name) {
  const P = MOMENTS[name]
  const S = new Scene()
  const css = []
  const anim = (cls, style = '', extra = '') => ({ cls, style, extra })

  // ------------------------------------------------ sky
  // Bands of the sky's ramp, six rows high up where it changes slowly and four near the
  // horizon, each dithered into the next over its last three rows with dashed strokes (a dash
  // of 1 and a gap of 3 is a quarter of the cells). Dashes are slow to draw, and the app's
  // player redraws the whole picture every frame, the lake's mirror twice; so the sky is the
  // content of a pattern, which keeps its raster between frames. Its rect stops three rows
  // above the waterline, where the woods and the mountains cover every column: had the sky
  // run on under them to the mirror's edge, its colour would show through the antialiased
  // edge there as a light hairline (a dark underlay sits behind it instead, see below).
  const edges = []
  for (let y = -1; y < 59; y += 6) edges.push(y)
  for (let y = 59; y < 99; y += 5) edges.push(y)
  for (let y = 99; y < WL - 2; y += 4) edges.push(y)
  edges.push(WL)
  const sy = 1.5 // the pattern's rows sit 1.5 below the scene's: its rect's top is at -1.5
  const bandCol = edges.slice(0, -1).map((y, i) => ramp(P.sky, (y + edges[i + 1] - 1) / 2))
  let skyTile = ''
  for (let i = 0; i < bandCol.length; i++) {
    const y0 = edges[i]
    const h = edges[i + 1] - y0
    skyTile += '<path stroke="' + bandCol[i] + '" stroke-width="' + (h + 1) + '" d="M0 ' + f2(y0 + (h - 1) / 2 + sy) + 'h320"/>'
  }
  // One path per edge, every row of it dashed 1 on, 3 off: a dash pattern starts afresh with
  // each subpath, so one, two and three subpaths a column apart cover a quarter, a half and
  // three quarters of a row.
  let dith = ''
  for (let i = 0; i + 1 < bandCol.length; i++) {
    let d = ''
    for (const [dx, dy] of [[2, -3], [1, -2], [3, -2], [0, -1], [2, -1], [3, -1]]) d += 'M' + dx + ' ' + (edges[i + 1] + dy + sy) + 'h320'
    dith += '<path stroke="' + bandCol[i + 1] + '" d="' + d + '"/>'
  }
  skyTile += '<g stroke-dasharray="1 3">' + dith + '</g>'
  S.defs.push("<pattern id='K' width='1' height='1'>" + skyTile + '</pattern>')
  const skyHtml = "<rect y='-1.5' width='320' height='" + (WL - 2) + "' fill='url(#K)'/>"

  // ------------------------------------------------ clouds
  const C = P.cloud
  const cloudDefs = [
    {
      puffs: [
        { x: 14, y: 56, r: 9 }, { x: 28, y: 50, r: 12 }, { x: 44, y: 46, r: 14 }, { x: 60, y: 48, r: 12 }, { x: 74, y: 53, r: 9 },
        { x: 86, y: 57, r: 7 }, { x: 36, y: 38, r: 9 }, { x: 52, y: 34, r: 10 }, { x: 64, y: 40, r: 7 },
      ],
      base: 62, seed: 1, swing: [5, 70, 21],
    },
    {
      puffs: [
        { x: 276, y: 50, r: 8 }, { x: 290, y: 44, r: 11 }, { x: 306, y: 40, r: 13 }, { x: 322, y: 38, r: 13 }, { x: 300, y: 30, r: 9 },
        { x: 316, y: 24, r: 10 },
      ],
      base: 58, seed: 2, swing: [-4, 64, 40],
    },
    { puffs: [{ x: 166, y: 27, r: 4 }, { x: 172, y: 24, r: 5 }, { x: 179, y: 27, r: 4 }, { x: 185, y: 28, r: 3 }], base: 29, seed: 3, swing: [6, 54, 9] },
    { puffs: [{ x: 214, y: 45, r: 3 }, { x: 219, y: 43, r: 4 }, { x: 225, y: 45, r: 3 }], base: 47, seed: 4, swing: [-5, 46, 30] },
    { puffs: [{ x: 108, y: 23, r: 3 }, { x: 113, y: 21, r: 4 }, { x: 119, y: 23, r: 3 }], base: 25, seed: 5, swing: [4, 58, 12] },
  ]
  const clouds = cloudDefs.map(def => {
    const r = rng(100 + def.seed)
    const L = new Layer('cloud' + def.seed)
    const ps = def.puffs.map(p => ({ ...p, sy: 1.15 }))
    cumulus(L, billow(ps, r, { lean: 0.2 }), { ...C, base: def.base, seed: def.seed, shadeH: Math.min(10, (def.base - Math.min(...ps.map(p => p.y - p.r))) * 0.45) })
    const [a, d, l] = def.swing
    // A swing of a whole cells, a cell at a time, there and back.
    L.anim = anim('cs', '--d:' + d + 's;--l:' + -l + 's;--n:' + Math.abs(a) + ';--x:' + a + 'px')
    return L
  })

  // ------------------------------------------------ mountains
  const lit = { rock: P.hero.rock, snow: P.hero.snow, rim: P.hero.rim, rimSnow: P.hero.rimSnow }
  const farL = new Layer('far')
  mountain(farL, FAR, {
    light: P.light, rock: P.far.rock, snow: P.far.snow, rim: P.far.rock[3], rimSnow: P.far.snow[3], lit,
  })
  const pal = (M, f) => ({ rock: hazed(M.rock, P.haze, f), snow: hazed(M.snow, P.haze, f * 0.7), rim: M.rim, rimSnow: M.rimSnow })
  // Alpenglow: above its line (ragged) a mass takes its glowing palettes.
  // The shadow of a range off to the west: it reaches lower on the left, nearer that range.
  const glowLine = x => 72 + 0.08 * (x - 133) + 8 * fbm(x * 0.09, 4, 8)
  const glowOf = M => (M.glow ? { lit: pal(M.glow, M.hazeF), glow: (x, y) => (y < glowLine(x) + M.glow.line ? 1 : 0) } : {})
  const heroL = new Layer('hero')
  const hp = pal(P.hero, P.hero.hazeF)
  mountain(heroL, HERO, {
    light: P.light, ...hp, lit: hp, ...glowOf(P.hero), hazeColour: P.haze, haze: y => clamp((y - 88) / 26, 0, 1) * 0.9,
  })
  const rightL = new Layer('right')
  const rp = pal(P.right, P.right.hazeF)
  mountain(rightL, RIGHT, {
    light: P.light, ...rp, lit: rp, ...glowOf(P.right), hazeColour: P.haze, haze: y => clamp((y - 90) / 24, 0, 1) * 0.8,
  })

  // ------------------------------------------------ woods, cliff, waterfall, far shore
  const F = P.forest
  const farShore = new Layer('farShore')
  forest(farShore, FAR_SHORE, { pals: [F.shore] })
  const leftWoods = new Layer('leftWoods')
  forest(leftWoods, LEFT_WOODS, { pals: [F.far, F.near] })
  const rightWoods = new Layer('rightWoods')
  forest(rightWoods, RIGHT_WOODS, { pals: [F.far, F.near] })

  // A cliff in the mountainside over the left woods, a thin fall of meltwater down it: pale
  // still water with bright dashes sliding down through it, spray where it meets the trees.
  const FT = 78 // the fall's top row
  const FB = 98 // below its last row
  const cliff = new Layer('cliff')
  {
    // A gully cut in the face: its left wall in shade, its right wall catching the light.
    const rock = hazed(hp.rock, P.haze, 0.12)
    for (let y = FT - 3; y < FB; y++) {
      const t = (y - FT + 3) / (FB - FT + 3)
      const l = Math.round(FALL_X - 1.5 - 2.5 * t + 0.8 * fbm(y * 0.4, 1, 3))
      const r = Math.round(FALL_X + 2.5 + 2.5 * t + 0.8 * fbm(y * 0.4, 2, 3))
      for (let x = l; x <= r; x++) {
        const c = x === l ? rock[0] : x === r ? rock[5] : x === r - 1 ? rock[3] : rock[x < FALL_X ? 1 : 2]
        cliff.set(x, y, c)
      }
    }
    for (let y = FT; y < FB; y++) {
      cliff.set(FALL_X, y, P.fall[1])
      cliff.set(FALL_X + 1, y, P.fall[y % 3 ? 0 : 1])
    }
    cliff.set(FALL_X, FT - 1, P.fall[0])
  }
  const fallTile = new Layer('fallTile')
  for (const [x, y] of [[0, 0], [0, 1], [1, 3], [1, 4], [0, 4]]) fallTile.set(x, FT + y, P.fall[2])
  const fallRect = S.tile(fallTile, 2, 6, FT, [FALL_X, FT - 6.5, 2, FB - FT + 6])
  S.defs.push("<clipPath id='F'><path d='M" + FALL_X + ' ' + (FT - 0.5) + 'h2v' + (FB - FT) + "h-2z'/></clipPath>")
  const fall = { html: "<g clip-path='url(#F)'><g class='fl'>" + fallRect + '</g></g>' }
  const spray = new Layer('spray')
  {
    const r = rng(77)
    for (let i = 0; i < 9; i++) {
      const x = FALL_X - 2 + Math.floor(r() * 6)
      const y = FB - 4 + Math.floor(r() * 3)
      spray.set(x, y, P.fall[r() < 0.3 ? 1 : 0])
    }
  }

  // Two birds, painted where they are at the start; now and then they cross the valley,
  // flapping in two poses (and cross the lake's mirror with them).
  const birdUp = new Layer('birdUp')
  const birdDown = new Layer('birdDown')
  for (const [bx, by] of [[146, 47], [154, 43]]) {
    for (const [dx, dy] of [[-2, -1], [-1, 0], [0, 1], [1, 0], [2, -1]]) birdUp.set(bx + dx, by + dy, P.bird)
    for (const [dx, dy] of [[-2, 1], [-1, 0], [0, 0], [1, 0], [2, 1]]) birdDown.set(bx + dx, by + dy, P.bird)
  }
  birdUp.anim = anim('fa')
  birdDown.anim = anim('fb')
  const birds = { wrap: "<g class='bx'>", end: '</g>', items: [birdUp, birdDown] }

  // Stars and the moon, for the night (in the sky's group, so the lake mirrors them).
  const night = []
  if (P.stars) {
    const r = rng(909)
    const dim = new Layer('stars')
    for (let i = 0; i < P.stars.n; i++) {
      const x = Math.floor(r() * W)
      const y = Math.floor(Math.pow(r(), 1.4) * 88)
      const b = r()
      dim.set(x, y, P.stars.tones[b > 0.8 ? 2 : b > 0.45 ? 1 : 0])
      if (b > 0.97) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) dim.set(x + dx, y + dy, P.stars.tones[0])
    }
    night.push(dim)
  }
  if (P.moon) {
    const { x: mx, y: my, r: mr, tones, halo } = P.moon
    const moon = new Layer('moon')
    for (let y = Math.floor(my - mr - 3); y <= my + mr + 3; y++) {
      for (let x = Math.floor(mx - mr - 3); x <= mx + mr + 3; x++) {
        const d = Math.hypot(x + 0.5 - mx, y + 0.5 - my)
        if (d < mr) {
          const lit = (-(x + 0.5 - mx) - (y + 0.5 - my)) / mr
          let v = 0.7 + 0.25 * lit
          if (noise(x * 0.5, y * 0.5, 4) > 0.66) v -= 0.25 // maria
          moon.set(x, y, tone(tones, v, x, y, 0.1))
        } else if (d < mr + 1.6) moon.set(x, y, halo[1])
        else if (d < mr + 3.2 && hash(x, y, 2) > 0.5) moon.set(x, y, halo[0])
      }
    }
    night.push(moon)
  }

  // ------------------------------------------------ the upper scene, and the lake that mirrors it
  const upper = [
    { html: skyHtml },
    ...night,
    ...clouds,
    farL,
    heroL,
    rightL,
    cliff,
    fall,
    farShore,
    leftWoods,
    spray,
    rightWoods,
    birds,
  ]
  // The sky stops above the woods' last rows, so every column there must be covered (by the
  // woods or a mountain's foot).
  for (let y = WL - 3; y < WL; y++)
    for (let x = 0; x < W; x++)
      if (![farShore, leftWoods, rightWoods, farL, heroL, rightL, cliff].some(L => L.has(x, y))) throw new Error('no woods at ' + x + ',' + y)
  // Behind the mirror's edge: one colour between the dark woods' and the pale far shore's, and
  // under any long flat stretch of the last row (the far shore's beach) that stretch's own.
  // (Seam fix: rows 111-116, so nothing is ever bare under the woods' last rows or the wl row.)
  {
    const top = x => [rightWoods, leftWoods, farShore, cliff, rightL, heroL, farL].find(L => L.has(x, WL - 1)).get(x, WL - 1)
    const under = new Map([[F.far[1], 'M0 ' + (WL - 0.5) + 'h320']])
    for (let x = 0; x < W; ) {
      const c = top(x)
      let e = x + 1
      while (e < W && top(e) === c) e++
      if (e - x >= 8) under.set(c, (under.get(c) ?? '') + 'M' + x + ' ' + (WL - 0.5) + 'h' + (e - x))
      x = e
    }
    let html = ''
    for (const [c, d] of under) html += "<path stroke='" + c + "' stroke-width='6' d='" + d + "'/>"
    S.add('pB', [{ html }])
    // (Seam fix.) The last row of the upper scene, drawn again a row lower: under the mirror's
    // first row, which mirrors that same row, so the two no longer meet edge to edge at the
    // waterline (where the underlay showed through as a line); its own mirror image lands on
    // the row it copies. Hidden at every size.
    const wl = new Layer('wl')
    for (let x = 0; x < W; x++) wl.set(x, WL, top(x))
    upper.splice(upper.indexOf(rightWoods) + 1, 0, wl)
  }
  cull(upper)
  S.add('pB', [{ wrap: "<g id='U'>", end: '</g>', items: upper }])
  const use = dx => "<use href='#U' transform='matrix(1 0 0 -1 " + dx + ' ' + MIRROR + ")'/>"
  S.add('pB', [{ html: use(0) }])

  // ------------------------------------------------ the lake
  // Bands of ripples break the mirror: rows, further apart and thicker toward us, where the
  // water shows the sky's colour in long broken runs (painted into the sliding ripple tiles
  // below). (Drawing the mirror again a cell to the side through clip paths left hairlines at
  // the clip edges, so the bands are painted.)
  const Wt = P.water
  const bandRows = []
  for (let k = 3; ; k++) {
    const y = Math.round(WL + 1.1 * Math.pow(k, 1.62))
    if (y >= H) break
    bandRows.push([y, 1 + Math.floor(k / 6)])
  }

  // The water's own colour shows more toward us: a tint over the mirror in whole-row steps,
  // thinner near the far shore.
  {
    const st = Wt.steps
    const span = H - WL + 1
    const edge = i => Math.round(Math.pow(i / st.length, 1.4) * span)
    let stops = ''
    st.forEach((a, i) => {
      const o0 = f3(edge(i) / span)
      const o1 = f3(edge(i + 1) / span)
      stops += '<stop offset="' + o0 + '" stop-color="' + Wt.tint + '" stop-opacity="' + f2(a) + '"/><stop offset="' + o1 + '" stop-color="' + Wt.tint + '" stop-opacity="' + f2(a) + '"/>'
    })
    S.defs.push("<linearGradient id='T' gradientUnits='userSpaceOnUse' x1='0' y1='" + (WL - 0.5) + "' x2='0' y2='" + (WL - 0.5 + span) + "'>" + stops + '</linearGradient>')
    S.add('pB', [{ html: "<rect y='" + (WL - 0.5) + "' width='320' height='" + span + "' fill='url(#T)'/>" }])
  }

  // A glint where the water meets the far shore: broken runs of light of every length on the
  // first two rows of water. Away from the light they are rare, short and barely lighter than
  // the water; under the sun's, the glow's or the moon's light they gather, lengthen and
  // brighten, the brightest with a white core. Five strengths in all.
  const shoreLine = new Layer('shoreLine')
  {
    const G = Wt.glint
    const tones = [0.78, 0.6, 0.38, 0.12].map(t => mix(Wt.line[0], Wt.tint, t)).concat(Wt.line[1])
    const r = rng(71)
    let x = Math.floor(r() * 6)
    while (x < W) {
      const g = Math.exp(-Math.pow((x - G.x) / G.spread, 2)) // 0..1, under the glow
      let len = 0
      if (r() < 0.2 + 0.7 * g) {
        len = 1 + Math.floor(Math.pow(r(), 1.8) * (2 + 13 * g) * (0.5 + noise(x * 0.07, 3, 72)))
        const k = Math.min(4, Math.floor(g * 2.4 + Math.pow(r(), 1.5) * 2.2)) // 0 faint .. 4 white core
        const y = WL + (r() < 0.3 ? 1 : 0)
        for (let j = 0; j < len && x + j < W; j++) {
          const end = j === 0 || j === len - 1
          shoreLine.set(x + j, y, tones[Math.max(0, k - (end && len > 2 ? 2 : 0))])
        }
      }
      x += len + 2 + Math.floor(Math.pow(r(), 1.6) * (9 + 18 * (1 - g)))
    }
  }

  // Ripples: light streaks on the water, short and dense far off and longer near, in three
  // tiles that slide across at their own speeds.
  const ripples = []
  const RB = [
    // rows, tile width, streak length, count, seconds a cell, colour share
    { y0: WL + 1, y1: WL + 18, tw: 96, len: [2, 5], n: 36, step: 0.9 },
    { y0: WL + 18, y1: WL + 46, tw: 128, len: [4, 10], n: 64, step: 0.6 },
    { y0: WL + 46, y1: H, tw: 160, len: [8, 18], n: 44, step: 0.4 },
  ]
  for (const [bi, b] of RB.entries()) {
    const r = rng(300 + bi)
    const L = new Layer('ripple' + bi)
    // Streaks gather in bands where a breath of wind runs, and leave the glassy water between.
    for (let i = 0, tries = 0; i < b.n && tries < 4000; tries++) {
      const y = b.y0 + Math.floor(Math.pow(r(), 0.9) * (b.y1 - b.y0))
      const x = Math.floor(r() * b.tw)
      const wind = noise(y * 0.16, 0, 77) * (0.6 + 0.4 * Math.sin((2 * Math.PI * x) / b.tw + y * 0.3))
      if (r() > wind * wind * 2.2) continue
      i++
      const len = Math.round(lerp(b.len[0], b.len[1], r()))
      const bright = r() < 0.3
      for (let j = 0; j < len; j++) L.set((x + j) % b.tw, y, bright && j > 0 && j < len - 1 ? Wt.glare[1] : Wt.glare[0])
    }
    for (const [y0, h] of bandRows) {
      if (y0 < b.y0 || y0 >= b.y1) continue
      for (let y = y0; y < Math.min(y0 + h, b.y1); y++) {
        let x = Math.floor(r() * 12)
        while (x < b.tw) {
          const len = 6 + Math.floor(r() * b.tw * 0.3)
          for (let j = 0; j < len && x + j < b.tw; j++) if (!L.has(x + j, y)) L.set(x + j, y, Wt.band)
          x += len + 3 + Math.floor(r() * b.tw * 0.18)
        }
      }
    }
    const th = b.y1 - b.y0
    // (Seam fix.) The tile and its rect take a clear row above and below the band: a streak on
    // the band's first or last row then never lies on the tile bitmap's edge, where it showed
    // as a line along the join with the next band.
    // The streaks' opacity is on the rect (fill-opacity), not on the pattern's strokes: the
    // seam-proof encoding lays cells under their neighbours and a filled backing under them,
    // which would add up where translucent; drawn opaque in the tile and faded as one, they
    // look as before.
    const rect = S.tile(L, b.tw, th + 2, b.y0 - 1, [-b.tw, b.y0 - 1.5, W + 2 * b.tw, th + 2]).replace('<rect ', "<rect fill-opacity='" + f2(Wt.glareA[bi]) + "' ")
    ripples.push({ html: "<g class='sf' style='--d:" + f1(b.tw * b.step) + 's;--n:' + b.tw + ';--w:' + (bi % 2 ? -b.tw : b.tw) + "px'>" + rect + '</g>' })
  }
  S.add('pB', [shoreLine, ...ripples])

  // At night the moon's path on the water: bright streaks under its reflection, wider toward
  // us, in two sets that sway a cell apart.
  if (P.glitter && P.moon) {
    const r = rng(404)
    const sets = [new Layer('glitA'), new Layer('glitB')]
    for (let y = WL + 3; y < H; y++) {
      const t = (y - WL) / (H - WL)
      const n = 1 + Math.floor(t * 3)
      for (let i = 0; i < n; i++) {
        if (r() > 0.55) continue
        const half = 1 + t * 9
        const x = Math.round(P.moon.x - half + r() * 2 * half)
        const len = 1 + Math.floor(r() * (1 + t * 4))
        const L = sets[(y + i) % 2]
        for (let j = 0; j < len; j++) L.set(x + j, y, P.glitter[j > 0 && j < len - 1 && r() < 0.6 ? 1 : 0])
      }
    }
    sets[0].anim = anim('sw', '--d:5s;--l:-1s')
    sets[1].anim = anim('sw', '--d:7s;--l:-4s')
    sets[0].twice = sets[1].twice = true // (seam fix) the two sets abut row on row
    S.add('pB', sets)
  }

  // Shafts of light from the sun, slanting down the valley, fading in whole-row steps, each
  // swelling and ebbing slowly. Drawn over the upper scene only.
  if (P.rays) {
    const R = P.rays
    const Y0 = -1
    const Y1 = WL - 14
    const span = Y1 - Y0 + 1
    const levels = Array.from({ length: 8 }, (_, i) => f3(R.a * (1 - i / 8) ** 1.4 + 0.01))
    let stops = ''
    levels.forEach((a, i) => {
      stops += '<stop offset="' + f3(i / levels.length) + '" stop-color="' + R.colour + '" stop-opacity="' + a + '"/><stop offset="' + f3((i + 1) / levels.length) + '" stop-color="' + R.colour + '" stop-opacity="' + a + '"/>'
    })
    S.defs.push("<linearGradient id='R' gradientUnits='userSpaceOnUse' x1='0' y1='" + (Y0 - 0.5) + "' x2='0' y2='" + (Y0 - 0.5 + span) + "'>" + stops + '</linearGradient>')
    let html = "<g fill='url(#R)'>"
    R.list.forEach((r, i) => {
      const c = y => r.x + r.s * (y - Y0)
      const sh = stairs(Y0, Y1, y => Math.round(c(y) - r.w / 2 - r.g * (y - Y0)), y => Math.round(c(y) + r.w / 2 + r.g * (y - Y0)))
      html += "<g class='ry' style='--d:" + r.d + 's;--l:' + f1(-((i * 4.3) % r.d)) + "s'>" + sh + '</g>'
    })
    S.add('pB', [{ html: html + '</g>' }])
  }

  // Mist: wisps low over the water under the far shore, drifting a little, now and then
  // thickening and thinning away.
  if (P.mist) {
    const mist = new Layer('mist')
    for (let x = 40; x < 280; x++) {
      for (let y = WL + 1; y < WL + 10; y++) {
        const env = Math.exp(-Math.pow((y - WL - 4) / 3, 2))
        const n = (0.65 * noise(x * 0.05, y * 0.35 + x * 0.01, 91) + 0.35 * noise(x * 0.16, y * 0.8, 92)) * env
        if (n > 0.4) mist.set(x, y, P.mist.tones[n > 0.56 ? 1 : 0])
      }
    }
    // (drifting nine cells there and back)
    mist.anim = anim('cs', '--d:63s;--l:-21s;--n:9;--x:9px')
    S.add('pB', [{ wrap: "<g opacity='" + f2(P.mist.a) + "'><g class='mo'>", end: '</g></g>', items: [mist] }])
  }

  // Now and then a fish rises: a ring spreads on the water in five steps and is gone.
  for (const [i, [fx, fy, t0]] of [[154, 151, -1.2], [72, 137, 11.9]].entries()) {
    const frames = []
    for (let k = 0; k < 5; k++) {
      const L = new Layer('ring' + i + k)
      const rx = 1 + k * 1.7
      const ry = 0.5 + rx * 0.32
      for (let a = 0; a < 360; a += 4) {
        const x = Math.round(fx + rx * Math.cos((a * Math.PI) / 180) - 0.5)
        const y = Math.round(fy + ry * Math.sin((a * Math.PI) / 180) - 0.5)
        const back = Math.sin((a * Math.PI) / 180) < 0
        L.set(x, y, mix(Wt.line[k < 2 ? 1 : 0], Wt.tint, [0, 0.15, 0.3, 0.42, 0.55][k] + (back ? 0.25 : 0)))
      }
      if (k === 0) L.set(fx, fy - 1, Wt.line[1])
      const d = (((t0 + 0.6 * k) % 25) + 25) % 25
      L.anim = anim('fr', '--l:' + f2(d - 25) + 's', " opacity='0'")
      frames.push(L)
    }
    S.add('pB', frames)
  }

  // ------------------------------------------------ the near bank on the right: spruces, the jetty, the boat
  const Fo = P.fore
  const refTint = Wt.tint
  {
    const r = rng(501)
    const back = new Layer('trees')
    // (Seam fix.) The spruces keep a backing: their 2-cell columns are written as side-by-side
    // runs, and the bright sky behind showed through the joint at some sizes.
    back.needBack = true
    spruce(back, { x: 281, top: 92, base: 172, w: 10, tones: Fo.spruce, rim: Fo.rimTree, seed: 5, tierH: 6 })
    spruce(back, { x: 322, top: 6, base: 178, w: 19, tones: Fo.spruce, rim: Fo.rimTree, seed: 7, tierH: 8 })
    spruce(back, { x: 301, top: 24, base: 176, w: 16, tones: Fo.spruce, rim: Fo.rimTree, seed: 6, tierH: 7, trunk: Fo.trunk })
    // The bank: a grassy slope in clumps, lit along its brow and darker down toward the water,
    // a cut of dark earth at the water's edge, stones along it.
    const bankTop = x => Math.round(174 - (x - 258) * 0.3 + 1.5 * fbm(x * 0.2, 1, 9))
    const shoreX = y => 257 - (y - 176) * 0.55
    const bank = new Layer('bank')
    for (let y = 150; y < H; y++) {
      for (let x = Math.floor(shoreX(y)); x < W; x++) {
        const d = y - bankTop(x)
        if (d < 0) continue
        const cut = x - shoreX(y)
        let c
        if (cut < 2.5 && d > 1) c = tone(Fo.earth, 0.3 + 0.4 * (cut / 2.5), x, y, 0.2)
        else {
          const clump = fbm(x * 0.22, y * 0.45, 13)
          const v = d < 2 ? 0.88 - d * 0.14 : 0.6 - d * 0.022 + clump * 0.42
          c = tone(Fo.grass, v, x, y, 0.05)
        }
        bank.set(x, y, c)
      }
    }
    boulders(bank, [
      { x: 254, y: 185, r: 5, sy: 1.2 }, { x: 248, y: 195, r: 7, sy: 1.15 }, { x: 260, y: 199, r: 6, sy: 1.1 }, { x: 262, y: 189, r: 4, sy: 1.2 },
      { x: 304, y: 201, r: 7 }, { x: 318, y: 197, r: 5 },
    ], { tones: Fo.rock, moss: Fo.moss, seed: 11 })
    // Grass tufts and flowers along the bank's top.
    const tufts = new Layer('tufts')
    const heads = new Layer('rheads')
    const sway = new Layer('rsway')
    for (let i = 0; i < 26; i++) {
      const x = 259 + Math.floor(r() * 61)
      blade(tufts, sway, { x, y: bankTop(x) + 1, h: 4 + r() * 7, lean: (r() - 0.4) * 4, tones: Fo.grass, split: 0.55 })
    }
    for (let i = 0; i < 9; i++) {
      const x = 262 + Math.floor(r() * 56)
      lupine(tufts, heads, { x, y: bankTop(x) + 1, h: 8 + Math.floor(r() * 6), tones: i % 3 === 2 ? Fo.pink : Fo.lupine, stem: Fo.stem })
    }
    for (let i = 0; i < 12; i++) {
      const x = 260 + Math.floor(r() * 58)
      bloom(tufts, heads, { x, y: bankTop(x) + 1, h: 3 + Math.floor(r() * 4), kind: i % 2 ? 'daisy' : 'cup', tones: i % 2 ? Fo.white : Fo.yellow, eye: Fo.eye, stem: Fo.stem })
    }
    heads.anim = anim('sw', '--d:5s;--l:-1.5s')
    sway.anim = anim('sw', '--d:4s;--l:-.5s')
    // (Seam fix.) The swaying parts and what they stand on are drawn twice (Scene.double).
    heads.twice = sway.twice = tufts.twice = bank.twice = true

    // The jetty, from the bank out to the left; only posts over the water are kept.
    const jet = new Layer('jetty')
    const J = jetty(jet, { far: [206, 159], near: [330, 184], tones: Fo.wood, lamp: Fo.lamp ?? [Fo.wood[0], Fo.wood[2], Fo.wood[4]] })
    for (const [x, y] of [...cells(jet)]) if (x >= 250 && y >= bankTop(x)) jet.m.delete((y + 1000) * 4096 + x + 1000)
    // The shade under the deck on the water, the posts' reflections, a ring of light at each foot.
    const under = new Layer('under')
    const postRef = new Layer('postRef')
    for (const [x, wy, w] of J.feet) {
      if (x >= 250) continue
      const top = J.deckTop(x) + J.deckH(x) + J.beamH(x)
      const src = new Layer('post')
      for (let k = 0; k < w; k++) for (let y = top; y < wy; y++) src.set(x + k, y, jet.get(x + k, y) ?? Fo.wood[1])
      reflect(src, postRef, () => wy, { tint: refTint, seed: x, fade: [0.45, 0.6, 0.72], stepRows: 3, gaps: 0.25 })
      for (let k = -1; k <= w; k++) under.set(x + k, wy, Wt.line[k === -1 || k === w ? 0 : 1])
    }
    for (let x = 206; x < 252; x++) {
      const top = J.deckTop(x) + J.deckH(x) + J.beamH(x)
      const wy = top + J.postL(x)
      for (let y = top; y < wy + Math.round(lerp(1, 4, (x - 206) / 124)); y++) if (!jet.has(x, y) && !under.has(x, y)) under.set(x, y, mix(Fo.shade, refTint, 0.3))
    }

    // The rowboat, moored off the end of the jetty, rising and settling a cell on the swell.
    const boat = { bow: new Layer('bow'), mid: new Layer('mid'), stern: new Layer('stern') }
    const BW = 181
    const hullWater = rowboat(boat, { x: 213, y: BW, a: 16, b: 3.4, depth: 4, ...Fo.boat })
    const boatRef = { bow: new Layer('bowR'), mid: new Layer('midR'), stern: new Layer('sternR') }
    for (const k of ['bow', 'mid', 'stern']) reflect(boat[k], boatRef[k], () => BW + 1, { tint: refTint, seed: 40, fade: [0.4, 0.55, 0.7], stepRows: 3, gaps: 0.15, reach: 14 })
    const wake = new Layer('wake')
    // Where the hull meets the water: light lapping at the bow and the stern, little amidships.
    for (const [x, y] of hullWater) {
      const q = Math.abs(x - 213) / 16
      if (hash(x, y, 3) > 0.2 + 0.75 * q * q) continue
      wake.set(x, y, q > 0.7 && hash(x, 1, 4) > 0.5 ? Wt.line[1] : q > 0.45 ? Wt.line[0] : mix(Wt.line[0], Wt.tint, 0.5))
    }
    // The painter: a rope from the bow to the last post.
    const rope = new Layer('rope')
    for (const [x, y] of line(199, 175, 207, 163)) rope.set(x, y, Fo.rope)
    // At night the lantern is lit: a soft pool of light round it, and its broken reflection
    // on the water below the boat.
    const lampGlow = new Layer('lampGlow')
    const lampRef = new Layer('lampRef')
    if (Fo.glow) {
      const lx = 207
      const ly = J.deckTop(lx) - 11
      for (let y = ly - 6; y <= ly + 6; y++) {
        for (let x = lx - 7; x <= lx + 7; x++) {
          const d = Math.hypot((x - lx) * 0.9, y - ly)
          if (d > 6.5 || d < 1.2) continue
          const k = d < 2.6 ? 2 : d < 4.2 ? 1 : 0
          if (k === 0 && bayer(x, y) > 0) continue
          lampGlow.set(x, y, Fo.glow[k])
        }
      }
      for (const [y, x0, w, k] of [[184, 205, 4, 2], [186, 206, 2, 2], [188, 205, 3, 1], [190, 206, 2, 1], [193, 205, 3, 0], [196, 206, 1, 0]]) {
        for (let x = x0; x < x0 + w; x++) lampRef.set(x, y, Fo.glow[k])
      }
    }
    S.add('pBR', [
      under,
      postRef,
      { wrap: "<g class='rd'>", end: '</g>', items: [boatRef.bow, boatRef.mid, boatRef.stern], twice: true },
      { wrap: "<g class='sw' style='--d:6s;--l:-2s'>", end: '</g>', items: [lampRef], twice: true },
      back,
      bank,
      { wrap: "<g opacity='.45'>", end: '</g>', items: [lampGlow] },
      jet,
      wake,
      { wrap: "<g class='rk'>", end: '</g>', items: [boat.bow, boat.mid, boat.stern], twice: true },
      rope,
      tufts,
      sway,
      heads,
    ])
  }

  // ------------------------------------------------ the stony shore on the left: boulders, reeds, flowers
  {
    const r = rng(601)
    const stones = new Layer('stones')
    const ground = new Layer('ground')
    const groundTop = x => Math.round(168 + x * 0.32 + 2 * fbm(x * 0.15, 2, 3))
    for (let x = 0; x < 44; x++) for (let y = groundTop(x); y < H; y++) ground.set(x, y, tone(y - groundTop(x) < 3 ? Fo.grass : Fo.earth, 0.6 - (y - groundTop(x)) * 0.08, x, y, 0.2))
    boulders(stones, [
      { x: 10, y: 186, r: 13, sy: 1.1 }, { x: 30, y: 192, r: 11, sy: 1.15 }, { x: 46, y: 197, r: 8, sy: 1.2 }, { x: -2, y: 176, r: 9 },
      { x: 20, y: 177, r: 7, sy: 1.1 },
    ], { tones: Fo.rock, moss: Fo.moss, seed: 21 })
    const wetFloor = x => (x < 60 ? 190 : x < 80 ? 199 : 195)
    const wet = new Layer('wetStones')
    boulders(wet, [{ x: 62, y: 196, r: 6, sy: 1.25 }, { x: 74, y: 199, r: 5, sy: 1.3 }, { x: 88, y: 194, r: 3.5, sy: 1.3 }, { x: 56, y: 189, r: 3, sy: 1.3 }], {
      tones: Fo.rock, seed: 23, floor: wetFloor,
    })
    const stoneRef = new Layer('stoneRef')
    reflect(wet, stoneRef, wetFloor, { tint: refTint, seed: 7, reach: 10 })
    // Reeds in the shallows: blades and cattails, their tops swaying in three groups.
    const reeds = new Layer('reeds')
    const tips = [new Layer('tipsA'), new Layer('tipsB'), new Layer('tipsC')]
    const roots = new Map()
    // Three clumps, each fanning out from a tight foot: the tallest near the stones.
    let i = 0
    for (const [cx, n, tall, foot] of [[52, 17, 40, 191], [79, 14, 31, 189], [104, 9, 22, 187]]) {
      for (let k = 0; k < n; k++, i++) {
        const off = (r() + r() - 1) * 4
        const x = Math.round(cx + off)
        const y = foot + Math.floor(r() * 3)
        roots.set(x, Math.max(roots.get(x) ?? 0, y))
        const h = tall * (0.45 + 0.55 * r()) * (1 - Math.abs(off) / 9)
        const o = { x, y, h, lean: off * h * 0.06 + (r() - 0.5) * 3, tones: Fo.reed, split: 0.5, w: h > tall * 0.7 ? 2 : 1, shade: (r() - 0.5) * 0.2 }
        if (k % 4 === 1 && h > 14) cattail(reeds, tips[i % 3], { ...o, head: Fo.head })
        else blade(reeds, tips[i % 3], { ...o, bend: Math.sign(off || 1) * r() * 5, droop: r() * 4 })
      }
      // Short dark leaves round the foot.
      for (let k = 0; k < 5; k++) blade(reeds, null, { x: cx + (k - 2) * 2, y: foot + 1, h: 4 + r() * 4, lean: (k - 2) * 1.5, tones: Fo.reed, shade: -0.2 })
    }
    const reedRef = new Layer('reedRef')
    const reedSrc = merge(merge(merge(merge(new Layer('rs'), reeds), tips[0]), tips[1]), tips[2])
    reflect(reedSrc, reedRef, x => roots.get(x) ?? roots.get(x - 1) ?? roots.get(x + 1) ?? null, { tint: refTint, seed: 9, reach: 18, gaps: 0.3 })
    // Flowers on the bank behind the stones.
    const flora = new Layer('flora')
    const fheads = new Layer('fheads')
    for (let i = 0; i < 8; i++) {
      const x = 2 + Math.floor(r() * 38)
      lupine(flora, fheads, { x, y: groundTop(x) + 1, h: 8 + Math.floor(r() * 7), tones: i % 3 === 1 ? Fo.pink : Fo.lupine, stem: Fo.stem })
    }
    for (let i = 0; i < 14; i++) {
      const x = 1 + Math.floor(r() * 36)
      blade(flora, null, { x, y: groundTop(x) + 1, h: 3 + r() * 6, lean: (r() - 0.5) * 3, tones: Fo.grass })
      if (i % 2) bloom(flora, fheads, { x: x + 1, y: groundTop(x) + 1, h: 3 + Math.floor(r() * 4), kind: i % 4 === 1 ? 'daisy' : 'cup', tones: i % 4 === 1 ? Fo.white : Fo.yellow, eye: Fo.eye, stem: Fo.stem })
    }
    fheads.anim = anim('sw', '--d:5s;--l:-3s')
    tips[0].anim = anim('sw', '--d:5s;--l:-.5s')
    tips[1].anim = anim('sw', '--d:6s;--l:-2.5s')
    tips[2].anim = anim('sw', '--d:4s;--l:-1s')
    // (Seam fix.) The swaying tops, the reeds under them and the flowers are drawn twice.
    for (const L of [...tips, reeds, fheads, flora]) L.twice = true
    S.add('pBL', [stoneRef, reedRef, wet, reeds, ...tips, ground, flora, fheads, stones])
  }

  return encode(S, css)
}

// ---------------------------------------------------------------- motion

// A swing of `a` whole cells as eased keyframes; the class runs it there and back.
function swingX(name, a) {
  let k = ''
  let last = null
  for (let i = 0; i <= 20; i++) {
    const v = Math.round((a * (1 - Math.cos((Math.PI * i) / 20))) / 2)
    if (v !== last || i === 20) k += i * 5 + '%{transform:' + (v ? 'translateX(' + v + 'px)' : 'none') + '}'
    last = v
  }
  return '@keyframes ' + name + '{' + k + '}'
}

// Opacity from lo to hi and back (or, `half`, just lo to hi) in twenty eased steps.
function breathe(name, lo, hi, half = false) {
  let k = ''
  for (let i = 0; i <= 20; i++) {
    const t = half ? (1 - Math.cos((Math.PI * i) / 20)) / 2 : 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 20)
    k += i * 5 + '%{opacity:' + f2(lo + (hi - lo) * (half ? t : 1 - t)) + '}'
  }
  return '@keyframes ' + name + '{' + k + '}'
}

// A staircase outline of rows y0..y1, row y spanning xl(y)..xr(y) (deep-reef's), cut into paths
// of at most 64 runs.
function stair(y0, y1, xl, xr) {
  let d = 'M' + xl(y0) + ' ' + (y0 - 0.5) + 'h' + (xr(y0) - xl(y0))
  let cur = xr(y0)
  let run = 0
  for (let y = y0; y <= y1; y++) {
    run++
    const nx = y < y1 ? xr(y + 1) : null
    if (nx !== cur) {
      d += 'v' + run
      run = 0
      if (nx !== null) {
        d += 'h' + (nx - cur)
        cur = nx
      }
    }
  }
  d += 'h' + (xl(y1) - cur)
  cur = xl(y1)
  run = 0
  for (let y = y1; y >= y0; y--) {
    run++
    const nx = y > y0 ? xl(y - 1) : null
    if (nx !== cur) {
      if (nx === null) break
      d += 'v-' + run
      run = 0
      d += 'h' + (nx - cur)
      cur = nx
    }
  }
  return d + 'z'
}
function stairs(y0, y1, xl, xr) {
  const d = stair(y0, y1, xl, xr)
  if (y0 === y1 || (d.match(/[hv]/g) ?? []).length <= 64) return '<path d="' + d + '"/>'
  const m = (y0 + y1) >> 1
  return stairs(y0, m, xl, xr) + stairs(m + 1, y1, xl, xr)
}

function encode(S, extraCss) {
  const body = S.body()
  const from = l => 'calc(' + l + ' + var(--m))'
  const RULES = [
    // Clouds swing a cell at a time, there and back; their reflections with them.
    '.cs{animation:cs var(--d) steps(var(--n)) ' + from('var(--l)') + ' infinite alternate}@keyframes cs{to{transform:translateX(var(--x))}}',
    // Reed tops and flower heads sway a cell or two, in steps.
    '.sw{animation:sw var(--d) steps(1) ' + from('var(--l)') + ' infinite}@keyframes sw{0%{transform:none}25%{transform:translateX(1px)}55%{transform:translateX(2px)}70%{transform:translateX(1px)}85%,100%{transform:none}}',
    // The boat rides the swell: it rises a cell for 2.4 s of every 6.4 s, and its reflection dips.
    '.rk{animation:rk 6.4s steps(1) calc(-1s + var(--m)) infinite}@keyframes rk{0%{transform:none}50%{transform:translateY(-1px)}87.5%,100%{transform:none}}',
    '.rd{animation:rd 6.4s steps(1) calc(-1s + var(--m)) infinite}@keyframes rd{0%{transform:none}50%{transform:translateY(1px)}87.5%,100%{transform:none}}',
    // The fall's bright dashes slide down a cell a step.
    '.fl{animation:fl 1.2s steps(6) var(--m) infinite}@keyframes fl{to{transform:translateY(6px)}}',
    // The birds cross the valley in 71 s, a cell each 0.2 s, then wait 29 s out of sight; at the
    // start they are where they are painted. Their wings take two poses, 0.45 s each.
    '.bx{animation:bx 100s steps(1) calc(-34s + var(--m)) infinite}@keyframes bx{0%{transform:translateX(-170px);animation-timing-function:steps(355)}71%,100%{transform:translateX(185px)}}',
    '.fa{animation:fa .9s steps(1) var(--m) infinite}@keyframes fa{0%{opacity:1}50%,100%{opacity:0}}',
    '.fb{animation:fb .9s steps(1) var(--m) infinite}@keyframes fb{0%{opacity:0}50%,100%{opacity:1}}',
    // Rays swell and ebb in twenty steps.
    '.ry{animation:ry var(--d) steps(1) ' + from('var(--l)') + ' infinite}' + breathe('ry', 0.5, 1),
    // Mist gathers and thins away over 50 s, there and back.
    '.mo{animation:mo 50s steps(1) calc(-30s + var(--m)) infinite alternate}' + breathe('mo', 0, 1, true),
    // A ring frame shows for 0.6 s of every 25 s.
    '.fr{animation:fr 25s steps(1) ' + from('var(--l)') + ' infinite}@keyframes fr{0%{opacity:1}2.4%,100%{opacity:0}}',
    // Ripple tiles slide across a cell a step.
    '.sf{animation:sf var(--d) steps(var(--n)) var(--m) infinite}@keyframes sf{to{transform:translateX(var(--w))}}',
    ...extraCss.map(k => {
      const n = /@keyframes (\w+)/.exec(k)[1]
      return '.' + n + '{animation-name:' + n + '}' + k
    }),
    '@media (prefers-reduced-motion:reduce){:root *{animation:none!important}}',
  ]
  const CSS = RULES.join('')
  let svg =
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" font-family="a" color="a" style="--m:0s">' +
    '<style>' + CSS + '</style><defs>' + S.defs.join('') + '</defs>' + body + '</svg>'
  svg = svg.replaceAll('"', "'")
  return { svg, css: CSS, stats: S.stats }
}

// ---------------------------------------------------------------- write

const LIMIT = 131072
fs.mkdirSync(path.join(HERE, 'out'), { recursive: true })
const only = process.argv.slice(2)
for (const name of only.length ? only : Object.keys(MOMENTS)) {
  const { svg, css, stats } = scene(name)
  const scrubbed = scrubbedLength(svg, css)
  fs.writeFileSync(path.join(HERE, 'out', 'mirror-lake-' + name + '.svg'), svg)
  console.log(name.padEnd(7), svg.length, 'chars (scrubbed ~' + scrubbed + '), css', css.length, '| patterns', stats.patterns, '| runs', stats.runs, scrubbed > LIMIT || svg.length > LIMIT ? 'TOO BIG' : '')
  if (process.env.SIZES) {
    const rows = [...stats.size].sort((a, b) => b[1][0] - a[1][0])
    let s = 0
    let o = 0
    for (const [, [a, b]] of rows) {
      s += a
      o += b
    }
    console.log('  layers: safe ' + s + ', plain ' + o)
    console.log('  ' + rows.slice(0, 30).map(([n, [a, b]]) => n.slice(0, 36) + ':' + a + '/' + b).join('  '))
  }
  if (process.env.STATS) {
    const top = [...stats.byLayer].sort((a, b) => b[1] - a[1]).slice(0, 24)
    console.log('  ' + top.map(([n, r]) => n.slice(0, 40) + ':' + r).join('  '))
    console.log('  each: ' + [...(stats.each ?? [])].sort((a, b) => b[1] - a[1]).map(([n, r]) => n + ':' + r).join('  '))
  }
}
