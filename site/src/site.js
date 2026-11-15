// BackdropKit landing: a Claude Code chat with winch-ai, over the theme it is showing.
// window.BK holds the data the build wrote: { THEMES, REPO }. Each theme is
// { slug, name, line, about, hero, thumb, zip: { file, name, bytes } | null,
//   moments: [{ id, name, file, tone, bytes }] }.
;(() => {
  const { THEMES, REPO } = window.BK
  const $ = id => document.getElementById(id)
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const root = document.documentElement

  /* ---------- Which moment the clock asks for ---------- */
  // For each stretch of the day, the moment ids to look for, best first.
  const PREFS = [
    [0, 4, ['night', 'a', 'twilight', 'evening', 'predawn']],
    [4, 6, ['predawn', 'dawn', 'sunrise', 'a', 'morning', 'b', 'day']],
    [6, 10, ['morning', 'sunrise', 'b', 'dawn', 'day']],
    [10, 17, ['day', 'b', 'morning', 'golden']],
    [17, 20, ['sunset', 'golden', 'evening', 'dusk', 'day']],
    [20, 24, ['night', 'evening', 'twilight', 'dusk', 'a']],
  ]
  function clockMoment(t, d = new Date()) {
    if (t.moments.length === 1) return 0
    const h = d.getHours() + d.getMinutes() / 60
    const row = PREFS.find(r => h >= r[0] && h < r[1]) || PREFS[0]
    for (const id of row[2]) {
      const i = t.moments.findIndex(m => m.id === id)
      if (i >= 0) return i
    }
    return t.hero
  }

  /* ---------- The scene behind the page ---------- */
  const layers = [$('s0'), $('s1')]
  let front = 0
  let seq = 0
  function showScene(file) {
    const cur = layers[front]
    if (cur.dataset.file === file) return
    const next = layers[1 - front]
    const tok = ++seq
    next.onload = () => {
      if (tok !== seq) return
      next.classList.add('on')
      cur.classList.remove('on')
      front = 1 - front
    }
    next.dataset.file = file
    next.src = file
  }

  /* ---------- State ---------- */
  let pick = 0
  let moment = clockMoment(THEMES[0])
  let chosen = false // the visitor picked a moment, so the clock no longer moves it

  function apply() {
    const t = THEMES[pick]
    const m = t.moments[moment]
    showScene(m.file)
    root.dataset.tone = m.tone
    $('now').textContent = t.name + (t.moments.length > 1 ? ' · ' + m.name : '')
    renderPicked()
  }

  /* ---------- The shelf ---------- */
  const track = $('track')
  track.innerHTML = THEMES.map(
    (t, i) =>
      '<button class="tcard" role="option" aria-selected="' + (i === pick) + '" data-i="' + i + '">' +
      '<div class="pic"><img src="' + esc(t.thumb) + '" alt="" loading="lazy" decoding="async"></div>' +
      '<span>' + esc(t.name) + '</span></button>',
  ).join('')
  track.addEventListener('click', e => {
    const b = e.target.closest('.tcard')
    if (!b) return
    choose(Number(b.dataset.i))
  })
  function choose(i) {
    if (i === pick) return
    pick = i
    moment = clockMoment(THEMES[i])
    chosen = false
    track.querySelectorAll('.tcard').forEach((b, j) => b.setAttribute('aria-selected', String(j === i)))
    resetSteps()
    apply()
    renderPrompt()
  }
  const step = () => Math.max(158, track.clientWidth * 0.8)
  $('prev').addEventListener('click', () => track.scrollBy({ left: -step(), behavior: reduced ? 'auto' : 'smooth' }))
  $('next').addEventListener('click', () => track.scrollBy({ left: step(), behavior: reduced ? 'auto' : 'smooth' }))

  /* ---------- The picked theme ---------- */
  const kb = n => (n / 1024 < 1000 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB')
  function renderPicked() {
    const t = THEMES[pick]
    const now = clockMoment(t)
    $('p-name').textContent = t.name
    $('p-about').textContent = t.about
    $('pills').innerHTML = t.moments
      .map(
        (m, i) =>
          '<button class="pill" aria-pressed="' + (i === moment) + '" data-m="' + i + '">' + esc(t.moments.length > 1 ? m.name : 'All day') +
          (i === now && t.moments.length > 1 ? '<span class="now">now</span>' : '') + '</button>',
      )
      .join('')
    const dl = $('dl')
    if (t.zip) {
      dl.hidden = false
      dl.href = t.zip.file
      dl.setAttribute('download', t.zip.name)
      $('dl-label').textContent = 'Download ' + t.zip.name
      $('dl-note').textContent = kb(t.zip.bytes) + (t.moments.length > 1 ? ' · follows your clock' : ' · the same at every hour')
    } else {
      dl.hidden = true
      $('dl-note').textContent = 'The archive comes with the first release.'
    }
  }
  $('pills').addEventListener('click', e => {
    const b = e.target.closest('.pill')
    if (!b) return
    moment = Number(b.dataset.m)
    chosen = true
    apply()
  })

  /* ---------- Install ---------- */
  function promptFor(t) {
    const S = t.slug
    return `Install the BackdropKit theme "${t.name}" for the Claude desktop app.

1. Find ${S}.zip (I just downloaded it, most likely into my Downloads folder).
2. Before installing, list what is inside. It should hold only: .claude-plugin/marketplace.json,
   mod/.claude-plugin/plugin.json, mod/hooks/ (the files listed in README.md), project.json, preview.png,
   README.md. If there is anything else, stop and tell me.
3. Read mod/hooks/register.tsx and tell me in two lines what it does.
4. Unpack it into ~/.claude/backdropkit/${S}, replacing an older copy if there is one.
   Keep this folder: the theme is read from it.
5. Run: claude plugin marketplace add "<that folder>"
   then: claude plugin install ${S}@backdropkit-${S} --scope user
6. If another theme plugin is enabled, ask me before turning it off.
7. Tell me to run /reload-plugins or start a new session to see the theme.`
  }
  function renderPrompt() {
    const t = THEMES[pick]
    $('prompt-text').textContent = promptFor(t)
    $('st-1').textContent = t.zip ? 'Download ' + t.zip.name : 'Download the archive'
  }
  function markStep(n) {
    const dot = $('dot-' + n)
    dot.className = 'dot done'
    dot.innerHTML = '<svg class="i" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg>'
  }
  function resetSteps() {
    for (const n of [1, 2]) {
      const dot = $('dot-' + n)
      dot.className = 'dot todo'
      dot.innerHTML = ''
    }
  }
  $('dl').addEventListener('click', () => markStep(1))
  let copyReset = 0
  $('copy').addEventListener('click', async () => {
    const text = promptFor(THEMES[pick])
    let ok = false
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      // The clipboard can be blocked inside a frame: fall back to a selection copy.
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        ok = document.execCommand('copy')
      } catch {
        ok = false
      }
      ta.remove()
    }
    const b = $('copy')
    if (ok) {
      markStep(2)
      b.textContent = 'Copied'
    } else {
      const r = document.createRange()
      r.selectNodeContents($('prompt-text'))
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(r)
      b.textContent = 'Press Ctrl+C'
    }
    clearTimeout(copyReset)
    copyReset = setTimeout(() => (b.textContent = 'Copy'), 2200)
  })

  /* ---------- Menu bar clock ---------- */
  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
  function tick() {
    const d = new Date()
    $('clock').textContent = dayFmt.format(d) + '  ' + timeFmt.format(d)
    if (!chosen) {
      const m = clockMoment(THEMES[pick], d)
      if (m !== moment) {
        moment = m
        apply()
      }
    }
  }
  setInterval(tick, 15000)

  /* ---------- Composer ---------- */
  const WANT = 'Build my own Claude Code theme'
  const typed = $('typed')
  if (reduced) typed.textContent = WANT
  else {
    let i = 0
    const type = () => {
      typed.textContent = WANT.slice(0, ++i)
      if (i < WANT.length) setTimeout(type, 70 + Math.random() * 60)
    }
    setTimeout(type, 1100)
  }
  let asked = false
  $('compose').addEventListener('click', () => {
    if (asked) {
      $('editor-reply').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
      return
    }
    asked = true
    typed.textContent = WANT
    const chat = $('chat')
    const user = document.createElement('div')
    user.className = 'msg user arrive'
    user.innerHTML = '<div>' + esc(WANT) + '</div>'
    const bot = document.createElement('div')
    bot.className = 'msg bot arrive'
    bot.id = 'editor-reply'
    bot.innerHTML =
      who() +
      '<p>The editor is not open yet: I am building it right now. You will stack layers, paint with pixel brushes, add motion, place the light and tie it all to the time of day, then export the same kind of archive these themes come in.</p>' +
      '<p>When it is ready, this box opens it. <a href="' + esc(REPO) + '" target="_blank" rel="noopener">Star BackdropKit on GitHub</a> to hear when it lands.</p>'
    const fine = $('fine')
    chat.insertBefore(user, fine)
    chat.insertBefore(bot, fine)
    bot.style.animationDelay = '0.5s'
    setTimeout(() => bot.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'end' }), 60)
  })
  function who() {
    return '<div class="who">' + $('mark-tpl').innerHTML + 'winch-ai</div>'
  }

  /* ---------- Start ---------- */
  tick()
  renderPrompt()
  apply()
})()
