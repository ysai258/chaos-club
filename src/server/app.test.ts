import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import type { ServerMessage } from '../shared/protocol.ts'
import { createChaosServer, type ChaosServer } from './app.ts'
import { silentLogger } from './log.ts'
import { testGame } from './test-game.ts'

let app: ChaosServer
let base: string
let wsUrl: string

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chaos-static-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Chaos Club</title>')
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)')
  writeFileSync(join(dir, 'favicon.svg'), '<svg/>')
  app = await createChaosServer({ games: { [testGame.id]: testGame }, log: silentLogger, port: 0, host: '127.0.0.1', staticDir: dir })
  base = `http://127.0.0.1:${app.port}`
  wsUrl = `ws://127.0.0.1:${app.port}/ws`
})

afterAll(async () => {
  await app.close()
})

function open(): Promise<{ ws: WebSocket; next: (t: ServerMessage['t']) => Promise<ServerMessage>; closed: Promise<number> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const queue: ServerMessage[] = []
    const waiters: { t: string; fn: (m: ServerMessage) => void }[] = []
    ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as ServerMessage
      const w = waiters.findIndex((x) => x.t === m.t)
      if (w >= 0) waiters.splice(w, 1)[0]!.fn(m)
      else queue.push(m)
    })
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)))
    const next = (t: ServerMessage['t']) =>
      new Promise<ServerMessage>((r) => {
        const i = queue.findIndex((m) => m.t === t)
        if (i >= 0) r(queue.splice(i, 1)[0]!)
        else waiters.push({ t, fn: r })
      })
    ws.on('open', () => resolve({ ws, next, closed }))
    ws.on('error', reject)
  })
}

describe('http', () => {
  it('health, games, rooms', async () => {
    expect(await (await fetch(`${base}/health`)).json()).toMatchObject({ ok: true })
    const games = (await (await fetch(`${base}/api/games`)).json()) as { games: { id: string; settingsSpec: unknown[] }[] }
    expect(games.games[0]!.id).toBe('test-lab')
    expect(games.games[0]!.settingsSpec.length).toBeGreaterThan(0)
    const res = await fetch(`${base}/api/rooms`, { method: 'POST' })
    expect(res.status).toBe(201)
    const { code } = (await res.json()) as { code: string }
    expect(code).toMatch(/^[A-Z]{5}$/)
    expect(await (await fetch(`${base}/api/rooms/${code.toLowerCase()}`)).json()).toMatchObject({ code, phase: 'lobby', players: 0 })
    expect((await fetch(`${base}/api/rooms/ZZZZZ`)).status).toBe(404)
    expect((await fetch(`${base}/api/nope`)).status).toBe(404)
  })

  it('serves the SPA with sensible caching', async () => {
    const index = await fetch(`${base}/r/ABCDE`)
    expect(index.status).toBe(200)
    expect(index.headers.get('cache-control')).toBe('no-cache')
    expect(await index.text()).toContain('Chaos Club')
    const asset = await fetch(`${base}/assets/app-abc123.js`)
    expect(asset.headers.get('cache-control')).toContain('immutable')
    expect(asset.headers.get('content-type')).toContain('javascript')
    expect((await fetch(`${base}/favicon.svg`)).headers.get('content-type')).toBe('image/svg+xml')
    expect((await fetch(`${base}/assets/missing-old.js`)).status).toBe(404)
    expect((await fetch(`${base}/..%2f..%2fetc%2fpasswd`)).status).not.toBe(500)
    const traversal = await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd`)
    expect(await traversal.text()).not.toContain('root:')
  })
})

describe('websocket', () => {
  it('hello → welcome → per-viewer room snapshot; ping → pong', async () => {
    const { code } = (await (await fetch(`${base}/api/rooms`, { method: 'POST' })).json()) as { code: string }
    const a = await open()
    a.ws.send(JSON.stringify({ t: 'hello', code, token: null, name: 'Asha', avatar: '🐸' }))
    const welcome = await a.next('welcome')
    expect(welcome).toMatchObject({ t: 'welcome' })
    const room = await a.next('room')
    if (room.t !== 'room' || welcome.t !== 'welcome') throw new Error('bad')
    expect(room.room.you).toBe(welcome.playerId)
    expect(room.room.players[0]).toMatchObject({ name: 'Asha', avatar: '🐸', isHost: true, connected: true })
    a.ws.send(JSON.stringify({ t: 'ping' }))
    const pong = await a.next('pong')
    expect(pong.t === 'pong' && Math.abs(pong.serverNow - Date.now()) < 1000).toBe(true)

    // Reconnect on a new socket with the token.
    a.ws.close()
    const b = await open()
    b.ws.send(JSON.stringify({ t: 'hello', code, token: welcome.token, name: 'Asha', avatar: '🐸' }))
    const again = await b.next('welcome')
    expect(again.t === 'welcome' && again.playerId).toBe(welcome.playerId)
    b.ws.close()
  })

  it('closes sockets that send more than 16KB', async () => {
    const c = await open()
    c.ws.send('x'.repeat(17 * 1024))
    expect(await c.closed).toBe(1009)
  })

  it('rejects malformed messages without dying', async () => {
    const c = await open()
    c.ws.send('{"t":"hello","code":5}')
    const err = await c.next('error')
    expect(err).toMatchObject({ code: 'bad_message' })
    c.ws.close()
  })
})
