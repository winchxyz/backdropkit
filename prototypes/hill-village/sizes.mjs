// node sizes.mjs [moment] : where the characters of out/hill-village-<moment>.svg go.
import fs from 'node:fs'

const m = process.argv[2] ?? 'sunrise'
const s = fs.readFileSync(new URL('./out/hill-village-' + m + '.svg', import.meta.url), 'utf8')
const defs = s.match(/<defs>([\s\S]*?)<\/defs>/)[1]
const css = s.match(/<style>([\s\S]*?)<\/style>/)[1]
const pats = [...defs.matchAll(/<pattern id='(\w+)'[^>]*>([\s\S]*?)<\/pattern>/g)]
const grads = [...defs.matchAll(/<(radialGradient|linearGradient|clipPath)[\s\S]*?<\/\1>/g)]
const body = s.slice(s.indexOf('</defs>'))
console.log('total', s.length, 'css', css.length, 'keyframes', [...css.matchAll(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g)].reduce((n, x) => n + x[0].length, 0))
console.log('patterns', pats.reduce((n, p) => n + p[0].length, 0), 'gradients+clips', grads.reduce((n, g) => n + g[0].length, 0), 'body', body.length)
// the body's moving groups by class
const byClass = new Map()
for (const g of body.matchAll(/<g class='(\w+)/g)) byClass.set(g[1], (byClass.get(g[1]) ?? 0) + 1)
console.log('groups', [...byClass].map(([k, n]) => k + ':' + n).join(' '))
// size of each top-level pattern reference and big raw chunks
const big = [...body.matchAll(/<g class='(md|ry|sm|cd \w+)'[^>]*>([\s\S]*?)<\/g>/g)].map(x => x[1] + ':' + x[0].length)
console.log('moving', big.join(' '))
console.log('pattern sizes', pats.map(p => p[1] + ':' + p[0].length).join(' '))
const rays = [...body.matchAll(/<g fill='url\(#RY\)'>[\s\S]*?<\/g><\/g>/g)].map(x => x[0].length)
console.log('ray blocks', rays.join(' '))
