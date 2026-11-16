// Finds the Claude desktop app's own backdrop player code in its HTTP cache, for player.mjs.
//
// This is sunfield/tools/app-code.mjs and the code-finding part of player-check.mjs, taught the
// shape the app's web code took on 2026-11-15. Until then one script held all of it: the
// element and attribute list with the parser that returns { markup, isMoving }, the flash
// detector, and the frame-time limit (1e3/60/3 over 3e3 ms). Since then the list, the parser,
// the player loop and the limit (written out as 5.555555555555556 over 3e3 ms) sit in a module
// of their own, and the flash detector's counter stays in the backdrop script, which imports
// its colour ramp from that module. Both shapes are read.
//
// findPlayer() -> { rules, parser, element, attr, css, flash, counter, limitMs, windowMs,
//                   url, made, shape } or throws when the code is not found.
// `rules` and `flash` are scripts to run in a page: `rules` defines the list and the parser in
// the page's global scope; `flash` is an expression for the counter factory.
//
// Environment: CLAUDE_CACHE, the app's Cache_Data folder (default %APPDATA%/Claude/Cache/Cache_Data).
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const CACHE = process.env.CLAUDE_CACHE ?? path.join(process.env.APPDATA ?? '', 'Claude', 'Cache', 'Cache_Data')
const BLOCK = { 1: 36, 2: 256, 3: 1024, 4: 4096 }

// Every cached app script: [{ url, name, made, code }].
export function cachedScripts() {
  const files = {}
  const file = n => (files[n] ??= fs.readFileSync(path.join(CACHE, n)))
  // A cache address: bit 31 set when in use, bits 28-30 the file type (0 = its own f_ file),
  // then for block files the data_N selector in bits 16-23 and the first block in bits 0-15.
  const body = (addr, size) => {
    if (!(addr & 0x80000000) || size <= 0) return null
    const type = (addr >>> 28) & 7
    try {
      if (type === 0) return file('f_' + (addr & 0x0fffffff).toString(16).padStart(6, '0')).subarray(0, size)
      const at = 8192 + (addr & 0xffff) * BLOCK[type]
      return file('data_' + ((addr >>> 16) & 0xff)).subarray(at, at + size)
    } catch {
      return null
    }
  }
  // Bodies are stored as sent: plain, brotli, gzip or zstd.
  const text = b => {
    for (const f of [x => x, zlib.brotliDecompressSync, zlib.gunzipSync, zlib.zstdDecompressSync]) {
      try {
        const s = f(b).toString('utf8')
        if (/^[\s\S]{0,200}(import|var|function|export|let|const|\(|!)/.test(s) && !s.slice(0, 64).includes('\u0000')) return s
      } catch {}
    }
    return null
  }
  // Each entry is a 256-byte record in data_1: creation time at 24, key length at 32, the
  // body's size at 44 and address at 60, the key (the URL) from 96.
  const entries = file('data_1')
  const out = []
  for (let at = 8192; at + 256 <= entries.length; at += 256) {
    const keyLen = entries.readInt32LE(at + 32)
    if (keyLen <= 0 || keyLen > 160 || entries.readUInt32LE(at + 36) !== 0) continue
    const key = entries.subarray(at + 96, at + 96 + keyLen).toString('latin1')
    if (!key.includes('/assets/') || !key.endsWith('.js')) continue
    const made = Number(entries.readBigUInt64LE(at + 24) / 1000n) - 11644473600000
    const b = body(entries.readUInt32LE(at + 60), entries.readInt32LE(at + 44))
    const code = b && text(b)
    if (!code) continue
    const url = key.split(' ').pop().replace(/^1\/0\//, '')
    out.push({ url, name: url.split('/').pop(), made, code })
  }
  return out
}

// The piece of source from the `var` that declares the first match of `from` up to the start
// of the first `function` after `to` (player-check's slice).
function slice(code, from, to) {
  const a = code.indexOf(from)
  const b = a < 0 ? -1 : code.indexOf(to, a)
  const start = a < 0 ? -1 : code.lastIndexOf('var ', a)
  const end = b < 0 ? -1 : code.indexOf('function ', b + to.length)
  return start < 0 || end < 0 ? null : code.slice(start, end)
}

/* ---------- A small scanner for minified modules ---------- */

// Top-level declarations of a module: { fns: Map(name -> source), vars: Map(name -> 'name=...'),
// imports: Map(alias -> { from, name }), exports: Map(exported -> local) }. It tracks strings,
// template literals, regular expressions (by the character before the slash) and braces.
function scan(code) {
  const fns = new Map()
  const vars = new Map()
  const imports = new Map()
  const exports = new Map()
  for (const m of code.matchAll(/import\{([^}]*)\}from"([^"]+)"/g)) {
    for (const part of m[1].split(',')) {
      const [a, b] = part.split(' as ')
      imports.set((b ?? a).trim(), { from: m[2].split('/').pop(), name: a.trim() })
    }
  }
  for (const m of code.matchAll(/export\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const [a, b] = part.split(' as ')
      exports.set((b ?? a).trim(), a.trim())
    }
  }
  // Top-level declarations: [start, end) of each function and var/let/const statement.
  let depth = 0
  let parens = 0
  let i = 0
  const n = code.length
  const stack = [] // template nesting: depth at which a ${ opened
  let prev = ';' // last significant character, for telling a regex from a division
  const decls = []
  let open = null // { start, kind, body } of the declaration being read
  const word = /[A-Za-z0-9_$]/
  while (i < n) {
    const ch = code[i]
    if (ch === '"' || ch === "'") {
      i++
      while (i < n && code[i] !== ch) i += code[i] === '\\' ? 2 : 1
      i++
      prev = 'a'
      continue
    }
    if (ch === '`') {
      i++
      for (;;) {
        if (i >= n) break
        if (code[i] === '\\') i += 2
        else if (code[i] === '`') {
          i++
          break
        } else if (code[i] === '$' && code[i + 1] === '{') {
          stack.push(depth)
          depth++
          i += 2
          break
        } else i++
      }
      prev = 'a'
      continue
    }
    if (ch === '/' && code[i + 1] === '/') {
      while (i < n && code[i] !== '\n') i++
      continue
    }
    if (ch === '/' && code[i + 1] === '*') {
      i = code.indexOf('*/', i + 2) + 2
      continue
    }
    if (ch === '/' && !(word.test(prev) || prev === ')' || prev === ']')) {
      // A regular expression.
      i++
      let cls = false
      while (i < n) {
        const c = code[i]
        if (c === '\\') i += 2
        else if (cls) {
          if (c === ']') cls = false
          i++
        } else if (c === '[') {
          cls = true
          i++
        } else if (c === '/') {
          i++
          break
        } else i++
      }
      while (i < n && word.test(code[i])) i++
      prev = 'a'
      continue
    }
    if (ch === '(') parens++
    else if (ch === ')') parens--
    else if (ch === ';' && open && open.kind === 'var' && depth === 0 && parens === 0) {
      decls.push([open.start, i, 'var'])
      open = null
    }
    if (ch === '{') {
      if (open && open.kind === 'fn' && depth === 0 && parens === 0) open.body = true
      depth++
    } else if (ch === '}') {
      depth--
      if (open && open.kind === 'fn' && open.body && depth === 0 && parens === 0) {
        decls.push([open.start, i + 1, 'fn'])
        open = null
      }
      if (stack.length && stack[stack.length - 1] === depth) {
        // Back into a template literal.
        stack.pop()
        i++
        for (;;) {
          if (i >= n) break
          if (code[i] === '\\') i += 2
          else if (code[i] === '`') {
            i++
            break
          } else if (code[i] === '$' && code[i + 1] === '{') {
            stack.push(depth)
            depth++
            i += 2
            break
          } else i++
        }
        prev = 'a'
        continue
      }
    }
    if (depth === 0 && parens === 0 && !open && (i === 0 || !word.test(code[i - 1]))) {
      if (code.startsWith('function ', i) || code.startsWith('async function ', i)) open = { start: i, kind: 'fn', body: false }
      else if (code.startsWith('var ', i) || code.startsWith('let ', i) || code.startsWith('const ', i)) open = { start: i, kind: 'var' }
    }
    if (!/\s/.test(ch)) {
      // Keywords before a slash start an expression (return /re/).
      if (word.test(ch)) {
        let j = i
        while (j < n && word.test(code[j])) j++
        const w = code.slice(i, j)
        prev = ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw'].includes(w) ? '(' : 'a'
        // Re-check this word for statement starts, then skip it.
        i = j
        continue
      }
      prev = ch
    }
    i++
  }
  if (open && open.kind === 'var') decls.push([open.start, n, 'var'])
  for (const [s, e, kind] of decls) {
    const text = code.slice(s, e)
    if (kind === 'fn') {
      const m = /^(?:async )?function ([\w$]+)\(/.exec(text)
      if (m) fns.set(m[1], text)
      continue
    }
    const m = /^(?:var|let|const) /.exec(text)
    // Split the declarators at depth-0 commas.
    const body = text.slice(m[0].length)
    let d = 0
    let q = null
    let last = 0
    const parts = []
    for (let k = 0; k < body.length; k++) {
      const c = body[k]
      if (q) {
        if (c === '\\') k++
        else if (c === q) q = null
        continue
      }
      if (c === '"' || c === "'" || c === '`') q = c
      else if ('([{'.includes(c)) d++
      else if (')]}'.includes(c)) d--
      else if (c === ',' && d === 0) {
        parts.push(body.slice(last, k))
        last = k + 1
      }
    }
    parts.push(body.slice(last))
    for (const p of parts) {
      const mm = /^\s*([A-Za-z_$][\w$]*)\s*=/.exec(p)
      if (mm) vars.set(mm[1], p.trim())
    }
  }
  return { fns, vars, imports, exports }
}

// The source needed to run `root` from module `mod`: its declaration and every top-level one it
// uses (names of two characters or more, which minified top-level names are; one-letter names
// are locals), across imports. Returns a script that defines them in one function scope per
// module and evaluates to `root`.
function extract(modules, modName, root) {
  const scanned = new Map()
  const scanOf = name => {
    if (!scanned.has(name)) {
      const m = modules.get(name)
      if (!m) throw new Error('module not cached: ' + name)
      scanned.set(name, scan(m.code))
    }
    return scanned.get(name)
  }
  const need = new Map() // module -> Set(local names)
  const imported = new Map() // module -> Map(alias -> { from, local })
  const visit = (mod, name, viaImport) => {
    const s = scanOf(mod)
    if (!need.has(mod)) need.set(mod, new Set())
    const set = need.get(mod)
    if (set.has(name)) return
    const src = s.fns.get(name) ?? s.vars.get(name)
    if (src === undefined) {
      const imp = s.imports.get(name)
      if (!imp) {
        if (viaImport) throw new Error('not found: ' + name + ' in ' + mod)
        return // a global
      }
      const local = scanOf(imp.from).exports.get(imp.name)
      if (!local) throw new Error('not exported: ' + imp.name + ' from ' + imp.from)
      if (!imported.has(mod)) imported.set(mod, new Map())
      imported.get(mod).set(name, { from: imp.from, local })
      visit(imp.from, local, true)
      return
    }
    set.add(name)
    const ids = new Set(src.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""').match(/(?<![\w$.])[A-Za-z_$][\w$]+/g) ?? [])
    for (const id of ids) if (id !== name && (s.fns.has(id) || s.vars.has(id) || s.imports.has(id))) visit(mod, id, false)
  }
  visit(modName, root, true)
  // Modules in dependency order: imported ones first.
  const order = []
  const place = mod => {
    if (order.includes(mod)) return
    for (const { from } of imported.get(mod)?.values() ?? []) place(from)
    order.push(mod)
  }
  place(modName)
  let script = '(()=>{const M={};'
  for (const mod of order) {
    const s = scanOf(mod)
    const names = [...need.get(mod)]
    const fnsSrc = names.filter(x => s.fns.has(x)).map(x => s.fns.get(x)).join(';')
    const varSrc = names.filter(x => s.vars.has(x)).map(x => s.vars.get(x))
    const imps = [...(imported.get(mod)?.entries() ?? [])].map(([alias, { from, local }]) => 'var ' + alias + '=M[' + JSON.stringify(from) + '].' + local + ';').join('')
    script += 'M[' + JSON.stringify(mod) + ']=(()=>{' + imps + fnsSrc + ';' + (varSrc.length ? 'var ' + varSrc.join(',') + ';' : '') + 'return{' + names.join(',') + '}})();'
  }
  return script + 'return M[' + JSON.stringify(modName) + '].' + root + '})()'
}

export function findPlayer() {
  const scripts = cachedScripts()
  const modules = new Map()
  for (const s of scripts.sort((a, b) => a.made - b.made)) modules.set(s.name, s)
  // The backdrop script: the newest with the backdrop's data attributes.
  const backdrop = scripts.filter(s => s.code.includes('data-software-compositing') && s.code.includes('data-engine-backdrop')).sort((a, b) => b.made - a.made)[0]
  if (!backdrop) throw new Error('no cached backdrop code: open the Claude desktop app once and try again')
  const PARSER = /function (\w+)\(e\)\{let t;try\{t=new DOMParser\(\)\.parseFromString\(e,"image\/svg\+xml"\)/
  // The list and the parser: in the backdrop script (to 2026-11-14) or a module it imports.
  let rulesMod = PARSER.test(backdrop.code) ? backdrop : null
  if (!rulesMod) {
    for (const m of backdrop.code.matchAll(/from"\.\/([^"]+)"/g)) {
      const cand = modules.get(m[1])
      if (cand && PARSER.test(cand.code) && cand.code.includes('isMoving:')) rulesMod = cand
    }
  }
  if (!rulesMod) throw new Error("the app's player code has changed shape: no parser found")
  const rules = slice(rulesMod.code, '"http://www.w3.org/1999/xlink"', 'isMoving:')
  const parser = PARSER.exec(rules ?? '')?.[1]
  const element = /function (\w+)\(e\)\{return!\(e\.namespaceURI===/.exec(rules ?? '')?.[1]
  const attr = /function (\w+)\(e,t\)\{let\{namespaceURI:n,localName:r,value:i\}=t;/.exec(rules ?? '')?.[1]
  const css = /function (\w+)\(e\)\{if\(e\.includes\("\\\\"\)/.exec(rules ?? '')?.[1]
  if (!rules || !parser || !element || !attr || !css) throw new Error("the app's player code has changed shape: the list")
  // The flash detector's counter factory.
  let flash
  let counter
  let shape
  const oldSlice = slice(backdrop.code, 'Uint8ClampedArray.from({length:1024}', 'return{count:')
  const oldCounter = oldSlice && /function (\w+)\(\)\{let e=\[\],t=new Uint8Array\(\w+\),n=new Int32Array\(\d+\);return\{count:/.exec(oldSlice)?.[1]
  if (oldCounter) {
    flash = '(()=>{' + oldSlice + ';return ' + oldCounter + '})()'
    counter = oldCounter
    shape = 'one script (to 2026-11-14)'
  } else {
    const m = /function (\w+)\(e=-1\/0\)\{let t=\[\],n=new Uint8Array\(\w+\),r=new Int32Array\(\d+\);return\{count:/.exec(backdrop.code)
    if (!m) throw new Error("the app's player code has changed shape: no flash detector")
    counter = m[1]
    flash = extract(modules, backdrop.name, counter)
    shape = 'player module ' + rulesMod.name + ' (2026-11-15 on)'
  }
  // The time limit and the window it averages over.
  let limitMs
  let windowMs
  for (const c of [rulesMod.code, backdrop.code]) {
    const a = /=1e3\/60\/(\d+),\w+=(\d+)e3,/.exec(c)
    if (a) {
      limitMs = 1000 / 60 / Number(a[1])
      windowMs = Number(a[2]) * 1000
      break
    }
    const b = /\w-\w<(\d+)e3\)return!1;let (\w)=\w\/\w;return [^}]*?\2>([\d.]+)\}/.exec(c)
    if (b) {
      limitMs = Number(b[3])
      windowMs = Number(b[1]) * 1000
      break
    }
  }
  if (!limitMs) throw new Error("the app's player code has changed shape: no frame-time limit")
  return { rules, parser, element, attr, css, flash, counter, limitMs, windowMs, url: backdrop.url, made: backdrop.made, shape }
}
