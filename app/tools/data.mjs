// node tools/data.mjs : writes the app's generated data into app/data/.
//   data/scenes/<slug>/<file>.svg   every scene the app shows (prototypes copied, Sunfield drawn)
//   data/sunfield.zip               the Sunfield archive (see sunfieldArchive)
//   data/sunfield-preview.png       Sunfield at day, for the archive (rendered once, then reused)
//   data/themes.js                  names, lines, moments and file paths, as an ES module
// The prototypes are read as they are when this runs: a theme with no finished SVG yet is left
// out, and its moments appear once their files exist.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { HERO_ORDER, MOMENT_NAMES, MOMENT_ORDER, MOMENT_OVERRIDES, REPO, REPO_API, SUNFIELD_MOMENTS, THEMES } from './catalog.mjs'
import { unzip, zip } from './zip.mjs'

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROTOS = path.resolve(APP, '../prototypes')
const SUNFIELD = path.resolve(APP, '../../sunfield')
const DATA = path.join(APP, 'data')
const PW = import.meta.resolve('playwright-core')

// A fixed summer day for Sunfield's moments, so the same build gives the same pictures.
const SUN_DAY = new Date(2026, 5, 21)

const rel = p => path.relative(APP, p).split(path.sep).join('/')
const finished = text => text.trimEnd().endsWith('</svg>')

function momentName(slug, id) {
  return MOMENT_OVERRIDES[slug]?.[id] ?? MOMENT_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1)
}

function sortMoments(list) {
  const rank = id => {
    const i = MOMENT_ORDER.indexOf(id)
    return i < 0 ? 99 : i
  }
  return list.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id))
}

function heroOf(moments) {
  for (const id of HERO_ORDER) {
    const i = moments.findIndex(m => m.id === id)
    if (i >= 0) return i
  }
  return 0
}

// Scenes still being re-encoded (UNFINISHED=slug,slug) are read from out/pre-seam/, their last
// finished version, so a half-done build never reaches a page.
const UNFINISHED = process.env.UNFINISHED ? process.env.UNFINISHED.split(',') : []

// The prototype's scenes as they stand: [{ id, file }], or [] when none is finished.
function prototypeMoments(slug) {
  const pre = path.join(PROTOS, slug, 'out', 'pre-seam')
  const dir = UNFINISHED.includes(slug) && fs.existsSync(pre) ? pre : path.join(PROTOS, slug, 'out')
  if (!fs.existsSync(dir)) return { moments: [], single: false }
  const re = new RegExp('^' + slug.replace(/[-]/g, '\\-') + '(?:-([a-z0-9]+))?\\.svg$')
  const found = []
  let single = false
  for (const f of fs.readdirSync(dir)) {
    const m = re.exec(f)
    if (!m) continue
    const text = fs.readFileSync(path.join(dir, f), 'utf8')
    if (!finished(text)) {
      console.warn('  skipped (still being written):', slug + '/' + f)
      continue
    }
    if (!m[1]) single = true
    found.push({ id: m[1] ?? '', text })
  }
  // A one-moment scene is <slug>.svg; when moment files exist too, they win.
  const timed = found.filter(f => f.id)
  return { moments: timed.length ? timed : found, single: single && !timed.length }
}

async function sunfieldMoments() {
  const day = await import(pathToFileURL(path.join(SUNFIELD, 'mod/hooks/day.js')).href)
  const { SCENE } = await import(pathToFileURL(path.join(SUNFIELD, 'mod/hooks/scene.js')).href)
  const midnight = SUN_DAY.getTime()
  const { rise, set } = day.sunTimes(midnight + 12 * 3600e3)
  return SUNFIELD_MOMENTS.map(id => {
    const [anchor, offset] = day.MOMENTS[id]
    const minute = (anchor === 'r' ? rise : set) + offset
    return { id, text: day.sceneAt(SCENE, midnight + minute * 60e3, 0), clock: day.clock(minute) }
  })
}

// Sunfield at day as a PNG, for the archive. Rendered with the local Chromium the first time
// (or when the scene changes) and kept in data/.
async function sunfieldPreview(daySvg) {
  const out = path.join(DATA, 'sunfield-preview.png')
  const sceneJs = path.join(SUNFIELD, 'mod/hooks/scene.js')
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(sceneJs).mtimeMs) return fs.readFileSync(out)
  const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
  const dir = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
  const build = fs.readdirSync(dir).filter(d => d.startsWith('chromium-')).sort().pop()
  const browser = await chromium.launch({ executablePath: path.join(dir, build, 'chrome-win64', 'chrome.exe') })
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } })
  const still = daySvg.replace('</style>', '*{animation-play-state:paused!important}</style>')
  await page.setContent(
    `<style>html,body{margin:0;background:#000}img{display:block;width:960px;height:600px}</style><img src="data:image/svg+xml;base64,${Buffer.from(still).toString('base64')}">`,
  )
  await page.waitForFunction(() => document.querySelector('img').complete)
  await page.waitForTimeout(300)
  const png = await page.screenshot({ type: 'png' })
  await browser.close()
  fs.writeFileSync(out, png)
  return png
}

// What each hooks file is, for the archive's README. Files not named here are listed bare.
const HOOK_NOTES = {
  'register.tsx': 'sets the theme when a session starts, writes the scene for the time of day, and adds /sunfield-off, /sunfield-on and /sunfield-sky',
  'register.test.tsx': 'tests for register.tsx (claude plugin test mod)',
  'day.js': 'sunrise and sunset from the clock and time zone, the look of each moment, and the CSS of the day',
  'colors.js': 'the colours and the frosted glass over the scene',
  'scene.js': 'the scene: one animated pixel-art SVG, as a string',
  'make-colors.js': "Anthropic's colour helper, copied from Claude Code's plugin-authoring skill",
  'hooks.json': 'names register.tsx as the module to load',
}

function sunfieldReadme(hooks) {
  const list = hooks
    .map(f => {
      const note = HOOK_NOTES[f] ?? (f.endsWith('.d.ts') ? 'type declarations for ' + f.replace('.d.ts', '.js') : '')
      return '- `mod/hooks/' + f + '`' + (note ? ': ' + note + '.' : '')
    })
    .join('\n')
  return `# Sunfield

A BackdropKit theme for the Claude desktop app: an animated pixel-art sky over a sunflower field
behind your Claude Code conversation. It follows your computer's clock, from night through
sunrise, day and sunset, and the app's panels follow the sky.

Made by the BackdropKit community project (${REPO}). Not made by Anthropic.

## What is inside

- \`.claude-plugin/marketplace.json\`: a marketplace with one plugin, named \`backdropkit-sunfield\`.
- \`mod/.claude-plugin/plugin.json\`: the plugin, named \`sunfield\`.
${list}
- \`preview.png\`: the theme at day.
- \`project.json\`: the theme's project file for the BackdropKit editor (empty for now).
- \`README.md\`: this file.

Nothing else belongs in the archive. The plugin reads no files and makes no network requests.

## Install by hand

Unpack the archive into a folder you keep (the theme is read from it), for example
\`~/.claude/backdropkit/sunfield\`, then run these two commands with that folder's path:

\`\`\`
claude plugin marketplace add "<that folder>"
claude plugin install sunfield@backdropkit-sunfield --scope user
\`\`\`

Run /reload-plugins or start a new session to see the theme.

## Use

- \`/sunfield-sky\` shows today's sunrise and sunset; \`/sunfield-sky sunset\` (or night, dawn,
  sunrise, morning, day, golden, dusk, twilight, or a time like 18:30) previews another time;
  \`/sunfield-sky now\` goes back to your clock.
- \`/sunfield-off\` takes the theme off, \`/sunfield-on\` puts it back.
- To remove it: \`claude plugin uninstall sunfield@backdropkit-sunfield\`.

The app plays the motion only with the GPU on and reduced motion off; otherwise it shows a
still frame of the current time of day.
`
}

async function sunfieldArchive(daySvg) {
  const marketplace = JSON.parse(fs.readFileSync(path.join(SUNFIELD, '.claude-plugin/marketplace.json'), 'utf8'))
  marketplace.name = 'backdropkit-sunfield'
  marketplace.plugins = marketplace.plugins.map(p => ({ ...p, name: 'sunfield', source: './mod' }))
  const hooksDir = path.join(SUNFIELD, 'mod/hooks')
  const hooks = fs
    .readdirSync(hooksDir)
    .filter(f => fs.statSync(path.join(hooksDir, f)).isFile())
    .sort()
  const entries = [
    { name: '.claude-plugin/marketplace.json', data: JSON.stringify(marketplace, null, 2) + '\n' },
    { name: 'mod/.claude-plugin/plugin.json', data: fs.readFileSync(path.join(SUNFIELD, 'mod/.claude-plugin/plugin.json')) },
    ...hooks.map(f => ({ name: 'mod/hooks/' + f, data: fs.readFileSync(path.join(hooksDir, f)) })),
    { name: 'README.md', data: sunfieldReadme(hooks) },
    { name: 'preview.png', data: await sunfieldPreview(daySvg) },
    { name: 'project.json', data: '{}\n' },
  ]
  const buf = zip(entries)
  // Read it back: every name and byte must survive.
  const back = unzip(buf)
  if (back.length !== entries.length) throw new Error('zip check: entry count')
  for (const [i, e] of entries.entries()) {
    const want = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data)
    if (back[i].name !== e.name || !back[i].data.equals(want)) throw new Error('zip check: ' + e.name)
  }
  return { buf, names: entries.map(e => e.name) }
}

export async function buildData({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log
  fs.rmSync(path.join(DATA, 'scenes'), { recursive: true, force: true })
  fs.mkdirSync(path.join(DATA, 'scenes'), { recursive: true })

  const themes = []
  for (const t of THEMES) {
    let found
    let single = false
    let clocks = {}
    if (t.slug === 'sunfield') {
      found = await sunfieldMoments()
      clocks = Object.fromEntries(found.map(m => [m.id, m.clock]))
    } else {
      ;({ moments: found, single } = prototypeMoments(t.slug))
    }
    if (!found.length) {
      log('  not drawn yet:', t.slug)
      continue
    }
    const dir = path.join(DATA, 'scenes', t.slug)
    fs.mkdirSync(dir, { recursive: true })
    const moments = sortMoments(
      found.map(m => {
        const file = path.join(dir, t.slug + (m.id ? '-' + m.id : '') + '.svg')
        fs.writeFileSync(file, m.text)
        return { id: m.id, name: m.id ? momentName(t.slug, m.id) : 'All day', file: rel(file), bytes: Buffer.byteLength(m.text) }
      }),
    )
    themes.push({
      slug: t.slug,
      name: t.name,
      line: t.line,
      about: t.about,
      ready: !!t.ready,
      clock: t.slug === 'sunfield' || !single,
      hero: heroOf(moments),
      moments,
      times: clocks,
    })
    log('  ' + t.slug.padEnd(15), moments.map(m => m.id || '(one)').join(', '))
  }

  // The Sunfield archive.
  const sun = themes.find(t => t.slug === 'sunfield')
  const daySvg = fs.readFileSync(path.join(APP, sun.moments.find(m => m.id === 'day').file), 'utf8')
  const { buf, names } = await sunfieldArchive(daySvg)
  const zipFile = path.join(DATA, 'sunfield.zip')
  fs.writeFileSync(zipFile, buf)
  sun.archive = { file: rel(zipFile), name: 'sunfield.zip', bytes: buf.length }
  log('  sunfield.zip', buf.length, 'bytes,', names.length, 'files')

  const js =
    '// Generated by tools/data.mjs. Do not edit: change tools/catalog.mjs and run it again.\n' +
    'export const REPO = ' + JSON.stringify(REPO) + '\n' +
    'export const REPO_API = ' + JSON.stringify(REPO_API) + '\n' +
    'export const THEMES = ' + JSON.stringify(themes, null, 1) + '\n'
  fs.writeFileSync(path.join(DATA, 'themes.js'), js)
  return { themes, dataDir: DATA }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { themes } = await buildData()
  console.log('data/themes.js:', themes.length, 'themes')
}
