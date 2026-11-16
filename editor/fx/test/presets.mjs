// node editor/fx/test/presets.mjs : every preset on the test pictures.
// Saves 3x previews (nearest) and one labelled sheet per picture to FX_OUT (all presets on that
// picture, after the original), and prints each preset's estimated cost, the encoder's real cost
// (ENC=0 skips it), what fitLook does at a 90k budget, and the time it took. The sheet pictures
// are harbor (a theme still), landscape and painting (drawn, full screen) and sprite (drawn,
// small on transparency); THUMBS=1 adds every theme still to the cost table (no sheets).
// PICS=harbor,landscape and PRESETS=clean,poster pick; FX_CACHE=<folder> keeps decoded pictures.
import fs from 'node:fs'
import path from 'node:path'
import { OUT, loadPictures, writePng, sheet, closeBrowser, encoderCost } from './helpers.mjs'
import { applyLook, fitLook, LOOK_PRESETS, estimateCost, renderCells, withPreset, DEFAULT_LOOK } from '../index.js'

const ENC = process.env.ENC !== '0'
const BUDGET = 90000
const SHEETS = ['harbor', 'landscape', 'painting', 'sprite']
const all = await loadPictures()
const only = process.env.PICS ? process.env.PICS.split(',') : null
const names = Object.keys(all).filter(p => (only ? only.includes(p) : SHEETS.includes(p) || (process.env.THUMBS === '1' && p !== 'sticker')))
const presets = LOOK_PRESETS.filter(p => !process.env.PRESETS || process.env.PRESETS.split(',').includes(p.id))
const k = v => (v / 1000).toFixed(1) + 'k'
const rows = []
for (const pic of names) {
  const rgba = all[pic]
  const items = []
  const sheetIt = SHEETS.includes(pic)
  if (sheetIt) {
    const s = 3
    const big = { w: 320 * s, h: 200 * s, data: new Uint8ClampedArray(320 * s * 200 * s * 4) }
    for (let y = 0; y < 200 * s; y++) for (let x = 0; x < 320 * s; x++) {
      const i = (((y / s) | 0) * 320 + ((x / s) | 0)) * 4
      big.data.set(rgba.data.subarray(i, i + 4), (y * 320 * s + x) * 4)
    }
    const file = path.join(OUT, 'fx-prev-' + pic + '-original.png')
    writePng(file, big)
    items.push({ file, label: 'Original (placed, 320 x 200)' })
  }
  for (const p of presets) {
    const look = withPreset(DEFAULT_LOOK, p)
    const t0 = performance.now()
    const r = applyLook(rgba, look)
    const ms = performance.now() - t0
    const est = estimateCost(r.cells, r.colors)
    const real = ENC ? await encoderCost(r.cells, r.colors) : null
    const fit = est.chars > BUDGET ? fitLook(rgba, look, { budget: BUDGET }) : null
    const fitReal = fit && ENC ? await encoderCost(fit.frames[0], fit.colors) : null
    if (sheetIt) {
      const file = path.join(OUT, 'fx-prev-' + pic + '-' + p.id + '.png')
      writePng(file, renderCells(r.cells, r.colors, 320, 200, 3))
      items.push({ file, label: p.name + ': ' + r.colors.length + ' colours, ' + (real ? k(real.chars) + ' (est ' + k(est.chars) + ')' : 'est ' + k(est.chars)) })
    }
    rows.push({ pic, preset: p.id, colors: r.colors.length, est: est.chars, real: real?.chars ?? null, ms: Math.round(ms), estMs: est.ms, fit: fit ? { est: fit.cost, real: fitReal?.chars ?? null, steps: fit.steps } : null })
    console.log(
      pic.padEnd(15),
      p.id.padEnd(12),
      String(r.colors.length).padStart(3),
      'col',
      ('est ' + k(est.chars)).padStart(11),
      real ? ('real ' + k(real.chars)).padStart(12) + (' (' + ((est.chars / real.chars - 1) * 100).toFixed(0) + '%)').padStart(7) : '',
      String(Math.round(ms)).padStart(5) + ' ms',
      fit ? ' fit ' + k(fitReal?.chars ?? fit.cost) + ': ' + fit.steps.join(', ') : '',
    )
  }
  if (sheetIt) console.log('sheet', await sheet(items, path.join(OUT, 'fx-sheet-' + pic + '.png'), { cols: 4, cellW: 480, title: 'BackdropKit looks on "' + pic + '"' }))
}
fs.writeFileSync(path.join(OUT, 'fx-costs.json'), JSON.stringify(rows, null, 1))
// Per preset over the full-screen pictures: median and max of the real (or estimated) cost.
const full = rows.filter(r => r.pic !== 'sprite')
if (new Set(full.map(r => r.pic)).size > 1) {
  console.log('\nfull-screen pictures:', new Set(full.map(r => r.pic)).size)
  for (const p of presets) {
    const v = full.filter(r => r.preset === p.id).map(r => r.real ?? r.est).sort((a, b) => a - b)
    const fitted = full.filter(r => r.preset === p.id).map(r => (r.fit ? (r.fit.real ?? r.fit.est) : (r.real ?? r.est))).sort((a, b) => a - b)
    console.log('  ' + p.id.padEnd(12), 'median', k(v[v.length >> 1]).padStart(7), ' max', k(v[v.length - 1]).padStart(7), ' over 90k', String(v.filter(x => x > BUDGET).length).padStart(2), '  after fitLook max', k(fitted[fitted.length - 1]))
  }
}
await closeBrowser()
