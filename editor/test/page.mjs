// A Chromium page (playwright-core) that serves the repository at http://kit.test/, so the
// exporter's browser helpers (editor/lib/browser.js) run as the editor runs them:
//   const page = await open()
//   await page.evaluate(async () => { const B = await import('/editor/lib/browser.js'); ... })
// Nothing is fetched from the network; every request outside kit.test is refused.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const ORIGIN = 'http://kit.test'
const PW = process.env.PLAYWRIGHT_CORE ?? import.meta.resolve('playwright-core')
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.html': 'text/html' }

let browser
export async function open() {
  if (!browser) {
    const { chromium } = await import(PW.startsWith('file:') ? PW : pathToFileURL(PW).href)
    const dir = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
    let executablePath
    if (fs.existsSync(dir)) {
      const build = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().pop()
      const exe = build && path.join(dir, build, 'chrome-win64', 'chrome.exe')
      if (exe && fs.existsSync(exe)) executablePath = exe
    }
    browser = await chromium.launch(executablePath ? { executablePath } : {})
  }
  const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 })
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== ORIGIN) return route.abort()
    if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"></body>' })
    const file = path.join(KIT, ...decodeURIComponent(url.pathname).split('/').filter(Boolean))
    if (!file.startsWith(KIT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: 'not found' })
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) })
  })
  await page.goto(ORIGIN + '/')
  return page
}

export async function close() {
  if (browser) await browser.close()
  browser = undefined
}
