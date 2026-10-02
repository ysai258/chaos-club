import { createContext, useContext, useEffect, useState } from 'react'

/**
 * Server-corrected clock. The room provides it; outside a room it falls back
 * to Date.now. All deadlines from the server are server epoch ms, so
 * `deadline - now()` is the time left.
 */
export const ClockContext = createContext<() => number>(() => Date.now())

export function useClock(): () => number {
  return useContext(ClockContext)
}

/** Re-renders every `intervalMs` and returns the server-corrected now. */
export function useNow(intervalMs = 250): number {
  const now = useClock()
  const [t, setT] = useState(now)
  useEffect(() => {
    const id = setInterval(() => setT(now()), intervalMs)
    return () => clearInterval(id)
  }, [now, intervalMs])
  return t
}

export interface CountdownState {
  /** ms left, never negative. 0 when no deadline. */
  msLeft: number
  /** Whole seconds left, rounded up (shows 1 until it actually hits 0). */
  secondsLeft: number
  /** 1 → 0 across the phase. Total = time left when this deadline was first seen. */
  fraction: number
  /** True when there is a deadline and it is in the future. */
  running: boolean
}

/** Ticking countdown towards a server deadline. */
export function useCountdown(deadline: number | null, intervalMs = 100): CountdownState {
  const now = useNow(intervalMs)
  const [total, setTotal] = useState<{ deadline: number | null; total: number }>({ deadline: null, total: 1 })
  // Remember how long this deadline was when we first saw it, for the bar.
  if (deadline !== total.deadline) {
    setTotal({ deadline, total: deadline ? Math.max(1, deadline - now) : 1 })
  }
  if (deadline === null) return { msLeft: 0, secondsLeft: 0, fraction: 0, running: false }
  const msLeft = Math.max(0, deadline - now)
  return {
    msLeft,
    secondsLeft: Math.ceil(msLeft / 1000),
    fraction: Math.min(1, msLeft / total.total),
    running: msLeft > 0,
  }
}
