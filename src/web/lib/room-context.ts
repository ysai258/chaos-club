import type { ClientMessage, PlayerInfo, RoomSnapshot } from '../../shared/protocol.ts'
import type { GameInfo } from './api.ts'
import type { ConnStatus, RoomClient } from './room-client.ts'

/** Everything a room screen needs, passed down from RoomSession. */
export interface RoomView {
  room: RoomSnapshot
  me: PlayerInfo
  isHost: boolean
  host: PlayerInfo | undefined
  client: RoomClient
  /** Registered games (null while loading). */
  games: GameInfo[] | null
  /** Meta for room.gameId. */
  game: GameInfo | undefined
  status: ConnStatus
  joinedMidGame: boolean
  send: (msg: ClientMessage) => boolean
}
