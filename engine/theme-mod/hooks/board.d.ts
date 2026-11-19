// The price board (board.js): live figures drawn as pixel digits into a theme's scene.

/** The figures on the board; a missing one shows as dashes. */
export type Figures = {
  /** Tokens this chat has sent and received, as the API counts them (cache reads included). */
  tokens?: number
  /** How full the context window is, 0 to 100. */
  context?: number
  /** How much of the weekly usage limit is used, 0 to 100. */
  weekly?: number
}

export type BoardRow = {
  /** Which figure the window shows. */
  id: 'tokens' | 'context' | 'weekly'
  /** The left cell of the digit area. */
  x: number
  /** The top cell row of the digits (they are 7 rows tall). */
  y: number
  /** The digit area's width in cells. */
  w: number
  align?: 'left' | 'center' | 'right'
}

export type Board = {
  /** Added to a cell row to get its run's y (0 when the marker sits at the top of the scene's grid). */
  yo?: number
  /** The windows, top to bottom. */
  rows: readonly BoardRow[]
  /** The digits' colour at each moment, by moment id, #rrggbb. */
  ink: Readonly<Record<string, string>>
  /** A glow one cell round the digits at each moment, by moment id, #rrggbb. */
  halo?: Readonly<Record<string, string>>
}

export declare const GLYPH_H: number
export declare const MIN_W: number
/** The empty group a scene with a board holds where the digits go. */
export declare const MARKER: string
/** Sample figures, for previews. */
export declare const SAMPLE: Required<Figures>
export declare function tokensText(n: number | undefined): string
export declare function percentText(p: number | undefined): string
export declare function textsOf(values: Figures): { tokens: string; context: string; weekly: string }
export declare function boardMarkup(board: Board, moment: string, values: Figures): string
/** The scene with the board's digits in its marker; a scene without the marker comes back as it is. */
export declare function fillBoard(svg: string, board: Board | undefined, moment: string, values: Figures): string
export declare function checkBoard(board: Board): string[]
