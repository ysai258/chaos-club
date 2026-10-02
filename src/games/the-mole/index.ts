/**
 * THE MOLE — co-op challenges with a traitor on every team.
 *
 * Each team plays the same kind of quick challenge every round, with its own
 * content. One player per team is secretly a Mole working for a RIVAL team:
 * they get a private sabotage objective each challenge, and every objective
 * they pull off pays their employer (revealed only at the end). After each
 * challenge the team sees partial evidence and can vote to accuse. Catch your
 * mole = big bonus. Accuse an innocent = penalty, and they're cleared. Any mole
 * still hidden after the last round faces a mandatory Final Hunt; if they
 * survive it, their employer cashes a fat escape bonus.
 *
 * Hidden information: `team.mole` and the challenge's `d.mole` never reach a
 * view except the mole's own (and everyone's at the unmasking).
 */
import type { PlayerId, TeamId } from '../../shared/protocol.ts'
import type { BaseCtx, GameDefinition, GameEvent, Step } from '../types.ts'
import { ALL_KINDS, CHALLENGES, active, pick, shuffle, type Base } from './challenges.ts'
import type {
  AccusationResult, CaseEntry, ChallengeKind, Evidence, MolePhase, MoleView, RoleView, UnmaskTeam, Wiretap,
} from './shared.ts'

// ---------- tuning ----------

export const SCORING = { win: 3, catch: 6, wrong: -3, finalCatch: 4, escape: 8, sabotage: 2 } as const
export const WIRETAP_COST = 2
export const BADGES = 2
export const CLEAN_BONUS = 4
export const BRIEF_MS = 9_000
export const DEBRIEF_MS = 60_000
export const VERDICT_MS = 9_000
export const FINAL_MS = 60_000
export const UNMASK_MS = 60_000
/** Challenges where a wiretap reveals something hidden per player. */
const TAPPABLE: ChallengeKind[] = ['safe', 'heist', 'intel', 'bribe', 'ballpark', 'stock']

export interface MoleSettings extends Record<string, unknown> {
  rounds: number
  pace: 'chill' | 'normal' | 'quick'
  paranoia: boolean
}

const PACE: Record<MoleSettings['pace'], number> = { chill: 1.4, normal: 1, quick: 0.75 }

// ---------- state ----------

export interface TeamState {
  id: TeamId
  members: PlayerId[]
  mole: PlayerId | null
  employer: TeamId | null
  caught: boolean
  caughtRound: number | null
  badges: number
  cleared: PlayerId[]
  current: { kind: ChallengeKind; d: Base } | null
  result: { success: boolean; points: number } | null
  votes: Record<PlayerId, string>
  wiretap: Wiretap | null
  caseFile: CaseEntry[]
  hits: { round: number; name: string; emoji: string }[]
  finalVotes: Record<PlayerId, string>
  fate: UnmaskTeam['fate'] | null
  calledClean: boolean
}

export interface MoleState {
  settings: MoleSettings
  phase: MolePhase
  phaseDeadline: number | null
  /** 0-based index of the current challenge. */
  round: number
  kinds: ChallengeKind[]
  teams: TeamState[]
  gone: PlayerId[]
  score: Record<TeamId, number>
  /** Sabotage + escape payouts, hidden until the unmasking. */
  secret: Record<TeamId, number>
  revealed: boolean
  used: Partial<Record<ChallengeKind, number[]>>
  verdicts: AccusationResult[]
  unmask: UnmaskTeam[] | null
  over: boolean
}

// ---------- small helpers ----------

const teamOfPlayer = (s: MoleState, pid: PlayerId): TeamState | undefined => s.teams.find((t) => t.members.includes(pid))
const activeMembers = (s: MoleState, t: TeamState): PlayerId[] => t.members.filter((p) => !s.gone.includes(p))
const mapTeam = (s: MoleState, id: TeamId, f: (t: TeamState) => TeamState): MoleState =>
  ({ ...s, teams: s.teams.map((t) => (t.id === id ? f(t) : t)) })
const canAccuse = (t: TeamState): boolean => !t.caught && t.badges > 0
const accusable = (t: TeamState): PlayerId[] =>
  t.members.filter((p) => !t.cleared.includes(p) && !(t.caught && p === t.mole))
/** Votes needed to convict `target`: a strict majority of the team's OTHER active players. */
const neededFor = (s: MoleState, t: TeamState, target: PlayerId): number => {
  const others = activeMembers(s, t).filter((p) => p !== target).length
  return Math.floor(others / 2) + 1
}
const needsFinal = (s: MoleState, t: TeamState): boolean =>
  !t.caught && activeMembers(s, t).length > 0 && (t.mole !== null || s.settings.paranoia)

function intPayload(p: Record<string, unknown>, k: string): number | null {
  const v = p[k]
  return typeof v === 'number' && Number.isInteger(v) ? v : null
}

// ---------- phase transitions ----------

function startBriefing(s: MoleState, ctx: BaseCtx): MoleState {
  const kind = s.kinds[s.round] as ChallengeKind
  const ch = CHALLENGES[kind]
  const start = ctx.now + BRIEF_MS
  const used = [...(s.used[kind] ?? [])]
  const teams = s.teams.map((t): TeamState => {
    const roster = activeMembers(s, t)
    const reset = { ...t, votes: {}, wiretap: null, result: null }
    if (roster.length < 2) return { ...reset, current: null }
    const mole = t.mole && !t.caught && roster.includes(t.mole) ? t.mole : null
    const d = ch.setup({ roster, mole, start, random: ctx.random, avoid: used, pace: PACE[s.settings.pace] })
    used.push(d.content)
    return { ...reset, current: { kind, d } }
  })
  return { ...s, teams, phase: 'briefing', phaseDeadline: start, verdicts: [], used: { ...s.used, [kind]: used } }
}

const allChallengesDone = (s: MoleState): boolean => s.teams.every((t) => !t.current || t.current.d.done)

function toDebrief(s: MoleState, ctx: BaseCtx): Step<MoleState> {
  const score = { ...s.score }
  const secret = { ...s.secret }
  const events: GameEvent[] = []
  const kind = s.kinds[s.round] as ChallengeKind
  const ch = CHALLENGES[kind]
  const teams = s.teams.map((t): TeamState => {
    const base = { round: s.round + 1, kind, name: ch.name, emoji: ch.emoji, wiretap: null, accusation: null }
    if (!t.current) {
      const evidence: Evidence = { success: false, points: 0, headline: 'Not enough players — your team sat this one out.', facts: [], anon: [], named: null }
      return { ...t, result: null, caseFile: [...t.caseFile, { ...base, evidence, skipped: true }] }
    }
    const r = ch.resolve(t.current.d, ctx.random)
    score[t.id] = (score[t.id] ?? 0) + r.points
    let hits = t.hits
    if (r.sabotage && t.employer && t.current.d.mole) {
      secret[t.employer] = (secret[t.employer] ?? 0) + SCORING.sabotage
      hits = [...hits, { round: s.round + 1, name: ch.name, emoji: ch.emoji }]
    }
    events.push({ type: r.success ? 'success' : 'fail', to: { teamId: t.id }, data: { points: r.points } })
    return { ...t, hits, result: { success: r.success, points: r.points }, caseFile: [...t.caseFile, { ...base, evidence: r.evidence }] }
  })
  return { state: { ...s, teams, score, secret, phase: 'debrief', phaseDeadline: ctx.now + DEBRIEF_MS }, events }
}

function setLastCase(t: TeamState, patch: Partial<CaseEntry>): CaseEntry[] {
  const last = t.caseFile[t.caseFile.length - 1]
  if (!last) return t.caseFile
  return [...t.caseFile.slice(0, -1), { ...last, ...patch }]
}

function endDebrief(s: MoleState, ctx: BaseCtx): Step<MoleState> {
  const score = { ...s.score }
  const verdicts: AccusationResult[] = []
  const events: GameEvent[] = []
  const teams = s.teams.map((t): TeamState => {
    if (!canAccuse(t)) return t
    const voters = activeMembers(s, t)
    const tally: Record<PlayerId, number> = {}
    for (const v of voters) {
      const target = t.votes[v]
      if (target && target !== 'pass') tally[target] = (tally[target] ?? 0) + 1
    }
    const qualifying = Object.keys(tally).filter((p) => (tally[p] as number) >= neededFor(s, t, p))
    if (!qualifying.length) return t
    const best = Math.max(...qualifying.map((p) => tally[p] as number))
    const top = qualifying.filter((p) => tally[p] === best)
    if (top.length !== 1) return t
    const accused = top[0] as PlayerId
    const correct = accused === t.mole
    const points = correct ? SCORING.catch : SCORING.wrong
    score[t.id] = (score[t.id] ?? 0) + points
    const result: AccusationResult = {
      teamId: t.id, accused, correct, final: false, points,
      votes: voters.filter((v) => t.votes[v]).map((v) => ({ voter: v, target: t.votes[v] as string })),
    }
    verdicts.push(result)
    events.push({ type: correct ? 'caught' : 'cleared', data: { teamId: t.id, playerId: accused } })
    return {
      ...t,
      badges: t.badges - 1,
      caught: correct || t.caught,
      caughtRound: correct ? s.round + 1 : t.caughtRound,
      cleared: correct ? t.cleared : [...t.cleared, accused],
      caseFile: setLastCase(t, { accusation: result }),
    }
  })
  const next = { ...s, teams, score, verdicts }
  if (verdicts.length) return { state: { ...next, phase: 'verdict', phaseDeadline: ctx.now + VERDICT_MS }, events }
  return { state: nextRound(next, ctx), events }
}

function nextRound(s: MoleState, ctx: BaseCtx): MoleState {
  const round = s.round + 1
  if (round < s.settings.rounds) return startBriefing({ ...s, round }, ctx)
  const done = { ...s, verdicts: [] }
  if (s.teams.some((t) => needsFinal(s, t))) return { ...done, phase: 'finalHunt', phaseDeadline: ctx.now + FINAL_MS }
  return unmask(done, ctx)
}

function endFinal(s: MoleState, ctx: BaseCtx): MoleState {
  const score = { ...s.score }
  const teams = s.teams.map((t): TeamState => {
    if (!needsFinal(s, t)) return t
    const tally: Record<string, number> = {}
    for (const v of activeMembers(s, t)) {
      const target = t.finalVotes[v]
      if (target) tally[target] = (tally[target] ?? 0) + 1
    }
    const best = Math.max(0, ...Object.values(tally))
    const top = Object.keys(tally).filter((k) => tally[k] === best)
    const choice = best > 0 && top.length === 1 ? (top[0] as string) : null
    if (t.mole === null) {
      const ok = choice === 'clean'
      if (ok) score[t.id] = (score[t.id] ?? 0) + CLEAN_BONUS
      return { ...t, fate: ok ? 'clean' : 'clean-missed', calledClean: ok }
    }
    const ok = choice === t.mole
    if (ok) score[t.id] = (score[t.id] ?? 0) + SCORING.finalCatch
    return { ...t, fate: ok ? 'final' : 'escaped' }
  })
  return unmask({ ...s, teams, score }, ctx)
}

function unmask(s: MoleState, ctx: BaseCtx): MoleState {
  const secret = { ...s.secret }
  const teams = s.teams.map((t): TeamState => {
    const fate = t.fate ?? (t.mole === null ? 'clean' : t.caught ? 'caught' : 'escaped')
    if (fate === 'escaped' && t.employer) secret[t.employer] = (secret[t.employer] ?? 0) + SCORING.escape
    return { ...t, fate }
  })
  const list: UnmaskTeam[] = teams.map((t) => {
    const payouts: UnmaskTeam['payouts'] = []
    if (t.employer && t.hits.length) payouts.push({ label: `${t.hits.length} sabotage${t.hits.length === 1 ? '' : 's'} paid out`, teamId: t.employer, points: t.hits.length * SCORING.sabotage })
    if (t.fate === 'escaped' && t.employer) payouts.push({ label: 'Mole escaped!', teamId: t.employer, points: SCORING.escape })
    if (t.fate === 'caught') payouts.push({ label: `Caught in round ${t.caughtRound}`, teamId: t.id, points: SCORING.catch })
    if (t.fate === 'final') payouts.push({ label: 'Nailed in the Final Hunt', teamId: t.id, points: SCORING.finalCatch })
    if (t.calledClean) payouts.push({ label: 'Called it: no mole!', teamId: t.id, points: CLEAN_BONUS })
    return { teamId: t.id, moleId: t.mole, employerTeamId: t.employer, fate: t.fate ?? 'clean', caughtRound: t.caughtRound, hits: t.hits, payouts }
  })
  return { ...s, teams, secret, revealed: true, unmask: list, phase: 'unmasking', phaseDeadline: ctx.now + UNMASK_MS }
}

function allVoted(s: MoleState, key: 'votes' | 'finalVotes'): boolean {
  return s.teams.every((t) => {
    if (key === 'finalVotes' && !needsFinal(s, t)) return true
    return activeMembers(s, t).every((p) => p in t[key])
  })
}

function afterChange(s: MoleState, ctx: BaseCtx, events: GameEvent[] = []): Step<MoleState> {
  if (s.phase === 'challenge' && allChallengesDone(s)) {
    const r = toDebrief(s, ctx)
    return { state: r.state, events: [...events, ...(r.events ?? [])] }
  }
  if (s.phase === 'debrief' && allVoted(s, 'votes')) {
    const r = endDebrief(s, ctx)
    return { state: r.state, events: [...events, ...(r.events ?? [])] }
  }
  if (s.phase === 'finalHunt' && allVoted(s, 'finalVotes')) return { state: endFinal(s, ctx), events: [...events, { type: 'unmask' }] }
  return { state: s, events }
}

// ---------- view ----------

function roleFor(t: TeamState | undefined, viewer: PlayerId): RoleView {
  if (!t) return { kind: 'spectator' }
  if (t.mole === viewer && t.employer) {
    return t.caught ? { kind: 'turned', employerTeamId: t.employer } : { kind: 'mole', employerTeamId: t.employer, hits: t.hits.length }
  }
  return { kind: 'loyal' }
}

function buildView(s: MoleState, viewer: PlayerId, ctx: BaseCtx): MoleView {
  const t = teamOfPlayer(s, viewer)
  const kind = s.kinds[Math.min(s.round, s.kinds.length - 1)] as ChallengeKind
  const ch = CHALLENGES[kind]
  const inChallenge = s.phase === 'briefing' || s.phase === 'challenge'
  let play: MoleView['play'] = null
  if (t?.current && inChallenge) {
    play = ch.view(t.current.d, viewer)
    if (s.phase === 'briefing') play = { ...play, input: null, waitingOn: [] }
  } else if (t && inChallenge) {
    play = {
      kind, name: ch.name, emoji: ch.emoji, rules: ch.rules, stage: 'skip', stageLabel: 'Sitting out',
      facts: [], intel: [], objective: null, input: null, mine: null, board: null, waitingOn: [],
      note: 'Your team is too small right now to play this one. Sit tight.',
    }
  }
  const rivals = s.teams.filter((x) => x.id !== t?.id).map((x) => ({
    teamId: x.id,
    done: !x.current || x.current.d.done,
    success: !inChallenge && x.result ? x.result.success : null,
    points: !inChallenge && x.result ? x.result.points : null,
  }))

  let debrief: MoleView['debrief'] = null
  if (t && s.phase === 'debrief') {
    const entry = t.caseFile[t.caseFile.length - 1] ?? null
    const tappable = !!t.current && TAPPABLE.includes(kind)
    debrief = {
      evidence: entry?.evidence ?? null,
      wiretap: t.wiretap,
      canWiretap: tappable && !t.wiretap && (s.score[t.id] ?? 0) >= WIRETAP_COST,
      wiretapCost: WIRETAP_COST,
      canAccuse: canAccuse(t),
      votes: Object.entries(t.votes).map(([voter, target]) => ({ voter, target })),
      needed: canAccuse(t) ? accusable(t).map((p) => ({ playerId: p, needed: neededFor(s, t, p) })) : [],
      voters: activeMembers(s, t),
    }
  }

  let finalHunt: MoleView['finalHunt'] = null
  if (t && s.phase === 'finalHunt') {
    finalHunt = {
      required: needsFinal(s, t),
      options: accusable(t).filter((p) => p !== viewer),
      allowClean: s.settings.paranoia,
      myVote: t.finalVotes[viewer] ?? null,
      voted: Object.keys(t.finalVotes),
      voters: activeMembers(s, t),
    }
  }

  return {
    phase: s.phase,
    round: Math.min(s.round + 1, s.settings.rounds),
    totalRounds: s.settings.rounds,
    myTeamId: t?.id ?? null,
    isHost: ctx.hostId === viewer,
    role: roleFor(t, viewer),
    paranoia: s.settings.paranoia,
    team: t ? {
      members: t.members.map((id) => ({
        id,
        status: t.caught && id === t.mole ? 'exposed' : t.cleared.includes(id) ? 'cleared' : 'suspect',
        gone: s.gone.includes(id),
      })),
      badges: t.badges,
      moleCaught: t.caught,
    } : null,
    play,
    rivals,
    debrief,
    verdicts: s.verdicts.map((v) => (v.teamId === t?.id ? v : { ...v, votes: [] })),
    finalHunt,
    unmasking: s.phase === 'unmasking' ? s.unmask : null,
    caseFile: t?.caseFile ?? [],
    scoring: { ...SCORING },
  }
}

// ---------- results ----------

function buildResults(s: MoleState, ctx: BaseCtx): { highlights: string[]; awards: { playerId: PlayerId; title: string; emoji: string }[] } {
  const name = (id: PlayerId | null): string => (id ? ctx.players.find((p) => p.id === id)?.name ?? 'Someone' : 'nobody')
  const teamName = (id: TeamId | null): string => (id ? ctx.teams.find((x) => x.id === id)?.name ?? 'a rival team' : 'nobody')
  const highlights: string[] = []
  const awards: { playerId: PlayerId; title: string; emoji: string }[] = []
  for (const t of s.teams) {
    if (!t.mole) {
      highlights.push(`${teamName(t.id)} never had a mole. ${t.calledClean ? 'And they knew it.' : 'The paranoia was all in their heads.'}`)
    } else {
      const hits = t.hits.length
      const fateText = t.fate === 'caught' ? `got caught in round ${t.caughtRound}` : t.fate === 'final' ? 'was nailed in the Final Hunt' : 'ESCAPED'
      highlights.push(`🐀 ${name(t.mole)} was ${teamName(t.id)}'s Mole, secretly working for ${teamName(t.employer)} — pulled off ${hits} sabotage${hits === 1 ? '' : 's'} and ${fateText}.`)
      if (t.fate === 'escaped') awards.push({ playerId: t.mole, title: 'Master Mole', emoji: '🐀' })
      else if (hits >= 2) awards.push({ playerId: t.mole, title: 'Busy Saboteur', emoji: '🧨' })
      const hunt = t.caseFile.find((e) => e.accusation?.correct)?.accusation
      if (hunt) for (const v of hunt.votes) if (v.target === t.mole) awards.push({ playerId: v.voter, title: 'Mole Hunter', emoji: '🔦' })
    }
    for (const c of t.cleared) {
      highlights.push(`${name(c)} was wrongly accused by their own team. Trust issues.`)
      awards.push({ playerId: c, title: 'Framed', emoji: '🖼️' })
    }
  }
  return { highlights, awards }
}

// ---------- definition ----------

export const theMole: GameDefinition<MoleState, MoleSettings> = {
  id: 'the-mole',
  meta: {
    name: 'The Mole',
    emoji: '🐀',
    tagline: 'Crack the challenges. Catch the traitor on your own team.',
    howToPlay: [
      'Your team plays quick co-op challenges — but one of you is secretly a Mole, working for a rival team.',
      'The Mole gets a secret sabotage mission every round. Sabotage that lands pays the rival team (revealed at the end).',
      'After each challenge you get evidence: shuffled numbers, revealed clues, who did what. Argue in team chat — the Mole reads it too.',
      "Vote to accuse: a majority of everyone else on your team convicts. Right = +6. Wrong = −3, and they're cleared.",
      'Still hidden after the last round? Final Hunt. If the Mole survives that, their employer gets +8.',
    ],
    minPlayers: 6,
    maxPlayers: 16,
    teams: { min: 2, max: 4 },
    minTeamSize: 3,
    estimatedMinutes: 15,
    teamChat: true,
    color: 'grape',
  },
  settingsSpec: [
    { key: 'rounds', label: 'Challenges', kind: 'number', min: 4, max: 9, step: 1, default: 6 },
    {
      key: 'pace', label: 'Timers', kind: 'select', default: 'normal',
      options: [{ value: 'chill', label: 'Chill (longer)' }, { value: 'normal', label: 'Normal' }, { value: 'quick', label: 'Quick' }],
    },
    { key: 'paranoia', label: 'Paranoia mode (a team might have NO mole)', kind: 'toggle', default: false },
  ],
  parseSettings(raw) {
    const r = typeof raw.rounds === 'number' && Number.isFinite(raw.rounds) ? Math.round(raw.rounds) : 6
    const pace = raw.pace === 'chill' || raw.pace === 'quick' ? raw.pace : 'normal'
    return { rounds: Math.min(9, Math.max(4, r)), pace, paranoia: raw.paranoia === true }
  },

  create(ctx) {
    const known = new Set(ctx.players.map((p) => p.id))
    const base = ctx.teams
      .map((t) => ({ id: t.id, members: t.playerIds.filter((p) => known.has(p)) }))
      .filter((t) => t.members.length > 0)
    // Who has a mole. Paranoia: each team may be clean (30%), but never all of them.
    let hasMole = base.map((t) => t.members.length >= 2 && !(ctx.settings.paranoia && ctx.random() < 0.3))
    if (!hasMole.some(Boolean)) {
      const eligible = base.map((t, i) => (t.members.length >= 2 ? i : -1)).filter((i) => i >= 0)
      if (eligible.length) { const i = pick(ctx.random, eligible); hasMole = base.map((_, j) => j === i) }
    }
    // Employers: a shuffled cycle, so with 3+ teams every team runs exactly one spy.
    const order = shuffle(ctx.random, base.map((t) => t.id))
    const employerOf = (id: TeamId): TeamId => order[(order.indexOf(id) + 1) % order.length] as TeamId
    const teams: TeamState[] = base.map((t, i) => {
      const mole = hasMole[i] ? pick(ctx.random, t.members) : null
      return {
        id: t.id, members: t.members, mole, employer: mole && base.length > 1 ? employerOf(t.id) : null,
        caught: false, caughtRound: null, badges: BADGES, cleared: [], current: null, result: null,
        votes: {}, wiretap: null, caseFile: [], hits: [], finalVotes: {}, fate: null, calledClean: false,
      }
    })
    const score: Record<TeamId, number> = {}
    const secret: Record<TeamId, number> = {}
    for (const t of ctx.teams) { score[t.id] = 0; secret[t.id] = 0 }
    const state: MoleState = {
      settings: ctx.settings, phase: 'briefing', phaseDeadline: null, round: 0,
      kinds: shuffle(ctx.random, ALL_KINDS).slice(0, ctx.settings.rounds),
      teams, gone: [], score, secret, revealed: false, used: {}, verdicts: [], unmask: null, over: false,
    }
    return startBriefing(state, ctx)
  },

  view: (s, viewer, ctx) => buildView(s, viewer, ctx),

  action(s, pid, action, ctx) {
    const t = teamOfPlayer(s, pid)
    if (!t) return { state: s, error: "You're watching this one — you'll play next game" }
    if (s.over) return { state: s, error: 'Game over' }
    const p = action.payload ?? {}
    if (action.type === 'finish') {
      if (s.phase !== 'unmasking') return { state: s, error: 'Not yet' }
      if (pid !== ctx.hostId) return { state: s, error: 'Only the host can wrap up' }
      return { state: { ...s, over: true, phaseDeadline: null } }
    }
    if (intPayload(p, 'round') !== s.round + 1) return { state: s, error: 'That was for a different round' }
    if (s.gone.includes(pid)) return { state: s, error: 'You left this game' }

    switch (action.type) {
      case 'play': {
        if (s.phase !== 'challenge') return { state: s, error: s.phase === 'briefing' ? 'Hold on — starting in a sec' : 'Too late for that' }
        const cur = t.current
        if (!cur) return { state: s, error: 'Your team is sitting this one out' }
        const d = cur.d
        if (!d.roster.includes(pid) || d.gone.includes(pid)) return { state: s, error: "You're not in this challenge" }
        if (d.done) return { state: s, error: 'Your team is done with this one' }
        if (p.stage !== d.stage) return { state: s, error: 'Too late — the challenge moved on' }
        const res = CHALLENGES[cur.kind].act(d, pid, p.value, { now: ctx.now, random: ctx.random })
        if (typeof res === 'string') return { state: s, error: res }
        return afterChange(mapTeam(s, t.id, (x) => ({ ...x, current: { kind: cur.kind, d: res } })), ctx)
      }
      case 'vote': {
        if (s.phase !== 'debrief') return { state: s, error: 'Voting is closed' }
        const target = p.target
        if (target !== 'pass') {
          if (!canAccuse(t)) return { state: s, error: t.caught ? 'Your mole is already caught' : 'No accusations left' }
          if (typeof target !== 'string' || target === pid || !accusable(t).includes(target)) return { state: s, error: "You can't accuse them" }
        }
        return afterChange(mapTeam(s, t.id, (x) => ({ ...x, votes: { ...x.votes, [pid]: target as string } })), ctx)
      }
      case 'wiretap': {
        if (s.phase !== 'debrief') return { state: s, error: 'Wiretaps only during the debrief' }
        const kind = s.kinds[s.round] as ChallengeKind
        if (!t.current || !TAPPABLE.includes(kind)) return { state: s, error: 'Nothing to wiretap this round' }
        if (t.wiretap) return { state: s, error: 'Your team already used a wiretap this round' }
        if ((s.score[t.id] ?? 0) < WIRETAP_COST) return { state: s, error: `Wiretaps cost ${WIRETAP_COST} points` }
        const target = p.target
        if (typeof target !== 'string' || target === pid || !t.current.d.roster.includes(target)) return { state: s, error: 'Pick a teammate from this challenge' }
        const text = CHALLENGES[kind].wiretap(t.current.d, target)
        if (!text) return { state: s, error: 'Nothing to wiretap this round' }
        const tap: Wiretap = { by: pid, target, text }
        const next = mapTeam(
          { ...s, score: { ...s.score, [t.id]: (s.score[t.id] ?? 0) - WIRETAP_COST } },
          t.id, (x) => ({ ...x, wiretap: tap, caseFile: setLastCase(x, { wiretap: tap }) }),
        )
        return { state: next, events: [{ type: 'wiretap', to: { teamId: t.id }, data: { by: pid, target } }] }
      }
      case 'finalVote': {
        if (s.phase !== 'finalHunt') return { state: s, error: 'The Final Hunt is not on' }
        if (!needsFinal(s, t)) return { state: s, error: 'Your team is done hunting' }
        const target = p.target
        const ok = (target === 'clean' && s.settings.paranoia) || (typeof target === 'string' && target !== pid && accusable(t).includes(target))
        if (!ok) return { state: s, error: "You can't pick them" }
        return afterChange(mapTeam(s, t.id, (x) => ({ ...x, finalVotes: { ...x.finalVotes, [pid]: target as string } })), ctx)
      }
      default:
        return { state: s, error: 'Unknown action' }
    }
  },

  deadline(s) {
    if (s.over) return null
    if (s.phase === 'challenge') {
      const ds = s.teams.filter((t) => t.current && !t.current.d.done).map((t) => (t.current as { d: Base }).d.deadline)
      return ds.length ? Math.min(...ds) : null
    }
    return s.phaseDeadline
  },

  tick(s, ctx) {
    if (s.over) return { state: s }
    const due = s.phaseDeadline === null || ctx.now >= s.phaseDeadline
    switch (s.phase) {
      case 'briefing':
        if (!due) return { state: s }
        return afterChange({ ...s, phase: 'challenge', phaseDeadline: null }, ctx, [{ type: 'go' }])
      case 'challenge': {
        const teams = s.teams.map((t) => {
          if (!t.current || t.current.d.done || t.current.d.deadline > ctx.now) return t
          const d = CHALLENGES[t.current.kind].timeout(t.current.d, { now: ctx.now, random: ctx.random })
          return { ...t, current: { kind: t.current.kind, d } }
        })
        return afterChange({ ...s, teams }, ctx)
      }
      case 'debrief':
        return due ? endDebrief(s, ctx) : { state: s }
      case 'verdict':
        return due ? { state: nextRound(s, ctx) } : { state: s }
      case 'finalHunt':
        return due ? { state: endFinal(s, ctx), events: [{ type: 'unmask' }] } : { state: s }
      case 'unmasking':
        return due ? { state: { ...s, over: true, phaseDeadline: null } } : { state: s }
    }
  },

  onPlayerGone(s, pid, ctx) {
    const t = teamOfPlayer(s, pid)
    if (!t || s.gone.includes(pid)) return { state: s }
    let next: MoleState = { ...s, gone: [...s.gone, pid] }
    const cur = t.current
    if (cur && cur.d.roster.includes(pid) && !cur.d.gone.includes(pid)) {
      const d0 = { ...cur.d, gone: [...cur.d.gone, pid] }
      const d = d0.done ? d0 : active(d0).length === 0 ? { ...d0, done: true } : CHALLENGES[cur.kind].onGone(d0, pid, { now: ctx.now, random: ctx.random })
      next = mapTeam(next, t.id, (x) => ({ ...x, current: { kind: cur.kind, d } }))
    }
    if (s.over) return { state: next }
    return afterChange(next, ctx)
  },

  scores(s) {
    const out: Record<TeamId, number> = {}
    for (const id of Object.keys(s.score)) out[id] = (s.score[id] ?? 0) + (s.revealed ? s.secret[id] ?? 0 : 0)
    return out
  },

  isOver: (s) => s.over,

  results: (s, ctx) => buildResults(s, ctx),
}
