import type { GameInfo } from '../lib/api.ts'
import { Badge, COLOR, cn } from '../ui/index.ts'

const TILTS = ['-rotate-1', 'rotate-1', 'rotate-0', '-rotate-2', 'rotate-2', '-rotate-1']

/** A game as a sticker card. `selected` lifts it; `onClick` makes it a button. */
export function GameCard({ game, index = 0, selected, onClick, compact }: {
  game: GameInfo
  index?: number
  selected?: boolean
  onClick?: () => void
  compact?: boolean
}) {
  const m = game.meta
  const body = (
    <>
      <div className="flex items-start gap-3">
        <span className={cn('grid shrink-0 place-items-center rounded-2xl border-3 border-ink bg-white leading-none', compact ? 'size-11 text-2xl' : 'size-14 text-3xl')} aria-hidden>
          {m.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className={cn('font-display font-extrabold leading-tight', compact ? 'text-base' : 'text-xl')}>{m.name}</h3>
          {!compact && <p className="mt-0.5 text-sm leading-snug font-medium">{m.tagline}</p>}
        </div>
        {selected && <span className="shrink-0 animate-pop text-2xl" aria-label="selected">✅</span>}
      </div>
      {!compact && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge>👥 {m.minPlayers}–{m.maxPlayers}</Badge>
          <Badge>⏱ ~{m.estimatedMinutes} min</Badge>
          <Badge>{m.teams.min === m.teams.max ? `${m.teams.min} teams` : `${m.teams.min}–${m.teams.max} teams`}</Badge>
          {m.teamChat && <Badge>💬 team chat</Badge>}
        </div>
      )}
    </>
  )
  const classes = cn(
    'block w-full rounded-3xl border-3 border-ink text-left transition-transform duration-150',
    compact ? 'p-3' : 'p-4',
    COLOR[m.color].bg,
    // Compact cards sit in a tight grid: no tilt and no outline, so nothing overlaps a neighbour's tap area.
    selected
      ? cn('rotate-0 shadow-hard-lg', compact ? 'ring-3 ring-ink ring-inset' : 'outline-3 outline-offset-3 outline-ink')
      : cn('shadow-hard', !compact && TILTS[index % TILTS.length]),
  )
  if (!onClick) return <article className={classes} data-testid={`game-info-${game.id}`}>{body}</article>
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} data-testid={`game-card-${game.id}`} className={cn(classes, 'active:translate-x-1 active:translate-y-1 active:shadow-none')}>
      {body}
    </button>
  )
}
