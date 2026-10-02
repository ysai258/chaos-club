/**
 * Silent Sketch Relay — server engine.
 *
 * One team draws a secret prompt on a shared canvas, ONE STROKE EACH in
 * rotation, in silence. One of their own players is blindfolded this round
 * (the Seer): they race the rival teams to type the answer. If the Seer gets
 * it, the drawing team scores; if a rival gets there first, it is a steal.
 */
import type { BaseCtx, GameAction, GameDefinition, GameEvent, Step } from '../types.ts'
import type { PlayerId, TeamId } from '../../shared/protocol.ts'
import { PROMPTS, type Prompt } from './prompts.ts'
import { judge } from './match.ts'
import { validateChunk, appendChunk } from './strokes.ts'
import { BRUSH_WIDTH, MAX_STROKE_POINTS } from './limits.ts'
import type {
  BrushSize, Difficulty, GalleryItem, ModifierId, ModifierInfo, Phase,
  Role, RoundResultView, SketchSettings, SketchView, StrokeView,
} from './shared.ts'

// ---------------------------------------------------------------- tuning

export const T = {
  pickMs: 12_000,
  lastCallMs: 12_000,
  revealMs: 8_000,
  galleryMs: 120_000,
  inkMax: 1_600,
  droughtInk: 650,
  fogKeep: 2,
  guessCooldownMs: 900,
  maxGuessLen: 60,
  keepGuesses: 24,
  chaosChance: 0.6,
} as const

export const BASE_POINTS: Record<Difficulty, number> = { easy: 3, medium: 5, hard: 8 }

export const MODIFIERS: Record<ModifierId, ModifierInfo> = {
  fog: { id: 'fog', name: 'Fog of War', emoji: '🌫️', blurb: `Drawers only see the last ${T.fogKeep} strokes. Guessers see everything.` },
  blitz: { id: 'blitz', name: 'Blitz', emoji: '⚡', blurb: 'Half the time per stroke. Panic responsibly.' },
  drought: { id: 'drought', name: 'Ink Drought', emoji: '🏜️', blurb: 'Every stroke gets less than half the usual ink.' },
  flip: { id: 'flip', name: 'Topsy-Turvy', emoji: '🙃', blurb: 'Every other stroke is drawn on an upside-down canvas.' },
  fat: { id: 'fat', name: 'Fat Markers', emoji: '🖍️', blurb: 'Giant brushes only. Detail is a myth.' },
}
const MODIFIER_IDS = Object.keys(MODIFIERS) as ModifierId[]

/** Distinct, loud ink colours. Teammates get different ones. */
export const INKS = [
  '#ff3b2f', '#1689ff', '#22b33a', '#8a3ffc', '#ff9f0a', '#ff4fa3', '#14b8a6', '#1c1c1c',
  '#8b5a2b', '#2f3fbf', '#c0c41a', '#c2185b', '#00a2c7', '#7a7a7a', '#ff6f3c', '#5b8c00',
] as const

// ---------------------------------------------------------------- state

interface Stroke extends StrokeView { len: number }

interface Live { stroke: Stroke; seq: number }

interface Turn {
  id: number
  drawerId: PlayerId
  startedAt: number
  deadline: number
  inkMax: number
  flipped: boolean
}

interface Guess { id: number; playerId: PlayerId; teamId: TeamId; text: string }

interface Round {
  index: number
  teamId: TeamId
  seerId: PlayerId | null
  drawerOrder: PlayerId[]
  pickerId: PlayerId | null
  /** Indexes into PROMPTS. */
  options: number[]
  choice: number | null
  modifier: ModifierId | null
  strokes: Stroke[]
  live: Live | null
  turn: Turn | null
  /** Turns spent (strokes, passes and freezes). */
  strokesUsed: number
  nextDrawer: number
  guesses: Guess[]
  result: RoundResultView | null
}

interface Stats {
  ink: Record<PlayerId, number>
  strokes: Record<PlayerId, number>
  frozen: Record<PlayerId, number>
  correct: Record<PlayerId, number>
  wrong: Record<PlayerId, number>
  steals: Record<TeamId, number>
  fastest: { playerId: PlayerId; prompt: string; strokes: number } | null
  longest: { playerId: PlayerId; len: number } | null
}

export interface SketchState {
  settings: SketchSettings
  teams: { id: TeamId; playerIds: PlayerId[] }[]
  teamOrder: TeamId[]
  colors: Record<PlayerId, string>
  gone: PlayerId[]
  phase: Phase
  /** Deadline of pick / lastCall / reveal / gallery. Draw uses the turn deadline. */
  phaseDeadline: number | null
  totalRounds: number
  round: Round
  history: GalleryItem[]
  scores: Record<TeamId, number>
  usedPrompts: number[]
  seerCursor: Record<TeamId, number>
  turnCounter: number
  guessCounter: number
  lastGuessAt: Record<PlayerId, number>
  stats: Stats
}

type S = SketchState

// ---------------------------------------------------------------- helpers

const clampInt = (v: unknown, min: number, max: number, dflt: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dflt
  return Math.min(max, Math.max(min, n))
}

const pickOne = <X>(xs: readonly X[], random: () => number): X | undefined => xs[Math.floor(random() * xs.length)]

const bump = (rec: Record<string, number>, key: string, by = 1): Record<string, number> => ({ ...rec, [key]: (rec[key] ?? 0) + by })

const teamOf = (s: S, pid: PlayerId): TeamId | null => s.teams.find((t) => t.playerIds.includes(pid))?.id ?? null

const isConnected = (ctx: BaseCtx, pid: PlayerId): boolean => ctx.players.find((p) => p.id === pid)?.connected ?? false

const promptOf = (s: S): Prompt | null => (s.round.choice === null ? null : PROMPTS[s.round.choice] ?? null)

export function pointsNow(s: S): number {
  const p = promptOf(s)
  if (!p) return 0
  const base = BASE_POINTS[p.difficulty]
  const max = s.settings.strokesPerRound
  const left = Math.max(0, max - s.round.strokesUsed)
  return base + Math.round((base * left) / max)
}

function roleOf(s: S, pid: PlayerId): Role {
  const team = teamOf(s, pid)
  if (!team) return 'spectator'
  if (team !== s.round.teamId) return 'rival'
  return pid === s.round.seerId ? 'seer' : 'drawer'
}

function turnMs(s: S): number {
  const ms = s.settings.secondsPerStroke * 1000
  return s.round.modifier === 'blitz' ? Math.max(2500, Math.round(ms / 2)) : ms
}

function brushWidth(s: S, size: BrushSize): number {
  return s.round.modifier === 'fat' ? BRUSH_WIDTH.xl : BRUSH_WIDTH[size]
}

function samplePrompts(used: number[], random: () => number): number[] {
  const usedSet = new Set(used)
  const out: number[] = []
  for (const d of ['easy', 'medium', 'hard'] as Difficulty[]) {
    let pool = PROMPTS.map((p, i) => (p.difficulty === d && !usedSet.has(i) ? i : -1)).filter((i) => i >= 0)
    if (pool.length === 0) pool = PROMPTS.map((p, i) => (p.difficulty === d ? i : -1)).filter((i) => i >= 0)
    const i = pickOne(pool, random)
    if (i !== undefined) out.push(i)
  }
  return out
}

// ---------------------------------------------------------------- round flow

function emptyRound(index: number, teamId: TeamId): Round {
  return {
    index, teamId, seerId: null, drawerOrder: [], pickerId: null, options: [], choice: null, modifier: null,
    strokes: [], live: null, turn: null, strokesUsed: 0, nextDrawer: 0, guesses: [], result: null,
  }
}

/** Set up round `index` (or the gallery when there are no rounds left). */
function startRound(s: S, index: number, ctx: BaseCtx, events: GameEvent[]): S {
  for (let i = index; i < s.totalRounds; i++) {
    const teamId = s.teamOrder[i % s.teamOrder.length]
    if (teamId === undefined) break
    const roster = (s.teams.find((t) => t.id === teamId)?.playerIds ?? []).filter((p) => !s.gone.includes(p))
    if (roster.length === 0) continue // a team that left entirely loses its turn

    let seerId: PlayerId | null = null
    let seerCursor = s.seerCursor
    if (roster.length >= 2) {
      const start = s.seerCursor[teamId] ?? 0
      const ordered = roster.map((_, k) => roster[(start + k) % roster.length] as PlayerId)
      seerId = ordered.find((p) => isConnected(ctx, p)) ?? (ordered[0] as PlayerId)
      seerCursor = { ...s.seerCursor, [teamId]: start + 1 }
    }
    const drawers = roster.filter((p) => p !== seerId)
    const lap = Math.floor(i / s.teamOrder.length)
    const rot = drawers.length ? lap % drawers.length : 0
    const drawerOrder = [...drawers.slice(rot), ...drawers.slice(0, rot)]
    const options = samplePrompts(s.usedPrompts, ctx.random)
    const firstLap = i < s.teamOrder.length
    const modifier = s.settings.chaos && !firstLap && ctx.random() < T.chaosChance ? pickOne(MODIFIER_IDS, ctx.random) ?? null : null
    const round: Round = {
      ...emptyRound(i, teamId),
      seerId,
      drawerOrder,
      pickerId: drawerOrder.find((p) => isConnected(ctx, p)) ?? drawerOrder[0] ?? null,
      options,
      modifier,
    }
    events.push({ type: 'roundStart', data: { round: i, teamId, seerId, modifier } })
    return { ...s, seerCursor, round, phase: 'pick', phaseDeadline: ctx.now + T.pickMs, usedPrompts: [...s.usedPrompts, ...options] }
  }
  return { ...s, phase: 'gallery', phaseDeadline: ctx.now + T.galleryMs }
}

function choose(s: S, optionIndex: number, ctx: BaseCtx, events: GameEvent[]): S {
  const choice = s.round.options[optionIndex] ?? s.round.options[0] ?? null
  const next: S = { ...s, round: { ...s.round, choice }, phase: 'draw', phaseDeadline: null }
  return startTurn(next, ctx, events)
}

function startTurn(s: S, ctx: BaseCtx, events: GameEvent[]): S {
  const r = s.round
  if (r.strokesUsed >= s.settings.strokesPerRound || r.drawerOrder.length === 0) {
    return { ...s, phase: 'lastCall', phaseDeadline: ctx.now + T.lastCallMs, round: { ...r, turn: null, live: null } }
  }
  const n = r.drawerOrder.length
  let idx = r.nextDrawer % n
  for (let k = 0; k < n; k++) {
    const cand = r.drawerOrder[(r.nextDrawer + k) % n] as PlayerId
    if (isConnected(ctx, cand)) { idx = (r.nextDrawer + k) % n; break }
  }
  const drawerId = r.drawerOrder[idx] as PlayerId
  const turnId = s.turnCounter + 1
  const turn: Turn = {
    id: turnId,
    drawerId,
    startedAt: ctx.now,
    deadline: ctx.now + turnMs(s),
    inkMax: r.modifier === 'drought' ? T.droughtInk : T.inkMax,
    flipped: r.modifier === 'flip' && r.strokesUsed % 2 === 1,
  }
  events.push({ type: 'yourTurn', data: { turn: turnId }, to: { playerIds: [drawerId] } })
  return { ...s, turnCounter: turnId, round: { ...r, turn, live: null, nextDrawer: idx + 1 } }
}

/** Finish the current turn: commit whatever was drawn, then hand over. */
function endTurn(s: S, ctx: BaseCtx, events: GameEvent[], how: 'stroke' | 'pass' | 'timeout' | 'gone'): S {
  const r = s.round
  const turn = r.turn
  if (!turn) return s
  const live = r.live
  let stats = s.stats
  let strokes = r.strokes
  let used = r.strokesUsed
  if (live && live.stroke.p.length >= 2) {
    const st = live.stroke
    strokes = [...strokes, st]
    used += 1
    stats = {
      ...stats,
      ink: bump(stats.ink, st.by, Math.round(st.len)),
      strokes: bump(stats.strokes, st.by),
      longest: !stats.longest || st.len > stats.longest.len ? { playerId: st.by, len: Math.round(st.len) } : stats.longest,
    }
  } else if (how === 'pass') {
    used += 1
  } else if (how === 'timeout') {
    used += 1
    stats = { ...stats, frozen: bump(stats.frozen, turn.drawerId) }
    events.push({ type: 'frozen', data: { playerId: turn.drawerId } })
  }
  // 'gone' with no ink: the turn simply does not count.
  const next: S = { ...s, stats, round: { ...r, strokes, strokesUsed: used, live: null, turn: null } }
  return startTurn(next, ctx, events)
}

function finishRound(s: S, ctx: BaseCtx, events: GameEvent[], winner: { playerId: PlayerId; teamId: TeamId; text: string } | null): S {
  // Ink in flight at the end still belongs in the picture.
  let r = s.round
  if (r.live && r.live.stroke.p.length >= 2) r = { ...r, strokes: [...r.strokes, r.live.stroke] }
  const prompt = promptOf(s)
  const pts = pointsNow(s)
  const steal = winner !== null && winner.teamId !== r.teamId
  let scores = s.scores
  let stats = s.stats
  if (winner) {
    scores = bump(scores, winner.teamId, pts)
    // A solo team has no Seer, so the rivals guessing it is the only way it pays off: an assist.
    if (steal && r.seerId === null) scores = bump(scores, r.teamId, Math.ceil(pts / 2))
    stats = {
      ...stats,
      correct: bump(stats.correct, winner.playerId),
      steals: steal ? bump(stats.steals, winner.teamId) : stats.steals,
      fastest: prompt && (!stats.fastest || r.strokesUsed < stats.fastest.strokes)
        ? { playerId: winner.playerId, prompt: prompt.text, strokes: r.strokesUsed }
        : stats.fastest,
    }
    events.push({ type: 'correct', data: { teamId: winner.teamId, playerId: winner.playerId, steal, points: pts } })
  } else {
    events.push({ type: 'stumped', data: {} })
  }
  const result: RoundResultView = {
    prompt: prompt?.text ?? '???',
    difficulty: prompt?.difficulty ?? 'easy',
    drawingTeamId: r.teamId,
    winnerTeamId: winner?.teamId ?? null,
    winnerPlayerId: winner?.playerId ?? null,
    steal,
    points: winner ? pts : 0,
    strokesUsed: r.strokesUsed,
    winningGuess: winner?.text ?? null,
  }
  const item: GalleryItem = {
    round: r.index,
    prompt: result.prompt,
    drawingTeamId: r.teamId,
    seerId: r.seerId,
    modifier: r.modifier,
    strokes: r.strokes.map(({ by, c, w, p }) => ({ by, c, w, p })),
    result,
  }
  return {
    ...s,
    scores,
    stats,
    phase: 'reveal',
    phaseDeadline: ctx.now + T.revealMs,
    history: [...s.history, item],
    round: { ...r, live: null, turn: null, result },
  }
}

// ---------------------------------------------------------------- reducers

function tickOnce(s: S, ctx: BaseCtx, events: GameEvent[]): S {
  switch (s.phase) {
    case 'pick': {
      const k = Math.floor(ctx.random() * Math.max(1, s.round.options.length))
      return choose(s, k, ctx, events)
    }
    case 'draw':
      return endTurn(s, ctx, events, 'timeout')
    case 'lastCall':
      return finishRound(s, ctx, events, null)
    case 'reveal':
      return startRound(s, s.round.index + 1, ctx, events)
    case 'gallery':
      return { ...s, phase: 'over', phaseDeadline: null }
    default:
      return s
  }
}

function deadlineOf(s: S): number | null {
  if (s.phase === 'draw') return s.round.turn?.deadline ?? null
  if (s.phase === 'over') return null
  return s.phaseDeadline
}

/** Apply every overdue tick, so an action that races a timer sees the newer state. */
function catchUp(s: S, ctx: BaseCtx, events: GameEvent[]): S {
  let cur = s
  for (let guard = 0; guard < 50; guard++) {
    const d = deadlineOf(cur)
    if (d === null || d > ctx.now) break
    cur = tickOnce(cur, ctx, events)
  }
  return cur
}

function onInk(s: S, pid: PlayerId, payload: Record<string, unknown>, ctx: BaseCtx, events: GameEvent[]): Step<S> {
  const r = s.round
  const turn = r.turn
  // Ink racing a turn change is normal (finger still down when the timer hits): drop it quietly.
  if (s.phase !== 'draw' || !turn || payload.round !== r.index || payload.turn !== turn.id) return { state: s, events }
  if (turn.drawerId !== pid) return { state: s, events, error: 'Not your stroke — hands off! ✋' }
  const chunk = validateChunk(payload.pts)
  if (!chunk.ok) return { state: s, events, error: chunk.error }
  const seq = typeof payload.seq === 'number' && Number.isInteger(payload.seq) ? payload.seq : -1
  if (seq < 0) return { state: s, events, error: 'Bad ink' }
  if (r.live && seq <= r.live.seq) return { state: s, events } // duplicate
  const sizeRaw = payload.size
  const size: BrushSize = sizeRaw === 's' || sizeRaw === 'l' ? sizeRaw : 'm'
  const stroke: Stroke = r.live?.stroke ?? { by: pid, c: s.colors[pid] ?? '#1c1c1c', w: brushWidth(s, size), p: [], len: 0 }
  const res = appendChunk(stroke.p, stroke.len, chunk.pts, turn.inkMax, MAX_STROKE_POINTS)
  const live: Live = { stroke: { ...stroke, p: res.points, len: res.len }, seq }
  const next: S = { ...s, round: { ...r, live } }
  if (payload.end === true || res.capped) {
    if (live.stroke.p.length === 0) return { state: endTurn({ ...next, round: { ...next.round, live: null } }, ctx, events, 'pass'), events }
    return { state: endTurn(next, ctx, events, 'stroke'), events }
  }
  return { state: next, events }
}

function onGuess(s: S, pid: PlayerId, payload: Record<string, unknown>, ctx: BaseCtx, events: GameEvent[]): Step<S> {
  if (payload.round !== s.round.index || (s.phase !== 'draw' && s.phase !== 'lastCall')) {
    return { state: s, events, error: s.phase === 'pick' ? 'Wait for the first stroke!' : 'Too late — that round is over' }
  }
  const role = roleOf(s, pid)
  if (role === 'drawer') return { state: s, events, error: 'You know the answer, genius 🤐' }
  if (role === 'spectator' || s.gone.includes(pid)) return { state: s, events, error: 'You are watching this one' }
  const text = typeof payload.text === 'string' ? payload.text.replace(/\s+/g, ' ').trim().slice(0, T.maxGuessLen) : ''
  if (!text) return { state: s, events, error: 'Type a guess first' }
  const last = s.lastGuessAt[pid] ?? -Infinity
  if (ctx.now - last < T.guessCooldownMs) return { state: s, events, error: 'Slow down! One guess at a time' }
  const prompt = promptOf(s)
  if (!prompt) return { state: s, events, error: 'No prompt yet' }
  const teamId = teamOf(s, pid) as TeamId
  const base: S = { ...s, lastGuessAt: { ...s.lastGuessAt, [pid]: ctx.now } }
  const verdict = judge(text, [prompt.text, ...prompt.accept])
  if (verdict === 'correct') return { state: finishRound(base, ctx, events, { playerId: pid, teamId, text }), events }
  const id = s.guessCounter + 1
  const guesses = [...s.round.guesses, { id, playerId: pid, teamId, text }].slice(-T.keepGuesses)
  events.push({ type: 'wrong', data: { playerId: pid, text } })
  if (verdict === 'close') events.push({ type: 'close', data: { text }, to: { playerIds: [pid] } })
  return {
    state: { ...base, guessCounter: id, stats: { ...s.stats, wrong: bump(s.stats.wrong, pid) }, round: { ...s.round, guesses } },
    events,
  }
}

// ---------------------------------------------------------------- definition

export const sketchRelay: GameDefinition<S, SketchSettings> = {
  id: 'sketch-relay',
  meta: {
    name: 'Silent Sketch Relay',
    emoji: '✏️',
    tagline: 'One stroke each. No talking. Your teammate just ruined the elephant.',
    howToPlay: [
      'Your team draws one secret prompt together — ONE stroke each, a few seconds per turn, in rotation.',
      'Drawers stay SILENT. No talking, no letters, no numbers. Mute if you must. 🤫',
      'One teammate is blindfolded each round (the Seer) and has to type the answer.',
      'Rival teams watch the same canvas — if they type it first, they steal the points!',
      'Fewer strokes = more points. Hard prompts pay more.',
    ],
    minPlayers: 2,
    maxPlayers: 16,
    teams: { min: 2, max: 4 },
    minTeamSize: 1,
    estimatedMinutes: 12,
    teamChat: false,
    color: 'bubblegum',
  },
  settingsSpec: [
    { key: 'roundsPerTeam', label: 'Drawings per team', kind: 'number', min: 1, max: 5, default: 2 },
    { key: 'strokesPerRound', label: 'Strokes per drawing', kind: 'number', min: 6, max: 24, step: 2, default: 12 },
    { key: 'secondsPerStroke', label: 'Seconds per stroke', kind: 'number', min: 3, max: 12, default: 6 },
    { key: 'chaos', label: 'Chaos cards (fog, blitz, upside-down…)', kind: 'toggle', default: true },
  ],
  parseSettings(raw) {
    return {
      roundsPerTeam: clampInt(raw.roundsPerTeam, 1, 5, 2),
      strokesPerRound: clampInt(raw.strokesPerRound, 6, 24, 12),
      secondsPerStroke: clampInt(raw.secondsPerStroke, 3, 12, 6),
      chaos: typeof raw.chaos === 'boolean' ? raw.chaos : true,
    }
  },

  create(ctx) {
    const settings = sketchRelay.parseSettings(ctx.settings)
    const teams = ctx.teams.map((t) => ({ id: t.id, playerIds: t.playerIds.filter((p) => ctx.players.some((q) => q.id === p)) }))
    const teamOrder = teams.filter((t) => t.playerIds.length > 0).map((t) => t.id)
    const colors: Record<PlayerId, string> = {}
    for (const t of teams) t.playerIds.forEach((p, i) => { colors[p] = INKS[i % INKS.length] as string })
    const base: S = {
      settings,
      teams,
      teamOrder,
      colors,
      gone: [],
      phase: 'pick',
      phaseDeadline: null,
      totalRounds: teamOrder.length * settings.roundsPerTeam,
      round: emptyRound(0, teamOrder[0] ?? ''),
      history: [],
      scores: Object.fromEntries(ctx.teams.map((t) => [t.id, 0])),
      usedPrompts: [],
      seerCursor: Object.fromEntries(teams.map((t) => [t.id, Math.floor(ctx.random() * Math.max(1, t.playerIds.length))])),
      turnCounter: 0,
      guessCounter: 0,
      lastGuessAt: {},
      stats: { ink: {}, strokes: {}, frozen: {}, correct: {}, wrong: {}, steals: {}, fastest: null, longest: null },
    }
    return startRound(base, 0, ctx, [])
  },

  view(s, viewerId, ctx): SketchView {
    const r = s.round
    const role = roleOf(s, viewerId)
    const live = s.phase === 'draw' || s.phase === 'lastCall'
    const ended = s.phase === 'reveal' || s.phase === 'gallery' || s.phase === 'over'
    const p = promptOf(s)
    const prompt = (role === 'drawer' && live) || ended ? p?.text ?? null : null
    const fogged = r.modifier === 'fog' && role === 'drawer' && live
    const all = r.strokes.map(({ by, c, w, p: pts }): StrokeView => ({ by, c, w, p: pts }))
    const strokes = fogged ? all.slice(-T.fogKeep) : all
    return {
      phase: s.phase,
      round: r.index,
      totalRounds: s.totalRounds,
      role,
      drawingTeamId: r.teamId,
      seerId: r.seerId,
      drawerOrder: r.drawerOrder,
      pickerId: r.pickerId,
      colors: s.colors,
      myColor: s.colors[viewerId] ?? null,
      modifier: r.modifier ? MODIFIERS[r.modifier] : null,
      difficulty: p && s.phase !== 'pick' ? p.difficulty : null,
      pointsNow: pointsNow(s),
      options: role === 'drawer' && s.phase === 'pick'
        ? r.options.map((pi, index) => {
          const q = PROMPTS[pi] as Prompt
          return { index, text: q.text, difficulty: q.difficulty, points: BASE_POINTS[q.difficulty] * 2 }
        })
        : null,
      prompt,
      turn: r.turn && s.phase === 'draw'
        ? { ...r.turn, inkUsed: Math.round(r.live?.stroke.len ?? 0) }
        : null,
      strokesUsed: r.strokesUsed,
      strokesMax: s.settings.strokesPerRound,
      strokes,
      fogHidden: all.length - strokes.length,
      live: r.live && s.phase === 'draw' ? { by: r.live.stroke.by, c: r.live.stroke.c, w: r.live.stroke.w, p: r.live.stroke.p } : null,
      guesses: r.guesses,
      canGuess: live && (role === 'seer' || role === 'rival') && !s.gone.includes(viewerId),
      result: s.phase === 'reveal' ? r.result : null,
      gallery: s.phase === 'gallery' || s.phase === 'over' ? s.history : null,
      isHost: ctx.hostId === viewerId,
    }
  },

  action(state, pid, action: GameAction, ctx) {
    const events: GameEvent[] = []
    const s = catchUp(state, ctx, events)
    const payload = action.payload ?? {}
    if (!teamOf(s, pid)) return { state: s, events, error: 'You joined mid-game — you are watching this one 👀' }
    switch (action.type) {
      case 'pick': {
        if (s.phase !== 'pick' || payload.round !== s.round.index) return { state: s, events, error: 'Too late to pick' }
        if (roleOf(s, pid) !== 'drawer') return { state: s, events, error: 'Only the drawers pick the prompt' }
        const idx = payload.index
        if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= s.round.options.length) {
          return { state: s, events, error: 'Pick one of the cards' }
        }
        return { state: choose(s, idx, ctx, events), events }
      }
      case 'ink':
        return onInk(s, pid, payload, ctx, events)
      case 'pass': {
        const turn = s.round.turn
        if (s.phase !== 'draw' || !turn || payload.round !== s.round.index || payload.turn !== turn.id) return { state: s, events }
        if (turn.drawerId !== pid) return { state: s, events, error: 'Not your turn' }
        return { state: endTurn(s, ctx, events, 'pass'), events }
      }
      case 'guess':
        return onGuess(s, pid, payload, ctx, events)
      case 'finish': {
        if (s.phase !== 'gallery') return { state: s, events, error: 'Not yet' }
        if (ctx.hostId !== pid) return { state: s, events, error: 'Only the host can wrap up' }
        return { state: { ...s, phase: 'over', phaseDeadline: null }, events }
      }
      default:
        return { state: s, events, error: 'Unknown action' }
    }
  },

  deadline: deadlineOf,

  tick(s, ctx) {
    const events: GameEvent[] = []
    return { state: tickOnce(s, ctx, events), events }
  },

  onPlayerGone(s, pid, ctx) {
    if (s.gone.includes(pid) || !teamOf(s, pid) || s.phase === 'over') return { state: s }
    const events: GameEvent[] = []
    let next: S = { ...s, gone: [...s.gone, pid] }
    const r = next.round
    if (r.teamId !== teamOf(s, pid) || (s.phase !== 'pick' && s.phase !== 'draw' && s.phase !== 'lastCall')) {
      return { state: next, events }
    }
    let drawerOrder = r.drawerOrder.filter((p) => p !== pid)
    let seerId = r.seerId === pid ? null : r.seerId
    // The last drawer left: the blindfold comes off and the Seer has to draw.
    if (drawerOrder.length === 0 && seerId) {
      drawerOrder = [seerId]
      seerId = null
    }
    const oldIdx = r.drawerOrder.indexOf(pid)
    const nextDrawer = oldIdx >= 0 && oldIdx < r.nextDrawer ? Math.max(0, r.nextDrawer - 1) : r.nextDrawer
    const pickerId = r.pickerId === pid ? drawerOrder[0] ?? null : r.pickerId
    next = { ...next, round: { ...r, drawerOrder, seerId, nextDrawer, pickerId } }
    if (drawerOrder.length === 0) {
      if (next.phase === 'pick') next = { ...next, round: { ...next.round, choice: next.round.options[0] ?? null } }
      return { state: finishRound(next, ctx, events, null), events }
    }
    if (next.phase === 'draw' && r.turn?.drawerId === pid) {
      next = endTurn(next, ctx, events, 'gone')
    }
    return { state: next, events }
  },

  scores: (s) => s.scores,

  isOver: (s) => s.phase === 'over',

  results(s, ctx) {
    const name = (pid: PlayerId) => ctx.players.find((p) => p.id === pid)?.name ?? 'Someone'
    const teamName = (tid: TeamId) => ctx.teams.find((t) => t.id === tid)?.name ?? 'A team'
    const top = (rec: Record<string, number>): [string, number] | null => {
      const e = Object.entries(rec).sort((a, b) => b[1] - a[1])[0]
      return e && e[1] > 0 ? e : null
    }
    const highlights: string[] = []
    const st = s.stats
    if (st.fastest) highlights.push(`⚡ ${name(st.fastest.playerId)} read “${st.fastest.prompt}” after just ${st.fastest.strokes} stroke${st.fastest.strokes === 1 ? '' : 's'}`)
    const thief = top(st.steals)
    if (thief) highlights.push(`🦝 ${teamName(thief[0])} stole ${thief[1]} drawing${thief[1] === 1 ? '' : 's'}`)
    const stumped = s.history.filter((h) => !h.result.winnerTeamId)
    if (stumped.length) highlights.push(`🤷 ${stumped.length} drawing${stumped.length === 1 ? '' : 's'} stumped everyone (RIP “${stumped[0]?.prompt}”)`)
    const froze = top(st.frozen)
    if (froze) highlights.push(`🗿 ${name(froze[0])} froze ${froze[1]} time${froze[1] === 1 ? '' : 's'} with the pen in hand`)
    const wrong = top(st.wrong)
    if (wrong && wrong[1] >= 3) highlights.push(`🎯 ${name(wrong[0])} fired ${wrong[1]} wrong guesses. Volume strategy.`)

    const awards: { playerId: PlayerId; title: string; emoji: string }[] = []
    const ink = top(st.ink)
    if (ink) awards.push({ playerId: ink[0], title: 'Picasso of Panic', emoji: '🎨' })
    const reader = top(st.correct)
    if (reader) awards.push({ playerId: reader[0], title: 'Mind Reader', emoji: '🔮' })
    if (st.longest && st.longest.playerId !== ink?.[0]) awards.push({ playerId: st.longest.playerId, title: 'Longest Line', emoji: '📏' })
    if (froze) awards.push({ playerId: froze[0], title: 'Statue Mode', emoji: '🗿' })
    return { highlights, awards }
  },
}
