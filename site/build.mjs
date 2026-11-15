// node site/build.mjs : builds the BackdropKit landing page into docs/, which GitHub Pages serves.
//   docs/index.html            the page for GitHub Pages (a whole document)
//   docs/artifact.html         the same page as a fragment, for a claude.ai Artifact preview
//   docs/scenes/<slug>/*.svg   every scene, as the desktop app plays it
//   docs/thumbs/<slug>.jpg     a still of each theme for the shelf
//   docs/themes/<slug>.zip     the archives: Sunfield from app/tools/data.mjs, the rest from
//                              engine/pack.mjs when it exists (NOPACK=1 skips it)
// Scenes, names and Sunfield's archive come from app/tools/data.mjs (UNFINISHED=<slugs> there
// shows a scene's pre-seam copy). Each moment's tone (light or dark ink) is measured from a
// still: the mean brightness of the middle of the picture, where the chat sits.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { buildData } from '../app/tools/data.mjs'
import { REPO } from '../app/tools/catalog.mjs'

const SITE = path.dirname(fileURLToPath(import.meta.url))
const KIT = path.resolve(SITE, '..')
const APP = path.join(KIT, 'app')
const DIST = path.join(KIT, 'docs')
const PW = import.meta.resolve('playwright-core')
const rel = p => path.relative(DIST, p).split(path.sep).join('/')

/* ---------- Data ---------- */
const { themes } = await buildData({ quiet: true })
for (const d of ['scenes', 'thumbs']) fs.rmSync(path.join(DIST, d), { recursive: true, force: true })
fs.mkdirSync(path.join(DIST, 'themes'), { recursive: true })

const PACK = path.join(KIT, 'engine', 'pack.mjs')
if (!process.env.NOPACK && fs.existsSync(PACK)) {
  const r = spawnSync(process.execPath, [PACK, path.join(DIST, 'themes')], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('engine/pack.mjs failed')
}
fs.copyFileSync(path.join(APP, 'data', 'sunfield.zip'), path.join(DIST, 'themes', 'sunfield.zip'))

/* ---------- Stills: tone per moment, a thumb per theme ---------- */
const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent('<!doctype html><title>still</title>')
async function measure(svgText, thumb) {
  return page.evaluate(
    async ({ b64, thumb }) => {
      const img = new Image()
      img.src = 'data:image/svg+xml;base64,' + b64
      await img.decode()
      const c = document.createElement('canvas')
      c.width = 160
      c.height = 100
      const x = c.getContext('2d')
      x.drawImage(img, 0, 0, 160, 100)
      // The middle of the picture: the chat column, from under the title bar to above the composer.
      const d = x.getImageData(40, 12, 80, 72).data
      let sum = 0
      for (let i = 0; i < d.length; i += 4) sum += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255
      const luma = sum / (d.length / 4)
      let jpg = null
      if (thumb) {
        const t = document.createElement('canvas')
        t.width = 320
        t.height = 200
        const tx = t.getContext('2d')
        tx.imageSmoothingQuality = 'high'
        tx.drawImage(img, 0, 0, 320, 200)
        jpg = t.toDataURL('image/jpeg', 0.86)
      }
      return { luma, jpg }
    },
    { b64: Buffer.from(svgText).toString('base64'), thumb },
  )
}

const out = []
for (const t of themes) {
  const sceneDir = path.join(DIST, 'scenes', t.slug)
  fs.mkdirSync(sceneDir, { recursive: true })
  const moments = []
  for (const [i, m] of t.moments.entries()) {
    const src = path.join(APP, m.file)
    const dst = path.join(sceneDir, path.basename(src))
    fs.copyFileSync(src, dst)
    const r = await measure(fs.readFileSync(src, 'utf8'), i === t.hero)
    if (r.jpg) {
      fs.mkdirSync(path.join(DIST, 'thumbs'), { recursive: true })
      fs.writeFileSync(path.join(DIST, 'thumbs', t.slug + '.jpg'), Buffer.from(r.jpg.split(',')[1], 'base64'))
    }
    moments.push({ id: m.id, name: m.name, file: rel(dst), tone: r.luma < 0.5 ? 'dark' : 'light', bytes: m.bytes })
    console.log('  ' + t.slug.padEnd(15) + (m.id || '(one)').padEnd(9) + r.luma.toFixed(2) + ' ' + moments.at(-1).tone)
  }
  const zipFile = path.join(DIST, 'themes', t.slug + '.zip')
  const zip = fs.existsSync(zipFile) ? { file: rel(zipFile), name: t.slug + '.zip', bytes: fs.statSync(zipFile).size } : null
  out.push({ slug: t.slug, name: t.name, line: t.line, about: t.about, hero: t.hero, thumb: 'thumbs/' + t.slug + '.jpg', zip, moments })
}
await browser.close()

/* ---------- Page ---------- */
const css = fs.readFileSync(path.join(SITE, 'src', 'site.css'), 'utf8')
const js = fs.readFileSync(path.join(SITE, 'src', 'site.js'), 'utf8')
const data = JSON.stringify({ THEMES: out, REPO }).replace(/</g, '\\u003c')

const icon = (d, box = 16) => '<svg class="i" viewBox="0 0 ' + box + ' ' + box + '" aria-hidden="true">' + d + '</svg>'
const I = {
  chevR: icon('<path d="M6 3.5l4.5 4.5L6 12.5"/>'),
  chevL: icon('<path d="M10 3.5L5.5 8l4.5 4.5"/>'),
  chevD: icon('<path d="M4 6l4 4 4-4"/>'),
  plus: icon('<path d="M8 3v10M3 8h10"/>'),
  sidebar: icon('<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M6 3v10"/>'),
  star: icon('<path d="M8 2.2l1.75 3.6 3.95.55-2.87 2.77.7 3.93L8 11.2l-3.53 1.85.7-3.93L2.3 6.35l3.95-.55z"/>'),
  download: icon('<path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10"/>'),
}

// winch-ai's mark: an 8 x 8 pixel sun cut by the horizon.
const MARK_ROWS = ['..####..', '.######.', '########', '########', '........', '########', '........', '.######.']
const mark = (() => {
  let r = ''
  MARK_ROWS.forEach((row, y) => [...row].forEach((c, x) => c === '#' && (r += 'M' + x + ' ' + y + 'h1v1h-1z')))
  return '<svg class="mark" viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="' + r + '"/></svg>'
})()

// Claude's spark, drawn here as rays round a centre, to say which tool the themes are for.
const claude = (() => {
  const lens = [11, 9.3, 10.6, 8.9, 11.2, 9.6, 10.3, 8.7, 11, 9.4, 10.8, 9.1]
  let d = ''
  const f = v => v.toFixed(2)
  lens.forEach((L, i) => {
    const a = (i / lens.length) * Math.PI * 2 - Math.PI / 2 + 0.1
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const p = (r, w) => f(12 + ux * r - uy * w) + ' ' + f(12 + uy * r + ux * w)
    const w0 = 1.5
    const w1 = 0.78
    d += 'M' + p(2, w0) + 'L' + p(L, w1) + 'A' + w1 + ' ' + w1 + ' 0 0 1 ' + p(L, -w1) + 'L' + p(2, -w0) + 'Z'
  })
  return '<svg class="claude" viewBox="0 0 24 24" role="img" aria-label="Claude Code"><path fill="#D97757" d="' + d + '"/><circle cx="12" cy="12" r="3.3" fill="#D97757"/></svg>'
})()

const who = '<div class="who">' + mark + 'winch-ai</div>'
const n = out.length
const clockCount = out.filter(t => t.moments.length > 1).length
const themeRows = out
  .map(t => '<tr><td>' + t.name + '</td><td>' + (t.moments.length > 1 ? t.moments.map(m => m.name).join(', ') : 'All day') + '</td></tr>')
  .join('')
const sizeRows = out
  .map(t => {
    const big = Math.max(...t.moments.map(m => m.bytes))
    return '<tr><td>' + t.name + '</td><td>' + (big / 1000).toFixed(1) + 'k</td></tr>'
  })
  .join('')

const body = `<div class="scene" aria-hidden="true"><img id="s0" class="on" alt=""><img id="s1" alt=""></div>
<div class="band" aria-hidden="true"></div>
<template id="mark-tpl">${mark}</template>

<header class="top">
  <nav class="menubar" aria-label="Menu bar">
    <div class="side">
      <a class="mb-item mb-app" href="#top">${mark}winch-ai</a>
      <a class="mb-item mb-menu" href="#themes">Themes</a>
      <a class="mb-item mb-menu" href="#install">Install</a>
      <a class="mb-item mb-menu" href="#editor">Editor</a>
    </div>
    <div class="side">
      <span class="mb-item mb-now" id="now" aria-live="polite"></span>
      <span class="mb-item mb-clock" id="clock"></span>
    </div>
  </nav>
  <div class="titlebar">
    <div class="side">
      <span class="tb-btn" aria-hidden="true">${I.sidebar}</span>
      <h1 class="title" style="margin:0;font-size:inherit;font-weight:500">Animated themes for Claude Code ${I.chevD}</h1>
    </div>
    <div class="side">
      <a class="tb-btn" href="${REPO}" target="_blank" rel="noopener" title="Star BackdropKit on GitHub" aria-label="Star BackdropKit on GitHub">${I.star}</a>
    </div>
  </div>
</header>

<main class="chat" id="chat">
  <div class="msg user" id="top"><div>What is this?</div></div>

  <div class="msg bot">
    ${who}
    <p><strong>BackdropKit</strong> is a set of animated pixel-art themes for the Claude Code desktop app. A theme plays behind your conversation, the way this page plays behind me, and the app's panels take their colour from it.</p>
    <p>${clockCount} of the ${n} follow your clock, from night to sunrise, day and sunset. They are made by <a href="https://github.com/winchxyz" target="_blank" rel="noopener">winchxyz</a>, and they are free and open source.</p>
    <details class="tool"><summary>Loaded ${n} themes ${I.chevR}</summary>
      <div class="tool-body scroll"><table>${themeRows}</table></div>
    </details>
  </div>

  <div class="msg user" id="themes"><div>Show me the themes</div></div>

  <div class="msg bot">
    ${who}
    <p>Here they are. Pick one and this page switches to it, the way it would look in the app. The times of day under it show the other moments.</p>
    <div class="shelf">
      <div class="shelf-head"><span>${n} themes</span>
        <div class="arrows"><button class="round" id="prev" aria-label="Earlier themes">${I.chevL}</button><button class="round" id="next" aria-label="More themes">${I.chevR}</button></div>
      </div>
      <div class="track" id="track" role="listbox" aria-label="Themes"></div>
      <div class="picked" id="picked">
        <h3 id="p-name"></h3>
        <p id="p-about"></p>
        <div class="pills" id="pills" role="group" aria-label="Time of day"></div>
        <div class="actions">
          <a class="btn primary" id="dl" href="#">${I.download}<span id="dl-label">Download</span></a>
          <a class="btn" href="#install">How to install</a>
          <span class="note" id="dl-note"></span>
        </div>
      </div>
    </div>
    <details class="tool"><summary>Checked every scene against the app's player ${I.chevR}</summary>
      <div class="tool-body scroll">
        <p>Each scene is one animated SVG that the desktop app plays by itself, with no script. The app takes up to 131,072 characters; this is the largest moment of each.</p>
        <table>${sizeRows}</table>
      </div>
    </details>
  </div>

  <div class="msg user" id="install"><div>How do I install one?</div></div>

  <div class="msg bot">
    ${who}
    <p>Download the archive, then give Claude Code this prompt. It checks what is inside before it installs anything, and asks before it turns off another theme.</p>
    <ul class="tasks">
      <li><span class="dot todo" id="dot-1"></span><span><span id="st-1">Download the archive</span><span class="sub">It lands in your Downloads folder.</span></span></li>
      <li><span class="dot todo" id="dot-2"></span><span>Copy the prompt<span class="sub">It tells Claude Code what to check and where to unpack.</span></span></li>
      <li><span class="dot todo"></span><span>Paste it into Claude Code<span class="sub">In the Claude desktop app. It installs the theme and tells you when to reload.</span></span></li>
    </ul>
    <div class="prompt">
      <div class="prompt-head"><span>Prompt for Claude Code</span><button class="btn" id="copy">Copy</button></div>
      <pre id="prompt-text"></pre>
    </div>
  </div>

  <div class="msg user" id="editor"><div>Can I make my own?</div></div>

  <div class="msg bot">
    ${who}
    <p>Soon. A theme editor is on the way: layers, pixel brushes, motion, light and the time of day, exported as the same kind of archive. It will open from the box below.</p>
    <div class="status"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>Building the theme editor</div>
  </div>

  <p class="fine" id="fine">Community project, not affiliated with Anthropic. Claude and Claude Code are trademarks of Anthropic. <a href="${REPO}" target="_blank" rel="noopener">Source on GitHub</a></p>
</main>

<div class="composer">
  <button class="box" id="compose" aria-label="Build my own Claude Code theme">
    <span class="plus">${I.plus}</span>
    <span class="line"><span id="typed"></span><span class="caret" aria-hidden="true"></span></span>
    <span class="go">${claude}<span class="label">Build</span></span>
  </button>
  <div class="under"><span>winch-ai</span><span>BackdropKit</span></div>
</div>

<script>window.BK = ${data}</script>
<script>${js}</script>`

const TITLE = 'BackdropKit'
const DESC = 'Animated pixel-art themes for the Claude Code desktop app, free and open source.'
const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&family=Inter:opsz,wght@14..32,400..700&display=swap">'

const full =
  '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  '<title>' + TITLE + '</title>\n<meta name="description" content="' + DESC + '">\n' +
  '<meta property="og:title" content="BackdropKit"><meta property="og:description" content="' + DESC + '">\n' +
  FONTS + '\n<style>\n' + css + '</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n'
const fragment =
  '<title>' + TITLE + '</title>\n<meta name="description" content="' + DESC + '">\n' +
  '<meta name="claude:viewport-fit-sides" content="cover">\n' + FONTS + '\n<style>\n' + css + '</style>\n' + body + '\n'

fs.writeFileSync(path.join(DIST, 'index.html'), full)
fs.writeFileSync(path.join(DIST, 'artifact.html'), fragment)
fs.writeFileSync(path.join(DIST, '.nojekyll'), '')
const zips = out.filter(t => t.zip).length
console.log('docs: ' + out.length + ' themes, ' + zips + ' archives, index.html ' + full.length + ' chars')
