import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from './cn.ts'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  /** Sticky area under the content, e.g. a chat input or action buttons. */
  footer?: ReactNode
  /** Max height on phones. Default '85dvh'. */
  maxHeight?: string
  className?: string
}

/**
 * Bottom sheet on phones, centred dialog on wider screens. Closes on
 * backdrop tap, Escape, or the ✕ button.
 */
export function Sheet({ open, onClose, title, children, footer, maxHeight = '85dvh', className }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      prev?.focus?.()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <div className="absolute inset-0 animate-fade-in bg-ink/45" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        style={{ maxHeight }}
        className={cn(
          'relative flex w-full max-w-lg animate-slide-up flex-col rounded-t-[28px] border-3 border-b-0 border-ink bg-paper shadow-hard-lg outline-none',
          'sm:animate-pop sm:rounded-[28px] sm:border-b-3',
          className,
        )}
      >
        <div className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-ink/25 sm:hidden" aria-hidden />
        <div className="flex shrink-0 items-center gap-3 px-5 pt-3 pb-2">
          <div className="min-w-0 flex-1 font-display text-xl font-extrabold">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-11 shrink-0 place-items-center rounded-xl border-3 border-ink bg-white text-lg font-black shadow-hard-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
        {footer && (
          <div className="shrink-0 border-t-3 border-ink bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:rounded-b-[25px]">
            {footer}
          </div>
        )}
        {!footer && <div className="shrink-0 pb-[env(safe-area-inset-bottom)]" />}
      </div>
    </div>,
    document.body,
  )
}
