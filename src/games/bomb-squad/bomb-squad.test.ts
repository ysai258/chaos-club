import { describe, expect, it } from 'vitest'
import type { BaseCtx, GamePlayer, GameTeam, Step } from '../types.ts'
import { bombSquad, BRIEFING_MS, AFTERMATH_MS, STRIKE_PENALTY_MS, PREDICT_WINDOW_MS, type State, type Settings } from './index.ts'
import {
  generateModule, glyphColumnsContaining, makeEdgework, makeSections, dealSections, spellable, sayAnswer, solveWires,
  type ModuleState, type Rand,
} from './modules.ts'
import { LOCK_WORDS, MANUAL_ATOMS, STRIP_RULES, TAP_MAX_MS, discoPress, timerText } from './content.ts'
import type { BombSquadView, ModuleKind } from './shared.ts'

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function rng(seed: number): Rand {
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
  random: Rand
  players: GamePlayer[]
  teams: GameTeam[]
  state: State
  events: { type: string; data?: Record<string, unknown> }[] = []

  constructor(sizes: number[], settings: Partial<Settings> = {}, seed = 7) {
    this.random = rng(seed)
    this.teams = sizes.map((n, t) => ({
      id: `t${t}`, name: `Team ${t}`, color: 'tomato' as const,
      playerIds: Array.from({ length: n }, (_, i) => `p${t}_${i}`),
    }))
    this.players = this.teams.flatMap((t) => t.playerIds.map((id) => ({ id, name: id.toUpperCase(), avatar: '🙂', teamId: t.id, connected: true })))
    this.state = bombSquad.create({ ...this.ctx(), settings: bombSquad.parseSettings(settings) })
  }

  ctx(): BaseCtx {
    return { now: this.now, random: this.random, players: this.players, teams: this.teams, hostId: 'p0_0' }
  }

  apply(step: Step<State>) {
    if (!step.error) {
      this.state = step.state
      this.events.push(...(step.events ?? []))
    }
    return step
  }

  act(playerId: string, type: string, payload: Record<string, unknown> = {}) {
    return this.apply(bombSquad.action(this.state, playerId, { type, payload: { turn: this.state.bomb?.turn, ...payload } }, this.ctx()))
  }

  /** Advance the clock and run due ticks like the platform does. */
  wait(ms: number) {
    this.now += ms
    for (let d = bombSquad.deadline(this.state); d !== null && d <= this.now; d = bombSquad.deadline(this.state)) {
      this.apply(bombSquad.tick(this.state, this.ctx()))
    }
  }

  view(p: string): BombSquadView {
    return JSON.parse(JSON.stringify(bombSquad.view(this.state, p, this.ctx())))
  }

  get bomb() { return this.state.bomb! }
  get defuser() { return this.bomb.defuserId }

  setConnected(p: string, connected: boolean) {
    this.players = this.players.map((x) => (x.id === p ? { ...x, connected } : x))
  }

  /** Solve one module correctly using the server's secret state. */
  solve(mi: number) {
    const d = this.defuser
    const m = this.bomb.modules[mi]!
    switch (m.kind) {
      case 'wires': return this.act(d, 'cut', { module: mi, index: m.answer })
      case 'button': {
        this.act(d, 'buttonDown', { module: mi })
        if (m.act === 'tap') { this.now += 100; return this.act(d, 'buttonUp', { module: mi }) }
        this.now += TAP_MAX_MS + 50
        while (!STRIP_RULES[m.strip].ok(timerText(this.bomb.explodeAt! - this.now))) this.now += 100
        return this.act(d, 'buttonUp', { module: mi })
      }
      case 'glyphs': {
        let last
        for (const g of m.order) last = this.act(d, 'glyph', { module: mi, index: m.glyphs.indexOf(g) })
        return last!
      }
      case 'saywhat': {
        let last
        for (const st of m.stages) last = this.act(d, 'say', { module: mi, index: st.buttons.indexOf(st.answer) })
        return last!
      }
      case 'wheels': {
        m.slots.forEach((letters, slot) => {
          let i = (this.bomb.modules[mi] as Extract<ModuleState, { kind: 'wheels' }>).index[slot]!
          while (letters[i] !== m.word[slot]) { this.act(d, 'wheel', { module: mi, slot, dir: 1 }); i = (i + 1) % letters.length }
        })
        return this.act(d, 'submitWheels', { module: mi })
      }
      case 'disco': {
        let last
        for (let stage = 1; stage <= m.seq.length; stage++) {
          for (let k = 0; k < stage; k++) {
            last = this.act(d, 'disco', { module: mi, color: discoPress(m.seq[k]!, this.bomb.strikes, this.bomb.edgework) })
          }
        }
        return last!
      }
    }
  }

  /** A wrong move on module mi (guaranteed strike). */
  wrong(mi: number) {
    const d = this.defuser
    const m = this.bomb.modules[mi]!
    switch (m.kind) {
      case 'wires': return this.act(d, 'cut', { module: mi, index: m.cut.findIndex((c, i) => !c && i !== m.answer) })
      case 'button': {
        this.act(d, 'buttonDown', { module: mi })
        this.now += m.act === 'tap' ? 2000 : 100
        return this.act(d, 'buttonUp', { module: mi })
      }
      case 'glyphs': return this.act(d, 'glyph', { module: mi, index: m.glyphs.indexOf(m.order[3]!) })
      case 'saywhat': { const st = m.stages[m.stage]!; return this.act(d, 'say', { module: mi, index: st.buttons.findIndex((b) => b !== st.answer) }) }
      case 'wheels': return this.act(d, 'submitWheels', { module: mi })
      case 'disco': {
        const right = discoPress(m.seq[0]!, this.bomb.strikes, this.bomb.edgework)
        return this.act(d, 'disco', { module: mi, color: right === 'red' ? 'blue' : 'red' })
      }
    }
  }

  /** Wrong only if the module isn't already in a "wrong is impossible" state. */
  defuseAll() {
    this.act(this.defuser, 'arm')
    this.bomb.modules.forEach((_, i) => { this.now += 1000; expect(this.solve(i).error).toBeUndefined() })
  }
}

const json = (v: unknown) => JSON.stringify(v)

// ---------------------------------------------------------------------------
// Full game
// ---------------------------------------------------------------------------

describe('full playthrough', () => {
  it('plays 3 rounds for 2 teams: every bomb defused, scores add up, the game ends', () => {
    const t = new Table([3, 3], { rounds: 3 })
    const defusers: string[] = []
    const sizes: number[] = []
    for (let turn = 0; turn < 6; turn++) {
      expect(t.state.phase).toBe('briefing')
      expect(t.bomb.turn).toBe(turn)
      defusers.push(t.defuser)
      sizes.push(t.bomb.modules.length)
      t.defuseAll()
      expect(t.state.phase).toBe('aftermath')
      expect(t.state.aftermath!.result).toBe('defused')
      t.wait(AFTERMATH_MS)
    }
    expect(bombSquad.isOver(t.state)).toBe(true)
    expect(sizes).toEqual([2, 2, 3, 3, 4, 4])
    // Team order flips every round; each team rotates its defuser.
    expect(t.state.history.map((h) => h.teamId)).toEqual(['t0', 't1', 't1', 't0', 't0', 't1'])
    expect(new Set(defusers.filter((d) => d.startsWith('p0'))).size).toBe(3)
    expect(new Set(defusers.filter((d) => d.startsWith('p1'))).size).toBe(3)
    const scores = bombSquad.scores(t.state)
    const total = t.state.history.reduce((n, h) => n + h.points, 0)
    expect(scores.t0! + scores.t1!).toBe(total)
    expect(t.state.history.every((h) => h.result === 'defused')).toBe(true)
    const res = bombSquad.results(t.state, t.ctx())
    expect(res.highlights.length).toBeGreaterThan(0)
    expect(t.events.filter((e) => e.type === 'defused')).toHaveLength(6)
  })

  it('briefing auto-arms after the countdown; the timer runs out into a boom', () => {
    const t = new Table([2, 2], { rounds: 1 })
    t.wait(BRIEFING_MS)
    expect(t.state.phase).toBe('live')
    t.wait(t.bomb.fuseMs)
    expect(t.state.phase).toBe('aftermath')
    expect(t.state.aftermath!.result).toBe('boom')
    expect(t.events.some((e) => e.type === 'boom')).toBe(true)
  })

  it('round difficulty grows: rounds 4+ have 5 modules from the full pool', () => {
    const t = new Table([2, 2], { rounds: 5 })
    const kinds = new Set<ModuleKind>()
    for (let turn = 0; turn < 10; turn++) {
      t.bomb.modules.forEach((m) => kinds.add(m.kind))
      if (turn >= 6) expect(t.bomb.modules).toHaveLength(5)
      t.defuseAll()
      t.wait(AFTERMATH_MS)
    }
    expect(kinds.size).toBe(6)
    expect(t.state.phase).toBe('over')
  })

  it('both teams get the same module kinds in a round (fairness)', () => {
    const t = new Table([2, 2], { rounds: 2 })
    const first = t.bomb.modules.map((m) => m.kind)
    t.defuseAll(); t.wait(AFTERMATH_MS)
    expect(t.bomb.modules.map((m) => m.kind)).toEqual(first)
  })
})

// ---------------------------------------------------------------------------
// Strikes, timing, races
// ---------------------------------------------------------------------------

describe('strikes and the clock', () => {
  it('a strike costs 15s; max strikes is a boom; modules disarmed still score', () => {
    const t = new Table([2, 2], { rounds: 1, strikes: 2 })
    t.act(t.defuser, 'arm')
    const before = t.bomb.explodeAt!
    t.solve(0)
    expect(t.wrong(1).error).toBeUndefined()
    expect(t.bomb.strikes).toBe(1)
    expect(t.bomb.explodeAt).toBe(before - STRIKE_PENALTY_MS)
    t.wrong(1)
    expect(t.state.phase).toBe('aftermath')
    expect(t.state.aftermath!.result).toBe('boom')
    expect(t.state.aftermath!.points).toBe(3)
  })

  it('a click that lands after the timer hit zero detonates instead of counting', () => {
    const t = new Table([2, 2], { rounds: 1 })
    t.act(t.defuser, 'arm')
    t.bomb.modules.slice(0, -1).forEach((_, i) => t.solve(i))
    t.now = t.bomb.explodeAt! // deadline reached, tick not run yet
    const step = t.solve(t.bomb.modules.length - 1)
    expect(step.error).toBeUndefined()
    expect(t.state.aftermath!.result).toBe('boom')
  })

  it('a strike that eats the last seconds is a boom', () => {
    const t = new Table([2, 2], { rounds: 1 })
    t.act(t.defuser, 'arm')
    t.now = t.bomb.explodeAt! - 5000
    t.wrong(0)
    expect(t.state.aftermath!.result).toBe('boom')
  })

  it('defuse bonus scales with time left and is capped', () => {
    const t = new Table([2, 2], { rounds: 1 })
    t.act(t.defuser, 'arm')
    t.bomb.modules.forEach((_, i) => t.solve(i))
    const a = t.state.aftermath!
    expect(a.result).toBe('defused')
    expect(a.points).toBeLessThanOrEqual(2 * 3 + 5 + 6)
    expect(a.points).toBeGreaterThanOrEqual(2 * 3 + 5)
  })
})

// ---------------------------------------------------------------------------
// Module mechanics
// ---------------------------------------------------------------------------

function liveWith(kind: ModuleKind, seed = 3): { t: Table; mi: number } {
  for (let s = seed; s < seed + 400; s++) {
    const t = new Table([2, 2], { rounds: 3 }, s)
    // jump to a round where the kind exists
    for (let k = 0; k < 6 && t.state.phase !== 'over'; k++) {
      const mi = t.bomb.modules.findIndex((m) => m.kind === kind)
      if (mi >= 0) { t.act(t.defuser, 'arm'); return { t, mi } }
      t.defuseAll(); t.wait(AFTERMATH_MS)
    }
  }
  throw new Error(`no ${kind}`)
}

describe('modules', () => {
  it('wires: double cut is rejected without a strike', () => {
    const { t, mi } = liveWith('wires')
    t.wrong(mi)
    const m = t.bomb.modules[mi] as Extract<ModuleState, { kind: 'wires' }>
    const cutIdx = m.cut.findIndex(Boolean)
    expect(t.act(t.defuser, 'cut', { module: mi, index: cutIdx }).error).toMatch(/already cut/)
    expect(t.bomb.strikes).toBe(1)
  })

  it('button: holding a tap-button or tapping a hold-button is a strike; hold+release on the right digit works', () => {
    for (const want of ['tap', 'hold'] as const) {
      let found = false
      for (let s = 1; s < 300 && !found; s++) {
        const t = new Table([2, 2], { rounds: 1 }, s)
        const mi = t.bomb.modules.findIndex((m) => m.kind === 'button' && m.act === want)
        if (mi < 0) continue
        found = true
        t.act(t.defuser, 'arm')
        t.wrong(mi)
        expect(t.bomb.strikes).toBe(1)
        expect(t.solve(mi).error).toBeUndefined()
        expect(t.bomb.modules[mi]!.solved).toBe(true)
      }
      expect(found).toBe(true)
    }
  })

  it('button: the strip only shows while held', () => {
    const { t, mi } = liveWith('button')
    const face = () => t.view(t.defuser).bomb!.modules[mi]!.face as { strip: string | null; held: boolean }
    expect(face().strip).toBeNull()
    t.act(t.defuser, 'buttonDown', { module: mi })
    expect(face().held).toBe(true)
    expect(face().strip).not.toBeNull()
  })

  it('glyphs: pressing out of order strikes and keeps progress', () => {
    const { t, mi } = liveWith('glyphs')
    const m = t.bomb.modules[mi] as Extract<ModuleState, { kind: 'glyphs' }>
    t.act(t.defuser, 'glyph', { module: mi, index: m.glyphs.indexOf(m.order[0]!) })
    t.act(t.defuser, 'glyph', { module: mi, index: m.glyphs.indexOf(m.order[3]!) })
    expect(t.bomb.strikes).toBe(1)
    expect((t.bomb.modules[mi] as typeof m).pressed.filter(Boolean)).toHaveLength(1)
    expect(t.act(t.defuser, 'glyph', { module: mi, index: m.glyphs.indexOf(m.order[0]!) }).error).toMatch(/Already/)
  })

  it('disco: the mapping switches after a strike', () => {
    const { t, mi } = liveWith('disco')
    t.wrong(mi)
    expect(t.bomb.strikes).toBe(1)
    expect(t.solve(mi).error).toBeUndefined()
    expect(t.bomb.modules[mi]!.solved).toBe(true)
  })

  it('say what & wheels: wrong answers strike, right answers solve', () => {
    for (const kind of ['saywhat', 'wheels'] as const) {
      const { t, mi } = liveWith(kind)
      t.wrong(mi)
      expect(t.bomb.strikes).toBe(1)
      t.solve(mi)
      expect(t.bomb.modules[mi]!.solved).toBe(true)
    }
  })

  it('generators always produce exactly one valid answer (1000 seeds)', () => {
    for (let seed = 0; seed < 1000; seed++) {
      const r = rng(seed)
      const e = makeEdgework(r)
      expect(e.serial).toMatch(/^[A-Z0-9]{5}[0-9]$/)
      expect(e.serial).not.toMatch(/[IOY]/)
      const d = ((seed % 4) + 1) as 1 | 2 | 3 | 4
      const w = generateModule('wires', 0, d, e, r) as Extract<ModuleState, { kind: 'wires' }>
      expect(w.answer).toBeGreaterThanOrEqual(0)
      expect(w.answer).toBeLessThan(w.wires.length)
      expect(solveWires(w.wires, e).answer).toBe(w.answer)
      const g = generateModule('glyphs', 0, d, e, r) as Extract<ModuleState, { kind: 'glyphs' }>
      expect(new Set(g.glyphs).size).toBe(4)
      expect(glyphColumnsContaining(g.glyphs)).toEqual([g.column])
      const k = generateModule('wheels', 0, d, e, r) as Extract<ModuleState, { kind: 'wheels' }>
      expect(LOCK_WORDS.filter((x) => spellable(k.slots, x))).toEqual([k.word])
      k.slots.forEach((s) => expect(new Set(s).size).toBe(6))
      const sw = generateModule('saywhat', 0, d, e, r) as Extract<ModuleState, { kind: 'saywhat' }>
      sw.stages.forEach((st) => {
        expect(new Set(st.buttons).size).toBe(4)
        expect(sayAnswer(st.display, st.buttons)).toBe(st.answer)
      })
    }
  })
})

// ---------------------------------------------------------------------------
// Hidden information
// ---------------------------------------------------------------------------

describe('hidden information', () => {
  it('defuser sees the bomb but never a solution or the manual; experts see pages but never the bomb', () => {
    const t = new Table([4, 3], { rounds: 3 })
    t.defuseAll(); t.wait(AFTERMATH_MS); t.defuseAll(); t.wait(AFTERMATH_MS) // round 2: 3 modules
    t.act(t.defuser, 'arm')
    const d = t.defuser
    const team = t.teams.find((x) => x.playerIds.includes(d))!
    const others = team.playerIds.filter((p) => p !== d)
    const rival = t.teams.find((x) => x !== team)!.playerIds[0]!

    const dv = t.view(d)
    expect(dv.role).toBe('defuser')
    expect(dv.manual).toEqual([])
    expect(json(dv)).not.toContain('"solution"')
    expect(json(dv)).not.toContain('"why"')
    expect(dv.bomb!.edgework!.serial).toBe(t.bomb.edgework.serial)
    for (const m of t.bomb.modules) {
      if (m.kind === 'wires') expect(json(dv)).not.toMatch(/answer/)
      if (m.kind === 'wheels') expect(json(dv)).not.toContain(`"${m.word}"`)
    }

    const pages = new Map<string, string[]>()
    for (const p of others) {
      const ev = t.view(p)
      expect(ev.role).toBe('expert')
      expect(ev.bomb!.edgework).toBeUndefined()
      expect(ev.bomb!.modules.every((m) => m.face === undefined && m.solution === undefined)).toBe(true)
      expect(json(ev)).not.toContain(t.bomb.edgework.serial)
      expect(ev.manual.length).toBeGreaterThan(0)
      pages.set(p, ev.manual.map((x) => x.id))
    }
    // Each expert holds DIFFERENT pages.
    const all = [...pages.values()].flat()
    expect(new Set(all).size).toBe(all.length)
    // One expert's page text is not in another expert's view.
    const [a, b] = others
    const aText = t.view(a!).manual.flatMap((x) => x.blocks).map(json)
    const bJson = json(t.view(b!))
    for (const blk of aText) if (!blk.includes('"t":"p"')) expect(bJson).not.toContain(blk)

    const sv = t.view(rival)
    expect(sv.role).toBe('spectator')
    expect(sv.manual).toEqual([])
    expect(sv.bomb!.modules.every((m) => m.solution && m.face)).toBe(true)
    expect(sv.pageHolders).toEqual([])
  })

  it('the defuser cannot see the bomb during the briefing; pages are readable already', () => {
    const t = new Table([2, 2])
    const dv = t.view(t.defuser)
    expect(dv.bomb!.modules.every((m) => !m.face)).toBe(true)
    expect(dv.bomb!.edgework).toBeUndefined()
    const expert = t.teams.find((x) => x.playerIds.includes(t.defuser))!.playerIds.find((p) => p !== t.defuser)!
    expect(t.view(expert).manual.length).toBeGreaterThan(0)
  })

  it('after the bomb everyone sees the solution', () => {
    const t = new Table([2, 2])
    t.defuseAll()
    expect(t.view(t.defuser).bomb!.modules.every((m) => m.solution)).toBe(true)
  })

  it('late joiners (unknown ids) are benched: no bomb details, actions rejected', () => {
    const t = new Table([2, 2])
    t.players = [...t.players, { id: 'late', name: 'LATE', avatar: '🐢', teamId: 't0', connected: true }]
    const v = t.view('late')
    expect(v.role).toBe('benched')
    expect(v.manual).toEqual([])
    expect(v.bomb!.modules.every((m) => !m.face && !m.solution)).toBe(true)
    expect(t.act('late', 'heckle', { kind: 'tick' }).error).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Manual splitting
// ---------------------------------------------------------------------------

describe('manual pages', () => {
  const kinds: ModuleKind[] = ['wires', 'button']
  it.each([1, 2, 3, 4, 5, 6, 7])('%i experts: every atom is held, nobody is empty-handed', (n) => {
    const sections = makeSections(kinds, n)
    const atoms = sections.flatMap((s) => s.atoms.map((a) => `${s.kind}${a}`))
    expect(new Set(atoms).size).toBe(MANUAL_ATOMS.wires.length + MANUAL_ATOMS.button.length)
    expect(atoms).toHaveLength(new Set(atoms).size)
    const experts = Array.from({ length: n }, (_, i) => `e${i}`)
    const deal = dealSections(sections, experts)
    for (const e of experts) expect(deal[e]!.length).toBeGreaterThan(0)
    const originals = Object.values(deal).flat().filter((h) => !h.copy).map((h) => h.sectionId)
    expect(new Set(originals)).toEqual(new Set(sections.map((s) => s.id)))
    if (n <= sections.length) expect(Object.values(deal).flat().every((h) => !h.copy)).toBe(true)
  })

  it('a team of 1 plays lone wolf: bomb + whole manual + 50% more time', () => {
    const t = new Table([1, 3], { rounds: 1 })
    expect(t.defuser).toBe('p0_0')
    expect(t.bomb.loneWolf).toBe(true)
    t.act(t.defuser, 'arm')
    const v = t.view('p0_0')
    expect(v.role).toBe('loneWolf')
    expect(v.manual.map((m) => m.kind).sort()).toEqual(t.bomb.modules.map((m) => m.kind).sort())
    expect(v.bomb!.modules.every((m) => m.face && !m.solution)).toBe(true)
    expect(t.bomb.bonuses.join()).toMatch(/Lone wolf/)
  })

  it('a team of 8 spreads pages over 7 experts', () => {
    const t = new Table([8, 2], { rounds: 1 })
    const team = t.teams[0]!.playerIds.filter((p) => p !== t.defuser)
    team.forEach((p) => expect(t.view(p).manual.length).toBeGreaterThan(0))
  })
})

// ---------------------------------------------------------------------------
// People leaving, stale and illegal actions
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('rejects stale turn ids, non-defuser moves, junk payloads and unknown actions', () => {
    const t = new Table([2, 2])
    const d = t.defuser
    const mate = t.teams.find((x) => x.playerIds.includes(d))!.playerIds.find((p) => p !== d)!
    expect(t.act(d, 'cut', { module: 0, index: 0 }).error).toMatch(/Arm/)
    t.act(d, 'arm')
    expect(t.act(d, 'arm').error).toMatch(/Already/)
    expect(bombSquad.action(t.state, d, { type: 'cut', payload: { turn: 99, module: 0, index: 0 } }, t.ctx()).error).toMatch(/older/)
    expect(t.act(mate, 'cut', { module: 0, index: 0 }).error).toMatch(/Only the defuser/)
    expect(t.act(d, 'cut', { module: 42, index: 0 }).error).toBeTruthy()
    expect(t.act(d, 'cut', { module: 0, index: 'x' }).error).toBeTruthy()
    expect(t.act(d, 'explode', {}).error).toBeTruthy()
    expect(t.bomb.strikes).toBe(0)
  })

  it('stale actions from the previous bomb are rejected', () => {
    const t = new Table([2, 2])
    const old = t.bomb.turn
    const d = t.defuser
    t.defuseAll()
    t.wait(AFTERMATH_MS)
    expect(bombSquad.action(t.state, d, { type: 'cut', payload: { turn: old, module: 0, index: 0 } }, t.ctx()).error).toMatch(/older/)
  })

  it('a disconnected defuser can be replaced by a teammate; the replaced defuser gets pages', () => {
    const t = new Table([3, 2])
    t.act(t.defuser, 'arm')
    const old = t.defuser
    const mate = t.teams.find((x) => x.playerIds.includes(old))!.playerIds.find((p) => p !== old)!
    expect(t.act(mate, 'takeOver').error).toMatch(/still here/)
    t.setConnected(old, false)
    const v = t.view(mate)
    expect(v.defuserOffline).toBe(true)
    expect(v.canTakeOver).toBe(true)
    expect(t.act(mate, 'takeOver').error).toBeUndefined()
    expect(t.defuser).toBe(mate)
    expect(t.state.bomb!.holdings[old]!.length).toBeGreaterThan(0)
    expect(t.view(mate).bomb!.modules[0]!.face).toBeDefined()
  })

  it('defuser gone for good: the next teammate inherits the ticking bomb', () => {
    const t = new Table([3, 2])
    t.act(t.defuser, 'arm')
    const old = t.defuser
    const explodeAt = t.bomb.explodeAt
    t.apply(bombSquad.onPlayerGone(t.state, old, t.ctx()))
    expect(t.defuser).not.toBe(old)
    expect(t.bomb.explodeAt).toBe(explodeAt)
    expect(t.state.phase).toBe('live')
    t.bomb.modules.forEach((_, i) => t.solve(i))
    expect(t.state.aftermath!.result).toBe('defused')
  })

  it('last player of the defusing team gone: bomb abandoned, game moves on', () => {
    const t = new Table([1, 2], { rounds: 1 })
    t.act(t.defuser, 'arm')
    t.apply(bombSquad.onPlayerGone(t.state, 'p0_0', t.ctx()))
    expect(t.state.aftermath!.result).toBe('abandoned')
    t.wait(AFTERMATH_MS)
    expect(t.bomb.teamId).toBe('t1')
  })

  it('a team with nobody left is skipped at turn start; the game still ends', () => {
    const t = new Table([2, 1], { rounds: 2 })
    t.apply(bombSquad.onPlayerGone(t.state, 'p1_0', t.ctx()))
    t.defuseAll(); t.wait(AFTERMATH_MS) // t1 skipped, round 2 t1 skipped, t0 again
    expect(t.bomb.teamId).toBe('t0')
    t.defuseAll(); t.wait(AFTERMATH_MS)
    expect(t.state.phase).toBe('over')
    expect(t.state.history.filter((h) => h.result === 'skipped')).toHaveLength(2)
  })

  it('an expert gone: pages are redealt; an offline expert’s pages are lent to a teammate', () => {
    const t = new Table([4, 2])
    const team = t.teams[0]!.playerIds.includes(t.defuser) ? t.teams[0]! : t.teams[1]!
    const ex = team.playerIds.filter((p) => p !== t.defuser)
    t.setConnected(ex[0]!, false)
    const lent = t.view(ex[1]!).manual.filter((m) => m.borrowedFrom)
    expect(lent.length).toBeGreaterThan(0)
    t.apply(bombSquad.onPlayerGone(t.state, ex[0]!, t.ctx()))
    expect(t.state.bomb!.holdings[ex[0]!]).toBeUndefined()
    const covered = ex.slice(1).flatMap((p) => t.view(p).manual.map((m) => m.id))
    expect(new Set(covered)).toEqual(new Set(t.bomb.sections.map((s) => s.id)))
  })

  it('host can skip the aftermath; others cannot', () => {
    const t = new Table([2, 2])
    t.defuseAll()
    expect(t.act('p1_0', 'next').error).toMatch(/host/)
    expect(t.act('p0_0', 'next').error).toBeUndefined()
    expect(t.state.phase).toBe('briefing')
    expect(t.state.turnIdx).toBe(1)
  })

  it('players leaving after the game started that were never in it are ignored', () => {
    const t = new Table([2, 2])
    const before = t.state
    expect(bombSquad.onPlayerGone(t.state, 'stranger', t.ctx()).state).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// The waiting team
// ---------------------------------------------------------------------------

describe('spectating team', () => {
  it('can bet until 30s after arming; a correct bet is +2', () => {
    const t = new Table([2, 2], { rounds: 1 })
    const rival = t.bomb.teamId === 't0' ? 'p1_0' : 'p0_0'
    expect(t.act(t.defuser, 'predict', { guess: 'boom' }).error).toMatch(/yourselves/)
    expect(t.act(rival, 'predict', { guess: 'boom' }).error).toBeUndefined()
    t.act(t.defuser, 'arm')
    t.now += PREDICT_WINDOW_MS + 1
    expect(t.act(rival, 'predict', { guess: 'defuse' }).error).toMatch(/closed/)
    t.wait(t.bomb.fuseMs)
    const rivalTeam = rival.startsWith('p0') ? 't0' : 't1'
    expect(bombSquad.scores(t.state)[rivalTeam]).toBe(2)
  })

  it('heckles reach everyone, have a cooldown, and can be switched off', () => {
    const t = new Table([2, 2])
    const rival = t.bomb.teamId === 't0' ? 'p1_0' : 'p0_0'
    t.act(t.defuser, 'arm')
    expect(t.act(rival, 'heckle', { kind: 'chicken' }).error).toBeUndefined()
    expect(t.act(rival, 'heckle', { kind: 'chicken' }).error).toMatch(/voice/)
    expect(t.act(t.defuser, 'heckle', { kind: 'chicken' }).error).toBeTruthy()
    expect(t.act(rival, 'heckle', { kind: 'nuke' }).error).toBeTruthy()
    expect(t.view(t.defuser).heckles).toHaveLength(1)
    const off = new Table([2, 2], { heckles: false })
    const r2 = off.bomb.teamId === 't0' ? 'p1_0' : 'p0_0'
    expect(off.act(r2, 'heckle', { kind: 'tick' }).error).toMatch(/off/)
  })

  it('a team far behind gets an underdog fuse', () => {
    const t = new Table([2, 2], { rounds: 3 })
    t.state = { ...t.state, scores: { t0: 30, t1: 0 } }
    t.defuseAll(); t.wait(AFTERMATH_MS) // next turn starts with the gap
    expect(t.bomb.teamId).toBe('t1')
    expect(t.bomb.bonuses.join()).toMatch(/Underdog/)
  })
})

describe('settings', () => {
  it('coerces junk to safe defaults', () => {
    expect(bombSquad.parseSettings({ rounds: 99, fuse: 'nuclear', strikes: -3, heckles: 'yes' })).toEqual({ rounds: 6, fuse: 'normal', strikes: 1, heckles: true })
    expect(bombSquad.parseSettings({})).toEqual({ rounds: 3, fuse: 'normal', strikes: 3, heckles: true })
  })
})

describe('timer display', () => {
  it('the phone shows exactly the timer the server judges button releases against', async () => {
    const web = await import('../../web/games/bomb-squad/util.ts')
    for (const ms of [0, 1, 999, 1000, 1001, 59_999, 60_000, 61_500, 185_000, 599_001]) expect(web.timerText(ms)).toBe(timerText(ms))
    expect(timerText(65_000)).toBe('1:05')
    expect(timerText(64_001)).toBe('1:05')
  })
})
