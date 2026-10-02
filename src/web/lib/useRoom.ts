import { useEffect, useState, useSyncExternalStore } from 'react'
import { RoomClient, type ClientState } from './room-client.ts'
import type { Profile } from './storage.ts'

const IDLE: ClientState = { status: 'connecting', room: null, playerId: null, fatal: null, joinedMidGame: false }

/** Connects to a room for as long as the component is mounted. */
export function useRoomClient(code: string, profile: Profile): { client: RoomClient | null; state: ClientState } {
  const [client, setClient] = useState<RoomClient | null>(null)
  useEffect(() => {
    const c = new RoomClient(code, profile)
    setClient(c)
    return () => c.close()
    // Profile changes don't reconnect: the seat is keyed by token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])
  const state = useSyncExternalStore(
    (cb) => client?.subscribe(cb) ?? (() => {}),
    () => client?.getState() ?? IDLE,
    () => IDLE,
  )
  return { client, state }
}
