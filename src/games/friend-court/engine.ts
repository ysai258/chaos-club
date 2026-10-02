/**
 * Friend Court — pure game engine. No Date.now / Math.random: ctx only.
 */
import type { BaseCtx, CreateCtx, GameAction, GameEvent, Step } from '../types.ts'
import type { PlayerId, TeamId } from '../../shared/protocol.ts'
import { CASES, EVIDENCE, GUILTY_SENTENCES, ACQUITTAL_LINES, OBJECTION_REASONS } from './content.ts'
import type { EvidenceCard } from './content.ts'
import {
  REACTIONS,
  type CardView, type CourtPhase, type CourtRole, type FriendCourtView, type HistoryItem,
  type RecordEntry, type Side, type SpeechKind, type SpeechSlotView,
} from './shared.ts'

// ---------------------------------------------------------------- constants

export type Pace = 'snappy' | 'normal' | 'epic'
export interface Settings extends Record<string, unknown> {
  /** Select values are strings on the wire: '2' | '4' | '6'. */
  cases: string
  pace: Pace
  hostJudge: boolean
}

export const PACE: Record<Pace, { reveal: number; open: number; close: number; delib: number }> = {
  snappy: { reveal: 15_000, open: 30_000, close: 20_000, delib: 25_000 },
  normal: { reveal: 20_000, open: 45_000, close: 30_000, delib: 30_000 },
  epic: { reveal: 25_000, open: 60_000, close: 40_000, delib: 35_000 },
}
export const OBJECTION_MS = 15_000
export const VERDICT_MS = 10_000
export const MIN_RESUME_MS = 5_000
export const HAND_SIZE = 3
export const MAX_PER_SPEECH = 2
export const OBJECTIONS_PER_SIDE = 2
export const WIN_POINTS = 3
export const EXHIBIT_POINTS = 1
export const OBJECTION_POINTS = 1
export const REACT_COOLDOWN_MS = 700

const SPEECH_LABEL: Record<SpeechKind, string> = {
  'p-open': 'Opening for the prosecution',
  'd-open': 'Opening for the defence',
  'p-close': 'Closing for the prosecution',
  'd-close': "The accused's last words",
}
const SPEECH_SIDE: Record<SpeechKind, Side> = {
  'p-open': 'prosecution', 'd-open': 'defence', 'p-close': 'prosecution', 'd-close': 'defence',
}

// ---------------------------------------------------------------- state

interface Card { uid: string; cardId: string; fromId?: PlayerId }

interface PlannedSpeech {
  kind: SpeechKind
  speakerId: PlayerId | null
  status: 'pending' | 'live' | 'done' | 'skipped'
}

interface Exhibit {
  cardId: string
  byId: PlayerId
  side: Side
  struck: boolean
  speechIdx: number
  viaNoteFromId?: PlayerId
}

interface Verdict {
  guilty: boolean
  mistrial: boolean
  sentence: string
  decidedBy: 'judge' | 'jury' | 'auto'
  tally: { guilty: number; notGuilty: number } | null
  respected: PlayerId[]
}

interface CaseState {
  no: number
  templateId: string
  accusedId: PlayerId
  victimId: PlayerId | null
  teams: Record<Side, TeamId>
  judgeId: PlayerId | null
  verdictBy: 'judge' | 'jury'
  juryIds: PlayerId[]
  speeches: PlannedSpeech[]
  speechIdx: number
  /** Frozen speaker time while an objection is pending. */
  speechRemainingMs: number | null
  objection: { byId: PlayerId; side: Side; reason: string; endsAt: number } | null
  objectionsLeft: Record<Side, number>
  record: Exhibit[]
  notesPassed: PlayerId[]
  ballots: Record<PlayerId, boolean>
  judgeSentence: { guilty: boolean; idx: number } | null
  sentenceOptions: { guilty: string[]; notGuilty: string[] }
  respect: Record<PlayerId, PlayerId>
  points: Record<TeamId, number>
  verdict: Verdict | null
  mistrial: boolean
}

interface PlayerRec { id: PlayerId; name: string; teamId: TeamId; gone: boolean }

export interface Stats {
  speeches: number
  exhibits: number
  struck: number
  objections: number
  objectionsWon: number
  respect: number
  judged: number
  accused: number
  convicted: number
  acquitted: number
  notes: number
}

interface StoredHistory { no: number; templateId: string; accusedId: PlayerId; victimId: PlayerId | null; guilty: boolean; mistrial: boolean; sentence: string }

export interface State {
  settings: Settings
  seq: number
  phase: CourtPhase
  phaseEndsAt: number | null
  caseIdx: number
  caseCount: number
  players: PlayerRec[]
  teamOrder: TeamId[]
  deck: string[]
  uidCounter: number
  hands: Record<PlayerId, Card[]>
  usedCases: string[]
  usedSentences: string[]
  cur: CaseState | null
  history: StoredHistory[]
  scores: Record<TeamId, number>
  stats: Record<PlayerId, Stats>
  argued: Record<TeamId, { argued: number; prosecuted: number }>
  lastReact: Record<PlayerId, number>
}

// ---------------------------------------------------------------- settings

export function parseSettings(raw: Record<string, unknown>): Settings {
  const casesRaw = String(raw.cases)
  const cases = ['2', '4', '6'].includes(casesRaw) ? casesRaw : '4'
  const pace: Pace = raw.pace === 'snappy' || raw.pace === 'epic' ? raw.pace : 'normal'
  return { cases, pace, hostJudge: raw.hostJudge === true }
}

// ---------------------------------------------------------------- helpers

const CARD_BY_ID = new Map<string, EvidenceCard>(EVIDENCE.map((c) => [c.id, c]))
const CASE_BY_ID = new Map(CASES.map((c) => [c.id, c]))

function shuffle<T>(arr: readonly T[], random: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const t = a[i] as T
    a[i] = a[j] as T
    a[j] = t
  }
  return a
}

function pick<T>(arr: readonly T[], random: () => number): T | undefined {
  if (arr.length === 0) return undefined
  return arr[Math.floor(random() * arr.length)]
}

function emptyStats(): Stats {
  return { speeches: 0, exhibits: 0, struck: 0, objections: 0, objectionsWon: 0, respect: 0, judged: 0, accused: 0, convicted: 0, acquitted: 0, notes: 0 }
}

/** Deep-ish clone: the state is plain JSON, so this is safe and keeps reducers pure. */
function clone(s: State): State {
  return structuredClone(s)
}

function rec(s: State, id: PlayerId): PlayerRec | undefined {
  return s.players.find((p) => p.id === id)
}

function nameOf(s: State, ctx: BaseCtx | null, id: PlayerId | null): string {
  if (!id) return 'the group'
  return ctx?.players.find((p) => p.id === id)?.name ?? rec(s, id)?.name ?? 'someone'
}

function connected(ctx: BaseCtx, id: PlayerId): boolean {
  return ctx.players.find((p) => p.id === id)?.connected ?? false
}

/** Present = in the game and not gone. */
function present(s: State, id: PlayerId): boolean {
  const r = rec(s, id)
  return !!r && !r.gone
}

/** Present and currently connected. */
function live(s: State, ctx: BaseCtx, id: PlayerId): boolean {
  return present(s, id) && connected(ctx, id)
}

function teamMembers(s: State, teamId: TeamId): PlayerId[] {
  return s.players.filter((p) => p.teamId === teamId && !p.gone).map((p) => p.id)
}

/** Sort candidates: connected first, then fewest of `key`, then a random tiebreak. */
function choose(s: State, ctx: BaseCtx, ids: PlayerId[], key: (id: PlayerId) => number): PlayerId | null {
  if (ids.length === 0) return null
  const tagged = shuffle(ids, ctx.random).map((id) => ({ id, c: connected(ctx, id) ? 0 : 1, k: key(id) }))
  tagged.sort((a, b) => a.c - b.c || a.k - b.k)
  return tagged[0]?.id ?? null
}

export function render(text: string, s: State, ctx: BaseCtx | null, accusedId: PlayerId | null, victimId: PlayerId | null): string {
  return text.replaceAll('{A}', nameOf(s, ctx, accusedId)).replaceAll('{V}', nameOf(s, ctx, victimId))
}

function sideOfPlayer(c: CaseState, s: State, id: PlayerId): Side | null {
  if (id === c.judgeId) return null
  const r = rec(s, id)
  if (!r) return null
  if (r.teamId === c.teams.prosecution) return 'prosecution'
  if (r.teamId === c.teams.defence) return 'defence'
  return null
}

function arguers(s: State, c: CaseState, side: Side): PlayerId[] {
  return teamMembers(s, c.teams[side]).filter((id) => id !== c.judgeId)
}

function addPoints(s: State, teamId: TeamId, n: number): void {
  s.scores[teamId] = (s.scores[teamId] ?? 0) + n
  if (s.cur) s.cur.points[teamId] = (s.cur.points[teamId] ?? 0) + n
}

function stat(s: State, id: PlayerId): Stats {
  let st = s.stats[id]
  if (!st) {
    st = emptyStats()
    s.stats[id] = st
  }
  return st
}

function other(side: Side): Side {
  return side === 'prosecution' ? 'defence' : 'prosecution'
}

// ---------------------------------------------------------------- cards

function draw(s: State, ctx: BaseCtx): string {
  if (s.deck.length === 0) {
    const held = new Set(Object.values(s.hands).flat().map((c) => c.cardId))
    s.deck = shuffle(EVIDENCE.map((c) => c.id).filter((id) => !held.has(id)), ctx.random)
    if (s.deck.length === 0) s.deck = shuffle(EVIDENCE.map((c) => c.id), ctx.random)
  }
  return s.deck.pop() as string
}

function topUpHands(s: State, ctx: BaseCtx): void {
  for (const p of s.players) {
    if (p.gone) continue
    // A note only means something in the case it was passed: afterwards it is just a card.
    const hand = (s.hands[p.id] ?? []).map((k) => ({ uid: k.uid, cardId: k.cardId }))
    while (hand.length < HAND_SIZE) {
      s.uidCounter += 1
      hand.push({ uid: `k${s.uidCounter}`, cardId: draw(s, ctx) })
    }
    s.hands[p.id] = hand
  }
}

// ---------------------------------------------------------------- create

export function create(ctx: CreateCtx<Settings>): State {
  const settings = parseSettings(ctx.settings)
  const teamOrder = ctx.teams.filter((t) => t.playerIds.length > 0).map((t) => t.id)
  const players: PlayerRec[] = ctx.players
    .filter((p) => teamOrder.includes(p.teamId))
    .map((p) => ({ id: p.id, name: p.name, teamId: p.teamId, gone: false }))
  const s: State = {
    settings,
    seq: 0,
    phase: 'reveal',
    phaseEndsAt: null,
    caseIdx: 0,
    caseCount: Number(settings.cases),
    players,
    teamOrder,
    deck: shuffle(EVIDENCE.map((c) => c.id), ctx.random),
    uidCounter: 0,
    hands: {},
    usedCases: [],
    usedSentences: [],
    cur: null,
    history: [],
    scores: Object.fromEntries(ctx.teams.map((t) => [t.id, 0])),
    stats: Object.fromEntries(players.map((p) => [p.id, emptyStats()])),
    argued: Object.fromEntries(teamOrder.map((t) => [t, { argued: 0, prosecuted: 0 }])),
    lastReact: {},
  }
  startCase(s, ctx)
  return s
}

// ---------------------------------------------------------------- case setup

function pickTeams(s: State, ctx: BaseCtx): { pros: TeamId; def: TeamId } | null {
  const k = s.caseIdx
  const withPeople = s.teamOrder.filter((t) => teamMembers(s, t).length > 0)
  if (s.teamOrder.length === 2) {
    const [a, b] = s.teamOrder as [TeamId, TeamId]
    return k % 2 === 0 ? { pros: a, def: b } : { pros: b, def: a }
  }
  if (withPeople.length < 2) {
    const [a, b] = s.teamOrder as [TeamId, TeamId]
    return { pros: a, def: b }
  }
  // 3+ teams: the two teams that have argued least (rotating tiebreak), the rest are the jury.
  const n = withPeople.length
  const ordered = withPeople
    .map((t, i) => ({ t, i: (i - (k % n) + n) % n, a: s.argued[t]?.argued ?? 0 }))
    .sort((x, y) => x.a - y.a || x.i - y.i)
  const t1 = ordered[0]!.t
  const t2 = ordered[1]!.t
  const p1 = s.argued[t1]?.prosecuted ?? 0
  const p2 = s.argued[t2]?.prosecuted ?? 0
  void ctx
  return p1 <= p2 ? { pros: t1, def: t2 } : { pros: t2, def: t1 }
}

function pickJudge(s: State, ctx: BaseCtx, pros: TeamId, def: TeamId): PlayerId | null {
  const hostId = ctx.hostId
  const judgedCount = (id: PlayerId) => s.stats[id]?.judged ?? 0
  const arguing = [pros, def]
  // Neutral pool: players of teams not arguing this case.
  const neutral = s.players.filter((p) => !p.gone && !arguing.includes(p.teamId)).map((p) => p.id)

  if (s.settings.hostJudge && present(s, hostId) && connected(ctx, hostId)) {
    const hostTeam = rec(s, hostId)!.teamId
    const leftBehind = teamMembers(s, hostTeam).filter((id) => id !== hostId)
    if (!arguing.includes(hostTeam) || leftBehind.length > 0) return hostId
  }
  if (neutral.length > 0) return choose(s, ctx, neutral.filter((id) => connected(ctx, id)), judgedCount) ?? choose(s, ctx, neutral, judgedCount)
  // Two teams: the gavel alternates between teams every two cases, so each team
  // judges once while prosecuting and once while defending. A judge sits out of
  // arguing, so their team must keep at least one other present player.
  const k = s.caseIdx
  const first = s.teamOrder[Math.floor(k / 2) % 2] ?? pros
  const order = first === pros ? [pros, def] : [def, pros]
  for (const t of order) {
    const members = teamMembers(s, t)
    const liveMembers = members.filter((id) => connected(ctx, id))
    if (liveMembers.length >= 2) {
      const j = choose(s, ctx, liveMembers, judgedCount)
      if (j) return j
    }
    void members
  }
  return null
}

function startCase(s: State, ctx: BaseCtx): void {
  s.seq += 1
  if (s.caseIdx >= s.caseCount) {
    s.phase = 'over'
    s.phaseEndsAt = null
    s.cur = null
    return
  }
  const teams = pickTeams(s, ctx)!
  const judgeId = pickJudge(s, ctx, teams.pros, teams.def)
  const neutralTeams = s.teamOrder.filter((t) => t !== teams.pros && t !== teams.def)
  const verdictBy: 'judge' | 'jury' = neutralTeams.length > 0 ? 'jury' : 'judge'
  const juryIds = verdictBy === 'jury'
    ? s.players.filter((p) => !p.gone && neutralTeams.includes(p.teamId)).map((p) => p.id)
    : []

  const prosArg = teamMembers(s, teams.pros).filter((id) => id !== judgeId)
  const defArg = teamMembers(s, teams.def).filter((id) => id !== judgeId)
  const mistrial = prosArg.length === 0 || defArg.length === 0

  const accusedId = choose(s, ctx, defArg, (id) => s.stats[id]?.accused ?? 0)
    ?? choose(s, ctx, s.players.filter((p) => !p.gone).map((p) => p.id), () => 0)
    ?? s.players[0]!.id
  const victimId = choose(s, ctx, prosArg, () => 0)
    ?? choose(s, ctx, s.players.filter((p) => !p.gone && p.id !== accusedId).map((p) => p.id), () => 0)

  const unused = CASES.filter((c) => !s.usedCases.includes(c.id))
  const template = pick(unused.length > 0 ? unused : CASES, ctx.random)!
  s.usedCases.push(template.id)

  const freshSentences = (list: string[]) => {
    const pool = list.filter((x) => !s.usedSentences.includes(x))
    const chosen = shuffle(pool.length >= 3 ? pool : list, ctx.random).slice(0, 3)
    s.usedSentences.push(...chosen)
    return chosen
  }

  const speeches: PlannedSpeech[] = []
  if (!mistrial) {
    const spoke = (id: PlayerId) => s.stats[id]?.speeches ?? 0
    const pOpen = choose(s, ctx, prosArg, spoke)
    const dOpenPool = defArg.length > 1 ? defArg.filter((id) => id !== accusedId) : defArg
    const dOpen = choose(s, ctx, dOpenPool, spoke)
    const pClosePool = prosArg.length > 1 ? prosArg.filter((id) => id !== pOpen) : prosArg
    // Bias the closer towards whoever has spoken least *after* counting this case's opener.
    const pClose = choose(s, ctx, pClosePool, spoke)
    speeches.push(
      { kind: 'p-open', speakerId: pOpen, status: 'pending' },
      { kind: 'd-open', speakerId: dOpen, status: 'pending' },
      { kind: 'p-close', speakerId: pClose, status: 'pending' },
      { kind: 'd-close', speakerId: accusedId, status: 'pending' },
    )
  }

  stat(s, accusedId).accused += 1
  if (judgeId) stat(s, judgeId).judged += 1
  for (const t of [teams.pros, teams.def]) {
    const a = s.argued[t] ?? { argued: 0, prosecuted: 0 }
    a.argued += 1
    if (t === teams.pros) a.prosecuted += 1
    s.argued[t] = a
  }

  s.cur = {
    no: s.caseIdx + 1,
    templateId: template.id,
    accusedId,
    victimId: victimId ?? null,
    teams: { prosecution: teams.pros, defence: teams.def },
    judgeId,
    verdictBy,
    juryIds,
    speeches,
    speechIdx: 0,
    speechRemainingMs: null,
    objection: null,
    objectionsLeft: { prosecution: OBJECTIONS_PER_SIDE, defence: OBJECTIONS_PER_SIDE },
    record: [],
    notesPassed: [],
    ballots: {},
    judgeSentence: null,
    sentenceOptions: { guilty: freshSentences(GUILTY_SENTENCES), notGuilty: freshSentences(ACQUITTAL_LINES) },
    respect: {},
    points: Object.fromEntries(s.teamOrder.map((t) => [t, 0])),
    verdict: null,
    mistrial,
  }
  topUpHands(s, ctx)

  if (mistrial) {
    finishCase(s, ctx, null)
    return
  }
  s.phase = 'reveal'
  s.phaseEndsAt = ctx.now + PACE[s.settings.pace].reveal
}

// ---------------------------------------------------------------- speeches

function speechDuration(s: State, kind: SpeechKind): number {
  const p = PACE[s.settings.pace]
  return kind === 'p-open' || kind === 'd-open' ? p.open : p.close
}

/** Start the speech at `idx` or the next one that has someone to give it. */
function startSpeech(s: State, ctx: BaseCtx, idx: number, events: GameEvent[]): void {
  const c = s.cur!
  s.seq += 1
  c.objection = null
  c.speechRemainingMs = null
  for (let i = idx; i < c.speeches.length; i++) {
    const sp = c.speeches[i]!
    const side = SPEECH_SIDE[sp.kind]
    let speaker = sp.speakerId
    if (!speaker || !live(s, ctx, speaker) || sideOfPlayer(c, s, speaker) !== side) {
      const pool = arguers(s, c, side)
      const liveOnes = pool.filter((id) => connected(ctx, id))
      speaker = choose(s, ctx, liveOnes, (id) => s.stats[id]?.speeches ?? 0)
      if (sp.kind === 'd-close' && speaker && sp.speakerId !== speaker) {
        // The accused fled: whoever speaks last for the defence is now the accused.
        if (c.accusedId !== speaker && !live(s, ctx, c.accusedId)) {
          events.push({ type: 'fled', data: { fromId: c.accusedId, toId: speaker } })
          c.accusedId = speaker
          stat(s, speaker).accused += 1
        }
      }
    }
    if (!speaker) {
      sp.status = 'skipped'
      continue
    }
    sp.speakerId = speaker
    sp.status = 'live'
    c.speechIdx = i
    stat(s, speaker).speeches += 1
    s.phase = 'speech'
    s.phaseEndsAt = ctx.now + speechDuration(s, sp.kind)
    events.push({ type: 'floor', data: { speakerId: speaker, kind: sp.kind } })
    return
  }
  c.speechIdx = c.speeches.length
  startDeliberation(s, ctx)
}

function endSpeech(s: State, ctx: BaseCtx, events: GameEvent[]): void {
  const c = s.cur!
  const sp = c.speeches[c.speechIdx]
  if (sp && sp.status === 'live') sp.status = 'done'
  startSpeech(s, ctx, c.speechIdx + 1, events)
}

function resolveObjection(s: State, ctx: BaseCtx, sustained: boolean, auto: boolean, events: GameEvent[]): void {
  const c = s.cur!
  const obj = c.objection!
  const speakerSide = other(obj.side)
  let struckLetter: string | null = null
  if (sustained) {
    addPoints(s, c.teams[obj.side], OBJECTION_POINTS)
    stat(s, obj.byId).objectionsWon += 1
    for (let i = c.record.length - 1; i >= 0; i--) {
      const e = c.record[i]!
      if (e.speechIdx === c.speechIdx && !e.struck) {
        e.struck = true
        addPoints(s, c.teams[e.side], -EXHIBIT_POINTS)
        stat(s, e.byId).struck += 1
        struckLetter = letter(i)
        break
      }
    }
  } else {
    addPoints(s, c.teams[speakerSide], OBJECTION_POINTS)
  }
  const remaining = Math.max(c.speechRemainingMs ?? 0, MIN_RESUME_MS)
  c.objection = null
  c.speechRemainingMs = null
  s.seq += 1
  s.phaseEndsAt = ctx.now + remaining
  events.push({ type: 'ruling', data: { sustained, auto, byId: obj.byId, struck: struckLetter } })
}

function letter(i: number): string {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  return i < 26 ? a[i]! : `${a[Math.floor(i / 26) - 1]}${a[i % 26]}`
}

// ---------------------------------------------------------------- deliberation & verdict

function benchIds(s: State, ctx: BaseCtx): PlayerId[] {
  const c = s.cur!
  const ids = c.verdictBy === 'jury' ? [...c.juryIds] : c.judgeId ? [c.judgeId] : []
  return ids.filter((id) => live(s, ctx, id))
}

function respectTargets(s: State, c: CaseState, id: PlayerId): PlayerId[] {
  const side = sideOfPlayer(c, s, id)
  if (!side) return []
  return arguers(s, c, other(side))
}

function respectVoters(s: State, ctx: BaseCtx): PlayerId[] {
  const c = s.cur!
  return [...arguers(s, c, 'prosecution'), ...arguers(s, c, 'defence')]
    .filter((id) => live(s, ctx, id) && respectTargets(s, c, id).length > 0)
}

function deliberationProgress(s: State, ctx: BaseCtx): { done: PlayerId[]; waiting: PlayerId[] } {
  const c = s.cur!
  const done: PlayerId[] = []
  const waiting: PlayerId[] = []
  for (const id of benchIds(s, ctx)) (id in c.ballots ? done : waiting).push(id)
  for (const id of respectVoters(s, ctx)) (id in c.respect ? done : waiting).push(id)
  return { done, waiting }
}

function startDeliberation(s: State, ctx: BaseCtx): void {
  s.seq += 1
  s.phase = 'deliberation'
  s.phaseEndsAt = ctx.now + PACE[s.settings.pace].delib
}

function autoGuilty(s: State): boolean {
  const c = s.cur!
  const p = c.points[c.teams.prosecution] ?? 0
  const d = c.points[c.teams.defence] ?? 0
  return p > d // Ties: benefit of the doubt.
}

function finishCase(s: State, ctx: BaseCtx, events: GameEvent[] | null): void {
  const c = s.cur!
  let guilty = false
  let decidedBy: Verdict['decidedBy'] = 'auto'
  let tally: Verdict['tally'] = null
  if (!c.mistrial) {
    if (c.verdictBy === 'jury') {
      const votes = Object.entries(c.ballots)
      const g = votes.filter(([, v]) => v).length
      const n = votes.length - g
      tally = { guilty: g, notGuilty: n }
      if (votes.length === 0) guilty = autoGuilty(s)
      else if (g !== n) { guilty = g > n; decidedBy = 'jury' }
      else if (c.judgeId && c.judgeId in c.ballots) { guilty = c.ballots[c.judgeId]!; decidedBy = 'jury' }
      else guilty = autoGuilty(s)
    } else if (c.judgeId && c.judgeId in c.ballots) {
      guilty = c.ballots[c.judgeId]!
      decidedBy = 'judge'
    } else {
      guilty = autoGuilty(s)
    }
  }
  let sentence: string
  if (c.mistrial) {
    sentence = 'MISTRIAL! One side never showed up. Nobody scores, everybody is disappointed.'
  } else {
    const list = guilty ? c.sentenceOptions.guilty : c.sentenceOptions.notGuilty
    const js = c.judgeSentence
    const chosen = js && js.guilty === guilty ? list[js.idx] : pick(list, ctx.random)
    sentence = render(chosen ?? list[0] ?? '{A} is free to go.', s, ctx, c.accusedId, c.victimId)
    addPoints(s, c.teams[guilty ? 'prosecution' : 'defence'], WIN_POINTS)
    stat(s, c.accusedId)[guilty ? 'convicted' : 'acquitted'] += 1
  }
  // Respect: votes from the other side only (enforced when cast).
  const counts = new Map<PlayerId, number>()
  for (const target of Object.values(c.respect)) counts.set(target, (counts.get(target) ?? 0) + 1)
  for (const [id, n] of counts) stat(s, id).respect += n
  const top = Math.max(0, ...counts.values())
  const respected = top > 0 ? [...counts].filter(([, n]) => n === top).map(([id]) => id) : []

  c.verdict = { guilty, mistrial: c.mistrial, sentence, decidedBy, tally, respected }
  s.history.push({ no: c.no, templateId: c.templateId, accusedId: c.accusedId, victimId: c.victimId, guilty, mistrial: c.mistrial, sentence })
  s.seq += 1
  s.phase = 'verdict'
  s.phaseEndsAt = ctx.now + VERDICT_MS
  events?.push({ type: 'verdict', data: { guilty, mistrial: c.mistrial } })
}

function maybeFinishDeliberation(s: State, ctx: BaseCtx, events: GameEvent[]): void {
  if (s.phase !== 'deliberation') return
  if (deliberationProgress(s, ctx).waiting.length === 0) finishCase(s, ctx, events)
}

// ---------------------------------------------------------------- actions

function fail(state: State, error: string): Step<State> {
  return { state, error }
}

export function action(state: State, playerId: PlayerId, act: GameAction, ctx: BaseCtx): Step<State> {
  if (!present(state, playerId)) return fail(state, 'You are watching this game — you can play from the next one.')
  const payload = act.payload ?? {}
  if (act.type === 'react') return react(state, playerId, payload, ctx)
  if (payload.seq !== state.seq) return fail(state, 'Too late — the court has moved on.')
  const c = state.cur
  if (!c || state.phase === 'over') return fail(state, 'Court is adjourned.')
  const s = clone(state)
  const cs = s.cur!
  const events: GameEvent[] = []
  const mySide = sideOfPlayer(cs, s, playerId)
  const isJudge = cs.judgeId === playerId

  switch (act.type) {
    case 'begin': {
      if (s.phase !== 'reveal') return fail(state, 'The trial already started.')
      const allowed = isJudge || (!cs.judgeId && playerId === ctx.hostId)
      if (!allowed) return fail(state, 'Only the judge can open court.')
      events.push({ type: 'allRise', data: {} })
      startSpeech(s, ctx, 0, events)
      break
    }
    case 'play': {
      if (s.phase !== 'speech') return fail(state, 'You can only present evidence during your speech.')
      const sp = cs.speeches[cs.speechIdx]
      if (!sp || sp.speakerId !== playerId) return fail(state, "You don't have the floor.")
      if (cs.objection) return fail(state, 'Wait for the judge to rule on the objection.')
      const played = cs.record.filter((e) => e.speechIdx === cs.speechIdx).length
      if (played >= MAX_PER_SPEECH) return fail(state, `Max ${MAX_PER_SPEECH} exhibits per speech.`)
      const hand = s.hands[playerId] ?? []
      const idx = hand.findIndex((k) => k.uid === payload.uid)
      if (idx < 0) return fail(state, "That card isn't in your hand.")
      const [card] = hand.splice(idx, 1)
      const side = SPEECH_SIDE[sp.kind]
      const entry: Exhibit = { cardId: card!.cardId, byId: playerId, side, struck: false, speechIdx: cs.speechIdx }
      if (card!.fromId) entry.viaNoteFromId = card!.fromId
      cs.record.push(entry)
      addPoints(s, cs.teams[side], EXHIBIT_POINTS)
      stat(s, playerId).exhibits += 1
      const ev = CARD_BY_ID.get(card!.cardId)
      events.push({
        type: 'exhibit',
        data: {
          letter: letter(cs.record.length - 1),
          byId: playerId,
          emoji: ev?.emoji ?? '🧾',
          kind: ev?.kind ?? 'exhibit',
          text: render(ev?.text ?? '???', s, ctx, cs.accusedId, cs.victimId),
        },
      })
      break
    }
    case 'note': {
      if (s.phase !== 'speech') return fail(state, 'Notes can only be passed during a speech.')
      const sp = cs.speeches[cs.speechIdx]
      if (!sp || !sp.speakerId) return fail(state, 'Nobody has the floor.')
      if (mySide !== SPEECH_SIDE[sp.kind]) return fail(state, 'You can only pass notes to your own lawyer.')
      if (sp.speakerId === playerId) return fail(state, "You can't pass a note to yourself.")
      if (cs.notesPassed.includes(playerId)) return fail(state, 'One note per case. You already passed yours.')
      const hand = s.hands[playerId] ?? []
      const idx = hand.findIndex((k) => k.uid === payload.uid)
      if (idx < 0) return fail(state, "That card isn't in your hand.")
      const [card] = hand.splice(idx, 1)
      const target = s.hands[sp.speakerId] ?? []
      target.push({ uid: card!.uid, cardId: card!.cardId, fromId: playerId })
      s.hands[sp.speakerId] = target
      cs.notesPassed.push(playerId)
      stat(s, playerId).notes += 1
      events.push({ type: 'note', data: { fromId: playerId, toId: sp.speakerId }, to: { teamId: cs.teams[mySide] } })
      break
    }
    case 'rest': {
      if (s.phase !== 'speech') return fail(state, 'Nothing to rest.')
      const sp = cs.speeches[cs.speechIdx]
      if (!sp || sp.speakerId !== playerId) return fail(state, "You don't have the floor.")
      if (cs.objection) return fail(state, 'Wait for the judge to rule on the objection.')
      events.push({ type: 'rest', data: { byId: playerId } })
      endSpeech(s, ctx, events)
      break
    }
    case 'object': {
      if (s.phase !== 'speech') return fail(state, 'You can only object during a speech.')
      if (cs.objection) return fail(state, 'There is already an objection on the table.')
      if (!cs.judgeId || !live(s, ctx, cs.judgeId)) return fail(state, 'No judge on the bench to hear objections.')
      const sp = cs.speeches[cs.speechIdx]
      if (!sp || !mySide || mySide === SPEECH_SIDE[sp.kind]) return fail(state, 'Only the other side can object.')
      if (cs.objectionsLeft[mySide] <= 0) return fail(state, 'Your side is out of objections this case.')
      cs.objectionsLeft[mySide] -= 1
      const reason = pick(OBJECTION_REASONS, ctx.random) ?? 'Objection!'
      cs.speechRemainingMs = Math.max(0, (s.phaseEndsAt ?? ctx.now) - ctx.now)
      cs.objection = { byId: playerId, side: mySide, reason, endsAt: ctx.now + OBJECTION_MS }
      s.phaseEndsAt = ctx.now + OBJECTION_MS
      s.seq += 1
      stat(s, playerId).objections += 1
      events.push({ type: 'objection', data: { byId: playerId, reason } })
      break
    }
    case 'rule': {
      if (!cs.objection) return fail(state, 'There is no objection to rule on.')
      if (!isJudge) return fail(state, 'Only the judge rules on objections.')
      if (typeof payload.sustained !== 'boolean') return fail(state, 'Sustained or overruled?')
      resolveObjection(s, ctx, payload.sustained, false, events)
      break
    }
    case 'verdict': {
      if (s.phase !== 'deliberation') return fail(state, 'The jury is not deliberating.')
      const onBench = cs.verdictBy === 'jury' ? cs.juryIds.includes(playerId) : isJudge
      if (!onBench) return fail(state, "You're not on the bench this case.")
      if (playerId in cs.ballots) return fail(state, 'Your verdict is already in.')
      if (typeof payload.guilty !== 'boolean') return fail(state, 'Guilty or not guilty?')
      cs.ballots[playerId] = payload.guilty
      if (isJudge) {
        const n = Number(payload.sentence)
        const idx = Number.isInteger(n) && n >= 0 && n < 3 ? n : 0
        cs.judgeSentence = { guilty: payload.guilty, idx }
      }
      maybeFinishDeliberation(s, ctx, events)
      break
    }
    case 'respect': {
      if (s.phase !== 'deliberation') return fail(state, 'Voting is closed.')
      if (playerId in cs.respect) return fail(state, 'You already voted.')
      const targets = respectTargets(s, cs, playerId)
      if (targets.length === 0) return fail(state, "You're not on either side this case.")
      const target = String(payload.playerId)
      if (!targets.includes(target)) return fail(state, 'Respect goes to someone on the OTHER side.')
      cs.respect[playerId] = target
      maybeFinishDeliberation(s, ctx, events)
      break
    }
    default:
      return fail(state, 'Unknown action.')
  }
  return { state: s, events }
}

function react(state: State, playerId: PlayerId, payload: Record<string, unknown>, ctx: BaseCtx): Step<State> {
  const emoji = String(payload.emoji)
  if (!(REACTIONS as readonly string[]).includes(emoji)) return fail(state, 'Unknown reaction.')
  if (ctx.now - (state.lastReact[playerId] ?? 0) < REACT_COOLDOWN_MS) return { state }
  const s = { ...state, lastReact: { ...state.lastReact, [playerId]: ctx.now } }
  return { state: s, events: [{ type: 'react', data: { byId: playerId, emoji } }] }
}

// ---------------------------------------------------------------- time

export function deadline(s: State): number | null {
  return s.phase === 'over' ? null : s.phaseEndsAt
}

export function tick(state: State, ctx: BaseCtx): Step<State> {
  if (state.phase === 'over' || state.phaseEndsAt === null || ctx.now < state.phaseEndsAt) return { state }
  const s = clone(state)
  const events: GameEvent[] = []
  const c = s.cur
  switch (s.phase) {
    case 'reveal':
      events.push({ type: 'allRise', data: {} })
      startSpeech(s, ctx, 0, events)
      break
    case 'speech':
      if (c?.objection) resolveObjection(s, ctx, false, true, events)
      else {
        events.push({ type: 'timeUp', data: {} })
        endSpeech(s, ctx, events)
      }
      break
    case 'deliberation':
      finishCase(s, ctx, events)
      break
    case 'verdict':
      s.caseIdx += 1
      startCase(s, ctx)
      if ((s.phase as CourtPhase) === 'over') events.push({ type: 'adjourned', data: {} })
      else events.push({ type: 'newCase', data: { no: s.caseIdx + 1 } })
      break
  }
  return { state: s, events }
}

// ---------------------------------------------------------------- people leaving

export function onPlayerGone(state: State, playerId: PlayerId, ctx: BaseCtx): Step<State> {
  if (!present(state, playerId)) return { state }
  const s = clone(state)
  rec(s, playerId)!.gone = true
  delete s.hands[playerId]
  const events: GameEvent[] = []
  const c = s.cur
  if (!c || s.phase === 'over') return { state: s }

  // Judge left: hand the gavel to a neutral player if there is one, otherwise the robot judge.
  if (c.judgeId === playerId) {
    const neutral = c.juryIds.filter((id) => live(s, ctx, id))
    c.judgeId = choose(s, ctx, neutral, (id) => s.stats[id]?.judged ?? 0)
    if (c.judgeId) stat(s, c.judgeId).judged += 1
    events.push({ type: 'newJudge', data: { judgeId: c.judgeId } })
    if (c.objection) resolveObjection(s, ctx, false, true, events)
  }
  c.juryIds = c.juryIds.filter((id) => id !== playerId)

  // Objector left mid-objection: nothing changes, the judge still rules.

  // Accused left before the trial reached their last words: someone else stands accused.
  if (c.accusedId === playerId && !c.verdict) {
    const pool = arguers(s, c, 'defence').filter((id) => connected(ctx, id))
    const next = choose(s, ctx, pool, (id) => s.stats[id]?.accused ?? 0)
    if (next) {
      events.push({ type: 'fled', data: { fromId: playerId, toId: next } })
      c.accusedId = next
      stat(s, next).accused += 1
      const last = c.speeches.find((sp) => sp.kind === 'd-close')
      if (last && last.status === 'pending') last.speakerId = next
    }
  }
  if (c.victimId === playerId) c.victimId = null

  // Speaker left mid-speech: a teammate grabs the mic with the time that was left.
  if (s.phase === 'speech') {
    const sp = c.speeches[c.speechIdx]
    if (sp && sp.speakerId === playerId) {
      const side = SPEECH_SIDE[sp.kind]
      const pool = arguers(s, c, side).filter((id) => connected(ctx, id))
      const next = choose(s, ctx, pool, (id) => s.stats[id]?.speeches ?? 0)
      if (next) {
        sp.speakerId = next
        stat(s, next).speeches += 1
        s.seq += 1
        events.push({ type: 'floor', data: { speakerId: next, kind: sp.kind, takeover: true } })
      } else if (!c.objection) {
        sp.status = 'skipped'
        startSpeech(s, ctx, c.speechIdx + 1, events)
      } else {
        sp.status = 'skipped'
        c.objection = null
        startSpeech(s, ctx, c.speechIdx + 1, events)
      }
    }
  }
  if (s.phase === 'deliberation') maybeFinishDeliberation(s, ctx, events)
  return { state: s, events }
}

// ---------------------------------------------------------------- view

function cardView(s: State, ctx: BaseCtx, k: Card): CardView {
  const ev = CARD_BY_ID.get(k.cardId)
  const c = s.cur
  const v: CardView = {
    uid: k.uid,
    kind: ev?.kind ?? 'exhibit',
    emoji: ev?.emoji ?? '🧾',
    text: render(ev?.text ?? '???', s, ctx, c?.accusedId ?? null, c?.victimId ?? null),
  }
  if (k.fromId) v.fromId = k.fromId
  return v
}

export function view(s: State, viewerId: PlayerId, ctx: BaseCtx): FriendCourtView {
  const c = s.cur
  const inGame = present(s, viewerId)
  const hand = inGame ? (s.hands[viewerId] ?? []).map((k) => cardView(s, ctx, k)) : []
  const rules = { maxPerSpeech: MAX_PER_SPEECH, winPoints: WIN_POINTS, exhibitPoints: EXHIBIT_POINTS, objectionPoints: OBJECTION_POINTS }
  const history: HistoryItem[] = s.history.map((h) => ({
    no: h.no,
    title: CASE_BY_ID.get(h.templateId)?.title ?? 'A Mystery',
    accusedId: h.accusedId,
    guilty: h.guilty,
    mistrial: h.mistrial,
    sentence: h.sentence,
  }))
  const base: FriendCourtView = {
    seq: s.seq,
    phase: s.phase,
    caseNo: c?.no ?? s.caseCount,
    caseCount: s.caseCount,
    phaseEndsAt: s.phaseEndsAt,
    case: null,
    you: {
      role: 'watcher', side: null, hand, canPlay: false, canObject: false, canPassNote: false, canRule: false,
      canBegin: false, playedThisSpeech: 0, mustVote: null, myBallot: { guilty: null, respectId: null },
    },
    speeches: [],
    speechIdx: 0,
    speechRemainingMs: null,
    objection: null,
    record: [],
    deliberation: null,
    verdict: null,
    history,
    rules,
  }
  if (!c || s.phase === 'over') return base

  const template = CASE_BY_ID.get(c.templateId)
  const accusedName = nameOf(s, ctx, c.accusedId)
  const side = inGame ? sideOfPlayer(c, s, viewerId) : null
  const isJudge = c.judgeId === viewerId
  let role: CourtRole = 'watcher'
  if (isJudge) role = 'judge'
  else if (side) role = side
  else if (c.juryIds.includes(viewerId)) role = 'jury'

  const sp = s.phase === 'speech' ? c.speeches[c.speechIdx] : undefined
  const speakerSide = sp ? SPEECH_SIDE[sp.kind] : null
  const isSpeaker = !!sp && sp.speakerId === viewerId
  const playedThisSpeech = sp ? c.record.filter((e) => e.speechIdx === c.speechIdx).length : 0
  const judgeLive = !!c.judgeId && live(s, ctx, c.judgeId)

  const onBench = c.verdictBy === 'jury' ? c.juryIds.includes(viewerId) : isJudge
  const targets = respectTargets(s, c, viewerId)
  let mustVote: 'verdict' | 'respect' | null = null
  if (s.phase === 'deliberation') {
    if (onBench && !(viewerId in c.ballots)) mustVote = 'verdict'
    else if (targets.length > 0 && !(viewerId in c.respect)) mustVote = 'respect'
  }

  const progress = s.phase === 'deliberation' ? deliberationProgress(s, ctx) : null

  const view: FriendCourtView = {
    ...base,
    case: {
      no: c.no,
      title: template?.title ?? 'A Mystery',
      charge: `The State vs. ${accusedName} — accused of ${render(template?.charge ?? 'something', s, ctx, c.accusedId, c.victimId)}`,
      accusedId: c.accusedId,
      victimId: c.victimId,
      prosecutionTeamId: c.teams.prosecution,
      defenceTeamId: c.teams.defence,
      judgeId: c.judgeId,
      verdictBy: c.verdictBy,
      juryIds: c.juryIds,
      objectionsLeft: c.objectionsLeft,
      mistrial: c.mistrial,
    },
    you: {
      role,
      side,
      hand,
      canPlay: isSpeaker && !c.objection && playedThisSpeech < MAX_PER_SPEECH && hand.length > 0,
      canObject: s.phase === 'speech' && !c.objection && !!side && !!speakerSide && side !== speakerSide
        && c.objectionsLeft[side] > 0 && judgeLive,
      canPassNote: s.phase === 'speech' && !!side && side === speakerSide && !isSpeaker
        && !c.notesPassed.includes(viewerId) && hand.length > 0,
      canRule: isJudge && !!c.objection,
      canBegin: s.phase === 'reveal' && (isJudge || (!c.judgeId && viewerId === ctx.hostId)),
      playedThisSpeech,
      mustVote,
      myBallot: {
        guilty: c.ballots[viewerId] ?? null,
        respectId: c.respect[viewerId] ?? null,
      },
    },
    speeches: c.speeches.map((x): SpeechSlotView => ({
      kind: x.kind,
      side: SPEECH_SIDE[x.kind],
      label: SPEECH_LABEL[x.kind],
      speakerId: x.speakerId,
      status: x.status === 'pending' ? 'next' : x.status,
    })),
    speechIdx: c.speechIdx,
    speechRemainingMs: c.speechRemainingMs,
    objection: c.objection ? { ...c.objection } : null,
    record: c.record.map((e, i): RecordEntry => {
      const ev = CARD_BY_ID.get(e.cardId)
      const r: RecordEntry = {
        letter: letter(i),
        kind: ev?.kind ?? 'exhibit',
        emoji: ev?.emoji ?? '🧾',
        text: render(ev?.text ?? '???', s, ctx, c.accusedId, c.victimId),
        byId: e.byId,
        side: e.side,
        struck: e.struck,
      }
      // Who slipped the note is a team secret: only the side that played it learns it.
      if (e.viaNoteFromId && side === e.side) r.viaNoteFromId = e.viaNoteFromId
      return r
    }),
    deliberation: progress ? { doneIds: progress.done, waitingIds: progress.waiting } : null,
    verdict: c.verdict
      ? { ...c.verdict, points: { ...c.points } }
      : null,
  }
  if (s.phase === 'deliberation') {
    if (isJudge) {
      view.you.sentenceOptions = {
        guilty: c.sentenceOptions.guilty.map((t) => render(t, s, ctx, c.accusedId, c.victimId)),
        notGuilty: c.sentenceOptions.notGuilty.map((t) => render(t, s, ctx, c.accusedId, c.victimId)),
      }
    }
    if (targets.length > 0) view.you.respectTargets = targets
  }
  return view
}

// ---------------------------------------------------------------- results

export function results(s: State, ctx: BaseCtx): { highlights: string[]; awards: { playerId: PlayerId; title: string; emoji: string }[] } {
  const highlights: string[] = []
  for (const h of s.history) {
    if (h.mistrial) continue
    const title = CASE_BY_ID.get(h.templateId)?.title ?? 'a mystery'
    const name = nameOf(s, ctx, h.accusedId)
    highlights.push(h.guilty ? `${title}: ${name} — GUILTY. ${h.sentence}` : `${title}: ${name} — NOT GUILTY. ${h.sentence}`)
  }
  const awards: { playerId: PlayerId; title: string; emoji: string }[] = []
  const award = (key: keyof Stats, title: string, emoji: string) => {
    let best: PlayerId | null = null
    let bestN = 0
    for (const p of s.players) {
      const n = s.stats[p.id]?.[key] ?? 0
      if (n > bestN) { best = p.id; bestN = n }
    }
    if (best && !awards.some((a) => a.playerId === best)) awards.push({ playerId: best, title, emoji })
  }
  award('respect', 'Respected by the Enemy', '🫡')
  award('convicted', 'Repeat Offender', '🚔')
  award('objectionsWon', 'Objection Machine', '✋')
  award('exhibits', 'Evidence Hoarder', '🗂️')
  award('notes', 'Best Co-Counsel', '📝')
  award('acquitted', 'Teflon Defendant', '😇')
  return { highlights: highlights.slice(0, 6), awards }
}

export function isOver(s: State): boolean {
  return s.phase === 'over'
}

export function scores(s: State): Record<TeamId, number> {
  return { ...s.scores }
}
