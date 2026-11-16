// The inspector's controls, all alike: a label at the left, the value at the right, the
// control under them. A slider shows its value and goes back to its default on a
// double-click. Every control carries a help line (data-help) that the inspector shows at its
// foot while the pointer is over it, and a search key (data-find) that "/" can jump to.
import { h, icon, clamp } from './util.js'

const fmtNum = (v, step) => {
  const d = step < 1 ? (String(step).split('.')[1] || '').length : 0
  return Number(v).toFixed(d)
}

// A slider. onInput runs while dragging; onChange once it is let go (or reset).
export function slider({ label, help, min, max, step = 1, value, def, unit = '', fmt, find, onInput, onChange }) {
  const show = v => (fmt ? fmt(v) : fmtNum(v, step) + unit)
  const out = h('span.cv', null, show(value))
  const input = h('input.range', { type: 'range', min, max, step, value, 'aria-label': label })
  const paintFill = () => input.style.setProperty('--p', ((Number(input.value) - min) / (max - min)) * 100 + '%')
  paintFill()
  input.addEventListener('input', () => {
    const v = Number(input.value)
    out.textContent = show(v)
    paintFill()
    onInput?.(v)
  })
  input.addEventListener('change', () => onChange?.(Number(input.value)))
  const reset = () => {
    if (def === undefined) return
    input.value = def
    out.textContent = show(def)
    paintFill()
    onInput?.(Number(def))
    onChange?.(Number(def))
  }
  input.addEventListener('dblclick', reset)
  out.addEventListener('dblclick', reset)
  // Arrow keys step; the change lands when the key is let go.
  input.addEventListener('keyup', e => /Arrow|Page|Home|End/.test(e.key) && onChange?.(Number(input.value)))
  const el = h('div.ctl.slider', { 'data-help': (help ? help + ' ' : '') + (def !== undefined ? 'Double-click to reset.' : ''), 'data-find': find || label }, h('div.crow', null, h('label.cl', null, label), out), input)
  el.set = v => {
    input.value = v
    out.textContent = show(v)
    paintFill()
  }
  return el
}

// A row of choices. choices: [[value, label], ...].
export function seg({ label, help, choices, value, find, onChange, wide }) {
  const buttons = choices.map(([v, l]) =>
    h('button.sg', { type: 'button', 'aria-pressed': String(v === value), on: { click: () => (setOn(v), onChange(v)) } }, l),
  )
  const setOn = v => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(choices[i][0] === v)))
  const many = wide || choices.length > 5 || choices.reduce((n, c) => n + String(c[1]).length, 0) > 28
  const box = h('div.segs' + (many ? '.wrap' : ''), { role: 'group', 'aria-label': label }, buttons)
  // Once it is on the page: a row while it fits, otherwise a grid of 3, 2 or 1 columns, so
  // no choice is ever cut (fonts, scrollbars and panel widths vary).
  requestAnimationFrame(() => fitSegs(box))
  return h('div.ctl', { 'data-help': help || '', 'data-find': find || label }, label ? h('div.crow', null, h('label.cl', null, label)) : null, box)
}
export function fitSegs(box) {
  if (!box.isConnected) return
  const cut = () => box.scrollWidth > box.clientWidth + 1 || [...box.children].some(b => b.scrollWidth > b.clientWidth + 1)
  box.classList.remove('wrap')
  box.style.removeProperty('--cols')
  if (!cut()) return
  for (const cols of [3, 2, 1]) {
    box.classList.add('wrap')
    box.style.setProperty('--cols', cols)
    if (!cut()) return
  }
}
addEventListener('resize', () => requestAnimationFrame(() => document.querySelectorAll('.segs').forEach(fitSegs)))

// A dropdown, for long lists.
export function select({ label, help, choices, value, find, onChange }) {
  const s = h('select.sel', { 'aria-label': label, on: { change: () => onChange(choices[s.selectedIndex][0]) } }, choices.map(([v, l]) => h('option', { selected: v === value }, l)))
  return h('div.ctl.inline', { 'data-help': help || '', 'data-find': find || label }, h('label.cl', null, label), h('span.selwrap', null, s, icon('chevD')))
}

// A switch.
export function toggle({ label, help, value, find, onChange }) {
  const b = h('button.switch', { type: 'button', role: 'switch', 'aria-checked': String(!!value), 'aria-label': label, on: { click: () => {
    const v = b.getAttribute('aria-checked') !== 'true'
    b.setAttribute('aria-checked', String(v))
    onChange(v)
  } } })
  return h('div.ctl.inline', { 'data-help': help || '', 'data-find': find || label }, h('label.cl', null, label), b)
}

// A colour: a swatch that opens the system picker. onInput while picking, onChange at the end.
export function colorField({ label, help, value, find, onInput, onChange }) {
  const input = h('input.cpick', { type: 'color', value, 'aria-label': label })
  const sw = h('span.csw', { style: { background: value } })
  const hex = h('span.cv.mono', null, value)
  input.addEventListener('input', () => {
    sw.style.background = input.value
    hex.textContent = input.value
    onInput?.(input.value)
  })
  input.addEventListener('change', () => onChange?.(input.value))
  return h('div.ctl.inline', { 'data-help': help || '', 'data-find': find || label }, h('label.cl', null, label), h('label.cfield', null, sw, hex, input))
}

// A card with a title (and a switch in the title when it can be turned off).
export function section({ title, help, on, onToggle, find, open = true }, ...kids) {
  const body = h('div.sbody', { hidden: on === false }, kids)
  let sw = null
  if (on !== undefined) {
    sw = h('button.switch', { type: 'button', role: 'switch', 'aria-checked': String(!!on), 'aria-label': title, on: { click: e => {
      e.stopPropagation()
      const v = sw.getAttribute('aria-checked') !== 'true'
      sw.setAttribute('aria-checked', String(v))
      body.hidden = !v
      onToggle(v)
    } } })
  }
  void open
  return h('section.card', { 'data-help': help || '', 'data-find': find || title }, h('header.chead', null, h('h3', null, title), sw), body)
}

// A plain line of text in a card.
export const note = (text, cls = '') => h('p.note' + (cls ? '.' + cls.trim().split(/\s+/).join('.') : ''), null, text)

// A button row.
export const buttons = (...list) => h('div.brow', null, list)
export const btn = (label, { icon: ic, help, primary, onClick, find, key, danger } = {}) =>
  h('button.btn' + (primary ? '.primary' : '') + (danger ? '.danger' : ''), { type: 'button', 'data-help': help || '', 'data-find': find || '', 'data-key': key || null, on: { click: onClick } }, ic ? icon(ic) : null, label ? h('span', null, label) : null)

// A text field that commits on Enter or blur.
export function textField({ label, help, value, max = 60, find, onChange, placeholder }) {
  const input = h('input.tinput', { value: value ?? '', maxlength: max, spellcheck: false, autocomplete: 'off', placeholder: placeholder || '' })
  const commit = () => input.value.trim() !== (value ?? '') && onChange(input.value.trim())
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur()
    if (e.key === 'Escape') {
      input.value = value ?? ''
      input.blur()
    }
  })
  input.addEventListener('blur', commit)
  return h('div.ctl', { 'data-help': help || '', 'data-find': find || label }, label ? h('div.crow', null, h('label.cl', null, label)) : null, input)
}

export { clamp }
