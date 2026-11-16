// A BackdropKit theme: an animated pixel-art scene behind the conversation, with the app's
// colours and frosted glass to match. A theme has one scene for each part of the day (night,
// sunrise, day, sunset and so on), and the computer's clock picks it: each moment starts at a
// local hour and lasts until the next one starts. A theme with one scene plays it all day. The
// desktop and mobile apps draw it; the terminal keeps its own look.
//
// /<theme>-off takes it off (in new sessions too), /<theme>-on puts it back, and
// /<theme>-time previews another moment or time of day.
//
// This file is the same in every BackdropKit theme but for the theme's name in its three
// commands, written in where they are registered and answered so that claude plugin validate
// reads each as a command the module answers itself. What else differs is theme.js, written
// by the BackdropKit packer: the theme's name, its moments and their scenes.
import type { Register, ThemeSetArgs } from 'claude-code'

import { BLUR, COLORS, NIGHT_COLORS } from './colors.js'
import { makeColors } from './make-colors.js'
import { THEME } from './theme.js'
import type { Moment } from './theme.js'

// The scene's name, and the commands as the replies name them. Where the commands are
// registered and answered, below, the packer writes the theme's slug into their names.
const SCENE_ID = THEME.slug
const ON = THEME.slug + '-on'
const TIME = THEME.slug + '-time'

const LIGHT = makeColors(COLORS)
const DARK = makeColors(NIGHT_COLORS)

// The moments in the order of the day, as theme.js holds them.
const MOMENTS = THEME.moments
const LAST: Moment = MOMENTS[MOMENTS.length - 1] ?? MOMENTS[0]

// The hour of the day at `ms`, local time, with minutes and seconds as a fraction.
function hourOf(ms: number): number {
  const d = new Date(ms)
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
}

// The moment at `ms`: the last one started by that hour, or, before the first start, the one
// that began the evening before.
function momentAt(ms: number): Moment {
  const h = hourOf(ms)
  let at = LAST
  for (const m of MOMENTS) if (m.start <= h) at = m
  return at
}

// The hour the moment after `m` starts.
function endOf(m: Moment): number {
  const i = MOMENTS.indexOf(m)
  return (MOMENTS[i + 1] ?? MOMENTS[0]).start
}

// "HH:MM" for an hour of the day.
function clock(hour: number): string {
  const t = ((Math.round(hour * 60) % 1440) + 1440) % 1440
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0')
}

// What /<theme>-time takes for a moment: its name in lower case, with hyphens for spaces.
const keyOf = (m: Moment) => m.name.toLowerCase().replace(/\s+/g, '-')

// The whole theme for moment `m`: the colours of its kind (light or dark) and its glass.
function lookOf(m: Moment): ThemeSetArgs {
  return {
    colors: (m.dark ? DARK : LIGHT).theme,
    overrideColorScheme: m.dark ? 'dark' : 'light',
    backdrop: { scene: SCENE_ID, glass: { blur: BLUR, tint: m.tint, opacity: m.opacity } },
  }
}

// Every motion in a scene counts from its --m, the scene's motion clock, which the scene file
// holds as 0s. Writing in the seconds since a fixed moment makes a scene the app restarts (it
// does when the window is resized), or the next moment's scene, carry on where the motion was
// instead of starting over. A scene that would pass the app's size limit with the longer
// value is drawn as it is.
const MOTION_MARK = '--m:0s'
const MOTION_EPOCH = Date.UTC(2026, 0, 1)
const SCENE_LIMIT = 131072

// The scene as it should be drawn at `ms`. `lead` is how long the app takes to start the
// picture after this runs, in seconds.
function sceneAt(svg: string, ms: number, lead = 0.2): string {
  const at = svg.indexOf(MOTION_MARK)
  if (at < 0) return svg
  const m = Math.max(0, Math.round(((ms - MOTION_EPOCH) / 1000 + lead) * 20) / 20)
  const out = svg.slice(0, at) + '--m:' + (m === 0 ? '0' : '-' + m) + 's' + svg.slice(at + MOTION_MARK.length)
  return out.length <= SCENE_LIMIT ? out : svg
}

// How often the moment and the glass are checked against the clock, so a moment changes at
// most this long after its hour.
const RESYNC_MS = 5 * 60 * 1000

// The time: read from the engine's clock now and then and carried on in between, so drawing
// never waits. `shift` moves it for /<theme>-time.
let clockAt = Date.now()
let perfAt = performance.now()
let shift = 0
const now = () => clockAt + (performance.now() - perfAt) + shift

// Whether the person took the theme off, and the moment last set, so the theme is set again
// only when the moment changes.
let off = false
let shown: Moment | undefined

// The theme for this moment when it is not the one last set (always, with `force`), else
// undefined; it counts as set from here.
function changedLook(force = false): ThemeSetArgs | undefined {
  if (off) return undefined
  const m = momentAt(now())
  if (!force && m === shown) return undefined
  shown = m
  return lookOf(m)
}

// The day's moments in words: "Day from 06:00 to 17:00, Sunset from 17:00 to 21:00, ...".
function schedule(): string {
  return MOMENTS.map(m => m.name + ' from ' + clock(m.start) + ' to ' + clock(endOf(m))).join(', ')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: '__SLUG__-off', description: 'Take the ' + THEME.name + ' theme off' })
    await $.command.register({ name: '__SLUG__-on', description: 'Put the ' + THEME.name + ' theme back on' })
    await $.command.register({
      name: '__SLUG__-time',
      description:
        MOMENTS.length > 1
          ? 'Show when each ' + THEME.name + ' scene plays, or preview another moment or time'
          : 'Show when the ' + THEME.name + ' scene plays',
      argumentHint: MOMENTS.length > 1 ? '[' + MOMENTS.map(keyOf).join('|') + '|HH:MM|now]' : undefined,
    })
    try {
      clockAt = await $.clock.now()
      perfAt = performance.now()
    } catch {
      // Keep the time read when the module loaded.
    }
    try {
      off = (await $.store.get('off')) === true
    } catch {
      off = false
    }
    $.clock.every(RESYNC_MS, () => {
      $.clock
        .now()
        .then(ms => {
          clockAt = ms
          perfAt = performance.now()
        })
        .catch(() => undefined)
        .then(() => {
          const look = changedLook()
          return look === undefined ? undefined : $.theme.set(look)
        })
        .catch(() => undefined)
        .finally(() => $.ui.invalidate('ui.render'))
    })
    if (!off) {
      // The line that would stop Desktop painting the colours, if a change ever brings one.
      const unpainted = [...LIGHT.problems, ...DARK.problems].find(line => line.startsWith("Desktop won't paint"))
      if (unpainted !== undefined) $.ui.toast(unpainted)
      // No status line from the result: at start (and on a reload) the app is often not
      // attached yet, so the set reports "no attached desktop or mobile client" while the app
      // goes on to draw the theme once it attaches.
      const look = changedLook(true)
      if (look !== undefined) await $.theme.set(look)
    }
    $.ui.status(undefined)
    return next(e)
  })

  // The backdrop is the one Svg, alone: the desktop app plays a moving scene of that shape
  // itself, as a picture it redraws with the scene's own CSS motion, and keeps the still frame
  // for reduced motion and slow machines. It draws the moment last set, so the scene and the
  // glass over it always match.
  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if (e.props.plugin !== $.plugin.name || e.props.scene !== SCENE_ID) return next(e)
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)
    const { Svg } = $.ui.resolve(e)
    const m = shown ?? momentAt(now())
    return <Svg source={sceneAt(m.svg, now())} alt={m.alt} isInteractive />
  })

  // /<theme>-time: when each moment plays; with a moment or a time, the scene and the glass
  // jump there and run on from it until /<theme>-time now.
  on('command.run', { command: '__SLUG__-time' }, async ($, e) => {
    if (MOMENTS.length < 2) return { text: THEME.name + ' plays one scene all day, the same at every hour: there is no other moment to preview.' }
    const arg = e.args.trim().toLowerCase()
    const real = clockAt + (performance.now() - perfAt)
    const choices = MOMENTS.map(keyOf).join(', ')
    const note = off ? ' The theme is off: /' + ON + ' puts it back.' : ''
    if (arg === '' || arg === 'now') {
      if (shift !== 0) {
        shift = 0
        const look = changedLook()
        if (look !== undefined) await $.theme.set(look)
        $.ui.invalidate('ui.render')
      }
      return {
        text: THEME.name + ' follows your clock: ' + schedule() + '. To preview: /' + TIME + ' ' + choices + ', or a time like 18:30.' + note,
      }
    }
    let hour: number | undefined
    const key = arg.replace(/\s+/g, '-')
    const moment = MOMENTS.find(m => m.id === key || keyOf(m) === key)
    if (moment !== undefined) hour = moment.start
    const hm = /^(\d{1,2}):(\d{2})$/.exec(arg)
    if (hm !== null) {
      const h = Number(hm[1] ?? '')
      const m = Number(hm[2] ?? '')
      if (h < 24 && m < 60) hour = h + m / 60
    }
    if (hour === undefined) return { text: 'No such moment or time: "' + arg + '". Try ' + choices + ', a time like 18:30, or now.' }
    shift = (hour - hourOf(real)) * 3600 * 1000
    const look = changedLook()
    if (look !== undefined) await $.theme.set(look)
    $.ui.invalidate('ui.render')
    const at = momentAt(now())
    return {
      text:
        THEME.name + ' shows ' + at.name + ' at ' + clock(hour) + ' and runs on from there. /' + TIME + ' now goes back to your clock.' + note,
    }
  })

  on('command.run', { command: '__SLUG__-off' }, async $ => {
    let kept = true
    try {
      await $.store.set('off', true)
    } catch {
      kept = false
    }
    off = true
    shown = undefined
    await $.theme.clear()
    return {
      text: kept
        ? THEME.name + ' is off, in new sessions too. /' + ON + ' puts it back.'
        : THEME.name + ' is off in this session.',
    }
  })

  on('command.run', { command: '__SLUG__-on' }, async $ => {
    try {
      await $.store.delete('off')
    } catch {
      // Nothing stored: it was on already.
    }
    off = false
    const set = await $.theme.set(changedLook(true) ?? lookOf(momentAt(now())))
    return { text: set.isDrawn ? THEME.name + ' is on.' : THEME.name + ' is set, but nothing draws it here: ' + set.reason }
  })
}
