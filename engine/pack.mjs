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

import { HERO_ORDER, MOMENT_NAMES, MOMENT_ORDER, MOMENT_OVERRIDES, REPO, THEMES } from '../app/tools/catalog.mjs'
import { unzip, zip } from '../app/tools/zip.mjs'

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

// The scene with its motion held at the first frame: every animation paused at its start.
function stillOf(svg) {
  const pause = '*{animation-play-state:paused!important}'
  return svg.includes('</style>') ? svg.replace('</style>', pause + '</style>') : svg.replace(/<svg\b[^>]*>/, m => m + '<style>' + pause + '</style>')
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

// OKLab, from and to linear sRGB.
function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}
function linear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}
const encode = v => {
  const c = Math.min(1, Math.max(0, v))
  return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255)
}
const hex = rgb => '#' + rgb.map(v => encode(v).toString(16).padStart(2, '0')).join('')
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// The tone and the frosted glass of a moment, from its still. Like Sunfield's glass, the tint
// keeps the hue of the scene and stays smoky, never milky: over a light scene a pale tint
// (OKLab lightness about 0.91, the scene's colour cut to under half, at most 0.04), over a
// dark one a deep tint (lightness 0.18 to 0.3, darker for a darker scene, the scene's colour
// a little stronger, at most 0.06). Opacity is 0.5 over a light scene and 0.55 over a dark
// one, 0.6 where the middle of a dark scene is mid-toned (as Sunfield's sunrise glass is).
// Measured on Sunfield's own scenes, this lands within a few steps of its hand-picked glass.
export function glassOf({ luma, avg }) {
  const dark = luma < 0.5
  const [L, a, b] = oklab(avg)
  const chroma = Math.hypot(a, b)
  const hue = Math.atan2(b, a)
  const tL = dark ? clamp(0.17 + 0.2 * L, 0.18, 0.3) : clamp(0.87 + 0.06 * L, 0.88, 0.93)
  let tC = dark ? Math.min(0.06, 1.2 * chroma) : Math.min(0.04, 0.45 * chroma)
  let rgb = linear([tL, tC * Math.cos(hue), tC * Math.sin(hue)])
  while (tC > 1e-4 && rgb.some(v => v < 0 || v > 1)) {
    tC *= 0.9
    rgb = linear([tL, tC * Math.cos(hue), tC * Math.sin(hue)])
  }
  const opacity = dark ? (luma >= 0.38 ? 0.6 : 0.55) : 0.5
  return { tone: dark ? 'dark' : 'light', tint: hex(rgb), opacity }
}

/* ---------- The mod ---------- */

// What each hooks file is, for the README.
const HOOK_NOTES = {
  'register.tsx': s => `sets the theme when a session starts, picks the scene for the time of day, and adds /${s}-off, /${s}-on and /${s}-time`,
  'register.test.tsx': () => 'tests for register.tsx (claude plugin test mod)',
  'theme.js': () => "the theme: its moments, the hour each starts, the panels' tone and glass over each, and each scene as one animated SVG string",
  'colors.js': () => 'the colours of the light and the dark look, and the blur of the frosted glass',
  'make-colors.js': () => "Anthropic's colour helper, copied from Claude Code's plugin-authoring skill",
  'hooks.json': () => 'names register.tsx as the module to load',
}

function themeJs(theme, moments) {
  const lines = moments.map(
    m =>
      '    { id: ' + JSON.stringify(m.id) + ', name: ' + JSON.stringify(m.name) + ', start: ' + m.start + ', dark: ' + (m.tone === 'dark') +
      ', tint: ' + JSON.stringify(m.tint) + ', opacity: ' + m.opacity + ',\n      alt: ' + JSON.stringify(m.alt) + ',\n      svg: ' + JSON.stringify(m.text) + ' },',
  )
  return (
    '// Generated by the BackdropKit packer for the theme ' + theme.name + '. Do not edit: the scenes and the\n' +
    "// words come from the BackdropKit project, and packing again writes this file anew. Each scene\n" +
    '// is one animated SVG document, as the app plays it, and each moment lasts from its start hour\n' +
    '// until the next one starts.\n' +
    'export const THEME = {\n' +
    '  slug: ' + JSON.stringify(theme.slug) + ',\n' +
    '  name: ' + JSON.stringify(theme.name) + ',\n' +
    '  moments: [\n' +
    lines.join('\n') + '\n' +
    '  ],\n' +
    '}\n'
  )
}

function description(theme, single) {
  const line = theme.line.replace(/\.\s*$/, '')
  const what = line.charAt(0).toLowerCase() + line.slice(1)
  const how = single ? 'the same at every hour' : 'that follows your clock'
  return `${theme.name}: ${what}, as an animated pixel-art scene behind the conversation ${how}. ${CREDIT}`
}

function readme(theme, moments, hooks) {
  const s = theme.slug
  const single = moments.length === 1
  const list = hooks
    .map(f => {
      const note = HOOK_NOTES[f]?.(s) ?? (f.endsWith('.d.ts') ? 'type declarations for ' + f.replace('.d.ts', '.js') : '')
      return '- `mod/hooks/' + f + '`' + (note ? ': ' + note + '.' : '')
    })
    .join('\n')
  const when = single
    ? `It is the same at every hour: one scene, all day.`
    : `It follows your computer's clock, with one scene for each part of the day:

| Scene | From | To | Panels |
| --- | --- | --- | --- |
${moments.map((m, i) => `| ${m.name} | ${clock(m.start)} | ${clock((moments[i + 1] ?? moments[0]).start)} | ${m.tone} |`).join('\n')}

The scene changes within five minutes of its hour, and the app's panels change with it: light
with dark words over a light scene, dark with pale words over a dark one, the frosted glass
tinted from the scene.`
  const keys = moments.map(m => m.name.toLowerCase().replace(/\s+/g, '-'))
  const use = single
    ? `- \`/${s}-off\` takes the theme off, in new sessions too; \`/${s}-on\` puts it back.
- \`/${s}-time\` says when the scene plays: all day, so there is no other moment to preview.`
    : `- \`/${s}-time\` lists when each scene plays. \`/${s}-time ${keys[keys.length - 1]}\` (or ${keys.slice(0, -1).join(', ')}, or a
  time like 18:30) previews another moment and runs on from it; \`/${s}-time now\` goes back
  to your clock.
- \`/${s}-off\` takes the theme off, in new sessions too; \`/${s}-on\` puts it back.`
  return `# ${theme.name}

A BackdropKit theme for the Claude desktop app: ${theme.line.charAt(0).toLowerCase() + theme.line.slice(1)} ${aboutOf(theme)}

It is an animated pixel-art scene behind your Claude Code conversation, with the app's colours
to match. ${when}

${CREDIT}

## What is inside

- \`.claude-plugin/marketplace.json\`: a marketplace with one plugin, named \`backdropkit-${s}\`.
- \`mod/.claude-plugin/plugin.json\`: the plugin, named \`${s}\`, version ${VERSION}.
${list}
- \`preview.png\`: a still of the ${single ? 'scene' : heroOf(moments).name + ' scene'}.
- \`project.json\`: the theme's project file for the BackdropKit editor (empty for now).
- \`README.md\`: this file.

Nothing else belongs in the archive. The plugin reads no files and makes no network requests.

## Install by hand

Unpack the archive into a folder you keep (the theme is read from it), for example
\`~/.claude/backdropkit/${s}\`, then run these two commands with that folder's path:

\`\`\`
claude plugin marketplace add "<that folder>"
claude plugin install ${s}@backdropkit-${s} --scope user
\`\`\`

Run /reload-plugins or start a new session to see the theme. If another theme plugin is on,
turn it off first (\`claude plugin disable <name>\`): the theme set last wins.

## Use

${use}
- To remove it: \`claude plugin uninstall ${s}@backdropkit-${s}\`.

The app plays the motion only with the GPU on and reduced motion off; otherwise it shows a
still frame of the scene.
`
}

function heroOf(moments) {
  for (const id of HERO_ORDER) {
    const m = moments.find(x => x.id === id)
    if (m) return m
  }
  return moments[0]
}

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

  const hookFiles = { ...Object.fromEntries(fs.readdirSync(TEMPLATE).filter(f => fs.statSync(path.join(TEMPLATE, f)).isFile()).map(f => [f, fs.readFileSync(path.join(TEMPLATE, f))])), 'theme.js': js }
  // The command names in register.tsx are written as literals (so claude plugin validate reads
  // them as commands the module answers itself): the template holds __SLUG__ in their place.
  const reg = hookFiles['register.tsx'].toString('utf8')
  const stamps = reg.split("'__SLUG__-").length - 1
  if (stamps !== 6) throw new Error(`register.tsx: expected 6 command names to stamp, found ${stamps}`)
  hookFiles['register.tsx'] = reg.replaceAll("'__SLUG__-", "'" + s + '-')
  if (hookFiles['register.tsx'].includes('__SLUG__')) throw new Error('register.tsx: a __SLUG__ left after stamping')
  const hooks = Object.keys(hookFiles).sort()
  const desc = description(theme, single)
  const plugin = { name: s, version: VERSION, description: desc, author: { name: 'BackdropKit community project', url: REPO }, homepage: REPO, license: 'MIT' }
  const marketplace = {
    name: 'backdropkit-' + s,
    owner: { name: 'BackdropKit community project', url: REPO },
    metadata: { description: `${theme.name}, a BackdropKit theme for the Claude desktop app. ${CREDIT}` },
    plugins: [{ name: s, source: './mod', description: desc, version: VERSION }],
  }
  const entries = [
    { name: '.claude-plugin/marketplace.json', data: JSON.stringify(marketplace, null, 2) + '\n' },
    { name: 'mod/.claude-plugin/plugin.json', data: JSON.stringify(plugin, null, 2) + '\n' },
    ...hooks.map(f => ({ name: 'mod/hooks/' + f, data: hookFiles[f] })),
    { name: 'README.md', data: readme(theme, moments, hooks) },
    { name: 'preview.png', data: heroOf(moments).png },
    { name: 'project.json', data: '{}\n' },
  ]
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
