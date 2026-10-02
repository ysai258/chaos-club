import type { TeamInfo } from '../../shared/protocol.ts'
import { cn } from './cn.ts'
import { COLOR } from './colors.ts'

export interface TeamPillProps {
  team: Pick<TeamInfo, 'name' | 'emoji' | 'color'>
  score?: number
  /** e.g. whose turn it is: lifts and wiggles the pill. */
  active?: boolean
  /** Hide the name, show only emoji (+ score). For tight headers. */
  compact?: boolean
  size?: 'sm' | 'md'
  className?: string
}

/** Team name sticker with an optional score bubble. */
export function TeamPill({ team, score, active, compact, size = 'md', className }: TeamPillProps) {
  return (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border-3 border-ink font-display font-extrabold',
        COLOR[team.color].bg,
        size === 'sm' ? 'h-9 pl-2 pr-1 text-sm' : 'h-11 pl-3 pr-1.5 text-base',
        active ? '-translate-y-0.5 shadow-hard animate-wiggle' : 'shadow-hard-sm',
        score === undefined && (size === 'sm' ? 'pr-3' : 'pr-4'),
        className,
      )}
      title={team.name}
    >
      <span aria-hidden className="shrink-0">{team.emoji}</span>
      {!compact && <span className="truncate">{team.name}</span>}
      {score !== undefined && (
        <span
          key={score}
          className={cn(
            'grid shrink-0 animate-pop place-items-center rounded-full border-2 border-ink bg-white tabular-nums',
            size === 'sm' ? 'h-6 min-w-6 px-1 text-xs' : 'h-7 min-w-7 px-1.5 text-sm',
          )}
          aria-label={`${score} points`}
        >
          {score}
        </span>
      )}
    </span>
  )
}
