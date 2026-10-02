/**
 * The Mole — view shapes and action names shared by server and web.
 * TYPES AND CONSTANTS ONLY. No content, no logic.
 */
import type { PlayerId, TeamId } from '../../shared/protocol.ts'

export type MolePhase = 'briefing' | 'challenge' | 'debrief' | 'verdict' | 'finalHunt' | 'unmasking'

export type ChallengeKind =
  | 'safe' | 'heist' | 'heat' | 'intel' | 'bribe' | 'ballpark' | 'code' | 'stock' | 'blind'

/** One labelled fact. `playerId` makes the UI render that player's chip next to/instead of `value`. */
export interface Fact {
  label: string
  value: string
  playerId?: PlayerId
  tone?: 'secret' | 'mole' | 'good' | 'bad'
}

export type InputSpec =
  | { type: 'number'; label: string; min: number; max: number; big?: boolean }
  | { type: 'choice'; label: string; options: { value: string; label: string }[]; columns?: 1 | 2 | 3 }
  | { type: 'multi'; label: string; options: { value: string; label: string; playerId?: PlayerId }[]; count: number }
  | { type: 'text'; label: string; maxLength: number; placeholder: string }
  | { type: 'digits'; label: string; length: number }

export interface BoardItem { text: string; by?: PlayerId }

/** What one player sees of their team's current challenge. */
export interface PlayView {
  kind: ChallengeKind
  name: string
  emoji: string
  rules: string[]
  /** Sent back in every `play` action; stale stages are rejected. */
  stage: string
  stageLabel: string
  /** Shared with the whole team. */
  facts: Fact[]
  /** Private to this viewer. */
  intel: Fact[]
  /** Only ever present in the mole's own view. */
  objective: string | null
  input: InputSpec | null
  /** Display of what this viewer already locked in. */
  mine: string | null
  board: { title: string; items: BoardItem[] } | null
  /** Teammates the challenge is still waiting on (not what they chose). */
  waitingOn: PlayerId[]
  note: string | null
}

export interface Evidence {
  success: boolean
  points: number
  headline: string
  facts: Fact[]
  /** Shuffled, unattributed lists. */
  anon: { title: string; items: string[] }[]
  /** Attributed rows. */
  named: { title: string; rows: { playerId: PlayerId; text: string }[] } | null
}

export interface Wiretap { by: PlayerId; target: PlayerId; text: string }

export interface AccusationResult {
  teamId: TeamId
  /** null = the team voted "we're clean" (paranoia mode final). */
  accused: PlayerId | null
  correct: boolean
  final: boolean
  points: number
  /** Only filled in for the viewer's own team. */
  votes: { voter: PlayerId; target: string }[]
}

export interface CaseEntry {
  round: number
  kind: ChallengeKind
  name: string
  emoji: string
  evidence: Evidence
  wiretap: Wiretap | null
  accusation: AccusationResult | null
  /** The team had too few players and sat this one out. */
  skipped?: boolean
}

export type MemberStatus = 'suspect' | 'cleared' | 'exposed'

export type RoleView =
  | { kind: 'loyal' }
  | { kind: 'mole'; employerTeamId: TeamId; hits: number }
  | { kind: 'turned'; employerTeamId: TeamId }
  | { kind: 'spectator' }

export interface UnmaskTeam {
  teamId: TeamId
  moleId: PlayerId | null
  employerTeamId: TeamId | null
  fate: 'caught' | 'final' | 'escaped' | 'clean' | 'clean-missed'
  caughtRound: number | null
  hits: { round: number; name: string; emoji: string }[]
  payouts: { label: string; teamId: TeamId; points: number }[]
}

export interface MoleView {
  phase: MolePhase
  /** 1-based. */
  round: number
  totalRounds: number
  myTeamId: TeamId | null
  isHost: boolean
  role: RoleView
  paranoia: boolean
  team: {
    members: { id: PlayerId; status: MemberStatus; gone: boolean }[]
    badges: number
    moleCaught: boolean
  } | null
  /** Briefing + challenge. */
  play: PlayView | null
  rivals: { teamId: TeamId; done: boolean; success: boolean | null; points: number | null }[]
  debrief: {
    evidence: Evidence | null
    wiretap: Wiretap | null
    canWiretap: boolean
    wiretapCost: number
    canAccuse: boolean
    votes: { voter: PlayerId; target: string }[]
    /** For each accusable teammate: votes needed to convict. */
    needed: { playerId: PlayerId; needed: number }[]
    voters: PlayerId[]
  } | null
  verdicts: AccusationResult[]
  finalHunt: {
    required: boolean
    options: PlayerId[]
    allowClean: boolean
    myVote: string | null
    voted: PlayerId[]
    voters: PlayerId[]
  } | null
  unmasking: UnmaskTeam[] | null
  caseFile: CaseEntry[]
  scoring: { win: number; catch: number; wrong: number; finalCatch: number; escape: number; sabotage: number }
}

/** Client → server action types (payload always carries `round`). */
export type MoleActionType = 'play' | 'vote' | 'wiretap' | 'finalVote' | 'finish'
