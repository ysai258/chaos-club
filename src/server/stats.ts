/**
 * Play statistics: how much Chaos Club gets played, per day (India time).
 *
 * Counters build up in memory and are written out every 30 s. With Upstash
 * Redis credentials set (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN, or
 * the KV_REST_API_* names the Vercel integration uses) they survive restarts
 * and the free plan's sleep; without them they cover the time since the
 * server last woke up. Only counts are kept: no names, codes, tokens or IPs.
 *
 * "joins" counts new seats taken in a room (a reconnect to the same seat is
 * not counted again). The client has no identity that spans rooms, so there
 * is no unique-player count.
 */

export const COUNTERS = ['roomsCreated', 'joins', 'gamesStarted', 'gamesFinished', 'playersInGames'] as const
export type Counter = (typeof COUNTERS)[number]

export interface DayStats extends Record<Counter, number> {
  date: string
  peakOnline: number
  /** Games started, per game id. */
  byGame: Record<string, number>
}

export interface LiveCounts {
  rooms: number
  playing: number
  online: number
}

interface Batch {
  counts: Map<string, Map<string, number>>
  peaks: Map<string, number>
}

export interface StatsBackend {
  readonly kind: 'redis' | 'memory'
  write(batch: Batch): Promise<void>
  read(dates: string[]): Promise<DayStats[]>
}

const KEEP_DAYS = 400
const KEY = (kind: string, date: string) => `cc:${kind}:${date}`
const GAME_PREFIX = 'game:'
const GAME_ID = /^[a-z0-9-]{1,40}$/

/** YYYY-MM-DD in India time. */
export function dayOf(ms: number): string {
  return new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10)
}

export function lastDates(n: number, now: number): string[] {
  return Array.from({ length: n }, (_, i) => dayOf(now - i * 86_400_000))
}

const emptyDay = (date: string): DayStats => ({
  date,
  peakOnline: 0,
  byGame: {},
  ...(Object.fromEntries(COUNTERS.map((c) => [c, 0])) as Record<Counter, number>),
})

/** Put one hash field (a counter or `game:<id>`) into a day. */
function apply(day: DayStats, field: string, n: number): void {
  if ((COUNTERS as readonly string[]).includes(field)) day[field as Counter] += n
  else if (field.startsWith(GAME_PREFIX)) {
    const id = field.slice(GAME_PREFIX.length)
    day.byGame[id] = (day.byGame[id] ?? 0) + n
  }
}

export class MemoryBackend implements StatsBackend {
  readonly kind = 'memory' as const
  private days = new Map<string, DayStats>()

  async write(b: Batch): Promise<void> {
    for (const [date, counts] of b.counts) {
      const d = this.day(date)
      for (const [field, n] of counts) apply(d, field, n)
    }
    for (const [date, peak] of b.peaks) this.day(date).peakOnline = Math.max(this.day(date).peakOnline, peak)
  }

  async read(dates: string[]): Promise<DayStats[]> {
    return dates.map((d) => {
      const day = this.days.get(d)
      return day ? { ...day, byGame: { ...day.byGame } } : emptyDay(d)
    })
  }

  private day(date: string): DayStats {
    let d = this.days.get(date)
    if (!d) this.days.set(date, (d = emptyDay(date)))
    return d
  }
}

type Cmd = (string | number)[]

/** Upstash Redis over its REST API: one pipelined request per write or read. */
export class UpstashBackend implements StatsBackend {
  readonly kind = 'redis' as const
  constructor(
    private url: string,
    private token: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async pipeline(cmds: Cmd[]): Promise<unknown[]> {
    const res = await this.fetchImpl(`${this.url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`stats store HTTP ${res.status}`)
    const out = (await res.json()) as { result?: unknown; error?: string }[]
    const err = out.find((r) => r.error)
    if (err) throw new Error(`stats store: ${err.error}`)
    return out.map((r) => r.result)
  }

  async write(b: Batch): Promise<void> {
    const cmds: Cmd[] = []
    const ttl = KEEP_DAYS * 86_400
    for (const [date, counts] of b.counts) {
      for (const [field, n] of counts) cmds.push(['HINCRBY', KEY('day', date), field, n])
      cmds.push(['EXPIRE', KEY('day', date), ttl])
    }
    for (const [date, peak] of b.peaks) {
      cmds.push(['ZADD', KEY('peak', date), 'GT', peak, 'online'], ['EXPIRE', KEY('peak', date), ttl])
    }
    if (cmds.length) await this.pipeline(cmds)
  }

  async read(dates: string[]): Promise<DayStats[]> {
    const cmds: Cmd[] = []
    for (const d of dates) cmds.push(['HGETALL', KEY('day', d)], ['ZSCORE', KEY('peak', d), 'online'])
    const r = await this.pipeline(cmds)
    return dates.map((date, i) => {
      const day = emptyDay(date)
      const flat = (r[i * 2] as string[] | null) ?? []
      for (let k = 0; k + 1 < flat.length; k += 2) apply(day, String(flat[k]), Number(flat[k + 1]) || 0)
      day.peakOnline = Number(r[i * 2 + 1]) || 0
      return day
    })
  }
}

export class Stats {
  private pending: Batch = Stats.emptyBatch()
  private timer: ReturnType<typeof setInterval> | null = null
  private cache: { at: number; days: number; value: { days: DayStats[]; totals: Record<string, unknown> } } | null = null
  readonly startedAt: number
  lastError = ''
  /** How long a report is reused, so the public endpoint can't hammer the store. */
  cacheMs = 20_000

  constructor(
    readonly backend: StatsBackend,
    private now: () => number = Date.now,
  ) {
    this.startedAt = now()
  }

  private static emptyBatch(): Batch {
    return { counts: new Map(), peaks: new Map() }
  }

  private add(field: string, n: number): void {
    if (!(n > 0)) return
    const date = dayOf(this.now())
    const m = this.pending.counts.get(date) ?? new Map<string, number>()
    m.set(field, (m.get(field) ?? 0) + n)
    this.pending.counts.set(date, m)
  }

  count(c: Counter, n = 1): void {
    this.add(c, n)
  }

  /** A game began with `players` people in it. */
  gameStarted(gameId: string, players: number): void {
    this.add('gamesStarted', 1)
    this.add('playersInGames', players)
    if (GAME_ID.test(gameId)) this.add(GAME_PREFIX + gameId, 1)
  }

  online(n: number): void {
    const date = dayOf(this.now())
    if (n > (this.pending.peaks.get(date) ?? 0)) this.pending.peaks.set(date, n)
  }

  async flush(): Promise<void> {
    const b = this.pending
    if (!b.counts.size && !b.peaks.size) return
    this.pending = Stats.emptyBatch()
    try {
      await this.backend.write(b)
      this.lastError = ''
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
      this.merge(b) // keep it for the next try
    }
  }

  private merge(b: Batch): void {
    for (const [date, counts] of b.counts) {
      const m = this.pending.counts.get(date) ?? new Map<string, number>()
      for (const [field, n] of counts) m.set(field, (m.get(field) ?? 0) + n)
      this.pending.counts.set(date, m)
    }
    for (const [date, p] of b.peaks) this.pending.peaks.set(date, Math.max(p, this.pending.peaks.get(date) ?? 0))
  }

  start(everyMs = 30_000): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.flush(), everyMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Daily numbers for the last `days` days (1–90), newest first, plus live counts. */
  async report(days: number, live: LiveCounts) {
    const n = Math.max(1, Math.min(90, Math.floor(days) || 14))
    if (!this.cache || this.cache.days !== n || this.now() - this.cache.at >= this.cacheMs) {
      await this.flush()
      const list = await this.backend.read(lastDates(n, this.now()))
      const byGame: Record<string, number> = {}
      for (const d of list) for (const [id, k] of Object.entries(d.byGame)) byGame[id] = (byGame[id] ?? 0) + k
      const totals = {
        ...Object.fromEntries(COUNTERS.map((c) => [c, list.reduce((s, d) => s + d[c], 0)])),
        peakOnline: list.reduce((s, d) => Math.max(s, d.peakOnline), 0),
        byGame,
      }
      this.cache = { at: this.now(), days: n, value: { days: list, totals } }
    }
    return {
      live,
      ...this.cache.value,
      timezone: 'Asia/Kolkata',
      storage: this.backend.kind,
      since: this.backend.kind === 'memory' ? new Date(this.startedAt).toISOString() : undefined,
      error: this.lastError || undefined,
    }
  }
}

export function statsFromEnv(env: NodeJS.ProcessEnv = process.env): Stats {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN
  return new Stats(url && token ? new UpstashBackend(url, token) : new MemoryBackend())
}
