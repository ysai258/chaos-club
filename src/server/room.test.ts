import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientMessage, RoomSnapshot, ServerMessage } from '../shared/protocol.ts'
import type { AnyGame, GameDefinition } from '../games/types.ts'
import { Hub } from './hub.ts'
import type { Conn } from './room.ts'
import { silentLogger } from './log.ts'
import { testGame, type TestView } from './test-game.ts'
import { mulberry32, CODE_ALPHABET } from './random.ts'

// ------------------------------------------------------------------ fixtures

class FakeConn implements Conn {
  static seq = 0
  readonly id = `c${FakeConn.seq++}`
  roomCode?: string
  playerId?: string
  inbox: ServerMessage[] = []
  closed: { code?: number; reason?: string } | null = null
  send(msg: ServerMessage) {
    // Round-trip through JSON like the real socket does.
    this.inbox.push(JSON.parse(JSON.stringify(msg)) as ServerMessage)
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason }
  }
  get room(): RoomSnapshot {
    const r = [...this.inbox].reverse().find((m) => m.t === 'room')
    if (!r || r.t !== 'room') throw new Error('no snapshot yet')
    return r.room
  }
  get errors() {
    return this.inbox.filter((m): m is Extract<ServerMessage, { t: 'error' }> => m.t === 'error')
  }
  get events() {
    return this.inbox.filter((m): m is Extract<ServerMessage, { t: 'event' }> => m.t === 'event')
  }
  get token(): string {
    const w = this.inbox.find((m) => m.t === 'welcome')
    if (!w || w.t !== 'welcome') throw new Error('no welcome')
    return w.token
  }
}

function makeHub(games: Record<string, AnyGame> = { [testGame.id]: testGame }, rate = { burst: 1000, perSecond: 1000 }) {
  return new Hub({ games, log: silentLogger, graceMs: 30_000, hostGraceMs: 10_000, rate })
}

function send(hub: Hub, conn: FakeConn, msg: ClientMessage) {
  hub.onMessage(conn, JSON.stringify(msg))
}

function join(hub: Hub, code: string, name: string, token: string | null = null): FakeConn {
  const c = new FakeConn()
  send(hub, c, { t: 'hello', code, token, name, avatar: '🦊' })
  return c
}

function setup(n: number, games?: Record<string, AnyGame>) {
  const hub = makeHub(games)
  const room = hub.createRoom()
  const conns = Array.from({ length: n }, (_, i) => join(hub, room.code, `P${i}`))
  return { hub, room, code: room.code, conns, host: conns[0]! }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-03T12:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

// ------------------------------------------------------------------ rooms & joining

describe('rooms', () => {
  it('generates 5-letter codes from the unambiguous alphabet', () => {
    const hub = makeHub()
    for (let i = 0; i < 50; i++) {
      const code = hub.createRoom().code
      expect(code).toMatch(/^[A-Z]{5}$/)
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch)
      expect(code).not.toMatch(/[IOLU01]/)
    }
    expect(hub.rooms.size).toBe(50)
  })

  it('first joiner is host, players are auto-balanced across 2 teams', () => {
    const { conns, host } = setup(5)
    const snap = host.room
    expect(snap.players.map((p) => p.name)).toEqual(['P0', 'P1', 'P2', 'P3', 'P4'])
    expect(snap.players[0]!.isHost).toBe(true)
    expect(snap.players.filter((p) => p.isHost)).toHaveLength(1)
    expect(snap.teams).toHaveLength(2)
    expect(snap.teams.map((t) => t.playerIds.length).sort()).toEqual([2, 3])
    expect(new Set(snap.teams.map((t) => t.color)).size).toBe(2)
    expect(snap.teams[0]!.name).not.toBe(snap.teams[1]!.name)
    // Every viewer gets their own `you`.
    conns.forEach((c, i) => expect(c.room.you).toBe(snap.players[i]!.id))
  })

  it('rejects unknown rooms and garbage messages', () => {
    const hub = makeHub()
    const c = join(hub, 'ZZZZZ', 'Lost')
    expect(c.errors[0]?.code).toBe('room_not_found')
    hub.onMessage(c, 'not json')
    hub.onMessage(c, JSON.stringify({ t: 'room/start', extra: 1, sneaky: { a: 1 } }))
    hub.onMessage(c, JSON.stringify({ t: 'nope' }))
    expect(c.errors.map((e) => e.code)).toEqual(['room_not_found', 'bad_message', 'not_in_room', 'bad_message'])
  })

  it('cleans names, dedupes them, and keeps one grapheme of avatar', () => {
    const { hub, code } = setup(1)
    const a = join(hub, code, '  P0  ')
    const b = new FakeConn()
    send(hub, b, { t: 'hello', code, token: null, name: '   ', avatar: '👨‍👩‍👧extra' })
    const names = b.room.players.map((p) => p.name)
    expect(names).toEqual(['P0', 'P0 2', 'Mystery Guest'])
    expect(b.room.players[2]!.avatar).toBe('👨‍👩‍👧')
    expect(a.room.players[1]!.name).toBe('P0 2')
  })

  it('answers ping with pong', () => {
    const hub = makeHub()
    const c = new FakeConn()
    send(hub, c, { t: 'ping' })
    expect(c.inbox[0]).toEqual({ t: 'pong', serverNow: Date.now() })
  })
})

// ------------------------------------------------------------------ teams

describe('teams', () => {
  it('host can set team count; players are rebalanced', () => {
    const { hub, host } = setup(6)
    send(hub, host, { t: 'room/setTeams', count: 3 })
    expect(host.room.teams.map((t) => t.playerIds.length)).toEqual([2, 2, 2])
    send(hub, host, { t: 'room/setTeams', count: 1 })
    expect(host.room.teams).toHaveLength(1)
    expect(host.room.teams[0]!.playerIds).toHaveLength(6)
    for (const p of host.room.players) expect(p.teamId).toBe(host.room.teams[0]!.id)
  })

  it('non-hosts cannot use host powers but can move themselves', () => {
    const { hub, conns, host } = setup(3)
    const guest = conns[1]!
    send(hub, guest, { t: 'room/setTeams', count: 3 })
    send(hub, guest, { t: 'room/shuffleTeams' })
    send(hub, guest, { t: 'room/renameTeam', teamId: host.room.teams[0]!.id, name: 'x' })
    expect(guest.errors.map((e) => e.code)).toEqual(['not_host', 'not_host', 'not_host'])

    const me = guest.room.you
    const other = guest.room.teams.find((t) => !t.playerIds.includes(me))!
    send(hub, guest, { t: 'room/movePlayer', playerId: me, teamId: other.id })
    expect(guest.room.teams.find((t) => t.id === other.id)!.playerIds).toContain(me)

    const hostId = host.room.you
    send(hub, guest, { t: 'room/movePlayer', playerId: hostId, teamId: other.id })
    expect(guest.errors.at(-1)?.code).toBe('not_host')
  })

  it('host can move, rename (cleaned), and shuffle', () => {
    const { hub, conns, host } = setup(4)
    const p1 = conns[1]!.room.you
    const t0 = host.room.teams[0]!
    send(hub, host, { t: 'room/movePlayer', playerId: p1, teamId: t0.id })
    expect(host.room.teams[0]!.playerIds).toContain(p1)
    send(hub, host, { t: 'room/renameTeam', teamId: t0.id, name: '  The   Chai\n Gang  plus a very long tail that goes on' })
    expect(host.room.teams[0]!.name).toBe('The Chai Gang plus a very long')
    send(hub, host, { t: 'room/renameTeam', teamId: t0.id, name: '   ' })
    expect(host.errors.at(-1)?.code).toBe('bad_name')
    const before = JSON.stringify(host.room.teams.map((t) => t.playerIds))
    send(hub, host, { t: 'room/shuffleTeams' })
    const after = host.room.teams.map((t) => t.playerIds)
    expect(JSON.stringify(after)).not.toBe(before)
    expect(after.flat().sort()).toEqual(host.room.players.map((p) => p.id).sort())
  })

  it('picking a game clamps team count into its range', () => {
    const fourTeams: AnyGame = { ...testGame, id: 'quad', meta: { ...testGame.meta, teams: { min: 3, max: 4 } } }
    const { hub, host } = setup(4, { [testGame.id]: testGame, quad: fourTeams })
    send(hub, host, { t: 'room/pickGame', gameId: 'quad' })
    expect(host.room.gameId).toBe('quad')
    expect(host.room.teams).toHaveLength(3)
    send(hub, host, { t: 'room/pickGame', gameId: 'nope' })
    expect(host.errors.at(-1)?.code).toBe('unknown_game')
  })
})

// ------------------------------------------------------------------ host succession & kick

describe('host', () => {
  it('passes the crown to the next connected player after the host grace', () => {
    const { hub, conns, host } = setup(3)
    hub.onClose(host)
    vi.advanceTimersByTime(9_000)
    expect(conns[1]!.room.players[0]!.isHost).toBe(true)
    vi.advanceTimersByTime(1_500)
    const snap = conns[1]!.room
    expect(snap.players.find((p) => p.isHost)?.name).toBe('P1')
    // The old host coming back does not take it back.
    const back = join(hub, snap.code, 'P0', host.token)
    expect(back.room.players.find((p) => p.isHost)?.name).toBe('P1')
    expect(back.room.you).toBe(snap.players[0]!.id)
  })

  it('kick removes the player, closes their socket and bans the token', () => {
    const { hub, code, conns, host } = setup(3)
    const victim = conns[2]!
    const id = victim.room.you
    send(hub, host, { t: 'room/kick', playerId: id })
    expect(victim.errors.at(-1)?.code).toBe('kicked')
    expect(victim.closed?.code).toBe(4001)
    expect(host.room.players.map((p) => p.id)).not.toContain(id)
    const again = join(hub, code, 'P2', victim.token)
    expect(again.errors.at(-1)?.code).toBe('kicked')
    send(hub, host, { t: 'room/kick', playerId: host.room.you })
    expect(host.errors.at(-1)?.code).toBe('bad_kick')
  })
})

// ------------------------------------------------------------------ reconnect

describe('reconnect', () => {
  it('a token restores the same seat within the grace period', () => {
    const { hub, code, conns } = setup(2)
    const guest = conns[1]!
    const id = guest.room.you
    hub.onClose(guest)
    expect(conns[0]!.room.players[1]!.connected).toBe(false)
    vi.advanceTimersByTime(20_000)
    const back = join(hub, code, 'whatever', guest.token)
    expect(back.room.you).toBe(id)
    expect(back.room.players).toHaveLength(2)
    expect(back.room.players[1]!.connected).toBe(true)
    expect(back.room.players[1]!.name).toBe('P1')
    vi.advanceTimersByTime(60_000)
    expect(back.room.players).toHaveLength(2)
  })

  it('in the lobby a player gone past the grace loses their seat', () => {
    const { hub, conns } = setup(3)
    hub.onClose(conns[2]!)
    vi.advanceTimersByTime(30_001)
    expect(conns[0]!.room.players.map((p) => p.name)).toEqual(['P0', 'P1'])
  })

  it('mid-game, the game is told via onPlayerGone after 30s, and the seat survives', () => {
    const { hub, code, conns, host } = setup(3)
    send(hub, host, { t: 'room/start' })
    const leaver = conns[1]!
    const id = leaver.room.you
    hub.onClose(leaver)
    vi.advanceTimersByTime(29_000)
    expect((host.room.game!.view as TestView).gone).toEqual([])
    vi.advanceTimersByTime(1_500)
    expect((host.room.game!.view as TestView).gone).toEqual([id])
    const back = join(hub, code, 'P1', leaver.token)
    expect(back.room.you).toBe(id)
    expect(back.room.phase).toBe('playing')
  })
})

// ------------------------------------------------------------------ game lifecycle

describe('game lifecycle', () => {
  it('start validates players and team sizes with a clear message', () => {
    const strict: AnyGame = { ...testGame, id: 'strict', meta: { ...testGame.meta, minTeamSize: 2, minPlayers: 4 } }
    const { hub, code, host } = setup(1, { strict })
    send(hub, host, { t: 'room/start' })
    expect(host.errors.at(-1)?.message).toMatch(/Need 3 more players/)
    for (const n of ['A', 'B', 'C']) join(hub, code, n)
    send(hub, host, { t: 'room/setTeams', count: 2 })
    // 4 players, 2 teams of 2: OK. Move one across to make it 3/1.
    const snap = host.room
    const small = snap.teams[1]!
    send(hub, host, { t: 'room/movePlayer', playerId: small.playerIds[0]!, teamId: snap.teams[0]!.id })
    send(hub, host, { t: 'room/start' })
    expect(host.errors.at(-1)?.message).toBe('Each team needs at least 2 players')
    expect(host.room.phase).toBe('lobby')
    const guest = join(hub, code, 'Late')
    send(hub, guest, { t: 'room/start' })
    expect(guest.errors.at(-1)?.code).toBe('not_host')
  })

  it('settings are parsed by the game and remembered per game', () => {
    const { hub, host } = setup(2)
    send(hub, host, { t: 'room/settings', settings: { rounds: 99, mode: 'chaos', junk: true } })
    expect(host.room.settings).toEqual({ rounds: 5, roundSeconds: 60, mode: 'chaos', bonus: false })
    send(hub, host, { t: 'room/settings', settings: { bonus: true } })
    expect(host.room.settings).toMatchObject({ rounds: 5, mode: 'chaos', bonus: true })
  })

  it('runs a full game: actions, chained ticks from the deadline, results with tied ranks', () => {
    const { hub, conns, host } = setup(4)
    send(hub, host, { t: 'room/settings', settings: { rounds: 3, roundSeconds: 10 } })
    send(hub, host, { t: 'room/start' })
    expect(host.room.phase).toBe('playing')
    expect(host.room.game!.deadline).toBe(Date.now() + 10_000)
    expect((host.room.game!.view as TestView).round).toBe(1)

    // One player per team scores once: tie.
    const [t0, t1] = host.room.teams
    const onT0 = conns.find((c) => t0!.playerIds.includes(c.room.you))!
    const onT1 = conns.find((c) => t1!.playerIds.includes(c.room.you))!
    send(hub, onT0, { t: 'game', type: 'point', payload: { round: 1 } })
    send(hub, onT1, { t: 'game', type: 'point', payload: { round: 1 } })
    expect(host.room.game!.scores).toEqual({ [t0!.id]: 1, [t1!.id]: 1 })

    vi.advanceTimersByTime(10_000)
    expect((host.room.game!.view as TestView).round).toBe(2)
    // Stale action from the previous round is rejected with the game's message.
    send(hub, onT0, { t: 'game', type: 'point', payload: { round: 1 } })
    expect(onT0.errors.at(-1)).toMatchObject({ code: 'action_rejected', message: 'That was last round!' })

    vi.advanceTimersByTime(10_000)
    expect((host.room.game!.view as TestView).round).toBe(3)
    vi.advanceTimersByTime(10_000)
    expect(host.room.phase).toBe('results')
    expect(host.room.results!.ranking).toEqual([
      { teamId: t0!.id, score: 1, rank: 1 },
      { teamId: t1!.id, score: 1, rank: 1 },
    ])
    expect(host.room.results!.highlights.length).toBeGreaterThan(0)
    expect(host.room.results!.awards?.[0]?.title).toBe('Fastest Thumb')
    expect(host.room.game!.deadline).toBeNull()
    expect(host.events.map((e) => e.type)).toContain('timeup')
  })

  it('chains ticks while the deadline is already due (event loop stalled)', () => {
    const ticks: number[] = []
    const metronome: GameDefinition<{ d: number; n: number }> = {
      ...(testGame as unknown as GameDefinition<{ d: number; n: number }>),
      id: 'metronome',
      create: (ctx) => ({ d: ctx.now + 1000, n: 0 }),
      view: (s) => ({ n: s.n }),
      deadline: (s) => (s.n >= 10 ? null : s.d),
      tick: (s, ctx) => {
        ticks.push(ctx.now)
        return { state: { d: s.d + 1000, n: s.n + 1 }, events: [{ type: 'beat', data: { n: s.n + 1 } }] }
      },
      isOver: () => false,
      scores: () => ({}),
    }
    const { hub, host } = setup(2, { metronome: metronome as AnyGame })
    send(hub, host, { t: 'room/start' })
    const start = Date.now()
    vi.setSystemTime(start + 5_500) // the clock jumps; the timer has not fired yet
    vi.advanceTimersByTime(1000)
    expect(ticks).toHaveLength(6) // deadlines at +1s..+6s were all due at +6.5s
    expect((host.room.game!.view as { n: number }).n).toBe(6)
    expect(host.events.filter((e) => e.type === 'beat')).toHaveLength(6)
    vi.advanceTimersByTime(500)
    expect(ticks).toHaveLength(7)
  })

  it('competition ranking: 1, 1, 3', () => {
    const { hub, conns, host } = setup(3)
    send(hub, host, { t: 'room/setTeams', count: 3 })
    send(hub, host, { t: 'room/start' })
    const teams = host.room.teams
    const on = (i: number) => conns.find((c) => teams[i]!.playerIds.includes(c.room.you))!
    send(hub, on(0), { t: 'game', type: 'point', payload: {} })
    send(hub, on(0), { t: 'game', type: 'point', payload: {} })
    send(hub, on(2), { t: 'game', type: 'point', payload: {} })
    send(hub, on(2), { t: 'game', type: 'point', payload: {} })
    send(hub, host, { t: 'game', type: 'finish', payload: {} })
    const r = host.room.results!.ranking
    expect(r.map((x) => x.rank)).toEqual([1, 1, 3])
    expect(r[2]!.teamId).toBe(teams[1]!.id)
  })

  it('per-viewer views: a team secret never reaches the other team', () => {
    const { hub, conns, host } = setup(4)
    send(hub, host, { t: 'room/start' })
    const teams = host.room.teams
    const secretOf = (c: FakeConn) => (c.room.game!.view as TestView).secret
    for (const c of conns) {
      const myTeam = teams.find((t) => t.playerIds.includes(c.room.you))!
      const mates = conns.filter((o) => myTeam.playerIds.includes(o.room.you))
      for (const m of mates) expect(secretOf(m)).toBe(secretOf(c))
    }
    // Inspect the raw bytes each viewer got: other team's word absent unless identical by chance.
    const a = conns.find((c) => teams[0]!.playerIds.includes(c.room.you))!
    const b = conns.find((c) => teams[1]!.playerIds.includes(c.room.you))!
    if (secretOf(a) !== secretOf(b)) {
      expect(JSON.stringify(a.inbox)).not.toContain(`"${secretOf(b)}"`)
      expect(JSON.stringify(b.inbox)).not.toContain(`"${secretOf(a)}"`)
    }
  })

  it('routes events by team, by player, and to everyone', () => {
    const { hub, code, conns, host } = setup(4)
    send(hub, host, { t: 'room/start' })
    const late = join(hub, code, 'Late') // parked on a team, not in the game
    const teams = host.room.teams
    const lateTeam = teams.find((t) => t.playerIds.includes(late.room.you))!
    const scorer = conns.find((c) => lateTeam.playerIds.includes(c.room.you))!
    for (const c of [...conns, late]) c.inbox = []

    send(hub, scorer, { t: 'game', type: 'point', payload: {} })
    for (const c of conns) {
      const same = lateTeam.playerIds.includes(c.room.you)
      expect(c.events.map((e) => e.type)).toEqual(same ? ['point'] : [])
    }
    expect(late.events).toEqual([]) // late joiners never get team-secret events

    for (const c of [...conns, late]) c.inbox = []
    send(hub, conns[1]!, { t: 'game', type: 'whisper', payload: {} })
    expect(conns[1]!.events.map((e) => e.type)).toEqual(['whisper'])
    expect(conns[0]!.events).toEqual([])

    send(hub, conns[2]!, { t: 'game', type: 'shout', payload: {} })
    for (const c of [...conns, late]) expect(c.events.at(-1)?.type).toBe('shout')
    // The snapshot is sent before the event.
    const idxRoom = conns[0]!.inbox.findIndex((m) => m.t === 'room')
    const idxEvent = conns[0]!.inbox.findIndex((m) => m.t === 'event' && m.type === 'shout')
    expect(idxRoom).toBeLessThan(idxEvent)
  })

  it('late joiners spectate: their actions are refused and they get a view', () => {
    const { hub, code, host } = setup(2)
    send(hub, host, { t: 'room/start' })
    const late = join(hub, code, 'Late')
    expect(late.room.phase).toBe('playing')
    expect((late.room.game!.view as TestView).spectator).toBe(true)
    expect(late.room.players.find((p) => p.name === 'Late')!.teamId).not.toBeNull()
    send(hub, late, { t: 'game', type: 'point', payload: {} })
    expect(late.errors.at(-1)?.code).toBe('spectating')
  })

  it('play again restarts with the same game; back to lobby clears the game', () => {
    const { hub, host } = setup(2)
    send(hub, host, { t: 'room/start' })
    send(hub, host, { t: 'game', type: 'finish', payload: {} })
    expect(host.room.phase).toBe('results')
    send(hub, host, { t: 'room/playAgain' })
    expect(host.room.phase).toBe('playing')
    expect(host.room.results).toBeNull()
    send(hub, host, { t: 'room/backToLobby' })
    expect(host.room.phase).toBe('lobby')
    expect(host.room.game).toBeNull()
  })

  it('a gone player is pruned when the host goes back to the lobby', () => {
    const { hub, conns, host } = setup(3)
    send(hub, host, { t: 'room/start' })
    hub.onClose(conns[2]!)
    vi.advanceTimersByTime(31_000)
    expect(host.room.players).toHaveLength(3)
    send(hub, host, { t: 'room/backToLobby' })
    expect(host.room.players.map((p) => p.name)).toEqual(['P0', 'P1'])
  })

  it('teams are locked during a game', () => {
    const { hub, host } = setup(2)
    send(hub, host, { t: 'room/start' })
    send(hub, host, { t: 'room/setTeams', count: 3 })
    send(hub, host, { t: 'room/movePlayer', playerId: host.room.you, teamId: host.room.teams[1]!.id })
    expect(host.errors.map((e) => e.code)).toEqual(['bad_phase', 'bad_phase'])
  })
})

// ------------------------------------------------------------------ buggy games

describe('a buggy game cannot take the room down', () => {
  it('a throwing action becomes an error toast, state unchanged', () => {
    const { hub, host } = setup(2)
    send(hub, host, { t: 'room/start' })
    send(hub, host, { t: 'game', type: 'explode', payload: {} })
    expect(host.errors.at(-1)?.code).toBe('game_error')
    expect(host.room.phase).toBe('playing')
  })

  it('a tick that keeps throwing sends the room back to the lobby', () => {
    const broken: AnyGame = { ...testGame, id: 'broken', tick: () => { throw new Error('nope') } }
    const { hub, host } = setup(2, { broken })
    send(hub, host, { t: 'room/settings', settings: { roundSeconds: 5 } })
    send(hub, host, { t: 'room/start' })
    vi.advanceTimersByTime(5_000 + 5 * 1_000 + 10)
    expect(host.room.phase).toBe('lobby')
    expect(host.errors.at(-1)?.code).toBe('game_error')
  })

  it('a tick that never moves the deadline backs off instead of spinning', () => {
    let ticks = 0
    const stuck: GameDefinition<{ d: number }> = {
      ...(testGame as unknown as GameDefinition<{ d: number }>),
      id: 'stuck',
      create: (ctx) => ({ d: ctx.now + 1000 }),
      view: () => ({}),
      deadline: (s) => s.d,
      tick: (s) => {
        ticks++
        return { state: s }
      },
      isOver: () => false,
      scores: () => ({}),
    }
    const { hub, host } = setup(2, { stuck: stuck as AnyGame })
    send(hub, host, { t: 'room/start' })
    vi.advanceTimersByTime(1000)
    expect(ticks).toBe(50)
    vi.advanceTimersByTime(999)
    expect(ticks).toBe(50)
    vi.advanceTimersByTime(1)
    expect(ticks).toBe(100)
    expect(host.room.phase).toBe('playing')
  })

  it('a throwing view gives that viewer a placeholder, others unaffected', () => {
    const picky: AnyGame = {
      ...testGame,
      id: 'picky',
      view: (s: unknown, viewer: string, ctx: Parameters<typeof testGame.view>[2]) => {
        if (viewer === ctx.hostId) throw new Error('host view broke')
        return testGame.view(s as never, viewer, ctx)
      },
    }
    const { hub, conns, host } = setup(2, { picky })
    send(hub, host, { t: 'room/start' })
    expect(host.room.game!.view).toEqual({ error: 'view_failed' })
    expect((conns[1]!.room.game!.view as TestView).round).toBe(1)
  })

  it('a create that throws keeps the room in the lobby', () => {
    const bad: AnyGame = { ...testGame, id: 'bad', create: () => { throw new Error('boom') } }
    const { hub, host } = setup(2, { bad })
    send(hub, host, { t: 'room/start' })
    expect(host.room.phase).toBe('lobby')
    expect(host.errors.at(-1)?.code).toBe('game_error')
  })
})

// ------------------------------------------------------------------ chat, rate limits, cleanup

describe('team chat', () => {
  it('is private to the team, trimmed, capped at 200 chars and 50 messages', () => {
    const { hub, conns, host } = setup(4)
    const teams = host.room.teams
    const a = conns.find((c) => teams[0]!.playerIds.includes(c.room.you))!
    const b = conns.find((c) => teams[1]!.playerIds.includes(c.room.you))!
    const mate = conns.find((c) => c !== a && teams[0]!.playerIds.includes(c.room.you))!
    send(hub, a, { t: 'room/teamChat', text: `  hello ${'x'.repeat(300)}` })
    expect(mate.room.teamChat).toHaveLength(1)
    expect(Array.from(mate.room.teamChat[0]!.text)).toHaveLength(200)
    expect(b.room.teamChat).toEqual([])
    expect(JSON.stringify(b.inbox)).not.toContain('hello')
    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(1500)
      send(hub, a, { t: 'room/teamChat', text: `m${i}` })
    }
    expect(a.room.teamChat).toHaveLength(50)
    expect(a.room.teamChat.at(-1)!.text).toBe('m59')
  })

  it('is rate limited', () => {
    const { hub, host } = setup(2)
    for (let i = 0; i < 8; i++) send(hub, host, { t: 'room/teamChat', text: `spam ${i}` })
    expect(host.room.teamChat).toHaveLength(5)
    expect(host.errors.at(-1)?.code).toBe('rate_limited')
  })

  it('is off when the game disables it', () => {
    const quiet: AnyGame = { ...testGame, id: 'quiet', meta: { ...testGame.meta, teamChat: false } }
    const { hub, host } = setup(2, { quiet })
    send(hub, host, { t: 'room/teamChat', text: 'hi' })
    expect(host.errors.at(-1)?.code).toBe('chat_disabled')
    expect(host.room.teamChat).toEqual([])
  })
})

describe('rate limiting & cleanup', () => {
  it('drops messages over the per-socket budget, then closes a flooding socket', () => {
    const hub = makeHub(undefined, { burst: 5, perSecond: 1 })
    const c = new FakeConn()
    for (let i = 0; i < 8; i++) send(hub, c, { t: 'ping' })
    expect(c.inbox.filter((m) => m.t === 'pong')).toHaveLength(5)
    expect(c.errors.map((e) => e.code)).toEqual(['rate_limited'])
    vi.advanceTimersByTime(2000)
    send(hub, c, { t: 'ping' })
    expect(c.inbox.filter((m) => m.t === 'pong')).toHaveLength(6)
    for (let i = 0; i < 100; i++) send(hub, c, { t: 'ping' })
    expect(c.closed?.code).toBe(4008)
  })

  it('closes rooms that are empty for 10 minutes or idle for 2 hours', () => {
    const hub = makeHub()
    const empty = hub.createRoom()
    const busy = hub.createRoom()
    const c = join(hub, busy.code, 'Night owl')
    vi.advanceTimersByTime(11 * 60_000)
    expect(hub.sweep(Date.now())).toBe(1)
    expect(hub.getRoom(empty.code)).toBeUndefined()
    expect(hub.getRoom(busy.code)).toBeDefined()
    vi.advanceTimersByTime(2 * 60 * 60_000)
    hub.sweep(Date.now())
    expect(hub.getRoom(busy.code)).toBeUndefined()
    expect(c.errors.at(-1)?.code).toBe('room_closed')
  })
})

describe('seeded random', () => {
  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 100; i++) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })
})
