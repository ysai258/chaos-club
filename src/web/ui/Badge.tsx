import type { HTMLAttributes } from 'react'
import type { TeamColor } from '../../shared/protocol.ts'
import { cn } from './cn.ts'
import { COLOR } from './colors.ts'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  color?: TeamColor | 'ink' | 'white'
  size?: 'sm' | 'md'
}

/** Small sticker label: "HOST", "3 players", "+2". */
export function Badge({ color = 'white', size = 'sm', className, ...rest }: BadgeProps) {
  const bg = color === 'white' ? 'bg-white text-ink' : color === 'ink' ? 'bg-ink text-paper' : `${COLOR[color].bg} text-ink`
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border-2 border-ink font-display font-bold leading-none',
        size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
        bg,
        className,
      )}
      {...rest}
    />
  )
}
