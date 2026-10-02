import type { GameMeta, SettingField } from '../../games/types.ts'

export interface GameInfo {
  id: string
  meta: GameMeta
  settingsSpec: SettingField[]
  /** The platform's own test game; hidden on the landing page. */
  testOnly?: boolean
}

export interface RoomSummary {
  code: string
  phase: 'lobby' | 'playing' | 'results'
  gameId: string
  players: number
}

let gamesPromise: Promise<GameInfo[]> | null = null

/** Meta + settings spec of every registered game. Cached for the session. */
export function fetchGames(): Promise<GameInfo[]> {
  gamesPromise ??= fetch('/api/games')
    .then((r) => {
      if (!r.ok) throw new Error(`games ${r.status}`)
      return r.json() as Promise<{ games: GameInfo[] }>
    })
    .then((b) => b.games)
    .catch((e: unknown) => {
      gamesPromise = null
      throw e
    })
  return gamesPromise
}

export async function createRoom(): Promise<string> {
  const r = await fetch('/api/rooms', { method: 'POST' })
  const body = (await r.json().catch(() => ({}))) as { code?: string; error?: string }
  if (!r.ok || !body.code) throw new Error(body.error ?? "Couldn't create a room. Try again?")
  return body.code
}

/** null when the room doesn't exist. Throws on network trouble. */
export async function fetchRoom(code: string): Promise<RoomSummary | null> {
  const r = await fetch(`/api/rooms/${encodeURIComponent(code)}`)
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`room ${r.status}`)
  return (await r.json()) as RoomSummary
}
