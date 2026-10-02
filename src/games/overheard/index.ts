/**
 * Overheard — a Decrypto-style code game for teams on one voice call.
 *
 * Each team has four secret keywords (1–4). Every round each team's encryptor
 * gets a 3-digit code and types three clues, then reads them OUT LOUD on the
 * call. Their team decodes; the rival team, who heard everything, tries to
 * intercept. Two wiretaps (interceptions) win; two static (miscommunications) lose.
 */
import type { BaseCtx, GameDefinition, GameEvent, Step } from '../types.ts'
import type { PlayerId, TeamId } from '../../shared/protocol.ts'
import type {
  Digit, GuessDraft, HistoryRow, OutcomeView, OverheardView, Phase, Role, TeamPublic,
} from './shared.ts'
import { KEYWORDS } from './content.ts'
import {
  MAX_CLUE, SILENCE, clueProblem, cleanText, makeCode, parseCode, parseSlots, pickDistinct, sameCode, wordMatches,
} from './logic.ts'

// ---------------------------------------------------------------- settings

export interface Settings extends Record<string, unknown> {
  maxRounds: number
  clueSeconds: number
  guessSeconds: number
  interceptRound1: boolean
}

const CLUE_CHOICES = [60, 90, 120, 180]
const GUESS_CHOICES = [45, 60, 90, 120]

export const TIMING = {
  /** Once one encryptor sends, the other has at most this long (the sand timer). */
  sandTimerMs: 30_000,
  /** Time for the encryptor to read the clues aloud before they auto-reveal. */
  transmitMs: 45_000,
  revealMs: 9_000,
  tiebreakMs: 120_000,
  /** A replacement encryptor gets at least this long. */
  replacementMs: 60_000,
} as const

const MAX_NOTE = 40
const MAX_WORD = 30
const WIN_BONUS = 5

// ---------------------------------------------------------------- state

interface GuessS {
  slots: (Digit | null)[]
  locked: boolean
  lockedBy: PlayerId | null
  editedBy: PlayerId | null
}

interface Tx {
  teamId: TeamId
  encryptorId: PlayerId | null
  code: Digit[]
  draft: string[]
  /** Final clues once sent (or forced at the deadline). */
  clues: string[] | null
  revealed: number
  /** Keyed by the guessing team's id. */
  guesses: Record<TeamId, GuessS>
}

type Row = HistoryRow & { decodeBy: PlayerId | null; interceptBy: PlayerId | null }

interface TeamS {
  id: TeamId
  name: string
  members: PlayerId[]
  keywords: string[]
  /** Rotation pointer into members: who encrypts next. */
  rot: number
  wiretaps: number
  static: number
  notes: string[]
  history: Row[]
  tbDraft: string[]
  tbLocked: boolean
}

interface Outcome {
  winner: TeamId | null
  reason: string
  tiebreak: { teamId: TeamId; guesses: string[]; correct: boolean[] }[] | null
}

export interface State {
  settings: Settings
  turn: number
  round: number
  phase: Phase
  deadline: number | null
  teams: TeamS[]
  order: TeamId[]
  active: number
  tx: Record<TeamId, Tx>
  gone: PlayerId[]
  outcome: Outcome | null
}

// ---------------------------------------------------------------- small helpers

const emptyGuess = (): GuessS => ({ slots: [null, null, null], locked: false, lockedBy: null, editedBy: null })

function teamOf(s: State, pid: PlayerId): TeamS | undefined {
  return s.teams.find((t) => t.members.includes(pid))
}
function rivalOf(s: State, teamId: TeamId): TeamS {
  return s.teams.find((t) => t.id !== teamId)!
}
function alive(s: State, t: TeamS): PlayerId[] {
  return t.members.filter((m) => !s.gone.includes(m))
}
function activeTx(s: State): Tx {
  return s.tx[s.order[s.active]!]!
}
function interceptOpen(s: State): boolean {
  return s.round >= (s.settings.interceptRound1 ? 1 : 2)
}
function decoders(s: State, tx: Tx): PlayerId[] {
  const t = s.teams.find((x) => x.id === tx.teamId)!
  return alive(s, t).filter((m) => m !== tx.encryptorId)
}
/** Which teams must lock a guess for this transmission. */
function guessing(s: State, tx: Tx): Record<TeamId, boolean> {
  const rival = rivalOf(s, tx.teamId)
  return {
    [tx.teamId]: decoders(s, tx).length > 0,
    [rival.id]: interceptOpen(s) && alive(s, rival).length > 0,
  }
}
function isConnected(ctx: BaseCtx, pid: PlayerId): boolean {
  return ctx.players.find((p) => p.id === pid)?.connected ?? false
}
function playerName(ctx: BaseCtx, pid: PlayerId | null): string {
  return (pid && ctx.players.find((p) => p.id === pid)?.name) || 'Someone'
}
function allTiebreakLocked(s: State): boolean {
  return s.teams.every((t) => t.tbLocked || alive(s, t).length === 0)
}

/** Next encryptor in rotation: alive, preferring connected players. */
function nextEncryptor(s: State, t: TeamS, ctx: BaseCtx): { id: PlayerId | null; rot: number } {
  const n = t.members.length
  const order = Array.from({ length: n }, (_, k) => (t.rot + k) % n)
  const ok = (i: number, needConnected: boolean) => {
    const m = t.members[i]!
    return !s.gone.includes(m) && (!needConnected || isConnected(ctx, m))
  }
  const i = order.find((x) => ok(x, true)) ?? order.find((x) => ok(x, false))
  if (i === undefined) return { id: null, rot: t.rot }
  return { id: t.members[i]!, rot: (i + 1) % n }
}

function withTeam(s: State, id: TeamId, patch: (t: TeamS) => TeamS): State {
  return { ...s, teams: s.teams.map((t) => (t.id === id ? patch(t) : t)) }
}
function withTx(s: State, id: TeamId, patch: (t: Tx) => Tx): State {
  return { ...s, tx: { ...s.tx, [id]: patch(s.tx[id]!) } }
}
function enter(s: State, p: Phase, deadline: number | null): State {
  return { ...s, phase: p, deadline, turn: s.turn + 1 }
}

// ---------------------------------------------------------------- flow

type Out = { state: State; events: GameEvent[] }

function startRound(s: State, ctx: BaseCtx, events: GameEvent[]): Out {
  const round = s.round + 1
  const [a, b] = s.teams.map((t) => t.id) as [TeamId, TeamId]
  const order = round % 2 === 1 ? [a, b] : [b, a]
  let next: State = { ...s, round, order, active: 0, tx: {} }
  for (const t of s.teams) {
    const pick = nextEncryptor(next, t, ctx)
    next = withTeam(next, t.id, (x) => ({ ...x, rot: pick.rot }))
    next = {
      ...next,
      tx: {
        ...next.tx,
        [t.id]: {
          teamId: t.id, encryptorId: pick.id, code: makeCode(ctx.random), draft: ['', '', ''],
          clues: pick.id ? null : [SILENCE, SILENCE, SILENCE], revealed: 0, guesses: {},
        },
      },
    }
  }
  next = enter(next, 'encrypt', ctx.now + s.settings.clueSeconds * 1000)
  events.push({ type: 'round', data: { round } })
  return maybeAllSent({ state: next, events }, ctx)
}

function maybeAllSent(o: Out, ctx: BaseCtx): Out {
  const s = o.state
  if (s.phase !== 'encrypt') return o
  if (Object.values(s.tx).every((t) => t.clues !== null)) return startTransmit(s, 0, ctx, o.events)
  return o
}

/** Turn whatever the encryptor typed into final clues; blanks and illegal clues become silence. */
function forceClues(s: State, tx: Tx): string[] {
  const team = s.teams.find((t) => t.id === tx.teamId)!
  const used = team.history.flatMap((h) => h.clues)
  const out: string[] = []
  for (const raw of tx.draft) {
    const c = cleanText(raw, MAX_CLUE)
    out.push(c && !clueProblem(c, team.keywords, [...used, ...out]) ? c : SILENCE)
  }
  return out
}

function startTransmit(s: State, index: number, ctx: BaseCtx, events: GameEvent[]): Out {
  let next: State = { ...s, active: index }
  for (const tx of Object.values(next.tx)) {
    if (tx.clues === null) {
      const forced = forceClues(next, tx)
      next = withTx(next, tx.teamId, (t) => ({ ...t, clues: forced }))
    }
  }
  const tx = activeTx(next)
  next = enter(next, 'transmit', ctx.now + TIMING.transmitMs)
  events.push({ type: 'transmit', data: { teamId: tx.teamId, encryptorId: tx.encryptorId } })
  if (!tx.encryptorId || next.gone.includes(tx.encryptorId) || !isConnected(ctx, tx.encryptorId)) {
    return startGuess(next, ctx, events)
  }
  return { state: next, events }
}

function startGuess(s: State, ctx: BaseCtx, events: GameEvent[]): Out {
  const tx = activeTx(s)
  const guesses: Record<TeamId, GuessS> = {}
  for (const [id, needed] of Object.entries(guessing(s, tx))) if (needed) guesses[id] = emptyGuess()
  let next = withTx(s, tx.teamId, (t) => ({ ...t, revealed: 3, guesses }))
  next = enter(next, 'guess', ctx.now + s.settings.guessSeconds * 1000)
  return maybeAllLocked({ state: next, events }, ctx)
}

function maybeAllLocked(o: Out, ctx: BaseCtx): Out {
  const s = o.state
  if (s.phase !== 'guess') return o
  const tx = activeTx(s)
  const done = Object.entries(guessing(s, tx)).every(([id, needed]) => !needed || tx.guesses[id]?.locked)
  return done ? resolveTransmission(s, ctx, o.events) : o
}

function resolveTransmission(s: State, ctx: BaseCtx, events: GameEvent[]): Out {
  const tx = activeTx(s)
  const need = guessing(s, tx)
  const rival = rivalOf(s, tx.teamId)
  const own = s.teams.find((t) => t.id === tx.teamId)!
  // An unlocked but complete draft still counts when the timer runs out.
  const decodeGuess = need[own.id] ? parseCode(tx.guesses[own.id]?.slots) : null
  const interceptGuess = need[rival.id] ? parseCode(tx.guesses[rival.id]?.slots) : null
  const decoded = need[own.id] ? sameCode(decodeGuess, tx.code) : null
  const intercepted = need[rival.id] ? sameCode(interceptGuess, tx.code) : null
  const row: Row = {
    round: s.round, encryptorId: tx.encryptorId ?? '', clues: tx.clues ?? [SILENCE, SILENCE, SILENCE], code: tx.code,
    decodeGuess, interceptGuess, decoded, intercepted,
    decodeBy: tx.guesses[own.id]?.lockedBy ?? tx.guesses[own.id]?.editedBy ?? null,
    interceptBy: tx.guesses[rival.id]?.lockedBy ?? tx.guesses[rival.id]?.editedBy ?? null,
  }
  let next = withTeam(s, own.id, (t) => ({ ...t, history: [...t.history, row], static: t.static + (decoded === false ? 1 : 0) }))
  next = withTeam(next, rival.id, (t) => ({ ...t, wiretaps: t.wiretaps + (intercepted ? 1 : 0) }))
  next = enter(next, 'reveal', ctx.now + TIMING.revealMs)
  events.push({ type: 'reveal', data: { teamId: own.id, decoded, intercepted } })
  return { state: next, events }
}

function afterReveal(s: State, ctx: BaseCtx, events: GameEvent[]): Out {
  if (s.active === 0) return startTransmit(s, 1, ctx, events)
  const someoneHit = s.teams.some((t) => t.wiretaps >= 2 || t.static >= 2)
  if (someoneHit || s.round >= s.settings.maxRounds) return finish(s, ctx, events)
  return startRound(s, ctx, events)
}

function over(s: State, outcome: Outcome, events: GameEvent[]): Out {
  events.push({ type: 'gameover', data: { winner: outcome.winner } })
  return { state: { ...enter(s, 'over', null), outcome }, events }
}

function finish(s: State, ctx: BaseCtx, events: GameEvent[]): Out {
  const [a, b] = s.teams as [TeamS, TeamS]
  const good = (t: TeamS, o: TeamS) => t.wiretaps >= 2 || o.static >= 2
  const aGood = good(a, b)
  const bGood = good(b, a)
  if (aGood !== bGood) {
    const w = aGood ? a : b
    const l = aGood ? b : a
    const reason = w.wiretaps >= 2 ? `${w.name} wiretapped two codes` : `${l.name} drowned in static twice`
    return over(s, { winner: w.id, reason, tiebreak: null }, events)
  }
  const net = (t: TeamS) => t.wiretaps - t.static
  if (net(a) !== net(b)) {
    const w = net(a) > net(b) ? a : b
    return over(s, { winner: w.id, reason: `${w.name} win on tokens (wiretaps minus static)`, tiebreak: null }, events)
  }
  events.push({ type: 'tiebreak', data: {} })
  return { state: enter(s, 'tiebreak', ctx.now + TIMING.tiebreakMs), events }
}

function resolveTiebreak(s: State, events: GameEvent[]): Out {
  const tb = s.teams.map((t) => {
    const rival = rivalOf(s, t.id)
    const guesses = t.tbDraft.map((g) => cleanText(g, MAX_WORD))
    return { teamId: t.id, guesses, correct: rival.keywords.map((k, i) => wordMatches(guesses[i] ?? '', k)) }
  })
  const count = (i: number) => tb[i]!.correct.filter(Boolean).length
  const [ca, cb] = [count(0), count(1)]
  if (ca === cb) return over(s, { winner: null, reason: `Dead heat: both teams named ${ca} of the rival's words`, tiebreak: tb }, events)
  const w = ca > cb ? s.teams[0]! : s.teams[1]!
  return over(s, { winner: w.id, reason: `${w.name} knew the rival's words best (${Math.max(ca, cb)} vs ${Math.min(ca, cb)})`, tiebreak: tb }, events)
}

function forfeit(s: State, quitter: TeamS, events: GameEvent[]): Out {
  const w = rivalOf(s, quitter.id)
  return over(s, { winner: w.id, reason: `${quitter.name} left the call, so ${w.name} win by walkover`, tiebreak: null }, events)
}

// ---------------------------------------------------------------- actions

const STALE = 'Too late, that moment has passed'

function act(s: State, pid: PlayerId, type: string, p: Record<string, unknown>, ctx: BaseCtx): Step<State> {
  const me = teamOf(s, pid)
  if (!me || s.gone.includes(pid)) return { state: s, error: "You're watching this one. You'll be in the next game" }
  if (s.phase === 'over') return { state: s, error: 'The game is over' }
  const turnOk = p.turn === s.turn

  switch (type) {
    case 'note:set': {
      const i = p.index
      if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i > 3) return { state: s, error: 'Bad note' }
      const text = cleanText(p.text, MAX_NOTE)
      return { state: withTeam(s, me.id, (t) => ({ ...t, notes: t.notes.map((n, k) => (k === i ? text : n)) })) }
    }

    case 'clue:draft': {
      // Drafts arrive debounced and may be stale; ignore them quietly.
      const tx = s.tx[me.id]
      if (!turnOk || s.phase !== 'encrypt' || !tx || tx.encryptorId !== pid || tx.clues) return { state: s }
      if (!Array.isArray(p.clues) || p.clues.length !== 3) return { state: s }
      const draft = p.clues.map((c) => (typeof c === 'string' ? c.slice(0, MAX_CLUE) : ''))
      return { state: withTx(s, me.id, (t) => ({ ...t, draft })) }
    }

    case 'clue:submit': {
      if (!turnOk) return { state: s, error: STALE }
      const tx = s.tx[me.id]
      if (s.phase !== 'encrypt' || !tx || tx.encryptorId !== pid) return { state: s, error: "You're not the encryptor right now" }
      if (tx.clues) return { state: s, error: 'Your clues are already sent' }
      if (!Array.isArray(p.clues) || p.clues.length !== 3) return { state: s, error: 'Send exactly three clues' }
      const clues = p.clues.map((c) => cleanText(c, MAX_CLUE))
      const used = me.history.flatMap((h) => h.clues)
      for (let i = 0; i < 3; i++) {
        const problem = clueProblem(clues[i]!, me.keywords, [...used, ...clues.slice(0, i)])
        if (problem) return { state: s, error: problem }
      }
      let next = withTx(s, me.id, (t) => ({ ...t, clues, draft: clues }))
      const events: GameEvent[] = [{ type: 'sent', data: { teamId: me.id } }]
      const othersPending = Object.values(next.tx).some((t) => t.clues === null)
      if (othersPending && next.deadline !== null && next.deadline > ctx.now + TIMING.sandTimerMs) {
        next = { ...next, deadline: ctx.now + TIMING.sandTimerMs }
        events.push({ type: 'sandtimer', data: { teamId: me.id } })
      }
      return maybeAllSent({ state: next, events }, ctx)
    }

    case 'clue:reveal': {
      if (!turnOk) return { state: s, error: STALE }
      const tx = activeTx(s)
      if (s.phase !== 'transmit' || tx.encryptorId !== pid) return { state: s, error: "It's not your mic right now" }
      // `index` makes a double tap harmless: the second tap names a clue that is already out.
      if (p.index !== tx.revealed) return { state: s }
      const revealed = tx.revealed + 1
      const events: GameEvent[] = [{ type: 'clue', data: { teamId: tx.teamId, index: revealed - 1 } }]
      const next = withTx(s, tx.teamId, (t) => ({ ...t, revealed }))
      if (revealed >= 3) return startGuess(next, ctx, events)
      return { state: next, events }
    }

    case 'guess:set':
    case 'guess:lock': {
      const lock = type === 'guess:lock'
      if (!turnOk) return lock ? { state: s, error: STALE } : { state: s }
      if (s.phase !== 'guess') return { state: s, error: 'Not guessing right now' }
      const tx = activeTx(s)
      const need = guessing(s, tx)
      if (tx.teamId === me.id && tx.encryptorId === pid) return { state: s, error: 'Shh, you know the code! Let your team crack it' }
      if (!need[me.id]) return { state: s, error: me.id === tx.teamId ? 'Nothing to guess' : 'Interception opens next round. Just listen' }
      const g = tx.guesses[me.id] ?? emptyGuess()
      if (g.locked) return { state: s, error: 'Your team already locked in' }
      const slots = lock ? parseCode(p.slots) : parseSlots(p.slots)
      if (!slots) return { state: s, error: lock ? 'Pick three different numbers' : 'Bad guess' }
      const guess: GuessS = lock ? { slots, locked: true, lockedBy: pid, editedBy: pid } : { ...g, slots, editedBy: pid }
      const next = withTx(s, tx.teamId, (t) => ({ ...t, guesses: { ...t.guesses, [me.id]: guess } }))
      if (!lock) return { state: next }
      return maybeAllLocked({ state: next, events: [{ type: 'locked', data: { teamId: me.id } }] }, ctx)
    }

    case 'reveal:next': {
      if (!turnOk || s.phase !== 'reveal') return { state: s }
      if (pid !== ctx.hostId) return { state: s, error: 'Only the host can skip ahead' }
      const o = afterReveal(s, ctx, [])
      return { state: o.state, events: o.events }
    }

    case 'tiebreak:set':
    case 'tiebreak:lock': {
      const lock = type === 'tiebreak:lock'
      if (!turnOk || s.phase !== 'tiebreak') return lock ? { state: s, error: STALE } : { state: s }
      if (me.tbLocked) return lock ? { state: s, error: 'Your team already locked in' } : { state: s }
      if (!Array.isArray(p.words) || p.words.length !== 4) return { state: s, error: 'Four guesses please' }
      const words = p.words.map((w) => (typeof w === 'string' ? w.slice(0, MAX_WORD) : ''))
      const next = withTeam(s, me.id, (t) => ({ ...t, tbDraft: words, tbLocked: lock }))
      if (lock && allTiebreakLocked(next)) {
        const o = resolveTiebreak(next, [])
        return { state: o.state, events: o.events }
      }
      return { state: next, events: lock ? [{ type: 'locked', data: { teamId: me.id } }] : [] }
    }
  }
  return { state: s, error: 'Unknown action' }
}

// ---------------------------------------------------------------- view

function publicRow({ decodeBy: _d, interceptBy: _i, ...r }: Row): HistoryRow {
  return r
}

function guessView(g: GuessS | undefined): GuessDraft | null {
  return g ? { slots: g.slots, locked: g.locked, lockedBy: g.lockedBy, editedBy: g.editedBy } : null
}

function view(s: State, viewer: PlayerId, ctx: BaseCtx): OverheardView {
  const myTeam = s.gone.includes(viewer) ? undefined : teamOf(s, viewer)
  const rival = myTeam ? rivalOf(s, myTeam.id) : undefined
  const myTx = myTeam ? s.tx[myTeam.id] : undefined
  const amEncryptor = !!myTx && myTx.encryptorId === viewer
  const live = s.phase === 'encrypt' || s.phase === 'transmit' || s.phase === 'guess' || s.phase === 'reveal'

  const teams: TeamPublic[] = s.teams.map((t) => ({
    id: t.id, wiretaps: t.wiretaps, static: t.static,
    encryptorId: s.tx[t.id]?.encryptorId ?? null,
    submitted: s.tx[t.id]?.clues != null,
    history: t.history.map(publicRow),
  }))

  let transmission: OverheardView['transmission'] = null
  if (s.phase === 'transmit' || s.phase === 'guess') {
    const tx = activeTx(s)
    const open = interceptOpen(s)
    let role: Role = 'spectator'
    if (myTeam) {
      if (myTeam.id === tx.teamId) role = tx.encryptorId === viewer ? 'encryptor' : 'decoder'
      else role = open ? 'interceptor' : 'listener'
    }
    const locked: Record<string, boolean> = {}
    for (const t of s.teams) locked[t.id] = !!tx.guesses[t.id]?.locked
    transmission = {
      teamId: tx.teamId,
      encryptorId: tx.encryptorId,
      clues: (tx.clues ?? []).slice(0, s.phase === 'guess' ? 3 : tx.revealed),
      role,
      myGuess: myTeam && role !== 'encryptor' ? guessView(tx.guesses[myTeam.id]) : null,
      locked,
      guessing: guessing(s, tx),
      interceptOpen: open,
    }
  }

  let reveal: OverheardView['reveal'] = null
  if (s.phase === 'reveal') {
    const teamId = s.order[s.active]!
    const last = s.teams.find((x) => x.id === teamId)!.history.at(-1)
    if (last) reveal = { ...publicRow(last), teamId }
  }

  let tiebreak: OverheardView['tiebreak'] = null
  if (s.phase === 'tiebreak') {
    const locked: Record<string, boolean> = {}
    for (const t of s.teams) locked[t.id] = t.tbLocked
    tiebreak = { myDraft: myTeam ? myTeam.tbDraft : null, myLocked: !!myTeam?.tbLocked, locked }
  }

  let outcome: OutcomeView | null = null
  if (s.phase === 'over' && s.outcome) {
    const keywords: Record<string, string[]> = {}
    for (const t of s.teams) keywords[t.id] = t.keywords
    outcome = { ...s.outcome, keywords }
  }

  return {
    turn: s.turn,
    round: s.round,
    maxRounds: s.settings.maxRounds,
    phase: s.phase,
    myTeamId: myTeam?.id ?? null,
    rivalTeamId: rival?.id ?? null,
    order: s.order,
    active: s.active,
    teams,
    myKeywords: myTeam ? myTeam.keywords : null,
    notes: myTeam ? myTeam.notes : null,
    myCode: amEncryptor && live ? myTx!.code : null,
    myClueDraft: amEncryptor && s.phase === 'encrypt' ? (myTx!.clues ?? myTx!.draft) : null,
    myClues: amEncryptor && live ? myTx!.clues : null,
    transmission,
    reveal,
    tiebreak,
    outcome,
    isHost: viewer === ctx.hostId,
    interceptFromRound: s.settings.interceptRound1 ? 1 : 2,
  }
}

// ---------------------------------------------------------------- tick and disconnects

function tick(s: State, ctx: BaseCtx): Step<State> {
  if (s.deadline === null || ctx.now < s.deadline) return { state: s }
  const events: GameEvent[] = []
  let o: Out
  switch (s.phase) {
    case 'encrypt': o = startTransmit(s, 0, ctx, events); break
    case 'transmit': o = startGuess(s, ctx, events); break
    case 'guess': o = resolveTransmission(s, ctx, events); break
    case 'reveal': o = afterReveal(s, ctx, events); break
    case 'tiebreak': o = resolveTiebreak(s, events); break
    default: return { state: { ...s, deadline: null } }
  }
  return { state: o.state, events: o.events }
}

function onPlayerGone(s0: State, pid: PlayerId, ctx: BaseCtx): Step<State> {
  const team = teamOf(s0, pid)
  if (!team || s0.gone.includes(pid) || s0.phase === 'over') return { state: s0 }
  let s: State = { ...s0, gone: [...s0.gone, pid] }
  const events: GameEvent[] = [{ type: 'gone', data: { playerId: pid } }]
  if (alive(s, team).length === 0) {
    const o = forfeit(s, team, events)
    return { state: o.state, events: o.events }
  }
  const tx = s.tx[team.id]
  let o: Out = { state: s, events }

  if (tx && tx.encryptorId === pid) {
    if (s.phase === 'encrypt' && tx.clues === null) {
      // Hand the same code to the next teammate, with enough time to think.
      const pick = nextEncryptor(s, team, ctx)
      s = withTeam(s, team.id, (t) => ({ ...t, rot: pick.rot }))
      s = withTx(s, team.id, (t) => ({ ...t, encryptorId: pick.id, draft: ['', '', ''] }))
      s = { ...s, turn: s.turn + 1, deadline: Math.max(s.deadline ?? 0, ctx.now + TIMING.replacementMs) }
      events.push({ type: 'newEncryptor', data: { teamId: team.id, playerId: pick.id } })
      o = { state: s, events }
    } else if (s.phase === 'transmit' && activeTx(s).teamId === team.id) {
      o = startGuess(s, ctx, events)
    }
  }
  if (o.state.phase === 'guess') o = maybeAllLocked(o, ctx)
  if (o.state.phase === 'tiebreak' && allTiebreakLocked(o.state)) o = resolveTiebreak(o.state, o.events)
  return { state: o.state, events: o.events }
}

// ---------------------------------------------------------------- scores and results

function scores(s: State): Record<TeamId, number> {
  const out: Record<TeamId, number> = {}
  for (const t of s.teams) out[t.id] = t.wiretaps - t.static + (s.outcome?.winner === t.id ? WIN_BONUS : 0)
  return out
}

function results(s: State, ctx: BaseCtx) {
  const highlights: string[] = []
  if (s.outcome) highlights.push(s.outcome.reason)
  for (const t of s.teams) highlights.push(`${t.name}${t.name.endsWith('s') ? "'" : "'s"} secret words: ${t.keywords.join(', ')}`)

  const rows = s.teams.flatMap((t) => t.history.map((h) => ({ ...h, team: t })))
  const firstTap = rows.find((r) => r.intercepted)
  if (firstTap) {
    highlights.push(`Round ${firstTap.round}: ${playerName(ctx, firstTap.encryptorId)} said "${firstTap.clues.join(' / ')}" and the other side cracked it`)
  }
  const baffle = rows.find((r) => r.decoded === false && !r.clues.includes(SILENCE))
  if (baffle) highlights.push(`Most baffling: "${baffle.clues.join(' / ')}". Not even ${baffle.team.name} got it`)
  const silent = rows.filter((r) => r.clues.includes(SILENCE)).length
  if (silent > 0) highlights.push(`${silent} transmission${silent > 1 ? 's' : ''} went out with dead air 🤐`)

  const awards: { playerId: PlayerId; title: string; emoji: string }[] = []
  const byEncryptor = new Map<PlayerId, typeof rows>()
  for (const r of rows) if (r.encryptorId) byEncryptor.set(r.encryptorId, [...(byEncryptor.get(r.encryptorId) ?? []), r])
  for (const [pid, rs] of byEncryptor) {
    if (rs.some((r) => r.intercepted)) awards.push({ playerId: pid, title: 'Leaky Mic', emoji: '🚰' })
    else if (rs.some((r) => r.decoded === false)) awards.push({ playerId: pid, title: 'Lost in Translation', emoji: '🌀' })
    else if (rs.every((r) => r.decoded)) awards.push({ playerId: pid, title: 'Enigma Machine', emoji: '🧩' })
  }
  for (const pid of new Set(rows.filter((r) => r.intercepted && r.interceptBy).map((r) => r.interceptBy!))) {
    awards.push({ playerId: pid, title: 'Wiretapper', emoji: '🎧' })
  }
  return { highlights, awards }
}

// ---------------------------------------------------------------- definition

const secondsLabel = (n: number) => (n >= 120 ? `${n / 60} min` : `${n}s`)

export const overheard: GameDefinition<State, Settings> = {
  id: 'overheard',
  meta: {
    name: 'Overheard',
    emoji: '👂',
    tagline: 'Say your secret code out loud. The other team is listening.',
    howToPlay: [
      'Your team has 4 secret words, numbered 1–4. The other team never sees them.',
      'Each round your encryptor gets a code like 3-1-4, types one clue per number, then reads them aloud on the call.',
      'Your team decodes it in team chat, because the rivals hear everything said out loud.',
      'From round 2 the rivals try to intercept your code using every clue you have ever given.',
      'Two wiretaps (interceptions) win. Two static (failed decodes) lose. Be obvious to your team and baffling to theirs.',
    ],
    minPlayers: 4,
    maxPlayers: 16,
    teams: { min: 2, max: 2 },
    minTeamSize: 2,
    estimatedMinutes: 25,
    teamChat: true,
    color: 'sky',
  },
  settingsSpec: [
    { key: 'maxRounds', label: 'Max rounds', kind: 'number', min: 3, max: 10, step: 1, default: 8 },
    { key: 'clueSeconds', label: 'Time to write clues', kind: 'select', default: '120', options: CLUE_CHOICES.map((n) => ({ value: String(n), label: secondsLabel(n) })) },
    { key: 'guessSeconds', label: 'Time to guess', kind: 'select', default: '90', options: GUESS_CHOICES.map((n) => ({ value: String(n), label: secondsLabel(n) })) },
    { key: 'interceptRound1', label: 'Chaos mode: rivals may intercept in round 1', kind: 'toggle', default: false },
  ],
  parseSettings(raw) {
    const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN)
    const rounds = num(raw.maxRounds)
    const clue = num(raw.clueSeconds)
    const guess = num(raw.guessSeconds)
    return {
      maxRounds: Number.isFinite(rounds) ? Math.min(10, Math.max(3, Math.round(rounds))) : 8,
      clueSeconds: CLUE_CHOICES.includes(clue) ? clue : 120,
      guessSeconds: GUESS_CHOICES.includes(guess) ? guess : 90,
      interceptRound1: raw.interceptRound1 === true,
    }
  },
  create(ctx) {
    const words = pickDistinct(KEYWORDS, 8, ctx.random)
    const known = new Set(ctx.players.map((p) => p.id))
    const teams: TeamS[] = ctx.teams.slice(0, 2).map((t, i) => ({
      id: t.id, name: t.name,
      members: t.playerIds.filter((id) => known.has(id)),
      keywords: words.slice(i * 4, i * 4 + 4),
      rot: 0, wiretaps: 0, static: 0, notes: ['', '', '', ''], history: [], tbDraft: ['', '', '', ''], tbLocked: false,
    }))
    const base: State = {
      settings: ctx.settings, turn: 0, round: 0, phase: 'encrypt', deadline: null,
      teams, order: teams.map((t) => t.id), active: 0, tx: {}, gone: [], outcome: null,
    }
    if (teams.length < 2) return { ...base, phase: 'over', outcome: { winner: null, reason: 'Overheard needs two teams', tiebreak: null } }
    const empty = teams.find((t) => t.members.length === 0)
    if (empty) return forfeit(base, empty, []).state
    return startRound(base, ctx, []).state
  },
  view,
  action: (s, pid, a, ctx) => act(s, pid, a.type, a.payload ?? {}, ctx),
  deadline: (s) => s.deadline,
  tick,
  onPlayerGone,
  scores,
  isOver: (s) => s.phase === 'over',
  results,
}
