/** Ink validation: untrusted point chunks in, clean bounded strokes out. */
import { CANVAS, MAX_CHUNK_NUMBERS } from './limits.ts'

/** Pointer can wander a little outside the canvas; anything wilder is rejected. */
const SLACK = 100

export type ChunkCheck = { ok: true; pts: number[] } | { ok: false; error: string }

export function validateChunk(raw: unknown): ChunkCheck {
  if (!Array.isArray(raw)) return { ok: false, error: 'Bad ink' }
  if (raw.length % 2 !== 0) return { ok: false, error: 'Bad ink' }
  if (raw.length > MAX_CHUNK_NUMBERS) return { ok: false, error: 'Too much ink at once' }
  const pts: number[] = []
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < -SLACK || v > CANVAS + SLACK) return { ok: false, error: 'Ink off the canvas' }
    pts.push(Math.min(CANVAS, Math.max(0, Math.round(v))))
  }
  return { ok: true, pts }
}

export interface InkResult {
  points: number[]
  len: number
  /** The stroke hit its ink or point limit; it must end now. */
  capped: boolean
}

/** Append points to a stroke, cutting it exactly where the ink runs out. */
export function appendChunk(prev: readonly number[], prevLen: number, add: readonly number[], inkMax: number, maxPoints: number): InkResult {
  const points = [...prev]
  let len = prevLen
  for (let i = 0; i + 1 < add.length; i += 2) {
    const x = add[i] as number
    const y = add[i + 1] as number
    const n = points.length
    if (n === 0) { points.push(x, y); continue }
    const lx = points[n - 2] as number
    const ly = points[n - 1] as number
    const seg = Math.hypot(x - lx, y - ly)
    if (seg === 0) continue
    if (len + seg >= inkMax) {
      const f = (inkMax - len) / seg
      points.push(Math.round(lx + (x - lx) * f), Math.round(ly + (y - ly) * f))
      return { points, len: inkMax, capped: true }
    }
    points.push(x, y)
    len += seg
    if (points.length / 2 >= maxPoints) return { points, len, capped: true }
  }
  return { points, len, capped: false }
}
