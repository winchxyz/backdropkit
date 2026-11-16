// Runs the exporter off the page's thread (adapter.js keeps one per lane: checks, Play, export).
// Messages: { id, type: 'all' | 'scene', project, mid, svgs } -> { id, ok, result | error }.
let lib = null
async function exporter() {
  if (!lib) lib = await import('./lib/export.js')
  return lib
}
self.onmessage = async e => {
  const { id, type, project, mid, svgs } = e.data
  try {
    const X = await exporter()
    if (type === 'scene') {
      const r = X.exportScene(project, mid)
      self.postMessage({ id, ok: true, result: { svg: r.svg, chars: r.chars, ms: r.ms, problems: r.problems || [] } })
    } else {
      const r = X.exportAll(project)
      const scenes = (r.scenes || []).map(s => ({ id: s.id, chars: s.chars, ms: s.ms, merged: s.merged, costs: s.costs || [], svg: svgs ? s.svg : undefined, problems: s.problems }))
      self.postMessage({ id, ok: true, result: { scenes, ok: r.ok, problems: r.problems || [], cost: r.cost } })
    }
  } catch (err) {
    lib = null
    self.postMessage({ id, ok: false, error: String((err && err.message) || err), missing: /Failed to fetch|Cannot find|404|Importing a module/i.test(String(err)) })
  }
}
