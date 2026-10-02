/**
 * Contract for a game's screen in the browser.
 *
 * The platform renders the room chrome (header with room code, team
 * scoreboard, timer bar, team chat drawer, connection banner) and puts the
 * game's <Screen> in the middle. The screen gets this viewer's `view` (whatever
 * the server-side GameDefinition.view returned) and a `send` function.
 *
 * Never import anything from src/games/<id>/ except a `shared.ts` file that
 * holds TYPES ONLY (view shapes, action names). Content and logic stay on the server.
 */
import type { ComponentType } from 'react'
import type { PlayerInfo, RoomSnapshot, TeamInfo, PlayerId, TeamId } from '../../shared/protocol.ts'

export interface GameScreenProps<View = unknown> {
  view: View
  me: PlayerInfo
  players: PlayerInfo[]
  teams: TeamInfo[]
  /** Server-corrected epoch ms deadline of the current phase, or null. */
  deadline: number | null
  scores: Record<TeamId, number>
  /** Send a game action. Resolves when the server acks or rejects (errors also toast automatically). */
  send: (type: string, payload?: Record<string, unknown>) => void
  /** Subscribe to game events ('boom', 'buzz', ...). Returns unsubscribe. */
  onEvent: (handler: (type: string, data: Record<string, unknown>) => void) => () => void
  /** Server-corrected Date.now(). */
  now: () => number
  player: (id: PlayerId) => PlayerInfo | undefined
  team: (id: TeamId) => TeamInfo | undefined
  room: RoomSnapshot
}

export interface WebGame {
  id: string
  Screen: ComponentType<GameScreenProps<any>>
}
