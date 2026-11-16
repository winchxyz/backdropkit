// The overflow check, run in the page (page.evaluate(checkOverflow, { allow })): every piece of
// text on show must end inside each clipping ancestor's inner box (inside its border and
// scrollbars). Vertical overflow is fine in a box that scrolls up and down; nothing may run
// out sideways. Text cut short with an ellipsis is reported too, except in the elements that
// `allow` names (long names of layers, art, themes and moments are meant to end with "…").
// Returns [{ text, where, clip, axis, over }], `over` in CSS pixels.
export function checkOverflow({ allow = [], slack = 0.5 } = {}) {
  const out = []
  const path = el => {
    const bits = []
    for (let e = el; e && e !== document.body && bits.length < 4; e = e.parentElement) {
      let s = e.tagName.toLowerCase()
      if (e.id) s += '#' + e.id
      else if (e.classList.length) s += '.' + [...e.classList].slice(0, 2).join('.')
      bits.unshift(s)
    }
    return bits.join(' > ')
  }
  const allowed = el => allow.some(sel => el.closest(sel))
  const shown = el => (el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : !!el.getClientRects().length)
  const clippers = el => {
    const list = []
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p)
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') list.push({ p, cs })
    }
    return list
  }
  const seen = new Set()
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) })
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n.parentElement
    if (!el || !shown(el) || el.closest('svg, script, style, [aria-hidden="true"]')) continue
    const range = document.createRange()
    range.selectNodeContents(n)
    const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0)
    if (!rects.length) continue
    const r = {
      left: Math.min(...rects.map(x => x.left)),
      right: Math.max(...rects.map(x => x.right)),
      top: Math.min(...rects.map(x => x.top)),
      bottom: Math.max(...rects.map(x => x.bottom)),
    }
    const text = n.nodeValue.trim().slice(0, 48)
    // Past a box that scrolls up and down, height is that box's business: only width counts.
    let scrolled = false
    for (const { p, cs } of clippers(el)) {
      const b = p.getBoundingClientRect()
      const box = { left: b.left + p.clientLeft, top: b.top + p.clientTop }
      box.right = box.left + (p === document.documentElement ? innerWidth : p.clientWidth)
      box.bottom = box.top + (p === document.documentElement ? innerHeight : p.clientHeight)
      // Text scrolled out of view in a box that scrolls is not cut.
      const scrollsY = /auto|scroll/.test(cs.overflowY)
      if (scrollsY && (r.bottom < box.top || r.top > box.bottom)) break
      const over = Math.max(box.left - r.left, r.right - box.right)
      const overY = scrollsY || scrolled ? 0 : Math.max(box.top - r.top, r.bottom - box.bottom)
      if (scrollsY) scrolled = true
      const cut = over > slack ? ['x', over] : overY > slack ? ['y', overY] : null
      if (cut && !allowed(el)) {
        const key = path(el) + '|' + text
        if (!seen.has(key)) {
          seen.add(key)
          out.push({ text, where: path(el), clip: path(p), axis: cut[0], over: Math.round(cut[1] * 10) / 10 })
        }
        break
      }
    }
  }
  // Ellipses: text that does not fit its own box.
  for (const el of document.querySelectorAll('body *')) {
    if (!shown(el) || allowed(el)) continue
    const cs = getComputedStyle(el)
    if (cs.textOverflow !== 'ellipsis' || cs.overflowX === 'visible') continue
    if (el.scrollWidth > el.clientWidth + 1 && el.textContent.trim()) out.push({ text: el.textContent.trim().slice(0, 48), where: path(el), clip: 'ellipsis', axis: 'x', over: el.scrollWidth - el.clientWidth })
  }
  return out
}

// Names people choose may end in an ellipsis when they are long; so may a short moment's
// name on the day line, and a layer's second line (its full text is in the hint).
export const ALLOW = ['.lname', '.lkind', '.vname', '.dseg', '.aname', '.title', '.dname', '.mname', '.sl', '.tcard b', '.ptext', '.code', '.prompt pre']
