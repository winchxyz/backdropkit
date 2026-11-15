// node engine/check-packs.mjs <outDir> <scratchDir>
//
// Checks every archive engine/pack.mjs wrote to <outDir> (the ones packs.json lists). Each is
// unpacked into <scratchDir>/<slug>/ (emptied first) and its mod checked there:
//   1. the archive holds only what the README and the site's install prompt say it holds;
//   2. claude plugin validate <slug>/mod, and of <slug>/ (the marketplace beside it);
//   3. a type-check: tsc -p <scratchDir>/<slug>.tsconfig.json, the tsconfig from the header of
//      the Claude Code build's claude-code.d.ts, kept outside the mod folder, its include
//      naming that file and the mod's hooks;
//   4. claude plugin test <slug>/mod, which runs mod/hooks/register.test.tsx.
// Nothing is installed and no marketplace is added. Each command's whole output is kept in
// <scratchDir>/<slug>.log. Exits with 1 when any check fails.
//
// Environment: CLAUDE_BIN, a Claude Code of 2.1.325 or later (else the newest one the desktop
// app keeps, else claude on the PATH); CLAUDE_TYPES, that build's claude-code.d.ts (else the
// one its plugin-authoring skill wrote under the temp folder); TSC, typescript's bin/tsc.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { unzip } from '../app/tools/zip.mjs'

const [outArg, scratchArg] = process.argv.slice(2)
if (!outArg || !scratchArg) {
  console.error('usage: node engine/check-packs.mjs <outDir> <scratchDir>')
  process.exit(2)
}
const OUT = path.resolve(outArg)
const SCRATCH = path.resolve(scratchArg)

const versionOf = s => (/(\d+)\.(\d+)\.(\d+)/.exec(s) ?? []).slice(1).map(Number)
const newer = (a, b) => {
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts })
  return { status: r.status ?? (r.error ? -1 : 0), out: (r.stdout ?? '') + (r.stderr ?? '') + (r.error ? String(r.error) : '') }
}

function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN
  const root = process.env.APPDATA && path.join(process.env.APPDATA, 'Claude', 'claude-code')
  let best
  if (root && fs.existsSync(root)) {
    for (const v of fs.readdirSync(root)) {
      const dir = path.join(root, v)
      if (!fs.statSync(dir).isDirectory()) continue
      for (const h of fs.readdirSync(dir)) {
        const exe = path.join(dir, h, 'claude.exe')
        if (fs.existsSync(exe) && (!best || newer(versionOf(v), versionOf(best.v)))) best = { v, exe }
      }
    }
  }
  return best ? best.exe : 'claude'
}

function findTypes(version) {
  if (process.env.CLAUDE_TYPES) return process.env.CLAUDE_TYPES
  const root = path.join(os.tmpdir(), 'claude', 'bundled-skills', version)
  if (!fs.existsSync(root)) return undefined
  for (const h of fs.readdirSync(root)) {
    const f = path.join(root, h, 'plugin-authoring', 'types', 'claude-code.d.ts')
    if (fs.existsSync(f)) return f
  }
  return undefined
}

function findTsc() {
  const list = [process.env.TSC, path.resolve('node_modules', 'typescript', 'bin', 'tsc')]
  return list.find(f => f && fs.existsSync(f))
}

const CLAUDE = findClaude()
const claudeVersion = run(CLAUDE, ['--version']).out.trim()
const v = versionOf(claudeVersion)
if (newer([2, 1, 325], v)) {
  console.error(`Claude Code ${claudeVersion} is older than 2.1.325, which claude plugin test needs; set CLAUDE_BIN`)
  process.exit(2)
}
const TYPES = findTypes(v.join('.'))
const TSC = findTsc()
if (!TYPES) console.error('no claude-code.d.ts found for ' + v.join('.') + '; set CLAUDE_TYPES (the type-check is skipped)')
if (!TSC) console.error('no TypeScript found; set TSC (the type-check is skipped)')
const tscVersion = TSC ? run(process.execPath, [TSC, '--version']).out.trim() : '-'
console.log('claude: ' + claudeVersion + '  typescript: ' + tscVersion)

// The tsconfig the types file's header gives for a hooks module.
const COMPILER = {
  target: 'es2023',
  lib: ['es2023'],
  types: [],
  module: 'esnext',
  moduleResolution: 'bundler',
  strict: true,
  noUncheckedIndexedAccess: true,
  noEmit: true,
  skipLibCheck: true,
  jsx: 'react',
  jsxFactory: 'h',
  jsxFragmentFactory: 'Fragment',
}

// What an archive may hold, as the README and the site's install prompt list it.
const allowed = name =>
  ['.claude-plugin/marketplace.json', 'mod/.claude-plugin/plugin.json', 'README.md', 'preview.png', 'project.json'].includes(name) ||
  /^mod\/hooks\/[A-Za-z0-9._-]+$/.test(name)

const packs = JSON.parse(fs.readFileSync(path.join(OUT, 'packs.json'), 'utf8'))
fs.mkdirSync(SCRATCH, { recursive: true })
let failed = 0
const rows = []
for (const [slug, p] of Object.entries(packs)) {
  const dir = path.join(SCRATCH, slug)
  const mod = path.join(dir, 'mod')
  const log = []
  const row = { slug, contents: 'ok', validate: '-', market: '-', tsc: '-', test: '-' }
  fs.rmSync(dir, { recursive: true, force: true })
  const buf = fs.readFileSync(path.join(OUT, p.zip))
  if (buf.length !== p.bytes) row.contents = 'size differs from packs.json'
  const entries = unzip(buf)
  for (const e of entries) {
    if (!allowed(e.name) || e.name.split('/').includes('..')) {
      row.contents = 'unexpected entry ' + e.name
      continue
    }
    const file = path.join(dir, ...e.name.split('/'))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, e.data)
  }
  log.push('== contents\n' + entries.map(e => e.name + ' ' + e.data.length).join('\n'))

  const val = run(CLAUDE, ['plugin', 'validate', mod], { cwd: SCRATCH })
  log.push('== claude plugin validate ' + mod + ' (exit ' + val.status + ')\n' + val.out)
  row.validate = val.status === 0 && /Validation passed/.test(val.out) ? (/with warnings/.test(val.out) ? 'pass (warnings)' : 'pass') : 'FAIL'
  // Each of the three commands must read as one the module answers itself, never as a gate.
  const own = ['off', 'on', 'time'].filter(c => val.out.includes('answers its own command: command.run{command=' + slug + '-' + c + '}'))
  if (row.validate !== 'FAIL' && (own.length !== 3 || /gating hook/.test(val.out))) row.validate = 'FAIL (commands not read as its own)'

  const mkt = run(CLAUDE, ['plugin', 'validate', dir], { cwd: SCRATCH })
  log.push('== claude plugin validate ' + dir + ' (exit ' + mkt.status + ')\n' + mkt.out)
  row.market = mkt.status === 0 && /Validation passed/.test(mkt.out) ? (/with warnings/.test(mkt.out) ? 'pass (warnings)' : 'pass') : 'FAIL'

  if (TYPES && TSC) {
    const config = path.join(SCRATCH, slug + '.tsconfig.json')
    fs.writeFileSync(config, JSON.stringify({ compilerOptions: COMPILER, include: [TYPES.split(path.sep).join('/'), slug + '/mod/hooks'] }, null, 2) + '\n')
    const tsc = run(process.execPath, [TSC, '-p', config], { cwd: SCRATCH })
    log.push('== tsc -p ' + config + ' (exit ' + tsc.status + ')\n' + tsc.out)
    row.tsc = tsc.status === 0 ? 'pass' : 'FAIL'
  }

  const test = run(CLAUDE, ['plugin', 'test', mod], { cwd: SCRATCH })
  log.push('== claude plugin test ' + mod + ' (exit ' + test.status + ')\n' + test.out)
  const passN = /(\d+) pass/.exec(test.out)?.[1] ?? '?'
  const failN = /(\d+) fail/.exec(test.out)?.[1] ?? '?'
  row.test = test.status === 0 && failN === '0' ? passN + ' pass' : 'FAIL (' + passN + ' pass, ' + failN + ' fail)'

  fs.writeFileSync(path.join(SCRATCH, slug + '.log'), log.join('\n\n') + '\n')
  if (row.contents !== 'ok' || [row.validate, row.market, row.tsc, row.test].some(s => s.startsWith('FAIL'))) failed++
  rows.push(row)
  console.log(
    '  ' + slug.padEnd(15) + ' contents ' + row.contents + ' | validate mod ' + row.validate + ' | validate marketplace ' + row.market + ' | tsc ' + row.tsc + ' | test ' + row.test,
  )
}
console.log(rows.length + ' archives checked, ' + failed + ' failed. Logs: ' + SCRATCH)
process.exit(failed ? 1 : 0)
