// node editor/fx/test/calibrate.mjs : how close estimateCost comes to the exporter's encoder.
// Runs every preset and a few extra looks on every test picture (18 pictures: the theme stills
// and the drawn ones), encodes each result with editor/lib/encode.js, prints the error of the
// estimate per look and overall, and the COST_FIT numbers a weighted least-squares fit gives
// (paste them into cost.js when they move). FX_CACHE=<folder> keeps decoded pictures.
import fs from 'node:fs'
import { loadPictures, encoderCost, closeBrowser } from './helpers.mjs'
import { applyLook, estimateCost, LOOK_PRESETS, withPreset, DEFAULT_LOOK, normalizeLook } from '../index.js'
import { COST_FIT } from '../cost.js'

const looks = LOOK_PRESETS.map(p => [p.id, withPreset(DEFAULT_LOOK, p)])
looks.push(['raw-32', normalizeLook({ picture: { smooth: 0 }, colors: { count: 32, clean: 0 } })])
looks.push(['floyd-8', normalizeLook({ colors: { count: 8 }, dither: { algo: 'floyd', amount: 0.6, where: 'all' } })])
looks.push(['rings-4', normalizeLook({ colors: { count: 6 }, shapes: { on: true, k: 4, shape: 'ring', ground: 'light' } })])
looks.push(['ascii-7x9', normalizeLook({ colors: { count: 6 }, glyphs: { on: true, set: 'ascii', size: '7x9', ground: 'dark' } })])

const pics = await loadPictures()
const rows = []
for (const [pic, img] of Object.entries(pics)) {
  for (const [id, look] of looks) {
    const r = applyLook(img, look)
    const e = estimateCost(r.cells, r.colors)
    const real = await encoderCost(r.cells, r.colors)
    rows.push({ pic, look: id, est: e.chars, runs: e.runs, paths: e.paths, cover: e.cover, used: e.colors, ms: e.ms, real: real.chars, realRuns: real.runs })
  }
  process.stdout.write('.')
}
console.log()
if (process.env.FX_ROWS) fs.writeFileSync(process.env.FX_ROWS, JSON.stringify(rows))

const mean = a => a.reduce((s, x) => s + x, 0) / a.length
const stats = errs => {
  const s = errs.map(Math.abs).sort((a, b) => a - b)
  return { median: s[s.length >> 1], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1] }
}
const pct = v => (v * 100).toFixed(1) + '%'
const report = (name, errs) => {
  const s = stats(errs)
  console.log(name, ' median', pct(s.median), ' p90', pct(s.p90), ' max', pct(s.max))
}

// The model in cost.js: runs * (perRun + perLog * log2(cover / runs)) + perPath * paths +
// perColour * colours. perPath and perColour stay as set (what a path's and a colour's markup
// takes; fitting them too only trades them against the runs); perRun and perLog are fitted.
const feats = r => [r.runs, r.runs * Math.log2(Math.max(1, r.cover / Math.max(1, r.runs)))]
const fixed = r => COST_FIT.perPath * r.paths + COST_FIT.perColour * r.used
const predict = (c, r) => feats(r).reduce((s, f, i) => s + f * c[i], 0) + fixed(r)

// Weighted least squares on the relative error (each row divided by the real cost).
function fit() {
  const n = 2
  const A = Array.from({ length: n }, () => new Float64Array(n))
  const b = new Float64Array(n)
  for (const r of rows) {
    const f = feats(r).map(v => v / r.real)
    const t = (r.real - fixed(r)) / r.real
    for (let j = 0; j < n; j++) {
      b[j] += f[j] * t
      for (let k = 0; k < n; k++) A[j][k] += f[j] * f[k]
    }
  }
  for (let i = 0; i < n; i++) {
    let p = i
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r
    ;[A[i], A[p]] = [A[p], A[i]]
    ;[b[i], b[p]] = [b[p], b[i]]
    for (let r = 0; r < n; r++) {
      if (r === i) continue
      const f = A[r][i] / A[i][i]
      for (let k = i; k < n; k++) A[r][k] -= f * A[i][k]
      b[r] -= f * b[i]
    }
  }
  return [...b].map((v, i) => v / A[i][i])
}

console.log('COST_FIT now', JSON.stringify(COST_FIT), ' on', rows.length, 'encodings')
const byLook = {}
for (const r of rows) (byLook[r.look] ??= []).push(r)
for (const [id, list] of Object.entries(byLook)) {
  const e = list.map(r => r.est / r.real - 1)
  const runsErr = mean(list.map(r => r.runs / r.realRuns - 1))
  console.log('  ' + id.padEnd(12), 'mean', pct(mean(e)).padStart(7), ' worst', pct(e.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0)).padStart(7), '  runs', pct(runsErr).padStart(7))
}
report('estimate error', rows.map(r => r.est / r.real - 1))
const c = fit()
const fitted = { ...COST_FIT, perRun: +c[0].toFixed(2), perLog: +c[1].toFixed(2) }
report('refit error   ', rows.map(r => predict(c, r) / r.real - 1))
console.log('refit COST_FIT', JSON.stringify(fitted))
const ms = rows.map(r => r.ms).sort((a, b) => a - b)
console.log('estimate time: median', ms[ms.length >> 1] + ' ms, p90', ms[Math.floor(ms.length * 0.9)] + ' ms, max', ms[ms.length - 1] + ' ms')
await closeBrowser()
