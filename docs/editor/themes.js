// The 14 site themes, as the start offers them. Scenes live next to the editor on the site:
// ../scenes/<slug>/<file>.svg, thumbs at ../thumbs/<slug>.jpg; the 13 packed themes' schedules
// are in ../themes/packs.json (read at run time, with these starts as the fallback).
export const SITE = '../'

const m = (id, name, start) => ({ id, name, start })
export const THEMES = [
  { slug: 'sunfield', name: 'Sunfield', line: 'Sunflowers under a sky that follows the sun.', moments: [m('sunrise', 'Sunrise', 5), m('day', 'Day', 8), m('sunset', 'Sunset', 19), m('night', 'Night', 21.5)] },
  { slug: 'harbor', name: 'Harbor', line: 'A fishing harbour seen from the pier.', moments: [m('day', 'Day', 6), m('sunset', 'Sunset', 17), m('night', 'Night', 21)] },
  { slug: 'snowfall-ridge', name: 'Snowfall Ridge', line: 'Mountains, spruce and a cabin under snow.', moments: [m('morning', 'Morning', 6), m('day', 'Day', 10), m('night', 'Night', 20)] },
  { slug: 'rainy-studio', name: 'Rainy Studio', line: 'A desk by a rainy window.', moments: [m('day', 'Day', 6), m('evening', 'Evening', 17), m('night', 'Night', 21)] },
  { slug: 'low-orbit', name: 'Low Orbit', line: 'The edge of the Earth, seen from orbit.', moments: [m('a', 'Before dawn', 0), m('b', 'Morning', 6)] },
  { slug: 'tide-line', name: 'Tide Line', line: 'A low view from the beach.', moments: [m('sunrise', 'Sunrise', 5), m('sunset', 'Sunset', 17), m('night', 'Night', 21)] },
  { slug: 'cloud-sea', name: 'Cloud Sea', line: 'A cliff top above a sea of clouds.', moments: [m('day', 'Day', 6), m('sunset', 'Sunset', 17), m('night', 'Night', 21)] },
  { slug: 'mirror-lake', name: 'Mirror Lake', line: 'A still mountain lake that mirrors the sky.', moments: [m('day', 'Day', 6), m('sunset', 'Sunset', 17), m('night', 'Night', 21)] },
  { slug: 'lavender-slope', name: 'Lavender Slope', line: 'Lavender rows rolling down to a valley.', moments: [m('day', 'Day', 6), m('sunset', 'Sunset', 17), m('night', 'Night', 21)] },
  { slug: 'hill-village', name: 'Hill Village', line: 'A village on a forested hillside.', moments: [m('sunrise', 'Sunrise', 5), m('day', 'Day', 8), m('night', 'Night', 20)] },
  { slug: 'sunbeam-wood', name: 'Sunbeam Wood', line: 'Shafts of light in an old forest.', moments: [m('morning', 'Morning', 6), m('day', 'Day', 10), m('night', 'Night', 20)] },
  { slug: 'side-street', name: 'Side Street', line: 'A steep lane in a quiet seaside town.', moments: [m('day', 'Day', 6), m('evening', 'Evening', 17), m('night', 'Night', 21)] },
  { slug: 'deep-reef', name: 'Deep Reef', line: 'Under the water, light falling from above.', moments: [m('', 'All day', 0)] },
  { slug: 'moon-keep', name: 'Moon Keep', line: 'A castle of spires under a full moon.', moments: [m('', 'All day', 0)] },
]

export const sceneUrl = (t, id) => SITE + 'scenes/' + t.slug + '/' + t.slug + (id ? '-' + id : '') + '.svg'
export const thumbUrl = t => SITE + 'thumbs/' + t.slug + '.jpg'

// The packed schedules, when the site has them.
let packs = null
export async function schedules() {
  if (packs) return packs
  try {
    const r = await fetch(SITE + 'themes/packs.json')
    packs = r.ok ? await r.json() : {}
  } catch {
    packs = {}
  }
  return packs
}
export async function momentsOf(t) {
  const p = (await schedules())[t.slug]
  return t.moments.map(x => {
    const s = p?.moments?.find(y => y.id === x.id)
    return { ...x, start: s ? s.start : x.start, name: s?.name || x.name }
  })
}
