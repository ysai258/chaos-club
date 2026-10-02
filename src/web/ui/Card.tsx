import type { HTMLAttributes } from 'react'
import type { TeamColor } from '../../shared/protocol.ts'
import { cn } from './cn.ts'
import { COLOR } from './colors.ts'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Background: a palette colour, its soft tint, white (default) or paper. */
  color?: TeamColor | 'white' | 'paper' | 'ink'
  soft?: boolean
  /** Slight sticker rotation. */
  tilt?: 'left' | 'right' | 'none'
  shadow?: 'none' | 'sm' | 'md' | 'lg'
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

const TILT = { left: '-rotate-1', right: 'rotate-1', none: '' }
const SHADOW = { none: '', sm: 'shadow-hard-sm', md: 'shadow-hard', lg: 'shadow-hard-lg' }
const PAD = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-6' }

/** A sticker: thick outline, hard shadow, optional tilt. */
export function Card({ color = 'white', soft, tilt = 'none', shadow = 'md', padding = 'md', className, ...rest }: CardProps) {
  const bg =
    color === 'white' ? 'bg-white' : color === 'paper' ? 'bg-paper' : color === 'ink' ? 'bg-ink text-paper' : soft ? COLOR[color].soft : COLOR[color].bg
  return <div className={cn('rounded-3xl border-3 border-ink', bg, TILT[tilt], SHADOW[shadow], PAD[padding], className)} {...rest} />
}
