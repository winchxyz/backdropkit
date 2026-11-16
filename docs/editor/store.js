// The last project, kept in the browser (IndexedDB) as the visitor works. Typed arrays are
// stored as they are (structured clone), so saving is cheap.
const DB = 'backdropkit-editor'
const STORE = 'kv'
let dbp = null
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1)
      r.onupgradeneeded = () => r.result.createObjectStore(STORE)
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    }).catch(() => null)
  }
  return dbp
}
async function tx(mode, fn) {
  const d = await db()
  if (!d) return null
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode)
    const s = t.objectStore(STORE)
    const r = fn(s)
    t.oncomplete = () => resolve(r?.result ?? null)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}
export async function saveLast(doc, view) {
  try {
    await tx('readwrite', s => s.put({ doc, view, at: Date.now() }, 'last'))
    return true
  } catch {
    return false
  }
}
export async function loadLast() {
  try {
    return await tx('readonly', s => s.get('last'))
  } catch {
    return null
  }
}
export async function clearLast() {
  try {
    await tx('readwrite', s => s.delete('last'))
  } catch {
    /* nothing kept */
  }
}
