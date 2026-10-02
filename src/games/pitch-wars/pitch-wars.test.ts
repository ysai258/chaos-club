import { describe, expect, it } from 'vitest'
import type { BaseCtx, GameEvent, GamePlayer, GameTeam, Step } from '../types.ts'
import { CURVEBALLS, PRODUCTS, QUESTIONS, TWISTS } from './content.ts'
import { CURVEBALL_BONUS_MS, INVEST_MS, pitchWars, STAGE_MS, WALLET, type Settings, type State } from './index.ts'
import type { PwView } from './shared.ts'

// ---------------------------------------------------------------- harness

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const COLORS = ['tomato', 'sky', 'lime', 'grape'] as const

class Game {
  state: State
  now = 1_000_000
  players: GamePlayer[]
  teams: GameTeam[]
  hostId: string
  random = rng(42)
  events: GameEvent[] = []

  constructor(sizes: number[], settings: Partial<Settings> = {}, seed = 42) {
    this.random = rng(seed)
    this.teams = sizes.map((n, i) => ({
      id: `T${i}`, name: `Team ${i}`, color: COLORS[i] ?? 'sun',
      playerIds: Array.from({ length: n }, (_, j) => `p${i}${j}`),
    }))
    this.players = this.teams.flatMap((t) => t.playerIds.map((id) => ({ id, name: `N-${id}`, avatar: '🙂', teamId: t.id, connected: true })))
    this.hostId = this.players[0]!.id
    this.state = pitchWars.create({ ...this.ctx(), settings: pitchWars.parseSettings(settings) })
  }

  ctx(): BaseCtx {
    return { now: this.now, random: this.random, players: this.players, teams: this.teams, hostId: this.hostId }
  }

  view(id: string): PwView { return pitchWars.view(this.state, id, this.ctx()) as PwView }

  apply(step: Step<State>) {
    if (!step.error) {
      this.state = step.state
      this.events.push(...(step.events ?? []))
    }
    return step
  }

  act(id: string, type: string, payload: Record<string, unknown> = {}) {
    return this.apply(pitchWars.action(this.state, id, { type, payload: { stage: this.state.stage, ...payload } }, this.ctx()))
  }

  ok(id: string, type: string, payload: Record<string, unknown> = {}) {
    const r = this.act(id, type, payload)
    expect(r.error, `${type} by ${id}`).toBeUndefined()
    return r
  }

  /** Advance the clock like the platform does: tick while the deadline is due. */
  advance(ms: number) {
    this.now += ms
    for (let i = 0; i < 20; i++) {
      const d = pitchWars.deadline(this.state)
      if (d === null || d > this.now) break
      this.apply(pitchWars.tick(this.state, this.ctx()))
    }
  }

  expire() {
    const d = pitchWars.deadline(this.state)
    if (d !== null) this.advance(d - this.now)
  }

  gone(id: string) {
    this.players = this.players.map((p) => (p.id === id ? { ...p, connected: false } : p))
    this.apply(pitchWars.onPlayerGone(this.state, id, this.ctx()))
  }

  disconnect(id: string) {
    this.players = this.players.map((p) => (p.id === id ? { ...p, connected: false } : p))
  }

  members(teamId: string) { return this.teams.find((t) => t.id === teamId)!.playerIds }
  current() { return this.state.current!.teamId }
  sharks() { return this.players.filter((p) => p.teamId !== this.current() && !this.state.players.find((q) => q.id === p.id)?.gone).map((p) => p.id) }
  pitcher() { return this.state.current!.pitcherId! }
}

function readyAll(g: Game) {
  for (const t of g.teams) {
    const id = t.playerIds.find((pid) => !g.state.players.find((p) => p.id === pid)?.gone)
    if (id && g.state.phase === 'prep' && !g.state.teamRounds[t.id]?.ready) g.ok(id, 'ready', { ready: true })
  }
}

// ---------------------------------------------------------------- content

describe('content', () => {
  it('has plenty of original, unique cards', () => {
    expect(PRODUCTS.length).toBeGreaterThanOrEqual(100)
    expect(TWISTS.length).toBeGreaterThanOrEqual(60)
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(60)
    expect(CURVEBALLS.length).toBeGreaterThanOrEqual(30)
    expect(new Set(PRODUCTS.map((p) => p.title)).size).toBe(PRODUCTS.length)
    expect(new Set(TWISTS).size).toBe(TWISTS.length)
    expect(new Set(QUESTIONS).size).toBe(QUESTIONS.length)
    expect(new Set(CURVEBALLS).size).toBe(CURVEBALLS.length)
  })
})

// ---------------------------------------------------------------- playthrough

describe('full playthrough', () => {
  it('plays 2 rounds with 2 teams of 2, every team pitches each round, pitchers rotate', () => {
    const g = new Game([2, 2], { rounds: 2 })
    expect(g.state.phase).toBe('prep')
    expect(g.view('p00').myTeam?.product.title).toBeTruthy()
    const pitchersByTeam: Record<string, string[]> = { T0: [], T1: [] }

    for (let round = 0; round < 2; round++) {
      expect(g.state.round).toBe(round)
      // Draft the poster
      for (const t of g.teams) {
        const m = t.playerIds[0]!
        g.ok(m, 'draft', { name: `${t.id} Co R${round}`, slogan: 'Bas kar bhai', price: '₹99/month', mascot: '🐐', ask: g.state.askOptions[1], equity: 51 })
        pitchersByTeam[t.id]!.push(g.state.teamRounds[t.id]!.pitcherId!)
      }
      readyAll(g)
      for (let pitch = 0; pitch < 2; pitch++) {
        expect(g.state.phase).toBe('stage')
        const team = g.current()
        expect(g.state.order[pitch]).toBe(team)
        g.ok(g.pitcher(), 'start')
        expect(g.state.phase).toBe('pitch')
        const shark = g.sharks()[0]!
        const hand = g.view(shark).sharkHand!
        expect(hand.questions).toHaveLength(3)
        g.ok(shark, 'fire', { id: hand.questions[0]!.id })
        g.ok(shark, 'curveball', { id: hand.curveballs[0]!.id })
        expect(g.view(g.pitcher()).onStage!.questions).toHaveLength(1)
        expect(g.view(g.pitcher()).onStage!.curveball?.text).toBe(hand.curveballs[0]!.text)
        g.ok(g.pitcher(), 'done')
        expect(g.state.phase).toBe('invest')
        for (const s of g.sharks()) g.ok(s, 'invest', { amount: 300 })
        expect(g.state.phase).toBe('reveal')
        const rec = g.view('p00').reveal!
        expect(rec.total).toBe(300)
        expect(rec.deal).toBe(true) // ask = askOptions[1] = 200
        expect(rec.points).toBe(300 + 100)
        expect(rec.draft.name).toBe(`${team} Co R${round}`)
        g.expire()
      }
    }
    expect(g.state.phase).toBe('over')
    expect(pitchWars.isOver(g.state)).toBe(true)
    expect(pitchWars.scores(g.state)).toEqual({ T0: 8, T1: 8 })
    // rotation: each team used two different pitchers
    expect(new Set(pitchersByTeam.T0).size).toBe(2)
    expect(new Set(pitchersByTeam.T1).size).toBe(2)
    const res = pitchWars.results(g.state, g.ctx())
    expect(res.highlights.length).toBeGreaterThan(0)
    expect(res.awards?.some((a) => a.title === 'Golden Mic')).toBe(true)
  })

  it('runs entirely on timers when nobody touches anything', () => {
    const g = new Game([1, 1], { rounds: 1 })
    for (let i = 0; i < 20 && g.state.phase !== 'over'; i++) g.expire()
    expect(g.state.phase).toBe('over')
    expect(g.state.history).toHaveLength(2)
    expect(g.state.history.every((h) => h.total === 0 && !h.deal && h.points === 0)).toBe(true)
    expect(pitchWars.scores(g.state)).toEqual({ T0: 0, T1: 0 })
  })

  it('misses the Ask → no deal, half the money', () => {
    const g = new Game([1, 2], { rounds: 1 })
    g.ok('p00', 'draft', { ask: g.state.askOptions[5] }) // 1000 lakh
    readyAll(g)
    while (g.current() !== 'T0') { g.expire(); g.expire(); g.expire(); g.expire() }
    g.expire(); g.expire() // stage → pitch → invest
    expect(g.state.phase).toBe('invest')
    g.ok('p10', 'invest', { amount: 500 })
    g.ok('p11', 'invest', { amount: 200 })
    const r = g.view('p00').reveal!
    expect(r.byTeam).toEqual([{ teamId: 'T1', amount: 350 }]) // average, so team size doesn't matter
    expect(r.deal).toBe(false)
    expect(r.points).toBe(175)
  })

  it('3 teams: every non-pitching team invests, wallets are per round and shared across pitches', () => {
    const g = new Game([1, 1, 1], { rounds: 1 })
    expect(g.state.askOptions).toEqual([200, 400, 600, 1000, 1400, 2000])
    readyAll(g)
    // pitch 1
    g.ok(g.pitcher(), 'start')
    g.ok(g.pitcher(), 'done')
    const sharks = g.sharks()
    expect(sharks).toHaveLength(2)
    expect(g.view(sharks[0]!).role).toBe('shark')
    g.ok(sharks[0]!, 'invest', { amount: WALLET })
    g.ok(sharks[1]!, 'invest', { amount: 100 })
    expect(g.state.history[0]!.total).toBe(1100)
    g.expire()
    // pitch 2: the all-in shark has nothing left, unless they're pitching
    g.ok(g.pitcher(), 'start')
    g.ok(g.pitcher(), 'done')
    const broke = sharks[0]!
    if (g.sharks().includes(broke)) {
      expect(g.act(broke, 'invest', { amount: 50 }).error).toMatch(/wallet/)
      g.ok(broke, 'invest', { amount: 0 })
    }
  })
})

// ---------------------------------------------------------------- secrets

describe('hidden information', () => {
  it("rival drafts, products and twists never leak during prep", () => {
    const g = new Game([2, 2])
    g.ok('p00', 'draft', { name: 'ZZSECRETNAME', slogan: 'ZZSECRETSLOGAN', price: 'ZZPRICE' })
    const mine = g.state.teamRounds.T0!
    for (const viewer of ['p10', 'p11']) {
      const json = JSON.stringify(g.view(viewer))
      expect(json).not.toContain('ZZSECRET')
      expect(json).not.toContain('ZZPRICE')
      expect(json).not.toContain(mine.product.title)
      expect(json).not.toContain(mine.twist)
    }
    const teammate = JSON.stringify(g.view('p01'))
    expect(teammate).toContain('ZZSECRETNAME')
    expect(teammate).toContain(mine.product.title)
  })

  it('the team pitching second stays secret while the first pitches', () => {
    const g = new Game([1, 1])
    g.ok('p00', 'draft', { name: 'AAAFIRST' })
    g.ok('p10', 'draft', { name: 'BBBSECOND' })
    readyAll(g)
    const first = g.current()
    const second = first === 'T0' ? 'T1' : 'T0'
    const firstName = first === 'T0' ? 'AAAFIRST' : 'BBBSECOND'
    const secondName = first === 'T0' ? 'BBBSECOND' : 'AAAFIRST'
    const firstMember = g.members(first)[0]!
    const json = JSON.stringify(g.view(firstMember))
    expect(json).toContain(firstName)
    expect(json).not.toContain(secondName)
    expect(json).not.toContain(g.state.teamRounds[second]!.product.title)
  })

  it("cheque amounts are hidden from everyone but the signer until the reveal; shark hands stay with the shark team", () => {
    const g = new Game([2, 2, 1])
    readyAll(g)
    g.ok(g.pitcher(), 'start')
    const pitching = g.current()
    const sharkTeams = g.teams.filter((t) => t.id !== pitching)
    // Shark hands: own team only
    const handA = g.view(sharkTeams[0]!.playerIds[0]!).sharkHand!
    const handB = g.view(sharkTeams[1]!.playerIds[0]!).sharkHand!
    expect(handA.questions.length).toBe(3)
    for (const id of g.members(pitching)) {
      const v = g.view(id)
      expect(v.sharkHand).toBeNull()
      const json = JSON.stringify(v)
      for (const q of [...handA.questions, ...handB.questions]) expect(json).not.toContain(q.text)
      for (const c of [...handA.curveballs, ...handB.curveballs]) expect(json).not.toContain(c.text)
    }
    const otherJson = JSON.stringify(g.view(sharkTeams[1]!.playerIds[0]!))
    for (const q of handA.questions) if (!handB.questions.some((x) => x.text === q.text)) expect(otherJson).not.toContain(q.text)

    g.ok(g.pitcher(), 'done')
    const signer = sharkTeams[0]!.playerIds[0]!
    g.ok(signer, 'invest', { amount: 750 })
    expect(g.view(signer).invest!.mine).toBe(750)
    for (const p of g.players) {
      if (p.id === signer) continue
      const v = g.view(p.id)
      expect(v.invest!.lockedIds).toContain(signer)
      expect(v.invest!.mine).toBeNull()
      expect(JSON.stringify(v)).not.toContain('750')
    }
    expect(JSON.stringify(g.state.cheques)).toContain('750')
  })
})

// ---------------------------------------------------------------- edge cases

describe('edge cases', () => {
  it('rejects stale actions from a previous stage and double taps', () => {
    const g = new Game([1, 1])
    const oldStage = g.state.stage
    readyAll(g)
    expect(g.act('p00', 'ready', { ready: false, stage: oldStage }).error).toMatch(/passed/)
    const pitcher = g.pitcher()
    const s = g.state.stage
    g.ok(pitcher, 'start')
    expect(g.act(pitcher, 'start', { stage: s }).error).toBeTruthy() // double tap
    g.ok(pitcher, 'done')
    const shark = g.sharks()[0]!
    g.ok(shark, 'invest', { amount: 100 }) // only shark → reveal right away
    expect(g.state.phase).toBe('reveal')
    expect(g.act(shark, 'invest', { amount: 100 }).error).toBeTruthy()
  })

  it('validates untrusted payloads', () => {
    const g = new Game([1, 1])
    expect(g.act('p00', 'draft', { mascot: '💩' }).error).toBeTruthy()
    expect(g.act('p00', 'draft', { ask: 12345 }).error).toBeTruthy()
    expect(g.act('p00', 'draft', { name: 42 }).error).toBeTruthy()
    expect(g.act('p00', 'draft', { equity: 99 }).error).toBeTruthy()
    g.ok('p00', 'draft', { name: 'x'.repeat(500), slogan: 'line1\nline2' })
    expect(g.state.teamRounds.T0!.draft.name).toHaveLength(32)
    expect(g.state.teamRounds.T0!.draft.slogan).not.toContain('\n')
    expect(g.act('p00', 'nope').error).toBeTruthy()
    expect(g.act('stranger', 'ready', { ready: true }).error).toMatch(/watching/)
    readyAll(g)
    g.ok(g.pitcher(), 'start')
    g.ok(g.pitcher(), 'done')
    const shark = g.sharks()[0]!
    expect(g.act(shark, 'invest', { amount: 33 }).error).toBeTruthy()
    expect(g.act(shark, 'invest', { amount: -50 }).error).toBeTruthy()
    expect(g.act(shark, 'invest', { amount: WALLET + 50 }).error).toBeTruthy()
    expect(g.act(shark, 'invest', { amount: '100' }).error).toBeTruthy()
    expect(g.act(g.pitcher(), 'invest', { amount: 100 }).error).toMatch(/yourself/)
  })

  it('redraws: one product and one twist per round', () => {
    const g = new Game([1, 1], {}, 7)
    const before = g.state.teamRounds.T0!.product.title
    g.ok('p00', 'redraw', { card: 'product' })
    expect(g.state.teamRounds.T0!.product.title).not.toBe(before)
    expect(g.act('p00', 'redraw', { card: 'product' }).error).toMatch(/No product/)
    g.ok('p00', 'redraw', { card: 'twist' })
    expect(g.act('p00', 'redraw', { card: 'twist' }).error).toBeTruthy()
  })

  it('question limits and one curveball per pitch / per team per round', () => {
    const g = new Game([1, 1, 1])
    readyAll(g)
    g.ok(g.pitcher(), 'start')
    const [a, b] = g.sharks()
    const ha = g.view(a!).sharkHand!
    expect(g.act(g.pitcher(), 'fire', { id: ha.questions[0]!.id }).error).toBeTruthy()
    g.ok(a!, 'fire', { id: ha.questions[0]!.id })
    expect(g.act(a!, 'fire', { id: ha.questions[0]!.id }).error).toMatch(/Already/)
    g.ok(a!, 'fire', { id: ha.questions[1]!.id })
    expect(g.act(a!, 'fire', { id: ha.questions[2]!.id }).error).toMatch(/out of questions/)
    expect(g.act(a!, 'fire', { id: 'q99999' }).error).toBeTruthy()
    const endsBefore = g.state.endsAt!
    g.ok(a!, 'curveball', { id: ha.curveballs[0]!.id })
    expect(g.state.endsAt).toBe(endsBefore + CURVEBALL_BONUS_MS)
    const hb = g.view(b!).sharkHand!
    expect(hb.canCurveball).toBe(false)
    expect(g.act(b!, 'curveball', { id: hb.curveballs[0]!.id }).error).toMatch(/already threw/)
  })

  it('a timer expiring at the same moment as an action: late actions are rejected', () => {
    const g = new Game([1, 1])
    readyAll(g)
    g.expire() // stage → pitch
    g.ok(g.pitcher(), 'done')
    g.now += INVEST_MS + 1000 // deadline passed but the platform hasn't ticked yet
    expect(g.act(g.sharks()[0]!, 'invest', { amount: 100 }).error).toMatch(/Time/)
    g.advance(0)
    expect(g.state.phase).toBe('reveal')
  })

  it('teams of 1 always pitch with the same person; 2 teams of 8 rotate through members', () => {
    const solo = new Game([1, 1], { rounds: 3 })
    const big = new Game([8, 8], { rounds: 3 })
    const seenSolo = new Set<string>()
    const seenBig = new Set<string>()
    for (let r = 0; r < 3; r++) {
      seenSolo.add(solo.state.teamRounds.T0!.pitcherId!)
      seenBig.add(big.state.teamRounds.T0!.pitcherId!)
      for (let i = 0; i < 12 && solo.state.round === r && solo.state.phase !== 'over'; i++) solo.expire()
      for (let i = 0; i < 12 && big.state.round === r && big.state.phase !== 'over'; i++) big.expire()
    }
    expect(seenSolo.size).toBe(1)
    expect(seenBig.size).toBe(3)
  })

  it('the pitcher vanishing mid-pitch hands the mic to a teammate', () => {
    const g = new Game([3, 1])
    readyAll(g)
    while (g.current() !== 'T0') { for (let i = 0; i < 4; i++) g.expire() }
    g.ok(g.pitcher(), 'start')
    const old = g.pitcher()
    g.gone(old)
    expect(g.pitcher()).not.toBe(old)
    expect(g.members('T0')).toContain(g.pitcher())
    g.ok(g.pitcher(), 'done')
    expect(g.state.phase).toBe('invest')
  })

  it('a disconnected (grace period) pitcher can be replaced by a teammate taking the mic', () => {
    const g = new Game([2, 1])
    const pitcher = g.state.teamRounds.T0!.pitcherId!
    const mate = g.members('T0').find((id) => id !== pitcher)!
    expect(g.act(mate, 'takeMic').error).toMatch(/still here/)
    g.disconnect(pitcher)
    g.ok(mate, 'takeMic')
    expect(g.state.teamRounds.T0!.pitcherId).toBe(mate)
  })

  it('an offline shark never blocks the reveal; disconnected sharks just abstain', () => {
    const g = new Game([1, 3])
    readyAll(g)
    while (g.current() !== 'T0') { for (let i = 0; i < 4; i++) g.expire() }
    g.ok(g.pitcher(), 'start')
    g.ok(g.pitcher(), 'done')
    g.disconnect('p12')
    g.ok('p10', 'invest', { amount: 400 })
    expect(g.state.phase).toBe('invest')
    g.ok('p11', 'invest', { amount: 200 })
    expect(g.state.phase).toBe('reveal')
    const r = g.state.history.at(-1)!
    expect(r.cheques.find((c) => c.playerId === 'p12')!.amount).toBeNull()
    expect(r.byTeam[0]!.amount).toBe(300) // abstainers excluded from the average
  })

  it('the last unsigned shark leaving triggers the reveal', () => {
    const g = new Game([1, 2])
    readyAll(g)
    while (g.current() !== 'T0') { for (let i = 0; i < 4; i++) g.expire() }
    g.ok(g.pitcher(), 'start')
    g.ok(g.pitcher(), 'done')
    g.ok('p10', 'invest', { amount: 100 })
    g.gone('p11')
    expect(g.state.phase).toBe('reveal')
  })

  it('a whole team vanishing in a 3-team game skips their pitch and stops them investing', () => {
    const g = new Game([1, 1, 1], { rounds: 2 })
    readyAll(g)
    const later = g.state.order[2]!
    g.gone(g.members(later)[0]!)
    expect(g.state.phase).toBe('stage')
    for (let i = 0; i < 30 && g.state.phase !== 'over'; i++) g.expire()
    expect(g.state.phase).toBe('over')
    expect(g.state.history.some((h) => h.teamId === later && h.skipped)).toBe(true)
    expect(g.state.history.filter((h) => !h.skipped).length).toBe(4)
  })

  it('down to one team → game over instead of getting stuck', () => {
    const g = new Game([1, 2])
    g.gone('p00')
    expect(g.state.phase).toBe('over')
    expect(pitchWars.deadline(g.state)).toBeNull()
  })

  it('a pitching team vanishing mid-pitch moves on', () => {
    const g = new Game([1, 1, 1])
    readyAll(g)
    g.ok(g.pitcher(), 'start')
    const team = g.current()
    g.gone(g.members(team)[0]!)
    expect(g.state.phase).toBe('stage')
    expect(g.current()).not.toBe(team)
  })

  it('a player gone during prep: un-ready team no longer blocks if the rest are ready', () => {
    const g = new Game([1, 1, 1])
    g.ok('p00', 'ready', { ready: true })
    g.ok('p10', 'ready', { ready: true })
    expect(g.state.phase).toBe('prep')
    g.gone('p20')
    expect(g.state.phase).toBe('stage')
  })

  it('only the host can skip the reveal', () => {
    const g = new Game([1, 1])
    readyAll(g)
    g.ok(g.pitcher(), 'start')
    g.ok(g.pitcher(), 'done')
    g.ok(g.sharks()[0]!, 'invest', { amount: 0 })
    expect(g.act('p10', 'next').error).toMatch(/host/)
    g.ok('p00', 'next')
    expect(g.state.phase).toBe('stage')
  })

  it('stage auto-starts, ignores players unknown to the game', () => {
    const g = new Game([1, 1])
    readyAll(g)
    g.advance(STAGE_MS)
    expect(g.state.phase).toBe('pitch')
    const step = pitchWars.onPlayerGone(g.state, 'late-joiner', g.ctx())
    expect(step.state).toBe(g.state)
    expect((pitchWars.view(g.state, 'late-joiner', g.ctx()) as PwView).role).toBe('spectator')
  })

  it('parseSettings clamps garbage', () => {
    expect(pitchWars.parseSettings({ rounds: 99, prepSeconds: 'abc', pitchSeconds: 50 })).toEqual({ rounds: 3, prepSeconds: 120, pitchSeconds: 45 })
    expect(pitchWars.parseSettings({})).toEqual({ rounds: 2, prepSeconds: 120, pitchSeconds: 75 })
  })

  it('never mutates the previous state', () => {
    const g = new Game([1, 1])
    const snap = JSON.stringify(g.state)
    const prev = g.state
    pitchWars.action(prev, 'p00', { type: 'draft', payload: { stage: prev.stage, name: 'mutant' } }, g.ctx())
    pitchWars.tick(prev, { ...g.ctx(), now: g.now + 10_000_000 })
    pitchWars.onPlayerGone(prev, 'p00', g.ctx())
    expect(JSON.stringify(prev)).toBe(snap)
  })
})
