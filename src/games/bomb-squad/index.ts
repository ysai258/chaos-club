/**
 * Bomb Squad — one teammate holds a ticking bomb, the rest hold scraps of the
 * defusal manual. Teams take turns; the waiting team watches with the answers.
 */
import type { BaseCtx, GameDefinition, GameEvent, Step } from '../types.ts'
import type { PlayerId, TeamId } from '../../shared/protocol.ts'
import { MODULE_NAMES, timerText } from './content.ts'
import {
  type Difficulty, type Holding, type ModuleState, type SectionDef,
  dealSections, faceOf, generateModule, makeEdgework, makeSections, playModule, releaseHolds, renderSection,
  shuffle, solutionOf,
} from './modules.ts'
import type {
  AftermathView, BombSquadView, BombView, Edgework, HeckleKind, HeckleView, HistoryEntry, ManualSection,
  ModuleKind, ModuleView, Outcome, Phase, Prediction, Role,
} from './shared.ts'

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

export const BRIEFING_MS = 30_000
export const AFTERMATH_MS = 12_000
export const STRIKE_PENALTY_MS = 15_000
export const PREDICT_WINDOW_MS = 30_000
export const HECKLE_COOLDOWN_MS = 2_500
export const UNDERDOG_GAP = 8
export const UNDERDOG_BONUS_MS = 30_000
export const LONE_WOLF_FACTOR = 1.5
export const POINTS = { module: 3, defuse: 5, per20s: 1, timeCap: 6, prediction: 2 }
const FUSE_PER_MODULE: Record<Fuse, number> = { relaxed: 100_000, normal: 75_000, panic: 55_000 }
const FUSE_BASE_MS = 30_000
const HECKLES: HeckleKind[] = ['tick', 'chicken', 'airhorn', 'popcorn', 'pray', 'clap']
const EASY: ModuleKind[] = ['wires', 'button', 'wheels']
const ALL: ModuleKind[] = ['wires', 'button', 'glyphs', 'saywhat', 'wheels', 'disco']

type Fuse = 'relaxed' | 'normal' | 'panic'
export interface Settings extends Record<string, unknown> {
  rounds: number
  fuse: Fuse
  strikes: number
  heckles: boolean
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface Bomb {
  turn: number
  round: number
  teamId: TeamId
  defuserId: PlayerId
  edgework: Edgework
  modules: ModuleState[]
  strikes: number
  fuseMs: number
  bonuses: string[]
  loneWolf: boolean
  armedAt: number | null
  explodeAt: number | null
  timeLeftMs: number | null
  sections: SectionDef[]
  holdings: Record<PlayerId, Holding[]>
  predictions: Record<TeamId, Prediction>
  heckles: HeckleView[]
}

export interface State {
  settings: Settings
  teams: { id: TeamId; name: string; playerIds: PlayerId[] }[]
  names: Record<PlayerId, string>
  gone: PlayerId[]
  turns: { round: number; teamId: TeamId }[]
  turnIdx: number
  rotation: Record<TeamId, number>
  roundKinds: Record<number, ModuleKind[]>
  phase: Phase
  phaseEndsAt: number | null
  bomb: Bomb | null
  aftermath: AftermathView | null
  scores: Record<TeamId, number>
  history: HistoryEntry[]
  strikesBy: Record<PlayerId, number>
  heckleCount: Record<PlayerId, number>
  lastHeckle: Record<PlayerId, number>
  heckleSeq: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const teamOf = (s: State, p: PlayerId) => s.teams.find((t) => t.playerIds.includes(p))
const present = (s: State, teamId: TeamId) => s.teams.find((t) => t.id === teamId)!.playerIds.filter((p) => !s.gone.includes(p))
const isConnected = (ctx: BaseCtx, p: PlayerId) => ctx.players.find((x) => x.id === p)?.connected ?? false
const difficulty = (round: number): Difficulty => Math.min(4, round) as Difficulty
const moduleCount = (round: number) => Math.min(5, round + 1)
const name = (s: State, p: PlayerId | null) => (p ? s.names[p] ?? 'Someone' : 'Nobody')
const fmt = (ms: number) => timerText(ms)

function kindsFor(round: number, rand: () => number): ModuleKind[] {
  const n = moduleCount(round)
  const pool = round === 1 ? EASY : ALL
  const kinds = shuffle(rand, pool).slice(0, n)
  // Always keep a wire module — everybody's favourite.
  if (!kinds.includes('wires')) kinds[kinds.length - 1] = 'wires'
  return kinds
}

function experts(s: State, b: Bomb): PlayerId[] {
  return present(s, b.teamId).filter((p) => p !== b.defuserId)
}

/** (Re)deal the manual over whoever is left on the defusing team. */
function deal(s: State, b: Bomb): Bomb {
  const ex = experts(s, b)
  const kinds = [...new Set(b.modules.map((m) => m.kind))]
  const sections = makeSections(kinds, ex.length)
  if (ex.length === 0) {
    return { ...b, sections, loneWolf: true, holdings: { [b.defuserId]: sections.map((x) => ({ sectionId: x.id, copy: false })) } }
  }
  return { ...b, sections, loneWolf: false, holdings: dealSections(sections, ex) }
}

/** Choose the next defuser for a team: round-robin, skipping gone players, preferring connected ones. */
function chooseDefuser(s: State, teamId: TeamId, ctx: BaseCtx): { id: PlayerId | null; rotation: number } {
  const team = s.teams.find((t) => t.id === teamId)!
  const start = s.rotation[teamId] ?? 0
  const order = team.playerIds.map((_, i) => team.playerIds[(start + i) % team.playerIds.length]!)
  const alive = order.filter((p) => !s.gone.includes(p))
  const id = alive.find((p) => isConnected(ctx, p)) ?? alive[0] ?? null
  return { id, rotation: id ? team.playerIds.indexOf(id) + 1 : start }
}

function skippedEntry(s: State, round: number, teamId: TeamId): HistoryEntry {
  return {
    turn: s.turnIdx, round, teamId, defuserId: null, result: 'skipped', modulesSolved: 0, modulesTotal: 0,
    strikes: 0, timeLeftMs: 0, points: 0, predictionPoints: {},
  }
}

/** Start the turn at s.turnIdx, skipping teams with nobody left. */
function startTurn(s: State, ctx: BaseCtx): State {
  let state = s
  for (;;) {
    const t = state.turns[state.turnIdx]
    if (!t) return { ...state, phase: 'over', phaseEndsAt: null, bomb: null, aftermath: null }
    const chosen = chooseDefuser(state, t.teamId, ctx)
    if (!chosen.id) {
      state = { ...state, history: [...state.history, skippedEntry(state, t.round, t.teamId)], turnIdx: state.turnIdx + 1 }
      continue
    }
    const roundKinds = state.roundKinds[t.round] ? state.roundKinds : { ...state.roundKinds, [t.round]: kindsFor(t.round, ctx.random) }
    const edgework = makeEdgework(ctx.random)
    const modules = roundKinds[t.round]!.map((k, i) => generateModule(k, i, difficulty(t.round), edgework, ctx.random))
    const bonuses: string[] = []
    let fuseMs = FUSE_BASE_MS + FUSE_PER_MODULE[state.settings.fuse] * modules.length
    const mine = state.scores[t.teamId] ?? 0
    const best = Math.max(0, ...state.teams.filter((x) => x.id !== t.teamId).map((x) => state.scores[x.id] ?? 0))
    if (best - mine >= UNDERDOG_GAP) {
      fuseMs += UNDERDOG_BONUS_MS
      bonuses.push(`Underdog fuse: +${UNDERDOG_BONUS_MS / 1000}s`)
    }
    let bomb: Bomb = {
      turn: state.turnIdx, round: t.round, teamId: t.teamId, defuserId: chosen.id, edgework, modules, strikes: 0,
      fuseMs, bonuses, loneWolf: false, armedAt: null, explodeAt: null, timeLeftMs: null, sections: [], holdings: {},
      predictions: {}, heckles: [],
    }
    bomb = deal(state, bomb)
    if (bomb.loneWolf) {
      const extra = Math.round(bomb.fuseMs * (LONE_WOLF_FACTOR - 1))
      bomb = { ...bomb, fuseMs: bomb.fuseMs + extra, bonuses: [...bomb.bonuses, `Lone wolf: +${Math.round(extra / 1000)}s`] }
    }
    return {
      ...state, roundKinds, bomb, phase: 'briefing', phaseEndsAt: ctx.now + BRIEFING_MS, aftermath: null,
      rotation: { ...state.rotation, [t.teamId]: chosen.rotation },
    }
  }
}

function arm(s: State, ctx: BaseCtx): Step<State> {
  const b = s.bomb!
  const bomb = { ...b, armedAt: ctx.now, explodeAt: ctx.now + b.fuseMs }
  return {
    state: { ...s, bomb, phase: 'live', phaseEndsAt: null },
    events: [{ type: 'armed', data: { turn: b.turn, teamId: b.teamId, defuserId: b.defuserId } }],
  }
}

function endBomb(s: State, ctx: BaseCtx, result: Outcome, reason: string, extraEvents: GameEvent[] = []): Step<State> {
  const b = s.bomb!
  const solved = b.modules.filter((m) => m.solved).length
  const timeLeftMs = b.explodeAt !== null ? Math.max(0, b.explodeAt - ctx.now) : b.fuseMs
  const breakdown: string[] = []
  let points = solved * POINTS.module
  if (solved) breakdown.push(`${solved} module${solved === 1 ? '' : 's'} disarmed: +${solved * POINTS.module}`)
  if (result === 'defused') {
    const timeBonus = Math.min(POINTS.timeCap, Math.floor(timeLeftMs / 20_000) * POINTS.per20s)
    points += POINTS.defuse + timeBonus
    breakdown.push(`Bomb defused: +${POINTS.defuse}`)
    if (timeBonus) breakdown.push(`${fmt(timeLeftMs)} left on the clock: +${timeBonus}`)
  }
  const scores = { ...s.scores, [b.teamId]: (s.scores[b.teamId] ?? 0) + points }
  const predictionPoints: Record<TeamId, number> = {}
  for (const [teamId, guess] of Object.entries(b.predictions)) {
    if ((guess === 'defuse') === (result === 'defused')) {
      predictionPoints[teamId] = POINTS.prediction
      scores[teamId] = (scores[teamId] ?? 0) + POINTS.prediction
    }
  }
  const entry: HistoryEntry = {
    turn: b.turn, round: b.round, teamId: b.teamId, defuserId: b.defuserId, result, modulesSolved: solved,
    modulesTotal: b.modules.length, strikes: b.strikes, timeLeftMs: result === 'defused' ? timeLeftMs : 0, points,
    predictionPoints,
  }
  return {
    state: {
      ...s, scores, history: [...s.history, entry], phase: 'aftermath', phaseEndsAt: ctx.now + AFTERMATH_MS,
      bomb: { ...b, modules: b.modules.map(releaseHolds), timeLeftMs },
      aftermath: { result, reason, points, breakdown },
    },
    events: [...extraEvents, { type: result === 'defused' ? 'defused' : 'boom', data: { turn: b.turn, teamId: b.teamId, reason, points } }],
  }
}

function advance(s: State, ctx: BaseCtx): State {
  return startTurn({ ...s, turnIdx: s.turnIdx + 1, bomb: null, aftermath: null }, ctx)
}

function tick(s: State, ctx: BaseCtx): Step<State> {
  if (s.phase === 'briefing' && s.phaseEndsAt !== null && ctx.now >= s.phaseEndsAt) return arm(s, ctx)
  if (s.phase === 'live' && s.bomb?.explodeAt != null && ctx.now >= s.bomb.explodeAt) {
    return endBomb(s, ctx, 'boom', 'The timer hit zero')
  }
  if (s.phase === 'aftermath' && s.phaseEndsAt !== null && ctx.now >= s.phaseEndsAt) return { state: advance(s, ctx) }
  return { state: s }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const MODULE_ACTIONS = new Set(['cut', 'buttonDown', 'buttonUp', 'glyph', 'say', 'wheel', 'submitWheels', 'disco'])

function act(s: State, playerId: PlayerId, type: string, p: Record<string, unknown>, ctx: BaseCtx): Step<State> {
  const myTeam = teamOf(s, playerId)
  if (!myTeam) return { state: s, error: 'You joined mid-game — you’re in from the next one' }
  if (s.phase === 'over') return { state: s, error: 'The game is over' }

  if (type === 'next') {
    if (s.phase !== 'aftermath') return { state: s, error: 'Nothing to skip' }
    if (playerId !== ctx.hostId) return { state: s, error: 'Only the host can skip ahead' }
    if (p.turn !== s.bomb?.turn) return { state: s, error: 'That was for an older bomb' }
    return { state: advance(s, ctx) }
  }

  const b = s.bomb
  if (!b || p.turn !== b.turn) return { state: s, error: 'That was for an older bomb' }
  // The clock beat the click: the bomb goes off first.
  if (s.phase === 'live' && b.explodeAt !== null && ctx.now >= b.explodeAt) return tick(s, ctx)
  if (s.phase !== 'briefing' && s.phase !== 'live') return { state: s, error: 'This bomb is done' }
  const onBombTeam = myTeam.id === b.teamId

  switch (type) {
    case 'arm': {
      if (s.phase !== 'briefing') return { state: s, error: 'Already ticking!' }
      if (playerId !== b.defuserId) return { state: s, error: 'Only the defuser can arm the bomb' }
      return arm(s, ctx)
    }
    case 'predict': {
      if (onBombTeam) return { state: s, error: 'No betting on yourselves' }
      if (p.guess !== 'defuse' && p.guess !== 'boom') return { state: s, error: 'Pick defuse or boom' }
      if (s.phase === 'live' && ctx.now >= (b.armedAt ?? 0) + PREDICT_WINDOW_MS) return { state: s, error: 'Bets are closed' }
      return { state: { ...s, bomb: { ...b, predictions: { ...b.predictions, [myTeam.id]: p.guess } } } }
    }
    case 'heckle': {
      if (!s.settings.heckles) return { state: s, error: 'Heckling is off' }
      if (onBombTeam) return { state: s, error: 'Heckle the other team, not yourselves' }
      if (!HECKLES.includes(p.kind as HeckleKind)) return { state: s, error: 'Unknown heckle' }
      if (ctx.now - (s.lastHeckle[playerId] ?? -Infinity) < HECKLE_COOLDOWN_MS) return { state: s, error: 'Easy — save your voice' }
      const h: HeckleView = { id: s.heckleSeq + 1, by: playerId, kind: p.kind as HeckleKind, at: ctx.now }
      return {
        state: {
          ...s, heckleSeq: h.id, bomb: { ...b, heckles: [...b.heckles, h].slice(-5) },
          lastHeckle: { ...s.lastHeckle, [playerId]: ctx.now },
          heckleCount: { ...s.heckleCount, [playerId]: (s.heckleCount[playerId] ?? 0) + 1 },
        },
        events: [{ type: 'heckle', data: { kind: h.kind, by: playerId, id: h.id } }],
      }
    }
    case 'takeOver': {
      if (!onBombTeam || playerId === b.defuserId) return { state: s, error: 'Only a teammate can grab the bomb' }
      if (isConnected(ctx, b.defuserId) && !s.gone.includes(b.defuserId)) return { state: s, error: 'The defuser is still here' }
      const bomb = deal(s, { ...b, defuserId: playerId, modules: b.modules.map(releaseHolds) })
      return { state: { ...s, bomb }, events: [{ type: 'takeover', data: { by: playerId } }] }
    }
  }

  if (!MODULE_ACTIONS.has(type)) return { state: s, error: 'Unknown action' }
  if (playerId !== b.defuserId) return { state: s, error: 'Only the defuser can touch the bomb' }
  if (s.phase !== 'live') return { state: s, error: 'Arm the bomb first' }
  const mi = typeof p.module === 'number' ? p.module : -1
  const m = b.modules[mi]
  if (!m) return { state: s, error: 'No such module' }
  const r = playModule(m, type, p, { now: ctx.now, explodeAt: b.explodeAt!, strikes: b.strikes, edgework: b.edgework })
  if (r.error) return { state: s, error: r.error }
  let bomb: Bomb = { ...b, modules: b.modules.map((x, i) => (i === mi ? r.module : x)) }
  const next: State = { ...s, bomb }

  if (r.outcome === 'strike') {
    const strikes = b.strikes + 1
    bomb = { ...bomb, strikes, explodeAt: bomb.explodeAt! - STRIKE_PENALTY_MS }
    const struck = { ...next, bomb, strikesBy: { ...s.strikesBy, [playerId]: (s.strikesBy[playerId] ?? 0) + 1 } }
    const ev: GameEvent = { type: 'strike', data: { module: mi, strikes, by: playerId } }
    if (strikes >= s.settings.strikes) return endBomb(struck, ctx, 'boom', `Strike ${strikes} — that’s the limit`, [ev])
    if (bomb.explodeAt! <= ctx.now) return endBomb(struck, ctx, 'boom', 'The strike penalty ate the last seconds', [ev])
    return { state: struck, events: [ev] }
  }
  if (r.outcome === 'solved') {
    const ev: GameEvent = { type: 'solved', data: { module: mi, kind: m.kind } }
    if (bomb.modules.every((x) => x.solved)) return endBomb(next, ctx, 'defused', `${name(s, playerId)} defused it`, [ev])
    return { state: next, events: [ev] }
  }
  return { state: next }
}

// ---------------------------------------------------------------------------
// Views — the only place secrets are filtered.
// ---------------------------------------------------------------------------

function roleOf(s: State, viewer: PlayerId): Role {
  const team = teamOf(s, viewer)
  if (!team || s.gone.includes(viewer)) return 'benched'
  const b = s.bomb
  if (!b || team.id !== b.teamId) return 'spectator'
  if (viewer === b.defuserId) return b.loneWolf ? 'loneWolf' : 'defuser'
  return 'expert'
}

function manualFor(s: State, b: Bomb, viewer: PlayerId, ctx: BaseCtx): ManualSection[] {
  const byId = new Map(b.sections.map((x) => [x.id, x]))
  const own = (b.holdings[viewer] ?? []).map((h) => renderSection(byId.get(h.sectionId)!, h.copy ? { copy: true } : {}))
  // Pages of an expert who dropped off are lent to the first connected expert (or the defuser).
  const holders = Object.keys(b.holdings).filter((p) => p !== b.defuserId)
  const online = holders.filter((p) => isConnected(ctx, p))
  const fallback = online[0] ?? (isConnected(ctx, b.defuserId) ? b.defuserId : null)
  if (fallback !== viewer) return own
  const seen = new Set(own.map((x) => x.id))
  const borrowed: ManualSection[] = []
  for (const p of holders) {
    if (isConnected(ctx, p)) continue
    for (const h of b.holdings[p] ?? []) {
      if (h.copy || seen.has(h.sectionId)) continue
      seen.add(h.sectionId)
      borrowed.push(renderSection(byId.get(h.sectionId)!, { borrowedFrom: name(s, p) }))
    }
  }
  return [...own, ...borrowed]
}

function view(s: State, viewer: PlayerId, ctx: BaseCtx): BombSquadView {
  const role = roleOf(s, viewer)
  const b = s.bomb
  const live = s.phase === 'live'
  const after = s.phase === 'aftermath'
  const active = s.phase === 'briefing' || live
  const myTeam = teamOf(s, viewer)

  let bomb: BombView | null = null
  let manual: ManualSection[] = []
  let pageHolders: BombSquadView['pageHolders'] = []
  if (b) {
    const seesFace = after || role === 'spectator' || ((role === 'defuser' || role === 'loneWolf') && live)
    const seesSolution = after || role === 'spectator'
    const modules: ModuleView[] = b.modules.map((m) => ({
      id: m.id, kind: m.kind, name: MODULE_NAMES[m.kind], solved: m.solved,
      ...(seesFace ? { face: faceOf(m) } : {}),
      ...(seesSolution ? { solution: solutionOf(m, b.edgework, b.strikes) } : {}),
    }))
    bomb = {
      turn: b.turn, modules, strikes: b.strikes, maxStrikes: s.settings.strikes, armedAt: b.armedAt,
      explodeAt: b.explodeAt, timeLeftMs: after ? b.timeLeftMs : null, fuseMs: b.fuseMs, bonuses: b.bonuses,
      loneWolf: b.loneWolf, ...(seesFace ? { edgework: b.edgework } : {}),
    }
    if (role === 'expert' || role === 'loneWolf' || role === 'defuser') manual = manualFor(s, b, viewer, ctx)
    if (myTeam?.id === b.teamId) {
      const byId = new Map(b.sections.map((x) => [x.id, x]))
      pageHolders = Object.entries(b.holdings).map(([playerId, hs]) => ({
        playerId,
        titles: hs.map((h) => {
          const sec = renderSection(byId.get(h.sectionId)!)
          return `${sec.module}: ${sec.title}${h.copy ? ' (copy)' : ''}`
        }),
      }))
    }
  }

  const spectatorTeam = b && myTeam && role === 'spectator' ? myTeam.id : null
  const closesAt = b?.armedAt != null ? b.armedAt + PREDICT_WINDOW_MS : null
  const prediction = b && spectatorTeam
    ? { mine: b.predictions[spectatorTeam] ?? null, open: s.phase === 'briefing' || (live && closesAt !== null && ctx.now < closesAt), closesAt }
    : null

  const nextTurn = s.turns[s.turnIdx + 1]
  const nextUp = after && nextTurn ? { teamId: nextTurn.teamId, defuserId: chooseDefuser(s, nextTurn.teamId, ctx).id } : null
  const defuserOffline = !!b && active && (!isConnected(ctx, b.defuserId) || s.gone.includes(b.defuserId))

  return {
    phase: s.phase,
    round: b?.round ?? s.turns[Math.min(s.turnIdx, s.turns.length - 1)]?.round ?? 1,
    rounds: s.settings.rounds,
    turn: b?.turn ?? s.turnIdx,
    turnCount: s.turns.length,
    activeTeamId: b?.teamId ?? null,
    defuserId: b?.defuserId ?? null,
    role,
    phaseEndsAt: s.phaseEndsAt,
    bomb,
    manual,
    pageHolders,
    defuserOffline,
    canTakeOver: defuserOffline && role === 'expert',
    heckles: b && active ? b.heckles : [],
    heckleEnabled: s.settings.heckles,
    prediction,
    predictions: after && b ? b.predictions : {},
    aftermath: after ? s.aftermath : null,
    history: s.history,
    nextUp,
  }
}

// ---------------------------------------------------------------------------
// Player leaving for good
// ---------------------------------------------------------------------------

function onPlayerGone(s0: State, playerId: PlayerId, ctx: BaseCtx): Step<State> {
  const team = teamOf(s0, playerId)
  if (!team || s0.gone.includes(playerId)) return { state: s0 }
  const s: State = { ...s0, gone: [...s0.gone, playerId] }
  const b = s.bomb
  if (!b || (s.phase !== 'briefing' && s.phase !== 'live') || team.id !== b.teamId) return { state: s }
  if (playerId !== b.defuserId) return { state: { ...s, bomb: deal(s, b) } }
  const next = chooseDefuser(s, b.teamId, ctx).id
  if (!next) return endBomb(s, ctx, 'abandoned', 'The whole team vanished')
  const bomb = deal(s, { ...b, defuserId: next, modules: b.modules.map(releaseHolds) })
  return { state: { ...s, bomb }, events: [{ type: 'takeover', data: { by: next, auto: true } }] }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function results(s: State): ReturnType<GameDefinition['results']> {
  const played = s.history.filter((h) => h.defuserId)
  const highlights: string[] = []
  const awards: { playerId: PlayerId; title: string; emoji: string }[] = []
  for (const t of s.teams) {
    const mine = played.filter((h) => h.teamId === t.id)
    if (!mine.length) continue
    const d = mine.filter((h) => h.result === 'defused').length
    highlights.push(`${t.name} defused ${d} of ${mine.length} bomb${mine.length === 1 ? '' : 's'}${d === 0 ? ' — the neighbours have complained' : ''}`)
  }
  const defused = played.filter((h) => h.result === 'defused')
  const clutch = [...defused].sort((a, b) => a.timeLeftMs - b.timeLeftMs)[0]
  if (clutch && clutch.timeLeftMs < 20_000) {
    highlights.push(`${name(s, clutch.defuserId)} defused with ${fmt(clutch.timeLeftMs)} left. Cardiologists hate this one trick.`)
    awards.push({ playerId: clutch.defuserId!, title: 'Last-Second Legend', emoji: '⏱️' })
  }
  const cool = [...defused].sort((a, b) => b.timeLeftMs - a.timeLeftMs)[0]
  if (cool && cool !== clutch) awards.push({ playerId: cool.defuserId!, title: 'Ice in the Veins', emoji: '🧊' })
  const [butter, n] = Object.entries(s.strikesBy).sort((a, b) => b[1] - a[1])[0] ?? [null, 0]
  if (butter && n >= 2) {
    highlights.push(`${name(s, butter)} racked up ${n} strikes. The wires have filed a complaint.`)
    awards.push({ playerId: butter, title: 'Butterfingers', emoji: '🧈' })
  }
  const close = played.find((h) => h.result === 'boom' && h.modulesTotal > 1 && h.modulesSolved === h.modulesTotal - 1)
  if (close) highlights.push(`${name(s, close.defuserId)} was ONE module away from glory. So close. So loud.`)
  const [heckler, hn] = Object.entries(s.heckleCount).sort((a, b) => b[1] - a[1])[0] ?? [null, 0]
  if (heckler && hn >= 3) {
    highlights.push(`${name(s, heckler)} heckled ${hn} times. Nobody asked. Everybody heard.`)
    awards.push({ playerId: heckler, title: 'Heckler-in-Chief', emoji: '📣' })
  }
  if (!highlights.length) highlights.push('Nobody blew up. Suspicious.')
  return { highlights: highlights.slice(0, 5), awards }
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const bombSquad: GameDefinition<State, Settings> = {
  id: 'bomb-squad',
  meta: {
    name: 'Bomb Squad',
    emoji: '💣',
    tagline: 'One phone has the bomb. Everyone else has a scrap of the manual. Talk fast.',
    howToPlay: [
      'Teams take turns. On your turn one teammate is the Defuser — only they can see the bomb.',
      'Everyone else is an Expert holding a DIFFERENT page of the manual. Nobody has the whole thing.',
      'Defuser: describe the bomb out loud. Experts: find your rule and shout it. Wrong move = strike and −15s.',
      'The other team watches with the answers on screen. They bet on BOOM and heckle. Loudly.',
      'Points per module disarmed, a bonus for defusing, more for time left. The defuser rotates every round.',
    ],
    minPlayers: 2,
    maxPlayers: 16,
    teams: { min: 2, max: 4 },
    minTeamSize: 1,
    estimatedMinutes: 20,
    teamChat: false,
    color: 'tomato',
  },
  settingsSpec: [
    { key: 'rounds', label: 'Rounds (one bomb per team each)', kind: 'number', min: 1, max: 6, step: 1, default: 3 },
    {
      key: 'fuse', label: 'Fuse length', kind: 'select', default: 'normal',
      options: [
        { value: 'relaxed', label: 'Relaxed (100s a module)' },
        { value: 'normal', label: 'Normal (75s a module)' },
        { value: 'panic', label: 'Panic (55s a module)' },
      ],
    },
    { key: 'strikes', label: 'Strikes before boom', kind: 'number', min: 1, max: 5, step: 1, default: 3 },
    { key: 'heckles', label: 'Let the other team heckle', kind: 'toggle', default: true },
  ],
  parseSettings(raw) {
    const num = (v: unknown, min: number, max: number, d: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d
    const fuse: Fuse = raw.fuse === 'relaxed' || raw.fuse === 'panic' ? raw.fuse : 'normal'
    return {
      rounds: num(raw.rounds, 1, 6, 3),
      fuse,
      strikes: num(raw.strikes, 1, 5, 3),
      heckles: typeof raw.heckles === 'boolean' ? raw.heckles : true,
    }
  },

  create(ctx) {
    const members = new Set(ctx.players.map((p) => p.id))
    const teams = ctx.teams.map((t) => ({ id: t.id, name: t.name, playerIds: t.playerIds.filter((p) => members.has(p)) }))
    const turns: State['turns'] = []
    for (let r = 1; r <= ctx.settings.rounds; r++) {
      // Rotate who goes first each round so nobody always watches first.
      for (let i = 0; i < teams.length; i++) turns.push({ round: r, teamId: teams[(i + r - 1) % teams.length]!.id })
    }
    const s: State = {
      settings: ctx.settings,
      teams,
      names: Object.fromEntries(ctx.players.map((p) => [p.id, p.name])),
      gone: [],
      turns,
      turnIdx: 0,
      rotation: Object.fromEntries(teams.map((t) => [t.id, 0])),
      roundKinds: {},
      phase: 'briefing',
      phaseEndsAt: null,
      bomb: null,
      aftermath: null,
      scores: Object.fromEntries(teams.map((t) => [t.id, 0])),
      history: [],
      strikesBy: {},
      heckleCount: {},
      lastHeckle: {},
      heckleSeq: 0,
    }
    return startTurn(s, ctx)
  },

  view,
  action: (s, playerId, a, ctx) => act(s, playerId, a.type, a.payload ?? {}, ctx),

  deadline(s) {
    if (s.phase === 'briefing' || s.phase === 'aftermath') return s.phaseEndsAt
    if (s.phase === 'live') return s.bomb?.explodeAt ?? null
    return null
  },

  tick,
  onPlayerGone,
  scores: (s) => ({ ...s.scores }),
  isOver: (s) => s.phase === 'over',
  results,
}
