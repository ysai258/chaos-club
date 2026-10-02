/**
 * Overheard — view and action shapes shared by the server and the web screen.
 * TYPES ONLY. The web imports this file; content and logic stay on the server.
 */

export type Digit = 1 | 2 | 3 | 4

export type Phase = 'encrypt' | 'transmit' | 'guess' | 'reveal' | 'tiebreak' | 'over'

/** What the viewer is doing during the current transmission. */
export type Role = 'encryptor' | 'decoder' | 'interceptor' | 'listener' | 'spectator'

/** One finished transmission. Public to everyone once revealed. */
export interface HistoryRow {
  round: number
  encryptorId: string
  clues: string[]
  code: Digit[]
  decodeGuess: Digit[] | null
  interceptGuess: Digit[] | null
  /** null when the team had nobody left to decode. */
  decoded: boolean | null
  /** null when interception was closed (round 1) or nobody tried. */
  intercepted: boolean | null
}

export interface TeamPublic {
  id: string
  /** Interception tokens ("wiretaps") this team has earned. Two wins. */
  wiretaps: number
  /** Miscommunication tokens ("static") this team has suffered. Two loses. */
  static: number
  /** This round's encryptor. */
  encryptorId: string | null
  /** Whether this round's encryptor has sent their clues. */
  submitted: boolean
  history: HistoryRow[]
}

export interface GuessDraft {
  slots: (Digit | null)[]
  locked: boolean
  lockedBy: string | null
  editedBy: string | null
}

export interface TransmissionView {
  teamId: string
  encryptorId: string | null
  /** Clues revealed so far (all three once guessing starts). */
  clues: string[]
  role: Role
  /** The viewer's team's guess for this transmission (decode or intercept). */
  myGuess: GuessDraft | null
  /** Which teams have locked a guess. Public. */
  locked: Record<string, boolean>
  /** Which teams are expected to guess on this transmission. */
  guessing: Record<string, boolean>
  interceptOpen: boolean
}

export interface TiebreakView {
  myDraft: string[] | null
  myLocked: boolean
  locked: Record<string, boolean>
}

export interface OutcomeView {
  winner: string | null
  reason: string
  tiebreak: { teamId: string; guesses: string[]; correct: boolean[] }[] | null
  keywords: Record<string, string[]>
}

export interface OverheardView {
  /** Echo this in every action. Bumps on every phase change. */
  turn: number
  round: number
  maxRounds: number
  phase: Phase
  myTeamId: string | null
  rivalTeamId: string | null
  /** The two team ids, in this round's transmission order. */
  order: string[]
  /** Index into `order` of the transmission being played (transmit/guess/reveal). */
  active: number
  teams: TeamPublic[]
  /** The viewer's team's keywords, 1–4. Absent for the rival and spectators. */
  myKeywords: string[] | null
  /** Shared team notes about the rival's keywords 1–4. Own team only. */
  notes: string[] | null
  /** The secret code. Only the encryptor, only until it is revealed. */
  myCode: Digit[] | null
  /** The encryptor's own unsent clue draft. */
  myClueDraft: string[] | null
  /** The encryptor's own sent clues, so they can read them aloud. */
  myClues: string[] | null
  transmission: TransmissionView | null
  /** The result shown during the reveal phase. */
  reveal: (HistoryRow & { teamId: string }) | null
  tiebreak: TiebreakView | null
  outcome: OutcomeView | null
  isHost: boolean
  interceptFromRound: number
}

export type OverheardAction =
  | { type: 'clue:draft'; payload: { turn: number; clues: string[] } }
  | { type: 'clue:submit'; payload: { turn: number; clues: string[] } }
  | { type: 'clue:reveal'; payload: { turn: number; index: number } }
  | { type: 'guess:set'; payload: { turn: number; slots: (number | null)[] } }
  | { type: 'guess:lock'; payload: { turn: number; slots: number[] } }
  | { type: 'note:set'; payload: { index: number; text: string } }
  | { type: 'reveal:next'; payload: { turn: number } }
  | { type: 'tiebreak:set'; payload: { turn: number; words: string[] } }
  | { type: 'tiebreak:lock'; payload: { turn: number; words: string[] } }
