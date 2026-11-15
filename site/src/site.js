// BackdropKit landing: a Claude Code chat with winch-ai, over the theme it is showing.
// window.BK holds the data the build wrote: { THEMES, REPO, EDITOR } (EDITOR is the editor's
// address, or null while there is none). Each theme is
// { slug, name, line, about, hero, thumb, zip: { file, name, bytes } | null,
//   moments: [{ id, name, file, tone, bytes }] }.
;(() => {
  const { THEMES, REPO, EDITOR } = window.BK
  const $ = id => document.getElementById(id)
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const root = document.documentElement

  /* ---------- Which moment plays at a minute of the day ---------- */
  // Each moment has the hour it starts (the schedule the theme's mod follows); it plays until
  // the next one starts, and the last one runs on past midnight.
  const minuteNow = (d = new Date()) => d.getHours() * 60 + d.getMinutes()
  function momentAt(t, min) {
    if (t.moments.length === 1) return 0
    let best = -1
    t.moments.forEach((m, i) => {
      if (m.start * 60 <= min && (best < 0 || m.start > t.moments[best].start)) best = i
    })
    if (best >= 0) return best
    let last = 0
    t.moments.forEach((m, i) => {
      if (m.start > t.moments[last].start) last = i
    })
    return last
  }
  // The stretches of the day, for drawing: [{ i, from, to }] in minutes, midnight to midnight.
  function stretches(t) {
    if (t.moments.length === 1) return [{ i: 0, from: 0, to: 1440 }]
    const order = t.moments.map((m, i) => ({ i, at: Math.round(m.start * 60) })).sort((a, b) => a.at - b.at)
    const out = []
    if (order[0].at > 0) out.push({ i: order.at(-1).i, from: 0, to: order[0].at })
    order.forEach((o, k) => out.push({ i: o.i, from: o.at, to: k + 1 < order.length ? order[k + 1].at : 1440 }))
    return out.filter(s => s.to > s.from)
  }
  const hhmm = min => String(Math.floor(min / 60) % 24).padStart(2, '0') + ':' + String(Math.round(min % 60)).padStart(2, '0')

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
  let preview = null // a minute the visitor dragged or played to; null follows the clock
  let moment = momentAt(THEMES[0], minuteNow())

  function apply() {
    const t = THEMES[pick]
    const min = preview ?? minuteNow()
    moment = momentAt(t, min)
    const m = t.moments[moment]
    showScene(m.file)
    root.dataset.tone = m.tone
    $('now').textContent = t.name + (t.moments.length > 1 ? ' · ' + m.name : '') + (preview === null ? '' : ' · ' + hhmm(min))
    $('full-now').textContent = t.name + (t.moments.length > 1 ? ' · ' + m.name : '') + ' · ' + hhmm(min)
    renderDay(min)
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
    track.querySelectorAll('.tcard').forEach((b, j) => b.setAttribute('aria-selected', String(j === i)))
    resetSteps()
    renderPicked()
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
    $('p-name').textContent = t.name
    $('p-about').textContent = t.about
    $('segs').innerHTML = stretches(t)
      .map(
        s =>
          '<span class="seg" data-i="' + s.i + '" style="left:' + (s.from / 14.4).toFixed(3) + '%;width:' + ((s.to - s.from) / 14.4).toFixed(3) + '%">' +
          esc(t.moments.length > 1 ? t.moments[s.i].name : 'The same all day') + '</span>',
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
  /* ---------- The day line ---------- */
  function renderDay(min) {
    const t = THEMES[pick]
    $('day-time').textContent = hhmm(min)
    $('day-name').textContent = t.moments.length > 1 ? t.moments[moment].name : 'The same at every hour'
    $('knob').style.left = (min / 14.4).toFixed(3) + '%'
    $('scrub').value = String(min)
    $('segs').querySelectorAll('.seg').forEach(s => s.classList.toggle('on', Number(s.dataset.i) === moment))
    $('live').setAttribute('aria-pressed', String(preview === null))
  }
  // Play the day: an hour a second, from where the line is, once round the clock.
  let playing = 0
  let played = 0
  function playLabel(on) {
    for (const id of ['play', 'full-play']) {
      $(id).textContent = on ? 'Pause' : 'Play the day'
      $(id).setAttribute('aria-pressed', String(on))
    }
  }
  function stop() {
    clearInterval(playing)
    playing = 0
    playLabel(false)
  }
  function togglePlay() {
    if (playing) return stop()
    if (preview === null) preview = minuteNow()
    played = 0
    playLabel(true)
    playing = setInterval(() => {
      preview = (preview + 5) % 1440
      played += 5
      apply()
      if (played >= 1440) stop()
    }, 1000 / 12)
  }
  $('play').addEventListener('click', togglePlay)
  $('full-play').addEventListener('click', togglePlay)
  $('scrub').addEventListener('input', e => {
    stop()
    preview = Number(e.target.value)
    apply()
  })
  $('live').addEventListener('click', () => {
    stop()
    preview = null
    apply()
  })

  /* ---------- Full screen: the scene alone ---------- */
  // The chat, bars and composer step aside (the page keeps its scroll), the browser goes full
  // screen where it may (a preview frame can refuse; the page still shows the scene alone), and a
  // small bar stays for the theme, the hour and the way out. It hides when the pointer rests.
  let idle = 0
  function wake() {
    if (!root.dataset.full) return
    root.dataset.full = 'on'
    clearTimeout(idle)
    idle = setTimeout(() => {
      if (root.dataset.full && !$('full-bar').matches(':hover, :focus-within')) root.dataset.full = 'idle'
    }, 2600)
  }
  function enterFull() {
    if (root.dataset.full) return
    root.dataset.full = 'on'
    $('full-bar').hidden = false
    wake()
    const el = document.documentElement
    if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
  }
  function leaveFull() {
    if (!root.dataset.full) return
    delete root.dataset.full
    $('full-bar').hidden = true
    clearTimeout(idle)
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }
  const stepTheme = d => {
    choose((pick + d + THEMES.length) % THEMES.length)
    wake()
  }
  $('full').addEventListener('click', enterFull)
  $('full-tb').addEventListener('click', enterFull)
  $('full-exit').addEventListener('click', leaveFull)
  $('full-prev').addEventListener('click', () => stepTheme(-1))
  $('full-next').addEventListener('click', () => stepTheme(1))
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) leaveFull()
  })
  for (const ev of ['pointermove', 'pointerdown', 'wheel']) document.addEventListener(ev, wake, { passive: true })
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key
    if (root.dataset.full) {
      if (k === 'Escape' || k === 'f' || k === 'F') {
        e.preventDefault()
        leaveFull()
      } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        e.preventDefault()
        stepTheme(k === 'ArrowLeft' ? -1 : 1)
      } else wake()
      return
    }
    if ((k === 'f' || k === 'F') && !e.target.closest('textarea, [contenteditable], input:not([type="range"])')) {
      e.preventDefault()
      enterFull()
    }
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
    if (preview === null) apply()
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
    // With the editor built next to the page, the box opens it: here, or in a new tab from a preview.
    if (EDITOR) {
      if (/^https?:/.test(EDITOR)) window.open(EDITOR, '_blank', 'noopener')
      else location.href = EDITOR
      return
    }
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
  renderPicked()
  tick()
  renderPrompt()
})()
