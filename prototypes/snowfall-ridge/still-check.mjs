// node still-check.mjs <scene.svg> : (copied from sunfield/tools/app-check.mjs) draws the scene the way the desktop app draws an
// interactive Svg backdrop, and saves out/app-check.png.
// The steps are copied from the app's bundle: the root gets the app's font and colour
// unless it names its own, the source is refused past 131072 characters, DOMPurify
// scrubs it, and the result goes into a sandboxed iframe's srcdoc under a strict CSP.
// It needs DOMPurify (any 2.x or 3.x purify.min.js) and playwright-core with a Chromium build.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const svgPath = process.argv[2] ?? path.join(ROOT, 'out', 'scene.svg')
const PURIFY = process.env.PURIFY ?? 'node_modules/dompurify/dist/purify.min.js'
const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')

const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
const exe = path.join(process.env.LOCALAPPDATA, 'ms-playwright')
const build = fs.readdirSync(exe).filter(d => d.startsWith('chromium-')).sort().pop()
const browser = await chromium.launch({ executablePath: path.join(exe, build, 'chrome-win64', 'chrome.exe') })
const page = await browser.newPage({ viewport: { width: 1536, height: 960 } })
await page.setContent('<!doctype html><body style="margin:0;background:#888"></body>')
await page.addScriptTag({ content: fs.readFileSync(PURIFY, 'utf8') })

if (process.env.REDUCE === '1') await page.emulateMedia({ reducedMotion: 'reduce' })
const raw = fs.readFileSync(svgPath, 'utf8')
// STILL=1: what the app's live web code (2026-11-14) does to every scene that is not on its
// motion allowlist, and to every scene when it thinks it draws without the GPU or reduced
// motion is on: SMIL and non-SVG elements go, and the CSSOM drops each animation and
// transition property and every rule but style, media, supports, container, layer and scope.
const still = process.env.STILL === '1'
const result = await page.evaluate(([source, still]) => {
  if (still) {
    const SMIL = new Set(['animate', 'animatecolor', 'animatemotion', 'animatetransform', 'discard', 'mpath', 'set'])
    const KEEP = new Set(['CSSContainerRule', 'CSSLayerBlockRule', 'CSSMediaRule', 'CSSNestedDeclarations', 'CSSScopeRule', 'CSSStyleRule', 'CSSSupportsRule'])
    const MOTION = /^(?:-[a-z]+-)?(?:animation|transition)(?:-|$)/
    const strip = st => { for (const p of Array.from(st)) if (MOTION.test(p.toLowerCase())) st.removeProperty(p) }
    const walk = sheet => {
      for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
        const r = sheet.cssRules[i]
        if (!KEEP.has(r.constructor.name)) sheet.deleteRule(i)
        else {
          if ('style' in r) strip(r.style)
          if ('cssRules' in r) walk(r)
        }
      }
    }
    const css = t => {
      const s = new CSSStyleSheet()
      s.replaceSync(t)
      walk(s)
      return Array.from(s.cssRules, r => r.cssText).join('')
    }
    const root = new DOMParser().parseFromString(source, 'text/html').body.firstElementChild
    for (const e of [root, ...root.querySelectorAll('*')]) {
      if (!(e instanceof SVGElement) || SMIL.has(e.localName.toLowerCase())) { e.remove(); continue }
      if (e.localName === 'style') e.textContent = css(e.textContent ?? '')
      if (e.hasAttribute('style')) { strip(e.style); if (e.style.length === 0) e.removeAttribute('style') }
    }
    source = root.outerHTML
  }
  // The app's own font stack, as a long stand-in for what it injects.
  const ink = { font: '"Anthropic Sans", "Anthropic Sans Fallback", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', color: 'rgb(12, 33, 64)' }
  const esc = s => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
  const head = source.slice(0, source.indexOf('>') + 1).replaceAll(/"[^"]*"|'[^']*'/g, '""')
  const add = (/\sfont-family\s*=/i.test(head) ? '' : ` font-family="${esc(ink.font)}"`) + (/\scolor\s*=/i.test(head) ? '' : ` color="${esc(ink.color)}"`)
  const at = source.indexOf('>')
  const inked = source.slice(0, at) + add + source.slice(at)
  if (inked.length > 131072) return { ok: false, why: 'over 131072 after the app adds font and colour: ' + inked.length, length: inked.length }
  const P = window.DOMPurify
  P.addHook('uponSanitizeAttribute', (node, data) => {
    const n = data.attrName
    const v = data.attrValue
    const keep = n.startsWith('on') ? false : n === 'href' || n === 'xlink:href' ? v.trim().startsWith('#') : true
    if (!keep) data.keepAttr = false
  })
  const frag = P.sanitize(inked, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['animate', 'set', 'use'],
    ADD_ATTR: ['from', 'to', 'calcMode'],
    FORBID_TAGS: ['script', 'foreignObject', 'image', 'a', 'iframe'],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORCE_BODY: true,
    RETURN_DOM_FRAGMENT: true,
  })
  const kids = Array.from(frag.childNodes).filter(n => n.nodeType !== 3 || n.textContent.trim())
  const r = kids[0]
  if (kids.length !== 1 || r.localName !== 'svg') return { ok: false, why: 'no svg root after the scrub', length: inked.length }
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src data:; script-src 'none'; form-action 'none'"
  const css = ':root{color-scheme:light dark}html,body{margin:0;height:100%;background:transparent;overflow:hidden}body>svg{display:block;width:100%;height:100%}'
  const doc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${css}</style>` + r.outerHTML
  const f = document.createElement('iframe')
  f.setAttribute('sandbox', '')
  f.setAttribute('srcdoc', doc)
  f.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0'
  document.body.appendChild(f)
  return { ok: true, length: inked.length, scrubbed: r.outerHTML.length, styleKept: r.outerHTML.includes('<style>'), groups: (r.outerHTML.match(/<g /g) || []).length }
}, [raw, still])

await page.waitForTimeout(1500)
const a = await page.screenshot({ path: path.join(ROOT, 'out', 'still-' + path.basename(svgPath, '.svg') + (process.env.STILL === '1' ? '' : '-live') + (process.env.REDUCE === '1' ? '-reduce' : '') + '.png') })
await page.waitForTimeout(2000)
const b = await page.screenshot()
// How many pixels changed in two seconds: zero means nothing moves.
const changed = await page.evaluate(async ([a, b]) => {
  const load = async src => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + src
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    return g.getImageData(0, 0, c.width, c.height).data
  }
  const [p, q] = [await load(a), await load(b)]
  let n = 0
  for (let i = 0; i < p.length; i += 4) if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2]) n++
  return n
}, [a.toString('base64'), b.toString('base64')])
await browser.close()
console.log(JSON.stringify({ ...result, pixelsChangedIn2s: changed }))
