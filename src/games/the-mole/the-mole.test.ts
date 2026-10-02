import { describe, expect, it } from 'vitest'
import type { BaseCtx, GamePlayer, GameTeam } from '../types.ts'
import { theMole, SCORING, BRIEF_MS, type MoleSettings, type MoleState, type TeamState } from './index.ts'
import {
  ALL_KINDS, CHALLENGES, ballpark, blind, bribe, code, heat, heist, intel, safe, stock,
  type Base, type BallD, type BlindD, type BribeD, type CodeD, type HeatD, type HeistD, type IntelD, type SafeD, type StockD,
} from './challenges.ts'
import type { MoleView } from './shared.ts'

// ---------- harness ----------

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

class World {
  now = 1_000_000
  random: () => number
  players: GamePlayer[]
  teams: GameTeam[]
  state: MoleState
  hostId: string

  constructor(sizes: number[], seed = 1, settings: Partial<MoleSettings> = {}) {
    this.random = rng(seed)
    const colors = ['tomato', 'sky', 'lime', 'grape'] as const
    this.players = []
    this.teams = sizes.map((n, ti) => {
      const ids = Array.from({ length: n }, (_, i) => `p${ti}${i}`)
      for (const id of ids) this.players.push({ id, name: `Name-${id}`, avatar: '🙂', teamId: `t${ti}`, connected: true })
      return { id: `t${ti}`, name: `Team ${ti}`, color: colors[ti] ?? 'sun', playerIds: ids }
    })
    this.hostId = 'p00'
    const parsed = theMole.parseSettings(settings)
    this.state = theMole.create({ ...this.ctx(), settings: parsed })
  }

  ctx(): BaseCtx {
    return { now: this.now, random: this.random, players: this.players, teams: this.teams, hostId: this.hostId }
  }

  view(pid: string): MoleView { return theMole.view(this.state, pid, this.ctx()) as MoleView }

  act(pid: string, type: string, payload: Record<string, unknown> = {}): string | undefined {
    const step = theMole.action(this.state, pid, { type, payload: { round: this.state.round + 1, ...payload } }, this.ctx())
    if (!step.error) this.state = step.state
    return step.error
  }

  play(pid: string, value: unknown): string | undefined {
    const v = this.view(pid)
    return this.act(pid, 'play', { stage: v.play?.stage, value })
  }

  /** Jump to the next deadline and tick. */
  advance(): void {
    const d = theMole.deadline(this.state)
    if (d === null) throw new Error(`stuck in ${this.state.phase}`)
    this.now = Math.max(this.now, d)
    this.state = theMole.tick(this.state, this.ctx()).state
  }

  gone(pid: string): void { this.state = theMole.onPlayerGone(this.state, pid, this.ctx()).state }

  team(id: string): TeamState { return this.state.teams.find((t) => t.id === id) as TeamState }
  moleOf(id: string): string { return this.team(id).mole as string }
  ids(teamId: string): string[] { return this.team(teamId).members }
  cur<D extends Base>(teamId: string): D { return this.team(teamId).current?.d as D }
  toChallenge(): void { if (this.state.phase === 'briefing') this.advance() }
}

/** A cooperative bot: plays every open input with something legal. */
function botMove(w: World, pid: string): boolean {
  const v = w.view(pid)
  const input = v.play?.input
  if (!input) return false
  let value: unknown
  switch (input.type) {
    case 'number': value = input.min; break
    case 'choice': value = input.options[0]?.value; break
    case 'multi': value = input.options.slice(0, input.count).map((o) => o.value); break
    case 'text': value = 'zzclue'; break
    case 'digits': value = '0000'; break
  }
  return w.play(pid, value) === undefined
}

/** Every phase visited in a full game, with the loop driven by bots + timers. */
function playThrough(w: World, opts: { onStep?: () => void; vote?: (pid: string) => unknown } = {}): string[] {
  const phases: string[] = []
  for (let guard = 0; guard < 500 && !theMole.isOver(w.state); guard++) {
    opts.onStep?.()
    if (phases[phases.length - 1] !== w.state.phase) phases.push(w.state.phase)
    const everyone = w.players.map((p) => p.id).filter((p) => !w.state.gone.includes(p))
    let moved = false
    if (w.state.phase === 'challenge') for (const p of everyone) moved = botMove(w, p) || moved
    else if (w.state.phase === 'debrief') {
      for (const p of everyone) if (!(p in (w.state.teams.find((t) => t.members.includes(p))?.votes ?? {}))) {
        moved = w.act(p, 'vote', { target: opts.vote?.(p) ?? 'pass' }) === undefined || moved
        if (w.state.phase !== 'debrief') break
      }
    } else if (w.state.phase === 'finalHunt') {
      for (const p of everyone) {
        const fh = w.view(p).finalHunt
        if (fh?.required && !fh.myVote && fh.options[0]) moved = w.act(p, 'finalVote', { target: fh.options[0] }) === undefined || moved
        if (w.state.phase !== 'finalHunt') break
      }
    } else if (w.state.phase === 'unmasking') {
      expect(w.act(w.hostId, 'finish')).toBeUndefined()
      moved = true
    }
    if (!moved) w.advance()
  }
  return phases
}

// ---------- full game ----------

describe('the mole: full playthrough', () => {
  it('plays a whole 6-challenge game for 2 teams of 3 and ends with results', () => {
    const w = new World([3, 3], 7)
    expect(w.state.phase).toBe('briefing')
    expect(w.state.kinds).toHaveLength(6)
    expect(new Set(w.state.kinds).size).toBe(6)
    const phases = playThrough(w)
    expect(theMole.isOver(w.state)).toBe(true)
    expect(phases).toEqual(expect.arrayContaining(['briefing', 'challenge', 'debrief', 'finalHunt', 'unmasking']))
    for (const t of w.state.teams) expect(t.caseFile).toHaveLength(6)
    const scores = theMole.scores(w.state)
    expect(Object.keys(scores).sort()).toEqual(['t0', 't1'])
    const res = theMole.results(w.state, w.ctx())
    expect(res.highlights.length).toBeGreaterThanOrEqual(2)
    expect(res.highlights.join(' ')).toContain('Name-' + w.moleOf('t0'))
    expect(theMole.deadline(w.state)).toBeNull()
  })

  it('works for every seed, every team shape, with timers only (nobody acts)', () => {
    for (const sizes of [[3, 3], [4, 5], [3, 3, 3], [4, 4, 4, 4], [8, 8]]) {
      for (let seed = 1; seed <= 5; seed++) {
        const w = new World(sizes, seed, { rounds: 9 })
        for (let i = 0; i < 400 && !theMole.isOver(w.state); i++) w.advance()
        expect(theMole.isOver(w.state)).toBe(true)
        // Nobody acted: every mole escaped and their employer was paid at the unmasking.
        for (const t of w.state.teams) expect(t.fate).toBe('escaped')
      }
    }
  })

  it('runs all nine challenge types with bots', () => {
    const w = new World([4, 4], 3, { rounds: 9 })
    expect(new Set(w.state.kinds)).toEqual(new Set(ALL_KINDS))
    playThrough(w)
    expect(theMole.isOver(w.state)).toBe(true)
  })
})

// ---------- hidden information ----------

/** Same world, but team t0's mole swapped to another player. */
function twinWorlds(seed: number): [World, World, string, string] {
  const a = new World([4, 4], seed)
  const b = new World([4, 4], seed)
  const m = a.moleOf('t0')
  const other = a.ids('t0').find((p) => p !== m) as string
  b.state = {
    ...b.state,
    teams: b.state.teams.map((t) => t.id !== 't0' ? t : {
      ...t, mole: other,
      current: t.current ? { ...t.current, d: { ...t.current.d, mole: other } } : null,
    }),
  }
  return [a, b, m, other]
}

describe('the mole: hidden information', () => {
  it('a loyal player\'s view is byte-identical no matter who the mole is (every phase until the unmasking)', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const [a, b, m1, m2] = twinWorlds(seed)
      const loyal = a.ids('t0').filter((p) => p !== m1 && p !== m2)
      const rivals = a.ids('t1')
      let steps = 0
      // Drive both worlds with the same moves; moles behave like everyone else.
      for (let guard = 0; guard < 400 && a.state.phase !== 'unmasking' && !theMole.isOver(a.state); guard++) {
        for (const viewer of [...loyal, ...rivals]) {
          if (rivals.includes(viewer) && (viewer === a.moleOf('t1'))) continue
          expect(JSON.stringify(a.view(viewer))).toBe(JSON.stringify(b.view(viewer)))
        }
        expect(theMole.scores(a.state)).toEqual(theMole.scores(b.state))
        steps++
        let moved = false
        if (a.state.phase === 'challenge') {
          for (const p of a.players.map((x) => x.id)) {
            const va = a.view(p).play?.input
            if (!va) continue
            const value = va.type === 'number' ? va.min : va.type === 'choice' ? va.options[0]?.value : va.type === 'multi' ? va.options.slice(0, va.count).map((o) => o.value) : va.type === 'text' ? 'zzclue' : '0000'
            const ea = a.play(p, value); const eb = b.play(p, value)
            expect(ea).toBe(eb)
            moved = moved || ea === undefined
          }
        } else if (a.state.phase === 'debrief') {
          for (const p of a.players.map((x) => x.id)) { a.act(p, 'vote', { target: 'pass' }); b.act(p, 'vote', { target: 'pass' }) }
          moved = true
        }
        if (!moved) { a.advance(); b.advance() }
      }
      expect(steps).toBeGreaterThan(10)
    }
  })

  it('no non-mole view ever carries role, objective, insider intel or employer', () => {
    const w = new World([3, 3, 3], 11, { rounds: 9 })
    const moles = new Set(w.state.teams.map((t) => t.mole))
    playThrough(w, {
      onStep: () => {
        if (w.state.phase === 'unmasking') return
        for (const p of w.players) {
          const v = w.view(p.id)
          const json = JSON.stringify(v)
          if (moles.has(p.id)) {
            expect(v.role.kind).toBe('mole')
            continue
          }
          expect(v.role).toEqual({ kind: 'loyal' })
          expect(json).not.toContain('employerTeamId')
          expect(json).not.toContain('Insider')
          expect(json).not.toContain('"tone":"mole"')
          expect(v.play?.objective ?? null).toBeNull()
          expect(v.unmasking).toBeNull()
        }
      },
    })
  })

  it('the mole sees their employer, their objective, and insider intel', () => {
    const w = new World([3, 3], 5)
    const m = w.moleOf('t0')
    const v = w.view(m)
    expect(v.role).toEqual({ kind: 'mole', employerTeamId: 't1', hits: 0 })
    expect(v.play?.objective).toBeTruthy()
  })

  it('3+ teams: every mole works for a different rival team (a derangement)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const w = new World([3, 3, 3, 3], seed)
      const employers = w.state.teams.map((t) => t.employer)
      w.state.teams.forEach((t) => expect(t.employer).not.toBe(t.id))
      expect(new Set(employers).size).toBe(4)
    }
  })

  it('sabotage payouts stay out of the scoreboard until the unmasking', () => {
    const w = new World([3, 3], 2)
    w.toChallenge()
    w.state = { ...w.state, secret: { t0: 0, t1: 4 } }
    expect(theMole.scores(w.state)).toEqual({ t0: 0, t1: 0 })
    w.state = { ...w.state, revealed: true }
    expect(theMole.scores(w.state)).toEqual({ t0: 0, t1: 4 })
  })

  it('anonymous evidence is shuffled, not in roster order', () => {
    let differs = 0
    for (let seed = 1; seed <= 20; seed++) {
      const r = rng(seed)
      const d = safe.setup({ roster: ['a', 'b', 'c', 'd', 'e'], mole: 'a', start: 0, random: r, avoid: [], pace: 1 })
      const filled = { ...d, picks: { a: 1, b: 2, c: 3, d: 4, e: 5 }, done: true }
      const items = safe.resolve(filled, r).evidence.anon[0]?.items
      if (items?.join() !== '🔢 1,🔢 2,🔢 3,🔢 4,🔢 5') differs++
    }
    expect(differs).toBeGreaterThan(15)
  })

  it('a late joiner (unknown id) gets a spectator view with no team secrets, and cannot act', () => {
    const w = new World([3, 3], 4)
    w.toChallenge()
    const v = w.view('stranger')
    expect(v.role.kind).toBe('spectator')
    expect(v.team).toBeNull()
    expect(v.play).toBeNull()
    expect(v.caseFile).toEqual([])
    expect(w.act('stranger', 'play', { stage: 'x', value: 1 })).toMatch(/watching/)
  })
})

// ---------- accusations ----------

function toDebrief(w: World): void {
  w.toChallenge()
  for (let i = 0; i < 10 && w.state.phase === 'challenge'; i++) w.advance()
  expect(w.state.phase).toBe('debrief')
}

describe('the mole: accusations', () => {
  it('catching the mole: +6, exposed for everyone, turns them, no more objectives', () => {
    const w = new World([3, 3], 9)
    toDebrief(w)
    const m = w.moleOf('t0')
    const loyal = w.ids('t0').filter((p) => p !== m)
    const before = w.state.score.t0 ?? 0
    for (const p of loyal) expect(w.act(p, 'vote', { target: m })).toBeUndefined()
    w.advance() // debrief timer
    expect(w.state.phase).toBe('verdict')
    expect(w.state.score.t0).toBe(before + SCORING.catch)
    // Even the rival team sees who was caught.
    const rv = w.view('p10')
    expect(rv.verdicts[0]).toMatchObject({ teamId: 't0', accused: m, correct: true })
    expect(rv.verdicts[0]?.votes).toEqual([])
    expect(w.view(loyal[0] as string).team?.members.find((x) => x.id === m)?.status).toBe('exposed')
    expect(w.view(m).role.kind).toBe('turned')
    w.advance() // verdict → next briefing
    expect(w.state.phase).toBe('briefing')
    expect(w.cur('t0').mole).toBeNull()
    expect(w.view(m).play?.objective).toBeNull()
    // No more accusations once caught.
    toDebrief(w)
    expect(w.act(loyal[0] as string, 'vote', { target: loyal[1] })).toMatch(/already caught/)
  })

  it('a wrong accusation costs 3 points, clears the innocent, and burns a badge', () => {
    const w = new World([4, 3], 9)
    toDebrief(w)
    const m = w.moleOf('t0')
    const [inno, ...rest] = w.ids('t0').filter((p) => p !== m) as [string, ...string[]]
    const before = w.state.score.t0 ?? 0
    // Mole + one loyal frame the innocent: 2 of 3 others is a majority.
    expect(w.act(m, 'vote', { target: inno })).toBeUndefined()
    expect(w.act(rest[0] as string, 'vote', { target: inno })).toBeUndefined()
    w.advance()
    expect(w.state.score.t0).toBe(before + SCORING.wrong)
    expect(w.team('t0').cleared).toEqual([inno])
    expect(w.team('t0').badges).toBe(1)
    expect(w.view(m).team?.members.find((x) => x.id === inno)?.status).toBe('cleared')
    // The team sees who voted for whom.
    expect(w.view(inno).verdicts[0]?.votes).toEqual(expect.arrayContaining([{ voter: m, target: inno }]))
    // A cleared player can't be accused again.
    w.advance()
    toDebrief(w)
    expect(w.act(m, 'vote', { target: inno })).toMatch(/can't accuse/)
  })

  it('needs a strict majority of everyone else; a lone vote does nothing', () => {
    const w = new World([4, 3], 12)
    toDebrief(w)
    const m = w.moleOf('t0')
    const loyal = w.ids('t0').filter((p) => p !== m)
    w.act(loyal[0] as string, 'vote', { target: m })
    w.advance()
    expect(w.team('t0').caught).toBe(false)
    expect(w.team('t0').badges).toBe(2)
  })

  it('the debrief ends early once everyone has voted', () => {
    const w = new World([3, 3], 13)
    toDebrief(w)
    for (const p of w.players) w.act(p.id, 'vote', { target: 'pass' })
    expect(['briefing', 'finalHunt']).toContain(w.state.phase)
  })

  it('players cannot accuse themselves; badges run out after two', () => {
    const w = new World([5, 3], 14)
    toDebrief(w)
    const m = w.moleOf('t0')
    expect(w.act(m, 'vote', { target: m })).toMatch(/can't accuse/)
    const loyal = w.ids('t0').filter((p) => p !== m)
    for (let r = 0; r < 2; r++) {
      const victim = loyal[r] as string
      for (const p of w.ids('t0').filter((x) => x !== victim)) w.act(p, 'vote', { target: victim })
      if (w.state.phase === 'debrief') w.advance()
      expect(w.team('t0').cleared).toContain(victim)
      w.advance()
      toDebrief(w)
    }
    expect(w.team('t0').badges).toBe(0)
    expect(w.act(loyal[2] as string, 'vote', { target: m })).toMatch(/No accusations left/)
    expect(w.act(loyal[2] as string, 'vote', { target: 'pass' })).toBeUndefined()
  })
})

// ---------- final hunt + unmasking ----------

function toFinal(w: World): void {
  for (let i = 0; i < 300 && w.state.phase !== 'finalHunt' && w.state.phase !== 'unmasking'; i++) w.advance()
}

describe('the mole: final hunt', () => {
  it('nailing the mole in the final hunt pays +4; the other mole escapes and pays their employer +8', () => {
    const w = new World([3, 3], 21, { rounds: 4 })
    toFinal(w)
    expect(w.state.phase).toBe('finalHunt')
    const m0 = w.moleOf('t0')
    for (const p of w.ids('t0').filter((x) => x !== m0)) expect(w.act(p, 'finalVote', { target: m0 })).toBeUndefined()
    const m1 = w.moleOf('t1')
    const wrong = w.ids('t1').find((x) => x !== m1) as string
    for (const p of w.ids('t1').filter((x) => x !== wrong)) w.act(p, 'finalVote', { target: wrong })
    w.act(wrong, 'finalVote', { target: w.ids('t1').find((x) => x !== wrong && x !== m1) })
    w.act(m0, 'finalVote', { target: w.ids('t0').find((x) => x !== m0) })
    expect(w.state.phase).toBe('unmasking')
    expect(w.team('t0').fate).toBe('final')
    expect(w.team('t1').fate).toBe('escaped')
    const v = w.view('p00')
    expect(v.unmasking?.find((u) => u.teamId === 't1')?.moleId).toBe(m1)
    // t1's mole works for t0: t0 gets the escape bonus, revealed now.
    expect(theMole.scores(w.state).t0).toBe((w.state.score.t0 ?? 0) + (w.state.secret.t0 ?? 0))
    expect(w.state.secret.t0).toBeGreaterThanOrEqual(SCORING.escape)
    expect(w.act('p01', 'finish')).toMatch(/host/)
    expect(w.act('p00', 'finish')).toBeUndefined()
    expect(theMole.isOver(w.state)).toBe(true)
  })

  it('a tied final vote lets the mole escape', () => {
    const w = new World([4, 3], 22, { rounds: 4 })
    toFinal(w)
    const m = w.moleOf('t0')
    const loyal = w.ids('t0').filter((p) => p !== m) as [string, string, string]
    w.act(loyal[0], 'finalVote', { target: m })
    w.act(loyal[1], 'finalVote', { target: m })
    w.act(loyal[2], 'finalVote', { target: loyal[0] })
    w.act(m, 'finalVote', { target: loyal[0] })
    w.advance()
    expect(w.team('t0').fate).toBe('escaped')
  })

  it('paranoia mode: a clean team that calls "clean" earns a bonus', () => {
    let found = false
    for (let seed = 1; seed < 60 && !found; seed++) {
      const w = new World([3, 3], seed, { paranoia: true, rounds: 4 })
      const clean = w.state.teams.find((t) => t.mole === null)
      if (!clean) continue
      found = true
      expect(w.state.teams.some((t) => t.mole !== null)).toBe(true)
      toFinal(w)
      for (const p of clean.members) expect(w.act(p, 'finalVote', { target: 'clean' })).toBeUndefined()
      const before = w.state.score[clean.id] ?? 0
      for (let i = 0; i < 3 && w.state.phase === 'finalHunt'; i++) w.advance()
      expect(w.team(clean.id).fate).toBe('clean')
      expect(w.state.score[clean.id]).toBe(before + 4)
    }
    expect(found).toBe(true)
  })

  it('"clean" is not a legal vote without paranoia mode', () => {
    const w = new World([3, 3], 23, { rounds: 4 })
    toFinal(w)
    expect(w.act('p00', 'finalVote', { target: 'clean' })).toMatch(/can't pick/)
  })
})

// ---------- disconnects + stale actions ----------

describe('the mole: edge cases', () => {
  it('rejects stale rounds, wrong stages, double submissions and actions during briefing', () => {
    const w = new World([3, 3], 31)
    const p = 'p00'
    expect(w.act(p, 'play', { stage: w.view(p).play?.stage, value: 1 })).toMatch(/starting/)
    w.toChallenge()
    const step = theMole.action(w.state, p, { type: 'play', payload: { round: 99, stage: w.view(p).play?.stage, value: 1 } }, w.ctx())
    expect(step.error).toMatch(/different round/)
    expect(w.act(p, 'play', { stage: 'nonsense', value: 1 })).toMatch(/moved on/)
    expect(w.act(p, 'bogus')).toMatch(/Unknown/)
  })

  it('a disconnected player never blocks the challenge, debrief or final hunt', () => {
    const w = new World([3, 3], 32)
    w.toChallenge()
    w.gone('p02')
    for (const p of ['p00', 'p01', 'p10', 'p11', 'p12']) botMove(w, p)
    // Multi-stage challenges may need a second round of moves.
    for (let i = 0; i < 4 && w.state.phase === 'challenge'; i++) for (const p of ['p00', 'p01', 'p10', 'p11', 'p12']) botMove(w, p)
    if (w.state.phase === 'challenge') w.advance()
    expect(w.state.phase).toBe('debrief')
    for (const p of ['p00', 'p01', 'p10', 'p11', 'p12']) w.act(p, 'vote', { target: 'pass' })
    expect(w.state.phase).toBe('briefing')
    expect(w.act('p02', 'vote', { target: 'pass' })).toBeTruthy()
  })

  it('a team that shrinks below 2 sits challenges out instead of hanging', () => {
    const w = new World([3, 3], 33)
    w.gone('p01'); w.gone('p02')
    toDebrief(w)
    w.advance()
    w.toChallenge()
    expect(w.team('t0').current).toBeNull()
    expect(w.view('p00').play?.stage).toBe('skip')
  })

  it('the mole leaving keeps their secret; they can still be named in the final hunt', () => {
    const w = new World([4, 3], 34, { rounds: 4 })
    const m = w.moleOf('t0')
    w.gone(m)
    const loyal = w.ids('t0').filter((p) => p !== m)
    expect(JSON.stringify(w.view(loyal[0] as string))).not.toContain('Insider')
    toFinal(w)
    for (const p of loyal) w.act(p, 'finalVote', { target: m })
    for (let i = 0; i < 3 && w.state.phase === 'finalHunt'; i++) w.advance()
    expect(w.team('t0').fate).toBe('final')
  })

  it('wiretap: costs 2, reveals one teammate to the team, once per round', () => {
    const w = new World([3, 3], 35, { rounds: 9 })
    // Find a tappable round, give the team some points.
    for (let i = 0; i < 9; i++) {
      toDebrief(w)
      const ok = ['safe', 'heist', 'intel', 'bribe', 'ballpark', 'stock'].includes(w.state.kinds[w.state.round] as string)
      if (ok) break
      for (const p of w.players) w.act(p.id, 'vote', { target: 'pass' })
    }
    w.state = { ...w.state, score: { ...w.state.score, t0: 5 } }
    expect(w.view('p00').debrief?.canWiretap).toBe(true)
    expect(w.act('p00', 'wiretap', { target: 'p00' })).toBeTruthy()
    expect(w.act('p00', 'wiretap', { target: 'p01' })).toBeUndefined()
    expect(w.state.score.t0).toBe(3)
    expect(w.view('p02').debrief?.wiretap).toMatchObject({ by: 'p00', target: 'p01' })
    expect(w.view('p10').debrief?.wiretap).toBeNull()
    expect(w.act('p02', 'wiretap', { target: 'p01' })).toMatch(/already/)
  })

  it('a wiretap is refused when the team cannot afford it', () => {
    const w = new World([3, 3], 36, { rounds: 9 })
    for (let i = 0; i < 9; i++) {
      toDebrief(w)
      if (['safe', 'heist', 'intel', 'bribe', 'ballpark', 'stock'].includes(w.state.kinds[w.state.round] as string)) break
      for (const p of w.players) w.act(p.id, 'vote', { target: 'pass' })
    }
    w.state = { ...w.state, score: { ...w.state.score, t0: 1 } }
    expect(w.act('p00', 'wiretap', { target: 'p01' })).toMatch(/cost/)
  })

  it('parseSettings clamps garbage', () => {
    expect(theMole.parseSettings({ rounds: 99, pace: 'warp', paranoia: 'yes' })).toEqual({ rounds: 9, pace: 'normal', paranoia: false })
    expect(theMole.parseSettings({})).toEqual({ rounds: 6, pace: 'normal', paranoia: false })
  })

  it('briefing lasts BRIEF_MS before inputs open', () => {
    const w = new World([3, 3], 37)
    expect(theMole.deadline(w.state)).toBe(w.now + BRIEF_MS)
  })
})

// ---------- per-challenge rules ----------

const R = (): (() => number) => rng(99)
const setupArgs = (roster: string[], mole: string | null = 'a') => ({ roster, mole, start: 0, random: R(), avoid: [], pace: 1 })
const A = { now: 0, random: R() }

describe('challenges', () => {
  it('safe: exact hit wins; a miss by 1–2 is a sabotage', () => {
    const d = safe.setup(setupArgs(['a', 'b', 'c']))
    let x = d as SafeD
    const target = x.target
    x = safe.act(x, 'a', 0, A) as SafeD
    x = safe.act(x, 'b', Math.min(9, target), A) as SafeD
    expect(safe.act(x, 'b', 1, A)).toMatch(/already/)
    expect(safe.act(x, 'c', 10, A)).toMatch(/0 to 9/)
    x = safe.act(x, 'c', Math.max(0, target - Math.min(9, target)), A) as SafeD
    expect(x.done).toBe(true)
    const r = safe.resolve(x, R())
    expect(r.success).toBe(target <= 18)
    const miss = safe.resolve({ ...x, target: target + 2 }, R())
    expect(miss.sabotage).toBe(true)
    expect(safe.resolve({ ...x, target: target + 5 }, R()).sabotage).toBe(false)
    expect(safe.view(x, 'b').objective).toBeNull()
  })

  it('heist: leader picks the crew, one jam fails it, timeout picks a random crew', () => {
    const d = heist.setup(setupArgs(['a', 'b', 'c', 'd', 'e'])) as HeistD
    expect(d.crewSize).toBe(3)
    const notLeader = d.roster.find((p) => p !== d.leader) as string
    expect(heist.act(d, notLeader, ['a', 'b', 'c'], A)).toMatch(/Only the Leader/)
    expect(heist.act(d, d.leader, ['a', 'b'], A)).toMatch(/exactly 3/)
    let x = heist.act(d, d.leader, ['a', 'b', 'c'], A) as HeistD
    expect(x.stage).toBe('run')
    expect(heist.act(x, 'd', 'clean', A)).toMatch(/not on the crew/)
    x = heist.act(x, 'a', 'jam', A) as HeistD
    x = heist.act(x, 'b', 'clean', A) as HeistD
    x = heist.act(x, 'c', 'clean', A) as HeistD
    expect(x.done).toBe(true)
    const r = heist.resolve(x, R())
    expect(r.success).toBe(false)
    expect(r.sabotage).toBe(true)
    expect(heist.wiretap(x, 'a')).toMatch(/JAM/)
    expect(heist.wiretap(x, 'e')).toMatch(/not on the crew/)
    const t = heist.timeout(d, { now: 5, random: R() })
    expect(t.crew).toHaveLength(3)
    expect(t.stage).toBe('run')
  })

  it('heist: leader leaving mid-pick hands leadership to someone else', () => {
    const d = heist.setup(setupArgs(['a', 'b', 'c'])) as HeistD
    const g = { ...d, gone: [d.leader] }
    const x = heist.onGone(g, d.leader, { now: 0, random: R() })
    expect(x.leader).not.toBe(d.leader)
  })

  it('heat: correct ranks win; the mole sees everyone\'s numbers, loyals only their own', () => {
    const d = heat.setup(setupArgs(['a', 'b', 'c'])) as HeatD
    const order = ['a', 'b', 'c'].sort((p, q) => (d.nums[p] as number) - (d.nums[q] as number))
    let x = d
    order.forEach((p, i) => { x = heat.act(x, p, i + 1, A) as HeatD })
    expect(heat.resolve(x, R()).success).toBe(true)
    expect(heat.view(d, 'a').intel.length).toBe(3)
    expect(heat.view(d, 'b').intel.length).toBe(1)
    expect(heat.act(d, 'a', 4, A)).toMatch(/1 to 3/)
  })

  it('intel: honest posts find the target; votes split = fail; half the clues revealed', () => {
    const d = intel.setup(setupArgs(['a', 'b', 'c', 'd'], null)) as IntelD
    expect(d.options.length).toBe(5)
    expect(Object.values(d.clues)).not.toContain(d.answer)
    let x = d
    for (const p of d.roster) x = intel.act(x, p, d.clues[p], A) as IntelD
    expect(x.stage).toBe('vote')
    const left = d.options.filter((o) => !Object.values(d.clues).includes(o))
    expect(left).toEqual([d.answer])
    // Board doesn't reveal authors.
    expect(intel.view(x, 'a').board?.items.every((i) => i.by === undefined)).toBe(true)
    for (const p of d.roster) x = intel.act(x, p, d.answer, A) as IntelD
    const r = intel.resolve(x, R())
    expect(r.success).toBe(true)
    expect(r.evidence.named?.rows).toHaveLength(2)
    expect(intel.view(d, 'a').intel.some((f) => f.label === 'Insider')).toBe(false)
  })

  it('bribe: exact = 5, overpay costs points, 3+ overpay is a sabotage, hints contain the price', () => {
    const d = bribe.setup(setupArgs(['a', 'b', 'c'])) as BribeD
    for (const h of Object.values(d.hints)) { expect(h[0]).toBeLessThanOrEqual(d.price); expect(h[1]).toBeGreaterThanOrEqual(d.price) }
    const pay = (total: number) => bribe.resolve({ ...d, pays: { a: total, b: 0, c: 0 } }, R())
    expect(pay(d.price).points).toBe(5)
    expect(pay(d.price + 1).points).toBe(4)
    expect(pay(d.price + 3).sabotage).toBe(true)
    expect(pay(d.price - 1).points).toBe(0)
  })

  it('ballpark: median within the margin wins; hints are always true', () => {
    for (let s = 0; s < 30; s++) {
      const d = ballpark.setup({ ...setupArgs(['a', 'b', 'c', 'd', 'e']), random: rng(s) }) as BallD
      const v = ballpark.view(d, 'b')
      expect(v.intel[0]?.value).toMatch(/more than|less than/)
    }
    const d = ballpark.setup(setupArgs(['a', 'b', 'c'])) as BallD
    const ans = Number((ballpark.resolve({ ...d, guesses: { a: 0, b: 0, c: 0 } }, R()).evidence.facts[0]?.value ?? '').split(' ')[0]?.replace(/,/g, ''))
    expect(ballpark.resolve({ ...d, guesses: { a: ans, b: ans, c: 9_999_999 } }, R()).success).toBe(true)
  })

  it('code: only the keymaster types; keymaster leaving reassigns', () => {
    const d = code.setup(setupArgs(['a', 'b', 'c'])) as CodeD
    const other = d.roster.find((p) => p !== d.keymaster) as string
    expect(code.act(d, other, '1234', A)).toMatch(/Only the Keymaster/)
    const x = code.act(d, d.keymaster, d.code, A) as CodeD
    expect(code.resolve(x, R()).success).toBe(true)
    // Every digit is seen by someone.
    const covered = new Set(Object.values(d.seen).flat())
    expect(covered.size).toBe(4)
    expect(code.view(d, d.keymaster).intel.filter((f) => f.label === 'Your digits')).toHaveLength(0)
    const g = code.onGone({ ...d, gone: [d.keymaster] }, d.keymaster, { now: 0, random: R() })
    expect(g.keymaster).not.toBe(d.keymaster)
  })

  it('stock: majority call with median stake; a loss is a sabotage; a tie is no trade', () => {
    const d = stock.setup(setupArgs(['a', 'b', 'c'])) as StockD
    const wrong = d.truth === 'up' ? 'down' : 'up'
    const lose = stock.resolve({ ...d, calls: { a: { dir: wrong, stake: 3 }, b: { dir: wrong, stake: 2 }, c: { dir: d.truth, stake: 1 } } }, R())
    expect(lose.points).toBe(-2)
    expect(lose.sabotage).toBe(true)
    const win = stock.resolve({ ...d, calls: { a: { dir: d.truth, stake: 3 }, b: { dir: d.truth, stake: 3 } } }, R())
    expect(win.points).toBe(6)
    const tie = stock.resolve({ ...d, calls: { a: { dir: d.truth, stake: 3 }, b: { dir: wrong, stake: 3 } } }, R())
    expect(tie.points).toBe(0)
    expect(stock.act(d, 'a', 'sideways:9', A)).toMatch(/direction/)
  })

  it('blind: the Blind never sees the word (unless they are the mole); clues can\'t contain it', () => {
    let d = blind.setup(setupArgs(['a', 'b', 'c'], null)) as BlindD
    const json = JSON.stringify(blind.view(d, d.blind))
    expect(json).not.toContain(`"value":"${d.secret}"`)
    const giver = d.roster.find((p) => p !== d.blind) as string
    expect(blind.act(d, giver, d.secret.toUpperCase(), A)).toMatch(/word itself/)
    expect(blind.act(d, d.blind, 'hello', A)).toMatch(/Blind/)
    for (const p of d.roster.filter((x) => x !== d.blind)) d = blind.act(d, p, 'zz', A) as BlindD
    expect(d.stage).toBe('guess')
    const x = blind.act(d, d.blind, d.secret, A) as BlindD
    expect(blind.resolve(x, R()).success).toBe(true)
    const md = { ...d, mole: d.blind }
    expect(blind.view(md, d.blind).intel[0]?.value).toBe(d.secret)
  })

  it('every challenge view hides the objective from non-moles and shows it to the mole', () => {
    for (const k of ALL_KINDS) {
      const ch = CHALLENGES[k]
      const d = ch.setup(setupArgs(['a', 'b', 'c', 'd']))
      expect(ch.view(d, 'a').objective).toBeTruthy()
      for (const p of ['b', 'c', 'd']) {
        const v = ch.view(d, p)
        expect(v.objective).toBeNull()
        expect(v.intel.some((f) => f.tone === 'mole')).toBe(false)
      }
    }
  })
})
