// The price pylon's face, in screen cells: where its frame, label strips, lettering and digit
// windows lie, and the board's rows (engine/board.mjs) that the theme mod fills with live
// figures. The pylon's front is parallel to the picture plane (scene.mjs puts it there), so
// every part below is an exact rectangle of cells on the 320 x 200 grid.
//
// Top to bottom: a cap, the GAS sign (neon letters after dark), then three slots, each a label
// strip (TOKENS, CONTEXT, WEEKLY in the station's own 3 x 5 letters) over a dark LED window.
// Each window: a 1-cell frame round a dark panel 30 x 9 inside; the digits' area is 28 x 7 with
// one clear cell all round for the halo.

// The cabinet's face: columns 250-291, rows 36-122 (inclusive); the cap above it.
export const PY = {
  x0: 250,
  x1: 291,
  y0: 36, // top of the GAS sign
  cab: 56, // top of the cabinet with the windows
  y1: 122, // bottom of the cabinet
  capY0: 32,
  capX0: 256,
  capX1: 285,
  legs: [[256, 260], [281, 285]],
}

// The three windows (outer frame) and their label strips.
const SLOTS = [
  { id: 'tokens', word: 'TOKENS', strip: 58 },
  { id: 'context', word: 'CONTEXT', strip: 78 },
  { id: 'weekly', word: 'WEEKLY', strip: 98 },
]
const STRIP_H = 7
const WIN_X0 = 255
const WIN_X1 = 286
export const WINDOWS = SLOTS.map(s => {
  const y0 = s.strip + STRIP_H + 1 // the frame's top row, a body row under the strip
  return { ...s, x0: WIN_X0, x1: WIN_X1, y0, y1: y0 + 10 }
})
// The board: digits right-aligned in the window, 7 rows from the frame's top + 2.
export const ROWS = WINDOWS.map(w => ({ id: w.id, x: w.x0 + 2, y: w.y0 + 2, w: w.x1 - w.x0 - 3, align: 'right' }))

// ---------------------------------------------------------------- lettering
// The station's own small letters, 5 rows tall (3 wide, N 4, W 5).
const SMALL = {
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  E: ['###', '#..', '##.', '#..', '###'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  W: ['#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'],
  L: ['#..', '#..', '#..', '#..', '###'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
}
// The sign's big letters, 9 rows tall, strokes two cells wide.
const BIG = {
  G: ['.#####.', '##...##', '##.....', '##.....', '##..###', '##...##', '##...##', '##...##', '.#####.'],
  A: ['..###..', '.##.##.', '##...##', '##...##', '##...##', '#######', '##...##', '##...##', '##...##'],
  S: ['.#####.', '##...##', '##.....', '.###...', '..####.', '....###', '.....##', '##...##', '.#####.'],
}
function textCells(font, word, x0, y0) {
  const out = []
  let x = x0
  for (const ch of word) {
    const g = font[ch]
    g.forEach((row, j) => [...row].forEach((c, i) => c === '#' && out.push([x + i, y0 + j])))
    x += g[0].length + 1
  }
  return out
}
const widthOf = (font, word) => [...word].reduce((w, ch, i) => w + font[ch][0].length + (i ? 1 : 0), 0)

// ---------------------------------------------------------------- the face map
// One code per cell of the face: b body, t cream trim, o orange stripe, s label strip, i label
// ink, f window frame, l window panel (the board's ground), m sign frame, g sign face, n sign
// letter, h a letter's glow cell (dim neon, after dark), u neon tube.
export const FACE = new Map()
const key = (x, y) => x + ',' + y
const rect = (x0, y0, x1, y1, c) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) FACE.set(key(x, y), c)
}
// The cabinet body, a cream line along its top and an orange one near its foot.
rect(PY.x0, PY.y0, PY.x1, PY.y1, 'b')
// The GAS sign: a frame two cells wide (m), the face (g), the letters (n), a neon tube round the
// inside of the frame (u).
rect(PY.x0, PY.y0, PY.x1, PY.cab - 1, 'm')
rect(PY.x0 + 2, PY.y0 + 2, PY.x1 - 2, PY.cab - 3, 'g')
for (let x = PY.x0 + 3; x <= PY.x1 - 3; x++) for (const y of [PY.y0 + 3, PY.cab - 4]) FACE.set(key(x, y), 'u')
for (let y = PY.y0 + 4; y <= PY.cab - 5; y++) for (const x of [PY.x0 + 3, PY.x1 - 3]) FACE.set(key(x, y), 'u')
// The tube's corners are rounded: leave them face.
for (const [x, y] of [[PY.x0 + 3, PY.y0 + 3], [PY.x1 - 3, PY.y0 + 3], [PY.x0 + 3, PY.cab - 4], [PY.x1 - 3, PY.cab - 4]]) FACE.set(key(x, y), 'g')
{
  const word = 'GAS'
  const w = widthOf(BIG, word)
  const x0 = PY.x0 + Math.floor((PY.x1 - PY.x0 + 1 - w) / 2)
  const y0 = PY.y0 + Math.floor((PY.cab - PY.y0 - 9) / 2)
  const cells = textCells(BIG, word, x0, y0)
  const lit = new Set(cells.map(([x, y]) => key(x, y)))
  for (const [x, y] of cells) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!lit.has(key(x + dx, y + dy)) && FACE.get(key(x + dx, y + dy)) === 'g') FACE.set(key(x + dx, y + dy), 'h')
  for (const [x, y] of cells) FACE.set(key(x, y), 'n')
}
// A cream line under the sign, an orange one and a cream one near the cabinet's foot.
rect(PY.x0, PY.cab, PY.x1, PY.cab, 't')
rect(PY.x0, PY.y1 - 4, PY.x1, PY.y1 - 4, 'o')
rect(PY.x0, PY.y1 - 2, PY.x1, PY.y1 - 2, 't')
for (const w of WINDOWS) {
  // The label strip runs the width of the window; its word centred.
  rect(w.x0, w.strip, w.x1, w.strip + STRIP_H - 1, 's')
  const tw = widthOf(SMALL, w.word)
  const x0 = w.x0 + Math.floor((w.x1 - w.x0 + 1 - tw) / 2)
  for (const [x, y] of textCells(SMALL, w.word, x0, w.strip + 1)) FACE.set(key(x, y), 'i')
  rect(w.x0, w.y0, w.x1, w.y1, 'f')
  rect(w.x0 + 1, w.y0 + 1, w.x1 - 1, w.y1 - 1, 'l')
}
export const faceAt = (x, y) => FACE.get(key(x, y)) ?? null
// The neon cells (letters and tube), for the breathing layer in motion.mjs.
export const NEON = [...FACE].filter(([, c]) => c === 'n' || c === 'u').map(([k, c]) => [...k.split(',').map(Number), c])
