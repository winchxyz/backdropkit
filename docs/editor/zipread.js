// Reading a zip in the browser: stored entries as they are, deflated ones through the
// browser's own DecompressionStream. Returns [{ name, data: Uint8Array }].
export async function readZip(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('That file is not a zip.')
  const count = v.getUint16(end + 10, true)
  let p = v.getUint32(end + 16, true)
  const dec = new TextDecoder()
  const out = []
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('That zip is damaged.')
    const method = v.getUint16(p + 10, true)
    const size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    const at = v.getUint32(p + 42, true)
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    const start = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true)
    const body = bytes.subarray(start, start + size)
    out.push({ name, method, body })
    p += 46 + nameLen + extraLen + commentLen
  }
  return Promise.all(
    out.map(async e => {
      if (e.method === 0) return { name: e.name, data: e.body.slice() }
      if (e.method !== 8) throw new Error('That zip uses a packing this editor cannot read.')
      const ds = new DecompressionStream('deflate-raw')
      const data = new Uint8Array(await new Response(new Blob([e.body]).stream().pipeThrough(ds)).arrayBuffer())
      return { name: e.name, data }
    }),
  )
}
