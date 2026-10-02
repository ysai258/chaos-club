import { useEffect, useState } from 'react'
import type { ConnStatus } from '../lib/room-client.ts'
import { Spinner } from '../ui/index.ts'

/** Shows when the socket drops. Waits a beat so quick blips don't flash. */
export function ConnectionBanner({ status }: { status: ConnStatus }) {
  const down = status === 'reconnecting' || status === 'connecting'
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!down) return setShow(false)
    const t = setTimeout(() => setShow(true), 700)
    return () => clearTimeout(t)
  }, [down])
  if (!show) return null
  return (
    <div
      role="status"
      data-testid="connection-banner"
      className="fixed inset-x-0 top-0 z-[80] flex animate-slide-up items-center justify-center gap-3 border-b-3 border-ink bg-sun px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 font-display font-extrabold"
    >
      <span aria-hidden>📡</span> Reconnecting… <Spinner size="sm" />
    </div>
  )
}
