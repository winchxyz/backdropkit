// Tests for register.tsx: claude plugin test mod. They read the theme from theme.js, so the
// same file tests every BackdropKit theme.
import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { THEME } from './theme.js'
import type { Moment } from './theme.js'

const SLUG = THEME.slug
const MOMENTS = THEME.moments
const BACKDROP = { plugin: SLUG, component: 'Backdrop', props: { plugin: SLUG, scene: SLUG, glass: false } } as const
const RESYNC_MS = 5 * 60 * 1000

// A slash command as the person types it.
const typed = (command: string, args: string) => ({ command, args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } })

// What the session start asks of the engine, answered as the engine would. Each theme set is
// kept, as JSON, in `sets`; each clear is counted in `clears`.
function engine(on: On, sets: string[] = [], clears: number[] = []) {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('theme.set', (_, e) => {
    sets.push(JSON.stringify(e))
    return { value: { isDrawn: true as const, requestId: 'theme' } }
  })
  on('theme.clear', () => {
    clears.push(1)
    return { value: { isDrawn: false as const, reason: 'cleared' } }
  })
  on('ui.status', () => ({ value: undefined }))
}

// A time on a fixed local date, `hour` hours after midnight.
const at = (hour: number) => new Date(2026, 10, 15, 0, 0, 0).getTime() + Math.round(hour * 3600) * 1000

// The hour halfway through moment `m`.
function middleOf(m: Moment): number {
  if (MOMENTS.length === 1) return 12
  const i = MOMENTS.indexOf(m)
  const next = (MOMENTS[i + 1] ?? MOMENTS[0]).start
  const span = (next - m.start + 24) % 24 || 24
  return (m.start + span / 2) % 24
}

const hhmm = (hour: number) => {
  const t = Math.round(hour * 60) % 1440
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0')
}

// What a set says of the glass and the mode, as in the JSON a set is kept as.
const glassOf = (m: Moment) => '"tint":"' + m.tint + '","opacity":' + m.opacity
const schemeOf = (m: Moment) => '"overrideColorScheme":"' + (m.dark ? 'dark' : 'light') + '"'

// The scene as drawn, with its motion clock (--m) put back to the file's 0s and a price board's
// digits taken out of its marker.
const MARKER = "<g id='bk-board'></g>"
const plainOf = (source: string) => source.replace(/--m:-?[\d.]+s/, '--m:0s').replace(/<g id='bk-board'>[\s\S]*?<\/g>/, MARKER)
// The digits a price board was drawn with ('' for none).
const boardOf = (source: string) => /<g id='bk-board'>([\s\S]*?)<\/g>/.exec(source)?.[1] ?? ''

// The moment whose scene the Backdrop draws, and the motion clock it was drawn with, in
// seconds.
async function drawnMoment(ui: { drawn: () => Promise<unknown> }) {
  const tree = (await ui.drawn()) as { type: string; props: { source: string; alt: string } }
  expect(tree.type).toBe('Svg')
  const { source, alt } = tree.props
  const clockMark = /--m:(-?[\d.]+)s/.exec(source)
  expect(clockMark).not.toBeNull()
  const moment = MOMENTS.find(m => m.svg === plainOf(source))
  expect(moment).toBeDefined()
  expect(source.length).toBeLessThanOrEqual(131072)
  // A theme with a board says its figures after the scene's own words.
  expect(alt.startsWith(moment?.alt ?? '')).toBe(true)
  return { id: moment?.id, alt, source, motion: Number(clockMark?.[1]) }
}

for (const m of MOMENTS) {
  test('at ' + hhmm(middleOf(m)) + ' the theme is set for ' + m.name, async ($, on) => {
    const sets: string[] = []
    const when = at(middleOf(m))
    mock.clock(on, { now: when })
    mock.store(on)
    engine(on, sets)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    expect(sets.length).toBe(1)
    expect(sets[0]).toContain(schemeOf(m))
    expect(sets[0]).toContain(glassOf(m))
    expect(sets[0]).toContain('"scene":"' + SLUG + '"')

    for (const surface of ['desktop', 'mobile'] as const) {
      const ui = await $.ui.mount({ ...BACKDROP, surface })
      const drawn = await drawnMoment(ui)
      expect(drawn.id).toBe(m.id)
      if (THEME.board === undefined) expect(drawn.alt).toBe(m.alt)
      // The motion clock counts seconds from 2026-01-01 UTC, a fifth of a second ahead.
      expect(Math.abs(drawn.motion + ((when - Date.UTC(2026, 0, 1)) / 1000 + 0.2))).toBeLessThan(1)
      await ui.unmount()
    }
  })
}

test('the moment follows the hour', async ($, on) => {
  const sets: string[] = []
  const first = MOMENTS[0]
  const second = MOMENTS[1]
  // Two minutes before the second moment starts (or noon, for a theme of one moment).
  const start = second === undefined ? 12 : second.start - 2 / 60
  const clock = mock.clock(on, { now: at(start) })
  mock.store(on)
  engine(on, sets)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  expect(sets.length).toBe(1)
  expect(sets[0]).toContain(glassOf(first))
  expect((await drawnMoment(ui)).id).toBe(first.id)

  await clock.advance(RESYNC_MS)
  if (second === undefined) {
    // One scene all day: nothing changes, hours later either.
    await clock.advance(6 * 3600 * 1000)
    expect(sets.length).toBe(1)
    expect((await drawnMoment(ui)).id).toBe(first.id)
  } else {
    expect(sets.length).toBe(2)
    expect(sets[1]).toContain(schemeOf(second))
    expect(sets[1]).toContain(glassOf(second))
    expect((await drawnMoment(ui)).id).toBe(second.id)
    // Within a moment the theme is not set again.
    await clock.advance(RESYNC_MS)
    expect(sets.length).toBe(2)
  }
  await ui.unmount()
})

test('/' + SLUG + '-off takes the theme off and /' + SLUG + '-on puts it back', async ($, on) => {
  const sets: string[] = []
  const clears: number[] = []
  const clock = mock.clock(on, { now: at(middleOf(MOMENTS[0])) })
  mock.store(on)
  engine(on, sets, clears)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(sets.length).toBe(1)

  const offSaid = await $.command.run(typed(SLUG + '-off', ''))
  expect(offSaid.text).toContain('is off, in new sessions too')
  expect(clears.length).toBe(1)
  // Off stays off: a day of the clock sets nothing.
  await clock.advance(24 * 3600 * 1000)
  expect(sets.length).toBe(1)

  const onSaid = await $.command.run(typed(SLUG + '-on', ''))
  expect(onSaid.text).toContain('is on')
  expect(sets.length).toBe(2)
})

test('a theme taken off stays off in a new session until /' + SLUG + '-on', async ($, on) => {
  const sets: string[] = []
  const m = MOMENTS[0]
  mock.clock(on, { now: at(middleOf(m)) })
  mock.store(on, { off: true })
  engine(on, sets)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(sets.length).toBe(0)

  await $.command.run(typed(SLUG + '-on', ''))
  expect(sets.length).toBe(1)
  expect(sets[0]).toContain(glassOf(m))
})

test('/' + SLUG + '-time previews a moment and a time, and goes back', async ($, on) => {
  const sets: string[] = []
  const first = MOMENTS[0]
  const last = MOMENTS[MOMENTS.length - 1] ?? first
  mock.clock(on, { now: at(middleOf(first)) })
  mock.store(on)
  engine(on, sets)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  expect(sets.length).toBe(1)

  const plain = await $.command.run(typed(SLUG + '-time', ''))
  if (MOMENTS.length === 1) {
    expect(plain.text).toContain('the same at every hour')
    const asked = await $.command.run(typed(SLUG + '-time', '18:30'))
    expect(asked.text).toContain('the same at every hour')
    expect(sets.length).toBe(1)
    expect((await drawnMoment(ui)).id).toBe(first.id)
    await ui.unmount()
    return
  }
  expect(plain.text).toContain('follows your clock')
  expect(sets.length).toBe(1)

  // By name: the last moment of the day.
  const key = last.name.toLowerCase().replace(/\s+/g, '-')
  const byName = await $.command.run(typed(SLUG + '-time', key))
  expect(byName.text).toContain('shows ' + last.name)
  expect(sets.length).toBe(2)
  expect(sets[1]).toContain(glassOf(last))
  expect((await drawnMoment(ui)).id).toBe(last.id)

  // By time: the middle of the first moment.
  const byTime = await $.command.run(typed(SLUG + '-time', hhmm(middleOf(first))))
  expect(byTime.text).toContain('shows ' + first.name)
  expect(sets.length).toBe(3)
  expect(sets[2]).toContain(glassOf(first))
  expect((await drawnMoment(ui)).id).toBe(first.id)

  // Back to the clock, after another preview.
  await $.command.run(typed(SLUG + '-time', key))
  expect(sets.length).toBe(4)
  const back = await $.command.run(typed(SLUG + '-time', 'now'))
  expect(back.text).toContain('follows your clock')
  expect(sets.length).toBe(5)
  expect(sets[4]).toContain(glassOf(first))
  expect((await drawnMoment(ui)).id).toBe(first.id)

  const wrong = await $.command.run(typed(SLUG + '-time', '25:00'))
  expect(wrong.text).toContain('No such moment or time')
  expect(sets.length).toBe(5)
  await ui.unmount()
})

// The engine's usage figures, as session.measure and $.session.usage() give them.
const reading = (percent: number, weekly?: number) => ({
  context: { window: 200000, tokens: percent * 2000, percent },
  rateLimits: [{ kind: 'five_hour', percentUsed: 90 }, ...(weekly === undefined ? [] : [{ kind: 'seven_day', percentUsed: weekly }])],
})
const turnEnd = (tokens: number, agentId?: string) => ({
  answer: '',
  durationMs: 1000,
  isAborted: false,
  turnId: 'turn-' + tokens,
  reason: 'answer' as const,
  ...(agentId === undefined ? {} : { agentId }),
  usage: { model: 'claude', input_tokens: 10, output_tokens: tokens - 1010, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
})

test(THEME.board === undefined ? 'usage figures leave the scene as it is' : 'the price board shows the chat\'s figures', async ($, on) => {
  const m = MOMENTS[0]
  mock.clock(on, { now: at(middleOf(m)) })
  mock.store(on, { 'tokens:chat-1': 1240000, 'tokens:other': 5 })
  engine(on)
  on('session.id', () => ({ value: 'chat-1' }))
  on('session.usage', () => ({ value: { startedAt: 0, ...reading(25) } }))
  on('session.measure', (_, e) => ({ changed: [...e.changed] }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })

  if (THEME.board === undefined) {
    await $.session.measure({ ...reading(62, 34), changed: ['context', 'rateLimits'] })
    await $.turn.complete(turnEnd(50000))
    const drawn = await drawnMoment(ui)
    expect(drawn.alt).toBe(m.alt)
    expect(boardOf(drawn.source)).toBe('')
    await ui.unmount()
    return
  }

  // The chat's count carries on from the store; no weekly reading yet.
  let drawn = await drawnMoment(ui)
  expect(drawn.alt).toContain('1.24M tokens, 25% context, --% of the weekly limit')
  expect(boardOf(drawn.source)).not.toBe('')
  const before = boardOf(drawn.source)

  await $.session.measure({ ...reading(62, 34), changed: ['context', 'rateLimits'] })
  drawn = await drawnMoment(ui)
  expect(drawn.alt).toContain('1.24M tokens, 62% context, 34% of the weekly limit')
  expect(boardOf(drawn.source)).not.toBe(before)

  // A turn of the main loop and one of a subagent both count.
  await $.turn.complete(turnEnd(30000))
  await $.turn.complete(turnEnd(20000, 'agent-1'))
  drawn = await drawnMoment(ui)
  expect(drawn.alt).toContain('1.29M tokens, 62% context, 34% of the weekly limit')

  // A reading without a weekly window keeps the last one.
  await $.session.measure({ ...reading(63), changed: ['context'] })
  drawn = await drawnMoment(ui)
  expect(drawn.alt).toContain('1.29M tokens, 63% context, 34% of the weekly limit')
  await ui.unmount()
})
