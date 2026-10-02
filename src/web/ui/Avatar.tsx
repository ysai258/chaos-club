import type { TeamColor } from '../../shared/protocol.ts'
import { cn } from './cn.ts'
import { COLOR } from './colors.ts'

export interface AvatarProps {
  emoji: string
  /** Team colour ring/background. */
  color?: TeamColor
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  /** Shows a crown. */
  host?: boolean
  /** Dims the avatar and adds a sleepy badge when false. */
  connected?: boolean
  /** Name under the avatar. */
  name?: string
  /** Highlight ring, e.g. for the active player. */
  active?: boolean
  className?: string
}

const SIZE = {
  xs: 'size-7 text-base border-2',
  sm: 'size-9 text-xl border-2',
  md: 'size-12 text-2xl border-3',
  lg: 'size-16 text-4xl border-3',
  xl: 'size-24 text-6xl border-4',
}

/** Emoji in a sticker circle. */
export function Avatar({ emoji, color, size = 'md', host, connected = true, name, active, className }: AvatarProps) {
  return (
    <span className={cn('inline-flex min-w-0 flex-col items-center gap-1', className)}>
      <span
        className={cn(
          'relative grid shrink-0 place-items-center rounded-full border-ink leading-none',
          SIZE[size],
          color ? COLOR[color].soft : 'bg-white',
          active && 'outline-3 outline-offset-2 outline-ink animate-pulse-soft',
          !connected && 'opacity-45 grayscale',
        )}
        aria-label={name}
      >
        <span aria-hidden>{emoji}</span>
        {host && (
          <span className="absolute -top-2.5 -right-1.5 rotate-12 text-[0.55em] drop-shadow-[1px_1px_0_var(--color-ink)]" aria-label="host">
            👑
          </span>
        )}
        {!connected && (
          <span className="absolute -right-1 -bottom-1 rounded-full border-2 border-ink bg-white px-0.5 text-[0.4em]" aria-label="offline">
            💤
          </span>
        )}
      </span>
      {name && <span className="max-w-full truncate text-xs font-bold">{name}</span>}
    </span>
  )
}
