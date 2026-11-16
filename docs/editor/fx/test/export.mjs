// node editor/fx/test/export.mjs : real scene sizes for the presets. Builds a one-layer project
// (an `image` layer of a preset's cells, its colours as palette slots, one moment) for every
// preset on full-screen test pictures, exports it with editor/lib/export.js, and prints the
// scene's characters (what the app counts) next to the estimate. SVGs go to FX_OUT as
// fx-scene-<picture>-<preset>.svg, for the player checks (sunfield's tools/app-check.mjs).
// PICS and PRESETS pick (default harbor, landscape and painting, every preset).
import fs from 'node:fs'
import path from 'node:path'
import { OUT, loadPictures, closeBrowser } from './helpers.mjs'
import { applyLook, estimateCost, LOOK_PRESETS, withPreset, DEFAULT_LOOK } from '../index.js'
import { exportScene, encodeCells, LIMIT } from '../../lib/export.js'

const pics = process.env.PICS ? process.env.PICS.split(',') : ['harbor', 'landscape', 'painting']
const presets = LOOK_PRESETS.filter(p => !process.env.PRESETS || process.env.PRESETS.split(',').includes(p.id))
const all = await loadPictures()
await closeBrowser()

export function projectOf(name, cells, colors) {
  return {
    format: 'backdropkit-project',
    version: 1,
    name: 'Look test',
    slug: 'look-test',
    line: 'One picture through a look.',
    w: 320,
    h: 200,
    palette: colors.map((hex, i) => ({ id: 'c' + (i + 1), colors: { day: hex } })),
    moments: [{ id: 'day', name: 'Day', start: 0 }],
    layers: [{ id: 'l1', name, kind: 'image', visible: true, show: {}, cells: encodeCells(cells), motion: { type: 'none' } }],
  }
}

const k = v => (v / 1000).toFixed(1) + 'k'
const rows = []
for (const pic of pics) {
  for (const p of presets) {
    const r = applyLook(all[pic], withPreset(DEFAULT_LOOK, p))
    const est = estimateCost(r.cells, r.colors).chars
    const t0 = performance.now()
    const s = exportScene(projectOf(pic + ' ' + p.id, r.cells, r.colors), 'day')
    const ms = Math.round(performance.now() - t0)
    const file = path.join(OUT, 'fx-scene-' + pic + '-' + p.id + '.svg')
    fs.writeFileSync(file, s.svg)
    const errors = s.problems.filter(q => q.level === 'error').map(q => q.text)
    rows.push({ pic, preset: p.id, est, chars: s.chars, merged: s.merged, frameMs: s.ms, errors })
    console.log(pic.padEnd(10), p.id.padEnd(12), 'scene', k(s.chars).padStart(7), ' est', k(est).padStart(7), (s.chars <= LIMIT ? ' fits' : ' OVER'), s.merged ? ' merged ' + s.merged : '', ' ' + ms + ' ms', errors.length ? ' ' + errors.join(' | ').slice(0, 160) : '')
  }
}
fs.writeFileSync(path.join(OUT, 'fx-scenes.json'), JSON.stringify(rows, null, 1))
