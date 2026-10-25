/**
 * HTTP + WebSocket front door. `createChaosServer` is used by the entry point
 * and by integration tests (with port 0 and a fake game registry).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import type { AnyGame } from '../games/types.ts'
import { Hub, type HubOptions } from './hub.ts'
import type { Conn } from './room.ts'
import { newId } from './random.ts'
import { TEST_GAME_ID } from './test-game.ts'
import type { Logger } from './log.ts'
import type { Stats } from './stats.ts'

export const MAX_PAYLOAD = 16 * 1024

export interface ServerOptions extends Omit<HubOptions, 'games' | 'log' | 'stats'> {
  games: Record<string, AnyGame>
  log: Logger
  port: number
  host?: string
  /** Built web app to serve (dist/web). Omit in dev; Vite serves the UI. */
  staticDir?: string | null
  sweepEveryMs?: number
  heartbeatMs?: number
  /** Play counters served at GET /stats. Omit to turn the endpoint off. */
  stats?: Stats
  /** How often the online count is sampled for the daily peak. */
  statsSampleMs?: number
}

export interface ChaosServer {
  server: Server
  hub: Hub
  port: number
  close(): Promise<void>
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(data),
  })
  res.end(data)
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for']
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim()
  return first || req.socket.remoteAddress || 'unknown'
}

export function createChaosServer(opts: ServerOptions): Promise<ChaosServer> {
  const { games, log } = opts
  const hub = new Hub(opts)
  const staticRoot = opts.staticDir && existsSync(opts.staticDir) ? resolve(opts.staticDir) : null
  const indexHtml = staticRoot ? join(staticRoot, 'index.html') : null
  const gameList = Object.values(games).map((g) => ({
    id: g.id,
    meta: g.meta,
    settingsSpec: g.settingsSpec,
    ...(g.id === TEST_GAME_ID ? { testOnly: true } : {}),
  }))

  // POST /api/rooms: 20 per minute per IP is plenty for a party.
  const createHits = new Map<string, { n: number; since: number }>()
  const allowCreate = (ip: string): boolean => {
    const now = Date.now()
    const h = createHits.get(ip)
    if (!h || now - h.since > 60_000) {
      createHits.set(ip, { n: 1, since: now })
      return true
    }
    h.n++
    return h.n <= 20
  }

  const serveStatic = (req: IncomingMessage, res: ServerResponse, pathname: string): void => {
    if (!staticRoot || !indexHtml) return json(res, 404, { error: 'not_found' })
    let rel: string
    try {
      rel = decodeURIComponent(pathname)
    } catch {
      return json(res, 400, { error: 'bad_path' })
    }
    const file = normalize(join(staticRoot, rel))
    const inside = file === staticRoot || file.startsWith(staticRoot + sep)
    let target = indexHtml
    if (inside && existsSync(file) && statSync(file).isFile()) target = file
    else if (extname(rel) && rel !== '/') {
      // A missing asset (old hashed bundle, typo) is a real 404, not the SPA.
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      return void res.end('Not found')
    }
    const isIndex = target === indexHtml
    const hashed = target.includes(`${sep}assets${sep}`)
    const size = statSync(target).size
    const headers: Record<string, string | number> = {
      'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': isIndex ? 'no-cache' : hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      'accept-ranges': 'bytes',
    }
    // Byte ranges: video players (iOS Safari above all) refuse to play
    // without them, and seeking needs them everywhere.
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
    if (range && !isIndex && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2])
      let end = range[1] && range[2] ? Number(range[2]) : size - 1
      start = Math.max(0, start)
      end = Math.min(end, size - 1)
      if (start > end || start >= size) {
        res.writeHead(416, { 'content-range': `bytes */${size}` })
        return void res.end()
      }
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 })
      if (req.method === 'HEAD') return void res.end()
      return void createReadStream(target, { start, end }).pipe(res)
    }
    res.writeHead(200, { ...headers, 'content-length': size })
    if (req.method === 'HEAD') return void res.end()
    createReadStream(target).pipe(res)
  }

  // GET /stats: counts only (no names, codes or IPs), so it is public like /health.
  const serveStats = (res: ServerResponse, url: URL): void => {
    const stats = opts.stats
    if (!stats) return json(res, 404, { error: 'not_found' })
    const days = Number(url.searchParams.get('days') ?? 14)
    stats
      .report(days, hub.liveCounts())
      .then((body) => json(res, 200, body))
      .catch((e: unknown) =>
        json(res, 503, { error: `Stats are unavailable right now (${e instanceof Error ? e.message : String(e)})`, live: hub.liveCounts() }),
      )
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    try {
      if (path === '/health') return json(res, 200, { ok: true, rooms: hub.rooms.size, uptime: Math.round(process.uptime()) })
      if (path === '/stats' && req.method === 'GET') {
        res.setHeader('access-control-allow-origin', '*')
        return serveStats(res, url)
      }
      if (path === '/api/games' && req.method === 'GET') return json(res, 200, { games: gameList })
      if (path === '/api/rooms' && req.method === 'POST') {
        req.resume()
        if (!allowCreate(clientIp(req))) return json(res, 429, { error: 'Slow down — too many rooms created.' })
        const room = hub.createRoom()
        return json(res, 201, { code: room.code })
      }
      const m = /^\/api\/rooms\/([A-Za-z]{1,10})$/.exec(path)
      if (m && req.method === 'GET') {
        const room = hub.getRoom(m[1]!)
        return room ? json(res, 200, room.summary()) : json(res, 404, { error: 'room_not_found' })
      }
      if (path.startsWith('/api/')) return json(res, 404, { error: 'not_found' })
      if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, path)
      return json(res, 405, { error: 'method_not_allowed' })
    } catch (e) {
      log.error('http handler failed', { path, error: e instanceof Error ? e.message : String(e) })
      if (!res.headersSent) json(res, 500, { error: 'server_error' })
      else res.end()
    }
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD })
  const alive = new WeakMap<WebSocket, boolean>()

  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    if (path !== '/ws') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })

  wss.on('connection', (ws: WebSocket) => {
    alive.set(ws, true)
    const conn: Conn = {
      id: newId('c'),
      send(msg) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
      },
      close(code, reason) {
        try {
          ws.close(code, reason)
        } catch {
          ws.terminate()
        }
      },
    }
    ws.on('pong', () => alive.set(ws, true))
    ws.on('message', (data, isBinary) => {
      if (isBinary) return conn.send({ t: 'error', code: 'bad_message', message: 'Text frames only.' })
      try {
        hub.onMessage(conn, data.toString())
      } catch (e) {
        log.error('message handler failed', { error: e instanceof Error ? (e.stack ?? e.message) : String(e) })
        conn.send({ t: 'error', code: 'server_error', message: 'Something broke on our side. Try again?' })
      }
    })
    ws.on('close', () => {
      try {
        hub.onClose(conn)
      } catch (e) {
        log.error('close handler failed', { error: e instanceof Error ? e.message : String(e) })
      }
    })
    ws.on('error', (e) => log.warn('socket error', { error: e.message }))
  })

  // Drop sockets that stopped answering pings (phone went to sleep mid-Wi-Fi switch, etc).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate()
        continue
      }
      alive.set(ws, false)
      try {
        ws.ping()
      } catch {
        /* closing */
      }
    }
  }, opts.heartbeatMs ?? 25_000)
  const sweeper = setInterval(() => hub.sweep(Date.now()), opts.sweepEveryMs ?? 60_000)
  const sampler = opts.stats ? setInterval(() => opts.stats?.online(hub.liveCounts().online), opts.statsSampleMs ?? 5000) : null
  opts.stats?.start()
  heartbeat.unref()
  sweeper.unref()
  sampler?.unref()

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(opts.port, opts.host ?? '0.0.0.0', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : opts.port
      resolvePromise({
        server,
        hub,
        port,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(heartbeat)
            clearInterval(sweeper)
            if (sampler) clearInterval(sampler)
            opts.stats?.stop()
            hub.disposeAll()
            for (const ws of wss.clients) ws.terminate()
            wss.close()
            // Write the last counters out before saying we're closed.
            server.close(() => void Promise.resolve(opts.stats?.flush()).finally(done))
            server.closeAllConnections?.()
          }),
      })
    })
  })
}
