/**
 * Pitch Wars — view shapes and action names shared by server and web.
 * TYPES ONLY. No content, no logic: the web bundle may import this file.
 *
 * Money is in lakh (integer). 100 lakh = ₹1 crore.
 */
import type { PlayerId, TeamId } from '../../shared/protocol.ts'

export type PwPhase = 'prep' | 'stage' | 'pitch' | 'invest' | 'reveal' | 'over'

export interface PwProduct { title: string; blurb: string }

export interface PwDraft {
  name: string
  slogan: string
  price: string
  mascot: string
  /** The Ask, lakh. */
  ask: number
  /** Equity offered, percent. Flavour. */
  equity: number
}

export interface PwFired {
  id: string
  text: string
  byTeamId: TeamId
  byPlayerId: PlayerId
  at: number
}

export interface PwCheque {
  playerId: PlayerId
  teamId: TeamId
  /** null = never signed the cheque (abstained / asleep). */
  amount: number | null
}

export interface PwPitchRecord {
  round: number
  teamId: TeamId
  pitcherId: PlayerId | null
  product: PwProduct
  twist: string
  draft: PwDraft
  questions: PwFired[]
  curveball: PwFired | null
  cheques: PwCheque[]
  /** Average cheque per shark team, lakh. */
  byTeam: { teamId: TeamId; amount: number }[]
  total: number
  deal: boolean
  points: number
  /** The whole team vanished before pitching. */
  skipped: boolean
}

export interface PwTeamPublic {
  id: TeamId
  pitcherId: PlayerId | null
  ready: boolean
  folded: boolean
  pitchedThisRound: boolean
}

export interface PwMyTeam {
  teamId: TeamId
  product: PwProduct
  twist: string
  draft: PwDraft
  ready: boolean
  pitcherId: PlayerId | null
  redraws: { product: number; twist: number }
}

export interface PwOnStage {
  teamId: TeamId
  pitcherId: PlayerId | null
  product: PwProduct
  twist: string
  draft: PwDraft
  questions: PwFired[]
  curveball: PwFired | null
}

export interface PwSharkHand {
  questions: { id: string; text: string; fired: boolean }[]
  firesLeft: number
  /** Curveball options this round; empty once used this round. */
  curveballs: { id: string; text: string }[]
  canCurveball: boolean
}

export interface PwInvest {
  sharkIds: PlayerId[]
  lockedIds: PlayerId[]
  /** Your own locked cheque, if you're a shark and signed one. */
  mine: number | null
  /** Your wallet left this round, lakh. */
  wallet: number
}

export type PwRole = 'pitching' | 'shark' | 'spectator'

export interface PwView {
  phase: PwPhase
  /** Echo in every action payload as `stage`. Stale actions are rejected. */
  stage: number
  round: number
  rounds: number
  order: TeamId[]
  currentTeamId: TeamId | null
  role: PwRole
  myTeamId: TeamId | null
  teams: PwTeamPublic[]
  askOptions: number[]
  equityOptions: number[]
  mascots: string[]
  /** Wallet each shark gets per round, lakh. */
  walletPerRound: number
  myTeam: PwMyTeam | null
  onStage: PwOnStage | null
  sharkHand: PwSharkHand | null
  invest: PwInvest | null
  /** The pitch being revealed (phase reveal). */
  reveal: PwPitchRecord | null
  history: PwPitchRecord[]
  /** lakh per team */
  money: Record<TeamId, number>
}

/** Action types the web may send. */
export type PwActionType =
  | 'draft'      // { stage, ...Partial<PwDraft> }
  | 'redraw'     // { stage, card: 'product' | 'twist' }
  | 'ready'      // { stage, ready: boolean }
  | 'takeMic'    // { stage }
  | 'start'      // { stage }  pitcher skips the stage countdown
  | 'done'       // { stage }  pitcher ends the pitch early
  | 'fire'       // { stage, id }
  | 'curveball'  // { stage, id }
  | 'invest'     // { stage, amount }
  | 'next'       // { stage }  host skips the reveal
