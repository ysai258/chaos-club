import type { ElementType, ReactNode } from 'react'
import type { TeamColor } from '../../shared/protocol.ts'
import { cn } from './cn.ts'
import { COLOR } from './colors.ts'

export interface BigTextProps {
  children: ReactNode
  /** Fill colour of the outlined letters. Default 'sun'. */
  color?: TeamColor | 'white' | 'ink'
  size?: 'md' | 'lg' | 'xl'
  /** 'chunky' = Rubik Mono One (logo style), 'display' = Bricolage (default). */
  font?: 'display' | 'chunky'
  /** Pops in on mount / whenever `key` changes. */
  animate?: boolean
  as?: ElementType
  className?: string
}

const SIZE = {
  md: 'text-3xl sm:text-4xl',
  lg: 'text-4xl sm:text-5xl',
  xl: 'text-5xl sm:text-7xl',
}

/** Shouty outlined headline: "BOOM!", "YOUR TURN", "Team Chai wins". */
export function BigText({ children, color = 'sun', size = 'lg', font = 'display', animate = true, as: Tag = 'h2', className }: BigTextProps) {
  const fill = color === 'white' ? 'text-white' : color === 'ink' ? 'text-ink' : COLOR[color].text
  return (
    <Tag
      className={cn(
        'leading-[0.95] break-words',
        font === 'chunky' ? 'font-chunky tracking-tight' : 'font-display font-extrabold',
        color !== 'ink' && 'text-outline [text-shadow:3px_3px_0_var(--color-ink)]',
        SIZE[size],
        fill,
        animate && 'animate-pop',
        className,
      )}
    >
      {children}
    </Tag>
  )
}
