import { useEffect, useRef, useState } from 'react'
import type { TeamColor, TeamInfo } from '../../../shared/protocol.ts'
import type { GameScreenProps } from '../types.ts'
import type { PwView } from '../../../games/pitch-wars/shared.ts'

export type Props = GameScreenProps<PwView>

/** lakh → "₹2.5 cr" / "₹50 L" */
export function money(lakh: number): string {
  if (lakh === 0) return '₹0'
  if (lakh < 100) return `₹${lakh} L`
  const cr = Math.round(lakh / 10) / 10
  return `₹${cr} cr`
}

export function teamColor(t: TeamInfo | undefined): TeamColor {
  return t?.color ?? 'sun'
}

/**
 * A text field mirrored to the server: local edits win while focused and are
 * sent debounced; server changes (a teammate typing) flow in when not focused.
 */
export function useSyncedText(server: string, send: (v: string) => void, delay = 350) {
  const [local, setLocal] = useState(server)
  const focused = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<string | null>(null)
  useEffect(() => {
    if (!focused.current && pending.current === null) setLocal(server)
  }, [server])
  const flush = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (pending.current !== null) send(pending.current)
    pending.current = null
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return {
    value: local,
    onChange: (v: string) => {
      setLocal(v)
      pending.current = v
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, delay)
    },
    onFocus: () => { focused.current = true },
    onBlur: () => { focused.current = false; flush() },
  }
}
