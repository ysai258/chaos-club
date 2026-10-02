/**
 * The room store and the message router. Owns per-connection rate limits and
 * idle-room cleanup; everything game-ish is delegated to `Room`.
 */
import type { AnyGame } from '../games/types.ts'
import { Room, type Conn } from './room.ts'
import { generateCode } from './random.ts'
import { parseClientMessage } from './schema.ts'
import type { Logger } from './log.ts'

export interface HubOptions {
  games: Record<string, AnyGame>
  log: Logger
  graceMs?: number
  hostGraceMs?: number
  /** A room nobody touched for this long is closed. */
  idleMs?: number
  /** A room with nobody connected for this long is closed. */
  emptyMs?: number
  /** Token bucket per socket. */
  rate?: { burst: number; perSecond: number }
}

interface Bucket {
  tokens: number
  at: number
  strikes: number
  warnedAt: number
}

export const MAX_ROOMS = 2000

export class Hub {
  readonly rooms = new Map<string, Room>()
  private readonly buckets = new WeakMap<Conn, Bucket>()
  private readonly opts: Required<HubOptions>

  constructor(opts: HubOptions) {
    this.opts = {
      graceMs: 30_000,
      hostGraceMs: 10_000,
      idleMs: 2 * 60 * 60_000,
      emptyMs: 10 * 60_000,
      rate: { burst: 30, perSecond: 15 },
      ...opts,
    }
  }

  createRoom(): Room {
    if (this.rooms.size >= MAX_ROOMS) this.sweep(Date.now())
    if (this.rooms.size >= MAX_ROOMS) throw new Error('Too many rooms')
    const code = generateCode((c) => this.rooms.has(c))
    const room = new Room(code, {
      games: this.opts.games,
      graceMs: this.opts.graceMs,
      hostGraceMs: this.opts.hostGraceMs,
      log: this.opts.log,
    })
    this.rooms.set(code, room)
    this.opts.log.info('room created', { room: code })
    return room
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase())
  }

  onMessage(conn: Conn, raw: string): void {
    if (!this.allow(conn)) return
    const msg = parseClientMessage(raw)
    if (!msg) {
      conn.send({ t: 'error', code: 'bad_message', message: "The server didn't understand that." })
      return
    }
    if (msg.t === 'ping') {
      conn.send({ t: 'pong', serverNow: Date.now() })
      return
    }
    if (msg.t === 'hello') {
      const room = this.getRoom(msg.code)
      if (!room) {
        conn.send({ t: 'error', code: 'room_not_found', message: `No room called ${msg.code.toUpperCase()}. Check the code?` })
        return
      }
      // Leaving one room for another on the same socket.
      if (conn.roomCode && conn.roomCode !== room.code) this.onClose(conn)
      room.lastActivity = Date.now()
      room.hello(conn, msg)
      return
    }
    const room = conn.roomCode ? this.rooms.get(conn.roomCode) : undefined
    if (!room) {
      conn.send({ t: 'error', code: 'not_in_room', message: 'Join a room first.' })
      return
    }
    room.handle(conn, msg)
  }

  onClose(conn: Conn): void {
    const room = conn.roomCode ? this.rooms.get(conn.roomCode) : undefined
    room?.detach(conn)
    conn.roomCode = undefined
  }

  /** Close rooms that went idle or empty. Returns how many were closed. */
  sweep(now: number): number {
    let closed = 0
    for (const [code, room] of this.rooms) {
      const idle = now - room.lastActivity > this.opts.idleMs
      const empty = room.emptySince !== null && now - room.emptySince > this.opts.emptyMs
      if (idle || empty) {
        room.dispose(idle ? 'This room went quiet for too long and was closed.' : 'This room was closed.')
        this.rooms.delete(code)
        this.opts.log.info('room closed', { room: code, reason: idle ? 'idle' : 'empty' })
        closed++
      }
    }
    return closed
  }

  disposeAll(): void {
    for (const room of this.rooms.values()) room.dispose('The server is restarting.')
    this.rooms.clear()
  }

  private allow(conn: Conn): boolean {
    const now = Date.now()
    const { burst, perSecond } = this.opts.rate
    let b = this.buckets.get(conn)
    if (!b) {
      b = { tokens: burst, at: now, strikes: 0, warnedAt: 0 }
      this.buckets.set(conn, b)
    }
    b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * perSecond)
    b.at = now
    if (b.tokens >= 1) {
      b.tokens -= 1
      return true
    }
    b.strikes++
    if (b.strikes > burst * 10) {
      this.opts.log.warn('socket flooded; closing', { room: conn.roomCode })
      conn.close(4008, 'rate limited')
      return false
    }
    if (now - b.warnedAt > 1000) {
      b.warnedAt = now
      conn.send({ t: 'error', code: 'rate_limited', message: 'Whoa, too fast! Give it a second.' })
    }
    return false
  }
}
