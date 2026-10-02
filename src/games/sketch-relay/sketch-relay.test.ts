import { describe, expect, it } from 'vitest'
import { sketchRelay as G, T, type SketchState } from './index.ts'
import { PROMPTS } from './prompts.ts'
import { judge } from './match.ts'
import type { BaseCtx, GameEvent, GamePlayer, GameTeam, Step } from '../types.ts'
import type { SketchSettings, SketchView } from './shared.ts'

// ------------------------------------------------------------ harness

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

class Table {
  now = 1_000_000
  players: GamePlayer[]
  teams: GameTeam[]
  hostId: string
  state: SketchState
  events: GameEvent[] = []
  random = rng(7)

  constructor(sizes: number[], settings: Partial<SketchSettings> = {}) {
    const colors = ['tomato', 'sky', 'lime', 'grape'] as const
    this.players = []
    this.teams = sizes.map((n, ti) => {
      const ids = Array.from({ length: n }, (_, k) => `t${ti}p${k}`)
      for (const id of ids) this.players.push({ id, name: id.toUpperCase(), avatar: '🙂', teamId: `T${ti}`, connected: true })
      return { id: `T${ti}`, name: `Team ${ti}`, color: colors[ti % 4] as GameTeam['color'], playerIds: ids }
    })
    this.hostId = this.players[0]!.id
    this.state = G.create({ ...this.ctx(), settings: G.parseSettings({ chaos: false, roundsPerTeam: 1, ...settings }) })
  }

  ctx(): BaseCtx {
    return { now: this.now, random: this.random, players: this.players, teams: this.teams, hostId: this.hostId }
  }

  view(pid: string): SketchView {
    return G.view(this.state, pid, this.ctx()) as SketchView
  }

  act(pid: string, type: string, payload: Record<string, unknown> = {}): Step<SketchState> {
    const step = G.action(this.state, pid, { type, payload }, this.ctx())
    if (!step.error) this.state = step.state
    this.events.push(...(step.events ?? []))
    return step
  }

  /** Advance the clock and run due ticks like the platform does. */
  advance(ms: number): void {
    const end = this.now + ms
    while (this.now < end) {
      this.now = Math.min(end, this.now + 250)
      for (let i = 0; i < 50; i++) {
        const d = G.deadline(this.state)
        if (d === null || d > this.now) break
        if (i === 49) throw new Error('tick loop')
        const step = G.tick(this.state, this.ctx())
        this.state = step.state
        this.events.push(...(step.events ?? []))
      }
    }
  }

  get r() { return this.state.round }
  drawer(): string { return this.state.round.turn!.drawerId }
  promptText(): string { return PROMPTS[this.state.round.choice!]!.text }
  pick(index = 0): void {
    const drawer = this.r.drawerOrder[0]!
    const res = this.act(drawer, 'pick', { round: this.r.index, index })
    expect(res.error).toBeUndefined()
  }
  stroke(pts: number[] = [100, 100, 200, 200, 300, 150]): Step<SketchState> {
    const turn = this.r.turn!
    this.act(turn.drawerId, 'ink', { round: this.r.index, turn: turn.id, seq: 0, pts: pts.slice(0, 4) })
    return this.act(turn.drawerId, 'ink', { round: this.r.index, turn: turn.id, seq: 1, pts: pts.slice(4), end: true })
  }
  guess(pid: string, text: string): Step<SketchState> {
    this.now += 1000
    return this.act(pid, 'guess', { round: this.r.index, text })
  }
}

// ------------------------------------------------------------ tests

describe('settings', () => {
  it('fills defaults and clamps junk', () => {
    expect(G.parseSettings({})).toEqual({ roundsPerTeam: 2, strokesPerRound: 12, secondsPerStroke: 6, chaos: true })
    expect(G.parseSettings({ roundsPerTeam: 99, strokesPerRound: 'x', secondsPerStroke: -4, chaos: 'yes' }))
      .toEqual({ roundsPerTeam: 5, strokesPerRound: 12, secondsPerStroke: 3, chaos: true })
  })
})

describe('full playthrough, 2 teams of 3', () => {
  it('plays draw → seer guess → steal → gallery → results', () => {
    const t = new Table([3, 3])
    expect(t.state.phase).toBe('pick')
    expect(t.state.totalRounds).toBe(2)
    expect(t.r.teamId).toBe('T0')
    const seer0 = t.r.seerId!
    expect(seer0).toMatch(/^t0/)
    expect(t.r.drawerOrder).toHaveLength(2)
    expect(t.r.drawerOrder).not.toContain(seer0)
    expect(t.view(seer0).role).toBe('seer')
    expect(t.view('t1p0').role).toBe('rival')

    // Rivals and the Seer cannot pick; drawers can.
    expect(t.act(seer0, 'pick', { round: 0, index: 0 }).error).toBeTruthy()
    expect(t.act('t1p0', 'pick', { round: 0, index: 0 }).error).toBeTruthy()
    t.pick(2)
    expect(t.state.phase).toBe('draw')
    expect(PROMPTS[t.r.choice!]!.difficulty).toBe('hard')

    // Turn rotates through drawers, one stroke each, advancing on finger-up.
    const [d1, d2] = t.r.drawerOrder as [string, string]
    expect(t.drawer()).toBe(d1)
    t.stroke()
    expect(t.r.strokes).toHaveLength(1)
    expect(t.drawer()).toBe(d2)
    t.stroke([500, 500, 600, 600])
    expect(t.drawer()).toBe(d1)
    expect(t.view('t1p2').strokes).toHaveLength(2)
    expect(t.view('t1p2').strokes[0]!.c).not.toBe(t.view('t1p2').strokes[1]!.c) // teammates get different inks

    // Drawers cannot guess; a wrong seer guess is public.
    expect(t.guess(d1, t.promptText()).error).toMatch(/genius/)
    expect(t.guess(seer0, 'definitely not this zzz').error).toBeUndefined()
    expect(t.view('t1p0').guesses.map((g) => g.text)).toContain('definitely not this zzz')

    const before = G.scores(t.state).T0 ?? 0
    const ptsNow = t.view(seer0).pointsNow
    expect(ptsNow).toBe(8 + Math.round((8 * 10) / 12))
    expect(t.guess(seer0, t.promptText()).error).toBeUndefined()
    expect(t.state.phase).toBe('reveal')
    expect(G.scores(t.state).T0).toBe(before + ptsNow)
    expect(t.view('t1p0').result).toMatchObject({ winnerTeamId: 'T0', steal: false, points: ptsNow })

    // Round 2: team 1 draws, a rival from team 0 steals it.
    t.advance(T.revealMs)
    expect(t.state.phase).toBe('pick')
    expect(t.r.teamId).toBe('T1')
    t.pick(0)
    t.stroke()
    const rival = 't0p0'
    const steal = t.guess(rival, `is it a ${t.promptText()}?`)
    expect(steal.error).toBeUndefined()
    expect(t.view(rival).result).toMatchObject({ winnerTeamId: 'T0', steal: true })
    expect(G.scores(t.state).T1).toBe(0)
    expect(t.events.some((e) => e.type === 'correct' && e.data?.steal === true)).toBe(true)

    t.advance(T.revealMs)
    expect(t.state.phase).toBe('gallery')
    const gal = t.view('t1p1').gallery!
    expect(gal).toHaveLength(2)
    expect(gal[0]!.strokes).toHaveLength(2)
    expect(G.isOver(t.state)).toBe(false)
    expect(t.act('t1p1', 'finish').error).toBeTruthy() // not host
    expect(t.act(t.hostId, 'finish').error).toBeUndefined()
    expect(G.isOver(t.state)).toBe(true)
    expect(G.deadline(t.state)).toBeNull()

    const res = G.results(t.state, t.ctx())
    expect(res.highlights.length).toBeGreaterThan(0)
    expect(res.awards?.some((a) => a.title === 'Mind Reader')).toBe(true)
  })

  it('gallery times out on its own', () => {
    const t = new Table([1, 1])
    for (let i = 0; i < 2; i++) {
      t.advance(T.pickMs)
      t.advance(T.lastCallMs + 6000 * 12) // everyone freezes
      t.advance(T.revealMs)
    }
    expect(t.state.phase).toBe('gallery')
    t.advance(T.galleryMs)
    expect(G.isOver(t.state)).toBe(true)
  })
})

describe('hidden information', () => {
  it('options and prompt never reach the Seer or rivals until the reveal', () => {
    const t = new Table([3, 2])
    const seer = t.r.seerId!
    const drawer = t.r.drawerOrder[0]!
    const optionTexts = t.r.options.map((i) => PROMPTS[i]!.text)
    for (const pid of [seer, 't1p0', 't1p1', 'late-joiner']) {
      const json = JSON.stringify(t.view(pid))
      for (const o of optionTexts) expect(json).not.toContain(o)
    }
    const dv = t.view(drawer)
    expect(dv.options!.map((o) => o.text)).toEqual(optionTexts)

    t.pick(1)
    const p = PROMPTS[t.r.choice!]!
    t.stroke()
    t.guess(seer, 'nope nope')
    for (const pid of [seer, 't1p0', 't1p1', 'late-joiner']) {
      const v = t.view(pid)
      expect(v.prompt).toBeNull()
      expect(v.options).toBeNull()
      const json = JSON.stringify(v)
      expect(json).not.toContain(p.text)
      for (const a of p.accept) expect(json.toLowerCase()).not.toContain(`"${a}"`)
    }
    expect(t.view(drawer).prompt).toBe(p.text)
    expect(t.view('late-joiner').role).toBe('spectator')

    t.guess('t1p0', p.text)
    for (const pid of [seer, 't1p0']) expect(t.view(pid).result!.prompt).toBe(p.text)
  })

  it('a close call only pings the guesser', () => {
    const t = new Table([2, 2])
    t.pick(0)
    t.stroke()
    // Find a prompt where one of its words alone is "close" but not correct.
    let found: { idx: number; word: string } | null = null
    for (let i = 0; i < PROMPTS.length && !found; i++) {
      const p = PROMPTS[i]!
      for (const w of p.text.split(/\s+/)) {
        if (w.length >= 5 && judge(w, [p.text, ...p.accept]) === 'close') { found = { idx: i, word: w }; break }
      }
    }
    expect(found).not.toBeNull()
    t.state = { ...t.state, round: { ...t.state.round, choice: found!.idx } }
    t.events = []
    expect(t.guess('t1p0', found!.word).error).toBeUndefined()
    expect(t.state.phase).toBe('draw')
    const close = t.events.find((e) => e.type === 'close')
    expect(close?.to).toEqual({ playerIds: ['t1p0'] })
    expect(t.events.find((e) => e.type === 'wrong')?.to).toBeUndefined()
  })

  it('Fog of War hides older strokes from drawers only', () => {
    const t = new Table([3, 2])
    t.state = { ...t.state, round: { ...t.state.round, modifier: 'fog' } }
    t.pick(0)
    for (let i = 0; i < 4; i++) t.stroke([i * 100, 10, i * 100 + 50, 60, i * 100 + 80, 90])
    const d = t.view(t.r.drawerOrder[0]!)
    expect(d.strokes).toHaveLength(T.fogKeep)
    expect(d.fogHidden).toBe(4 - T.fogKeep)
    expect(t.view(t.r.seerId!).strokes).toHaveLength(4)
    expect(t.view('t1p0').strokes).toHaveLength(4)
  })
})

describe('ink rules', () => {
  it('rejects ink from anyone but the active drawer, and garbage coordinates', () => {
    const t = new Table([3, 2])
    t.pick(0)
    const turn = t.r.turn!
    const other = t.r.drawerOrder.find((p) => p !== turn.drawerId)!
    expect(t.act(other, 'ink', { round: 0, turn: turn.id, seq: 0, pts: [1, 1, 2, 2] }).error).toMatch(/Not your stroke/)
    expect(t.act('t1p0', 'ink', { round: 0, turn: turn.id, seq: 0, pts: [1, 1] }).error).toBeTruthy()
    expect(t.act(turn.drawerId, 'ink', { round: 0, turn: turn.id, seq: 0, pts: [1, 1, 2] }).error).toBeTruthy()
    expect(t.act(turn.drawerId, 'ink', { round: 0, turn: turn.id, seq: 0, pts: [1, 99999] }).error).toBeTruthy()
    expect(t.act(turn.drawerId, 'ink', { round: 0, turn: turn.id, seq: 'x', pts: [1, 1] }).error).toBeTruthy()
    expect(t.r.live).toBeNull()
  })

  it('streams live ink, ignores duplicates and silently drops stale turn ids', () => {
    const t = new Table([3, 2])
    t.pick(0)
    const turn = t.r.turn!
    t.act(turn.drawerId, 'ink', { round: 0, turn: turn.id, seq: 0, pts: [10, 10, 20, 20] })
    expect(t.view('t1p0').live!.p).toEqual([10, 10, 20, 20])
    t.act(turn.drawerId, 'ink', { round: 0, turn: turn.id, seq: 0, pts: [10, 10, 20, 20] }) // dup
    expect(t.r.live!.stroke.p).toEqual([10, 10, 20, 20])
    t.act(turn.drawerId, 'ink', { round: 0, turn: turn.id, seq: 1, pts: [30, 30], end: true })
    expect(t.r.strokes[0]!.p).toEqual([10, 10, 20, 20, 30, 30])
    // Late chunk from the finished turn: no error, no change.
    const stale = t.act(turn.drawerId, 'ink', { round: 0, turn: turn.id, seq: 2, pts: [40, 40] })
    expect(stale.error).toBeUndefined()
    expect(t.r.strokes).toHaveLength(1)
    expect(t.r.live).toBeNull()
    // Wrong round id also dropped.
    const next = t.r.turn!
    expect(t.act(next.drawerId, 'ink', { round: 5, turn: next.id, seq: 0, pts: [1, 1] }).error).toBeUndefined()
    expect(t.r.live).toBeNull()
  })

  it('ends the stroke and the turn when the ink runs out', () => {
    const t = new Table([2, 2])
    t.pick(0)
    const turn = t.r.turn!
    const pts: number[] = []
    for (let i = 0; i < 50; i++) pts.push(i % 2 ? 0 : 1000, i * 20) // zig-zags, ~1000 units per hop
    t.act(turn.drawerId, 'ink', { round: 0, turn: turn.id, seq: 0, pts: pts.slice(0, 8) })
    expect(t.r.strokes).toHaveLength(1)
    expect(t.r.strokesUsed).toBe(1)
    expect(t.r.turn!.id).not.toBe(turn.id)
  })

  it('cuts a stroke off at the turn deadline and keeps it', () => {
    const t = new Table([2, 2])
    t.pick(0)
    const turn = t.r.turn!
    t.act(turn.drawerId, 'ink', { round: 0, turn: turn.id, seq: 0, pts: [10, 10, 50, 50] })
    t.advance(6000)
    expect(t.r.strokes).toHaveLength(1)
    expect(t.events.some((e) => e.type === 'frozen')).toBe(false)
  })

  it('a frozen turn burns a stroke; pass also burns one', () => {
    const t = new Table([2, 2])
    t.pick(0)
    const first = t.drawer()
    t.advance(6000)
    expect(t.r.strokesUsed).toBe(1)
    expect(t.events.some((e) => e.type === 'frozen' && e.data?.playerId === first)).toBe(true)
    const turn = t.r.turn!
    expect(t.act(turn.drawerId, 'pass', { round: 0, turn: turn.id }).error).toBeUndefined()
    expect(t.r.strokesUsed).toBe(2)
    expect(t.r.strokes).toHaveLength(0)
  })

  it('Fat Markers forces the big brush, Blitz halves the timer, Drought cuts ink', () => {
    const t = new Table([2, 2], { secondsPerStroke: 8 })
    t.state = { ...t.state, round: { ...t.state.round, modifier: 'fat' } }
    t.pick(0)
    t.stroke()
    expect(t.r.strokes[0]!.w).toBe(48)
    const b = new Table([2, 2], { secondsPerStroke: 8 })
    b.state = { ...b.state, round: { ...b.state.round, modifier: 'blitz' } }
    b.pick(0)
    expect(b.r.turn!.deadline - b.now).toBe(4000)
    const d = new Table([2, 2])
    d.state = { ...d.state, round: { ...d.state.round, modifier: 'drought' } }
    d.pick(0)
    expect(d.r.turn!.inkMax).toBe(T.droughtInk)
    const f = new Table([2, 2])
    f.state = { ...f.state, round: { ...f.state.round, modifier: 'flip' } }
    f.pick(0)
    expect(f.r.turn!.flipped).toBe(false)
    f.stroke()
    expect(f.view(f.drawer()).turn!.flipped).toBe(true)
  })
})

describe('round endings and scoring', () => {
  it('stroke budget runs out → last call → nobody scores', () => {
    const t = new Table([2, 2], { strokesPerRound: 6 })
    t.pick(0)
    for (let i = 0; i < 6; i++) t.stroke()
    expect(t.state.phase).toBe('lastCall')
    expect(t.view('t1p0').canGuess).toBe(true)
    expect(t.guess('t1p0', 'wrong thing').error).toBeUndefined()
    t.advance(T.lastCallMs)
    expect(t.state.phase).toBe('reveal')
    expect(t.view('t1p0').result).toMatchObject({ winnerTeamId: null, points: 0 })
    expect(G.scores(t.state)).toEqual({ T0: 0, T1: 0 })
  })

  it('a guess racing the last-call timer loses (catch-up before acting)', () => {
    const t = new Table([2, 2], { strokesPerRound: 6 })
    t.pick(0)
    for (let i = 0; i < 6; i++) t.stroke()
    const text = t.promptText()
    t.now += T.lastCallMs // deadline passed, platform tick not yet run
    const res = t.act('t1p0', 'guess', { round: 0, text })
    expect(res.error).toMatch(/Too late/)
    expect(G.scores(t.state).T1).toBe(0)
  })

  it('stale guesses from the previous round are rejected', () => {
    const t = new Table([2, 2])
    t.pick(0)
    t.stroke()
    t.guess('t1p0', t.promptText())
    t.advance(T.revealMs)
    t.pick(0)
    t.stroke()
    expect(t.act('t0p0', 'guess', { round: 0, text: 'x' }).error).toBeTruthy()
  })

  it('guess cooldown and empty guesses', () => {
    const t = new Table([2, 2])
    t.pick(0)
    t.stroke()
    expect(t.guess('t1p0', '   ').error).toBeTruthy()
    expect(t.guess('t1p0', 'one').error).toBeUndefined()
    expect(t.act('t1p0', 'guess', { round: 0, text: 'two' }).error).toMatch(/Slow down/)
  })

  it('cannot guess during the pick phase', () => {
    const t = new Table([2, 2])
    expect(t.guess('t1p0', 'x').error).toMatch(/first stroke/)
  })

  it('points shrink with every stroke used', () => {
    const t = new Table([2, 2])
    t.pick(0) // easy: base 3
    expect(t.view('t1p0').pointsNow).toBe(6)
    for (let i = 0; i < 6; i++) t.stroke()
    expect(t.view('t1p0').pointsNow).toBe(3 + Math.round(18 / 12))
  })

  it('3 teams: first correct team wins, the round closes for everyone', () => {
    const t = new Table([2, 2, 2])
    expect(t.state.totalRounds).toBe(3)
    t.pick(0)
    t.stroke()
    expect(t.guess('t2p1', t.promptText()).error).toBeUndefined()
    expect(t.guess('t1p0', t.promptText()).error).toMatch(/Too late/)
    expect(G.scores(t.state).T2).toBeGreaterThan(0)
    expect(G.scores(t.state).T1).toBe(0)
    t.advance(T.revealMs)
    expect(t.r.teamId).toBe('T1')
    t.advance(T.pickMs)
    expect(t.state.phase).toBe('draw') // auto-picked
  })

  it('teams of 1: no Seer, rivals guessing gives the drawer an assist', () => {
    const t = new Table([1, 1])
    expect(t.r.seerId).toBeNull()
    expect(t.r.drawerOrder).toEqual(['t0p0'])
    t.pick(1)
    t.stroke()
    expect(t.drawer()).toBe('t0p0') // solo relay with yourself
    const pts = t.view('t1p0').pointsNow
    t.guess('t1p0', t.promptText())
    expect(G.scores(t.state)).toEqual({ T0: Math.ceil(pts / 2), T1: pts })
  })

  it('rotates the Seer and the first drawer across a team’s rounds', () => {
    const t = new Table([3, 1], { roundsPerTeam: 3 })
    const seers: string[] = []
    for (let i = 0; i < 6; i++) {
      if (t.r.teamId === 'T0') seers.push(t.r.seerId!)
      t.advance(T.pickMs)
      t.advance(6000 * 12 + T.lastCallMs)
      t.advance(T.revealMs)
    }
    expect(new Set(seers).size).toBe(3)
    expect(t.state.phase).toBe('gallery')
  })

  it('chaos cards only show up after the first lap', () => {
    const t = new Table([2, 2], { chaos: true, roundsPerTeam: 5 })
    const mods: (string | null)[] = []
    for (let i = 0; i < 10; i++) {
      mods.push(t.r.modifier)
      t.advance(T.pickMs + 6000 * 12 + T.lastCallMs + T.revealMs)
      while (t.state.phase !== 'pick' && t.state.phase !== 'gallery') t.advance(1000)
    }
    expect(mods[0]).toBeNull()
    expect(mods[1]).toBeNull()
    expect(mods.slice(2).some((m) => m !== null)).toBe(true)
  })

  it('does not repeat prompts across rounds', () => {
    const t = new Table([2, 2], { roundsPerTeam: 5 })
    const seen = new Set<number>()
    let lastRound = -1
    while (t.state.phase !== 'gallery') {
      if (t.state.phase === 'pick' && t.r.index !== lastRound && (lastRound = t.r.index) >= 0) for (const o of t.r.options) { expect(seen.has(o)).toBe(false); seen.add(o) }
      t.advance(1000)
    }
  })
})

describe('people leaving', () => {
  it('skips a disconnected drawer when handing over the turn', () => {
    const t = new Table([4, 2])
    t.pick(0)
    const order = t.r.drawerOrder
    t.players = t.players.map((p) => (p.id === order[1] ? { ...p, connected: false } : p))
    t.stroke()
    expect(t.drawer()).toBe(order[2])
  })

  it('the active drawer leaving mid-stroke keeps their ink and hands over', () => {
    const t = new Table([4, 2])
    t.pick(0)
    const turn = t.r.turn!
    t.act(turn.drawerId, 'ink', { round: 0, turn: turn.id, seq: 0, pts: [1, 1, 300, 300] })
    const step = G.onPlayerGone(t.state, turn.drawerId, t.ctx())
    t.state = step.state
    expect(t.r.strokes).toHaveLength(1)
    expect(t.r.drawerOrder).not.toContain(turn.drawerId)
    expect(t.drawer()).not.toBe(turn.drawerId)
    // Their stale ink after leaving does nothing.
    expect(t.act(turn.drawerId, 'ink', { round: 0, turn: turn.id, seq: 1, pts: [5, 5] }).error).toBeUndefined()
    expect(t.r.strokes).toHaveLength(1)
  })

  it('the last drawer leaving takes the Seer’s blindfold off', () => {
    const t = new Table([2, 2])
    t.pick(0)
    const seer = t.r.seerId!
    const drawer = t.r.drawerOrder[0]!
    t.state = G.onPlayerGone(t.state, drawer, t.ctx()).state
    expect(t.r.seerId).toBeNull()
    expect(t.r.drawerOrder).toEqual([seer])
    expect(t.drawer()).toBe(seer)
    expect(t.view(seer).role).toBe('drawer')
    expect(t.view(seer).prompt).toBe(t.promptText())
  })

  it('a whole drawing team vanishing ends the round, and their later rounds are skipped', () => {
    const t = new Table([1, 2], { roundsPerTeam: 2 })
    t.pick(0)
    t.state = G.onPlayerGone(t.state, 't0p0', t.ctx()).state
    expect(t.state.phase).toBe('reveal')
    t.advance(T.revealMs)
    expect(t.r.teamId).toBe('T1')
    t.advance(T.pickMs + 6000 * 12 + T.lastCallMs + T.revealMs)
    while (t.state.phase !== 'gallery' && t.state.phase !== 'pick') t.advance(1000)
    expect(t.r.teamId).toBe('T1') // T0 skipped
    expect(t.r.index).toBe(3)
  })

  it('the picker leaving during pick still lets the round go on', () => {
    const t = new Table([3, 2])
    const picker = t.r.pickerId!
    t.state = G.onPlayerGone(t.state, picker, t.ctx()).state
    expect(t.r.pickerId).not.toBe(picker)
    t.advance(T.pickMs)
    expect(t.state.phase).toBe('draw')
    expect(t.drawer()).not.toBe(picker)
  })

  it('unknown / late players are ignored', () => {
    const t = new Table([2, 2])
    expect(t.act('ghost', 'guess', { round: 0, text: 'x' }).error).toMatch(/mid-game/)
    expect(G.onPlayerGone(t.state, 'ghost', t.ctx()).state).toBe(t.state)
    expect(t.act(t.r.drawerOrder[0]!, 'nonsense').error).toBeTruthy()
  })
})
