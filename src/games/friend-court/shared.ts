/**
 * Friend Court — TYPES ONLY. Shared by the server engine and the web screen.
 * No content, no logic: the web bundle may import this file.
 */
import type { PlayerId, TeamId } from '../../shared/protocol.ts'

export type Side = 'prosecution' | 'defence'
export type CourtPhase = 'reveal' | 'speech' | 'deliberation' | 'verdict' | 'over'
export type CourtRole = 'judge' | 'prosecution' | 'defence' | 'jury' | 'watcher'
export type SpeechKind = 'p-open' | 'd-open' | 'p-close' | 'd-close'

export interface CardView {
  uid: string
  kind: 'exhibit' | 'witness'
  emoji: string
  text: string
  /** Set when a teammate slipped this card to you as a note. */
  fromId?: PlayerId
}

export interface RecordEntry {
  /** Exhibit letter, A, B, C... */
  letter: string
  kind: 'exhibit' | 'witness'
  emoji: string
  text: string
  byId: PlayerId
  side: Side
  struck: boolean
  viaNoteFromId?: PlayerId
}

export interface SpeechSlotView {
  kind: SpeechKind
  side: Side
  label: string
  speakerId: PlayerId | null
  status: 'done' | 'live' | 'next' | 'skipped'
}

export interface CaseView {
  no: number
  title: string
  /** Full sentence: "The State vs. Ravi — accused of ..." already rendered with names. */
  charge: string
  accusedId: PlayerId
  victimId: PlayerId | null
  prosecutionTeamId: TeamId
  defenceTeamId: TeamId
  judgeId: PlayerId | null
  /** 'judge' = the judge alone decides (2 teams). 'jury' = neutral teams vote (3+ teams). */
  verdictBy: 'judge' | 'jury'
  juryIds: PlayerId[]
  objectionsLeft: Record<Side, number>
  mistrial: boolean
}

export interface ObjectionView {
  byId: PlayerId
  side: Side
  reason: string
  endsAt: number
}

export interface VerdictView {
  guilty: boolean
  mistrial: boolean
  sentence: string
  decidedBy: 'judge' | 'jury' | 'auto'
  tally: { guilty: number; notGuilty: number } | null
  points: Record<TeamId, number>
  /** Players who got the most "respect" votes from the other side this case. */
  respected: PlayerId[]
}

export interface YouView {
  role: CourtRole
  side: Side | null
  hand: CardView[]
  canPlay: boolean
  canObject: boolean
  canPassNote: boolean
  canRule: boolean
  canBegin: boolean
  playedThisSpeech: number
  /** Deliberation: what the viewer still has to do. */
  mustVote: 'verdict' | 'respect' | null
  /** Judge only, during deliberation. */
  sentenceOptions?: { guilty: string[]; notGuilty: string[] }
  /** Respect ballot targets (players on the other side), during deliberation. */
  respectTargets?: PlayerId[]
  myBallot: { guilty: boolean | null; respectId: PlayerId | null }
}

export interface HistoryItem {
  no: number
  title: string
  accusedId: PlayerId
  guilty: boolean
  mistrial: boolean
  sentence: string
}

export interface FriendCourtView {
  seq: number
  phase: CourtPhase
  caseNo: number
  caseCount: number
  phaseEndsAt: number | null
  case: CaseView | null
  you: YouView
  speeches: SpeechSlotView[]
  speechIdx: number
  /** Speaker time left, frozen while an objection is pending. */
  speechRemainingMs: number | null
  objection: ObjectionView | null
  record: RecordEntry[]
  deliberation: { doneIds: PlayerId[]; waitingIds: PlayerId[] } | null
  verdict: VerdictView | null
  history: HistoryItem[]
  rules: { maxPerSpeech: number; winPoints: number; exhibitPoints: number; objectionPoints: number }
}

/** Action types sent by the web client. Every payload carries `seq`. */
export type FriendCourtAction =
  | { type: 'begin'; payload: { seq: number } }
  | { type: 'play'; payload: { seq: number; uid: string } }
  | { type: 'note'; payload: { seq: number; uid: string } }
  | { type: 'rest'; payload: { seq: number } }
  | { type: 'object'; payload: { seq: number } }
  | { type: 'rule'; payload: { seq: number; sustained: boolean } }
  | { type: 'verdict'; payload: { seq: number; guilty: boolean; sentence?: number } }
  | { type: 'respect'; payload: { seq: number; playerId: PlayerId } }
  | { type: 'react'; payload: { seq: number; emoji: string } }

export const REACTIONS = ['👏', '😂', '🍅', '😱', '🔥', '🤡'] as const
