import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import type { StrokeView } from '../../../games/sketch-relay/shared.ts'
import { cn } from '../../ui/index.ts'
import { CANVAS, CHUNK_NUMBERS, FLUSH_MS, MIN_STEP, paintAll, paintStroke } from './draw.ts'

export interface DrawInput {
  /** Turn id; a new id resets the local stroke. */
  turn: number
  inkMax: number
  color: string
  width: number
  /** Topsy-Turvy: this drawer's canvas is upside down. */
  flipped: boolean
  send: (chunk: { seq: number; pts: number[]; end: boolean }) => void
  onInk?: (used: number) => void
  onDone?: () => void
}

interface Local {
  turn: number
  pts: number[]
  pending: number[]
  len: number
  seq: number
  ended: boolean
  pointerId: number | null
}

export function SketchCanvas({
  strokes,
  live,
  input,
  className,
  children,
  label = 'Shared drawing canvas',
}: {
  strokes: readonly StrokeView[]
  live: StrokeView | null
  input: DrawInput | null
  className?: string
  children?: ReactNode
  label?: string
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [px, setPx] = useState(0)
  const local = useRef<Local | null>(null)
  const timer = useRef<number | null>(null)
  const latest = useRef({ strokes, live, input })
  latest.current = { strokes, live, input }

  const redraw = useCallback(() => {
    const c = canvasRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const { strokes: st, live: lv, input: inp } = latest.current
    paintAll(ctx, c.width, st)
    const scale = c.width / CANVAS
    const mine = local.current
    if (mine && inp && mine.turn === inp.turn && mine.pts.length >= 2) {
      paintStroke(ctx, { by: '', c: inp.color, w: inp.width, p: mine.pts }, scale)
    } else if (lv) {
      paintStroke(ctx, lv, scale)
    }
  }, [])

  // Fit the canvas to its box (crisp on retina) and repaint on every resize.
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const fit = () => {
      const w = Math.floor(wrap.clientWidth)
      if (w > 0) setPx(w)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    const c = canvasRef.current
    if (!c || px === 0) return
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    c.width = Math.round(px * dpr)
    c.height = Math.round(px * dpr)
    redraw()
  }, [px, redraw])

  useEffect(() => {
    // A new turn (or no turn) means the server owns whatever was drawn.
    if (!input || (local.current && local.current.turn !== input.turn)) {
      if (local.current && !local.current.ended) stopTimer()
      local.current = null
    }
    redraw()
  })

  const stopTimer = () => {
    if (timer.current !== null) window.clearInterval(timer.current)
    timer.current = null
  }

  const flush = (end: boolean) => {
    const l = local.current
    const inp = latest.current.input
    if (!l || !inp || l.turn !== inp.turn) return
    if (l.pending.length === 0 && !end) return
    inp.send({ seq: l.seq, pts: l.pending, end })
    l.seq++
    l.pending = []
    inp.onInk?.(Math.round(l.len))
  }

  const finish = () => {
    const l = local.current
    if (!l || l.ended) return
    l.ended = true
    stopTimer()
    flush(true)
    latest.current.input?.onDone?.()
  }

  useEffect(() => () => stopTimer(), [])

  const toCanvas = (e: { clientX: number; clientY: number }): [number, number] => {
    const c = canvasRef.current
    if (!c) return [0, 0]
    const r = c.getBoundingClientRect()
    let x = ((e.clientX - r.left) / r.width) * CANVAS
    let y = ((e.clientY - r.top) / r.height) * CANVAS
    if (latest.current.input?.flipped) {
      x = CANVAS - x
      y = CANVAS - y
    }
    const clamp = (v: number) => Math.round(Math.min(CANVAS, Math.max(0, v)))
    return [clamp(x), clamp(y)]
  }

  const addPoint = (x: number, y: number) => {
    const l = local.current
    const inp = latest.current.input
    if (!l || l.ended || !inp) return
    const n = l.pts.length
    const lx = l.pts[n - 2] as number
    const ly = l.pts[n - 1] as number
    const d = Math.hypot(x - lx, y - ly)
    if (d < MIN_STEP) return
    if (l.len + d >= inp.inkMax) {
      const f = (inp.inkMax - l.len) / d
      const cx = Math.round(lx + (x - lx) * f)
      const cy = Math.round(ly + (y - ly) * f)
      l.pts.push(cx, cy)
      l.pending.push(cx, cy)
      l.len = inp.inkMax
      finish()
      return
    }
    l.pts.push(x, y)
    l.pending.push(x, y)
    l.len += d
    if (l.pending.length >= CHUNK_NUMBERS) flush(false)
  }

  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    const inp = latest.current.input
    if (!inp || !e.isPrimary) return
    if (local.current && local.current.turn === inp.turn) return // one stroke per turn
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const [x, y] = toCanvas(e)
    local.current = { turn: inp.turn, pts: [x, y], pending: [x, y], len: 0, seq: 0, ended: false, pointerId: e.pointerId }
    stopTimer()
    timer.current = window.setInterval(() => flush(false), FLUSH_MS)
    flush(false)
    redraw()
  }

  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const l = local.current
    if (!l || l.ended || l.pointerId !== e.pointerId) return
    e.preventDefault()
    const native = e.nativeEvent as PointerEvent
    const evs = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : []
    for (const ev of evs.length ? evs : [native]) {
      const [x, y] = toCanvas(ev)
      addPoint(x, y)
    }
    redraw()
  }

  const onUp = (e: RPointerEvent<HTMLCanvasElement>) => {
    const l = local.current
    if (!l || l.pointerId !== e.pointerId) return
    finish()
    redraw()
  }

  const canDraw = !!input && !(local.current?.ended && local.current.turn === input.turn)

  return (
    <div
      ref={wrapRef}
      className={cn(
        'relative aspect-square w-full overflow-hidden rounded-3xl border-3 border-ink bg-[#fffdf7] shadow-hard',
        canDraw && 'outline-4 outline-offset-2 outline-sun',
        className,
      )}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        data-testid="sketch-canvas"
        data-can-draw={canDraw ? 'yes' : 'no'}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onLostPointerCapture={onUp}
        onContextMenu={(e) => e.preventDefault()}
        className={cn('block size-full select-none', input?.flipped && 'rotate-180', canDraw ? 'cursor-crosshair' : 'cursor-default')}
        style={{ touchAction: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' } as CSSProperties}
      />
      {children}
    </div>
  )
}
