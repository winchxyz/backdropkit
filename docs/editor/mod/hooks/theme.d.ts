// The theme in theme.js, which engine/pack.mjs writes for each BackdropKit theme.

export type Moment = {
  /** The moment's id, as in its scene's file name: '' for a theme that is the same all day. */
  id: string
  /** Its English name, such as 'Sunset'. */
  name: string
  /** The local hour it starts at, from 0 to under 24 (a fraction is minutes); it lasts until the next one starts. */
  start: number
  /** Dark panels with pale words (true), or light panels with dark words (false). */
  dark: boolean
  /** The colour of the frosted glass over the scene, #rrggbb. */
  tint: string
  /** How opaque that glass is, from 0 to 1. */
  opacity: number
  /** What the scene shows, for a screen reader. */
  alt: string
  /** The scene: one animated SVG document, as the app plays it. */
  svg: string
}

export type Theme = {
  /** The plugin's name, its scene's name and the stem of its commands. */
  slug: string
  /** The theme's name, such as 'Harbor'. */
  name: string
  /** At least one moment, in the order of the day: by start hour. */
  moments: readonly [Moment, ...Moment[]]
}

export declare const THEME: Theme
