/**
 * One room: players, teams, the chosen game and its state, chat, timers.
 *
 * Transport-agnostic: it talks to `Conn`s (a WebSocket in production, a fake
 * in tests). Every mutation ends in `commit()`, which checks for game over,
 * re-arms the deadline timer, broadcasts a per-viewer snapshot and then
 * flushes queued game events.
 *
 * Game code is untrusted in the sense that it may have bugs: every call into
 * a GameDefinition goes through `call()`, which catches and logs, so one
 * broken game can never take the process down or wedge a room forever.
 */
import type {
  ChatMessage,
  ClientMessage,
  GameResults,
  PlayerId,
  PlayerInfo,
  RoomPhase,
  RoomSnapshot,
  ServerMessage,
  TeamColor,
  TeamId,
  TeamInfo,
} from '../shared/protocol.ts'
import type { AnyGame, BaseCtx, GameEvent, GamePlayer, GameTeam, Step } from '../games/types.ts'
import { startBlocker } from '../shared/start-check.ts'
import { TEAM_COLORS, TEAM_NAMES } from './names.ts'
import { hashString, mulberry32, newId, newToken, shuffle } from './random.ts'
import { MAX_CHAT, MAX_NAME, MAX_TEAM_NAME, cleanAvatar, cleanText } from './schema.ts'
import type { Logger } from './log.ts'
import type { Stats } from './stats.ts'

export interface Conn {
  readonly id: string
  send(msg: ServerMessage): void
  close(code?: number, reason?: string): void
  /** Set once the connection has said hello to a room. */
  roomCode?: string | undefined
  playerId?: string | undefined
}

export interface RoomOptions {
  games: Record<string, AnyGame>
  /** How long a disconnected player keeps their seat before the game is told they're gone. */
  graceMs: number
  /** How long a disconnected host keeps the crown. */
  hostGraceMs: number
  log: Logger
  /** Play counters (counts only). Optional so tests can leave it out. */
  stats?: Pick<Stats, 'count' | 'gameStarted'> | undefined
}

export const MAX_PLAYERS = 24
export const MAX_TEAMS = 6
export const CHAT_HISTORY = 50
const MAX_TICKS_PER_RUN = 50
const MAX_TICK_FAILURES = 5

interface Player {
  id: PlayerId
  name: string
  avatar: string
  token: string
  teamId: TeamId | null
  conns: Set<Conn>
  joinOrder: number
  disconnectedAt: number | null
  /** The grace period ran out (or they were kicked) and the game was told. */
  gone: boolean
  goneTimer: ReturnType<typeof setTimeout> | null
  hostTimer: ReturnType<typeof setTimeout> | null
  chatBucket: { tokens: number; at: number }
}

interface Team {
  id: TeamId
  name: string
  emoji: string
  color: TeamColor
  playerIds: PlayerId[]
}

interface ActiveGame {
  def: AnyGame
  state: unknown
  /** Players present at create. Only they exist for the game. */
  roster: Map<PlayerId, { name: string; avatar: string; teamId: TeamId }>
  teamIds: TeamId[]
  tickFailures: number
}

type Result<T> = { ok: true; value: T } | { ok: false }

export class Room {
  readonly code: string
  readonly createdAt = Date.now()
  lastActivity = Date.now()
  /** When the last connection dropped, or null while anyone is connected. */
  emptySince: number | null = Date.now()

  private readonly opts: RoomOptions
  private readonly players = new Map<PlayerId, Player>()
  private teams: Team[] = []
  private hostId: PlayerId | null = null
  private phase: RoomPhase = 'lobby'
  private gameId: string
  private settings: Record<string, unknown> = {}
  private readonly savedSettings = new Map<string, Record<string, unknown>>()
  private game: ActiveGame | null = null
  private results: GameResults | null = null
  private readonly chat = new Map<TeamId, ChatMessage[]>()
  private readonly kickedTokens = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private pendingEvents: GameEvent[] = []
  private rngCounter = 0
  private joinCounter = 0
  private disposed = false

  constructor(code: string, opts: RoomOptions) {
    this.code = code
    this.opts = opts
    const first = Object.keys(opts.games)[0]
    if (!first) throw new Error('No games registered')
    this.gameId = first
    this.settings = this.parseSettings(first, {})
    this.resizeTeams(2)
  }

  // ---------------------------------------------------------------- queries

  get playerCount(): number {
    return this.players.size
  }

  get connectedCount(): number {
    let n = 0
    for (const p of this.players.values()) if (p.conns.size > 0) n++
    return n
  }

  get currentPhase(): RoomPhase {
    return this.phase
  }

  summary() {
    return { code: this.code, phase: this.phase, gameId: this.gameId, players: this.players.size }
  }

  // ---------------------------------------------------------------- connections

  hello(conn: Conn, msg: Extract<ClientMessage, { t: 'hello' }>): void {
    if (this.disposed) return this.err(conn, 'room_not_found', 'This room has closed.')
    if (msg.token && this.kickedTokens.has(msg.token)) {
      return this.err(conn, 'kicked', 'The host removed you from this room.')
    }
    // A socket re-saying hello: drop its previous seat binding first.
    if (conn.playerId) this.detach(conn, false)

    let p = msg.token ? [...this.players.values()].find((x) => x.token === msg.token) : undefined
    if (p) {
      p.conns.add(conn)
      this.markConnected(p)
    } else {
      if (this.players.size >= MAX_PLAYERS) return this.err(conn, 'room_full', `This room is full (${MAX_PLAYERS} max).`)
      p = this.addPlayer(conn, msg.name, msg.avatar)
      this.opts.stats?.count('joins')
    }
    conn.roomCode = this.code
    conn.playerId = p.id
    conn.send({ t: 'welcome', token: p.token, playerId: p.id })
    this.commit()
  }

  /** The socket closed. */
  detach(conn: Conn, doCommit = true): void {
    const p = conn.playerId ? this.players.get(conn.playerId) : undefined
    conn.playerId = undefined
    if (!p) return
    p.conns.delete(conn)
    if (p.conns.size === 0) {
      p.disconnectedAt = Date.now()
      this.clearPlayerTimers(p)
      p.goneTimer = setTimeout(() => this.graceExpired(p.id), this.opts.graceMs)
      if (this.hostId === p.id) {
        p.hostTimer = setTimeout(() => this.commit(), this.opts.hostGraceMs)
      }
    }
    if (doCommit) this.commit()
  }

  /** Route one validated message from a joined connection. */
  handle(conn: Conn, msg: ClientMessage): void {
    const p = conn.playerId ? this.players.get(conn.playerId) : undefined
    if (!p) return this.err(conn, 'not_in_room', 'Join the room first.')
    this.lastActivity = Date.now()
    switch (msg.t) {
      case 'hello':
      case 'ping':
        return // handled by the hub
      case 'room/teamChat':
        return this.teamChat(conn, p, msg.text)
      case 'game':
        return this.gameAction(conn, p, msg.type, msg.payload)
      case 'room/movePlayer':
        return this.movePlayer(conn, p, msg.playerId, msg.teamId)
    }
    // Everything below is a host power.
    if (this.hostId !== p.id) return this.err(conn, 'not_host', 'Only the host can do that.')
    switch (msg.t) {
      case 'room/setTeams':
        if (!this.requireLobby(conn)) return
        this.resizeTeams(msg.count)
        return this.commit()
      case 'room/shuffleTeams':
        if (!this.requireLobby(conn)) return
        this.shuffleTeams()
        return this.commit()
      case 'room/renameTeam': {
        if (!this.requireLobby(conn)) return
        const team = this.teams.find((t) => t.id === msg.teamId)
        const name = cleanText(msg.name, MAX_TEAM_NAME)
        if (!team) return this.err(conn, 'bad_team', 'That team does not exist.')
        if (!name) return this.err(conn, 'bad_name', 'Team names cannot be empty.')
        team.name = name
        return this.commit()
      }
      case 'room/pickGame': {
        if (!this.requireLobby(conn)) return
        const def = this.opts.games[msg.gameId]
        if (!def) return this.err(conn, 'unknown_game', 'That game does not exist.')
        this.gameId = def.id
        this.settings = this.parseSettings(def.id, this.savedSettings.get(def.id) ?? {})
        const { min, max } = def.meta.teams
        if (this.teams.length < min) this.resizeTeams(min)
        else if (this.teams.length > max) this.resizeTeams(max)
        return this.commit()
      }
      case 'room/settings': {
        if (!this.requireLobby(conn)) return
        this.settings = this.parseSettings(this.gameId, { ...this.settings, ...msg.settings })
        this.savedSettings.set(this.gameId, this.settings)
        return this.commit()
      }
      case 'room/start':
        if (!this.requireLobby(conn)) return
        this.start(conn)
        return this.commit()
      case 'room/playAgain':
        if (this.phase !== 'results') return this.err(conn, 'bad_phase', 'Finish this game first.')
        this.pruneGone()
        if (!this.start(conn)) this.toLobby()
        return this.commit()
      case 'room/backToLobby':
        if (this.phase === 'lobby') return
        this.toLobby()
        return this.commit()
      case 'room/kick': {
        if (msg.playerId === p.id) return this.err(conn, 'bad_kick', "You can't kick yourself.")
        const target = this.players.get(msg.playerId)
        if (!target) return
        this.kickedTokens.add(target.token)
        for (const c of target.conns) {
          c.send({ t: 'error', code: 'kicked', message: 'The host removed you from this room.' })
          c.playerId = undefined
          c.close(4001, 'kicked')
        }
        target.conns.clear()
        this.removePlayer(target.id)
        return this.commit()
      }
    }
  }

  dispose(reason: string): void {
    if (this.disposed) return
    this.disposed = true
    this.clearTimer()
    for (const p of this.players.values()) {
      this.clearPlayerTimers(p)
      for (const c of p.conns) {
        c.send({ t: 'error', code: 'room_closed', message: reason })
        c.playerId = undefined
        c.close(4000, 'room closed')
      }
    }
    this.players.clear()
  }

  // ---------------------------------------------------------------- players

  private addPlayer(conn: Conn, rawName: string, rawAvatar: string): Player {
    let base = cleanText(rawName, MAX_NAME) || 'Mystery Guest'
    const taken = new Set([...this.players.values()].map((x) => x.name.toLowerCase()))
    let name = base
    for (let i = 2; taken.has(name.toLowerCase()); i++) {
      const suffix = ` ${i}`
      base = Array.from(base).slice(0, MAX_NAME - suffix.length).join('')
      name = base + suffix
    }
    const team = this.smallestTeam()
    const p: Player = {
      id: newId('p'),
      name,
      avatar: cleanAvatar(rawAvatar),
      token: newToken(),
      teamId: team?.id ?? null,
      conns: new Set([conn]),
      joinOrder: this.joinCounter++,
      disconnectedAt: null,
      gone: false,
      goneTimer: null,
      hostTimer: null,
      chatBucket: { tokens: 5, at: Date.now() },
    }
    this.players.set(p.id, p)
    team?.playerIds.push(p.id)
    if (!this.hostId || !this.players.has(this.hostId)) this.hostId = p.id
    return p
  }

  private markConnected(p: Player): void {
    this.clearPlayerTimers(p)
    p.disconnectedAt = null
    // A player whose grace ran out mid-game is back. The game already moved on
    // without them; they keep watching and rejoin properly next game.
  }

  private clearPlayerTimers(p: Player): void {
    if (p.goneTimer) clearTimeout(p.goneTimer)
    if (p.hostTimer) clearTimeout(p.hostTimer)
    p.goneTimer = null
    p.hostTimer = null
  }

  private graceExpired(id: PlayerId): void {
    const p = this.players.get(id)
    if (!p || p.conns.size > 0) return
    p.goneTimer = null
    if (this.phase === 'lobby') {
      this.removePlayer(id)
    } else {
      this.notifyGone(p)
    }
    this.commit()
  }

  private notifyGone(p: Player): void {
    if (p.gone) return
    p.gone = true
    const g = this.game
    if (this.phase !== 'playing' || !g || !g.roster.has(p.id)) return
    const r = this.call('onPlayerGone', () => g.def.onPlayerGone(g.state, p.id, this.ctx()))
    if (r.ok) this.applyStep(r.value)
  }

  private removePlayer(id: PlayerId): void {
    const p = this.players.get(id)
    if (!p) return
    this.notifyGone(p)
    this.clearPlayerTimers(p)
    this.players.delete(id)
    for (const t of this.teams) t.playerIds = t.playerIds.filter((x) => x !== id)
    if (this.hostId === id) this.hostId = null
    this.ensureHost()
  }

  /** Players who left and never came back lose their seat between games. */
  private pruneGone(): void {
    for (const p of [...this.players.values()]) {
      if (p.conns.size === 0 && p.gone) this.removePlayer(p.id)
    }
  }

  private ensureHost(): void {
    const host = this.hostId ? this.players.get(this.hostId) : undefined
    const now = Date.now()
    const hostAway =
      !host || (host.conns.size === 0 && host.disconnectedAt !== null && now - host.disconnectedAt >= this.opts.hostGraceMs)
    if (!hostAway) return
    const byJoin = [...this.players.values()].sort((a, b) => a.joinOrder - b.joinOrder)
    const next = byJoin.find((x) => x.conns.size > 0) ?? (host ? undefined : byJoin[0])
    if (next && next.id !== this.hostId) {
      this.hostId = next.id
      this.opts.log.info('host passed', { room: this.code, to: next.name })
    } else if (!host) {
      this.hostId = next?.id ?? null
    }
  }

  // ---------------------------------------------------------------- teams

  private smallestTeam(): Team | undefined {
    let best: Team | undefined
    for (const t of this.teams) if (!best || t.playerIds.length < best.playerIds.length) best = t
    return best
  }

  private makeTeam(): Team {
    const usedNames = new Set(this.teams.map((t) => t.name))
    const usedColors = new Set(this.teams.map((t) => t.color))
    const free = TEAM_NAMES.filter(([n]) => !usedNames.has(n))
    const [name, emoji] = free[Math.floor(Math.random() * free.length)] ?? ['Team ' + (this.teams.length + 1), '⭐']
    const color = TEAM_COLORS.find((c) => !usedColors.has(c)) ?? 'sun'
    return { id: newId('t'), name, emoji, color, playerIds: [] }
  }

  private resizeTeams(count: number): void {
    const n = Math.max(1, Math.min(MAX_TEAMS, Math.round(count)))
    while (this.teams.length < n) this.teams.push(this.makeTeam())
    const removed = this.teams.splice(n)
    for (const t of removed) {
      this.chat.delete(t.id)
      for (const id of t.playerIds) {
        const target = this.smallestTeam()!
        target.playerIds.push(id)
        const p = this.players.get(id)
        if (p) p.teamId = target.id
      }
    }
    this.balance()
  }

  /** Move latest joiners from the biggest team to the smallest until sizes differ by at most one. */
  private balance(): void {
    for (let guard = 0; guard < 100; guard++) {
      const sorted = [...this.teams].sort((a, b) => a.playerIds.length - b.playerIds.length)
      const small = sorted[0]
      const big = sorted[sorted.length - 1]
      if (!small || !big || big.playerIds.length - small.playerIds.length <= 1) return
      const id = big.playerIds.pop()!
      small.playerIds.push(id)
      const p = this.players.get(id)
      if (p) p.teamId = small.id
    }
  }

  private shuffleTeams(): void {
    const before = new Map([...this.players.values()].map((p) => [p.id, p.teamId]))
    let order = shuffle([...this.players.keys()])
    // Try a few times to produce a visibly different split.
    for (let i = 0; i < 5; i++) {
      this.deal(order)
      const changed = [...this.players.values()].some((p) => before.get(p.id) !== p.teamId)
      if (changed || this.players.size < 3) return
      order = shuffle(order)
    }
  }

  private deal(order: PlayerId[]): void {
    for (const t of this.teams) t.playerIds = []
    // Random team order too, so the odd player out isn't always on team 1.
    const teamOrder = shuffle(this.teams)
    order.forEach((id, i) => {
      const t = teamOrder[i % teamOrder.length]!
      t.playerIds.push(id)
      const p = this.players.get(id)
      if (p) p.teamId = t.id
    })
  }

  private movePlayer(conn: Conn, actor: Player, playerId: PlayerId, teamId: TeamId): void {
    if (actor.id !== this.hostId && actor.id !== playerId) {
      return this.err(conn, 'not_host', 'Only the host can move other players.')
    }
    if (!this.requireLobby(conn)) return
    const p = this.players.get(playerId)
    const team = this.teams.find((t) => t.id === teamId)
    if (!p || !team) return this.err(conn, 'bad_team', 'That player or team does not exist.')
    if (p.teamId === teamId) return
    for (const t of this.teams) t.playerIds = t.playerIds.filter((x) => x !== playerId)
    team.playerIds.push(playerId)
    p.teamId = teamId
    this.commit()
  }

  // ---------------------------------------------------------------- chat

  private chatEnabled(): boolean {
    return this.opts.games[this.gameId]?.meta.teamChat === true
  }

  private teamChat(conn: Conn, p: Player, raw: string): void {
    if (!this.chatEnabled()) return this.err(conn, 'chat_disabled', 'Team chat is off for this game.')
    if (!p.teamId) return this.err(conn, 'no_team', 'Join a team to chat.')
    const text = cleanText(raw, MAX_CHAT)
    if (!text) return
    // 5 messages burst, then one every 1.5s.
    const now = Date.now()
    const b = p.chatBucket
    b.tokens = Math.min(5, b.tokens + (now - b.at) / 1500)
    b.at = now
    if (b.tokens < 1) return this.err(conn, 'rate_limited', 'Easy there — slow down a little.')
    b.tokens -= 1
    const list = this.chat.get(p.teamId) ?? []
    list.push({ id: newId('m'), playerId: p.id, text, at: now })
    this.chat.set(p.teamId, list.slice(-CHAT_HISTORY))
    this.commit()
  }

  // ---------------------------------------------------------------- game lifecycle

  private parseSettings(gameId: string, raw: Record<string, unknown>): Record<string, unknown> {
    const def = this.opts.games[gameId]
    if (!def) return {}
    const r = this.call('parseSettings', () => def.parseSettings(raw))
    if (r.ok && r.value && typeof r.value === 'object') return r.value as Record<string, unknown>
    const fallback = this.call('parseSettings', () => def.parseSettings({}))
    return fallback.ok && fallback.value && typeof fallback.value === 'object' ? (fallback.value as Record<string, unknown>) : {}
  }

  /** Returns false (after telling the host why) when the game can't start. */
  private start(conn: Conn): boolean {
    const def = this.opts.games[this.gameId]
    if (!def) {
      this.err(conn, 'unknown_game', 'Pick a game first.')
      return false
    }
    const live = (id: PlayerId) => (this.players.get(id)?.conns.size ?? 0) > 0
    const blocker = startBlocker(
      def.meta,
      this.teams.map((t) => ({ name: t.name, size: t.playerIds.filter(live).length })),
    )
    if (blocker) {
      this.err(conn, 'cannot_start', blocker)
      return false
    }
    const roster = new Map<PlayerId, { name: string; avatar: string; teamId: TeamId }>()
    for (const t of this.teams) {
      for (const id of t.playerIds) {
        const p = this.players.get(id)
        if (p && live(id)) roster.set(id, { name: p.name, avatar: p.avatar, teamId: t.id })
      }
    }
    const game: ActiveGame = { def, state: undefined, roster, teamIds: this.teams.map((t) => t.id), tickFailures: 0 }
    this.game = game
    const base = this.ctx()
    const created = this.call('create', () => def.create({ ...base, settings: this.settings }))
    if (!created.ok) {
      this.game = null
      this.err(conn, 'game_error', `${def.meta.name} failed to start. Try again or pick another game.`)
      return false
    }
    game.state = created.value
    for (const p of this.players.values()) p.gone = false
    this.phase = 'playing'
    this.results = null
    this.chat.clear()
    this.opts.log.info('game started', { room: this.code, game: def.id, players: roster.size })
    this.opts.stats?.gameStarted(def.id, roster.size)
    return true
  }

  private toLobby(): void {
    this.clearTimer()
    this.phase = 'lobby'
    this.game = null
    this.results = null
    this.pendingEvents = []
    this.pruneGone()
  }

  private gameAction(conn: Conn, p: Player, type: string, payload: Record<string, unknown>): void {
    const g = this.game
    if (this.phase !== 'playing' || !g) return this.err(conn, 'bad_phase', 'No game is running right now.')
    if (!g.roster.has(p.id)) return this.err(conn, 'spectating', "You're watching this round — you'll play in the next one.")
    const r = this.call('action', () => g.def.action(g.state, p.id, { type, payload }, this.ctx()))
    if (!r.ok) return this.err(conn, 'game_error', 'The game tripped over that. Try again?')
    const step = r.value
    if (step && typeof step === 'object' && typeof step.error === 'string' && step.error) {
      return this.err(conn, 'action_rejected', step.error)
    }
    this.applyStep(step)
    this.commit()
  }

  private applyStep(step: Step<unknown> | undefined): boolean {
    if (!step || typeof step !== 'object' || !('state' in step)) {
      this.opts.log.error('game returned a bad step', { room: this.code, game: this.gameId })
      return false
    }
    if (this.game) this.game.state = step.state
    if (Array.isArray(step.events)) this.pendingEvents.push(...step.events)
    return true
  }

  private finishIfOver(): boolean {
    const g = this.game
    if (this.phase !== 'playing' || !g) return false
    const over = this.call('isOver', () => g.def.isOver(g.state))
    if (!over.ok || !over.value) return false
    const scores = this.currentScores()
    const res = this.call('results', () => g.def.results(g.state, this.ctx()))
    const extra = res.ok && res.value && typeof res.value === 'object' ? res.value : { highlights: [] }
    const ranked = g.teamIds
      .map((teamId) => ({ teamId, score: scores[teamId] ?? 0 }))
      .sort((a, b) => b.score - a.score)
    let rank = 0
    const ranking = ranked.map((r, i) => {
      if (i === 0 || r.score !== ranked[i - 1]!.score) rank = i + 1
      return { ...r, rank }
    })
    const highlights = Array.isArray(extra.highlights) ? extra.highlights.filter((h): h is string => typeof h === 'string') : []
    const awards = Array.isArray(extra.awards)
      ? extra.awards.filter((a) => a && typeof a.playerId === 'string' && typeof a.title === 'string')
      : undefined
    this.results = { ranking, highlights, ...(awards && awards.length ? { awards } : {}) }
    this.phase = 'results'
    this.clearTimer()
    this.opts.log.info('game over', { room: this.code, game: g.def.id })
    this.opts.stats?.count('gamesFinished')
    return true
  }

  private currentScores(): Record<TeamId, number> {
    const g = this.game
    if (!g) return {}
    const r = this.call('scores', () => g.def.scores(g.state))
    const raw = r.ok && r.value && typeof r.value === 'object' ? r.value : {}
    const out: Record<TeamId, number> = {}
    for (const id of g.teamIds) {
      const v = raw[id]
      out[id] = typeof v === 'number' && Number.isFinite(v) ? v : 0
    }
    return out
  }

  private currentDeadline(): number | null {
    const g = this.game
    if (this.phase !== 'playing' || !g) return null
    const r = this.call('deadline', () => g.def.deadline(g.state))
    return r.ok && typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : null
  }

  // ---------------------------------------------------------------- timers

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(minDelay = 0): void {
    this.clearTimer()
    if (this.disposed) return
    const d = this.currentDeadline()
    if (d === null) return
    const delay = Math.min(2 ** 31 - 1, Math.max(minDelay, d - Date.now()))
    this.timer = setTimeout(() => this.runTicks(), delay)
  }

  private runTicks(): void {
    this.timer = null
    const g = this.game
    if (!g || this.phase !== 'playing') return
    for (let i = 0; i < MAX_TICKS_PER_RUN; i++) {
      const d = this.currentDeadline()
      if (d === null || d > Date.now()) return this.commit()
      const r = this.call('tick', () => g.def.tick(g.state, this.ctx()))
      if (!r.ok || !this.applyStep(r.value)) {
        g.tickFailures++
        if (g.tickFailures >= MAX_TICK_FAILURES) {
          this.opts.log.error('game kept failing on tick; back to lobby', { room: this.code, game: g.def.id })
          this.toLobby()
          this.broadcastError('game_error', `${g.def.meta.name} glitched out. Back to the lobby — sorry!`)
          return this.commit()
        }
        this.broadcast()
        return this.schedule(1000)
      }
      g.tickFailures = 0
      if (this.finishIfOver()) return this.commit()
    }
    // Deadline still due after many ticks: the game is not advancing it.
    this.opts.log.error('tick did not advance the deadline', { room: this.code, game: g.def.id })
    this.broadcast()
    this.flushEvents()
    this.schedule(1000)
  }

  // ---------------------------------------------------------------- commit & broadcast

  /** After every change: game over?, re-arm the timer, host check, broadcast, events. */
  private commit(): void {
    if (this.disposed) return
    this.finishIfOver()
    this.ensureHost()
    this.schedule()
    this.emptySince = this.connectedCount === 0 ? (this.emptySince ?? Date.now()) : null
    this.broadcast()
    this.flushEvents()
  }

  private ctx(): BaseCtx {
    const g = this.game
    const players: GamePlayer[] = []
    const teams: GameTeam[] = []
    if (g) {
      for (const [id, r] of g.roster) {
        players.push({ id, ...r, connected: (this.players.get(id)?.conns.size ?? 0) > 0 })
      }
      for (const teamId of g.teamIds) {
        const t = this.teams.find((x) => x.id === teamId)
        teams.push({
          id: teamId,
          name: t?.name ?? 'Team',
          color: t?.color ?? 'sun',
          playerIds: [...g.roster].filter(([, r]) => r.teamId === teamId).map(([id]) => id),
        })
      }
    }
    const random = mulberry32(hashString(`${this.code}:${this.createdAt}:${this.rngCounter++}`))
    return { now: Date.now(), random, players, teams, hostId: this.hostId ?? '' }
  }

  private broadcast(): void {
    const now = Date.now()
    const players: PlayerInfo[] = [...this.players.values()]
      .sort((a, b) => a.joinOrder - b.joinOrder)
      .map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        teamId: p.teamId,
        connected: p.conns.size > 0,
        isHost: p.id === this.hostId,
      }))
    const teams: TeamInfo[] = this.teams.map((t) => ({ ...t, playerIds: [...t.playerIds] }))
    const g = this.game
    const deadline = this.currentDeadline()
    const scores = this.currentScores()
    const ctx = g ? this.ctx() : null
    const chatOn = this.chatEnabled()
    for (const p of this.players.values()) {
      if (p.conns.size === 0) continue
      let game: RoomSnapshot['game'] = null
      if (g && ctx && this.phase !== 'lobby') {
        const v = this.call('view', () => g.def.view(g.state, p.id, ctx))
        game = { view: v.ok ? v.value : { error: 'view_failed' }, deadline, scores }
      }
      const snapshot: RoomSnapshot = {
        code: this.code,
        phase: this.phase,
        you: p.id,
        players,
        teams,
        gameId: this.gameId,
        settings: this.settings,
        game,
        results: this.results,
        teamChat: chatOn && p.teamId ? (this.chat.get(p.teamId) ?? []) : [],
        serverNow: now,
      }
      const msg: ServerMessage = { t: 'room', room: snapshot }
      for (const c of p.conns) c.send(msg)
    }
  }

  private flushEvents(): void {
    const events = this.pendingEvents
    this.pendingEvents = []
    const g = this.game
    for (const e of events) {
      if (!e || typeof e.type !== 'string') continue
      const msg: ServerMessage = { t: 'event', type: e.type, data: e.data ?? {}, at: Date.now() }
      let targets: Player[]
      if (!e.to) targets = [...this.players.values()]
      else if ('teamId' in e.to) {
        const teamId = e.to.teamId
        // Team-addressed events go to that team's players in this game only,
        // never to a late joiner who was parked on the team mid-game.
        targets = [...this.players.values()].filter((p) => (g ? g.roster.get(p.id)?.teamId === teamId : p.teamId === teamId))
      } else {
        const ids = new Set(e.to.playerIds)
        targets = [...this.players.values()].filter((p) => ids.has(p.id))
      }
      for (const p of targets) for (const c of p.conns) c.send(msg)
    }
  }

  private broadcastError(code: string, message: string): void {
    for (const p of this.players.values()) for (const c of p.conns) c.send({ t: 'error', code, message })
  }

  private requireLobby(conn: Conn): boolean {
    if (this.phase === 'lobby') return true
    this.err(conn, 'bad_phase', 'That only works in the lobby.')
    return false
  }

  private err(conn: Conn, code: string, message: string): void {
    conn.send({ t: 'error', code, message })
  }

  private call<T>(what: string, fn: () => T): Result<T> {
    try {
      return { ok: true, value: fn() }
    } catch (e) {
      this.opts.log.error(`game.${what} threw`, {
        room: this.code,
        game: this.game?.def.id ?? this.gameId,
        error: e instanceof Error ? (e.stack ?? e.message) : String(e),
      })
      return { ok: false }
    }
  }
}
