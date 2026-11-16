// node editor/test/run.mjs [outDir] : the exporter's tests, against the real player checks.
//
// Builds the test projects (projects.mjs), exports every moment, and checks each scene:
//   1. the exporter's own result: no errors (or, for the over-limit project, the error that
//      names the costliest layers), merges where they are expected;
//   2. the rest picture: browser.js pictureFromSvg of the scene (1 px a cell, motion off)
//      against the project's own cells, cell by cell (within the merge level when merged);
//   3. engine/seamscan.mjs at T=0 and T=37 (and at extra times for the glint): every size
//      passes, no holes;
//   4. sunfield/tools/app-check.mjs with STILL=1: ok, the length it counts equal to the
//      exporter's `chars` and at most 131,072;
//   5. editor/test/player.mjs (player-check on the app's current player code): PLAYS, with
//      the frame cost measured next to the exporter's estimate.
// Then each archive is made in the browser as the editor makes it (looks, preview and the
// mod template fetched from docs/editor/mod/hooks/), its theme.js imported back, and all of
// them go through engine/check-packs.mjs: contents, claude plugin validate of the mod and of
// the marketplace, tsc, claude plugin test.
//
// Everything is written under outDir (default: <tmp>/backdropkit-editor-test): scenes/,
// archives/ (with a packs.json for check-packs), unpacked/, results.json. Exits 1 on any
// failure. ONLY=slug,slug runs some projects; SKIP=seam,app,player,archive skips checks.
// PROJECTS=community/<theme>/project.json[,...] runs those projects instead of the test set
// (how a theme sent in a pull request is checked; see CONTRIBUTING.md).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { LIMIT, exportAll } from '../lib/export.js'
import { decodeCells, normHex } from '../lib/color.js'
import { KIT, close as closePage, open } from './page.mjs'
import { check as playerCheck, close as closePlayer } from './player.mjs'
import { artwork, generated, harborStarter, heavy } from './projects.mjs'

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'backdropkit-editor-test'))
const SUNFIELD = path.resolve(KIT, '..', 'sunfield')
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null
const SKIP = new Set((process.env.SKIP ?? '').split(',').filter(Boolean))
const N = 320 * 200
for (const d of ['scenes', 'archives']) fs.rmSync(path.join(OUT, d), { recursive: true, force: true })
for (const d of ['scenes', 'archives']) fs.mkdirSync(path.join(OUT, d), { recursive: true })

const failures = []
const fail = (where, what) => {
  failures.push(where + ': ' + what)
  console.log('  FAIL ' + where + ': ' + what)
}
const t0 = Date.now()
const page = await open()

/* ---------- The projects: the test set, or the ones named in PROJECTS ---------- */

// PROJECTS=a/project.json,b/project.json checks those projects (a community theme, say)
// instead of the test set, through every step below.
const EXTERNAL = process.env.PROJECTS ? process.env.PROJECTS.split(',').map(f => path.resolve(f.trim())) : null
const projects = EXTERNAL ? EXTERNAL.map(external) : await testSet()
function external(file) {
  const project = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (project.format !== 'backdropkit' && !project.layers) throw new Error(file + ' is not a BackdropKit project')
  // A glint or a moving layer is checked mid-way too.
  return { project, kind: 'external', extraT: [0.1, 1] }
}

async function testSet() {
console.log('pictures')
const harborMoments = JSON.parse(fs.readFileSync(path.join(KIT, 'docs', 'themes', 'packs.json'), 'utf8')).harbor.moments.map(m => ({ id: m.id, name: m.name, start: m.start }))
const harbor = await page.evaluate(async ids => {
  const B = await import('/editor/lib/browser.js')
  const C = await import('/editor/lib/color.js')
  const svgs = {}
  for (const id of ids) svgs[id] = await (await fetch('/docs/scenes/harbor/harbor-' + id + '.svg')).text()
  const m = await B.pictureFromSvgs(svgs)
  const exact = Object.fromEntries(Object.entries(m.pictures).map(([id, p]) => [id, { colors: p.colors.length, exact: p.exact }]))
  return { palette: m.palette, byMoment: Object.fromEntries(Object.entries(m.byMoment).map(([k, v]) => [k, C.encodeCells(v)])), exact }
}, harborMoments.map(m => m.id))
harbor.byMoment = Object.fromEntries(Object.entries(harbor.byMoment).map(([k, v]) => [k, decodeCells(v, N)]))
console.log('  harbor: ' + harbor.palette.length + ' slots; ' + Object.entries(harbor.exact).map(([id, e]) => id + ' ' + e.colors + ' colours' + (e.exact ? '' : ' (folded)')).join(', '))
// Uploaded art: Mirror Lake's day scene as an image (a 960 x 600 raster), in 24 colours with
// a Bayer dither (ART_DITHER, 0.5).
const ART_DITHER = Number(process.env.ART_DITHER ?? 0.5)
const lake = await page.evaluate(
  async dither => {
    const B = await import('/editor/lib/browser.js')
    const C = await import('/editor/lib/color.js')
    const svg = await (await fetch('/docs/scenes/mirror-lake/mirror-lake-day.svg')).text()
    const canvas = await B.canvasOf(svg.replace('</style>', '*{animation:none!important}</style>'), 960, 600)
    const p = await B.pictureFromImage(canvas, { colors: 24, dither })
    return { colors: p.colors, cells: C.encodeCells(p.cells) }
  },
  ART_DITHER,
)
lake.cells = decodeCells(lake.cells, N)
console.log('  art: ' + lake.colors.length + ' colours from a Mirror Lake raster, dither ' + ART_DITHER)

return [
  { project: generated(), kind: 'generated' },
  { project: harborStarter(harbor, harborMoments), kind: 'starter' },
  { project: heavy('near'), kind: 'near', expectMerge: true },
  { project: heavy('over'), kind: 'over', expectError: true },
  { project: artwork(lake), kind: 'art', extraT: [0.1, 1] },
].filter(x => !ONLY || ONLY.includes(x.project.slug))
}

/* ---------- Export ---------- */

// The rest picture the project describes at a moment: the topmost shown layer's colour.
function restPicture(project, mid) {
  const ids = project.moments.map(m => m.id)
  const hex = project.palette.map(p => {
    let h = normHex(p.colors[mid])
    for (const id of ids) h ??= normHex(p.colors[id])
    return h
  })
  const out = new Array(N).fill(null)
  for (const L of project.layers) {
    if (L.visible === false || L.show?.[mid] === false) continue
    const src = L.frames?.length ? L.frames[0] : (L.byMoment?.[mid] ?? L.cells)
    const f = decodeCells(src, N)
    for (let k = 0; k < N; k++) if (f[k]) out[k] = hex[f[k] - 1]
  }
  return out
}
const chan = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const step = (a, b) => Math.max(...chan(a).map((v, i) => Math.abs(v - chan(b)[i])))

const results = []
for (const P of projects) {
  const { project } = P
  const s = project.slug
  const t = Date.now()
  const r = exportAll(project)
  const ms = Date.now() - t
  const errors = r.problems.filter(p => p.level === 'error')
  console.log(`${s}: exported in ${ms} ms, ok ${r.ok}`)
  for (const p of r.problems) console.log('  ' + p.level + ': ' + p.text)
  const res = { slug: s, kind: P.kind, exportMs: ms, ok: r.ok, problems: r.problems, scenes: [] }
  results.push(res)
  if (P.expectError) {
    const e = errors.find(p => /over the app's/.test(p.text))
    if (r.ok || !e) fail(s, 'expected the over-limit error')
    else if (!/Grain/.test(e.text) || !e.layer) fail(s, 'the error does not name the costliest layer')
    else console.log('  the error path works: ' + e.text.slice(0, 120) + '...')
    res.expected = 'error'
    continue
  }
  if (!r.ok) fail(s, 'export has errors: ' + errors.map(p => p.text).join(' / '))
  for (const sc of r.scenes) {
    const file = path.join(OUT, 'scenes', s + '-' + sc.id + '.svg')
    fs.writeFileSync(file, sc.svg)
    res.scenes.push({ id: sc.id, file, chars: sc.chars, raw: sc.raw, estMs: sc.ms, merged: sc.merged, costs: sc.costs })
    console.log(`  ${sc.id.padEnd(8)} ${String(sc.chars).padStart(7)} chars (raw ${sc.raw}), merged ${sc.merged}, est ${sc.ms} ms; ` + sc.costs.map(c => c.name + ' ' + c.chars).join(', '))
    if (sc.chars > LIMIT || sc.raw > LIMIT) fail(s + '/' + sc.id, 'over the limit')
  }
  if (P.expectMerge && !r.scenes.some(x => x.merged > 0)) fail(s, 'expected a colour merge')

  // The rest picture, back from the scene.
  for (const sc of res.scenes) {
    const svg = fs.readFileSync(sc.file, 'utf8')
    const back = await page.evaluate(async svg => {
      const B = await import('/editor/lib/browser.js')
      const C = await import('/editor/lib/color.js')
      const p = await B.pictureFromSvg(svg)
      return { colors: p.colors, cells: C.encodeCells(p.cells), exact: p.exact }
    }, svg)
    const cells = decodeCells(back.cells, N)
    const want = restPicture(project, sc.id)
    let off = 0
    let worst = 0
    for (let k = 0; k < N; k++) {
      const got = cells[k] ? back.colors[cells[k] - 1] : null
      if (got === want[k]) continue
      const d = got && want[k] ? step(got, want[k]) : 255
      worst = Math.max(worst, d)
      if (d > sc.merged) off++
    }
    sc.rest = { off, worst }
    console.log(`  ${sc.id.padEnd(8)} rest picture: ${off} cells off` + (worst ? ` (largest step ${worst}, merge level ${sc.merged})` : ''))
    if (off) fail(s + '/' + sc.id, `rest picture differs in ${off} cells`)
  }
}

/* ---------- The player's checks ---------- */

// The same objects as in results, so the checks below land in results.json too.
const scenes = results.flatMap(r => r.scenes.map(sc => Object.assign(sc, { slug: r.slug, extraT: projects.find(p => p.project.slug === r.slug).extraT ?? [] })))

function seamscan(files, T) {
  const r = spawnSync(process.execPath, [path.join(KIT, 'engine', 'seamscan.mjs'), ...files], { cwd: KIT, encoding: 'utf8', env: { ...process.env, ...(T !== undefined ? { T: String(T) } : {}) }, maxBuffer: 64 << 20 })
  const out = {}
  let cur
  for (const line of (r.stdout ?? '').split('\n')) {
    const h = /^== (.+?) \(/.exec(line)
    if (h) {
      cur = out[h[1]] = { sizes: 0, failed: 0, holes: 0, lines: 0, worst: '' }
      continue
    }
    const m = /^\s+(\S+)\s+([\d.]+) px\/cell\s+holes\s+(\d+)\s+lines\s+(\d+)\s+(.*)$/.exec(line)
    if (m && cur) {
      cur.sizes++
      cur.holes += Number(m[3])
      if (Number(m[4]) > cur.lines) {
        cur.lines = Number(m[4])
        cur.worst = m[1]
      }
      if (m[5].startsWith('FAIL')) cur.failed++
    }
  }
  if (r.status !== 0 && r.status !== 1) out.__error = (r.stderr ?? '').slice(0, 400)
  return out
}

if (!SKIP.has('seam') && scenes.length) {
  console.log('seamscan')
  const times = [0, 37]
  for (const T of times) {
    const got = seamscan(scenes.map(x => x.file), T)
    if (got.__error) fail('seamscan T=' + T, got.__error)
    for (const sc of scenes) {
      const g = got[path.basename(sc.file)]
      sc.seam ??= {}
      sc.seam['T' + T] = g
      if (!g || g.sizes !== 11) fail(sc.slug + '/' + sc.id, `seamscan T=${T}: no result`)
      else if (g.failed || g.holes) fail(sc.slug + '/' + sc.id, `seamscan T=${T}: ${g.failed} sizes fail, ${g.holes} holes, ${g.lines} line px at ${g.worst}`)
      else console.log(`  ${(sc.slug + '/' + sc.id).padEnd(22)} T=${String(T).padEnd(4)} 11/11 sizes ok, 0 holes, at most ${g.lines} line px` + (g.lines ? ' (' + g.worst + ')' : ''))
    }
  }
  for (const sc of scenes) {
    for (const T of sc.extraT) {
      const g = seamscan([sc.file], T)[path.basename(sc.file)]
      sc.seam['T' + T] = g
      if (!g || g.sizes !== 11 || g.failed || g.holes) fail(sc.slug + '/' + sc.id, `seamscan T=${T}: ` + JSON.stringify(g))
      else console.log(`  ${(sc.slug + '/' + sc.id).padEnd(22)} T=${String(T).padEnd(4)} 11/11 sizes ok, 0 holes, at most ${g.lines} line px`)
    }
  }
}

if (!SKIP.has('app') && scenes.length) {
  console.log('app-check (STILL=1)')
  const tool = path.join(SUNFIELD, 'tools', 'app-check.mjs')
  for (const sc of scenes) {
    const r = spawnSync(process.execPath, [tool, sc.file], { cwd: SUNFIELD, encoding: 'utf8', env: { ...process.env, STILL: '1' }, maxBuffer: 16 << 20 })
    let j
    try {
      j = JSON.parse((r.stdout ?? '').trim().split('\n').pop())
    } catch {
      j = { ok: false, why: (r.stderr ?? '').slice(0, 300) }
    }
    sc.app = j
    if (!j.ok || j.length > LIMIT) fail(sc.slug + '/' + sc.id, 'app-check: ' + JSON.stringify(j))
    else if (j.length !== sc.chars) fail(sc.slug + '/' + sc.id, `app-check counts ${j.length}, the exporter said ${sc.chars}`)
    else console.log(`  ${(sc.slug + '/' + sc.id).padEnd(22)} ok, ${j.length} after the scrub (exporter: ${sc.chars}), still frame kept (${j.pixelsChangedIn2s} px change in 2 s)`)
  }
}

if (!SKIP.has('player') && scenes.length) {
  console.log('player-check (editor/test/player.mjs)')
  for (const sc of scenes) {
    const r = await playerCheck(fs.readFileSync(sc.file, 'utf8'))
    sc.player = { plays: r.plays, why: r.why, worstAverageMs: r.worstAverageMs, windows: r.windows, app: r.app }
    if (!r.plays) fail(sc.slug + '/' + sc.id, 'player: STILL, ' + r.why.join('; '))
    else console.log(`  ${(sc.slug + '/' + sc.id).padEnd(22)} PLAYS, ${r.worstAverageMs} ms a frame at worst (estimate ${sc.estMs}; limit ${r.limitMs.toFixed(2)})`)
  }
  await closePlayer()
}

/* ---------- Archives ---------- */

if (!SKIP.has('archive')) {
  console.log('archives (made in the browser, as the editor makes them)')
  const packs = {}
  for (const res of results) {
    if (res.expected === 'error' || !res.ok) continue
    const project = projects.find(p => p.project.slug === res.slug).project
    const sceneList = res.scenes.map(sc => ({ id: sc.id, svg: fs.readFileSync(sc.file, 'utf8') }))
    const a = await page.evaluate(
      async ([project, scenes]) => {
        const X = await import('/editor/lib/export.js')
        const B = await import('/editor/lib/browser.js')
        const C = await import('/editor/lib/color.js')
        const looks = {}
        for (const s of scenes) looks[s.id] = await B.measureLook(s.svg)
        const preview = await B.previewPng(project, scenes, looks)
        const modFiles = {}
        for (const n of X.MOD_FILES) {
          const r = await fetch('/docs/editor/mod/hooks/' + n)
          if (!r.ok) throw new Error('missing ' + n)
          modFiles[n] = await r.text()
        }
        const bytes = X.buildArchive(project, { scenes, looks, preview, modFiles })
        return { looks, zip: C.bytesToBase64(bytes), theme: X.themeModule(project, scenes, looks), prompt: X.promptFor(project), previewBytes: preview.length }
      },
      [project, sceneList],
    )
    const buf = Buffer.from(a.zip, 'base64')
    const file = path.join(OUT, 'archives', res.slug + '.zip')
    fs.writeFileSync(file, buf)
    packs[res.slug] = { zip: res.slug + '.zip', bytes: buf.length }
    // theme.js back as a module: every scene exactly as exported, in start order.
    const mod = await import('data:text/javascript;base64,' + Buffer.from(a.theme).toString('base64'))
    const order = [...project.moments].sort((x, y) => x.start - y.start).map(m => m.id)
    const okTheme = mod.THEME.slug === res.slug && mod.THEME.moments.map(m => m.id).join() === order.join() && mod.THEME.moments.every(m => m.svg === sceneList.find(s => s.id === m.id).svg)
    if (!okTheme) fail(res.slug, 'theme.js does not give back the scenes')
    res.archive = { file, bytes: buf.length, looks: a.looks, previewBytes: a.previewBytes, themeOk: okTheme, prompt: a.prompt.split('\n')[0] }
    console.log(`  ${res.slug.padEnd(15)} ${buf.length} bytes (stored), preview ${a.previewBytes} bytes; looks ` + Object.entries(a.looks).map(([id, l]) => `${id} ${l.tone} ${l.tint} ${l.opacity}`).join(', ') + (okTheme ? '; theme.js gives back every scene' : ''))
  }
  fs.writeFileSync(path.join(OUT, 'archives', 'packs.json'), JSON.stringify(packs, null, 2) + '\n')
  if (Object.keys(packs).length) {
    const r = spawnSync(process.execPath, [path.join(KIT, 'engine', 'check-packs.mjs'), path.join(OUT, 'archives'), path.join(OUT, 'unpacked')], { cwd: KIT, encoding: 'utf8', maxBuffer: 64 << 20 })
    const out = (r.stdout ?? '') + (r.stderr ?? '')
    console.log(out.trimEnd().split('\n').map(l => '  ' + l.trim()).join('\n'))
    for (const res of results) {
      const line = out.split('\n').find(l => l.trim().startsWith(res.slug + ' '))
      if (!line) continue
      res.archive.check = line.trim().replace(/\s+/g, ' ')
      if (/FAIL|unexpected|differs/.test(line)) fail(res.slug, 'check-packs: ' + line.trim())
    }
    if (r.status !== 0) fail('check-packs', 'exit ' + r.status)
  }
}

await closePage()
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ when: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), failures, results }, null, 2) + '\n')
console.log(`${failures.length ? failures.length + ' FAILED' : 'all passed'} in ${Math.round((Date.now() - t0) / 1000)} s; results in ${path.join(OUT, 'results.json')}`)
process.exit(failures.length ? 1 : 0)
