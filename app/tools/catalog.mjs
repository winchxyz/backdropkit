// The themes BackdropKit shows, in order, with the words for each. The files are found by
// tools/data.mjs: Sunfield's moments are drawn from its own code, the prototypes' moments are
// whatever <slug>-<moment>.svg (or <slug>.svg) files exist in prototypes/<slug>/out/ when it runs.

export const THEMES = [
  {
    slug: 'sunfield',
    name: 'Sunfield',
    line: 'Sunflowers under a sky that follows the sun.',
    about:
      'An animated pixel-art sky over a sunflower field. Stars and a moon at night, the sun rising behind the long cloud bank and setting behind the small cloud. The flowers lean in the wind, torn petals tumble away, and a flock crosses about once a minute.',
    ready: true,
  },
  {
    slug: 'harbor',
    name: 'Harbor',
    line: 'A fishing harbour seen from the pier.',
    about: 'Boats at their moorings, light glinting on the water, gulls overhead and a lighthouse on the point.',
  },
  {
    slug: 'snowfall-ridge',
    name: 'Snowfall Ridge',
    line: 'Mountains, spruce and a cabin under snow.',
    about: 'A ridge above a spruce forest and a small cabin. Snow falls in three layers and smoke rises from the chimney.',
  },
  {
    slug: 'rainy-studio',
    name: 'Rainy Studio',
    line: 'A desk by a rainy window.',
    about: 'Drops run down the glass over a soft city. A desk lamp, a few books and steam rising from a mug.',
  },
  {
    slug: 'low-orbit',
    name: 'Low Orbit',
    line: 'The edge of the Earth, seen from orbit.',
    about: 'A satellite drifts past the curve of the Earth. The line between day and night moves with the clock, and cities glow on the night side.',
  },
  {
    slug: 'tide-line',
    name: 'Tide Line',
    line: 'A low view from the beach.',
    about: 'Waves roll in and leave foam on shining wet sand.',
  },
  {
    slug: 'cloud-sea',
    name: 'Cloud Sea',
    line: 'A cliff top above a sea of clouds.',
    about: 'Rock spires rise through the clouds below a grassy cliff edge and a lone pine.',
  },
  {
    slug: 'mirror-lake',
    name: 'Mirror Lake',
    line: 'A still mountain lake that mirrors the sky.',
    about: 'A wide valley and a lake so calm it holds the whole scene again; the clouds drift in the water as they drift above.',
  },
  {
    slug: 'lavender-slope',
    name: 'Lavender Slope',
    line: 'Lavender rows rolling down to a valley.',
    about: 'A lavender field running down a slope into a valley under jagged snow peaks.',
  },
  {
    slug: 'hill-village',
    name: 'Hill Village',
    line: 'A village on a forested hillside.',
    about: 'Houses spill down a wooded hill into a valley, and the sun comes up at its far end.',
  },
  {
    slug: 'sunbeam-wood',
    name: 'Sunbeam Wood',
    line: 'Shafts of light in an old forest.',
    about: 'Huge mossy trunks frame a glade. Light slants through the canopy onto grass, a stream, a fallen log and ferns.',
  },
  {
    slug: 'side-street',
    name: 'Side Street',
    line: 'A steep lane in a quiet seaside town.',
    about: 'A residential lane running down to a level crossing, with the roofs of the lower town and the bay beyond.',
  },
  {
    slug: 'deep-reef',
    name: 'Deep Reef',
    line: 'Under the water, light falling from above.',
    about: 'Rays from the surface, swaying weed, fish and rising bubbles. The same at every hour.',
  },
  {
    slug: 'moon-keep',
    name: 'Moon Keep',
    line: 'A castle of spires under a full moon.',
    about: 'Gothic spires on a crag in a cold blue night. The same at every hour.',
  },
]

// Moment ids as they appear in file names, in the order of the day, with their English names.
// A theme can rename its own (Low Orbit's a and b are not words).
export const MOMENT_ORDER = ['a', 'predawn', 'dawn', 'sunrise', 'morning', 'b', 'day', 'golden', 'sunset', 'dusk', 'evening', 'twilight', 'night']
export const MOMENT_NAMES = {
  predawn: 'Before dawn',
  dawn: 'Dawn',
  sunrise: 'Sunrise',
  morning: 'Morning',
  day: 'Day',
  golden: 'Golden hour',
  sunset: 'Sunset',
  dusk: 'Dusk',
  evening: 'Evening',
  twilight: 'Twilight',
  night: 'Night',
}
export const MOMENT_OVERRIDES = {
  'low-orbit': { a: 'Before dawn', b: 'Morning' },
}
// Which moment a card shows first: the brightest one the theme has.
export const HERO_ORDER = ['day', 'morning', 'b', 'sunrise', 'sunset', 'golden', 'evening', 'dawn', 'a', 'dusk', 'twilight', 'night']

// Sunfield's preview moments, by the names day.js gives them in MOMENTS.
export const SUNFIELD_MOMENTS = ['night', 'sunrise', 'day', 'sunset']

export const REPO = 'https://github.com/winchxyz/backdropkit'
export const REPO_API = 'https://api.github.com/repos/winchxyz/backdropkit'
