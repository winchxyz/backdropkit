// Placing an asset frame into the cell grid: { x, y, scale, flipX } in cells, where `scale` is
// cells per asset pixel. Shrinking averages every source pixel a cell covers (area weights,
// premultiplied by alpha, so transparent edges do not darken); enlarging takes the nearest pixel,
// so pixel art stays crisp.

/**
 * placeAsset(frameRgba, place, w = 320, h = 200) -> { w, h, data: Uint8ClampedArray }
 *   frameRgba: { w, h, data } (the asset's pixels)
 *   place: { x, y (cells, the asset's top-left corner; fractions allowed), scale (> 0),
 *            flipX (mirror the asset left to right) }
 * A cell's alpha is the share of it the asset covers (times the asset's own alpha).
 */
export function placeAsset(frameRgba, place = {}, w = 320, h = 200) {
  const src = frameRgba
  const W0 = src.w
  const H0 = src.h
  const out = new Uint8ClampedArray(w * h * 4)
  const s = Number(place.scale) > 0 ? Number(place.scale) : 1
  const px = Number(place.x) || 0
  const py = Number(place.y) || 0
  const flip = !!place.flipX
  if (!W0 || !H0) return { w, h, data: out }
  const d = src.data

  if (s >= 1) {
    // Nearest: the source pixel under each cell's centre.
    for (let cy = 0; cy < h; cy++) {
      const v = Math.floor((cy + 0.5 - py) / s)
      if (v < 0 || v >= H0) continue
      for (let cx = 0; cx < w; cx++) {
        let u = Math.floor((cx + 0.5 - px) / s)
        if (u < 0 || u >= W0) continue
        if (flip) u = W0 - 1 - u
        const i = (v * W0 + u) * 4
        const o = (cy * w + cx) * 4
        out[o] = d[i]
        out[o + 1] = d[i + 1]
        out[o + 2] = d[i + 2]
        out[o + 3] = d[i + 3]
      }
    }
    return { w, h, data: out }
  }

  // Area average, separable. Each output column (row) gets the list of source columns (rows)
  // it covers with their overlap, in source pixels; the weights are divided by the full cell
  // footprint (1 / s source pixels), so a cell only half over the asset gets half the alpha.
  const spans = (count, offset, srcLen, mirror) => {
    const list = new Array(count)
    for (let c = 0; c < count; c++) {
      let a = (c - offset) / s
      let b = (c + 1 - offset) / s
      if (mirror) [a, b] = [srcLen - b, srcLen - a]
      const lo = Math.max(0, a)
      const hi = Math.min(srcLen, b)
      if (hi <= lo) {
        list[c] = null
        continue
      }
      const idx = []
      const wt = []
      for (let i = Math.floor(lo); i < Math.ceil(hi); i++) {
        const ov = Math.min(hi, i + 1) - Math.max(lo, i)
        if (ov > 1e-6) {
          idx.push(i)
          wt.push(ov * s)
        }
      }
      list[c] = { idx, wt }
    }
    return list
  }
  const cols = spans(w, px, W0, flip)
  const rows = spans(h, py, H0, false)
  // Source rows any output row needs.
  const need = new Uint8Array(H0)
  for (const r of rows) if (r) for (const i of r.idx) need[i] = 1
  // Horizontal pass: premultiplied RGB and alpha per needed source row, per output column.
  const tmp = new Float32Array(H0 * w * 4)
  for (let v = 0; v < H0; v++) {
    if (!need[v]) continue
    const rowBase = v * W0 * 4
    for (let cx = 0; cx < w; cx++) {
      const c = cols[cx]
      if (!c) continue
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let k = 0; k < c.idx.length; k++) {
        const i = rowBase + c.idx[k] * 4
        const al = (d[i + 3] / 255) * c.wt[k]
        r += d[i] * al
        g += d[i + 1] * al
        b += d[i + 2] * al
        a += al
      }
      const o = (v * w + cx) * 4
      tmp[o] = r
      tmp[o + 1] = g
      tmp[o + 2] = b
      tmp[o + 3] = a
    }
  }
  // Vertical pass.
  for (let cy = 0; cy < h; cy++) {
    const rr = rows[cy]
    if (!rr) continue
    for (let cx = 0; cx < w; cx++) {
      if (!cols[cx]) continue
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let k = 0; k < rr.idx.length; k++) {
        const i = (rr.idx[k] * w + cx) * 4
        const wt = rr.wt[k]
        r += tmp[i] * wt
        g += tmp[i + 1] * wt
        b += tmp[i + 2] * wt
        a += tmp[i + 3] * wt
      }
      if (a <= 0) continue
      const o = (cy * w + cx) * 4
      out[o] = r / a
      out[o + 1] = g / a
      out[o + 2] = b / a
      out[o + 3] = Math.round(Math.min(1, a) * 255)
    }
  }
  return { w, h, data: out }
}

// The place that fits a frame inside w x h (contained, centred), as the editor's starting point.
export function fitPlace(frameW, frameH, w = 320, h = 200, cover = false) {
  const k = cover ? Math.max(w / frameW, h / frameH) : Math.min(w / frameW, h / frameH)
  return { x: (w - frameW * k) / 2, y: (h - frameH * k) / 2, scale: k, flipX: false }
}
