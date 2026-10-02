import { describe, expect, it } from 'vitest'
import type { BaseCtx, CreateCtx, GamePlayer, GameTeam, Step } from '../types.ts'
import { friendCourt } from './index.ts'
import * as E from './engine.ts'
import { CASES, EVIDENCE, GUILTY_SENTENCES, ACQUITTAL_LINES, OBJECTION_REASONS } from './content.ts'
import type { FriendCourtView } from './shared.ts'

// ---------------------------------------------------------------- harness

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

const NAMES = ['Ravi', 'Priya', 'Arjun', 'Meera', 'Kabir', 'Zoya', 'Dev', 'Isha', 'Rohan', 'Tara', 'Neel', 'Anya', 'Vikram', 'Sana', 'Om', 'Lata']
const COLORS = ['tomato', 'sky', 'lime', 'grape'] as const

class Table {
  now = 1_000_000
  random = rng(42)
  players: GamePlayer[]
  teams: GameTeam[]
  hostId: string
  state: E.State
  events: { type: string; data?: Record<string, unknown> }[] = []

  constructor(sizes: number[], settings: Record<string, unknown> = {}, seed = 42) {
    this.random = rng(seed)
    let n = 0
    this.teams = sizes.map((size, ti) => {
      const ids = Array.from({ length: size }, () => `p${n++}`)
      return { id: `t${ti}`, name: `Team ${ti}`, color: COLORS[ti]!, playerIds: ids }
    })
    this.players = this.teams.flatMap((t) => t.playerIds.map((id) => ({
      id, name: NAMES[Number(id.slice(1))]!, avatar: '🙂', teamId: t.id, connected: true,
    })))
    this.hostId = 'p0'
    const ctx: CreateCtx<E.Settings> = { ...this.ctx(), settings: friendCourt.parseSettings(settings) }
    this.state = friendCourt.create(ctx)
  }

  ctx(): BaseCtx {
    return { now: this.now, random: this.random, players: this.players, teams: this.teams, hostId: this.hostId }
  }

  view(id: string): FriendCourtView {
    return friendCourt.view(this.state, id, this.ctx()) as FriendCourtView
  }

  apply(step: Step<E.State>): Step<E.State> {
    if (!step.error) {
      this.state = step.state
      this.events.push(...(step.events ?? []))
    }
    return step
  }

  act(id: string, type: string, payload: Record<string, unknown> = {}): Step<E.State> {
    return this.apply(friendCourt.action(this.state, id, { type, payload: { seq: this.state.seq, ...payload } }, this.ctx()))
  }

  /** Jump the clock to the current deadline and tick (like the platform does). */
  expire(): void {
    const d = friendCourt.deadline(this.state)
    if (d === null) throw new Error('no deadline')
    this.now = Math.max(this.now, d)
    this.apply(friendCourt.tick(this.state, this.ctx()))
  }

  disconnect(id: string): void {
    this.players = this.players.map((p) => (p.id === id ? { ...p, connected: false } : p))
    this.apply(friendCourt.onPlayerGone(this.state, id, this.ctx()))
  }

  get c() { return this.state.cur! }
  speaker(): string { return this.c.speeches[this.c.speechIdx]!.speakerId! }
  judge(): string | null { return this.c.judgeId }
  sideIds(side: 'prosecution' | 'defence'): string[] {
    return this.players.filter((p) => p.teamId === this.c.teams[side] && p.id !== this.c.judgeId && p.connected).map((p) => p.id)
  }
}

/** Drive one whole case with lots of interaction. */
function playCase(t: Table, opts: { guilty: boolean }): void {
  const judge = t.judge()
  if (judge) expect(t.act(judge, 'begin').error).toBeUndefined()
  else t.expire()
  expect(t.state.phase).toBe('speech')
  for (let i = 0; i < 4 && t.state.phase === 'speech'; i++) {
    const sp = t.speaker()
    const v = t.view(sp)
    expect(v.you.canPlay).toBe(true)
    expect(t.act(sp, 'play', { uid: v.you.hand[0]!.uid }).error).toBeUndefined()
    const mySide = v.you.side!
    const mate = t.sideIds(mySide).find((id) => id !== sp)
    if (mate && t.view(mate).you.canPassNote) {
      expect(t.act(mate, 'note', { uid: t.view(mate).you.hand[0]!.uid }).error).toBeUndefined()
      const note = t.view(sp).you.hand.find((k) => k.fromId === mate)
      expect(note).toBeDefined()
      expect(t.act(sp, 'play', { uid: note!.uid }).error).toBeUndefined()
    }
    const opp = t.sideIds(mySide === 'prosecution' ? 'defence' : 'prosecution')[0]!
    if (judge && t.view(opp).you.canObject) {
      expect(t.act(opp, 'object').error).toBeUndefined()
      expect(t.act(judge, 'rule', { sustained: i % 2 === 0 }).error).toBeUndefined()
    }
    expect(t.act(sp, 'rest').error).toBeUndefined()
  }
  expect(t.state.phase).toBe('deliberation')
  if (t.c.verdictBy === 'jury') {
    for (const j of t.c.juryIds) t.act(j, 'verdict', { guilty: opts.guilty })
  } else if (judge) {
    expect(t.act(judge, 'verdict', { guilty: opts.guilty, sentence: 1 }).error).toBeUndefined()
  }
  for (const p of t.players) {
    const v = t.view(p.id)
    if (v.you.mustVote === 'respect') expect(t.act(p.id, 'respect', { playerId: v.you.respectTargets![0] }).error).toBeUndefined()
  }
  expect(t.state.phase).toBe('verdict')
  t.expire()
}

// ---------------------------------------------------------------- tests

describe('content', () => {
  it('has plenty of unique, well-formed content', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(60)
    expect(EVIDENCE.length).toBeGreaterThanOrEqual(150)
    expect(GUILTY_SENTENCES.length).toBeGreaterThanOrEqual(40)
    expect(ACQUITTAL_LINES.length).toBeGreaterThanOrEqual(25)
    expect(OBJECTION_REASONS.length).toBeGreaterThanOrEqual(25)
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length)
    expect(new Set(EVIDENCE.map((c) => c.id)).size).toBe(EVIDENCE.length)
    const all = [...CASES.flatMap((c) => [c.title, c.charge]), ...EVIDENCE.map((e) => e.text), ...GUILTY_SENTENCES, ...ACQUITTAL_LINES]
    for (const s of all) expect(s.replaceAll('{A}', '').replaceAll('{V}', '')).not.toMatch(/[{}]/)
    for (const s of GUILTY_SENTENCES) expect(s).toContain('{A}')
  })
})

describe('settings', () => {
  it('coerces junk to defaults', () => {
    expect(E.parseSettings({})).toEqual({ cases: '4', pace: 'normal', hostJudge: false })
    expect(E.parseSettings({ cases: '6', pace: 'epic', hostJudge: true })).toEqual({ cases: '6', pace: 'epic', hostJudge: true })
    expect(E.parseSettings({ cases: 99, pace: 'warp', hostJudge: 'yes' })).toEqual({ cases: '4', pace: 'normal', hostJudge: false })
  })
})

describe('full game, 2 teams of 3', () => {
  it('plays 4 cases end to end with consistent scoring', () => {
    const t = new Table([3, 3])
    const sidesSeen: string[] = []
    const judges: string[] = []
    for (let k = 0; k < 4; k++) {
      expect(t.state.phase).toBe('reveal')
      expect(t.c.no).toBe(k + 1)
      sidesSeen.push(t.c.teams.prosecution)
      judges.push(t.judge()!)
      // The judge sits the case out and never belongs to the speaking roster.
      expect(t.c.speeches.every((s) => s.speakerId !== t.judge())).toBe(true)
      // The accused gives the defence's last words.
      expect(t.c.speeches[3]!.speakerId).toBe(t.c.accusedId)
      playCase(t, { guilty: k % 2 === 0 })
    }
    expect(friendCourt.isOver(t.state)).toBe(true)
    expect(friendCourt.deadline(t.state)).toBeNull()
    // Sides swap every case.
    expect(sidesSeen).toEqual(['t0', 't1', 't0', 't1'])
    // The gavel alternates teams: two judges from each team.
    const judgeTeams = judges.map((j) => t.players.find((p) => p.id === j)!.teamId)
    expect(judgeTeams.filter((x) => x === 't0')).toHaveLength(2)
    expect(new Set(judges).size).toBe(4)
    // Scores = sum of everything that happened; every case has a winner worth 3.
    const total = Object.values(friendCourt.scores(t.state)).reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThanOrEqual(4 * E.WIN_POINTS)
    expect(t.state.history.map((h) => h.guilty)).toEqual([true, false, true, false])
    const res = friendCourt.results(t.state, t.ctx())
    expect(res.highlights.length).toBe(4)
    expect(res.highlights[0]).toMatch(/GUILTY/)
    expect(res.awards!.length).toBeGreaterThan(0)
    // Everyone spoke at least once across the game.
    for (const p of t.players) expect(t.state.stats[p.id]!.speeches + t.state.stats[p.id]!.judged).toBeGreaterThan(0)
  })

  it('every case ends by timers alone if nobody touches anything', () => {
    const t = new Table([2, 2], { cases: 2, pace: 'snappy' })
    let guard = 0
    while (!friendCourt.isOver(t.state) && guard++ < 50) t.expire()
    expect(friendCourt.isOver(t.state)).toBe(true)
    expect(t.state.history).toHaveLength(2)
    // Auto verdict with no evidence played: benefit of the doubt.
    expect(t.state.history.every((h) => !h.guilty)).toBe(true)
  })

  it('never repeats a case in one game', () => {
    const t = new Table([2, 2], { cases: 6 })
    let guard = 0
    while (!friendCourt.isOver(t.state) && guard++ < 100) t.expire()
    expect(new Set(t.state.usedCases).size).toBe(6)
  })

  it('does not mutate the previous state', () => {
    const t = new Table([2, 2])
    const frozen = JSON.stringify(t.state)
    const before = t.state
    friendCourt.action(before, t.judge()!, { type: 'begin', payload: { seq: before.seq } }, t.ctx())
    friendCourt.tick(before, { ...t.ctx(), now: t.now + 10 ** 7 })
    friendCourt.onPlayerGone(before, 'p1', t.ctx())
    expect(JSON.stringify(before)).toBe(frozen)
  })
})

describe('hidden information', () => {
  it("keeps every hand, the judge's sentence options and ballots private", () => {
    const t = new Table([3, 3])
    const judge = t.judge()!
    t.act(judge, 'begin')
    for (const p of t.players) {
      const own = t.state.hands[p.id]!
      for (const other of t.players) {
        if (other.id === p.id) continue
        const json = JSON.stringify(t.view(other.id))
        for (const k of own) expect(json).not.toContain(`"${k.uid}"`)
      }
    }
    // Card text of a hand never appears in a non-owner view (checks rendered text, not ids).
    const sp = t.speaker()
    const spCards = t.view(sp).you.hand.map((k) => k.text)
    const outsider = t.players.find((p) => p.id !== sp && p.id !== judge)!.id
    const outsiderHand = new Set(t.view(outsider).you.hand.map((k) => k.text))
    const outsiderJson = JSON.stringify(t.view(outsider))
    for (const text of spCards) if (!outsiderHand.has(text)) expect(outsiderJson).not.toContain(text)

    // Once played it is public.
    const card = t.view(sp).you.hand[0]!
    t.act(sp, 'play', { uid: card.uid })
    expect(JSON.stringify(t.view(outsider))).toContain(card.text)

    // Go to deliberation.
    while (t.state.phase === 'speech') t.act(t.speaker(), 'rest')
    expect(t.state.phase).toBe('deliberation')
    expect(t.view(judge).you.sentenceOptions).toBeDefined()
    for (const p of t.players) if (p.id !== judge) expect(t.view(p.id).you.sentenceOptions).toBeUndefined()
    const options = t.view(judge).you.sentenceOptions!
    for (const p of t.players) {
      if (p.id === judge) continue
      const json = JSON.stringify(t.view(p.id))
      for (const line of [...options.guilty, ...options.notGuilty]) expect(json).not.toContain(line)
    }
    // A respect vote is secret until the verdict.
    const voter = t.players.find((p) => t.view(p.id).you.mustVote === 'respect')!.id
    const target = t.view(voter).you.respectTargets![0]!
    t.act(voter, 'respect', { playerId: target })
    for (const p of t.players) {
      if (p.id === voter) continue
      expect(JSON.stringify(t.view(p.id).you.myBallot)).not.toContain(target)
    }
  })

  it('a passed note is visible only to the speaker and only its own side learns who passed it', () => {
    const t = new Table([3, 3])
    t.act(t.judge()!, 'begin')
    const sp = t.speaker()
    const side = t.view(sp).you.side!
    const mate = t.sideIds(side).find((id) => id !== sp)!
    const card = t.view(mate).you.hand[0]!
    t.act(mate, 'note', { uid: card.uid })
    const noteEvent = t.events.find((e) => e.type === 'note')!
    expect((noteEvent as { to?: unknown }).to).toEqual({ teamId: t.c.teams[side] })
    expect(t.view(sp).you.hand.some((k) => k.uid === card.uid && k.fromId === mate)).toBe(true)
    t.act(sp, 'play', { uid: card.uid })
    const opp = t.sideIds(side === 'prosecution' ? 'defence' : 'prosecution')[0]!
    expect(t.view(opp).record[0]!.viaNoteFromId).toBeUndefined()
    expect(t.view(mate).record[0]!.viaNoteFromId).toBe(mate)
  })

  it('an unused note becomes a plain card in the next case', () => {
    const t = new Table([3, 3])
    t.act(t.judge()!, 'begin')
    const sp = t.speaker()
    const mate = t.sideIds(t.view(sp).you.side!).find((id) => id !== sp)!
    const card = t.view(mate).you.hand[0]!
    t.act(mate, 'note', { uid: card.uid })
    while (t.state.caseIdx === 0) t.expire()
    const k = t.view(sp).you.hand.find((x) => x.uid === card.uid)!
    expect(k).toBeDefined()
    expect(k.fromId).toBeUndefined()
  })
})

describe('rules enforcement', () => {
  it('rejects stale actions from a previous phase', () => {
    const t = new Table([2, 2])
    const staleSeq = t.state.seq
    t.act(t.judge()!, 'begin')
    const sp = t.speaker()
    const r = friendCourt.action(t.state, sp, { type: 'rest', payload: { seq: staleSeq } }, t.ctx())
    expect(r.error).toMatch(/moved on/)
  })

  it('an action racing the timer loses cleanly', () => {
    const t = new Table([2, 2])
    t.act(t.judge()!, 'begin')
    const sp = t.speaker()
    const seq = t.state.seq
    t.expire() // speech timed out first
    const r = friendCourt.action(t.state, sp, { type: 'rest', payload: { seq } }, t.ctx())
    expect(r.error).toBeDefined()
    expect(t.c.speechIdx).toBe(1)
  })

  it('double taps do not double count', () => {
    const t = new Table([2, 2])
    t.act(t.judge()!, 'begin')
    const sp = t.speaker()
    const uid = t.view(sp).you.hand[0]!.uid
    expect(t.act(sp, 'play', { uid }).error).toBeUndefined()
    expect(t.act(sp, 'play', { uid }).error).toMatch(/isn't in your hand/)
    expect(t.c.record).toHaveLength(1)
    while (t.state.phase === 'speech') t.act(t.speaker(), 'rest')
    const j = t.judge()!
    expect(t.act(j, 'verdict', { guilty: true }).error).toBeUndefined()
    // Possibly the case already finished; either way a second ballot is refused.
    expect(t.act(j, 'verdict', { guilty: false }).error).toBeDefined()
  })

  it('caps exhibits per speech and only lets the floor holder present', () => {
    const t = new Table([2, 2])
    t.act(t.judge()!, 'begin')
    const sp = t.speaker()
    const notSp = t.players.find((p) => p.id !== sp)!.id
    expect(t.act(notSp, 'play', { uid: t.view(notSp).you.hand[0]!.uid }).error).toMatch(/floor/)
    t.act(sp, 'play', { uid: t.view(sp).you.hand[0]!.uid })
    t.act(sp, 'play', { uid: t.view(sp).you.hand[0]!.uid })
    expect(t.view(sp).you.canPlay).toBe(false)
    expect(t.act(sp, 'play', { uid: t.view(sp).you.hand[0]!.uid }).error).toMatch(/Max/)
  })

  it('objections: only the other side, limited per case, judge rules, time freezes', () => {
    const t = new Table([3, 3])
    const judge = t.judge()!
    t.act(judge, 'begin')
    const sp = t.speaker()
    const side = t.view(sp).you.side!
    const mate = t.sideIds(side).find((id) => id !== sp)!
    const opp = t.sideIds(side === 'prosecution' ? 'defence' : 'prosecution')
    expect(t.act(mate, 'object').error).toMatch(/other side/)
    expect(t.act(judge, 'object').error).toBeDefined()
    t.act(sp, 'play', { uid: t.view(sp).you.hand[0]!.uid })
    const scoreBefore = { ...t.state.scores }
    t.now += 10_000
    const remaining = t.state.phaseEndsAt! - t.now
    expect(t.act(opp[0]!, 'object').error).toBeUndefined()
    expect(t.view(sp).speechRemainingMs).toBe(remaining)
    expect(t.view(sp).you.canPlay).toBe(false)
    expect(t.act(opp[1]!, 'object').error).toMatch(/already/)
    expect(t.act(opp[0]!, 'rule', { sustained: true }).error).toMatch(/judge/)
    t.now += 4000
    expect(t.act(judge, 'rule', { sustained: true }).error).toBeUndefined()
    // Sustained: objector +1, the speaker's exhibit is struck (-1).
    const oppTeam = t.c.teams[side === 'prosecution' ? 'defence' : 'prosecution']
    expect(t.state.scores[oppTeam]).toBe(scoreBefore[oppTeam]! + 1)
    expect(t.state.scores[t.c.teams[side]]).toBe(scoreBefore[t.c.teams[side]]! - 1)
    expect(t.c.record[0]!.struck).toBe(true)
    // Time resumed with what was left when the objection landed.
    expect(t.state.phaseEndsAt! - t.now).toBe(remaining)
    // Second objection then out.
    expect(t.act(opp[1]!, 'object').error).toBeUndefined()
    t.expire() // judge napping -> auto overruled
    expect(t.events.at(-1)).toMatchObject({ type: 'ruling', data: { sustained: false, auto: true } })
    expect(t.state.phase).toBe('speech')
    expect(t.state.phaseEndsAt! - t.now).toBeGreaterThanOrEqual(E.MIN_RESUME_MS)
    expect(t.act(opp[0]!, 'object').error).toMatch(/out of objections/)
  })

  it('respect only goes to the other side', () => {
    const t = new Table([2, 2])
    t.act(t.judge()!, 'begin')
    while (t.state.phase === 'speech') t.act(t.speaker(), 'rest')
    const voter = t.players.find((p) => t.view(p.id).you.mustVote === 'respect')!.id
    const mate = t.sideIds(t.view(voter).you.side!).find((id) => id !== voter)
    if (mate) expect(t.act(voter, 'respect', { playerId: mate }).error).toMatch(/OTHER/)
    expect(t.act(voter, 'respect', { playerId: voter }).error).toMatch(/OTHER/)
  })

  it('ignores players who joined after the game started', () => {
    const t = new Table([2, 2])
    t.players.push({ id: 'late', name: 'Late Larry', avatar: '🐢', teamId: 't0', connected: true })
    expect(t.act('late', 'begin').error).toMatch(/watching/)
    const v = t.view('late')
    expect(v.you.role).toBe('watcher')
    expect(v.you.hand).toEqual([])
  })

  it('rejects junk payloads without throwing', () => {
    const t = new Table([2, 2])
    t.act(t.judge()!, 'begin')
    const sp = t.speaker()
    expect(t.act(sp, 'play', { uid: { evil: true } }).error).toBeDefined()
    expect(t.act(sp, 'nonsense').error).toMatch(/Unknown/)
    expect(t.act(sp, 'react', { emoji: '<script>' }).error).toBeDefined()
    expect(t.act(sp, 'react', { emoji: '🍅' }).events?.[0]?.type).toBe('react')
    // Cooldown swallows spam silently.
    expect(t.act(sp, 'react', { emoji: '🍅' }).events).toBeUndefined()
  })
})

describe('team shapes', () => {
  it('3 teams: two argue, the third is a neutral jury with a neutral judge', () => {
    const t = new Table([2, 2, 2], { cases: 6 })
    const argued: Record<string, number> = { t0: 0, t1: 0, t2: 0 }
    for (let k = 0; k < 6; k++) {
      const c = t.c
      expect(c.verdictBy).toBe('jury')
      const judgeTeam = t.players.find((p) => p.id === c.judgeId)!.teamId
      expect([c.teams.prosecution, c.teams.defence]).not.toContain(judgeTeam)
      expect(c.juryIds).toContain(c.judgeId)
      argued[c.teams.prosecution]!++
      argued[c.teams.defence]!++
      // Jury split 1-1: the judge's ballot breaks the tie.
      const other = c.juryIds.find((id) => id !== c.judgeId)!
      t.act(c.judgeId!, 'begin')
      while (t.state.phase === 'speech') t.act(t.speaker(), 'rest')
      t.act(other, 'verdict', { guilty: false })
      t.act(c.judgeId!, 'verdict', { guilty: true, sentence: 2 })
      for (const p of t.players) {
        const v = t.view(p.id)
        if (v.you.mustVote === 'respect') t.act(p.id, 'respect', { playerId: v.you.respectTargets![0] })
      }
      expect(t.state.phase).toBe('verdict')
      expect(t.c.verdict).toMatchObject({ guilty: true, decidedBy: 'jury', tally: { guilty: 1, notGuilty: 1 } })
      t.expire()
    }
    expect(argued).toEqual({ t0: 4, t1: 4, t2: 4 })
  })

  it('uneven 1 vs 3: the judge comes from the big team and the solo player argues everything', () => {
    const t = new Table([1, 3])
    for (let k = 0; k < 4; k++) {
      expect(t.judge()).not.toBe('p0')
      expect(t.judge()).not.toBeNull()
      const soloSide = t.c.teams.prosecution === 't0' ? 'prosecution' : 'defence'
      const slots = t.c.speeches.filter((s) => (s.kind.startsWith('p') ? 'prosecution' : 'defence') === soloSide)
      expect(slots.every((s) => s.speakerId === 'p0')).toBe(true)
      while (!friendCourt.isOver(t.state) && t.state.caseIdx === k) t.expire()
    }
    expect(friendCourt.isOver(t.state)).toBe(true)
  })

  it('1 vs 1: no judge possible, so the host opens court, objections are off and the robot rules', () => {
    const t = new Table([1, 1])
    expect(t.judge()).toBeNull()
    expect(t.view('p1').you.canBegin).toBe(false)
    expect(t.view('p0').you.canBegin).toBe(true)
    t.act('p0', 'begin')
    const sp = t.speaker()
    const opp = sp === 'p0' ? 'p1' : 'p0'
    expect(t.view(opp).you.canObject).toBe(false)
    expect(t.act(opp, 'object').error).toMatch(/No judge/)
    t.act(sp, 'play', { uid: t.view(sp).you.hand[0]!.uid })
    while (t.state.phase === 'speech') t.act(t.speaker(), 'rest')
    // Everyone left to vote is a respect voter.
    for (const id of ['p0', 'p1']) t.act(id, 'respect', { playerId: id === 'p0' ? 'p1' : 'p0' })
    expect(t.c.verdict!.decidedBy).toBe('auto')
    // Prosecution presented one exhibit, defence none -> guilty.
    expect(t.c.verdict!.guilty).toBe(sp === t.c.speeches[0]!.speakerId)
  })

  it('2 teams of 8: roles rotate so speakers and accused differ across cases', () => {
    const t = new Table([8, 8], { cases: 6 })
    const accused = new Set<string>()
    const speakers = new Set<string>()
    for (let k = 0; k < 6; k++) {
      accused.add(t.c.accusedId)
      for (const s of t.c.speeches) speakers.add(s.speakerId!)
      // Four distinct speakers in a big game.
      expect(new Set(t.c.speeches.map((s) => s.speakerId)).size).toBe(4)
      while (t.state.caseIdx === k) t.expire()
    }
    expect(accused.size).toBe(6)
    expect(speakers.size).toBeGreaterThanOrEqual(14)
  })

  it('host-judge setting keeps the host on the bench', () => {
    const t = new Table([3, 3], { hostJudge: true })
    for (let k = 0; k < 4; k++) {
      expect(t.judge()).toBe('p0')
      while (t.state.caseIdx === k) t.expire()
    }
  })
})

describe('people leaving', () => {
  it('the accused flees before trial: a teammate stands accused instead', () => {
    const t = new Table([3, 3])
    const accused = t.c.accusedId
    t.disconnect(accused)
    expect(t.c.accusedId).not.toBe(accused)
    expect(t.events.some((e) => e.type === 'fled')).toBe(true)
    const v = t.view(t.c.accusedId)
    expect(v.case!.charge).toContain(t.players.find((p) => p.id === t.c.accusedId)!.name)
    expect(t.c.speeches[3]!.speakerId).toBe(t.c.accusedId)
  })

  it('the speaker drops mid-speech: a teammate takes the mic with the remaining time', () => {
    const t = new Table([3, 3])
    t.act(t.judge()!, 'begin')
    const sp = t.speaker()
    const endsAt = t.state.phaseEndsAt
    t.disconnect(sp)
    expect(t.speaker()).not.toBe(sp)
    expect(t.state.phase).toBe('speech')
    expect(t.state.phaseEndsAt).toBe(endsAt)
    expect(t.view(t.speaker()).you.canPlay).toBe(true)
  })

  it('a whole side vanishing skips its speeches and the game still finishes', () => {
    const t = new Table([2, 2])
    t.act(t.judge()!, 'begin')
    const sp = t.speaker()
    const side = t.view(sp).you.side!
    for (const id of t.sideIds(side)) t.disconnect(id)
    expect(t.state.phase === 'speech' || t.state.phase === 'deliberation').toBe(true)
    if (t.state.phase === 'speech') expect(t.view(t.speaker()).you.side).not.toBe(side)
    let guard = 0
    while (!friendCourt.isOver(t.state) && guard++ < 60) t.expire()
    expect(friendCourt.isOver(t.state)).toBe(true)
  })

  it('the judge leaves mid-objection: auto overruled, robot judge decides', () => {
    const t = new Table([2, 2])
    const judge = t.judge()!
    t.act(judge, 'begin')
    const sp = t.speaker()
    const side = t.view(sp).you.side!
    const opp = t.sideIds(side === 'prosecution' ? 'defence' : 'prosecution')[0]!
    t.act(opp, 'object')
    t.disconnect(judge)
    expect(t.c.objection).toBeNull()
    expect(t.c.judgeId).toBeNull()
    expect(t.view(opp).you.canObject).toBe(false)
    while (t.state.phase === 'speech') t.act(t.speaker(), 'rest')
    for (const p of t.players) {
      const v = t.view(p.id)
      if (v.you.mustVote === 'respect') t.act(p.id, 'respect', { playerId: v.you.respectTargets![0] })
    }
    expect(t.state.phase).toBe('verdict')
    expect(t.c.verdict!.decidedBy).toBe('auto')
  })

  it('deliberation does not wait for someone who left', () => {
    const t = new Table([2, 2])
    t.act(t.judge()!, 'begin')
    while (t.state.phase === 'speech') t.act(t.speaker(), 'rest')
    const waiting = t.view('p0').deliberation!.waitingIds
    const [last, ...rest] = waiting
    for (const id of rest) {
      const v = t.view(id)
      if (v.you.mustVote === 'verdict') t.act(id, 'verdict', { guilty: true })
      else t.act(id, 'respect', { playerId: v.you.respectTargets![0] })
    }
    expect(t.state.phase).toBe('deliberation')
    t.disconnect(last!)
    expect(t.state.phase).toBe('verdict')
  })

  it('a team that is fully gone at case start causes a mistrial, not a crash', () => {
    const t = new Table([1, 2])
    t.disconnect('p0')
    let guard = 0
    while (!friendCourt.isOver(t.state) && guard++ < 60) t.expire()
    expect(friendCourt.isOver(t.state)).toBe(true)
    expect(t.state.history.some((h) => h.mistrial)).toBe(true)
  })
})
