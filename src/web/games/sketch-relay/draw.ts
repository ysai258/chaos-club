/** Canvas painting for Silent Sketch Relay: live canvas, gallery thumbnails and PNG export. */
import type { StrokeView } from '../../../games/sketch-relay/shared.ts'

/** Mirrors the server's logical canvas size (src/games/sketch-relay/limits.ts). */
export const CANVAS = 1000
/** Mirrors the server's brush widths. */
export const BRUSH = { s: 7, m: 15, l: 28, xl: 48 } as const
/** The server takes at most 120 numbers per chunk; stay well under. */
export const CHUNK_NUMBERS = 60
/** Minimum distance between sampled points, canvas units. */
export const MIN_STEP = 6
/** How often the drawer streams ink, ms (the socket allows ~15 msgs/s). */
export const FLUSH_MS = 110

export const PAPER = '#fffdf7'

/** Paint one stroke with smooth midpoint curves. `scale` = css px per canvas unit * dpr. */
export function paintStroke(ctx: CanvasRenderingContext2D, s: StrokeView, scale: number): void {
  const p = s.p
  if (p.length < 2) return
  ctx.strokeStyle = s.c
  ctx.fillStyle = s.c
  ctx.lineWidth = s.w * scale
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const x = (i: number) => (p[i] as number) * scale
  if (p.length === 2) {
    ctx.beginPath()
    ctx.arc(x(0), x(1), (s.w * scale) / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.beginPath()
  ctx.moveTo(x(0), x(1))
  if (p.length === 4) {
    ctx.lineTo(x(2), x(3))
  } else {
    for (let i = 2; i < p.length - 2; i += 2) {
      const mx = (x(i) + x(i + 2)) / 2
      const my = (x(i + 1) + x(i + 3)) / 2
      ctx.quadraticCurveTo(x(i), x(i + 1), mx, my)
    }
    ctx.lineTo(x(p.length - 2), x(p.length - 1))
  }
  ctx.stroke()
}

export function paintAll(ctx: CanvasRenderingContext2D, size: number, strokes: readonly StrokeView[]): void {
  const scale = size / CANVAS
  ctx.save()
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, size, size)
  for (const s of strokes) paintStroke(ctx, s, scale)
  ctx.restore()
}

/** A shareable PNG: the drawing, the prompt and who drew it. */
export async function exportPng(opts: { strokes: readonly StrokeView[]; prompt: string; caption: string; accent: string }): Promise<Blob | null> {
  const W = 1080
  const pad = 40
  const art = W - pad * 2
  const H = art + 260
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#fff4e0'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = opts.accent
  ctx.fillRect(0, 0, W, 16)
  // Sticker frame
  ctx.fillStyle = '#16130f'
  ctx.fillRect(pad + 10, pad + 10, art, art)
  ctx.save()
  ctx.translate(pad, pad)
  paintAll(ctx, art, opts.strokes)
  ctx.restore()
  ctx.lineWidth = 6
  ctx.strokeStyle = '#16130f'
  ctx.strokeRect(pad, pad, art, art)
  ctx.fillStyle = '#16130f'
  ctx.textBaseline = 'top'
  ctx.font = '800 64px "Bricolage Grotesque", system-ui, sans-serif'
  wrapText(ctx, opts.prompt, pad, art + pad + 36, art, 70, 2)
  ctx.font = '600 32px "DM Sans", system-ui, sans-serif'
  ctx.fillStyle = '#5c544a'
  ctx.fillText(opts.caption, pad, H - 64)
  ctx.textAlign = 'right'
  ctx.fillText('✏️ Silent Sketch Relay · Chaos Club', W - pad, H - 64)
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'))
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines: number): void {
  const words = text.split(/\s+/)
  let line = ''
  let lines = 0
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + lines * lh)
      lines++
      line = w
      if (lines >= maxLines) return
    } else line = test
  }
  if (line) ctx.fillText(line, x, y + lines * lh)
}

export async function downloadPng(blob: Blob, name: string): Promise<void> {
  const file = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sketch'}.png`
  const f = new File([blob], file, { type: 'image/png' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.canShare?.({ files: [f] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [f], title: name })
      return
    } catch {
      /* cancelled: fall through to download */
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
