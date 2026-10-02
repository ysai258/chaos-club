import type { TeamColor } from '../../../shared/protocol.ts'
import type { PwDraft, PwProduct } from '../../../games/pitch-wars/shared.ts'
import { cn, COLOR } from '../../ui/index.ts'
import { money } from './util.tsx'

/** The startup poster: mascot, name, slogan, price sticker, the Ask, the twist stamp. */
export function Poster({
  draft, product, twist, color, compact, className, showAsk = true,
}: {
  draft: PwDraft
  product: PwProduct
  twist: string
  color: TeamColor
  compact?: boolean
  showAsk?: boolean
  className?: string
}) {
  const name = draft.name.trim() || product.title
  return (
    <div
      data-testid="pw-poster"
      className={cn(
        'relative overflow-hidden rounded-3xl border-3 border-ink text-left shadow-hard-lg',
        COLOR[color].bg,
        compact ? 'p-3' : 'p-4 pb-5',
        className,
      )}
    >
      {/* sunburst */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-1/2 left-1/2 aspect-square w-[160%] -translate-x-1/2 animate-spin-slow opacity-25"
        style={{ background: 'repeating-conic-gradient(var(--color-paper) 0 10deg, transparent 10deg 20deg)' }}
      />
      <div className="relative flex items-start gap-3">
        <div
          className={cn(
            'grid shrink-0 place-items-center rounded-2xl border-3 border-ink bg-paper shadow-hard-sm',
            compact ? 'size-14 text-4xl' : 'size-20 text-6xl -rotate-3',
          )}
          aria-hidden
        >
          {draft.mascot}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[0.65rem] font-black uppercase tracking-widest text-ink/70">Introducing</p>
          <h3
            className={cn(
              'font-display font-black leading-[0.95] break-words text-white text-outline [text-shadow:2px_2px_0_var(--color-ink)]',
              compact ? 'text-xl' : 'text-[1.7rem]',
            )}
          >
            {name}
          </h3>
          {draft.slogan.trim() && (
            <p className={cn('mt-1 font-display font-bold italic leading-snug', compact ? 'text-sm' : 'text-base')}>
              “{draft.slogan.trim()}”
            </p>
          )}
        </div>
      </div>
      {!compact && <p className="relative mt-3 rounded-xl border-2 border-ink bg-paper/90 px-3 py-2 text-sm leading-snug">{product.blurb}</p>}
      <div className="relative mt-3 flex flex-wrap items-center gap-2">
        {draft.price.trim() && (
          <span className="rotate-2 rounded-lg border-3 border-ink bg-white px-2 py-1 font-display text-sm font-extrabold shadow-hard-sm">
            🏷️ {draft.price.trim()}
          </span>
        )}
        {showAsk && (
          <span className="-rotate-1 rounded-lg border-3 border-ink bg-ink px-2 py-1 font-display text-sm font-extrabold text-sun shadow-hard-sm">
            Ask: {money(draft.ask)} for {draft.equity}%
          </span>
        )}
      </div>
      <div className="relative mt-3 inline-block max-w-full -rotate-2 rounded-md border-3 border-dashed border-ink bg-sun px-2 py-1 font-display text-xs font-black uppercase tracking-wide">
        ⚠️ Twist: {twist}
      </div>
    </div>
  )
}
