import { useSyncExternalStore } from 'react'
import { cn } from './cn.ts'
import { haptic, playSound } from './feedback.ts'

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
  emoji: string
}

let items: ToastItem[] = []
let seq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

const DEFAULT_EMOJI: Record<ToastKind, string> = { info: '👋', success: '🎉', error: '🙈' }

/**
 * Show a toast from anywhere (no hook needed):
 *   toast('Copied!', { kind: 'success' })
 */
export function toast(message: string, opts: { kind?: ToastKind; emoji?: string; durationMs?: number } = {}): void {
  const kind = opts.kind ?? 'info'
  // Same message twice in a row: don't stack duplicates.
  if (items.some((t) => t.message === message)) return
  const item: ToastItem = { id: ++seq, message, kind, emoji: opts.emoji ?? DEFAULT_EMOJI[kind] }
  items = [...items.slice(-2), item]
  emit()
  if (kind === 'error') {
    haptic('error')
    playSound('error')
  }
  setTimeout(() => dismissToast(item.id), opts.durationMs ?? (kind === 'error' ? 3500 : 2500))
}

export function dismissToast(id: number): void {
  items = items.filter((t) => t.id !== id)
  emit()
}

const BG: Record<ToastKind, string> = { info: 'bg-white', success: 'bg-lime', error: 'bg-tomato' }

/** Mounted once by the app. Games just call `toast()`. */
export function Toaster() {
  const list = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => items,
    () => items,
  )
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]"
    >
      {list.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismissToast(t.id)}
          className={cn(
            'pointer-events-auto flex min-h-12 w-full max-w-sm animate-pop items-center gap-2.5 rounded-2xl border-3 border-ink px-4 py-2.5 text-left font-display font-bold shadow-hard',
            BG[t.kind],
            t.kind === 'error' && '[animation:pop_0.3s_both,shake_0.4s_0.3s_both]',
          )}
        >
          <span className="text-2xl leading-none" aria-hidden>{t.emoji}</span>
          <span className="min-w-0 flex-1 break-words">{t.message}</span>
        </button>
      ))}
    </div>
  )
}
