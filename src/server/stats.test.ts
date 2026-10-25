import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ClientMessage, ServerMessage } from '../shared/protocol.ts'
import { createChaosServer, type ChaosServer } from './app.ts'
import { Hub } from './hub.ts'
import type { Conn } from './room.ts'
import { silentLogger } from './log.ts'
import { testGame } from './test-game.ts'
import { MemoryBackend, Stats, UpstashBackend, dayOf, lastDates, statsFromEnv, type StatsBackend } from './stats.ts'

class FakeConn implements Conn {
  static seq = 0
  readonly id = `s${FakeConn.seq++}`
  roomCode?: string
  playerId?: string
  inbox: ServerMessage[] = []
  send(msg: ServerMessage) {
    this.inbox.push(msg)
  }
  close() {}
  get token(): string {
    const w = this.inbox.find((m) => m.t === 'welcome')
    if (!w || w.t !== 'welcome') throw new Error('no welcome')
    return w.token
  }
}

const say = (hub: Hub, c: Conn, msg: ClientMessage) => hub.onMessage(c, JSON.stringify(msg))

function join(hub: Hub, code: string, name: string, token: string | null = null): FakeConn {
  const c = new FakeConn()
  say(hub, c, { t: 'hello', code, token, name, avatar: '🦊' })
  return c
}

describe('days', () => {
  it('rolls over at midnight India time, not UTC', () => {
    expect(dayOf(Date.parse('2026-10-24T18:29:59Z'))).toBe('2026-10-24')
    expect(dayOf(Date.parse('2026-10-24T18:30:00Z'))).toBe('2026-10-25')
    expect(lastDates(3, Date.parse('2026-10-25T06:00:00Z'))).toEqual(['2026-10-25', '2026-10-24', '2026-10-23'])
  })
})

describe('Stats', () => {
  it('batches counts, per-game starts and the peak online in memory', async () => {
    let now = Date.parse('2026-10-25T06:00:00Z')
    const stats = new Stats(new MemoryBackend(), () => now)
    stats.count('roomsCreated')
    stats.count('joins', 3)
    stats.gameStarted('bomb-squad', 3)
    stats.gameStarted('bomb-squad', 4)
    stats.gameStarted('Not A Game!', 2) // counted, but not as a per-game key
    stats.count('gamesFinished')
    stats.count('joins', 0) // ignored
    stats.online(5)
    stats.online(2)
    const r = await stats.report(2, { rooms: 1, playing: 0, online: 2 })
    expect(r.storage).toBe('memory')
    expect(r.days).toHaveLength(2)
    expect(r.days[0]).toMatchObject({
      date: '2026-10-25',
      roomsCreated: 1,
      joins: 3,
      gamesStarted: 3,
      gamesFinished: 1,
      playersInGames: 9,
      peakOnline: 5,
      byGame: { 'bomb-squad': 2 },
    })
    expect(r.days[1]).toMatchObject({ date: '2026-10-24', joins: 0 })
    expect(r.totals).toMatchObject({ gamesStarted: 3, peakOnline: 5, byGame: { 'bomb-squad': 2 } })
    expect(r.live).toEqual({ rooms: 1, playing: 0, online: 2 })

    // Reports are cached briefly so the public endpoint can't hammer the store.
    stats.count('joins')
    expect((await stats.report(2, r.live)).days[0]!.joins).toBe(3)
    now += stats.cacheMs
    expect((await stats.report(2, r.live)).days[0]!.joins).toBe(4)
  })

  it('keeps a failed batch and writes it on the next flush', async () => {
    const inner = new MemoryBackend()
    let fail = true
    const flaky: StatsBackend = {
      kind: 'redis',
      write: (b) => (fail ? Promise.reject(new Error('down')) : inner.write(b)),
      read: (d) => inner.read(d),
    }
    const now = Date.parse('2026-10-25T06:00:00Z')
    const stats = new Stats(flaky, () => now)
    stats.count('roomsCreated', 2)
    await stats.flush()
    expect(stats.lastError).toBe('down')
    stats.count('roomsCreated')
    fail = false
    await stats.flush()
    expect(stats.lastError).toBe('')
    expect((await inner.read(['2026-10-25']))[0]!.roomsCreated).toBe(3)
  })

  it('clamps the day range', async () => {
    const stats = new Stats(new MemoryBackend())
    const live = { rooms: 0, playing: 0, online: 0 }
    expect((await stats.report(1000, live)).days).toHaveLength(90)
    expect((await stats.report(Number.NaN, live)).days).toHaveLength(14)
  })

  it('talks to Upstash with one pipelined request per write or read', async () => {
    const calls: unknown[][] = []
    const fake = (async (_url: string, init: { body: string }) => {
      const cmds = JSON.parse(init.body) as unknown[][]
      calls.push(cmds)
      const result = (c: unknown[]) =>
        c[0] === 'HGETALL' ? ['joins', '7', 'game:overheard', '2', 'mystery', '9'] : c[0] === 'ZSCORE' ? '4' : 1
      return new Response(JSON.stringify(cmds.map((c) => ({ result: result(c) }))))
    }) as unknown as typeof fetch
    const backend = new UpstashBackend('https://example.upstash.io/', 'tok', fake)
    const stats = new Stats(backend, () => Date.parse('2026-10-25T06:00:00Z'))
    stats.count('joins', 2)
    stats.gameStarted('overheard', 4)
    stats.online(3)
    await stats.flush()
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        ['HINCRBY', 'cc:day:2026-10-25', 'joins', 2],
        ['HINCRBY', 'cc:day:2026-10-25', 'game:overheard', 1],
        ['ZADD', 'cc:peak:2026-10-25', 'GT', 3, 'online'],
      ]),
    )
    const [day] = await backend.read(['2026-10-25'])
    expect(day).toMatchObject({ joins: 7, peakOnline: 4, byGame: { overheard: 2 } })
    expect(day).not.toHaveProperty('mystery')
  })

  it('picks Upstash only when both URL and token are set', () => {
    expect(statsFromEnv({}).backend.kind).toBe('memory')
    expect(statsFromEnv({ UPSTASH_REDIS_REST_URL: 'https://x' }).backend.kind).toBe('memory')
    expect(statsFromEnv({ KV_REST_API_URL: 'https://x', KV_REST_API_TOKEN: 't' }).backend.kind).toBe('redis')
  })
})

describe('lifecycle hooks', () => {
  it('counts rooms, new seats (not reconnects), game starts and finishes', async () => {
    const stats = new Stats(new MemoryBackend())
    const hub = new Hub({ games: { [testGame.id]: testGame }, log: silentLogger, stats, rate: { burst: 1000, perSecond: 1000 } })
    const room = hub.createRoom()
    const host = join(hub, room.code, 'Asha')
    join(hub, room.code, 'Ravi')
    join(hub, room.code, 'Kiran')
    hub.onClose(host)
    const asha = join(hub, room.code, 'Asha', host.token) // reconnect: same seat, not a new join
    expect(hub.liveCounts()).toEqual({ rooms: 1, playing: 0, online: 3 })
    expect((await stats.report(1, hub.liveCounts())).days[0]).toMatchObject({ roomsCreated: 1, joins: 3, gamesStarted: 0 })

    say(hub, asha, { t: 'room/start' })
    expect(hub.liveCounts().playing).toBe(1)
    say(hub, asha, { t: 'game', type: 'finish', payload: {} })
    expect(room.currentPhase).toBe('results')

    stats.cacheMs = 0
    const day = (await stats.report(1, hub.liveCounts())).days[0]!
    expect(day).toMatchObject({ joins: 3, gamesStarted: 1, gamesFinished: 1, playersInGames: 3, byGame: { [testGame.id]: 1 } })
    hub.disposeAll()
  })
})

describe('GET /stats', () => {
  let app: ChaosServer
  let base: string
  const stats = new Stats(new MemoryBackend())

  beforeAll(async () => {
    app = await createChaosServer({ games: { [testGame.id]: testGame }, log: silentLogger, port: 0, host: '127.0.0.1', stats })
    base = `http://127.0.0.1:${app.port}`
  })
  afterAll(async () => {
    await app.close()
  })

  it('serves counts only, publicly and uncached', async () => {
    const created = (await (await fetch(`${base}/api/rooms`, { method: 'POST' })).json()) as { code: string }
    const res = await fetch(`${base}/stats?days=3`)
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as { days: { roomsCreated: number }[]; live: { rooms: number }; storage: string }
    expect(body.days).toHaveLength(3)
    expect(body.days[0]!.roomsCreated).toBe(1)
    expect(body.live.rooms).toBe(1)
    expect(body.storage).toBe('memory')
    // Nothing identifying: no room codes in the payload.
    expect(JSON.stringify(body)).not.toContain(created.code)
  })

  it('is absent when the server has no stats', async () => {
    const bare = await createChaosServer({ games: { [testGame.id]: testGame }, log: silentLogger, port: 0, host: '127.0.0.1' })
    try {
      expect((await fetch(`http://127.0.0.1:${bare.port}/stats`)).status).toBe(404)
    } finally {
      await bare.close()
    }
  })
})
