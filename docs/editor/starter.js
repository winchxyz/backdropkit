// The blank scene: a starter made of generators (sky, sun and moon, stars, clouds, far
// mountains, middle hills, a row of pines on near ground), with day, sunset and night.
import { blankDoc, newLayer, motionDefaults } from './project.js'
import { genDefaults, runGen } from './gen.js'

export function addGenLayer(doc, kind, patch = {}, name) {
  const l = newLayer(doc, kind, name)
  l.gen = { ...genDefaults(kind, doc), ...patch }
  doc.layers = [...doc.layers, l]
  runGen(doc, l, { force: true })
  return doc.layers.find(x => x.id === l.id)
}

export function starterDoc() {
  const doc = blankDoc()
  doc.name = 'Quiet Valley'
  doc.slug = 'quiet-valley'
  doc.line = 'Mountains and pines under a sky that follows the sun.'
  addGenLayer(doc, 'sky', { style: 'clear', bands: 9, horizon: 150, dither: 1 })
  const stars = addGenLayer(doc, 'stars', { amount: 5, big: 7, bottom: 120, seed: 4242 })
  stars.show = { day: false, sunset: false }
  stars.motion = motionDefaults('twinkle')
  addGenLayer(doc, 'sun', { body: 'auto', size: 8, glow: 2, pos: { day: { x: 92, up: 104 }, sunset: { x: 238, up: 22 }, night: { x: 246, up: 112 } } })
  const clouds = addGenLayer(doc, 'clouds', { amount: 3, size: 1, style: 'puffy', shade: 'white', top: 20, bottom: 78, seed: 1607 })
  clouds.motion = { type: 'drift', period: 300, dir: 1 }
  addGenLayer(doc, 'ridge', { style: 'mountains', base: 158, height: 74, rough: 55, distance: 2, color: '#7488a8', snow: true, seed: 311 }, 'Far mountains')
  addGenLayer(doc, 'ridge', { style: 'hills', base: 176, height: 30, rough: 30, distance: 1, color: '#62905a', snow: false, seed: 977 }, 'Hills')
  addGenLayer(doc, 'trees', { style: 'pines', base: 184, height: 28, density: 6, distance: 0, color: '#3c6a40', ground: true, seed: 5150 }, 'Pines')
  return doc
}
