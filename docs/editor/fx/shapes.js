// Pixel shapes for the looks, after Nightgrain's shape stage (engine.js paintShape: dot, ring,
// diamond, plus, square, sized by brightness), drawn here in whole cells: the layer in k x k
// blocks, each block one shape of cells in a (k-1) x (k-1) area with a one-cell gutter on its
// right and bottom, so neighbouring shapes never touch.

export const SHAPE_IDS = ['dot', 'ring', 'diamond', 'plus', 'square']

const cache = new Map()

// The shape's cells in a k x k block at size s (0..1), as a list of [x, y]. Sizes are taken in
// 2(k-1) steps; the smallest ones may hold no cell at all.
export function shapeCells(shape, k, s) {
  const steps = 2 * (k - 1)
  const level = Math.max(0, Math.min(steps, Math.round(s * steps)))
  const key = shape + ':' + k + ':' + level
  let cells = cache.get(key)
  if (cells) return cells
  cells = []
  const a = k - 1
  const c = a / 2
  const r = (level / steps) * (a / 2)
  for (let y = 0; y < a; y++) {
    for (let x = 0; x < a; x++) {
      const dx = x + 0.5 - c
      const dy = y + 0.5 - c
      const ax = Math.abs(dx)
      const ay = Math.abs(dy)
      const d2 = dx * dx + dy * dy
      let on = false
      if (level === 0) on = false
      else if (shape === 'square') on = ax <= r + 1e-6 && ay <= r + 1e-6
      else if (shape === 'diamond') on = ax + ay <= r + 0.5 + 1e-6
      else if (shape === 'plus') {
        const t = Math.max(0.5, r * 0.34)
        on = (ax <= t + 1e-6 || ay <= t + 1e-6) && Math.max(ax, ay) <= r + 1e-6
      } else if (shape === 'ring') {
        const R2 = (r + 0.2) * (r + 0.2)
        const ri = r - 1.05
        on = d2 <= R2 && (ri <= 0.3 || d2 > ri * ri)
      } else on = d2 <= (r + 0.2) * (r + 0.2) // dot
      if (on) cells.push([x, y])
    }
  }
  // A shape that rounds to nothing at a visible size keeps one centre cell.
  if (!cells.length && level >= steps / 4) cells.push([Math.floor(c), Math.floor(c)])
  cache.set(key, cells)
  return cells
}
