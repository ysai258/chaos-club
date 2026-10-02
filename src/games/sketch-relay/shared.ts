/**
 * Silent Sketch Relay — view shapes and action names shared with the web UI.
 * TYPES ONLY. No content, no logic: the web bundle imports this.
 */
import type { PlayerId, TeamId } from '../../shared/protocol.ts'

export type Difficulty = 'easy' | 'medium' | 'hard'
export type BrushSize = 's' | 'm' | 'l'

export type ModifierId = 'fog' | 'blitz' | 'drought' | 'flip' | 'fat'

export interface ModifierInfo {
  id: ModifierId
  name: string
  emoji: string
  blurb: string
}

export type Phase = 'pick' | 'draw' | 'lastCall' | 'reveal' | 'gallery' | 'over'

/**
 * - drawer: on the drawing team, sees the prompt, takes strokes, cannot guess.
 * - seer: on the drawing team but blindfolded this round; races the rivals to guess.
 * - rival: on another team; guesses to steal.
 */
export type Role = 'drawer' | 'seer' | 'rival' | 'spectator'

export interface StrokeView {
  /** Drawer. */
  by: PlayerId
  /** CSS colour. */
  c: string
  /** Width in canvas units. */
  w: number
  /** Flattened integer points [x0,y0,x1,y1,...] in 0..CANVAS. */
  p: number[]
}

export interface OptionView {
  index: number
  text: string
  difficulty: Difficulty
  points: number
}

export interface TurnView {
  /** Changes every turn. Ink must carry it. */
  id: number
  drawerId: PlayerId
  startedAt: number
  deadline: number
  /** Max path length of this stroke, canvas units. */
  inkMax: number
  /** Ink used so far by the live stroke. */
  inkUsed: number
  /** Whether the current drawer's canvas is upside down (Topsy-Turvy). */
  flipped: boolean
}

export interface GuessView {
  id: number
  playerId: PlayerId
  teamId: TeamId
  text: string
}

export interface RoundResultView {
  prompt: string
  difficulty: Difficulty
  drawingTeamId: TeamId
  /** Team that guessed it first, or null when nobody did. */
  winnerTeamId: TeamId | null
  winnerPlayerId: PlayerId | null
  /** True when a rival team guessed it (a steal). */
  steal: boolean
  points: number
  strokesUsed: number
  /** The guess as typed by the winner. */
  winningGuess: string | null
}

export interface GalleryItem {
  round: number
  prompt: string
  drawingTeamId: TeamId
  seerId: PlayerId | null
  modifier: ModifierId | null
  strokes: StrokeView[]
  result: RoundResultView
}

export interface SketchView {
  phase: Phase
  /** 0-based round index. Every action carries it. */
  round: number
  totalRounds: number
  role: Role
  drawingTeamId: TeamId
  seerId: PlayerId | null
  drawerOrder: PlayerId[]
  /** Who chooses the prompt in the pick phase. */
  pickerId: PlayerId | null
  colors: Record<PlayerId, string>
  myColor: string | null
  modifier: ModifierInfo | null
  /** Chosen prompt's difficulty, public once picked. */
  difficulty: Difficulty | null
  /** Points the prompt is worth right now (shrinks with every stroke). */
  pointsNow: number
  /** Drawers only, during pick. */
  options: OptionView[] | null
  /** Drawers only while drawing; everyone at reveal. */
  prompt: string | null
  turn: TurnView | null
  strokesUsed: number
  strokesMax: number
  /** Committed strokes. Under Fog of War, drawers only get the latest few. */
  strokes: StrokeView[]
  /** How many strokes were hidden from this viewer by Fog of War. */
  fogHidden: number
  /** Stroke being drawn right now. */
  live: StrokeView | null
  /** Recent wrong guesses, newest last. */
  guesses: GuessView[]
  /** Whether this viewer may type a guess now. */
  canGuess: boolean
  result: RoundResultView | null
  /** Only in the gallery phase. */
  gallery: GalleryItem[] | null
  isHost: boolean
}

/**
 * Actions (client -> server), every one carries `round`:
 * - pick  { round, index }
 * - ink   { round, turn, seq, pts: number[], end?: boolean, size?: BrushSize }
 * - pass  { round, turn }
 * - guess { round, text }
 * - finish {} (host, gallery)
 * Events (server -> client): yourTurn, correct, stumped, wrong, close, frozen, roundStart.
 */
export interface SketchSettings extends Record<string, unknown> {
  roundsPerTeam: number
  strokesPerRound: number
  secondsPerStroke: number
  chaos: boolean
}
