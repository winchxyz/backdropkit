// Interface pieces: popovers and menus, hover hints, the toast, the busy note.
import { $, h, icon } from './util.js'

/* ---------- Popovers ---------- */

let open = null
export function closePop() {
  if (!open) return
  const o = open
  open = null
  o.el.remove()
  o.anchor?.setAttribute?.('aria-expanded', 'false')
  o.anchor?.classList?.remove('open')
  o.onClose?.()
}
export const popOpen = () => open

// Show `content` (an element) next to `anchor` (an element or { x, y }). place: 'below' |
// 'above' | 'right' | 'left'. Closes on Escape, on a click outside, or on closePop().
export function popover(anchor, content, { place = 'below', cls = '', onClose, align = 'start' } = {}) {
  closePop()
  const el = h('div.pop' + (cls ? '.' + cls.split(' ').join('.') : ''), { role: 'dialog' }, content)
  document.body.append(el)
  open = { el, anchor: anchor instanceof Element ? anchor : null, onClose }
  if (anchor instanceof Element) {
    anchor.setAttribute('aria-expanded', 'true')
    anchor.classList.add('open')
  }
  position(el, anchor, place, align)
  const first = el.querySelector('input:not([type="range"]):not([type="color"]), textarea')
  if (first) setTimeout(() => first.focus({ preventScroll: true }), 0)
  return el
}
function position(el, anchor, place, align) {
  const r = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 }
  const vw = innerWidth
  const vh = innerHeight
  const w = el.offsetWidth
  const hh = el.offsetHeight
  let x
  let y
  if (place === 'below' || place === 'above') {
    x = align === 'end' ? r.right - w : align === 'center' ? r.left + r.width / 2 - w / 2 : r.left
    y = place === 'below' ? r.bottom + 6 : r.top - hh - 6
    if (place === 'below' && y + hh > vh - 8 && r.top - hh - 6 > 8) y = r.top - hh - 6
    if (place === 'above' && y < 8) y = r.bottom + 6
  } else {
    y = r.top
    x = place === 'right' ? r.right + 6 : r.left - w - 6
    if (place === 'right' && x + w > vw - 8) x = r.left - w - 6
    if (place === 'left' && x < 8) x = r.right + 6
  }
  el.style.left = Math.max(8, Math.min(vw - w - 8, x)) + 'px'
  el.style.top = Math.max(8, Math.min(vh - hh - 8, y)) + 'px'
}
document.addEventListener(
  'pointerdown',
  e => {
    if (!open) return
    if (open.el.contains(e.target)) return
    if (open.anchor && open.anchor.contains(e.target)) return
    closePop()
  },
  true,
)
addEventListener('resize', () => closePop())

// A menu of items: { label, key, run, disabled, icon, checked } | 'sep' | { head }.
export function menu(anchor, items, opts = {}) {
  const list = h('div.menu', { role: 'menu' })
  const buttons = []
  for (const it of items) {
    if (!it) continue
    if (it === 'sep') {
      list.append(h('div.msep'))
      continue
    }
    if (it.head) {
      list.append(h('div.mhead', null, it.head))
      continue
    }
    const b = h(
      'button.mi',
      {
        role: 'menuitem',
        disabled: !!it.disabled,
        on: {
          click: () => {
            closePop()
            it.run?.()
          },
        },
      },
      h('span.lab', null, it.icon ? icon(it.icon) : null, it.checked !== undefined ? (it.checked ? '✓ ' : '') : null, it.label),
      it.key ? h('kbd', null, it.key) : null,
    )
    buttons.push(b)
    list.append(b)
  }
  const el = popover(anchor, list, opts)
  el.addEventListener('keydown', e => {
    const live = buttons.filter(b => !b.disabled)
    const i = live.indexOf(document.activeElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      live[(i + 1) % live.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      live[(i - 1 + live.length) % live.length]?.focus()
    }
  })
  return el
}

/* ---------- Hover hints: one line, and the shortcut ---------- */

const hint = () => $('#hint')
let hintTimer = 0
let hintFor = null
function showHint(el) {
  const t = el.getAttribute('data-hint')
  if (!t) return
  const k = el.getAttribute('data-key')
  const box = hint()
  box.replaceChildren(...[h('span', null, t), k ? h('kbd', null, k) : null].filter(Boolean))
  box.hidden = false
  const r = el.getBoundingClientRect()
  const w = box.offsetWidth
  const hh = box.offsetHeight
  let x = r.left + r.width / 2 - w / 2
  let y = r.bottom + 7
  if (y + hh > innerHeight - 6) y = r.top - hh - 7
  box.style.left = Math.max(6, Math.min(innerWidth - w - 6, x)) + 'px'
  box.style.top = y + 'px'
}
export function hideHint() {
  clearTimeout(hintTimer)
  hintFor = null
  const b = hint()
  if (b) b.hidden = true
}
document.addEventListener('pointerover', e => {
  if (e.pointerType === 'touch') return
  const el = e.target.closest?.('[data-hint]')
  if (el === hintFor) return
  hideHint()
  if (!el) return
  hintFor = el
  hintTimer = setTimeout(() => hintFor === el && el.isConnected && showHint(el), 480)
})
document.addEventListener('pointerdown', hideHint, true)
document.addEventListener('wheel', hideHint, { passive: true, capture: true })

/* ---------- Toast: one line, maybe an action ---------- */

let toastTimer = 0
export function toast(text, { action, run, ms = 4200, error = false } = {}) {
  const t = $('#toast')
  t.className = 'toast' + (error ? ' err' : '')
  t.replaceChildren(h('span', null, text))
  if (action) t.append(h('button.btn', { on: { click: () => (hideToast(), run()) } }, action))
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(hideToast, ms)
}
export function hideToast() {
  clearTimeout(toastTimer)
  $('#toast').hidden = true
}

/* ---------- Busy ---------- */

let busyN = 0
export function busy(text) {
  busyN++
  $('#busy-text').textContent = text
  $('#busy').hidden = false
  return () => {
    busyN = Math.max(0, busyN - 1)
    if (!busyN) $('#busy').hidden = true
  }
}

/* ---------- A small form in a popover ---------- */

// fields: [{ key, label, value, note, max, validate(v) -> error text | '' }]
export function ask(anchor, { title, text, fields, ok = 'Save', place = 'below', align = 'start' }) {
  return new Promise(resolve => {
    let done = false
    const inputs = {}
    const err = h('div.err-text', { hidden: true })
    const finish = v => {
      if (done) return
      done = true
      closePop()
      resolve(v)
    }
    const submit = e => {
      e?.preventDefault()
      const out = {}
      for (const f of fields) {
        out[f.key] = inputs[f.key].value.trim()
        const msg = f.validate?.(out[f.key], out)
        if (msg) {
          err.textContent = msg
          err.hidden = false
          inputs[f.key].focus()
          return
        }
      }
      finish(out)
    }
    const form = h(
      'form.stack',
      { on: { submit } },
      title ? h('h3', null, title) : null,
      text ? h('p', null, text) : null,
      fields.map(f => {
        const input = h('input.tinput', { value: f.value ?? '', maxlength: f.max || 80, spellcheck: false, autocomplete: 'off' })
        if (f.onInput) input.addEventListener('input', () => f.onInput(input.value, inputs))
        inputs[f.key] = input
        return h('label.tlabel', null, f.label, input, f.note ? h('span.note', null, f.note) : null)
      }),
      err,
      h('div.row', null, h('button.btn', { type: 'button', on: { click: () => finish(null) } }, 'Cancel'), h('button.btn.primary', { type: 'submit' }, ok)),
    )
    popover(anchor, form, { cls: 'pad', place, align, onClose: () => finish(null) })
  })
}
