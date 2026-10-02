/**
 * Wire protocol between the browser and the server.
 *
 * The server owns all truth. A client sends intents (`ClientMessage`) and
 * renders whatever `ServerMessage` tells it. Every `room` snapshot is built
 * for one specific viewer, so a secret that viewer may not see is absent from
 * the bytes, not flagged as hidden.
 */

export type PlayerId = string
export type TeamId = string

export interface PlayerInfo {
  id: PlayerId
  name: string
  /** One emoji, picked at join. */
  avatar: string
  teamId: TeamId | null
  connected: boolean
  isHost: boolean
}

export interface TeamInfo {
  id: TeamId
  /** Silly auto-generated name, the host can rename. e.g. "The Spicy Pickles". */
  name: string
  emoji: string
  /** A CSS color token name from the design system: 'tomato' | 'sky' | 'lime' | 'grape' | 'sun' | 'bubblegum'. */
  color: TeamColor
  playerIds: PlayerId[]
}

export type TeamColor = 'tomato' | 'sky' | 'lime' | 'grape' | 'sun' | 'bubblegum'

export type RoomPhase = 'lobby' | 'playing' | 'results'

export interface ChatMessage {
  id: string
  playerId: PlayerId
  text: string
  at: number
}

/** What one viewer receives. Built fresh per viewer on every change. */
export interface RoomSnapshot {
  code: string
  phase: RoomPhase
  you: PlayerId
  players: PlayerInfo[]
  teams: TeamInfo[]
  /** Game chosen in the lobby (or being played). */
  gameId: string
  /** Current settings for `gameId`, validated by the game. */
  settings: Record<string, unknown>
  /** Present while phase === 'playing' or 'results'. */
  game: {
    /** Output of GameDefinition.view for this viewer. */
    view: unknown
    /** Epoch ms when the current game phase auto-advances, or null. */
    deadline: number | null
    /** Cumulative score per team in this game. */
    scores: Record<TeamId, number>
  } | null
  /** Present in phase === 'results'. */
  results: GameResults | null
  /** Messages of the viewer's own team only. Empty when the game disables team chat. */
  teamChat: ChatMessage[]
  /** Server clock at the moment this snapshot was built, for clock-offset correction. */
  serverNow: number
}

export interface GameResults {
  /** Team ids ordered best first. Ties share a rank. */
  ranking: { teamId: TeamId; score: number; rank: number }[]
  /** Short funny lines for the results screen, e.g. "Ravi cut the wrong wire 4 times". */
  highlights: string[]
  /** Optional per-player awards. */
  awards?: { playerId: PlayerId; title: string; emoji: string }[]
}

export type ClientMessage =
  | { t: 'hello'; code: string; token: string | null; name: string; avatar: string }
  | { t: 'room/setTeams'; count: number }
  | { t: 'room/shuffleTeams' }
  | { t: 'room/movePlayer'; playerId: PlayerId; teamId: TeamId }
  | { t: 'room/renameTeam'; teamId: TeamId; name: string }
  | { t: 'room/pickGame'; gameId: string }
  | { t: 'room/settings'; settings: Record<string, unknown> }
  | { t: 'room/start' }
  | { t: 'room/playAgain' }
  | { t: 'room/backToLobby' }
  | { t: 'room/kick'; playerId: PlayerId }
  | { t: 'room/teamChat'; text: string }
  | { t: 'game'; type: string; payload: Record<string, unknown> }
  | { t: 'ping' }

export type ServerMessage =
  /** Sent once after hello. Store the token in localStorage for reconnects. */
  | { t: 'welcome'; token: string; playerId: PlayerId }
  | { t: 'room'; room: RoomSnapshot }
  /** A game event worth a toast/sound/animation. `data` is game-specific. */
  | { t: 'event'; type: string; data: Record<string, unknown>; at: number }
  | { t: 'error'; code: string; message: string }
  | { t: 'pong'; serverNow: number }
