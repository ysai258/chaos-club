/**
 * Bomb Squad — TYPES ONLY. Shared by the server game and the web screen.
 * No values, no content, no rules here: the web bundle may import this file.
 */

export type ModuleKind = 'wires' | 'button' | 'glyphs' | 'saywhat' | 'wheels' | 'disco'
export type WireColor = 'red' | 'blue' | 'yellow' | 'green' | 'black' | 'white'
export type ButtonColor = 'red' | 'blue' | 'yellow' | 'white' | 'green'
export type StripColor = 'red' | 'blue' | 'yellow' | 'white' | 'pink'
export type DiscoColor = 'red' | 'blue' | 'green' | 'yellow'
export type Phase = 'briefing' | 'live' | 'aftermath' | 'over'
export type Role = 'defuser' | 'expert' | 'loneWolf' | 'spectator' | 'benched'
export type Outcome = 'defused' | 'boom' | 'abandoned' | 'skipped'
export type HeckleKind = 'tick' | 'chicken' | 'airhorn' | 'popcorn' | 'pray' | 'clap'
export type Prediction = 'defuse' | 'boom'

export interface Sticker { label: string; lit: boolean }

/** The bomb casing. Visible to the defuser and spectators only. */
export interface Edgework {
  serial: string
  batteries: number
  stickers: Sticker[]
}

/** What the bomb physically shows. Never contains the answer. */
export type ModuleFace =
  | { kind: 'wires'; wires: { color: WireColor; cut: boolean }[] }
  | { kind: 'button'; color: ButtonColor; label: string; held: boolean; strip: StripColor | null }
  | { kind: 'glyphs'; glyphs: number[]; pressed: boolean[] }
  | { kind: 'saywhat'; stage: number; stages: number; display: string; buttons: string[] }
  | { kind: 'wheels'; slots: { letters: string[]; index: number }[] }
  | { kind: 'disco'; stage: number; stages: number; flashes: DiscoColor[]; entered: number }

/** Spoiler for spectators (and everyone once the bomb is over). */
export interface Solution {
  text: string
  /** Why — which rule applied. */
  why?: string
  glyphs?: number[]
}

export interface ModuleView {
  id: number
  kind: ModuleKind
  name: string
  solved: boolean
  /** Defuser, lone wolf, spectators, and everyone after the bomb. */
  face?: ModuleFace
  /** Spectators while live; everyone after the bomb. */
  solution?: Solution
}

export type ManualBlock =
  | { t: 'p'; text: string }
  | { t: 'rules'; heading?: string; items: string[] }
  | { t: 'table'; heading?: string; head: string[]; rows: string[][] }
  | { t: 'glyphcols'; cols: { label: string; glyphs: number[] }[] }
  | { t: 'words'; heading?: string; words: string[] }

export interface ManualSection {
  id: string
  kind: ModuleKind
  module: string
  title: string
  blocks: ManualBlock[]
  /** This is a backup copy someone else also holds (more experts than pages). */
  copy?: boolean
  /** Someone else's page shown to you because they dropped off. */
  borrowedFrom?: string
}

export interface HeckleView { id: number; by: string; kind: HeckleKind; at: number }

export interface HistoryEntry {
  turn: number
  round: number
  teamId: string
  defuserId: string | null
  result: Outcome
  modulesSolved: number
  modulesTotal: number
  strikes: number
  timeLeftMs: number
  points: number
  predictionPoints: Record<string, number>
}

export interface BombView {
  turn: number
  edgework?: Edgework
  modules: ModuleView[]
  strikes: number
  maxStrikes: number
  armedAt: number | null
  explodeAt: number | null
  /** Remaining fuse frozen at the end of the bomb. */
  timeLeftMs: number | null
  fuseMs: number
  bonuses: string[]
  loneWolf: boolean
}

export interface AftermathView {
  result: Outcome
  reason: string
  points: number
  breakdown: string[]
}

export interface BombSquadView {
  phase: Phase
  round: number
  rounds: number
  turn: number
  turnCount: number
  activeTeamId: string | null
  defuserId: string | null
  role: Role
  /** The briefing/aftermath auto-advance moment. */
  phaseEndsAt: number | null
  bomb: BombView | null
  /** Only the pages this viewer holds. */
  manual: ManualSection[]
  /** Active team only: who holds which page titles. */
  pageHolders: { playerId: string; titles: string[] }[]
  defuserOffline: boolean
  canTakeOver: boolean
  heckles: HeckleView[]
  heckleEnabled: boolean
  /** Spectating teams: their team's call and whether it is still open. */
  prediction: { mine: Prediction | null; open: boolean; closesAt: number | null } | null
  predictions: Record<string, Prediction>
  aftermath: AftermathView | null
  history: HistoryEntry[]
  nextUp: { teamId: string; defuserId: string | null } | null
}

/** Action names the screen sends. Every payload carries `turn` (stale-action guard). */
export type BombAction =
  | 'arm' | 'cut' | 'buttonDown' | 'buttonUp' | 'glyph' | 'say' | 'wheel' | 'submitWheels'
  | 'disco' | 'heckle' | 'predict' | 'takeOver' | 'next'
