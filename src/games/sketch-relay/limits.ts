/** Server-side ink limits. The web client mirrors the few it needs in its own constants. */
import type { BrushSize } from './shared.ts'

/** Logical canvas is CANVAS x CANVAS, whatever the screen size. */
export const CANVAS = 1000

/** Numbers per ink chunk (x,y pairs flattened). The client sends smaller chunks. */
export const MAX_CHUNK_NUMBERS = 120
/** Points one stroke may hold before it is cut off. */
export const MAX_STROKE_POINTS = 240

/** Canvas units for each brush, plus the forced "fat marker" size. */
export const BRUSH_WIDTH: Record<BrushSize | 'xl', number> = { s: 7, m: 15, l: 28, xl: 48 }
