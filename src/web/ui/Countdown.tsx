import { useEffect, useRef } from 'react'
import { cn } from './cn.ts'
import { useCountdown } from './clock.ts'
import { playSound } from './feedback.ts'

export interface CountdownProps {
  /** Server epoch ms (as in GameScreenProps.deadline). null hides it. */
  deadline: number | null
  /** 'bar' = full-width draining bar, 'badge' = number sticker, 'big' = giant number. */
  variant?: 'bar' | 'badge' | 'big'
  /** Turns red and shakes under this many seconds. Default 5. */
  warnAt?: number
  /** Tick sound each second inside the warning zone. Default false. */
  tickSound?: boolean
  className?: string
}

/** Time left until a server deadline. Uses the room's server-corrected clock. */
export function Countdown({ deadline, variant = 'bar', warnAt = 5, tickSound = false, className }: CountdownProps) {
  const { secondsLeft, fraction, running } = useCountdown(deadline)
  const warn = running && secondsLeft <= warnAt
  const lastTick = useRef<number | null>(null)
  useEffect(() => {
    if (tickSound && warn && lastTick.current !== secondsLeft) playSound('tick')
    lastTick.current = secondsLeft
  }, [secondsLeft, warn, tickSound])

  if (deadline === null) return null
  const label = `${secondsLeft} seconds left`

  if (variant === 'bar') {
    return (
      <div
        role="timer"
        aria-label={label}
        className={cn('relative h-4 w-full overflow-hidden rounded-full border-3 border-ink bg-white', warn && 'animate-shake', className)}
      >
        <div
          className={cn('h-full origin-left transition-[width] duration-100 ease-linear', warn ? 'bg-tomato' : fraction > 0.5 ? 'bg-lime' : 'bg-sun')}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    )
  }
  if (variant === 'big') {
    return (
      <div
        role="timer"
        aria-label={label}
        key={warn ? secondsLeft : 'calm'}
        className={cn(
          'font-chunky text-7xl leading-none tabular-nums text-outline-thick',
          warn ? 'animate-pop text-tomato' : 'text-sun',
          className,
        )}
      >
        {secondsLeft}
      </div>
    )
  }
  return (
    <span
      role="timer"
      aria-label={label}
      className={cn(
        'inline-flex h-9 min-w-12 items-center justify-center gap-1 rounded-full border-3 border-ink px-2.5 font-display font-extrabold tabular-nums',
        warn ? 'animate-pulse-soft bg-tomato' : 'bg-white',
        className,
      )}
    >
      <span aria-hidden>⏱</span>
      {secondsLeft}s
    </span>
  )
}
