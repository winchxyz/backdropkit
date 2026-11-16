// node engine/pack.mjs <outDir>
//
// Packs each BackdropKit prototype theme as an installable Claude desktop theme mod, in the
// same archive format as Sunfield's (app/tools/data.mjs, sunfieldArchive):
//   <outDir>/<slug>.zip   one per theme:
//     .claude-plugin/marketplace.json   a marketplace named backdropkit-<slug>, with one plugin
//     mod/.claude-plugin/plugin.json    the plugin, named <slug>
//     mod/hooks/*                       engine/theme-mod/hooks/ and the theme's own theme.js
//     README.md                         what is inside, how to install it by hand, how to use it
//     preview.png                       a still of the theme's brightest moment
//     project.json                      {} for now
//   <outDir>/packs.json   for each slug: the zip's name and size, and its moments (id, name,
//                         start hour, tone, glass tint and opacity)
//
// The scenes are prototypes/<slug>/out/<slug>-<moment>.svg, or <slug>.svg for a theme that is
// the same all day; only those top-level files count. They go into theme.js as they are, byte
// for byte. Each moment's tone (light or dark panels) and glass come from a still of its scene:
// the tone from the brightness of the middle of the picture, where the chat sits (measured as
// site/build.mjs measures it), the glass tint from the scene's average colour, softened. The
// stills are rendered with the local Chromium (playwright-core) and cached in engine/.cache/,
// so a run with no changed scene renders nothing.
//
// Run it again whenever a scene changes. A theme whose scenes can't be packed (a file still
// being written, a scene over the app's size limit) is reported and left as it was; the
// others are packed, and the run exits with 1.
//
// Environment: PLAYWRIGHT_CORE, the playwright-core index.mjs to use.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import zlib from 'node:zlib'

import { HERO_ORDER, MOMENT_NAMES, MOMENT_ORDER, MOMENT_OVERRIDES, REPO, THEMES } from '../app/tools/catalog.mjs'
// The archive's text, the zip writer and the look of a moment are shared with the editor's
// exporter (editor/lib), so both make archives the same way.
import { archiveEntries, heroOf, themeJs } from '../editor/lib/archive.js'
import { glassOf, stillOf } from '../editor/lib/look.js'
import { unzip as unzipBytes, zip as zipBytes } from '../editor/lib/zip.js'

export { glassOf }
const deflate = b => zlib.deflateRawSync(b, { level: 9 })
const zip = entries => Buffer.from(zipBytes(entries, { deflate }))
const unzip = buf => unzipBytes(buf, { inflate: b => zlib.inflateRawSync(b) }).map(e => ({ name: e.name, data: Buffer.from(e.data) }))

const ENGINE = path.dirname(fileURLToPath(import.meta.url))
const KIT = path.resolve(ENGINE, '..')
const PROTOS = path.join(KIT, 'prototypes')
const TEMPLATE = path.join(ENGINE, 'theme-mod', 'hooks')
const CACHE = path.join(ENGINE, '.cache', 'stills')
const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')

export const VERSION = '0.1.0'
export const CREDIT = `Made by the BackdropKit community project (${REPO}). Not made by Anthropic.`
// The app's player takes a scene of at most this many characters.
const SCENE_LIMIT = 131072
// The stills: the size they are rendered at (also the preview's), and a key that changes when
// the way they are rendered or measured does, so the cache is not reused across it.
const STILL = { width: 960, height: 600 }
const STILL_KEY = 'still-v1 960x600 paused'

/* ---------- Moments and their hours ---------- */

// When each moment starts, in local hours; it lasts until the next moment of its theme starts.
// Night runs from late evening to before dawn; a sunrise or a morning is early; day is the
// middle of the day; a sunset, golden hour or evening runs from late afternoon into the
// evening. Low Orbit's a ("Before dawn") holds the small hours and b the rest of the day.
const START = { a: 0, predawn: 4, dawn: 5, sunrise: 5, morning: 6, b: 6, day: 10, golden: 16, sunset: 17, evening: 17, dusk: 19, twilight: 20, night: 21 }
const EARLY = ['predawn', 'dawn', 'sunrise']
const LATE = ['golden', 'sunset', 'evening', 'dusk', 'twilight']

// The start hour of each moment of a theme, from the ids it has.
export function startHours(slug, ids) {
  if (ids.length === 1) return { [ids[0]]: 0 }
  const has = list => ids.some(id => list.includes(id))
  const start = {}
  for (const id of ids) {
    if (!(id in START)) throw new Error(`${slug}: no start hour for the moment "${id}"; add it to START in engine/pack.mjs`)
    start[id] = START[id]
  }
  // Day takes over from the morning's scene: at 10 after a morning, at 8 after a sunrise or
  // dawn, and at 6 when there is none.
  if ('day' in start) start.day = ids.includes('morning') ? 10 : has(EARLY) ? 8 : 6
  // Night follows an evening's scene at 21; with none, day runs into night at 20.
  if ('night' in start) start.night = has(LATE) ? 21 : 20
  const hours = Object.values(start)
  if (new Set(hours).size !== hours.length) throw new Error(`${slug}: two moments start at the same hour: ${JSON.stringify(start)}`)
  return start
}

function momentName(slug, id) {
  if (!id) return 'All day'
  return MOMENT_OVERRIDES[slug]?.[id] ?? MOMENT_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1)
}

// The alt text of a moment's scene, from the catalog's words for the theme.
const WHEN = {
  day: 'by day',
  night: 'at night',
  sunrise: 'at sunrise',
  sunset: 'at sunset',
  morning: 'in the morning',
  evening: 'in the evening',
  'golden hour': 'in the golden hour',
  dawn: 'at dawn',
  dusk: 'at dusk',
  twilight: 'at twilight',
  'before dawn': 'before dawn',
}
// The catalog's about text without its closing "The same at every hour.", which the README
// says in its own words and a screen reader does not need.
const aboutOf = theme => theme.about.replace(/\s*The same at every hour\.\s*$/, '')

function altFor(theme, name, single) {
  const line = theme.line.replace(/\.\s*$/, '')
  const about = aboutOf(theme)
  if (single) return line + '. ' + about
  const when = WHEN[name.toLowerCase()] ?? 'at ' + name.toLowerCase()
  return line + ', ' + when + '. ' + about
}

const clock = hour => {
  const t = Math.round(hour * 60) % 1440
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0')
}

// The theme's scenes as they stand: [{ id, file, text }], checked.
function scenesOf(slug) {
  const dir = path.join(PROTOS, slug, 'out')
  if (!fs.existsSync(dir)) throw new Error(`${slug}: no folder ${path.relative(KIT, dir)}`)
  const re = new RegExp('^' + slug.replace(/-/g, '\\-') + '(?:-([a-z0-9]+))?\\.svg$')
  const found = []
  for (const f of fs.readdirSync(dir).sort()) {
    const m = re.exec(f)
    if (!m || !fs.statSync(path.join(dir, f)).isFile()) continue
    found.push({ id: m[1] ?? '', file: path.join(dir, f) })
  }
  // A one-moment scene is <slug>.svg; when moment files exist too, they win.
  const timed = found.filter(f => f.id)
  const list = timed.length ? timed : found
  if (!list.length) throw new Error(`${slug}: no scene in ${path.relative(KIT, dir)}`)
  return list.map(s => {
    const text = fs.readFileSync(s.file, 'utf8')
    const name = path.basename(s.file)
    if (!text.trimEnd().endsWith('</svg>')) throw new Error(`${slug}: ${name} is not finished (still being written?)`)
    if (text.length > SCENE_LIMIT) throw new Error(`${slug}: ${name} has ${text.length} characters, over the player's ${SCENE_LIMIT}`)
    if (text.includes('\uFFFD')) throw new Error(`${slug}: ${name} is not valid UTF-8`)
    return { ...s, text }
  })
}

/* ---------- Stills: tone and glass ---------- */

const hashOf = text => crypto.createHash('sha256').update(STILL_KEY + '\n' + text).digest('hex')

let browser
let page
async function openPage() {
  if (page) return page
  const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
  let executablePath
  const dir = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : ''
  if (dir && fs.existsSync(dir)) {
    const build = fs.readdirSync(dir).filter(d => d.startsWith('chromium-')).sort().pop()
    const exe = build && path.join(dir, build, 'chrome-win64', 'chrome.exe')
    if (exe && fs.existsSync(exe)) executablePath = exe
  }
  browser = await chromium.launch(executablePath ? { executablePath } : {})
  page = await browser.newPage({ viewport: STILL, deviceScaleFactor: 1 })
  return page
}

export async function closeStills() {
  if (browser) await browser.close()
  browser = undefined
  page = undefined
}

// A still of the scene as the app draws it (an <img> filling the window), and what is measured
// from it: `luma`, the mean brightness (0 to 1, Rec. 601 on the encoded values, as
// site/build.mjs measures it) of the middle of the picture, where the chat column sits: x from
// 25% to 75%, y from 12% (under the title bar) to 84% (above the message box); and `avg`, the
// average colour of the whole picture, in linear sRGB.
export async function still(svg) {
  const hash = hashOf(svg)
  const pngFile = path.join(CACHE, hash + '.png')
  const jsonFile = path.join(CACHE, hash + '.json')
  if (fs.existsSync(pngFile) && fs.existsSync(jsonFile)) {
    return { hash, png: fs.readFileSync(pngFile), ...JSON.parse(fs.readFileSync(jsonFile, 'utf8')), cached: true }
  }
  const p = await openPage()
  const b64 = Buffer.from(stillOf(svg)).toString('base64')
  await p.setContent(
    `<!doctype html><style>html,body{margin:0;background:#000}img{display:block;width:${STILL.width}px;height:${STILL.height}px}</style><img src="data:image/svg+xml;base64,${b64}">`,
  )
  await p.waitForFunction(() => document.querySelector('img').complete)
  await p.waitForTimeout(300)
  const png = await p.screenshot({ type: 'png' })
  const stats = await p.evaluate(async b64png => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64png
    await img.decode()
    const w = img.naturalWidth
    const h = img.naturalHeight
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const x = c.getContext('2d', { willReadFrequently: true })
    x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 0, w, h).data
    const lin = v => {
      const s = v / 255
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    const x0 = Math.round(w * 0.25)
    const x1 = Math.round(w * 0.75)
    const y0 = Math.round(h * 0.12)
    const y1 = Math.round(h * 0.84)
    let r = 0
    let g = 0
    let b = 0
    let luma = 0
    let mid = 0
    for (let y = 0; y < h; y++) {
      for (let xx = 0; xx < w; xx++) {
        const i = (y * w + xx) * 4
        r += lin(d[i])
        g += lin(d[i + 1])
        b += lin(d[i + 2])
        if (xx >= x0 && xx < x1 && y >= y0 && y < y1) {
          luma += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255
          mid++
        }
      }
    }
    const n = w * h
    return { luma: luma / mid, avg: [r / n, g / n, b / n] }
  }, png.toString('base64'))
  fs.mkdirSync(CACHE, { recursive: true })
  const ignore = path.join(ENGINE, '.cache', '.gitignore')
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n')
  fs.writeFileSync(pngFile, png)
  fs.writeFileSync(jsonFile, JSON.stringify(stats) + '\n')
  return { hash, png, ...stats, cached: false }
}

/* ---------- The mod ---------- */

// Nothing personal or local may go into an archive: no user name, no home folder, no
// absolute Windows path.
function checkClean(slug, entries) {
  const user = os.userInfo().username.toLowerCase()
  const home = os.homedir().toLowerCase()
  const banned = [/[a-z]:[\\/]+users[\\/]/i]
  for (const e of entries) {
    if (e.name.endsWith('.png')) continue
    const text = (Buffer.isBuffer(e.data) ? e.data.toString('utf8') : e.data).toLowerCase()
    const hit =
      banned.find(re => re.test(text)) ??
      [home, home.replace(/\\/g, '/'), home.replace(/\\/g, '\\\\')].find(h => h && text.includes(h)) ??
      (user.length >= 3 && new RegExp('(^|[^a-z0-9])' + user.replace(/[^a-z0-9]/g, '\\$&') + '([^a-z0-9]|$)').test(text) ? user : undefined)
    if (hit) throw new Error(`${slug}: ${e.name} holds a local path or the user name`)
  }
}

// One theme: its archive, and its entry in packs.json.
async function packTheme(theme, outDir) {
  const s = theme.slug
  const scenes = scenesOf(s)
  const single = scenes.length === 1 && scenes[0].id === ''
  const starts = startHours(s, scenes.map(x => x.id))
  const moments = []
  for (const sc of scenes) {
    const st = await still(sc.text)
    const name = momentName(s, sc.id)
    moments.push({
      id: sc.id,
      name,
      start: starts[sc.id],
      ...glassOf(st),
      alt: altFor(theme, name, single),
      text: sc.text,
      png: st.png,
      hash: st.hash,
      luma: st.luma,
      cached: st.cached,
      order: MOMENT_ORDER.indexOf(sc.id),
    })
  }
  moments.sort((a, b) => a.start - b.start)

  // theme.js, checked: imported as a module, every scene must come back exactly as its file.
  const js = themeJs(theme, moments)
  const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
  if (mod.THEME.slug !== s || mod.THEME.moments.length !== moments.length) throw new Error(`${s}: theme.js check: shape`)
  for (const [i, m] of moments.entries()) {
    const back = mod.THEME.moments[i]
    if (back.svg !== m.text || back.id !== m.id || back.start !== m.start) throw new Error(`${s}: theme.js check: ${m.id || 'scene'}`)
    if (!Buffer.from(back.svg, 'utf8').equals(fs.readFileSync(scenes.find(x => x.id === m.id).file))) throw new Error(`${s}: theme.js check: bytes of ${m.id || 'scene'}`)
  }

  // The template, with theme.js made from these moments and the slug stamped into the six
  // command names of register.tsx (editor/lib/archive.js, shared with the editor's exporter).
  const hookFiles = Object.fromEntries(fs.readdirSync(TEMPLATE).filter(f => f !== 'theme.js' && fs.statSync(path.join(TEMPLATE, f)).isFile()).map(f => [f, fs.readFileSync(path.join(TEMPLATE, f))]))
  const entries = archiveEntries({ theme, moments, hookFiles, preview: heroOf(moments, HERO_ORDER).png, project: '{}\n', by: 'packer', repo: REPO, heroOrder: HERO_ORDER })
  checkClean(s, entries)
  const buf = zip(entries)
  // Read it back: every name and byte must survive.
  const back = unzip(buf)
  if (back.length !== entries.length) throw new Error(`${s}: zip check: entry count`)
  for (const [i, e] of entries.entries()) {
    const want = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data)
    if (back[i].name !== e.name || !back[i].data.equals(want)) throw new Error(`${s}: zip check: ${e.name}`)
  }
  fs.writeFileSync(path.join(outDir, s + '.zip'), buf)
  return {
    entry: {
      zip: s + '.zip',
      bytes: buf.length,
      version: VERSION,
      moments: moments.map(m => ({ id: m.id, name: m.name, start: m.start, tone: m.tone, tint: m.tint, opacity: m.opacity })),
    },
    moments,
    hashes: moments.map(m => m.hash),
  }
}

export async function pack(outDir) {
  fs.mkdirSync(outDir, { recursive: true })
  const packsFile = path.join(outDir, 'packs.json')
  let before = {}
  try {
    before = JSON.parse(fs.readFileSync(packsFile, 'utf8'))
  } catch {
    before = {}
  }
  const packs = {}
  const used = new Set()
  const failed = []
  for (const theme of THEMES) {
    if (theme.slug === 'sunfield') continue
    try {
      const { entry, moments, hashes } = await packTheme(theme, outDir)
      packs[theme.slug] = entry
      for (const h of hashes) used.add(h)
      console.log(`  ${theme.slug.padEnd(15)} ${String(entry.bytes).padStart(7)} bytes`)
      for (const m of moments) {
        console.log(
          `    ${(m.id || '(one)').padEnd(8)} ${clock(m.start)}  luma ${m.luma.toFixed(3)}  ${m.tone.padEnd(5)}  ${m.tint} ${m.opacity.toFixed(2)}${m.cached ? '' : '  (rendered)'}`,
        )
      }
    } catch (err) {
      failed.push(theme.slug)
      console.error(`  ${theme.slug.padEnd(15)} NOT PACKED: ${err.message}`)
      // Keep what packs.json said of the archive already there, if it is still the same file.
      const old = before[theme.slug]
      const file = path.join(outDir, theme.slug + '.zip')
      if (old && fs.existsSync(file) && fs.statSync(file).size === old.bytes) packs[theme.slug] = old
    }
  }
  await closeStills()
  fs.writeFileSync(packsFile, JSON.stringify(packs, null, 2) + '\n')
  // Drop stills no scene uses any more (all of them only when every theme was packed).
  if (!failed.length && fs.existsSync(CACHE)) {
    for (const f of fs.readdirSync(CACHE)) if (!used.has(f.replace(/\.(png|json)$/, ''))) fs.rmSync(path.join(CACHE, f))
  }
  return { packs, failed }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outArg = process.argv[2]
  if (!outArg) {
    console.error('usage: node engine/pack.mjs <outDir>')
    process.exit(2)
  }
  const outDir = path.resolve(outArg)
  const t0 = Date.now()
  const { packs, failed } = await pack(outDir)
  console.log(`${Object.keys(packs).length} archives and packs.json in ${outDir} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
  if (failed.length) {
    console.error('not packed: ' + failed.join(', '))
    process.exit(1)
  }
}
