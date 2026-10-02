/**
 * The browser end of the WebSocket. One RoomClient per room visit.
 *
 * - Says hello with the stored token so a reload/reconnect keeps your seat.
 * - Reconnects with exponential backoff + jitter; immediately on 'online' and
 *   when the tab becomes visible again (phones kill sockets on lock).
 * - Estimates the server clock offset from ping/pong (best RTT wins), so
 *   countdowns agree across phones.
 */
import type { ClientMessage, RoomSnapshot, ServerMessage } from '../../shared/protocol.ts'
import { saveToken, loadToken, type Profile } from './storage.ts'

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface FatalError {
  code: 'room_not_found' | 'kicked' | 'room_closed'
  message: string
}

export interface ClientState {
  status: ConnStatus
  room: RoomSnapshot | null
  playerId: string | null
  fatal: FatalError | null
  /** True when this seat was created on this visit while a game was already running. */
  joinedMidGame: boolean
}

export type EventHandler = (type: string, data: Record<string, unknown>) => void
export type ErrorHandler = (code: string, message: string) => void

/** Last 200 game events on window.__chaosEvents, read by e2e helpers (getEvents). */
function recordEvent(type: string, data: Record<string, unknown>): void {
  const w = window as unknown as { __chaosEvents?: { type: string; data: Record<string, unknown>; at: number }[] }
  w.__chaosEvents ??= []
  w.__chaosEvents.push({ type, data, at: Date.now() })
  if (w.__chaosEvents.length > 200) w.__chaosEvents.splice(0, w.__chaosEvents.length - 200)
}

const FATAL = new Set(['room_not_found', 'kicked', 'room_closed'])
const PING_MS = 5000
const STALE_MS = 16000

export class RoomClient {
  private ws: WebSocket | null = null
  private state: ClientState = { status: 'connecting', room: null, playerId: null, fatal: null, joinedMidGame: false }
  private readonly listeners = new Set<() => void>()
  private readonly eventHandlers = new Set<EventHandler>()
  private readonly errorHandlers = new Set<ErrorHandler>()
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private lastMessageAt = 0
  private offset = 0
  private bestRtt = Infinity
  private rttSamples: { rtt: number; offset: number }[] = []
  private pingSentAt = 0
  private stopped = false
  private freshSeat = false
  private readonly code: string
  private readonly profile: Profile

  constructor(code: string, profile: Profile) {
    this.code = code.toUpperCase()
    this.profile = profile
    this.connect()
    window.addEventListener('online', this.wake)
    window.addEventListener('offline', this.dropSocket)
    document.addEventListener('visibilitychange', this.onVisible)
  }

  // ------------------------------------------------------------ public API

  getState = (): ClientState => this.state

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  onEvent(fn: EventHandler): () => void {
    this.eventHandlers.add(fn)
    return () => this.eventHandlers.delete(fn)
  }

  onError(fn: ErrorHandler): () => void {
    this.errorHandlers.add(fn)
    return () => this.errorHandlers.delete(fn)
  }

  /** Server-corrected Date.now(). */
  now = (): number => Date.now() + this.offset

  /** Returns false (and the UI should say so) when the socket isn't open. */
  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN || this.state.status !== 'open') {
      if (msg.t !== 'ping') this.emitError('offline', 'Reconnecting… try again in a sec.')
      return false
    }
    this.ws.send(JSON.stringify(msg))
    return true
  }

  close(): void {
    this.stopped = true
    this.clearTimers()
    window.removeEventListener('online', this.wake)
    window.removeEventListener('offline', this.dropSocket)
    document.removeEventListener('visibilitychange', this.onVisible)
    this.ws?.close(1000, 'bye')
    this.ws = null
  }

  // ------------------------------------------------------------ internals

  private set(patch: Partial<ClientState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  private url(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}/ws`
  }

  private connect(): void {
    if (this.stopped) return
    this.clearTimers()
    this.set({ status: this.state.room ? 'reconnecting' : 'connecting' })
    let ws: WebSocket
    try {
      ws = new WebSocket(this.url())
    } catch {
      return this.scheduleReconnect()
    }
    this.ws = ws
    ws.onopen = () => {
      this.lastMessageAt = Date.now()
      ws.send(
        JSON.stringify({
          t: 'hello',
          code: this.code,
          token: loadToken(this.code),
          name: this.profile.name,
          avatar: this.profile.avatar,
        } satisfies ClientMessage),
      )
      this.pingTimer = setInterval(() => this.ping(), PING_MS)
    }
    ws.onmessage = (e) => {
      this.lastMessageAt = Date.now()
      let msg: ServerMessage
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage
      } catch {
        return
      }
      this.receive(msg)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      this.clearTimers()
      if (this.stopped || this.state.fatal) return
      this.set({ status: 'reconnecting' })
      this.scheduleReconnect()
    }
    ws.onerror = () => {
      /* onclose follows */
    }
  }

  private receive(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome': {
        const previous = loadToken(this.code)
        this.freshSeat = previous !== msg.token
        saveToken(this.code, msg.token)
        this.attempt = 0
        this.set({ playerId: msg.playerId })
        this.ping()
        return
      }
      case 'room': {
        const room = msg.room
        // Before the first pong, a rough offset from the snapshot beats nothing.
        if (this.bestRtt === Infinity) this.offset = room.serverNow - Date.now()
        const joinedMidGame =
          this.state.room === null ? this.freshSeat && room.phase === 'playing' : this.state.joinedMidGame && room.phase === 'playing'
        this.set({ room, status: 'open', joinedMidGame })
        return
      }
      case 'event':
        recordEvent(msg.type, msg.data ?? {})
        for (const h of this.eventHandlers) {
          try {
            h(msg.type, msg.data ?? {})
          } catch (e) {
            console.error('event handler failed', e)
          }
        }
        return
      case 'pong': {
        if (!this.pingSentAt) return
        const rtt = Date.now() - this.pingSentAt
        this.pingSentAt = 0
        const offset = msg.serverNow + rtt / 2 - Date.now()
        this.rttSamples = [...this.rttSamples.slice(-7), { rtt, offset }]
        const best = this.rttSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a))
        this.bestRtt = best.rtt
        this.offset = best.offset
        return
      }
      case 'error':
        if (FATAL.has(msg.code)) {
          this.stopped = true
          if (msg.code === 'kicked' || msg.code === 'room_not_found') saveToken(this.code, null)
          this.set({ fatal: { code: msg.code as FatalError['code'], message: msg.message }, status: 'closed' })
          this.clearTimers()
          this.ws?.close()
          return
        }
        this.emitError(msg.code, msg.message)
        return
    }
  }

  private emitError(code: string, message: string): void {
    for (const h of this.errorHandlers) h(code, message)
  }

  private ping(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    if (Date.now() - this.lastMessageAt > STALE_MS) {
      // Half-open socket (common after a phone sleeps or switches networks). Start over.
      this.dropSocket()
      return
    }
    this.pingSentAt = Date.now()
    this.ws.send(JSON.stringify({ t: 'ping' } satisfies ClientMessage))
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    const base = Math.min(8000, 400 * 2 ** this.attempt)
    this.attempt++
    const delay = base / 2 + Math.random() * (base / 2)
    this.retryTimer = setTimeout(() => this.connect(), delay)
  }

  /** Abandon the current socket without waiting for a close handshake that may never come. */
  private dropSocket = (): void => {
    const ws = this.ws
    if (!ws) return
    this.ws = null
    ws.onclose = null
    ws.onmessage = null
    try {
      ws.close()
    } catch {
      /* already dead */
    }
    this.clearTimers()
    if (this.stopped || this.state.fatal) return
    this.set({ status: 'reconnecting' })
    this.scheduleReconnect()
  }

  private wake = (): void => {
    if (this.stopped) return
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.attempt = 0
      this.connect()
    } else if (this.ws.readyState === WebSocket.OPEN) {
      this.ping()
    }
  }

  private onVisible = (): void => {
    if (document.visibilityState === 'visible') this.wake()
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.retryTimer = null
    this.pingTimer = null
  }
}
