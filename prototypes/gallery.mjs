// node gallery.mjs <out.html> : the prototype scenes on one page, lettered A-M, each
// playing the way the desktop app plays a backdrop (an <img> of the SVG, its own CSS motion),
// with a switch between the moments of the ones that follow the time of day.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCENES = [
  { slug: 'harbor', name: 'Harbor', ru: 'Гавань', line: 'Рыбацкая гавань с пирса: лодки, блики, чайки, маяк.', moments: [['day', 'День'], ['sunset', 'Закат'], ['night', 'Ночь']] },
  { slug: 'snowfall-ridge', name: 'Snowfall Ridge', ru: 'Снежный хребет', line: 'Горы, ельник и хижина; снег в три слоя, дым из трубы.', moments: [['morning', 'Утро'], ['day', 'День'], ['night', 'Ночь']] },
  { slug: 'deep-reef', name: 'Deep Reef', ru: 'Риф', line: 'Под водой: лучи сверху, водоросли, рыбы, пузыри. Без времени суток.', moments: [['', 'Весь день']] },
  { slug: 'rainy-studio', name: 'Rainy Studio', ru: 'Дождливая мастерская', line: 'Стол у окна: капли по стеклу, город, лампа, пар над кружкой.', moments: [['day', 'День'], ['evening', 'Вечер'], ['night', 'Ночь']] },
  { slug: 'low-orbit', name: 'Low Orbit', ru: 'Орбита', line: 'Край Земли с орбиты, спутник; граница дня и ночи идёт по часам.', moments: [['a', 'Перед рассветом'], ['b', 'Утро']] },
  { slug: 'tide-line', name: 'Tide Line', ru: 'Линия прибоя', line: 'Низкий взгляд с пляжа: волны, пена, мокрый песок блестит.', moments: [['sunrise', 'Восход'], ['sunset', 'Закат'], ['night', 'Ночь']] },
  { slug: 'mirror-lake', name: 'Mirror Lake', ru: 'Зеркальное озеро', line: 'Горное озеро: пики отражаются в воде, лодка у берега.', moments: [['day', 'День'], ['sunset', 'Закат'], ['night', 'Ночь']] },
  { slug: 'lavender-slope', name: 'Lavender Slope', ru: 'Лавандовый склон', line: 'Ряды лаванды уходят к горам, туман в долине.', moments: [['sunset', 'Закат'], ['day', 'День'], ['night', 'Ночь']] },
  { slug: 'cloud-sea', name: 'Cloud Sea', ru: 'Море облаков', line: 'Скала над морем облаков, облака плывут внизу.', moments: [['sunset', 'Закат'], ['day', 'День'], ['night', 'Ночь']] },
  { slug: 'hill-village', name: 'Hill Village', ru: 'Городок на холме', line: 'Дома террасами на склоне, мост, дым из труб.', moments: [['sunrise', 'Восход'], ['day', 'День'], ['night', 'Ночь']] },
  { slug: 'sunbeam-wood', name: 'Sunbeam Wood', ru: 'Лес в лучах', line: 'Лесная тропа, лучи сквозь кроны, пылинки в свете.', moments: [['morning', 'Утро'], ['day', 'День'], ['night', 'Ночь']] },
  { slug: 'side-street', name: 'Side Street', ru: 'Переулок', line: 'Улочка к морю: переезд, поезд, провода, кот на стене.', moments: [['day', 'День'], ['evening', 'Вечер'], ['night', 'Ночь']] },
  { slug: 'moon-keep', name: 'Moon Keep', ru: 'Лунный замок', line: 'Замок на скале под луной, мост с фонарями. Только ночь.', moments: [['', 'Ночь']] },
]

const out = process.argv[2]
if (!out) throw new Error('usage: node gallery.mjs <out.html> (ONLY=slug,slug for a subset; letters stay fixed)')
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null
const LEAD = process.env.LEAD || 'Прототипы на движке Sunfield: каждая сцена играет так же, как фон в приложении.'
// While the hairline fix runs: FIXED=slug,slug are finished and shown from out/; every other
// scene is shown from out/pre-seam/ when that exists, so a half-done build never reaches the page.
// START=slug opens the page on that scene.
const FIXED = process.env.FIXED ? process.env.FIXED.split(',') : []
const START = process.env.START || ''
const data = []
for (const [i, s] of SCENES.entries()) {
  if (ONLY && !ONLY.includes(s.slug)) continue
  const fixed = FIXED.includes(s.slug)
  const moments = []
  let thumb = ''
  for (const [id, label] of s.moments) {
    const name = s.slug + (id ? '-' + id : '') + '.svg'
    const before = path.join(HERE, s.slug, 'out', 'pre-seam', name)
    const file = !fixed && fs.existsSync(before) ? before : path.join(HERE, s.slug, 'out', name)
    if (!fs.existsSync(file)) {
      console.warn('missing', file)
      continue
    }
    const svg = fs.readFileSync(file, 'utf8')
    moments.push({ label, src: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'), size: svg.length })
    // The strip holds still (the first moment, motion paused) so only the big stage plays.
    if (!thumb) {
      const still = svg.replace('</style>', '*{animation-play-state:paused!important}</style>')
      thumb = 'data:image/svg+xml;base64,' + Buffer.from(still).toString('base64')
    }
  }
  data.push({ slug: s.slug, letter: String.fromCharCode(65 + i), name: s.name, ru: s.ru, line: s.line, fixed, moments, thumb })
}

const html = `<title>BackdropKit Line-up</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<style>
/* Layout: one big stage, the scenes below it as a lettered strip. One dark look: backdrops read best on a dim room. */
:root {
  --bg: #0e1015;
  --panel: #161921;
  --line: #262a35;
  --fg: #eceef3;
  --muted: #9aa1b2;
  --pick: #f2c14e;
  --ok: #7fd49b;
  --text: -apple-system, "SF Pro Text", Inter, system-ui, sans-serif;
  --mono: ui-monospace, "SF Mono", "Geist Mono", Menlo, monospace;
  color-scheme: dark;
}
* { box-sizing: border-box }
body { background: var(--bg); color: var(--fg); font: 15px/1.5 var(--text); padding-block: 20px 40px;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)) }
main { max-width: 1280px; margin: 0 auto; display: grid; gap: 18px }
header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px 24px }
h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -.01em; text-wrap: balance }
header p { margin: 0; color: var(--muted); max-width: 62ch }
.stage { position: relative; aspect-ratio: 16 / 9; max-width: 100%; border-radius: 10px; overflow: hidden; background: #000; border: 1px solid var(--line) }
.stage img { position: absolute; inset: 0; width: 100%; height: 100%; display: block }
.about { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px }
.about h2 { margin: 0; font-size: 18px; font-weight: 600 }
.about h2 .letter { font-family: var(--mono); color: var(--pick); margin-right: 10px }
.about p { margin: 2px 0 0; color: var(--muted); min-width: 0 }
.moments { display: flex; flex-wrap: wrap; gap: 6px }
.moments button { font: 500 13px var(--text); color: var(--fg); background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 6px 14px; cursor: pointer }
.moments button[aria-pressed="true"] { background: var(--fg); color: var(--bg); border-color: var(--fg) }
.strip { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px }
@media (max-width: 900px) { .strip { grid-template-columns: repeat(3, minmax(0, 1fr)) } }
@media (max-width: 480px) { .strip { grid-template-columns: repeat(2, minmax(0, 1fr)) } }
.card { display: grid; gap: 6px; padding: 0; background: none; border: 0; color: inherit; text-align: left; cursor: pointer; font: inherit }
.card .thumb { position: relative; aspect-ratio: 16 / 10; border-radius: 8px; overflow: hidden; border: 2px solid transparent; background: #000 }
.card .thumb img { position: absolute; inset: 0; width: 100%; height: 100%; display: block }
.card[aria-current="true"] .thumb { border-color: var(--pick) }
.card span { font-size: 13px; color: var(--muted) }
.card b { font-family: var(--mono); color: var(--fg); margin-right: 6px; font-weight: 500 }
.card em, #fixed { font-style: normal; color: var(--ok) }
button:focus-visible { outline: 2px solid var(--pick); outline-offset: 2px }
footer { color: var(--muted); font-size: 13px }
</style>
<main>
  <header>
    <h1>Сцены BackdropKit</h1>
    <p>${LEAD}</p>
  </header>
  <div class="stage"><img id="big" alt=""></div>
  <section class="about">
    <div style="min-width:0"><h2 id="title"></h2><p id="line"></p><p id="fixed"></p></div>
    <div class="moments" id="moments" role="group" aria-label="Время суток"></div>
  </section>
  <nav class="strip" id="strip" aria-label="Сцены"></nav>
  <footer>Стрелки влево и вправо листают сцены.</footer>
</main>
<script>
const SCENES = ${JSON.stringify(data)};
let pick = Math.max(0, SCENES.findIndex(s => s.slug === ${JSON.stringify(START)})), moment = 0;
const $ = id => document.getElementById(id);
function show() {
  const s = SCENES[pick];
  const m = s.moments[Math.min(moment, s.moments.length - 1)];
  $('big').src = m ? m.src : '';
  $('big').alt = s.name + ', ' + (m ? m.label : '');
  $('title').innerHTML = '<span class="letter">' + s.letter + '</span>' + s.ru + ' · ' + s.name;
  $('line').textContent = s.line;
  $('fixed').textContent = s.fixed ? 'Исправлена: без тонких линий при любом размере окна.' : 'Пока прежняя версия, исправление ещё идёт.';
  $('fixed').style.color = s.fixed ? '' : 'var(--muted)';
  $('moments').innerHTML = '';
  s.moments.forEach((mm, i) => {
    const b = document.createElement('button');
    b.textContent = mm.label;
    b.setAttribute('aria-pressed', String(i === Math.min(moment, s.moments.length - 1)));
    b.onclick = () => { moment = i; show(); };
    $('moments').appendChild(b);
  });
  document.querySelectorAll('.card').forEach((c, i) => c.setAttribute('aria-current', String(i === pick)));
}
SCENES.forEach((s, i) => {
  const c = document.createElement('button');
  c.className = 'card';
  c.innerHTML = '<div class="thumb"><img alt=""></div><span><b>' + s.letter + '</b>' + s.ru + (s.fixed ? ' <em>✓</em>' : '') + '</span>';
  if (s.thumb) c.querySelector('img').src = s.thumb;
  c.onclick = () => { pick = i; moment = 0; show(); };
  $('strip').appendChild(c);
});
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') { pick = (pick + 1) % SCENES.length; moment = 0; show(); }
  if (e.key === 'ArrowLeft') { pick = (pick + SCENES.length - 1) % SCENES.length; moment = 0; show(); }
});
show();
</script>
`
fs.writeFileSync(out, html)
console.log(out, html.length, 'chars;', data.map(d => d.letter + ':' + d.moments.length).join(' '))
