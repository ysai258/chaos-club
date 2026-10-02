import { describe, expect, it } from 'vitest'
import type { BaseCtx, GamePlayer, GameTeam } from '../types.ts'
import { overheard, TIMING, type State, type Settings } from './index.ts'
import type { Digit, OverheardView } from './shared.ts'
import { KEYWORDS } from './content.ts'
import { clueProblem, squash, wordMatches } from './logic.ts'

// ------------------------------------------------------------- harness

function seeded(seed: number) {
  let x = seed >>> 0
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0
    return x / 2 ** 32
  }
}

class Table {
  now = 1_000_000
  players: GamePlayer[]
  teams: GameTeam[]
  state: State
  random = seeded(42)
  hostId = 'a1'
  lastError: string | undefined

  constructor(sizes: [number, number] = [2, 2], settings: Partial<Settings> = {}) {
    const mk = (team: string, n: number) =>
      Array.from({ length: n }, (_, i): GamePlayer => ({ id: `${team}${i + 1}`, name: `${team.toUpperCase()}${i + 1}`, avatar: '🙂', teamId: team, connected: true }))
    this.players = [...mk('a', sizes[0]), ...mk('b', sizes[1])]
    this.teams = [
      { id: 'a', name: 'Chai Gang', color: 'tomato', playerIds: this.players.filter((p) => p.teamId === 'a').map((p) => p.id) },
      { id: 'b', name: 'Spicy Pickles', color: 'sky', playerIds: this.players.filter((p) => p.teamId === 'b').map((p) => p.id) },
    ]
    this.state = overheard.create({ ...this.ctx(), settings: overheard.parseSettings(settings) })
  }

  ctx(): BaseCtx {
    return { now: this.now, random: this.random, players: this.players, teams: this.teams, hostId: this.hostId }
  }
  view(pid: string): OverheardView {
    return overheard.view(this.state, pid, this.ctx()) as OverheardView
  }
  json(pid: string): string {
    return JSON.stringify(overheard.view(this.state, pid, this.ctx()))
  }
  act(pid: string, type: string, payload: Record<string, unknown> = {}) {
    const step = overheard.action(this.state, pid, { type, payload: { turn: this.state.turn, ...payload } }, this.ctx())
    this.lastError = step.error
    if (!step.error) this.state = step.state
    this.settle()
    return step
  }
  /** Platform behaviour: tick while the deadline has passed. */
  settle() {
    for (let i = 0; i < 20; i++) {
      const d = overheard.deadline(this.state)
      if (d === null || d > this.now) return
      this.state = overheard.tick(this.state, this.ctx()).state
    }
  }
  advance(ms: number) {
    this.now += ms
    this.settle()
  }
  expire() {
    const d = overheard.deadline(this.state)
    if (d !== null) this.advance(d - this.now)
  }
  gone(pid: string) {
    this.players = this.players.map((p) => (p.id === pid ? { ...p, connected: false } : p))
    this.state = overheard.onPlayerGone(this.state, pid, this.ctx()).state
    this.settle()
  }
  enc(team: string): string {
    return this.state.tx[team]!.encryptorId!
  }
  code(team: string): Digit[] {
    return this.state.tx[team]!.code
  }
  team(id: string) {
    return this.state.teams.find((t) => t.id === id)!
  }
  wrong(team: string): Digit[] {
    const c = this.code(team)
    return [c[1]!, c[0]!, c[2]!]
  }
  /** Both encryptors send clues that are always legal (unique per round). */
  sendClues() {
    for (const t of ['a', 'b']) {
      const pid = this.enc(t)
      if (this.state.tx[t]!.clues) continue
      const r = this.state.round
      const step = this.act(pid, 'clue:submit', { clues: [`zx${t}${r}one`, `zx${t}${r}two`, `zx${t}${r}three`] })
      expect(step.error).toBeUndefined()
    }
  }
  readAloud() {
    expect(this.state.phase).toBe('transmit')
    const tx = this.state.tx[this.state.order[this.state.active]!]!
    for (let i = 0; i < 3; i++) this.act(tx.encryptorId!, 'clue:reveal', { index: i })
  }
  /** Lock a guess for `guesserTeam` on the active transmission. */
  lock(guesserTeam: string, slots: Digit[]) {
    const active = this.state.order[this.state.active]!
    const pid = this.teams.find((t) => t.id === guesserTeam)!.playerIds.find((p) => p !== this.state.tx[active]!.encryptorId && !this.state.gone.includes(p))!
    return this.act(pid, 'guess:lock', { slots })
  }
  /** Play one transmission: decode right/wrong, intercept right/wrong (when open). */
  playTx(decode: boolean, intercept: boolean) {
    this.readAloud()
    const active = this.state.order[this.state.active]!
    const rival = active === 'a' ? 'b' : 'a'
    if (this.state.phase === 'guess' && this.state.tx[active]!.guesses[rival]) this.lock(rival, intercept ? this.code(active) : this.wrong(active))
    if (this.state.phase === 'guess') this.lock(active, decode ? this.code(active) : this.wrong(active))
    expect(this.state.phase === 'reveal' || this.state.phase === 'over' || this.state.phase === 'tiebreak').toBe(true)
    if (this.state.phase === 'reveal') this.expire()
  }
  /** Outcome per team for a round, keyed by the transmitting team. */
  playRound(plan: Record<string, { decode: boolean; intercept: boolean }>) {
    expect(this.state.phase).toBe('encrypt')
    this.sendClues()
    for (let i = 0; i < 2; i++) {
      const t = this.state.order[this.state.active]!
      this.playTx(plan[t]!.decode, plan[t]!.intercept)
    }
  }
}

const clean = { decode: true, intercept: false }

// ------------------------------------------------------------- content

describe('content', () => {
  it('has 150+ distinct keywords and none hides inside another', () => {
    expect(KEYWORDS.length).toBeGreaterThanOrEqual(150)
    const sq = KEYWORDS.map(squash)
    expect(new Set(sq).size).toBe(KEYWORDS.length)
    for (const a of sq) for (const b of sq) if (a !== b) expect(b.includes(a), `${a} in ${b}`).toBe(false)
  })
  it('includes desi flavour', () => {
    for (const w of ['Biryani', 'Monsoon', 'Auto-rickshaw', 'Chai', 'Jugaad']) expect(KEYWORDS).toContain(w)
  })
})

describe('clue rules', () => {
  it('rejects a keyword, a 4+ letter part of one, and repeats', () => {
    const kws = ['Monsoon', 'Auto-rickshaw', 'Pani Puri', 'Bat']
    expect(clueProblem('MONSOON season', kws, [])).toMatch(/gives away/)
    expect(clueProblem('green rickshaws', kws, [])).toMatch(/part of/)
    expect(clueProblem('wombat', kws, [])).toMatch(/gives away/)
    expect(clueProblem('auto', kws, [])).toMatch(/part of/)
    expect(clueProblem('tuk-tuk', kws, [])).toBeNull()
    expect(clueProblem('rain', kws, ['Rain'])).toMatch(/already used/)
    expect(clueProblem('umbrella', kws, ['rain'])).toBeNull()
    expect(clueProblem('', kws, [])).toMatch(/at least/)
  })
  it('tiebreak matching forgives case, spacing, plurals and one typo', () => {
    expect(wordMatches('biryani', 'Biryani')).toBe(true)
    expect(wordMatches('auto rickshaw', 'Auto-rickshaw')).toBe(true)
    expect(wordMatches('Mangoes', 'Mango')).toBe(true)
    expect(wordMatches('mangos', 'Mango')).toBe(true)
    expect(wordMatches('biriyani', 'Biryani')).toBe(true)
    expect(wordMatches('cat', 'Bat')).toBe(false)
    expect(wordMatches('', 'Bat')).toBe(false)
  })
})

describe('settings', () => {
  it('coerces junk to defaults and clamps', () => {
    expect(overheard.parseSettings({})).toEqual({ maxRounds: 8, clueSeconds: 120, guessSeconds: 90, interceptRound1: false })
    expect(overheard.parseSettings({ maxRounds: 99, clueSeconds: '60', guessSeconds: '45', interceptRound1: true }))
      .toEqual({ maxRounds: 10, clueSeconds: 60, guessSeconds: 45, interceptRound1: true })
    expect(overheard.parseSettings({ maxRounds: 'x', clueSeconds: 7, guessSeconds: null }).clueSeconds).toBe(120)
  })
  it('meta requires two teams of at least two', () => {
    expect(overheard.meta.teams).toEqual({ min: 2, max: 2 })
    expect(overheard.meta.minTeamSize).toBe(2)
    expect(overheard.meta.teamChat).toBe(true)
  })
})

// ------------------------------------------------------------- playthrough

describe('full game', () => {
  it('two wiretaps win: B intercepts A in rounds 2 and 3', () => {
    const t = new Table([3, 2])
    expect(t.state.round).toBe(1)
    expect(t.state.order).toEqual(['a', 'b'])
    t.playRound({ a: clean, b: clean })
    expect(t.team('a').history).toHaveLength(1)
    expect(t.team('a').history[0]!.intercepted).toBeNull() // round 1: no interception
    expect(t.state.round).toBe(2)
    expect(t.state.order).toEqual(['b', 'a']) // alternates who goes first
    t.playRound({ a: { decode: true, intercept: true }, b: clean })
    expect(t.team('b').wiretaps).toBe(1)
    t.playRound({ a: { decode: true, intercept: true }, b: clean })
    expect(t.state.phase).toBe('over')
    expect(overheard.isOver(t.state)).toBe(true)
    expect(t.state.outcome!.winner).toBe('b')
    const sc = overheard.scores(t.state)
    expect(sc.b!).toBeGreaterThan(sc.a!)
    const res = overheard.results(t.state, t.ctx())
    expect(res.highlights[0]).toMatch(/wiretapped two codes/)
    expect(res.highlights.join('\n')).toMatch(/secret words/)
    expect(res.awards!.some((a) => a.title === 'Wiretapper')).toBe(true)
    expect(res.awards!.some((a) => a.title === 'Leaky Mic')).toBe(true)
    // at the end everyone sees every keyword
    const v = t.view('b1')
    expect(v.outcome!.keywords.a).toEqual(t.team('a').keywords)
  })

  it('two static lose', () => {
    const t = new Table()
    t.playRound({ a: { decode: false, intercept: false }, b: clean })
    t.playRound({ a: { decode: false, intercept: false }, b: clean })
    expect(t.state.outcome!.winner).toBe('b')
    expect(t.state.outcome!.reason).toMatch(/static/)
  })

  it('the round is always finished before the game ends (both sides get their transmission)', () => {
    const t = new Table()
    t.playRound({ a: clean, b: clean })
    // round 2 order is b, a. B gets intercepted twice? only one per round. A fails twice instead:
    t.playRound({ a: { decode: false, intercept: false }, b: clean })
    t.sendClues()
    expect(t.state.order).toEqual(['a', 'b'])
    t.playTx(false, false) // a: second static, but B still gets to transmit
    expect(t.state.phase).toBe('transmit')
    expect(t.state.order[t.state.active]).toBe('b')
    t.playTx(true, false)
    expect(t.state.phase).toBe('over')
  })

  it('both conditions in one round: net tokens decide', () => {
    const t = new Table()
    t.playRound({ a: clean, b: clean })
    // round 2: A intercepts B and B intercepts A
    t.playRound({ a: { decode: true, intercept: true }, b: { decode: true, intercept: true } })
    // round 3: same again, plus B miscommunicates → A: 2 taps, B: 2 taps + 1 static
    t.playRound({ a: { decode: true, intercept: true }, b: { decode: false, intercept: true } })
    expect(t.state.phase).toBe('over')
    expect(t.state.outcome!.winner).toBe('a')
    expect(t.state.outcome!.reason).toMatch(/tokens/)
  })

  it('max rounds with a dead tie goes to the keyword tiebreak', () => {
    const t = new Table([2, 2], { maxRounds: 3 })
    for (let i = 0; i < 3; i++) t.playRound({ a: clean, b: clean })
    expect(t.state.phase).toBe('tiebreak')
    const aWords = t.team('a').keywords
    const bWords = t.team('b').keywords
    // B's encryptor can't see A's words; A's guess list names 2 of B's words.
    expect(t.json('b1')).not.toContain(aWords[0]!)
    t.act('a1', 'tiebreak:set', { words: [bWords[0]!.toLowerCase(), bWords[1], 'nope', ''] })
    expect(t.json('b1')).not.toContain('nope')
    t.act('a2', 'tiebreak:lock', { words: [bWords[0]!.toLowerCase(), bWords[1], 'nope', ''] })
    expect(t.state.phase).toBe('tiebreak')
    expect(t.act('a1', 'tiebreak:lock', { words: ['', '', '', ''] }).error).toMatch(/already/)
    t.act('b2', 'tiebreak:lock', { words: [aWords[0], '', '', ''] })
    expect(t.state.phase).toBe('over')
    expect(t.state.outcome!.winner).toBe('a')
    expect(t.state.outcome!.tiebreak!.find((x) => x.teamId === 'a')!.correct).toEqual([true, true, false, false])
    expect(overheard.scores(t.state).a).toBeGreaterThan(overheard.scores(t.state).b!)
  })

  it('tiebreak timeout with equal answers is a draw with equal scores', () => {
    const t = new Table([2, 2], { maxRounds: 3 })
    for (let i = 0; i < 3; i++) t.playRound({ a: clean, b: clean })
    t.expire()
    expect(t.state.phase).toBe('over')
    expect(t.state.outcome!.winner).toBeNull()
    const sc = overheard.scores(t.state)
    expect(sc.a).toBe(sc.b)
  })

  it('rotates the encryptor through each team', () => {
    const t = new Table([3, 2])
    const seenA: string[] = []
    const seenB: string[] = []
    for (let i = 0; i < 4; i++) {
      seenA.push(t.enc('a'))
      seenB.push(t.enc('b'))
      t.playRound({ a: clean, b: clean })
    }
    expect(seenA).toEqual(['a1', 'a2', 'a3', 'a1'])
    expect(seenB).toEqual(['b1', 'b2', 'b1', 'b2'])
  })
})

// ------------------------------------------------------------- hidden information

describe('hidden information', () => {
  it('keywords, code, drafts and clues never leak early', () => {
    const t = new Table()
    const aWords = t.team('a').keywords
    const bWords = t.team('b').keywords
    const encA = t.enc('a')
    const others = ['a1', 'a2', 'b1', 'b2'].filter((p) => p !== encA)

    // keywords: own team only
    for (const w of aWords) {
      expect(t.json('b1')).not.toContain(w)
      expect(t.json('b2')).not.toContain(w)
      expect(t.json('stranger')).not.toContain(w)
    }
    for (const w of bWords) expect(t.json('a1')).not.toContain(w)
    expect(t.view('a2').myKeywords).toEqual(aWords)
    expect(t.view('stranger').myKeywords).toBeNull()

    // code: only the encryptor
    expect(t.view(encA).myCode).toEqual(t.code('a'))
    for (const p of others) expect(t.view(p).myCode === null || p === t.enc('b')).toBe(true)
    expect(t.view(t.enc('b')).myCode).toEqual(t.code('b'))
    expect(t.view(t.enc('b')).myCode).not.toEqual(t.code('a'))
    expect(t.json('stranger')).not.toMatch(/"code"/)

    // drafts: only the encryptor
    t.act(encA, 'clue:draft', { clues: ['qqsecretdraft', '', ''] })
    expect(t.view(encA).myClueDraft).toEqual(['qqsecretdraft', '', ''])
    for (const p of others) expect(t.json(p)).not.toContain('qqsecretdraft')

    // sent clues: hidden until read aloud, one at a time
    t.act(encA, 'clue:submit', { clues: ['qqone', 'qqtwo', 'qqthree'] })
    for (const p of others) expect(t.json(p)).not.toContain('qqone')
    t.act(t.enc('b'), 'clue:submit', { clues: ['rrone', 'rrtwo', 'rrthree'] })
    expect(t.state.phase).toBe('transmit')
    expect(t.json('b1')).not.toContain('qqone')
    t.act(encA, 'clue:reveal', { index: 0 })
    expect(t.json('b1')).toContain('qqone')
    expect(t.json('b1')).not.toContain('qqtwo')
    // B's clues stay hidden during A's transmission (except to B's encryptor)
    const nonEncB = ['a1', 'a2', 'b1', 'b2'].filter((p) => p !== t.enc('b'))
    for (const p of nonEncB) expect(t.json(p)).not.toContain('rrone')
    t.act(encA, 'clue:reveal', { index: 1 })
    t.act(encA, 'clue:reveal', { index: 2 })
    expect(t.state.phase).toBe('guess')
    // the decoders' draft guess is team-only
    const decA = ['a1', 'a2'].find((p) => p !== encA)!
    t.act(decA, 'guess:set', { slots: [4, null, 2] })
    expect(t.view(decA).transmission!.myGuess!.slots).toEqual([4, null, 2])
    expect(t.view('b1').transmission!.myGuess).toBeNull() // round 1: B has no guess
    expect(t.json('b1')).not.toContain('[4,null,2]')
    // the code is still secret during guessing
    expect(t.view(decA).myCode).toBeNull()
    expect(t.view('b1').reveal).toBeNull()
  })

  it("interceptors' guess is hidden from the transmitting team", () => {
    const t = new Table()
    t.playRound({ a: clean, b: clean })
    t.sendClues() // round 2: b first
    t.readAloud()
    t.act('a1', 'guess:set', { slots: [3, 2, 1] })
    t.act('a2', 'guess:set', { slots: [3, 2, 4] })
    expect(t.view('a1').transmission!.myGuess!.slots).toEqual([3, 2, 4]) // shared team draft
    expect(t.view('a1').transmission!.role).toBe('interceptor')
    expect(t.json('b1')).not.toContain('[3,2,4]')
    expect(t.json('b2')).not.toContain('[3,2,4]')
  })

  it('a gone player is treated as a spectator', () => {
    const t = new Table([3, 2])
    t.gone('a3')
    expect(t.view('a3').myKeywords).toBeNull()
    expect(t.act('a3', 'note:set', { index: 0, text: 'x' }).error).toBeTruthy()
  })
})

// ------------------------------------------------------------- edge cases

describe('rules enforcement', () => {
  it('rejects bad clues and lets the encryptor retry', () => {
    const t = new Table()
    const encA = t.enc('a')
    const kw = t.team('a').keywords[0]!
    expect(t.act(encA, 'clue:submit', { clues: [kw, 'x', 'y'] }).error).toMatch(/gives away/)
    expect(t.act(encA, 'clue:submit', { clues: ['same', 'Same', 'y'] }).error).toMatch(/already used/)
    expect(t.act(encA, 'clue:submit', { clues: ['a', 'b'] }).error).toMatch(/three/)
    expect(t.act(encA, 'clue:submit', { clues: ['a', '   ', 'c'] }).error).toMatch(/at least/)
    expect(t.act('b1' === t.enc('b') ? 'b2' : 'b1', 'clue:submit', { clues: ['a', 'b', 'c'] }).error).toMatch(/not the encryptor/)
    expect(t.act(encA, 'clue:submit', { clues: ['a', 'b', 'c'] }).error).toBeUndefined()
    expect(t.act(encA, 'clue:submit', { clues: ['d', 'e', 'f'] }).error).toMatch(/already sent/)
  })

  it('a clue cannot be reused in a later round', () => {
    const t = new Table()
    t.playRound({ a: clean, b: clean })
    const encA = t.enc('a')
    expect(t.act(encA, 'clue:submit', { clues: ['zxa1one', 'q', 'r'] }).error).toMatch(/already used/)
  })

  it('first encryptor done flips the sand timer for the other', () => {
    const t = new Table()
    const before = overheard.deadline(t.state)!
    t.advance(10_000)
    t.act(t.enc('a'), 'clue:submit', { clues: ['a', 'b', 'c'] })
    expect(overheard.deadline(t.state)).toBe(t.now + TIMING.sandTimerMs)
    expect(overheard.deadline(t.state)).toBeLessThan(before)
  })

  it('at the clue deadline, drafts become clues and blanks become silence', () => {
    const t = new Table()
    const kw = t.team('a').keywords[1]!
    t.act(t.enc('a'), 'clue:draft', { clues: ['typed', kw, ''] })
    t.expire()
    expect(t.state.phase).toBe('transmit')
    expect(t.state.tx.a!.clues).toEqual(['typed', '🤐', '🤐'])
    expect(t.state.tx.b!.clues).toEqual(['🤐', '🤐', '🤐'])
  })

  it('stale drafts and actions from a previous turn are rejected', () => {
    const t = new Table()
    const old = t.state.turn
    const encA = t.enc('a')
    t.sendClues()
    expect(t.state.turn).not.toBe(old)
    const step = overheard.action(t.state, encA, { type: 'clue:draft', payload: { turn: old, clues: ['late', '', ''] } }, t.ctx())
    expect(step.error).toBeUndefined()
    expect(step.state).toBe(t.state)
    const lock = overheard.action(t.state, 'a1', { type: 'guess:lock', payload: { turn: old, slots: [1, 2, 3] } }, t.ctx())
    expect(lock.error).toMatch(/Too late/)
  })

  it('double tapping reveal only reveals one clue', () => {
    const t = new Table()
    t.sendClues()
    const encA = t.enc('a')
    t.act(encA, 'clue:reveal', { index: 0 })
    t.act(encA, 'clue:reveal', { index: 0 })
    expect(t.state.tx.a!.revealed).toBe(1)
    expect(t.act('a1' === encA ? 'a2' : 'a1', 'clue:reveal', { index: 1 }).error).toMatch(/not your mic/)
  })

  it('transmit timer auto-reveals the clues', () => {
    const t = new Table()
    t.sendClues()
    t.advance(TIMING.transmitMs)
    expect(t.state.phase).toBe('guess')
    expect(t.view('b1').transmission!.clues).toHaveLength(3)
  })

  it('the encryptor cannot guess; rivals cannot guess in round 1; lock needs 3 distinct digits', () => {
    const t = new Table()
    t.sendClues()
    t.readAloud()
    const encA = t.enc('a')
    expect(t.act(encA, 'guess:set', { slots: [1, 2, 3] }).error).toMatch(/you know the code/)
    expect(t.act('b1', 'guess:set', { slots: [1, 2, 3] }).error).toMatch(/Interception opens next round/)
    expect(t.view('b1').transmission!.role).toBe('listener')
    const dec = encA === 'a1' ? 'a2' : 'a1'
    expect(t.act(dec, 'guess:lock', { slots: [1, 1, 2] }).error).toMatch(/different/)
    expect(t.act(dec, 'guess:set', { slots: [5, null, null] }).error).toBeTruthy()
    expect(t.act(dec, 'guess:set', { slots: 'x' }).error).toBeTruthy()
  })

  it('chaos mode opens interception in round 1', () => {
    const t = new Table([2, 2], { interceptRound1: true })
    t.sendClues()
    t.readAloud()
    expect(t.view('b1').transmission!.role).toBe('interceptor')
    t.lock('b', t.code('a'))
    t.lock('a', t.code('a'))
    expect(t.team('b').wiretaps).toBe(1)
  })

  it('guess deadline uses a complete unlocked draft, and an incomplete one counts as a miss', () => {
    const t = new Table()
    t.sendClues()
    t.readAloud()
    const dec = t.enc('a') === 'a1' ? 'a2' : 'a1'
    t.act(dec, 'guess:set', { slots: t.code('a') })
    t.expire()
    expect(t.team('a').history[0]!.decoded).toBe(true)
    t.expire() // reveal → b transmits
    t.readAloud()
    const decB = t.enc('b') === 'b1' ? 'b2' : 'b1'
    t.act(decB, 'guess:set', { slots: [t.code('b')[0], null, null] })
    t.expire()
    expect(t.team('b').history[0]!.decoded).toBe(false)
    expect(t.team('b').static).toBe(1)
  })

  it('an action landing just after the timer fired is rejected as stale', () => {
    const t = new Table()
    t.sendClues()
    t.readAloud()
    const turn = t.state.turn
    t.expire() // the guess timer fires first
    const dec = t.enc('a') === 'a1' ? 'a2' : 'a1'
    const late = overheard.action(t.state, dec, { type: 'guess:lock', payload: { turn, slots: [1, 2, 3] } }, t.ctx())
    expect(late.error).toBeTruthy()
  })

  it('locking twice is rejected', () => {
    const t = new Table([3, 2])
    t.sendClues()
    t.readAloud()
    const decs = ['a1', 'a2', 'a3'].filter((p) => p !== t.enc('a'))
    t.act(decs[0]!, 'guess:lock', { slots: [1, 2, 3] })
    expect(t.state.phase).toBe('reveal') // round 1: only A guesses → resolves at once
    const t2 = new Table([3, 3])
    t2.playRound({ a: clean, b: clean })
    t2.sendClues()
    t2.readAloud() // b transmits, a intercepts
    t2.act('a1', 'guess:lock', { slots: [1, 2, 3] })
    expect(t2.act('a2', 'guess:lock', { slots: [2, 3, 4] }).error).toMatch(/already locked/)
    expect(t2.view('b1').transmission!.locked.a).toBe(true)
  })

  it('only the host can skip the reveal', () => {
    const t = new Table()
    t.sendClues()
    t.playTx(true, false)
    expect(t.state.phase).toBe('transmit') // playTx expired the reveal
    t.readAloud()
    const dec = t.enc('b') === 'b1' ? 'b2' : 'b1'
    t.act(dec, 'guess:lock', { slots: t.code('b') })
    expect(t.state.phase).toBe('reveal')
    expect(t.act('b1', 'reveal:next').error).toMatch(/host/)
    t.act('a1', 'reveal:next')
    expect(t.state.phase).toBe('encrypt')
    expect(t.state.round).toBe(2)
  })

  it('notes are shared with the team and private from the rival', () => {
    const t = new Table()
    t.act('a1', 'note:set', { index: 2, text: '  probably   cricket ' })
    expect(t.view('a2').notes).toEqual(['', '', 'probably cricket', ''])
    expect(t.json('b1')).not.toContain('probably cricket')
    expect(t.act('a1', 'note:set', { index: 7, text: 'x' }).error).toBeTruthy()
  })

  it('players unknown to the game are ignored', () => {
    const t = new Table()
    expect(t.act('latecomer', 'guess:lock', { slots: [1, 2, 3] }).error).toMatch(/watching/)
    const v = t.view('latecomer')
    expect(v.myTeamId).toBeNull()
    expect(v.notes).toBeNull()
  })

  it('unknown action types are rejected', () => {
    const t = new Table()
    expect(t.act('a1', 'hack').error).toBeTruthy()
  })
})

describe('disconnects', () => {
  it('encryptor gone while writing: next teammate inherits the code with fresh time', () => {
    const t = new Table([3, 2])
    const code = t.code('a')
    t.advance(100_000) // 20s left on the clock
    t.gone('a1')
    expect(t.enc('a')).toBe('a2')
    expect(t.view('a2').myCode).toEqual(code)
    expect(overheard.deadline(t.state)).toBeGreaterThanOrEqual(t.now + TIMING.replacementMs)
    // the rotation continues after the replacement
    t.sendClues()
    t.playTx(true, false)
    t.playTx(true, false)
    expect(t.enc('a')).toBe('a3')
  })

  it('encryptor gone mid-transmission: clues auto-reveal', () => {
    const t = new Table([3, 2])
    t.sendClues()
    t.act('a1', 'clue:reveal', { index: 0 })
    t.gone('a1')
    expect(t.state.phase).toBe('guess')
    expect(t.view('b1').transmission!.clues).toHaveLength(3)
  })

  it('a disconnected encryptor at transmit time does not stall the game', () => {
    const t = new Table([3, 2])
    t.sendClues()
    t.playTx(true, false)
    t.players = t.players.map((p) => (p.id === t.enc('b') ? { ...p, connected: false } : p))
    t.state = overheard.tick({ ...t.state, deadline: t.now }, t.ctx()).state
    expect(t.state.phase).toBe('guess')
  })

  it('the next encryptor skips disconnected players', () => {
    const t = new Table([3, 2])
    t.players = t.players.map((p) => (p.id === 'a2' ? { ...p, connected: false } : p))
    t.playRound({ a: clean, b: clean })
    expect(t.enc('a')).toBe('a3')
  })

  it('last decoder gone while guessing resolves without a miscommunication', () => {
    const t = new Table([2, 2])
    t.sendClues()
    t.readAloud()
    t.gone(t.enc('a') === 'a1' ? 'a2' : 'a1')
    expect(t.state.phase).toBe('reveal')
    expect(t.team('a').history[0]!.decoded).toBeNull()
    expect(t.team('a').static).toBe(0)
  })

  it('a whole team leaving forfeits', () => {
    const t = new Table([2, 2])
    t.gone('b1')
    expect(t.state.phase).not.toBe('over')
    t.gone('b2')
    expect(t.state.phase).toBe('over')
    expect(t.state.outcome!.winner).toBe('a')
    expect(overheard.deadline(t.state)).toBeNull()
  })

  it('a team of one keeps playing: they encrypt, nobody decodes, rivals still intercept', () => {
    const t = new Table([2, 2])
    t.gone('a2')
    for (let r = 0; r < 3 && t.state.phase !== 'over'; r++) {
      expect(t.enc('a')).toBe('a1')
      t.playRound({ a: { decode: true, intercept: false }, b: clean })
    }
    expect(t.team('a').static).toBe(0)
    expect(t.team('a').history.every((h) => h.decoded === null)).toBe(true)
  })

  it('gone during tiebreak resolves when the remaining team locks', () => {
    const t = new Table([2, 2], { maxRounds: 3 })
    for (let i = 0; i < 3; i++) t.playRound({ a: clean, b: clean })
    t.act('a1', 'tiebreak:lock', { words: ['', '', '', ''] })
    t.gone('b1')
    expect(t.state.phase).toBe('tiebreak')
    t.act('b2', 'tiebreak:lock', { words: ['', '', '', ''] })
    expect(t.state.phase).toBe('over')
  })

  it('gone for unknown or repeated ids is a no-op', () => {
    const t = new Table()
    const s = t.state
    expect(overheard.onPlayerGone(s, 'nobody', t.ctx()).state).toBe(s)
    t.gone('a1')
    const s2 = t.state
    expect(overheard.onPlayerGone(s2, 'a1', t.ctx()).state).toBe(s2)
  })
})

describe('purity', () => {
  it('does not mutate the previous state', () => {
    const t = new Table()
    const snapshot = JSON.stringify(t.state)
    const prev = t.state
    t.sendClues()
    t.readAloud()
    expect(JSON.stringify(prev)).toBe(snapshot)
  })
})
