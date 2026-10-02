/**
 * The contract every game implements. Server side only.
 *
 * The platform (rooms, teams, sockets, timers, chat, scoreboard) knows nothing
 * about any particular game. It calls these methods and broadcasts `view`
 * output to each viewer. Adding a game = a folder under src/games/<id>/ plus
 * one line in src/games/registry.ts and src/web/games/registry.ts.
 *
 * RULES
 * - Reducers are pure: no Date.now(), no Math.random(), no I/O. Use ctx.now and
 *   ctx.random. Return a new state; never mutate the old one in place.
 * - `view` is the ONLY place hidden information is filtered. Omit secrets the
 *   viewer may not see (do not send them with a "hidden" flag).
 * - Content (word lists, bomb rules, cases...) lives in src/games/<id>/ server
 *   files and must never be imported by anything under src/web/.
 * - Reject illegal actions by returning { error } — never throw for user input.
 */
import type { PlayerId, TeamId, TeamColor, GameResults } from '../shared/protocol.ts'

export interface GamePlayer {
  id: PlayerId
  name: string
  avatar: string
  teamId: TeamId
  connected: boolean
}

export interface GameTeam {
  id: TeamId
  name: string
  color: TeamColor
  playerIds: PlayerId[]
}

export interface BaseCtx {
  /** Authoritative server time, epoch ms. */
  now: number
  /** Seeded PRNG in [0, 1). Deterministic per call; use for all randomness. */
  random: () => number
  players: GamePlayer[]
  teams: GameTeam[]
  hostId: PlayerId
}

export interface CreateCtx<Settings> extends BaseCtx {
  settings: Settings
}

export interface GameAction {
  type: string
  payload: Record<string, unknown>
}

export interface GameEvent {
  /** e.g. 'boom', 'defused', 'buzz', 'correct'. The web UI of that game interprets it. */
  type: string
  data?: Record<string, unknown>
  /** Who should receive it. Default: everyone. */
  to?: { teamId: TeamId } | { playerIds: PlayerId[] }
}

export interface Step<S> {
  state: S
  events?: GameEvent[]
  /** Set to reject an action. The state is then ignored and the player gets an error toast. */
  error?: string
}

export type SettingField =
  | { key: string; label: string; kind: 'number'; min: number; max: number; step?: number; default: number }
  | { key: string; label: string; kind: 'select'; options: { value: string; label: string }[]; default: string }
  | { key: string; label: string; kind: 'toggle'; default: boolean }

export interface GameMeta {
  name: string
  emoji: string
  /** One punchy line for the game card. */
  tagline: string
  /** 3-6 short bullet sentences shown in the lobby "How to play". */
  howToPlay: string[]
  minPlayers: number
  maxPlayers: number
  /** Allowed team counts. Most games: { min: 2, max: 2 }. */
  teams: { min: number; max: number }
  /** Minimum players per team for the game to start. */
  minTeamSize: number
  estimatedMinutes: number
  /** Whether the platform shows the private team chat panel during this game. */
  teamChat: boolean
  /** Card accent color. */
  color: TeamColor
}

export interface GameDefinition<S = unknown, Settings extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  meta: GameMeta
  settingsSpec: SettingField[]
  /** Coerce/validate untrusted settings from the host; fill defaults. */
  parseSettings(raw: Record<string, unknown>): Settings

  create(ctx: CreateCtx<Settings>): S

  /** Per-viewer payload. JSON-serialisable. Secrets the viewer may not know must be absent. */
  view(state: S, viewerId: PlayerId, ctx: BaseCtx): unknown

  /** Handle a player action. Validate everything — payloads are untrusted. */
  action(state: S, playerId: PlayerId, action: GameAction, ctx: BaseCtx): Step<S>

  /** Epoch ms when `tick` must be called, or null when waiting on people. */
  deadline(state: S): number | null

  /** Called by the platform once `deadline` has passed. May chain (platform re-checks deadline). */
  tick(state: S, ctx: BaseCtx): Step<S>

  /**
   * A player disconnected for longer than the grace period (30s) or was kicked.
   * The game must never get stuck waiting for them (skip their turn, reassign their role...).
   */
  onPlayerGone(state: S, playerId: PlayerId, ctx: BaseCtx): Step<S>

  /** Cumulative team scores right now. */
  scores(state: S): Record<TeamId, number>

  isOver(state: S): boolean

  /** Called once when isOver becomes true. Ranking is computed by the platform from `scores` if omitted. */
  results(state: S, ctx: BaseCtx): Pick<GameResults, 'highlights' | 'awards'>
}

/** Erased form held by the registry. */
export type AnyGame = GameDefinition<any, any>
