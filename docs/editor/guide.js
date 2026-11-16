// The guide: a page of its own (guide.html), opened in a new tab. Until it has been opened once
// in this browser, the Guide button wears a quiet, steady ring and a small dot. If the browser
// keeps nothing, the ring simply shows.
const KEY = 'backdropkit-editor-guide'
export const GUIDE_URL = 'guide.html'

export function guideSeen() {
  try {
    return localStorage.getItem(KEY) === 'seen'
  } catch {
    return false
  }
}
export function markGuideSeen() {
  try {
    localStorage.setItem(KEY, 'seen')
  } catch {
    /* the ring comes back next visit */
  }
  for (const el of document.querySelectorAll('.fresh')) el.classList.remove('fresh')
}
export function openGuide(anchor = '') {
  markGuideSeen()
  window.open(GUIDE_URL + (anchor ? '#' + anchor : ''), '_blank', 'noopener')
}
